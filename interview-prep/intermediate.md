> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# GoForge Interview Questions — Intermediate Level

50 Q&A pairs for mid-level Go engineer interviews.

---

## Q1. How does the GMP scheduler work in Go?

**Answer:**
Go's runtime uses a three-layer scheduler model called GMP:
- **G (Goroutine):** The unit of execution, a lightweight thread managed by the runtime.
- **M (Machine):** An OS thread. M executes Goroutines.
- **P (Processor):** A logical processor that holds a local run queue of Goroutines and is required for M to execute Go code.

At startup, the runtime creates `GOMAXPROCS` P's. Each P has a local run queue. When a goroutine is created, it is placed in the local run queue of the current P. If a P's queue is full, goroutines go to the global run queue. M's are assigned a P to run; without a P, an M can only do limited work (like syscalls). Work-stealing allows an idle P to steal goroutines from another P's run queue.

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    fmt.Println("NumCPU:", runtime.NumCPU())
}
```

**Follow-up:** What happens to the P when a goroutine makes a blocking syscall?
> When a goroutine makes a blocking syscall, the M detaches from its P. Another idle M (or a newly created one) picks up the P and continues running other goroutines. When the syscall completes, the original M tries to re-acquire a P; if none is available, the goroutine is placed on the global run queue and the M goes to sleep.

---

## Q2. What is the difference between unbuffered and buffered channels?

**Answer:**
- **Unbuffered channel (`make(chan T)`):** Both sender and receiver must be ready simultaneously. The send blocks until a receiver is available and vice versa — it is a synchronous rendezvous point.
- **Buffered channel (`make(chan T, n)`):** Has a capacity of `n`. Sends only block when the buffer is full; receives only block when the buffer is empty. Decouples sender and receiver up to the buffer size.

```go
package main

import "fmt"

func main() {
    // Unbuffered: sender blocks until receiver reads
    unbuf := make(chan int)
    go func() { unbuf <- 42 }()
    fmt.Println(<-unbuf) // 42

    // Buffered: send does not block if capacity available
    buf := make(chan int, 3)
    buf <- 1
    buf <- 2
    buf <- 3
    fmt.Println(<-buf) // 1
}
```

**Follow-up:** When would you prefer a buffered channel over an unbuffered one?
> Use buffered channels when the producer is faster than the consumer and you want to allow bursts without blocking, or when you want to avoid goroutine synchronization overhead at every exchange. Use unbuffered channels when you need explicit handoff guarantees (the sender knows the receiver has the value).

---

## Q3. What is escape analysis in Go?

**Answer:**
Escape analysis is a compile-time process where the Go compiler determines whether a variable can live on the stack or must be allocated on the heap. If a variable's lifetime cannot be proven to end within the current function scope (e.g., its address is returned, stored in a global, or passed to an interface), it "escapes" to the heap.

Stack allocation is cheaper (no GC pressure), so the compiler prefers it. You can inspect escape decisions with:

```bash
go build -gcflags="-m" ./...
```

```go
package main

func stackAlloc() int {
    x := 42  // stays on stack
    return x
}

func heapAlloc() *int {
    x := 42  // escapes to heap — address returned
    return &x
}
```

**Follow-up:** Does passing a pointer to a function always cause heap allocation?
> No. If the compiler can prove the pointer does not outlive the callee (inlining helps here), the variable may still live on the stack. Only when the lifetime analysis is uncertain does the variable escape.

---

## Q4. What synchronization primitives does the `sync` package provide?

**Answer:**
The `sync` package provides:
- `sync.Mutex` — mutual exclusion lock
- `sync.RWMutex` — reader/writer lock
- `sync.WaitGroup` — wait for a collection of goroutines to finish
- `sync.Once` — execute a function exactly once
- `sync.Cond` — condition variable for waiting on state changes
- `sync.Map` — concurrent-safe map
- `sync.Pool` — pool of reusable objects to reduce GC pressure

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var mu sync.Mutex
    counter := 0
    var wg sync.WaitGroup

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            counter++
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println(counter) // 1000
}
```

**Follow-up:** When should you use `sync.Pool`?
> Use `sync.Pool` to cache allocated but unused objects for reuse, reducing pressure on the GC. It is useful for short-lived, frequently allocated objects (e.g., `bytes.Buffer` in HTTP handlers). Note that the pool can be cleared by the GC at any time, so objects must be re-created if `Get` returns nil.

---

## Q5. How does context propagation work in Go?

**Answer:**
`context.Context` carries deadlines, cancellation signals, and request-scoped values across API boundaries. A parent context can be cancelled, and all derived child contexts are cancelled automatically.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func doWork(ctx context.Context) {
    select {
    case <-time.After(2 * time.Second):
        fmt.Println("work done")
    case <-ctx.Done():
        fmt.Println("cancelled:", ctx.Err())
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()
    doWork(ctx)
}
```

**Follow-up:** What is the difference between `context.WithCancel`, `context.WithTimeout`, and `context.WithDeadline`?
> - `WithCancel` returns a context that is cancelled only when the returned cancel function is explicitly called.
> - `WithTimeout` cancels the context after a duration relative to now.
> - `WithDeadline` cancels the context at an absolute point in time.
> All three return a cancel function that should always be called (usually via `defer`) to release resources.

---

## Q6. What are the rules for closing a channel in Go?

**Answer:**
1. Only the **sender** should close a channel (not the receiver).
2. Closing a **nil** channel panics.
3. Closing an **already-closed** channel panics.
4. Sending to a **closed** channel panics.
5. Receiving from a closed channel returns the zero value immediately after the buffer is drained.
6. Use the two-value receive `v, ok := <-ch` to check if the channel is closed (`ok == false`).

```go
package main

import "fmt"

func produce(ch chan<- int) {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    close(ch)
}

func main() {
    ch := make(chan int, 5)
    go produce(ch)
    for v := range ch { // range exits when channel is closed
        fmt.Println(v)
    }
}
```

**Follow-up:** How do you safely close a channel with multiple senders?
> Use a dedicated "done" channel or `sync.Once` to signal completion. Coordinate senders via a `sync.WaitGroup`; only close the data channel after all senders have finished.

---

## Q7. What is the internal structure of an interface in Go (iface vs eface)?

**Answer:**
Go interfaces are represented as two-word structs:
- **eface (empty interface `interface{}`):** `{type *_type, data unsafe.Pointer}` — holds any type.
- **iface (non-empty interface):** `{tab *itab, data unsafe.Pointer}` — `itab` contains a pointer to the type's method table and the interface type.

The `itab` caches method dispatch so repeated interface calls are fast after the first lookup.

```go
package main

import "fmt"

type Stringer interface {
    String() string
}

type Dog struct{ Name string }

func (d Dog) String() string { return "Dog: " + d.Name }

func main() {
    var s Stringer = Dog{Name: "Rex"}
    fmt.Println(s.String())

    var a any = 42 // eface: type=int, data=42
    fmt.Println(a)
}
```

**Follow-up:** Why is interface method dispatch slightly slower than direct function calls?
> Interface dispatch involves an indirect function call through the `itab` method table (a pointer dereference plus a call through a function pointer), whereas a direct call is a single instruction. The compiler cannot inline through interface calls unless it can devirtualize them.

---

## Q8. What is the "nil interface is not nil" bug?

**Answer:**
An interface value is `nil` only when both its type and value pointers are nil. If you assign a typed nil pointer to an interface, the interface is not nil — it has a type but a nil data pointer.

```go
package main

import "fmt"

type MyError struct{ msg string }

func (e *MyError) Error() string { return e.msg }

func getError(fail bool) error {
    var err *MyError // typed nil
    if fail {
        err = &MyError{"something went wrong"}
    }
    return err // interface wraps *MyError — NOT nil even when err==nil
}

func main() {
    e := getError(false)
    fmt.Println(e == nil)        // false! interface has type *MyError
    fmt.Println(e.(*MyError) == nil) // true
}
```

**Fix:** Return the interface type directly:
```go
func getError(fail bool) error {
    if fail {
        return &MyError{"something went wrong"}
    }
    return nil // returns a true nil interface
}
```

**Follow-up:** How do you detect this in code review?
> Check functions that return interface types (especially `error`). If the function declares a concrete typed variable and returns it via the interface, it may carry a typed nil. Return `nil` directly instead of a typed nil variable.

---

## Q9. How does Go's garbage collector work?

**Answer:**
Go uses a **tricolor concurrent mark-and-sweep** GC:
1. **Mark setup (STW):** Brief stop-the-world to enable write barriers.
2. **Concurrent mark:** GC goroutines trace reachable objects concurrently with the program, using tricolor invariant (white=unvisited, grey=visiting, black=visited).
3. **Mark termination (STW):** Brief STW to finalize marking.
4. **Concurrent sweep:** Unreachable (white) objects are swept concurrently.

Write barriers ensure that any pointers written during concurrent marking are tracked so no live objects are missed.

```go
import "runtime"

// Force a GC cycle
runtime.GC()

// Read GC stats
var stats runtime.MemStats
runtime.ReadMemStats(&stats)
```

**Follow-up:** What is the GOGC environment variable and what does it control?
> `GOGC` sets the target percentage of heap growth that triggers the next GC cycle. Default is 100, meaning GC runs when the live heap doubles. Setting `GOGC=200` makes GC run less frequently (larger heap), reducing CPU overhead at the cost of memory. `GOGC=off` disables GC entirely.

---

## Q10. What is the difference between `sync.Mutex` and `sync.RWMutex`?

**Answer:**
- `sync.Mutex`: Only one goroutine can hold the lock at a time — exclusive for both reads and writes.
- `sync.RWMutex`: Multiple goroutines can hold the read lock simultaneously (`RLock`/`RUnlock`), but only one goroutine can hold the write lock (`Lock`/`Unlock`), and no readers can hold the lock while a writer holds it.

Use `RWMutex` when reads are far more frequent than writes.

```go
package main

import (
    "fmt"
    "sync"
)

type SafeMap struct {
    mu sync.RWMutex
    m  map[string]int
}

func (s *SafeMap) Get(k string) int {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.m[k]
}

func (s *SafeMap) Set(k string, v int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[k] = v
}

func main() {
    sm := &SafeMap{m: make(map[string]int)}
    sm.Set("score", 100)
    fmt.Println(sm.Get("score"))
}
```

**Follow-up:** Can `RWMutex` cause writer starvation?
> In Go's implementation, once a writer is waiting, new readers are blocked from acquiring the read lock to prevent writer starvation. However, in high-read workloads, writers may still experience some latency.

---

## Q11. What happens when multiple cases in a `select` statement are ready?

**Answer:**
When multiple cases are simultaneously ready, Go chooses one **uniformly at random**. This is intentional to prevent systematic starvation of any channel.

```go
package main

import "fmt"

func main() {
    ch1 := make(chan string, 1)
    ch2 := make(chan string, 1)
    ch1 <- "one"
    ch2 <- "two"

    // Either case may be selected — non-deterministic
    select {
    case msg := <-ch1:
        fmt.Println("received from ch1:", msg)
    case msg := <-ch2:
        fmt.Println("received from ch2:", msg)
    }
}
```

**Follow-up:** How do you implement priority among channels in a `select`?
> Use a nested select or check the high-priority channel first before entering the general select. Another pattern is a for-loop that always drains the high-priority channel before moving to others.

---

## Q12. What are common goroutine leak patterns?

**Answer:**
Common patterns that cause goroutine leaks:
1. Goroutine blocked on a channel send/receive with no consumer/producer ever arriving.
2. Goroutine waiting on a `sync.WaitGroup` that is never `Done`'d.
3. Goroutine blocked on a `sync.Mutex` that is never unlocked.
4. HTTP server handlers spawning goroutines without context cancellation.
5. Goroutines in infinite loops without an exit condition.

```go
// Leak: nobody ever reads from ch, goroutine blocks forever
func leak() {
    ch := make(chan int)
    go func() {
        ch <- 42 // blocks forever
    }()
}

// Fix: use context or a done channel
func noLeak(done <-chan struct{}) {
    ch := make(chan int, 1)
    go func() {
        select {
        case ch <- 42:
        case <-done:
        }
    }()
}
```

**Follow-up:** How do you detect goroutine leaks in tests?
> Use `goleak` (go.uber.org/goleak). Call `goleak.VerifyNone(t)` at the end of a test to assert no unexpected goroutines remain.

---

## Q13. What are circular imports and how do you resolve them?

**Answer:**
A circular import occurs when package A imports package B which imports package A (directly or transitively). Go's compiler rejects circular imports at compile time.

**Resolution strategies:**
1. Extract shared types/interfaces into a third package (e.g., a `types` or `interfaces` package) that both depend on.
2. Merge the packages if the separation is artificial.
3. Use dependency injection: pass the dependency via an interface rather than importing the concrete package.
4. Move the function causing the cycle to one of the packages.

```
// Bad:
// pkg/a imports pkg/b
// pkg/b imports pkg/a  <-- circular

// Fix: extract shared interface to pkg/common
// pkg/a imports pkg/common
// pkg/b imports pkg/common
```

**Follow-up:** Can you have circular dependencies between modules (go.mod)?
> No. The Go module system also rejects circular module dependencies. The fix is the same: extract shared code into a separate module.

---

## Q14. What is the `sync.WaitGroup` pattern?

**Answer:**
`sync.WaitGroup` lets you wait for a collection of goroutines to complete. Call `Add(n)` before launching goroutines, `Done()` (or `defer Done()`) inside each goroutine, and `Wait()` to block until all complete.

```go
package main

import (
    "fmt"
    "sync"
)

func worker(id int, wg *sync.WaitGroup) {
    defer wg.Done()
    fmt.Printf("worker %d done\n", id)
}

func main() {
    var wg sync.WaitGroup
    for i := 1; i <= 5; i++ {
        wg.Add(1)
        go worker(i, &wg)
    }
    wg.Wait()
    fmt.Println("all workers done")
}
```

**Follow-up:** Why must `Add` be called before launching the goroutine, not inside it?
> There is a race condition: `Wait` could be called before the goroutine runs and calls `Add`, decrementing the counter before it has been incremented, causing `Wait` to return prematurely.

---

## Q15. How do you implement a worker pool in Go?

**Answer:**
A worker pool limits concurrent goroutines to a fixed number. Jobs are sent on a jobs channel, workers process them, and results (optionally) are sent on a results channel.

```go
package main

import (
    "fmt"
    "sync"
)

func workerPool(numWorkers, numJobs int) {
    jobs := make(chan int, numJobs)
    results := make(chan int, numJobs)

    var wg sync.WaitGroup
    for w := 0; w < numWorkers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- j * j // simulate work
            }
        }()
    }

    for j := 1; j <= numJobs; j++ {
        jobs <- j
    }
    close(jobs)

    go func() {
        wg.Wait()
        close(results)
    }()

    for r := range results {
        fmt.Println(r)
    }
}

func main() {
    workerPool(3, 9)
}
```

**Follow-up:** How do you propagate errors from workers back to the caller?
> Use a separate error channel or return errors in the results struct. Alternatively, use `errgroup` from `golang.org/x/sync/errgroup` which handles cancellation and first-error collection automatically.

---

## Q16. What is the functional options pattern?

**Answer:**
The functional options pattern passes behavior via functions rather than a config struct with many fields, enabling optional, named, and extensible configuration without breaking API compatibility.

```go
package main

import "fmt"

type Server struct {
    host    string
    port    int
    timeout int
}

type Option func(*Server)

func WithHost(h string) Option   { return func(s *Server) { s.host = h } }
func WithPort(p int) Option      { return func(s *Server) { s.port = p } }
func WithTimeout(t int) Option   { return func(s *Server) { s.timeout = t } }

func NewServer(opts ...Option) *Server {
    s := &Server{host: "localhost", port: 8080, timeout: 30}
    for _, opt := range opts {
        opt(s)
    }
    return s
}

func main() {
    s := NewServer(WithPort(9090), WithTimeout(60))
    fmt.Printf("%+v\n", s)
}
```

**Follow-up:** What is the advantage over a config struct parameter?
> Adding a new option is backward compatible — existing callers need not change. Config structs require callers to update struct literals when new required fields are added, or use `//nolint` patterns for optional fields.

---

## Q17. How do you implement a concurrent-safe map in Go?

**Answer:**
Three common approaches:
1. `sync.Mutex` or `sync.RWMutex` wrapping a regular map.
2. `sync.Map` from the standard library (optimized for read-heavy, mostly-stable key sets).
3. Sharded maps (divide keys across N mutex-protected maps to reduce contention).

```go
package main

import (
    "fmt"
    "sync"
)

// Approach 1: RWMutex-wrapped map
type ConcurrentMap struct {
    mu sync.RWMutex
    m  map[string]any
}

func NewConcurrentMap() *ConcurrentMap {
    return &ConcurrentMap{m: make(map[string]any)}
}

func (cm *ConcurrentMap) Store(k string, v any) {
    cm.mu.Lock()
    defer cm.mu.Unlock()
    cm.m[k] = v
}

func (cm *ConcurrentMap) Load(k string) (any, bool) {
    cm.mu.RLock()
    defer cm.mu.RUnlock()
    v, ok := cm.m[k]
    return v, ok
}

// Approach 2: sync.Map
func syncMapDemo() {
    var sm sync.Map
    sm.Store("key", 42)
    v, _ := sm.Load("key")
    fmt.Println(v)
}

func main() {
    cm := NewConcurrentMap()
    cm.Store("name", "GoForge")
    v, _ := cm.Load("name")
    fmt.Println(v)
    syncMapDemo()
}
```

**Follow-up:** When should you prefer `sync.Map` over a mutex-guarded map?
> `sync.Map` is optimized for two use cases: (1) entries are written once and read many times, and (2) goroutines operate on disjoint key sets. For maps with frequent writes across shared keys, a mutex-guarded map is often faster.

---

## Q18. How does `sync.Once` work and what is it used for?

**Answer:**
`sync.Once` guarantees a function is called exactly once, regardless of how many goroutines call `Do`. It is typically used for lazy initialization of shared resources (singletons, config loading, etc.).

```go
package main

import (
    "fmt"
    "sync"
)

type DB struct{ dsn string }

var (
    instance *DB
    once     sync.Once
)

func GetDB() *DB {
    once.Do(func() {
        fmt.Println("initializing DB connection")
        instance = &DB{dsn: "postgres://..."}
    })
    return instance
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            db := GetDB()
            _ = db
        }()
    }
    wg.Wait()
    // "initializing DB connection" printed exactly once
}
```

**Follow-up:** What happens if the function passed to `Do` panics?
> The function is considered "done" even if it panics. Subsequent calls to `Do` will not call the function again. The panic propagates to the goroutine that called `Do`.

---

## Q19. How do named return values interact with `defer`?

**Answer:**
Named return values are pre-declared variables. A deferred function can read and modify them by name, affecting the actual returned value.

```go
package main

import "fmt"

func example() (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
            result = -1
        }
    }()
    panic("oops")
}

func addBonus(n int) (total int) {
    total = n
    defer func() {
        total += 10 // modifies the named return
    }()
    return // returns total+10
}

func main() {
    res, err := example()
    fmt.Println(res, err) // -1 recovered: oops

    fmt.Println(addBonus(5)) // 15
}
```

**Follow-up:** What is a common mistake with `defer` and anonymous return values?
> If the return variable is unnamed, `defer` cannot modify it by name. Assigning to a local variable inside defer has no effect on the return value. Named returns are required for defer to modify the return.

---

## Q20. How does slice capacity grow in Go?

**Answer:**
When a slice's length reaches its capacity and a new element is appended, Go allocates a new backing array and copies data. The growth strategy (as of Go 1.18+) is roughly:
- Double the capacity when current cap < 256.
- Grow by ~25% (plus a smoothing factor) when cap >= 256.

```go
package main

import "fmt"

func main() {
    var s []int
    prev := 0
    for i := 0; i < 20; i++ {
        s = append(s, i)
        if cap(s) != prev {
            fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
            prev = cap(s)
        }
    }
}
```

**Follow-up:** How do you pre-allocate a slice to avoid repeated reallocations?
> Use `make([]T, 0, expectedLen)` to allocate with a known capacity. This avoids the O(n log n) total allocation cost of repeated doubling when the final size is known in advance.

---

## Q21. What are the rules for interface satisfaction in Go?

**Answer:**
A type `T` satisfies interface `I` if `T` (or `*T`) implements all methods declared in `I` with matching signatures. This check is structural (duck typing) — no explicit declaration is needed.

```go
package main

import "fmt"

type Writer interface {
    Write([]byte) (int, error)
}

type FileWriter struct{}

func (fw FileWriter) Write(p []byte) (int, error) {
    fmt.Println("writing:", string(p))
    return len(p), nil
}

func writeData(w Writer, data []byte) {
    w.Write(data)
}

func main() {
    fw := FileWriter{}
    writeData(fw, []byte("hello")) // FileWriter satisfies Writer
    
    // Compile-time check:
    var _ Writer = FileWriter{}
}
```

**Follow-up:** How do you verify interface satisfaction at compile time without instantiating a value?
> Use a blank identifier assignment: `var _ InterfaceName = (*ConcreteType)(nil)`. This fails compilation if the type does not satisfy the interface, at zero runtime cost.

---

## Q22. What are method sets in Go?

**Answer:**
The method set of a type defines which methods can be called on a value of that type.
- **Value type `T`:** method set = methods with value receiver `(T)`.
- **Pointer type `*T`:** method set = methods with value receiver `(T)` + methods with pointer receiver `(*T)`.

This matters for interface satisfaction:

```go
package main

import "fmt"

type Greeter interface{ Greet() }

type Person struct{ Name string }

func (p *Person) Greet() { fmt.Println("Hi, I'm", p.Name) }

func main() {
    p := Person{Name: "Alice"}
    // p.Greet()       // OK: Go auto-takes address on addressable values
    // var g Greeter = p  // COMPILE ERROR: Person does not implement Greeter
    var g Greeter = &p    // OK: *Person implements Greeter
    g.Greet()
}
```

**Follow-up:** Why can't you assign a value type to an interface when only pointer receivers implement the interface?
> An interface value must be able to call all interface methods. If a method has a pointer receiver, the interface needs the pointer to call it. A non-addressable value (e.g., a map element, function return value) cannot have its address taken, so Go enforces this at the type-system level.

---

## Q23. What is embedding vs inheritance in Go?

**Answer:**
Go does not have class inheritance. Instead, **embedding** composes types by including one type inside another. The outer type promotes the inner type's fields and methods, but there is no is-a relationship — only has-a (composition).

```go
package main

import "fmt"

type Animal struct{ Name string }

func (a Animal) Speak() { fmt.Println(a.Name, "speaks") }

type Dog struct {
    Animal        // embedded — Dog "has" Animal
    Breed  string
}

func (d Dog) Fetch() { fmt.Println(d.Name, "fetches!") }

func main() {
    d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Labrador"}
    d.Speak()  // promoted from Animal
    d.Fetch()
    fmt.Println(d.Name) // promoted field
}
```

**Follow-up:** Can embedding cause ambiguity?
> Yes. If two embedded types both have a method or field with the same name, accessing it via the outer type is a compile error. You must disambiguate by qualifying: `outer.TypeA.Method()`.

---

## Q24. How do type assertions work in Go?

**Answer:**
A type assertion extracts a concrete value from an interface. It has two forms:
1. `v := i.(T)` — panics if `i` does not hold type `T`.
2. `v, ok := i.(T)` — safe form; `ok` is false if the assertion fails, no panic.

Type switches allow testing multiple types at once.

```go
package main

import "fmt"

func describe(i any) {
    switch v := i.(type) {
    case int:
        fmt.Printf("int: %d\n", v)
    case string:
        fmt.Printf("string: %q\n", v)
    case []int:
        fmt.Printf("[]int len=%d\n", len(v))
    default:
        fmt.Printf("unknown type: %T\n", v)
    }
}

func main() {
    describe(42)
    describe("GoForge")
    describe([]int{1, 2, 3})

    var i any = "hello"
    s, ok := i.(string)
    fmt.Println(s, ok) // hello true
}
```

**Follow-up:** What is the performance cost of a type assertion vs a direct call?
> A type assertion involves comparing the dynamic type stored in the interface to the target type — typically a single pointer comparison. It is fast but slightly more expensive than a direct call. The two-value form adds a boolean branch.

---

## Q25. How does error wrapping and unwrapping work in Go?

**Answer:**
Go 1.13 introduced `fmt.Errorf` with `%w` verb for wrapping errors, and `errors.Is` / `errors.Unwrap` / `errors.As` for unwrapping.

- `%w` wraps an error so the chain is traversable.
- `errors.Is(err, target)` checks the chain for a matching error value.
- `errors.As(err, &target)` checks the chain for a matching error type and sets the target.

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

type DBError struct {
    Table string
    Err   error
}

func (e *DBError) Error() string { return fmt.Sprintf("db error on %s: %v", e.Table, e.Err) }
func (e *DBError) Unwrap() error  { return e.Err }

func query() error {
    return &DBError{Table: "users", Err: ErrNotFound}
}

func main() {
    err := fmt.Errorf("service layer: %w", query())

    fmt.Println(errors.Is(err, ErrNotFound)) // true

    var dbErr *DBError
    if errors.As(err, &dbErr) {
        fmt.Println("table:", dbErr.Table)
    }
}
```

**Follow-up:** What is the difference between `errors.Is` and `==` for error comparison?
> `==` only compares the top-level error value. `errors.Is` traverses the entire chain by calling `Unwrap()` recursively, so it works even when the target error is wrapped multiple layers deep.

---

## Q26. How do you tune `GOGC` for production applications?

**Answer:**
`GOGC` (default 100) sets the heap growth trigger. Tuning options:
- **Increase `GOGC`** (e.g., `GOGC=200`): GC runs less often, higher memory usage, lower CPU overhead — good for latency-sensitive services.
- **Decrease `GOGC`** (e.g., `GOGC=50`): GC runs more often, lower memory, higher CPU — good for memory-constrained environments.
- **`GOMEMLIMIT`** (Go 1.19+): Soft memory ceiling; the runtime increases GC frequency to stay under the limit regardless of `GOGC`.

```bash
# Run with tuned GC
GOGC=200 GOMEMLIMIT=512MiB ./my-service
```

```go
import "runtime/debug"

func init() {
    debug.SetGCPercent(200)
    debug.SetMemoryLimit(512 << 20) // 512 MiB
}
```

**Follow-up:** What is `GOMEMLIMIT` and how does it interact with `GOGC`?
> `GOMEMLIMIT` is a soft memory limit introduced in Go 1.19. When heap+overhead approaches the limit, the GC runs more aggressively regardless of `GOGC`. Setting `GOGC=off` with `GOMEMLIMIT` lets the GC run only when needed to stay under the limit, which can reduce GC pauses in steady state.

---

## Q27. How do you profile a Go program with `pprof`?

**Answer:**
`pprof` provides CPU, memory, goroutine, and block profiles.

```go
import (
    "net/http"
    _ "net/http/pprof" // registers /debug/pprof endpoints
)

func main() {
    go http.ListenAndServe(":6060", nil)
    // ... application code
}
```

**Capture and analyze:**
```bash
# CPU profile (30s)
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Heap profile
go tool pprof http://localhost:6060/debug/pprof/heap

# Goroutine profile
go tool pprof http://localhost:6060/debug/pprof/goroutine

# Interactive flame graph (browser)
go tool pprof -http=:8080 cpu.prof
```

**Follow-up:** What is the difference between `allocs` and `heap` pprof profiles?
> `heap` shows current live allocations (in-use objects). `allocs` shows all allocations since the program started, including those that have been freed. Use `allocs` to find allocation hotspots; use `heap` to find memory leaks.

---

## Q28. How do you build an HTTP middleware chain in Go?

**Answer:**
Middleware wraps an `http.Handler`, executing logic before and/or after the next handler. Chain them by wrapping each with the next.

```go
package main

import (
    "fmt"
    "net/http"
    "time"
)

type Middleware func(http.Handler) http.Handler

func Logger(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        fmt.Printf("%s %s %v\n", r.Method, r.URL.Path, time.Since(start))
    })
}

func Auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Header.Get("Authorization") == "" {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        next.ServeHTTP(w, r)
    })
}

func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}

func helloHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "Hello, GoForge!")
}

func main() {
    handler := Chain(
        http.HandlerFunc(helloHandler),
        Logger,
        Auth,
    )
    http.ListenAndServe(":8080", handler)
}
```

**Follow-up:** How do you pass values (e.g., a request ID) between middleware layers?
> Use `context.WithValue` to attach values to the request context, and `r.WithContext(ctx)` to propagate the updated context. Downstream middleware and handlers retrieve the value with `r.Context().Value(key)`.

---

## Q29. What are common JSON marshaling gotchas in Go?

**Answer:**
1. **Unexported fields are ignored** by `encoding/json`.
2. **`omitempty`** omits the field if it is the zero value, but for slices/maps/pointers the zero is nil, not an empty collection.
3. **`interface{}`** fields unmarshal numbers as `float64` by default.
4. **Pointer fields** marshal as `null` when nil; value fields marshal as their zero value.
5. **Custom types** (e.g., `time.Time`) require custom `MarshalJSON`/`UnmarshalJSON` or struct tags.

```go
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    Name    string `json:"name"`
    Age     int    `json:"age,omitempty"` // omitted if 0
    private string // ignored
    Tags    []string `json:"tags,omitempty"` // omitted if nil
}

func main() {
    u := User{Name: "Alice"}
    b, _ := json.Marshal(u)
    fmt.Println(string(b)) // {"name":"Alice"}

    // number as float64 in any
    var v any
    json.Unmarshal([]byte(`{"n":42}`), &v)
    m := v.(map[string]any)
    fmt.Printf("%T\n", m["n"]) // float64
}
```

**Follow-up:** How do you unmarshal JSON numbers as integers rather than `float64`?
> Use `json.Decoder` with `d.UseNumber()`, which returns `json.Number` instead of `float64`. Then call `.Int64()` or `.Float64()` on the `json.Number` value.

---

## Q30. How does context cancellation propagate in Go?

**Answer:**
When a parent context is cancelled (or times out), all child contexts derived from it via `WithCancel`, `WithTimeout`, or `WithDeadline` are also cancelled. The cancellation signal is delivered via the `ctx.Done()` channel being closed.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func child(ctx context.Context, name string) {
    select {
    case <-time.After(5 * time.Second):
        fmt.Println(name, "done normally")
    case <-ctx.Done():
        fmt.Println(name, "cancelled:", ctx.Err())
    }
}

func main() {
    parent, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    childCtx, childCancel := context.WithCancel(parent)
    defer childCancel()

    go child(parent, "parent-child")
    go child(childCtx, "grandchild")

    time.Sleep(500 * time.Millisecond)
    // Both goroutines are cancelled when parent times out
}
```

**Follow-up:** Does cancelling a child context cancel the parent?
> No. Cancellation only flows downward (from parent to child), never upward. Cancelling a child context has no effect on the parent or any sibling contexts.

---

## Q31. What is a race condition and how do you detect one in Go?

**Answer:**
A race condition occurs when two or more goroutines access a shared variable concurrently and at least one access is a write, without proper synchronization. Go provides a built-in race detector.

```bash
go test -race ./...
go run -race main.go
go build -race ./...
```

```go
// Race condition example
var counter int

func increment() {
    counter++ // read-modify-write — not atomic
}

// Fix with atomic
import "sync/atomic"
var counter int64

func increment() {
    atomic.AddInt64(&counter, 1)
}
```

**Follow-up:** What is the overhead of running with `-race`?
> The race detector typically adds 5-10x CPU overhead and 2-20x memory overhead. It is not suitable for production deployments but is invaluable in CI/CD and development.

---

## Q32. What is `sync/atomic` and when should you use it?

**Answer:**
`sync/atomic` provides low-level atomic memory operations (Add, Load, Store, Swap, CompareAndSwap) for integer types and pointers. These execute as single indivisible operations without locks.

Use atomics for simple counters, flags, and pointer swaps when you want maximum performance without the overhead of a mutex. For complex invariants involving multiple variables, use a mutex instead.

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var count int64
    var wg sync.WaitGroup

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&count, 1)
        }()
    }
    wg.Wait()
    fmt.Println(atomic.LoadInt64(&count)) // 1000
}
```

**Follow-up:** What is a CAS (Compare-And-Swap) operation and when is it useful?
> CAS atomically checks if a value equals an expected value; if so, replaces it with a new value and returns true. It is the building block for lock-free data structures and optimistic concurrency patterns (e.g., updating a pointer only if it hasn't changed).

---

## Q33. What is the `errgroup` package and how does it simplify concurrent error handling?

**Answer:**
`golang.org/x/sync/errgroup` runs a group of goroutines and collects the first non-nil error. It integrates with context to cancel all goroutines when one fails.

```go
package main

import (
    "context"
    "fmt"
    "golang.org/x/sync/errgroup"
)

func fetch(ctx context.Context, url string) error {
    // simulate work
    fmt.Println("fetching", url)
    return nil
}

func main() {
    g, ctx := errgroup.WithContext(context.Background())

    urls := []string{"https://a.com", "https://b.com", "https://c.com"}
    for _, url := range urls {
        url := url // capture loop variable
        g.Go(func() error {
            return fetch(ctx, url)
        })
    }

    if err := g.Wait(); err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("all fetches complete")
}
```

**Follow-up:** What happens to the context when one goroutine in the group returns an error?
> The context is cancelled, signalling all other goroutines in the group (via `ctx.Done()`) to stop work. `g.Wait()` returns after all goroutines have exited and reports the first non-nil error.

---

## Q34. What is the difference between `make` and `new` in Go?

**Answer:**
- `new(T)` allocates zeroed memory for type `T` and returns a `*T`. Works for any type.
- `make(T, args)` allocates and initializes slices, maps, and channels. Returns the type itself (not a pointer) in an initialized, ready-to-use state.

```go
package main

import "fmt"

func main() {
    p := new(int)       // *int, points to 0
    *p = 42
    fmt.Println(*p)     // 42

    s := make([]int, 5, 10) // len=5, cap=10
    m := make(map[string]int)
    ch := make(chan int, 1)

    m["a"] = 1
    ch <- 99
    fmt.Println(s, m, <-ch)
}
```

**Follow-up:** Can you use `new` to create a map or slice?
> You can, but it returns a pointer to a nil map/slice. `new(map[string]int)` returns `*map[string]int` pointing to a nil map. You still need to initialize the map with `make` before use, otherwise writes will panic.

---

## Q35. How does Go handle variadic functions?

**Answer:**
A variadic function accepts zero or more arguments of a specified type using `...T` syntax. The variadic parameter is received as a `[]T` slice inside the function. Use `args...` to spread a slice into a variadic call.

```go
package main

import "fmt"

func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func main() {
    fmt.Println(sum(1, 2, 3))       // 6
    fmt.Println(sum(10, 20))        // 30

    nums := []int{1, 2, 3, 4, 5}
    fmt.Println(sum(nums...))       // 15
}
```

**Follow-up:** Is there a performance cost to using variadic functions?
> When the variadic receives multiple arguments, a slice is allocated on the heap (unless the compiler can prove it stays on the stack). For hot paths, passing a pre-allocated slice can avoid this allocation. When called with a single value or spread from an existing slice, the overhead is minimal.

---

## Q36. What is the purpose of `init` functions in Go?

**Answer:**
`init` functions run automatically at program startup, after all variable declarations in the package are evaluated. Each file can have multiple `init` functions. They are used for setup that cannot be expressed as a variable initializer (registering drivers, validating config, etc.).

```go
package main

import "fmt"

var greeting string

func init() {
    greeting = "Hello, GoForge!"
    fmt.Println("init ran")
}

func main() {
    fmt.Println(greeting)
}
```

**Order of execution:**
1. Imported packages initialize first (depth-first).
2. Package-level variables are initialized in declaration order.
3. `init` functions run in the order they appear in source files.

**Follow-up:** Can you call `init` manually?
> No. `init` functions have no parameters and no return values, and cannot be called explicitly. They are invoked only by the runtime during program initialization.

---

## Q37. What are Go build tags and how are they used?

**Answer:**
Build tags (constraints) conditionally include or exclude files from compilation based on OS, architecture, Go version, or custom tags.

**New syntax (Go 1.17+):**
```go
//go:build linux && amd64
```

**Old syntax (still supported):**
```go
// +build linux,amd64
```

```go
//go:build integration

package mypackage

// This file is only compiled when: go test -tags=integration ./...
```

```bash
# Build only for Linux
GOOS=linux go build ./...

# Run integration tests
go test -tags=integration ./...

# Custom tag
go build -tags=production ./...
```

**Follow-up:** How do you write a file that only compiles on Windows?
> Add `//go:build windows` at the top of the file (before the `package` declaration, with a blank line between). Alternatively, name the file with the suffix `_windows.go` — Go automatically applies the OS build constraint based on filename.

---

## Q38. What is the difference between a goroutine and an OS thread?

**Answer:**

| Property        | Goroutine                  | OS Thread             |
|-----------------|----------------------------|-----------------------|
| Stack size      | Starts at ~2-8 KB, grows dynamically | Fixed ~1-8 MB     |
| Creation cost   | Microseconds               | Milliseconds          |
| Scheduling      | Go runtime (cooperative + preemptive) | OS kernel (preemptive) |
| Context switch  | ~100ns (user space)        | ~1-10 µs (kernel)     |
| Multiplexing    | M goroutines on N threads  | 1:1 with CPU          |

```go
// Create 100,000 goroutines easily
for i := 0; i < 100_000; i++ {
    go func() { /* work */ }()
}
// Equivalent with OS threads would exhaust memory
```

**Follow-up:** What triggers the Go runtime to preempt a goroutine?
> Since Go 1.14, the runtime uses asynchronous preemption via signals (SIGURG on Unix). Any goroutine can be preempted at safe points (function calls, certain loops). Before 1.14, only cooperative preemption at function call boundaries was used, which could starve other goroutines in tight loops.

---

## Q39. How do you implement the `Stringer` interface and why is it useful?

**Answer:**
The `fmt.Stringer` interface has a single method `String() string`. Implementing it allows custom types to control how they are printed with `fmt.Println`, `%v`, `%s`, etc.

```go
package main

import "fmt"

type Color int

const (
    Red Color = iota
    Green
    Blue
)

func (c Color) String() string {
    switch c {
    case Red:
        return "Red"
    case Green:
        return "Green"
    case Blue:
        return "Blue"
    default:
        return fmt.Sprintf("Color(%d)", int(c))
    }
}

func main() {
    c := Green
    fmt.Println(c)         // Green (not 1)
    fmt.Printf("%v\n", c) // Green
    fmt.Printf("%d\n", c) // 1
}
```

**Follow-up:** What is the `GoStringer` interface and when would you implement it?
> `fmt.GoStringer` has `GoString() string`. It controls the output of the `%#v` verb, producing a Go-syntax representation. Useful for debugging to see exact struct values in a Go-compilable format.

---

## Q40. What is `defer` ordering and how does it interact with panic/recover?

**Answer:**
`defer` statements execute in LIFO (last-in, first-out) order when the surrounding function returns. During a panic, deferred functions still run before the stack unwinds, which is where `recover()` must be called to stop the panic.

```go
package main

import "fmt"

func safeDiv(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return a / b, nil
}

func deferOrder() {
    for i := 0; i < 3; i++ {
        defer fmt.Println(i) // prints: 2, 1, 0
    }
}

func main() {
    res, err := safeDiv(10, 0)
    fmt.Println(res, err)
    deferOrder()
}
```

**Follow-up:** Can `recover` be called from a goroutine other than the one that panicked?
> No. `recover` only works inside a deferred function in the same goroutine that panicked. A panic in one goroutine that is not recovered will crash the entire program, even if other goroutines have deferred `recover` calls.

---

## Q41. What are channels as first-class values in Go?

**Answer:**
Channels are first-class values in Go — they can be assigned to variables, passed as function arguments, returned from functions, and stored in structs. This enables powerful patterns like channel of channels (request/response), fan-out, and pipeline construction.

```go
package main

import "fmt"

func generate(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        for _, n := range nums {
            out <- n
        }
        close(out)
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for n := range in {
            out <- n * n
        }
        close(out)
    }()
    return out
}

func main() {
    // Pipeline: generate -> square -> print
    for v := range square(generate(2, 3, 4, 5)) {
        fmt.Println(v) // 4 9 16 25
    }
}
```

**Follow-up:** What are directional channels (`chan<- T` and `<-chan T`) used for?
> Directional channels restrict a channel to send-only or receive-only within a scope, encoding intent and providing compile-time safety. Function signatures use them to document whether a function sends to or receives from a channel.

---

## Q42. How do you handle panics in HTTP handlers gracefully?

**Answer:**
Use a recovery middleware that catches panics, logs them, and returns a 500 response without crashing the server. Each HTTP request is handled in its own goroutine, so a panic in one handler must be recovered there.

```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "runtime/debug"
)

func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("panic: %v\n%s", err, debug.Stack())
                http.Error(w, "internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func panicHandler(w http.ResponseWriter, r *http.Request) {
    panic("something went terribly wrong")
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/panic", panicHandler)
    fmt.Println("listening on :8080")
    http.ListenAndServe(":8080", Recovery(mux))
}
```

**Follow-up:** Should you recover from all panics in production?
> Yes, at the server boundary you should recover to prevent one handler panic from taking down the whole process. However, panics in your own code signal programming errors (nil dereference, index out of bounds) and should be fixed rather than silently swallowed. Log the stack trace and alert when recovering.

---

## Q43. What is the `io.Reader` and `io.Writer` interface pattern?

**Answer:**
`io.Reader` (`Read(p []byte) (n int, err error)`) and `io.Writer` (`Write(p []byte) (n int, err error)`) are Go's fundamental streaming I/O interfaces. The entire standard library is built around them, enabling composition with `io.Copy`, `bufio`, `compress/gzip`, `crypto/tls`, etc.

```go
package main

import (
    "bytes"
    "compress/gzip"
    "io"
    "os"
)

func compressToFile(src io.Reader, dst string) error {
    f, err := os.Create(dst)
    if err != nil {
        return err
    }
    defer f.Close()

    gz := gzip.NewWriter(f)
    defer gz.Close()

    _, err = io.Copy(gz, src)
    return err
}

func main() {
    data := bytes.NewBufferString("Hello, GoForge! This is some data.")
    compressToFile(data, "/tmp/out.gz")
}
```

**Follow-up:** What does `io.EOF` mean and how should it be handled?
> `io.EOF` is a sentinel error returned by `Read` when there is no more data. It is not really an error — it signals normal end of stream. Functions like `io.Copy` handle it internally. When reading manually, check `if err == io.EOF` separately from other errors.

---

## Q44. How does the `strings.Builder` type improve performance over string concatenation?

**Answer:**
Concatenating strings with `+` creates a new string allocation per operation (O(n²) total for n concatenations). `strings.Builder` uses an internal byte buffer and only allocates the final string once via `String()`.

```go
package main

import (
    "fmt"
    "strings"
)

func buildString(parts []string) string {
    var sb strings.Builder
    sb.Grow(256) // pre-allocate if size is roughly known
    for _, p := range parts {
        sb.WriteString(p)
    }
    return sb.String()
}

func main() {
    parts := []string{"Go", "Forge", " ", "Platform", "!"}
    fmt.Println(buildString(parts))
}
```

**Follow-up:** What is the difference between `strings.Builder` and `bytes.Buffer`?
> Both use a growing byte buffer internally. `strings.Builder` is purpose-built for building strings and prevents copying the internal buffer (it cannot be copied after first use). `bytes.Buffer` is more general — it also implements `io.Reader` and can be used for bidirectional byte stream operations.

---

## Q45. What are function types and how are they used as values in Go?

**Answer:**
Functions in Go are first-class values. They have types based on their signature and can be stored in variables, passed as arguments, returned from functions, and stored in data structures.

```go
package main

import (
    "fmt"
    "sort"
)

type Transformer func(int) int

func apply(nums []int, t Transformer) []int {
    result := make([]int, len(nums))
    for i, n := range nums {
        result[i] = t(n)
    }
    return result
}

func main() {
    nums := []int{1, 2, 3, 4, 5}

    doubled := apply(nums, func(n int) int { return n * 2 })
    fmt.Println(doubled) // [2 4 6 8 10]

    // sort with custom comparator
    sort.Slice(nums, func(i, j int) bool {
        return nums[i] > nums[j] // descending
    })
    fmt.Println(nums) // [5 4 3 2 1]
}
```

**Follow-up:** How do closures capture variables in Go?
> Closures capture variables by reference, not by value. All closures referencing the same variable share the same storage. A common mistake in loop closures is capturing the loop variable; fix by creating a local copy: `v := v` or pass as a parameter.

---

## Q46. What is the difference between `log` and structured logging in Go?

**Answer:**
`log` (standard library) writes plain text logs with timestamp prefix. Structured logging (e.g., `log/slog` in Go 1.21+, `zap`, `zerolog`) logs key-value pairs in machine-readable formats (JSON, logfmt), enabling filtering and aggregation in observability platforms.

```go
package main

import (
    "log/slog"
    "os"
)

func main() {
    // Text handler (human-readable)
    logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
    logger.Info("request handled",
        "method", "GET",
        "path", "/api/users",
        "status", 200,
        "latency_ms", 14,
    )

    // JSON handler (machine-readable)
    jlogger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    jlogger.Error("database error",
        "table", "users",
        "err", "connection refused",
    )
}
```

**Follow-up:** What are the performance differences between `slog`, `zap`, and `zerolog`?
> `zerolog` is typically the fastest (uses zero allocation for hot paths), followed by `zap` (near-zero allocation), then `slog` (slightly more overhead but is standard library). For most services, `slog` is sufficient; use `zap` or `zerolog` for extreme throughput requirements.

---

## Q47. What are Go generics and when should you use them?

**Answer:**
Generics (Go 1.18+) allow writing functions and types parameterized over types, eliminating code duplication without sacrificing type safety or resorting to `interface{}`.

```go
package main

import (
    "fmt"
    "golang.org/x/exp/constraints"
)

func Map[T, U any](s []T, f func(T) U) []U {
    result := make([]U, len(s))
    for i, v := range s {
        result[i] = f(v)
    }
    return result
}

func Min[T constraints.Ordered](a, b T) T {
    if a < b {
        return a
    }
    return b
}

func main() {
    nums := []int{1, 2, 3, 4}
    strs := Map(nums, func(n int) string { return fmt.Sprintf("%d", n*n) })
    fmt.Println(strs) // [1 4 9 16]
    fmt.Println(Min(3.14, 2.72)) // 2.72
}
```

**Follow-up:** What are type constraints in generics?
> Type constraints are interfaces that restrict which types can be used as type parameters. `any` allows all types. `comparable` allows types that support `==`. Custom constraints can enumerate specific types (`~int | ~float64`) or require methods.

---

## Q48. How does Go handle multiple return values and what are the best practices?

**Answer:**
Go functions can return multiple values, most commonly used for the `(value, error)` pattern. Named return values improve readability for complex functions. Multiple returns eliminate the need for out-parameters or exception handling.

```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

// Classic (value, error) pattern
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

// Multiple meaningful returns
func parseCoords(s string) (lat, lon float64, err error) {
    var rawLat, rawLon string
    if n, _ := fmt.Sscanf(s, "%s %s", &rawLat, &rawLon); n != 2 {
        return 0, 0, fmt.Errorf("invalid format: %q", s)
    }
    lat, err = strconv.ParseFloat(rawLat, 64)
    if err != nil {
        return 0, 0, fmt.Errorf("bad lat: %w", err)
    }
    lon, err = strconv.ParseFloat(rawLon, 64)
    return // named return
}

func main() {
    if result, err := divide(10, 3); err == nil {
        fmt.Printf("%.4f\n", result)
    }
}
```

**Follow-up:** When should you use named return values?
> Use named returns when (1) the function is complex enough that names add clarity to the return values, (2) you use bare `return` to reduce repetition in multiple exit paths, or (3) a `defer` needs to modify the return values. Avoid named returns in simple, short functions where they add noise.

---

## Q49. What is the `testing` package and what types of tests does Go support?

**Answer:**
Go's `testing` package supports:
- **Unit tests:** Functions named `TestXxx(t *testing.T)`.
- **Benchmarks:** Functions named `BenchmarkXxx(b *testing.B)`.
- **Examples:** Functions named `ExampleXxx()` — documented and verified by the test runner.
- **Fuzz tests (Go 1.18+):** Functions named `FuzzXxx(f *testing.F)`.
- **Table-driven tests:** Idiomatic Go pattern using slices of test cases.

```go
package math_test

import "testing"

func Add(a, b int) int { return a + b }

func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive", 2, 3, 5},
        {"negative", -1, -2, -3},
        {"zero", 0, 0, 0},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.expected {
                t.Errorf("Add(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.expected)
            }
        })
    }
}

func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        Add(1, 2)
    }
}
```

**Follow-up:** How do you run only a subset of tests?
> Use `go test -run TestName ./...` with a regex pattern. For subtests, use `go test -run 'TestAdd/positive'`. For benchmarks: `go test -bench=BenchmarkAdd -benchmem ./...`.

---

## Q50. How do you implement graceful shutdown in a Go HTTP server?

**Answer:**
`http.Server.Shutdown(ctx)` stops accepting new connections and waits for active connections to complete. Pair it with OS signal handling to trigger shutdown on SIGTERM or SIGINT.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "ok")
    })

    srv := &http.Server{
        Addr:         ":8080",
        Handler:      mux,
        ReadTimeout:  5 * time.Second,
        WriteTimeout: 10 * time.Second,
        IdleTimeout:  120 * time.Second,
    }

    // Start server in background
    go func() {
        log.Println("server listening on :8080")
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatalf("server error: %v", err)
        }
    }()

    // Wait for interrupt signal
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit
    log.Println("shutting down...")

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(ctx); err != nil {
        log.Fatalf("forced shutdown: %v", err)
    }
    log.Println("server stopped")
}
```

**Follow-up:** What happens to in-flight requests during `Shutdown`?
> `Shutdown` stops the server from accepting new connections immediately, then waits for all active connections to become idle (requests complete). If the context deadline is reached before all connections close, `Shutdown` returns a context error, but the server still stops accepting new work. Websocket connections (which never become idle) must be closed explicitly.

---

> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.
