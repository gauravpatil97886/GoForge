# Error Patterns in Go

## What Is This?

Error handling in Go is explicit, value-based, and built into the language's function return convention. Instead of exceptions that unwind the stack, Go functions return an `error` interface value alongside their normal results, forcing the caller to decide what to do with it. This creates a discipline where every possible failure is a visible part of the API contract.

## Why Does It Exist?

Exception-based languages (Java, Python, C#) allow errors to propagate silently up the call stack — a function throws, the caller doesn't catch, and a handler ten layers up deals with it (or crashes). This makes it easy to miss error cases and hard to reason about what can fail at each layer. Go's designers — Rob Pike, Ken Thompson, Robert Griesemer — came from C and Unix, where return codes are the norm. They made errors first-class values so that you cannot ignore them without explicitly discarding them. The compiler forces you to deal with the `error` return. Ten years of production Go at Google proved this model scales: when you read Go code, you see exactly where failures originate and how they're handled.

## Who Uses This in Industry?

- **Google**: All internal Go services at Google (serving billions of requests/day) use sentinel errors and wrapped errors for their RPC/gRPC layers. The `google.golang.org/grpc` package defines typed error statuses that wrap gRPC status codes, allowing callers to use `errors.As()` to extract HTTP status equivalents.
- **Uber**: Uber's Go microservices use the `github.com/uber-go/multierr` package for parallel operations where multiple goroutines can fail simultaneously — collecting all errors into one value rather than short-circuiting on the first.
- **Kubernetes**: Kubernetes extensively uses typed errors (`k8s.io/apimachinery/pkg/api/errors`) — `IsNotFound(err)`, `IsConflict(err)` — allowing controllers to respond differently to "resource missing" vs "resource version conflict" without string matching.
- **Cloudflare**: Their DNS and reverse proxy infrastructure uses error wrapping to add context at each layer — a DNS resolution failure arrives at the HTTP handler with the full chain: `"serve dns: resolve upstream: dial tcp: connect: connection refused"`.
- **Docker / containerd**: The containerd runtime uses typed error sentinels so the daemon can distinguish "container not found" from "permission denied" from "image pull failed" and return the correct HTTP status code to the Docker CLI.

## Industry Standards & Best Practices

**What senior Go engineers do:**
- Define package-level sentinel errors for errors callers need to branch on: `var ErrNotFound = errors.New("not found")`
- Wrap errors with context at each layer using `fmt.Errorf("operation: %w", err)` — never strip context by returning `err` raw from deep in a stack
- Use `errors.Is()` for sentinel comparison — never `err == ErrFoo` (breaks with wrapping)
- Use `errors.As()` for type assertion — never `err.(*MyError)` (breaks with wrapping)
- Follow the "handle or return, never both" rule — either log+handle an error OR return it, not both
- Add stack traces only at the top of the application boundary (HTTP handler, main) — not at every layer
- Define error types in the same package that produces them

**What beginners do:**
- Check errors with `if err != nil { log.Fatal(err) }` everywhere — mixing logging with propagation
- Return `errors.New("something went wrong")` with no context — useless in production logs
- Compare errors with `==` which breaks when errors are wrapped
- Panic on errors that are actually recoverable
- Swallow errors with `_ = someFunc()` without understanding consequences
- Create error strings starting with capital letters (Go convention: lowercase, no punctuation)

## Why Go's Approach Is Unique

Go treats errors as values — they are just structs implementing the `error` interface (`Error() string`). This is fundamentally different from every other mainstream language:

| Aspect | Go | Java | Python | Node.js |
|--------|----|----|--------|---------|
| Mechanism | Return value | throws/try-catch | raise/try-except | throw/try-catch + callbacks |
| Visibility | Compiler-enforced | Optional catch | Optional catch | Optional .catch() |
| Stack unwinding | Never (unless panic) | Always | Always | Always |
| Overhead | Zero (value comparison) | JVM exception machinery | Stack trace creation | V8 exception machinery |
| Wrapping standard | errors.Is/As (1.13+) | getCause() chain | `__cause__` chain | `cause` property (ES2022) |
| Multiple errors | multierr / []error (1.20+) | Multi-catch | ExceptionGroup (3.11+) | AggregateError |

Go's tradeoff: more verbose at the call site (every `if err != nil` block), but zero surprise — a function's failure modes are part of its signature, not hidden in documentation. This is why Go code at Google is famously readable: the error handling is explicit, not hidden in exception hierarchies.

---

## Part 1: Basic Error Handling — The Foundations

### Why explicit errors beat exceptions for systems programming

In a web server handling 100,000 requests/second, an uncaught exception in Java or Python creates a full stack trace object, unwinds frames, and may crash goroutines if not handled at the right level. In Go, an error is just a pointer to a struct. The overhead is a nil check. For Google's internal services handling millions of RPCs per second, this difference is measurable.

```go
package main

import (
	"errors"
	"fmt"
	"os"
)

// THE BASIC PATTERN: errors are return values, checked explicitly
// The error interface has exactly one method: Error() string
// Any type implementing it is an error.

// --- Example 1: Basic error return and checking ---

func divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, errors.New("division by zero")
	}
	return a / b, nil
}

func main() {
	result, err := divide(10, 2)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("10 / 2 = %.2f\n", result) // 10 / 2 = 5.00

	_, err = divide(5, 0)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err) // error: division by zero
	}
}
```

**Common pitfall**: Error strings should be lowercase with no trailing punctuation. The calling code may wrap the error: `fmt.Errorf("math operation: %w", err)` produces `"math operation: division by zero"` — if the inner error started with a capital, it reads oddly mid-sentence.

---

## Part 2: Sentinel Errors — Named Package-Level Errors

### Why sentinel errors exist

Some callers need to behave differently based on the TYPE of error, not just whether an error occurred. A file cache might retry on "not found" but immediately fail on "permission denied". Sentinel errors give callers a stable, named value to compare against — part of the package's public API.

```go
package store

import (
	"errors"
	"fmt"
)

// --- Example 2: Sentinel errors ---
// Convention: Err prefix, exported if callers need to check them

var (
	// ErrNotFound is returned when a requested record does not exist.
	ErrNotFound = errors.New("not found")

	// ErrAlreadyExists is returned when creating a record that already exists.
	ErrAlreadyExists = errors.New("already exists")

	// ErrInvalidInput is returned when input fails validation.
	ErrInvalidInput = errors.New("invalid input")
)

type UserStore struct {
	data map[string]string
}

func NewUserStore() *UserStore {
	return &UserStore{data: make(map[string]string)}
}

func (s *UserStore) Get(id string) (string, error) {
	val, ok := s.data[id]
	if !ok {
		return "", fmt.Errorf("user %q: %w", id, ErrNotFound)
	}
	return val, nil
}

func (s *UserStore) Create(id, name string) error {
	if id == "" || name == "" {
		return fmt.Errorf("id and name required: %w", ErrInvalidInput)
	}
	if _, ok := s.data[id]; ok {
		return fmt.Errorf("user %q: %w", id, ErrAlreadyExists)
	}
	s.data[id] = name
	return nil
}
```

```go
package main

import (
	"errors"
	"fmt"
	"log"

	"yourmodule/store" // hypothetical import
)

func main() {
	s := store.NewUserStore()

	// Create a user
	if err := s.Create("u1", "Alice"); err != nil {
		log.Fatal(err)
	}

	// --- CORRECT: use errors.Is() to check sentinel errors ---
	// errors.Is() unwraps the chain — it works even when wrapped with %w
	_, err := s.Get("u999")
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			fmt.Println("user not found, will create default") // handles gracefully
		} else {
			log.Fatal(err) // unexpected error, abort
		}
	}

	// --- WRONG: direct comparison breaks with wrapping ---
	// if err == store.ErrNotFound { ... }  // NEVER do this
	// The wrapped error "user \"u999\": not found" is NOT == ErrNotFound
	// errors.Is() traverses the Unwrap() chain correctly

	// Duplicate creation
	err = s.Create("u1", "Bob")
	if errors.Is(err, store.ErrAlreadyExists) {
		fmt.Println("user already exists, skipping") // graceful handling
	}
}
```

---

## Part 3: Custom Error Types — Structured Error Information

### Why custom error types

Sentinel errors tell you WHAT happened. Custom error types tell you WHAT and WITH WHAT CONTEXT in a structured, machine-readable way. A validation system needs to report which field failed and why — you can't express that in a simple `errors.New()`.

```go
package main

import (
	"errors"
	"fmt"
	"strings"
)

// --- Example 3: Custom error type ---
// Implement the error interface: just needs Error() string

type ValidationError struct {
	Field   string
	Value   interface{}
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("validation error: field %q value %v: %s", e.Field, e.Value, e.Message)
}

// --- Example 4: Error type with underlying cause ---

type QueryError struct {
	Query string
	Err   error // wrapped cause
}

func (e *QueryError) Error() string {
	return fmt.Sprintf("query %q failed: %v", e.Query, e.Err)
}

// Unwrap allows errors.Is() and errors.As() to traverse the chain
func (e *QueryError) Unwrap() error {
	return e.Err
}

// --- Example 5: Multiple field validation ---

type MultiValidationError struct {
	Errors []*ValidationError
}

func (e *MultiValidationError) Error() string {
	msgs := make([]string, len(e.Errors))
	for i, ve := range e.Errors {
		msgs[i] = ve.Error()
	}
	return strings.Join(msgs, "; ")
}

func validateAge(age int) error {
	if age < 0 {
		return &ValidationError{Field: "age", Value: age, Message: "must be non-negative"}
	}
	if age > 150 {
		return &ValidationError{Field: "age", Value: age, Message: "must be <= 150"}
	}
	return nil
}

func validateEmail(email string) error {
	if !strings.Contains(email, "@") {
		return &ValidationError{Field: "email", Value: email, Message: "must contain @"}
	}
	return nil
}

type CreateUserRequest struct {
	Email string
	Age   int
}

func validateUser(req CreateUserRequest) error {
	var errs []*ValidationError

	if err := validateAge(req.Age); err != nil {
		var ve *ValidationError
		if errors.As(err, &ve) {
			errs = append(errs, ve)
		}
	}

	if err := validateEmail(req.Email); err != nil {
		var ve *ValidationError
		if errors.As(err, &ve) {
			errs = append(errs, ve)
		}
	}

	if len(errs) > 0 {
		return &MultiValidationError{Errors: errs}
	}
	return nil
}

func main() {
	// --- errors.As() extracts concrete types from wrapped chains ---
	req := CreateUserRequest{Email: "notanemail", Age: -5}
	err := validateUser(req)

	if err != nil {
		// Check if it's a multi-validation error
		var mve *MultiValidationError
		if errors.As(err, &mve) {
			fmt.Printf("Found %d validation errors:\n", len(mve.Errors))
			for _, ve := range mve.Errors {
				fmt.Printf("  - %s: %s\n", ve.Field, ve.Message)
			}
		}
	}

	// --- errors.As() traverses wrapping ---
	dbErr := &QueryError{
		Query: "SELECT * FROM users",
		Err:   &ValidationError{Field: "id", Value: "", Message: "cannot be empty"},
	}

	var ve *ValidationError
	if errors.As(dbErr, &ve) {
		// Found! errors.As walked through QueryError.Unwrap() -> ValidationError
		fmt.Printf("Underlying validation issue: field=%s msg=%s\n", ve.Field, ve.Message)
	}
}
```

---

## Part 4: Error Wrapping (Go 1.13+) — Adding Context

### Why wrapping: the layered context problem

When a database error bubbles up to an HTTP handler, the original error message `"connection refused"` is useless without knowing WHAT operation was attempted, on WHICH resource. Error wrapping adds a message layer at each boundary without losing the original error. The caller can still use `errors.Is()` and `errors.As()` on the wrapped chain.

```go
package main

import (
	"errors"
	"fmt"
	"os"
)

// Simulated sentinel errors
var (
	ErrNotFound   = errors.New("not found")
	ErrPermission = errors.New("permission denied")
)

// --- Example 6: Building a context chain with %w ---

func readConfig(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		// Wrap with %w — preserves the original error for Is/As inspection
		// The message chain will be: "read config: open /etc/app.conf: no such file or directory"
		return nil, fmt.Errorf("read config %q: %w", path, err)
	}
	return data, nil
}

func loadAppConfig(configPath string) (map[string]string, error) {
	data, err := readConfig(configPath)
	if err != nil {
		// Add another layer of context
		return nil, fmt.Errorf("load app config: %w", err)
	}
	// parse config...
	_ = data
	return map[string]string{}, nil
}

func initApp(configPath string) error {
	_, err := loadAppConfig(configPath)
	if err != nil {
		return fmt.Errorf("init app: %w", err)
	}
	return nil
}

// --- Example 7: errors.Is on wrapped chain ---

func lookupUser(id string) error {
	// Simulate: DB returns not found, we wrap it
	if id == "" {
		return fmt.Errorf("lookup user: %w", ErrNotFound)
	}
	return nil
}

func getProfile(userID string) error {
	if err := lookupUser(userID); err != nil {
		return fmt.Errorf("get profile: %w", err)
	}
	return nil
}

func handleRequest(userID string) error {
	if err := getProfile(userID); err != nil {
		return fmt.Errorf("handle request: %w", err)
	}
	return nil
}

func main() {
	// Chain: init app -> load app config -> read config -> os.ReadFile
	err := initApp("/nonexistent/config.toml")
	if err != nil {
		// Full message shows the entire operation chain
		fmt.Println(err)
		// Output: init app: load app config: read config "/nonexistent/config.toml":
		//         open /nonexistent/config.toml: no such file or directory

		// But we can still check what the root cause was
		if errors.Is(err, os.ErrNotExist) {
			fmt.Println("config file missing, using defaults")
		}
	}

	// --- Wrapping sentinel errors ---
	err = handleRequest("") // empty ID triggers ErrNotFound
	fmt.Println(err)         // handle request: get profile: lookup user: not found

	// errors.Is traverses the entire wrap chain
	if errors.Is(err, ErrNotFound) {
		fmt.Println("resource not found — return 404")
	}

	// --- WRONG: never use %v for wrapping — it loses the chain ---
	// return fmt.Errorf("context: %v", err)  // BROKEN: Is/As won't work
	// Always use %w when you want the chain preserved
}
```

**The %w vs %v distinction is critical:**
- `fmt.Errorf("ctx: %w", err)` — wraps: `errors.Is/As` work on the chain
- `fmt.Errorf("ctx: %v", err)` — formats as string: chain is LOST, `errors.Is/As` fail

---

## Part 5: Early Return and Guard Clauses

### Why early return: the "arrow of death" problem

Deep nesting — `if err == nil { if result != nil { if data.Valid { ... } } }` — is called the "arrow of death" or "pyramid of doom." It hides the happy path deep in indentation and makes error handling easy to skip. Go's idiom is the opposite: check the error condition first, return early, and let the happy path be the unindented code that reaches the end of the function.

```go
package main

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

var ErrInvalidInput = errors.New("invalid input")

// --- Example 8: Arrow of death (BAD) ---

func processOrderBad(input string) (string, error) {
	if input != "" {
		parts := strings.Split(input, ",")
		if len(parts) == 2 {
			id, err := strconv.Atoi(parts[0])
			if err == nil {
				amount, err := strconv.ParseFloat(parts[1], 64)
				if err == nil {
					if amount > 0 {
						return fmt.Sprintf("order %d: $%.2f", id, amount), nil
					} else {
						return "", fmt.Errorf("amount must be positive: %w", ErrInvalidInput)
					}
				} else {
					return "", fmt.Errorf("parse amount: %w", err)
				}
			} else {
				return "", fmt.Errorf("parse id: %w", err)
			}
		} else {
			return "", fmt.Errorf("expected 2 fields: %w", ErrInvalidInput)
		}
	} else {
		return "", fmt.Errorf("empty input: %w", ErrInvalidInput)
	}
}

// --- Example 9: Guard clauses (GOOD) ---
// Each guard clause handles ONE error condition and returns.
// The happy path is at the bottom, unindented, easy to find.

func processOrder(input string) (string, error) {
	// Guard: empty input
	if input == "" {
		return "", fmt.Errorf("process order: empty input: %w", ErrInvalidInput)
	}

	// Guard: wrong number of fields
	parts := strings.Split(input, ",")
	if len(parts) != 2 {
		return "", fmt.Errorf("process order: expected 2 fields, got %d: %w", len(parts), ErrInvalidInput)
	}

	// Guard: invalid id
	id, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return "", fmt.Errorf("process order: parse id %q: %w", parts[0], err)
	}

	// Guard: invalid amount
	amount, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err != nil {
		return "", fmt.Errorf("process order: parse amount %q: %w", parts[1], err)
	}

	// Guard: business rule
	if amount <= 0 {
		return "", fmt.Errorf("process order: amount must be positive, got %.2f: %w", amount, ErrInvalidInput)
	}

	// Happy path — reached only if everything is valid
	return fmt.Sprintf("order %d: $%.2f", id, amount), nil
}

// --- Example 10: The "handle or return, never both" rule ---

func fetchAndSave(id string) error {
	data, err := fetchFromDB(id)
	if err != nil {
		// WRONG — logs AND returns. The caller will also log. Double logging pollutes logs.
		// log.Printf("error fetching: %v", err)
		// return fmt.Errorf("fetch and save: %w", err)

		// CORRECT — just return with context. The boundary (HTTP handler / main) logs.
		return fmt.Errorf("fetch and save: %w", err)
	}

	if err := saveToCache(data); err != nil {
		// CORRECT — return with context, let the boundary decide whether to log
		return fmt.Errorf("fetch and save: cache %q: %w", id, err)
	}

	return nil
}

// stub functions for compilation
func fetchFromDB(id string) (string, error) { return "data", nil }
func saveToCache(data string) error          { return nil }

func main() {
	result, err := processOrder("42, 19.99")
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Println(result) // order 42: $19.99

	_, err = processOrder("")
	fmt.Println(err) // process order: empty input: invalid input

	_, err = processOrder("abc,19.99")
	fmt.Println(err) // process order: parse id "abc": strconv.Atoi: ...
}
```

---

## Part 6: When to Panic vs Return Error

### The fundamental rule

Panic is for programmer errors — conditions that should never happen if the code is correct. Errors are for runtime conditions — I/O failures, invalid user input, network timeouts. The distinction: can you recover from this at runtime? If yes, return error. If no (and it means the program is broken), panic.

```go
package main

import (
	"errors"
	"fmt"
)

// --- Example 11: panic for programmer errors ---

// Stack is a LIFO data structure. Pop() on an empty stack is a programmer error —
// the caller should always check IsEmpty() before calling Pop().
type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(item T) {
	s.items = append(s.items, item)
}

func (s *Stack[T]) IsEmpty() bool {
	return len(s.items) == 0
}

// Pop panics because calling it on an empty stack is a BUG in the caller's code.
// It's not a runtime error — it's a programming mistake.
func (s *Stack[T]) Pop() T {
	if s.IsEmpty() {
		// This should never happen if the caller checks IsEmpty() first.
		// panic() here is correct — it will surface as a goroutine crash
		// with a clear message during development.
		panic("stack.Pop: called on empty stack")
	}
	n := len(s.items) - 1
	item := s.items[n]
	s.items = s.items[:n]
	return item
}

// --- Example 12: Must() pattern for initialization ---
// Libraries often provide Must* wrappers for init-time operations where
// failure is a programming error (e.g., bad regex, bad template).

func Must[T any](val T, err error) T {
	if err != nil {
		panic(err)
	}
	return val
}

// --- Example 13: recover() at boundaries ---
// If you use panic internally, recover() at the goroutine boundary
// to convert to an error that callers can handle.

var ErrPanic = errors.New("recovered from panic")

func safeExecute(fn func()) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("safeExecute recovered: %v: %w", r, ErrPanic)
		}
	}()
	fn()
	return nil
}

// --- Example 14: Package init() — panic is acceptable ---
// init() runs before main, at program startup. If initialization fails,
// it's correct to panic — the program cannot run in a broken state.

var globalConfig map[string]string

func init() {
	// If this fails, the binary itself is misconfigured — panic is correct.
	cfg, err := loadConfig()
	if err != nil {
		panic(fmt.Sprintf("fatal: cannot load config at startup: %v", err))
	}
	globalConfig = cfg
}

func loadConfig() (map[string]string, error) {
	return map[string]string{"env": "dev"}, nil
}

func main() {
	// Must pattern for regex/template compilation at startup
	// import "regexp"
	// re := Must(regexp.Compile(`^\d{4}-\d{2}-\d{2}$`))
	// If the regex is wrong, it's a programmer error — panic at startup is fine.

	// Safe execution of potentially panicking code
	err := safeExecute(func() {
		s := &Stack[int]{}
		s.Push(1)
		_ = s.Pop()
		_ = s.Pop() // This panics — safeExecute recovers it
	})
	if err != nil {
		fmt.Println("Caught:", err)
		if errors.Is(err, ErrPanic) {
			fmt.Println("Was a panic recovery")
		}
	}
}
```

**The rules:**
1. Panic at initialization time for unrecoverable misconfiguration
2. Panic for impossible states (programmer bugs, violated invariants)
3. Return error for everything that can happen at runtime (I/O, user input, network)
4. Never panic in a library exported function — always return error
5. If you use `recover()`, always wrap in `fmt.Errorf` — don't lose the panic message

---

## Part 7: Package-Level Errors vs Inline Errors

### When to define package-level sentinels

Define a package-level sentinel when callers in other packages need to check for that specific error by identity. Create inline errors (with `errors.New` inside the function) for errors that are only informational and callers won't branch on.

```go
package userservice

import (
	"errors"
	"fmt"
)

// --- Package-level: callers WILL check these ---
// These are part of the package's PUBLIC CONTRACT.
var (
	ErrUserNotFound      = errors.New("user not found")
	ErrUserDeactivated   = errors.New("user is deactivated")
	ErrUsernameConflict  = errors.New("username already taken")
	ErrInvalidCredential = errors.New("invalid credential")
)

type User struct {
	ID       string
	Username string
	Active   bool
}

type Service struct {
	store map[string]*User
}

func NewService() *Service {
	return &Service{store: make(map[string]*User)}
}

func (s *Service) FindByID(id string) (*User, error) {
	u, ok := s.store[id]
	if !ok {
		// Wrap with context — caller still uses errors.Is(err, ErrUserNotFound)
		return nil, fmt.Errorf("FindByID %q: %w", id, ErrUserNotFound)
	}
	if !u.Active {
		return nil, fmt.Errorf("FindByID %q: %w", id, ErrUserDeactivated)
	}
	return u, nil
}

func (s *Service) Register(id, username string) error {
	for _, u := range s.store {
		if u.Username == username {
			return fmt.Errorf("Register: %w", ErrUsernameConflict)
		}
	}
	s.store[id] = &User{ID: id, Username: username, Active: true}
	return nil
}

// --- Inline errors: only informational, callers won't branch on them ---
// The HTTP handler just needs to log and return 500 — no branching needed.

func (s *Service) complexOperation(id string) error {
	if len(s.store) > 1000 {
		// No caller will do: if errors.Is(err, ErrStoreFull) — this is just info
		return errors.New("store capacity exceeded during complex operation")
	}
	return nil
}
```

```go
// Handler layer — shows HOW callers branch on package sentinels

package main

import (
	"errors"
	"fmt"
	"net/http"

	"yourmodule/userservice"
)

func handleGetUser(svc *userservice.Service, w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	user, err := svc.FindByID(id)
	if err != nil {
		// Branch on WHAT failed — different HTTP responses for different errors
		switch {
		case errors.Is(err, userservice.ErrUserNotFound):
			http.Error(w, "user not found", http.StatusNotFound)    // 404
		case errors.Is(err, userservice.ErrUserDeactivated):
			http.Error(w, "account deactivated", http.StatusForbidden) // 403
		default:
			http.Error(w, "internal error", http.StatusInternalServerError) // 500
		}
		return
	}
	fmt.Fprintf(w, "user: %s\n", user.Username)
}
```

---

## Part 8: Error Logging vs Error Propagation

### The single responsibility principle for errors

Each error should be handled ONCE. Either the function handles it (logs it, falls back to a default, retries) OR it propagates it up. Doing both creates log storms — the same error appears 5 times at different layers, making debugging a nightmare.

```go
package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
)

var ErrDatabaseDown = errors.New("database unavailable")

// --- Example 15: The logging boundary pattern ---

// Low-level function: propagates, never logs
func queryDatabase(query string) (string, error) {
	// Simulate DB failure
	return "", fmt.Errorf("query %q: %w", query, ErrDatabaseDown)
}

// Mid-level function: propagates with added context, never logs
func getUserData(userID string) (string, error) {
	data, err := queryDatabase(fmt.Sprintf("SELECT * FROM users WHERE id = %q", userID))
	if err != nil {
		return "", fmt.Errorf("getUserData %q: %w", userID, err)
	}
	return data, nil
}

// Business logic: may decide to handle (use fallback) OR propagate
// It never does BOTH.
func getProfileForDisplay(userID string) (string, error) {
	data, err := getUserData(userID)
	if err != nil {
		if errors.Is(err, ErrDatabaseDown) {
			// HANDLE: database down is a known recoverable case — use cached data
			// Do NOT also return err. We're handling it here.
			slog.Warn("database unavailable, using cached profile",
				"userID", userID,
				"error", err,
			)
			return "cached_profile_data", nil // fallback — error is HANDLED here
		}
		// For unknown errors, propagate — don't log
		return "", fmt.Errorf("getProfileForDisplay: %w", err)
	}
	return data, nil
}

// Top boundary: HTTP handler / main — the ONLY place that logs unhandled errors
func handleProfile(userID string) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	profile, err := getProfileForDisplay(userID)
	if err != nil {
		// This is the boundary — log it HERE, not in every layer below
		logger.Error("failed to get profile",
			"userID", userID,
			"error", err,
		)
		return
	}
	fmt.Printf("Profile for %s: %s\n", userID, profile)
}

func main() {
	// Database is down — getProfileForDisplay handles it with fallback
	handleProfile("user-123")
	// Output: JSON log at WARN level, then "Profile for user-123: cached_profile_data"
}
```

---

## Part 9: Functional Error Handling — The Result Type Pattern

### Why: reducing if-err-!=-nil repetition in pipelines

When you have a sequence of operations where each depends on the previous succeeding, the `if err != nil` checks become repetitive. The Result type pattern (borrowed from Rust's `Result<T, E>` and Haskell's `Either`) wraps a value+error together, allowing you to chain operations that short-circuit on the first error.

```go
package main

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// --- Example 16: Result type ---

type Result[T any] struct {
	value T
	err   error
}

// Ok wraps a successful value
func Ok[T any](value T) Result[T] {
	return Result[T]{value: value}
}

// Err wraps an error
func Err[T any](err error) Result[T] {
	return Result[T]{err: err}
}

// Unwrap returns value and error (use when you want to check)
func (r Result[T]) Unwrap() (T, error) {
	return r.value, r.err
}

// IsOk returns true if no error
func (r Result[T]) IsOk() bool {
	return r.err == nil
}

// IsErr returns true if there is an error
func (r Result[T]) IsErr() bool {
	return r.err != nil
}

// Map applies f to the value if Ok, short-circuits on Err
func Map[T, U any](r Result[T], f func(T) (U, error)) Result[U] {
	if r.err != nil {
		return Err[U](r.err)
	}
	val, err := f(r.value)
	if err != nil {
		return Err[U](err)
	}
	return Ok(val)
}

// --- Example 17: Using Result in a parsing pipeline ---

type OrderRequest struct {
	ID     int
	Amount float64
	Items  []string
}

func parseID(raw string) Result[int] {
	id, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return Err[int](fmt.Errorf("parse id %q: %w", raw, err))
	}
	if id <= 0 {
		return Err[int](fmt.Errorf("id must be positive, got %d", id))
	}
	return Ok(id)
}

func parseAmount(raw string) Result[float64] {
	amount, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return Err[float64](fmt.Errorf("parse amount %q: %w", raw, err))
	}
	if amount <= 0 {
		return Err[float64](fmt.Errorf("amount must be positive, got %.2f", amount))
	}
	return Ok(amount)
}

func parseItems(raw string) Result[[]string] {
	if raw == "" {
		return Err[[]string](errors.New("items cannot be empty"))
	}
	items := strings.Split(raw, "|")
	for i, item := range items {
		items[i] = strings.TrimSpace(item)
	}
	return Ok(items)
}

// The traditional way — lots of if err != nil
func parseOrderTraditional(idStr, amountStr, itemsStr string) (*OrderRequest, error) {
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return nil, fmt.Errorf("parse id: %w", err)
	}
	amount, err := strconv.ParseFloat(amountStr, 64)
	if err != nil {
		return nil, fmt.Errorf("parse amount: %w", err)
	}
	items := strings.Split(itemsStr, "|")
	return &OrderRequest{ID: id, Amount: amount, Items: items}, nil
}

// The Result type way — pipeline with automatic short-circuit
func parseOrderResult(idStr, amountStr, itemsStr string) (*OrderRequest, error) {
	idResult := parseID(idStr)
	amountResult := parseAmount(amountStr)
	itemsResult := parseItems(itemsStr)

	id, err := idResult.Unwrap()
	if err != nil {
		return nil, err
	}
	amount, err := amountResult.Unwrap()
	if err != nil {
		return nil, err
	}
	items, err := itemsResult.Unwrap()
	if err != nil {
		return nil, err
	}

	return &OrderRequest{ID: id, Amount: amount, Items: items}, nil
}

// --- Example 18: errWriter pattern (Dave Cheney's approach) ---
// For when you have many sequential writes that can each fail.

type errWriter struct {
	w   strings.Builder
	err error
}

func (ew *errWriter) write(format string, args ...interface{}) {
	if ew.err != nil {
		return // short-circuit: first error sticks
	}
	_, ew.err = fmt.Fprintf(&ew.w, format, args...)
}

func buildReport(name string, items []string, total float64) (string, error) {
	ew := &errWriter{}
	ew.write("=== Report for %s ===\n", name)
	ew.write("Items: %d\n", len(items))
	for i, item := range items {
		ew.write("  %d. %s\n", i+1, item)
	}
	ew.write("Total: $%.2f\n", total)
	ew.write("===================\n")

	if ew.err != nil {
		return "", fmt.Errorf("build report: %w", ew.err)
	}
	return ew.w.String(), nil
}

func main() {
	// Result pattern
	order, err := parseOrderResult("42", "19.99", "widget | gadget | doohickey")
	if err != nil {
		fmt.Println("Error:", err)
	} else {
		fmt.Printf("Order: ID=%d Amount=%.2f Items=%v\n", order.ID, order.Amount, order.Items)
	}

	// Error case
	_, err = parseOrderResult("-5", "not-a-number", "")
	fmt.Println("Parse error:", err) // reports the FIRST failure

	// errWriter pattern
	report, err := buildReport("Q4 Sales", []string{"Laptop", "Phone", "Tablet"}, 2999.97)
	if err != nil {
		fmt.Println("Report error:", err)
	} else {
		fmt.Print(report)
	}
}
```

---

## Summary: The Error Handling Checklist

```
Error creation:
  [ ] Lowercase message, no trailing punctuation
  [ ] Package-level sentinel for errors callers need to branch on
  [ ] Custom type (with Unwrap()) when callers need structured data
  [ ] Wrap with %w to preserve chain for Is/As

Error checking:
  [ ] errors.Is() for sentinel comparison (never ==)
  [ ] errors.As() for type extraction (never type assertion)
  [ ] Guard clauses for early return — never deep nesting

Error propagation:
  [ ] Add context at each boundary: fmt.Errorf("operation: %w", err)
  [ ] Never strip context by returning err raw from deep layers
  [ ] Handle OR return — never both (no log + return)
  [ ] Log only at the top boundary (HTTP handler, main)

Panic vs error:
  [ ] panic() for programmer bugs and invariant violations
  [ ] panic() at init() for fatal misconfiguration
  [ ] Must() pattern for startup-time resource acquisition
  [ ] Return error for everything that can fail at runtime
  [ ] Never panic in exported library functions
```
