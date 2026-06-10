# Go Memory Management & Garbage Collection

## What Is This?

Go uses automatic memory management with a concurrent garbage collector (GC): you allocate memory by creating values and the runtime frees it when no more references exist, without requiring `free()` or `delete`. Go's GC is a concurrent, tri-color mark-and-sweep collector that runs alongside your program — it does not "stop the world" for the entire collection, only for very short synchronized pauses measured in hundreds of microseconds. The compiler also performs escape analysis to decide whether each value lives on the stack (cheap, auto-freed when function returns) or the heap (requires GC).

## Why Does It Exist?

Manual memory management (C/C++) causes use-after-free bugs, buffer overflows, and double-free crashes — security vulnerabilities that have cost the industry billions. Languages like Java/C# solved safety with GC but introduced long "stop-the-world" pauses (hundreds of milliseconds to seconds) that made them unsuitable for low-latency systems. Go's designers needed a language safe for network servers handling millions of connections but with latency requirements closer to C than Java. The design decision: a concurrent GC with a hard sub-millisecond pause target, tunable via environment variables, backed by escape analysis to minimize heap allocations in the first place. What was broken without it: you'd either write unsafe C or accept Java's GC pauses in your 99th-percentile latency.

## Who Uses This in Industry?

- **Google**: Go's GC was designed to meet Google's internal SLOs for network services. The GC team at Google tuned it for sub-millisecond STW pauses across services handling petabytes of traffic. Google's use of `GOGC` tuning is documented in their production runbooks — different services set different values based on their memory/CPU tradeoff.
- **Uber**: Uber's Go services (dispatch, maps, fare) process millions of requests/minute. They found that GC pressure from short-lived allocations caused latency spikes. Their engineering blog documents using `sync.Pool` to reduce GC pressure in their high-throughput logging and serialization code, cutting p99 latency by 40%.
- **Cloudflare**: Cloudflare's Go-based DNS resolver and HTTP proxy handle 50+ million requests per second. They tune `GOGC=200` to reduce GC frequency (accepting higher memory use for lower CPU) and use `GOMEMLIMIT` (Go 1.19+) to cap heap size and prevent OOM kills. Their blog details using `go tool pprof` to find allocation hot spots in TLS handshake code.
- **Docker/Kubernetes**: Kubernetes' API server uses escape analysis awareness to avoid allocations in hot paths (request parsing, proto marshaling). The kubelet runs with memory limits enforced by `GOMEMLIMIT` to prevent it from consuming all node memory during GC pressure. Docker's image layer diffing code uses pooled byte buffers to avoid GC churn.

## Industry Standards & Best Practices

**What senior engineers do:**
- Run `go build -gcflags="-m"` to see escape analysis decisions and understand where heap allocations come from.
- Use `go test -memprofile=mem.out` and `go tool pprof mem.out` to find allocation hot spots before optimizing.
- Use `sync.Pool` for frequently-allocated, short-lived objects (buffers, request contexts) — but only after profiling confirms it matters.
- Set `GOMEMLIMIT` in production containers to prevent heap from growing unboundedly before GC kicks in.
- Know when NOT to optimize: premature optimization of GC is the most common form. Profile first.
- Use `b.ReportAllocs()` or `-benchmem` in benchmarks to see allocations per operation.

**What beginners do (and shouldn't):**
- Assume "allocating less is always better" — sometimes a clean, allocating solution is faster than a complex pool-based one due to cache effects.
- Use `sync.Pool` without profiling — pools add complexity and are only effective under specific allocation patterns.
- Ignore `GOMEMLIMIT` — running Go in containers without a memory limit causes OOM kills under GC pressure.
- Try to "force GC" with `runtime.GC()` — this is almost never the right solution and indicates a deeper misunderstanding.

## Why Go's Approach Is Unique

**vs Java (G1GC / ZGC):** Java's GC is region-based and highly configurable but requires JVM flags (-Xms, -Xmx, -XX:+UseG1GC) and expertise to tune. Go's GC is simpler: one knob (`GOGC`), one hard limit (`GOMEMLIMIT`), and it just works for most workloads. Java still has higher GC throughput for long-lived objects; Go optimizes for low-latency with many short-lived allocations.

**vs Python (CPython reference counting):** CPython uses reference counting — memory is freed immediately when the ref count hits zero. This gives deterministic cleanup but causes problems with circular references (requiring a cyclic GC as backup) and makes multithreading slow (GIL). Go's tracing GC handles cycles naturally and has no GIL equivalent.

**vs Node (V8 generational GC):** V8 uses a generational GC (young/old generations) designed for JavaScript's allocation patterns. Go's GC is non-generational — it doesn't separate objects by age. This is intentional: Go's escape analysis means many objects never reach the heap, so generational heuristics provide less benefit.

**The key tradeoff Go made:** Low-latency over maximum throughput. Go's GC will run more often (using more CPU) to keep individual pauses short. If you need maximum throughput (batch processing), increase `GOGC`. If you need minimum memory, decrease it. The defaults target server workloads with latency SLOs.

---

## 1. Stack vs Heap — Where Values Live

### Why Before How

Every variable in Go lives somewhere in memory. The two choices are:
- **Stack**: Fast, no GC needed. Automatically freed when the function returns. Fixed size per goroutine (starts at 2-8KB, grows dynamically). 
- **Heap**: Slower allocation, requires GC. Lives until no more references exist. Essentially unbounded.

The Go compiler's escape analysis decides automatically. You don't annotate with `stack` or `heap` — the compiler infers it. Understanding the rules helps you write allocation-efficient code. The rule of thumb: if a value "escapes" the function that created it (returned to caller, passed to interface, captured in goroutine), it goes to the heap.

```go
// escape/analysis.go
package escape

import "fmt"

// stackAllocated: x never escapes — stays on stack.
// The compiler allocates x in the stack frame of this function.
// When stackAllocated returns, x is gone instantly — no GC needed.
func stackAllocated() int {
	x := 42      // allocated on stack
	return x     // value is COPIED to caller — x itself doesn't escape
}

// heapAllocated: returning a pointer causes the value to escape to heap.
// The compiler sees that *int must outlive this function call, so it allocates
// the int on the heap where GC can manage it.
func heapAllocated() *int {
	x := 42      // x ESCAPES to heap — its address is returned
	return &x    // caller receives a pointer to heap-allocated memory
}

// interfaceEscape: assigning to an interface causes the value to escape.
// Interfaces hold (type, pointer) pairs internally — the concrete value
// must be heap-allocated to be pointer-able.
func interfaceEscape() interface{} {
	x := 42
	return x     // x escapes because interface{} boxes it on the heap
}

// goroutineEscape: variables captured by goroutines escape to heap.
// The goroutine may outlive the function, so captured vars must be on heap.
func goroutineEscape() {
	x := 42
	go func() {
		fmt.Println(x)  // x escapes because goroutine may outlive this function
	}()
}

// noEscape: even though we take an address, the compiler proves it doesn't escape.
// The pointer is only used within this function — stays on stack.
func noEscape() int {
	x := 42
	p := &x        // taking address of x
	*p = 100       // using the pointer locally
	return *p      // returning the VALUE, not the pointer — x does NOT escape
}

// largeStructOnStack: small structs stay on stack,
// very large ones may be moved to heap to avoid stack overflow.
func largeStructOnStack() [8]int {
	// Arrays of reasonable size stay on stack
	arr := [8]int{1, 2, 3, 4, 5, 6, 7, 8}
	return arr // copied to caller
}
```

**See escape analysis decisions:**
```bash
# -m shows escape analysis. -m -m shows more detail.
go build -gcflags="-m" ./escape/

# Output (example):
# escape/analysis.go:14:2: x escapes to heap
# escape/analysis.go:20:2: x escapes to heap
# escape/analysis.go:9:2: x does not escape
```

**Common pitfall:** Returning pointers to avoid large copies is sometimes SLOWER — the copy stays on stack, but the pointer forces heap allocation + GC. For large structs, pass a pointer IN (caller allocates) rather than returning a pointer OUT (callee allocates on heap).

---

## 2. Escape Analysis — Reading the Output

### Why Before How

Escape analysis is the compiler's proof system for determining allocation location. Understanding it lets you spot unintentional heap allocations in hot paths. `go build -gcflags="-m=2"` (two `-m` flags) gives verbose output. The key phrases:
- `"X escapes to heap"` — X will be heap-allocated.
- `"X does not escape"` — X stays on stack.
- `"leaking param X"` — the parameter escapes through the return value or another argument.

```go
// escape/detailed.go
package escape

import "fmt"

// Case 1: fmt.Sprintf causes escape — fmt functions take interface{} args.
// Every value passed to fmt functions escapes to heap.
func fmtEscape() string {
	n := 42
	// n escapes here because fmt.Sprintf takes ...interface{}
	// The int 42 gets boxed into an interface{} on the heap
	return fmt.Sprintf("value: %d", n)
}

// Case 2: Closure capturing a variable causes escape.
func closureEscape() func() int {
	x := 0       // x escapes — captured by returned closure
	return func() int {
		x++      // modifies heap-allocated x
		return x
	}
}

// Case 3: Slice of structs — the slice backing array escapes when it grows
// beyond what the compiler can prove is stack-safe.
func sliceEscape() []int {
	s := make([]int, 0, 10) // s escapes — returned to caller
	for i := 0; i < 10; i++ {
		s = append(s, i)
	}
	return s
}

// Case 4: Interface parameter — passing concrete type as interface causes boxing.
type Stringer interface {
	String() string
}

type myStruct struct{ val int }

func (m myStruct) String() string { return fmt.Sprintf("%d", m.val) }

func interfaceParam(s Stringer) string {
	return s.String()
}

func callInterfaceParam() string {
	ms := myStruct{val: 42}
	// ms escapes when passed to interfaceParam as Stringer interface
	return interfaceParam(ms)
}

// Case 5: No escape — pointer is provably local.
func sumSlice(nums []int) int {
	total := 0
	// p never escapes — only used within this function
	p := &total
	for _, n := range nums {
		*p += n
	}
	return *p
}
```

**Read escape analysis output:**
```bash
go build -gcflags="-m=2" ./escape/ 2>&1 | grep -E "(escapes|does not escape|leaking)"

# Typical output:
# ./detailed.go:10:14: n escapes to heap
# ./detailed.go:19:2: x escapes to heap
# ./detailed.go:26:14: make([]int, 0, 10) escapes to heap
# ./detailed.go:48:2: total does not escape
```

**Production use:** Cloudflare engineers run this on hot paths (request parsing, crypto) to find unexpected allocations. An allocation in a tight loop that runs 50M/sec is 50M GC objects per second — that causes GC pressure.

---

## 3. GC Algorithm — Tri-Color Mark-and-Sweep

### Why Before How

Understanding Go's GC algorithm helps you understand WHY certain patterns cause GC pressure and what the write barrier is. The algorithm in plain English:

**Phases:**
1. **Mark setup** (STW, ~0.1ms): Enable write barriers, take a snapshot of goroutine stacks.
2. **Concurrent mark** (runs with program): Trace all reachable objects starting from roots (globals, stacks). Objects are colored: white (unvisited), grey (found but children not scanned), black (scanned). Write barrier ensures any new pointers created during marking are tracked.
3. **Mark termination** (STW, ~0.1ms): Finalize marking. All remaining white objects are garbage.
4. **Concurrent sweep**: Free white (garbage) objects' memory. Runs concurrently with program.

**Why "write barrier":** If your program creates a new pointer during the concurrent mark phase — `a.next = b` — and the GC has already scanned `a`, it would miss `b`. The write barrier intercepts pointer writes and ensures the GC still sees `b`. Cost: every pointer write has a small overhead during GC.

```go
// gc/pressure.go
package gc

import (
	"runtime"
	"runtime/debug"
	"fmt"
)

// ShowGCStats prints current GC statistics.
// Use this to observe GC behavior before/after optimization.
func ShowGCStats() {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)

	fmt.Printf("GC runs: %d\n", stats.NumGC)
	fmt.Printf("Total pause time: %v\n", stats.PauseTotalNs)
	fmt.Printf("Last GC pause: %v ns\n", stats.PauseNs[(stats.NumGC+255)%256])
	fmt.Printf("Heap in use: %v MB\n", stats.HeapInuse/1024/1024)
	fmt.Printf("Heap alloc: %v MB\n", stats.HeapAlloc/1024/1024)
	fmt.Printf("Next GC target: %v MB\n", stats.NextGC/1024/1024)
	fmt.Printf("GC CPU fraction: %.2f%%\n", stats.GCCPUFraction*100)
}

// HighPressure creates many short-lived objects — high GC pressure.
// Each call to makeNode allocates on the heap.
type Node struct {
	value int
	next  *Node
}

func HighPressure(n int) *Node {
	var head *Node
	for i := 0; i < n; i++ {
		head = &Node{value: i, next: head} // each iteration: one heap allocation
	}
	return head
}

// ObserveGC demonstrates watching GC in action.
func ObserveGC() {
	// Set GC trace: GODEBUG=gctrace=1 ./myprogram
	// Each line shows: gc N @Ts heap_inuse->heap_after_gc/live_heap (wall cpu), @pause_time
	// Example: gc 14 @1.23s 4%: 0.036+1.2+0.034 ms clock, ...

	before := runtime.NumGoroutine()
	HighPressure(100000)
	runtime.GC() // force a GC cycle (rarely needed in production — for demonstration)
	after := runtime.NumGoroutine()

	fmt.Printf("Goroutines: before=%d, after=%d\n", before, after)
	ShowGCStats()
}

// SetGCPercent demonstrates programmatic GOGC control.
// Equivalent to setting GOGC environment variable, but at runtime.
func SetGCPercent(pct int) int {
	// debug.SetGCPercent returns previous value
	// pct=100 (default): GC when heap doubles
	// pct=200: GC when heap triples — less frequent, more memory
	// pct=50: GC when heap grows 50% — more frequent, less memory
	// pct=-1: disable GC entirely (NEVER do this in production)
	return debug.SetGCPercent(pct)
}
```

**Observe GC in production:**
```bash
GODEBUG=gctrace=1 ./myprogram 2>&1 | head -20

# Output format:
# gc 1 @0.023s 4%: 0.019+0.45+0.019 ms clock, 0.019+0.11/0.32/0+0.019 ms cpu, 4->4->2 MB, 5 MB goal, 8 P
# gc N    — GC cycle number
# @Xs     — time since program start
# Y%      — percent of CPU time spent in GC
# A+B+C ms clock — stop-the-world (STW) setup + concurrent mark + STW termination
# X->Y->Z MB — heap before GC -> heap after GC -> live heap
```

---

## 4. GOGC — The Primary Tuning Knob

### Why Before How

`GOGC` controls how aggressively the GC runs. Default is 100, meaning: GC when the heap has grown 100% since the last collection (doubles). Setting it higher means GC runs less often (less CPU, more memory). Lower means more often (more CPU, less memory).

The formula: `NextGC = LiveHeap * (1 + GOGC/100)`

If live heap after GC is 100MB and GOGC=100: next GC at 200MB.
If GOGC=200: next GC at 300MB — less frequent.
If GOGC=50: next GC at 150MB — more frequent.

Cloudflare sets `GOGC=200` for their DNS resolvers — they'd rather use more memory than have CPU spikes from frequent GC. Stripe sets `GOGC=50` for their payment workers — they prefer predictable memory bounds over CPU.

```go
// gc/gogc_demo.go
package gc

import (
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
)

// DemonstrateGOGC shows the effect of different GOGC values.
func DemonstrateGOGC() {
	printStats := func(label string) {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		fmt.Printf("[%s] HeapAlloc=%.1fMB HeapIdle=%.1fMB NumGC=%d\n",
			label,
			float64(m.HeapAlloc)/1e6,
			float64(m.HeapIdle)/1e6,
			m.NumGC,
		)
	}

	allocateData := func() {
		// Allocate ~50MB of data
		data := make([][]byte, 1000)
		for i := range data {
			data[i] = make([]byte, 50*1024) // 50KB each
		}
		_ = data
	}

	// Default GOGC=100
	debug.SetGCPercent(100)
	allocateData()
	printStats("GOGC=100")

	// GOGC=200 — GC less often, use more memory
	debug.SetGCPercent(200)
	allocateData()
	printStats("GOGC=200")

	// GOGC=50 — GC more often, use less memory
	debug.SetGCPercent(50)
	allocateData()
	printStats("GOGC=50")
}

// ConfigureGCFromEnvironment reads GOGC from environment and applies it.
// Production pattern: let operators tune via environment variable.
func ConfigureGCFromEnvironment() {
	if val := os.Getenv("APP_GOGC"); val != "" {
		n, err := strconv.Atoi(val)
		if err != nil || n < -1 {
			fmt.Fprintf(os.Stderr, "invalid APP_GOGC=%q, using default\n", val)
			return
		}
		old := debug.SetGCPercent(n)
		fmt.Printf("GC: set GOGC=%d (was %d)\n", n, old)
	}
}
```

**Set via environment:**
```bash
GOGC=200 ./myserver          # less frequent GC, higher memory
GOGC=off ./myserver          # disable GC entirely — ONLY for short batch jobs
GOGC=50 ./myserver           # more frequent GC, lower memory
```

---

## 5. GOMEMLIMIT — Hard Memory Ceiling (Go 1.19+)

### Why Before How

`GOGC` controls GC frequency relative to heap growth, but doesn't cap absolute memory. A service under load could grow its heap to 10GB before GC kicks in if there's enough live data. In containers with memory limits (Kubernetes pods, ECS tasks), this causes OOM kills — the container is killed by the OS before Go's GC can reclaim memory. `GOMEMLIMIT` sets a hard limit on the Go heap's soft memory ceiling. When heap approaches the limit, Go GC runs more aggressively — accepting higher CPU cost to stay under the limit.

Kubernetes at Google uses `GOMEMLIMIT` set to 90% of the container's memory limit, leaving 10% for non-heap memory (goroutine stacks, OS buffers). This prevents OOM kills.

```go
// gc/memlimit.go
package gc

import (
	"fmt"
	"math"
	"runtime"
	"runtime/debug"
)

// SetMemoryLimit configures Go's soft memory limit.
// This is the recommended production pattern for containerized Go services.
func SetMemoryLimit(limitBytes int64) {
	// debug.SetMemoryLimit sets the soft memory limit for the Go runtime.
	// The runtime will try to keep heap + overhead below this limit by running GC more aggressively.
	// Returns previous limit (math.MaxInt64 = no limit = default).
	previous := debug.SetMemoryLimit(limitBytes)

	if previous == math.MaxInt64 {
		fmt.Printf("MemLimit: set to %.0f MB (was: no limit)\n", float64(limitBytes)/1e6)
	} else {
		fmt.Printf("MemLimit: set to %.0f MB (was: %.0f MB)\n",
			float64(limitBytes)/1e6, float64(previous)/1e6)
	}
}

// ConfigureForContainer is the recommended production setup for containerized services.
// Set GOMEMLIMIT to ~90% of container memory limit to prevent OOM kills.
func ConfigureForContainer(containerMemoryBytes int64) {
	// Leave 10% headroom for goroutine stacks, OS buffers, non-heap memory.
	limit := int64(float64(containerMemoryBytes) * 0.9)
	debug.SetMemoryLimit(limit)

	// Optionally: disable GOGC percent and rely entirely on GOMEMLIMIT.
	// This trades predictable memory bounds for potential higher CPU usage.
	// debug.SetGCPercent(-1) // uncomment if using GOMEMLIMIT as sole control
}

// ShowMemoryInfo prints current memory state vs limits.
func ShowMemoryInfo() {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	limit := debug.SetMemoryLimit(-1) // -1 = query current limit without changing it
	// Note: passing -1 to SetMemoryLimit actually disables the limit in Go 1.19
	// The correct query is via runtime/metrics package:
	// metrics.Read([]metrics.Sample{{Name: "/memory/classes/total:bytes"}})

	fmt.Printf("HeapAlloc:  %.1f MB\n", float64(m.HeapAlloc)/1e6)
	fmt.Printf("HeapSys:    %.1f MB\n", float64(m.HeapSys)/1e6)
	fmt.Printf("HeapInuse:  %.1f MB\n", float64(m.HeapInuse)/1e6)
	fmt.Printf("Sys total:  %.1f MB\n", float64(m.Sys)/1e6)
	if limit != math.MaxInt64 {
		fmt.Printf("MemLimit:   %.1f MB\n", float64(limit)/1e6)
	} else {
		fmt.Println("MemLimit:   none")
	}
}
```

**Production pattern (Kubernetes):**
```go
// main.go — read container memory limit and configure Go runtime
func init() {
	// Read Kubernetes memory limit from downward API or cgroup
	// This is a simplified version — real code reads /sys/fs/cgroup/memory.limit_in_bytes
	if limitStr := os.Getenv("CONTAINER_MEMORY_LIMIT"); limitStr != "" {
		limit, _ := strconv.ParseInt(limitStr, 10, 64)
		if limit > 0 {
			// Set Go memory limit to 90% of container limit
			debug.SetMemoryLimit(int64(float64(limit) * 0.9))
		}
	}
}
```

**Set via environment:**
```bash
GOMEMLIMIT=512MiB ./myserver    # limit to 512MB
GOMEMLIMIT=1GiB ./myserver      # limit to 1GB
```

---

## 6. sync.Pool — Reducing GC Pressure

### Why Before How

`sync.Pool` is a cache of temporary objects. If your code frequently allocates and immediately discards objects (byte buffers, JSON encoders, request structs), those allocations create GC pressure. `sync.Pool` lets you reuse objects: `Get()` retrieves one from the pool (or calls `New` if empty), you use it, then `Put()` returns it to the pool. The pool is cleared on each GC cycle — it reduces allocation rate but doesn't hold objects indefinitely.

Uber's high-throughput logging library (`zap`) uses `sync.Pool` for log entry buffers — avoiding millions of allocations per second. The Go standard library uses `sync.Pool` internally in `encoding/json`, `net/http`, `fmt`.

```go
// pool/buffer_pool.go
package pool

import (
	"bytes"
	"fmt"
	"sync"
)

// ByteBufferPool is a pool of *bytes.Buffer objects.
// Use this when you frequently create and discard byte buffers.
var ByteBufferPool = sync.Pool{
	// New is called when the pool is empty and Get() is called.
	// It must return a pointer — pools work with reference types.
	New: func() interface{} {
		return new(bytes.Buffer)
	},
}

// SerializeData uses a pooled buffer to avoid per-call allocation.
func SerializeData(data map[string]string) string {
	// Get a buffer from the pool (or allocate a new one if pool is empty).
	buf := ByteBufferPool.Get().(*bytes.Buffer)

	// CRITICAL: Reset the buffer before use — it may contain data from a previous use.
	buf.Reset()

	// Use the buffer
	for k, v := range data {
		fmt.Fprintf(buf, "%s=%s\n", k, v)
	}
	result := buf.String()

	// Return the buffer to the pool.
	// After Put(), the caller must NOT use buf — it may be given to another goroutine.
	ByteBufferPool.Put(buf)

	return result
}

// WithoutPool shows the naive approach — every call allocates a new buffer.
func SerializeDataNoPool(data map[string]string) string {
	var buf bytes.Buffer // allocated on heap (escapes via closure-like fmt.Fprintf)
	for k, v := range data {
		fmt.Fprintf(&buf, "%s=%s\n", k, v)
	}
	return buf.String()
}

// JSONEncoderPool demonstrates pooling more complex objects.
// encoding/json's Encoder holds state — pooling avoids re-initialization.
type RequestPool struct {
	pool sync.Pool
}

type Request struct {
	ID      int
	Headers map[string]string
	Body    []byte
}

func NewRequestPool() *RequestPool {
	return &RequestPool{
		pool: sync.Pool{
			New: func() interface{} {
				return &Request{
					Headers: make(map[string]string, 8),
					Body:    make([]byte, 0, 4096),
				}
			},
		},
	}
}

func (p *RequestPool) Get() *Request {
	req := p.pool.Get().(*Request)
	// Reset all fields before returning to caller
	req.ID = 0
	for k := range req.Headers {
		delete(req.Headers, k)
	}
	req.Body = req.Body[:0] // reset slice length, keep capacity
	return req
}

func (p *RequestPool) Put(req *Request) {
	// Only return to pool if it hasn't grown too large
	// (prevents holding onto a 100MB buffer after a large request)
	if cap(req.Body) > 1024*1024 { // > 1MB
		return // let it be GC'd
	}
	p.pool.Put(req)
}
```

```go
// pool/pool_bench_test.go
package pool

import "testing"

// BenchmarkSerialize_Pool vs BenchmarkSerialize_NoPool
// Run: go test -bench=BenchmarkSerialize -benchmem ./pool/...
// Expected: Pool version shows fewer allocs/op
func BenchmarkSerialize_Pool(b *testing.B) {
	data := map[string]string{"key1": "val1", "key2": "val2", "key3": "val3"}
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_ = SerializeData(data)
	}
}

func BenchmarkSerialize_NoPool(b *testing.B) {
	data := map[string]string{"key1": "val1", "key2": "val2", "key3": "val3"}
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_ = SerializeDataNoPool(data)
	}
}
```

**Common pitfall:** Not resetting the object after `Get()`. The pool may return an object used by a previous caller — with residual data. Always reset before use.

**Common pitfall:** Using `sync.Pool` for objects that must not be reused (e.g., objects with finalizers, objects that hold open file handles). Pool is for cheap temporary objects.

**Common pitfall:** Over-pooling. If your allocation hot path is `1000/sec`, pooling saves ~1000 allocations/sec — negligible. Pool at `1,000,000/sec`. Profile first.

---

## 7. Memory Profiling — Finding Allocation Hot Spots

### Why Before How

Memory profiling tells you WHERE in your code heap allocations originate. Before you can fix GC pressure, you must find it. `go tool pprof` is the standard tool. You generate a profile (via `go test -memprofile`, via `net/http/pprof` in a running server, or programmatically), then analyze it. The profile shows: which functions allocated memory, how much, and a call graph.

```go
// profiling/server.go
package profiling

import (
	"net/http"
	_ "net/http/pprof" // side-effect import registers /debug/pprof/ endpoints
	"os"
	"runtime"
	"runtime/pprof"
)

// EnablePprofServer starts the pprof HTTP server.
// NEVER expose this publicly — it reveals internals and is a security risk.
// Bind to localhost or use auth middleware in production.
func EnablePprofServer(addr string) {
	// After importing net/http/pprof, these endpoints are available:
	// GET /debug/pprof/           — index
	// GET /debug/pprof/heap       — heap profile
	// GET /debug/pprof/goroutine  — goroutine stacks
	// GET /debug/pprof/profile?seconds=30  — CPU profile for 30s
	// GET /debug/pprof/allocs     — allocation profile (includes freed objects)
	go http.ListenAndServe(addr, nil)
}

// CaptureHeapProfile writes a heap profile to a file.
// Use this in tests or diagnostic code.
func CaptureHeapProfile(filename string) error {
	f, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer f.Close()

	// Force GC before heap profile to get accurate live object count
	runtime.GC()

	// Write heap profile
	// "heap" profile shows live allocations (at time of GC)
	// "allocs" profile shows all allocations since program start
	return pprof.WriteHeapProfile(f)
}

// AllocationHotspot simulates a common pattern: repeated string conversion.
// This is the kind of function you'd find in a pprof flame graph.
func AllocationHotspot(n int) []string {
	results := make([]string, n)
	for i := 0; i < n; i++ {
		// Each Sprintf allocates: the format string becomes a heap object
		results[i] = fmt.Sprintf("item-%d", i)
	}
	return results
}

// Using strconv is faster and allocates less:
func AllocationOptimized(n int) []string {
	results := make([]string, n)
	for i := 0; i < n; i++ {
		// strconv.AppendInt doesn't allocate if we append to existing buffer
		buf := []byte("item-")
		buf = strconv.AppendInt(buf, int64(i), 10)
		results[i] = string(buf)
	}
	return results
}
```

**Analyze memory profile in tests:**
```bash
# Generate memory profile during benchmark
go test -bench=BenchmarkAllocation -memprofile=mem.out ./profiling/...

# Analyze with pprof
go tool pprof mem.out

# In pprof shell:
# (pprof) top10          — top 10 allocating functions
# (pprof) top10 -cum     — top 10 by cumulative allocations
# (pprof) list Hotspot   — annotated source for AllocationHotspot
# (pprof) web            — flame graph in browser

# One-liner for flame graph
go test -bench=. -memprofile=mem.out ./... && go tool pprof -http=:8080 mem.out
```

**Analyze a live server:**
```bash
# Capture heap profile from running server
curl http://localhost:6060/debug/pprof/heap > heap.out
go tool pprof -http=:8080 heap.out

# Capture 30-second CPU profile
curl "http://localhost:6060/debug/pprof/profile?seconds=30" > cpu.out
go tool pprof -http=:8080 cpu.out
```

---

## 8. Common Memory Leaks in Go

### Why Before How

Go's GC prevents classic memory leaks (forgetting to free) but does NOT prevent logical leaks: cases where objects are reachable but no longer needed. The three most common production leaks:

1. **Goroutine leaks**: A goroutine blocked forever, holding references to objects. Found with `GODEBUG=tracebackancestors=5` or goroutine pprof profile.
2. **Timer leaks**: `time.NewTicker` or `time.NewTimer` not stopped — the timer goroutine runs forever.
3. **Slice growth retention**: A large backing array kept alive by a small slice derived from it.

```go
// leaks/goroutine_leak.go
package leaks

import (
	"context"
	"fmt"
	"runtime"
	"time"
)

// GoroutineLeak: channel that is never closed or sent to.
// The goroutine blocks on <-ch forever, preventing GC of anything it references.
func GoroutineLeak() {
	ch := make(chan int)
	// LEAK: this goroutine will NEVER exit because ch is never closed or sent to.
	// It holds a reference to ch, and ch holds a reference... forever.
	go func() {
		val := <-ch       // blocks forever
		fmt.Println(val)  // never reached
	}()
	// ch goes out of scope here, but the goroutine is still alive.
	// The goroutine count grows every time GoroutineLeak() is called.
}

// GoroutineLeakFixed: use context for cancellation.
// The goroutine exits when ctx is cancelled, even if no value is sent.
func GoroutineLeakFixed(ctx context.Context) {
	ch := make(chan int, 1)
	go func() {
		select {
		case val := <-ch:
			fmt.Println(val)
		case <-ctx.Done():
			return // exits cleanly when context cancelled
		}
	}()
}

// TimerLeak: time.NewTicker not stopped.
func TimerLeak() {
	ticker := time.NewTicker(1 * time.Second)
	// LEAK: ticker.Stop() is never called.
	// The ticker's goroutine runs forever, firing into ticker.C which nobody reads.
	go func() {
		for range ticker.C {
			fmt.Println("tick") // nobody stops this
		}
	}()
}

// TimerLeakFixed: always stop timers.
func TimerLeakFixed(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	go func() {
		defer ticker.Stop() // CORRECT: stop when goroutine exits
		for {
			select {
			case <-ticker.C:
				fmt.Println("tick")
			case <-ctx.Done():
				return // exits cleanly
			}
		}
	}()
}

// SliceRetentionLeak: small slice holds reference to large backing array.
func SliceRetentionLeak() []byte {
	// Read a large file (100MB)
	bigData := make([]byte, 100*1024*1024) // 100MB
	// ... fill bigData ...

	// LEAK: returning a small slice of bigData keeps the entire 100MB array alive!
	// The GC sees that smallSlice references bigData's backing array.
	smallSlice := bigData[100:200]
	return smallSlice // caller holds 100 bytes but 100MB is kept alive
}

// SliceRetentionFixed: copy only what you need.
func SliceRetentionFixed() []byte {
	bigData := make([]byte, 100*1024*1024)
	// ... fill bigData ...

	// CORRECT: copy only the needed bytes into a new, independent slice.
	smallSlice := make([]byte, 100)
	copy(smallSlice, bigData[100:200])
	// bigData is now unreachable — will be GC'd
	return smallSlice
}

// MapGrowthLeak: maps never shrink — removing keys doesn't release memory.
func MapGrowthLeak() {
	m := make(map[string][]byte)

	// Add 1000 entries (each ~1MB)
	for i := 0; i < 1000; i++ {
		m[fmt.Sprintf("key%d", i)] = make([]byte, 1024*1024)
	}

	// Delete all entries — map now holds 0 keys
	for k := range m {
		delete(m, k) // keys removed, VALUES are GC'd
	}

	// SURPRISE: the map itself still holds its internal buckets.
	// Memory for the bucket array is NOT released to OS.
	// The map's capacity doesn't shrink. Adding keys back won't reallocate.
	fmt.Printf("Map len: %d, but internal buckets still allocated\n", len(m))
}

// MapGrowthFixed: replace the map when you need to shrink it.
func MapGrowthFixed(m map[string][]byte) map[string][]byte {
	// To truly release map memory, replace it with a new empty map.
	// The old map becomes garbage-collectable.
	return make(map[string][]byte)
}

// DetectGoroutineLeaks shows how to monitor goroutine count.
// If goroutine count grows indefinitely, you have a leak.
func DetectGoroutineLeaks() {
	before := runtime.NumGoroutine()
	fmt.Printf("Goroutines before: %d\n", before)

	// ... run some code that might leak goroutines ...
	for i := 0; i < 10; i++ {
		GoroutineLeak()
	}

	// Give goroutines time to start
	time.Sleep(10 * time.Millisecond)

	after := runtime.NumGoroutine()
	fmt.Printf("Goroutines after: %d\n", after)
	if after > before+1 {
		fmt.Printf("WARNING: %d goroutines leaked!\n", after-before)
	}
}
```

```go
// leaks/goroutine_leak_test.go
package leaks

import (
	"runtime"
	"testing"
	"time"
)

// TestForGoroutineLeak is a standard pattern from goleak library.
// Can be done manually:
func TestNoGoroutineLeaks(t *testing.T) {
	before := runtime.NumGoroutine()

	// Run the function under test
	ctx, cancel := func() (interface{ Done() <-chan struct{} }, func()) {
		// simplified context for illustration
		done := make(chan struct{})
		return struct{ Done func() <-chan struct{} }{func() <-chan struct{} { return done }},
			func() { close(done) }
	}()
	_ = ctx
	cancel()

	// Allow goroutines to finish
	time.Sleep(50 * time.Millisecond)

	after := runtime.NumGoroutine()
	if after > before {
		t.Errorf("goroutine leak: started with %d, ended with %d", before, after)
	}
}
```

**Check goroutine leaks in production:**
```bash
# View current goroutine stacks
curl http://localhost:6060/debug/pprof/goroutine?debug=2

# If count keeps growing, you have a leak.
# The stack trace shows WHERE goroutines are blocked.
```

---

## Summary: Memory & GC Quick Reference

### Tuning Environment Variables

| Variable | Default | Effect |
|----------|---------|--------|
| `GOGC=100` | 100 | GC when heap doubles. Higher = less GC, more memory. |
| `GOGC=off` | — | Disable GC entirely. Only for short batch jobs. |
| `GOMEMLIMIT=512MiB` | no limit | Hard memory ceiling. Prevents OOM kills in containers. |
| `GODEBUG=gctrace=1` | off | Print GC stats to stderr on each cycle. |
| `GODEBUG=gccheckmark=1` | off | Verify GC correctness (slow — only for debugging). |
| `GOMAXPROCS=4` | num CPUs | Number of OS threads for goroutines. |

### Escape Analysis Cheat Sheet

| Pattern | Escapes? | Why |
|---------|----------|-----|
| Return value (not pointer) | No | Copied to caller's stack |
| Return pointer | Yes | Caller may outlive function |
| Pass to `interface{}` | Yes | Interface boxes value on heap |
| Capture in goroutine | Yes | Goroutine may outlive function |
| Capture in closure (returned) | Yes | Closure may outlive function |
| Large local array | Sometimes | Stack overflow prevention |
| `make([]T, n)` returned | Yes | Caller holds reference |
| Local `make([]T, n)` not returned | No | Compiler-provable stack allocation |

### Diagnostic Commands

```bash
# Escape analysis
go build -gcflags="-m" ./...
go build -gcflags="-m=2" ./...    # verbose

# Memory profile from test
go test -memprofile=mem.out -bench=. ./...
go tool pprof -http=:8080 mem.out

# GC trace
GODEBUG=gctrace=1 ./myprogram

# Live server profiling
curl http://localhost:6060/debug/pprof/heap > heap.out
go tool pprof -http=:8080 heap.out

# Goroutine count
curl http://localhost:6060/debug/pprof/goroutine?debug=1

# Benchmark with allocation stats
go test -bench=. -benchmem ./...
```

### The Optimization Decision Tree

```
Is there a memory problem?
  ↓
Run: go test -memprofile=mem.out -bench=. && go tool pprof mem.out
  ↓
Find top allocating function (pprof top10)
  ↓
Is it in a hot path? (>1M calls/sec or >10% of total allocs)
  ├─ No  → Don't optimize. Move on.
  └─ Yes →
       Is it a short-lived object created frequently?
       ├─ Yes → Consider sync.Pool
       └─ No  →
            Does the value need to be on the heap (escape analysis)?
            ├─ No  → Restructure to avoid escape
            └─ Yes → Accept it. Profile again after other changes.
```
