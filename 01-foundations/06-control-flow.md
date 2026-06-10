# Control Flow in Go

## What Is This?

Control flow is the set of language constructs that determine the order in which statements execute. In Go this means `if`/`else`, a single `for` keyword that handles every loop shape, `switch` for multi-branch decisions, `defer` for cleanup scheduling, and labels for breaking out of nested structures. Unlike most languages, Go keeps this list deliberately short and orthogonal — every construct does exactly one job.

## Why Does It Exist?

Programs are not straight lines. They make decisions, repeat work, and need guaranteed cleanup even when things go wrong. Go's control flow was designed to solve a specific pain point that existed at Google: enormous C++ and Java codebases where the same concept (looping) was expressed six different ways (`for`, `while`, `do-while`, `foreach`, iterators, range-based for), making large-scale automated refactoring nearly impossible. Go collapsed all loop shapes into one keyword (`for`), removed `do-while` entirely, made `switch` fall-through opt-in rather than opt-out (fixing the #1 C switch bug), and added `defer` to make resource cleanup reliable without `try/finally`. Every decision trades expressive variety for uniformity and toolability.

## Who Uses This in Industry?

- **Google**: The Go build system and internal tooling rely on Go's fast compilation. Uniform control flow (no operator overloading, no implicit fallthrough) means `gofmt` and `go vet` can understand and rewrite any Go file mechanically — critical when you have 100M+ lines of code and need to migrate APIs across the entire monorepo automatically.
- **Uber**: Uber's `kraken` (P2P file distribution) and `cadence` (workflow engine) use labeled breaks and range-over-channel patterns extensively in their scheduler loops. The predictability of Go's for-range on channels is what makes their distributed task dispatchers readable at 50k+ lines.
- **Cloudflare**: Their DNS resolver and TLS termination proxies use `for { select { ... } }` infinite loops with `defer` to guarantee socket cleanup. The LIFO guarantee of defer means file descriptors are released in reverse-acquisition order, which matches OS expectations.
- **Docker / Kubernetes**: The Kubernetes controller-manager is a set of infinite reconciliation loops (`for { ... }`). Every controller is structured as `for { observe(); diff(); act() }`. The switch-type pattern (`switch v := obj.(type)`) is the standard dispatch mechanism when a controller handles multiple API resource types.
- **HashiCorp (Terraform, Vault)**: Vault's secret lease renewal uses `defer` to revoke leases even when the calling goroutine panics. Without defer's run-on-panic guarantee, leaked secrets would accumulate silently.

## Industry Standards and Best Practices

**Senior engineers do this:**
- Use the `if init; condition` form to scope variables to the branch that needs them — avoids polluting the enclosing scope.
- Keep switch cases short; push logic into helper functions rather than writing 50-line case bodies.
- Defer at the top of a function, right after acquiring a resource — the acquisition and release appear together visually.
- Never use `goto` except in hand-written parsers and state machines where the alternative is a deeply nested switch inside a for loop.
- Annotate loop-variable captures in goroutines explicitly: `v := v` (shadow on purpose) or pass as a function argument.

**Beginners do this (avoid it):**
- `defer` inside loops — registers N closures, all executing on function return, not loop iteration end.
- Relying on `fallthrough` as a primary switch pattern — it bypasses the case expression check and surprises readers.
- Ignoring labeled breaks; instead they use boolean flags (`done := false`) to break nested loops — six lines where one label would do.

## Why Go's Approach Is Unique

| Feature | Go | Java | Python | C |
|---|---|---|---|---|
| Loop keywords | 1 (`for`) | 3 (`for`/`while`/`do`) | 2 (`for`/`while`) | 3 (`for`/`while`/`do`) |
| Switch fallthrough | Opt-in (`fallthrough`) | Opt-out (`break`) | N/A | Opt-out (`break`) |
| Resource cleanup | `defer` (guaranteed) | `try/finally` | `with`/`finally` | Manual |
| `goto` | Present, restricted | Absent | Absent | Present, unrestricted |
| Parentheses on `if` | Not allowed | Required | Not applicable | Required |
| Type dispatch | First-class (`switch type`) | `instanceof` chain | `isinstance` chain | Manual |

The core tradeoff: Go sacrifices expressive flexibility (no `do-while`, no `for-each` with arbitrary iterators until Go 1.22 range-over-func) to gain a codebase where every loop can be mechanically analyzed, reformatted, and refactored by tools without a full type-checker. This is not an accident — it directly serves Google's need for automated large-scale code transformation.

---

## 1. If / Else If / Else

### Why Before How

`if` in Go has no parentheses around the condition. This is enforced by `gofmt` — if you write them, the formatter removes them. The rationale: parentheses around conditions are a C artifact from when the parser needed disambiguation. Go's grammar does not require them. Removing them reduces visual noise by roughly 10% in condition-heavy code.

The initialization statement (`if x := f(); x > 0`) is Go's answer to a real bug class: code like this in C/Java:

```java
int result = compute();
if (result > 0) { use(result); }
// result still lives here — accident waiting to happen
```

In Go you can scope `result` to the if-block itself.

### Basic Syntax

```go
package main

import "fmt"

func classifyHTTPStatus(code int) string {
    if code >= 500 {
        return "server error"
    } else if code >= 400 {
        return "client error"
    } else if code >= 300 {
        return "redirect"
    } else if code >= 200 {
        return "success"
    } else {
        return "informational"
    }
}

func main() {
    codes := []int{200, 301, 404, 500, 102}
    for _, c := range codes {
        fmt.Printf("%d -> %s\n", c, classifyHTTPStatus(c))
    }
}
```

### Initialization Statement Form

```go
package main

import (
    "fmt"
    "strconv"
)

func parseAndValidatePort(s string) (int, error) {
    // port is scoped entirely to this if-else block
    if port, err := strconv.Atoi(s); err != nil {
        return 0, fmt.Errorf("invalid port %q: %w", s, err)
    } else if port < 1 || port > 65535 {
        return 0, fmt.Errorf("port %d out of range [1,65535]", port)
    } else {
        return port, nil
    }
}

func main() {
    inputs := []string{"8080", "99999", "abc", "443"}
    for _, s := range inputs {
        p, err := parseAndValidatePort(s)
        if err != nil {
            fmt.Printf("error: %v\n", err)
            continue
        }
        fmt.Printf("valid port: %d\n", p)
    }
}
```

### Common Pitfall: Shadowing in Init Statement

```go
// BUG: the outer err is shadowed, not reused
err := doFirst()
if err := doSecond(); err != nil { // this err is NEW
    fmt.Println(err) // only second error visible
}
fmt.Println(err) // still the FIRST error

// FIX: use a distinct name, or restructure
if secondErr := doSecond(); secondErr != nil {
    fmt.Println(secondErr)
}
```

---

## 2. For Loop — Go's Only Loop

### Why One Keyword

Go has no `while`, no `do-while`, no `foreach`. One keyword, three forms. The argument: `while(true)` and `for(;;)` are identical semantics with different syntax. Combining them reduces the grammar surface. The Go spec is ~50 pages; Java's is ~800. Smaller spec = fewer edge cases = faster compiler = better tooling.

### Form 1: Classic C-Style For

```go
package main

import "fmt"

// Implementing a simple ring buffer drain — classic index loop
func drainBuffer(buf []byte, batchSize int) {
    total := len(buf)
    for i := 0; i < total; i += batchSize {
        end := i + batchSize
        if end > total {
            end = total
        }
        batch := buf[i:end]
        fmt.Printf("processing batch at offset %d, len %d: %v\n", i, len(batch), batch)
    }
}

func main() {
    data := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    drainBuffer(data, 3)
}
```

### Form 2: While-Style (condition only)

```go
package main

import (
    "fmt"
    "math/rand"
)

// Exponential backoff retry — real pattern in every RPC client
func fetchWithRetry(maxAttempts int) error {
    attempt := 0
    delay := 1

    for attempt < maxAttempts {
        fmt.Printf("attempt %d, delay %dms\n", attempt+1, delay)

        // Simulate: succeed on attempt 3
        if attempt == 2 {
            fmt.Println("success")
            return nil
        }

        _ = rand.Intn(delay) // jitter in real code
        delay *= 2
        attempt++
    }

    return fmt.Errorf("all %d attempts exhausted", maxAttempts)
}

func main() {
    if err := fetchWithRetry(5); err != nil {
        fmt.Println("error:", err)
    }
}
```

### Form 3: Infinite Loop

```go
package main

import (
    "fmt"
    "time"
)

// Event loop — the skeleton of every Go server/daemon
func runEventLoop(events <-chan string, quit <-chan struct{}) {
    for {
        select {
        case e, ok := <-events:
            if !ok {
                fmt.Println("events channel closed, exiting")
                return
            }
            fmt.Println("handling event:", e)
        case <-quit:
            fmt.Println("quit signal received, exiting")
            return
        }
    }
}

func main() {
    events := make(chan string, 3)
    quit := make(chan struct{})

    events <- "login"
    events <- "purchase"
    events <- "logout"

    go func() {
        time.Sleep(10 * time.Millisecond)
        close(quit)
    }()

    runEventLoop(events, quit)
}
```

### Form 4: Range Over Slice, Map, String, Channel

```go
package main

import "fmt"

func main() {
    // --- Slice: index + value ---
    scores := []int{95, 87, 72, 100, 61}
    sum := 0
    for i, v := range scores {
        fmt.Printf("  scores[%d] = %d\n", i, v)
        sum += v
    }
    fmt.Printf("average: %.1f\n", float64(sum)/float64(len(scores)))

    // --- Map: key + value (iteration order is randomized by design) ---
    headers := map[string]string{
        "Content-Type":  "application/json",
        "Authorization": "Bearer token123",
        "X-Request-ID":  "abc-456",
    }
    fmt.Println("\nHTTP headers:")
    for k, v := range headers {
        fmt.Printf("  %s: %s\n", k, v)
    }

    // --- String: iterates RUNES (Unicode code points), not bytes ---
    s := "Héllo"
    fmt.Printf("\nRune iteration of %q:\n", s)
    for i, r := range s {
        fmt.Printf("  byte offset %d: %c (U+%04X)\n", i, r, r)
    }

    // --- Channel: reads until channel is closed ---
    ch := make(chan int, 3)
    ch <- 10
    ch <- 20
    ch <- 30
    close(ch)
    fmt.Println("\nchannel values:")
    for v := range ch {
        fmt.Println(" ", v)
    }
}
```

### The Classic Goroutine Loop-Variable Capture Bug

This is one of the most common bugs in Go codebases. Fixed at the language level in Go 1.22, but understanding it is essential for reading older code and for variable capture in general.

```go
package main

import (
    "fmt"
    "sync"
)

// BUG (pre-Go 1.22 behavior or with any closure capturing a loop var)
func buggyCapture() {
    var wg sync.WaitGroup
    results := make([]string, 3)

    urls := []string{"a.com", "b.com", "c.com"}
    for i, url := range urls {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // BUG: both i and url refer to the LOOP VARIABLE
            // By the time goroutines run, the loop has finished
            // and i == 2, url == "c.com" for all three
            results[i] = "fetched: " + url
        }()
    }
    wg.Wait()
    fmt.Println("buggy:", results)
}

// FIX 1: shadow the variable inside the loop
func fixedCaptureShadow() {
    var wg sync.WaitGroup
    results := make([]string, 3)

    urls := []string{"a.com", "b.com", "c.com"}
    for i, url := range urls {
        i, url := i, url // create new variables scoped to this iteration
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = "fetched: " + url
        }()
    }
    wg.Wait()
    fmt.Println("fixed (shadow):", results)
}

// FIX 2: pass as function arguments (clearer intent)
func fixedCaptureArgs() {
    var wg sync.WaitGroup
    results := make([]string, 3)

    urls := []string{"a.com", "b.com", "c.com"}
    for i, url := range urls {
        wg.Add(1)
        go func(idx int, u string) {
            defer wg.Done()
            results[idx] = "fetched: " + u
        }(i, url)
    }
    wg.Wait()
    fmt.Println("fixed (args):", results)
}

func main() {
    buggyCapture()
    fixedCaptureShadow()
    fixedCaptureArgs()
}
```

---

## 3. Switch Statement

### Why Before How

C's switch has fallthrough by default. This means forgetting a `break` silently executes the next case — the source of countless bugs. Go inverts this: cases do NOT fall through by default. Each case is an independent branch. If you want fallthrough, you say so with the `fallthrough` keyword — and it is unconditional (it falls through regardless of the next case's expression).

The switch with no expression (`switch { case ...: }`) is not a curiosity — it replaces if-else chains and is the idiomatic Go way to write multi-branch condition logic that doesn't share a single expression.

### Expression Switch

```go
package main

import "fmt"

type Weekday int

const (
    Monday Weekday = iota + 1
    Tuesday
    Wednesday
    Thursday
    Friday
    Saturday
    Sunday
)

func scheduleFor(day Weekday) string {
    switch day {
    case Monday, Wednesday, Friday:
        return "standup at 09:00, gym at 18:00"
    case Tuesday, Thursday:
        return "deep work block 09:00-12:00"
    case Saturday:
        return "open source contributions"
    case Sunday:
        return "rest"
    default:
        return "unknown day"
    }
}

func main() {
    for d := Monday; d <= Sunday; d++ {
        fmt.Printf("day %d: %s\n", d, scheduleFor(d))
    }
}
```

### Switch with No Expression (Replaces If-Else Chains)

```go
package main

import "fmt"

func describeLoad(cpuPct float64, memPct float64) string {
    // No expression on switch — each case is a boolean condition
    switch {
    case cpuPct > 90 || memPct > 90:
        return "CRITICAL: immediate action required"
    case cpuPct > 75 || memPct > 75:
        return "WARNING: monitor closely"
    case cpuPct > 50 || memPct > 50:
        return "ELEVATED: within acceptable range"
    default:
        return "NORMAL"
    }
}

func main() {
    samples := [][2]float64{
        {20, 30},
        {55, 45},
        {80, 60},
        {95, 70},
    }
    for _, s := range samples {
        fmt.Printf("cpu=%.0f%% mem=%.0f%% -> %s\n",
            s[0], s[1], describeLoad(s[0], s[1]))
    }
}
```

### Type Switch — Dispatching on Interface Dynamic Type

```go
package main

import "fmt"

// Real pattern: Kubernetes uses this to dispatch on runtime.Object types

type Event interface {
    EventType() string
}

type UserSignup struct{ Email string }
type OrderPlaced struct{ OrderID int; Amount float64 }
type PaymentFailed struct{ OrderID int; Reason string }

func (u UserSignup) EventType() string    { return "user.signup" }
func (o OrderPlaced) EventType() string   { return "order.placed" }
func (p PaymentFailed) EventType() string { return "payment.failed" }

func handleEvent(e Event) {
    // Type switch: v gets the concrete type in each case
    switch v := e.(type) {
    case UserSignup:
        fmt.Printf("new user: %s — send welcome email\n", v.Email)
    case OrderPlaced:
        fmt.Printf("order #%d placed, $%.2f — trigger fulfillment\n", v.OrderID, v.Amount)
    case PaymentFailed:
        fmt.Printf("payment failed for order #%d: %s — notify customer\n", v.OrderID, v.Reason)
    default:
        fmt.Printf("unknown event type: %T\n", v)
    }
}

func main() {
    events := []Event{
        UserSignup{Email: "alice@example.com"},
        OrderPlaced{OrderID: 1001, Amount: 49.99},
        PaymentFailed{OrderID: 1002, Reason: "insufficient funds"},
    }
    for _, e := range events {
        handleEvent(e)
    }
}
```

### Fallthrough Keyword

```go
package main

import "fmt"

// Fallthrough is unconditional — it does NOT check the next case's expression.
// Use it only when you genuinely need C-style cascading logic.

func accessLevel(role string) []string {
    var permissions []string

    switch role {
    case "admin":
        permissions = append(permissions, "delete")
        fallthrough // falls through to "editor" regardless of role value
    case "editor":
        permissions = append(permissions, "write")
        fallthrough
    case "viewer":
        permissions = append(permissions, "read")
    }

    return permissions
}

func main() {
    for _, role := range []string{"viewer", "editor", "admin", "guest"} {
        fmt.Printf("%-8s -> %v\n", role, accessLevel(role))
    }
}
```

---

## 4. Break, Continue, Goto, and Labels

### Why Before How

Labels exist to solve a specific problem: breaking out of a nested loop from inside an inner loop. In Java/C you need a boolean flag. In Python you restructure into a function. In Go you put a label on the outer loop and say `break OuterLoop`. This is not `goto` — it jumps to a specific, named, structurally enclosing statement.

`goto` exists in Go for state machines and hand-written parsers. The Go spec restricts it: you cannot `goto` a label that skips a variable declaration, and you cannot jump into a block from outside it. These restrictions prevent the worst C `goto` abuses while keeping the tool available for the legitimate case.

### Labeled Break for Nested Loops

```go
package main

import "fmt"

// Real use case: 2D grid search (pathfinding, image processing, CSV scanning)
func findFirstNegative(matrix [][]int) (row, col int, found bool) {
OuterLoop:
    for r, rowSlice := range matrix {
        for c, val := range rowSlice {
            if val < 0 {
                row, col, found = r, c, true
                break OuterLoop // exits BOTH loops immediately
            }
        }
    }
    return
}

func main() {
    grid := [][]int{
        {1, 2, 3},
        {4, -5, 6},
        {7, 8, 9},
    }

    r, c, found := findFirstNegative(grid)
    if found {
        fmt.Printf("first negative: grid[%d][%d] = %d\n", r, c, grid[r][c])
    } else {
        fmt.Println("no negative values found")
    }
}
```

### Labeled Continue

```go
package main

import "fmt"

// Skip entire outer-loop iteration from inside an inner loop
func processJobBatches(batches [][]int) {
BatchLoop:
    for batchIdx, batch := range batches {
        fmt.Printf("processing batch %d\n", batchIdx)
        for _, job := range batch {
            if job < 0 {
                fmt.Printf("  batch %d contains invalid job %d, skipping entire batch\n",
                    batchIdx, job)
                continue BatchLoop // skip to next batch, not just next job
            }
            fmt.Printf("  running job %d\n", job)
        }
        fmt.Printf("  batch %d complete\n", batchIdx)
    }
}

func main() {
    batches := [][]int{
        {1, 2, 3},
        {4, -1, 6}, // invalid job — whole batch skipped
        {7, 8, 9},
    }
    processJobBatches(batches)
}
```

### Goto in a State Machine (Legitimate Use)

```go
package main

import "fmt"

// Hand-written lexer fragment — goto keeps the state transitions flat
// without deep nesting or a separate switch-in-loop structure.
// This pattern appears in Go's own scanner (go/scanner package).

func lexSimple(input string) []string {
    var tokens []string
    i := 0

start:
    if i >= len(input) {
        goto done
    }
    if input[i] == ' ' || input[i] == '\t' || input[i] == '\n' {
        i++
        goto start
    }
    if input[i] >= 'a' && input[i] <= 'z' || input[i] >= 'A' && input[i] <= 'Z' {
        j := i
        goto readWord
        _ = j // suppress "declared and not used" if readWord unreachable
    readWord:
        for j < len(input) && (input[j] >= 'a' && input[j] <= 'z' ||
            input[j] >= 'A' && input[j] <= 'Z') {
            j++
        }
        tokens = append(tokens, input[i:j])
        i = j
        goto start
    }
    // treat anything else as a single-char token
    tokens = append(tokens, string(input[i]))
    i++
    goto start

done:
    return tokens
}

func main() {
    tokens := lexSimple("hello world foo bar")
    fmt.Println(tokens)
}
```

---

## 5. Defer

### Why Before How

`defer` is a control flow construct, not just a convenience. It schedules a function call to execute immediately before the surrounding function returns — whether via a normal `return`, a `panic`, or an explicit `return` from any branch. This makes it strictly more powerful than `finally` in Java/Python because:

1. It runs on panic, not just normal return.
2. It runs in LIFO order — if you acquire locks A then B, you release B then A, which is correct.
3. It captures the defer arguments at the time of the `defer` statement, not at execution time (unless you use a closure — then it captures variables by reference).

The combination of LIFO order + panic recovery makes `defer` the backbone of Go's resource management story.

### Basic Defer: Resource Cleanup

```go
package main

import (
    "fmt"
    "os"
)

func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return fmt.Errorf("open %s: %w", err)
    }
    defer f.Close() // registered here, runs when processFile returns

    // Multiple defers stack in LIFO order
    fmt.Println("file opened:", f.Name())

    // ... read, parse, process ...
    // f.Close() runs automatically after this return
    return nil
}

func main() {
    // Create a temp file to demonstrate
    tmp, _ := os.CreateTemp("", "demo-*.txt")
    tmp.WriteString("hello")
    tmp.Close()

    if err := processFile(tmp.Name()); err != nil {
        fmt.Println("error:", err)
    }

    os.Remove(tmp.Name())
}
```

### LIFO Order Demonstration

```go
package main

import "fmt"

func acquireResources() {
    fmt.Println("acquiring database connection")
    defer fmt.Println("releasing database connection") // runs LAST (LIFO)

    fmt.Println("acquiring mutex lock")
    defer fmt.Println("releasing mutex lock") // runs second

    fmt.Println("acquiring file handle")
    defer fmt.Println("closing file handle") // runs FIRST (registered last)

    fmt.Println("doing work...")
}

func main() {
    acquireResources()
}

// Output:
// acquiring database connection
// acquiring mutex lock
// acquiring file handle
// doing work...
// closing file handle      <- deferred last, runs first
// releasing mutex lock
// releasing database connection
```

### Defer + Named Return Values

Named return values and defer interact in a subtle and powerful way: a deferred function that closes over named return variables can read and modify them even after the `return` statement.

```go
package main

import (
    "fmt"
    "errors"
)

// Real use case: transaction wrapper — commit or rollback based on error
func runTransaction(fn func() error) (err error) {
    // Simulate: begin transaction
    fmt.Println("BEGIN TRANSACTION")

    defer func() {
        // err here is the NAMED RETURN variable — it reflects
        // whatever the function returned, even after return statement ran
        if err != nil {
            fmt.Println("ROLLBACK (error:", err, ")")
        } else {
            fmt.Println("COMMIT")
        }
    }()

    err = fn() // sets the named return
    return     // bare return — deferred func sees the current err
}

func main() {
    // Successful transaction
    fmt.Println("--- success case ---")
    runTransaction(func() error {
        fmt.Println("  executing queries...")
        return nil
    })

    // Failed transaction
    fmt.Println("--- failure case ---")
    runTransaction(func() error {
        fmt.Println("  executing queries...")
        return errors.New("constraint violation")
    })
}
```

### The Defer-in-Loop Pitfall

```go
package main

import (
    "fmt"
    "os"
)

// BUG: defer inside a loop — all defers run when the FUNCTION returns,
// not when the loop iteration ends. With 10000 files this holds
// 10000 open file descriptors until the function exits.
func buggyProcessFiles(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close() // BUG: all files stay open until function returns
        fmt.Println("processing:", p)
    }
    return nil
}

// FIX 1: extract to a helper function — defer scopes to the helper
func processOneFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // now scoped correctly to this call
    fmt.Println("processing:", path)
    return nil
}

func fixedProcessFiles(paths []string) error {
    for _, p := range paths {
        if err := processOneFile(p); err != nil {
            return err
        }
    }
    return nil
}

// FIX 2: explicit close in loop body (use when helper function is overkill)
func fixedProcessFilesInline(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        fmt.Println("processing:", p)
        f.Close() // explicit — fine when no early return paths complicate it
    }
    return nil
}

func main() {
    // Create temp files for demonstration
    var paths []string
    for i := 0; i < 3; i++ {
        tmp, _ := os.CreateTemp("", "demo-*.txt")
        tmp.Close()
        paths = append(paths, tmp.Name())
    }

    fixedProcessFiles(paths)

    for _, p := range paths {
        os.Remove(p)
    }
}
```

---

## Complete Production Example: HTTP Middleware Pipeline

This example combines all control flow constructs in a realistic context.

```go
package main

import (
    "errors"
    "fmt"
    "strings"
    "time"
)

// Simulated request/response types
type Request struct {
    Method  string
    Path    string
    Headers map[string]string
    Body    string
}

type Response struct {
    StatusCode int
    Body       string
}

// Middleware signature
type HandlerFunc func(req Request) (Response, error)
type Middleware func(next HandlerFunc) HandlerFunc

// --- Middleware 1: Request logging with defer ---
func loggingMiddleware(next HandlerFunc) HandlerFunc {
    return func(req Request) (resp Response, err error) {
        start := time.Now()
        fmt.Printf("[LOG] %s %s started\n", req.Method, req.Path)

        defer func() {
            elapsed := time.Since(start)
            if err != nil {
                fmt.Printf("[LOG] %s %s FAILED (%v) in %s\n",
                    req.Method, req.Path, err, elapsed)
            } else {
                fmt.Printf("[LOG] %s %s %d in %s\n",
                    req.Method, req.Path, resp.StatusCode, elapsed)
            }
        }()

        return next(req)
    }
}

// --- Middleware 2: Auth with if-init and type switch ---
type AuthError struct{ Message string }
type RateLimitError struct{ RetryAfter int }

func (e AuthError) Error() string      { return "auth: " + e.Message }
func (e RateLimitError) Error() string { return fmt.Sprintf("rate limited, retry after %ds", e.RetryAfter) }

func authMiddleware(next HandlerFunc) HandlerFunc {
    return func(req Request) (Response, error) {
        if token, ok := req.Headers["Authorization"]; !ok || !strings.HasPrefix(token, "Bearer ") {
            return Response{StatusCode: 401, Body: "unauthorized"}, AuthError{"missing or invalid token"}
        }
        return next(req)
    }
}

// --- Route handler with switch ---
func router(req Request) (Response, error) {
    switch req.Method + " " + req.Path {
    case "GET /health":
        return Response{StatusCode: 200, Body: `{"status":"ok"}`}, nil
    case "GET /users":
        return Response{StatusCode: 200, Body: `[{"id":1},{"id":2}]`}, nil
    case "POST /users":
        if req.Body == "" {
            return Response{StatusCode: 400, Body: "body required"}, errors.New("empty body")
        }
        return Response{StatusCode: 201, Body: req.Body}, nil
    default:
        return Response{StatusCode: 404, Body: "not found"}, nil
    }
}

// --- Chain middlewares ---
func chain(h HandlerFunc, middlewares ...Middleware) HandlerFunc {
    // Apply in reverse so first middleware is outermost
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}

// --- Error classification with type switch ---
func handleError(err error) {
    switch e := err.(type) {
    case AuthError:
        fmt.Printf("  -> auth failure: %s\n", e.Message)
    case RateLimitError:
        fmt.Printf("  -> rate limited, retry in %ds\n", e.RetryAfter)
    case nil:
        // no error
    default:
        fmt.Printf("  -> internal error: %v\n", e)
    }
}

func main() {
    handler := chain(router, loggingMiddleware, authMiddleware)

    requests := []Request{
        {
            Method:  "GET",
            Path:    "/health",
            Headers: map[string]string{"Authorization": "Bearer valid-token"},
        },
        {
            Method:  "GET",
            Path:    "/users",
            Headers: map[string]string{}, // missing auth
        },
        {
            Method:  "POST",
            Path:    "/users",
            Headers: map[string]string{"Authorization": "Bearer valid-token"},
            Body:    `{"name":"alice"}`,
        },
        {
            Method:  "DELETE",
            Path:    "/unknown",
            Headers: map[string]string{"Authorization": "Bearer valid-token"},
        },
    }

    for _, req := range requests {
        fmt.Printf("\nRequest: %s %s\n", req.Method, req.Path)
        resp, err := handler(req)
        handleError(err)
        fmt.Printf("Response: %d %s\n", resp.StatusCode, resp.Body)
    }
}
```

---

## Common Pitfalls Summary

| Pitfall | Symptom | Fix |
|---|---|---|
| Loop variable capture in goroutine | All goroutines use the same final value | Shadow with `v := v` or pass as arg |
| `defer` inside a loop | File descriptors / connections leak until function returns | Extract to a helper function |
| `fallthrough` surprises | Case executes even when condition doesn't match | Prefer multiple values in one case: `case "a", "b":` |
| `switch` missing default | Silent no-op on unexpected input | Always add a `default` or explicitly comment its absence |
| Named return + bare return without defer | Shadowing named return with `:=` inside function body | Assign to named return or use explicit return value |
| `if err != nil` after `:=` in init shadows outer err | Outer error never seen | Use `=` if variable already declared, or use a different name |
| `goto` jumping over a variable declaration | Compile error: "goto jumps over declaration" | Declare variables before the label or restructure |
| `range` on string iterates runes not bytes | Byte offset != index | If you need bytes: `for i := 0; i < len(s); i++` |

---

## Quick Reference

```go
// if with init
if v, err := parse(s); err != nil { ... } else { use(v) }

// for shapes
for i := 0; i < n; i++ { ... }          // classic
for condition { ... }                    // while
for { ... }                              // infinite
for i, v := range slice { ... }         // range slice
for k, v := range m { ... }             // range map
for v := range ch { ... }               // range channel (until close)
for i, r := range str { ... }           // range string (runes, not bytes)

// switch
switch x { case 1, 2: ... default: ... }        // expression
switch { case x > 0: ... }                       // condition chain
switch v := x.(type) { case int: ... }           // type dispatch

// labels
OuterLoop:
    for { for { break OuterLoop } }

// defer: LIFO, runs on return/panic
defer cleanup()
defer func() { if err != nil { rollback() } }()  // with named return
```
