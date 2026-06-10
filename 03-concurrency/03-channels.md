# Go Channels — Complete Deep-Dive

## What Is This?

A channel is a typed conduit through which goroutines send and receive values. It is Go's primary mechanism for safe communication between concurrently running goroutines — no shared memory, no mutexes required for the transfer itself. Channels are first-class values: you can pass them to functions, store them in structs, and close them to signal completion.

## Why Does It Exist?

Before channels, concurrent programs shared data through shared memory protected by locks. Lock-based code is error-prone: race conditions from forgotten locks, deadlocks from lock ordering, and priority inversion all plague production systems. Go's designers studied Communicating Sequential Processes (CSP), a 1978 formal model by Tony Hoare where independent processes communicate exclusively by passing messages. Channels are Go's direct implementation of CSP. The result is a model where the act of communication itself synchronizes goroutines, eliminating the need to manually coordinate access to shared state for most patterns.

> "Do not communicate by sharing memory; share memory by communicating." — Rob Pike

## Who Uses This in Industry?

- **Google**: gRPC streaming responses are modeled with channels internally. The gRPC-Go library uses channels to feed decoded frames from the network to application handlers, allowing each stream to be processed by a dedicated goroutine without mutex contention.
- **Uber**: Uber's Go microservices use fan-out channel patterns for parallel database lookups — a single ride request triggers concurrent queries to driver, pricing, and ETA services via a fan-out, then fan-in collects results before responding.
- **Kubernetes**: The core controller-manager uses `workqueue` packages backed by channels. Every resource event (pod created, node deleted) is enqueued as a message and consumed by worker goroutines — the entire reconciliation loop is channel-driven.
- **Cloudflare**: Cloudflare's DNS-over-HTTPS and TLS termination services use semaphore channels (buffered channels of `struct{}`) to cap concurrent upstream connections per client, providing backpressure without a separate rate-limiter library.
- **Docker / containerd**: containerd's event bus uses publish-subscribe via channels. Container lifecycle events (start, stop, OOM) are broadcast to multiple subscribers, each receiving events on its own channel.
- **HashiCorp Vault**: Vault's seal/unseal coordination and secret lease renewal use done channels and ticker channels for lifecycle management across goroutines.

## Industry Standards and Best Practices

**Senior engineers do:**
- Use directional channel types (`chan<- T`, `<-chan T`) in all function signatures to document ownership and prevent misuse at compile time.
- Close channels only from the single goroutine that owns/writes to them. Never close from receivers.
- Use `context.Context` with a done channel (`ctx.Done()`) for cancellation — not raw channels — in production services.
- Prefer unbuffered channels when synchronization is the goal; choose buffered only when you have a measured reason (queue, rate limit, batch).
- Always handle the `ok` flag on receive to distinguish zero-value from closed channel.
- Use `select` with a `default` case for non-blocking probes; use `select` with `time.After` for timeouts.

**Beginners commonly do:**
- Buffer channels "just in case" to avoid thinking about synchronization.
- Forget to close channels, causing goroutine leaks.
- Close channels from multiple goroutines (panic).
- Send on a closed channel (panic).
- Spawn goroutines in loops without a done channel, creating thousands of leaked goroutines under load.

## Why Go's Approach Is Unique

| Language | Concurrent Communication |
|---|---|
| Java | `BlockingQueue`, `synchronized`, `ReentrantLock` — all shared-memory based |
| Python | `queue.Queue` exists but the GIL limits true parallelism; asyncio uses coroutines and event loops, not channels |
| Node.js | Single-threaded event loop; worker threads communicate via `postMessage` (structured clone, not typed) |
| Rust | `mpsc::channel` — similar idea, but ownership rules enforce the contract at compile time via the type system |
| Go | Channels are a language primitive; `select` is a keyword; directional types are enforced by the compiler; goroutine scheduling is cooperative around channel ops |

Go's key tradeoff: simpler than Rust's ownership model (no lifetime annotations), more expressive than Java's `synchronized` blocks, and built into the scheduler so the runtime can park goroutines on channel operations without burning OS threads. The cost: Go's channel model requires programmer discipline (no compile-time alias tracking); Rust's ownership model catches more misuse statically.

---

## CSP Theory — The Foundation

Tony Hoare's CSP defines processes that run independently and synchronize only through named communication events. Two processes can only exchange a value when both are ready — neither knows about the other's internal state. Go channels implement this: an unbuffered `ch <- v` blocks the sender until a receiver executes `v := <-ch`. The moment of transfer is the synchronization point. No locks, no condition variables, no polling.

```
Process A                    Process B
---------                    ---------
Compute result               Wait for input
ch <- result    <======>    input := <-ch   (both unblock simultaneously)
Continue                     Process input
```

This model composes: you can chain processes (pipeline), split input across processes (fan-out), or merge outputs (fan-in) — all without shared variables.

---

## 1. Channel Fundamentals

### 1.1 Creating Channels

```go
// Example 01 — Creating and using basic channels
package main

import "fmt"

func main() {
	// Unbuffered channel — synchronous handoff
	unbuf := make(chan int)

	// Buffered channel — can hold up to 3 values before blocking
	buf := make(chan string, 3)

	// Send on buffered channel (does not block — buffer has space)
	buf <- "alpha"
	buf <- "beta"
	buf <- "gamma"

	// Receive from buffered channel
	fmt.Println(<-buf) // alpha
	fmt.Println(<-buf) // beta
	fmt.Println(<-buf) // gamma

	// Unbuffered requires a concurrent receiver
	go func() {
		val := <-unbuf // receiver ready
		fmt.Println("received:", val)
	}()
	unbuf <- 42 // sender blocks here until the goroutine above is ready
}
```

### 1.2 The Two-Value Receive

```go
// Example 02 — Receiving with ok to detect closed channel
package main

import "fmt"

func generate(ch chan<- int, nums ...int) {
	for _, n := range nums {
		ch <- n
	}
	close(ch) // sender closes when done
}

func main() {
	ch := make(chan int, 5)
	go generate(ch, 10, 20, 30)

	for {
		v, ok := <-ch
		if !ok {
			fmt.Println("channel closed")
			break
		}
		fmt.Println("got:", v)
	}

	// Idiomatic shorthand using range — same as above
	ch2 := make(chan int, 3)
	go func() {
		for _, n := range []int{1, 2, 3} {
			ch2 <- n
		}
		close(ch2)
	}()

	for v := range ch2 {
		fmt.Println("range got:", v)
	}
}
```

**Key rules about `close(ch)`:**
- Only the sender (writer) should close a channel.
- Closing a channel that is already closed panics.
- Sending to a closed channel panics.
- Receiving from a closed channel returns the zero value and `ok == false` immediately, indefinitely.

---

## 2. Unbuffered vs Buffered

### 2.1 Unbuffered — Synchronous Rendezvous

```go
// Example 03 — Unbuffered channel as synchronization point
package main

import (
	"fmt"
	"time"
)

func worker(id int, ready chan<- bool) {
	fmt.Printf("worker %d: starting up...\n", id)
	time.Sleep(time.Duration(id*100) * time.Millisecond) // simulate init
	fmt.Printf("worker %d: ready\n", id)
	ready <- true // signal readiness — blocks until main receives
}

func main() {
	ready := make(chan bool) // unbuffered

	go worker(1, ready)
	<-ready // main blocks until worker sends
	fmt.Println("main: worker 1 confirmed ready")

	go worker(2, ready)
	<-ready
	fmt.Println("main: worker 2 confirmed ready")
}
```

With an unbuffered channel, the `ready <- true` in `worker` does not complete until `main` executes `<-ready`. This is a guaranteed synchronization point — not "eventual", not "soon", but exactly at that line.

### 2.2 Buffered — Async Queue with Backpressure

```go
// Example 04 — Buffered channel as a task queue
package main

import (
	"fmt"
	"time"
)

func processTask(id int, tasks <-chan string, done chan<- struct{}) {
	for task := range tasks {
		fmt.Printf("worker %d processing: %s\n", id, task)
		time.Sleep(50 * time.Millisecond) // simulate work
	}
	done <- struct{}{}
}

func main() {
	tasks := make(chan string, 10) // buffer of 10 — producer won't block until full
	done := make(chan struct{}, 2)

	// Two consumers
	go processTask(1, tasks, done)
	go processTask(2, tasks, done)

	// Producer enqueues work — does not block (buffer has space)
	jobs := []string{"parse-json", "validate", "store-db", "notify", "audit-log"}
	for _, j := range jobs {
		tasks <- j
	}
	close(tasks) // no more work — workers will drain and exit range

	// Wait for both workers to finish
	<-done
	<-done
	fmt.Println("all tasks complete")
}
```

**When to choose which:**

| Situation | Choice | Reason |
|---|---|---|
| You need a guaranteed handoff (both sides must be ready) | Unbuffered | The sync point IS the guarantee |
| You want to decouple producer speed from consumer speed | Buffered | Queue absorbs bursts |
| You want backpressure (slow consumer eventually slows producer) | Buffered (small) | Full buffer blocks producer naturally |
| You need to know when work is "accepted" | Unbuffered | Sender unblocks only after receiver has it |

---

## 3. Channel Direction

Directional channel types allow the compiler to enforce who may send and who may receive. This documents intent and prevents entire classes of bugs.

```go
// Example 05 — Directional channels enforce send/receive roles
package main

import "fmt"

// producer can only send — compile error if it tries to receive or close in a way that violates direction
func producer(out chan<- int) {
	for i := 0; i < 5; i++ {
		out <- i
	}
	close(out)
	// <-out  // COMPILE ERROR: cannot receive from send-only channel
}

// consumer can only receive — compile error if it tries to send
func consumer(in <-chan int) {
	for v := range in {
		fmt.Println("consumed:", v)
	}
	// in <- 99  // COMPILE ERROR: cannot send to receive-only channel
}

func main() {
	ch := make(chan int, 5) // bidirectional in main — assigned to directional params
	go producer(ch)         // ch implicitly converts to chan<- int
	consumer(ch)            // ch implicitly converts to <-chan int
}
```

**Why this matters in production:** In a service with a dozen goroutines, you can glance at a function signature and immediately know: "this function only consumes from a queue; it can never accidentally close or double-send." The compiler enforces the contract that code review tries to enforce manually.

---

## 4. Select Statement

`select` waits on multiple channel operations simultaneously. It picks whichever case is ready; if multiple are ready simultaneously it picks one at random (fair, not priority by default).

### 4.1 Basic Select

```go
// Example 06 — Select on multiple channels
package main

import (
	"fmt"
	"time"
)

func fastSource(ch chan<- string) {
	time.Sleep(50 * time.Millisecond)
	ch <- "fast result"
}

func slowSource(ch chan<- string) {
	time.Sleep(200 * time.Millisecond)
	ch <- "slow result"
}

func main() {
	fast := make(chan string, 1)
	slow := make(chan string, 1)

	go fastSource(fast)
	go slowSource(slow)

	// Collect both results, print as each arrives
	for i := 0; i < 2; i++ {
		select {
		case r := <-fast:
			fmt.Println("received from fast:", r)
		case r := <-slow:
			fmt.Println("received from slow:", r)
		}
	}
}
```

### 4.2 Non-Blocking Select with Default

```go
// Example 07 — Non-blocking probe with default
package main

import "fmt"

func main() {
	ch := make(chan int, 1)

	// Probe: receive only if something is there
	select {
	case v := <-ch:
		fmt.Println("got:", v)
	default:
		fmt.Println("nothing ready yet") // prints this
	}

	ch <- 99

	select {
	case v := <-ch:
		fmt.Println("got:", v) // prints this
	default:
		fmt.Println("nothing ready yet")
	}
}
```

### 4.3 Select with Timeout

```go
// Example 08 — Select with timeout using time.After
package main

import (
	"fmt"
	"time"
)

func slowOperation(result chan<- string) {
	time.Sleep(2 * time.Second) // intentionally too slow
	result <- "done"
}

func main() {
	result := make(chan string, 1)
	go slowOperation(result)

	select {
	case r := <-result:
		fmt.Println("success:", r)
	case <-time.After(500 * time.Millisecond):
		fmt.Println("timeout: operation took too long")
		// In production: cancel via context, not time.After alone
	}
}
```

### 4.4 Priority Select Pattern

Go's `select` is random when multiple cases are ready. If you need priority, use nested selects:

```go
// Example 09 — Priority select: high-priority channel checked first
package main

import "fmt"

func prioritySelect(high, low <-chan string) string {
	// Check high-priority channel first without blocking
	select {
	case v := <-high:
		return "HIGH: " + v
	default:
	}
	// Fall through to both channels if high is empty
	select {
	case v := <-high:
		return "HIGH: " + v
	case v := <-low:
		return "LOW: " + v
	}
}

func main() {
	high := make(chan string, 1)
	low := make(chan string, 1)

	low <- "background task"
	high <- "urgent request"

	fmt.Println(prioritySelect(high, low)) // HIGH: urgent request
	fmt.Println(prioritySelect(high, low)) // LOW: background task
}
```

---

## 5. Channel Patterns

### 5.1 Done Channel — Signaling Termination

```go
// Example 10 — Done channel for clean shutdown
package main

import (
	"fmt"
	"time"
)

func monitor(id int, done <-chan struct{}) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			fmt.Printf("monitor %d: heartbeat\n", id)
		case <-done:
			fmt.Printf("monitor %d: shutting down\n", id)
			return
		}
	}
}

func main() {
	done := make(chan struct{})

	go monitor(1, done)
	go monitor(2, done)

	time.Sleep(350 * time.Millisecond)
	close(done) // broadcast shutdown to ALL monitors simultaneously
	time.Sleep(50 * time.Millisecond) // let goroutines print shutdown messages
	fmt.Println("main: all monitors stopped")
}
```

`close(done)` is the idiomatic broadcast: every goroutine blocked on `<-done` unblocks immediately. Sending a value on `done` would only wake one goroutine.

### 5.2 Pipeline Pattern

```
Input Source → Stage 1 (parse) → Stage 2 (validate) → Stage 3 (store) → Output
     ↕                ↕                  ↕                   ↕
  chan int       chan Record        chan Record           chan Result
```

```go
// Example 11 — Three-stage pipeline
package main

import (
	"fmt"
	"strings"
)

// Stage 1: generate raw strings
func generate(words ...string) <-chan string {
	out := make(chan string)
	go func() {
		for _, w := range words {
			out <- w
		}
		close(out)
	}()
	return out
}

// Stage 2: uppercase each word
func toUpper(in <-chan string) <-chan string {
	out := make(chan string)
	go func() {
		for v := range in {
			out <- strings.ToUpper(v)
		}
		close(out)
	}()
	return out
}

// Stage 3: add exclamation
func exclaim(in <-chan string) <-chan string {
	out := make(chan string)
	go func() {
		for v := range in {
			out <- v + "!"
		}
		close(out)
	}()
	return out
}

func main() {
	// Compose pipeline
	words := generate("gopher", "channels", "pipeline")
	upper := toUpper(words)
	excited := exclaim(upper)

	for result := range excited {
		fmt.Println(result)
	}
	// Output:
	// GOPHER!
	// CHANNELS!
	// PIPELINE!
}
```

Each stage is a goroutine that reads from an input channel and writes to an output channel. The pipeline is lazy — a value only moves forward when the next stage is ready.

### 5.3 Fan-Out — Distribute Work to Multiple Workers

```go
// Example 12 — Fan-out: one producer, N workers
package main

import (
	"fmt"
	"sync"
)

func fanOut(in <-chan int, numWorkers int) []<-chan int {
	outputs := make([]<-chan int, numWorkers)
	for i := 0; i < numWorkers; i++ {
		out := make(chan int)
		outputs[i] = out
		go func(workerID int, out chan<- int) {
			for v := range in {
				out <- v * v // each worker squares the value
				fmt.Printf("worker %d processed %d\n", workerID, v)
			}
			close(out)
		}(i+1, out)
	}
	return outputs
}

func main() {
	in := make(chan int, 10)
	for i := 1; i <= 6; i++ {
		in <- i
	}
	close(in)

	// Distribute to 3 workers
	outputs := fanOut(in, 3)

	var wg sync.WaitGroup
	for _, out := range outputs {
		wg.Add(1)
		go func(ch <-chan int) {
			defer wg.Done()
			for v := range ch {
				fmt.Println("result:", v)
			}
		}(out)
	}
	wg.Wait()
}
```

### 5.4 Fan-In — Merge Multiple Channels into One

```go
// Example 13 — Fan-in: merge multiple channels into one
package main

import (
	"fmt"
	"sync"
	"time"
)

func source(name string, interval time.Duration) <-chan string {
	ch := make(chan string)
	go func() {
		for i := 0; i < 3; i++ {
			time.Sleep(interval)
			ch <- fmt.Sprintf("%s-%d", name, i)
		}
		close(ch)
	}()
	return ch
}

func fanIn(channels ...<-chan string) <-chan string {
	merged := make(chan string)
	var wg sync.WaitGroup

	forward := func(ch <-chan string) {
		defer wg.Done()
		for v := range ch {
			merged <- v
		}
	}

	wg.Add(len(channels))
	for _, ch := range channels {
		go forward(ch)
	}

	// Close merged when all input channels are drained
	go func() {
		wg.Wait()
		close(merged)
	}()

	return merged
}

func main() {
	a := source("sensorA", 100*time.Millisecond)
	b := source("sensorB", 150*time.Millisecond)
	c := source("sensorC", 80*time.Millisecond)

	for event := range fanIn(a, b, c) {
		fmt.Println("event:", event)
	}
	fmt.Println("all sources exhausted")
}
```

### 5.5 Semaphore Channel — Limit Concurrency

```go
// Example 14 — Semaphore via buffered channel to cap parallel work
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	const maxConcurrent = 3
	sem := make(chan struct{}, maxConcurrent) // semaphore: max 3 goroutines at once

	var wg sync.WaitGroup
	for i := 1; i <= 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			sem <- struct{}{}        // acquire: blocks if 3 are already running
			defer func() { <-sem }() // release when done

			fmt.Printf("task %d: running (active: ~%d)\n", id, len(sem))
			time.Sleep(200 * time.Millisecond) // simulate work
			fmt.Printf("task %d: done\n", id)
		}(i)
	}
	wg.Wait()
	fmt.Println("all tasks complete")
}
```

`len(sem)` at any point equals the number of goroutines currently inside the critical section. When the buffer is full, the `sem <- struct{}{}` blocks, providing automatic backpressure.

### 5.6 Rate Limiter with time.Ticker

```go
// Example 15 — Rate limiter: at most N operations per second
package main

import (
	"fmt"
	"time"
)

func rateLimiter(rate int) (<-chan time.Time, func()) {
	ticker := time.NewTicker(time.Second / time.Duration(rate))
	return ticker.C, ticker.Stop
}

func callAPI(id int) {
	fmt.Printf("API call %d at %s\n", id, time.Now().Format("15:04:05.000"))
}

func main() {
	// Allow 5 API calls per second
	tokens, stop := rateLimiter(5)
	defer stop()

	for i := 1; i <= 10; i++ {
		<-tokens // block until next token available
		go callAPI(i)
	}

	time.Sleep(3 * time.Second) // wait for all calls
}
```

### 5.7 Pub-Sub Broadcast

```go
// Example 16 — Simple pub-sub: broadcast events to all subscribers
package main

import (
	"fmt"
	"sync"
)

type Broker struct {
	mu          sync.RWMutex
	subscribers map[int]chan string
	nextID      int
}

func NewBroker() *Broker {
	return &Broker{subscribers: make(map[int]chan string)}
}

func (b *Broker) Subscribe() (int, <-chan string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.nextID
	b.nextID++
	ch := make(chan string, 10)
	b.subscribers[id] = ch
	return id, ch
}

func (b *Broker) Unsubscribe(id int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.subscribers[id]; ok {
		close(ch)
		delete(b.subscribers, id)
	}
}

func (b *Broker) Publish(event string) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subscribers {
		select {
		case ch <- event:
		default:
			// subscriber too slow — drop event (or use a larger buffer)
		}
	}
}

func main() {
	broker := NewBroker()

	id1, ch1 := broker.Subscribe()
	id2, ch2 := broker.Subscribe()

	var wg sync.WaitGroup
	listen := func(name string, ch <-chan string) {
		defer wg.Done()
		for e := range ch {
			fmt.Printf("%s received: %s\n", name, e)
		}
	}

	wg.Add(2)
	go listen("Alice", ch1)
	go listen("Bob", ch2)

	broker.Publish("user.login")
	broker.Publish("order.created")
	broker.Publish("payment.processed")

	broker.Unsubscribe(id1)
	broker.Unsubscribe(id2)
	wg.Wait()
}
```

---

## 6. Channel Pitfalls

### 6.1 Deadlock — All Goroutines Blocked

```go
// Example 17 — Deadlock demonstration (do NOT run in production)
package main

func deadlockExample() {
	ch := make(chan int)
	// DEADLOCK: no goroutine is receiving, send blocks forever
	// The Go runtime detects this and panics: "all goroutines are asleep - deadlock!"
	ch <- 1 // blocks here forever
}

// FIXED VERSION:
func fixedVersion() {
	ch := make(chan int, 1) // buffered: send does not block
	ch <- 1
	v := <-ch
	_ = v
}
```

Common deadlock causes:
- Sending to an unbuffered channel with no goroutine ready to receive.
- Two goroutines each waiting to send to the other's channel.
- Forgetting to close a channel that a `range` loop is reading from.

### 6.2 Panic: Send on Closed Channel

```go
// Example 18 — The close() contract
package main

import (
	"fmt"
	"sync"
)

// WRONG: multiple senders, any might close — risk of panic
func wrongPattern() {
	ch := make(chan int, 5)
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			ch <- id
			// close(ch) // PANIC if multiple goroutines call this
		}(i)
	}
	wg.Wait()
	close(ch) // CORRECT: only the coordinator that knows "all senders done" closes
	for v := range ch {
		fmt.Println(v)
	}
}

// RIGHT: use sync.WaitGroup + single closer goroutine
func correctPattern() {
	ch := make(chan int, 5)
	var wg sync.WaitGroup

	send := func(id int) {
		defer wg.Done()
		ch <- id
	}

	for i := 0; i < 3; i++ {
		wg.Add(1)
		go send(i)
	}

	// Single goroutine owns the close
	go func() {
		wg.Wait()
		close(ch)
	}()

	for v := range ch {
		fmt.Println(v)
	}
}

func main() {
	correctPattern()
}
```

### 6.3 Goroutine Leaks from Abandoned Channels

```go
// Example 19 — Goroutine leak vs. leak-free with done channel
package main

import (
	"context"
	"fmt"
	"time"
)

// LEAKING: if caller stops reading, this goroutine is stuck forever
func leakyGenerator() <-chan int {
	ch := make(chan int)
	go func() {
		for i := 0; ; i++ {
			ch <- i // blocks if no one reads — goroutine leaks
		}
	}()
	return ch
}

// LEAK-FREE: use context for cancellation
func safeGenerator(ctx context.Context) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		for i := 0; ; i++ {
			select {
			case ch <- i:
			case <-ctx.Done():
				fmt.Println("generator: context cancelled, exiting")
				return
			}
		}
	}()
	return ch
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	for v := range safeGenerator(ctx) {
		fmt.Println(v)
		time.Sleep(50 * time.Millisecond)
	}
	fmt.Println("main: done")
}
```

**The goroutine leak checklist:**
1. Every goroutine that blocks on a channel send or receive must have a path to exit.
2. That exit path is typically a `done`/`ctx.Done()` channel in a `select`.
3. Use tools like `goleak` (uber-go/goleak) in tests to catch leaks.

---

## 7. Real-World Channel Usage

### 7.1 OS Signal Handling

```go
// Example 20 — Graceful shutdown on SIGINT / SIGTERM
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func startServer(stop <-chan struct{}) {
	fmt.Println("server: started")
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			fmt.Println("server: handling requests...")
		case <-stop:
			fmt.Println("server: graceful shutdown complete")
			return
		}
	}
}

func main() {
	// signal.Notify requires a buffered channel of size >= 1
	// The OS sends the signal once; if no goroutine is ready to receive, it would be lost
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	stop := make(chan struct{})
	go startServer(stop)

	sig := <-sigCh // block until signal received
	fmt.Printf("\nmain: received signal %v, initiating shutdown\n", sig)
	close(stop)
	time.Sleep(100 * time.Millisecond) // allow server to print shutdown message
}
```

### 7.2 Database Connection Pool via Buffered Channel

```go
// Example 21 — Connection pool using buffered channel
package main

import (
	"fmt"
	"sync"
	"time"
)

type Connection struct {
	id int
}

func (c *Connection) Query(q string) string {
	time.Sleep(50 * time.Millisecond) // simulate query
	return fmt.Sprintf("conn%d: result of [%s]", c.id, q)
}

type Pool struct {
	connections chan *Connection
}

func NewPool(size int) *Pool {
	p := &Pool{connections: make(chan *Connection, size)}
	for i := 0; i < size; i++ {
		p.connections <- &Connection{id: i + 1}
	}
	return p
}

func (p *Pool) Acquire() *Connection {
	return <-p.connections // blocks if no connection available
}

func (p *Pool) Release(c *Connection) {
	p.connections <- c // return to pool
}

func main() {
	pool := NewPool(3) // only 3 concurrent DB connections allowed
	var wg sync.WaitGroup

	for i := 1; i <= 8; i++ {
		wg.Add(1)
		go func(queryID int) {
			defer wg.Done()
			conn := pool.Acquire() // waits if all 3 connections are in use
			defer pool.Release(conn)
			result := conn.Query(fmt.Sprintf("SELECT * WHERE id=%d", queryID))
			fmt.Println(result)
		}(i)
	}
	wg.Wait()
	fmt.Println("all queries complete")
}
```

### 7.3 HTTP Request with Context Cancellation

```go
// Example 22 — Context cancellation propagated via ctx.Done() channel
package main

import (
	"context"
	"fmt"
	"time"
)

func expensiveDBQuery(ctx context.Context, query string) (string, error) {
	resultCh := make(chan string, 1)

	go func() {
		// Simulate a slow database query
		time.Sleep(500 * time.Millisecond)
		resultCh <- "query result for: " + query
	}()

	select {
	case result := <-resultCh:
		return result, nil
	case <-ctx.Done():
		return "", fmt.Errorf("query cancelled: %w", ctx.Err())
	}
}

func handleRequest(timeout time.Duration, query string) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel() // always cancel to release resources

	result, err := expensiveDBQuery(ctx, query)
	if err != nil {
		fmt.Printf("request failed: %v\n", err)
		return
	}
	fmt.Printf("request succeeded: %s\n", result)
}

func main() {
	fmt.Println("--- fast enough ---")
	handleRequest(1*time.Second, "SELECT name FROM users")

	fmt.Println("--- too slow ---")
	handleRequest(200*time.Millisecond, "SELECT * FROM orders JOIN payments")
}
```

---

## 8. Visual Pipeline Diagram

```
                          PIPELINE ARCHITECTURE
                          =====================

  ┌──────────┐   chan int    ┌──────────┐  chan Record  ┌──────────┐  chan Result  ┌──────────┐
  │  Source   │ ──────────▶ │  Parse   │ ─────────────▶│ Validate │ ─────────────▶│  Store   │
  │(generate) │             │  Stage   │               │  Stage   │               │  Stage   │
  └──────────┘             └──────────┘               └──────────┘               └──────────┘
       │                        │                           │                           │
   goroutine                goroutine                   goroutine                   goroutine
   produces                 transforms                  filters                      sinks


                           FAN-OUT / FAN-IN
                           ================

                                         ┌──────────┐
                              ┌─────────▶│ Worker 1 │─────────┐
                              │          └──────────┘          │
  ┌──────────┐  chan Task      │          ┌──────────┐          │   chan Result   ┌──────────┐
  │ Dispatch │────────────────┼─────────▶│ Worker 2 │──────────┼───────────────▶│  Merge   │
  └──────────┘                │          └──────────┘          │                └──────────┘
                              │          ┌──────────┐          │
                              └─────────▶│ Worker 3 │─────────┘
                                         └──────────┘


                         SEMAPHORE (CONCURRENCY CAP)
                         ===========================

   sem := make(chan struct{}, 3)   ← buffer size = max concurrent goroutines

   Goroutine wants to run:   sem <- struct{}{}   (blocks if 3 slots taken)
   Goroutine finishes:       <-sem               (releases a slot)

   [ slot 1 ] [ slot 2 ] [ slot 3 ]  ← 3 goroutines max inside critical section
```

---

## Quick Reference: Channel Operations Summary

| Operation | Unbuffered | Buffered (not full) | Buffered (full) | Closed |
|---|---|---|---|---|
| Send `ch <- v` | Blocks until receiver ready | Returns immediately | Blocks until space | **PANIC** |
| Receive `v := <-ch` | Blocks until sender ready | Returns immediately | Returns immediately | Returns zero value |
| Receive `v, ok := <-ch` | Blocks until sender ready | Returns `val, true` | Returns `val, true` | Returns `zero, false` |
| `close(ch)` | Legal (once) | Legal (once) | Legal (once) | **PANIC** |
| `len(ch)` | Always 0 | Items in buffer | Capacity | Items remaining |
| `cap(ch)` | 0 | Buffer size | Buffer size | Buffer size |

---

## Common Mistakes Checklist

- [ ] Sending to a nil channel — blocks forever (nil channel is never ready)
- [ ] Receiving from a nil channel — blocks forever
- [ ] Closing a nil channel — panic
- [ ] Multiple goroutines calling `close()` on the same channel — panic on second close
- [ ] Reading from a closed buffered channel — safe (drains remaining values, then zero + false)
- [ ] Forgetting `default` in select when non-blocking is needed
- [ ] Using `time.After` in a loop — creates a new timer per iteration, leaks until GC (use `time.NewTimer` and reset)
- [ ] Goroutines that send to a channel no one will ever read — goroutine leak
- [ ] Ranging over a channel that is never closed — range loops forever
