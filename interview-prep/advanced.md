> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# GoForge Interview Questions — Advanced Level

40 Q&A pairs for senior/staff Go engineer interviews.

---

## Q1. Design a goroutine-safe LRU cache in Go.

**Answer:**

A goroutine-safe LRU (Least Recently Used) cache combines a doubly linked list with a hash map under a mutex. The linked list tracks access order — most recently used at the front, least recently used at the back. The map provides O(1) lookups. On every `Get`, the accessed node moves to the front. On every `Put`, if the key exists the node updates and moves front; if not, a new node is created at the front and if capacity is exceeded the tail node is evicted from both the list and the map.

The standard approach in Go is to protect the entire data structure with a `sync.RWMutex`. Use `RLock` for reads if the `Get` operation does not mutate state, but since LRU reorders on access, every `Get` is effectively a write — so a full `sync.Mutex` is simpler and correct.

For very high concurrency, a sharded LRU partitions keys across N independent caches each with its own mutex. The shard is selected via a hash of the key modulo N. This reduces lock contention dramatically in workloads with many goroutines accessing different keys simultaneously.

A production consideration is TTL support: store expiry alongside the value, check on `Get`, and lazily evict expired entries. For active expiration a background goroutine can scan periodically, but that requires care to avoid holding the lock during long scans.

```go
package lru

import (
    "container/list"
    "sync"
)

type entry struct {
    key   string
    value any
}

type Cache struct {
    cap   int
    mu    sync.Mutex
    list  *list.List
    items map[string]*list.Element
}

func New(cap int) *Cache {
    return &Cache{
        cap:   cap,
        list:  list.New(),
        items: make(map[string]*list.Element, cap),
    }
}

func (c *Cache) Get(key string) (any, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    el, ok := c.items[key]
    if !ok {
        return nil, false
    }
    c.list.MoveToFront(el)
    return el.Value.(*entry).value, true
}

func (c *Cache) Put(key string, value any) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if el, ok := c.items[key]; ok {
        el.Value.(*entry).value = value
        c.list.MoveToFront(el)
        return
    }
    if c.list.Len() == c.cap {
        tail := c.list.Back()
        c.list.Remove(tail)
        delete(c.items, tail.Value.(*entry).key)
    }
    el := c.list.PushFront(&entry{key, value})
    c.items[key] = el
}
```

**Follow-up:** How would you make this cache support generics and avoid `any` boxing?

Use a type parameter: `type Cache[K comparable, V any]`. The map becomes `map[K]*list.Element` and the entry struct `entry[K, V]`. Boxing is eliminated for non-pointer types and the compiler generates type-safe code without reflection overhead.

---

## Q2. Explain the Go memory model and happens-before relationships.

**Answer:**

The Go memory model specifies under what conditions a read of a variable in one goroutine is guaranteed to observe a write performed in another goroutine. Without these guarantees, the compiler and CPU are free to reorder memory operations for optimization.

The model defines a happens-before partial order. If operation A happens-before operation B, then A's effects are visible to B. Key guarantees include:

1. **Within a goroutine**: operations execute in source order — sequential consistency within a single goroutine.
2. **Goroutine creation**: `go f()` happens-before `f` begins.
3. **Goroutine completion**: `f` returning is not guaranteed to happen-before anything outside unless synchronized via a channel or WaitGroup.
4. **Channel send**: a send on a channel happens-before the corresponding receive from that channel completes.
5. **Channel close**: a close of a channel happens-before a receive that returns a zero value.
6. **Mutex unlock**: `Unlock` of a `sync.Mutex` happens-before any subsequent `Lock`.
7. **Once**: the `f()` passed to `sync.Once.Do` returns happens-before any `Do` call returns.

A classic data race is reading a variable set by another goroutine without synchronization. Even if the write "appears" to happen first in wall-clock time, without a happens-before edge the behavior is undefined. The Go race detector (`-race`) instruments memory accesses to detect violations at runtime.

The 2022 revision of the Go memory model added explicit machine-word-level guarantees and clarified that programs that are race-free have sequentially consistent semantics. Programs with races have no defined behavior beyond what the memory model specifies for those racy operations — they do not guarantee "torn reads" will be the only consequence; the compiler can legally produce arbitrarily incorrect output.

Practically: protect all shared mutable state with channels or sync primitives. Use `sync/atomic` for single-word state where performance is critical, understanding that atomics only guarantee atomicity for that one word, not ordering relative to other variables unless using `atomic.LoadPointer`/`StorePointer` with the appropriate memory ordering.

```go
// Classic happens-before violation — DO NOT DO THIS
var ready bool
var data int

go func() {
    data = 42    // write
    ready = true // write — no happens-before edge
}()

for !ready {} // spin — may never see data=42
fmt.Println(data)

// Correct: use a channel
ch := make(chan struct{})
go func() {
    data = 42
    close(ch) // close happens-before receive
}()
<-ch
fmt.Println(data) // guaranteed to see 42
```

**Follow-up:** Why is `sync/atomic` insufficient for publishing a struct initialization safely?

Atomics are word-sized. Publishing a pointer atomically ensures the pointer itself is atomically visible, but if the pointed-to struct was written by one goroutine without a synchronization edge, the fields of that struct may be partially visible. Use `sync.Once` or a channel to publish initialized structs safely.

---

## Q3. When should you use atomics versus mutexes?

**Answer:**

The choice between `sync/atomic` and `sync.Mutex` depends on the complexity of the critical section, the number of variables involved, and performance requirements.

Use `sync/atomic` when:
- You are operating on a **single machine word** (int32, int64, uintptr, pointer).
- The operation is a simple read, write, add, compare-and-swap, or swap.
- Latency is critical and lock overhead is measurable (nanoseconds matter, e.g., hot-path counters).
- You need to build lock-free data structures (advanced use case requiring deep expertise).

Use `sync.Mutex` when:
- The critical section spans **multiple variables** that must be consistent with each other.
- You need to execute multiple operations atomically (read-modify-write of a struct).
- You need to call other functions within the lock.
- Correctness is paramount and the atomics API does not cover your access pattern.

Performance characteristics: a mutex lock/unlock on an uncontended mutex costs ~20–40 ns on modern hardware. An atomic add costs ~5–10 ns. Under contention both degrade, but mutexes park goroutines while spinlock-based atomics burn CPU. At very high read-to-write ratios, `sync.RWMutex` is superior to a regular mutex.

A common mistake is using multiple atomics to protect logically related state:

```go
// WRONG: not atomic across both fields
var hits, misses int64
atomic.AddInt64(&hits, 1)
// Another goroutine reads hits and misses — they can be inconsistent

// CORRECT: protect related state together
type Stats struct {
    mu           sync.Mutex
    hits, misses int64
}

func (s *Stats) RecordHit() {
    s.mu.Lock()
    s.hits++
    s.mu.Unlock()
}
```

For a single counter, atomic is superior:

```go
var counter int64
atomic.AddInt64(&counter, 1)
n := atomic.LoadInt64(&counter)
```

`sync/atomic.Value` allows storing and loading any value atomically (as `any`), which is useful for publishing configuration snapshots — write once, read many times without a mutex.

**Follow-up:** What is a compare-and-swap (CAS) loop and when is it appropriate?

CAS atomically checks if a location has an expected value and only writes a new value if it matches. A CAS loop retries on failure:

```go
for {
    old := atomic.LoadInt64(&v)
    new := transform(old)
    if atomic.CompareAndSwapInt64(&v, old, new) {
        break
    }
}
```

CAS loops are appropriate for low-contention counters or pointers. Under high contention they degrade to live-lock; a mutex is more fair and predictable.

---

## Q4. What are structured concurrency patterns in Go?

**Answer:**

Structured concurrency is the discipline of ensuring that all goroutines spawned by a function terminate before that function returns, analogous to structured programming where all control flow returns through defined exit points.

In Go, the standard primitives for structured concurrency are:

**1. sync.WaitGroup** — tracks a set of goroutines and blocks until all complete. The caller controls the scope.

**2. errgroup.Group** (golang.org/x/sync/errgroup) — extends WaitGroup with error propagation and optional context cancellation. The first non-nil error cancels the context and is returned by `Wait`.

**3. Context cancellation** — all goroutines should accept a `context.Context` and respect its cancellation signal, ensuring they terminate promptly when the parent scope exits.

**4. Pipeline pattern** — a chain of goroutines connected by channels, each stage consuming from one channel and producing to another. Cancellation propagates upstream by closing the done channel or cancelling the context.

The key invariant: no goroutine should outlive the scope that launched it. This prevents goroutine leaks, which are one of the most common production issues in Go services. A leaked goroutine holds references that prevent GC and may block indefinitely.

```go
func processAll(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)

    for _, item := range items {
        item := item // capture
        g.Go(func() error {
            return process(ctx, item)
        })
    }

    return g.Wait() // blocks until all goroutines finish
}
```

For fan-out with bounded parallelism:

```go
func boundedFanOut(ctx context.Context, items []Item, concurrency int) error {
    g, ctx := errgroup.WithContext(ctx)
    sem := make(chan struct{}, concurrency)

    for _, item := range items {
        item := item
        sem <- struct{}{}
        g.Go(func() error {
            defer func() { <-sem }()
            return process(ctx, item)
        })
    }

    return g.Wait()
}
```

**Follow-up:** How do you detect goroutine leaks in production?

Use `runtime.NumGoroutine()` as a metric tracked over time. In tests, use `goleak` (github.com/uber-go/goleak) which enumerates goroutines before and after a test and fails if any unexpected ones remain. In production, pprof's goroutine profile shows stack traces of all live goroutines and their count.

---

## Q5. Implement a circuit breaker in Go.

**Answer:**

A circuit breaker prevents cascading failures by short-circuiting calls to a failing downstream when the failure rate exceeds a threshold. It has three states: **Closed** (normal operation), **Open** (fail fast without calling downstream), and **Half-Open** (probe with limited calls to see if the downstream recovered).

The state machine transitions: Closed → Open when failures reach a threshold within a window. Open → Half-Open after a timeout. Half-Open → Closed on success, or back to Open on failure.

Implementation considerations:
- Track failures and successes in a rolling time window (or count window).
- Use atomics or a mutex to protect state transitions.
- The timeout for Open→Half-Open is typically configurable (e.g., 30 seconds).
- Half-Open should allow only one or a limited number of probe requests.

```go
package breaker

import (
    "errors"
    "sync"
    "time"
)

type State int

const (
    StateClosed State = iota
    StateOpen
    StateHalfOpen
)

var ErrCircuitOpen = errors.New("circuit breaker is open")

type CircuitBreaker struct {
    mu           sync.Mutex
    state        State
    failures     int
    maxFailures  int
    resetTimeout time.Duration
    lastFailure  time.Time
    successes    int
    halfOpenMax  int
}

func New(maxFailures int, resetTimeout time.Duration) *CircuitBreaker {
    return &CircuitBreaker{
        maxFailures:  maxFailures,
        resetTimeout: resetTimeout,
        halfOpenMax:  1,
    }
}

func (cb *CircuitBreaker) Execute(fn func() error) error {
    cb.mu.Lock()
    switch cb.state {
    case StateOpen:
        if time.Since(cb.lastFailure) >= cb.resetTimeout {
            cb.state = StateHalfOpen
            cb.successes = 0
        } else {
            cb.mu.Unlock()
            return ErrCircuitOpen
        }
    case StateHalfOpen:
        if cb.successes >= cb.halfOpenMax {
            cb.mu.Unlock()
            return ErrCircuitOpen
        }
    }
    cb.mu.Unlock()

    err := fn()

    cb.mu.Lock()
    defer cb.mu.Unlock()

    if err != nil {
        cb.failures++
        cb.lastFailure = time.Now()
        if cb.state == StateHalfOpen || cb.failures >= cb.maxFailures {
            cb.state = StateOpen
            cb.failures = 0
        }
        return err
    }

    if cb.state == StateHalfOpen {
        cb.successes++
        if cb.successes >= cb.halfOpenMax {
            cb.state = StateClosed
            cb.failures = 0
        }
    } else {
        cb.failures = 0
    }
    return nil
}
```

**Follow-up:** How do you handle the circuit breaker in a distributed system where multiple instances share state?

Use a distributed store (Redis) to persist failure counts and state with TTL-based expiry for the rolling window. Use Lua scripts or Redis transactions (MULTI/EXEC) to atomically read-modify-write the counters and state. Each service instance reads the shared state on every call and updates it atomically after the call completes.

---

## Q6. How does reflection work internally in Go?

**Answer:**

Go's reflection (`reflect` package) allows programs to inspect and manipulate types and values at runtime. Internally, every Go value consists of two machine words: a pointer to type information (`*rtype`) and a data pointer (or the data itself if it fits in a word). The `reflect.Type` and `reflect.Value` types expose this information.

The `*rtype` struct (defined in `reflect/type.go` and mirrored in the runtime) contains: the kind (int, string, struct, etc.), size, alignment, pointer bitmap (for GC), method sets (for interface dispatch and reflection calls), and for structs, the list of fields with their names, types, offsets, and tags.

When you call `reflect.TypeOf(x)`, Go extracts the type pointer from the interface header. `reflect.ValueOf(x)` wraps the type pointer and data pointer into a `reflect.Value`. Reflection values heap-escape in almost all cases, which is why reflection is expensive: it causes allocations that inline code avoids.

Method calls via reflection (`Value.Method(i).Call(args)`) are expensive because they must:
1. Look up the method in the type's method table.
2. Build a `[]reflect.Value` slice for arguments.
3. Convert each argument to the correct type (potentially allocating).
4. Call through a function pointer with a general calling convention.
5. Wrap return values in `reflect.Value`.

Struct tag parsing (`reflect.StructTag.Lookup`) is O(n) string scanning. Encoding libraries like `encoding/json` cache parsed struct metadata in a sync.Map to avoid repeated reflection on the same type.

```go
import "reflect"

type Point struct {
    X int    `json:"x"`
    Y int    `json:"y"`
}

p := Point{1, 2}
t := reflect.TypeOf(p)  // *rtype for Point
v := reflect.ValueOf(p) // reflect.Value wrapping p

for i := 0; i < t.NumField(); i++ {
    field := t.Field(i)
    tag := field.Tag.Get("json")
    val := v.Field(i).Interface()
    fmt.Printf("field %s (json:%s) = %v\n", field.Name, tag, val)
}
```

**Follow-up:** What is the performance cost of reflection compared to direct access?

Reflection field access is typically 10–100x slower than direct struct field access because of interface boxing, allocations, and indirect dispatch. For hot paths (marshaling millions of records per second), code generation (like `easyjson` or `protoc-gen-go`) or generics-based approaches eliminate reflection entirely.

---

## Q7. Design a distributed rate limiter in Go.

**Answer:**

A distributed rate limiter controls the request rate across multiple service instances sharing a backend, most commonly Redis. The two primary algorithms are **token bucket** and **sliding window**.

**Token bucket with Redis**: A Lua script atomically checks and decrements a key representing available tokens. The key has a TTL that resets the bucket. Lua executes atomically in Redis — no TOCTOU race.

**Sliding window log**: Store each request timestamp in a Redis sorted set keyed by client ID. On each request: remove members older than `now - window`, count remaining members, reject if count >= limit, otherwise add the current timestamp. This is precise but memory-intensive for high-volume clients.

**Sliding window counter (hybrid)**: Approximate using two counters — current window and previous window — weighted by how far into the current window we are. Memory-efficient and approximately correct.

```go
// Token bucket via Redis Lua script
const luaScript = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local count = redis.call("GET", key)
if count and tonumber(count) >= limit then
    return 0
end
redis.call("INCR", key)
redis.call("EXPIRE", key, window)
return 1
`

type RateLimiter struct {
    client *redis.Client
    sha    string
    limit  int
    window int // seconds
}

func NewRateLimiter(client *redis.Client, limit, windowSecs int) (*RateLimiter, error) {
    sha, err := client.ScriptLoad(context.Background(), luaScript).Result()
    if err != nil {
        return nil, err
    }
    return &RateLimiter{client: client, sha: sha, limit: limit, window: windowSecs}, nil
}

func (r *RateLimiter) Allow(ctx context.Context, key string) (bool, error) {
    result, err := r.client.EvalSha(ctx, r.sha, []string{key},
        r.limit, r.window, time.Now().Unix()).Int()
    if err != nil {
        // Fail open or fail closed depending on requirements
        return true, err
    }
    return result == 1, nil
}
```

Production considerations: handle Redis unavailability gracefully (fail open with a flag, or use a local in-memory fallback with sync/atomic); add jitter to avoid thundering herd on window resets; use Redis Cluster with slot-consistent key naming; expose remaining quota in response headers (X-RateLimit-Remaining).

**Follow-up:** How do you implement a per-user rate limiter that handles bursting?

Use the token bucket algorithm: each user has a bucket refilling at `rate` tokens/second with a maximum capacity of `burst`. On each request, calculate tokens accumulated since last check (`elapsed * rate`), cap at `burst`, subtract 1 if available. Implement this atomically in Lua with the last-request timestamp and current tokens stored in Redis as a hash.

---

## Q8. When and how should you use the unsafe package?

**Answer:**

The `unsafe` package bypasses Go's type system and memory safety guarantees. It should be used only when: (1) performance is critical and profiling proves the safe approach is insufficient, (2) you need zero-copy conversion between types with identical memory layout, or (3) you are interfacing with C via cgo and must pass pointers.

Key `unsafe` operations:
- `unsafe.Pointer` — a generic pointer that can be converted to/from any pointer type and to `uintptr`. The GC tracks `unsafe.Pointer` but not `uintptr`.
- `unsafe.Sizeof`, `unsafe.Offsetof`, `unsafe.Alignof` — compile-time constants for layout information.
- `unsafe.SliceData`, `unsafe.StringData` (Go 1.17+) — safe ways to extract underlying array pointers from slices and strings.

The most common legitimate use is zero-copy string↔[]byte conversion:

```go
// Safe conversion added in Go 1.20 — prefer this
s := "hello"
b := unsafe.Slice(unsafe.StringData(s), len(s))
// b shares memory with s — do not modify b

// Converting []byte to string without copy
func bytesToString(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

Critical rules for `unsafe.Pointer`:
1. Conversion from `unsafe.Pointer` to `uintptr` must be used immediately; storing a `uintptr` is unsafe because GC can move objects (though Go's current GC does not move, this may change).
2. Pointer arithmetic via `uintptr` must be in a single expression: `(*int)(unsafe.Pointer(uintptr(p) + offset))`.
3. The `go vet` tool and `go build -gcflags="-d=checkptr"` detect some unsafe misuse.

Using `unsafe` to access unexported struct fields across packages is a fragile anti-pattern — struct layout can change across Go versions.

**Follow-up:** What is the difference between `unsafe.Pointer` and `uintptr`?

`unsafe.Pointer` is a real pointer — the GC knows about it and will update it if objects move. `uintptr` is just an integer that holds an address. The GC does not trace `uintptr` values, so if you store an address in a `uintptr` variable, the pointed-to object can be collected (or moved in a future compacting GC). Never store a `uintptr` across function calls or GC-safe points if you intend to dereference it.

---

## Q9. How does the Go linker perform dead code elimination?

**Answer:**

The Go linker (cmd/link) performs whole-program dead code elimination, also called tree shaking. It starts from the program's entry point (`main.main` and any `init` functions) and transitively marks all reachable symbols — functions, methods, global variables. Unreachable symbols are excluded from the final binary.

Go's approach is more aggressive than many compiled languages because it has full visibility at link time: all packages are compiled to object files and linked together, giving the linker a complete call graph.

Key mechanisms:

1. **Reachability analysis**: The linker builds a call graph from the entry points. Functions referenced only through interfaces are tricky — since the concrete type is not known statically, the linker must be conservative and include any method that satisfies an interface if any value of that interface type exists in the program. This is why large interface implementations can pull in more code than expected.

2. **Inlining interplay**: The compiler inlines small functions before the linker stage. Inlined functions may not appear as separate symbols, effectively eliminating their call overhead. The inliner is controlled by a cost budget.

3. **Init graph**: Package `init` functions are included if the package is imported, which is why importing a package solely for side effects (`import _ "pkg"`) includes all its init code.

4. **Reflection**: Types accessed via reflection cannot be dead-code eliminated because the linker cannot statically determine which types will be reflected on. This is a significant source of binary bloat in reflection-heavy programs.

```bash
# See what's included in the binary
go build -v ./...

# Print linker symbol table
go tool nm ./myapp | grep -i "mypackage"

# Build with linker flags to strip debug info (reduces size, not DCE)
go build -ldflags="-s -w" ./...

# Use trimpath to remove source paths from binary
go build -trimpath ./...
```

**Follow-up:** How do build tags affect dead code elimination?

Build tags (`//go:build`) cause entire files to be excluded from compilation before the linker stage — they are compile-time, not link-time. This is more efficient than linker-level DCE for feature flags because the excluded code never enters the object files at all. The `//go:noinline` and `//go:linkname` directives also affect linker behavior.

---

## Q10. Explain sync.Pool internals and appropriate usage.

**Answer:**

`sync.Pool` is a cache of temporary objects that can be reused across goroutines to reduce allocator pressure and GC load. Its internal design is carefully tuned for multi-core performance:

**Internal structure (Go 1.13+):**
- Each P (OS thread context in the runtime scheduler) gets a private `poolLocal` struct containing: a `private` field (single object, accessed without locks) and a `shared` double-ended queue (a `poolChain`) accessible by other Ps.
- `Get` first tries the local P's `private` field (no synchronization needed), then the local P's `shared` queue, then steals from other Ps' shared queues, then calls the `New` function.
- `Put` stores to the local P's `private` if empty, otherwise pushes to the local shared queue.
- At each GC cycle, the pool is completely drained — objects are not kept across GC. This is by design: Pool is for reducing allocator pressure, not for object caching with retention guarantees.

```go
var bufPool = sync.Pool{
    New: func() any {
        return &bytes.Buffer{}
    },
}

func processRequest(data []byte) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()

    buf.Write(data)
    // ... transform ...
    return buf.String()
}
```

**When to use:**
- Short-lived, frequently allocated objects (byte buffers, scratch slices, encoders).
- When profiling (`go tool pprof`) shows significant allocation pressure from a specific type.
- Objects whose zero value is valid (or a `New` function initializes them correctly).

**When NOT to use:**
- Objects with cleanup requirements (file handles, connections) — GC draining silently discards them.
- Objects that must persist across GC cycles — use an explicit free-list or channel-based pool.
- Premature optimization — add Pool only after profiling proves allocation is the bottleneck.

**Follow-up:** Why does sync.Pool drain on GC, and what was the change in Go 1.13?

Before Go 1.13, Pool was fully drained on every GC cycle, causing the "pool thrashing" problem where GC pressure increased allocation pressure which increased GC frequency. Go 1.13 introduced a two-generation scheme: objects are moved to a "victim cache" on the first GC cycle and only actually discarded on the second, smoothing out the drain effect.

---

## Q11. How does singleflight prevent request duplication?

**Answer:**

`golang.org/x/sync/singleflight` solves the thundering herd problem: when many goroutines simultaneously request the same expensive resource (cache miss, database query, external API), only one request is sent and all waiters share the result.

The implementation uses a map protected by a mutex. The map keys are request identifiers (strings). Each entry is a `call` struct containing a `sync.WaitGroup`, the result, and the error. When `Do(key, fn)` is called:
1. Lock the mutex, check if a `call` for this key exists.
2. If yes: unlock, add to the WaitGroup, wait for completion, return the shared result.
3. If no: create a new `call`, add it to the map, unlock, execute `fn()`, store results, broadcast to all waiters via the WaitGroup, remove from map.

This means N concurrent requests for the same key result in exactly 1 execution of `fn`, with all N callers receiving the same response.

```go
import "golang.org/x/sync/singleflight"

type UserService struct {
    db    *sql.DB
    cache *lru.Cache
    group singleflight.Group
}

func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
    if u, ok := s.cache.Get(id); ok {
        return u.(*User), nil
    }

    v, err, shared := s.group.Do(id, func() (any, error) {
        u, err := s.db.QueryUser(ctx, id)
        if err != nil {
            return nil, err
        }
        s.cache.Put(id, u)
        return u, nil
    })

    if err != nil {
        return nil, err
    }

    _ = shared // true if result was shared with other callers
    return v.(*User), nil
}
```

**DoChan** returns a channel instead of blocking, allowing the caller to also select on a context cancellation:

```go
ch := s.group.DoChan(id, fn)
select {
case res := <-ch:
    return res.Val.(*User), res.Err
case <-ctx.Done():
    return nil, ctx.Err()
}
```

**Follow-up:** What is the difference between `Do` and `DoChan`, and when does `Forget` matter?

`DoChan` is non-blocking, returning a channel, suitable when you need to cancel via context. `Forget(key)` removes the in-flight call from the map, causing the next `Do` to start a new call rather than joining the existing one. Use `Forget` when the in-flight request is known to be using stale data (e.g., the backing store was just updated) or when errors should not be shared with subsequent callers.

---

## Q12. What is the performance cost of interface dispatch?

**Answer:**

Interface dispatch in Go involves an indirect function call through a method table (itab). Every interface value is two words: a pointer to the itab (type + method pointers) and a data pointer. Calling a method on an interface requires:
1. Load the itab pointer.
2. Load the method function pointer from the itab at a computed offset.
3. Indirect call through that pointer.

This costs approximately 1–3 ns on a modern CPU, compared to a direct function call at ~0.5 ns. The real cost is not the pointer dereference but the **branch misprediction** at the indirect call site, which defeats the branch predictor and flushes the CPU pipeline. For hot inner loops this matters.

The secondary cost is **devirtualization failure**: the compiler cannot inline indirect calls through interfaces. A direct call to a concrete type's method can be inlined, eliminating the call overhead entirely and enabling further optimizations (escape analysis, constant folding). Interface calls block these optimizations.

The tertiary cost is **heap allocation for interface boxing**: storing a value type (int, small struct) in an interface causes heap allocation if the value is larger than a pointer or if the compiler cannot prove it does not escape. This is the dominant cost in many benchmarks.

```go
type Transformer interface {
    Transform([]byte) []byte
}

// This prevents inlining and may cause allocation:
func processAll(t Transformer, data [][]byte) {
    for _, d := range data {
        d = t.Transform(d) // indirect call, no inlining
    }
}

// This allows inlining if ConcreteTransformer.Transform is small:
func processAllConcrete(t *ConcreteTransformer, data [][]byte) {
    for _, d := range data {
        d = t.Transform(d) // may be inlined
    }
}
```

Benchmark to measure dispatch cost:

```go
func BenchmarkInterface(b *testing.B) {
    var t Transformer = &ConcreteTransformer{}
    data := []byte("hello")
    for i := 0; i < b.N; i++ {
        _ = t.Transform(data)
    }
}
```

**Follow-up:** How does the Go compiler optimize interface calls?

The compiler can devirtualize interface calls when it can prove at compile time that a particular interface variable holds exactly one concrete type (monomorphization of the call site). This is rare in general code but happens in simple cases. Profile-guided optimization (PGO), introduced in Go 1.20, uses runtime profiles to devirtualize hot interface calls, enabling inlining of the callee.

---

## Q13. How was generics achieved before Go 1.18?

**Answer:**

Before Go 1.18 introduced native generics, Go developers used several techniques to achieve type parameterization:

**1. Code generation**: Tools like `go generate` with text/template or specialized generators (`genny`, `gengen`) emitted concrete typed implementations from templates. A developer would write a generic algorithm in a template and generate versions for `int`, `string`, `float64`, etc. The `//go:generate` directive annotated the source file.

```go
// gen.go — template (not compiled directly)
// Type: TYPE

func SortTYPE(s []TYPE) {
    sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
}

// Generated: sort_int.go
func SortInt(s []int) {
    sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
}
```

**2. Interface{} (any) with type assertions**: Accept `interface{}` parameters and type-assert at runtime. Correct but sacrifices compile-time safety, causes boxing allocations for scalar types, and is verbose.

```go
func Map(slice interface{}, fn interface{}) interface{} {
    // Use reflection to iterate and apply fn
    sv := reflect.ValueOf(slice)
    fv := reflect.ValueOf(fn)
    result := reflect.MakeSlice(sv.Type(), sv.Len(), sv.Len())
    for i := 0; i < sv.Len(); i++ {
        result.Index(i).Set(fv.Call([]reflect.Value{sv.Index(i)})[0])
    }
    return result.Interface()
}
```

**3. Reflection-based implementation**: Libraries like `mapstructure` and early versions of ORM libraries used `reflect` to write generic algorithms. Reflection is ~10–100x slower than direct code but correct.

**4. Interface-based polymorphism**: Define a narrow interface and write algorithms against it. For example, `sort.Interface` (Len, Less, Swap) lets sort work on any collection — this is genuine Go idiom, not a workaround.

**5. Concrete instantiation per package**: Some projects simply duplicated code per type, accepting the maintenance burden in exchange for performance and type safety.

**Follow-up:** How do Go generics differ from C++ templates in implementation?

Go uses a hybrid strategy called GCShape stenciling (dictionary passing). Types with the same GC shape (same size, same pointer bitmap) share a single instantiation of a generic function, with a dictionary passed as a hidden parameter to handle type-specific operations (method calls, conversions). C++ templates generate completely separate instantiations per type, producing larger binaries but enabling more aggressive optimization per instantiation.

---

## Q14. Implement a cancellable pipeline in Go.

**Answer:**

A Go pipeline chains goroutines through channels, each stage reading from an input channel and writing to an output channel. With context cancellation, every stage must respect `ctx.Done()` to terminate cleanly when the pipeline is cancelled.

Design principles:
- Each stage goroutine must close its output channel when it finishes (signals downstream).
- Each stage must select on both the input channel and `ctx.Done()`.
- The source stage should also respect cancellation.
- Use `errgroup` to collect errors from all stages and wait for all goroutines to finish.

```go
package pipeline

import (
    "context"
    "golang.org/x/sync/errgroup"
)

// Source generates integers
func source(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case out <- n:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// Square squares each integer
func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            select {
            case n, ok := <-in:
                if !ok {
                    return
                }
                select {
                case out <- n * n:
                case <-ctx.Done():
                    return
                }
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// Fan-out to N workers, fan-in results
func fanOutFanIn(ctx context.Context, in <-chan int, workers int) <-chan int {
    g, ctx := errgroup.WithContext(ctx)
    out := make(chan int, workers)

    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for {
                select {
                case n, ok := <-in:
                    if !ok {
                        return nil
                    }
                    select {
                    case out <- n * n:
                    case <-ctx.Done():
                        return ctx.Err()
                    }
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
        })
    }

    go func() {
        g.Wait()
        close(out)
    }()

    return out
}

// Usage
func Run(ctx context.Context) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    c1 := source(ctx, 1, 2, 3, 4, 5)
    c2 := square(ctx, c1)
    for n := range c2 {
        _ = n
    }
}
```

**Follow-up:** How do you handle backpressure in a pipeline?

Use buffered channels between stages — the buffer absorbs bursts. When the buffer fills, the producer blocks, naturally applying backpressure upstream. Size buffers based on acceptable latency vs. throughput tradeoff. For bounded work queues, use a semaphore channel (`make(chan struct{}, N)`) to limit the number of goroutines or in-flight items.

---

## Q15. Implement a distributed lock using Redis in Go.

**Answer:**

The standard algorithm for a distributed lock in Redis is **Redlock** for multi-node setups, or simpler SET NX EX for single-node. The single-node approach uses `SET key token NX EX ttl` — atomic, sets only if not exists, with TTL for automatic expiry on crash.

The token (random value) is critical: it ensures only the lock holder can release the lock. Without it, a slow process might release another process's lock after its TTL expired.

```go
package distlock

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "errors"
    "time"

    "github.com/redis/go-redis/v9"
)

var ErrLockNotAcquired = errors.New("lock not acquired")
var ErrLockNotHeld = errors.New("lock not held by this token")

const unlockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end`

type Lock struct {
    client *redis.Client
    key    string
    token  string
    ttl    time.Duration
}

func Acquire(ctx context.Context, client *redis.Client, key string, ttl time.Duration) (*Lock, error) {
    token := make([]byte, 16)
    if _, err := rand.Read(token); err != nil {
        return nil, err
    }
    tokenStr := hex.EncodeToString(token)

    ok, err := client.SetNX(ctx, key, tokenStr, ttl).Result()
    if err != nil {
        return nil, err
    }
    if !ok {
        return nil, ErrLockNotAcquired
    }
    return &Lock{client: client, key: key, token: tokenStr, ttl: ttl}, nil
}

func (l *Lock) Release(ctx context.Context) error {
    result, err := l.client.Eval(ctx, unlockScript, []string{l.key}, l.token).Int()
    if err != nil {
        return err
    }
    if result == 0 {
        return ErrLockNotHeld
    }
    return nil
}

func (l *Lock) Extend(ctx context.Context) error {
    extendScript := `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    else
        return 0
    end`
    ms := int(l.ttl.Milliseconds())
    result, err := l.client.Eval(ctx, extendScript, []string{l.key}, l.token, ms).Int()
    if err != nil {
        return err
    }
    if result == 0 {
        return ErrLockNotHeld
    }
    return nil
}
```

Production considerations: implement lock extension (heartbeat goroutine calls `Extend` at `ttl/2` intervals); handle Redis failures gracefully (fail open or closed based on consistency requirements); use Redlock across 2N+1 Redis nodes for high availability without a single point of failure.

**Follow-up:** What are the failure modes of a Redis-based distributed lock?

(1) TTL expires while the lock holder is still in the critical section (long GC pause, slow disk I/O) — the lock owner believes it holds the lock but a new holder has been granted it. Mitigation: fencing tokens (monotonically increasing IDs) passed to resources that reject stale tokens. (2) Redis replica failover: if the primary crashes after SET NX but before replication, the replica promoted to primary has no record of the lock — two processes believe they hold it. Redlock addresses this with majority quorum across nodes.

---

## Q16. Describe a production profiling and optimization workflow in Go.

**Answer:**

A systematic Go optimization workflow follows the scientific method: measure, hypothesize, change, verify.

**Step 1 — Establish a baseline**: Run existing benchmarks or write targeted benchmarks for the suspected hot path. Use `go test -bench=. -benchmem -count=5` to get stable numbers. Record allocations/op and ns/op.

**Step 2 — CPU profiling**: Enable pprof in production via `net/http/pprof` at a low-traffic path, or use `runtime/pprof` in benchmarks. Collect a 30-second CPU profile under representative load. Analyze with `go tool pprof -http=:8080 cpu.prof`. Look for the hottest frames — functions where the CPU spends the most time.

**Step 3 — Memory profiling**: Collect a heap profile. Differentiate between `alloc_objects` (total allocations, GC pressure) and `inuse_objects` (live objects, memory leak). High `alloc_objects` for a type suggests pool reuse opportunity.

**Step 4 — Trace analysis**: `go tool trace` shows goroutine scheduling, GC pauses, and syscall blocking. Use `GOTRACE=runtime:5 go test` for fine-grained scheduler events. Identify STW (stop-the-world) pause durations and goroutine blocking patterns.

**Step 5 — Targeted fixes** (in order of impact):
- Reduce allocations: reuse buffers (sync.Pool), avoid string conversions, pre-size slices/maps.
- Reduce GC pressure: fewer short-lived allocations; tune `GOGC` and `GOMEMLIMIT`.
- Reduce lock contention: profile with mutex profiling (`runtime.SetMutexProfileFraction(1)`).
- Reduce syscalls: batch I/O, use `bufio`, tune TCP buffer sizes.
- Reduce work: algorithmic improvements, better data structures, caching.

```go
// Enable all pprof endpoints in a service
import _ "net/http/pprof"
// Then: go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

// Benchmark with profiling
func BenchmarkHotPath(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        result := HotPath(input)
        _ = result
    }
}
// go test -bench=BenchmarkHotPath -benchmem -cpuprofile=cpu.prof -memprofile=mem.prof
```

**Step 6 — Verify**: Re-run benchmarks. Confirm improvement. Confirm no regression in correctness (full test suite). Check that the optimization is measurable in production metrics.

**Follow-up:** How do you use `GOGC` and `GOMEMLIMIT` together?

`GOGC=N` triggers GC when heap grows N% above the live heap size. Lower values = more frequent GC = less memory but more CPU. `GOMEMLIMIT` (Go 1.19+) sets a hard memory limit — Go will run GC more aggressively to stay below it. Use `GOMEMLIMIT` to cap memory in containerized environments and `GOGC=off` + `GOMEMLIMIT` together for "GC only when approaching the limit" strategy, which can dramatically reduce GC CPU overhead for services with ample memory headroom.

---

## Q17. How does HTTP/2 multiplexing work with Go's net/http?

**Answer:**

HTTP/2 multiplexes multiple request/response streams over a single TCP connection, eliminating HTTP/1.1's head-of-line blocking at the application layer. Go's `net/http` package supports HTTP/2 transparently via the `golang.org/x/net/http2` package, which is bundled with the standard library.

When a Go HTTPS server starts, it advertises HTTP/2 support via the ALPN TLS extension. The client and server negotiate HTTP/2 during the TLS handshake. Go's `http.Server` automatically enables HTTP/2 when `ListenAndServeTLS` is called (since Go 1.6).

Internally, each HTTP/2 stream has a stream ID (odd for client-initiated). The `http2.ClientConn` multiplexes requests by writing HEADERS and DATA frames interleaved on the same connection. A `sync.Mutex` protects frame writing; reading runs in a dedicated goroutine that demultiplexes frames to the correct stream.

Flow control operates at two levels: per-stream (prevents a single stream from starving others) and per-connection (limits total bandwidth). Go's implementation respects both the server's and client's advertised window sizes. The WINDOW_UPDATE frame increments flow control windows after data is consumed.

Server Push is supported via `http.Pusher` interface — if the `ResponseWriter` implements `http.Pusher`, the handler can push sub-resources.

```go
// HTTP/2 server — automatic with TLS
server := &http.Server{
    Addr:    ":8443",
    Handler: mux,
    TLSConfig: &tls.Config{
        MinVersion: tls.VersionTLS12,
    },
}

// Force HTTP/2 for testing without TLS (h2c)
import "golang.org/x/net/http2/h2c"
h2s := &http2.Server{}
handler := h2c.NewHandler(mux, h2s)
server := &http.Server{Addr: ":8080", Handler: handler}

// HTTP/2 client — automatic for https:// URLs
client := &http.Client{
    Transport: &http.Transport{
        TLSClientConfig: &tls.Config{},
        // ForceAttemptHTTP2 true by default for https
    },
}

// Verify HTTP/2 was used
resp, _ := client.Get("https://example.com")
fmt.Println(resp.Proto) // "HTTP/2.0"
```

**Follow-up:** How do you tune Go's HTTP/2 connection pooling for high-throughput gRPC or API clients?

By default, Go's HTTP/2 client reuses one connection per host (per TLS identity). For high-concurrency clients, this single connection can become a bottleneck due to flow control and CPU serialization of frame encoding. Options: (1) Configure `MaxConnsPerHost` in the transport to create multiple HTTP/2 connections (unusual but valid). (2) Use gRPC's client-side load balancing with multiple target addresses. (3) Tune `http2.Transport` settings: `MaxHeaderListSize`, `ReadIdleTimeout`, `PingTimeout` for connection health detection.

---

## Q18. What makes a Go API idiomatic?

**Answer:**

Idiomatic Go API design reflects the language's philosophy: simplicity, explicitness, and composability. Key principles:

**1. Accept interfaces, return structs.** Parameters accepting narrow interfaces are more composable (e.g., accept `io.Reader` not `*os.File`). Return concrete types so callers can access all methods without intermediate assignments.

**2. Error handling is explicit.** Return `error` as the last return value. Never panic in library code except for programmer errors (invariant violations). Provide sentinel errors (`var ErrNotFound = errors.New(...)`) and error types for structured error information.

**3. Context propagation.** Accept `context.Context` as the first parameter of functions that perform I/O, may block, or should support cancellation. Never store context in a struct.

**4. Functional options for complex constructors.** Avoid constructor explosion:

```go
type ServerOption func(*serverConfig)

func WithTimeout(d time.Duration) ServerOption {
    return func(c *serverConfig) { c.timeout = d }
}

func NewServer(addr string, opts ...ServerOption) *Server {
    cfg := defaultConfig()
    for _, o := range opts {
        o(cfg)
    }
    return &Server{addr: addr, cfg: cfg}
}
```

**5. Zero value is useful.** Design structs so the zero value is a valid, usable state (like `sync.Mutex`, `bytes.Buffer`). This eliminates the need for constructors for simple types.

**6. Small interfaces.** The standard library's `io.Reader` (1 method), `io.Writer` (1 method), `io.Closer` (1 method) are templates. Prefer composing small interfaces over defining large ones.

**7. Naming conventions.** Exported names are self-documenting (`http.Get` not `http.HTTPGetRequest`). Avoid stuttering (`user.UserID` → `user.ID`). Methods on a type are called on the type name so context is implicit.

**8. Errors over panics.** Only use `panic` for unrecoverable programmer errors; recover from panics only at package boundaries to convert to errors.

```go
// Idiomatic: narrow interface, context first, error last
func CopyWithContext(ctx context.Context, dst io.Writer, src io.Reader) (int64, error)

// NOT idiomatic: concrete types, no context, panic
func CopyFiles(dst *os.File, src *os.File) int64 // panics on error
```

**Follow-up:** When is it appropriate to use a Builder pattern vs. functional options?

Builder pattern is appropriate when construction involves multiple mandatory sequential steps that must happen in order and each step may return an error. Functional options are better when options are truly independent, have sensible defaults, and the set of options evolves over time without breaking existing callers.

---

## Q19. How do you achieve zero-downtime deployments with Go services?

**Answer:**

Zero-downtime deployment (also called rolling or blue-green deployment) requires the service to handle the following transition gracefully: new code starts receiving traffic while old code still serves requests, both versions may be active simultaneously briefly, and no in-flight requests are dropped.

**1. Graceful shutdown.** When SIGTERM is received (from orchestration system: Kubernetes, systemd), the service should: (a) stop accepting new connections, (b) wait for in-flight requests to complete, (c) close downstream connections, (d) exit. Go's `http.Server.Shutdown(ctx)` does exactly this.

```go
server := &http.Server{Addr: ":8080", Handler: mux}

// Start server
go func() {
    if err := server.ListenAndServe(); err != http.ErrServerClosed {
        log.Fatal(err)
    }
}()

// Wait for SIGTERM or SIGINT
quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
<-quit

// Graceful shutdown with a deadline
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := server.Shutdown(ctx); err != nil {
    log.Printf("forced shutdown: %v", err)
}
```

**2. Health checks.** Expose `/healthz` (liveness) and `/readyz` (readiness) endpoints. Kubernetes uses readiness to control traffic routing — set readiness to false immediately on SIGTERM receipt, before initiating shutdown, to ensure the load balancer stops sending new requests.

**3. Database migrations.** Run backward-compatible migrations before deploying new code. New code must handle both old and new schemas. Use expand-contract migrations: add nullable column (expand), deploy new code that writes both, backfill, remove old column (contract).

**4. Long-running requests.** Set a maximum request duration and enforce it via context timeout. Requests that take longer than the shutdown window are forcibly cancelled. Communicate this limit to clients via `Timeout` headers or documentation.

**5. Connection draining in Kubernetes.** Add a `preStop` hook sleep (5–10s) to account for iptables rule propagation delay — Kubernetes may still route traffic to a terminating pod for a few seconds after the pod enters Terminating state.

**Follow-up:** How do you handle background jobs (cron, worker goroutines) during graceful shutdown?

Track all background goroutines with a `sync.WaitGroup`. On shutdown signal, cancel the root context (which all background goroutines respect), then `wg.Wait()` with a timeout. For jobs that cannot be interrupted (e.g., a database transaction in progress), use a separate shutdown timeout budget. For distributed job queues, mark the job as "in progress" with a heartbeat — if the heartbeat stops, another worker can claim it.

---

## Q20. How do you handle errors at scale in a Go service?

**Answer:**

Error handling at scale requires: structured errors with context, consistent propagation, centralized logging, and observability through metrics.

**1. Structured errors with wrapping.** Use `fmt.Errorf("%w", err)` to wrap errors preserving the chain. Define custom error types for categories that callers may need to distinguish:

```go
type NotFoundError struct {
    Resource string
    ID       string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %s not found", e.Resource, e.ID)
}

// Wrap with context
func (s *Service) GetOrder(ctx context.Context, id string) (*Order, error) {
    o, err := s.db.FindOrder(ctx, id)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, &NotFoundError{Resource: "order", ID: id}
        }
        return nil, fmt.Errorf("getOrder %s: %w", id, err)
    }
    return o, nil
}
```

**2. Error classification at boundaries.** At the HTTP/gRPC layer, classify errors into response codes. Use `errors.As` to unwrap custom types:

```go
func toHTTPStatus(err error) int {
    var nfe *NotFoundError
    if errors.As(err, &nfe) {
        return http.StatusNotFound
    }
    var ve *ValidationError
    if errors.As(err, &ve) {
        return http.StatusBadRequest
    }
    return http.StatusInternalServerError
}
```

**3. Centralized error middleware.** In HTTP servers, a middleware logs the full error chain, extracts structured fields, records a metric, and sends a sanitized response to the client. Internal error details never leak to clients.

**4. Error metrics.** Increment a counter with labels `{service, operation, error_type}`. Alert on elevated error rates. Do not log every error at ERROR level if the rate is high — prefer metrics with sampling of logs.

**5. Sentinel errors and errors.Is.** Use `errors.Is` for comparing to sentinel errors through the wrapping chain. Never use `==` to compare wrapped errors.

**6. Panic recovery.** In goroutines serving requests, recover from panics at the outermost handler and convert them to 500 errors with a stack trace logged internally:

```go
defer func() {
    if r := recover(); r != nil {
        log.Error("panic recovered", "error", r, "stack", debug.Stack())
        http.Error(w, "internal error", http.StatusInternalServerError)
    }
}()
```

**Follow-up:** How do you prevent error string duplication when wrapping through multiple layers?

Each layer adds only the context it owns, not context already present in the wrapped error. Use short, lowercase operation names without punctuation: `"getUser: fetchFromDB: query: ..."`. The error chain reads like a call stack. Avoid wrapping with the same message as the callee. Use `%w` consistently so `errors.Is` and `errors.As` work through the chain.

---

## Q21. Explain how Go's scheduler implements work stealing.

**Answer:**

Go's M:N scheduler maps M goroutines onto N OS threads (called M threads) managed by P logical processors. Work stealing is the mechanism by which an idle P steals goroutines from busy Ps to improve CPU utilization.

Each P has a local run queue (a circular buffer of ~256 goroutines). Newly created goroutines preferentially go onto the creating P's local queue. When a P's local queue is empty, it tries to steal half the goroutines from a randomly chosen other P's run queue. If no goroutines are found, it checks the global run queue, then polls network I/O via the netpoller.

Work stealing is implemented in `runtime/proc.go` in the `findRunnable` function. The steal operation is lock-free using CAS on the queue's head and tail indices. The randomization of the steal target ensures load balances without a central coordinator.

The scheduler runs in the context of M (OS threads). GOMAXPROCS sets the number of Ps (default: number of CPU cores). When a goroutine blocks on a syscall, the M is detached from its P (which is handed to another M or an idle M is created), so the P can continue running other goroutines.

```go
// Observe scheduler behavior
import "runtime"

func main() {
    runtime.GOMAXPROCS(4) // 4 Ps, 4 logical processors

    // GODEBUG=schedtrace=1000 ./myapp  — prints scheduler state every 1000ms
    // Output: SCHED 1000ms: gomaxprocs=4 idleprocs=1 threads=5 ...
}
```

**Follow-up:** What is a goroutine preemption and when was it improved?

Before Go 1.14, goroutines were cooperatively preempted — they only yielded at function call sites. A tight loop with no function calls could hold a P indefinitely, starving other goroutines. Go 1.14 introduced **asynchronous preemption** via signals (SIGURG on Unix): the runtime sends a signal to the OS thread, the signal handler marks the goroutine as preemptible, and the next safe point causes a goroutine switch. This means any goroutine can be preempted within ~10ms.

---

## Q22. How does Go's garbage collector work, and how do you tune it?

**Answer:**

Go uses a **tri-color concurrent mark-and-sweep** GC that runs mostly concurrently with the application. The three phases are:

1. **Mark setup (STW)**: Short stop-the-world to enable write barriers and take a consistent view of root objects (goroutine stacks, globals).
2. **Concurrent mark**: GC goroutines run alongside application goroutines, tracing the object graph. Write barriers (on pointer writes) maintain correctness — any pointer write during marking is recorded so the GC does not miss newly created live objects.
3. **Mark termination (STW)**: Short stop-the-world to finalize marking, disable write barriers, and compute the next GC trigger.
4. **Concurrent sweep**: Objects identified as unreachable are returned to the memory allocator. Sweep runs lazily as allocations are made.

The GC trigger is controlled by `GOGC` (default 100 = trigger when heap doubles). `GOMEMLIMIT` (Go 1.19) adds a soft memory cap, causing more aggressive GC before the limit is hit.

Tuning strategies:
- **Reduce allocation rate**: The single biggest lever. Fewer allocations = less GC work = lower latency.
- **`GOGC=200`**: Less frequent GC, higher memory usage, better throughput for batch workloads.
- **`GOGC=off` + `GOMEMLIMIT`**: Disables periodic GC, runs only when approaching the memory limit. Excellent for latency-sensitive services with available memory.
- **`runtime.GC()`**: Force a GC cycle at a known quiescent point (e.g., after a batch job) to keep heap size predictable.
- **Avoid pointer-heavy data structures**: The GC must scan all pointers. Large []int is scanned once (no pointers); large []*int requires scanning each element.

```bash
# Monitor GC behavior
GODEBUG=gctrace=1 ./myapp
# Output: gc 1 @0.004s 2%: 0.018+0.47+0.021 ms clock ...

# GC stats in Go
var ms runtime.MemStats
runtime.ReadMemStats(&ms)
fmt.Printf("GC cycles: %d, Pause total: %v\n", ms.NumGC, time.Duration(ms.PauseTotalNs))
```

**Follow-up:** What is the write barrier and why is it necessary?

The write barrier is a small piece of code inserted by the compiler before every pointer write during the GC mark phase. It records the written pointer (and sometimes the overwritten pointer) in a per-P write barrier buffer. This ensures the GC's tri-color invariant: no black object points to a white (unscanned) object without the GC knowing about it. Without write barriers, concurrent mutation could cause the GC to miss live objects and collect them, causing memory corruption.

---

## Q23. How do channels work internally in Go?

**Answer:**

A Go channel (`hchan` in `runtime/chan.go`) contains: a ring buffer (for buffered channels), send and receive wait queues (doubly linked lists of `sudog` structs), a mutex, and state fields (closed flag, buffer head/tail indices, element count).

**Send operation** (`ch <- v`):
1. Lock the channel's mutex.
2. If a receiver is waiting in `recvq`: copy directly to the receiver's stack (avoids touching the buffer), wake the receiver goroutine, unlock, return.
3. If buffer space is available: copy to buffer, unlock, return.
4. Otherwise (block): create a `sudog` for the current goroutine, add to `sendq`, call `gopark` to suspend the goroutine (releasing the mutex via the scheduler).

**Receive operation** (`v := <-ch`):
1. Lock the mutex.
2. If a sender is waiting in `sendq`: if buffer is non-empty, dequeue from buffer and copy the waiting sender's value into the buffer (FIFO), wake sender; otherwise copy sender's value directly, wake sender, unlock.
3. If buffer non-empty: dequeue from buffer, unlock, return.
4. Otherwise: create `sudog`, add to `recvq`, `gopark`.

The direct goroutine-to-goroutine copy (bypassing the buffer) is a key optimization — it avoids an extra allocation and copy.

```go
// Buffered channel internals visualization
ch := make(chan int, 3) // ring buffer of 3
// hchan.buf = [_, _, _], dataqsiz=3, qcount=0

ch <- 1 // qcount=1
ch <- 2 // qcount=2
ch <- 3 // qcount=3 — buffer full

// <-ch would dequeue 1 (FIFO), qcount=2
```

**Follow-up:** What happens when you range over a closed channel?

Ranging over a closed channel with a buffer drains the buffer first (receiving all remaining buffered values), then returns the zero value with `ok=false` on subsequent receives, and the range loop terminates. The close signal is stored as a flag in `hchan.closed`. A receive on a closed, empty channel always returns immediately with `(zero, false)`.

---

## Q24. What is escape analysis and how does it affect performance?

**Answer:**

Escape analysis is a compile-time analysis that determines whether a variable's lifetime extends beyond the function that created it. If a variable "escapes" to the heap, it must be heap-allocated (garbage collected). If it does not escape, it can be stack-allocated (automatically freed when the function returns), which is orders of magnitude cheaper.

Variables escape when:
- Their address is returned from the function.
- They are stored into a heap-allocated object (including interface values, since the concrete value is stored on the heap when assigned to an interface).
- They are sent to a goroutine (goroutine's stack is separate; the value must outlive the spawner's stack).
- They are too large for the stack (typically >32KB, though the Go runtime can grow stacks via segmented/copy-on-write stack — large arrays may still be stack-allocated if they don't escape).
- The compiler cannot prove they don't escape (conservative analysis).

```go
// Does NOT escape — stack allocated
func noEscape() int {
    x := 42
    return x // value copy, not address
}

// DOES escape — heap allocated
func escapes() *int {
    x := 42
    return &x // address escapes, x must be on heap
}

// Interface boxing causes escape
func boxed() any {
    x := 42    // x escapes to heap — stored in interface
    return x
}
```

Inspect escape analysis decisions:

```bash
go build -gcflags="-m -m" ./... 2>&1 | grep escape
# Output: ./main.go:8:2: x escapes to heap
```

Optimization strategies:
- Accept a pointer to a pre-allocated struct rather than returning a new one.
- Use value receivers on small structs to avoid heap allocation.
- Pre-allocate slices with `make([]T, 0, knownSize)` to avoid re-allocation and reduce escape.
- Avoid `interface{}` in hot paths — use concrete types or generics.

**Follow-up:** Can stack growth cause performance problems in Go?

Yes. Go starts goroutines with a small stack (2KB) and grows it by copying to a larger stack when needed. Stack copying requires updating all pointers on the stack, which is a stop-the-world operation for that goroutine (not the whole process). For goroutines that frequently oscillate between requiring a large and small stack, this "stack thrashing" adds latency. You can diagnose it with `go tool trace` (goroutine stack growth events) and mitigate by pre-sizing the initial stack with `runtime/debug.SetMaxStack` or restructuring the code to reduce peak stack depth.

---

## Q25. How do you implement request timeout and deadline propagation?

**Answer:**

In Go, timeouts and deadlines are propagated through `context.Context`. The context carries a deadline that all functions in the call chain can observe and respect. When the deadline is exceeded, `ctx.Done()` is closed and `ctx.Err()` returns `context.DeadlineExceeded`.

Key distinction: `context.WithTimeout` sets a duration from now; `context.WithDeadline` sets an absolute time. Both cancel their derived context when the deadline passes.

Propagation pattern: the entry point (HTTP handler, gRPC handler, main) creates a context with a budget. Each downstream call (database, cache, external API) derives its own context from the parent with a sub-budget, ensuring the total time is bounded.

```go
func (h *Handler) GetUserOrders(w http.ResponseWriter, r *http.Request) {
    // Total request budget: 2 seconds
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()

    userID := r.PathValue("id")

    // Sub-budget for user lookup: 500ms
    userCtx, userCancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer userCancel()
    user, err := h.userSvc.GetUser(userCtx, userID)
    if err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            http.Error(w, "user lookup timed out", http.StatusGatewayTimeout)
        } else {
            http.Error(w, "internal error", http.StatusInternalServerError)
        }
        return
    }

    // Remaining budget for orders: whatever is left of 2s
    orders, err := h.orderSvc.GetOrders(ctx, user.ID)
    if err != nil {
        // handle
        return
    }

    json.NewEncoder(w).Encode(orders)
}
```

For HTTP clients, also set `http.Client.Timeout` as a defense-in-depth measure:

```go
client := &http.Client{
    Timeout: 5 * time.Second, // hard client-level timeout
    Transport: &http.Transport{
        DialContext: (&net.Dialer{
            Timeout:   1 * time.Second, // TCP connect timeout
            KeepAlive: 30 * time.Second,
        }).DialContext,
        ResponseHeaderTimeout: 3 * time.Second,
    },
}
```

**Follow-up:** How do you propagate timeouts across service boundaries (HTTP, gRPC)?

For gRPC, deadlines are built into the protocol — the gRPC client transmits the deadline in the request metadata and the server automatically applies it. For HTTP, use the `X-Request-Timeout` or standard `Deadline` header (or gRPC-Gateway which handles this). The receiving service extracts the remaining budget from the header and creates a context with `Min(receivedBudget, localBudget)` to prevent remote clients from setting arbitrarily long timeouts.

---

## Q26. How do you build observable Go services with structured logging and tracing?

**Answer:**

Observability comprises logs, metrics, and traces (the "three pillars"). In Go, these are typically implemented with:

**Structured logging**: Use `log/slog` (Go 1.21+) or `zap`/`zerolog` for structured, leveled, JSON-formatted logs. Always include a request ID / trace ID in every log entry using a context-attached logger.

```go
import "log/slog"

// Attach logger to context
type ctxKey struct{}
func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
    return context.WithValue(ctx, ctxKey{}, l)
}
func Logger(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}

// In middleware
func RequestMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        traceID := r.Header.Get("X-Trace-ID")
        l := slog.With("trace_id", traceID, "method", r.Method, "path", r.URL.Path)
        ctx := WithLogger(r.Context(), l)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

**Metrics**: Use Prometheus client (`prometheus/client_golang`). Define counters, histograms, and gauges at package init time. Instrument HTTP handlers with request duration histograms and error rate counters.

**Distributed tracing**: Use OpenTelemetry (`go.opentelemetry.io/otel`). Create spans for each significant operation, propagate trace context via W3C Trace Context headers across service boundaries.

```go
import "go.opentelemetry.io/otel"

func (s *Service) GetUser(ctx context.Context, id string) (*User, error) {
    ctx, span := otel.Tracer("user-service").Start(ctx, "GetUser")
    defer span.End()

    span.SetAttributes(attribute.String("user.id", id))

    user, err := s.db.QueryUser(ctx, id)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return nil, err
    }
    return user, nil
}
```

**Follow-up:** What is the performance impact of OpenTelemetry tracing in Go?

With sampling (e.g., 1% of requests), the overhead is negligible (<1%). For 100% sampling in high-throughput services, span creation and context propagation add ~1–5 µs per span. The main cost is the exporter — sending spans to a collector. Use the OTLP exporter with batching and asynchronous export to avoid blocking the request path. In extreme cases, use a sampling strategy (parent-based, rate-limited, or tail-based sampling via a collector like Jaeger).

---

## Q27. What are the semantics of defer and how is it optimized?

**Answer:**

`defer` schedules a function call to execute when the surrounding function returns, in LIFO order. Deferred functions execute even if the function panics (unless the goroutine crashes), making them essential for cleanup (closing files, unlocking mutexes, releasing resources).

**Semantics details:**
- Arguments to deferred calls are evaluated immediately at the `defer` statement, not when the deferred function executes.
- Named return values can be modified by deferred functions, affecting the returned value.
- Defer in a loop creates O(n) deferred functions — each allocated on the heap in older Go versions.

```go
// Argument evaluation at defer time
x := 1
defer fmt.Println(x) // prints 1, not 2
x = 2

// Named return modification
func double(n int) (result int) {
    defer func() { result *= 2 }() // modifies named return
    result = n
    return // returns n*2
}
```

**Performance evolution:**
- Before Go 1.13: each `defer` heap-allocated a `_defer` struct (~40ns overhead).
- Go 1.13: "open-coded" defers — for functions with a small, fixed number of defers known at compile time, the compiler inlines the deferred calls at all return sites. Overhead drops to ~1–2ns.
- Go 1.14: extended open-coded defers to handle `panic` paths correctly with a bitmap tracking which defers have been executed.

```go
// This benefits from open-coded defer (fast path):
func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // open-coded: ~1ns overhead

    // ...
    return nil
}

// This does NOT benefit (defer in loop):
func processAll(paths []string) error {
    for _, p := range paths {
        f, _ := os.Open(p)
        defer f.Close() // heap allocated, slow path
    }
    return nil
}
// Correct pattern for loop:
for _, p := range paths {
    func() {
        f, _ := os.Open(p)
        defer f.Close() // open-coded within the anonymous func
    }()
}
```

**Follow-up:** How does defer interact with panic and recover?

When a goroutine panics, the runtime begins unwinding the stack, executing deferred functions in LIFO order. If a deferred function calls `recover()`, the panic is stopped and `recover()` returns the panic value. Execution continues normally after the deferred function returns — but at the point the surrounding function returns (not from where the panic occurred). `recover` returns `nil` if called outside a deferred function or if there is no panic.

---

## Q28. How do you implement a generic Result type in Go 1.18+?

**Answer:**

A `Result[T]` type encapsulates either a successful value or an error, similar to Rust's `Result<T, E>`. This eliminates repeated `if err != nil` checks when chaining multiple fallible operations and makes error handling more composable.

```go
package result

// Result holds either a value of type T or an error.
type Result[T any] struct {
    val T
    err error
}

func Ok[T any](v T) Result[T] {
    return Result[T]{val: v}
}

func Err[T any](err error) Result[T] {
    return Result[T]{err: err}
}

func (r Result[T]) Unwrap() (T, error) {
    return r.val, r.err
}

func (r Result[T]) IsOk() bool {
    return r.err == nil
}

func (r Result[T]) Value() T {
    if r.err != nil {
        panic("Result.Value called on error result: " + r.err.Error())
    }
    return r.val
}

// Map transforms the value inside a successful Result.
func Map[T, U any](r Result[T], f func(T) U) Result[U] {
    if r.err != nil {
        return Err[U](r.err)
    }
    return Ok(f(r.val))
}

// FlatMap (bind) chains operations that return Results.
func FlatMap[T, U any](r Result[T], f func(T) Result[U]) Result[U] {
    if r.err != nil {
        return Err[U](r.err)
    }
    return f(r.val)
}

// Usage example
func parseInt(s string) Result[int] {
    n, err := strconv.Atoi(s)
    if err != nil {
        return Err[int](err)
    }
    return Ok(n)
}

func double(n int) Result[int] {
    return Ok(n * 2)
}

func main() {
    r := FlatMap(parseInt("21"), double)
    if v, err := r.Unwrap(); err == nil {
        fmt.Println(v) // 42
    }
}
```

**Follow-up:** What are the limitations of this pattern in Go compared to Rust?

Go lacks `?` operator sugar for early returns, so chaining still requires explicit `FlatMap` calls. Go's type inference for generic functions is limited — in some cases, type parameters must be explicit. Go does not have pattern matching (switch on type is limited), so destructuring a Result requires `Unwrap()` or `IsOk()` checks rather than exhaustive case handling. The nil-panic approach for `Value()` is less safe than Rust's compile-time guarantees.

---

## Q29. How do you write table-driven tests and property-based tests in Go?

**Answer:**

Table-driven tests are Go's idiomatic testing pattern: a slice of test cases (structs with inputs and expected outputs) is iterated with `t.Run` for subtests, providing clear test names and isolation.

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive", 2, 3, 5},
        {"negative", -1, -2, -3},
        {"zero", 0, 0, 0},
        {"overflow check", math.MaxInt, 1, math.MinInt}, // example edge case
    }

    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel() // run subtests in parallel
            got := Add(tc.a, tc.b)
            if got != tc.expected {
                t.Errorf("Add(%d, %d) = %d, want %d", tc.a, tc.b, got, tc.expected)
            }
        })
    }
}
```

**Property-based testing** with `testing/quick` (standard library) or `pgregory.net/rapid`/`github.com/leanovate/gopter` generates random inputs to verify invariants hold for all inputs:

```go
import "testing/quick"

// Property: reversing a slice twice returns the original
func TestReverseProperty(t *testing.T) {
    property := func(input []int) bool {
        original := make([]int, len(input))
        copy(original, input)
        Reverse(input)
        Reverse(input)
        return reflect.DeepEqual(input, original)
    }

    if err := quick.Check(property, &quick.Config{MaxCount: 1000}); err != nil {
        t.Error(err)
    }
}

// With rapid (more ergonomic):
import "pgregory.net/rapid"

func TestSortProperty(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        input := rapid.SliceOf(rapid.Int()).Draw(t, "input")
        sorted := Sort(input)
        // Property 1: length preserved
        if len(sorted) != len(input) {
            t.Fatalf("length changed: %d -> %d", len(input), len(sorted))
        }
        // Property 2: sorted order
        for i := 1; i < len(sorted); i++ {
            if sorted[i] < sorted[i-1] {
                t.Fatalf("not sorted at index %d", i)
            }
        }
    })
}
```

**Follow-up:** How do you test concurrent code in Go to detect race conditions?

Run tests with `-race` flag to enable the race detector. For deterministic concurrent testing, use `sync.WaitGroup` to ensure all goroutines complete before assertions. For stress testing, use `go test -race -count=100 -parallel=8`. The `goleak` package detects leaked goroutines in tests. For channel-based concurrency, test invariants on the output channel, not on shared mutable state.

---

## Q30. How do you implement a middleware chain in Go?

**Answer:**

A middleware in Go is a function that wraps an `http.Handler` with additional behavior. Middleware chains compose using higher-order functions. The standard pattern is `func(http.Handler) http.Handler`.

```go
type Middleware func(http.Handler) http.Handler

// Chain composes middlewares left-to-right (first is outermost)
func Chain(middlewares ...Middleware) Middleware {
    return func(final http.Handler) http.Handler {
        for i := len(middlewares) - 1; i >= 0; i-- {
            final = middlewares[i](final)
        }
        return final
    }
}

// Logging middleware
func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        lrw := &loggingResponseWriter{ResponseWriter: w, statusCode: 200}
        next.ServeHTTP(lrw, r)
        slog.Info("request",
            "method", r.Method,
            "path", r.URL.Path,
            "status", lrw.statusCode,
            "duration", time.Since(start),
        )
    })
}

// Auth middleware
func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        userID, err := validateToken(token)
        if err != nil {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        ctx := context.WithValue(r.Context(), userIDKey{}, userID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Rate limiting middleware
func RateLimitMiddleware(limiter *RateLimiter) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if !limiter.Allow(r.Context(), r.RemoteAddr) {
                http.Error(w, "too many requests", http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}

// Compose and use
chain := Chain(
    LoggingMiddleware,
    AuthMiddleware,
    RateLimitMiddleware(limiter),
)

mux := http.NewServeMux()
mux.HandleFunc("/api/users", usersHandler)
http.ListenAndServe(":8080", chain(mux))
```

**Follow-up:** How does middleware composition differ from gRPC interceptors?

gRPC uses the concept of UnaryInterceptor and StreamInterceptor with a `grpc.ChainUnaryInterceptor` helper. The signature is different — `func(ctx, req, info, handler)` — but the composition pattern is identical. gRPC interceptors receive typed request/response objects rather than raw HTTP bytes, and context propagation is idiomatic (trace context, metadata) rather than via HTTP headers.

---

## Q31. What are the tradeoffs of embedding vs. composition in Go?

**Answer:**

Go does not have inheritance. It offers two alternatives: **embedding** (promoted methods via struct embedding) and **composition** (explicit delegation through a named field).

**Embedding** promotes all exported fields and methods of the embedded type to the embedding struct. This is structural promotion, not inheritance — there is no polymorphism through the embedding type.

```go
type Animal struct {
    Name string
}

func (a Animal) Breathe() { fmt.Println(a.Name, "breathes") }

type Dog struct {
    Animal        // embedded — promotes Breathe()
    Breed  string
}

d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Lab"}
d.Breathe() // promoted method — equivalent to d.Animal.Breathe()
```

**Tradeoffs of embedding:**
- PRO: Reduces boilerplate — no need to write delegation methods.
- PRO: The embedding type satisfies interfaces that the embedded type satisfies.
- CON: Leaky abstraction — all exported methods of the embedded type become part of the embedding type's API, which may not be desired.
- CON: Method conflicts — if embedding two types that both have a method `Foo`, calling `d.Foo()` is ambiguous and fails to compile.
- CON: Makes the type's method set non-obvious — users must know what is embedded.

**Composition via named field** is more explicit:

```go
type Dog struct {
    animal Animal // unexported — composition
    Breed  string
}

func (d *Dog) Breathe() { d.animal.Breathe() } // explicit delegation
```

**Rule of thumb:** Use embedding when you genuinely want to expose the embedded type's interface. Use named fields when you want to hide the implementation detail and provide a curated API. Never embed a mutex (`sync.Mutex`) by pointer — embed by value and keep it unexported.

**Follow-up:** Can embedding cause interface satisfaction surprises?

Yes. If an embedded type satisfies an interface, the embedding type automatically satisfies it too, even if this was not intended. This can cause accidental interface satisfaction that compiles correctly but behaves unexpectedly. A concrete example: embedding `http.ResponseWriter` in a struct makes that struct implement `http.ResponseWriter`, which may interfere with HTTP middleware that type-asserts `ResponseWriter` to check for optional interfaces like `http.Flusher`.

---

## Q32. How do you handle configuration management in production Go services?

**Answer:**

Configuration management in Go services must handle: multiple environments (dev, staging, prod), secret management, runtime reloading, and type safety.

**Layer 1 — Struct-based config with validation:**

```go
type Config struct {
    Server   ServerConfig   `yaml:"server"`
    Database DatabaseConfig `yaml:"database"`
    Redis    RedisConfig    `yaml:"redis"`
}

type ServerConfig struct {
    Port         int           `yaml:"port" validate:"required,min=1,max=65535"`
    ReadTimeout  time.Duration `yaml:"read_timeout"`
    WriteTimeout time.Duration `yaml:"write_timeout"`
}

func Load(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("read config: %w", err)
    }
    var cfg Config
    if err := yaml.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parse config: %w", err)
    }
    if err := validate.Struct(&cfg); err != nil {
        return nil, fmt.Errorf("validate config: %w", err)
    }
    return &cfg, nil
}
```

**Layer 2 — Environment variable overrides (12-factor):**

Use `envconfig` or `viper` to overlay environment variables on top of file config. Environment variables take precedence: `DATABASE_DSN` overrides `database.dsn`.

**Layer 3 — Secret management:**

Never store secrets in config files committed to source control. Use: Kubernetes Secrets (mounted as env vars or files), HashiCorp Vault (dynamic secrets), AWS Secrets Manager. The service loads secrets at startup (or uses Vault agent sidecar for lease renewal).

**Layer 4 — Hot reload for non-secret config:**

Watch the config file with `fsnotify`, re-parse and re-validate on change, atomically swap with `sync/atomic.Value`:

```go
var currentCfg atomic.Value // stores *Config

func watchConfig(path string) {
    watcher, _ := fsnotify.NewWatcher()
    watcher.Add(path)
    for range watcher.Events {
        if cfg, err := Load(path); err == nil {
            currentCfg.Store(cfg)
        }
    }
}
```

**Follow-up:** How do you handle feature flags in a Go service?

Store flags in a remote config store (LaunchDarkly, Unleash, or a simple Redis key) with a local cache and background refresh. In code, check the flag as `if flags.IsEnabled(ctx, "new-checkout-flow", userID)`. The `userID` enables percentage rollouts and user targeting. Always wrap the flag check in a thin abstraction so the flag system can be swapped and tests can control flag state without external dependencies.

---

## Q33. What are Go's memory allocation patterns and the role of the tcmalloc-inspired allocator?

**Answer:**

Go's memory allocator is inspired by tcmalloc (Thread-Caching Malloc). It is a size-class based allocator designed to reduce contention and fragmentation.

**Structure:**
- **MSpan**: A run of pages (8KB each) dedicated to a single size class. Objects of one size class are never mixed with another in the same span.
- **MCache**: Per-P (per-logical-processor) cache of free objects for each size class. Allocation from MCache requires no locking — it is local to the P.
- **MCentral**: Per-size-class central free list shared across all Ps. Protected by a per-size-class lock.
- **MHeap**: The global heap, managing spans. Large objects (>32KB) are allocated directly from MHeap.

**Allocation path:**
1. If the object is small (≤32KB): check the P's MCache for the appropriate size class. If available, return a pointer — no lock, no syscall.
2. If MCache is empty for that size class: refill from MCentral (acquire size-class lock, bulk-transfer a span).
3. If MCentral is empty: request a new span from MHeap (global lock).
4. If no memory available: grow the heap via `mmap` (OS syscall).

**Size classes**: Go has ~70 size classes ranging from 8 bytes to 32KB. An 18-byte object uses the 24-byte size class, wasting 6 bytes — this is internal fragmentation, the cost of the slab allocator approach.

```go
// Observe allocation size classes
// go tool compile -S -gcflags="-m" main.go

// Benchmark allocation patterns
func BenchmarkSmallAlloc(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = make([]byte, 64) // likely stays on stack; use &[64]byte{} to force heap
    }
}
```

**Follow-up:** What is the noscan optimization and when does it apply?

The GC must scan objects that contain pointers. Objects with no pointer fields (e.g., `[]byte`, `[N]int`) are allocated in noscan spans and are never scanned by the GC marker — only swept. This significantly reduces GC scanning work for byte-heavy workloads. You can see this in practice: a program allocating many `[]int` slices has lower GC overhead than one allocating equivalent numbers of pointer-containing structs.

---

## Q34. How does Go's net/http server manage goroutines for connections?

**Answer:**

Go's `net/http` server uses a goroutine-per-connection model. For each accepted TCP connection, a new goroutine is spawned to handle all HTTP requests on that connection. For HTTP/1.1 keep-alive connections, the same goroutine handles multiple sequential requests. For HTTP/2, one goroutine manages the connection multiplexing, with additional goroutines spawned per stream.

**Connection lifecycle:**
1. `net.Listener.Accept()` returns a new `net.Conn`.
2. `go c.serve(ctx)` starts a goroutine per connection.
3. Within `serve`, requests are read sequentially (HTTP/1.1), the handler is called (potentially spawning goroutines), and the response is written.
4. Connection-level timeouts are enforced with `net.Conn.SetReadDeadline`/`SetWriteDeadline`.

**Key server fields for tuning:**

```go
server := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadTimeout:       5 * time.Second,  // time to read entire request
    ReadHeaderTimeout: 2 * time.Second,  // time to read request headers (prevents Slowloris)
    WriteTimeout:      10 * time.Second, // time to write response
    IdleTimeout:       120 * time.Second, // keep-alive idle timeout
    MaxHeaderBytes:    1 << 20,          // 1MB max header size
}
```

**Slowloris protection**: Without `ReadHeaderTimeout`, a malicious client can open many connections and send headers very slowly, eventually exhausting the goroutine pool. Set `ReadHeaderTimeout` to protect against this.

**Goroutine count**: Under high connection concurrency (100K+ simultaneous connections), the goroutine count and associated stack memory can be significant. Each goroutine starts with a 2–8KB stack. 100K goroutines = 200MB–800MB just for stacks. Use connection pooling from clients, keep-alive, and HTTP/2 multiplexing to reduce simultaneous connection count.

**Follow-up:** What is `Server.ConnState` and how is it used?

`Server.ConnState` is a callback invoked when a connection transitions between states: `New`, `Active`, `Idle`, `Hijacked`, `Closed`. It can be used to implement connection-level metrics (count active vs. idle connections), enforce per-IP connection limits, or implement custom keep-alive logic.

---

## Q35. How do you design a job queue with at-least-once delivery in Go?

**Answer:**

An at-least-once job queue guarantees every job is processed at least once — jobs may be delivered multiple times if a worker crashes after receiving but before acknowledging. Jobs must be **idempotent** by design.

**Architecture:**
- Jobs are stored durably (database, Redis, Kafka, SQS) before being enqueued.
- Workers dequeue with a visibility timeout (the job is invisible to other workers for a period).
- Worker must acknowledge (delete/commit) the job within the visibility timeout.
- A background process re-enqueues jobs whose visibility timeout expired without acknowledgment.

**Go implementation with PostgreSQL (simple SKIP LOCKED pattern):**

```go
type Job struct {
    ID        int64
    Payload   json.RawMessage
    LockedAt  sql.NullTime
    LockToken string
    Attempts  int
}

// Dequeue atomically locks a job for this worker
func (q *Queue) Dequeue(ctx context.Context) (*Job, error) {
    token := uuid.New().String()
    var job Job
    err := q.db.QueryRowContext(ctx, `
        UPDATE jobs
        SET locked_at = NOW(), lock_token = $1, attempts = attempts + 1
        WHERE id = (
            SELECT id FROM jobs
            WHERE (locked_at IS NULL OR locked_at < NOW() - INTERVAL '30 seconds')
              AND attempts < 5
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING id, payload, attempts
    `, token).Scan(&job.ID, &job.Payload, &job.Attempts)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }
    job.LockToken = token
    return &job, nil
}

func (q *Queue) Acknowledge(ctx context.Context, id int64, token string) error {
    result, err := q.db.ExecContext(ctx,
        "DELETE FROM jobs WHERE id = $1 AND lock_token = $2", id, token)
    if err != nil {
        return err
    }
    rows, _ := result.RowsAffected()
    if rows == 0 {
        return errors.New("job not found or token mismatch")
    }
    return nil
}
```

**Worker pool:**

```go
func RunWorkers(ctx context.Context, q *Queue, concurrency int, fn func(context.Context, *Job) error) {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < concurrency; i++ {
        g.Go(func() error {
            for {
                job, err := q.Dequeue(ctx)
                if err != nil || job == nil {
                    select {
                    case <-ctx.Done(): return ctx.Err()
                    case <-time.After(1 * time.Second): continue
                    }
                }
                if err := fn(ctx, job); err != nil {
                    // Log error, job will be retried after visibility timeout
                    continue
                }
                q.Acknowledge(ctx, job.ID, job.LockToken)
            }
        })
    }
    g.Wait()
}
```

**Follow-up:** How do you implement exactly-once processing on top of at-least-once delivery?

Exactly-once requires idempotency keys. Each job has a unique `idempotency_key`. Before processing, atomically check-and-insert the key into a `processed_jobs` table within the same database transaction as the job's side effects. If the insert fails with a unique constraint violation, the job was already processed — skip silently. Commit the transaction atomically with the side effects. This pattern is correct even if the worker receives the same job multiple times.

---

## Q36. How does `sync.Map` differ from a mutex-protected map?

**Answer:**

`sync.Map` is a specialized concurrent map optimized for two specific access patterns:
1. **Write-once, read-many**: entries are written infrequently but read very frequently.
2. **Disjoint keys per goroutine**: each goroutine accesses a mostly separate set of keys.

**Internal structure:**
`sync.Map` maintains two maps: a `read` map (a `atomic.Value` holding a `readOnly` struct containing a regular map) and a `dirty` map (protected by a mutex). The read map is a snapshot that can be read without locking. Reads check the read map first atomically. On a miss, the mutex is acquired and the dirty map is checked. After enough misses (proportional to the dirty map size), the dirty map is promoted to the read map atomically.

Writes always go to the dirty map under a mutex. If a key already exists in the read map, an atomic pointer swap updates it without the mutex (expunged entries are the exception).

**When to use `sync.Map`:**
- Cache-like structures with high read-to-write ratio.
- Registry patterns where entries are added at startup and only read thereafter.
- When the read map hit rate is very high (>90% of accesses).

**When NOT to use `sync.Map`:**
- General-purpose concurrent maps with balanced reads and writes.
- Maps requiring atomic read-modify-write (sync.Map has no such operation).
- When you need range with mutations (unsafe with sync.Map).

```go
var m sync.Map

// Store
m.Store("key", "value")

// Load
if v, ok := m.Load("key"); ok {
    fmt.Println(v.(string))
}

// LoadOrStore — atomic check-then-set
actual, loaded := m.LoadOrStore("key", "default")
if loaded {
    fmt.Println("existing:", actual)
}

// Range — snapshot iteration (safe but not consistent if writes occur)
m.Range(func(k, v any) bool {
    fmt.Println(k, v)
    return true // return false to stop iteration
})
```

**Follow-up:** Why is a sharded mutex map often better than `sync.Map` for write-heavy workloads?

Under write-heavy workloads, `sync.Map`'s dirty map gets invalidated frequently, causing expensive promotions (full copy of dirty into read). A sharded map (array of N `sync.RWMutex`-protected maps) distributes contention across N locks. With N=64 shards and well-distributed keys, contention per shard is ~64x lower. `sync.Map` was never designed for high-write scenarios — its documentation explicitly states this.

---

## Q37. How do you implement connection pooling for a database in Go?

**Answer:**

`database/sql` provides built-in connection pooling. The `sql.DB` type maintains a pool of idle connections and creates new ones up to a configured maximum. Understanding and tuning this pool is critical for production services.

**Key pool settings:**

```go
db, err := sql.Open("postgres", dsn)
if err != nil {
    return err
}

// Maximum number of open connections (including in-use + idle)
db.SetMaxOpenConns(25)

// Maximum number of idle connections in the pool
db.SetMaxIdleConns(10)

// Maximum lifetime of a connection (prevents stale connections)
db.SetConnMaxLifetime(5 * time.Minute)

// Maximum time a connection can be idle before being closed
db.SetConnMaxIdleTime(1 * time.Minute)
```

**Tradeoffs:**
- `MaxOpenConns` prevents overwhelming the database (PostgreSQL default max_connections is 100). Set to (DB_MAX_CONNECTIONS / number_of_service_instances) * safety_factor.
- `MaxIdleConns` should equal `MaxOpenConns` if you want warm connections; lower it to free DB-side resources during low traffic.
- `ConnMaxLifetime` handles database restarts, network failures, and server-side connection limits without service restart.

**Pool exhaustion**: When all connections are in use and `MaxOpenConns` is reached, `db.QueryContext` blocks until a connection is available or the context is cancelled. Monitor with `db.Stats().WaitCount` and `WaitDuration`.

```go
// Monitor pool health
func poolMetrics(db *sql.DB) {
    stats := db.Stats()
    metrics.Gauge("db.pool.open", float64(stats.OpenConnections))
    metrics.Gauge("db.pool.idle", float64(stats.Idle))
    metrics.Gauge("db.pool.in_use", float64(stats.InUse))
    metrics.Counter("db.pool.waits", float64(stats.WaitCount))
    metrics.Histogram("db.pool.wait_duration", stats.WaitDuration.Seconds())
}
```

**Always use context**: Pass context to every database operation so slow queries can be cancelled:

```go
user, err := db.QueryRowContext(ctx, "SELECT * FROM users WHERE id = $1", id).Scan(&u.ID, &u.Name)
```

**Follow-up:** How do you handle database connection retries at startup?

The `sql.Open` call does not actually establish a connection — it just validates the DSN. Use `db.PingContext(ctx)` in a retry loop at startup to wait for the database to become available:

```go
for attempt := 0; attempt < 10; attempt++ {
    if err := db.PingContext(ctx); err == nil {
        break
    }
    time.Sleep(time.Duration(attempt+1) * time.Second) // linear backoff
}
```

---

## Q38. Explain the difference between value and pointer receivers in Go.

**Answer:**

In Go, a method can have either a value receiver `(v T)` or a pointer receiver `(v *T)`. The choice affects: mutation semantics, interface satisfaction, copying behavior, and nil safety.

**Value receiver `(v T)`:**
- The method operates on a copy of the receiver.
- Mutations to `v` inside the method do not affect the original.
- Can be called on both value and pointer variables.
- The method set of `T` includes value receiver methods.
- The method set of `*T` includes both value and pointer receiver methods.

**Pointer receiver `(v *T)`:**
- The method operates on the original value via a pointer.
- Mutations to `v` inside the method affect the original.
- Can be called on pointer variables directly; if called on an addressable value variable, Go automatically takes the address (`x.Method()` becomes `(&x).Method()`).
- Cannot be called on non-addressable values (returned from functions, map values).

**Interface satisfaction**: A value of type `T` satisfies an interface if all methods in the interface have value receivers. A value of type `*T` satisfies an interface if all methods have either value or pointer receivers. This asymmetry is the source of many "does not implement" compile errors.

```go
type Counter struct{ n int }

// Value receiver — does not mutate
func (c Counter) Value() int { return c.n }

// Pointer receiver — mutates
func (c *Counter) Inc() { c.n++ }

type Incrementer interface {
    Inc()
    Value() int
}

var i Incrementer = &Counter{} // OK: *Counter has both Inc() and Value()
// var i Incrementer = Counter{} // ERROR: Counter does not implement Inc() (pointer receiver)
```

**Rule of thumb:**
- Use pointer receivers when the method needs to modify the receiver or when the receiver is large (to avoid copying).
- Use value receivers for small structs where copying is cheap and no mutation is needed.
- Be consistent within a type: if any method needs a pointer receiver, use pointer receivers for all methods to keep the method set clean and avoid confusion.

**Follow-up:** Why can't you call a pointer receiver method on a non-addressable value?

Map values are not addressable — the map implementation may move values internally. If `m["key"].Inc()` were allowed, `Inc` would get a pointer to a temporary copy, not to the map-stored value, and the mutation would be silently lost. Go prevents this at compile time. The fix is to use `*Counter` as the map value type: `map[string]*Counter`.

---

## Q39. How do you implement graceful degradation and fallbacks in Go services?

**Answer:**

Graceful degradation means the service continues to function (perhaps with reduced functionality) when dependencies are unavailable, rather than failing completely.

**Patterns:**

**1. Stale cache fallback**: Return cached data when the upstream is unavailable. Use a cache with a grace period — serve stale data for up to N minutes during outages.

```go
func (s *ProductService) GetProduct(ctx context.Context, id string) (*Product, error) {
    // Try cache first
    if p, ok := s.cache.Get(id); ok {
        return p.(*Product), nil
    }

    // Try upstream with timeout
    upstreamCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()
    p, err := s.upstream.GetProduct(upstreamCtx, id)
    if err != nil {
        // Serve stale data from cache (even expired entries)
        if stale, ok := s.staleCache.Get(id); ok {
            s.metrics.Inc("product.stale_serve")
            return stale.(*Product), nil
        }
        return nil, fmt.Errorf("getProduct: %w", err)
    }

    s.cache.Put(id, p)
    s.staleCache.Put(id, p)
    return p, nil
}
```

**2. Default/static fallback**: Return a sensible default when personalization service is down:

```go
func (s *RecommendationService) GetRecommendations(ctx context.Context, userID string) ([]Item, error) {
    items, err := s.personalizer.Recommend(ctx, userID)
    if err != nil {
        // Fall back to popular items (static, always available)
        return s.popularItems.Get(), nil
    }
    return items, nil
}
```

**3. Circuit breaker + fallback**: Combine a circuit breaker (to avoid calling a failing service) with a fallback.

**4. Feature flag degradation**: Disable expensive or fragile features via a feature flag when the system is under load. Shed load gracefully rather than cascading:

```go
func (h *Handler) SearchHandler(w http.ResponseWriter, r *http.Request) {
    if h.flags.IsEnabled(r.Context(), "search.full-text") {
        results, err := h.fullTextSearch(r.Context(), r.URL.Query().Get("q"))
        if err == nil {
            json.NewEncoder(w).Encode(results)
            return
        }
    }
    // Degrade to prefix search
    results := h.prefixSearch(r.URL.Query().Get("q"))
    json.NewEncoder(w).Encode(results)
}
```

**5. Load shedding**: Reject requests when the system is overloaded rather than queuing them indefinitely. Respond with `503 Service Unavailable` and a `Retry-After` header.

**Follow-up:** How do you test graceful degradation behavior?

Inject faults via the dependency's interface. In tests, replace the upstream with a fake that returns errors or times out on demand. Use `net/http/httptest` to simulate slow or failing HTTP services. For integration tests, use tools like Toxiproxy to simulate network partitions and latency. Chaos engineering in staging (terminating pods, injecting faults) validates degradation behavior under production-like conditions.

---

## Q40. How do you optimize Go binary size for production deployments?

**Answer:**

Go binaries are statically linked by default and include the runtime, garbage collector, and all imported packages. A "Hello, World" binary is ~1.8MB. Production services often reach 20–100MB. Optimization strategies reduce cold-start time, container image size, and deployment bandwidth.

**1. Strip debug information** (most impactful, ~30% reduction):

```bash
go build -ldflags="-s -w" -o myapp ./...
# -s: omit symbol table
# -w: omit DWARF debug information
```

**2. UPX compression** (further reduction, adds decompression latency at startup):

```bash
upx --best myapp
# Typical: 60-70% size reduction, ~200ms startup overhead
```

**3. Remove unused imports and dead code**: The linker already does DCE, but ensure you are not importing packages solely for init side effects that pull in large dependencies.

**4. Use `trimpath`** (removes absolute file paths from the binary, improves reproducibility, minor size reduction):

```bash
go build -trimpath ./...
```

**5. Minimize reflection-heavy dependencies**: Reflection prevents DCE. Replace `encoding/json` with `encoding/json/v2` or `go.noodles.io/jsonv2` (draft), or use code-generated marshalers (`easyjson`, `go-json`) that avoid reflection.

**6. CGO-free build** (enables full static linking and removes CGO overhead):

```bash
CGO_ENABLED=0 go build -o myapp ./...
```

**7. Build tags to exclude optional features**:

```go
//go:build !full

// Omit expensive optional functionality in trimmed builds
```

**8. Slim base images**: Use `FROM scratch` or `FROM gcr.io/distroless/static` for CGO-free binaries. A scratch-based container with a stripped Go binary can be under 5MB.

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o /myapp ./...

FROM scratch
COPY --from=builder /myapp /myapp
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
ENTRYPOINT ["/myapp"]
```

**Follow-up:** Why does importing `net/http` significantly increase binary size even for small programs?

`net/http` imports `crypto/tls`, which imports `crypto/elliptic`, `crypto/rsa`, `crypto/ecdsa`, and their dependencies — the entire TLS stack. For binaries that do not need TLS (internal services communicating over a service mesh), this can be avoided by using HTTP-only transports. Additionally, `net/http` imports `mime` and `mime/multipart`, pulling in several MB of MIME type data. Using lightweight HTTP libraries or code that avoids the full stdlib HTTP stack can reduce size in extremely constrained environments.

---

*© 2024 Gaurav Patil — GoForge Platform. All rights reserved.*
