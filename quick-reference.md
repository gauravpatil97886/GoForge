# Go Quick Reference Cheat Sheet

## Variables
```go
var x int = 5          // explicit
x := 5                 // short declaration (inside functions)
const MAX = 100        // constant
```

## Functions
```go
func name(param type) returnType { }
func name() (int, error) { }       // multiple returns
func name(args ...int) { }         // variadic
```

## Methods
```go
func (receiver Type) MethodName() { }     // value receiver
func (receiver *Type) MethodName() { }    // pointer receiver
```

## Interfaces
```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

// Satisfied automatically if all methods match
var r Reader = myType{}
value, ok := r.(string)            // type assertion
```

## Control Flow
```go
if x > 0 { }
for i := 0; i < 10; i++ { }
for range slice { }                // iterate
switch x { case 1: default: }
select { case <-ch: default: }
```

## Goroutines & Channels
```go
go func() { }()                    // launch goroutine
ch := make(chan int)               // unbuffered channel
ch := make(chan int, 10)           // buffered channel
v := <-ch                          // receive
ch <- v                            // send
close(ch)                          // close channel
for v := range ch { }              // receive all
v, ok := <-ch                      // check if closed
```

## Select (multiplexing)
```go
select {
case <-ch1:
    fmt.Println("received")
case ch2 <- value:
    fmt.Println("sent")
case <-time.After(1 * time.Second):
    fmt.Println("timeout")
default:
    fmt.Println("non-blocking")
}
```

## Sync Primitives
```go
mu := sync.Mutex{}
mu.Lock()
defer mu.Unlock()

wg := sync.WaitGroup{}
wg.Add(1)
go func() { defer wg.Done(); }()
wg.Wait()

var once sync.Once
once.Do(func() { })                // runs exactly once
```

## Context
```go
ctx, cancel := context.WithCancel(context.Background())
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
<-ctx.Done()
```

## Error Handling
```go
err := errors.New("message")
err := fmt.Errorf("message: %w", err)
if errors.Is(err, io.EOF) { }
if errors.As(err, &customErr) { }
```

## Common Packages
```go
import (
    "fmt"          // printing
    "io"           // I/O interfaces
    "os"           // OS functions
    "sync"         // synchronization
    "sync/atomic"  // atomic operations
    "time"         // time/timers
    "context"      // context
    "log"          // logging
    "errors"       // error creation
    "strings"      // string manipulation
    "encoding/json" // JSON
    "net/http"     // HTTP server/client
)
```

## Useful Commands
```bash
go run file.go              # run immediately
go build -o binary          # compile
go test ./...               # run tests
go test -v -race ./...      # verbose + race detection
go fmt ./...                # format
go vet ./...                # lint
go doc package.Type         # view docs
```
