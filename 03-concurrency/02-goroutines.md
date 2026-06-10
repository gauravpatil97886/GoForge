# Goroutines — Deep Dive

## What Is This?

A goroutine is a lightweight, independently executing function managed by the Go runtime, not the operating system. You launch one with the `go` keyword, and the runtime schedules it onto OS threads transparently. Goroutines start with roughly 2–8 KB of stack and can exist by the millions inside a single process — something impossible with OS threads.

## Why Does It Exist?

OS threads are expensive: each costs 1–2 MB of stack memory, kernel context-switch overhead, and a syscall to create. At Google's scale — millions of simultaneous RPC calls, database queries, and background jobs — allocating one OS thread per task collapses servers. Go's designers needed a concurrency primitive that was cheap enough to use for every network connection, every background task, and every pipeline stage without careful rationing. Goroutines solve this by multiplexing thousands of goroutines onto a small, fixed pool of OS threads, with the Go runtime handling all scheduling in user space.

## Who Uses This in Industry?

- **Google**: Runs goroutine-heavy gRPC servers that handle millions of concurrent RPCs. The original motivation for goroutines was Google's internal RPC infrastructure, where one goroutine per in-flight request is the standard pattern.
- **Uber**: The `uber-go/zap` logger, `uber-go/fx` dependency injection, and virtually all Uber backend services use goroutines. Production Uber services routinely sustain millions of live goroutines per process during peak traffic.
- **Cloudflare**: Their DNS resolver, HTTP proxy (written in Go), and Workers edge infrastructure use goroutine pools to handle 50M+ requests per day. Cloudflare engineers have written extensively about goroutine-per-connection patterns enabling their edge scale.
- **Docker / Kubernetes**: The Docker daemon and the Kubernetes API server, scheduler, and controller-manager are all goroutine-heavy. `kubectl` uses goroutines to parallelize multi-resource operations. The Kubernetes controller runtime spawns one goroutine per watched resource type.
- **Netflix**: Go microservices at Netflix use goroutines for concurrent calls to backing services (Cassandra, EVCache, etc.), collapsing multi-service fan-outs from sequential seconds to tens of milliseconds.
- **Stripe / Twilio**: Payment and messaging APIs use goroutines to process webhook delivery queues, where thousands of outbound HTTP retries run concurrently without thread exhaustion.

## Industry Standards and Best Practices

Senior engineers follow a set of hard rules in production Go:

1. **Every goroutine has a defined exit condition.** You never `go` something without knowing exactly how and when it stops.
2. **Goroutine count is observable.** Production services expose `runtime.NumGoroutine()` as a metric. A leak shows up as a monotonically increasing goroutine count.
3. **Goroutines receive `context.Context`.** Long-running goroutines accept a context so callers can cancel them on shutdown, timeout, or request cancellation.
4. **`errgroup.Group` over raw goroutines + WaitGroup** for any operation that may fail and needs its error returned to the caller.
5. **Worker pools cap concurrency.** Unbounded fan-out (`for _, item := range list { go process(item) }`) is a beginner pattern that creates thundering-herd memory spikes in production. Senior engineers use a semaphore or a fixed-size worker pool.
6. **`-race` flag in CI.** Every production Go codebase runs `go test -race` in its test suite. Data races are undefined behavior.

Beginners start goroutines freely and hope they stop. Senior engineers treat every goroutine as a resource that must be allocated and freed.

## Why Go's Approach Is Unique

| Approach | Model | Cost per unit | Scheduling |
|---|---|---|---|
| Java threads | 1:1 OS thread | ~1 MB stack, kernel context switch | OS kernel |
| Python asyncio | Cooperative coroutines (1 thread) | Very low, but no true parallelism | Event loop (single-threaded) |
| Node.js | Event loop + libuv (1 thread) | Very low, but no true parallelism | Event loop (single-threaded) |
| Go goroutines | M:N (many goroutines : few OS threads) | 2–8 KB stack, user-space switch | Go runtime (GMP scheduler) |

Python and Node achieve concurrency through cooperative yielding — they never actually run two pieces of code simultaneously on different cores. Java achieves parallelism but at the cost of one heavy OS thread per goroutine-equivalent.

Go makes a different tradeoff: it keeps the simplicity of sequential code (you write straight-line `for` loops and function calls), multiplexes many goroutines onto a pool of real OS threads, and achieves both true parallelism and low memory overhead simultaneously. The key design decision was preemptive scheduling inside the Go runtime — goroutines don't have to cooperatively yield; the scheduler preempts them at function call boundaries and (since Go 1.14) at safe points in loops.

---

## Part 1 — Goroutine Internals

### The M:N Scheduler (GMP Model)

The Go runtime implements an M:N scheduler, meaning M goroutines run on N OS threads. The three actors are:

- **G (Goroutine)**: The logical unit of execution. Contains its own stack, instruction pointer, and state.
- **M (Machine)**: An OS thread. The actual CPU context. There are typically `GOMAXPROCS` M's actively running Go code at any time, though more M's may exist blocked in syscalls.
- **P (Processor)**: A scheduling context. Each P has a local run queue of goroutines. There are exactly `GOMAXPROCS` P's (default: number of CPU cores). An M must hold a P to run Go code.

```
         ┌─────────────────────────────────────────┐
         │           Go Runtime Scheduler           │
         │                                          │
         │  Global Run Queue: [G5] [G6] [G7] ...   │
         │                                          │
         │  P0              P1              P2      │
         │  local Q:        local Q:        local Q:│
         │  [G1][G2]        [G3]            [G4]   │
         │     │               │               │   │
         │     M0              M1              M2  │
         │  (OS thread)   (OS thread)    (OS thread)│
         └─────────────────────────────────────────┘
                │               │               │
             CPU core        CPU core        CPU core
```

**Work stealing**: When P1's local queue is empty, it steals half of P0's local queue. This keeps all CPUs busy without any centralized coordination bottleneck.

**Goroutine states**:
- `_Grunnable`: Ready to run, sitting in a run queue.
- `_Grunning`: Currently executing on an M.
- `_Gwaiting`: Blocked (on channel, syscall, mutex, network I/O).
- `_Gdead`: Finished execution, stack can be reused.
- `_Gcopystack`: Stack is being grown (moved to a larger allocation).

### Stack Growth: From Segmented to Contiguous

Early Go (pre-1.3) used **segmented stacks**: when a goroutine's stack overflowed, the runtime allocated a new segment and linked them. This caused the "hot split" problem — a function called in a tight loop that happened to be on a segment boundary would repeatedly trigger allocation and deallocation.

Go 1.3+ uses **contiguous stacks**: when the stack overflows its current allocation, the runtime allocates a new, larger contiguous block (typically double the size), copies all stack frames to the new location (updating all pointers), and frees the old stack. This eliminates hot splits at the cost of occasional O(stack size) copy operations.

The initial goroutine stack is **2 KB** in recent Go versions (it was 8 KB earlier; reduced to save memory for the millions-of-goroutines use case). It grows on demand up to a default maximum of 1 GB (configurable via `GOTRACEBACK` and `debug.SetMaxStack`).

**Example 1 — Observing goroutine stack growth**

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/debug"
)

// recursiveWork forces stack growth by deep recursion.
// In production, deep call chains (e.g. middleware stacks) trigger the same mechanism.
func recursiveWork(depth int) int {
    if depth == 0 {
        return 1
    }
    // This local array forces the stack to hold real data.
    var buf [64]byte
    buf[0] = byte(depth)
    return int(buf[0]) + recursiveWork(depth-1)
}

func main() {
    // Show stack size limit
    fmt.Printf("Max stack size: %d bytes\n", debug.SetMaxStack(1<<30)) // 1 GB default

    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    before := ms.StackInuse

    done := make(chan int)
    go func() {
        result := recursiveWork(10000)
        runtime.ReadMemStats(&ms)
        after := ms.StackInuse
        fmt.Printf("Stack in use before: %d KB\n", before/1024)
        fmt.Printf("Stack in use after:  %d KB\n", after/1024)
        fmt.Printf("Work result (forces no optimization): %d\n", result)
        done <- result
    }()

    <-done
}
```

---

## Part 2 — Creating Goroutines

### The `go` Keyword

The `go` keyword before any function call launches that function as a goroutine. The calling goroutine does not wait — it continues immediately after the `go` statement.

**Example 2 — Fire and forget (and why main() exiting kills goroutines)**

```go
package main

import (
    "fmt"
    "time"
)

func sendEmail(to, subject string) {
    // Simulates a slow external call
    time.Sleep(100 * time.Millisecond)
    fmt.Printf("Email sent to %s: %s\n", to, subject)
}

func main() {
    // WRONG: main exits before goroutine completes.
    // In production, this means work is silently dropped on shutdown.
    go sendEmail("user@example.com", "Welcome!")

    // Without this sleep (or a proper sync mechanism), nothing prints.
    // NEVER use time.Sleep for synchronization in production.
    time.Sleep(200 * time.Millisecond)
    fmt.Println("main done")
}
```

The fundamental rule: **the Go program exits when main() returns, killing all goroutines instantly.** This is why every production goroutine needs a synchronization mechanism.

### Passing Arguments to Goroutines

**Example 3 — Argument capture bug (the classic loop variable trap)**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup

    // WRONG: all goroutines capture the same 'i' variable.
    // By the time any goroutine runs, the loop may have advanced i.
    fmt.Println("=== WRONG: captured loop variable ===")
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Printf("wrong: %d\n", i) // likely prints 5,5,5,5,5
        }()
    }
    wg.Wait()

    fmt.Println("\n=== CORRECT: pass as argument ===")
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) { // id is a copy, not a reference
            defer wg.Done()
            fmt.Printf("correct: %d\n", id) // prints 0,1,2,3,4 (in any order)
        }(i)
    }
    wg.Wait()

    // Go 1.22+ fix: loop variables are per-iteration by default.
    // But knowing WHY is essential for code running on Go 1.21 and below.
}
```

**Note**: Go 1.22 changed loop variable semantics so each iteration gets its own copy of `i`. But understanding the original behavior is critical when reviewing older codebases or code targeting Go 1.21 and below.

### Goroutines from Methods

**Example 4 — Starting goroutines from struct methods (production service pattern)**

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

// MetricsCollector is a typical background-worker struct in production services.
type MetricsCollector struct {
    interval time.Duration
    mu       sync.Mutex
    counts   map[string]int64
}

func NewMetricsCollector(interval time.Duration) *MetricsCollector {
    return &MetricsCollector{
        interval: interval,
        counts:   make(map[string]int64),
    }
}

func (mc *MetricsCollector) Increment(key string) {
    mc.mu.Lock()
    mc.counts[key]++
    mc.mu.Unlock()
}

// Start launches a background goroutine. It accepts a context for cancellation.
// This is the canonical Go pattern for background workers.
func (mc *MetricsCollector) Start(ctx context.Context) {
    go mc.run(ctx) // goroutine from a method — 'mc' receiver is captured safely
}

func (mc *MetricsCollector) run(ctx context.Context) {
    ticker := time.NewTicker(mc.interval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            fmt.Println("MetricsCollector: shutting down")
            return
        case <-ticker.C:
            mc.mu.Lock()
            fmt.Printf("Metrics snapshot: %v\n", mc.counts)
            mc.mu.Unlock()
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    collector := NewMetricsCollector(200 * time.Millisecond)
    collector.Start(ctx)

    for i := 0; i < 10; i++ {
        collector.Increment("requests")
        time.Sleep(50 * time.Millisecond)
    }
    collector.Increment("errors")

    time.Sleep(500 * time.Millisecond)
    cancel() // signal shutdown
    time.Sleep(50 * time.Millisecond) // let the goroutine print its shutdown message
}
```

---

## Part 3 — Synchronization with WaitGroup

`sync.WaitGroup` is the standard mechanism for waiting until a set of goroutines complete. It has three methods: `Add(n)`, `Done()`, and `Wait()`.

**Critical rule**: Call `wg.Add()` before starting the goroutine. Calling it inside the goroutine creates a race where `wg.Wait()` might see zero and return before all goroutines have called `Add`.

**Example 5 — Parallel data processing with WaitGroup (real ETL pattern)**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Record struct {
    ID    int
    Value float64
}

func processRecord(r Record) (float64, error) {
    // Simulate variable-latency processing (e.g., enrichment API call)
    time.Sleep(time.Duration(10+r.ID%5) * time.Millisecond)
    return r.Value * 2.5, nil
}

func processAll(records []Record) []float64 {
    results := make([]float64, len(records))
    var wg sync.WaitGroup

    for i, r := range records {
        wg.Add(1)
        go func(idx int, rec Record) {
            defer wg.Done()
            result, err := processRecord(rec)
            if err != nil {
                fmt.Printf("error processing record %d: %v\n", rec.ID, err)
                return
            }
            results[idx] = result // safe: each goroutine writes to a unique index
        }(i, r)
    }

    wg.Wait()
    return results
}

func main() {
    records := make([]Record, 20)
    for i := range records {
        records[i] = Record{ID: i, Value: float64(i) * 1.5}
    }

    start := time.Now()
    results := processAll(records)
    elapsed := time.Since(start)

    fmt.Printf("Processed %d records in %v\n", len(results), elapsed)
    fmt.Printf("First 5 results: %v\n", results[:5])
    // Sequential would take ~200ms; parallel takes ~15ms
}
```

---

## Part 4 — Goroutine Leaks (The #1 Production Bug)

A goroutine leak occurs when a goroutine is started but never terminates. Unlike memory leaks which show in heap stats, goroutine leaks show as a steadily increasing `runtime.NumGoroutine()` count and eventually cause OOM or latency degradation.

**Common causes**:
1. Goroutine blocked on a channel send/receive with no reader/writer.
2. Goroutine blocked on a mutex that is never unlocked.
3. Goroutine blocked on a network/syscall with no timeout.
4. `select` statement with no `default` and no `done` channel.

**Example 6 — Classic leak: goroutine blocked on channel send forever**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

// LEAKY: this function starts a goroutine that sends to a channel.
// If the caller discards the channel without reading, the goroutine blocks forever.
func startLeakyWorker() {
    ch := make(chan int) // unbuffered
    go func() {
        result := expensiveComputation()
        ch <- result // BLOCKS FOREVER if nobody reads ch
        fmt.Println("worker done") // never reached
    }()
    // ch goes out of scope; goroutine is stuck
}

func expensiveComputation() int {
    time.Sleep(10 * time.Millisecond)
    return 42
}

// FIXED: pass context; goroutine exits on cancellation.
func startSafeWorker(done <-chan struct{}) <-chan int {
    ch := make(chan int, 1) // buffered: goroutine can always send without blocking
    go func() {
        result := expensiveComputation()
        select {
        case ch <- result:
        case <-done: // exit if caller cancelled
        }
    }()
    return ch
}

func main() {
    fmt.Printf("Goroutines at start: %d\n", runtime.NumGoroutine())

    // Create 10 leaky goroutines
    for i := 0; i < 10; i++ {
        startLeakyWorker()
    }

    time.Sleep(50 * time.Millisecond) // let them all block
    fmt.Printf("Goroutines after leak: %d\n", runtime.NumGoroutine())
    // Prints ~11: 1 main + 10 stuck goroutines

    // Compare with safe version
    done := make(chan struct{})
    for i := 0; i < 10; i++ {
        startSafeWorker(done)
    }
    close(done) // signal all workers to exit
    time.Sleep(50 * time.Millisecond)
    fmt.Printf("Goroutines after safe shutdown: %d\n", runtime.NumGoroutine())
    // Prints ~1: only main remains
}
```

### Detecting Leaks with pprof

In production, you expose a `/debug/pprof` endpoint and capture goroutine dumps:

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof" // registers /debug/pprof/* handlers
    "runtime"
    "time"
)

func leakingHandler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan int)
    go func() {
        // This goroutine leaks on every request: ch is never read
        time.Sleep(time.Hour)
        ch <- 1
    }()
    fmt.Fprintln(w, "handled")
}

func main() {
    http.HandleFunc("/work", leakingHandler)

    // pprof endpoint — add this to every production Go service
    go func() {
        fmt.Println("pprof listening on :6060")
        http.ListenAndServe(":6060", nil)
    }()

    http.ListenAndServe(":8080", nil)
}

// To inspect goroutines:
//   curl http://localhost:6060/debug/pprof/goroutine?debug=1
//
// Output includes stack traces like:
//
// goroutine 18 [chan send, 3 minutes]:
// main.leakingHandler.func1()
//         /home/user/main.go:16 +0x44
// created by main.leakingHandler in goroutine 7
//         /home/user/main.go:14 +0x3c
//
// "chan send, 3 minutes" tells you:
//   - The goroutine is blocked on a channel send
//   - It has been blocked for 3 minutes
//   - The file/line shows exactly where it was created
//
// For a full snapshot:
//   go tool pprof http://localhost:6060/debug/pprof/goroutine
//   (pprof) top        -- shows which functions have the most goroutines stuck
//   (pprof) traces     -- shows full stack traces
//   (pprof) list main  -- shows annotated source
```

**Reading a pprof goroutine dump**:

```
goroutine 42 [chan receive, 2 minutes]:     ← state + duration blocked
main.processQueue(0xc0001a6000)             ← function holding the goroutine
        /app/worker.go:87 +0x1c4           ← file:line in that function
created by main.(*Server).Start             ← who launched this goroutine
        /app/server.go:43 +0x78
```

The most important fields are the **state** (`chan receive`, `chan send`, `select`, `IO wait`, `semacquire`) and the **duration** (how long it has been blocked). Any goroutine blocked for more than a few seconds in a healthy service is a leak candidate.

**Example 7 — Monitoring goroutine count as a metric**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

// In production, you'd export this to Prometheus/Datadog instead of printing.
func monitorGoroutines(interval time.Duration, done <-chan struct{}) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()
    var previous int
    for {
        select {
        case <-done:
            return
        case <-ticker.C:
            current := runtime.NumGoroutine()
            delta := current - previous
            sign := "+"
            if delta < 0 {
                sign = ""
            }
            fmt.Printf("goroutines: %d (%s%d)\n", current, sign, delta)
            previous = current
        }
    }
}

func main() {
    done := make(chan struct{})
    go monitorGoroutines(100*time.Millisecond, done)

    // Simulate goroutine growth (leak scenario)
    for i := 0; i < 5; i++ {
        blocked := make(chan int)
        go func() { <-blocked }() // these will block until process exits
        time.Sleep(110 * time.Millisecond)
    }

    // Simulate goroutine cleanup
    time.Sleep(200 * time.Millisecond)
    fmt.Println("--- cleanup ---")

    close(done)
    time.Sleep(50 * time.Millisecond)
}
```

---

## Part 5 — Goroutine Patterns

### Fan-Out: One Spawns Many

Fan-out distributes work across multiple goroutines. The key discipline: **always bound the maximum number of goroutines** using a semaphore or worker pool.

**Example 8 — Bounded fan-out with semaphore (Cloudflare/Stripe style)**

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

// semaphore limits concurrent goroutines using a buffered channel.
// Sending acquires a slot; receiving releases it.
type semaphore chan struct{}

func newSemaphore(n int) semaphore {
    return make(semaphore, n)
}

func (s semaphore) Acquire(ctx context.Context) error {
    select {
    case s <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s semaphore) Release() {
    <-s
}

func fetchURL(ctx context.Context, url string) (string, error) {
    time.Sleep(50 * time.Millisecond) // simulate HTTP call
    return fmt.Sprintf("response from %s", url), nil
}

func fetchAllBounded(ctx context.Context, urls []string, concurrency int) ([]string, error) {
    sem := newSemaphore(concurrency)
    results := make([]string, len(urls))
    errs := make([]error, len(urls))

    var wg sync.WaitGroup
    for i, url := range urls {
        wg.Add(1)
        go func(idx int, u string) {
            defer wg.Done()

            if err := sem.Acquire(ctx); err != nil {
                errs[idx] = err
                return
            }
            defer sem.Release()

            result, err := fetchURL(ctx, u)
            results[idx] = result
            errs[idx] = err
        }(i, url)
    }
    wg.Wait()

    for _, err := range errs {
        if err != nil {
            return nil, err
        }
    }
    return results, nil
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    urls := make([]string, 50)
    for i := range urls {
        urls[i] = fmt.Sprintf("https://api.example.com/item/%d", i)
    }

    start := time.Now()
    // Only 10 goroutines run at a time, regardless of how many URLs there are
    results, err := fetchAllBounded(ctx, urls, 10)
    fmt.Printf("Fetched %d URLs in %v (err: %v)\n", len(results), time.Since(start), err)
}
```

### Worker Pool: Fixed Concurrency

A worker pool pre-allocates a fixed number of goroutines that pull work from a shared channel. This is the standard pattern for CPU-bound processing where you want exactly `GOMAXPROCS` workers.

**Example 9 — Worker pool (Kubernetes controller pattern)**

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

type Job struct {
    ID   int
    Data string
}

type Result struct {
    JobID  int
    Output string
}

func worker(id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
    defer wg.Done()
    for job := range jobs { // exits when jobs channel is closed
        // Simulate CPU-bound work
        time.Sleep(10 * time.Millisecond)
        results <- Result{
            JobID:  job.ID,
            Output: fmt.Sprintf("worker %d processed job %d: %s", id, job.ID, job.Data),
        }
    }
}

func runPool(numWorkers int, jobList []Job) []Result {
    jobs := make(chan Job, len(jobList))
    results := make(chan Result, len(jobList))

    var wg sync.WaitGroup
    for i := 1; i <= numWorkers; i++ {
        wg.Add(1)
        go worker(i, jobs, results, &wg)
    }

    for _, j := range jobList {
        jobs <- j
    }
    close(jobs) // signals workers to exit after draining the queue

    // Close results after all workers are done
    go func() {
        wg.Wait()
        close(results)
    }()

    var collected []Result
    for r := range results {
        collected = append(collected, r)
    }
    return collected
}

func main() {
    numWorkers := runtime.GOMAXPROCS(0) // one worker per CPU core
    fmt.Printf("Running pool with %d workers\n", numWorkers)

    jobs := make([]Job, 40)
    for i := range jobs {
        jobs[i] = Job{ID: i, Data: fmt.Sprintf("payload-%d", i)}
    }

    start := time.Now()
    results := runPool(numWorkers, jobs)
    fmt.Printf("Completed %d jobs in %v\n", len(results), time.Since(start))
}
```

### Background Goroutine with Graceful Shutdown

**Example 10 — Production-grade background worker with shutdown coordination**

```go
package main

import (
    "context"
    "fmt"
    "os"
    "os/signal"
    "syscall"
    "time"
)

type CacheWarmer struct {
    interval time.Duration
}

func (c *CacheWarmer) Run(ctx context.Context) error {
    ticker := time.NewTicker(c.interval)
    defer ticker.Stop()

    fmt.Println("CacheWarmer: started")
    for {
        select {
        case <-ctx.Done():
            // Perform any flush/cleanup before exiting
            fmt.Println("CacheWarmer: context cancelled, flushing...")
            time.Sleep(20 * time.Millisecond) // simulate flush
            fmt.Println("CacheWarmer: shutdown complete")
            return ctx.Err()
        case t := <-ticker.C:
            fmt.Printf("CacheWarmer: warming cache at %v\n", t.Format("15:04:05.000"))
        }
    }
}

func main() {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    warmer := &CacheWarmer{interval: 200 * time.Millisecond}

    // Launch background worker
    done := make(chan error, 1)
    go func() {
        done <- warmer.Run(ctx)
    }()

    // Wait for either SIGINT/SIGTERM or a self-imposed deadline (for demo)
    select {
    case <-ctx.Done():
        fmt.Println("main: received shutdown signal")
    case <-time.After(700 * time.Millisecond):
        fmt.Println("main: demo timeout reached, initiating shutdown")
        stop() // trigger context cancellation
    }

    // Wait for goroutine to finish its cleanup
    if err := <-done; err != nil && err != context.Canceled {
        fmt.Fprintf(os.Stderr, "warmer exited with error: %v\n", err)
        os.Exit(1)
    }
    fmt.Println("main: clean exit")
}
```

### sync.Once for One-Time Initialization

`sync.Once` guarantees a function runs exactly once across all goroutines, even under concurrent calls. It is the standard pattern for lazy singleton initialization.

**Example 11 — sync.Once for connection pool initialization**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type DBPool struct {
    connections []string // simulate connections
}

var (
    dbPool *DBPool
    once   sync.Once
)

func initDB() {
    fmt.Println("initializing DB pool (expensive, happens once)")
    time.Sleep(50 * time.Millisecond) // simulate slow initialization
    dbPool = &DBPool{
        connections: []string{"conn-1", "conn-2", "conn-3"},
    }
}

func GetDB() *DBPool {
    once.Do(initDB) // safe to call from many goroutines; initDB runs exactly once
    return dbPool
}

func main() {
    var wg sync.WaitGroup

    // 20 goroutines all try to get the DB simultaneously
    for i := 0; i < 20; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            db := GetDB()
            fmt.Printf("goroutine %d got DB with %d connections\n", id, len(db.connections))
        }(i)
    }

    wg.Wait()
    // "initializing DB pool" prints exactly once despite 20 concurrent callers
}
```

---

## Part 6 — errgroup for Concurrent Error Handling

`golang.org/x/sync/errgroup` is the production-standard replacement for `sync.WaitGroup` whenever any goroutine can fail. It:
- Cancels all sibling goroutines when the first error occurs.
- Collects and returns the first non-nil error.
- Integrates with `context.Context`.

**Example 12 — Parallel microservice calls with errgroup (Netflix/Uber pattern)**

```go
package main

import (
    "context"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

// In production: each of these is a gRPC or HTTP call to a different microservice.
func fetchUserProfile(ctx context.Context, userID int) (string, error) {
    time.Sleep(30 * time.Millisecond)
    return fmt.Sprintf("profile-%d", userID), nil
}

func fetchUserOrders(ctx context.Context, userID int) ([]string, error) {
    time.Sleep(50 * time.Millisecond)
    return []string{fmt.Sprintf("order-%d-1", userID), fmt.Sprintf("order-%d-2", userID)}, nil
}

func fetchUserRecommendations(ctx context.Context, userID int) ([]string, error) {
    time.Sleep(40 * time.Millisecond)
    // Simulate a transient error
    if userID == 42 {
        return nil, fmt.Errorf("recommendation service unavailable")
    }
    return []string{"item-A", "item-B", "item-C"}, nil
}

type UserPage struct {
    Profile         string
    Orders          []string
    Recommendations []string
}

func buildUserPage(ctx context.Context, userID int) (*UserPage, error) {
    g, ctx := errgroup.WithContext(ctx)

    var page UserPage

    g.Go(func() error {
        profile, err := fetchUserProfile(ctx, userID)
        if err != nil {
            return fmt.Errorf("user profile: %w", err)
        }
        page.Profile = profile
        return nil
    })

    g.Go(func() error {
        orders, err := fetchUserOrders(ctx, userID)
        if err != nil {
            return fmt.Errorf("user orders: %w", err)
        }
        page.Orders = orders
        return nil
    })

    g.Go(func() error {
        recs, err := fetchUserRecommendations(ctx, userID)
        if err != nil {
            return fmt.Errorf("recommendations: %w", err)
        }
        page.Recommendations = recs
        return nil
    })

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return &page, nil
}

func main() {
    ctx := context.Background()

    // Normal user — all services succeed
    start := time.Now()
    page, err := buildUserPage(ctx, 7)
    fmt.Printf("User 7 page built in %v (err: %v)\n", time.Since(start), err)
    if page != nil {
        fmt.Printf("  Profile: %s, Orders: %v, Recs: %v\n",
            page.Profile, page.Orders, page.Recommendations)
    }

    // User 42 — recommendation service fails
    start = time.Now()
    page, err = buildUserPage(ctx, 42)
    fmt.Printf("User 42 page built in %v (err: %v)\n", time.Since(start), err)
    // errgroup returns immediately when any goroutine fails,
    // but already-running goroutines are not interrupted unless they check ctx.Done().
}
```

**Note**: To use errgroup, add it to your module:
```
go get golang.org/x/sync/errgroup
```

---

## Part 7 — The Race Detector

The race detector is a compile-time instrumentation tool that detects concurrent access to shared memory without synchronization. It instruments every memory access and reports races at runtime.

**Enable it**: `go run -race main.go` or `go test -race ./...`

**Example 13 — Demonstrating a data race and fixing it**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

// RACY: concurrent writes to a shared map without synchronization.
// Running with -race will report: "DATA RACE on map"
func racyCounter() map[string]int {
    counts := make(map[string]int)
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counts["requests"]++ // concurrent read-modify-write = data race
        }()
    }
    wg.Wait()
    return counts
}

// SAFE option 1: protect with mutex
func safeCounterMutex() map[string]int {
    counts := make(map[string]int)
    var mu sync.Mutex
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            counts["requests"]++
            mu.Unlock()
        }()
    }
    wg.Wait()
    return counts
}

// SAFE option 2: use sync/atomic for simple integer counters
func safeCounterAtomic() int64 {
    var count int64
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&count, 1) // hardware-level atomic increment
        }()
    }
    wg.Wait()
    return count
}

// SAFE option 3: channel-based ownership transfer (Go's preferred style)
func safeCounterChannel() int {
    inc := make(chan struct{}, 100)
    done := make(chan int)

    go func() { // single goroutine owns the counter
        count := 0
        for range inc {
            count++
        }
        done <- count
    }()

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            inc <- struct{}{}
        }()
    }
    wg.Wait()
    close(inc)
    return <-done
}

func main() {
    // Don't run racyCounter in production — it has undefined behavior.
    // Uncomment to see the race detector report:
    // fmt.Println(racyCounter())

    fmt.Println("mutex counter:", safeCounterMutex()["requests"])
    fmt.Println("atomic counter:", safeCounterAtomic())
    fmt.Println("channel counter:", safeCounterChannel())
}
```

**What the race detector output looks like**:

```
==================
WARNING: DATA RACE
Write at 0x00c0001b4060 by goroutine 7:
  runtime.mapassign_faststr()
      /usr/local/go/src/runtime/map_faststr.go:212 +0x0
  main.racyCounter.func1()
      /home/user/main.go:18 +0x5c

Previous write at 0x00c0001b4060 by goroutine 6:
  runtime.mapassign_faststr()
      /usr/local/go/src/runtime/map_faststr.go:212 +0x0
  main.racyCounter.func1()
      /home/user/main.go:18 +0x5c

Goroutine 7 was created at:
  main.racyCounter()
      /home/user/main.go:17 +0xa4
==================
```

The report gives you: the type of conflict (Write/Write or Read/Write), the exact line number, and which goroutines were involved.

**Race detector cost**: ~5–20x slowdown and 5–10x memory increase. Run in CI, not in production load tests.

---

## Part 8 — Production Best Practices Summary

### Rule 1: Never start a goroutine without knowing how it stops

```go
// BAD: no way to stop this
func startWorker() {
    go func() {
        for {
            doWork()
        }
    }()
}

// GOOD: context-driven lifecycle
func startWorker(ctx context.Context) <-chan error {
    errCh := make(chan error, 1)
    go func() {
        for {
            select {
            case <-ctx.Done():
                errCh <- nil
                return
            default:
                if err := doWork(); err != nil {
                    errCh <- err
                    return
                }
            }
        }
    }()
    return errCh
}
```

### Rule 2: Use errgroup for concurrent operations that return errors

```go
// BAD: errors are lost or need custom wiring
var wg sync.WaitGroup
var firstErr error
for _, url := range urls {
    wg.Add(1)
    go func(u string) {
        defer wg.Done()
        if err := fetch(u); err != nil {
            firstErr = err // DATA RACE: multiple goroutines write firstErr
        }
    }(url)
}

// GOOD: errgroup handles this correctly
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    u := url
    g.Go(func() error {
        return fetch(ctx, u)
    })
}
err := g.Wait() // returns first error, cancels context
```

### Rule 3: Limit concurrency with semaphores or worker pools

```go
// BAD: unbounded — if len(items) == 100,000, you spawn 100,000 goroutines
for _, item := range items {
    go process(item)
}

// GOOD: bounded concurrency
const maxConcurrent = 100
sem := make(chan struct{}, maxConcurrent)
for _, item := range items {
    item := item
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        process(item)
    }()
}
// Drain: wait for all in-flight goroutines to complete
for i := 0; i < cap(sem); i++ {
    sem <- struct{}{}
}
```

### Rule 4: Always pass context to goroutines doing I/O

```go
// BAD: no way to cancel this HTTP call if the parent request times out
go func() {
    resp, err := http.Get("https://external-api.example.com/data")
    // ...
}()

// GOOD: request-scoped context propagates deadlines and cancellation
go func(ctx context.Context) {
    req, _ := http.NewRequestWithContext(ctx, "GET", "https://external-api.example.com/data", nil)
    resp, err := http.DefaultClient.Do(req)
    // If ctx is cancelled (parent request timed out), Do() returns immediately.
    _ = resp
    _ = err
}(ctx)
```

### Rule 5: Use runtime/debug and pprof in production

```go
package main

import (
    "expvar"
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

var goroutineCount = expvar.NewInt("goroutines")

func init() {
    // Publish goroutine count to /debug/vars every 10 seconds
    go func() {
        for {
            goroutineCount.Set(int64(runtime.NumGoroutine()))
            time.Sleep(10 * time.Second)
        }
    }()
}

func main() {
    // Exposes:
    //   /debug/pprof/         — profiling index
    //   /debug/pprof/goroutine — goroutine dump
    //   /debug/vars           — exported variables including goroutine count
    fmt.Println("Listening on :8080")
    http.ListenAndServe(":8080", nil)
}
```

---

## Goroutine State Machine (Reference)

```
          ┌──────────────────────────────────────────────────────────┐
          │                                                          │
  go fn() │              ┌──────────┐     scheduled                 │
 ─────────►  _Grunnable  │  local   │─────────────────► _Grunning   │
          │              │run queue │                       │        │
          │              └──────────┘           preempted   │        │
          │                   ▲                 or yielded  │        │
          │                   │                             │        │
          │              work steal                         │        │
          │               from P                            │        │
          │                   │                             ▼        │
          │              _Grunnable ◄──────────────── I/O complete  │
          │                                    wake                  │
          │                                                 │        │
          │                                    blocked      │        │
          │                                    (chan, mutex) │        │
          │                                                 ▼        │
          │                                           _Gwaiting      │
          │                                                          │
          │  return from fn()                                        │
          │ ─────────────────────────────────────────► _Gdead        │
          │                   (stack reused for next goroutine)      │
          └──────────────────────────────────────────────────────────┘
```

---

## Quick Reference Card

| Operation | Code |
|---|---|
| Start goroutine | `go fn(arg)` |
| Wait for N goroutines | `var wg sync.WaitGroup; wg.Add(1); go func() { defer wg.Done(); ... }(); wg.Wait()` |
| Bounded fan-out | `sem := make(chan struct{}, N)` — send to acquire, receive to release |
| Error collection | `g, ctx := errgroup.WithContext(ctx); g.Go(func() error { ... }); g.Wait()` |
| One-time init | `var once sync.Once; once.Do(initFn)` |
| Goroutine count | `runtime.NumGoroutine()` |
| Race detection | `go test -race ./...` |
| Goroutine dump | `curl localhost:6060/debug/pprof/goroutine?debug=2` |
| Max parallelism | `runtime.GOMAXPROCS(n)` — default: number of CPU cores |
| Stack size limit | `debug.SetMaxStack(bytes)` — default: 1 GB |
