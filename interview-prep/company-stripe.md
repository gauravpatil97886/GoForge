> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# Stripe-Style Go Interview Questions

25 problems focused on payment correctness, idempotency, reliability.
For each: problem → Go implementation → correctness analysis → edge cases.

---

## Problem 1: Idempotency Key Store (Prevents Duplicate Charges)

**Problem:** Implement a thread-safe idempotency key store that prevents duplicate payment requests. A client sends the same `Idempotency-Key` header on retry — the server must return the cached response instead of re-executing the charge.

```go
package idempotency

import (
    "sync"
    "time"
)

type StoredResponse struct {
    StatusCode int
    Body       []byte
    CreatedAt  time.Time
}

type IdempotencyStore struct {
    mu      sync.RWMutex
    records map[string]*StoredResponse
    ttl     time.Duration
}

func NewIdempotencyStore(ttl time.Duration) *IdempotencyStore {
    s := &IdempotencyStore{
        records: make(map[string]*StoredResponse),
        ttl:     ttl,
    }
    go s.evictExpired()
    return s
}

// GetOrLock returns (response, true) if key exists, or (nil, false) and acquires
// a write-lock entry so concurrent requests with the same key wait.
func (s *IdempotencyStore) GetOrCreate(key string) (*StoredResponse, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if resp, ok := s.records[key]; ok {
        return resp, true
    }
    // Placeholder: mark key as "in-flight" with nil body.
    s.records[key] = nil
    return nil, false
}

func (s *IdempotencyStore) Save(key string, statusCode int, body []byte) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.records[key] = &StoredResponse{
        StatusCode: statusCode,
        Body:       body,
        CreatedAt:  time.Now(),
    }
}

func (s *IdempotencyStore) evictExpired() {
    ticker := time.NewTicker(s.ttl / 2)
    for range ticker.C {
        cutoff := time.Now().Add(-s.ttl)
        s.mu.Lock()
        for k, v := range s.records {
            if v != nil && v.CreatedAt.Before(cutoff) {
                delete(s.records, k)
            }
        }
        s.mu.Unlock()
    }
}
```

**Correctness Analysis:**
- `GetOrCreate` is atomic under the write lock — no TOCTOU race.
- A `nil` sentinel in the map signals "in-flight"; callers must re-check until the entry is non-nil (use a condition variable or polling in production).
- TTL eviction runs in a background goroutine; stopping the store requires a `context.Context` to cancel the goroutine.

**Edge Cases:**
- Two goroutines calling `GetOrCreate` for the same key simultaneously — only one gets `false`; the other gets a `nil` response and should wait/retry.
- Key collisions across different customers — prefix the key with customer/account ID.
- Idempotency key reuse with different request bodies — validate that the stored request body hash matches the incoming body before returning cached response.

---

## Problem 2: Payment Retry with Exponential Backoff

**Problem:** Implement a payment retry mechanism with exponential backoff and jitter for transient failures (network errors, gateway timeouts). Hard-fail on non-retryable errors (card declined, fraud).

```go
package retry

import (
    "context"
    "errors"
    "fmt"
    "math/rand"
    "time"
)

type PaymentError struct {
    Code      string
    Retryable bool
    Err       error
}

func (e *PaymentError) Error() string { return fmt.Sprintf("[%s] %v", e.Code, e.Err) }
func (e *PaymentError) Unwrap() error  { return e.Err }

type PaymentFunc func(ctx context.Context) error

func RetryPayment(ctx context.Context, fn PaymentFunc, maxAttempts int, baseDelay time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := fn(ctx)
        if err == nil {
            return nil
        }

        var payErr *PaymentError
        if errors.As(err, &payErr) && !payErr.Retryable {
            return err // hard failure: card declined, fraud detected
        }

        lastErr = err
        if attempt == maxAttempts-1 {
            break
        }

        delay := backoffDuration(attempt, baseDelay)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(delay):
        }
    }
    return fmt.Errorf("payment failed after %d attempts: %w", maxAttempts, lastErr)
}

// backoffDuration implements full jitter: sleep = random(0, min(cap, base * 2^attempt))
func backoffDuration(attempt int, base time.Duration) time.Duration {
    cap := 30 * time.Second
    exp := base * (1 << uint(attempt)) // base * 2^attempt
    if exp > cap {
        exp = cap
    }
    jitter := time.Duration(rand.Int63n(int64(exp)))
    return jitter
}
```

**Correctness Analysis:**
- Full jitter (`random(0, cap)`) distributes retries across time, avoiding thundering herd.
- Context cancellation is respected between retries via `select`.
- Non-retryable errors exit immediately without consuming retry budget.

**Edge Cases:**
- Integer overflow in `1 << uint(attempt)` for large attempt counts — cap the exponent.
- `baseDelay` of zero causes immediate retry loop — validate input.
- Idempotency: ensure the payment function uses an idempotency key so retried requests are safe to re-execute.
- Clock skew on distributed systems: use monotonic time (`time.Since`).

---

## Problem 3: Webhook Delivery At-Least-Once

**Problem:** Implement an at-least-once webhook delivery system. Events must be delivered to subscriber URLs even across process restarts. Track delivery attempts and stop retrying after a configurable failure threshold.

```go
package webhook

import (
    "bytes"
    "context"
    "database/sql"
    "net/http"
    "time"
)

type WebhookEvent struct {
    ID          string
    URL         string
    Payload     []byte
    Attempts    int
    MaxAttempts int
    NextRetry   time.Time
    Delivered   bool
}

type Dispatcher struct {
    db     *sql.DB
    client *http.Client
}

func NewDispatcher(db *sql.DB) *Dispatcher {
    return &Dispatcher{
        db:     db,
        client: &http.Client{Timeout: 10 * time.Second},
    }
}

func (d *Dispatcher) Dispatch(ctx context.Context, event *WebhookEvent) error {
    req, err := http.NewRequestWithContext(ctx, http.MethodPost, event.URL, bytes.NewReader(event.Payload))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-Webhook-Event-ID", event.ID)

    resp, err := d.client.Do(req)
    if err != nil || resp.StatusCode >= 500 {
        event.Attempts++
        if event.Attempts >= event.MaxAttempts {
            return d.markFailed(event)
        }
        // Exponential backoff: 5m, 10m, 20m, ...
        backoff := time.Duration(5*(1<<uint(event.Attempts-1))) * time.Minute
        event.NextRetry = time.Now().Add(backoff)
        return d.persist(event)
    }

    event.Delivered = true
    return d.markDelivered(event)
}

func (d *Dispatcher) persist(e *WebhookEvent) error {
    _, err := d.db.Exec(
        `UPDATE webhook_events SET attempts=$1, next_retry=$2 WHERE id=$3`,
        e.Attempts, e.NextRetry, e.ID,
    )
    return err
}

func (d *Dispatcher) markDelivered(e *WebhookEvent) error {
    _, err := d.db.Exec(`UPDATE webhook_events SET delivered=true WHERE id=$1`, e.ID)
    return err
}

func (d *Dispatcher) markFailed(e *WebhookEvent) error {
    _, err := d.db.Exec(`UPDATE webhook_events SET failed=true WHERE id=$1`, e.ID)
    return err
}

// PollPending picks up events due for delivery. Run in a worker loop.
func (d *Dispatcher) PollPending(ctx context.Context) ([]*WebhookEvent, error) {
    rows, err := d.db.QueryContext(ctx,
        `SELECT id, url, payload, attempts, max_attempts, next_retry
         FROM webhook_events
         WHERE delivered=false AND failed=false AND next_retry <= $1
         LIMIT 100`,
        time.Now(),
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var events []*WebhookEvent
    for rows.Next() {
        e := &WebhookEvent{}
        if err := rows.Scan(&e.ID, &e.URL, &e.Payload, &e.Attempts, &e.MaxAttempts, &e.NextRetry); err != nil {
            return nil, err
        }
        events = append(events, e)
    }
    return events, rows.Err()
}
```

**Correctness Analysis:**
- Events are persisted in the database before delivery so a crash cannot lose them.
- The `X-Webhook-Event-ID` header lets subscribers deduplicate replays.
- `PollPending` with a `LIMIT` prevents unbounded memory usage.

**Edge Cases:**
- Two workers picking the same event — use `SELECT FOR UPDATE SKIP LOCKED` in Postgres.
- 2xx response but network read fails — treat as success if status is known (log and skip retry).
- Subscriber URL returns 410 Gone — stop retrying permanently.
- Large payloads — stream body instead of buffering.

---

## Problem 4: Financial Ledger Double-Entry Bookkeeping

**Problem:** Implement a double-entry ledger. Every transaction must debit one account and credit another for the same amount. The ledger must never become unbalanced.

```go
package ledger

import (
    "context"
    "database/sql"
    "errors"
    "fmt"

    "github.com/shopspring/decimal"
)

type EntryType string

const (
    Debit  EntryType = "debit"
    Credit EntryType = "credit"
)

type LedgerEntry struct {
    AccountID   string
    Type        EntryType
    Amount      decimal.Decimal
    Currency    string
    Description string
}

type Ledger struct {
    db *sql.DB
}

func NewLedger(db *sql.DB) *Ledger { return &Ledger{db: db} }

func (l *Ledger) RecordTransaction(ctx context.Context, txID string, entries []LedgerEntry) error {
    if err := validateDoubleEntry(entries); err != nil {
        return err
    }

    tx, err := l.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
    if err != nil {
        return err
    }
    defer tx.Rollback()

    for _, e := range entries {
        _, err := tx.ExecContext(ctx,
            `INSERT INTO ledger_entries (tx_id, account_id, type, amount, currency, description)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            txID, e.AccountID, e.Type, e.Amount.String(), e.Currency, e.Description,
        )
        if err != nil {
            return fmt.Errorf("insert entry: %w", err)
        }
    }
    return tx.Commit()
}

// validateDoubleEntry ensures debits == credits per currency.
func validateDoubleEntry(entries []LedgerEntry) error {
    totals := make(map[string]decimal.Decimal) // currency -> net (debit positive, credit negative)
    for _, e := range entries {
        if e.Amount.IsNegative() || e.Amount.IsZero() {
            return errors.New("entry amount must be positive")
        }
        switch e.Type {
        case Debit:
            totals[e.Currency] = totals[e.Currency].Add(e.Amount)
        case Credit:
            totals[e.Currency] = totals[e.Currency].Sub(e.Amount)
        default:
            return fmt.Errorf("unknown entry type: %s", e.Type)
        }
    }
    for currency, net := range totals {
        if !net.IsZero() {
            return fmt.Errorf("unbalanced entries for currency %s: net %s", currency, net.String())
        }
    }
    return nil
}

func (l *Ledger) Balance(ctx context.Context, accountID, currency string) (decimal.Decimal, error) {
    var bal decimal.Decimal
    row := l.db.QueryRowContext(ctx,
        `SELECT
            COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END), 0)
         FROM ledger_entries
         WHERE account_id=$1 AND currency=$2`,
        accountID, currency,
    )
    var raw string
    if err := row.Scan(&raw); err != nil {
        return bal, err
    }
    return decimal.NewFromString(raw)
}
```

**Correctness Analysis:**
- `validateDoubleEntry` runs before the database transaction — invalid entries never touch the DB.
- `Serializable` isolation prevents concurrent writes from producing phantom reads that could corrupt balances.
- Uses `shopspring/decimal` to avoid float arithmetic errors (see Problem 14).

**Edge Cases:**
- Multi-currency transactions — validate balance per currency, not globally.
- Reversal: insert the mirror-image entries under a new `txID`, not by deleting original entries.
- Concurrent balance reads during a partial write — serializable isolation handles this.
- Overflow: `decimal` supports arbitrary precision; pick scale (e.g., 8 decimal places) consistently.

---

## Problem 5: Rate Limiter Per API Key (Multiple Tiers)

**Problem:** Implement a token bucket rate limiter supporting multiple tiers (Free: 100 req/min, Pro: 1000 req/min, Enterprise: unlimited). Thread-safe, in-memory.

```go
package ratelimit

import (
    "sync"
    "time"
)

type Tier int

const (
    FreeTier       Tier = 100
    ProTier        Tier = 1000
    EnterpriseTier Tier = -1 // unlimited
)

type bucket struct {
    tokens     float64
    capacity   float64
    refillRate float64 // tokens per nanosecond
    lastRefill time.Time
    mu         sync.Mutex
}

func newBucket(ratePerMin int) *bucket {
    if ratePerMin == -1 {
        return nil // unlimited
    }
    cap := float64(ratePerMin)
    return &bucket{
        tokens:     cap,
        capacity:   cap,
        refillRate: cap / float64(time.Minute),
        lastRefill: time.Now(),
    }
}

func (b *bucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()

    now := time.Now()
    elapsed := float64(now.Sub(b.lastRefill))
    b.tokens += elapsed * b.refillRate
    if b.tokens > b.capacity {
        b.tokens = b.capacity
    }
    b.lastRefill = now

    if b.tokens >= 1 {
        b.tokens--
        return true
    }
    return false
}

type RateLimiter struct {
    mu      sync.RWMutex
    buckets map[string]*bucket
    tiers   map[string]Tier
}

func NewRateLimiter() *RateLimiter {
    return &RateLimiter{
        buckets: make(map[string]*bucket),
        tiers:   make(map[string]Tier),
    }
}

func (r *RateLimiter) SetTier(apiKey string, tier Tier) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.tiers[apiKey] = tier
    r.buckets[apiKey] = newBucket(int(tier))
}

func (r *RateLimiter) Allow(apiKey string) bool {
    r.mu.RLock()
    b, ok := r.buckets[apiKey]
    r.mu.RUnlock()

    if !ok {
        return false // unknown key
    }
    if b == nil {
        return true // enterprise unlimited
    }
    return b.Allow()
}
```

**Correctness Analysis:**
- Token refill is lazy (computed on each `Allow` call) — no background ticker needed.
- The per-bucket mutex allows concurrent requests from different API keys to proceed in parallel.
- `nil` bucket represents unlimited tier, avoiding branch complexity inside `Allow`.

**Edge Cases:**
- Tier upgrades mid-flight — `SetTier` replaces the bucket; tokens do not carry over.
- Stale buckets for inactive keys — add an LRU eviction or per-bucket `lastAccess` TTL.
- Burst tolerance: token bucket allows bursting up to `capacity`; use a sliding window log if strict per-minute counting is required.
- Distributed deployment: in-memory rate limiter is per-process; use Redis with `INCR + EXPIRE` for cross-instance limiting.

---

## Problem 6: Currency Conversion with Concurrent Rate Updates

**Problem:** Implement a currency converter where exchange rates are updated concurrently by a background feed. Reads must always see a consistent (not partially written) rate table.

```go
package currency

import (
    "sync"
    "sync/atomic"
    "unsafe"
)

type RateTable map[string]float64 // e.g. "USD/EUR" -> 0.92

type RateStore struct {
    table unsafe.Pointer // *RateTable — updated atomically
    mu    sync.Mutex     // serialises writers
}

func NewRateStore(initial RateTable) *RateStore {
    s := &RateStore{}
    s.storeTable(initial)
    return s
}

func (s *RateStore) storeTable(t RateTable) {
    atomic.StorePointer(&s.table, unsafe.Pointer(&t))
}

func (s *RateStore) loadTable() RateTable {
    return *(*RateTable)(atomic.LoadPointer(&s.table))
}

// UpdateRates replaces the entire rate table atomically (copy-on-write).
func (s *RateStore) UpdateRates(updates map[string]float64) {
    s.mu.Lock()
    defer s.mu.Unlock()

    current := s.loadTable()
    newTable := make(RateTable, len(current))
    for k, v := range current {
        newTable[k] = v
    }
    for k, v := range updates {
        newTable[k] = v
    }
    s.storeTable(newTable)
}

func (s *RateStore) Convert(amount float64, from, to string) (float64, bool) {
    t := s.loadTable()
    key := from + "/" + to
    if rate, ok := t[key]; ok {
        return amount * rate, true
    }
    // Try inverse
    if rate, ok := t[to+"/"+from]; ok {
        return amount / rate, true
    }
    return 0, false
}
```

**Correctness Analysis:**
- `atomic.StorePointer` / `atomic.LoadPointer` provide a lock-free pointer swap; readers always see either the old or the new map, never a partially built one.
- The writer mutex serialises concurrent updates, preventing a lost-update where two goroutines each copy the old table and overwrite each other.
- Readers do not hold any lock, so reads scale horizontally.

**Edge Cases:**
- Floating point precision for rates — use `decimal` for high-value conversions (see Problem 14).
- Triangular arbitrage inconsistency: if USD/EUR and EUR/GBP are updated independently, USD/GBP derived rate may be momentarily stale.
- Rate feed failures — keep last known good table; expose a staleness timestamp.
- Missing cross-rate: implement a two-hop conversion via a base currency (e.g., USD) as fallback.

---

## Problem 7: Distributed Lock for Payment Processing

**Problem:** Implement a distributed lock using Redis to ensure a payment for a given order is processed by exactly one worker at a time.

```go
package distlock

import (
    "context"
    "errors"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
)

var ErrLockNotAcquired = errors.New("lock not acquired")

type RedisLock struct {
    client *redis.Client
    key    string
    value  string // unique token to prevent releasing another holder's lock
    ttl    time.Duration
}

func NewRedisLock(client *redis.Client, key, token string, ttl time.Duration) *RedisLock {
    return &RedisLock{client: client, key: key, value: token, ttl: ttl}
}

func (l *RedisLock) Acquire(ctx context.Context) error {
    ok, err := l.client.SetNX(ctx, l.key, l.value, l.ttl).Result()
    if err != nil {
        return fmt.Errorf("redis setnx: %w", err)
    }
    if !ok {
        return ErrLockNotAcquired
    }
    return nil
}

// Release uses a Lua script to atomically check ownership and delete.
var releaseScript = redis.NewScript(`
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
    else
        return 0
    end
`)

func (l *RedisLock) Release(ctx context.Context) error {
    result, err := releaseScript.Run(ctx, l.client, []string{l.key}, l.value).Int()
    if err != nil {
        return fmt.Errorf("release script: %w", err)
    }
    if result == 0 {
        return errors.New("lock was not held by this process (expired or stolen)")
    }
    return nil
}

// WithLock acquires the lock, runs fn, then releases. Retries acquisition up to maxRetries.
func WithLock(ctx context.Context, lock *RedisLock, maxRetries int, fn func() error) error {
    for i := 0; i < maxRetries; i++ {
        err := lock.Acquire(ctx)
        if err == nil {
            defer lock.Release(ctx)
            return fn()
        }
        if !errors.Is(err, ErrLockNotAcquired) {
            return err
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(100 * time.Millisecond):
        }
    }
    return fmt.Errorf("could not acquire lock after %d retries", maxRetries)
}
```

**Correctness Analysis:**
- `SetNX` (Set if Not eXists) is atomic in Redis — no race between check and set.
- The Lua script for release is atomic: it reads and conditionally deletes in one round-trip.
- The unique `value` (token) prevents worker A from releasing worker B's lock after A's TTL expired and B re-acquired.

**Edge Cases:**
- Lock expiry during long processing — extend TTL with `PEXPIRE` via a background goroutine ("watchdog").
- Redis failure after lock acquisition — payment may be skipped; ensure idempotency key handles re-entry.
- Network partition causing `SetNX` to succeed on Redis but response lost to client — client retries and gets `ErrLockNotAcquired`; use Redlock for multi-node safety.
- `maxRetries` exhausted — surface as a retryable error upstream.

---

## Problem 8: Reconciliation — Bank Statement Matching

**Problem:** Given internal ledger transactions and an external bank statement, identify matched, unmatched internal, and unmatched external records.

```go
package reconciliation

import (
    "fmt"
    "time"

    "github.com/shopspring/decimal"
)

type Transaction struct {
    ID        string
    Amount    decimal.Decimal
    Currency  string
    Date      time.Time
    Reference string
}

type ReconciliationResult struct {
    Matched           []MatchedPair
    UnmatchedInternal []Transaction
    UnmatchedExternal []Transaction
}

type MatchedPair struct {
    Internal Transaction
    External Transaction
}

// Reconcile matches internal ledger entries against bank statement entries.
// Matching key: (Amount, Currency, Reference) within a 3-day date window.
func Reconcile(internal, external []Transaction) ReconciliationResult {
    result := ReconciliationResult{}
    usedExternal := make(map[string]bool)

    for _, in := range internal {
        matched := false
        for _, ex := range external {
            if usedExternal[ex.ID] {
                continue
            }
            if in.Amount.Equal(ex.Amount) &&
                in.Currency == ex.Currency &&
                in.Reference == ex.Reference &&
                dateDiff(in.Date, ex.Date) <= 3 {
                result.Matched = append(result.Matched, MatchedPair{Internal: in, External: ex})
                usedExternal[ex.ID] = true
                matched = true
                break
            }
        }
        if !matched {
            result.UnmatchedInternal = append(result.UnmatchedInternal, in)
        }
    }

    for _, ex := range external {
        if !usedExternal[ex.ID] {
            result.UnmatchedExternal = append(result.UnmatchedExternal, ex)
        }
    }
    return result
}

func dateDiff(a, b time.Time) int {
    diff := a.Sub(b)
    if diff < 0 {
        diff = -diff
    }
    return int(diff.Hours() / 24)
}

func SummaryReport(r ReconciliationResult) string {
    return fmt.Sprintf(
        "Matched: %d | Unmatched Internal: %d | Unmatched External: %d",
        len(r.Matched), len(r.UnmatchedInternal), len(r.UnmatchedExternal),
    )
}
```

**Correctness Analysis:**
- `usedExternal` prevents one external record from matching multiple internal entries.
- Uses `decimal.Equal` instead of `==` for amount comparison to handle precision safely.
- O(n*m) — acceptable for typical batch sizes (hundreds to thousands); use a hash map keyed by `(Amount, Currency, Reference)` for large datasets.

**Edge Cases:**
- Duplicate transactions with identical fields — require tie-breaking by closest date.
- Bank uses different reference formats — normalize references before comparison (trim spaces, uppercase).
- Partial settlements (bank splits one charge into two) — flag for manual review.
- Timezone differences in dates — convert all times to UTC before comparing.

---

## Problem 9: Audit Log That Cannot Be Modified

**Problem:** Implement an append-only audit log where each entry is chained to the previous via a hash (like a blockchain), making tampering detectable.

```go
package auditlog

import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "fmt"
    "sync"
    "time"
)

type AuditEntry struct {
    Seq       int64
    Timestamp time.Time
    Action    string
    Actor     string
    Payload   json.RawMessage
    PrevHash  string
    Hash      string
}

type AuditLog struct {
    mu      sync.Mutex
    entries []*AuditEntry
}

func (al *AuditLog) Append(action, actor string, payload any) (*AuditEntry, error) {
    al.mu.Lock()
    defer al.mu.Unlock()

    data, err := json.Marshal(payload)
    if err != nil {
        return nil, err
    }

    var prevHash string
    var seq int64
    if n := len(al.entries); n > 0 {
        prevHash = al.entries[n-1].Hash
        seq = al.entries[n-1].Seq + 1
    }

    entry := &AuditEntry{
        Seq:       seq,
        Timestamp: time.Now().UTC(),
        Action:    action,
        Actor:     actor,
        Payload:   data,
        PrevHash:  prevHash,
    }
    entry.Hash = computeHash(entry)
    al.entries = append(al.entries, entry)
    return entry, nil
}

func computeHash(e *AuditEntry) string {
    h := sha256.New()
    fmt.Fprintf(h, "%d|%s|%s|%s|%s|%s",
        e.Seq, e.Timestamp.String(), e.Action, e.Actor, string(e.Payload), e.PrevHash)
    return hex.EncodeToString(h.Sum(nil))
}

func (al *AuditLog) Verify() error {
    al.mu.Lock()
    defer al.mu.Unlock()

    for i, entry := range al.entries {
        expected := computeHash(entry)
        if entry.Hash != expected {
            return fmt.Errorf("entry %d hash mismatch: stored %s, computed %s", i, entry.Hash, expected)
        }
        if i > 0 && entry.PrevHash != al.entries[i-1].Hash {
            return errors.New(fmt.Sprintf("chain broken at entry %d", i))
        }
    }
    return nil
}
```

**Correctness Analysis:**
- Changing any entry's fields invalidates its hash, and cascades to break all subsequent `PrevHash` links.
- `Verify` detects both field tampering and deletion of entries (chain breaks).
- Mutex ensures sequential `Seq` numbering and consistent `PrevHash` linking.

**Edge Cases:**
- Log stored in a database — an adversary with DB access can recompute hashes after tampering; sign each hash with an HMAC key stored separately (HSM).
- Log rotation/pagination — persist the last hash of each page to continue the chain.
- Concurrent `Append` calls — the mutex serialises them; avoid multiple log instances.
- Timestamp manipulation — use a trusted time server (RFC 3161 timestamping).

---

## Problem 10: Payment State Machine with Event Sourcing

**Problem:** Model a payment as a state machine (Created → Authorized → Captured → Refunded / Failed). Use event sourcing: store events, derive state by replaying.

```go
package payment

import (
    "errors"
    "fmt"
    "time"
)

type State string

const (
    StateCreated    State = "created"
    StateAuthorized State = "authorized"
    StateCaptured   State = "captured"
    StateRefunded   State = "refunded"
    StateFailed     State = "failed"
)

type EventType string

const (
    EventAuthorize EventType = "authorize"
    EventCapture   EventType = "capture"
    EventRefund    EventType = "refund"
    EventFail      EventType = "fail"
)

type Event struct {
    Type      EventType
    OccuredAt time.Time
    Metadata  map[string]string
}

type Payment struct {
    ID     string
    Events []Event
}

func NewPayment(id string) *Payment {
    return &Payment{ID: id}
}

func (p *Payment) Apply(e Event) error {
    current := p.CurrentState()
    if err := validateTransition(current, e.Type); err != nil {
        return err
    }
    e.OccuredAt = time.Now().UTC()
    p.Events = append(p.Events, e)
    return nil
}

// CurrentState replays all events to derive the current state.
func (p *Payment) CurrentState() State {
    state := StateCreated
    for _, e := range p.Events {
        switch e.Type {
        case EventAuthorize:
            state = StateAuthorized
        case EventCapture:
            state = StateCaptured
        case EventRefund:
            state = StateRefunded
        case EventFail:
            state = StateFailed
        }
    }
    return state
}

var transitions = map[State]map[EventType]bool{
    StateCreated:    {EventAuthorize: true, EventFail: true},
    StateAuthorized: {EventCapture: true, EventFail: true},
    StateCaptured:   {EventRefund: true},
    StateRefunded:   {},
    StateFailed:     {},
}

func validateTransition(from State, event EventType) error {
    allowed, ok := transitions[from]
    if !ok {
        return fmt.Errorf("unknown state: %s", from)
    }
    if !allowed[event] {
        return fmt.Errorf("cannot apply event %s in state %s", event, from)
    }
    return nil
}

// Rebuild creates a Payment from a persisted event slice.
func Rebuild(id string, events []Event) (*Payment, error) {
    p := NewPayment(id)
    for _, e := range events {
        if err := validateTransition(p.CurrentState(), e.Type); err != nil {
            return nil, fmt.Errorf("invalid event history: %w", err)
        }
        p.Events = append(p.Events, e)
    }
    return p, errors.New("") // remove this; illustrative
}
```

**Correctness Analysis:**
- State is never stored — it is derived from the immutable event log.
- `validateTransition` enforces the state machine contract; illegal events are rejected before appending.
- Replaying events is deterministic and testable without a database.

**Edge Cases:**
- Partial refund — model as `PartialRefund` event with an amount field in Metadata, or a separate `RefundedAmount` accumulator.
- Concurrent state changes — use optimistic concurrency: store the last event sequence number and reject conflicting writes.
- Long event history — introduce snapshots (cache current state at N events) to avoid full replay.
- Schema evolution — version event types; handle unknown event types gracefully during replay.

---

## Problem 11: Charge Reversal Idempotency

**Problem:** Implement a charge reversal (refund) endpoint that is idempotent. Re-issuing the same refund request must not double-refund.

```go
package reversal

import (
    "context"
    "database/sql"
    "errors"
    "fmt"

    "github.com/shopspring/decimal"
)

var ErrAlreadyRefunded = errors.New("charge has already been fully refunded")
var ErrRefundExceedsCharge = errors.New("refund amount exceeds original charge")

type RefundRequest struct {
    IdempotencyKey string
    ChargeID       string
    Amount         decimal.Decimal
    Currency       string
    Reason         string
}

type RefundResult struct {
    RefundID string
    Status   string
}

type ReversalService struct {
    db *sql.DB
}

func NewReversalService(db *sql.DB) *ReversalService { return &ReversalService{db: db} }

func (s *ReversalService) Refund(ctx context.Context, req RefundRequest) (*RefundResult, error) {
    tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
    if err != nil {
        return nil, err
    }
    defer tx.Rollback()

    // Check idempotency: has this exact refund been issued?
    var existingRefundID string
    err = tx.QueryRowContext(ctx,
        `SELECT refund_id FROM refunds WHERE idempotency_key=$1`, req.IdempotencyKey,
    ).Scan(&existingRefundID)
    if err == nil {
        tx.Rollback()
        return &RefundResult{RefundID: existingRefundID, Status: "already_processed"}, nil
    }
    if !errors.Is(err, sql.ErrNoRows) {
        return nil, fmt.Errorf("idempotency check: %w", err)
    }

    // Check total refunded so far against original charge.
    var originalAmount, refundedSoFar decimal.Decimal
    var rawOriginal, rawRefunded string
    if err := tx.QueryRowContext(ctx,
        `SELECT amount, COALESCE((SELECT SUM(amount) FROM refunds WHERE charge_id=$1),0)
         FROM charges WHERE id=$1`, req.ChargeID,
    ).Scan(&rawOriginal, &rawRefunded); err != nil {
        return nil, fmt.Errorf("fetch charge: %w", err)
    }
    originalAmount, _ = decimal.NewFromString(rawOriginal)
    refundedSoFar, _ = decimal.NewFromString(rawRefunded)

    if refundedSoFar.Add(req.Amount).GreaterThan(originalAmount) {
        return nil, ErrRefundExceedsCharge
    }

    // Insert the refund record.
    var newRefundID string
    if err := tx.QueryRowContext(ctx,
        `INSERT INTO refunds (charge_id, idempotency_key, amount, currency, reason)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        req.ChargeID, req.IdempotencyKey, req.Amount.String(), req.Currency, req.Reason,
    ).Scan(&newRefundID); err != nil {
        return nil, fmt.Errorf("insert refund: %w", err)
    }

    return &RefundResult{RefundID: newRefundID, Status: "succeeded"}, tx.Commit()
}
```

**Correctness Analysis:**
- The idempotency check and refund insert run inside a single serializable transaction, preventing a race where two concurrent refunds for the same key both pass the check.
- `SUM(amount)` includes all prior refunds for the charge, preventing over-refunding even for partial refunds.
- Returning the existing `refundID` on duplicate request satisfies the idempotency contract.

**Edge Cases:**
- Gateway call (to Stripe, Braintree) must also be idempotent — pass `idempotency_key` to the gateway before inserting into the database.
- Refund inserted but gateway call fails — the DB entry exists but no money moved; mark as `pending_gateway` and retry.
- Concurrent refunds for different amounts on the same charge — serializable isolation serialises them; second refund re-reads the updated `SUM`.

---

## Problem 12: Fraud Detection Concurrent Rule Engine

**Problem:** Evaluate a list of fraud rules concurrently against a transaction. Rules are independent; return the first triggered rule (or none). Respect a timeout.

```go
package fraud

import (
    "context"
    "sync"
    "time"

    "github.com/shopspring/decimal"
)

type Transaction struct {
    ID       string
    Amount   decimal.Decimal
    Country  string
    IP       string
    UserID   string
}

type RuleResult struct {
    RuleName string
    Reason   string
}

type Rule func(ctx context.Context, tx Transaction) *RuleResult

// EvaluateRules runs all rules concurrently, returns the first triggered result.
func EvaluateRules(ctx context.Context, tx Transaction, rules []Rule, timeout time.Duration) *RuleResult {
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    resultCh := make(chan *RuleResult, len(rules))
    var wg sync.WaitGroup

    for _, rule := range rules {
        wg.Add(1)
        go func(r Rule) {
            defer wg.Done()
            if res := r(ctx, tx); res != nil {
                select {
                case resultCh <- res:
                default:
                }
            }
        }(rule)
    }

    go func() {
        wg.Wait()
        close(resultCh)
    }()

    select {
    case res, ok := <-resultCh:
        if ok {
            return res
        }
        return nil // no rule triggered
    case <-ctx.Done():
        return &RuleResult{RuleName: "timeout", Reason: "fraud evaluation timed out"}
    }
}

// Sample rules
var HighAmountRule Rule = func(ctx context.Context, tx Transaction) *RuleResult {
    if tx.Amount.GreaterThan(decimal.NewFromInt(10000)) {
        return &RuleResult{RuleName: "high_amount", Reason: "transaction exceeds $10,000"}
    }
    return nil
}

var SanctionedCountryRule Rule = func(ctx context.Context, tx Transaction) *RuleResult {
    sanctioned := map[string]bool{"KP": true, "IR": true, "SY": true}
    if sanctioned[tx.Country] {
        return &RuleResult{RuleName: "sanctioned_country", Reason: "transaction from sanctioned country"}
    }
    return nil
}
```

**Correctness Analysis:**
- Buffered channel of size `len(rules)` ensures no goroutine blocks on send; the outer `select` reads only the first.
- `cancel()` via `context.WithTimeout` signals all rule goroutines to exit early if they respect context.
- `wg.Wait` followed by `close(resultCh)` cleanly signals "all rules done with no trigger".

**Edge Cases:**
- Multiple rules trigger simultaneously — first to reach the channel wins; rest are discarded (buffered).
- Rule goroutine panics — add `recover` in the goroutine wrapper to prevent crashing the engine.
- Rules requiring external calls (IP reputation, ML scoring) — enforce per-rule sub-timeouts.
- Rule ordering for determinism — for audit purposes, log all triggered rules, not just the first.

---

## Problem 13: Payment Gateway Health Checker

**Problem:** Implement a health checker that polls multiple payment gateways (Stripe, Braintree, Adyen) concurrently. Track availability percentages over a sliding window.

```go
package healthcheck

import (
    "context"
    "net/http"
    "sync"
    "time"
)

type HealthStatus struct {
    Gateway     string
    Available   bool
    Latency     time.Duration
    Availability float64 // rolling percentage
}

type windowEntry struct {
    ok        bool
    timestamp time.Time
}

type GatewayChecker struct {
    mu      sync.RWMutex
    windows map[string][]windowEntry
    window  time.Duration // e.g., 5 minutes
    client  *http.Client
}

func NewGatewayChecker(windowDuration time.Duration) *GatewayChecker {
    return &GatewayChecker{
        windows: make(map[string][]windowEntry),
        window:  windowDuration,
        client:  &http.Client{Timeout: 5 * time.Second},
    }
}

func (g *GatewayChecker) Check(ctx context.Context, gateways map[string]string) []HealthStatus {
    results := make([]HealthStatus, 0, len(gateways))
    var mu sync.Mutex
    var wg sync.WaitGroup

    for name, url := range gateways {
        wg.Add(1)
        go func(n, u string) {
            defer wg.Done()
            start := time.Now()
            req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
            resp, err := g.client.Do(req)
            latency := time.Since(start)
            ok := err == nil && resp.StatusCode < 500

            g.record(n, ok)

            mu.Lock()
            results = append(results, HealthStatus{
                Gateway:      n,
                Available:    ok,
                Latency:      latency,
                Availability: g.availability(n),
            })
            mu.Unlock()
        }(name, url)
    }
    wg.Wait()
    return results
}

func (g *GatewayChecker) record(name string, ok bool) {
    g.mu.Lock()
    defer g.mu.Unlock()
    now := time.Now()
    g.evict(name, now)
    g.windows[name] = append(g.windows[name], windowEntry{ok: ok, timestamp: now})
}

func (g *GatewayChecker) evict(name string, now time.Time) {
    cutoff := now.Add(-g.window)
    entries := g.windows[name]
    i := 0
    for i < len(entries) && entries[i].timestamp.Before(cutoff) {
        i++
    }
    g.windows[name] = entries[i:]
}

func (g *GatewayChecker) availability(name string) float64 {
    g.mu.RLock()
    defer g.mu.RUnlock()
    entries := g.windows[name]
    if len(entries) == 0 {
        return 0
    }
    ok := 0
    for _, e := range entries {
        if e.ok {
            ok++
        }
    }
    return float64(ok) / float64(len(entries)) * 100
}
```

**Correctness Analysis:**
- Each gateway is checked in its own goroutine; `wg.Wait` ensures all complete before returning.
- `record` evicts stale entries inside the write lock before appending — sliding window is always current.
- `availability` acquires a read lock independently of `record`'s write lock; they do not deadlock.

**Edge Cases:**
- Gateway returning 200 with `{"status":"degraded"}` — parse body to detect soft failures.
- DNS failures vs TCP connection refused — distinguish to report better diagnostics.
- Circuit breaker: if availability drops below 50%, stop routing to that gateway.
- Thundering herd: spread check intervals with jitter per gateway.

---

## Problem 14: Fee Calculation with Precision (Avoid Float)

**Problem:** Calculate payment processing fees without floating-point errors. Stripe charges 2.9% + $0.30 per transaction. Represent all amounts in the smallest currency unit (cents).

```go
package fee

import (
    "errors"
    "fmt"

    "github.com/shopspring/decimal"
)

// All amounts in smallest unit (cents for USD).
type FeeResult struct {
    ChargeAmountCents int64
    FeeCents          int64
    NetCents          int64
}

var (
    rate    = decimal.NewFromFloat(0.029) // 2.9%
    fixedUS = decimal.NewFromInt(30)      // 30 cents
)

func CalculateFee(chargeAmountCents int64) (*FeeResult, error) {
    if chargeAmountCents <= 0 {
        return nil, errors.New("charge amount must be positive")
    }

    amount := decimal.NewFromInt(chargeAmountCents)
    // fee = amount * 2.9% + 30 cents, rounded up to nearest cent (Stripe's behaviour)
    fee := amount.Mul(rate).Add(fixedUS).Ceil()
    net := amount.Sub(fee)

    feeCents := fee.IntPart()
    netCents := net.IntPart()

    if net.IsNegative() {
        return nil, fmt.Errorf("fee (%d cents) exceeds charge (%d cents)", feeCents, chargeAmountCents)
    }

    return &FeeResult{
        ChargeAmountCents: chargeAmountCents,
        FeeCents:          feeCents,
        NetCents:          netCents,
    }, nil
}

// CalculateBreakEvenAmount returns the minimum charge where the seller receives at least minNet cents.
func CalculateBreakEvenAmount(minNetCents int64) int64 {
    // charge = (minNet + fixed) / (1 - rate)
    minNet := decimal.NewFromInt(minNetCents)
    one := decimal.NewFromInt(1)
    charge := minNet.Add(fixedUS).Div(one.Sub(rate)).Ceil()
    return charge.IntPart()
}
```

**Correctness Analysis:**
- All arithmetic uses `decimal.Decimal` — no IEEE 754 rounding errors.
- `Ceil()` on the fee mirrors Stripe's ceiling rounding policy; never undercharge fees.
- Working in cents (integers) avoids the need to convert to/from floating-point strings.

**Edge Cases:**
- Very small charges (e.g., $0.50) where fee exceeds amount — return error.
- Different rate tiers (Stripe's discounted rates for high-volume) — parameterise `rate`.
- International cards with different rate (3.9% + $0.30) — pass rate as a parameter.
- Currency without cents (JPY) — `fixedUS` should be zero and `scale` should be 0.

---

## Problem 15: Currency Rounding Rules

**Problem:** Implement ISO 4217-compliant rounding for different currencies. USD/EUR round to 2 decimal places, JPY rounds to 0, KWD rounds to 3.

```go
package rounding

import (
    "fmt"

    "github.com/shopspring/decimal"
)

type RoundingRule struct {
    DecimalPlaces int32
    Mode          decimal.RoundingMode
}

var currencyRules = map[string]RoundingRule{
    "USD": {2, decimal.RoundHalfUp},
    "EUR": {2, decimal.RoundHalfUp},
    "GBP": {2, decimal.RoundHalfUp},
    "JPY": {0, decimal.RoundHalfUp},
    "KWD": {3, decimal.RoundHalfUp},
    "BHD": {3, decimal.RoundHalfUp},
    "OMR": {3, decimal.RoundHalfUp},
    "CHF": {2, decimal.RoundHalfUp}, // Switzerland rounds to 0.05 in cash
}

func Round(amount decimal.Decimal, currency string) (decimal.Decimal, error) {
    rule, ok := currencyRules[currency]
    if !ok {
        return decimal.Zero, fmt.Errorf("unsupported currency: %s", currency)
    }
    return amount.RoundBank(rule.DecimalPlaces), nil
}

// RoundToSubunit converts a decimal amount to the smallest currency unit (integer).
func RoundToSubunit(amount decimal.Decimal, currency string) (int64, error) {
    rule, ok := currencyRules[currency]
    if !ok {
        return 0, fmt.Errorf("unsupported currency: %s", currency)
    }
    factor := decimal.NewFromFloat(pow10(int(rule.DecimalPlaces)))
    subunit := amount.Mul(factor).RoundBank(0)
    return subunit.IntPart(), nil
}

func pow10(n int) float64 {
    result := 1.0
    for i := 0; i < n; i++ {
        result *= 10
    }
    return result
}

// FormatAmount formats a subunit integer back to a human-readable string.
func FormatAmount(subunits int64, currency string) (string, error) {
    rule, ok := currencyRules[currency]
    if !ok {
        return "", fmt.Errorf("unsupported currency: %s", currency)
    }
    factor := decimal.NewFromFloat(pow10(int(rule.DecimalPlaces)))
    amount := decimal.NewFromInt(subunits).Div(factor)
    return fmt.Sprintf("%s %s", currency, amount.StringFixed(rule.DecimalPlaces)), nil
}
```

**Correctness Analysis:**
- `RoundBank` implements banker's rounding (round half to even), avoiding systematic bias in financial calculations.
- `RoundToSubunit` converts once to an integer for storage; all arithmetic on integers avoids further rounding.
- Central `currencyRules` map ensures rounding rules are defined once and applied consistently.

**Edge Cases:**
- CHF rounds to 0.05 in physical cash but 0.01 in electronic transactions — differentiate by payment channel.
- Negative amounts — `RoundBank` handles them correctly (rounds toward even).
- Unknown currency at runtime — return error and refuse to process rather than defaulting to 2 places.
- Cross-currency conversions — round only the final output amount, not intermediate values.

---

## Problem 16: Payment Webhook Signature Verification

**Problem:** Verify that incoming webhook payloads are genuinely from Stripe using HMAC-SHA256 signatures. Prevent replay attacks using timestamp tolerance.

```go
package webhook

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "errors"
    "fmt"
    "strconv"
    "strings"
    "time"
)

const toleranceSeconds = 300 // 5 minutes

var ErrInvalidSignature = errors.New("webhook signature invalid")
var ErrTimestampOutOfTolerance = errors.New("webhook timestamp outside tolerance window")

// VerifyStripeSignature validates the Stripe-Signature header.
// header format: "t=1614966513,v1=abc123...,v1=def456..."
func VerifyStripeSignature(payload []byte, header, secret string) error {
    ts, signatures, err := parseHeader(header)
    if err != nil {
        return err
    }

    // Replay attack prevention
    age := time.Since(time.Unix(ts, 0))
    if age.Abs() > toleranceSeconds*time.Second {
        return ErrTimestampOutOfTolerance
    }

    // Compute expected signature
    signedPayload := fmt.Sprintf("%d.%s", ts, string(payload))
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(signedPayload))
    expected := hex.EncodeToString(mac.Sum(nil))

    for _, sig := range signatures {
        if hmac.Equal([]byte(sig), []byte(expected)) {
            return nil
        }
    }
    return ErrInvalidSignature
}

func parseHeader(header string) (int64, []string, error) {
    var ts int64
    var signatures []string
    for _, part := range strings.Split(header, ",") {
        kv := strings.SplitN(part, "=", 2)
        if len(kv) != 2 {
            return 0, nil, fmt.Errorf("malformed header part: %s", part)
        }
        switch kv[0] {
        case "t":
            v, err := strconv.ParseInt(kv[1], 10, 64)
            if err != nil {
                return 0, nil, fmt.Errorf("invalid timestamp: %w", err)
            }
            ts = v
        case "v1":
            signatures = append(signatures, kv[1])
        }
    }
    if ts == 0 {
        return 0, nil, errors.New("missing timestamp in header")
    }
    return ts, signatures, nil
}
```

**Correctness Analysis:**
- `hmac.Equal` uses constant-time comparison, preventing timing attacks.
- Multiple `v1` signatures are checked to support key rotation (old and new key active simultaneously).
- Timestamp check is done before signature verification to fast-fail on replays.

**Edge Cases:**
- Missing header — return 400 immediately, do not process payload.
- Future timestamps (clock skew) — `age.Abs()` covers both past and future.
- Secret rotation window — support two secrets simultaneously during rollover.
- Very large payloads — stream-hash rather than buffer to prevent memory exhaustion.

---

## Problem 17: Concurrent Batch Payment Processor

**Problem:** Process a batch of payments concurrently with a controlled worker pool. Collect per-payment results; do not let one failure cancel others.

```go
package batch

import (
    "context"
    "sync"

    "github.com/shopspring/decimal"
)

type PaymentJob struct {
    ID     string
    Amount decimal.Decimal
}

type PaymentJobResult struct {
    Job   PaymentJob
    Error error
}

type ProcessFunc func(ctx context.Context, job PaymentJob) error

func ProcessBatch(
    ctx context.Context,
    jobs []PaymentJob,
    workers int,
    process ProcessFunc,
) []PaymentJobResult {
    jobCh := make(chan PaymentJob, len(jobs))
    for _, j := range jobs {
        jobCh <- j
    }
    close(jobCh)

    results := make([]PaymentJobResult, 0, len(jobs))
    var mu sync.Mutex
    var wg sync.WaitGroup

    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for job := range jobCh {
                err := process(ctx, job)
                mu.Lock()
                results = append(results, PaymentJobResult{Job: job, Error: err})
                mu.Unlock()
            }
        }()
    }
    wg.Wait()
    return results
}
```

**Correctness Analysis:**
- Pre-buffered `jobCh` loaded before workers start — avoids blocking on send.
- Errors are captured per-job; one failure does not cancel the context for others.
- `mu` protects the shared `results` slice from concurrent appends.

**Edge Cases:**
- `ctx` cancelled mid-batch — workers should check `ctx.Err()` inside `process` and skip remaining jobs.
- `workers > len(jobs)` — harmless; extra goroutines exit immediately on empty channel.
- Returning partial results — always return all results, with `Error != nil` for failed jobs.
- Rate limiting — add a `time.Ticker` or semaphore inside the worker to throttle calls to the payment gateway.

---

## Problem 18: Optimistic Locking for Account Balance Updates

**Problem:** Implement optimistic concurrency control for account balance updates. If two goroutines try to debit at the same time, only one should succeed per version.

```go
package account

import (
    "context"
    "database/sql"
    "errors"
    "fmt"

    "github.com/shopspring/decimal"
)

var ErrConflict = errors.New("optimistic lock conflict: please retry")
var ErrInsufficientFunds = errors.New("insufficient funds")

type Account struct {
    ID      string
    Balance decimal.Decimal
    Version int64
}

type AccountStore struct {
    db *sql.DB
}

func NewAccountStore(db *sql.DB) *AccountStore { return &AccountStore{db: db} }

func (s *AccountStore) Get(ctx context.Context, id string) (*Account, error) {
    a := &Account{}
    var rawBal string
    err := s.db.QueryRowContext(ctx,
        `SELECT id, balance, version FROM accounts WHERE id=$1`, id,
    ).Scan(&a.ID, &rawBal, &a.Version)
    if err != nil {
        return nil, err
    }
    a.Balance, err = decimal.NewFromString(rawBal)
    return a, err
}

func (s *AccountStore) Debit(ctx context.Context, a *Account, amount decimal.Decimal) error {
    if a.Balance.LessThan(amount) {
        return ErrInsufficientFunds
    }

    newBalance := a.Balance.Sub(amount)
    result, err := s.db.ExecContext(ctx,
        `UPDATE accounts SET balance=$1, version=version+1 WHERE id=$2 AND version=$3`,
        newBalance.String(), a.ID, a.Version,
    )
    if err != nil {
        return fmt.Errorf("update: %w", err)
    }
    rows, err := result.RowsAffected()
    if err != nil {
        return err
    }
    if rows == 0 {
        return ErrConflict // someone else updated first
    }
    a.Balance = newBalance
    a.Version++
    return nil
}
```

**Correctness Analysis:**
- `WHERE version=$3` ensures the update only applies if no other write has occurred since the read.
- `RowsAffected() == 0` signals a conflict — the caller retries with a fresh `Get`.
- No explicit lock is held; read throughput is not penalised.

**Edge Cases:**
- Retry loop starvation — add a backoff and a max-retry cap.
- ABA problem — version counter prevents it (even if balance returns to original value, version differs).
- Batch debits — fetch all accounts once, attempt all updates, collect conflicts, retry only those.
- High contention — switch to pessimistic locking (`SELECT FOR UPDATE`) if conflicts are frequent.

---

## Problem 19: Transaction Deduplication with Bloom Filter (Fast Path)

**Problem:** Implement a fast deduplication check using a Bloom filter as a pre-filter before hitting the database. Acceptable false positive rate: 0.1%.

```go
package dedup

import (
    "math"
    "sync"
)

// BloomFilter provides probabilistic membership testing.
type BloomFilter struct {
    bits    []uint64
    numBits uint
    numHash uint
    mu      sync.RWMutex
}

// NewBloomFilter creates a filter for n expected items at false positive rate p.
func NewBloomFilter(n uint, p float64) *BloomFilter {
    m := optimalBits(n, p)
    k := optimalHashes(m, n)
    return &BloomFilter{
        bits:    make([]uint64, (m+63)/64),
        numBits: m,
        numHash: k,
    }
}

func optimalBits(n uint, p float64) uint {
    return uint(math.Ceil(-float64(n) * math.Log(p) / (math.Log(2) * math.Log(2))))
}

func optimalHashes(m, n uint) uint {
    return uint(math.Round(float64(m) / float64(n) * math.Log(2)))
}

func (bf *BloomFilter) hashes(data []byte) []uint {
    h1 := fnv1a(data)
    h2 := murmur(data)
    positions := make([]uint, bf.numHash)
    for i := uint(0); i < bf.numHash; i++ {
        positions[i] = (h1 + uint64(i)*h2) % uint64(bf.numBits)
    }
    return positions
}

func (bf *BloomFilter) Add(data []byte) {
    bf.mu.Lock()
    defer bf.mu.Unlock()
    for _, pos := range bf.hashes(data) {
        bf.bits[pos/64] |= 1 << (pos % 64)
    }
}

func (bf *BloomFilter) MayContain(data []byte) bool {
    bf.mu.RLock()
    defer bf.mu.RUnlock()
    for _, pos := range bf.hashes(data) {
        if bf.bits[pos/64]&(1<<(pos%64)) == 0 {
            return false
        }
    }
    return true // possible duplicate; verify in DB
}

func fnv1a(data []byte) uint64 {
    h := uint64(14695981039346656037)
    for _, b := range data {
        h ^= uint64(b)
        h *= 1099511628211
    }
    return h
}

func murmur(data []byte) uint64 {
    // Simplified placeholder — use a real murmur3 in production.
    h := uint64(0xcbf29ce484222325)
    for _, b := range data {
        h ^= uint64(b)
        h = (h << 5) | (h >> 59)
        h *= 0x100000001b3
    }
    return h
}
```

**Correctness Analysis:**
- Bloom filter can produce false positives (rare), never false negatives — `MayContain` false means definitely not a duplicate.
- Double-hash scheme (`h1 + i*h2`) simulates k independent hash functions with good distribution.
- RW mutex allows concurrent reads; writes serialised.

**Edge Cases:**
- Filter saturation: as fill fraction rises, false positive rate increases — monitor load factor and rebuild/resize.
- Persistence: Bloom filter is in-memory; on restart, rebuild from DB before accepting traffic.
- Distributed systems: use Redis Bloom (`BF.MADD` / `BF.EXISTS`) for cross-process deduplication.
- False positive leads to unnecessary DB query — that is acceptable and cheaper than a missed duplicate.

---

## Problem 20: Stripe Connect Split Payment

**Problem:** Implement a split payment where a platform takes a fee and the remainder goes to a connected merchant. Ensure the split is exact (no money lost or gained).

```go
package splitpayment

import (
    "errors"
    "fmt"

    "github.com/shopspring/decimal"
)

type SplitResult struct {
    PlatformFeeCents int64
    MerchantCents    int64
    TotalCents       int64
}

// Split divides chargeAmountCents by platformRatePct (e.g., "2.5" for 2.5%).
// The platform fee is rounded down (floor); merchant gets the remainder.
// This ensures: platform + merchant == total (no penny lost or gained).
func Split(chargeAmountCents int64, platformRatePct string) (*SplitResult, error) {
    if chargeAmountCents <= 0 {
        return nil, errors.New("charge must be positive")
    }
    rate, err := decimal.NewFromString(platformRatePct)
    if err != nil {
        return nil, fmt.Errorf("invalid rate: %w", err)
    }
    if rate.IsNegative() || rate.GreaterThanOrEqual(decimal.NewFromInt(100)) {
        return nil, errors.New("platform rate must be in [0, 100)")
    }

    total := decimal.NewFromInt(chargeAmountCents)
    fee := total.Mul(rate).Div(decimal.NewFromInt(100)).Floor() // floor: platform takes less, not more
    merchant := total.Sub(fee)

    return &SplitResult{
        PlatformFeeCents: fee.IntPart(),
        MerchantCents:    merchant.IntPart(),
        TotalCents:       chargeAmountCents,
    }, nil
}
```

**Correctness Analysis:**
- `Floor` on the platform fee means the merchant is never short-changed by a rounding cent.
- `merchant = total - fee` guarantees `platform + merchant == total` with zero residual.
- All amounts remain integers (cents) throughout; no float arithmetic used.

**Edge Cases:**
- Zero-fee tier (rate = "0") — merchant receives 100%; works correctly.
- Very small charges where fee rounds to 0 — platform earns nothing on micro-transactions.
- Multiple parties (platform + sub-platform + merchant) — apply splits sequentially, always flooring and computing the remainder.
- Tax withholding — add as a third split computed on `merchant` amount after platform fee.

---

## Problem 21: Exactly-Once Kafka Payment Event Consumer

**Problem:** Consume payment events from Kafka with exactly-once semantics. Use transactional producer to write results and commit offsets atomically.

```go
package consumer

import (
    "context"
    "database/sql"
    "fmt"
    "log"

    "github.com/segmentio/kafka-go"
)

type PaymentEvent struct {
    PaymentID string
    Amount    int64
    Currency  string
}

type EventProcessor struct {
    reader *kafka.Reader
    writer *kafka.Writer // transactional
    db     *sql.DB
}

func (p *EventProcessor) Run(ctx context.Context) error {
    for {
        msg, err := p.reader.FetchMessage(ctx)
        if err != nil {
            return fmt.Errorf("fetch: %w", err)
        }

        if err := p.processOnce(ctx, msg); err != nil {
            log.Printf("process error (will retry): %v", err)
            continue // do not commit; message will be re-delivered
        }

        if err := p.reader.CommitMessages(ctx, msg); err != nil {
            return fmt.Errorf("commit: %w", err)
        }
    }
}

func (p *EventProcessor) processOnce(ctx context.Context, msg kafka.Message) error {
    // Idempotency guard using message offset as a deduplication key.
    var alreadyProcessed bool
    _ = p.db.QueryRowContext(ctx,
        `SELECT EXISTS(SELECT 1 FROM processed_offsets WHERE topic=$1 AND partition=$2 AND offset=$3)`,
        msg.Topic, msg.Partition, msg.Offset,
    ).Scan(&alreadyProcessed)

    if alreadyProcessed {
        return nil // safe to commit and skip
    }

    tx, err := p.db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Business logic: update ledger, trigger downstream events, etc.
    if err := applyEvent(ctx, tx, msg.Value); err != nil {
        return err
    }

    // Mark offset as processed in the same DB transaction.
    _, err = tx.ExecContext(ctx,
        `INSERT INTO processed_offsets (topic, partition, offset) VALUES ($1,$2,$3)`,
        msg.Topic, msg.Partition, msg.Offset,
    )
    if err != nil {
        return err
    }
    return tx.Commit()
}

func applyEvent(ctx context.Context, tx *sql.Tx, payload []byte) error {
    // Parse and apply business logic here.
    return nil
}
```

**Correctness Analysis:**
- Offset is stored in the same database transaction as the business mutation — either both succeed or both roll back.
- On crash between `Commit` and `CommitMessages`, the message is redelivered; the `processed_offsets` check prevents double-processing.
- Manual offset commit (`FetchMessage` + `CommitMessages`) gives full control, unlike auto-commit.

**Edge Cases:**
- Kafka partition rebalance — reader may receive messages it already processed; idempotency guard handles this.
- `processed_offsets` table grows unboundedly — purge records older than the Kafka retention period.
- Out-of-order delivery — offset check is per-partition; ordering within a partition is guaranteed by Kafka.
- `applyEvent` partial failure with committed offset — impossible with this design since they are in the same transaction.

---

## Problem 22: Currency Amount Parsing and Validation

**Problem:** Safely parse user-supplied currency strings (e.g., "$1,234.56", "1234.56 USD") into validated cent amounts. Reject ambiguous input.

```go
package parse

import (
    "errors"
    "fmt"
    "regexp"
    "strings"

    "github.com/shopspring/decimal"
)

var (
    // Match: optional currency symbol/code, optional commas, decimal number
    amountRe = regexp.MustCompile(`^([A-Z]{3})?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})?$`)
    ErrAmbiguous = errors.New("ambiguous currency: both prefix and suffix currency specified")
    ErrInvalid   = errors.New("invalid amount format")
)

type ParsedAmount struct {
    Cents    int64
    Currency string
}

func Parse(input, defaultCurrency string) (*ParsedAmount, error) {
    input = strings.TrimSpace(strings.ToUpper(input))
    input = strings.ReplaceAll(input, ",", "")

    matches := amountRe.FindStringSubmatch(input)
    if matches == nil {
        return nil, fmt.Errorf("%w: %q", ErrInvalid, input)
    }

    prefixCurrency := matches[1]
    rawNumber := matches[2]
    suffixCurrency := matches[3]

    if prefixCurrency != "" && suffixCurrency != "" && prefixCurrency != suffixCurrency {
        return nil, ErrAmbiguous
    }

    currency := prefixCurrency
    if currency == "" {
        currency = suffixCurrency
    }
    if currency == "" {
        currency = defaultCurrency
    }

    amt, err := decimal.NewFromString(rawNumber)
    if err != nil {
        return nil, fmt.Errorf("parse number: %w", err)
    }
    if amt.IsNegative() {
        return nil, errors.New("amount cannot be negative")
    }

    rule, ok := currencyScale[currency]
    if !ok {
        return nil, fmt.Errorf("unsupported currency: %s", currency)
    }

    factor := decimal.NewFromFloat(pow10(rule))
    cents := amt.Mul(factor).Round(0).IntPart()
    return &ParsedAmount{Cents: cents, Currency: currency}, nil
}

var currencyScale = map[string]int{
    "USD": 2, "EUR": 2, "GBP": 2,
    "JPY": 0, "KWD": 3,
}

func pow10(n int) float64 {
    r := 1.0
    for i := 0; i < n; i++ {
        r *= 10
    }
    return r
}
```

**Correctness Analysis:**
- Regex anchored with `^...$` prevents partial matches on malformed input.
- Comma stripping before parsing handles locale-formatted numbers.
- Currency scale lookup enforces that only supported currencies with known decimal places are accepted.

**Edge Cases:**
- European format (1.234,56) — not handled; document and reject explicitly.
- Negative amounts from refund UI — decide policy (accept with negation, or require separate sign field).
- Whitespace-only input — `TrimSpace` + regex will return `ErrInvalid`.
- Very large amounts (billions) — `decimal` handles arbitrary precision; add a business-logic max cap.

---

## Problem 23: Payment Link Expiry with Context

**Problem:** Implement a payment link that expires after a set duration. The checkout process must abort if the link expires mid-flow.

```go
package paylink

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

var ErrLinkExpired = errors.New("payment link has expired")
var ErrLinkNotFound = errors.New("payment link not found")

type PaymentLink struct {
    ID        string
    AmountCents int64
    Currency  string
    ExpiresAt time.Time
    cancel    context.CancelFunc
    ctx       context.Context
}

type PaymentLinkStore struct {
    mu    sync.RWMutex
    links map[string]*PaymentLink
}

func NewPaymentLinkStore() *PaymentLinkStore {
    return &PaymentLinkStore{links: make(map[string]*PaymentLink)}
}

func (s *PaymentLinkStore) Create(id string, amountCents int64, currency string, ttl time.Duration) *PaymentLink {
    ctx, cancel := context.WithTimeout(context.Background(), ttl)
    link := &PaymentLink{
        ID:          id,
        AmountCents: amountCents,
        Currency:    currency,
        ExpiresAt:   time.Now().Add(ttl),
        ctx:         ctx,
        cancel:      cancel,
    }

    s.mu.Lock()
    s.links[id] = link
    s.mu.Unlock()

    go func() {
        <-ctx.Done()
        s.mu.Lock()
        delete(s.links, id)
        s.mu.Unlock()
    }()

    return link
}

func (s *PaymentLinkStore) Checkout(callerCtx context.Context, linkID string, processFn func() error) error {
    s.mu.RLock()
    link, ok := s.links[linkID]
    s.mu.RUnlock()

    if !ok {
        return ErrLinkNotFound
    }

    // Merge caller context and link expiry context.
    ctx, cancel := context.WithCancel(callerCtx)
    defer cancel()

    go func() {
        select {
        case <-link.ctx.Done():
            cancel() // link expired: abort checkout
        case <-ctx.Done():
        }
    }()

    select {
    case <-ctx.Done():
        return fmt.Errorf("%w", ErrLinkExpired)
    default:
    }

    return processFn()
}
```

**Correctness Analysis:**
- `context.WithTimeout` on the link drives expiry — no ticker or polling required.
- The goroutine merges the link-expiry context into the caller's context so `processFn` inherits cancellation.
- Expired links are automatically removed from the store when the timeout fires.

**Edge Cases:**
- Link expires between the `RLock` check and `processFn` start — the merged context catches this.
- Link reuse after expiry — `ErrLinkNotFound` is returned since the goroutine deletes it from the map.
- `processFn` ignores context — add context-aware checkpoints inside `processFn`.
- Clock skew: `time.Now()` used for `ExpiresAt` display; `context.WithTimeout` uses monotonic clock internally.

---

## Problem 24: Payout Scheduling with Priority Queue

**Problem:** Schedule payouts with priority levels (instant, same-day, standard). Process highest-priority payouts first. Thread-safe.

```go
package payout

import (
    "container/heap"
    "sync"
    "time"

    "github.com/shopspring/decimal"
)

type Priority int

const (
    PriorityInstant  Priority = 3
    PrioritySameDay  Priority = 2
    PriorityStandard Priority = 1
)

type PayoutJob struct {
    ID          string
    AmountCents int64
    Currency    string
    Priority    Priority
    CreatedAt   time.Time
    index       int // heap index
}

type payoutHeap []*PayoutJob

func (h payoutHeap) Len() int { return len(h) }
func (h payoutHeap) Less(i, j int) bool {
    if h[i].Priority != h[j].Priority {
        return h[i].Priority > h[j].Priority // higher priority first
    }
    return h[i].CreatedAt.Before(h[j].CreatedAt) // FIFO within same priority
}
func (h payoutHeap) Swap(i, j int) {
    h[i], h[j] = h[j], h[i]
    h[i].index = i
    h[j].index = j
}
func (h *payoutHeap) Push(x any) {
    n := len(*h)
    job := x.(*PayoutJob)
    job.index = n
    *h = append(*h, job)
}
func (h *payoutHeap) Pop() any {
    old := *h
    n := len(old)
    job := old[n-1]
    old[n-1] = nil
    *h = old[:n-1]
    return job
}

type PayoutQueue struct {
    mu sync.Mutex
    h  payoutHeap
}

func NewPayoutQueue() *PayoutQueue {
    q := &PayoutQueue{}
    heap.Init(&q.h)
    return q
}

func (q *PayoutQueue) Enqueue(job *PayoutJob) {
    q.mu.Lock()
    defer q.mu.Unlock()
    heap.Push(&q.h, job)
}

func (q *PayoutQueue) Dequeue() (*PayoutJob, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if q.h.Len() == 0 {
        return nil, false
    }
    return heap.Pop(&q.h).(*PayoutJob), true
}

func (q *PayoutQueue) Len() int {
    q.mu.Lock()
    defer q.mu.Unlock()
    return q.h.Len()
}

// Suppress unused import
var _ = decimal.Zero
```

**Correctness Analysis:**
- `container/heap` provides O(log n) enqueue and dequeue.
- `Less` implements two-level ordering: priority first, then FIFO by `CreatedAt`.
- Single mutex protects the heap; all `heap` operations are under the lock.

**Edge Cases:**
- Priority upgrade mid-queue — call `heap.Fix(&q.h, job.index)` after mutating `job.Priority`; requires keeping a reference.
- Starvation of standard payouts under heavy instant load — add a counter-based "aging" bump after N cycles.
- Persistence: queue is in-memory; on restart, reload from DB sorted by `(priority DESC, created_at ASC)`.
- Dead-letter: payouts failing repeatedly — move to a separate DLQ after N attempts.

---

## Problem 25: Graceful Shutdown for Payment Workers

**Problem:** Implement graceful shutdown for a payment processing worker pool. In-flight payments must complete; new payments must stop being accepted. Flush results before exit.

```go
package worker

import (
    "context"
    "log"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"

    "github.com/shopspring/decimal"
)

type Payment struct {
    ID          string
    AmountCents int64
}

type Worker struct {
    jobs    chan Payment
    wg      sync.WaitGroup
    process func(Payment) error
}

func NewWorker(bufferSize int, process func(Payment) error) *Worker {
    return &Worker{
        jobs:    make(chan Payment, bufferSize),
        process: process,
    }
}

func (w *Worker) Start(ctx context.Context, concurrency int) {
    for i := 0; i < concurrency; i++ {
        w.wg.Add(1)
        go func() {
            defer w.wg.Done()
            for job := range w.jobs {
                if err := w.process(job); err != nil {
                    log.Printf("payment %s failed: %v", job.ID, err)
                }
            }
        }()
    }
}

func (w *Worker) Submit(p Payment) bool {
    select {
    case w.jobs <- p:
        return true
    default:
        return false // back-pressure: queue full
    }
}

// Shutdown stops accepting new jobs, waits for in-flight jobs to finish,
// then waits for all goroutines to exit. Times out after timeout.
func (w *Worker) Shutdown(timeout time.Duration) {
    close(w.jobs) // signal workers: no more jobs

    done := make(chan struct{})
    go func() {
        w.wg.Wait()
        close(done)
    }()

    select {
    case <-done:
        log.Println("all workers exited cleanly")
    case <-time.After(timeout):
        log.Println("shutdown timeout: some payments may not have completed")
    }
}

// RunWithGracefulShutdown wires OS signals to the worker shutdown.
func RunWithGracefulShutdown(process func(Payment) error) {
    w := NewWorker(1000, process)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    w.Start(ctx, 10)

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh

    log.Println("shutdown signal received, draining workers...")
    w.Shutdown(30 * time.Second)
}

// Suppress unused import
var _ = decimal.Zero
```

**Correctness Analysis:**
- `close(w.jobs)` is the shutdown signal; workers range over the channel and exit naturally after draining.
- `sync.WaitGroup` tracks all goroutines; `wg.Wait()` in a separate goroutine prevents blocking on `Shutdown`.
- Non-blocking `Submit` via `select`/`default` provides back-pressure instead of blocking the caller.

**Edge Cases:**
- Shutdown during `Submit` — `Submit` panics if called after `close(w.jobs)`; use a sync flag (`atomic.Bool`) to gate submissions after shutdown is initiated.
- Graceful shutdown timeout hit — log outstanding job IDs for manual reconciliation.
- Multiple SIGTERM — `signal.Notify` only calls `Shutdown` once since it reads one value from `sigCh`.
- Persisted queue: on timeout, dump remaining buffered jobs to disk/DB before exiting.

---

## Quick Reference: Stripe/Payments Patterns in Go

| Pattern | Key Tool | Gotcha |
|---|---|---|
| Idempotency | Map + mutex or DB unique constraint | In-flight sentinel (nil value) needs cond var |
| Money precision | `shopspring/decimal` | Never use `float64` for amounts |
| Distributed lock | Redis `SET NX` + Lua release | Must use unique token per holder |
| Double-entry | DB serializable transaction | Validate balance before insert |
| Webhook security | `hmac.Equal` (constant time) | Replay window: check timestamp first |
| Rate limiting | Token bucket, lazy refill | Use Redis for multi-process |
| Exactly-once Kafka | Offset in same DB transaction | Purge `processed_offsets` table periodically |
| State machine | Event sourcing + replay | Snapshot at N events for performance |
| Audit log | SHA-256 hash chain | HMAC-sign hashes with HSM for adversarial tamper-proof |
| Graceful shutdown | `close(chan)` + `WaitGroup` | Guard `Submit` after close with atomic flag |
