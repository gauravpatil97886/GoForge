# Go Closures

## What Is This?

A closure is a function that "closes over" — captures and remembers — variables from the surrounding scope where it was defined, even after that outer scope has returned. In Go, any function literal (anonymous function) that references variables from an enclosing function is a closure. The captured variables are shared by reference between the closure and the outer scope, meaning changes in either place are visible to both.

## Why Does It Exist?

Before closures, encapsulating state without creating a full struct and method required either global variables (unsafe, untestable) or passing state as explicit arguments (verbose, leaky). Closures solve the "I need a function that remembers something" problem elegantly: the function carries its own private state with it, hidden from the outside world. Go adopted first-class functions and closures because its primary use case — networked servers, middleware chains, concurrent workers — demands lightweight, composable behavior that can be built up at runtime without heavyweight object hierarchies.

## Who Uses This in Industry?

- **Google**: Internal RPC frameworks wrap handlers in closures to inject tracing, deadlines, and authentication context — the handler sees a clean signature while the infrastructure concerns are hidden in the enclosing scope.
- **Cloudflare**: Their Go-based edge proxy (used in their Workers runtime and internal services) chains HTTP middleware using closure-based wrappers. Each middleware layer is a function that takes a `http.Handler` and returns a new `http.Handler` — a closure captures the next handler in the chain.
- **Uber**: The `zap` logging library (open-sourced by Uber) uses the **functional options pattern** — a closure-based design — to configure loggers. `zap.New(core, zap.AddCaller(), zap.AddStacktrace(...))` passes option functions that close over configuration values.
- **Docker / Kubernetes**: `client-go` (Kubernetes Go client) uses closure-based informer event handlers: `cache.ResourceEventHandlerFuncs{AddFunc: func(obj interface{}) { /* closes over controller state */ }}`. Docker's BuildKit uses closure-based solver graphs where each build step is a function closing over its dependencies.
- **HashiCorp (Terraform, Vault)**: Functional options and middleware-style closures are used throughout for plugin configuration, request routing, and retry logic.

In production Go systems, closures appear in three dominant patterns: **middleware chains** (HTTP, gRPC interceptors), **functional options** (library configuration), and **concurrent worker factories** (spawning goroutines that share coordinating state).

## Industry Standards and Best Practices

**Senior engineers do:**
- Use closures for short-lived, self-contained behavior (middleware, callbacks, options)
- Always shadow loop variables before launching goroutines (or use Go 1.22+ loop variable semantics)
- Keep closed-over state minimal — if a closure needs more than 2-3 variables, consider a struct
- Document when a closure captures a pointer vs. a value — the difference is a common source of bugs
- Use the functional options pattern for any exported constructor that might grow configuration parameters

**Beginners tend to:**
- Assume closures capture values (they capture references)
- Launch goroutines in loops without capturing the loop variable, causing the classic data race
- Build deeply nested closures that are hard to read and test — flatten when possible
- Ignore that captured variables remain alive as long as the closure is alive (memory leak risk)

**The rule of thumb**: if you find yourself writing `type Foo struct { fn func() }` just to hold a function, ask whether a plain closure would be cleaner.

## Why Go's Approach Is Unique

**vs. Java**: Java had no closures until lambdas in Java 8, and even then captured variables must be "effectively final" — you cannot mutate them from inside the lambda. Go closures capture by reference with no such restriction, giving more power but requiring more discipline.

**vs. Python**: Python closures also capture by reference but have the `nonlocal` keyword awkwardness for assignment. Go has no such keyword — any variable from an enclosing scope is automatically captured by reference when referenced.

**vs. JavaScript/Node**: JavaScript closures are identical in semantics to Go's, but Go adds the goroutine dimension: a closure launched as a goroutine can outlive its enclosing function and access stack variables that have been promoted to the heap — the Go compiler handles this automatically via escape analysis.

**The key tradeoff Go made**: simplicity over safety. Go does not prevent you from capturing a loop variable that changes — it trusts you to know what you are doing. This keeps the language small and the rules consistent, but shifts the burden of correctness to the programmer. The Go 1.22 loop variable change (each iteration gets its own variable) partially addressed the most common mistake, but understanding the underlying model is still essential.

---

## 1. What a Closure Is — The Basics

A function literal in Go is not just code — it is a value that bundles code together with the environment (the variables it references). When that function literal references a variable from an outer function, Go promotes that variable to the heap so both the outer function and the closure can access the same memory location.

**Why this matters**: the closure does not get a snapshot of the variable at creation time. It gets a live reference. Whatever the variable holds when the closure runs is what the closure sees.

```go
// Example 1: Basic closure — capturing and mutating a variable
package main

import "fmt"

func makeCounter() func() int {
	count := 0 // This variable lives on the heap because the closure captures it

	// This anonymous function is a closure — it closes over `count`
	return func() int {
		count++ // Mutates the captured variable directly
		return count
	}
}

func main() {
	counter := makeCounter()

	fmt.Println(counter()) // 1
	fmt.Println(counter()) // 2
	fmt.Println(counter()) // 3

	// A second counter gets its OWN `count` variable — fully independent
	counter2 := makeCounter()
	fmt.Println(counter2()) // 1  (not 4!)
	fmt.Println(counter())  // 4  (first counter continues its own state)
}
```

**Key insight**: `makeCounter` has returned, but `count` is still alive because `counter` holds a reference to it. This is the heap escape in action — Go's compiler detected the escape and allocated `count` on the heap automatically.

---

## 2. Variable Capture by Reference — The Classic Bug

This is the single most common mistake in Go, appearing in code reviews at every company. Understand it once, never make it again.

```go
// Example 2: THE GOROUTINE LOOP BUG — what NOT to do
package main

import (
	"fmt"
	"sync"
)

func brokenVersion() {
	var wg sync.WaitGroup

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// BUG: `i` is captured by reference.
			// By the time these goroutines run, the loop has likely
			// finished and `i` equals 5 (or some unpredictable value).
			fmt.Println(i) // Likely prints 5 five times (or worse, a data race)
		}()
	}

	wg.Wait()
}

// FIX 1 (classic, works in all Go versions): pass i as an argument
func fixedWithArgument() {
	var wg sync.WaitGroup

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(i int) { // i is now a parameter — a NEW copy per goroutine
			defer wg.Done()
			fmt.Println(i) // Each goroutine has its own i: prints 0,1,2,3,4 (any order)
		}(i) // Pass the current value of i immediately
	}

	wg.Wait()
}

// FIX 2 (also classic): shadow i with a local variable inside the loop
func fixedWithShadow() {
	var wg sync.WaitGroup

	for i := 0; i < 5; i++ {
		i := i // Shadow: creates a NEW variable `i` scoped to this loop iteration
		wg.Add(1)
		go func() {
			defer wg.Done()
			fmt.Println(i) // Captures the shadowed i, which is unique per iteration
		}()
	}

	wg.Wait()
}

// FIX 3 (Go 1.22+): loop variables are per-iteration automatically
// In Go 1.22+, the original `brokenVersion` code would actually work correctly
// because each iteration of the loop creates a new `i` variable.
// But do NOT rely on this when writing code that must run on older Go versions.

func main() {
	fmt.Println("--- Broken version (likely all 5s) ---")
	brokenVersion()

	fmt.Println("--- Fixed with argument (0-4 in any order) ---")
	fixedWithArgument()

	fmt.Println("--- Fixed with shadow (0-4 in any order) ---")
	fixedWithShadow()
}
```

**Why the bug happens**: The goroutine closure captures the variable `i`, not its value at launch time. The loop body increments `i` on every iteration and the goroutines may not execute until after all iterations complete. All goroutines then read the same memory location that now holds the post-loop value.

**The fix principle**: when launching a goroutine in a loop that needs the loop variable, always give each goroutine its own copy — either as a function argument or via shadowing.

---

## 3. First-Class Functions — Functions as Values

Go treats functions as first-class values. You can store them in variables, pass them as arguments, return them from other functions, and put them in slices or maps. Closures are the mechanism that makes this useful beyond mere callbacks.

```go
// Example 3: Functions as values — function types, passing, storing
package main

import "fmt"

// A named function type makes signatures readable
type Transformer func(int) int

// applyAll applies each transformer to the value in sequence
func applyAll(value int, transformers ...Transformer) int {
	for _, t := range transformers {
		value = t(value)
	}
	return value
}

// multiplierFactory returns a closure that multiplies by n
// n is captured from the outer scope — each returned function has its own n
func multiplierFactory(n int) Transformer {
	return func(x int) int {
		return x * n
	}
}

// adderFactory returns a closure that adds n
func adderFactory(n int) Transformer {
	return func(x int) int {
		return x + n
	}
}

func main() {
	double := multiplierFactory(2)
	triple := multiplierFactory(3)
	addTen := adderFactory(10)

	// Compose operations: (5 * 2 + 10) * 3 = 60
	result := applyAll(5, double, addTen, triple)
	fmt.Println(result) // 60

	// Store functions in a slice — each closure captures its own state
	pipeline := []Transformer{
		multiplierFactory(2),
		adderFactory(1),
		multiplierFactory(3),
	}

	val := applyAll(4, pipeline...)
	fmt.Println(val) // (4 * 2 + 1) * 3 = 27

	// Anonymous closure inline — no need for a named function
	square := func(x int) int { return x * x }
	fmt.Println(applyAll(3, square, addTen)) // 9 + 10 = 19
}
```

---

## 4. Returning Functions — Factories and Builders

Returning a closure from a function is how you build configurable, stateful behavior without exposing internal state. This is the core mechanism behind several major Go library patterns.

```go
// Example 4: Closure as a factory — memoization
package main

import "fmt"

// memoize wraps any func(int) int with a cache.
// The cache is closed over — invisible to callers but persistent across calls.
func memoize(fn func(int) int) func(int) int {
	cache := make(map[int]int) // captured by the returned closure

	return func(n int) int {
		if val, ok := cache[n]; ok {
			fmt.Printf("  cache hit for %d\n", n)
			return val
		}
		result := fn(n)
		cache[n] = result
		fmt.Printf("  computed %d => %d\n", n, result)
		return result
	}
}

func slowFibonacci(n int) int {
	if n <= 1 {
		return n
	}
	return slowFibonacci(n-1) + slowFibonacci(n-2)
}

func main() {
	fastFib := memoize(slowFibonacci)

	// First calls compute; subsequent calls hit cache
	fmt.Println(fastFib(10))
	fmt.Println(fastFib(10)) // cache hit
	fmt.Println(fastFib(7))
	fmt.Println(fastFib(7)) // cache hit

	// Each memoized function has its OWN independent cache
	fastFib2 := memoize(slowFibonacci)
	fmt.Println(fastFib2(10)) // computed again — different cache
}
```

---

## 5. HTTP Middleware Pattern

This is the most important real-world closure pattern in Go. Nearly every production Go HTTP server uses this pattern — it is how `net/http`, `gorilla/mux`, `chi`, and `gin` all work under the hood.

```go
// Example 5: HTTP middleware using closures
package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

// Middleware is a function that wraps a handler — the standard Go middleware type
type Middleware func(http.Handler) http.Handler

// loggingMiddleware returns a new handler that logs before/after calling next.
// `next` is captured from the parameter — the closure holds a reference to it.
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		log.Printf("START %s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r) // call the wrapped handler
		log.Printf("END   %s %s [%v]", r.Method, r.URL.Path, time.Since(start))
	})
}

// authMiddleware closes over an allowed API key — configuration captured at setup time.
func authMiddleware(allowedKey string) Middleware {
	// allowedKey is captured here — the returned closure checks against it
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("X-API-Key")
			if key != allowedKey {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// chain composes multiple middlewares left-to-right:
// chain(a, b, c)(handler) == a(b(c(handler)))
func chain(middlewares ...Middleware) Middleware {
	return func(final http.Handler) http.Handler {
		// Apply in reverse so the first middleware is outermost
		for i := len(middlewares) - 1; i >= 0; i-- {
			final = middlewares[i](final)
		}
		return final
	}
}

func helloHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "Hello, World!")
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/hello", helloHandler)

	// Build the middleware stack using closures
	// Each layer captures the next handler in the chain
	stack := chain(
		loggingMiddleware,
		authMiddleware("secret-key-123"),
	)

	server := &http.Server{
		Addr:    ":8080",
		Handler: stack(mux),
	}

	log.Println("Listening on :8080")
	// Uncomment to actually run: log.Fatal(server.ListenAndServe())
	_ = server
	fmt.Println("Server configured with middleware chain (not started in this example)")
}
```

**Why closures make this elegant**: `authMiddleware("secret-key-123")` captures the key at startup time. The returned handler never exposes that key in its signature — it simply has it. No globals, no context lookups for configuration.

---

## 6. Functional Options Pattern

This pattern (popularized by Dave Cheney's 2014 blog post, then adopted by `grpc-go`, `zap`, `urfave/cli`, and dozens of major libraries) uses closures to make struct configuration ergonomic and backwards-compatible.

```go
// Example 6: Functional options — the production-grade config pattern
package main

import (
	"fmt"
	"time"
)

// Server holds configuration — fields are unexported to force use of options
type Server struct {
	host    string
	port    int
	timeout time.Duration
	maxConn int
	tls     bool
}

// Option is a function that configures a Server.
// Each option is a closure that captures its specific value.
type Option func(*Server)

// WithHost returns an Option that sets the host.
// The returned closure captures `host` from the parameter.
func WithHost(host string) Option {
	return func(s *Server) {
		s.host = host
	}
}

func WithPort(port int) Option {
	return func(s *Server) {
		s.port = port
	}
}

func WithTimeout(d time.Duration) Option {
	return func(s *Server) {
		s.timeout = d
	}
}

func WithMaxConnections(n int) Option {
	return func(s *Server) {
		s.maxConn = n
	}
}

func WithTLS(enabled bool) Option {
	return func(s *Server) {
		s.tls = enabled
	}
}

// NewServer applies defaults, then applies each option in order.
// New options can be added without changing the function signature — forever.
func NewServer(opts ...Option) *Server {
	// Sensible defaults
	s := &Server{
		host:    "localhost",
		port:    8080,
		timeout: 30 * time.Second,
		maxConn: 100,
		tls:     false,
	}

	// Each option closure mutates s
	for _, opt := range opts {
		opt(s)
	}

	return s
}

func main() {
	// Minimal server — uses all defaults
	s1 := NewServer()
	fmt.Printf("s1: %s:%d (tls=%v)\n", s1.host, s1.port, s1.tls)

	// Custom server — only override what you need
	s2 := NewServer(
		WithHost("0.0.0.0"),
		WithPort(443),
		WithTLS(true),
		WithMaxConnections(1000),
		WithTimeout(60*time.Second),
	)
	fmt.Printf("s2: %s:%d (tls=%v, maxConn=%d, timeout=%v)\n",
		s2.host, s2.port, s2.tls, s2.maxConn, s2.timeout)

	// Another variant — closures let you compose options programmatically
	productionOpts := []Option{
		WithHost("0.0.0.0"),
		WithTLS(true),
		WithMaxConnections(5000),
	}
	s3 := NewServer(append(productionOpts, WithPort(8443))...)
	fmt.Printf("s3: %s:%d (tls=%v)\n", s3.host, s3.port, s3.tls)
}
```

**Why senior engineers use this**: adding a new configuration field later requires only a new `WithXxx` function — existing call sites compile unchanged. Compare to a config struct literal where every call site must be updated when fields are added.

---

## 7. Closures with Goroutines — Coordination Patterns

Closures and goroutines are designed to work together. The closure captures the synchronization primitives (channels, WaitGroups, mutexes) and the goroutine uses them — all without any global state.

```go
// Example 7: Closure + goroutine coordination with WaitGroup and channel
package main

import (
	"fmt"
	"sync"
)

// workerPool spawns n workers. Each worker is a closure that captures
// the jobs channel and the WaitGroup — both shared coordination primitives.
func workerPool(n int, jobs <-chan int) <-chan int {
	results := make(chan int, n*2)
	var wg sync.WaitGroup

	for id := 0; id < n; id++ {
		id := id // Capture per-worker id (shadow pattern)
		wg.Add(1)

		go func() { // This is a closure — captures wg, jobs, results, id
			defer wg.Done()
			for job := range jobs {
				result := job * job // simulate work
				fmt.Printf("  worker %d: %d^2 = %d\n", id, job, result)
				results <- result
			}
		}()
	}

	// Closer goroutine: closes results when all workers finish.
	// This closure captures wg and results.
	go func() {
		wg.Wait()
		close(results)
	}()

	return results
}

func main() {
	jobs := make(chan int, 10)

	// Send jobs
	for i := 1; i <= 9; i++ {
		jobs <- i
	}
	close(jobs)

	// Start 3 workers
	results := workerPool(3, jobs)

	// Collect results
	sum := 0
	for r := range results {
		sum += r
	}
	fmt.Printf("Sum of squares 1..9 = %d\n", sum) // 1+4+9+16+25+36+49+64+81 = 285
}
```

---

## 8. State Encapsulation — Closure as a Lightweight Object

When you need private state with multiple behaviors, closures can replace a simple struct. This is not always better than a struct — use it when the state is simple and the behaviors are few.

```go
// Example 8: Closure-based state machine — a rate limiter token bucket
package main

import (
	"fmt"
	"time"
)

// newRateLimiter returns two functions: one to attempt acquisition, one to see tokens.
// The token bucket state is entirely private — only accessible through these functions.
func newRateLimiter(capacity int, refillPerSecond int) (allow func() bool, tokens func() int) {
	bucket := capacity             // current tokens — captured by both closures
	lastRefill := time.Now()       // also captured
	mu := make(chan struct{}, 1)    // mutex via channel (simple, illustrative)
	mu <- struct{}{}               // unlock initially

	refill := func() {
		now := time.Now()
		elapsed := now.Sub(lastRefill).Seconds()
		add := int(elapsed * float64(refillPerSecond))
		if add > 0 {
			bucket += add
			if bucket > capacity {
				bucket = capacity
			}
			lastRefill = now
		}
	}

	allow = func() bool {
		<-mu // acquire lock
		defer func() { mu <- struct{}{} }() // release lock

		refill()
		if bucket > 0 {
			bucket--
			return true
		}
		return false
	}

	tokens = func() int {
		<-mu
		defer func() { mu <- struct{}{} }()
		refill()
		return bucket
	}

	return allow, tokens
}

func main() {
	allow, tokens := newRateLimiter(5, 2) // 5 token capacity, refill 2/sec

	fmt.Printf("Tokens available: %d\n", tokens())

	// Consume all tokens
	for i := 0; i < 7; i++ {
		ok := allow()
		fmt.Printf("Request %d: allowed=%v (tokens remaining: %d)\n", i+1, ok, tokens())
	}

	// Wait and refill
	fmt.Println("Waiting 1 second for refill...")
	time.Sleep(1 * time.Second)
	fmt.Printf("Tokens after refill: %d\n", tokens())

	ok := allow()
	fmt.Printf("Request after refill: allowed=%v\n", ok)
}
```

---

## Common Pitfalls Summary

| Pitfall | Cause | Fix |
|---|---|---|
| Goroutine loop bug | Loop variable captured by reference, goroutine runs after loop | Pass as argument `go func(i int){...}(i)` or shadow `i := i` |
| Unexpected shared state | Two closures from same factory share one variable | Verify factory creates new variables per call |
| Memory leak via closure | Closure captures large object, prevents GC | Set captured pointer to nil when done, or copy only needed fields |
| Race condition | Multiple goroutines capture and mutate the same variable | Protect with mutex or channel; or make variable goroutine-local |
| Nil function call | Closure variable declared but not assigned | Initialize before use; check for nil if optional |

## When to Use Closures vs. Structs

Use a **closure** when:
- The state is simple (1-3 variables)
- The behavior is a single function or a small set of tightly related functions
- You want to hide implementation details from callers completely
- You are building middleware, options, or callbacks

Use a **struct with methods** when:
- The state is complex (4+ fields)
- You need multiple methods that share state
- You need the type to implement an interface
- You need the type to be serializable or inspectable (e.g., for testing, logging)
