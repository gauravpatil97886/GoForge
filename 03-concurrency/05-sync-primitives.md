# Go Sync Primitives

## What Is This?

The `sync` package provides low-level concurrency primitives: mutexes, read-write locks, wait groups, one-time initialization, condition variables, and object pools. These are the building blocks for shared-memory concurrency — coordinating goroutines that need to access the same data or wait on each other. Unlike channels (which communicate by passing ownership), sync primitives protect *shared state in place*.

## Why Does It Exist?

Go's philosophy is "share memory by communicating" — channels are the preferred tool. But not every concurrency problem maps cleanly to message passing. A counter shared by 100 goroutines doesn't need message passing — it needs a lock. A cache shared by readers and writers needs a read-write lock. A connection pool needs object reuse without heap allocation per request. The `sync` package provides these tools for the cases where channels would add unnecessary complexity and overhead. Without `sync`, every shared-state problem would require a dedicated goroutine acting as a serializer, which is sometimes the right answer but often overkill.

## Who Uses This in Industry?

- **Google**: Go's standard library itself uses `sync.RWMutex` extensively — `http.ServeMux` uses one to protect its route table, since routes are registered at startup (writes) and then read-only for the lifetime of the server (many concurrent reads).
- **Uber**: Uber's `zap` logging library (the most widely used Go logger) uses `sync.Pool` to pool `[]byte` buffers for log line serialization. This eliminates per-log-entry allocations at high throughput, which would otherwise cause significant GC pressure at Uber's scale.
- **Netflix**: Netflix's Go-based metadata service uses `sync.Once` for lazy initialization of expensive connections (e.g., Cassandra client, Elasticsearch client). The connection is established exactly once, thread-safely, on first use.
- **Cloudflare**: Cloudflare's DNS infrastructure uses `sync.RWMutex` to protect in-memory DNS record caches. Thousands of concurrent goroutines read the cache; a background goroutine updates it periodically. `RWMutex` allows all readers to proceed in parallel.
- **Kubernetes**: The Kubernetes API server uses `sync.WaitGroup` in shutdown sequences — it waits for all active request goroutines to drain before releasing resources, ensuring no goroutine uses a connection that has been closed.

## Industry Standards & Best Practices

**Senior engineers always:**
- Use `defer mu.Unlock()` immediately after `mu.Lock()` — prevents unlock-on-every-return bugs.
- Keep the critical section as small as possible — lock, copy data out, unlock, then process the copy.
- Use `sync.RWMutex` when reads vastly outnumber writes and the read path is on the hot path.
- Use `sync.Once` for singleton initialization instead of `init()` functions when initialization can fail or is expensive.
- Embed `sync.Mutex` in a struct that owns the protected data — never pass a mutex by value.
- Comment exactly which fields a mutex protects.

**Beginners often:**
- Copy a mutex (by value assignment) and create two independent locks — a silent bug.
- Hold a lock while calling external code (e.g., logging, network calls) — causes lock contention hotspots.
- Use `sync.Mutex` everywhere when `sync.RWMutex` would give 10x better read throughput.
- Forget `defer` and introduce subtle paths that return without unlocking.

## Why Go's Approach Is Unique

**Java** has `synchronized`, `ReentrantLock`, `ReadWriteLock`, `volatile`, `Semaphore`, and `CountDownLatch` — a sprawling API. Java's `synchronized` is tied to object monitors, which adds a hidden lock on every Java object. This is convenient but creates invisible overhead.

**Python** has `threading.Lock`, `threading.RLock`, `threading.Condition` — but the GIL means these primitives primarily protect against corruption, not actually enabling parallel execution. Real parallelism requires `multiprocessing`.

**Node.js** is single-threaded by default — there is no equivalent because shared-memory parallelism doesn't exist in the main thread model. Worker threads exist but don't share the V8 heap.

**Go's `sync` package** is minimal by design. There is no reentrant mutex (Go considers reentrance a design smell — restructure your code). There is no semaphore in the standard library (use channels with a buffered capacity). There is no `volatile` — use `sync/atomic` for lock-free operations. Go forces you to be explicit about what you're protecting and how, which makes concurrent Go code more auditable than Java code with scattered `synchronized` blocks.

---

## 1. sync.Mutex — Mutual Exclusion

**WHY:** When two goroutines read-modify-write the same variable, you get a data race. The result depends on scheduling — non-deterministic and undefined behavior. A `Mutex` ensures only one goroutine is in the critical section at a time.

```go
package main

import (
	"fmt"
	"sync"
)

// SafeCounter is safe to use from multiple goroutines
type SafeCounter struct {
	mu    sync.Mutex // protects count
	count int
}

func (c *SafeCounter) Increment() {
	c.mu.Lock()
	defer c.mu.Unlock() // ALWAYS use defer — prevents unlock on every return path
	c.count++           // critical section: as small as possible
}

func (c *SafeCounter) Value() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.count
}

func main() {
	counter := &SafeCounter{}
	var wg sync.WaitGroup

	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			counter.Increment()
		}()
	}

	wg.Wait()
	fmt.Println("Final count:", counter.Value()) // always 1000
}
```

**Without the mutex, the final count would be less than 1000** — run with `go run -race` to see the race detector catch it.

**Critical section discipline:** Don't do I/O, network calls, or logging while holding a lock. Copy data out first:

```go
package main

import (
	"fmt"
	"sync"
)

type Cache struct {
	mu    sync.Mutex
	items map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
	c.mu.Lock()
	v, ok := c.items[key] // copy out under lock
	c.mu.Unlock()         // release before doing anything with v
	// now process v without holding the lock
	return v, ok
}

func (c *Cache) Set(key, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.items == nil {
		c.items = make(map[string]string)
	}
	c.items[key] = value
}

func main() {
	cache := &Cache{}
	cache.Set("name", "Alice")
	if v, ok := cache.Get("name"); ok {
		fmt.Println("cached:", v)
	}
}
```

**Pitfall — never copy a mutex:**

```go
// BAD: mu is copied, original and copy are independent locks
func bad(mu sync.Mutex) {
	mu.Lock() // locks the copy, not the original
}

// GOOD: always pass by pointer
func good(mu *sync.Mutex) {
	mu.Lock()
	defer mu.Unlock()
}
```

**The `go vet` tool catches mutex copies** — run it in CI.

---

## 2. sync.RWMutex — Multiple Readers, One Writer

**WHY:** A regular `Mutex` serializes ALL access — readers must wait for other readers even though concurrent reads are safe. `RWMutex` allows any number of readers to hold `RLock()` simultaneously, but only one writer can hold `Lock()`, and it blocks all readers. For read-heavy workloads (a cache, a config store), this can give dramatically better throughput.

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type ConfigStore struct {
	mu     sync.RWMutex
	config map[string]string
}

// Read: multiple goroutines can call this concurrently
func (cs *ConfigStore) Get(key string) string {
	cs.mu.RLock()         // shared read lock — non-exclusive
	defer cs.mu.RUnlock()
	return cs.config[key]
}

// Write: exclusive — blocks all readers and other writers
func (cs *ConfigStore) Set(key, value string) {
	cs.mu.Lock()         // exclusive write lock
	defer cs.mu.Unlock()
	if cs.config == nil {
		cs.config = make(map[string]string)
	}
	cs.config[key] = value
}

func main() {
	store := &ConfigStore{}
	store.Set("env", "production")
	store.Set("version", "2.1.0")

	var wg sync.WaitGroup

	// Simulate 10 concurrent readers
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			val := store.Get("env")
			fmt.Printf("reader %d got: %s\n", id, val)
		}(i)
	}

	// One writer updating config
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(1 * time.Millisecond) // let readers start
		store.Set("version", "2.2.0")
		fmt.Println("writer updated version")
	}()

	wg.Wait()
}
```

**When to use RWMutex vs Mutex:**
- Reads >> Writes (e.g., 100:1): use `RWMutex`
- Writes are frequent or reads are fast: plain `Mutex` is simpler and has lower overhead
- Rule of thumb: if in doubt, profile. `RWMutex` has higher overhead per-operation than `Mutex` when there's contention.

---

## 3. sync.WaitGroup — Coordinating Goroutine Completion

**WHY:** You launch N goroutines and need to wait for all of them to finish before proceeding. Channels work but require careful bookkeeping. `WaitGroup` is the idiomatic tool: `Add(n)` to declare how many goroutines, `Done()` when each finishes, `Wait()` to block until count reaches zero.

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func processItem(id int, wg *sync.WaitGroup) {
	defer wg.Done() // ALWAYS defer Done — ensure it runs even on panic
	fmt.Printf("processing item %d\n", id)
	time.Sleep(10 * time.Millisecond)
	fmt.Printf("finished item %d\n", id)
}

func main() {
	var wg sync.WaitGroup

	items := []int{1, 2, 3, 4, 5}

	for _, item := range items {
		wg.Add(1) // Add BEFORE launching goroutine (not inside)
		go processItem(item, &wg)
	}

	wg.Wait() // blocks until all Done() calls balance the Add() calls
	fmt.Println("all items processed")
}
```

**Classic mistake — Add inside the goroutine:**

```go
// BUG: if wg.Wait() is called before the goroutine starts, Wait returns immediately
go func() {
    wg.Add(1)       // TOO LATE — race with Wait()
    defer wg.Done()
    doWork()
}()
wg.Wait()           // may return before goroutine even calls Add(1)
```

**Pattern — fan-out with result collection:**

```go
package main

import (
	"fmt"
	"sync"
)

func fanOut(inputs []int) []int {
	results := make([]int, len(inputs))
	var wg sync.WaitGroup
	var mu sync.Mutex // protect results slice if order doesn't matter

	for i, v := range inputs {
		wg.Add(1)
		go func(idx, val int) {
			defer wg.Done()
			processed := val * val // do work
			mu.Lock()
			results[idx] = processed
			mu.Unlock()
		}(i, v)
	}

	wg.Wait()
	return results
}

func main() {
	inputs := []int{1, 2, 3, 4, 5}
	results := fanOut(inputs)
	fmt.Println("results:", results) // [1 4 9 16 25]
}
```

---

## 4. sync.Once — Initialization That Happens Exactly Once

**WHY:** Expensive initialization (database connections, config parsing, singleton setup) should happen once, no matter how many goroutines race to use it. A naive check-then-act (`if notInitialized { init() }`) is a data race. `sync.Once` guarantees the function runs exactly once, and all goroutines that call `Do()` after the first will block until the initialization completes, then return.

```go
package main

import (
	"fmt"
	"sync"
)

type DatabaseClient struct {
	DSN string
}

var (
	dbOnce   sync.Once
	dbClient *DatabaseClient
)

func getDB() *DatabaseClient {
	dbOnce.Do(func() {
		fmt.Println("initializing database connection (runs once)")
		// Expensive setup: dial DB, run migrations, etc.
		dbClient = &DatabaseClient{DSN: "postgres://localhost/mydb"}
	})
	return dbClient
}

func main() {
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			db := getDB()
			fmt.Printf("goroutine %d using db: %s\n", id, db.DSN)
		}(i)
	}
	wg.Wait()
	// "initializing database connection" printed exactly once
}
```

**Struct-level Once — preferred pattern for encapsulation:**

```go
package main

import (
	"fmt"
	"sync"
)

type Service struct {
	once   sync.Once
	client interface{} // your expensive resource
}

func (s *Service) Client() interface{} {
	s.once.Do(func() {
		fmt.Println("creating client once")
		s.client = struct{ Name string }{"MyClient"}
	})
	return s.client
}

func main() {
	svc := &Service{}
	fmt.Println(svc.Client())
	fmt.Println(svc.Client()) // second call — Do() is no-op
}
```

**Pitfall — Once.Do does not re-run if the function panics:**

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	var once sync.Once
	var initialized bool

	// First call panics — Do is still marked as done
	func() {
		defer func() { recover() }()
		once.Do(func() {
			panic("init failed")
		})
	}()

	// Second call is a no-op — initialization never actually succeeded
	once.Do(func() {
		initialized = true // never runs
	})

	fmt.Println("initialized:", initialized) // false — bug!
}
```

**Fix:** If initialization can fail, return an error and use a `sync.Mutex` + a boolean flag instead of `Once`.

---

## 5. sync.Cond — Condition Variables

**WHY:** A condition variable lets goroutines sleep while waiting for a *condition* to become true, and wake them up when it does. `sync.Mutex` alone can only protect data. `sync.Cond` adds the ability to say "wake me up when the data satisfies some condition." The canonical use case is a bounded producer-consumer queue.

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type BoundedQueue struct {
	mu       sync.Mutex
	cond     *sync.Cond
	items    []int
	capacity int
}

func NewBoundedQueue(cap int) *BoundedQueue {
	q := &BoundedQueue{capacity: cap}
	q.cond = sync.NewCond(&q.mu)
	return q
}

func (q *BoundedQueue) Push(item int) {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Wait while full
	for len(q.items) >= q.capacity {
		q.cond.Wait() // atomically releases lock and suspends goroutine
	}
	q.items = append(q.items, item)
	fmt.Printf("pushed %d (queue size: %d)\n", item, len(q.items))
	q.cond.Broadcast() // wake up all waiting goroutines (consumers may be waiting)
}

func (q *BoundedQueue) Pop() int {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Wait while empty
	for len(q.items) == 0 {
		q.cond.Wait() // atomically releases lock and suspends goroutine
	}
	item := q.items[0]
	q.items = q.items[1:]
	fmt.Printf("popped %d (queue size: %d)\n", item, len(q.items))
	q.cond.Broadcast() // wake up producers who may be waiting for space
	return item
}

func main() {
	q := NewBoundedQueue(3)
	var wg sync.WaitGroup

	// Producer
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 1; i <= 5; i++ {
			q.Push(i)
			time.Sleep(10 * time.Millisecond)
		}
	}()

	// Consumer
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 5; i++ {
			v := q.Pop()
			_ = v
			time.Sleep(20 * time.Millisecond)
		}
	}()

	wg.Wait()
	fmt.Println("done")
}
```

**Critical rules for sync.Cond:**
1. Always check the condition in a `for` loop, not an `if` — spurious wakeups are possible.
2. `cond.Wait()` must be called while holding the associated mutex.
3. `Broadcast()` wakes all waiters; `Signal()` wakes one. Use `Broadcast` when multiple goroutines might be unblocked by the state change.

**Honest note:** In modern Go, most use cases for `sync.Cond` can be replaced with channels. Use `sync.Cond` when you have many goroutines all waiting on a complex shared state that can change in multiple ways. For simple producer-consumer, a buffered channel is usually cleaner.

---

## 6. sync.Pool — Object Reuse and GC Pressure Reduction

**WHY:** In high-throughput systems, allocating the same object type thousands of times per second puts pressure on the garbage collector — more allocations mean more GC cycles mean more latency spikes. `sync.Pool` provides a free list of reusable objects. Get an object from the pool, use it, put it back. The GC may reclaim pool objects, so pools are not caches — they're temporary object reservoirs.

**Used by:** `encoding/json`, `fmt`, `net/http`, `compress/gzip` — all use `sync.Pool` internally for byte buffers.

```go
package main

import (
	"bytes"
	"fmt"
	"sync"
)

// Pool of byte buffers — avoids allocating a new buffer per request
var bufPool = sync.Pool{
	New: func() interface{} {
		// New is called when the pool is empty
		fmt.Println("allocating new buffer")
		return new(bytes.Buffer)
	},
}

func processRequest(data string) string {
	// Get a buffer from the pool
	buf := bufPool.Get().(*bytes.Buffer)
	buf.Reset() // CRITICAL: reset before use — pool objects may be dirty
	defer bufPool.Put(buf) // return to pool when done

	buf.WriteString("processed: ")
	buf.WriteString(data)
	return buf.String()
}

func main() {
	var wg sync.WaitGroup
	results := make([]string, 5)

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx] = processRequest(fmt.Sprintf("request-%d", idx))
		}(i)
	}

	wg.Wait()
	for _, r := range results {
		fmt.Println(r)
	}
	// "allocating new buffer" appears fewer than 5 times — objects are reused
}
```

**Pool rules:**
1. Always call `Reset()` or equivalent on objects retrieved from the pool — they may contain data from a previous use.
2. Never store pointers to objects obtained from a pool beyond their usage scope — the GC may reclaim them.
3. Pool objects are not guaranteed to survive GC cycles — don't use Pool as a persistent cache.
4. Pool is safe for concurrent use — no mutex needed.

**When to use Pool:**
- Allocating the same object type many times per second (> ~10k/sec)
- Profiling shows the type appearing heavily in heap allocations
- The object is expensive to initialize or large in size

**When NOT to use Pool:**
- Object count is small or allocation rate is low
- Objects have complex cleanup requirements
- You need guaranteed lifetime (use a real cache instead)

---

## 7. sync/atomic — Lock-Free Primitives

**WHY:** For simple numeric operations (counters, flags), a full mutex is overkill. `sync/atomic` provides CPU-level atomic read-modify-write operations that are faster than mutexes for the specific cases they support.

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type AtomicCounter struct {
	value int64 // must be 64-bit aligned
}

func (c *AtomicCounter) Increment() {
	atomic.AddInt64(&c.value, 1)
}

func (c *AtomicCounter) Value() int64 {
	return atomic.LoadInt64(&c.value) // safe concurrent read
}

// Compare-and-swap: update only if current value matches expected
func (c *AtomicCounter) CompareAndSwap(old, new int64) bool {
	return atomic.CompareAndSwapInt64(&c.value, old, new)
}

func main() {
	counter := &AtomicCounter{}
	var wg sync.WaitGroup

	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			counter.Increment()
		}()
	}

	wg.Wait()
	fmt.Println("count:", counter.Value()) // always 1000

	// Atomic flag (0 = false, 1 = true)
	var shutdownFlag int32
	// Set the flag
	atomic.StoreInt32(&shutdownFlag, 1)
	// Read the flag
	if atomic.LoadInt32(&shutdownFlag) == 1 {
		fmt.Println("shutdown requested")
	}
}
```

---

## 8. Choosing: Mutex vs Channel vs Atomic — Decision Guide

This is the most important judgment call in concurrent Go programming.

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

// ---- USE CHANNEL WHEN ----
// Transferring ownership of data between goroutines
// Coordinating work (producer-consumer, fan-out, fan-in)
// Signaling events (done, cancel, tick)

func channelExample() {
	jobs := make(chan int, 10)
	results := make(chan int, 10)

	go func() {
		for j := range jobs {
			results <- j * j
		}
		close(results)
	}()

	for i := 1; i <= 5; i++ {
		jobs <- i
	}
	close(jobs)

	for r := range results {
		fmt.Println("result:", r)
	}
}

// ---- USE MUTEX WHEN ----
// Protecting shared state that multiple goroutines read/write
// Guarding a data structure (map, slice, struct)
// Cache, registry, connection pool state

type Registry struct {
	mu    sync.RWMutex
	items map[string]string
}

func (r *Registry) Register(key, val string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.items == nil {
		r.items = make(map[string]string)
	}
	r.items[key] = val
}

func (r *Registry) Lookup(key string) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v, ok := r.items[key]
	return v, ok
}

// ---- USE ATOMIC WHEN ----
// Simple numeric counters (requests served, errors, bytes written)
// Boolean flags (shutdown initiated, feature enabled)
// Metrics/stats that are read-heavy

type Metrics struct {
	requests int64
	errors   int64
}

func (m *Metrics) RecordRequest() { atomic.AddInt64(&m.requests, 1) }
func (m *Metrics) RecordError()   { atomic.AddInt64(&m.errors, 1) }
func (m *Metrics) Snapshot() (reqs, errs int64) {
	return atomic.LoadInt64(&m.requests), atomic.LoadInt64(&m.errors)
}

func main() {
	// Channel: pass work
	channelExample()

	// Mutex: protect shared state
	reg := &Registry{}
	reg.Register("svc-a", "v1.2")
	if v, ok := reg.Lookup("svc-a"); ok {
		fmt.Println("registry:", v)
	}

	// Atomic: count things
	metrics := &Metrics{}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			metrics.RecordRequest()
		}()
	}
	wg.Wait()
	reqs, errs := metrics.Snapshot()
	fmt.Printf("requests=%d errors=%d\n", reqs, errs)

	_ = context.Background() // imported for completeness
}
```

**Decision table:**

| Problem | Tool |
|---------|------|
| Pass data between goroutines | Channel |
| Signal events (done, cancel) | Channel (or context) |
| Protect a map/slice/struct | `sync.Mutex` or `sync.RWMutex` |
| Many readers, rare writers | `sync.RWMutex` |
| Wait for N goroutines | `sync.WaitGroup` |
| One-time initialization | `sync.Once` |
| Simple counter/flag | `sync/atomic` |
| Buffer pool / GC reduction | `sync.Pool` |
| Complex multi-condition wait | `sync.Cond` |

---

## 9. Common Bugs and Pitfalls

### Bug 1: Copying a Mutex

```go
package main

import (
	"fmt"
	"sync"
)

type BadService struct {
	mu   sync.Mutex
	data int
}

// BUG: receiver is a value copy — copies the mutex
func (s BadService) BadMethod() {
	s.mu.Lock() // locks a copy, original unaffected
	defer s.mu.Unlock()
	s.data++ // modifies the copy, not original
	fmt.Println("bad method data:", s.data)
}

// GOOD: pointer receiver — same mutex, same data
func (s *BadService) GoodMethod() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data++
	fmt.Println("good method data:", s.data)
}

func main() {
	svc := BadService{}
	svc.BadMethod()  // operates on a copy
	svc.GoodMethod() // operates on the original
	svc.GoodMethod()
	// go vet will flag BadMethod with "Lock value copied"
}
```

**Detection:** `go vet ./...` reports "assignment copies lock value to X" and "call of X copies lock value".

### Bug 2: Forgetting defer Unlock — Panic Leaves Lock Held

```go
package main

import (
	"fmt"
	"sync"
)

type Store struct {
	mu   sync.Mutex
	data map[string]int
}

// BAD: if panic occurs inside, mu is never unlocked — deadlock
func (s *Store) BadSet(key string, val int) {
	s.mu.Lock()
	if val < 0 {
		panic("negative value") // mu stays locked forever
	}
	s.data[key] = val
	s.mu.Unlock() // never reached on panic
}

// GOOD: defer ensures unlock even on panic
func (s *Store) GoodSet(key string, val int) {
	s.mu.Lock()
	defer s.mu.Unlock() // runs even if function panics
	if val < 0 {
		return // or return an error — defer still unlocks
	}
	if s.data == nil {
		s.data = make(map[string]int)
	}
	s.data[key] = val
}

func main() {
	store := &Store{}
	store.GoodSet("a", 10)
	store.GoodSet("b", 20)
	store.GoodSet("c", -1) // returns without setting
	fmt.Println("store data:", store.data)
}
```

### Bug 3: sync.Pool — Not Resetting Before Use

```go
package main

import (
	"bytes"
	"fmt"
	"sync"
)

var pool = sync.Pool{New: func() interface{} { return new(bytes.Buffer) }}

// BAD: buffer may contain data from previous use
func badProcess(s string) string {
	buf := pool.Get().(*bytes.Buffer)
	defer pool.Put(buf)
	buf.WriteString(s) // APPENDS to potentially dirty buffer
	return buf.String()
}

// GOOD: always reset first
func goodProcess(s string) string {
	buf := pool.Get().(*bytes.Buffer)
	buf.Reset() // clear before use
	defer pool.Put(buf)
	buf.WriteString(s)
	return buf.String()
}

func main() {
	fmt.Println(goodProcess("hello"))
	fmt.Println(goodProcess("world"))
}
```

### Bug 4: WaitGroup Add Inside Goroutine — Race with Wait

```go
package main

import (
	"fmt"
	"sync"
)

func buggyFanOut(items []int) {
	var wg sync.WaitGroup
	results := make(chan int, len(items))

	for _, item := range items {
		// BUG: Add called inside goroutine launch — may race with Wait
		go func(v int) {
			wg.Add(1) // WRONG: called after goroutine starts
			defer wg.Done()
			results <- v * v
		}(item)
	}

	wg.Wait() // may return before any goroutine calls Add(1)
	close(results)
	for r := range results {
		fmt.Println(r)
	}
}

func correctFanOut(items []int) {
	var wg sync.WaitGroup
	results := make(chan int, len(items))

	for _, item := range items {
		wg.Add(1) // CORRECT: Add called before goroutine starts
		go func(v int) {
			defer wg.Done()
			results <- v * v
		}(item)
	}

	wg.Wait()
	close(results)
	for r := range results {
		fmt.Println(r)
	}
}

func main() {
	correctFanOut([]int{1, 2, 3, 4, 5})
}
```

### Bug 5: sync.Once Masking Initialization Errors

```go
package main

import (
	"errors"
	"fmt"
	"sync"
)

// BAD: errors from Once initialization are silently lost
var (
	once      sync.Once
	badClient interface{}
)

func getBadClient() interface{} {
	once.Do(func() {
		// if this fails, badClient stays nil but Once won't retry
		badClient = nil // imagine this returned an error
	})
	return badClient // may be nil, caller must check
}

// GOOD: use mutex + error return for fallible initialization
type SafeClient struct {
	mu     sync.Mutex
	client interface{}
	err    error
	done   bool
}

func (c *SafeClient) Get() (interface{}, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return c.client, c.err
	}
	// attempt initialization
	client, err := func() (interface{}, error) {
		// simulate initialization that might fail
		return struct{ Name string }{"client"}, nil
	}()
	if err != nil {
		c.err = err
		// NOTE: we do NOT set c.done = true here — allow retry
		return nil, err
	}
	c.client = client
	c.done = true
	return c.client, nil
}

func main() {
	sc := &SafeClient{}
	client, err := sc.Get()
	if err != nil {
		fmt.Println("init failed:", err)
		return
	}
	fmt.Println("client:", client)

	// Demonstrate Once limitation
	_ = errors.New("example")
	fmt.Println("Once does not retry on failure — use mutex pattern for fallible init")
}
```

---

## Summary Reference

| Primitive | Use Case | Key Method | Critical Rule |
|-----------|----------|------------|---------------|
| `sync.Mutex` | Protect shared data | `Lock` / `Unlock` | Always `defer Unlock` |
| `sync.RWMutex` | Protect read-heavy data | `RLock` / `Lock` | Use when reads >> writes |
| `sync.WaitGroup` | Wait for N goroutines | `Add` / `Done` / `Wait` | `Add` before goroutine launch |
| `sync.Once` | One-time init | `Do` | Won't retry on panic |
| `sync.Cond` | Wait for a condition | `Wait` / `Broadcast` | Check condition in `for` loop |
| `sync.Pool` | Reuse objects | `Get` / `Put` | Always `Reset` before use |
| `sync/atomic` | Simple numeric ops | `AddInt64` / `LoadInt64` | Only for simple scalars |
