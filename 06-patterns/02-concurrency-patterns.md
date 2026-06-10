# Concurrency Patterns in Go

> **Main Reference**: For foundational concurrency patterns (Worker Pool, Fan-Out/Fan-In, Pipeline, Pub-Sub, Circuit Breaker, Rate Limiter, errgroup, graceful shutdown), see **[03-concurrency/08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md)**. That file contains production-grade implementations with full explanations of each pattern's motivation and industry usage.

This file covers:
1. The **Actor Model** — a distinct approach to concurrency via message-passing actors
2. **CSP vs. Shared Memory** — a rigorous comparison of the two dominant models
3. **Structured Concurrency** — a manifesto for Go's missing model and how to approximate it
4. **Six additional patterns** not covered in the main concurrency file

---

## The Actor Model in Go

### What is it?

The Actor Model (Carl Hewitt, 1973) treats every concurrent entity as an "actor" — an isolated unit with its own private state, a mailbox (message queue), and a behavior function. Actors communicate ONLY by sending immutable messages to each other's mailboxes. There is no shared memory. Erlang, Elixir, and Akka (JVM) are built around this model.

Go does not have native actors, but the pattern maps cleanly to goroutines + channels: each actor is a goroutine with a dedicated `chan` as its mailbox.

### Why the Actor Model exists

Shared memory concurrency has a fundamental problem: any piece of code that holds a reference to shared state can corrupt it. Locks help, but they require discipline — forget one lock, and you have a data race. The actor model eliminates the problem by construction: actors have no shared state, so there's nothing to race on. Erlang/OTP's "let it crash" philosophy — actors crash, supervisors restart them — gives you fault-tolerant systems without try/catch in every goroutine.

### Actor Model vs. Go's CSP

| Aspect | Actor Model (Erlang/Akka) | Go (CSP) |
|--------|--------------------------|----------|
| Communication | Actor sends to named actor (by PID) | Goroutine sends to channel (the pipe) |
| State | Locked inside actor, never shared | By convention (not enforced by compiler) |
| Error handling | Supervisor tree — parent restarts crashed child | `errgroup`, manual `recover()` |
| Location | Actors can be on different machines (distributed) | Goroutines are local to the process |
| Discovery | Actor registry by name | Channel references passed explicitly |

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// --- Actor Model: Counter Actor ---
// The counter's state (count int) is NEVER accessed from outside.
// All mutations happen via message passing.

type CounterMsg struct {
	Type    string // "increment", "decrement", "get", "stop"
	Amount  int
	ReplyCh chan int // used only for "get"
}

type CounterActor struct {
	mailbox chan CounterMsg
	count   int
}

func NewCounterActor(bufSize int) *CounterActor {
	a := &CounterActor{
		mailbox: make(chan CounterMsg, bufSize),
	}
	go a.run() // the actor's behavior loop
	return a
}

// run is the actor's main loop — it processes one message at a time.
// Since only this goroutine reads/writes a.count, no lock is needed.
func (a *CounterActor) run() {
	for msg := range a.mailbox {
		switch msg.Type {
		case "increment":
			a.count += msg.Amount
		case "decrement":
			a.count -= msg.Amount
		case "get":
			msg.ReplyCh <- a.count
		case "stop":
			return
		}
	}
}

// Increment sends an increment message — fire and forget
func (a *CounterActor) Increment(n int) {
	a.mailbox <- CounterMsg{Type: "increment", Amount: n}
}

// Decrement sends a decrement message — fire and forget
func (a *CounterActor) Decrement(n int) {
	a.mailbox <- CounterMsg{Type: "decrement", Amount: n}
}

// Get sends a "get" message and waits for the reply — request/response
func (a *CounterActor) Get() int {
	reply := make(chan int, 1)
	a.mailbox <- CounterMsg{Type: "get", ReplyCh: reply}
	return <-reply
}

// Stop shuts down the actor
func (a *CounterActor) Stop() {
	a.mailbox <- CounterMsg{Type: "stop"}
	close(a.mailbox)
}

// --- Actor with Supervisor ---

type ActorStatus string

const (
	StatusRunning ActorStatus = "running"
	StatusStopped ActorStatus = "stopped"
)

// Supervisor monitors child actors and restarts them on panic.
type Supervisor struct {
	mu       sync.Mutex
	children map[string]func() // factory functions to restart actors
	statuses map[string]ActorStatus
}

func NewSupervisor() *Supervisor {
	return &Supervisor{
		children: make(map[string]func()),
		statuses: make(map[string]ActorStatus),
	}
}

// Register registers an actor by name with a factory for restarting it.
func (s *Supervisor) Register(name string, factory func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.children[name] = factory
	s.statuses[name] = StatusRunning
	go s.watchActor(name, factory)
}

func (s *Supervisor) watchActor(name string, factory func()) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("Supervisor: actor %q panicked (%v), restarting...\n", name, r)
			time.Sleep(100 * time.Millisecond) // back-off before restart
			go s.watchActor(name, factory)     // restart
			factory()
		}
	}()
	factory()
}

// --- Demonstration ---

func main() {
	// Simple counter actor — state is completely encapsulated
	counter := NewCounterActor(100)

	// Multiple goroutines send messages — NO DATA RACE (state is in the actor)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			counter.Increment(n)
		}(i)
	}
	wg.Wait()

	fmt.Printf("Counter value: %d\n", counter.Get()) // sum of 0+1+2+...+9 = 45
	counter.Stop()

	// --- Typed actors with request/response ---
	type EmailRequest struct {
		To      string
		Subject string
		Body    string
		ErrCh   chan error
	}

	emailActorMailbox := make(chan EmailRequest, 50)

	// Email actor: processes one email at a time
	go func() {
		for req := range emailActorMailbox {
			// Simulate sending email
			fmt.Printf("Sending email to %s: %s\n", req.To, req.Subject)
			req.ErrCh <- nil // success
		}
	}()

	// Send an email via the actor
	errCh := make(chan error, 1)
	emailActorMailbox <- EmailRequest{
		To:      "alice@example.com",
		Subject: "Hello from Actor",
		Body:    "Actor model in Go!",
		ErrCh:   errCh,
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	select {
	case err := <-errCh:
		if err != nil {
			fmt.Println("Email error:", err)
		} else {
			fmt.Println("Email sent successfully")
		}
	case <-ctx.Done():
		fmt.Println("Email timed out")
	}

	close(emailActorMailbox)
}
```

---

## CSP vs. Shared Memory: A Rigorous Comparison

### The Two Models

**Shared Memory (Java, C++, Python threading)**: Multiple threads access the same memory locations, protected by locks (mutexes, rwmutexes, semaphores). Correctness depends on every programmer correctly acquiring the right lock before every access.

**CSP — Communicating Sequential Processes (Go, Erlang)**: Concurrent processes communicate by passing messages through channels. The Go proverb: *"Do not communicate by sharing memory; instead, share memory by communicating."*

### Why the distinction matters at scale

At Google scale — billions of requests per day, hundreds of engineers on the same codebase — shared memory concurrency is a maintenance time bomb. A single forgotten lock in one code path causes a data race that corrupts state across the entire process, often in ways that are non-deterministic and hard to reproduce. The Kubernetes bug tracker has had multiple critical races in the scheduler. CSP doesn't eliminate bugs, but it constrains them: a bug in a goroutine's message handling is local to that goroutine.

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// === SHARED MEMORY APPROACH ===

type SharedCounter struct {
	mu    sync.RWMutex
	count int64
	// Problem: every caller must know to acquire mu before accessing count
	// One missed lock anywhere = data race
}

func (c *SharedCounter) Increment() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.count++
}

func (c *SharedCounter) Read() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.count
}

// SharedCache has a classic "check-then-act" race even with locks
type SharedCache struct {
	mu   sync.RWMutex
	data map[string]string
}

func (c *SharedCache) GetOrSet(key, value string) string {
	// Check
	c.mu.RLock()
	if v, ok := c.data[key]; ok {
		c.mu.RUnlock()
		return v
	}
	c.mu.RUnlock()

	// Act — RACE CONDITION: another goroutine may have Set() between unlock and here
	c.mu.Lock()
	defer c.mu.Unlock()
	// Must re-check after acquiring write lock (double-checked locking pattern)
	if v, ok := c.data[key]; ok {
		return v
	}
	c.data[key] = value
	return value
}

// === CSP / CHANNEL APPROACH ===

// CacheActor owns its state completely. No external lock needed.
type CacheActor struct {
	ops chan cacheOp
}

type cacheOp struct {
	key     string
	value   string
	isWrite bool
	reply   chan string
}

func NewCacheActor() *CacheActor {
	a := &CacheActor{ops: make(chan cacheOp, 64)}
	go func() {
		data := make(map[string]string) // owned exclusively by this goroutine
		for op := range a.ops {
			if op.isWrite {
				if _, exists := data[op.key]; !exists {
					data[op.key] = op.value
				}
				op.reply <- data[op.key]
			} else {
				op.reply <- data[op.key] // empty string if not found
			}
		}
	}()
	return a
}

func (a *CacheActor) GetOrSet(key, value string) string {
	reply := make(chan string, 1)
	a.ops <- cacheOp{key: key, value: value, isWrite: true, reply: reply}
	return <-reply
}

// === ATOMIC — best of both worlds for simple counters ===

type AtomicCounter struct {
	count atomic.Int64
}

func (c *AtomicCounter) Increment() {
	c.count.Add(1)
}

func (c *AtomicCounter) Read() int64 {
	return c.count.Load()
}

func main() {
	// Both approaches give correct results
	sc := &SharedCounter{}
	ac := &AtomicCounter{}
	ca := NewCacheActor()

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sc.Increment()
			ac.Increment()
		}()
	}
	wg.Wait()

	fmt.Printf("SharedCounter: %d\n", sc.Read())
	fmt.Printf("AtomicCounter: %d\n", ac.Read())

	// CacheActor: no race between check and set
	result := ca.GetOrSet("greeting", "hello")
	fmt.Printf("CacheActor get-or-set: %s\n", result)
	result = ca.GetOrSet("greeting", "world") // should still return "hello"
	fmt.Printf("CacheActor second call: %s\n", result)

	close(ca.ops)
}

// === Summary: Which to use? ===
//
// Use channels (CSP) when:
//   - Transferring OWNERSHIP of data between goroutines
//   - Coordinating goroutine lifecycle (done signals, cancellation)
//   - Implementing producer/consumer, pipeline, pub-sub
//   - The data is complex and evolving — actors encapsulate it cleanly
//
// Use mutex (shared memory) when:
//   - Simple shared state that many goroutines read, few write (sync.RWMutex)
//   - Caching with read-heavy access patterns
//   - You need to protect a short critical section efficiently
//   - Data is simple and the lock granularity is well-understood
//
// Use atomics when:
//   - Single numeric counters, flags, pointers
//   - Maximum performance required (no syscall, no scheduler involvement)
//   - The operation is inherently atomic (Add, CompareAndSwap, Store/Load)
//
// The WRONG choice:
//   - Channels for protecting counters — massive overhead for a simple int
//   - Mutexes for producer/consumer — deadlock-prone, hard to reason about
```

---

## Structured Concurrency: A Manifesto for Go

### The problem with raw goroutines

In 2021, Nathaniel J. Smith published "Notes on structured concurrency, or: Go statement considered harmful." The argument: `go func()` is like `goto` — it creates a concurrent computation that escapes the calling scope with no automatic tracking, no automatic cancellation, no automatic error collection.

```go
// This is UNSTRUCTURED concurrency — the goroutine outlives the scope
func processRequest(req Request) {
    go func() {
        // This goroutine runs forever — or until it panics silently
        // If processRequest returns, the goroutine is STILL RUNNING
        // If the goroutine panics, no one catches it
        // If the goroutine fails, the caller never knows
        sendNotification(req)
    }()
    // processRequest returns, but work is still in-flight
}
```

**Structured concurrency's promise**: every goroutine you spawn must:
1. Be tracked (you know it exists)
2. Be bounded (it will eventually finish)
3. Propagate errors back to its parent
4. Be cancellable (via context)
5. Be joined (parent waits for all children before returning)

Go doesn't enforce this at the language level, but `errgroup.Group` approximates it.

```go
package main

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/sync/errgroup"
)

// --- Unstructured (BAD) ---
func processOrdersUnstructured(orderIDs []string) error {
	for _, id := range orderIDs {
		go func(orderID string) {
			// ❌ No tracking, no error collection, no cancellation
			if err := processOrder(orderID); err != nil {
				fmt.Printf("error processing %s: %v\n", orderID, err)
				// error is logged but NOT returned to caller
			}
		}(id)
	}
	// Returns immediately — goroutines may still be running!
	// Caller has no idea if processing succeeded or failed.
	return nil
}

// --- Structured with errgroup (GOOD) ---
func processOrdersStructured(ctx context.Context, orderIDs []string) error {
	g, ctx := errgroup.WithContext(ctx) // child context — cancels all on first error

	for _, id := range orderIDs {
		orderID := id // capture for closure
		g.Go(func() error {
			// ✅ Tracked by errgroup
			// ✅ Error propagated back
			// ✅ ctx cancellation stops remaining orders if one fails
			return processOrder(orderID)
		})
	}

	// ✅ Waits for ALL goroutines to complete
	// ✅ Returns first non-nil error (others are cancelled via ctx)
	return g.Wait()
}

// --- Structured with semaphore for bounded concurrency ---
func processOrdersBounded(ctx context.Context, orderIDs []string, maxConcurrent int) error {
	g, ctx := errgroup.WithContext(ctx)
	sem := make(chan struct{}, maxConcurrent) // semaphore

	for _, id := range orderIDs {
		orderID := id
		g.Go(func() error {
			// Acquire semaphore slot (blocks if maxConcurrent already running)
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return ctx.Err()
			}
			defer func() { <-sem }() // release slot when done

			return processOrder(orderID)
		})
	}

	return g.Wait()
}

func processOrder(id string) error {
	time.Sleep(10 * time.Millisecond) // simulate work
	if id == "bad-order" {
		return fmt.Errorf("order %s: invalid", id)
	}
	return nil
}

func main() {
	ctx := context.Background()
	orders := []string{"order-1", "order-2", "order-3"}

	// Structured: all goroutines tracked, errors propagated
	if err := processOrdersStructured(ctx, orders); err != nil {
		fmt.Println("Error:", err)
	} else {
		fmt.Println("All orders processed")
	}

	// With a failing order
	ordersWithBad := append(orders, "bad-order")
	if err := processOrdersStructured(ctx, ordersWithBad); err != nil {
		fmt.Println("Expected error:", err)
	}

	// Bounded: at most 2 concurrent
	if err := processOrdersBounded(ctx, orders, 2); err != nil {
		fmt.Println("Bounded error:", err)
	} else {
		fmt.Println("Bounded processing done")
	}
}
```

### The Structured Concurrency Checklist

```
For every goroutine you spawn, ensure:
  [ ] It's tracked — errgroup, WaitGroup, or explicit channel
  [ ] It accepts ctx context.Context — for cancellation
  [ ] It propagates errors — via errgroup or error channel
  [ ] It's bounded — will finish in finite time
  [ ] It's joined — parent calls Wait() before returning
  [ ] It has a name — for pprof/debugging (use goroutine labels)
```

---

## Six Additional Patterns

### Pattern 1: Timeout Pattern with Multiple Strategies

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrTimeout = errors.New("operation timed out")

// WithTimeout wraps any operation with a deadline.
// Returns ErrTimeout if the operation doesn't complete in time.
func WithTimeout[T any](ctx context.Context, timeout time.Duration, fn func(context.Context) (T, error)) (T, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	type result struct {
		val T
		err error
	}
	ch := make(chan result, 1)

	go func() {
		val, err := fn(ctx)
		ch <- result{val, err}
	}()

	select {
	case r := <-ch:
		return r.val, r.err
	case <-ctx.Done():
		var zero T
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return zero, fmt.Errorf("%w: %v", ErrTimeout, ctx.Err())
		}
		return zero, ctx.Err()
	}
}

func slowOperation(ctx context.Context) (string, error) {
	select {
	case <-time.After(500 * time.Millisecond):
		return "result", nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func main() {
	ctx := context.Background()

	// Succeeds with generous timeout
	val, err := WithTimeout(ctx, 1*time.Second, slowOperation)
	fmt.Printf("Success: val=%s err=%v\n", val, err)

	// Fails with tight timeout
	_, err = WithTimeout(ctx, 100*time.Millisecond, slowOperation)
	if errors.Is(err, ErrTimeout) {
		fmt.Println("Timed out as expected")
	}
}
```

### Pattern 2: Retry with Exponential Backoff

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"time"
)

type RetryConfig struct {
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
	Multiplier  float64
	Jitter      bool
}

var DefaultRetryConfig = RetryConfig{
	MaxAttempts: 3,
	BaseDelay:   100 * time.Millisecond,
	MaxDelay:    30 * time.Second,
	Multiplier:  2.0,
	Jitter:      true,
}

// IsRetryable is a function the caller provides to determine if an error should be retried.
type IsRetryable func(err error) bool

// Retry executes fn up to MaxAttempts times, backing off exponentially between attempts.
// It only retries if isRetryable(err) returns true.
func Retry[T any](ctx context.Context, cfg RetryConfig, isRetryable IsRetryable, fn func() (T, error)) (T, error) {
	var lastErr error
	var zero T

	for attempt := 0; attempt < cfg.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, fmt.Errorf("retry cancelled: %w", err)
		}

		val, err := fn()
		if err == nil {
			return val, nil
		}

		lastErr = err

		if !isRetryable(err) {
			return zero, fmt.Errorf("non-retryable error on attempt %d: %w", attempt+1, err)
		}

		if attempt == cfg.MaxAttempts-1 {
			break // no sleep after last attempt
		}

		// Exponential backoff: delay = baseDelay * multiplier^attempt
		delay := time.Duration(float64(cfg.BaseDelay) * math.Pow(cfg.Multiplier, float64(attempt)))
		if delay > cfg.MaxDelay {
			delay = cfg.MaxDelay
		}

		// Add jitter to prevent thundering herd
		if cfg.Jitter {
			jitter := time.Duration(rand.Int63n(int64(delay / 2)))
			delay = delay/2 + jitter
		}

		fmt.Printf("Attempt %d failed: %v. Retrying in %v\n", attempt+1, err, delay)

		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return zero, fmt.Errorf("retry cancelled during backoff: %w", ctx.Err())
		}
	}

	return zero, fmt.Errorf("all %d attempts failed: %w", cfg.MaxAttempts, lastErr)
}

var ErrTransient = errors.New("transient error")
var ErrPermanent = errors.New("permanent error")

func unreliableAPI() (string, error) {
	if rand.Float32() < 0.7 { // 70% failure rate
		return "", fmt.Errorf("API call failed: %w", ErrTransient)
	}
	return "success", nil
}

func main() {
	rand.New(rand.NewSource(42))
	ctx := context.Background()

	result, err := Retry(ctx, DefaultRetryConfig,
		func(err error) bool { return errors.Is(err, ErrTransient) },
		unreliableAPI,
	)
	if err != nil {
		fmt.Println("Final error:", err)
	} else {
		fmt.Println("Result:", result)
	}

	// Permanent error — no retry
	_, err = Retry(ctx, DefaultRetryConfig,
		func(err error) bool { return errors.Is(err, ErrTransient) },
		func() (string, error) {
			return "", fmt.Errorf("cannot recover: %w", ErrPermanent)
		},
	)
	fmt.Println("Non-retryable:", err)
}
```

### Pattern 3: Scatter-Gather (Parallel Fan-Out with Collection)

```go
package main

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"
)

// ScatterGather runs fn on each item concurrently, collects ALL results.
// Unlike fan-out/fan-in which returns first-come-first-served,
// ScatterGather preserves the original ordering of results.
func ScatterGather[T, U any](
	ctx context.Context,
	items []T,
	fn func(context.Context, T) (U, error),
) ([]U, []error) {
	results := make([]U, len(items))
	errs := make([]error, len(items))

	var wg sync.WaitGroup
	for i, item := range items {
		wg.Add(1)
		go func(idx int, val T) {
			defer wg.Done()
			result, err := fn(ctx, val)
			results[idx] = result
			errs[idx] = err
		}(i, item)
	}
	wg.Wait()

	return results, errs
}

// BestOf runs fn concurrently, returns the FIRST successful result.
// Cancels remaining goroutines when one succeeds.
// Used for "hedge requests" — send to multiple backends, use fastest.
func BestOf[T any](
	ctx context.Context,
	items []T,
	fn func(context.Context, T) (T, error),
) (T, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type result struct {
		val T
		err error
	}
	ch := make(chan result, len(items))

	for _, item := range items {
		go func(val T) {
			v, err := fn(ctx, val)
			ch <- result{v, err}
		}(item)
	}

	var lastErr error
	var zero T
	for i := 0; i < len(items); i++ {
		r := <-ch
		if r.err == nil {
			cancel() // cancel remaining
			return r.val, nil
		}
		lastErr = r.err
	}
	return zero, fmt.Errorf("all attempts failed: %w", lastErr)
}

type SearchResult struct {
	Source string
	Data   string
}

func searchBackend(ctx context.Context, backend string) (SearchResult, error) {
	delay := time.Duration(50+len(backend)*10) * time.Millisecond
	select {
	case <-time.After(delay):
		return SearchResult{Source: backend, Data: "results from " + backend}, nil
	case <-ctx.Done():
		return SearchResult{}, ctx.Err()
	}
}

func main() {
	ctx := context.Background()
	backends := []string{"primary", "secondary", "tertiary"}

	// ScatterGather: query all backends, collect all results
	results, errs := ScatterGather(ctx, backends, searchBackend)
	sort.Slice(results, func(i, j int) bool { return results[i].Source < results[j].Source })
	for i, r := range results {
		if errs[i] != nil {
			fmt.Printf("Backend error: %v\n", errs[i])
		} else {
			fmt.Printf("Got: source=%s data=%s\n", r.Source, r.Data)
		}
	}

	// BestOf: return first result (hedge request pattern)
	best, err := BestOf(ctx, backends, searchBackend)
	if err != nil {
		fmt.Println("BestOf error:", err)
	} else {
		fmt.Printf("Fastest result: %s\n", best.Source)
	}
}
```

### Pattern 4: Debounce and Throttle

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// Debounce returns a function that delays calling fn until d has elapsed
// since the LAST call. Useful for: search-as-you-type, resize handlers,
// batching rapid config reloads.
func Debounce(fn func(), d time.Duration) func() {
	var mu sync.Mutex
	var timer *time.Timer

	return func() {
		mu.Lock()
		defer mu.Unlock()

		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(d, fn)
	}
}

// Throttle returns a function that calls fn at most once per interval.
// First call goes through immediately; subsequent calls within the interval
// are dropped (or queued — use "trailing" variant for queued).
func Throttle(fn func(), interval time.Duration) func() {
	var mu sync.Mutex
	var lastCall time.Time

	return func() {
		mu.Lock()
		defer mu.Unlock()

		now := time.Now()
		if now.Sub(lastCall) >= interval {
			lastCall = now
			go fn() // run in background to not block the caller
		}
		// else: silently drop — throttle in effect
	}
}

// ThrottleWithQueue is a throttle that queues the LAST call during a throttle window
// and executes it when the window expires (trailing throttle).
func ThrottleWithQueue(fn func(), interval time.Duration) func() {
	var mu sync.Mutex
	var lastCall time.Time
	var pending bool
	var timer *time.Timer

	return func() {
		mu.Lock()
		defer mu.Unlock()

		now := time.Now()
		if now.Sub(lastCall) >= interval {
			lastCall = now
			go fn()
			return
		}

		// Queue the call for when the window expires
		if !pending {
			pending = true
			remaining := interval - now.Sub(lastCall)
			if timer != nil {
				timer.Stop()
			}
			timer = time.AfterFunc(remaining, func() {
				mu.Lock()
				pending = false
				lastCall = time.Now()
				mu.Unlock()
				fn()
			})
		}
		// else: already queued — the last call will execute when the window expires
	}
}

func main() {
	var callCount int
	var mu sync.Mutex

	handler := func() {
		mu.Lock()
		callCount++
		count := callCount
		mu.Unlock()
		fmt.Printf("Handler called (call #%d) at %v\n", count, time.Now().Format("15:04:05.000"))
	}

	// Debounce: only fires after 100ms of silence
	debounced := Debounce(handler, 100*time.Millisecond)
	fmt.Println("=== Debounce ===")
	for i := 0; i < 5; i++ {
		debounced()
		time.Sleep(20 * time.Millisecond) // rapid calls — all but last are suppressed
	}
	time.Sleep(200 * time.Millisecond) // wait for debounce to fire

	// Throttle: fires at most once per 100ms
	mu.Lock()
	callCount = 0
	mu.Unlock()
	throttled := Throttle(handler, 100*time.Millisecond)
	fmt.Println("=== Throttle ===")
	for i := 0; i < 5; i++ {
		throttled()
		time.Sleep(30 * time.Millisecond) // 3 calls within the 100ms window
	}
	time.Sleep(200 * time.Millisecond) // wait for any pending calls
}
```

### Pattern 5: Concurrent Cache with Singleflight

```go
package main

import (
	"fmt"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// ConcurrentCache is a thread-safe cache with:
// 1. Read-through: on miss, fetch from source and cache
// 2. Singleflight: concurrent requests for the same key collapse into ONE fetch
// 3. TTL expiration
//
// The singleflight prevents the "cache stampede" problem:
// 1000 goroutines miss the cache simultaneously → 1000 parallel DB queries.
// With singleflight: 1 DB query, 999 goroutines wait for the result.

type CacheEntry[T any] struct {
	value     T
	expiresAt time.Time
}

type ConcurrentCache[T any] struct {
	mu      sync.RWMutex
	entries map[string]CacheEntry[T]
	ttl     time.Duration
	group   singleflight.Group
	fetch   func(key string) (T, error)
}

func NewConcurrentCache[T any](ttl time.Duration, fetch func(string) (T, error)) *ConcurrentCache[T] {
	return &ConcurrentCache[T]{
		entries: make(map[string]CacheEntry[T]),
		ttl:     ttl,
		fetch:   fetch,
	}
}

func (c *ConcurrentCache[T]) Get(key string) (T, error) {
	// Fast path: check cache with read lock
	c.mu.RLock()
	if entry, ok := c.entries[key]; ok && time.Now().Before(entry.expiresAt) {
		val := entry.value
		c.mu.RUnlock()
		return val, nil
	}
	c.mu.RUnlock()

	// Cache miss: use singleflight to deduplicate concurrent fetches
	// All goroutines requesting the same key will block here until one fetch completes
	val, err, _ := c.group.Do(key, func() (interface{}, error) {
		// Re-check cache after acquiring singleflight (another goroutine may have fetched)
		c.mu.RLock()
		if entry, ok := c.entries[key]; ok && time.Now().Before(entry.expiresAt) {
			val := entry.value
			c.mu.RUnlock()
			return val, nil
		}
		c.mu.RUnlock()

		// Fetch from source
		fetchedVal, fetchErr := c.fetch(key)
		if fetchErr != nil {
			return nil, fetchErr
		}

		// Store in cache
		c.mu.Lock()
		c.entries[key] = CacheEntry[T]{
			value:     fetchedVal,
			expiresAt: time.Now().Add(c.ttl),
		}
		c.mu.Unlock()

		return fetchedVal, nil
	})

	if err != nil {
		var zero T
		return zero, err
	}
	return val.(T), nil
}

func main() {
	fetchCount := 0
	var fetchMu sync.Mutex

	cache := NewConcurrentCache(5*time.Minute, func(key string) (string, error) {
		fetchMu.Lock()
		fetchCount++
		count := fetchCount
		fetchMu.Unlock()

		fmt.Printf("Fetching key=%q (fetch #%d)\n", key, count)
		time.Sleep(50 * time.Millisecond) // simulate DB query
		return "value:" + key, nil
	})

	// Concurrent requests for the same key — only ONE fetch should happen
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			val, err := cache.Get("user:123")
			if err == nil {
				_ = val
			}
		}()
	}
	wg.Wait()

	fetchMu.Lock()
	fmt.Printf("Total fetches for 10 concurrent requests: %d (singleflight collapsed them)\n", fetchCount)
	fetchMu.Unlock()

	// Second request hits cache (no new fetch)
	val, _ := cache.Get("user:123")
	fetchMu.Lock()
	fmt.Printf("Cache hit: %s, total fetches: %d\n", val, fetchCount)
	fetchMu.Unlock()
}
```

### Pattern 6: Backpressure with Bounded Channels

```go
package main

import (
	"context"
	"fmt"
	"time"
)

// BackpressureQueue is a bounded work queue that applies backpressure to producers.
// When the queue is full, producers block (or can timeout/drop).
// This prevents memory exhaustion from an unbounded backlog.
//
// Used in: Cloudflare's request queues, Kafka consumer groups, HTTP request queues.

type BackpressureQueue[T any] struct {
	ch      chan T
	metrics struct {
		enqueued int64
		dropped  int64
		processed int64
	}
}

func NewBackpressureQueue[T any](capacity int) *BackpressureQueue[T] {
	return &BackpressureQueue[T]{
		ch: make(chan T, capacity),
	}
}

// EnqueueBlocking blocks until space is available or ctx is cancelled.
// Use for producers that MUST deliver (no dropping allowed).
func (q *BackpressureQueue[T]) EnqueueBlocking(ctx context.Context, item T) error {
	select {
	case q.ch <- item:
		q.metrics.enqueued++
		return nil
	case <-ctx.Done():
		return fmt.Errorf("enqueue cancelled: %w", ctx.Err())
	}
}

// EnqueueWithTimeout blocks for at most d before giving up.
func (q *BackpressureQueue[T]) EnqueueWithTimeout(item T, d time.Duration) bool {
	select {
	case q.ch <- item:
		q.metrics.enqueued++
		return true
	case <-time.After(d):
		q.metrics.dropped++
		return false
	}
}

// EnqueueOrDrop tries to enqueue; drops the item if the queue is full.
// Use for telemetry/metrics where dropping is acceptable.
func (q *BackpressureQueue[T]) EnqueueOrDrop(item T) bool {
	select {
	case q.ch <- item:
		q.metrics.enqueued++
		return true
	default:
		q.metrics.dropped++
		return false
	}
}

// Consume returns the channel for consumers to read from.
func (q *BackpressureQueue[T]) Consume() <-chan T {
	return q.ch
}

// Close signals no more items will be produced.
func (q *BackpressureQueue[T]) Close() {
	close(q.ch)
}

type Request struct {
	ID      int
	Payload string
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Small capacity — will demonstrate backpressure
	queue := NewBackpressureQueue[Request](5)

	// Consumer: processes one request per 50ms
	go func() {
		for req := range queue.Consume() {
			time.Sleep(50 * time.Millisecond)
			fmt.Printf("Processed request #%d\n", req.ID)
			queue.metrics.processed++
		}
	}()

	// Producer: sends 20 requests as fast as possible
	dropped := 0
	for i := 1; i <= 20; i++ {
		req := Request{ID: i, Payload: fmt.Sprintf("data-%d", i)}
		if !queue.EnqueueWithTimeout(req, 10*time.Millisecond) {
			dropped++
			fmt.Printf("Dropped request #%d (queue full)\n", i)
		}
	}

	// Wait for processing with context deadline
	<-ctx.Done()
	queue.Close()

	fmt.Printf("\nStats: enqueued=%d dropped=%d\n",
		queue.metrics.enqueued, queue.metrics.dropped)
}
```

---

## Cross-Reference

| Pattern | Location | Key Use Case |
|---------|----------|-------------|
| Worker Pool | [08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md) | Bounded goroutine parallelism |
| Fan-Out / Fan-In | [08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md) | Parallel sub-tasks, collect results |
| Pipeline | [08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md) | Staged data processing |
| Pub-Sub | [08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md) | Event broadcasting to multiple consumers |
| Circuit Breaker | [08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md) | Fail fast when dependency is down |
| Rate Limiter | [08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md) | Token bucket, sliding window |
| Graceful Shutdown | [08-advanced-patterns.md](../03-concurrency/08-advanced-patterns.md) | Signal handling, drain in-flight |
| Actor Model | This file | Encapsulated state with mailbox |
| CSP vs Shared Memory | This file | Design decision guide |
| Structured Concurrency | This file | errgroup, lifecycle tracking |
| Timeout | This file | Generic operation timeout wrapper |
| Retry + Backoff | This file | Transient failure recovery |
| Scatter-Gather | This file | Parallel fan-out, ordered collection |
| Debounce / Throttle | This file | Rate limiting UI/event handlers |
| Concurrent Cache + Singleflight | This file | Cache stampede prevention |
| Backpressure | This file | Bounded queues, drop/block policies |
