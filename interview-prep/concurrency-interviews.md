# Concurrency Interview Questions - Deep Dive

Based on the Concurrency Guide, here are common interview questions with detailed answers and cross-questions.

## Scheduler & Goroutines

### Q: Explain the GMP model in detail
**A:** G (goroutine) is the unit of work, M (machine) is an OS thread, P (processor) is the logical scheduling context.

Each P has:
- Local run queue (256-size ring buffer, lock-free for the owning P)
- Resources needed to execute Go code
- Number of P's = GOMAXPROCS (defaults to NumCPU)

Only M's holding a P can run Go code. When a P's queue is empty, the M tries:
1. Global queue (occasionally, for fairness)
2. Netpoller (for I/O-ready goroutines)
3. Work steal from another P's queue (~half)

**CQ: Why not just use OS threads directly?**
A: M:N scheduling gives us millions of goroutines on limited OS threads. P decouples schedulable context from OS threads, enabling work stealing and P handoff on blocking syscalls.

**CQ: What happens during a blocking syscall?**
A: The M enters kernel and blocks. Runtime detaches the P and gives it to another M (creating/waking if needed). Original goroutine goes to global queue when syscall returns.

---

### Q: What causes a goroutine to yield/be descheduled?
**A:** Explicit/implicit scheduling points:
- Channel operations that block (send/receive)
- Mutex/sync operations that block
- Blocking syscalls
- `go` statement
- `select` statement
- GC safe points
- Function prologues (preemption checks every function call)
- Asynchronous preemption (Go 1.14+, SIGURG on Unix)

**CQ: What was the problem before Go 1.14?**
A: Tight loops with no function calls had no preemption point. A goroutine could hog the single P forever on GOMAXPROCS=1.

---

## Channels & Synchronization

### Q: Design a pattern to process 1000 URLs concurrently with at most 50 concurrent requests

**A:**
```go
func fetchURLs(urls []string, maxConcurrent int) {
    sem := make(chan struct{}, maxConcurrent)
    var wg sync.WaitGroup
    
    for _, url := range urls {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            sem <- struct{}{}       // acquire
            defer func() { <-sem }() // release
            fetch(u)
        }(url)
    }
    wg.Wait()
}
```

Or use errgroup with SetLimit.

**CQ: Why not just use buffered channel cap 50?**
A: That works too, but semaphore pattern is explicit. Also, errgroup gives you error handling and cancellation.

---

### Q: What's the difference between sending on nil vs closed channel?

**A:**
| Operation | nil | closed | open |
|-----------|-----|--------|------|
| send | blocks forever | panics | blocks until received |
| receive | blocks forever | returns 0, ok=false | blocks until ready |
| close | panics | panics | closes |

**CQ: How can you use nil channels on purpose?**
A: In select statements, nil cases are never selected. Set a channel to nil to disable a branch dynamically.

**CQ: Who should close?**
A: The sender. If receiver closes, a sender can panic. For multiple senders, use a separate done channel or sync.Once.

---

## Data Races & Memory Model

### Q: What is a data race and how do you detect it?

**A:** A data race is when two goroutines access the same memory and at least one writes, with no synchronization. It's undefined behavior.

Detect with:
```bash
go test -race ./...
go run -race main.go
```

**CQ: Are all data races race conditions?**
A: No. A data race is unsynchronized memory access. A race condition is a logic bug about timing. Every data race is a race condition, but not vice versa.

**CQ: What's an example of a race condition without a data race?**
A: Timing-dependent logic where you have synchronization but the logic is still wrong:
```go
// With synchronization but still racy logic:
if exists(key) {        // true
    value := get(key)   // might return nil if key deleted between checks
}
```

---

## Context & Cancellation

### Q: How does context propagate cancellation?

**A:** Context forms a tree. Cancelling a parent automatically cancels all children via `<-ctx.Done()`.

```go
parent, _ := context.WithCancel(context.Background())
child, _ := context.WithCancel(parent)

cancel()  // cancels both parent and child
```

**CQ: Can you cancel a child without affecting the parent?**
A: Yes, cancel the child specifically (it has its own cancel function). The parent is unaffected.

**CQ: When should you NOT use context.Value?**
A: For optional parameters or configuration. Only use for request-scoped data (request ID, user, auth). Never store in struct fields.

---

## Mutexes & Atomics

### Q: When would you use RWMutex over Mutex?

**A:** When reads greatly outnumber writes.

RWMutex allows multiple readers OR one writer.

```go
mu.RLock()      // read lock
mu.RUnlock()

mu.Lock()       // write lock
mu.Unlock()
```

**Trade-off:** RWMutex has overhead. For highly contended or tiny critical sections, plain Mutex can be faster.

**CQ: What happens if a writer is waiting?**
A: New reader attempts are blocked to prevent writer starvation.

**CQ: Is Mutex reentrant?**
A: No. Locking a mutex you already hold deadlocks.

---

### Q: When use atomic vs mutex?

**A:** Use atomic for:
- Simple counters or flags
- High-frequency updates where mutex would bottleneck
- CAS loops for lock-free structures

Use mutex for:
- Complex shared state
- Coordinating multiple updates

```go
var count atomic.Int64  // Go 1.19+
count.Add(1)
count.Load()

// Pre-1.19
var count int64
atomic.AddInt64(&count, 1)
n := atomic.LoadInt64(&count)
```

**CQ: Does atomic.Add guarantee ordering of surrounding code?**
A: No. Only the atomic operation itself is atomic. Read the memory model carefully.

---

## Patterns & Advanced Topics

### Q: Design a fan-out/fan-in pattern

**A:**
```go
// Fan-out: read from one channel, write to multiple
func fanOut(in <-chan int, outs ...chan<- int) {
    for v := range in {
        for _, out := range outs {
            out <- v  // or go func(out) { out <- v }(out) for async
        }
    }
}

// Fan-in: read from multiple, write to one
func fanIn(out chan<- int, ins ...<-chan int) {
    var wg sync.WaitGroup
    for _, in := range ins {
        wg.Add(1)
        go func(in <-chan int) {
            defer wg.Done()
            for v := range in {
                out <- v
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
}
```

---

### Q: What's a goroutine leak and how do you detect it?

**A:** A goroutine that blocks forever and never exits. Not garbage-collected while blocking.

Example:
```go
go func() {
    <-ch  // If ch never gets sent, goroutine leaks
}()
```

Detect:
```bash
runtime.NumGoroutine()  // Check over time in tests
```

Fix:
```go
go func() {
    select {
    case <-ch:
    case <-ctx.Done():
        return
    }
}()
```

---

### Q: What's a deadlock vs goroutine leak?

**A:**
- **Deadlock**: All goroutines blocked waiting on each other. Runtime detects total deadlocks ("fatal error: all goroutines are asleep"). Partial deadlocks aren't detected.
- **Goroutine leak**: Goroutines block forever but others still run. No fatal error, just growing memory.

---

## Final Tips

✅ **Always run with `-race`**  
✅ **Test context cancellation**  
✅ **Know the GMP model cold**  
✅ **Memorize channel table**  
✅ **Practice writing worker pools**  
✅ **Understand memory model happens-before edges**  

Good luck with your interviews!
