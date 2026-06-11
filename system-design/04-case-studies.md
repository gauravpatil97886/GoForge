# Full System Design Case Studies for Go Developers

Every case study follows the complete 5-step interview framework used at Google, Meta, Uber, and Stripe. Each section contains production-grade Go code, capacity math, Mermaid architecture diagrams, and the follow-up questions interviewers actually ask.

---

## How to Use This File

The framework used in every case study below:

1. **Requirements Clarification** — What you ask the interviewer, what you confirm
2. **Capacity Estimation** — Back-of-envelope math (never skip this)
3. **High-Level Design** — Architecture diagram + component list
4. **Component Deep Dive** — Code, schemas, algorithms
5. **Bottlenecks and Scale** — What breaks, how to fix it

---

## Case Study 1: Design a URL Shortener (bit.ly Clone)

### Why This Problem Appears in Interviews

A URL shortener is a canonical system design problem because it touches: ID generation at scale, read-heavy caching, database indexing, CDN usage, and analytics pipelines — all in a single system.

---

### Step 1: Requirements Clarification

**Questions you ask the interviewer:**

| Question | Why You Ask |
|---|---|
| "What is the expected URL length after shortening?" | Determines ID space and encoding scheme |
| "Do shortened URLs expire?" | Affects storage estimates and TTL strategy |
| "Do we need custom aliases (e.g. bit.ly/my-brand)?" | Adds write complexity and conflict resolution |
| "Do we need analytics (click counts, geo, device)?" | Changes the write path significantly |
| "What is the read/write ratio?" | Determines caching strategy |
| "Global or single region?" | Changes replication and CDN requirements |

**Confirmed Non-Functional Requirements:**

- 100M URLs stored total
- 10B redirects per day
- p99 redirect latency under 100ms
- 99.99% uptime (52 minutes downtime/year)
- URLs do not expire by default (configurable)

---

### Step 2: Capacity Estimation

**Write path (URL creation):**

```
Assume 100M total URLs created over 5 years
= 100,000,000 / (5 × 365 × 86,400)
= 100,000,000 / 157,680,000
≈ 0.63 writes/sec
Peak: 10× = ~6 writes/sec
```

**Read path (redirects):**

```
10B redirects/day
= 10,000,000,000 / 86,400
≈ 115,741 redirects/sec
Peak: 3× = ~350,000 redirects/sec
```

**Storage:**

```
Per URL record: 500 bytes (original URL 400 + short code 10 + metadata 90)
100M records × 500 bytes = 50 GB
Analytics: ~200 bytes/click × 10B/day × 365 = ~730 TB/year (store aggregated, not raw)
```

**Bandwidth:**

```
Read: 350,000 req/sec × 500 bytes = 175 MB/s outbound
Write: 6 req/sec × 500 bytes = negligible
```

**Summary Table:**

| Metric | Value |
|---|---|
| Write RPS (peak) | 6/sec |
| Read RPS (peak) | 350,000/sec |
| Storage (URLs) | 50 GB |
| Bandwidth (read) | 175 MB/s |
| Cache hit target | 99%+ |

---

### Step 3: High-Level Design

```mermaid
graph TD
    Client["Client Browser / App"]
    LB["Load Balancer\n(L7, e.g. NGINX / ALB)"]
    URLService["URL Service\n(Go, stateless, 10 replicas)"]
    Cache["Redis Cluster\n(read cache, TTL 24h)"]
    DB["PostgreSQL\n(primary + read replicas)"]
    Analytics["Analytics Service\n(async, Kafka consumer)"]
    Kafka["Kafka\n(click events)"]
    CDN["CDN\n(popular URLs)"]

    Client -->|"POST /shorten"| LB
    Client -->|"GET /:code"| CDN
    CDN -->|"cache miss"| LB
    LB --> URLService
    URLService -->|"read"| Cache
    Cache -->|"miss"| DB
    URLService -->|"write"| DB
    URLService -->|"publish click"| Kafka
    Kafka --> Analytics
    Analytics -->|"write aggregates"| DB
```

**Component Responsibilities:**

| Component | Role | Tech Choice |
|---|---|---|
| Load Balancer | L7 routing, SSL termination | NGINX or AWS ALB |
| URL Service | Shorten + redirect logic | Go (stateless) |
| Redis | Short-code → long-URL cache | Redis Cluster (6 shards) |
| PostgreSQL | Source of truth for URL mappings | Primary + 3 read replicas |
| Kafka | Async click event stream | 12 partitions |
| Analytics Service | Aggregation, dashboards | Go consumer |
| CDN | Edge cache for popular URLs | CloudFront / Fastly |

---

### Step 4: Component Deep Dive

#### URL Encoding: Base62

Base62 uses `[0-9A-Za-z]` — 62 characters. A 7-character code gives 62^7 = 3.5 trillion combinations, more than enough.

```go
package shortener

const base62Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// Encode converts a numeric ID to a base62 string.
// Example: 125 → "CB"
func Encode(id uint64) string {
    if id == 0 {
        return string(base62Chars[0])
    }
    result := make([]byte, 0, 8)
    for id > 0 {
        result = append(result, base62Chars[id%62])
        id /= 62
    }
    // reverse
    for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
        result[i], result[j] = result[j], result[i]
    }
    return string(result)
}

// Decode converts a base62 string back to a numeric ID.
func Decode(code string) uint64 {
    var id uint64
    for _, c := range code {
        id = id*62 + uint64(charIndex(byte(c)))
    }
    return id
}

func charIndex(c byte) int {
    switch {
    case c >= '0' && c <= '9':
        return int(c - '0')
    case c >= 'A' && c <= 'Z':
        return int(c-'A') + 10
    case c >= 'a' && c <= 'z':
        return int(c-'a') + 36
    default:
        return -1
    }
}
```

#### Redirect HTTP Handler with Redis Cache

```go
package handlers

import (
    "context"
    "net/http"
    "time"

    "github.com/go-redis/redis/v8"
)

type RedirectHandler struct {
    redis *redis.Client
    store URLStore // interface over PostgreSQL
}

// ServeHTTP handles GET /:code and redirects to the original URL.
// Cache-aside: check Redis first, fall back to DB on miss.
func (h *RedirectHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    code := r.URL.Path[1:] // strip leading "/"
    if code == "" || len(code) > 10 {
        http.NotFound(w, r)
        return
    }

    ctx, cancel := context.WithTimeout(r.Context(), 80*time.Millisecond)
    defer cancel()

    // 1. Check Redis cache
    longURL, err := h.redis.Get(ctx, "url:"+code).Result()
    if err == nil {
        // cache hit — respond immediately
        http.Redirect(w, r, longURL, http.StatusMovedPermanently)
        go h.publishClick(code, r) // async analytics
        return
    }

    // 2. Cache miss — query database
    longURL, err = h.store.GetByCode(ctx, code)
    if err != nil {
        http.NotFound(w, r)
        return
    }

    // 3. Populate cache with 24h TTL
    h.redis.SetEX(ctx, "url:"+code, longURL, 24*time.Hour)

    http.Redirect(w, r, longURL, http.StatusMovedPermanently)
    go h.publishClick(code, r)
}

func (h *RedirectHandler) publishClick(code string, r *http.Request) {
    // publish to Kafka for async analytics processing
}
```

#### Database Schema

```sql
CREATE TABLE urls (
    id          BIGSERIAL PRIMARY KEY,
    short_code  VARCHAR(10)  NOT NULL UNIQUE,
    long_url    TEXT         NOT NULL,
    user_id     BIGINT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,
    click_count BIGINT       NOT NULL DEFAULT 0
);

-- Primary lookup: short_code → long_url (used on every redirect)
CREATE UNIQUE INDEX idx_urls_short_code ON urls(short_code);

-- For user dashboards listing their URLs
CREATE INDEX idx_urls_user_id ON urls(user_id) WHERE user_id IS NOT NULL;

-- For expiry cleanup job
CREATE INDEX idx_urls_expires_at ON urls(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE analytics_hourly (
    short_code  VARCHAR(10)  NOT NULL,
    hour        TIMESTAMPTZ  NOT NULL,
    click_count BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (short_code, hour)
);
```

#### Cache Strategy: Cache-Aside with SETEX

```
On redirect request:
  1. GET url:{code} from Redis
  2. If HIT → redirect, publish click event async
  3. If MISS → SELECT from PostgreSQL read replica
  4. SETEX url:{code} 86400 {long_url}   ← 24h TTL
  5. Redirect, publish click event async

On URL creation:
  - Write to PostgreSQL primary
  - Do NOT pre-warm cache (lazy loading is fine here)

On URL update/deletion:
  - Write to PostgreSQL primary
  - DEL url:{code} from Redis (invalidate)
```

---

### Step 5: Bottlenecks and Scale

**What breaks at 1B redirects/day:**

| Bottleneck | Symptoms | Fix |
|---|---|---|
| Single Redis node | OOM, single point of failure | Redis Cluster (6 shards) |
| Single PostgreSQL | Read replica lag, connection pool exhaustion | 3 read replicas + PgBouncer |
| URL Service pods | CPU saturation | Horizontal autoscaling (HPA in K8s) |
| Analytics writes | Slows redirect path | Decouple to Kafka → async consumer |
| Hot URLs | 80% traffic to 20% URLs, thundering herd on cache miss | CDN caching + cache warming |

**Database read replica for redirects:**

Redirect queries are `SELECT long_url FROM urls WHERE short_code = $1` — read-only, perfectly suited for read replicas. The URL service connects to a replica pool (via PgBouncer) for all GET operations. Writes (shorten) go to primary only.

**CDN for popular URLs:**

Top 0.1% of URLs generate ~50% of traffic. These can be cached at CDN edge nodes:

```
Response headers on redirect:
  Cache-Control: public, max-age=3600
  Vary: Accept-Encoding

CDN caches the 301/302 response. Edge nodes serve redirects with <5ms latency globally.
```

**Geographic distribution:**

```
US-East  ──┐
US-West  ──┼── Global LB (GeoDNS) ── Route to nearest region
EU-West  ──┤
AP-SE    ──┘

Each region: 2 URL Service pods + 1 Redis + 1 PG read replica
Single global primary PostgreSQL (US-East) for writes
```

---

### Full Go Implementation: URL Shortener Service

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "net/http"
    "sync/atomic"
    "time"

    "github.com/go-redis/redis/v8"
    _ "github.com/lib/pq"
)

// --- ID Generation (Snowflake-like) ---
// Format: [41 bits timestamp | 10 bits machine ID | 12 bits sequence]

type IDGenerator struct {
    machineID  uint64
    sequence   uint64
    lastMillis uint64
}

func NewIDGenerator(machineID uint64) *IDGenerator {
    return &IDGenerator{machineID: machineID & 0x3FF} // 10 bits
}

func (g *IDGenerator) NextID() uint64 {
    now := uint64(time.Now().UnixMilli())
    seq := atomic.AddUint64(&g.sequence, 1) & 0xFFF // 12 bits
    return (now << 22) | (g.machineID << 12) | seq
}

// --- Base62 Encoding ---

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

func encode(id uint64) string {
    buf := make([]byte, 0, 8)
    for id > 0 {
        buf = append(buf, base62[id%62])
        id /= 62
    }
    for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
        buf[i], buf[j] = buf[j], buf[i]
    }
    return string(buf)
}

// --- Service ---

type URLService struct {
    db    *sql.DB
    rdb   *redis.Client
    idGen *IDGenerator
}

func (s *URLService) Shorten(ctx context.Context, longURL string) (string, error) {
    id := s.idGen.NextID()
    code := encode(id)

    _, err := s.db.ExecContext(ctx,
        `INSERT INTO urls (id, short_code, long_url) VALUES ($1, $2, $3)`,
        id, code, longURL,
    )
    if err != nil {
        return "", fmt.Errorf("insert url: %w", err)
    }
    return code, nil
}

func (s *URLService) Resolve(ctx context.Context, code string) (string, error) {
    // Cache-aside
    val, err := s.rdb.Get(ctx, "url:"+code).Result()
    if err == nil {
        return val, nil
    }

    var longURL string
    err = s.db.QueryRowContext(ctx,
        `SELECT long_url FROM urls WHERE short_code = $1`, code,
    ).Scan(&longURL)
    if err != nil {
        return "", fmt.Errorf("url not found: %w", err)
    }

    s.rdb.SetEX(ctx, "url:"+code, longURL, 24*time.Hour)
    return longURL, nil
}

// --- HTTP Handlers ---

func (s *URLService) handleShorten(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    longURL := r.FormValue("url")
    if longURL == "" {
        http.Error(w, "url is required", http.StatusBadRequest)
        return
    }
    ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
    defer cancel()

    code, err := s.Shorten(ctx, longURL)
    if err != nil {
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    fmt.Fprintf(w, "https://short.ly/%s\n", code)
}

func (s *URLService) handleRedirect(w http.ResponseWriter, r *http.Request) {
    code := r.URL.Path[1:]
    ctx, cancel := context.WithTimeout(r.Context(), 80*time.Millisecond)
    defer cancel()

    longURL, err := s.Resolve(ctx, code)
    if err != nil {
        http.NotFound(w, r)
        return
    }
    http.Redirect(w, r, longURL, http.StatusMovedPermanently)
}

func main() {
    db, _ := sql.Open("postgres", "postgres://localhost/shortener?sslmode=disable")
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    svc := &URLService{db: db, rdb: rdb, idGen: NewIDGenerator(1)}

    http.HandleFunc("/shorten", svc.handleShorten)
    http.HandleFunc("/", svc.handleRedirect)

    log.Println("URL shortener listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

---

### Interviewer Follow-up Questions (URL Shortener)

**Q1: How do you prevent duplicate long URLs from getting multiple short codes?**

Add a `UNIQUE INDEX` on `long_url` (or a hash of it for long URLs). On insert, use `ON CONFLICT (long_url) DO NOTHING RETURNING short_code` to return the existing code. For very long URLs, store a SHA-256 hash as the lookup key.

**Q2: How do you handle custom aliases (e.g. bit.ly/black-friday)?**

Add an `alias` column to the `urls` table. On creation, if an alias is provided, use it as `short_code` directly and insert — the `UNIQUE` constraint prevents collisions. Aliases bypass the ID generator.

**Q3: What happens if two service instances generate the same short code simultaneously?**

The Snowflake ID generator is machine-ID-specific, so two different pods with different machine IDs will never produce the same ID. The `UNIQUE` constraint on `short_code` is a safety net that causes one insert to fail, which the service retries with a new ID.

**Q4: How do you implement URL expiry?**

Store `expires_at TIMESTAMPTZ` in the `urls` table. On redirect, check `WHERE short_code = $1 AND (expires_at IS NULL OR expires_at > NOW())`. A background job runs every hour to delete expired rows. Redis TTL should match `expires_at`.

**Q5: How would you rate-limit URL creation per user?**

Use Redis with a sliding window counter: `INCR user:ratelimit:{user_id}:{minute}` with a 60-second TTL. Reject if count exceeds threshold. This is exactly Case Study 2 below.

**Q6: How do you count clicks accurately at 10B/day without slowing redirects?**

Never update `click_count` synchronously on redirect. Instead, publish a click event to Kafka. A consumer reads Kafka, batches events, and writes aggregates to `analytics_hourly`. The `click_count` column in `urls` is refreshed hourly from aggregates.

**Q7: What if Redis goes down?**

With proper circuit breakers, the service falls back directly to PostgreSQL read replicas. Latency increases but the service stays available. Once Redis recovers, the cache self-populates via cache-aside.

**Q8: How do you prevent abuse (someone shortening malicious URLs)?**

Maintain a blocklist of known-malicious domains in Redis (a `SET`). Before inserting, check `SISMEMBER blocklist {domain}`. Integrate with Safe Browsing API asynchronously. Flag URLs for review if they match patterns.

**Q9: How would you design an analytics dashboard showing clicks per country?**

Include IP-to-country lookup (MaxMind GeoIP) in the click event. Kafka consumer writes to `analytics_geo (short_code, country, hour, count)`. Dashboard queries this table. For real-time, use Redis sorted sets: `ZINCRBY clicks:geo:{code} 1 {country}`.

**Q10: How do you handle the thundering herd problem when a viral URL causes a cache miss storm?**

Use a distributed lock (Redis `SET url:lock:{code} 1 NX EX 5`). Only one goroutine fetches from DB; others wait. Alternatively, use probabilistic early expiration: slightly before TTL expires, one request refreshes the cache while others still use the cached value.

---

---

## Case Study 2: Design a Rate Limiter

### Why This Problem Appears in Interviews

A rate limiter is an infrastructure primitive found in every API gateway, microservice mesh, and payment processor. It tests your understanding of distributed consistency, atomic operations, and algorithm trade-offs.

---

### Requirements and Scale

**Functional:**
- Limit requests per user, per service, per endpoint
- Support multiple limit types: per-second, per-minute, per-hour
- Return HTTP 429 with `Retry-After` header when limited
- Allow burst traffic up to a configurable multiplier

**Non-Functional:**
- 10K services behind the rate limiter
- 1B requests/day total
- Less than 1ms overhead added to each request
- Distributed (multiple rate limiter instances must agree)
- Rules changeable at runtime without restart

**Capacity:**
```
1B requests/day = 11,574 req/sec average
Peak (10×): ~115,740 req/sec
Redis operations per request: 2 (GET + SET or EVALSHA)
Peak Redis ops/sec: ~230,000 — well within Redis capacity (1M ops/sec)
```

---

### Algorithms Comparison

| Algorithm | Allows Burst | Memory/User | Distributed | Accuracy | Best For |
|---|---|---|---|---|---|
| Fixed Window | Yes (edge burst) | O(1) | Easy | Low | Simple APIs |
| Sliding Window Log | No | O(requests) | Medium | High | Audit logs |
| Sliding Window Counter | Partial | O(1) | Easy | Medium | General APIs |
| Token Bucket | Yes (controlled) | O(1) | Medium | High | APIs with bursts |
| Leaky Bucket | No (smooths) | O(queue) | Hard | High | Smooth output rate |

**Winner for most cases: Token Bucket** — allows legitimate bursts, O(1) memory, and maps naturally to Redis with atomic Lua scripts.

---

### Full Go Implementation: Token Bucket (In-Process)

```go
package ratelimit

import (
    "sync"
    "time"
)

// TokenBucket implements a per-key token bucket rate limiter.
// Thread-safe for concurrent use.
type TokenBucket struct {
    mu       sync.Mutex
    buckets  map[string]*bucket
    rate     float64 // tokens added per second
    capacity float64 // maximum tokens
}

type bucket struct {
    tokens    float64
    lastRefil time.Time
}

func NewTokenBucket(ratePerSec, capacity float64) *TokenBucket {
    return &TokenBucket{
        buckets:  make(map[string]*bucket),
        rate:     ratePerSec,
        capacity: capacity,
    }
}

// Allow returns true if the request for the given key is permitted.
func (tb *TokenBucket) Allow(key string) bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()

    now := time.Now()
    b, ok := tb.buckets[key]
    if !ok {
        // New key: start with full bucket
        tb.buckets[key] = &bucket{tokens: tb.capacity, lastRefil: now}
        return true
    }

    // Refill tokens based on elapsed time
    elapsed := now.Sub(b.lastRefil).Seconds()
    b.tokens = min(tb.capacity, b.tokens+elapsed*tb.rate)
    b.lastRefil = now

    if b.tokens < 1 {
        return false // rate limited
    }
    b.tokens--
    return true
}

// AllowN returns true if n tokens are available.
func (tb *TokenBucket) AllowN(key string, n float64) bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()

    now := time.Now()
    b, ok := tb.buckets[key]
    if !ok {
        if n <= tb.capacity {
            tb.buckets[key] = &bucket{tokens: tb.capacity - n, lastRefil: now}
            return true
        }
        return false
    }

    elapsed := now.Sub(b.lastRefil).Seconds()
    b.tokens = min(tb.capacity, b.tokens+elapsed*tb.rate)
    b.lastRefil = now

    if b.tokens < n {
        return false
    }
    b.tokens -= n
    return true
}

func min(a, b float64) float64 {
    if a < b {
        return a
    }
    return b
}
```

---

### Distributed Rate Limiter with Redis and Lua

The problem with in-process rate limiters: each service pod has its own state. With 10 pods, each pod allows 100 req/min → users can make 1000 req/min.

**Solution: centralized Redis with atomic Lua scripts.**

```go
package ratelimit

import (
    "context"
    "fmt"
    "time"

    "github.com/go-redis/redis/v8"
)

// luaTokenBucket is an atomic Lua script that runs on Redis.
// It implements token bucket refill + consume atomically.
// KEYS[1] = bucket key
// ARGV[1] = max tokens (capacity)
// ARGV[2] = refill rate (tokens/sec)
// ARGV[3] = requested tokens
// ARGV[4] = current Unix timestamp (microseconds)
// Returns: 1 if allowed, 0 if limited; and remaining tokens
var luaTokenBucket = redis.NewScript(`
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local rate       = tonumber(ARGV[2])
local requested  = tonumber(ARGV[3])
local now        = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "tokens", "last_refill")
local tokens     = tonumber(data[1]) or capacity
local last_refill = tonumber(data[2]) or now

-- Refill tokens based on elapsed time
local elapsed = math.max(0, (now - last_refill) / 1000000)
tokens = math.min(capacity, tokens + elapsed * rate)

if tokens >= requested then
    tokens = tokens - requested
    redis.call("HMSET", key, "tokens", tokens, "last_refill", now)
    redis.call("PEXPIRE", key, math.ceil(capacity / rate) * 1000 + 1000)
    return {1, math.floor(tokens)}
else
    redis.call("HMSET", key, "tokens", tokens, "last_refill", now)
    redis.call("PEXPIRE", key, math.ceil(capacity / rate) * 1000 + 1000)
    return {0, math.floor(tokens)}
end
`)

type DistributedRateLimiter struct {
    rdb      *redis.Client
    capacity int64
    rate     float64 // tokens/sec
}

func NewDistributed(rdb *redis.Client, capacity int64, ratePerSec float64) *DistributedRateLimiter {
    return &DistributedRateLimiter{
        rdb:      rdb,
        capacity: capacity,
        rate:     ratePerSec,
    }
}

type LimitResult struct {
    Allowed   bool
    Remaining int64
    RetryAfter time.Duration
}

// Check evaluates whether the given key (e.g. "user:42:api:v1") is within limits.
func (d *DistributedRateLimiter) Check(ctx context.Context, key string, requested int64) (LimitResult, error) {
    now := time.Now().UnixMicro()
    redisKey := fmt.Sprintf("rl:%s", key)

    result, err := luaTokenBucket.Run(ctx, d.rdb,
        []string{redisKey},
        d.capacity, d.rate, requested, now,
    ).Int64Slice()

    if err != nil {
        // Fail open: allow request if Redis is unavailable
        return LimitResult{Allowed: true}, fmt.Errorf("redis error: %w", err)
    }

    allowed := result[0] == 1
    remaining := result[1]

    var retryAfter time.Duration
    if !allowed {
        // Time until 1 token refills
        retryAfter = time.Duration(float64(time.Second) / d.rate)
    }

    return LimitResult{
        Allowed:    allowed,
        Remaining:  remaining,
        RetryAfter: retryAfter,
    }, nil
}

// Middleware wraps an HTTP handler with rate limiting.
func (d *DistributedRateLimiter) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        userID := r.Header.Get("X-User-ID")
        key := fmt.Sprintf("user:%s:endpoint:%s", userID, r.URL.Path)

        res, err := d.Check(r.Context(), key, 1)
        if err != nil {
            // Fail open on Redis errors
            next.ServeHTTP(w, r)
            return
        }

        w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", res.Remaining))
        w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", d.capacity))

        if !res.Allowed {
            w.Header().Set("Retry-After", fmt.Sprintf("%.0f", res.RetryAfter.Seconds()))
            http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

---

### Architecture: Rate Limiter in Microservices

```mermaid
graph TD
    Client["API Client"]
    Gateway["API Gateway\n(Go, 5 replicas)"]
    RLMiddleware["Rate Limiter Middleware\n(embedded in Gateway)"]
    Redis["Redis Cluster\n(6 shards, token buckets)"]
    RuleStore["Rule Store\n(PostgreSQL + Redis cache)"]
    ServiceA["Service A\n(Go)"]
    ServiceB["Service B\n(Go)"]
    ServiceC["Service C\n(Go)"]
    AdminAPI["Admin API\n(update rules at runtime)"]

    Client -->|"HTTP request\n+ X-User-ID header"| Gateway
    Gateway --> RLMiddleware
    RLMiddleware -->|"EVALSHA lua script"| Redis
    RLMiddleware -->|"load rules"| RuleStore
    AdminAPI -->|"update rules"| RuleStore
    RuleStore -->|"invalidate rule cache"| Redis
    RLMiddleware -->|"allowed"| ServiceA
    RLMiddleware -->|"allowed"| ServiceB
    RLMiddleware -->|"allowed"| ServiceC
    RLMiddleware -->|"HTTP 429"| Client
```

**Rule Store structure:**

```sql
CREATE TABLE rate_limit_rules (
    id          SERIAL PRIMARY KEY,
    key_pattern VARCHAR(200) NOT NULL,  -- e.g. "user:*:endpoint:/api/v1/orders"
    capacity    INT NOT NULL,
    rate        FLOAT NOT NULL,         -- tokens/sec
    enabled     BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Rules are cached in Redis with a 30-second TTL and reloaded on change via pub/sub notification from the Admin API.

---

### Interviewer Follow-up Questions (Rate Limiter)

**Q1: What is the difference between token bucket and leaky bucket?**

Token bucket allows bursts up to the bucket capacity. If a user makes no requests for 10 seconds, they accumulate 10 seconds of tokens and can spend them all at once. Leaky bucket enforces a constant output rate — requests queue and drain at a fixed rate, smoothing traffic. Token bucket is better for APIs that want to allow legitimate bursts; leaky bucket is better for output rate control (e.g., email sending).

**Q2: How do you handle the case where Redis is down?**

Two philosophies: "fail open" (allow all requests) or "fail closed" (reject all). For most APIs, fail open is correct — you'd rather serve extra traffic than take an outage. Implement with a circuit breaker: if Redis error rate exceeds a threshold, bypass rate limiting entirely and alert.

**Q3: How do you rate limit across multiple dimensions simultaneously?**

Run multiple checks: per-user, per-IP, per-endpoint, per-service. The request is allowed only if ALL checks pass. Use goroutines with `errgroup` to run Redis checks in parallel to stay under the 1ms budget.

**Q4: What is the fixed window edge burst problem?**

With a fixed window (e.g., 100 requests per minute), a user can make 100 requests at 11:59:59 and 100 more at 12:00:01 — 200 requests in 2 seconds. Sliding window counters fix this by weighting the previous window's count based on overlap with the current window.

**Q5: How do you implement per-plan rate limits (free: 100/min, paid: 1000/min)?**

Look up the user's plan from a Redis hash (`HGET user:plan:{user_id} tier`) on first request, cache it locally with a 5-minute TTL. Use the plan tier to select the appropriate capacity and rate from a configuration map.

**Q6: How would you rate limit at the network layer instead of application layer?**

Use iptables/nftables for IP-level limiting, or deploy Envoy/Istio with ext_authz calling a rate limit service (Lyft's ratelimit or Envoy's built-in). This moves limiting before the application processes the request.

**Q7: How do you test a distributed rate limiter for correctness?**

Run N goroutines simultaneously hitting the same key. The total allowed count must equal exactly `capacity` (for a one-shot burst test). Use `sync.WaitGroup` + atomic counters. Also test: correct `Retry-After` header, correct remaining count, behavior on Redis failure.

**Q8: How do you implement different limits for authenticated vs anonymous users?**

Use different key namespaces: `anon:{ip}` vs `user:{user_id}`. Unauthenticated traffic uses IP-based keys with stricter limits (e.g., 10 req/min). Authenticated traffic uses user ID keys with plan-based limits.

**Q9: How would you implement a "global rate limit" across all users for a shared resource?**

Use a single Redis key for the global limit, separate from per-user keys. Both per-user and global checks must pass. The global key uses a higher capacity (e.g., 100K req/min total) to protect the downstream service.

**Q10: How do you handle time drift between distributed nodes affecting the rate limiter?**

The Lua script uses the timestamp passed as an argument (ARGV[4]), not Redis's own clock. This means the clock is the calling application server's clock. For correctness in a distributed system, use NTP-synchronized clocks (drift under 1ms is acceptable for second-level rate limiting). For millisecond precision, use Redis's `TIME` command inside the Lua script to get Redis's own clock.

---

---

## Case Study 3: Design a Notification Service

### Why This Problem Appears in Interviews

A notification service spans multiple systems (push, SMS, email), requires priority queuing, retry logic, template rendering, and delivery guarantees — exactly the properties that expose system design skill.

---

### Requirements

**Functional:**
- Send push notifications (APNs/FCM), SMS (Twilio), and email (SendGrid)
- Priority levels: critical (OTP, alerts) > high (order updates) > normal (promotions)
- Template engine: parameterized messages per channel
- Delivery guarantees: at-least-once for critical, best-effort for promotional
- Per-user notification preferences (opt-out per channel/category)

**Non-Functional:**
- 10M active users
- Peak: 5M notifications in 1 hour (e.g., flash sale launch)
- Critical notifications delivered in under 5 seconds
- Email delivery under 30 seconds
- Provider rate limits: FCM 600K/min, Twilio 100/sec, SendGrid 600/min

---

### Architecture

```mermaid
graph TD
    API["Notification API\n(Go, REST)"]
    PriorityQ["Priority Queue\n(Kafka, 3 topics)"]
    CriticalTopic["Kafka: critical\n(3 partitions)"]
    HighTopic["Kafka: high\n(12 partitions)"]
    NormalTopic["Kafka: normal\n(48 partitions)"]
    WorkerPool["Worker Pool\n(Go, auto-scaled)"]
    PushWorker["Push Worker\n(FCM/APNs)"]
    SMSWorker["SMS Worker\n(Twilio)"]
    EmailWorker["Email Worker\n(SendGrid)"]
    PrefsDB["User Prefs\n(PostgreSQL)"]
    TemplateDB["Template Store\n(PostgreSQL + Redis)"]
    DeliveryLog["Delivery Log\n(PostgreSQL/ClickHouse)"]
    RetryQueue["Retry Queue\n(Redis sorted set)"]

    API -->|"validate + enqueue"| PriorityQ
    API -->|"check prefs"| PrefsDB
    PriorityQ --> CriticalTopic
    PriorityQ --> HighTopic
    PriorityQ --> NormalTopic
    CriticalTopic -->|"high priority consumers"| WorkerPool
    HighTopic --> WorkerPool
    NormalTopic --> WorkerPool
    WorkerPool -->|"render template"| TemplateDB
    WorkerPool --> PushWorker
    WorkerPool --> SMSWorker
    WorkerPool --> EmailWorker
    PushWorker -->|"failed"| RetryQueue
    SMSWorker -->|"failed"| RetryQueue
    EmailWorker -->|"failed"| RetryQueue
    RetryQueue -->|"retry after backoff"| WorkerPool
    PushWorker -->|"log result"| DeliveryLog
    SMSWorker -->|"log result"| DeliveryLog
    EmailWorker -->|"log result"| DeliveryLog
```

---

### Component Design

#### Priority Queue with Go Heap

```go
package notification

import "container/heap"

type Priority int

const (
    PriorityNormal   Priority = 0
    PriorityHigh     Priority = 1
    PriorityCritical Priority = 2
)

type Notification struct {
    ID        string
    UserID    string
    Channel   string // "push", "sms", "email"
    Template  string
    Params    map[string]string
    Priority  Priority
    CreatedAt int64 // Unix nanoseconds for ordering within priority
}

// notifHeap implements heap.Interface for min-heap by priority (higher = first).
type notifHeap []*Notification

func (h notifHeap) Len() int { return len(h) }

func (h notifHeap) Less(i, j int) bool {
    if h[i].Priority != h[j].Priority {
        return h[i].Priority > h[j].Priority // higher priority first
    }
    return h[i].CreatedAt < h[j].CreatedAt // FIFO within same priority
}

func (h notifHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

func (h *notifHeap) Push(x any) {
    *h = append(*h, x.(*Notification))
}

func (h *notifHeap) Pop() any {
    old := *h
    n := len(old)
    item := old[n-1]
    old[n-1] = nil
    *h = old[:n-1]
    return item
}

// PriorityQueue wraps the heap with a mutex for concurrent access.
type PriorityQueue struct {
    mu   sync.Mutex
    heap notifHeap
    cond *sync.Cond
}

func NewPriorityQueue() *PriorityQueue {
    pq := &PriorityQueue{}
    pq.cond = sync.NewCond(&pq.mu)
    heap.Init(&pq.heap)
    return pq
}

func (pq *PriorityQueue) Push(n *Notification) {
    pq.mu.Lock()
    heap.Push(&pq.heap, n)
    pq.cond.Signal()
    pq.mu.Unlock()
}

func (pq *PriorityQueue) Pop() *Notification {
    pq.mu.Lock()
    defer pq.mu.Unlock()
    for pq.heap.Len() == 0 {
        pq.cond.Wait()
    }
    return heap.Pop(&pq.heap).(*Notification)
}
```

#### Worker Pool with Bounded Concurrency

```go
package notification

import (
    "context"
    "log"
    "sync"
)

// WorkerPool dispatches notifications to channel-specific senders.
type WorkerPool struct {
    workers   int
    queue     *PriorityQueue
    senders   map[string]Sender // "push", "sms", "email"
    wg        sync.WaitGroup
    retryQ    *RetryQueue
}

type Sender interface {
    Send(ctx context.Context, n *Notification) error
}

func NewWorkerPool(workers int, queue *PriorityQueue, senders map[string]Sender, retryQ *RetryQueue) *WorkerPool {
    return &WorkerPool{
        workers:  workers,
        queue:    queue,
        senders:  senders,
        retryQ:   retryQ,
    }
}

func (wp *WorkerPool) Start(ctx context.Context) {
    for i := 0; i < wp.workers; i++ {
        wp.wg.Add(1)
        go wp.runWorker(ctx, i)
    }
}

func (wp *WorkerPool) Wait() {
    wp.wg.Wait()
}

func (wp *WorkerPool) runWorker(ctx context.Context, id int) {
    defer wp.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }

        notif := wp.queue.Pop()
        sender, ok := wp.senders[notif.Channel]
        if !ok {
            log.Printf("worker %d: unknown channel %s", id, notif.Channel)
            continue
        }

        if err := sender.Send(ctx, notif); err != nil {
            log.Printf("worker %d: send failed for %s: %v", id, notif.ID, err)
            wp.retryQ.Enqueue(notif)
            continue
        }
        log.Printf("worker %d: delivered %s via %s", id, notif.ID, notif.Channel)
    }
}
```

#### Template Engine

```go
package notification

import (
    "bytes"
    "fmt"
    "text/template"
)

// TemplateEngine renders notification messages from stored templates.
type TemplateEngine struct {
    cache map[string]*template.Template
    mu    sync.RWMutex
    store TemplateStore
}

func (te *TemplateEngine) Render(templateID string, params map[string]string) (string, error) {
    te.mu.RLock()
    tmpl, ok := te.cache[templateID]
    te.mu.RUnlock()

    if !ok {
        raw, err := te.store.Get(templateID)
        if err != nil {
            return "", fmt.Errorf("template not found: %s", templateID)
        }
        tmpl, err = template.New(templateID).Parse(raw)
        if err != nil {
            return "", fmt.Errorf("template parse error: %w", err)
        }
        te.mu.Lock()
        te.cache[templateID] = tmpl
        te.mu.Unlock()
    }

    var buf bytes.Buffer
    if err := tmpl.Execute(&buf, params); err != nil {
        return "", fmt.Errorf("template execute: %w", err)
    }
    return buf.String(), nil
}

// Example template stored in DB:
// "Your OTP is {{.otp}}. Valid for {{.ttl}} minutes. Do not share."
```

#### Exponential Backoff Retry Logic

```go
package notification

import (
    "context"
    "math"
    "time"

    "github.com/go-redis/redis/v8"
)

// RetryQueue uses a Redis sorted set where the score is the next retry timestamp.
type RetryQueue struct {
    rdb        *redis.Client
    maxRetries int
}

func (rq *RetryQueue) Enqueue(n *Notification) {
    attempt := getAttemptCount(n)
    if attempt >= rq.maxRetries {
        logDeliveryFailure(n) // dead letter
        return
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s ...
    delay := time.Duration(math.Pow(2, float64(attempt))) * time.Second
    nextRetry := time.Now().Add(delay).Unix()

    rq.rdb.ZAdd(context.Background(), "retry:queue", &redis.Z{
        Score:  float64(nextRetry),
        Member: serializeNotif(n),
    })
}

// Poll runs in a goroutine, checking for due retries every second.
func (rq *RetryQueue) Poll(ctx context.Context, queue *PriorityQueue) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            now := float64(time.Now().Unix())
            results, _ := rq.rdb.ZRangeByScore(ctx, "retry:queue",
                &redis.ZRangeBy{Min: "-inf", Max: fmt.Sprintf("%f", now), Count: 100},
            ).Result()

            for _, raw := range results {
                n := deserializeNotif(raw)
                incrementAttemptCount(n)
                queue.Push(n)
                rq.rdb.ZRem(ctx, "retry:queue", raw)
            }
        }
    }
}
```

---

### Database Design

```sql
-- Notification records (source of truth)
CREATE TABLE notifications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      BIGINT NOT NULL,
    channel      VARCHAR(10) NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
    template_id  VARCHAR(100) NOT NULL,
    params       JSONB NOT NULL DEFAULT '{}',
    priority     SMALLINT NOT NULL DEFAULT 0,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at      TIMESTAMPTZ,
    attempts     SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_notif_user_status ON notifications(user_id, status);
CREATE INDEX idx_notif_created ON notifications(created_at DESC);

-- Templates
CREATE TABLE templates (
    id           VARCHAR(100) PRIMARY KEY,
    channel      VARCHAR(10) NOT NULL,
    subject      TEXT,              -- for email
    body         TEXT NOT NULL,     -- Go text/template syntax
    version      INT NOT NULL DEFAULT 1,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User notification preferences
CREATE TABLE user_preferences (
    user_id         BIGINT NOT NULL,
    channel         VARCHAR(10) NOT NULL,
    category        VARCHAR(50) NOT NULL,  -- 'marketing', 'transactional', 'alerts'
    opted_in        BOOLEAN NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel, category)
);

-- Delivery log (append-only, high-volume: consider ClickHouse/TimescaleDB)
CREATE TABLE delivery_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id),
    attempt         SMALLINT NOT NULL,
    provider        VARCHAR(50),   -- 'fcm', 'apns', 'twilio', 'sendgrid'
    status          VARCHAR(20),   -- 'delivered', 'failed', 'bounced'
    error_message   TEXT,
    provider_id     TEXT,          -- provider's message ID for receipt tracking
    logged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_delivery_notif ON delivery_log(notification_id);
```

---

### Scale to 10M Users

**Kafka partition sizing:**

```
Target: process 5M notifications in 1 hour = 1388 notif/sec
Per partition throughput: ~100 notif/sec (with DB writes, template rendering)
Partitions needed: 1388 / 100 = ~14 partitions

With priority separation:
  critical: 3 partitions  (always over-provisioned)
  high:     12 partitions
  normal:   48 partitions
Total: 63 partitions
```

**Worker pool sizing:**

```
FCM limit: 600K/min = 10K/sec → 10K goroutines (lightweight) or 100 workers × 100 async sends
Twilio limit: 100/sec → 100 workers, 1 send/worker/sec
SendGrid limit: 600/min = 10/sec → 10 workers

Worker pool sizing: 100 push + 100 SMS + 20 email = 220 workers per pod
Scale: 5 pods = 1100 workers total
```

**Provider rate limiting per provider:**

```go
// Use a per-provider rate limiter wrapping the Sender interface
type RateLimitedSender struct {
    inner   Sender
    limiter *rate.Limiter // golang.org/x/time/rate
}

func (s *RateLimitedSender) Send(ctx context.Context, n *Notification) error {
    if err := s.limiter.Wait(ctx); err != nil {
        return err
    }
    return s.inner.Send(ctx, n)
}

// FCM: rate.NewLimiter(rate.Limit(10000), 1000) // 10K/sec, burst 1000
// Twilio: rate.NewLimiter(rate.Limit(100), 10)  // 100/sec, burst 10
// SendGrid: rate.NewLimiter(rate.Limit(10), 5)  // 10/sec, burst 5
```

---

### Full Go Notification Service Sketch

```go
package main

import (
    "context"
    "log"
    "net/http"
    "os/signal"
    "syscall"

    "github.com/go-redis/redis/v8"
    "golang.org/x/time/rate"
)

type NotificationService struct {
    pool     *WorkerPool
    queue    *PriorityQueue
    retryQ   *RetryQueue
    tmplEng  *TemplateEngine
    prefStore PreferenceStore
}

func (s *NotificationService) Submit(ctx context.Context, req NotificationRequest) error {
    // 1. Check user preferences
    optedIn, err := s.prefStore.IsOptedIn(ctx, req.UserID, req.Channel, req.Category)
    if err != nil || !optedIn {
        return nil // silently drop if opted out
    }

    // 2. Render template
    body, err := s.tmplEng.Render(req.TemplateID, req.Params)
    if err != nil {
        return fmt.Errorf("render: %w", err)
    }

    // 3. Enqueue
    s.queue.Push(&Notification{
        ID:       uuid.New().String(),
        UserID:   req.UserID,
        Channel:  req.Channel,
        Priority: req.Priority,
        Body:     body,
    })
    return nil
}

func (s *NotificationService) HandleSubmit(w http.ResponseWriter, r *http.Request) {
    var req NotificationRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }
    if err := s.Submit(r.Context(), req); err != nil {
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusAccepted)
}

func main() {
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})

    queue := NewPriorityQueue()
    retryQ := &RetryQueue{rdb: rdb, maxRetries: 5}
    tmplEng := &TemplateEngine{cache: make(map[string]*template.Template)}

    senders := map[string]Sender{
        "push":  &RateLimitedSender{inner: &FCMSender{}, limiter: rate.NewLimiter(10000, 1000)},
        "sms":   &RateLimitedSender{inner: &TwilioSender{}, limiter: rate.NewLimiter(100, 10)},
        "email": &RateLimitedSender{inner: &SendGridSender{}, limiter: rate.NewLimiter(10, 5)},
    }

    pool := NewWorkerPool(220, queue, senders, retryQ)
    svc := &NotificationService{pool: pool, queue: queue, retryQ: retryQ, tmplEng: tmplEng}

    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer stop()

    pool.Start(ctx)
    go retryQ.Poll(ctx, queue)

    http.HandleFunc("/notify", svc.HandleSubmit)
    log.Println("notification service listening on :8081")
    log.Fatal(http.ListenAndServe(":8081", nil))
}
```

---

---

## Case Study 4: Design a Distributed Cache (Redis-like)

### Why This Problem Appears in Interviews

Building a cache from scratch tests your understanding of consistent hashing, LRU eviction, concurrent access patterns, and distributed systems consistency — topics that appear in senior and staff engineer interviews.

---

### Requirements

- In-memory key-value store (GET/SET/DEL)
- Consistent hashing for horizontal sharding
- LRU eviction when memory is full
- Replication: each key on 2 nodes (for fault tolerance)
- TTL support
- Single-node throughput: 500K ops/sec

---

### Consistent Hashing with Virtual Nodes

```go
package cache

import (
    "crypto/sha256"
    "fmt"
    "sort"
    "sync"
)

// ConsistentHashRing distributes keys across nodes using virtual nodes.
// Each physical node gets `replicas` positions on the ring.
type ConsistentHashRing struct {
    mu       sync.RWMutex
    replicas int
    ring     []uint32          // sorted hash positions
    nodes    map[uint32]string // hash → node address
}

func NewRing(replicas int) *ConsistentHashRing {
    return &ConsistentHashRing{
        replicas: replicas,
        nodes:    make(map[uint32]string),
    }
}

func hashKey(key string) uint32 {
    h := sha256.Sum256([]byte(key))
    return uint32(h[0])<<24 | uint32(h[1])<<16 | uint32(h[2])<<8 | uint32(h[3])
}

func (r *ConsistentHashRing) AddNode(node string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    for i := 0; i < r.replicas; i++ {
        vkey := fmt.Sprintf("%s#%d", node, i)
        h := hashKey(vkey)
        r.ring = append(r.ring, h)
        r.nodes[h] = node
    }
    sort.Slice(r.ring, func(i, j int) bool { return r.ring[i] < r.ring[j] })
}

func (r *ConsistentHashRing) RemoveNode(node string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    for i := 0; i < r.replicas; i++ {
        vkey := fmt.Sprintf("%s#%d", node, i)
        h := hashKey(vkey)
        delete(r.nodes, h)
    }
    // Rebuild ring slice
    newRing := r.ring[:0]
    for _, h := range r.ring {
        if _, ok := r.nodes[h]; ok {
            newRing = append(newRing, h)
        }
    }
    r.ring = newRing
}

// GetNodes returns the N nodes responsible for a key (for replication).
func (r *ConsistentHashRing) GetNodes(key string, n int) []string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    if len(r.ring) == 0 {
        return nil
    }
    h := hashKey(key)
    idx := sort.Search(len(r.ring), func(i int) bool { return r.ring[i] >= h })
    if idx == len(r.ring) {
        idx = 0 // wrap around
    }

    seen := make(map[string]bool)
    result := make([]string, 0, n)
    for len(result) < n && len(result) < len(r.nodes)/r.replicas {
        node := r.nodes[r.ring[idx%len(r.ring)]]
        if !seen[node] {
            seen[node] = true
            result = append(result, node)
        }
        idx++
    }
    return result
}
```

---

### LRU Eviction Implementation

```go
package cache

import (
    "container/list"
    "sync"
    "time"
)

type entry struct {
    key       string
    value     []byte
    expiresAt time.Time // zero = no expiry
}

// LRUCache is a thread-safe LRU cache with TTL support.
type LRUCache struct {
    mu       sync.Mutex
    capacity int
    ll       *list.List
    items    map[string]*list.Element
}

func NewLRUCache(capacity int) *LRUCache {
    return &LRUCache{
        capacity: capacity,
        ll:       list.New(),
        items:    make(map[string]*list.Element, capacity),
    }
}

func (c *LRUCache) Set(key string, value []byte, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()

    var exp time.Time
    if ttl > 0 {
        exp = time.Now().Add(ttl)
    }

    if el, ok := c.items[key]; ok {
        c.ll.MoveToFront(el)
        el.Value.(*entry).value = value
        el.Value.(*entry).expiresAt = exp
        return
    }

    if c.ll.Len() >= c.capacity {
        c.evict()
    }

    el := c.ll.PushFront(&entry{key: key, value: value, expiresAt: exp})
    c.items[key] = el
}

func (c *LRUCache) Get(key string) ([]byte, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()

    el, ok := c.items[key]
    if !ok {
        return nil, false
    }

    e := el.Value.(*entry)
    if !e.expiresAt.IsZero() && time.Now().After(e.expiresAt) {
        c.removeElement(el)
        return nil, false
    }

    c.ll.MoveToFront(el)
    return e.value, true
}

func (c *LRUCache) Del(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if el, ok := c.items[key]; ok {
        c.removeElement(el)
    }
}

func (c *LRUCache) evict() {
    el := c.ll.Back()
    if el != nil {
        c.removeElement(el)
    }
}

func (c *LRUCache) removeElement(el *list.Element) {
    c.ll.Remove(el)
    delete(c.items, el.Value.(*entry).key)
}

// Len returns current number of items (including possibly expired ones).
func (c *LRUCache) Len() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.ll.Len()
}
```

---

### Architecture Diagram: Distributed Cache Cluster

```mermaid
graph TD
    Client["Cache Client\n(Go SDK)"]
    Ring["Consistent Hash Ring\n(client-side routing)"]
    Node1["Cache Node 1\n(LRU + TTL)"]
    Node2["Cache Node 2\n(LRU + TTL)"]
    Node3["Cache Node 3\n(LRU + TTL)"]
    Replica1["Node 1 Replica"]
    Replica2["Node 2 Replica"]
    Replica3["Node 3 Replica"]

    Client -->|"hash(key) → node"| Ring
    Ring -->|"primary write"| Node1
    Ring -->|"primary write"| Node2
    Ring -->|"primary write"| Node3
    Node1 -->|"async replicate"| Replica1
    Node2 -->|"async replicate"| Replica2
    Node3 -->|"async replicate"| Replica3
```

---

### Interviewer Follow-up Questions (Distributed Cache)

**Q1: What happens when a cache node fails?**

The consistent hash ring routes requests to the next node on the ring. With replication factor 2, the replica node serves reads immediately. A replacement node is added to the ring; it receives new writes but must be warmed with keys rehashed to it. Avoid full re-hashing by limiting key migration to only the affected arc of the ring.

**Q2: What is the difference between cache eviction and cache expiry?**

Eviction removes items due to capacity pressure (LRU, LFU, random). Expiry removes items whose TTL has elapsed. Both result in cache misses but for different reasons. A well-designed cache handles both: lazy expiry checks on read, plus background sweep for memory reclamation.

**Q3: How do you handle hot keys (a single key getting 90% of traffic)?**

Hot keys create uneven load on one node. Solutions: (1) read-through replication — hot keys are additionally cached on multiple nodes with a suffix (`key#0`, `key#1`, ...) and the client randomly picks one on read. (2) client-side local cache for the hottest N keys with a short TTL.

**Q4: How does consistent hashing minimize data movement when a node is added?**

With N nodes and a new node added, only keys in the arc between the new node and its predecessor on the ring need to move. This is approximately 1/N of total keys, versus N/(N+1) with naive modulo hashing. Virtual nodes ensure even distribution.

**Q5: How do you implement cache write-through vs write-back?**

Write-through: write to cache AND database synchronously before responding. Consistent, no data loss, but higher latency. Write-back: write to cache first, respond, then asynchronously flush to database. Lower latency but risk of data loss on node failure. URL shortener uses cache-aside (lazy loading) — a common third pattern.

**Q6: What does it mean for a cache to be "eventually consistent"?**

After a write, replicas may serve stale data for a short window (replication lag). This is acceptable for non-critical reads like product descriptions or analytics. For financial data, use synchronous replication (higher latency) or read from primary only.

**Q7: How do you handle a cache stampede (many requests miss simultaneously)?**

Use a distributed mutex: the first request to miss acquires a lock and fetches from DB. Other requests wait or serve stale data. Alternatively, use probabilistic early expiration: before TTL expires, a subset of requests proactively refresh the cache.

**Q8: How does Redis handle persistence differently from your in-memory cache?**

Redis offers RDB snapshots (point-in-time dump) and AOF (append-only log of every write command). Your in-memory cache above has no persistence — a node restart loses all data. For production, implement WAL-based persistence or accept cache cold-start behavior.

**Q9: How would you implement a cache with both LRU and LFU eviction?**

Redis 4.0+ implemented LFU. Combine: track both access recency (LRU doubly-linked list) and frequency (counter with decay). On eviction, choose between the least recently used and the least frequently used based on a configurable policy. "Tiny LFU" approximates LFU with minimal memory overhead.

**Q10: What is cache coherence and why does it matter in distributed systems?**

Cache coherence ensures that all nodes see consistent values for a key. In a distributed cache with replication, a write to Node A must propagate to Node A's replica before any reader sees the old value. Strategies: synchronous replication (strong consistency, higher latency), async replication (eventual consistency, lower latency), or versioning (clients resolve conflicts via vector clocks).

---

---

## Case Study 5: Design a Distributed Task Scheduler

### Why This Problem Appears in Interviews

A task scheduler combines cron parsing, distributed locking, leader election, fault tolerance, and at-least-once delivery — topics that surface at companies running large job pipelines (Airbnb, Netflix, Shopify).

---

### Requirements

**Functional:**
- Cron-like scheduling (`*/5 * * * *` syntax)
- HTTP and Go function job types
- At-least-once execution guarantee
- Job history and status tracking
- Job retries with configurable backoff

**Non-Functional:**
- Distributed: multiple scheduler nodes, only one fires each job
- Fault-tolerant: if a scheduler node dies, another takes over within 30 seconds
- 10K registered jobs
- 1 second scheduling precision
- All job state persisted in PostgreSQL

---

### Architecture with Leader Election

```mermaid
graph TD
    etcd["etcd\n(distributed coordination)"]
    Leader["Scheduler Leader\n(Go, elected via etcd)"]
    Follower1["Scheduler Follower 1\n(standby)"]
    Follower2["Scheduler Follower 2\n(standby)"]
    TaskStore["Task Store\n(PostgreSQL)"]
    WorkerQueue["Worker Queue\n(Kafka or Redis List)"]
    Worker1["Task Worker 1\n(Go)"]
    Worker2["Task Worker 2\n(Go)"]
    Worker3["Task Worker 3\n(Go)"]
    JobHistory["Job History\n(PostgreSQL)"]

    Follower1 -->|"campaign for leader"| etcd
    Follower2 -->|"campaign for leader"| etcd
    Leader -->|"holds lease"| etcd
    etcd -->|"leader elected"| Leader
    Leader -->|"read due jobs"| TaskStore
    Leader -->|"enqueue"| WorkerQueue
    WorkerQueue --> Worker1
    WorkerQueue --> Worker2
    WorkerQueue --> Worker3
    Worker1 -->|"update status"| JobHistory
    Worker2 -->|"update status"| JobHistory
    Worker3 -->|"update status"| JobHistory
    Follower1 -->|"watches leader"| etcd
    Follower2 -->|"watches leader"| etcd
```

---

### Leader Election with etcd

```go
package scheduler

import (
    "context"
    "log"
    "time"

    clientv3 "go.etcd.io/etcd/client/v3"
    "go.etcd.io/etcd/client/v3/concurrency"
)

type SchedulerNode struct {
    id      string
    etcd    *clientv3.Client
    onLead  func(ctx context.Context) // called when this node becomes leader
    onResign func()                   // called when leadership is lost
}

// Run starts the election campaign and blocks until the context is cancelled.
// When this node wins the election, onLead is called with a context that is
// cancelled if leadership is lost.
func (n *SchedulerNode) Run(ctx context.Context) error {
    session, err := concurrency.NewSession(n.etcd, concurrency.WithTTL(15))
    if err != nil {
        return fmt.Errorf("create etcd session: %w", err)
    }
    defer session.Close()

    election := concurrency.NewElection(session, "/scheduler/leader")

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }

        log.Printf("node %s: campaigning for leadership", n.id)

        // Campaign blocks until this node wins or context is cancelled.
        if err := election.Campaign(ctx, n.id); err != nil {
            log.Printf("node %s: campaign failed: %v", n.id, err)
            time.Sleep(time.Second)
            continue
        }

        log.Printf("node %s: became leader", n.id)

        // leadCtx is cancelled if the etcd session expires (node loses leadership).
        leadCtx, cancel := context.WithCancel(ctx)
        go func() {
            select {
            case <-session.Done():
                log.Printf("node %s: session expired, resigning", n.id)
                cancel()
            case <-leadCtx.Done():
            }
        }()

        n.onLead(leadCtx)
        cancel()

        if n.onResign != nil {
            n.onResign()
        }

        // Resign and re-campaign (handles context cancellation gracefully)
        _ = election.Resign(ctx)
    }
}
```

---

### Full Go Implementation: Task Store, Scheduler Loop, Worker Dispatch

```go
package scheduler

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "time"

    "github.com/go-redis/redis/v8"
    "github.com/robfig/cron/v3"
)

// --- Data Model ---

type JobStatus string

const (
    JobStatusPending  JobStatus = "pending"
    JobStatusRunning  JobStatus = "running"
    JobStatusDone     JobStatus = "done"
    JobStatusFailed   JobStatus = "failed"
)

type Job struct {
    ID          int64
    Name        string
    Schedule    string    // cron expression e.g. "*/5 * * * *"
    URL         string    // HTTP URL to POST to
    MaxRetries  int
    Timeout     time.Duration
    NextRun     time.Time
    LastRun     time.Time
    Enabled     bool
}

type JobRun struct {
    ID        int64
    JobID     int64
    Status    JobStatus
    StartedAt time.Time
    EndedAt   time.Time
    Error     string
    Attempt   int
}

// --- Task Store (PostgreSQL) ---

type TaskStore struct {
    db *sql.DB
}

// DueJobs returns jobs that should run now (next_run <= now AND enabled).
func (ts *TaskStore) DueJobs(ctx context.Context) ([]*Job, error) {
    rows, err := ts.db.QueryContext(ctx, `
        SELECT id, name, schedule, url, max_retries, timeout_seconds, next_run
        FROM jobs
        WHERE enabled = true AND next_run <= $1
        FOR UPDATE SKIP LOCKED
        LIMIT 500
    `, time.Now())
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var jobs []*Job
    for rows.Next() {
        j := &Job{}
        var timeoutSecs int
        err := rows.Scan(&j.ID, &j.Name, &j.Schedule, &j.URL,
            &j.MaxRetries, &timeoutSecs, &j.NextRun)
        if err != nil {
            return nil, err
        }
        j.Timeout = time.Duration(timeoutSecs) * time.Second
        jobs = append(jobs, j)
    }
    return jobs, rows.Err()
}

// AdvanceNextRun updates next_run based on the cron expression.
func (ts *TaskStore) AdvanceNextRun(ctx context.Context, job *Job) error {
    parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
    sched, err := parser.Parse(job.Schedule)
    if err != nil {
        return fmt.Errorf("parse cron %q: %w", job.Schedule, err)
    }
    next := sched.Next(time.Now())

    _, err = ts.db.ExecContext(ctx,
        `UPDATE jobs SET next_run = $1, last_run = $2 WHERE id = $3`,
        next, time.Now(), job.ID,
    )
    return err
}

// RecordRun inserts a job run record.
func (ts *TaskStore) RecordRun(ctx context.Context, run *JobRun) error {
    _, err := ts.db.ExecContext(ctx, `
        INSERT INTO job_runs (job_id, status, started_at, ended_at, error, attempt)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, run.JobID, run.Status, run.StartedAt, run.EndedAt, run.Error, run.Attempt)
    return err
}

// --- Scheduler Loop (runs only on the leader) ---

type Scheduler struct {
    store    *TaskStore
    queue    *redis.Client // Redis list as work queue
    interval time.Duration
}

func NewScheduler(store *TaskStore, rdb *redis.Client) *Scheduler {
    return &Scheduler{store: store, queue: rdb, interval: time.Second}
}

// Run is the main scheduler loop. It runs only when this node is the leader.
// ctx is cancelled when leadership is lost.
func (s *Scheduler) Run(ctx context.Context) {
    ticker := time.NewTicker(s.interval)
    defer ticker.Stop()
    log.Println("scheduler: started as leader")

    for {
        select {
        case <-ctx.Done():
            log.Println("scheduler: stepping down as leader")
            return
        case <-ticker.C:
            if err := s.tick(ctx); err != nil {
                log.Printf("scheduler: tick error: %v", err)
            }
        }
    }
}

func (s *Scheduler) tick(ctx context.Context) error {
    jobs, err := s.store.DueJobs(ctx)
    if err != nil {
        return fmt.Errorf("fetch due jobs: %w", err)
    }

    for _, job := range jobs {
        // Enqueue job ID to Redis list for workers to pick up
        s.queue.LPush(ctx, "scheduler:queue", job.ID)

        // Advance next_run immediately to prevent double-scheduling
        if err := s.store.AdvanceNextRun(ctx, job); err != nil {
            log.Printf("scheduler: advance next_run for job %d: %v", job.ID, err)
        }
    }

    if len(jobs) > 0 {
        log.Printf("scheduler: enqueued %d jobs", len(jobs))
    }
    return nil
}

// --- Worker Pool ---

type Worker struct {
    id     int
    store  *TaskStore
    queue  *redis.Client
    client *http.Client
}

func (w *Worker) Run(ctx context.Context) {
    log.Printf("worker %d: started", w.id)
    for {
        // Blocking pop from Redis list, 5 second timeout
        result, err := w.queue.BRPop(ctx, 5*time.Second, "scheduler:queue").Result()
        if err != nil {
            if ctx.Err() != nil {
                return // context cancelled
            }
            continue // timeout, loop again
        }

        jobIDStr := result[1]
        var jobID int64
        fmt.Sscan(jobIDStr, &jobID)

        w.executeJob(ctx, jobID)
    }
}

func (w *Worker) executeJob(ctx context.Context, jobID int64) {
    run := &JobRun{
        JobID:     jobID,
        Status:    JobStatusRunning,
        StartedAt: time.Now(),
        Attempt:   1,
    }

    // Fetch job details
    var job Job
    err := w.store.db.QueryRowContext(ctx,
        `SELECT url, timeout_seconds, max_retries FROM jobs WHERE id = $1`, jobID,
    ).Scan(&job.URL, &job.Timeout, &job.MaxRetries)
    if err != nil {
        log.Printf("worker %d: fetch job %d: %v", w.id, jobID, err)
        return
    }

    // Execute with retry
    var execErr error
    for attempt := 1; attempt <= job.MaxRetries; attempt++ {
        run.Attempt = attempt
        jobCtx, cancel := context.WithTimeout(ctx, job.Timeout)
        resp, err := w.client.PostContext(jobCtx, job.URL, "application/json", nil)
        cancel()

        if err == nil && resp.StatusCode < 500 {
            execErr = nil
            break
        }
        execErr = fmt.Errorf("attempt %d: %v", attempt, err)

        if attempt < job.MaxRetries {
            backoff := time.Duration(attempt*attempt) * time.Second
            time.Sleep(backoff)
        }
    }

    run.EndedAt = time.Now()
    if execErr != nil {
        run.Status = JobStatusFailed
        run.Error = execErr.Error()
    } else {
        run.Status = JobStatusDone
    }

    w.store.RecordRun(ctx, run)
    log.Printf("worker %d: job %d → %s", w.id, jobID, run.Status)
}
```

---

### Database Schema for Scheduler

```sql
CREATE TABLE jobs (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL UNIQUE,
    schedule        VARCHAR(100) NOT NULL,       -- cron expression
    url             TEXT NOT NULL,               -- HTTP endpoint to invoke
    max_retries     INT NOT NULL DEFAULT 3,
    timeout_seconds INT NOT NULL DEFAULT 30,
    next_run        TIMESTAMPTZ NOT NULL,
    last_run        TIMESTAMPTZ,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical index: scheduler tick does a range scan on this
CREATE INDEX idx_jobs_next_run ON jobs(next_run) WHERE enabled = true;

CREATE TABLE job_runs (
    id          BIGSERIAL PRIMARY KEY,
    job_id      BIGINT NOT NULL REFERENCES jobs(id),
    status      VARCHAR(20) NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ,
    error       TEXT,
    attempt     SMALLINT NOT NULL DEFAULT 1
);

CREATE INDEX idx_job_runs_job_id ON job_runs(job_id, started_at DESC);
```

---

### Fault Tolerance Analysis

**What happens when the leader dies mid-tick?**

The `DueJobs` query uses `FOR UPDATE SKIP LOCKED`. Jobs that were fetched and enqueued to Redis but not yet `AdvanceNextRun`-ed will be re-fetched by the new leader on its first tick (their `next_run` is still in the past). This creates at-least-once execution — workers must be idempotent.

**What happens if a worker crashes mid-execution?**

The Redis list entry is consumed (RPOPed). The job run record has status `running` permanently. A background "reaper" job runs every 5 minutes and restarts any `running` job older than `timeout + 60s`:

```sql
UPDATE job_runs SET status = 'failed', error = 'worker crash detected'
WHERE status = 'running' AND started_at < NOW() - INTERVAL '5 minutes';
-- Then re-enqueue affected job IDs to Redis
```

**What happens if etcd itself is unavailable?**

The leader's etcd session TTL expires (15s). All nodes lose leadership simultaneously. A "safe mode" flag pauses scheduling to prevent split-brain execution. Once etcd recovers, a new election completes within seconds.

---

### Interviewer Follow-up Questions (Task Scheduler)

**Q1: How do you guarantee exactly-once execution?**

Exactly-once is very hard in distributed systems. At-least-once is achievable: use the `FOR UPDATE SKIP LOCKED` pattern so only one scheduler instance claims a job, and advance `next_run` immediately. For true exactly-once, workers need idempotency keys and the job endpoint must implement idempotent handling (database upsert keyed on the job run ID).

**Q2: What is the leader election TTL and why does it matter?**

The etcd session TTL (15s in our code) determines how long a dead leader's lock persists before the new leader can take over. A shorter TTL means faster failover but risks false expiry on network hiccups. A longer TTL means slower failover. 15s is a common production value.

**Q3: How do you handle jobs that take longer than their schedule interval?**

Option 1: Concurrent — the scheduler fires the next instance even if the previous is still running. Option 2: Singleton — skip firing if a previous instance is still running (check `job_runs` for a `running` entry). The right choice depends on the job's semantics. Add a `concurrency_policy` column: `allow`, `forbid`, or `replace`.

**Q4: How would you implement job dependencies (Job B runs after Job A)?**

Add a `depends_on BIGINT REFERENCES jobs(id)` column. The scheduler tick checks: `WHERE enabled = true AND next_run <= NOW() AND (depends_on IS NULL OR (SELECT status FROM job_runs WHERE job_id = depends_on ORDER BY started_at DESC LIMIT 1) = 'done')`. A DAG-aware scheduler (like Airflow's DAG model) is more complex but necessary for multi-step pipelines.

**Q5: How do you handle time zone changes and daylight saving time with cron?**

Store all `next_run` timestamps in UTC. When a job is created or rescheduled, parse the cron expression in the job's configured timezone using Go's `time.LoadLocation`, then convert the next fire time to UTC for storage. Re-evaluate `next_run` on DST transitions using a background job.

**Q6: How do you scale to 1M jobs?**

The scheduler tick fetches `LIMIT 500` due jobs per second. With 1M jobs and most in `next_run > now`, the index scan is fast. For horizontal scaling: shard jobs across multiple schedulers by job ID range or by hash (each scheduler owns a shard), with each shard having its own leader election.

**Q7: How do you implement job cancellation?**

Set `enabled = false` in the database. Workers check a context tied to a per-job cancellation signal. For long-running jobs, workers poll a `cancelled` Redis key every few seconds: `GET job:cancel:{run_id}`. If set, the worker calls the job URL with `DELETE` or cancels its context.

**Q8: How do you handle a burst of jobs at midnight (many "0 0 * * *" jobs)?**

Stagger execution using jitter: when computing `next_run`, add a random offset of 0-60 seconds. This distributes the midnight burst across a minute. For explicit ordering, use a priority field on jobs.

**Q9: How do you make the job execution HTTP handler idempotent?**

The worker sends a unique `X-Job-Run-Id` header with each request. The handler stores a record in `idempotency_keys (run_id, result)` with a unique constraint. On a duplicate request (retry), it returns the stored result without re-executing. This is the standard idempotency key pattern.

**Q10: How do you monitor scheduler health?**

Metrics to track: jobs fired per second (Prometheus counter), job execution latency (histogram), job failure rate (counter by job name), scheduler election count (detect flapping), queue depth (jobs in Redis list). Alert if: any job has not fired within 2x its schedule interval, or leader re-election happens more than twice per hour.

---

## Summary: Interview Cheatsheet

| Case Study | Core Algorithm | Key Go Patterns | Scale Technique |
|---|---|---|---|
| URL Shortener | Base62 encoding | Cache-aside, Snowflake ID | CDN, read replicas |
| Rate Limiter | Token bucket (Lua) | Redis atomic scripts, middleware | Fail open, per-plan rules |
| Notification Service | Priority queue (heap) | Worker pool, exponential backoff | Kafka partitions, provider rate limits |
| Distributed Cache | Consistent hashing + LRU | Doubly-linked list, virtual nodes | Replication factor, hot key sharding |
| Task Scheduler | Cron + leader election | etcd election, FOR UPDATE SKIP LOCKED | Job sharding, idempotency keys |

### The 5-Step Framework Applied Consistently

1. **Requirements** — Always confirm functional AND non-functional. Ask about scale numbers, latency budgets, consistency requirements.
2. **Estimation** — Show your math. Write/sec, read/sec, storage/year, bandwidth. Get to order-of-magnitude quickly.
3. **High-Level Design** — Draw the Mermaid diagram first. Name every component. Confirm with interviewer before diving deep.
4. **Deep Dive** — Pick 2-3 components to code. Show the Go implementation. Discuss trade-offs (why Redis vs Kafka, why LRU vs LFU).
5. **Bottlenecks** — Proactively identify what breaks. Show you've thought about failure modes before the interviewer asks.
