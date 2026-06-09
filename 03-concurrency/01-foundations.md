# Concurrency Fundamentals

## Key Concepts to Know

### Concurrency vs Parallelism Refresher
- **Concurrency**: Structuring a program with independent pieces
- **Parallelism**: Those pieces actually running simultaneously (needs multiple cores)

A single-core machine can be concurrent but not parallel.

### Why Concurrency Matters

Modern systems need to:
- Handle many network requests simultaneously
- Respond to user input while processing
- Balance computation across multiple cores
- Build responsive, scalable applications

Go makes concurrency easy.

## Goroutines: The Building Block

```go
go func() {
    // runs concurrently
}()
```

Key facts:
- Goroutines are lightweight (2 KB stack vs 1-2 MB for OS threads)
- Millions can run on a single machine
- The runtime schedules them onto OS threads
- Cancellation is cooperative

## Channels: Communication

```go
ch := make(chan string)

go func() {
    ch <- "hello"    // send
}()

msg := <-ch          // receive
```

Channels enforce safe communication patterns.

## The Patterns

**Worker Pool** - Bounded concurrency
**Fan-out / Fan-in** - Distribute work, merge results
**Pipeline** - Stages connected by channels
**Semaphore** - Limit concurrent access

---

**Full Study:** [CONCURRENCY_GUIDE.md](./CONCURRENCY_GUIDE.md)

**Next:** [Goroutines Deep Dive](./02-goroutines.md)
