# Context Package in Go

## What Is This?

`context.Context` is Go's standard mechanism for carrying a cancellation signal, a deadline, and a small bag of request-scoped values through a chain of function calls — across goroutines, across network boundaries, and across library APIs. Every function that does I/O (HTTP, database, gRPC, file) accepts a context as its first argument and stops working when that context is cancelled. Think of it as a lightweight "request handle" that every layer of your program can read and that any layer can cancel.

## Why Does It Exist?

Before the `context` package (Go 1.7, 2016), there was no standard way to tell a goroutine "the client disconnected — stop what you are doing." Teams invented their own cancellation channels, passed deadline structs through function arguments, or stored them in global variables. The results were incompatible, hard to compose, and prone to goroutine leaks. The deeper design problem: a single HTTP request might spawn a database query, which spawns a cache lookup, which spawns a background goroutine — and none of those layers knew the request had been cancelled. The `context` package creates a tree of cancellation nodes. When a parent node is cancelled, every child is cancelled automatically and immediately, propagating the signal through arbitrary call depth without any layer having to know about the layers above or below it.

## Who Uses This in Industry?

- **Google**: Every internal RPC at Google passes a context. The `context` package was designed by Sameer Ajmani at Google to match how Google's internal `context.Context` (called `gContext`) worked. All BigTable, Spanner, and Cloud Storage client libraries in Go treat context as the primary cancellation and deadline mechanism.
- **Uber**: The `Jaeger` distributed tracing library propagates trace IDs and span IDs through context values. Every cross-service RPC at Uber carries a Jaeger span, injected into context at the entry point and extracted at each service boundary. Without context, trace IDs would have to be passed as explicit function arguments through every layer.
- **Stripe**: Idempotency keys — used to safely retry payment operations — are carried in context through the payment processing pipeline. The key is set at the HTTP handler and read deep in the payment engine without threading it through a dozen function signatures.
- **Kubernetes**: The kubelet, API server, and controller-manager use context extensively for graceful shutdown. When the process receives SIGTERM, a root context is cancelled, which propagates to every in-flight request handler, every watch loop, and every background reconciliation goroutine simultaneously.
- **Cloudflare**: Their Go-based DNS resolver and proxy code use context deadlines to enforce per-request timeouts. A context with a 500ms deadline is created at the edge, and if any upstream fetch (cache, origin, DNS) doesn't complete in time, the whole chain unwinds cleanly.

## Industry Standards & Best Practices

**The law of context (from the Go blog):**
1. Do not store a context in a struct. Pass it as the first parameter to every function that needs it, named `ctx`.
2. Never pass `nil` as a context. If you don't know which context to use, pass `context.TODO()`.
3. Use context values only for request-scoped data — not for optional function parameters.
4. Always call the cancel function returned by `WithCancel`, `WithTimeout`, or `WithDeadline` — typically via `defer cancel()` — or you leak memory.

**What senior engineers do:**
- Define a private key type (`type contextKey string`) to avoid collisions with other packages' context values.
- Create the context at the outermost layer (HTTP handler, CLI entry point, test function) and pass it down.
- Set timeouts at service boundaries, not deep in library code — the caller knows the budget, not the callee.
- Use `ctx.Err()` to distinguish cancellation (`context.Canceled`) from timeout (`context.DeadlineExceeded`) when logging errors.
- In tests, use `context.Background()` directly or `context.WithTimeout(context.Background(), 5*time.Second)` to give tests a hard deadline.

**What beginners get wrong:**
- Storing context in a struct field (`type MyService struct { ctx context.Context }`). This freezes the context at construction time; the service can never participate in per-request cancellation.
- Calling `context.Background()` deep inside a library function instead of accepting the context as a parameter — the function becomes impossible to cancel from the outside.
- Forgetting `defer cancel()`, which keeps the context's internal goroutine alive until the parent context is cancelled (a memory leak).
- Using string keys for context values, which leads to collisions between packages.

## Why Go's Approach Is Unique

Java uses `Thread.interrupt()` or `Future.cancel()`, which are tied to a specific thread or task. To cancel a chain of operations, you must propagate the interrupt signal manually through each layer. Python's `asyncio` has `Task.cancel()`, which is better but only works within a single event loop. Node.js has `AbortController` / `AbortSignal`, which is similar in concept but arrived much later and is not universally adopted.

Go's `context.Context` is unique in three ways:
1. **It is an interface**, so any layer can wrap it to add behaviour (middleware adding trace IDs, testing replacing the deadline clock).
2. **The tree structure** means one `cancel()` call propagates to arbitrarily many children with no explicit wiring — you just pass the context down.
3. **It is a first-class convention**: the standard library (`net/http`, `database/sql`, `os/exec`, `net`) and the entire ecosystem treat a `context.Context` first argument as mandatory for I/O operations, so the convention is universal and consistent.

---

## 1. Basic: Context Tree — Background → WithCancel → WithTimeout → WithValue

Every context starts at a root (`context.Background()`) and grows into a tree of derived contexts. Cancelling a node cancels all its descendants. Values are inherited: a child can see values added by its parents.

```go
// file: 07-context/01-tree/main.go
package main

import (
	"context"
	"fmt"
	"time"
)

func main() {
	// Root — never cancelled, never has a deadline, never has values.
	// All contexts ultimately derive from this.
	root := context.Background()
	fmt.Println("root:", root)

	// Level 1: add a cancel function
	cancelCtx, cancel := context.WithCancel(root)
	defer cancel()

	// Level 2: add a timeout (derived from the cancel context)
	// If cancelCtx is cancelled OR 2 seconds pass, timeoutCtx is done
	timeoutCtx, timeoutCancel := context.WithTimeout(cancelCtx, 2*time.Second)
	defer timeoutCancel()

	// Level 3: add a value
	// The key MUST be a non-string type to avoid package collisions (see section 7)
	type requestIDKey struct{}
	valueCtx := context.WithValue(timeoutCtx, requestIDKey{}, "req-abc-123")

	// Values are visible to children; look them up with the same key type
	fmt.Println("request ID:", valueCtx.Value(requestIDKey{}))

	// Check if a context has a deadline
	if deadline, ok := valueCtx.Deadline(); ok {
		fmt.Println("deadline in:", time.Until(deadline).Round(time.Millisecond))
	}

	// Manually cancel the parent — both timeoutCtx and valueCtx are immediately done
	cancel()

	// Give the runtime a moment to propagate
	time.Sleep(time.Millisecond)

	fmt.Println("cancelCtx.Err():", cancelCtx.Err())   // context.Canceled
	fmt.Println("timeoutCtx.Err():", timeoutCtx.Err()) // context.Canceled (not DeadlineExceeded)
	fmt.Println("valueCtx.Err():", valueCtx.Err())     // context.Canceled
}
```

**Key insight:** The cancellation propagates from parent to child, never child to parent. Cancelling `cancelCtx` kills its descendants. Cancelling `timeoutCtx` does NOT cancel `cancelCtx`. This asymmetry is intentional — children cannot affect their parents.

---

## 2. Basic: context.Background() vs context.TODO()

Both return a non-nil, empty context that is never cancelled and has no deadline. The distinction is semantic, not functional.

```go
// file: 07-context/02-background-vs-todo/main.go
package main

import (
	"context"
	"fmt"
)

// Use context.Background() when you are the top-level caller and there
// is no incoming context: main(), TestXxx(), init(), long-running servers.
func startServer() {
	ctx := context.Background()
	// ... pass ctx to all server operations
	fmt.Println("server context:", ctx)
}

// Use context.TODO() as a placeholder when:
//   - You are refactoring a function to accept context and haven't plumbed it yet
//   - The calling code hasn't been updated to pass a context yet
//   - You genuinely don't know which context to use yet
//
// TODO() is a searchable marker — grep for context.TODO() to find
// places that need attention before a production release.
func legacyFunction() error {
	// TODO: accept ctx as a parameter once the caller is updated
	ctx := context.TODO()
	_ = ctx
	return nil
}

func main() {
	startServer()

	// They are functionally identical — the difference is documentation
	bg := context.Background()
	todo := context.TODO()
	fmt.Println("Background == TODO:", bg == todo) // false (different zero values)
	fmt.Println("bg.Err():", bg.Err())             // <nil>
	fmt.Println("todo.Err():", todo.Err())         // <nil>
}
```

**Production rule:** `grep -r 'context.TODO()' ./...` should return zero results before you merge to main. Every `TODO` is a goroutine leak waiting to happen.

---

## 3. Basic: context.WithCancel() — Manual Cancellation

`WithCancel` is the simplest form: you get a context and a function. Call the function and the context (and all its children) are immediately done.

```go
// file: 07-context/03-with-cancel/main.go
// Demonstrates goroutine cancellation — the most common use case.
package main

import (
	"context"
	"fmt"
	"time"
)

// worker runs until ctx is cancelled.
// This is the canonical pattern for all long-running goroutines.
func worker(ctx context.Context, id int) {
	for {
		select {
		case <-ctx.Done():
			// ctx.Err() tells you WHY it was cancelled
			fmt.Printf("worker %d stopping: %v\n", id, ctx.Err())
			return
		case <-time.After(300 * time.Millisecond):
			fmt.Printf("worker %d: doing work...\n", id)
		}
	}
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())

	// ALWAYS defer cancel. Even if you intend to call cancel explicitly,
	// the defer is a safety net against panics or early returns.
	defer cancel()

	// Start 3 workers
	for i := 1; i <= 3; i++ {
		go worker(ctx, i)
	}

	// Let workers run for 1 second
	time.Sleep(time.Second)

	// Cancel all workers simultaneously
	fmt.Println("main: cancelling context")
	cancel()

	// Give workers time to print their shutdown message
	time.Sleep(100 * time.Millisecond)
	fmt.Println("main: all workers stopped")
}
```

**Common pitfall — calling cancel in a goroutine without defer:**

```go
// WRONG: if fetchData panics or returns early, cancel is never called
go func() {
    result := fetchData(ctx) // if this panics, cancel leaks
    cancel()
    process(result)
}()

// RIGHT: always defer
go func() {
    defer cancel()
    result := fetchData(ctx)
    process(result)
}()
```

---

## 4. Intermediate: context.WithTimeout() vs context.WithDeadline()

`WithTimeout(ctx, d)` is syntactic sugar for `WithDeadline(ctx, time.Now().Add(d))`. Use `WithTimeout` when you think in relative terms ("this should take at most 5 seconds"). Use `WithDeadline` when you have an absolute time ("the request must complete before the end of the billing window at 23:59:59").

```go
// file: 07-context/04-timeout-deadline/main.go
package main

import (
	"context"
	"fmt"
	"time"
)

// simulateSlowOperation takes longer than the deadline allows.
func simulateSlowOperation(ctx context.Context, duration time.Duration) error {
	select {
	case <-time.After(duration):
		return nil // completed in time
	case <-ctx.Done():
		return ctx.Err() // cancelled or timed out
	}
}

func main() {
	// --- WithTimeout ---
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err := simulateSlowOperation(ctx, 2*time.Second) // 2s > 500ms timeout
	fmt.Println("WithTimeout error:", err)            // context.DeadlineExceeded

	// --- WithDeadline ---
	deadline := time.Now().Add(500 * time.Millisecond)
	ctx2, cancel2 := context.WithDeadline(context.Background(), deadline)
	defer cancel2()

	err2 := simulateSlowOperation(ctx2, 100*time.Millisecond) // 100ms < 500ms, succeeds
	fmt.Println("WithDeadline error (fast):", err2)            // <nil>

	// --- Distinguishing errors ---
	ctx3, cancel3 := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel3()

	err3 := simulateSlowOperation(ctx3, 1*time.Second)
	switch err3 {
	case context.DeadlineExceeded:
		fmt.Println("timed out — retry with backoff")
	case context.Canceled:
		fmt.Println("cancelled by caller — do not retry")
	case nil:
		fmt.Println("success")
	default:
		fmt.Println("unexpected error:", err3)
	}

	// --- Tightest deadline wins ---
	// If parent has 100ms and child tries to set 500ms, child still gets 100ms
	parent, parentCancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer parentCancel()

	// Child asks for 500ms but will be cancelled when parent's 100ms expires
	child, childCancel := context.WithTimeout(parent, 500*time.Millisecond)
	defer childCancel()

	if d, ok := child.Deadline(); ok {
		fmt.Println("effective deadline:", time.Until(d).Round(time.Millisecond))
		// Will be ~100ms, not 500ms — the shorter deadline wins
	}
}
```

**Production pattern:** Set timeouts at service boundaries, not inside libraries. A database library should accept a context; the service calling it decides the budget:

```go
// In service code (correct):
ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
defer cancel()
rows, err := db.QueryContext(ctx, query)

// In library code (wrong — libraries should not set their own timeouts):
func (r *Repo) GetUser(ctx context.Context, id int) (*User, error) {
    // DO NOT do this — you are overriding the caller's budget
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second) // BAD
    defer cancel()
    ...
}
```

---

## 5. Intermediate: context.WithValue() and the Key Type Pattern

`WithValue` attaches a value to a context. The key must be comparable (usable in a map). Using a `string` key is unsafe: any package that happens to use the same string can accidentally read or shadow your value. The pattern: define a private unexported type in your package and use a value of that type as the key.

```go
// file: 07-context/05-with-value/main.go
package main

import (
	"context"
	"fmt"
)

// --- WRONG: string keys collide across packages ---
func badExample() {
	ctx := context.WithValue(context.Background(), "userID", 42)
	// Any package can read this with context.WithValue(ctx, "userID", ...) — collision risk
	fmt.Println("bad:", ctx.Value("userID"))
}

// --- RIGHT: private key type ---
// Define in the package that owns the value.
// The unexported type means no other package can construct a key of this type.
type contextKey int

const (
	userIDKey contextKey = iota
	traceIDKey
	tenantIDKey
)

// Provide typed accessors — callers never see the key type
func WithUserID(ctx context.Context, id int) context.Context {
	return context.WithValue(ctx, userIDKey, id)
}

func UserID(ctx context.Context) (int, bool) {
	id, ok := ctx.Value(userIDKey).(int)
	return id, ok
}

func WithTraceID(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceIDKey, traceID)
}

func TraceID(ctx context.Context) string {
	if id, ok := ctx.Value(traceIDKey).(string); ok {
		return id
	}
	return ""
}

// Middleware: adds request-scoped values at the HTTP boundary
func requestMiddleware(ctx context.Context, rawUserID int, rawTraceID string) context.Context {
	ctx = WithUserID(ctx, rawUserID)
	ctx = WithTraceID(ctx, rawTraceID)
	return ctx
}

// Deep in business logic: reads values without knowing how they were set
func processOrder(ctx context.Context, orderID string) {
	userID, ok := UserID(ctx)
	if !ok {
		fmt.Println("processOrder: no user ID in context — unauthenticated request")
		return
	}
	traceID := TraceID(ctx)
	fmt.Printf("processOrder: orderID=%s userID=%d traceID=%s\n", orderID, userID, traceID)
}

func main() {
	badExample()

	// Simulate an HTTP request coming in
	ctx := context.Background()
	ctx = requestMiddleware(ctx, 1001, "trace-xyz-789")

	// Pass ctx down the call stack — no function needs to know what's in it
	processOrder(ctx, "order-555")

	// Values are inherited by children
	childCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	fmt.Println("child sees userID:", func() int { id, _ := UserID(childCtx); return id }())
}
```

**What to store in context values:**
- Request trace IDs / span IDs (Jaeger, OpenTelemetry)
- Authenticated user ID / tenant ID
- Request ID for log correlation
- Feature flag overrides for A/B testing
- Database transaction (when using transaction-aware middleware)

**What NOT to store:**
- Optional function parameters (use function arguments)
- Database connections (pass them explicitly)
- Loggers (debated — some teams do it, but it makes testing harder)
- Mutable state (context values should be immutable once set)

---

## 6. Intermediate: Context in HTTP Servers

The `net/http` package gives you a context per request via `r.Context()`. This context is cancelled when the client disconnects, when the handler returns, or when the server shuts down. Always propagate `r.Context()` into every downstream call.

```go
// file: 07-context/06-http-context/main.go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type contextKey int

const requestIDKey contextKey = 0

// requestIDMiddleware adds a request ID to every request's context.
func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		// Attach to the request context, not a global variable
		ctx := context.WithValue(r.Context(), requestIDKey, reqID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// simulateDB queries a "database" — respects context cancellation.
func simulateDB(ctx context.Context, query string) (map[string]string, error) {
	// Simulate a slow query
	select {
	case <-time.After(200 * time.Millisecond):
		return map[string]string{"result": query + "_result"}, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("db query cancelled: %w", ctx.Err())
	}
}

// userHandler handles GET /user — respects client disconnect.
func userHandler(w http.ResponseWriter, r *http.Request) {
	// ALWAYS use r.Context() — never context.Background() in a handler
	ctx := r.Context()

	reqID, _ := ctx.Value(requestIDKey).(string)
	log.Printf("[%s] handling request", reqID)

	// Set a per-handler timeout — the handler knows its budget, not the DB client
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()

	result, err := simulateDB(ctx, "SELECT * FROM users")
	if err != nil {
		// Client disconnected? Budget exceeded?
		switch ctx.Err() {
		case context.DeadlineExceeded:
			http.Error(w, "request timeout", http.StatusGatewayTimeout)
		case context.Canceled:
			// Client disconnected — don't write a response, it will be discarded
			log.Printf("[%s] client disconnected", reqID)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Request-ID", reqID)
	json.NewEncoder(w).Encode(result)
}

// Making outbound HTTP requests with context:
func fetchExternalAPI(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	// If ctx is cancelled while waiting for the response, the request is aborted
	return http.DefaultClient.Do(req)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/user", userHandler)

	handler := requestIDMiddleware(mux)

	server := &http.Server{
		Addr:    ":8080",
		Handler: handler,
	}

	log.Println("server starting on :8080")
	// In production: handle graceful shutdown with context
	// For demo: just log the error
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
```

**Graceful shutdown pattern (critical for production):**

```go
// file: 07-context/06-http-context/shutdown/main.go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	server := &http.Server{Addr: ":8080", Handler: http.DefaultServeMux}

	// Start server in background
	go func() {
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// Wait for OS signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down...")

	// Give in-flight requests 30 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatal("forced shutdown:", err)
	}
	log.Println("server stopped cleanly")
}
```

---

## 7. Intermediate: Context in Database Operations

`database/sql` has had context-aware methods since Go 1.8: `QueryContext`, `ExecContext`, `BeginTx`, `PingContext`. Always use the `Context` variants. The plain methods (`Query`, `Exec`) use `context.Background()` internally — they can never be cancelled.

```go
// file: 07-context/07-database/main.go
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"
	_ "github.com/mattn/go-sqlite3" // import for side effect: registers "sqlite3" driver
)

type UserRepo struct {
	db *sql.DB
}

// GetUser fetches a user, honouring the caller's context.
// If the context is cancelled or times out, the query is aborted.
func (r *UserRepo) GetUser(ctx context.Context, id int) (string, error) {
	var name string
	// QueryRowContext cancels the underlying network call when ctx is done
	err := r.db.QueryRowContext(ctx, "SELECT name FROM users WHERE id = ?", id).Scan(&name)
	if err != nil {
		return "", fmt.Errorf("GetUser(%d): %w", id, err)
	}
	return name, nil
}

// CreateUser inserts a user inside a transaction, honouring the context.
func (r *UserRepo) CreateUser(ctx context.Context, name string) error {
	// BeginTx respects context for the transaction's lifetime
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() // no-op if Commit succeeds

	_, err = tx.ExecContext(ctx, "INSERT INTO users (name) VALUES (?)", name)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}

	return tx.Commit()
}

// BatchProcess processes a list of IDs, stopping early if context is cancelled.
// This is the pattern used in bulk jobs that need to respect shutdown signals.
func (r *UserRepo) BatchProcess(ctx context.Context, ids []int) error {
	for _, id := range ids {
		// Check cancellation before each unit of work
		select {
		case <-ctx.Done():
			return fmt.Errorf("batch cancelled after processing some IDs: %w", ctx.Err())
		default:
		}

		name, err := r.GetUser(ctx, id)
		if err != nil {
			log.Printf("skip id=%d: %v", id, err)
			continue
		}
		fmt.Printf("processed: id=%d name=%s\n", id, name)
	}
	return nil
}

func main() {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Setup
	ctx := context.Background()
	_, err = db.ExecContext(ctx, `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`)
	if err != nil {
		log.Fatal(err)
	}

	repo := &UserRepo{db: db}

	// Create users
	for _, name := range []string{"Alice", "Bob", "Carol"} {
		if err := repo.CreateUser(ctx, name); err != nil {
			log.Printf("create user %s: %v", name, err)
		}
	}

	// Fetch with timeout
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	name, err := repo.GetUser(queryCtx, 1)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("fetched:", name)

	// Batch process with cancellable context
	batchCtx, batchCancel := context.WithCancel(ctx)
	go func() {
		time.Sleep(10 * time.Millisecond)
		batchCancel() // cancel mid-batch to simulate shutdown
	}()

	err = repo.BatchProcess(batchCtx, []int{1, 2, 3})
	fmt.Println("batch result:", err)
}
```

**Why `defer tx.Rollback()` is safe:** If `Commit()` succeeds, `Rollback()` returns `sql.ErrTxDone` which the defer ignores. If anything before `Commit()` fails (including context cancellation), `Rollback()` correctly undoes the partial transaction. This is the universally accepted Go transaction pattern.

---

## 8. Advanced: Checking Cancellation — ctx.Done() and ctx.Err()

`ctx.Done()` returns a channel that is closed when the context is cancelled or times out. `ctx.Err()` returns the reason. Understanding how to use both is essential for writing robust concurrent code.

```go
// file: 07-context/08-done-err/main.go
package main

import (
	"context"
	"fmt"
	"time"
)

// pipeline demonstrates a multi-stage pipeline where each stage
// respects context cancellation.
func generate(ctx context.Context, nums ...int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for _, n := range nums {
			select {
			case out <- n:
			case <-ctx.Done():
				fmt.Println("generate: cancelled")
				return
			}
		}
	}()
	return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			select {
			case out <- n * n:
			case <-ctx.Done():
				fmt.Println("square: cancelled")
				return
			}
		}
	}()
	return out
}

// retryWithContext retries an operation until it succeeds or context expires.
// This is the pattern used in distributed systems for transient failures.
func retryWithContext(ctx context.Context, operation func(context.Context) error) error {
	backoff := 50 * time.Millisecond
	for attempt := 1; ; attempt++ {
		err := operation(ctx)
		if err == nil {
			return nil
		}

		// Check if context is done before sleeping
		select {
		case <-ctx.Done():
			return fmt.Errorf("retry aborted after %d attempts: %w", attempt, ctx.Err())
		default:
		}

		fmt.Printf("attempt %d failed: %v, retrying in %v\n", attempt, err, backoff)

		select {
		case <-time.After(backoff):
			backoff *= 2 // exponential backoff
		case <-ctx.Done():
			return fmt.Errorf("retry aborted during backoff: %w", ctx.Err())
		}
	}
}

func main() {
	// --- Pipeline with cancellation ---
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := generate(ctx, 1, 2, 3, 4, 5)
	out := square(ctx, c)

	// Read only 3 values, then cancel
	for i := 0; i < 3; i++ {
		fmt.Println(<-out)
	}
	cancel() // cancel pipeline — generate and square goroutines exit cleanly
	time.Sleep(10 * time.Millisecond)

	// --- Retry with timeout ---
	fmt.Println("\n--- Retry demo ---")
	attempts := 0
	retryCtx, retryCancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer retryCancel()

	err := retryWithContext(retryCtx, func(ctx context.Context) error {
		attempts++
		if attempts < 5 { // always fail for demo
			return fmt.Errorf("transient error")
		}
		return nil
	})
	fmt.Println("retry result:", err, "| attempts:", attempts)

	// --- ctx.Err() to distinguish cancellation from timeout ---
	fmt.Println("\n--- Error type demo ---")
	timeoutCtx, timeoutCancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer timeoutCancel()
	time.Sleep(50 * time.Millisecond) // exceed timeout
	switch timeoutCtx.Err() {
	case context.DeadlineExceeded:
		fmt.Println("timeout: back off and retry later")
	case context.Canceled:
		fmt.Println("cancelled: do not retry")
	}
}
```

---

## 9. Advanced: Propagating Context — The First Argument Convention

The most important rule in Go's context system: **every function that does I/O, calls another service, or spawns a goroutine must accept `ctx context.Context` as its first argument.** This creates a chain from the outermost request handler all the way down to the TCP write.

```go
// file: 07-context/09-propagation/main.go
package main

import (
	"context"
	"fmt"
	"time"
)

// Layer 3: lowest level — actual I/O (simulated)
func fetchFromCache(ctx context.Context, key string) (string, error) {
	select {
	case <-time.After(10 * time.Millisecond):
		return "cached_" + key, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// Layer 2: business logic — composes lower-level calls
func getProduct(ctx context.Context, productID string) (string, error) {
	// CORRECT: propagate ctx, don't create a new one
	value, err := fetchFromCache(ctx, productID)
	if err != nil {
		return "", fmt.Errorf("getProduct(%s): %w", productID, err)
	}
	return value, nil
}

// Layer 1: service layer — sets timeout budget
func handleCheckout(ctx context.Context, userID, productID string) error {
	// Service layer sets the timeout — it knows the SLA
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()

	product, err := getProduct(ctx, productID)
	if err != nil {
		return fmt.Errorf("checkout for user %s: %w", userID, err)
	}

	fmt.Printf("checkout: user=%s product=%s\n", userID, product)
	return nil
}

// Layer 0: HTTP handler — passes r.Context()
// (simulated without a real HTTP server for compilability)
func simulatedHTTPHandler(requestCtx context.Context) {
	err := handleCheckout(requestCtx, "user-1", "product-A")
	if err != nil {
		fmt.Println("handler error:", err)
	}
}

// -------------------------------------------------------------------
// WRONG PATTERNS — shown for comparison
// -------------------------------------------------------------------

// WRONG: creates a new background context — loses cancellation from caller
func badGetProduct(productID string) (string, error) {
	// If the HTTP request is cancelled, this function keeps running!
	ctx := context.Background() // BAD: orphaned context
	return fetchFromCache(ctx, productID)
}

// WRONG: stores context in struct — context is frozen at construction time
type BadService struct {
	ctx context.Context // BAD: never do this
}

func (s *BadService) GetProduct(productID string) (string, error) {
	return fetchFromCache(s.ctx, productID) // uses stale context
}

// -------------------------------------------------------------------

func main() {
	// Simulate an HTTP request arriving
	requestCtx, requestCancel := context.WithCancel(context.Background())
	defer requestCancel()

	simulatedHTTPHandler(requestCtx)

	// Simulate client disconnecting mid-request
	fmt.Println("\n--- Client disconnect simulation ---")
	disconnectCtx, disconnect := context.WithCancel(context.Background())
	go func() {
		time.Sleep(5 * time.Millisecond) // client disconnects after 5ms
		disconnect()
	}()

	// fetchFromCache takes 10ms — disconnect happens first
	val, err := fetchFromCache(disconnectCtx, "key-1")
	fmt.Println("val:", val, "err:", err) // err: context.Canceled
}
```

---

## 10. Advanced: Context in Concurrent Fan-Out

When fanning out to multiple goroutines (parallel database queries, parallel API calls), share one context across all goroutines. The first error cancels all the others.

```go
// file: 07-context/10-fan-out/main.go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Result struct {
	Source string
	Data   string
	Err    error
}

// fetchSource simulates fetching from one data source.
func fetchSource(ctx context.Context, source string, latency time.Duration) Result {
	select {
	case <-time.After(latency):
		return Result{Source: source, Data: "data_from_" + source}
	case <-ctx.Done():
		return Result{Source: source, Err: ctx.Err()}
	}
}

// FanOut queries multiple sources in parallel, returns all results.
// Each goroutine respects the shared context — if any times out, all stop.
func FanOut(ctx context.Context, sources []string) []Result {
	results := make([]Result, len(sources))
	var wg sync.WaitGroup

	for i, src := range sources {
		wg.Add(1)
		go func(idx int, source string) {
			defer wg.Done()
			// Vary latency to make it interesting
			latency := time.Duration(50+idx*30) * time.Millisecond
			results[idx] = fetchSource(ctx, source, latency)
		}(i, src)
	}

	wg.Wait()
	return results
}

// FanOutFirstWins returns the first successful result and cancels the rest.
// Pattern used in: read repair, nearest-replica routing, hedged requests.
func FanOutFirstWins(ctx context.Context, sources []string) (Result, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel() // cancel remaining goroutines when we return

	ch := make(chan Result, len(sources))

	for _, src := range sources {
		go func(source string) {
			latency := time.Duration(10+len(source)*20) * time.Millisecond
			r := fetchSource(ctx, source, latency)
			if r.Err == nil {
				ch <- r
			}
		}(src)
	}

	select {
	case result := <-ch:
		cancel() // cancel other goroutines — we have a winner
		return result, nil
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
}

func main() {
	sources := []string{"db-primary", "db-replica-1", "db-replica-2", "cache"}

	// --- Fan-out all sources with shared timeout ---
	fmt.Println("=== Fan-out all ===")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	results := FanOut(ctx, sources)
	for _, r := range results {
		if r.Err != nil {
			fmt.Printf("  %s: ERROR %v\n", r.Source, r.Err)
		} else {
			fmt.Printf("  %s: %s\n", r.Source, r.Data)
		}
	}

	// --- First-wins (hedged request pattern) ---
	fmt.Println("\n=== First wins ===")
	ctx2, cancel2 := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel2()

	winner, err := FanOutFirstWins(ctx2, sources)
	if err != nil {
		fmt.Println("all failed:", err)
	} else {
		fmt.Printf("winner: %s -> %s\n", winner.Source, winner.Data)
	}

	// Give goroutines time to observe cancellation and exit
	time.Sleep(50 * time.Millisecond)
}
```

---

## Summary: Context Decision Guide

| Situation | What to do |
|---|---|
| Starting a server / CLI / test | `context.Background()` |
| Refactoring — context not plumbed yet | `context.TODO()` |
| Need to cancel goroutines manually | `context.WithCancel()` |
| Operation must complete within N seconds | `context.WithTimeout()` |
| Operation must complete by a specific time | `context.WithDeadline()` |
| Carrying trace IDs, user IDs, auth tokens | `context.WithValue()` with private key type |
| HTTP handler context | `r.Context()` — never `context.Background()` |
| Outbound HTTP request | `http.NewRequestWithContext(ctx, ...)` |
| Database query | `db.QueryContext(ctx, ...)` |
| Fan-out goroutines | Share one parent context; derive children if needed |

**The one rule that prevents 90% of context bugs: the context flows in, through function arguments, from the outside in. It never flows up, never lives in a struct, and never appears as a global variable.**
