> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# GoForge Interview Questions — Beginner Level

50 Q&A pairs for junior Go engineer interviews.

---

**Q1: What is Go and why was it created?**
**Answer:** Go (also called Golang) is a statically typed, compiled programming language designed at Google by Robert Griesemer, Rob Pike, and Ken Thompson, and released publicly in 2009. It was created to address frustrations with existing languages at Google — C++ compiled too slowly, Java had heavy runtime overhead, and Python was too slow for systems work. Go was designed to offer fast compilation, safe concurrency, garbage collection, and simplicity all in a single language. The language prioritizes readability and maintainability through a minimalist syntax and opinionated formatting. It excels at building network services, CLIs, cloud infrastructure, and distributed systems.
**Code Example:**
```go
package main

import "fmt"

func main() {
    fmt.Println("Hello from Go!")
}
```
**Follow-up:** Who designed Go, and at what company?
Go was designed by Robert Griesemer, Rob Pike, and Ken Thompson at Google. It was open-sourced in 2009 and reached version 1.0 in March 2012.

---

**Q2: Is Go a compiled or interpreted language?**
**Answer:** Go is a compiled language — source code is translated directly into native machine code by the Go compiler (`go build`), producing a standalone binary. Unlike interpreted languages such as Python or JavaScript, there is no runtime interpreter needed to execute a Go program. This results in faster startup times, lower memory footprint, and predictable performance. Go's compilation is notably fast compared to languages like C++, largely due to its simple dependency model and absence of header files. The resulting binary is statically linked by default, meaning it can be deployed without installing any runtime on the target machine.
**Code Example:**
```go
// Compile:  go build -o hello main.go
// Execute:  ./hello
package main

import "fmt"

func main() {
    fmt.Println("Go compiles to a native binary.")
}
```
**Follow-up:** What does `go run` do differently from `go build`?
`go run` compiles the source in a temporary directory and immediately executes it without leaving a persistent binary on disk, making it convenient for quick scripts and experimentation.

---

**Q3: How does Go compare to Java?**
**Answer:** Both Go and Java are statically typed, garbage-collected, and compile to run on modern hardware, but their philosophies differ significantly. Java runs on the JVM, which provides portability but adds startup overhead and requires the JVM runtime to be installed; Go compiles to a single native binary with no external runtime. Go has no classes or inheritance — it uses structs and interfaces for composition instead. Go's concurrency model (goroutines + channels) is built into the language and far lighter than Java threads. Java has a richer ecosystem of enterprise frameworks; Go's standard library is more comprehensive out of the box for network and I/O work. Go programs tend to be shorter and more readable due to the language's deliberate minimalism.
**Code Example:**
```go
// Go struct + method (no classes, no inheritance)
type Animal struct{ Name string }

func (a Animal) Speak() string {
    return a.Name + " speaks."
}
```
**Follow-up:** Does Go support inheritance?
No. Go deliberately omits inheritance. Behaviour is shared through interfaces (implicit satisfaction) and composition via struct embedding, which encourages flatter, more flexible designs.

---

**Q4: How does Go compare to Python?**
**Answer:** Python is dynamically typed and interpreted; Go is statically typed and compiled. This means Go catches type errors at compile time and runs significantly faster at runtime — often 10–100x for CPU-bound tasks. Python is more concise for scripting and data work, and its ecosystem for machine learning (NumPy, PyTorch) is unmatched, but it requires the Python runtime to be installed everywhere. Go produces self-contained binaries, making deployment and containerisation simpler. Go's explicit error handling replaces Python's exceptions, which some developers find more predictable. Both languages are readable, but Go enforces a single canonical formatting style via `gofmt`.
**Code Example:**
```go
// Type safety caught at compile time
var count int = 10
// count = "ten" // compile error: cannot use "ten" (string) as int
fmt.Println(count)
```
**Follow-up:** When would you still choose Python over Go?
Python remains the better choice for data science, machine learning pipelines, rapid scripting, and tasks that benefit from its huge third-party ecosystem (e.g., pandas, scikit-learn).

---

**Q5: How does Go compare to Node.js?**
**Answer:** Both Go and Node.js handle high-concurrency I/O well, but through different mechanisms. Node.js uses a single-threaded event loop with callbacks/promises/async-await, while Go uses goroutines that are scheduled across multiple OS threads by the Go runtime. Go is statically typed and compiled, giving better performance for CPU-bound work and earlier error detection. Node.js has a massive npm ecosystem; Go's standard library is stronger for systems and networking tasks. Go programs are easier to reason about for concurrent code because goroutines and channels avoid callback hell. For CPU-bound microservices, Go is generally the faster choice; for highly I/O-bound applications with a rich JavaScript ecosystem, Node.js can be competitive.
**Code Example:**
```go
// Thousands of goroutines are cheap — comparable to async tasks in Node
for i := 0; i < 10_000; i++ {
    go func(id int) {
        fmt.Println("goroutine", id)
    }(i)
}
```
**Follow-up:** Does Go use an event loop like Node.js?
No. Go uses a preemptive scheduler (the Go runtime scheduler) that multiplexes many goroutines onto a pool of OS threads (M:N threading), with no single event loop.

---

**Q6: What is a goroutine?**
**Answer:** A goroutine is a lightweight, independently executing function managed by the Go runtime, launched with the `go` keyword. Unlike OS threads, goroutines start with a small stack (a few kilobytes) that grows and shrinks dynamically, so you can run hundreds of thousands concurrently without exhausting memory. The Go runtime scheduler multiplexes goroutines onto a smaller number of OS threads using a work-stealing M:N scheduler. Goroutines communicate through channels or shared memory (protected by sync primitives). They are the fundamental unit of concurrency in Go and are central to writing scalable network services.
**Code Example:**
```go
package main

import (
    "fmt"
    "time"
)

func greet(name string) {
    fmt.Println("Hello,", name)
}

func main() {
    go greet("Alice") // runs concurrently
    go greet("Bob")
    time.Sleep(100 * time.Millisecond) // wait for goroutines to finish
}
```
**Follow-up:** How much stack memory does a goroutine start with?
A new goroutine starts with approximately 2–8 KB of stack, and the Go runtime grows or shrinks it dynamically as needed (up to a default maximum of 1 GB).

---

**Q7: How does a goroutine differ from an OS thread?**
**Answer:** OS threads are managed by the kernel and typically start with a fixed 1–8 MB stack, making it expensive to spawn thousands of them. Goroutines are managed entirely by the Go runtime in user space and start with a tiny, dynamically-sized stack (roughly 2 KB). Context switching between goroutines is much cheaper than kernel-level thread switches because it happens in user space. The Go runtime scheduler maps many goroutines onto a smaller pool of OS threads (M:N scheduling), so your program can have 100,000 goroutines running on, say, 8 OS threads. This model allows Go to handle massive concurrency with low overhead, which is ideal for network servers.
**Code Example:**
```go
// Spawning 100,000 goroutines is practical in Go
for i := 0; i < 100_000; i++ {
    go func() { /* lightweight work */ }()
}
```
**Follow-up:** What does GOMAXPROCS control?
`GOMAXPROCS` sets the number of OS threads that can execute Go code simultaneously. It defaults to the number of logical CPU cores on the machine.

---

**Q8: What is a channel in Go?**
**Answer:** A channel is a typed conduit through which goroutines send and receive values, providing safe communication without explicit locks. Channels are created with `make(chan T)` for unbuffered or `make(chan T, n)` for buffered channels. An unbuffered channel synchronises the sender and receiver — the send blocks until the receiver is ready and vice versa. A buffered channel holds up to `n` values before blocking the sender. Channels follow the principle "do not communicate by sharing memory; instead, share memory by communicating." Closing a channel signals to receivers that no more values will be sent; reading from a closed channel returns the zero value.
**Code Example:**
```go
ch := make(chan int) // unbuffered

go func() {
    ch <- 42 // send
}()

val := <-ch // receive
fmt.Println(val) // 42
```
**Follow-up:** What is a buffered channel and when would you use one?
A buffered channel (`make(chan T, n)`) allows up to `n` sends to proceed without a corresponding receive, decoupling producers from consumers slightly and smoothing out burst traffic.

---

**Q9: What is `defer` in Go?**
**Answer:** `defer` schedules a function call to be executed just before the surrounding function returns, regardless of whether it returns normally or via a panic. Multiple deferred calls are executed in last-in, first-out (LIFO) order. It is most commonly used for cleanup tasks such as closing files, releasing locks, or closing database connections, ensuring these actions always happen even if an error or panic occurs mid-function. Deferred function arguments are evaluated immediately when the `defer` statement is encountered, not at the time of execution. This pattern eliminates the need for `try/finally` blocks found in other languages.
**Code Example:**
```go
func readFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // always runs when readFile returns

    // read from f...
    return nil
}
```
**Follow-up:** In what order do multiple defers execute?
Multiple deferred calls execute in LIFO (last-in, first-out) order — the last `defer` statement encountered is the first one to run when the function returns.

---

**Q10: How does Go handle errors instead of using exceptions?**
**Answer:** Go does not have exceptions. Functions that can fail return an `error` value as their last return value, and callers are expected to check it explicitly with an `if err != nil` guard. This makes error handling visible at every call site, preventing silent failures that are common with unchecked exceptions. The `error` type is a built-in interface with a single `Error() string` method. Custom errors can be created with `errors.New`, `fmt.Errorf` (which supports wrapping with `%w`), or by implementing the `error` interface on a struct. Go 1.13 introduced `errors.Is` and `errors.As` for inspecting wrapped error chains.
**Code Example:**
```go
import (
    "errors"
    "fmt"
)

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

result, err := divide(10, 0)
if err != nil {
    fmt.Println("Error:", err)
}
```
**Follow-up:** How do you wrap an error in Go to add context?
Use `fmt.Errorf("context: %w", err)` to wrap an error; the `%w` verb stores the original error so it can later be inspected with `errors.Is` or `errors.As`.

---

**Q11: What are zero values in Go?**
**Answer:** In Go every variable is automatically initialised to its zero value when declared without an explicit initialiser. This eliminates undefined behaviour caused by uninitialised variables. The zero values are: `0` for numeric types, `false` for `bool`, `""` (empty string) for `string`, and `nil` for pointers, slices, maps, channels, functions, and interfaces. Structs are zero-initialised field by field. This design means you can safely read a variable immediately after declaration, and many types (like `sync.Mutex`) are usable in their zero state without any constructor call.
**Code Example:**
```go
var i int       // 0
var f float64   // 0.0
var b bool      // false
var s string    // ""
var p *int      // nil

fmt.Println(i, f, b, s, p) // 0 0 false  <nil>
```
**Follow-up:** What is the zero value of a struct?
The zero value of a struct is a struct where each field is initialised to its own zero value — numeric fields to 0, string fields to `""`, pointer fields to `nil`, and so on.

---

**Q12: What is the difference between value semantics and pointer semantics?**
**Answer:** In Go, when you pass a variable by value, a copy of the data is made; mutations inside the function do not affect the original. When you pass a pointer, you pass the memory address, so mutations inside the function affect the original data. Value semantics are safer and more predictable for small, immutable data. Pointer semantics are necessary when you need to mutate a value, avoid expensive copies of large structs, or share state between goroutines (with appropriate synchronisation). Method receivers can also be value (`func (t T) method()`) or pointer (`func (t *T) method()`); pointer receivers can modify the receiver and are required when the struct is large or needs to be mutated.
**Code Example:**
```go
type Point struct{ X, Y int }

func scaleValue(p Point, factor int) Point {
    p.X *= factor; p.Y *= factor
    return p // original unchanged
}

func scalePointer(p *Point, factor int) {
    p.X *= factor; p.Y *= factor // modifies original
}
```
**Follow-up:** When should you prefer a pointer receiver over a value receiver on a method?
Use a pointer receiver when the method needs to mutate the receiver, when the struct is large and copying is expensive, or when you want all methods on a type to share a consistent receiver type.

---

**Q13: What is an interface in Go?**
**Answer:** An interface in Go is a type defined as a set of method signatures. Any type that implements all the methods of an interface satisfies it implicitly — there is no `implements` keyword. This implicit satisfaction, known as structural typing or duck typing, decouples code: a function that accepts an interface works with any future type that happens to satisfy it. Interfaces enable polymorphism and are the primary mechanism for abstraction in Go. The empty interface (`interface{}` or `any` in Go 1.18+) is satisfied by every type, making it the equivalent of `Object` in Java. Interface values hold both a concrete type and a value; a nil interface is different from an interface holding a nil pointer.
**Code Example:**
```go
type Speaker interface {
    Speak() string
}

type Dog struct{}
func (d Dog) Speak() string { return "Woof!" }

type Cat struct{}
func (c Cat) Speak() string { return "Meow!" }

func makeNoise(s Speaker) {
    fmt.Println(s.Speak())
}

makeNoise(Dog{}) // Woof!
makeNoise(Cat{}) // Meow!
```
**Follow-up:** Does a Go type need to declare that it implements an interface?
No. Interfaces are satisfied implicitly. If a type has all the methods an interface requires, it automatically satisfies that interface with no explicit declaration needed.

---

**Q14: What is the blank identifier `_` in Go?**
**Answer:** The blank identifier `_` is a special write-only variable that discards any value assigned to it. Go's compiler enforces that every declared variable must be used; `_` provides a way to satisfy this requirement when you intentionally do not need a value. It is commonly used to discard the error return value (though this is discouraged in production code), to ignore a loop index or value, and to import packages solely for their side effects (e.g., `import _ "image/png"`). It can also be used in a variable declaration to force a compile-time interface satisfaction check.
**Code Example:**
```go
// Ignore loop index
for _, v := range []int{1, 2, 3} {
    fmt.Println(v)
}

// Compile-time interface check
var _ Speaker = Dog{} // verifies Dog implements Speaker

// Side-effect import
import _ "image/png" // registers PNG decoder
```
**Follow-up:** Why is discarding errors with `_` considered bad practice?
Silently discarding errors means failures go undetected, leading to data corruption, security issues, or confusing bugs. Always handle or explicitly log errors so problems surface at the right layer.

---

**Q15: What is the difference between `make` and `new` in Go?**
**Answer:** `new(T)` allocates memory for a value of type `T`, initialises it to its zero value, and returns a `*T` (pointer to T). It works for any type. `make(T, args...)` is only for slices, maps, and channels — it allocates and initialises the internal data structure (length, capacity, hash buckets, or channel buffer), returning a ready-to-use value of type `T` (not a pointer). You must use `make` for these three types because their zero value (`nil`) is not usable without initialisation. In practice, `new` is rarely used; most allocations happen via composite literals or `make`.
**Code Example:**
```go
// new: returns a *int initialised to 0
p := new(int)
*p = 42

// make: returns an initialised, usable slice
s := make([]int, 5, 10)   // len=5, cap=10

// make: returns an initialised map
m := make(map[string]int)
m["a"] = 1
```
**Follow-up:** Can you use `new` to create a map?
`new(map[string]int)` returns a `*map[string]int` pointing to a nil map. Attempting to write to that nil map will panic. You must use `make` (or a composite literal) to create a usable map.

---

**Q16: What is the difference between a slice and an array in Go?**
**Answer:** An array in Go has a fixed length that is part of its type — `[3]int` and `[5]int` are different types and cannot be interchanged. Arrays are value types: assigning one array to another copies all elements. Slices are dynamically-sized views over an underlying array described by a pointer, a length, and a capacity. Slices are reference types: assigning one slice to another copies the header but both point to the same underlying array. Because of their flexibility, slices are used far more often than arrays in Go. The built-in `append` function grows a slice automatically, allocating a new underlying array when the capacity is exceeded.
**Code Example:**
```go
// Array — fixed size, value type
arr := [3]int{1, 2, 3}
copy := arr  // deep copy

// Slice — dynamic size, reference type
s := []int{1, 2, 3}
s = append(s, 4, 5)
fmt.Println(len(s), cap(s)) // 5, 6 (capacity may vary)
```
**Follow-up:** What happens when `append` exceeds a slice's capacity?
Go allocates a new, larger underlying array (typically doubling capacity for small slices), copies the existing elements, and returns a new slice header pointing to the new array.

---

**Q17: How do maps work in Go?**
**Answer:** A map in Go is an unordered collection of key-value pairs where keys must be comparable (support `==`). Maps are created with `make(map[K]V)` or a composite literal. Reading a missing key returns the zero value for the value type — no panic occurs. To distinguish between a missing key and a key with a zero value, use the two-value form: `v, ok := m[key]`. Maps are reference types; passing a map to a function allows the function to modify the original. Maps are not safe for concurrent access — use `sync.Mutex` or `sync.Map` when multiple goroutines read/write the same map. Iteration order over maps is intentionally randomised in each run.
**Code Example:**
```go
m := map[string]int{
    "alice": 30,
    "bob":   25,
}

age, ok := m["alice"]
if ok {
    fmt.Println("Alice is", age) // Alice is 30
}

delete(m, "bob")
fmt.Println(len(m)) // 1
```
**Follow-up:** Why are map iteration orders random in Go?
The Go runtime deliberately randomises map iteration order (since Go 1.0) to prevent programs from accidentally relying on a specific order, since the internal hash layout is an implementation detail that can change.

---

**Q18: What is `package main` and why is it special?**
**Answer:** In Go, every source file belongs to a package declared at the top with `package <name>`. `package main` is the special package that defines an executable program rather than a reusable library. The Go toolchain looks for a `main` function inside `package main` as the entry point of the program. Any Go file in `package main` with a `main()` function can be compiled into a runnable binary with `go build`. If you name a package anything other than `main`, it compiles into a library (archive) that can be imported but not run directly. There can be only one `main` function across all files in the same `package main`.
**Code Example:**
```go
package main // marks this as an executable

import "fmt"

func main() { // entry point
    fmt.Println("Entry point reached.")
}
```
**Follow-up:** Can a library package have a `main` function?
A package that is not named `main` can technically define a function called `main`, but it will not be treated as an entry point by the toolchain — it is just a regular exported or unexported function.

---

**Q19: What are exported and unexported identifiers in Go?**
**Answer:** In Go, an identifier (variable, function, type, constant, field) is exported (visible outside its package) if it starts with an uppercase letter, and unexported (package-private) if it starts with a lowercase letter. There are no `public` or `private` keywords — capitalisation is the sole visibility rule. This convention applies to functions, types, struct fields, interface methods, constants, and variables. Unexported identifiers can still be accessed via reflection in some cases, but the convention is to treat them as internal implementation details. This simple rule makes package APIs immediately obvious by scanning identifier names.
**Code Example:**
```go
package geometry

// Exported — visible to other packages
type Circle struct {
    Radius float64 // exported field
}

// unexported — internal helper
func area(r float64) float64 {
    return 3.14159 * r * r
}

// Exported method
func (c Circle) Area() float64 {
    return area(c.Radius)
}
```
**Follow-up:** Can an exported struct have unexported fields?
Yes. An exported struct can have a mix of exported (uppercase) and unexported (lowercase) fields. Unexported fields are accessible within the same package but not from external packages.

---

**Q20: What is `go.mod` and what does it do?**
**Answer:** `go.mod` is the module definition file introduced in Go 1.11 that replaced the older GOPATH-based dependency management. It declares the module path (the import prefix for the module), the minimum Go version required, and all direct and indirect dependencies with their specific versions. Running `go mod init <module-path>` creates the file. The Go toolchain uses `go.mod` and its companion `go.sum` (a cryptographic hash file) to ensure reproducible, hermetic builds. You can update dependencies with `go get`, tidy unused entries with `go mod tidy`, and download all dependencies with `go mod download`.
**Code Example:**
```
// go.mod example
module github.com/gaurav/myapp

go 1.22

require (
    github.com/gin-gonic/gin v1.9.1
    golang.org/x/crypto v0.22.0
)
```
**Follow-up:** What does `go mod tidy` do?
`go mod tidy` adds any missing module requirements needed by current code and removes requirements for modules that are no longer used, keeping `go.mod` and `go.sum` in sync with the actual imports.

---

**Q21: How does Go handle imports?**
**Answer:** Go imports are declared at the top of each source file using the `import` keyword with the full module path of the package. The Go compiler requires that every imported package is actually used — an unused import is a compile error. Multiple imports can be grouped in a parenthesised block. Import aliases can rename a package locally to avoid name collisions or for convenience. Standard library packages use short paths like `"fmt"` or `"net/http"`, while third-party packages use full module paths like `"github.com/gin-gonic/gin"`. A dot import (`import . "pkg"`) merges the package's exported names into the current namespace (generally discouraged).
**Code Example:**
```go
import (
    "fmt"
    "os"
    "net/http"

    log "github.com/sirupsen/logrus" // alias
    _ "image/png"                    // side-effect only
)
```
**Follow-up:** Why does Go treat an unused import as a compile error?
To keep code clean and avoid confusion. Unused imports add noise to the dependency graph, slow compilation marginally, and suggest the code may have been refactored incompletely. The strict rule forces developers to keep imports intentional.

---

**Q22: What are `panic` and `recover` in Go?**
**Answer:** `panic` is a built-in function that stops normal execution of the current goroutine and begins unwinding the call stack, running deferred functions along the way. It is intended for truly unrecoverable errors — index out of bounds, nil pointer dereference, or explicit programmer assertions. `recover` is a built-in that, when called inside a deferred function, stops the panic and returns the value passed to `panic`. This is Go's equivalent of a `catch` for panics. After recovery, execution continues normally in the deferred function and the function that called `recover` returns normally. Using panic/recover for ordinary error handling is an anti-pattern; they are reserved for exceptional, unexpected situations.
**Code Example:**
```go
func safeDiv(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered from panic: %v", r)
        }
    }()
    return a / b, nil // panics if b == 0
}

res, err := safeDiv(10, 0)
fmt.Println(res, err) // 0 recovered from panic: runtime error: integer divide by zero
```
**Follow-up:** In what order do deferred functions run when a panic occurs?
Deferred functions run in LIFO order during a panic unwind, just as they do during a normal return. If a deferred function calls `recover`, the panic is stopped at that point.

---

**Q23: What is a goroutine leak?**
**Answer:** A goroutine leak occurs when a goroutine is started but never terminates — it remains alive indefinitely, consuming stack memory and potentially holding resources like channels or file handles. Common causes include goroutines blocked waiting on a channel that will never receive a value, goroutines blocked on a network or I/O operation with no timeout, or goroutines stuck in an infinite loop. Over time, leaking goroutines can exhaust memory and degrade performance. Leaks are detected with the `runtime.NumGoroutine()` function or tools like `pprof`. Prevention strategies include using `context.Context` for cancellation, ensuring every `go` statement has a clear termination path, and using `select` with a `Done` channel.
**Code Example:**
```go
// LEAK: goroutine blocks forever if ch is never read
func leak() {
    ch := make(chan int)
    go func() {
        ch <- 1 // blocks forever if no receiver
    }()
    // ch is never read, goroutine leaks
}

// FIX: use context or ensure receiver exists
func noLeak(ctx context.Context) {
    ch := make(chan int, 1)
    go func() {
        select {
        case ch <- 1:
        case <-ctx.Done():
        }
    }()
}
```
**Follow-up:** How would you detect goroutine leaks in a running Go program?
Use `runtime.NumGoroutine()` to track counts over time, or expose a `/debug/pprof/goroutine` endpoint via `net/http/pprof` and inspect it with `go tool pprof`.

---

**Q24: What is the difference between GOPATH and Go modules?**
**Answer:** GOPATH was the original Go workspace mechanism where all Go code, dependencies, and binaries lived under a single directory tree (typically `~/go`). It required all projects to live inside `$GOPATH/src` and offered no version pinning — you always got the latest code from a dependency. Go modules (introduced experimentally in Go 1.11, the default since Go 1.16) replaced GOPATH with per-project `go.mod` files. Modules allow projects to live anywhere on the filesystem, enable exact version pinning, provide reproducible builds via `go.sum`, and support semantic versioning. Today virtually all Go projects use modules; GOPATH-style development is obsolete.
**Code Example:**
```bash
# GOPATH style (legacy)
# All code must live in $GOPATH/src/github.com/user/project

# Module style (modern)
mkdir myproject && cd myproject
go mod init github.com/gaurav/myproject
# go.mod created — project can live anywhere
```
**Follow-up:** Since when have Go modules been the default?
Go modules became the default (with `GO111MODULE` defaulting to `on`) starting with Go 1.16, released in February 2021.

---

**Q25: What do `go build`, `go run`, and `go test` do?**
**Answer:** `go build` compiles the specified packages and their dependencies into a binary; for `package main` it produces an executable in the current directory (or specified output path). `go run` compiles and immediately runs a Go program without saving the binary, useful for quick iteration. `go test` compiles and runs tests found in files ending in `_test.go`, looking for functions named `TestXxx(t *testing.T)`. `go test` also supports benchmarks (`BenchmarkXxx`) and example functions (`ExampleXxx`). All three commands resolve dependencies via `go.mod`. `go build ./...` and `go test ./...` operate recursively on all packages in the module.
**Code Example:**
```bash
go build -o myapp ./cmd/server   # compile to binary named myapp
go run main.go                   # compile + run immediately
go test ./...                    # run all tests in the module
go test -v -run TestLogin ./...  # verbose, filter by name
```
**Follow-up:** How do you run only a specific test function with `go test`?
Use the `-run` flag with a regex: `go test -run TestFunctionName ./...` runs only tests whose names match the pattern.

---

**Q26: What is the `fmt` package and what are its most common functions?**
**Answer:** The `fmt` package provides formatted I/O functions similar to C's `printf`/`scanf`. `fmt.Println` prints values separated by spaces with a trailing newline. `fmt.Printf` uses a format string with verbs like `%d` (integer), `%s` (string), `%v` (default format), `%+v` (struct with field names), `%T` (type), and `%p` (pointer). `fmt.Sprintf` returns a formatted string instead of printing it. `fmt.Errorf` creates a formatted error, and with `%w` it wraps another error. `fmt.Scan` and `fmt.Scanf` read from standard input. The `fmt` package is the most commonly imported package in Go programs.
**Code Example:**
```go
name := "Gaurav"
score := 98

fmt.Println("Name:", name)
fmt.Printf("Score: %d/100\n", score)
msg := fmt.Sprintf("Hello, %s! Your score is %d.", name, score)
fmt.Println(msg)

type User struct{ Name string; Age int }
u := User{"Alice", 30}
fmt.Printf("%v\n", u)  // {Alice 30}
fmt.Printf("%+v\n", u) // {Name:Alice Age:30}
```
**Follow-up:** What is the difference between `%v` and `%+v`?
`%v` prints a value in its default format (e.g., `{Alice 30}` for a struct), while `%+v` additionally includes field names when printing structs (e.g., `{Name:Alice Age:30}`).

---

**Q27: What is the only loop construct in Go?**
**Answer:** Go has only one looping keyword: `for`. It subsumes all loop types found in other languages. Used with three components (`for init; condition; post`), it behaves like a C `for` loop. Used with only a condition (`for condition`), it behaves like a `while` loop. An infinite loop is written as `for {}` or `for true {}`. The `range` form (`for i, v := range collection`) iterates over arrays, slices, maps, strings, and channels. `break` exits the loop early; `continue` skips to the next iteration; labels can be used with `break` and `continue` to target outer loops.
**Code Example:**
```go
// Classic for
for i := 0; i < 3; i++ {
    fmt.Println(i)
}

// While-style
n := 1
for n < 100 {
    n *= 2
}

// Infinite loop
// for { ... }

// Range over slice
for i, v := range []string{"a", "b", "c"} {
    fmt.Println(i, v)
}
```
**Follow-up:** What does `range` return when iterating over a map?
`range` over a map returns key-value pairs in an unspecified (randomised) order. You can ignore either with `_`: `for k := range m` gives only keys.

---

**Q28: How does `switch` work in Go, and what is different about its fallthrough behaviour?**
**Answer:** Go's `switch` statement compares an expression against a list of cases and executes the first matching case. Unlike C, Java, or JavaScript, Go cases do NOT fall through by default — only the matching case executes, and there is no need for a `break` statement. Multiple values can be listed in a single case separated by commas. The optional `fallthrough` keyword explicitly transfers control to the next case (executing it unconditionally, without re-evaluating the condition). A `switch` without an expression is equivalent to `switch true` and is a clean way to write if-else chains. Cases can have expressions, making Go `switch` more flexible than many other languages.
**Code Example:**
```go
day := "Monday"
switch day {
case "Saturday", "Sunday":
    fmt.Println("Weekend")
case "Monday":
    fmt.Println("Start of work week")
    fallthrough // explicitly fall to next case
case "Tuesday":
    fmt.Println("Still early in the week")
default:
    fmt.Println("Midweek or later")
}
```
**Follow-up:** What is a type switch and when would you use it?
A type switch (`switch v := x.(type) { case int: ... }`) inspects the dynamic type of an interface value, allowing you to handle different concrete types stored in an `interface{}` or `any`.

---

**Q29: What are multiple return values in Go?**
**Answer:** Go functions can return more than one value by listing the return types in parentheses. Multiple return values are idiomatic Go — the most common use is returning a result alongside an error so callers must explicitly handle failure. This eliminates the need for out-parameters or exceptions. Return values are unpacked by the caller using a multi-assignment statement. If you do not need one of the returned values, discard it with `_`. Multiple return values are a first-class language feature, not a workaround, and they appear throughout the standard library.
**Code Example:**
```go
func minMax(nums []int) (int, int) {
    min, max := nums[0], nums[0]
    for _, n := range nums[1:] {
        if n < min { min = n }
        if n > max { max = n }
    }
    return min, max
}

lo, hi := minMax([]int{3, 1, 4, 1, 5, 9})
fmt.Println(lo, hi) // 1 9
```
**Follow-up:** How many return values can a Go function have?
Go imposes no hard limit on the number of return values, but in practice using more than two or three is considered a design smell — a struct is usually cleaner for returning many related values.

---

**Q30: What are named return values in Go?**
**Answer:** Go allows return values to be given names in the function signature. Named returns are automatically declared as local variables initialised to their zero values. A "naked return" (`return` with no arguments) returns the current values of all named return variables. Named returns are useful for documentation (making the meaning of return values clear) and for simplifying complex functions with many return paths. However, naked returns in long functions can reduce readability by obscuring what is being returned, so they are best used in short functions. Named returns can also be set inside deferred functions to modify the final return value.
**Code Example:**
```go
func divide(a, b float64) (result float64, err error) {
    if b == 0 {
        err = errors.New("division by zero")
        return // naked return: result=0, err=error
    }
    result = a / b
    return // naked return: result=a/b, err=nil
}
```
**Follow-up:** Can a deferred function modify a named return value?
Yes. A deferred function has access to the named return variables by closure, so it can read or modify them before the function actually returns. This is useful for wrapping errors in a consistent way.

---

**Q31: What is the `init()` function in Go?**
**Answer:** `init()` is a special function that is called automatically by the Go runtime after all package-level variables in a file are initialised, and before `main()` is called. It takes no arguments and returns no values. A single package can have multiple `init()` functions — even multiple in the same file — and they all run in the order they appear. `init()` functions across packages run in dependency order: the imported package's `init` runs before the importing package's `init`. Common uses include registering database drivers, setting up global state, validating configuration, or performing one-time setup that cannot be expressed as a variable initialiser.
**Code Example:**
```go
package main

import "fmt"

var greeting string

func init() {
    greeting = "Hello from init!"
    fmt.Println("init() called")
}

func main() {
    fmt.Println(greeting)
}
// Output:
// init() called
// Hello from init!
```
**Follow-up:** Can you call `init()` manually in your code?
No. `init()` is called exclusively by the Go runtime. It cannot be called directly from user code, referenced as a value, or overridden.

---

**Q32: What is `iota` in Go?**
**Answer:** `iota` is a predeclared identifier used in `const` blocks that represents the index of the current constant specification, starting at 0 and incrementing by 1 for each successive constant in the block. It is reset to 0 at the start of each new `const` block. `iota` is used to create sequences of related constants — especially enumerations — without manually assigning values. By using expressions with `iota` (like bit shifting for flag values or multiplying for scaled constants), you can create sophisticated constant series cleanly and maintainably.
**Code Example:**
```go
type Direction int

const (
    North Direction = iota // 0
    East                   // 1
    South                  // 2
    West                   // 3
)

// Bit flags using iota
const (
    Read    = 1 << iota // 1  (1 << 0)
    Write               // 2  (1 << 1)
    Execute             // 4  (1 << 2)
)

fmt.Println(North, East, South, West)    // 0 1 2 3
fmt.Println(Read, Write, Execute)        // 1 2 4
```
**Follow-up:** What happens to `iota` when you use `_` in a const block?
`iota` still increments for the `_` entry, so subsequent constants continue from the correct index. This lets you skip specific values in an enumeration.

---

**Q33: How do you declare variables in Go?**
**Answer:** Go offers several variable declaration styles. The `var` keyword is the most explicit form and works both at package level and inside functions: `var x int = 10`. At package level, `var` is the only option. Inside functions, the short declaration operator `:=` infers the type from the right-hand side and is idiomatic: `x := 10`. Multiple variables can be declared together: `x, y := 1, 2`. Constants are declared with `const` and must be compile-time values. Group declarations with `var ( ... )` blocks improve readability when declaring multiple related variables. Go enforces that all declared variables are used; unused variables inside functions cause a compile error.
**Code Example:**
```go
var globalCount int = 0 // package-level, must use var

func example() {
    var name string = "Go"      // explicit type
    age := 10                   // short declaration, type inferred
    x, y := 3.14, true         // multiple assignment

    var (
        a int    = 1
        b string = "hello"
    )

    fmt.Println(name, age, x, y, a, b)
}
```
**Follow-up:** Why is the short declaration operator `:=` not usable at package level?
Package-level declarations must use `var` or `const` so the compiler can process them in any order. The short form `:=` is restricted to function scopes where execution order is clear.

---

**Q34: What are Go's basic data types?**
**Answer:** Go's built-in types include: integers (`int`, `int8`, `int16`, `int32`, `int64`, `uint`, `uint8`/`byte`, `uint16`, `uint32`, `uint64`, `uintptr`); floating-point numbers (`float32`, `float64`); complex numbers (`complex64`, `complex128`); `bool`; and `string`. `int` and `uint` are platform-dependent (32 or 64 bits). `byte` is an alias for `uint8` and `rune` is an alias for `int32`, representing a Unicode code point. Strings in Go are immutable sequences of bytes (not characters), and are UTF-8 encoded by convention. There are no implicit numeric conversions — all type conversions must be explicit.
**Code Example:**
```go
var i int = 42
var f float64 = 3.14
var b bool = true
var s string = "GoForge"
var r rune = '你'      // Unicode code point (int32)
var by byte = 'A'     // uint8

// Explicit conversion required
var x float64 = float64(i) + f
fmt.Println(x) // 45.14
```
**Follow-up:** What is the difference between `byte` and `rune`?
`byte` is an alias for `uint8` and represents a single byte of data (often ASCII). `rune` is an alias for `int32` and represents a Unicode code point, which can be up to 4 bytes in UTF-8. Use `rune` when working with international characters.

---

**Q35: How do structs work in Go?**
**Answer:** A struct is a composite type that groups together fields of different types under a single named type, similar to a record or object without methods. Structs are declared with the `type ... struct { }` syntax. Fields are accessed with dot notation. Structs are value types — assignment or passing to a function copies the entire struct. Methods are defined separately using a receiver syntax. Struct literals initialise a struct either positionally or by field name; the named form is preferred as it is resistant to field reordering. Anonymous structs (without a type name) are useful for short-lived groupings. Struct embedding provides a form of composition that promotes fields and methods from embedded types.
**Code Example:**
```go
type Person struct {
    Name string
    Age  int
}

func (p Person) Greet() string {
    return fmt.Sprintf("Hi, I'm %s, age %d.", p.Name, p.Age)
}

p := Person{Name: "Gaurav", Age: 28}
fmt.Println(p.Greet())

// Anonymous struct
config := struct{ Host string; Port int }{"localhost", 8080}
fmt.Println(config.Host, config.Port)
```
**Follow-up:** What is struct embedding in Go?
Struct embedding includes one struct type inside another without a field name. The outer struct automatically promotes all fields and methods of the embedded type, providing a form of reuse similar to inheritance.

---

**Q36: What is a pointer in Go?**
**Answer:** A pointer holds the memory address of a value rather than the value itself. The address-of operator `&` returns a pointer to a variable; the dereference operator `*` accesses the value at the address. Pointers in Go are safe — there is no pointer arithmetic (unlike C), and the garbage collector manages memory. Pointers are used to share and mutate values across function boundaries, to avoid copying large structs, and to implement data structures like linked lists. A pointer's zero value is `nil`. Dereferencing a nil pointer causes a runtime panic. The `new` built-in allocates a zero-initialised value and returns a pointer to it.
**Code Example:**
```go
x := 10
p := &x         // p is *int, holds address of x
fmt.Println(*p) // 10 — dereference

*p = 20
fmt.Println(x)  // 20 — x was modified via pointer

func increment(n *int) {
    *n++
}
increment(&x)
fmt.Println(x) // 21
```
**Follow-up:** Is there pointer arithmetic in Go?
No. Go does not support pointer arithmetic. The `unsafe` package provides `unsafe.Pointer` and `uintptr` that can be used for low-level pointer manipulation, but this is strongly discouraged in normal code.

---

**Q37: How does type assertion work in Go?**
**Answer:** A type assertion extracts the concrete value stored inside an interface variable. The syntax `v, ok := i.(T)` checks whether the interface value `i` holds a value of type `T`. If the assertion succeeds, `v` holds the concrete value and `ok` is `true`. If it fails, `v` is the zero value of `T` and `ok` is `false`. The single-return form `v := i.(T)` panics if the assertion fails. Type assertions are used when you receive an `interface{}` or `any` value and need to work with the underlying type. They are also used to check whether a value implements an optional interface.
**Code Example:**
```go
var i interface{} = "hello"

s, ok := i.(string)
if ok {
    fmt.Println("String:", s) // String: hello
}

n, ok := i.(int)
fmt.Println(ok, n) // false 0

// Panics if wrong:
// s2 := i.(int) // panic: interface conversion
```
**Follow-up:** What is the difference between a type assertion and a type switch?
A type assertion tests for one specific type. A type switch tests an interface value against multiple types in one statement, executing the matching branch — it is cleaner when you need to handle several possible types.

---

**Q38: What is a function type and how are functions first-class in Go?**
**Answer:** In Go, functions are first-class values — they can be assigned to variables, passed as arguments, returned from other functions, and stored in data structures. Every function has a type defined by its parameter and return types. Anonymous functions (function literals or closures) can be defined inline. A closure captures variables from its enclosing scope and can read and write them. Higher-order functions that accept or return other functions are idiomatic in Go, particularly for callbacks, middleware patterns, and functional utilities like `sort.Slice`. Function types make dependency injection and testing straightforward.
**Code Example:**
```go
// Function as a variable
add := func(a, b int) int { return a + b }
fmt.Println(add(2, 3)) // 5

// Higher-order function
func apply(nums []int, f func(int) int) []int {
    result := make([]int, len(nums))
    for i, v := range nums {
        result[i] = f(v)
    }
    return result
}

doubled := apply([]int{1, 2, 3}, func(n int) int { return n * 2 })
fmt.Println(doubled) // [2 4 6]
```
**Follow-up:** What is a closure in Go?
A closure is an anonymous function that references variables from its surrounding lexical scope. The closure captures those variables by reference, so it can read and modify them even after the enclosing function has returned.

---

**Q39: What is the `any` type in Go?**
**Answer:** `any` is an alias for `interface{}` introduced in Go 1.18 to improve readability. An `interface{}` (or `any`) variable can hold a value of any type, since every type in Go satisfies the empty interface. It is used when you need a container for values of unknown or mixed types, such as in generic utility functions, JSON unmarshalling, or when interfacing with APIs that were written before generics existed. Working with `any` values requires type assertions or type switches to recover the concrete type. Overuse of `any` sacrifices type safety, so prefer concrete types or generics where possible.
**Code Example:**
```go
func printAnything(v any) {
    switch t := v.(type) {
    case int:
        fmt.Println("int:", t)
    case string:
        fmt.Println("string:", t)
    default:
        fmt.Printf("unknown type: %T\n", t)
    }
}

printAnything(42)       // int: 42
printAnything("hello")  // string: hello
printAnything(3.14)     // unknown type: float64
```
**Follow-up:** When were generics added to Go, and does that reduce the need for `any`?
Generics (type parameters) were added in Go 1.18 (March 2022). They reduce but do not eliminate the need for `any` — generic functions can often replace `any`-based code with type-safe alternatives, but `any` remains useful for truly heterogeneous collections and dynamic data.

---

**Q40: How does Go's garbage collector work at a high level?**
**Answer:** Go uses a concurrent, tri-colour mark-and-sweep garbage collector that runs mostly in parallel with the application goroutines, minimising stop-the-world pauses. In the mark phase, the GC traverses the object graph starting from roots (globals, stacks), marking reachable objects white, grey, or black. In the sweep phase, unmarked (white) objects are reclaimed. The Go GC is designed for low latency rather than maximum throughput; stop-the-world pauses are typically under a millisecond. The `GOGC` environment variable (default 100) controls the GC target: it sets the percentage of new allocations relative to live heap at which a GC cycle should trigger. Go's escape analysis decides whether a value is allocated on the stack (cheap, no GC) or the heap (managed by GC).
**Code Example:**
```go
import "runtime"

// Force a GC cycle (rarely needed in production)
runtime.GC()

// Check current heap stats
var m runtime.MemStats
runtime.ReadMemStats(&m)
fmt.Printf("HeapAlloc = %v KB\n", m.HeapAlloc/1024)
```
**Follow-up:** What does `GOGC=off` do?
`GOGC=off` disables the garbage collector entirely. The heap will grow without bound until the program exits. This can be useful for short-lived programs or benchmarks where you want to isolate allocation performance from GC overhead.

---

**Q41: What is the `select` statement in Go?**
**Answer:** `select` is a control structure that waits on multiple channel operations simultaneously and executes the case of whichever operation is ready first. If multiple cases are ready, one is chosen at random. A `default` case makes `select` non-blocking — if no channel is ready, the `default` runs immediately. `select` is the primary mechanism for implementing timeouts (using `time.After`), cancellation (using `context.Done()`), and fan-in patterns (merging multiple channels into one). Without a `default`, `select` blocks until at least one channel operation can proceed, which is how goroutines wait for external events without busy-spinning.
**Code Example:**
```go
ch1 := make(chan string, 1)
ch2 := make(chan string, 1)
ch1 <- "one"

select {
case msg := <-ch1:
    fmt.Println("received from ch1:", msg)
case msg := <-ch2:
    fmt.Println("received from ch2:", msg)
default:
    fmt.Println("no message ready")
}

// Timeout pattern
select {
case res := <-ch1:
    fmt.Println(res)
case <-time.After(1 * time.Second):
    fmt.Println("timed out")
}
```
**Follow-up:** What happens when multiple cases in a `select` are ready at the same time?
Go picks one of the ready cases uniformly at random. This prevents starvation of any particular channel and ensures fairness.

---

**Q42: What are variadic functions in Go?**
**Answer:** A variadic function accepts a variable number of arguments for its final parameter, denoted with `...T`. Inside the function, the variadic parameter is treated as a slice of type `[]T`. You can call a variadic function with any number of arguments (including zero) for that parameter. To pass an existing slice to a variadic parameter, use the spread operator `slice...`. The `fmt.Println`, `fmt.Printf`, and `append` functions are prominent examples of variadic functions in the standard library. Variadic functions are a clean way to create flexible APIs without requiring callers to construct a slice explicitly.
**Code Example:**
```go
func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

fmt.Println(sum(1, 2, 3))       // 6
fmt.Println(sum(10, 20))        // 30

nums := []int{4, 5, 6}
fmt.Println(sum(nums...))       // 15 — spread operator
```
**Follow-up:** Can a variadic parameter appear anywhere other than the last position?
No. A variadic parameter must be the last parameter in a function signature. Only one variadic parameter is allowed per function.

---

**Q43: What is the `range` keyword used for?**
**Answer:** `range` is used in `for` loops to iterate over the elements of various data structures. Over a slice or array, `range` yields the index and value of each element. Over a map, it yields key-value pairs in random order. Over a string, it yields the byte index and Unicode code point (`rune`) of each character (not byte), so it handles multi-byte UTF-8 characters correctly. Over a channel, it reads values until the channel is closed. Either the index/key or value can be discarded with `_`. Using `range` is idiomatic and eliminates off-by-one errors common in manual index-based loops.
**Code Example:**
```go
// Slice
for i, v := range []int{10, 20, 30} {
    fmt.Println(i, v)
}

// Map
scores := map[string]int{"Alice": 95, "Bob": 87}
for name, score := range scores {
    fmt.Println(name, score)
}

// String (iterates runes)
for i, r := range "Go🚀" {
    fmt.Printf("%d: %c\n", i, r)
}

// Channel
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3; close(ch)
for v := range ch {
    fmt.Println(v)
}
```
**Follow-up:** What does `range` return when iterating over a string?
`range` over a string returns the byte index of each Unicode code point and the `rune` (Unicode code point) value. Characters that are more than one byte wide will not have consecutive indices.

---

**Q44: What is a method in Go?**
**Answer:** A method is a function with a special receiver argument that binds it to a particular type. Methods are defined outside the struct declaration but within the same package. The receiver can be a value type (copy) or a pointer type (reference). Value receivers work on a copy of the type, leaving the original unchanged; pointer receivers can modify the original. Only types defined in the same package can have methods added to them — you cannot add methods to built-in types or types from other packages directly (use a type alias or wrapper instead). Methods enable types to satisfy interfaces, which is the foundation of polymorphism in Go.
**Code Example:**
```go
type Rectangle struct{ Width, Height float64 }

// Value receiver — does not modify
func (r Rectangle) Area() float64 {
    return r.Width * r.Height
}

// Pointer receiver — modifies
func (r *Rectangle) Scale(factor float64) {
    r.Width *= factor
    r.Height *= factor
}

rect := Rectangle{4, 3}
fmt.Println(rect.Area()) // 12
rect.Scale(2)
fmt.Println(rect.Area()) // 48
```
**Follow-up:** Can you add methods to a type defined in another package?
No. You can only define methods on types within the same package. To add behaviour to an external type, define a new named type in your package that wraps or aliases the external type.

---

**Q45: How does Go handle concurrency safety for shared data?**
**Answer:** Go offers multiple tools for safe concurrent access to shared data. The `sync.Mutex` provides mutual exclusion — `Lock()` acquires the lock and `Unlock()` (often deferred) releases it. `sync.RWMutex` allows multiple concurrent readers but exclusive write access. `sync.WaitGroup` waits for a collection of goroutines to finish. `sync/atomic` provides lock-free atomic operations for simple numeric types. Channels can also be used to pass ownership of data rather than sharing it, following the Go proverb "share memory by communicating." The race detector (`go run -race` or `go test -race`) detects data races at runtime during testing.
**Code Example:**
```go
import "sync"

type SafeCounter struct {
    mu sync.Mutex
    v  map[string]int
}

func (c *SafeCounter) Inc(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.v[key]++
}

func (c *SafeCounter) Value(key string) int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.v[key]
}
```
**Follow-up:** What is a data race, and how do you detect one in Go?
A data race occurs when two goroutines access the same memory location concurrently and at least one is writing, without synchronisation. Detect races by running your tests or binary with the `-race` flag: `go test -race ./...`.

---

**Q46: What is the `context` package used for?**
**Answer:** The `context` package provides a way to carry deadlines, cancellation signals, and request-scoped values across API boundaries and between goroutines. A `context.Context` is passed as the first argument (by convention named `ctx`) to functions that may block or perform I/O. `context.WithCancel` returns a context and a cancel function; calling cancel signals all goroutines watching `ctx.Done()` to stop. `context.WithTimeout` and `context.WithDeadline` automatically cancel after a duration or at a specific time. Using contexts prevents goroutine leaks by giving goroutines a clean, cooperative shutdown mechanism. Standard library packages like `net/http`, `database/sql`, and `os/exec` all accept contexts.
**Code Example:**
```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()

req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://example.com", nil)
resp, err := http.DefaultClient.Do(req)
if err != nil {
    fmt.Println("request failed:", err) // includes timeout error
    return
}
defer resp.Body.Close()
```
**Follow-up:** Why should `cancel` always be deferred when using `context.WithCancel` or `context.WithTimeout`?
Not calling `cancel` causes a context leak — the parent context holds a reference to the child until it is cancelled or the parent is cancelled. Deferring `cancel` ensures resources are freed even if the function returns early.

---

**Q47: How do you define and use constants in Go?**
**Answer:** Constants are declared with the `const` keyword and must be assigned a value that is computable at compile time — literals, arithmetic on literals, or `iota`. Constants can be typed or untyped; untyped constants have higher precision and can be used in more contexts without explicit conversion. Constants cannot be declared with `:=`. They can be grouped in a `const ( ... )` block. Constants are not addressable (you cannot take their pointer). Unlike variables, constants cannot be modified at runtime. Commonly used for configuration values, enumeration members (with `iota`), and mathematical constants.
**Code Example:**
```go
const Pi = 3.14159265358979 // untyped float constant

const (
    StatusOK    = 200
    StatusNotFound = 404
)

// Typed constant
const MaxRetries int = 3

// Untyped constant adapts to context
var radius float32 = 5.0
area := Pi * radius * radius // Pi used as float32 without cast
fmt.Println(area)
```
**Follow-up:** What is the difference between a typed and an untyped constant?
A typed constant has a fixed type (e.g., `const x int = 5`) and can only be used where that type is accepted. An untyped constant (e.g., `const x = 5`) retains high-precision and adapts its type to the context it is used in, allowing it to be assigned to any compatible numeric type without an explicit conversion.

---

**Q48: What is the `strings` package and what are some common operations?**
**Answer:** The `strings` package provides utility functions for manipulating UTF-8 encoded strings. Key functions include: `strings.Contains(s, substr)` checks for a substring; `strings.HasPrefix` / `strings.HasSuffix` check string boundaries; `strings.Split(s, sep)` splits a string into a slice; `strings.Join(slice, sep)` concatenates a slice with a separator; `strings.TrimSpace` removes leading/trailing whitespace; `strings.ToUpper` / `strings.ToLower` change case; `strings.Replace` / `strings.ReplaceAll` substitute substrings; `strings.Count` counts non-overlapping instances; and `strings.Builder` provides efficient string construction by avoiding repeated allocations. Since strings are immutable in Go, all functions return new strings.
**Code Example:**
```go
s := "  Hello, GoForge!  "

fmt.Println(strings.TrimSpace(s))            // "Hello, GoForge!"
fmt.Println(strings.ToUpper("go"))           // "GO"
fmt.Println(strings.Contains(s, "GoForge")) // true
fmt.Println(strings.Split("a,b,c", ","))    // [a b c]
fmt.Println(strings.Join([]string{"Go", "is", "great"}, " ")) // "Go is great"
fmt.Println(strings.ReplaceAll("aabbaa", "a", "x"))            // "xxbbxx"
```
**Follow-up:** How would you efficiently build a large string in Go?
Use `strings.Builder`: write to it with `WriteString` or `WriteByte`, then call `String()` once. This avoids allocating a new string on every concatenation, which would be O(n²) with `+`.

---

**Q49: What is the `os` package used for in Go?**
**Answer:** The `os` package provides a platform-independent interface to operating system functionality. Common uses include reading environment variables (`os.Getenv`, `os.LookupEnv`), accessing command-line arguments (`os.Args`), working with files and directories (`os.Open`, `os.Create`, `os.MkdirAll`, `os.Remove`), reading and writing to standard I/O (`os.Stdin`, `os.Stdout`, `os.Stderr`), and exiting the program (`os.Exit`). File operations return an `*os.File` which implements `io.Reader` and `io.Writer`. Errors are returned as `*os.PathError` values that include the operation, path, and underlying system error, all checkable with `errors.Is`.
**Code Example:**
```go
// Read environment variable
home := os.Getenv("HOME")
fmt.Println("Home:", home)

// Command-line arguments
fmt.Println("Args:", os.Args)

// Write to a file
f, err := os.Create("/tmp/demo.txt")
if err != nil {
    log.Fatal(err)
}
defer f.Close()
f.WriteString("Hello, GoForge!\n")
```
**Follow-up:** What is the difference between `os.Exit(1)` and returning an error from `main`?
`os.Exit(1)` terminates the process immediately with exit code 1 without running deferred functions. Returning an error from `main` is not valid in Go — instead, you log the error and call `os.Exit`, or use `log.Fatal` which prints the error and calls `os.Exit(1)` internally.

---

**Q50: What is `go vet` and how does it differ from the compiler?**
**Answer:** `go vet` is a static analysis tool bundled with the Go toolchain that examines Go source code for suspicious constructs that are syntactically valid but likely to be bugs. It catches issues the compiler does not, such as incorrect `Printf` format verbs and argument mismatches, unreachable code, misuse of `sync.Mutex` (copying a mutex by value), incorrect use of `atomic` operations, shadowed variables in loops, and malformed struct tags. Unlike the compiler, `go vet` makes no guarantees — it reports likely bugs, not certain ones. It is fast, runs without executing the program, and is commonly integrated into CI pipelines alongside `gofmt` and linters such as `staticcheck` or `golangci-lint`.
**Code Example:**
```bash
go vet ./...
```
```go
// go vet would flag this:
func badPrintf() {
    x := 42
    fmt.Printf("%s", x) // vet error: arg x for verb %s is of wrong type int
}

// go vet would flag this:
var mu sync.Mutex
mu2 := mu // vet error: assignment copies lock value to mu2
```
**Follow-up:** What is `gofmt` and why is it important?
`gofmt` is the canonical Go code formatter that automatically reformats source code to a single, community-wide standard style. Because all Go code looks the same, code reviews focus on logic rather than style, and automated formatters eliminate style debates entirely. Running `gofmt -w .` (or using editor integrations) keeps code consistently formatted.

---

> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.
