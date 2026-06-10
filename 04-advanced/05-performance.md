# Go Performance Optimization

## What Is This?

Go performance optimization is the discipline of measuring, profiling, and tuning Go programs to run faster, use less memory, and handle more concurrency. It covers everything from micro-level choices (which data structure to use, whether a value escapes to the heap) to macro-level architecture decisions (how to size goroutine pools, when to use sync.Pool). Performance work is always measurement-driven: you profile first, then optimize.

## Why Does It Exist?

Go was designed from day one to be fast. The language eliminates a garbage-collected VM startup cost, compiles to native machine code, and gives developers direct control over memory layout through value types and arrays of structs. However, even idiomatic Go code can contain hidden allocations, lock contention, or cache-unfriendly data patterns that become bottlenecks under production load. The performance tooling (pprof, the testing benchmark framework, the escape analysis flags) exists because at internet scale, a 10% CPU reduction on a fleet of thousands of servers translates directly to millions of dollars in infrastructure savings and meaningfully lower latency for end users.

## Who Uses This in Industry?

- **Google**: Go powers internal RPC infrastructure (gRPC servers), search backend sidecars, and the Go compiler itself. Performance engineers at Google routinely use pprof CPU and heap profiles to reduce allocation rates in hot paths, targeting sub-millisecond P99 latency for internal services.
- **Uber**: Uber's real-time dispatch engine is written in Go. Engineers use GOMAXPROCS tuning, goroutine pool sizing, and sync.Pool for ride-matching objects that are allocated and discarded millions of times per minute across their global fleet.
- **Cloudflare**: Cloudflare processes 50+ million HTTP requests per day through Go-based services including their DNS resolver, Workers runtime edge proxy, and DDoS mitigation pipeline. They publish extensively on escape analysis and zero-copy I/O optimizations to keep per-request cost in the nanoseconds range.
- **Docker / containerd**: The container runtime's hot path for image layer reads uses io.Reader chaining and zero-copy sendfile syscalls. Benchmark regressions block releases.
- **Kubernetes**: The API server's serialization path was profiled and optimized to reduce JSON encoding allocations. The scheduler uses object pools for predicate evaluation structs to keep GC pauses minimal during pod scheduling bursts.

## Industry Standards and Best Practices

**Senior engineers do:**
- Profile before optimizing. Every optimization decision is backed by a pprof profile showing the actual hotspot.
- Write benchmarks that live alongside production code (`_test.go` files with `Benchmark*` functions) and run them in CI to catch regressions.
- Target allocations first. In a garbage-collected language, allocation rate directly drives GC pressure, which drives latency variance (stop-the-world pauses and GC assist tax).
- Use `go tool pprof` interactively, read flame graphs, and look at the `web` or `svg` output before touching code.
- Set `GOGC` and `GOMEMLIMIT` based on measured behavior, not guesswork.
- Validate optimizations with before/after benchmarks stored in version control.

**Beginners do:**
- Optimize blindly based on intuition ("maps are slow, I'll use a slice").
- Ignore allocations and then wonder why GC pauses are hurting P99 latency.
- Write benchmarks that the compiler optimizes away (the result is discarded).
- Tune GOMAXPROCS without measuring lock contention or goroutine scheduling overhead.

## Why Go's Approach Is Unique

**Compared to Java**: Java's JIT compiler can perform speculative optimizations at runtime that Go's AOT compiler cannot. But Go eliminates JVM warmup time and gives programmers direct control over data layout — a `[]MyStruct` in Go is a flat array of structs in memory, not an array of pointers to heap-allocated objects. This makes Go cache-friendly by default in a way Java rarely is.

**Compared to Python**: Python's GIL prevents true parallel execution of CPU-bound code. Go's goroutines run on multiple OS threads (controlled by GOMAXPROCS) with true parallelism and a runtime scheduler designed for high concurrency. A Go HTTP server handles 100,000 concurrent connections on a single process routinely; Python needs multiprocessing or async frameworks to approach this.

**Compared to Node.js**: Node's single-threaded event loop means CPU-bound work blocks the entire server. Go's goroutine model lets CPU-bound and I/O-bound work interleave naturally. Go also compiles to native code, so number-crunching is orders of magnitude faster.

**The key tradeoff Go made**: Go chose a concurrent, non-generational GC with short stop-the-world pauses over a high-throughput generational GC. This means Go's GC is excellent for latency-sensitive services (pauses are typically under 1ms) but total GC throughput is lower than Java's G1GC for allocation-heavy workloads. This is why Go performance work focuses intensely on reducing allocations.

---

## 1. Benchmarking: Measuring Before Optimizing

### Why Before How

You cannot optimize what you cannot measure. Go's testing package includes a first-class benchmarking facility. Benchmarks belong in `_test.go` files, run with `go test -bench=.`, and produce throughput numbers and allocation counts. The most common beginner mistake is writing a benchmark that the compiler eliminates through dead-code removal — the result is a nonsensically fast number that means nothing.

The two rules for valid benchmarks:
1. Use the input in a way the compiler cannot prove is unused (assign to a package-level `var sink` or use `testing.B.ReportAllocs`).
2. Reset the timer if you have setup code: `b.ResetTimer()`.

### Basic Benchmark

```go
// bench_basic_test.go
package performance

import (
	"strings"
	"testing"
)

// Package-level sink prevents the compiler from eliminating benchmark results.
var sink string
var sinkInt int

// BenchmarkStringConcat measures naive string concatenation with +
func BenchmarkStringConcat(b *testing.B) {
	words := []string{"hello", " ", "world", " ", "from", " ", "go"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result := ""
		for _, w := range words {
			result += w
		}
		sink = result // prevent dead-code elimination
	}
}

// BenchmarkStringsBuilder measures strings.Builder (idiomatic approach)
func BenchmarkStringsBuilder(b *testing.B) {
	words := []string{"hello", " ", "world", " ", "from", " ", "go"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var sb strings.Builder
		for _, w := range words {
			sb.WriteString(w)
		}
		sink = sb.String()
	}
}

// BenchmarkStringsBuilderPrealloc measures strings.Builder with pre-allocation
func BenchmarkStringsBuilderPrealloc(b *testing.B) {
	words := []string{"hello", " ", "world", " ", "from", " ", "go"}
	total := 0
	for _, w := range words {
		total += len(w)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var sb strings.Builder
		sb.Grow(total) // pre-allocate exactly the right capacity
		for _, w := range words {
			sb.WriteString(w)
		}
		sink = sb.String()
	}
}

// BenchmarkStringsJoin measures strings.Join (standard library optimized)
func BenchmarkStringsJoin(b *testing.B) {
	words := []string{"hello", " ", "world", " ", "from", " ", "go"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sink = strings.Join(words, "")
	}
}
```

Run with:
```
go test -bench=BenchmarkString -benchmem -count=3 ./...
```

Expected output (approximate):
```
BenchmarkStringConcat-8             5000000    310 ns/op    112 B/op    6 allocs/op
BenchmarkStringsBuilder-8          10000000    142 ns/op     64 B/op    2 allocs/op
BenchmarkStringsBuilderPrealloc-8  20000000     71 ns/op     16 B/op    1 allocs/op
BenchmarkStringsJoin-8             20000000     68 ns/op     16 B/op    1 allocs/op
```

**Key insight**: The allocation count drives the performance difference. Each `+` on a string allocates a new backing array. Builder with `Grow` does one allocation for the final string.

### Benchmark with Sub-benchmarks

```go
// bench_table_test.go
package performance

import (
	"fmt"
	"testing"
)

// BenchmarkMapVsSliceLookup compares map lookup vs linear slice scan
// at different sizes. This is a table-driven benchmark pattern.
func BenchmarkMapVsSliceLookup(b *testing.B) {
	sizes := []int{10, 100, 1000, 10000}

	for _, size := range sizes {
		size := size // capture loop variable (pre-Go 1.22 requirement)

		// Build test data
		m := make(map[int]bool, size)
		s := make([]int, size)
		for i := 0; i < size; i++ {
			m[i] = true
			s[i] = i
		}
		target := size / 2 // search for the middle element

		b.Run(fmt.Sprintf("Map/size=%d", size), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				sinkInt = 0
				if m[target] {
					sinkInt = 1
				}
			}
		})

		b.Run(fmt.Sprintf("Slice/size=%d", size), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				sinkInt = 0
				for _, v := range s {
					if v == target {
						sinkInt = 1
						break
					}
				}
			}
		})
	}
}
```

Run with:
```
go test -bench=BenchmarkMapVsSliceLookup -benchmem ./...
```

Expected output shows that at size=10, slice scan is competitive with map lookup (map has hash overhead). At size=1000+, map O(1) wins decisively.

---

## 2. Profiling with pprof

### Why Before How

pprof is Go's built-in profiler. It collects samples of what the program is doing (CPU), what memory it has allocated (heap), how goroutines are blocked (block profile), and how long mutexes are contended (mutex profile). You cannot fix performance problems you cannot see. pprof shows you where time is actually spent, which is almost never where you think.

There are two ways to use pprof:
1. **Benchmark profiles**: Add `-cpuprofile` and `-memprofile` flags to `go test`.
2. **Runtime HTTP endpoint**: Import `_ "net/http/pprof"` and hit `/debug/pprof/` in a running server.

### CPU Profiling in Tests

```go
// profile_test.go
package performance

import (
	"encoding/json"
	"testing"
)

// Simulate a struct we serialize frequently
type Order struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	Amount    float64 `json:"amount"`
	Status    string  `json:"status"`
	ItemCount int     `json:"item_count"`
}

func makeOrders(n int) []Order {
	orders := make([]Order, n)
	for i := range orders {
		orders[i] = Order{
			ID:        int64(i),
			UserID:    int64(i * 100),
			Amount:    float64(i) * 9.99,
			Status:    "pending",
			ItemCount: i % 10,
		}
	}
	return orders
}

var jsonSink []byte

func BenchmarkJSONMarshal(b *testing.B) {
	orders := makeOrders(100)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		data, err := json.Marshal(orders)
		if err != nil {
			b.Fatal(err)
		}
		jsonSink = data
	}
}
```

Run with CPU and memory profiles:
```bash
go test -bench=BenchmarkJSONMarshal -benchmem \
  -cpuprofile=cpu.prof \
  -memprofile=mem.prof \
  ./...

# Analyze CPU profile interactively
go tool pprof cpu.prof
# In pprof shell: top10, list json.Marshal, web (opens flame graph)

# Analyze memory profile
go tool pprof mem.prof
# In pprof shell: top10 -cum, list makeOrders
```

### Runtime pprof HTTP Endpoint (Production Use)

```go
// main_pprof.go
package main

import (
	"fmt"
	"log"
	"net/http"
	_ "net/http/pprof" // registers /debug/pprof/ routes as a side effect
	"time"
)

func expensiveHandler(w http.ResponseWriter, r *http.Request) {
	// Simulate CPU-bound work
	result := 0
	for i := 0; i < 1_000_000; i++ {
		result += i
	}
	fmt.Fprintf(w, "result: %d\n", result)
}

func main() {
	// Application routes
	mux := http.NewServeMux()
	mux.HandleFunc("/compute", expensiveHandler)

	// pprof routes are registered on http.DefaultServeMux by the import above.
	// Serve pprof on a SEPARATE internal port — never expose it publicly.
	go func() {
		log.Println("pprof listening on :6060")
		// This uses http.DefaultServeMux which has /debug/pprof/ registered
		if err := http.ListenAndServe("localhost:6060", nil); err != nil {
			log.Fatal(err)
		}
	}()

	// Application server on public port
	server := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	log.Println("App listening on :8080")
	log.Fatal(server.ListenAndServe())
}
```

While the server is running, collect profiles:
```bash
# 30-second CPU profile
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Heap profile (current allocations)
go tool pprof http://localhost:6060/debug/pprof/heap

# Goroutine dump (see all goroutines and their stacks)
curl http://localhost:6060/debug/pprof/goroutine?debug=2

# Block profile (goroutines blocked on channel/mutex operations)
# Must enable first: runtime.SetBlockProfileRate(1)
go tool pprof http://localhost:6060/debug/pprof/block

# Mutex contention profile
# Must enable first: runtime.SetMutexProfileFraction(1)
go tool pprof http://localhost:6060/debug/pprof/mutex
```

---

## 3. Memory Optimization: Reducing Allocations

### Why Before How

Every allocation in Go eventually triggers garbage collection. The GC pauses goroutines briefly (stop-the-world) and runs concurrent mark/sweep phases that compete with your application for CPU time. Reducing allocation rate is the single highest-leverage performance optimization in most Go services. The goal is not zero allocations — it is eliminating unnecessary allocations in hot paths.

### Understanding Escape Analysis

The Go compiler performs escape analysis to decide whether a variable can live on the goroutine's stack (fast, no GC) or must be heap-allocated (slower, GC-managed). You can inspect decisions with:
```bash
go build -gcflags='-m -m' ./...
```

```go
// escape_analysis.go
package performance

import "fmt"

// stackAlloc: point stays on stack. The compiler sees it does not escape.
// gcflags output: "point does not escape"
func stackAlloc() int {
	point := struct{ x, y int }{1, 2} // stack allocated
	return point.x + point.y
}

// heapAlloc: returning a pointer forces heap allocation.
// gcflags output: "&point escapes to heap"
func heapAlloc() *struct{ x, y int } {
	point := struct{ x, y int }{1, 2}
	return &point // pointer escapes: heap allocated
}

// interfaceBoxing: assigning a concrete type to interface{} causes heap allocation
// for non-pointer types. The value must be addressable for the interface.
func interfaceBoxing() {
	var values []interface{}
	for i := 0; i < 1000; i++ {
		values = append(values, i) // each `i` is boxed: 1000 heap allocations
	}
	_ = values
}

// NoBoxing: use a typed slice to avoid interface boxing
func noBoxing() {
	values := make([]int, 0, 1000) // one allocation for the backing array
	for i := 0; i < 1000; i++ {
		values = append(values, i) // no boxing, no per-element allocation
	}
	_ = values
}

// formatInts demonstrates fmt.Sprintf allocation vs manual conversion
func formatIntsAlloc(n int) string {
	return fmt.Sprintf("value=%d", n) // allocates a string each call
}

// Better: use strconv for hot paths
func formatIntsNoAlloc(n int) []byte {
	buf := make([]byte, 0, 20)
	buf = append(buf, "value="...)
	buf = appendInt(buf, int64(n))
	return buf
}

func appendInt(b []byte, n int64) []byte {
	if n < 0 {
		b = append(b, '-')
		n = -n
	}
	start := len(b)
	for {
		b = append(b, byte('0'+n%10))
		n /= 10
		if n == 0 {
			break
		}
	}
	// reverse digits
	end := len(b) - 1
	for start < end {
		b[start], b[end] = b[end], b[start]
		start++
		end--
	}
	return b
}
```

Benchmark comparing the approaches:
```go
// escape_bench_test.go
package performance

import (
	"fmt"
	"strconv"
	"testing"
)

var strSink string
var bytesSink []byte

func BenchmarkFmtSprintf(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		strSink = fmt.Sprintf("value=%d", i)
	}
}

func BenchmarkStrconvItoa(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		strSink = "value=" + strconv.Itoa(i)
	}
}

func BenchmarkAppendInt(b *testing.B) {
	b.ReportAllocs()
	buf := make([]byte, 0, 20)
	for i := 0; i < b.N; i++ {
		buf = buf[:0]                // reset length, keep capacity
		buf = append(buf, "value="...)
		buf = appendInt(buf, int64(i))
		bytesSink = buf
	}
}
```

Expected output:
```
BenchmarkFmtSprintf-8      10000000    145 ns/op    24 B/op    2 allocs/op
BenchmarkStrconvItoa-8     20000000     82 ns/op    16 B/op    2 allocs/op
BenchmarkAppendInt-8      100000000     12 ns/op     0 B/op    0 allocs/op
```

### sync.Pool: Reusing Expensive Objects

`sync.Pool` is a cache of temporary objects that can be reused across goroutines. Use it when:
- You create and discard objects at a high rate.
- Object creation is expensive (large allocation, complex initialization).
- Objects are not shared across goroutines simultaneously.

```go
// pool_example.go
package performance

import (
	"bytes"
	"encoding/json"
	"sync"
)

// bufferPool holds *bytes.Buffer objects for JSON encoding.
// The pool handles the GC pressure: objects in the pool are
// cleared before a GC cycle, so they do not hold memory permanently.
var bufferPool = sync.Pool{
	New: func() interface{} {
		return bytes.NewBuffer(make([]byte, 0, 4096))
	},
}

// MarshalJSON encodes v to JSON using a pooled buffer.
// Allocation-free in the hot path (after pool is warm).
func MarshalJSON(v interface{}) ([]byte, error) {
	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset() // clear previous contents, keep allocated capacity

	enc := json.NewEncoder(buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		bufferPool.Put(buf) // always return to pool, even on error
		return nil, err
	}

	// Copy result before returning buffer to pool.
	// The caller owns the returned slice; the pool owns the buffer.
	result := make([]byte, buf.Len())
	copy(result, buf.Bytes())

	bufferPool.Put(buf)
	return result, nil
}

// workerPool demonstrates using sync.Pool for per-goroutine scratch buffers
type ScratchBuffer struct {
	Data []byte
}

var scratchPool = sync.Pool{
	New: func() interface{} {
		return &ScratchBuffer{Data: make([]byte, 0, 64*1024)} // 64KB scratch
	},
}

func ProcessData(input []byte) []byte {
	scratch := scratchPool.Get().(*ScratchBuffer)
	scratch.Data = scratch.Data[:0] // reset

	// Do work using scratch.Data as a temporary buffer...
	scratch.Data = append(scratch.Data, input...)
	// ... transformations ...

	result := make([]byte, len(scratch.Data))
	copy(result, scratch.Data)

	scratchPool.Put(scratch)
	return result
}
```

```go
// pool_bench_test.go
package performance

import (
	"bytes"
	"encoding/json"
	"testing"
)

type Event struct {
	Name    string `json:"name"`
	Payload string `json:"payload"`
	Count   int    `json:"count"`
}

func marshalWithNewBuffer(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func BenchmarkMarshalNewBuffer(b *testing.B) {
	e := Event{Name: "click", Payload: "button-submit", Count: 42}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = marshalWithNewBuffer(e)
	}
}

func BenchmarkMarshalPooledBuffer(b *testing.B) {
	e := Event{Name: "click", Payload: "button-submit", Count: 42}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = MarshalJSON(e)
	}
}
```

Expected output:
```
BenchmarkMarshalNewBuffer-8    3000000    490 ns/op    512 B/op    4 allocs/op
BenchmarkMarshalPooledBuffer-8 5000000    210 ns/op     48 B/op    1 allocs/op
```

### Pre-allocation: Slice and Map Sizing

```go
// prealloc.go
package performance

// slowAppend builds a slice without pre-allocation.
// append() doubles capacity repeatedly: 1, 2, 4, 8, 16... causing
// O(log n) allocations and copies.
func slowAppend(n int) []int {
	var result []int
	for i := 0; i < n; i++ {
		result = append(result, i)
	}
	return result
}

// fastAppend pre-allocates with make([]T, 0, n).
// One allocation, zero copies.
func fastAppend(n int) []int {
	result := make([]int, 0, n)
	for i := 0; i < n; i++ {
		result = append(result, i)
	}
	return result
}

// slowMap builds a map without size hint.
// Map rehashes as it grows.
func slowMap(n int) map[int]string {
	m := make(map[int]string)
	for i := 0; i < n; i++ {
		m[i] = "value"
	}
	return m
}

// fastMap pre-sizes the map to avoid rehashing.
func fastMap(n int) map[int]string {
	m := make(map[int]string, n) // hint: n buckets initially
	for i := 0; i < n; i++ {
		m[i] = "value"
	}
	return m
}
```

```go
// prealloc_bench_test.go
package performance

import "testing"

var sliceSink []int
var mapSink map[int]string

func BenchmarkSlowAppend(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		sliceSink = slowAppend(10000)
	}
}

func BenchmarkFastAppend(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		sliceSink = fastAppend(10000)
	}
}

func BenchmarkSlowMap(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		mapSink = slowMap(10000)
	}
}

func BenchmarkFastMap(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		mapSink = fastMap(10000)
	}
}
```

Expected output:
```
BenchmarkSlowAppend-8    1000    1.8 ms/op    386024 B/op    20 allocs/op
BenchmarkFastAppend-8    2000    0.7 ms/op     81920 B/op     1 allocs/op
BenchmarkSlowMap-8        500    3.2 ms/op    687952 B/op   215 allocs/op
BenchmarkFastMap-8        800    1.9 ms/op    325664 B/op     8 allocs/op
```

---

## 4. CPU Optimization: Value Types and Cache Locality

### Why Before How

Modern CPUs are bottlenecked not by computation but by memory access. An L1 cache hit costs ~1ns; a RAM access costs ~100ns. Data structures that are laid out contiguously in memory (arrays of values, structs with related fields grouped together) get loaded into cache in cache lines of 64 bytes. Pointer-heavy structures (linked lists, arrays of pointers to heap objects) cause cache misses at every step. Go's value types — using `[]MyStruct` instead of `[]*MyStruct` — are the idiomatic way to get cache-friendly data layout.

```go
// cache_layout.go
package performance

// Point3D is a small value type: 24 bytes, packed contiguously in a slice.
type Point3D struct {
	X, Y, Z float64
}

// Node is a pointer-heavy struct: each element in a slice requires
// dereferencing a pointer to reach the actual data.
type Node struct {
	Value int
	Next  *Node
}

// sumPointsValue: accesses a contiguous array of Point3D structs.
// Cache-friendly: one cache line holds 2-3 structs.
func sumPointsValue(points []Point3D) float64 {
	sum := 0.0
	for _, p := range points {
		sum += p.X + p.Y + p.Z
	}
	return sum
}

// sumPointsPointer: accesses an array of *Point3D pointers.
// Each element is a pointer to a potentially scattered heap location.
// Cache-unfriendly: each access may miss the cache.
func sumPointsPointer(points []*Point3D) float64 {
	sum := 0.0
	for _, p := range points {
		sum += p.X + p.Y + p.Z
	}
	return sum
}
```

```go
// cache_bench_test.go
package performance

import "testing"

const N = 100_000

var floatSink float64

func BenchmarkValueSlice(b *testing.B) {
	points := make([]Point3D, N)
	for i := range points {
		points[i] = Point3D{float64(i), float64(i + 1), float64(i + 2)}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		floatSink = sumPointsValue(points)
	}
}

func BenchmarkPointerSlice(b *testing.B) {
	points := make([]*Point3D, N)
	for i := range points {
		p := &Point3D{float64(i), float64(i + 1), float64(i + 2)}
		points[i] = p
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		floatSink = sumPointsPointer(points)
	}
}
```

Expected output:
```
BenchmarkValueSlice-8      20000     65 µs/op    0 B/op    0 allocs/op
BenchmarkPointerSlice-8     5000    310 µs/op    0 B/op    0 allocs/op
```

The value slice is ~5x faster due to cache locality.

### Avoiding Interface Boxing in Hot Paths

```go
// interface_boxing.go
package performance

import "sort"

// slowSort uses sort.Interface with boxing overhead.
// Each comparison call goes through an interface dispatch.
type IntSlice []int

func (s IntSlice) Len() int           { return len(s) }
func (s IntSlice) Less(i, j int) bool { return s[i] < s[j] }
func (s IntSlice) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

func sortWithInterface(data []int) {
	sort.Sort(IntSlice(data))
}

// fastSort uses sort.Slice which takes a closure.
// The closure is inlined by the compiler in most cases.
func sortWithSlice(data []int) {
	sort.Slice(data, func(i, j int) bool {
		return data[i] < data[j]
	})
}

// fastestSort uses sort.Ints which is specialized for []int.
// No interface dispatch, no closure overhead.
func sortInts(data []int) {
	sort.Ints(data)
}
```

---

## 5. Concurrency Optimization

### Why Before How

Go's concurrency model is a strength, but misuse creates bottlenecks. Three common concurrency performance problems are:
1. **Lock contention**: Too many goroutines fighting over the same mutex.
2. **Goroutine explosion**: Creating thousands of goroutines that all block waiting for I/O, consuming memory (each goroutine has a ~2KB initial stack).
3. **Wrong GOMAXPROCS**: The default is `runtime.NumCPU()` which is usually correct, but containerized environments may need tuning with `automaxprocs`.

### Goroutine Pool Pattern

```go
// worker_pool.go
package performance

import (
	"context"
	"sync"
)

// Task represents a unit of work.
type Task struct {
	ID   int
	Data []byte
}

// Result is the outcome of processing a Task.
type Result struct {
	TaskID int
	Output []byte
	Err    error
}

// WorkerPool processes tasks concurrently with a fixed number of goroutines.
// This prevents goroutine explosion when processing large batches.
type WorkerPool struct {
	workers int
	tasks   chan Task
	results chan Result
	wg      sync.WaitGroup
}

// NewWorkerPool creates a pool with `workers` goroutines and buffered channels.
// Buffer size of 2*workers prevents producers from blocking while workers are busy.
func NewWorkerPool(workers int) *WorkerPool {
	p := &WorkerPool{
		workers: workers,
		tasks:   make(chan Task, workers*2),
		results: make(chan Result, workers*2),
	}
	return p
}

// Start launches the worker goroutines. Call Stop() to shut down.
func (p *WorkerPool) Start(ctx context.Context, process func(Task) Result) {
	for i := 0; i < p.workers; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for {
				select {
				case task, ok := <-p.tasks:
					if !ok {
						return // channel closed: shut down
					}
					p.results <- process(task)
				case <-ctx.Done():
					return
				}
			}
		}()
	}
}

// Submit sends a task to the pool. Blocks if the task buffer is full.
func (p *WorkerPool) Submit(t Task) {
	p.tasks <- t
}

// Results returns the channel of completed results for consumption.
func (p *WorkerPool) Results() <-chan Result {
	return p.results
}

// Stop closes the task channel and waits for all workers to finish.
func (p *WorkerPool) Stop() {
	close(p.tasks)
	p.wg.Wait()
	close(p.results)
}
```

### Reducing Lock Contention with Sharding

```go
// sharded_map.go
package performance

import (
	"hash/fnv"
	"sync"
)

const shards = 32 // must be a power of 2 for fast modulo

// ShardedMap distributes keys across 32 independent maps, each with its own
// mutex. Under high concurrency, this reduces lock contention by 32x compared
// to a single map with a single mutex.
type ShardedMap struct {
	shards [shards]struct {
		mu sync.RWMutex
		m  map[string]interface{}
	}
}

// NewShardedMap initializes all shard maps.
func NewShardedMap() *ShardedMap {
	sm := &ShardedMap{}
	for i := range sm.shards {
		sm.shards[i].m = make(map[string]interface{})
	}
	return sm
}

func (sm *ShardedMap) shardIndex(key string) int {
	h := fnv.New32a()
	h.Write([]byte(key))
	return int(h.Sum32()) & (shards - 1) // fast modulo for power-of-2
}

// Set stores key-value in the appropriate shard.
func (sm *ShardedMap) Set(key string, value interface{}) {
	idx := sm.shardIndex(key)
	sm.shards[idx].mu.Lock()
	sm.shards[idx].m[key] = value
	sm.shards[idx].mu.Unlock()
}

// Get retrieves a value from the appropriate shard. Uses RLock for read concurrency.
func (sm *ShardedMap) Get(key string) (interface{}, bool) {
	idx := sm.shardIndex(key)
	sm.shards[idx].mu.RLock()
	v, ok := sm.shards[idx].m[key]
	sm.shards[idx].mu.RUnlock()
	return v, ok
}
```

```go
// contention_bench_test.go
package performance

import (
	"fmt"
	"sync"
	"testing"
)

// naiveMap: single mutex for all keys — high contention under concurrency.
type naiveMap struct {
	mu sync.RWMutex
	m  map[string]interface{}
}

func newNaiveMap() *naiveMap {
	return &naiveMap{m: make(map[string]interface{})}
}
func (n *naiveMap) Set(k string, v interface{}) {
	n.mu.Lock()
	n.m[k] = v
	n.mu.Unlock()
}
func (n *naiveMap) Get(k string) (interface{}, bool) {
	n.mu.RLock()
	v, ok := n.m[k]
	n.mu.RUnlock()
	return v, ok
}

func BenchmarkNaiveMapParallel(b *testing.B) {
	m := newNaiveMap()
	// pre-populate
	for i := 0; i < 1000; i++ {
		m.Set(fmt.Sprintf("key%d", i), i)
	}
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			key := fmt.Sprintf("key%d", i%1000)
			m.Set(key, i)
			m.Get(key)
			i++
		}
	})
}

func BenchmarkShardedMapParallel(b *testing.B) {
	m := NewShardedMap()
	// pre-populate
	for i := 0; i < 1000; i++ {
		m.Set(fmt.Sprintf("key%d", i), i)
	}
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			key := fmt.Sprintf("key%d", i%1000)
			m.Set(key, i)
			m.Get(key)
			i++
		}
	})
}
```

Run with multiple goroutines to observe contention:
```
go test -bench=BenchmarkNaiveMapParallel,BenchmarkShardedMapParallel -benchmem -cpu=8 ./...
```

Expected output (8 CPUs):
```
BenchmarkNaiveMapParallel-8     1000000    1540 ns/op    ...
BenchmarkShardedMapParallel-8   5000000     290 ns/op    ...
```

---

## 6. I/O Optimization

### Why Before How

Unbuffered I/O is catastrophically slow. A single `write()` syscall for each byte of output means millions of context switches between user space and kernel space per second. `bufio.Writer` batches writes into 4KB (default) or custom-sized chunks, flushing to the OS in large calls. Similarly, `bufio.Reader` reads ahead in large chunks and serves your application from a memory buffer. For network I/O at high request rates, the difference between buffered and unbuffered can be 10-50x in throughput.

```go
// io_optimization.go
package performance

import (
	"bufio"
	"io"
	"os"
	"strings"
)

// writeUnbuffered writes lines one at a time, each triggering a syscall.
// On 100,000 lines: ~100,000 write() syscalls.
func writeUnbuffered(filename string, lines []string) error {
	f, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer f.Close()

	for _, line := range lines {
		if _, err := io.WriteString(f, line+"\n"); err != nil {
			return err
		}
	}
	return nil
}

// writeBuffered writes through bufio.Writer.
// bufio batches writes into 4096-byte chunks: ~25x fewer syscalls.
func writeBuffered(filename string, lines []string) error {
	f, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer f.Close()

	w := bufio.NewWriterSize(f, 64*1024) // 64KB buffer
	for _, line := range lines {
		if _, err := w.WriteString(line); err != nil {
			return err
		}
		if err := w.WriteByte('\n'); err != nil {
			return err
		}
	}
	return w.Flush() // CRITICAL: flush remaining buffered data
}

// readLineByLine reads a file one byte at a time (inefficient).
func readLineByLine(r io.Reader) (int, error) {
	buf := make([]byte, 1)
	lines := 0
	for {
		_, err := r.Read(buf)
		if err == io.EOF {
			break
		}
		if err != nil {
			return lines, err
		}
		if buf[0] == '\n' {
			lines++
		}
	}
	return lines, nil
}

// countLinesBuffered uses bufio.Scanner for efficient line reading.
func countLinesBuffered(r io.Reader) (int, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB max line length
	lines := 0
	for scanner.Scan() {
		lines++
	}
	return lines, scanner.Err()
}

// transformStream demonstrates io.Reader chaining for zero-intermediate-buffer transforms.
// Reads from input, transforms in memory, writes to output — without loading all data.
func transformStream(dst io.Writer, src io.Reader) error {
	// Use TeeReader or custom reader chain for streaming transforms.
	// Here: uppercase transform on a stream.
	r := &uppercaseReader{src: src}
	_, err := io.Copy(dst, r)
	return err
}

type uppercaseReader struct {
	src io.Reader
}

func (u *uppercaseReader) Read(p []byte) (int, error) {
	n, err := u.src.Read(p)
	for i := 0; i < n; i++ {
		if p[i] >= 'a' && p[i] <= 'z' {
			p[i] -= 32
		}
	}
	return n, err
}

// sendfileCopy uses io.Copy which on Linux with *os.File src+dst calls sendfile(2).
// sendfile is a zero-copy syscall: data moves from file to file without
// being copied into user-space buffers.
func sendfileCopy(dst, src *os.File) error {
	_, err := io.Copy(dst, src)
	return err
}

// BuildQuery demonstrates []byte vs string for query building to avoid allocations.
func BuildQuery(table string, fields []string, limit int) string {
	// strings.Builder is stack-friendly and avoids intermediate string allocations.
	var sb strings.Builder
	sb.Grow(64 + len(table) + len(fields)*20)

	sb.WriteString("SELECT ")
	for i, f := range fields {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(f)
	}
	sb.WriteString(" FROM ")
	sb.WriteString(table)
	if limit > 0 {
		sb.WriteString(" LIMIT ")
		sb.WriteString(itoa(limit))
	}
	return sb.String()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append(buf, byte('0'+n%10))
		n /= 10
	}
	// reverse
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}
```

---

## 7. Compiler Optimizations: Inlining and Escape Analysis

### Why Before How

The Go compiler performs several automatic optimizations. Understanding them helps you write code that the compiler can optimize effectively, and helps you avoid patterns that defeat optimization.

**Function inlining**: Small functions (complexity budget <= 80 AST nodes) are inlined at the call site, eliminating the function call overhead and enabling further optimizations like constant folding. You can check inlining decisions with `-gcflags='-m'`.

**Escape analysis**: As covered above, values that don't escape to the heap live on the stack. Stack allocation is dramatically cheaper (no GC involvement).

```go
// compiler_opts.go
package performance

// inlineable: small enough to be inlined. The compiler will paste its body
// at every call site. gcflags output: "can inline add"
func add(a, b int) int {
	return a + b
}

// notInlineable: contains a loop and multiple operations.
// Exceeds the inlining budget. gcflags output: "cannot inline processSlice: ..."
func processSlice(s []int) int {
	result := 0
	for _, v := range s {
		if v > 0 {
			result += v * v
		}
	}
	return result
}

// Use //go:noinline to prevent inlining for benchmarking purposes.
// Without this, a benchmarked function may be inlined, making the
// benchmark measure nothing useful.
//
//go:noinline
func addNoInline(a, b int) int {
	return a + b
}

// Demonstrate compiler constant folding:
// The compiler evaluates this at compile time.
const (
	KB = 1024
	MB = KB * KB // folded to 1048576 at compile time
	GB = MB * KB // folded to 1073741824 at compile time
)

// BoundsCheckElimination: Go performs bounds check elimination when
// the compiler can prove an index is always in range.
func sumKnownLength(a [4]int) int {
	// The compiler knows len(a)==4, so accesses 0-3 have no bounds check.
	return a[0] + a[1] + a[2] + a[3]
}

// Force bounds check elimination manually by asserting length.
func sumSliceFast(s []int) int {
	if len(s) < 4 {
		return 0
	}
	s = s[:4:4] // slice expression: compiler knows len==cap==4
	return s[0] + s[1] + s[2] + s[3]
}
```

Check compiler decisions:
```bash
# See inlining and escape decisions
go build -gcflags='-m' ./...

# Verbose version showing reasoning
go build -gcflags='-m -m' ./...

# Disable bounds check elimination to see its impact
go test -bench=BenchmarkSumSlice -gcflags='-B' ./...  # disable bounds checks
go test -bench=BenchmarkSumSlice ./...               # with bounds checks (default)
```

---

## 8. Real-World Optimization: HTTP Handler

This example applies all the above techniques to a realistic HTTP handler that processes JSON order batches.

```go
// optimized_handler.go
package performance

import (
	"encoding/json"
	"net/http"
	"sync"
)

// OrderRequest is an incoming batch of orders to process.
type OrderRequest struct {
	Orders []Order `json:"orders"`
}

// OrderResponse is the result of processing.
type OrderResponse struct {
	Processed int     `json:"processed"`
	Total     float64 `json:"total"`
	Errors    []string `json:"errors,omitempty"`
}

// ---- Naive version: allocations in every request ----

func naiveOrderHandler(w http.ResponseWriter, r *http.Request) {
	var req OrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	resp := OrderResponse{}
	for _, order := range req.Orders {
		resp.Processed++
		resp.Total += order.Amount
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) // allocates an encoder each call
}

// ---- Optimized version: pooled decoder/encoder, pre-sized response ----

var (
	// requestPool pools OrderRequest objects. The Decode call reuses
	// the existing slice allocation inside req.Orders on subsequent calls.
	requestPool = sync.Pool{
		New: func() interface{} {
			return &OrderRequest{
				Orders: make([]Order, 0, 100),
			}
		},
	}

	// responseEncoder pools the JSON encode buffer.
	responseBufferPool = sync.Pool{
		New: func() interface{} {
			b := make([]byte, 0, 512)
			return &b
		},
	}
)

func optimizedOrderHandler(w http.ResponseWriter, r *http.Request) {
	// Get pooled request struct and reset its slice.
	req := requestPool.Get().(*OrderRequest)
	req.Orders = req.Orders[:0] // reset length, keep capacity

	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		requestPool.Put(req)
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	// Build response in-place (no intermediate allocations).
	resp := OrderResponse{} // stack-allocated (small struct, no pointers that escape)
	for _, order := range req.Orders {
		resp.Processed++
		resp.Total += order.Amount
	}

	requestPool.Put(req)

	// Encode response using pooled buffer.
	bufPtr := responseBufferPool.Get().(*[]byte)
	buf := (*bufPtr)[:0]

	var err error
	buf, err = json.Marshal(resp)
	if err != nil {
		responseBufferPool.Put(bufPtr)
		http.Error(w, "encoding failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", itoa(len(buf)))
	w.WriteHeader(http.StatusOK)
	w.Write(buf)

	*bufPtr = buf
	responseBufferPool.Put(bufPtr)
}
```

---

## 9. GOMAXPROCS and Container Awareness

```go
// maxprocs.go
package main

import (
	"fmt"
	"runtime"
)

// In containers (Docker, Kubernetes), runtime.NumCPU() returns the HOST CPU count,
// not the container's CPU quota. A container with 0.5 CPU quota on a 64-core host
// will set GOMAXPROCS=64, causing massive over-scheduling.
//
// Use the automaxprocs package to set GOMAXPROCS from the cgroup CPU quota:
//   import _ "go.uber.org/automaxprocs"
//
// Manual approach for demonstration:
func configureGOMAXPROCS() {
	// Default: use all CPUs. Good for bare-metal.
	current := runtime.GOMAXPROCS(0) // 0 = query without changing
	fmt.Printf("Current GOMAXPROCS: %d\n", current)
	fmt.Printf("Host CPUs: %d\n", runtime.NumCPU())

	// For a service that is I/O bound (database calls, network):
	// More goroutines than CPUs is fine — they spend most time waiting.
	// GOMAXPROCS doesn't limit goroutine count, only parallel execution.

	// For a service that is CPU bound (image processing, JSON parsing):
	// GOMAXPROCS should match available CPU quota.
	// In a container with 2 CPU cores:
	// runtime.GOMAXPROCS(2)
}

func main() {
	configureGOMAXPROCS()
}
```

---

## 10. GOMEMLIMIT and GC Tuning

```go
// gc_tuning.go
package main

import (
	"fmt"
	"runtime"
	"runtime/debug"
)

// GC tuning levers:
//
// GOGC (environment variable or debug.SetGCPercent):
//   Default: 100 (GC triggers when heap doubles from last collection)
//   Lower value (e.g., 50): more frequent GC, lower peak memory, more CPU for GC
//   Higher value (e.g., 200): less frequent GC, higher peak memory, less CPU for GC
//   GOGC=off: disable GC entirely (dangerous in long-running servers)
//
// GOMEMLIMIT (Go 1.19+):
//   Sets a soft memory limit. GC increases its frequency to stay under the limit.
//   Prevents OOM kills in containers with strict memory limits.
//   Replaces the need to tune GOGC for memory-constrained environments.

func printGCStats() {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	fmt.Printf("HeapAlloc:    %d KB\n", stats.HeapAlloc/1024)
	fmt.Printf("HeapSys:      %d KB\n", stats.HeapSys/1024)
	fmt.Printf("NumGC:        %d\n", stats.NumGC)
	fmt.Printf("PauseTotalNs: %d µs\n", stats.PauseTotalNs/1000)
	fmt.Printf("GCCPUFraction: %.4f\n", stats.GCCPUFraction)
}

func tuneGC() {
	// For latency-sensitive services: reduce GC frequency to lower CPU overhead,
	// use GOMEMLIMIT to prevent OOM instead of relying on GOGC alone.
	//
	// In code (also settable via env):
	debug.SetGCPercent(200)              // less frequent GC
	debug.SetMemoryLimit(512 * 1024 * 1024) // 512MB soft limit (Go 1.19+)

	// Force a GC cycle and print stats
	runtime.GC()
	printGCStats()
}

func main() {
	tuneGC()
}
```

---

## Common Pitfalls

1. **Benchmarking without `-benchmem`**: You see ns/op but miss allocs/op, which is often the real bottleneck.

2. **Discarding benchmark results**: The compiler eliminates dead code. Always assign to a package-level `sink` variable.

3. **Not resetting the timer after setup**: `b.ResetTimer()` after expensive setup prevents setup time from skewing results.

4. **sync.Pool not returning objects on error paths**: Always `Put` back to the pool in all code paths, including error paths.

5. **Forgetting `bufio.Flush()`**: A buffered writer that is never flushed silently drops data.

6. **pprof on the public port**: The `/debug/pprof/` endpoint can be used to DoS your service (it runs expensive profiling) and leaks internal information. Always serve it on an internal-only address.

7. **Premature optimization**: Profile first. "Optimizing" code that isn't in a hot path wastes time and introduces bugs.

8. **GOMEMLIMIT too tight**: Setting GOMEMLIMIT to exactly your container's memory limit leaves no headroom for the Go runtime's own overhead. Set it to ~90% of container memory.
