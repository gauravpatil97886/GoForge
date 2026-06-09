# Go Concurrency — From Basics to Deep Internals (Interview Edition)

A study guide that builds from first principles, goes into runtime internals, and ends with a large bank of interview questions — each with the **cross-questions** an interviewer asks after your first answer, and how to answer them.

---

## PART 1 — FOUNDATIONS

### 1.1 Concurrency vs Parallelism

- **Concurrency** = *dealing with* many things at once (structure). It's about composing independently executing pieces.
- **Parallelism** = *doing* many things at once (execution). It needs multiple CPU cores.

A single-core machine can be concurrent (many goroutines interleaved) but not parallel. Rob Pike's line: "Concurrency is not parallelism." Concurrency is a way to *structure* a program; whether it runs in parallel depends on the hardware and `GOMAXPROCS`.

### 1.2 Goroutines

A goroutine is a lightweight thread managed by the Go runtime, not the OS.

```go
go doWork()        // launches a goroutine; the go statement returns immediately
```

Key facts to know cold:

- **Initial stack is ~2 KB** (since Go 1.4; before that 8 KB). OS threads usually reserve 1–2 MB.
- Stacks are **dynamically resized** using *contiguous stacks*: when a goroutine needs more space, the runtime allocates a bigger stack and **copies** the old one over, fixing up pointers. They can also shrink.
- You can run **hundreds of thousands to millions** of goroutines. You cannot do that with OS threads.
- Goroutines are multiplexed onto a small number of OS threads by the **scheduler** (see Part 2).
- A goroutine is **not** addressable — there is no goroutine ID exposed, no handle, no way to kill one from outside. Cancellation is cooperative (via channels / context).

### 1.3 The "share memory by communicating" philosophy

> "Do not communicate by sharing memory; instead, share memory by communicating."

Go gives you both channels *and* mutexes. The idiom prefers channels for passing ownership of data between goroutines, and mutexes for protecting small bits of shared state (counters, caches, maps). Neither is "always right" — see Part 4.

---

## PART 2 — THE SCHEDULER (GMP MODEL) — DEPTH

This is the single most common "depth" area interviewers probe. Learn it precisely.

### 2.1 The three entities

- **G — Goroutine**: the unit of work. Holds its stack, instruction pointer, and scheduling state.
- **M — Machine**: an OS thread. Code only runs on an M.
- **P — Processor**: a *logical* processor / scheduling context. Holds a **local run queue** of runnable G's and the resources needed to execute Go code. The number of P's = **`GOMAXPROCS`** (defaults to number of CPU cores).

The rule: **to run Go code, an M must hold a P.** So at most `GOMAXPROCS` goroutines run Go code *simultaneously*, even though you may have thousands of M's and millions of G's.

```
        P0            P1            P2          (GOMAXPROCS = 3)
        |             |             |
        M (thread)    M             M
        |             |             |
        G (running)   G             G
   local runq:   local runq:   local runq:
   [G G G]       [G]           [G G G G]

   Global run queue: [G G ...]   (overflow / fairness)
```

### 2.2 Run queues

- Each **P has a local run queue** (a fixed-size ring buffer, capacity 256). Cheap, lock-free for the owning P most of the time.
- A **global run queue** exists as overflow and for fairness.
- The **netpoller** holds goroutines blocked on network I/O; they're moved back to a run queue when the I/O is ready.

### 2.3 Work stealing

When a P's local queue is empty, its M tries, in order:
1. Pull from the **global** run queue (occasionally — to avoid starving it).
2. Poll the **netpoller** for ready network goroutines.
3. **Steal** half of another P's local run queue.

This keeps cores busy without a central lock on the hot path.

### 2.4 Scheduling points (when does a goroutine yield?)

A goroutine can be descheduled at:
- **Channel operations** that block.
- **Mutex / sync** operations that block.
- **System calls.**
- **`go` statement, `select`, GC** safe points.
- **Function call preemption checks** — the compiler inserts stack-growth/preemption checks at function prologues.
- **Asynchronous preemption (Go 1.14+)** — the runtime sends a signal (`SIGURG` on Unix) to preempt a goroutine stuck in a *tight loop with no function calls*. Before 1.14, such a loop could hog a P forever (a classic "my program hangs at GOMAXPROCS=1" bug).

### 2.5 Syscalls and handoff

When a goroutine makes a **blocking syscall**, the M is blocked in the kernel. The runtime **detaches the P from that M** and hands the P to another M (creating/parking one as needed) so the other goroutines on that P keep running. When the syscall returns, the original M tries to reacquire a P; if it can't, its goroutine goes to the global queue and the M parks.

This is why blocking syscalls don't freeze your whole program — but they *do* cost an OS thread temporarily. (Hence `GOMAXPROCS` ≠ max threads; the runtime can spin up many M's.)

### 2.6 Numbers worth remembering

- Default `GOMAXPROCS` = `runtime.NumCPU()`.
- Local run queue cap = 256.
- Initial goroutine stack = 2 KB.
- `runtime.GOMAXPROCS(n)`, `runtime.NumGoroutine()`, `runtime.Gosched()` (voluntary yield).

---

## PART 3 — CHANNELS

### 3.1 The mental model

A channel is a typed conduit. Internally (`hchan`) it has: a **lock**, a **ring buffer** (for buffered channels), a count/size, and two wait queues — **`sendq`** and **`recvq`** — holding blocked goroutines (wrapped in `sudog`).

### 3.2 Unbuffered channels (synchronous / rendezvous)

```go
ch := make(chan int)   // capacity 0
```

- A send **blocks** until another goroutine is ready to receive, and vice versa. The handoff is a **rendezvous**: both sides meet.
- Useful as a synchronization signal, not just data transfer.

### 3.3 Buffered channels (asynchronous up to capacity)

```go
ch := make(chan int, 3)  // capacity 3
```

- Send blocks **only when the buffer is full**.
- Receive blocks **only when the buffer is empty**.
- Capacity is a *throughput buffer*, not infinite. A full buffer still blocks the sender (back-pressure).

### 3.4 The four channel "states" you must know

| Operation | nil channel | closed channel | open channel |
|---|---|---|---|
| **send** | blocks forever | **panics** | sends (may block) |
| **receive** | blocks forever | returns zero value, `ok=false`, never blocks | receives (may block) |
| **close** | **panics** | **panics** (double close) | closes |

Memorize: **send-on-closed panics, receive-on-closed never blocks, double-close panics, close-nil panics, send/recv-on-nil block forever.**

### 3.5 Closing semantics

- Closing signals "no more values." Receivers can drain remaining buffered values, then get zero + `ok=false`.
- The **sender closes**, never the receiver. (A receiver closing can cause a sender to panic.)
- Use the comma-ok form or `range`:

```go
for v := range ch {  // exits cleanly when ch is closed and drained
    use(v)
}

v, ok := <-ch
if !ok { /* channel closed and empty */ }
```

### 3.6 nil channels as a feature

A `nil` channel blocks forever on send/recv. In a `select`, a `nil` case is **never selected** — so you can dynamically enable/disable a branch by setting a channel variable to `nil`:

```go
for {
    select {
    case v, ok := <-in:
        if !ok { in = nil; continue } // disable this case after close
        out <- v
    case <-done:
        return
    }
}
```

---

## PART 4 — SELECT

```go
select {
case v := <-ch1:    // ready receive
case ch2 <- x:      // ready send
case <-time.After(time.Second):  // timeout
default:            // runs if NO case is ready (non-blocking)
}
```

Key rules:
- If **multiple cases are ready**, one is chosen **uniformly at random** (prevents starvation, defeats ordering assumptions).
- With a **`default`**, `select` never blocks — it's a non-blocking poll.
- Without any ready case and no default, it **blocks**.
- An **empty `select{}`** blocks forever (sometimes used to park `main`).
- `time.After` in a loop leaks a timer until it fires — for hot loops use a reusable `time.Timer` / `time.Ticker` and `Stop()` it.

---

## PART 5 — SYNC PRIMITIVES

### 5.1 sync.Mutex

```go
var mu sync.Mutex
mu.Lock(); defer mu.Unlock()
```

- **Not reentrant** — locking a mutex you already hold deadlocks. (Common interview gotcha.)
- A zero `Mutex` is ready to use; **never copy a Mutex** after first use (the value contains state). `go vet` catches copies.
- Has two modes internally: **normal** (fast, allows barging) and **starvation** (FIFO, kicks in if a waiter waits > 1ms) to bound tail latency.

### 5.2 sync.RWMutex

- Many readers **or** one writer.
- `RLock`/`RUnlock` for readers, `Lock`/`Unlock` for writers.
- Cheaper for read-heavy workloads, but has overhead; for low-contention or tiny critical sections a plain `Mutex` can be faster. A pending writer blocks new readers to avoid writer starvation.

### 5.3 sync.WaitGroup

```go
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)              // BEFORE go, never inside the goroutine
    go func() { defer wg.Done(); work() }()
}
wg.Wait()
```

- **`Add` must happen before the goroutine that `Done`s could finish** — putting `Add(1)` inside the goroutine is a race against `Wait`.
- Counter going negative → **panic**.
- Don't copy a WaitGroup; pass `*sync.WaitGroup`.
- Go 1.25 added `wg.Go(func(){...})` which does `Add(1)` + `go` + `Done` for you.

### 5.4 sync.Once

```go
var once sync.Once
once.Do(func(){ initExpensiveThing() })  // body runs exactly once, ever
```

- All concurrent callers **block** until the first `Do` finishes — so after `Do` returns, init is guaranteed complete.
- If the function panics, it still counts as "done" (won't retry). Go 1.21 added `OnceFunc`, `OnceValue`, `OnceValues`.

### 5.5 sync.Cond

For waiting on a condition with a shared lock — wakes goroutines via `Signal` (one) or `Broadcast` (all). Always re-check the predicate in a loop:

```go
c.L.Lock()
for !ready { c.Wait() }   // Wait atomically unlocks, sleeps, re-locks on wake
use()
c.L.Unlock()
```

Often a channel is clearer; `Cond` shines when many goroutines wait on a state change with shared data.

### 5.6 sync/atomic

Lock-free reads/writes/CAS on integers and pointers.

```go
var n atomic.Int64       // typed atomics, Go 1.19+
n.Add(1)
n.Load(); n.Store(5)
swapped := n.CompareAndSwap(old, new)
```

- Use for simple counters/flags where a mutex is overkill.
- **Atomicity ≠ ordering of surrounding non-atomic ops** unless you reason via the memory model. Don't mix atomic and non-atomic access to the same variable.

### 5.7 sync.Map

A concurrent map optimized for two cases: (1) keys written once, read many times; (2) disjoint key sets across goroutines. For general read+write contention, a plain `map` + `RWMutex` is often faster. Don't reach for it by default.

### 5.8 sync.Pool

A pool of reusable temporary objects to reduce GC pressure.

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}
b := bufPool.Get().(*bytes.Buffer); b.Reset()
defer bufPool.Put(b)
```

- Contents can be **GC'd at any time** (cleared each GC cycle) — never store anything you must keep.
- Great for byte buffers / scratch space in hot paths.

---

## PART 6 — CONTEXT

`context.Context` carries cancellation, deadlines, and request-scoped values across API boundaries and goroutines.

```go
ctx, cancel := context.WithCancel(parent)
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
ctx, cancel := context.WithDeadline(parent, t)
defer cancel()  // ALWAYS call cancel to release resources, even on the timeout variants
```

- Cancellation **propagates down the tree**: cancelling a parent cancels all children.
- Consume it via `<-ctx.Done()`; check `ctx.Err()` (`Canceled` or `DeadlineExceeded`).
- **Pass `ctx` as the first parameter**, never store it in a struct.
- `context.Value` is for request-scoped data (request ID, auth), **not** for passing optional function params.
- Cancellation is **cooperative**: ctx doesn't kill a goroutine; the goroutine must watch `Done()` and return.

```go
func worker(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case job := <-jobs:
            process(job)
        }
    }
}
```

---

## PART 7 — THE GO MEMORY MODEL (HAPPENS-BEFORE)

Without synchronization, one goroutine is **not guaranteed to observe** another's writes in any particular order — or at all. The memory model defines *happens-before* edges that make a read observe a write.

The edges you must be able to state:

1. **The `go` statement happens-before the goroutine's execution begins.** (Args evaluated before it starts.)
2. **A send on a channel happens-before the corresponding receive completes.**
3. **The close of a channel happens-before a receive that returns the zero value (because closed).**
4. **For unbuffered channels: a receive happens-before the send completes.** (Subtle — the *receive* side establishes ordering.)
5. **A `Mutex.Unlock` happens-before any subsequent `Lock` returns.**
6. **`Once.Do(f)`'s call to `f` happens-before any `Do` returns.**

Practical takeaway: if two goroutines touch the same memory and at least one writes, you **need** synchronization (channel, mutex, or atomic) to be correct — otherwise it's a **data race** and the behavior is undefined. Run with **`go test -race` / `go run -race`**.

---

## PART 8 — PATTERNS

### 8.1 Worker pool (bounded concurrency)

```go
func pool(jobs <-chan Job, results chan<- Result, workers int) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {        // ranges until jobs is closed
                results <- process(j)
            }
        }()
    }
    wg.Wait()
    close(results)                        // close results only after all workers done
}
```

### 8.2 Fan-out / fan-in

- **Fan-out**: multiple goroutines read from the same channel.
- **Fan-in**: merge multiple input channels into one output channel.

```go
func merge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, c := range cs {
        wg.Add(1)
        go func(c <-chan int) { defer wg.Done(); for v := range c { out <- v } }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

### 8.3 Pipeline

Stages connected by channels; each stage is a goroutine reading from the previous, writing to the next. Propagate a `done`/`ctx` so upstream stages stop when downstream stops (prevents leaks).

### 8.4 Semaphore (limit concurrency with a buffered channel)

```go
sem := make(chan struct{}, maxConcurrent)
for _, task := range tasks {
    sem <- struct{}{}                 // acquire (blocks if full)
    go func(t Task) {
        defer func(){ <-sem }()       // release
        t.Run()
    }(task)
}
```

(Or use `golang.org/x/sync/semaphore` for a weighted, context-aware version.)

### 8.5 errgroup

```go
g, ctx := errgroup.WithContext(ctx)
for _, u := range urls {
    u := u
    g.Go(func() error { return fetch(ctx, u) })
}
if err := g.Wait(); err != nil { /* first non-nil error; ctx is cancelled */ }
```

`errgroup` = WaitGroup + first-error capture + automatic context cancellation when any goroutine errors. `SetLimit(n)` bounds concurrency.

### 8.6 Rate limiting

`time.Ticker` for a fixed rate, or `golang.org/x/time/rate` (token bucket) for bursts + steady rate.

---

## PART 9 — THE CLASSIC BUGS

### 9.1 Data race
Two goroutines access the same memory, at least one writes, no synchronization. Detect with `-race`. *A race condition is a logic bug about timing; a data race is the specific unsynchronized-memory case — related but not identical.*

### 9.2 Deadlock
All goroutines blocked waiting on each other. The runtime detects the **total** deadlock case ("fatal error: all goroutines are asleep - deadlock!"), but **partial** deadlocks (some goroutines stuck while others run) are NOT detected. Causes: lock ordering inversion, unbuffered channel with no receiver, forgetting to `close`, double `Lock`.

### 9.3 Goroutine leak
A goroutine blocks forever (e.g., on a channel nobody will ever send to / receive from) and is never collected — goroutines are **not** garbage-collected while blocked. Memory and the goroutine stay forever. Fix with `context`/`done` channels and ensuring every send has a guaranteed receiver path. Watch `runtime.NumGoroutine()` grow over time.

### 9.4 Loop variable capture (the famous one)

```go
// BEFORE Go 1.22 — BUG: all goroutines often print the last value
for _, v := range items {
    go func() { fmt.Println(v) }()   // v shared across iterations
}
```
Pre-1.22 fix: shadow it — `v := v` — or pass as an argument `go func(v T){...}(v)`.
**Go 1.22+** changed loop semantics so each iteration gets a **fresh `v`**, fixing this for `for range` / `for i :=` loops. Still worth knowing both, because interviewers love this and lots of code targets older Go.

### 9.5 WaitGroup misuse
`Add` inside the goroutine; copying the WaitGroup; reusing before `Wait` returns.

### 9.6 Sending on a closed channel / closing twice
Panics. Guard with a single owner of close, or `sync.Once` for close.

---

# PART 10 — INTERVIEW QUESTIONS WITH CROSS-QUESTIONS

Format: **Q** (the question) → **A** (a strong answer) → **CQ** (follow-up the interviewer asks) → **A** (how to answer it).

---

### Q1. What's the difference between concurrency and parallelism in Go?
**A.** Concurrency is structuring a program as independently executing pieces (goroutines); parallelism is them literally running at the same instant on multiple cores. Go gives you concurrency primitives; whether they run in parallel depends on `GOMAXPROCS` and available cores.

**CQ: So if I set `GOMAXPROCS=1`, do my goroutines still run concurrently?**
A. Yes — they're interleaved on one OS thread by the scheduler, so the program is concurrent but not parallel. CPU-bound goroutines take turns at scheduling points; I/O-bound ones yield naturally.

**CQ: Before Go 1.14, what could go wrong with `GOMAXPROCS=1` and a tight loop?**
A. A goroutine in a `for{}` loop with no function calls had no preemption point, so it could hog the single P forever and starve everything else. Go 1.14 added **asynchronous preemption** via signals to fix that.

---

### Q2. How is a goroutine different from an OS thread?
**A.** Goroutines are user-space, runtime-scheduled, start with a ~2 KB growable stack, and are multiplexed onto OS threads (M:N scheduling). OS threads cost ~1–2 MB stack and are scheduled by the kernel. You can run millions of goroutines, not millions of threads.

**CQ: How does the stack grow if it starts at 2 KB?**
A. Contiguous stacks: when more space is needed, the runtime allocates a larger stack, copies the contents over, and fixes up pointers into the stack. They can shrink during GC too.

**CQ: Is there a goroutine ID I can use?**
A. Not exposed by design. There's no public API and you shouldn't rely on it (no goroutine-local storage). Use context/closures to carry per-goroutine data.

---

### Q3. Explain the GMP scheduler.
**A.** G = goroutine (work), M = OS thread (executes code), P = logical processor (scheduling context + local run queue). To run Go code an M must hold a P, and `GOMAXPROCS` caps the number of P's, so that's the max goroutines running Go code at once. Idle P's steal work from busy P's; there's also a global run queue and a netpoller.

**CQ: Why have P at all? Why not just M and G?**
A. P decouples "schedulable context" from "OS thread." It gives each P a **lock-free local run queue** (fast path), enables **work stealing**, and lets the runtime **hand off a P** when an M blocks in a syscall — so blocking threads don't reduce parallelism.

**CQ: Walk me through what happens on a blocking syscall.**
A. The M enters the kernel and blocks. The runtime detaches the P and hands it to another M (waking/creating one) so other goroutines keep running. When the syscall returns, the M tries to grab a P; if none is free, its goroutine goes to the global queue and the M parks.

**CQ: What's work stealing and how much does it steal?**
A. When a P's local queue empties, its M checks the global queue and netpoller, then steals roughly **half** of another random P's local queue — balancing load without a central lock.

---

### Q4. Buffered vs unbuffered channel — when do you use each?
**A.** Unbuffered (cap 0) is synchronous: send and receive rendezvous, so it doubles as a synchronization signal. Buffered decouples sender and receiver up to capacity, useful for throughput/smoothing bursts and as a counting semaphore. I default to unbuffered for clear handoff semantics and add a buffer only when I can justify the size.

**CQ: Does a buffered channel make my program faster?**
A. Not inherently. It reduces blocking when producer/consumer rates differ momentarily, but a wrong/huge buffer hides back-pressure and can mask bugs or grow memory. The buffer is bounded — once full the sender still blocks.

**CQ: What happens if I send on an unbuffered channel with no receiver?**
A. The sender blocks forever. If it's the only goroutine, the runtime reports a deadlock; otherwise it's a goroutine leak.

---

### Q5. What happens when you operate on a closed or nil channel?
**A.** Send on closed → **panic**. Receive on closed → returns immediately with zero value and `ok=false` (drains buffered values first). Close a closed channel → panic. Close a nil channel → panic. Send or receive on a **nil** channel → blocks forever.

**CQ: How do you use that nil-blocks-forever behavior on purpose?**
A. In a `select`, a `nil` channel case is never selected, so I set a channel variable to `nil` to dynamically disable that branch — e.g., after an input channel closes, set it to nil so the select stops choosing it without busy-looping.

**CQ: Who should close a channel, sender or receiver?**
A. The **sender**, and ideally a single owner. A receiver closing can make a still-running sender panic. For multiple senders, coordinate close via a separate done channel or `sync.Once`.
