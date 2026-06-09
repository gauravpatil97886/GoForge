# Common Pitfalls & Solutions

## 1. Loop Variable Capture (Pre-Go 1.22)

❌ **Problem:**
```go
for i, v := range items {
    go func() {
        fmt.Println(i, v)  // Often prints last value!
    }()
}
```

✅ **Solution 1 - Shadow the variable (works all versions):**
```go
for i, v := range items {
    i, v := i, v  // create a new binding
    go func() {
        fmt.Println(i, v)
    }()
}
```

✅ **Solution 2 - Pass as argument:**
```go
for i, v := range items {
    go func(idx int, val Type) {
        fmt.Println(idx, val)
    }(i, v)
}
```

✅ **Solution 3 - Go 1.22+ (automatic):**
Go 1.22+ fixed this; each iteration now has its own binding for `i` and `v`.

---

## 2. Goroutine Leaks

❌ **Problem:**
```go
go func() {
    // Wait forever on a channel that never gets sent to
    <-ch
}()
```

✅ **Solution - Use context for cancellation:**
```go
go func(ctx context.Context) {
    select {
    case <-ch:
        // process
    case <-ctx.Done():
        return  // exit gracefully
    }
}(ctx)
```

---

## 3. Send on Closed Channel

❌ **Problem:**
```go
close(ch)
ch <- value  // PANIC!
```

✅ **Solution - Single owner closes:**
```go
// Only sender closes
func sender(ch chan int) {
    defer close(ch)
    ch <- 1
}

// Receiver never closes
func receiver(ch chan int) {
    for v := range ch {
        process(v)
    }
}
```

---

## 4. Copy After Mutex Use

❌ **Problem:**
```go
type Handler struct {
    mu sync.Mutex
}

h := &Handler{}
h2 := *h  // Copying a Mutex after use!
```

✅ **Solution:**
```go
// Never copy a Mutex; always use pointers
h2 := h  // OK - pointer copy
// OR
h2 := &Handler{}  // Create new instance
```

---

## 5. WaitGroup Add Inside Goroutine

❌ **Problem:**
```go
for item := range items {
    go func() {
        wg.Add(1)  // Race condition!
        defer wg.Done()
        process(item)
    }()
}
wg.Wait()  // Might return before Add() is called
```

✅ **Solution - Add before launching:**
```go
for item := range items {
    wg.Add(1)  // Add BEFORE goroutine
    go func() {
        defer wg.Done()
        process(item)
    }()
}
wg.Wait()
```

---

## 6. Data Race (Unsynchronized Access)

❌ **Problem:**
```go
var count int
go func() { count++ }()
go func() { count++ }()
// Undefined behavior!
```

✅ **Solution - Use synchronization:**
```go
var count int64
var mu sync.Mutex

go func() { 
    mu.Lock()
    count++
    mu.Unlock() 
}()

// OR use atomic
go func() { 
    atomic.AddInt64(&count, 1) 
}()
```

---

## 7. Reentrant Lock (Non-reentrant Mutex)

❌ **Problem:**
```go
var mu sync.Mutex

func f() {
    mu.Lock()
    g()          // Calls g() which also tries to lock
    mu.Unlock()
}

func g() {
    mu.Lock()    // DEADLOCK!
    mu.Unlock()
}
```

✅ **Solution - Restructure to avoid reentry:**
```go
func f() {
    mu.Lock()
    defer mu.Unlock()
    gUnsafe()
}

func gUnsafe() {
    // Assumes mu already locked
}
```

---

## 8. Nil Channel Blocks Forever

✅ **Intentional Use:**
```go
select {
case <-ch1:
    ch1 = nil  // Disable this case
case <-ch2:
    ch2 = nil
}
```

❌ **Accidental Bug:**
```go
var ch chan int  // nil
v := <-ch        // Blocks forever!
```

---

## 9. Not Checking Context Errors

❌ **Problem:**
```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()

result := doSomething(ctx)  // Might timeout, but ignore ctx.Err()
```

✅ **Solution - Check context:**
```go
select {
case result := <-doChan:
    return result, nil
case <-ctx.Done():
    return nil, ctx.Err()  // Returns Canceled or DeadlineExceeded
}
```

---

## 10. Buffered Channel False Sense of Safety

❌ **Misconception:**
```go
// Just because it's buffered doesn't mean data won't be lost
ch := make(chan int, 100)
go func() { ch <- 1 }()
close(ch)  // Data lost if no receiver!
```

✅ **Solution - Ensure receivers:**
```go
go func() {
    for v := range ch {
        process(v)
    }
}()

ch <- 1
close(ch)
```

---

## 11. Timer Leak

❌ **Problem:**
```go
for {
    select {
    case <-time.After(1 * time.Second):  // Creates new timer each iteration
        doWork()
    }
}
```

✅ **Solution - Reuse timer:**
```go
ticker := time.NewTicker(1 * time.Second)
defer ticker.Stop()

for {
    select {
    case <-ticker.C:
        doWork()
    case <-done:
        return
    }
}
```

---

## 12. Panicking in Goroutines

❌ **Problem:**
```go
go func() {
    panic("something went wrong")  // Program crashes!
}()

fmt.Println("I never print")
```

✅ **Solution - Recover or use error channels:**
```go
errCh := make(chan error, 1)

go func() {
    defer func() {
        if r := recover(); r != nil {
            errCh <- fmt.Errorf("panic: %v", r)
        }
    }()
    doWork()
}()

if err := <-errCh; err != nil {
    log.Println(err)
}
```

---

## Testing for These Issues

```bash
# Run with race detector
go test -race ./...
go run -race main.go

# Go vet catches some issues
go vet ./...
```

Use `golangci-lint` for more comprehensive linting.
