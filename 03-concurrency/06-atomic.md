# Atomic Operations in Go

## What Is This?

Atomic operations are CPU-level instructions that read or write memory in a single, indivisible step — no other goroutine can observe the value mid-operation. The `sync/atomic` package exposes these hardware primitives directly to Go programs. Think of them as the lowest layer of synchronization: no locks, no schedulers, just a single machine instruction that the CPU guarantees cannot be interrupted.

## Why Does It Exist?

Without atomics, even a simple counter increment (`counter++`) is actually three operations: load, add, store. If two goroutines do this simultaneously, one goroutine's write can overwrite the other's, producing a lost update — the classic race condition. Mutexes fix this but carry overhead: goroutines block, the scheduler context-switches, and cache lines bounce between CPU cores. Atomic operations solve the same problem without any of that overhead when the shared state fits in a single word (int32, int64, pointer). Go added `sync/atomic` at the language's inception because high-performance server code — rate limiters, counters, flags — needs lock-free updates that match the speed of hardware.

## Who Uses This in Industry?

- **Google**: Prometheus (the monitoring library used internally everywhere) uses `atomic.Int64` for every metric counter. The `expvar` package in the standard library uses atomics for exported counters. `net/http` uses an atomic for connection state transitions.
- **Uber**: The `zap` logging library uses atomics for its `AtomicLevel` type — a logger whose level can be changed at runtime without pausing any in-flight log writes.
- **Cloudflare**: Their Go-based reverse proxies use atomic swap to update a "current config" pointer when configuration reloads happen, so all in-flight requests keep reading the old config cleanly until the pointer flips.
- **Docker / Kubernetes**: The kubelet uses atomic operations for pod status flags and reference counts. Docker's containerd uses atomic state machines for container lifecycle transitions (created → running → stopped) without locking the whole container record.
- **HashiCorp**: Consul's gossip layer uses atomic counters for sequence numbers and health-check state because the per-node hot paths cannot afford mutex contention.

## Industry Standards & Best Practices

**What senior engineers do:**
- Use atomics exclusively for single-word state: counters, flags, generation numbers, version stamps, and pointer swaps.
- Prefer `atomic.Int64` / `atomic.Bool` (Go 1.19+) over the functional API because the typed structs prevent accidental non-atomic access.
- Always pair atomic pointer updates with a read barrier — load once into a local variable, then use the local variable.
- Benchmark before replacing a mutex with an atomic: under high contention, a single-word atomic wins; for multi-field state, a mutex is cleaner and not always slower.
- Use `CompareAndSwap` (CAS) for state machines where only one goroutine should win a transition.

**What beginners get wrong:**
- Mixing atomic writes with non-atomic reads of the same variable (still a race condition).
- Using `sync/atomic` on a struct field that isn't 64-bit aligned on 32-bit platforms.
- Thinking "I'm using atomics so I don't need to think about ordering" — atomics give sequential consistency only for the specific variable; coordinating multiple variables still requires mutexes or channels.

## Why Go's Approach Is Unique

Java has `java.util.concurrent.atomic.*` with a rich class hierarchy. Python's GIL makes most of this unnecessary (and its `ctypes` atomics are rarely used). Node.js is single-threaded with async I/O so the question barely arises. Go takes a pragmatic middle path: expose the raw hardware primitives through a flat, simple package (`sync/atomic`) and, in Go 1.19, add typed wrappers (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`) that make misuse harder without inventing a class hierarchy. The tradeoff is explicitness over convenience — you must consciously choose an atomic type, making it obvious at the call site that you are doing lock-free programming. The race detector (`go test -race`) catches violations of the "read and write must both be atomic" rule, which is the main safety net.

---

## 1. Basic: The Race Condition and Why Atomics Fix It

Before writing any atomic code, understand what you are preventing. A non-atomic counter increment is three machine instructions. If two goroutines execute them concurrently, one increment is silently lost.

```go
// file: 06-atomic/01-race-demo/main.go
// Run with: go run main.go
// Run with race detector: go run -race main.go
package main

import (
	"fmt"
	"sync"
)

func main() {
	// --- BROKEN: data race on plain integer ---
	var unsafeCounter int
	var wg sync.WaitGroup

	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			unsafeCounter++ // RACE: load + add + store are three operations
		}()
	}
	wg.Wait()
	// Result is unpredictable — will almost never be 1000
	fmt.Println("Unsafe counter (expect <1000):", unsafeCounter)
}
```

**Common pitfall:** Running this without `-race` often prints 1000 on your laptop because your CPU is fast enough that goroutines rarely collide. In production under real concurrency, you lose updates. Always use the race detector during development.

---

## 2. Basic: sync/atomic Functional API

The functional API uses package-level functions. Every function name encodes the type: `AddInt64`, `LoadInt32`, `StoreUint64`, etc.

```go
// file: 06-atomic/02-functional-api/main.go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

func main() {
	var counter int64 // must be int64, not int, for atomic operations

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			atomic.AddInt64(&counter, 1) // indivisible: fetch-and-add
		}()
	}
	wg.Wait()
	// Always prints 1000 — guaranteed
	fmt.Println("Safe counter:", atomic.LoadInt64(&counter))

	// Store: write a value atomically
	atomic.StoreInt64(&counter, 0)
	fmt.Println("After store:", atomic.LoadInt64(&counter)) // 0

	// Swap: atomically replace and return old value
	old := atomic.SwapInt64(&counter, 42)
	fmt.Println("Old:", old, "New:", atomic.LoadInt64(&counter)) // Old: 0, New: 42

	// CompareAndSwap: only writes if current value matches expected
	// CAS is the foundation of all lock-free algorithms
	swapped := atomic.CompareAndSwapInt64(&counter, 42, 100)
	fmt.Println("CAS succeeded:", swapped, "Value:", atomic.LoadInt64(&counter)) // true, 100

	swapped = atomic.CompareAndSwapInt64(&counter, 42, 999) // 42 != 100, fails
	fmt.Println("CAS succeeded:", swapped, "Value:", atomic.LoadInt64(&counter)) // false, 100
}
```

**Why `&counter`?** The functions take a pointer so the compiler can verify the variable's address is passed, not a copy of the value. Passing a copy would silently operate on a temporary and discard the result.

---

## 3. Intermediate: Go 1.19+ Typed Atomics (Preferred Style)

Go 1.19 introduced `atomic.Int32`, `atomic.Int64`, `atomic.Uint32`, `atomic.Uint64`, `atomic.Uintptr`, `atomic.Bool`, and `atomic.Pointer[T]`. These are struct types. The key benefit: you cannot accidentally perform a non-atomic read by writing `val = myAtomicInt64` — the compiler forces you through the `.Load()` / `.Store()` methods.

```go
// file: 06-atomic/03-typed-atomics/main.go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// RateLimiter tracks request counts atomically.
// This is the pattern used in Uber's rate-limiting infrastructure.
type RateLimiter struct {
	count atomic.Int64
	limit int64
}

func (r *RateLimiter) Allow() bool {
	// Add 1 and check if we exceeded the limit
	new := r.count.Add(1)
	return new <= r.limit
}

func (r *RateLimiter) Reset() {
	r.count.Store(0)
}

// FeatureFlag demonstrates atomic.Bool — used by every feature-flagging system.
type FeatureFlag struct {
	enabled atomic.Bool
}

func (f *FeatureFlag) Enable()          { f.enabled.Store(true) }
func (f *FeatureFlag) Disable()         { f.enabled.Store(false) }
func (f *FeatureFlag) IsEnabled() bool  { return f.enabled.Load() }

func main() {
	// --- Rate limiter example ---
	rl := &RateLimiter{limit: 5}
	var wg sync.WaitGroup

	results := make([]bool, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx] = rl.Allow()
		}(i)
	}
	wg.Wait()

	allowed := 0
	for _, r := range results {
		if r {
			allowed++
		}
	}
	fmt.Println("Allowed:", allowed, "(expect 5)") // exactly 5

	// --- Feature flag example ---
	flag := &FeatureFlag{}
	fmt.Println("Flag initially:", flag.IsEnabled()) // false

	flag.Enable()
	fmt.Println("Flag after Enable():", flag.IsEnabled()) // true

	// atomic.Int64 direct usage
	var gen atomic.Int64
	gen.Store(1)
	fmt.Println("Generation:", gen.Load())    // 1
	fmt.Println("Add:", gen.Add(1))           // 2
	fmt.Println("Swap:", gen.Swap(100))       // 2 (old value)
	fmt.Println("CAS:", gen.CompareAndSwap(100, 200)) // true
	fmt.Println("Final:", gen.Load())         // 200
}
```

**Important:** `atomic.Int64` (the struct) has a zero value that is valid and equals 0. Never copy it after first use — always pass by pointer or embed in a struct. The struct contains internal fields the runtime uses for alignment; copying would corrupt them.

---

## 4. Intermediate: atomic.Pointer[T] — Lock-Free Config Reloads

The most powerful typed atomic is `atomic.Pointer[T]`. It enables the "pointer swap" pattern: write a completely new value, then atomically replace the pointer. All readers that already loaded the old pointer finish safely; all new readers get the new value. This is how Cloudflare updates proxy configuration without pausing requests.

```go
// file: 06-atomic/04-atomic-pointer/main.go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Config struct {
	MaxConnections int
	Timeout        time.Duration
	Debug          bool
}

// ConfigManager holds the current config behind an atomic pointer.
// Readers never block. Writers replace the whole config atomically.
type ConfigManager struct {
	current atomic.Pointer[Config]
}

func NewConfigManager(initial *Config) *ConfigManager {
	cm := &ConfigManager{}
	cm.current.Store(initial)
	return cm
}

// Get returns the current config. The returned pointer is stable —
// even if Reload() is called concurrently, the caller can read the
// struct it received without races.
func (cm *ConfigManager) Get() *Config {
	return cm.current.Load()
}

// Reload replaces the current config atomically.
func (cm *ConfigManager) Reload(newCfg *Config) {
	cm.current.Store(newCfg)
}

func main() {
	mgr := NewConfigManager(&Config{
		MaxConnections: 100,
		Timeout:        5 * time.Second,
		Debug:          false,
	})

	var wg sync.WaitGroup

	// Simulate 10 readers continuously reading config
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				cfg := mgr.Get() // atomic load — no lock needed
				_ = cfg.MaxConnections
				time.Sleep(time.Millisecond)
			}
		}(i)
	}

	// Simulate config reload on a separate goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(10 * time.Millisecond)
		mgr.Reload(&Config{
			MaxConnections: 200,
			Timeout:        10 * time.Second,
			Debug:          true,
		})
		fmt.Println("Config reloaded")
	}()

	wg.Wait()
	fmt.Printf("Final config: MaxConnections=%d Debug=%v\n",
		mgr.Get().MaxConnections, mgr.Get().Debug)
	// Output: Final config: MaxConnections=200 Debug=true
}
```

**Why not a mutex?** With a `sync.RWMutex`, every `Get()` acquires a read lock. Under thousands of concurrent requests per second, the lock becomes a shared cache line that bounces between CPU cores. The atomic pointer has no contention at all on reads — the only synchronization cost is a memory barrier, which the CPU handles in hardware.

---

## 5. Intermediate: CAS Loop — The Foundation of Lock-Free Algorithms

`CompareAndSwap` is the atomic primitive that makes lock-free programming possible. The pattern: read current value, compute new value, swap only if current value hasn't changed. If another goroutine changed it first, retry. This is called an optimistic loop.

```go
// file: 06-atomic/05-cas-loop/main.go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// AtomicMax atomically updates max to v if v > max.
// A plain "if v > max { max = v }" is not atomic.
// This CAS loop is used in histogram implementations (Prometheus percentiles).
func AtomicMax(max *atomic.Int64, v int64) {
	for {
		old := max.Load()
		if v <= old {
			return // no update needed
		}
		// Try to swap; if someone else updated max between Load and CAS, retry
		if max.CompareAndSwap(old, v) {
			return
		}
		// CAS failed — another goroutine won the race, retry the loop
	}
}

// StateMachine uses CAS for safe state transitions.
// Only one goroutine can successfully transition from state A to state B.
const (
	StateIdle    int32 = 0
	StateRunning int32 = 1
	StateStopped int32 = 2
)

type Worker struct {
	state atomic.Int32
}

// Start transitions Idle -> Running; returns false if already started.
func (w *Worker) Start() bool {
	return w.state.CompareAndSwap(StateIdle, StateRunning)
}

// Stop transitions Running -> Stopped; returns false if not running.
func (w *Worker) Stop() bool {
	return w.state.CompareAndSwap(StateRunning, StateStopped)
}

func (w *Worker) State() int32 { return w.state.Load() }

func main() {
	// --- AtomicMax demo ---
	var max atomic.Int64
	var wg sync.WaitGroup

	values := []int64{3, 17, 8, 42, 5, 19, 42, 11}
	for _, v := range values {
		wg.Add(1)
		go func(val int64) {
			defer wg.Done()
			AtomicMax(&max, val)
		}(v)
	}
	wg.Wait()
	fmt.Println("Max:", max.Load()) // 42

	// --- State machine demo ---
	w := &Worker{}
	fmt.Println("Start 1:", w.Start()) // true
	fmt.Println("Start 2:", w.Start()) // false — already running
	fmt.Println("State:", w.State())   // 1 (Running)
	fmt.Println("Stop:", w.Stop())     // true
	fmt.Println("State:", w.State())   // 2 (Stopped)
}
```

**Pitfall: ABA problem.** If a value changes from A to B and back to A between your `Load` and `CAS`, the CAS succeeds even though the state changed. For pointers, this can cause subtle bugs. The fix is to use a generation counter alongside the pointer (a "stamped reference"). In practice, Go's garbage collector makes ABA rare for pointers because freed memory is not immediately reused.

---

## 6. Advanced: Memory Ordering and Happens-Before

Go's memory model guarantees: an atomic store in goroutine A happens-before an atomic load of the same variable in goroutine B that observes A's value. This is the key coordination primitive for signaling.

```go
// file: 06-atomic/06-memory-ordering/main.go
package main

import (
	"fmt"
	"sync/atomic"
)

// Classic "message passing" pattern:
// Goroutine 1 writes data, then sets a flag.
// Goroutine 2 waits for the flag, then reads data.
// The atomic store/load on 'ready' creates a happens-before edge,
// so goroutine 2 is guaranteed to see the writes to 'data'.

var data [10]int
var ready atomic.Bool

func producer() {
	// Write to data (non-atomic is fine here)
	for i := range data {
		data[i] = i * i
	}
	// The atomic store creates a happens-before boundary:
	// everything above this line is visible to anyone who loads true from ready
	ready.Store(true)
}

func consumer() {
	// Busy-wait until ready (spin loop — only acceptable in benchmarks/demos)
	for !ready.Load() {
		// In real code, use a channel or sync.WaitGroup instead of spinning
	}
	// Guaranteed: we see the complete data array written by producer
	fmt.Println("data[5] =", data[5]) // always 25
}

func main() {
	go producer()
	consumer() // runs in main goroutine
}
```

**Critical pitfall — non-atomic read + atomic write is still a race:**

```go
// file: 06-atomic/06-memory-ordering/pitfall/main.go
package main

import (
	"sync/atomic"
)

var x int64

func bad() {
	// WRONG: mixing atomic write with non-atomic read
	atomic.StoreInt64(&x, 42) // atomic write
	_ = x                     // non-atomic read — DATA RACE!
	// Both operations must use the atomic API or neither should
}

func good() {
	atomic.StoreInt64(&x, 42)
	_ = atomic.LoadInt64(&x) // correct: atomic read
}

func main() {
	bad()
	good()
}
```

The race detector catches this. The rule: **every access to a variable shared between goroutines must use the same synchronization mechanism**. You cannot mix atomic writes with plain reads of the same variable.

---

## 7. Advanced: Benchmarking Atomic vs Mutex

Understanding when atomics win over mutexes requires measuring. The crossover point depends on contention level and the number of variables being protected.

```go
// file: 06-atomic/07-benchmark/bench_test.go
// Run: go test -bench=. -benchmem -count=3
package atomic_bench

import (
	"sync"
	"sync/atomic"
	"testing"
)

// --- Mutex counter ---
type MutexCounter struct {
	mu    sync.Mutex
	value int64
}

func (c *MutexCounter) Inc() {
	c.mu.Lock()
	c.value++
	c.mu.Unlock()
}

func (c *MutexCounter) Load() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.value
}

// --- Atomic counter ---
type AtomicCounter struct {
	value atomic.Int64
}

func (c *AtomicCounter) Inc() { c.value.Add(1) }
func (c *AtomicCounter) Load() int64 { return c.value.Load() }

// --- RWMutex counter (read-optimized) ---
type RWCounter struct {
	mu    sync.RWMutex
	value int64
}

func (c *RWCounter) Inc() {
	c.mu.Lock()
	c.value++
	c.mu.Unlock()
}

func (c *RWCounter) Load() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.value
}

// Single-goroutine write benchmarks
func BenchmarkMutexInc(b *testing.B) {
	c := &MutexCounter{}
	for i := 0; i < b.N; i++ {
		c.Inc()
	}
}

func BenchmarkAtomicInc(b *testing.B) {
	c := &AtomicCounter{}
	for i := 0; i < b.N; i++ {
		c.Inc()
	}
}

// Parallel benchmarks — simulates real concurrent workload
func BenchmarkMutexIncParallel(b *testing.B) {
	c := &MutexCounter{}
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			c.Inc()
		}
	})
}

func BenchmarkAtomicIncParallel(b *testing.B) {
	c := &AtomicCounter{}
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			c.Inc()
		}
	})
}

func BenchmarkRWMutexIncParallel(b *testing.B) {
	c := &RWCounter{}
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			c.Inc()
		}
	})
}

// Read-heavy benchmark: 95% reads, 5% writes
// This is the realistic pattern for feature flags and config
func BenchmarkMutexReadHeavy(b *testing.B) {
	c := &MutexCounter{}
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			if i%20 == 0 {
				c.Inc()
			} else {
				_ = c.Load()
			}
			i++
		}
	})
}

func BenchmarkAtomicReadHeavy(b *testing.B) {
	c := &AtomicCounter{}
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			if i%20 == 0 {
				c.Inc()
			} else {
				_ = c.Load()
			}
			i++
		}
	})
}

func BenchmarkRWMutexReadHeavy(b *testing.B) {
	c := &RWCounter{}
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			if i%20 == 0 {
				c.Inc()
			} else {
				_ = c.Load()
			}
			i++
		}
	})
}
```

**Typical results on a modern multi-core machine:**

| Benchmark | Single goroutine | Parallel (GOMAXPROCS=8) |
|---|---|---|
| Mutex Inc | ~15 ns/op | ~80 ns/op |
| Atomic Inc | ~5 ns/op | ~12 ns/op |
| RWMutex ReadHeavy | ~30 ns/op | ~18 ns/op |
| Atomic ReadHeavy | ~5 ns/op | ~5 ns/op |

Atomics win by 5-10x on parallel writes and are flat under contention. Mutexes degrade as core count increases because the lock becomes a serial bottleneck. RWMutex is a good middle ground when reads vastly outnumber writes and you need to protect multiple fields.

---

## 8. Advanced: Lock-Free Ring Buffer (Concept + Implementation)

A single-producer, single-consumer lock-free queue is one of the most common data structures in high-performance systems: logger queues, network packet queues, event buses. The key insight: head and tail indices are atomic; the data slots themselves need no synchronization as long as each slot is written by exactly one producer and read by exactly one consumer.

```go
// file: 06-atomic/08-ring-buffer/main.go
// Single-producer, single-consumer lock-free ring buffer.
// Used in: Uber's zap logger (async core), Linux kernel io_uring, DPDK.
package main

import (
	"fmt"
	"sync/atomic"
)

const bufSize = 8 // must be power of 2

type RingBuffer struct {
	head atomic.Uint64 // written by consumer (dequeue)
	_    [56]byte      // padding to avoid false sharing (cache line = 64 bytes)
	tail atomic.Uint64 // written by producer (enqueue)
	_    [56]byte
	buf  [bufSize]atomic.Int64
}

// Enqueue adds v. Returns false if buffer is full.
// Only call from one goroutine (single-producer).
func (r *RingBuffer) Enqueue(v int64) bool {
	tail := r.tail.Load()
	head := r.head.Load()
	if tail-head >= bufSize {
		return false // full
	}
	r.buf[tail%bufSize].Store(v)
	r.tail.Add(1) // publish: consumer sees new tail only after Store above
	return true
}

// Dequeue removes and returns the next value.
// Returns (0, false) if empty. Only call from one goroutine (single-consumer).
func (r *RingBuffer) Dequeue() (int64, bool) {
	head := r.head.Load()
	tail := r.tail.Load()
	if head >= tail {
		return 0, false // empty
	}
	v := r.buf[head%bufSize].Load()
	r.head.Add(1) // consume: producer sees new head only after Load above
	return v, true
}

func main() {
	rb := &RingBuffer{}

	// Producer: enqueue values
	for i := int64(1); i <= 6; i++ {
		ok := rb.Enqueue(i * 10)
		fmt.Printf("Enqueue(%d): %v\n", i*10, ok)
	}

	// Try to enqueue when full (bufSize=8, 6 items in, 2 more fit)
	for i := int64(7); i <= 10; i++ {
		ok := rb.Enqueue(i * 10)
		fmt.Printf("Enqueue(%d): %v\n", i*10, ok)
	}

	// Consumer: dequeue all values
	fmt.Println("--- Dequeue ---")
	for {
		v, ok := rb.Dequeue()
		if !ok {
			break
		}
		fmt.Println("Got:", v)
	}
}
```

**Why the padding (`[56]byte`)?** The `head` and `tail` are on separate cache lines (64 bytes each). Without padding, both fit in the same cache line. The producer writes `tail`, the consumer writes `head` — if they share a cache line, every write by either party invalidates the other's cache entry, forcing a round-trip across CPU cores. This is called **false sharing**, and it can make a "lock-free" structure slower than a mutex. The padding prevents it.

---

## Summary: When to Use What

| Scenario | Tool |
|---|---|
| Single shared counter (metrics, rate limits) | `atomic.Int64` |
| Feature flag or shutdown flag | `atomic.Bool` |
| Config/pointer swap without stopping readers | `atomic.Pointer[T]` |
| State machine transitions (only one winner) | `CompareAndSwap` |
| Multiple fields that must be updated together | `sync.Mutex` |
| Read-heavy multi-field state | `sync.RWMutex` |
| Ordered work with backpressure | `channel` |

The single most important rule: **atomics are for one variable at a time**. The moment you need "update A and B together, consistently," reach for a mutex or a channel.
