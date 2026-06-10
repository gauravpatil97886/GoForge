> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# Go Context Package — Coding Practice

---

## Q1: Cancel Work with WithCancel  [Level 1 — Beginner]
> **Tags:** `#context` `#WithCancel` `#goroutine` `#cancellation`

### Problem Statement
Create a goroutine that performs iterative work simulated with a loop. Use `context.WithCancel` to let the caller cancel mid-execution. The goroutine must exit cleanly when cancellation arrives via `ctx.Done()`. This is the foundational pattern for all context-based cancellation in Go.

### Input / Output / Constraints
```
Input:  cancel() called after ~2 iterations (250ms sleep between)
Output: "Working iteration 1", "Working iteration 2", "Work cancelled: context canceled"
Constraints:
  • Must not leak goroutines
  • Must use ctx.Done() for cancellation signal
  • cancel() must be deferred in caller
```

### Thought Process
1. Understand: Parent creates a cancellable context and passes it to a goroutine; goroutine checks ctx.Done() each iteration.
2. Pattern: select with ctx.Done() and default inside a for-loop — canonical Go cancellation.
3. Edge cases: Cancel called before goroutine starts, goroutine finishes before cancel, forgetting defer cancel() leaks context.

### Brute Force
```go
// O(n) time, O(1) space — bare done channel, no context
func bruteForce(stop chan struct{}) {
    for i := 1; ; i++ {
        select {
        case <-stop:
            fmt.Println("Work stopped")
            return
        default:
            fmt.Printf("Working iteration %d\n", i)
            time.Sleep(100 * time.Millisecond)
        }
    }
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context) {
    for i := 1; ; i++ {
        select {
        case <-ctx.Done():
            fmt.Println("Work cancelled:", ctx.Err())
            return
        default:
            fmt.Printf("Working iteration %d\n", i)
            time.Sleep(100 * time.Millisecond)
        }
    }
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// DoWork — O(n) time, O(1) space
// Performs iterative work; exits cleanly on context cancellation.
func DoWork(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	for i := 1; ; i++ {
		select {
		case <-ctx.Done():
			fmt.Println("Work cancelled:", ctx.Err())
			return
		default:
			fmt.Printf("Working iteration %d\n", i)
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go DoWork(ctx, &wg)

	time.Sleep(250 * time.Millisecond)
	cancel()
	wg.Wait()
	fmt.Println("Main done")
}
```
**Time:** O(n) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Scales to thousands of goroutines; each independently listens on ctx.Done() channel |
| Edge Cases | Always defer cancel() immediately after WithCancel; early return without it leaks the context |
| Error Handling | ctx.Err() returns context.Canceled or context.DeadlineExceeded; log and wrap appropriately |
| Memory | Contexts form a tree; cancelling parent auto-cancels all children |
| Concurrency | ctx.Done() channel close is broadcast-safe; all readers unblock simultaneously |

### Visual Explanation
```mermaid
flowchart TD
    A["main: ctx, cancel = WithCancel"] --> B["go DoWork(ctx)"]
    B --> C{"select"}
    C -->|"ctx.Done() closed"| D["Print cancelled → return"]
    C -->|"default"| E["Print iteration N"]
    E --> F["sleep 100ms"] --> C
    A --> G["sleep 250ms"] --> H["cancel()"]
    H --> I["ctx.Done() channel closed"] --> D
```
```
Trace: iter1(100ms) → iter2(100ms) → cancel() at 250ms →
       ctx.Done() fires → "Work cancelled: context canceled" → wg.Wait() returns
```

### Interviewer Questions
1. Why this approach? — ctx.Done() is idiomatic; composes with timeouts/deadlines automatically.
2. Can it be optimized? — For CPU-bound work, check ctx.Done() every N iterations to reduce select overhead.
3. Scale to 10M? — Channel close broadcasts in O(1); context tree handles cancellation without loops.
4. Edge cases? — Forgetting defer cancel() causes goroutine and context to leak indefinitely.
5. Goroutine-safe? — Yes; channel close is atomic and safe for concurrent readers.
6. Memory impact? — ~200 bytes per context; negligible at normal scale.
7. Alternative? — Bare done channel works but doesn't compose; sync.WaitGroup for completion tracking.

### Follow-Up Questions
**Q1:** What does ctx.Err() return after cancel()? **A1:** `context.Canceled`.
**Q2:** Is calling cancel() twice safe? **A2:** Yes — idempotent, subsequent calls are no-ops.
**Q3:** Does cancelling parent cancel children? **A3:** Yes — propagates automatically down the tree.
**Q4:** How to actually wait for goroutine exit? **A4:** Use sync.WaitGroup or a done channel; time.Sleep is demo-only.
**Q5:** Zero value of context.Context? **A5:** nil; always use context.Background() or context.TODO() as root.

---

## Q2: HTTP Request with WithTimeout  [Level 1 — Beginner]
> **Tags:** `#context` `#WithTimeout` `#http` `#timeout`

### Problem Statement
Write a function that makes an HTTP GET request with a configurable timeout using `context.WithTimeout`. If the server does not respond within the deadline the request must be cancelled and a wrapped error returned. This is the most common real-world use of context in Go services.

### Input / Output / Constraints
```
Input:  url = "https://httpbin.org/delay/5", timeout = 2s
Output: error: "execute request: context deadline exceeded"
Constraints:
  • Timeout enforced via context, not only http.Client.Timeout
  • Must defer cancel() after WithTimeout
  • Must handle non-2xx status codes as errors
```

### Thought Process
1. Understand: http.NewRequestWithContext attaches context to the request; client aborts when ctx deadline fires.
2. Pattern: context.WithTimeout + http.NewRequestWithContext + defer cancel().
3. Edge cases: Zero timeout, 5xx response, network unreachable, ctx already cancelled before call.

### Brute Force
```go
// O(1) time, O(1) space — Client.Timeout only, context not propagated downstream
func bruteForce(url string, secs int) error {
	client := &http.Client{Timeout: time.Duration(secs) * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	return nil
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"
)

// FetchWithTimeout — O(1) time, O(body) space
// Makes an HTTP GET and enforces a strict per-call timeout via context.
func FetchWithTimeout(url string, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return body, nil
}

func main() {
	body, err := FetchWithTimeout("https://httpbin.org/get", 5*time.Second)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Printf("Response: %d bytes\n", len(body))
}
```
**Time:** O(1) | **Space:** O(body size)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Reuse a shared http.Client with custom transport; never use http.DefaultClient in production |
| Edge Cases | Always read body fully (io.Copy to io.Discard if unused) before Close to enable connection reuse |
| Error Handling | errors.Is(err, context.DeadlineExceeded) to distinguish timeout from network errors |
| Memory | Stream large response bodies; io.ReadAll buffers entire payload in memory |
| Concurrency | http.Client is goroutine-safe; one shared instance per service |

### Visual Explanation
```mermaid
flowchart TD
    A["FetchWithTimeout(url, 2s)"] --> B["WithTimeout → deadline=now+2s"]
    B --> C["NewRequestWithContext(ctx)"]
    C --> D["client.Do(req)"]
    D --> E{"Response within 2s?"}
    E -->|Yes| F["io.ReadAll → return bytes"]
    E -->|No — T+2s| G["ctx.Done() fires"]
    G --> H["client.Do → DeadlineExceeded error"]
    H --> I["return nil, wrapped error"]
```
```
Trace: ctx(2s) → request sent → server delays 5s →
       at T+2s deadline fires → http aborts → error returned to caller
```

### Interviewer Questions
1. Why this approach? — Context timeout composes with caller deadlines; Client.Timeout is global and doesn't compose.
2. Can it be optimized? — Shared http.Client with tuned transport (MaxIdleConns, IdleConnTimeout).
3. Scale to 10M? — Worker pool with shared client; each worker creates its own context per request.
4. Edge cases? — Drain body even on 4xx/5xx so TCP connection is reused.
5. Goroutine-safe? — http.Client is goroutine-safe by design.
6. Memory impact? — io.ReadAll buffers full body; stream for large payloads.
7. Alternative? — http.Client.Timeout for simple cases; context for composable pipelines.

### Follow-Up Questions
**Q1:** Difference between Client.Timeout and context timeout? **A1:** Client.Timeout is per-client global; context timeout is per-call and inherits parent deadlines.
**Q2:** Error type returned on timeout? **A2:** *url.Error wrapping context.DeadlineExceeded.
**Q3:** How to check if timeout caused the error? **A3:** `errors.Is(err, context.DeadlineExceeded)`.
**Q4:** Why must body always be read? **A4:** To allow TCP keep-alive connection reuse in the transport pool.
**Q5:** What is context.TODO()? **A5:** Placeholder signalling future context wiring; treated same as Background() at runtime.

---

## Q3: WithDeadline for Absolute Time Cutoff  [Level 2 — Easy]
> **Tags:** `#context` `#WithDeadline` `#batch` `#partial-results`

### Problem Statement
Implement a batch processor that accepts an absolute deadline (`time.Time`) and must complete as many work items as possible before that point. Use `context.WithDeadline` to enforce the cutoff. Return partial results and a wrapped error when time expires. This mirrors SLA enforcement in real payment and data pipelines.

### Input / Output / Constraints
```
Input:  items=[1..10], deadline=now+300ms, each item takes 50ms
Output: results=[2,4,6,8,10], err="deadline exceeded after 5 items: context deadline exceeded"
Constraints:
  • Deadline is absolute time.Time (not relative duration)
  • Must return partial results, not nil, on timeout
  • Must not block past the deadline
```

### Thought Process
1. Understand: WithDeadline takes absolute time.Time; natural when cutoff arrives from SLA or upstream request.
2. Pattern: select on ctx.Done() before each work unit; accumulate results.
3. Edge cases: Deadline already past (ctx immediately cancelled), all items done before deadline, empty input.

### Brute Force
```go
// O(n) time, O(n) space — no deadline, all items processed regardless
func bruteForce(items []int) []int {
	out := make([]int, 0, len(items))
	for _, v := range items {
		time.Sleep(50 * time.Millisecond)
		out = append(out, v*2)
	}
	return out
}
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
func better(ctx context.Context, items []int) ([]int, error) {
	out := make([]int, 0, len(items))
	for _, v := range items {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		time.Sleep(50 * time.Millisecond)
		out = append(out, v*2)
	}
	return out, nil
}
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"time"
)

// ProcessWithDeadline — O(n) time, O(n) space
// Processes items until absolute deadline; returns partial results + error.
func ProcessWithDeadline(deadline time.Time, items []int) ([]int, error) {
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()

	results := make([]int, 0, len(items))
	for _, item := range items {
		select {
		case <-ctx.Done():
			return results, fmt.Errorf("deadline exceeded after %d items: %w",
				len(results), ctx.Err())
		default:
		}
		time.Sleep(50 * time.Millisecond)
		results = append(results, item*2)
	}
	return results, nil
}

func main() {
	items := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	deadline := time.Now().Add(300 * time.Millisecond)

	results, err := ProcessWithDeadline(deadline, items)
	fmt.Println("Results:", results)
	if err != nil {
		fmt.Println("Error:", err)
	}
}
```
**Time:** O(n) | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Propagate the same deadline context into all sub-calls so the whole tree respects the SLA |
| Edge Cases | Check time.Until(deadline) <= 0 before creating context to fail fast |
| Error Handling | Wrap ctx.Err() with %w so callers can use errors.Is for introspection |
| Memory | Pre-allocate with make([]int, 0, len(items)) to avoid repeated GC pressure |
| Concurrency | Fan out with goroutines each checking ctx.Done(); collect via buffered channel |

### Visual Explanation
```mermaid
flowchart TD
    A["ProcessWithDeadline(deadline, items)"] --> B["WithDeadline → ctx"]
    B --> C["Loop items"]
    C --> D{"ctx.Done() closed?"}
    D -->|Yes| E["return partial + error"]
    D -->|No| F["process item, append"]
    F --> G{"more items?"}
    G -->|Yes| C
    G -->|No| H["return all results, nil"]
```
```
Trace: deadline=now+300ms → items 1-5 processed (5×50ms=250ms) →
       item 6 pre-check: ctx.Done() fires → return [2,4,6,8,10], err
```

### Interviewer Questions
1. Why this approach? — WithDeadline is natural when time boundary is absolute (SLA, upstream header).
2. Can it be optimized? — Fan out to worker pool; all workers share same context.
3. Scale to 10M? — Distribute across nodes; pass deadline as gRPC deadline or HTTP header.
4. Edge cases? — Deadline in past: ctx is cancelled before first iteration; returns empty slice + error.
5. Goroutine-safe? — Context is safe; result slice needs mutex if written concurrently.
6. Memory impact? — Partial results in memory; flush to storage for very large batches.
7. Alternative? — WithTimeout for relative durations; cleaner in most application code.

### Follow-Up Questions
**Q1:** WithDeadline vs WithTimeout? **A1:** WithTimeout(d) = WithDeadline(time.Now().Add(d)); use WithDeadline when absolute time is known.
**Q2:** Can a child have a later deadline than parent? **A2:** No — the earlier deadline always wins; child cannot extend parent.
**Q3:** How to check remaining time? **A3:** `dl, ok := ctx.Deadline(); remaining := time.Until(dl)`.
**Q4:** What does false from ctx.Deadline() mean? **A4:** No deadline is set on this context.
**Q5:** How to propagate deadline across services? **A5:** gRPC propagates automatically; for HTTP use X-Request-Deadline custom header.

---

## Q4: WithValue for Trace IDs  [Level 2 — Easy]
> **Tags:** `#context` `#WithValue` `#tracing` `#middleware` `#request-id`

### Problem Statement
Build a request tracing system where each incoming HTTP request receives a unique trace ID. Store it in context via `context.WithValue` using a custom unexported struct key type to prevent cross-package collisions. Provide typed helper functions for injection and extraction. Log the trace ID on every line throughout the call chain.

### Input / Output / Constraints
```
Input:  HTTP request, X-Trace-ID header = "req-abc-123"
Output: "[trace:req-abc-123] handler called", "[trace:req-abc-123] db queried"
Constraints:
  • Key type must be unexported struct (not string/int)
  • Extraction must use type assertion with ok-check
  • Must fall back to "unknown" when absent
```

### Thought Process
1. Understand: context.WithValue key must be comparable; custom unexported type prevents collision even if two packages use the same string.
2. Pattern: `type traceKeyType struct{}`, var traceKey = traceKeyType{}, WithTraceID / TraceIDFrom helpers.
3. Edge cases: Missing ID in context, wrong type stored under same key, nil context.

### Brute Force
```go
// O(1) time, O(1) space — raw string key: collision-prone across packages
func bruteForce(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, "traceID", id) // BAD
}
func getTrace(ctx context.Context) string {
	v, _ := ctx.Value("traceID").(string)
	return v
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
type ctxKey string
const traceKey ctxKey = "traceID"

func withTrace(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, traceKey, id)
}
func traceFrom(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(traceKey).(string)
	return id, ok
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"net/http"
)

type traceKeyType struct{} // unexported: zero collision risk
var traceKey = traceKeyType{}

// WithTraceID attaches a trace ID to the context.
func WithTraceID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, traceKey, id)
}

// TraceIDFrom retrieves the trace ID; second return is false if absent.
func TraceIDFrom(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(traceKey).(string)
	return id, ok
}

func log(ctx context.Context, msg string) {
	id, ok := TraceIDFrom(ctx)
	if !ok {
		id = "unknown"
	}
	fmt.Printf("[trace:%s] %s\n", id, msg)
}

// TraceMiddleware injects a trace ID for every HTTP request.
func TraceMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Trace-ID")
		if id == "" {
			id = fmt.Sprintf("auto-%d", r.ContentLength)
		}
		ctx := WithTraceID(r.Context(), id)
		log(ctx, "request: "+r.URL.Path)
		next(w, r.WithContext(ctx))
	}
}

func handleOrder(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log(ctx, "processing order")
	log(ctx, "order saved to db")
	w.WriteHeader(http.StatusOK)
}

func main() {
	ctx := WithTraceID(context.Background(), "req-abc-123")
	log(ctx, "handler called")
	log(ctx, "db queried")
	log(ctx, "response sent")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Zero-overhead propagation; log aggregators index by trace ID for distributed debugging |
| Edge Cases | Always provide fallback value; missing ID should never cause nil-pointer or empty log field |
| Error Handling | Never store mutable values; context values are immutable by convention |
| Memory | Each WithValue adds one linked-list node; avoid many separate calls — batch into one struct |
| Concurrency | Context values are read-only; safe for all concurrent readers |

### Visual Explanation
```mermaid
flowchart TD
    A["HTTP Request"] --> B["TraceMiddleware"]
    B --> C{"X-Trace-ID header?"}
    C -->|Present| D["use header value"]
    C -->|Absent| E["generate ID"]
    D --> F["WithValue(ctx, traceKey, id)"]
    E --> F
    F --> G["handler receives enriched ctx"]
    G --> H["TraceIDFrom(ctx) → prefix every log"]
```
```
Trace: request → "req-abc-123" injected → handleOrder →
       TraceIDFrom = "req-abc-123" → all logs tagged with trace ID
```

### Interviewer Questions
1. Why this approach? — Struct key type guarantees no collision even across separate packages using same literal string.
2. Can it be optimized? — Store one struct with all request-scoped metadata instead of multiple WithValue calls.
3. Scale to 10M? — String reference; negligible memory per request.
4. Edge cases? — ctx.Value returns nil if absent; type assertion with ok prevents panic.
5. Goroutine-safe? — Yes; values immutable after set.
6. Memory impact? — One linked-list node per WithValue; avoid deep chains.
7. Alternative? — Explicit struct param; OpenTelemetry Span for full distributed tracing.

### Follow-Up Questions
**Q1:** Why not use string as key type? **A1:** Two packages with same string literal silently shadow each other's values.
**Q2:** Is context.Value lookup O(1)? **A2:** No — O(n) linked-list walk from child to root.
**Q3:** Can value be any type? **A3:** Yes, but prefer small immutable values; avoid large structs.
**Q4:** Best way to store multiple request fields? **A4:** One struct pointer in a single WithValue call.
**Q5:** Cross-service propagation? **A5:** Serialize to gRPC metadata or HTTP header; re-attach on server side.

---

## Q5: Propagating Context Through a Call Chain  [Level 2 — Easy]
> **Tags:** `#context` `#propagation` `#layers` `#cancellation`

### Problem Statement
Build a three-layer system: HTTP handler → service → repository. The HTTP request context must flow through every layer. Demonstrate that a simulated client disconnect (cancel at T+100ms) propagates automatically to a slow repository query (500ms) without any manual signalling between layers.

### Input / Output / Constraints
```
Input:  GET /user/1, client disconnects at T+100ms, DB query takes 500ms
Output: "[repo] cancelled: context canceled", handler returns HTTP 503
Constraints:
  • ctx passed as first argument at every function boundary
  • No goroutine blocks after disconnect
  • Each layer logs its own cancellation
```

### Thought Process
1. Understand: r.Context() is cancelled by the HTTP server on disconnect; each layer just passes ctx down.
2. Pattern: ctx as first argument — universal Go convention; select in repository on ctx.Done().
3. Edge cases: Nil ctx passed, forgot to pass ctx to DB call, service layer wrapping ctx with extra values.

### Brute Force
```go
// O(1) time, O(1) space — ignores context entirely
func bruteForce(w http.ResponseWriter, r *http.Request) {
	user := slowQuery(1) // cannot be cancelled
	fmt.Fprintln(w, user)
}
func slowQuery(id int) string {
	time.Sleep(500 * time.Millisecond)
	return "user"
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func handler(w http.ResponseWriter, r *http.Request) {
	u, err := svcGet(r.Context(), 1)
	if err != nil { http.Error(w, err.Error(), 503); return }
	fmt.Fprintln(w, u)
}
func svcGet(ctx context.Context, id int) (string, error) {
	return repoGet(ctx, id)
}
func repoGet(ctx context.Context, id int) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(500 * time.Millisecond):
		return fmt.Sprintf("User#%d", id), nil
	}
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"
)

// --- Repository ---
type UserRepo struct{}

func (r *UserRepo) FindByID(ctx context.Context, id int) (string, error) {
	log.Printf("[repo] query start user=%d", id)
	select {
	case <-ctx.Done():
		log.Printf("[repo] cancelled: %v", ctx.Err())
		return "", fmt.Errorf("repo: %w", ctx.Err())
	case <-time.After(500 * time.Millisecond):
		return fmt.Sprintf("User#%d", id), nil
	}
}

// --- Service ---
type UserService struct{ repo *UserRepo }

func (s *UserService) GetUser(ctx context.Context, id int) (string, error) {
	log.Printf("[service] GetUser id=%d", id)
	u, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return "", fmt.Errorf("service: %w", err)
	}
	return u, nil
}

// --- Handler ---
func (s *UserService) Handle(w http.ResponseWriter, r *http.Request) {
	log.Printf("[handler] GET /user")
	u, err := s.GetUser(r.Context(), 1)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	fmt.Fprintln(w, u)
}

func main() {
	// Demo: simulate disconnect at 100ms
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		log.Println("[client] disconnecting")
		cancel()
	}()

	repo := &UserRepo{}
	result, err := repo.FindByID(ctx, 1)
	fmt.Println("result:", result, "| err:", err)
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Zero-cost propagation; all goroutines share the same closed channel broadcast |
| Edge Cases | Use db.QueryContext not db.Query so driver cancels at the wire level |
| Error Handling | Wrap at each layer with %w; errors.Is traces through the chain |
| Memory | No allocation from passing ctx by interface value |
| Concurrency | r.Context() cancelled concurrently by HTTP server; all layers react simultaneously |

### Visual Explanation
```mermaid
flowchart TD
    A["Client GET /user/1"] --> B["Handler: r.Context()"]
    B --> C["Service.GetUser(ctx)"]
    C --> D["Repo.FindByID(ctx)"]
    D --> E{"select"}
    E -->|"ctx.Done at T+100ms"| F["[repo] cancelled"]
    F --> G["error bubbles up all layers"]
    G --> H["HTTP 503"]
    E -->|"query done at T+500ms"| I["HTTP 200 User#1"]
```
```
Trace: ctx flows handler→service→repo → cancel at 100ms →
       ctx.Done in repo select → error wrapped at each layer → 503
```

### Interviewer Questions
1. Why this approach? — First-arg ctx is Go standard; enables automatic propagation without boilerplate.
2. Can it be optimized? — No optimization needed; propagation is zero-cost.
3. Scale to 10M? — Each request independent ctx; no shared state; linear scaling.
4. Edge cases? — db.QueryContext cancels at driver level; partial rows returned via rows.Err().
5. Goroutine-safe? — ctx.Done() channel close is broadcast-safe.
6. Memory impact? — Interface value copy; negligible.
7. Alternative? — Thread-locals not idiomatic; explicit done channel (pre-1.7).

### Follow-Up Questions
**Q1:** When does r.Context() cancel? **A1:** When client closes connection or server WriteTimeout fires.
**Q2:** How does database/sql use context? **A2:** db.QueryContext cancels at driver level when ctx done.
**Q3:** Store ctx in struct? **A3:** No — Go docs prohibit it; pass as argument always.
**Q4:** Outlive request context? **A4:** context.WithoutCancel (Go 1.21) detaches from parent cancellation.
**Q5:** gRPC context propagation? **A5:** gRPC passes ctx per RPC call; cancelled when client disconnects.

---

## Q6: Context in HTTP Handlers  [Level 3 — Medium]
> **Tags:** `#context` `#http` `#middleware` `#timeout` `#disconnect`

### Problem Statement
Build an HTTP server with two middleware layers: one injects a request ID, the other wraps the handler with a per-request timeout. The handler runs a slow operation and must return early — with distinct log messages — if the timeout fires or if the client disconnects. Distinguish the two cases using `ctx.Err()`.

### Input / Output / Constraints
```
Input:  GET /slow — handler takes 2s; timeout middleware = 1s
Output: HTTP 503 "request timeout"; log shows "[req-id] timeout"
        OR if client disconnects at 500ms: log "[req-id] client disconnected"
Constraints:
  • Two composable middleware functions
  • Must distinguish DeadlineExceeded from Canceled in logs
  • Background goroutine for slow work must be buffered to avoid leak
```

### Thought Process
1. Understand: r.Context() cancelled by server on disconnect; wrapping with WithTimeout adds deadline. ctx.Err() == DeadlineExceeded means timeout; == Canceled means disconnect.
2. Pattern: Middleware chain → enriched ctx → handler selects on ctx.Done() channel.
3. Edge cases: Handler completes before either fires, timeout < disconnect, concurrent requests with independent contexts.

### Brute Force
```go
// O(1) time, O(1) space — no cancellation, blocks for full 2s even if client left
func bruteForce(w http.ResponseWriter, r *http.Request) {
	time.Sleep(2 * time.Second)
	fmt.Fprintln(w, "done")
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
	defer cancel()
	done := make(chan string, 1)
	go func() { time.Sleep(2 * time.Second); done <- "result" }()
	select {
	case res := <-done:
		fmt.Fprintln(w, res)
	case <-ctx.Done():
		http.Error(w, ctx.Err().Error(), http.StatusServiceUnavailable)
	}
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"
)

type reqIDKey struct{}

func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = fmt.Sprintf("%d", time.Now().UnixNano())
		}
		ctx := context.WithValue(r.Context(), reqIDKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func TimeoutMiddleware(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func slowHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, _ := ctx.Value(reqIDKey{}).(string)

	result := make(chan string, 1) // buffered: goroutine never blocks
	go func() {
		time.Sleep(2 * time.Second)
		result <- "data"
	}()

	select {
	case data := <-result:
		log.Printf("[%s] completed", id)
		fmt.Fprintln(w, data)
	case <-ctx.Done():
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			log.Printf("[%s] timeout", id)
			http.Error(w, "request timeout", http.StatusServiceUnavailable)
		} else {
			log.Printf("[%s] client disconnected", id)
			// client gone — do not write to w
		}
	}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/slow", slowHandler)
	chain := RequestIDMiddleware(TimeoutMiddleware(1*time.Second)(mux))
	log.Println("Server on :8080")
	_ = http.ListenAndServe(":8080", chain)
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Timeout middleware prevents slow handlers from exhausting connection pool |
| Edge Cases | Writing to ResponseWriter after client disconnect is a no-op; always check ctx.Err() first |
| Error Handling | errors.Is(ctx.Err(), context.DeadlineExceeded) vs Canceled distinguishes the two cases |
| Memory | Background goroutine runs until its own timer fires even after ctx cancels; buffered chan prevents leak |
| Concurrency | Each request has independent ctx; middleware is stateless and goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /slow"] --> B["RequestIDMiddleware — inject ID"]
    B --> C["TimeoutMiddleware — WithTimeout 1s"]
    C --> D["slowHandler — go func slow work 2s"]
    D --> E{"select"}
    E -->|"result at 2s — but ctx done at 1s"| F["ctx.Done() wins"]
    F --> G{"ctx.Err()"}
    G -->|"DeadlineExceeded"| H["HTTP 503 timeout"]
    G -->|"Canceled"| I["log: client disconnected"]
    E -->|"result before deadline"| J["HTTP 200"]
```
```
Trace: T+0 request → ID injected → timeout=1s set → slow work starts →
       T+1s deadline fires → ctx.Done() → 503 returned
```

### Interviewer Questions
1. Why this approach? — Composable middleware keeps handler clean; ctx carries both ID and deadline.
2. Can it be optimized? — Use http.TimeoutHandler from stdlib for simple timeout-only cases.
3. Scale to 10M? — Stateless middleware; horizontal scaling; timeout prevents resource exhaustion.
4. Edge cases? — Never write to ResponseWriter after Hijack or verified client disconnect.
5. Goroutine-safe? — Stateless middleware; each request goroutine is independent.
6. Memory impact? — Background goroutine continues until its timer; buffered channel prevents deadlock.
7. Alternative? — http.TimeoutHandler (stdlib) handles timeout + 503 automatically.

### Follow-Up Questions
**Q1:** Does cancelling ctx stop the slow goroutine? **A1:** No — goroutine keeps running; pass ctx into goroutine to stop it.
**Q2:** How to stop background goroutine? **A2:** Pass ctx; inside goroutine select on ctx.Done() alongside work.
**Q3:** What is http.TimeoutHandler? **A3:** Stdlib wrapper that enforces a handler timeout with automatic 503.
**Q4:** Custom JSON error on timeout? **A4:** Write JSON in the DeadlineExceeded case before returning.
**Q5:** What if ResponseWriter already written? **A5:** Header flush is no-op; body write may partially succeed.

---

## Q7: Database Query with Context  [Level 3 — Medium]
> **Tags:** `#context` `#database` `#sql` `#timeout` `#cancellation`

### Problem Statement
Implement a repository that queries a relational database with `db.QueryContext`. Layer two timeouts: the caller's existing context deadline (e.g., 5s HTTP deadline) and a per-query budget (2s). The child context uses whichever deadline is shorter. Return partial rows already scanned if iteration is cancelled mid-result-set.

### Input / Output / Constraints
```
Input:  callerCtx deadline=5s, queryBudget=2s, DB query takes 3s
Output: error "db query timeout after 2s: context deadline exceeded" at T+2s
Constraints:
  • Must use db.QueryContext, not db.Query
  • Child context respects the shorter deadline automatically
  • Must defer rows.Close(); must check rows.Err() after loop
```

### Thought Process
1. Understand: context.WithTimeout on top of parent ctx yields child whose deadline = min(parent, now+budget).
2. Pattern: child ctx → QueryContext → defer rows.Close() → rows.Next() loop with ctx.Err() check → rows.Err().
3. Edge cases: Parent already expired, scan error mid-loop, nil rows, connection pool exhaustion.

### Brute Force
```go
// O(n) time, O(n) space — no context, query cannot be cancelled
func bruteForce(db *sql.DB, id int) (string, error) {
	row := db.QueryRow("SELECT name FROM users WHERE id=$1", id)
	var name string
	return name, row.Scan(&name)
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, db *sql.DB, id int) (string, error) {
	row := db.QueryRowContext(ctx, "SELECT name FROM users WHERE id=$1", id)
	var name string
	if err := row.Scan(&name); err != nil {
		return "", err
	}
	return name, nil
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

type User struct{ ID int; Name string; Age int }

// QueryUsers — O(n) time, O(n) space
// Queries with composed context: min(caller deadline, queryBudget).
func QueryUsers(ctx context.Context, db *sql.DB, budget time.Duration) ([]User, error) {
	qCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()

	rows, err := db.QueryContext(qCtx,
		"SELECT id, name, age FROM users ORDER BY id LIMIT 100")
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, fmt.Errorf("db query timeout after %s: %w", budget, err)
		}
		return nil, fmt.Errorf("db query: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		if qCtx.Err() != nil {
			return users, fmt.Errorf("scan cancelled: %w", qCtx.Err())
		}
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.Age); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration: %w", err)
	}
	return users, nil
}

func main() {
	db, err := sql.Open("postgres", "postgres://user:pass@localhost/demo?sslmode=disable")
	if err != nil { log.Fatal(err) }
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	users, err := QueryUsers(ctx, db, 2*time.Second)
	if err != nil { log.Println("Error:", err); return }
	fmt.Printf("Found %d users\n", len(users))
}
```
**Time:** O(n) | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Per-query budget prevents slow queries from exhausting the connection pool |
| Edge Cases | Always defer rows.Close(); failure leaks a connection back to pool |
| Error Handling | Check rows.Err() after loop — iteration errors reported there, not in rows.Next() |
| Memory | Stream large results row-by-row; avoid collecting all into a slice |
| Concurrency | sql.DB is goroutine-safe; QueryContext grabs a connection from the pool |

### Visual Explanation
```mermaid
flowchart TD
    A["QueryUsers(callerCtx 5s, budget 2s)"] --> B["WithTimeout(callerCtx, 2s)"]
    B --> C["qCtx deadline = min(5s, now+2s)"]
    C --> D["db.QueryContext(qCtx, SQL)"]
    D --> E{"query returns ≤ 2s?"}
    E -->|No| F["DeadlineExceeded → return nil, error"]
    E -->|Yes| G["rows.Next() loop"]
    G --> H["rows.Close() deferred"]
    G --> I["return []User, nil"]
```
```
Trace: callerCtx(5s) → child(2s) → QueryContext → query takes 3s →
       at T+2s child deadline fires → error returned → rows.Close() deferred runs
```

### Interviewer Questions
1. Why this approach? — Composed contexts enforce both global SLA and per-query budget; shorter wins.
2. Can it be optimized? — Prepared statements with QueryContext; avoid per-request db.Open.
3. Scale to 10M? — Tune MaxOpenConns, MaxIdleConns; monitor db.Stats().WaitCount.
4. Edge cases? — rows.Err() after loop catches mid-stream network errors.
5. Goroutine-safe? — sql.DB pool is goroutine-safe.
6. Memory impact? — Collect only needed columns; stream for large datasets.
7. Alternative? — sqlx.SelectContext, GORM with context.

### Follow-Up Questions
**Q1:** Forget rows.Close()? **A1:** Connection not returned to pool; pool exhausts under load.
**Q2:** What does rows.Err() check? **A2:** Errors during iteration not visible via rows.Next() bool.
**Q3:** Global query timeout? **A3:** Wrap db with helper that always applies budget; or use db.SetConnMaxLifetime.
**Q4:** Reuse rows after Close? **A4:** No — rows.Next() returns false; data inaccessible.
**Q5:** Detect pool exhaustion? **A5:** db.Stats() returns WaitCount and WaitDuration.

---

## Q8: Goroutine Select on ctx.Done  [Level 3 — Medium]
> **Tags:** `#context` `#select` `#goroutine` `#fan-out` `#cancellation`

### Problem Statement
Launch N worker goroutines that each process jobs from a shared channel. All workers must stop cleanly when the parent context is cancelled. The coordinator must wait for all workers to exit before returning. Demonstrate the fan-out, fan-in pattern with context-aware workers.

### Input / Output / Constraints
```
Input:  workers=3, jobs=[1..9], cancel() called after 5 jobs processed
Output: Each worker logs completed jobs; after cancel all log "worker N stopped"
Constraints:
  • Must use sync.WaitGroup to detect all workers exited
  • Workers must drain in-progress work before exiting (no partial state)
  • Jobs channel closed by coordinator, not workers
```

### Thought Process
1. Understand: Each worker selects on ctx.Done() and jobs channel; closing jobs channel OR cancelling ctx causes exit.
2. Pattern: Fan-out with WaitGroup; coordinator closes jobs after send; workers exit on ctx.Done or closed channel.
3. Edge cases: More jobs than workers can process before cancel, jobs channel full (block), ctx already cancelled at start.

### Brute Force
```go
// O(n) time, O(n) space — no cancellation, workers block forever if jobs dry up
func bruteForce(jobs <-chan int) {
	for job := range jobs {
		fmt.Println("processing", job)
	}
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
func worker(ctx context.Context, id int, jobs <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			fmt.Printf("worker %d stopped\n", id)
			return
		case job, ok := <-jobs:
			if !ok { return }
			fmt.Printf("worker %d: job %d\n", id, job)
		}
	}
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Worker — O(n) time, O(1) space per worker
// Processes jobs until ctx cancelled or jobs channel closed.
func Worker(ctx context.Context, id int, jobs <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			fmt.Printf("worker %d stopped: %v\n", id, ctx.Err())
			return
		case job, ok := <-jobs:
			if !ok {
				fmt.Printf("worker %d: jobs channel closed\n", id)
				return
			}
			// Simulate work; also check ctx mid-work for long tasks
			select {
			case <-ctx.Done():
				fmt.Printf("worker %d: job %d cancelled mid-work\n", id, job)
				return
			case <-time.After(100 * time.Millisecond):
				fmt.Printf("worker %d: completed job %d\n", id, job)
			}
		}
	}
}

func RunWorkers(ctx context.Context, numWorkers, numJobs int) {
	jobs := make(chan int, numJobs)
	var wg sync.WaitGroup

	// Start workers
	for i := 1; i <= numWorkers; i++ {
		wg.Add(1)
		go Worker(ctx, i, jobs, &wg)
	}

	// Send jobs
	for j := 1; j <= numJobs; j++ {
		jobs <- j
	}
	close(jobs) // signal no more jobs

	wg.Wait() // wait for all workers to exit cleanly
	fmt.Println("all workers done")
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		time.Sleep(350 * time.Millisecond) // cancel after ~3 jobs per worker
		cancel()
	}()

	RunWorkers(ctx, 3, 9)
}
```
**Time:** O(n/workers) | **Space:** O(workers)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Worker pool size tuned to CPU count or I/O concurrency limit; GOMAXPROCS for CPU-bound |
| Edge Cases | Buffered jobs channel prevents coordinator blocking; workers must handle both ctx.Done and closed channel |
| Error Handling | Collect errors via errgroup or error channel; do not panic inside workers |
| Memory | Each goroutine stack starts at 2KB; 10K workers ≈ 20MB minimum |
| Concurrency | WaitGroup ensures coordinator does not return until all workers exit cleanly |

### Visual Explanation
```mermaid
flowchart TD
    A["RunWorkers: ctx, 3 workers, 9 jobs"] --> B["launch worker 1,2,3"]
    B --> C["send jobs 1-9 to channel"]
    C --> D["close(jobs)"]
    D --> E["each worker: select"]
    E -->|"job received"| F["process 100ms"]
    F --> E
    E -->|"ctx.Done or channel closed"| G["worker exits, wg.Done()"]
    G --> H{"all workers done?"}
    H -->|Yes| I["wg.Wait() returns"]
```
```
Trace: 3 workers start → jobs sent → cancel() at 350ms →
       ctx.Done fires in all worker selects → each prints stopped → wg.Wait unblocks
```

### Interviewer Questions
1. Why this approach? — WaitGroup ensures clean shutdown; select handles both cancellation and channel drain.
2. Can it be optimized? — Use errgroup for automatic error collection and cancellation on first error.
3. Scale to 10M? — Adjust pool size; use rate limiter (golang.org/x/time/rate) to control throughput.
4. Edge cases? — Jobs sent to closed channel panics; always close after all sends complete.
5. Goroutine-safe? — WaitGroup, channel, and context are all safe for concurrent access.
6. Memory impact? — Monitor goroutine count with runtime.NumGoroutine(); profile with pprof.
7. Alternative? — errgroup.WithContext from golang.org/x/sync for cleaner error handling.

### Follow-Up Questions
**Q1:** What does closing a channel signal to workers? **A1:** The `ok` variable in `job, ok := <-jobs` becomes false; worker exits cleanly.
**Q2:** What if you send to a closed channel? **A2:** Panic; always close from the sender side after all sends.
**Q3:** errgroup vs WaitGroup? **A3:** errgroup cancels context on first error and collects errors; WaitGroup is simpler but error-collection requires extra channel.
**Q4:** How to limit concurrency? **A4:** Buffered semaphore channel: `sem := make(chan struct{}, maxConcurrent)`.
**Q5:** Detect goroutine leak in tests? **A5:** Use goleak library (go.uber.org/goleak) which checks goroutine count before/after test.

---

## Q9: Combining Contexts  [Level 3 — Medium]
> **Tags:** `#context` `#combine` `#multi-cancel` `#Go1.21`

### Problem Statement
You have two independent cancellation signals: a user-initiated abort and a system-level shutdown. Either one should cancel the downstream work. Before Go 1.21, implement a combineContexts helper. After Go 1.21, demonstrate `context.AfterFunc`. Show both approaches and compare.

### Input / Output / Constraints
```
Input:  userCtx cancelled at T+100ms, sysCtx deadline at T+500ms
Output: work cancelled at T+100ms (userCtx fires first)
Constraints:
  • Either signal must independently cancel work
  • Combined context must not outlive the shorter-lived parent
  • Must handle goroutine cleanup in pre-1.21 approach
```

### Thought Process
1. Understand: Go's context tree is single-parent; combining two unrelated contexts requires a helper goroutine or context.AfterFunc.
2. Pattern: Pre-1.21: goroutine selects on both Done channels and cancels a child. Go 1.21+: context.AfterFunc registers a callback.
3. Edge cases: Both fire simultaneously, one already cancelled at combine time, function registered with AfterFunc runs in new goroutine.

### Brute Force
```go
// O(1) time, O(1) space — only watches one context
func bruteForce(ctx1 context.Context) context.Context {
	return ctx1 // ignores second signal entirely
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Pre-1.21: goroutine merges two contexts
func mergeContexts(ctx1, ctx2 context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		select {
		case <-ctx1.Done():
			cancel()
		case <-ctx2.Done():
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}
```
**Time:** O(1) | **Space:** O(1) + goroutine

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"time"
)

// MergeContexts — pre-Go-1.21 approach
// Returns a context cancelled when either parent is cancelled.
func MergeContexts(ctx1, ctx2 context.Context) (context.Context, context.CancelFunc) {
	merged, cancel := context.WithCancel(context.Background())
	go func() {
		defer cancel()
		select {
		case <-ctx1.Done():
		case <-ctx2.Done():
		case <-merged.Done(): // caller cancelled directly
		}
	}()
	return merged, cancel
}

// WithAfterFunc — Go 1.21+ approach using context.AfterFunc
// Callback fires in a new goroutine when ctx is done.
func WithAfterFunc(userCtx, sysCtx context.Context) (context.Context, context.CancelFunc) {
	merged, cancel := context.WithCancel(context.Background())
	// AfterFunc calls cancel() when userCtx is done
	stop1 := context.AfterFunc(userCtx, cancel)
	// AfterFunc calls cancel() when sysCtx is done
	stop2 := context.AfterFunc(sysCtx, cancel)

	return merged, func() {
		stop1() // deregister callbacks to avoid goroutine leak
		stop2()
		cancel()
	}
}

func doWork(ctx context.Context, label string) {
	select {
	case <-time.After(1 * time.Second):
		fmt.Printf("[%s] completed\n", label)
	case <-ctx.Done():
		fmt.Printf("[%s] cancelled: %v\n", label, ctx.Err())
	}
}

func main() {
	userCtx, userCancel := context.WithCancel(context.Background())
	sysCtx, sysCancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer sysCancel()

	// Fire user cancel at 100ms
	go func() {
		time.Sleep(100 * time.Millisecond)
		fmt.Println("user abort")
		userCancel()
	}()

	// Pre-1.21
	merged1, cancel1 := MergeContexts(userCtx, sysCtx)
	defer cancel1()
	doWork(merged1, "pre-1.21")

	// Reset for second demo
	userCtx2, userCancel2 := context.WithCancel(context.Background())
	sysCtx2, sysCancel2 := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer sysCancel2()
	go func() { time.Sleep(100 * time.Millisecond); userCancel2() }()

	merged2, cancel2 := WithAfterFunc(userCtx2, sysCtx2)
	defer cancel2()
	doWork(merged2, "go-1.21")
}
```
**Time:** O(1) | **Space:** O(1) + goroutine

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | AfterFunc is preferred post-1.21; lower goroutine overhead than manual merge |
| Edge Cases | Call stop() from AfterFunc to deregister when work completes; prevents goroutine leak |
| Error Handling | ctx.Err() on merged context is always context.Canceled regardless of which parent fired |
| Memory | Pre-1.21 goroutine held until one parent cancels; use merged.Done() case to release early |
| Concurrency | AfterFunc callback runs in a new goroutine; cancel() is goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["userCtx + sysCtx"] --> B["MergeContexts"]
    B --> C["goroutine: select on both Done"]
    C -->|"userCtx.Done at T+100ms"| D["cancel merged"]
    C -->|"sysCtx.Done at T+500ms"| D
    D --> E["doWork: ctx.Done fires at T+100ms"]
    E --> F["print: cancelled"]
```
```
Trace: goroutine waits → userCtx cancelled at T+100ms →
       merged cancel() called → doWork ctx.Done fires → "cancelled: context canceled"
```

### Interviewer Questions
1. Why this approach? — Go context tree is single-parent; merging requires explicit coordination.
2. Can it be optimized? — Go 1.21 AfterFunc avoids a dedicated goroutine for the merge.
3. Scale to 10M? — AfterFunc scales better; pre-1.21 approach adds one goroutine per merge.
4. Edge cases? — Must call stop() from AfterFunc when work completes to prevent goroutine leak.
5. Goroutine-safe? — cancel() is goroutine-safe; can be called concurrently.
6. Memory impact? — One goroutine per merge in pre-1.21; AfterFunc uses runtime callback.
7. Alternative? — errgroup.WithContext cancels on first error; covers different use case.

### Follow-Up Questions
**Q1:** What does context.AfterFunc return? **A1:** A stop function; calling it deregisters the callback and prevents it from running.
**Q2:** Does AfterFunc block? **A2:** No — callback runs in a new goroutine asynchronously.
**Q3:** ctx.Err() after either parent cancels? **A3:** Always context.Canceled on the merged child.
**Q4:** What if both parents cancel simultaneously? **A4:** cancel() called twice; idempotent, no issue.
**Q5:** Use case in production? **A5:** Request context (client deadline) + shutdown signal; either should abort the handler.

---

## Q10: Context Leak Detection  [Level 4 — Advanced]
> **Tags:** `#context` `#leak` `#testing` `#goroutine-leak` `#pprof`

### Problem Statement
Demonstrate how a forgotten `cancel()` call creates a context leak and how to detect it. Write a leaky function, then fix it. Show how to use `goleak` in tests and `runtime/pprof` goroutine profiling to detect the leak. Add a linter-friendly cancel pattern using `defer`.

### Input / Output / Constraints
```
Input:  leakContext() called 1000 times without cancel
Output: 1000 goroutines leaked (visible via runtime.NumGoroutine())
        Fixed version: goroutine count returns to baseline
Constraints:
  • Demonstrate leak detection with runtime.NumGoroutine()
  • Show fix with defer cancel()
  • Show test-level detection with goleak
```

### Thought Process
1. Understand: Every WithCancel/WithTimeout/WithDeadline creates a child goroutine in the context package that waits for Done. If cancel is never called, it waits forever.
2. Pattern: Always `ctx, cancel := ...; defer cancel()` immediately. In tests use goleak.VerifyNone.
3. Edge cases: Cancel in error path forgotten, cancel inside if block skipped, cancel reassigned in loop.

### Brute Force
```go
// O(1) time, O(1) space — LEAKS: cancel never called
func bruteForce(parent context.Context) context.Context {
	ctx, _ := context.WithCancel(parent) // cancel discarded: LEAK
	return ctx
}
```
**Time:** O(1) | **Space:** O(1) + goroutine leak

### Better Solution
```go
// Better — caller must cancel, but easy to forget
func better(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithCancel(parent)
}
// Caller: ctx, cancel := better(parent); defer cancel()
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"runtime"
	"time"
)

// LEAKY: demonstrates what NOT to do
func leakContext(parent context.Context) context.Context {
	ctx, _ := context.WithTimeout(parent, 10*time.Second) // nolint — intentional demo
	return ctx
	// cancel discarded: goroutine inside context package waits 10s
}

// FIXED: always defer cancel immediately
func fixedContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 10*time.Second)
}

func runLeaky(n int) {
	before := runtime.NumGoroutine()
	for i := 0; i < n; i++ {
		_ = leakContext(context.Background())
	}
	after := runtime.NumGoroutine()
	fmt.Printf("Leaky:  before=%d after=%d leaked=%d\n", before, after, after-before)
}

func runFixed(n int) {
	before := runtime.NumGoroutine()
	for i := 0; i < n; i++ {
		ctx, cancel := fixedContext(context.Background())
		defer cancel() // in real code each call has its own cancel deferred
		_ = ctx
	}
	after := runtime.NumGoroutine()
	fmt.Printf("Fixed:  before=%d after=%d leaked=%d\n", before, after, after-before)
}

func main() {
	runLeaky(100)
	time.Sleep(100 * time.Millisecond) // let scheduler run
	runFixed(100)
}

// --- Test with goleak (example, not runnable standalone) ---
/*
import (
    "testing"
    "go.uber.org/goleak"
)

func TestNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
    defer cancel()
    _ = ctx
}
*/
```
**Time:** O(n) | **Space:** O(n goroutines if leaked)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Each leaked goroutine holds ~2-8KB stack; 1M leaks = 2-8GB RAM exhaustion |
| Edge Cases | cancel inside if-block can be skipped on happy path; always use defer immediately |
| Error Handling | go vet and staticcheck flag `context.WithCancel result not used`; enable in CI |
| Memory | Leaked goroutine holds reference to context chain; prevents GC of all ancestor values |
| Concurrency | goleak.VerifyNone in tests catches leaks from concurrent goroutines spawned in test |

### Visual Explanation
```mermaid
flowchart TD
    A["WithTimeout(parent, 10s)"] --> B["internal context goroutine spawned"]
    B --> C{"cancel() called?"}
    C -->|Yes| D["goroutine exits — no leak"]
    C -->|No — 10s passes| E["timer fires, goroutine exits"]
    E --> F["10s of leak per call"]
    A --> G["cancel discarded → path to D never taken"]
```
```
Trace: leakContext called 100x → 100 goroutines wait 10s each →
       fixedContext with defer cancel → goroutines exit immediately on return
```

### Interviewer Questions
1. Why this approach? — Deferred cancel is fail-safe; runs even on panics (if recover used) and early returns.
2. Can it be optimized? — Staticcheck + go vet catch discarded cancel at compile time; add to CI.
3. Scale to 10M? — 10M leaked goroutines ≈ 20-80GB RAM; context leaks are critical production bugs.
4. Edge cases? — cancel() in a loop: only the last cancel is deferred; all previous contexts leak.
5. Goroutine-safe? — cancel() is goroutine-safe; defer ensures it runs exactly once.
6. Memory impact? — Leaked ctx holds reference to entire parent chain preventing GC.
7. Alternative? — context.WithoutCancel (Go 1.21) for intentional detachment without leak.

### Follow-Up Questions
**Q1:** What does staticcheck say about discarded cancel? **A1:** `the cancel function returned by context.WithCancel should be called, not discarded`.
**Q2:** Does the leak resolve itself? **A2:** Yes — after the timeout fires or parent is cancelled; but may take seconds or minutes.
**Q3:** How to confirm a leak in production? **A3:** Expose pprof endpoint; GET /debug/pprof/goroutine shows all goroutine stacks.
**Q4:** Can defer cancel() run after function returns with goroutine still running? **A4:** Yes — deferred cancel runs when the enclosing function returns, not when spawned goroutines finish.
**Q5:** goleak false positives? **A5:** Use goleak.IgnoreTopFunction to whitelist known background goroutines (e.g., database/sql cleaner).

---

## Q11: Custom Key Type  [Level 4 — Advanced]
> **Tags:** `#context` `#custom-key` `#package-design` `#typed-values`

### Problem Statement
Design a production-grade request metadata package that stores multiple request-scoped values (trace ID, user ID, tenant ID, request start time) in a single context-stored struct. Provide compile-time-safe typed accessors. Demonstrate why a single struct in one WithValue call is better than multiple WithValue calls, and benchmark the lookup cost.

### Input / Output / Constraints
```
Input:  ctx enriched with RequestMeta{TraceID:"t1", UserID:42, TenantID:"acme"}
Output: meta, ok := RequestMetaFrom(ctx) → all fields accessible
Constraints:
  • Single WithValue call for all metadata
  • Typed accessors must return (T, bool), not interface{}
  • Package must be importable without collision risk
```

### Thought Process
1. Understand: Multiple WithValue calls create a linked list O(n) lookup per field; one struct stores all metadata in one node.
2. Pattern: Unexported struct key + exported RequestMeta struct + WithRequestMeta / RequestMetaFrom helpers.
3. Edge cases: Partial metadata (some fields zero), nil ctx, context value of wrong type.

### Brute Force
```go
// O(n) time per lookup, O(n) space — separate WithValue per field
type traceKey struct{}
type userKey  struct{}
func setTrace(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, traceKey{}, id)
}
func setUser(ctx context.Context, id int) context.Context {
	return context.WithValue(ctx, userKey{}, id)
}
// Each lookup walks the list: O(depth)
```
**Time:** O(n) per lookup | **Space:** O(n) nodes

### Better Solution
```go
type metaKey struct{}
type RequestMeta struct {
	TraceID  string
	UserID   int
	TenantID string
}
func WithMeta(ctx context.Context, m RequestMeta) context.Context {
	return context.WithValue(ctx, metaKey{}, m)
}
func MetaFrom(ctx context.Context) (RequestMeta, bool) {
	m, ok := ctx.Value(metaKey{}).(RequestMeta)
	return m, ok
}
```
**Time:** O(depth) for one lookup, all fields O(1) once found | **Space:** O(1) node

### Best Solution
```go
package reqmeta

import (
	"context"
	"time"
)

// metaKey is unexported to prevent cross-package key collision.
type metaKey struct{}

// RequestMeta holds all request-scoped metadata in one allocation.
type RequestMeta struct {
	TraceID   string
	UserID    int64
	TenantID  string
	StartTime time.Time
	IsAdmin   bool
}

// WithRequestMeta stores all metadata in a single context node.
func WithRequestMeta(ctx context.Context, m RequestMeta) context.Context {
	return context.WithValue(ctx, metaKey{}, m)
}

// RequestMetaFrom retrieves metadata; ok=false means not present.
func RequestMetaFrom(ctx context.Context) (RequestMeta, bool) {
	m, ok := ctx.Value(metaKey{}).(RequestMeta)
	return m, ok
}

// TraceIDFrom is a convenience accessor with safe fallback.
func TraceIDFrom(ctx context.Context) string {
	m, ok := RequestMetaFrom(ctx)
	if !ok {
		return "unknown"
	}
	return m.TraceID
}

// --- main package demo ---
package main

import (
	"context"
	"fmt"
	"time"
)

func main() {
	ctx := context.Background()

	meta := RequestMeta{
		TraceID:   "trace-abc-123",
		UserID:    42,
		TenantID:  "acme-corp",
		StartTime: time.Now(),
		IsAdmin:   false,
	}

	ctx = WithRequestMeta(ctx, meta)

	// Retrieve all fields in one lookup
	if m, ok := RequestMetaFrom(ctx); ok {
		fmt.Printf("Trace: %s | User: %d | Tenant: %s | Admin: %v\n",
			m.TraceID, m.UserID, m.TenantID, m.IsAdmin)
	}

	// Convenience accessor
	fmt.Println("TraceID:", TraceIDFrom(ctx))
}
```
**Time:** O(chain depth) | **Space:** O(1) extra node

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | One context node for all metadata; lookup cost O(depth) amortized across all field accesses |
| Edge Cases | Return zero-value struct + false when absent; callers must check ok before using fields |
| Error Handling | Never store errors in context; propagate errors through return values |
| Memory | RequestMeta is a value type; stored by copy; no pointer aliasing issues |
| Concurrency | Stored by value; immutable after WithValue; safe for concurrent reads |

### Visual Explanation
```mermaid
flowchart TD
    A["context.Background()"] --> B["WithRequestMeta(ctx, meta)"]
    B --> C["one context node: key=metaKey{}, value=RequestMeta{...}"]
    C --> D["RequestMetaFrom(ctx)"]
    D --> E["ctx.Value(metaKey{}) → type assert → RequestMeta"]
    E --> F["access TraceID, UserID, TenantID in O(1) after lookup"]
```
```
Trace: one WithValue call → one node in context chain →
       single O(depth) lookup → all fields accessible via struct fields
```

### Interviewer Questions
1. Why this approach? — Single node reduces lookup cost from O(n_fields × depth) to O(depth) once.
2. Can it be optimized? — Put request metadata as early ancestor so chain depth stays shallow.
3. Scale to 10M? — Metadata struct is ~100 bytes; 10M requests × 100B = ~1GB; acceptable.
4. Edge cases? — Nil ctx panics on Value call; always check for nil before passing ctx.
5. Goroutine-safe? — Value type stored by copy; immutable; fully goroutine-safe.
6. Memory impact? — Value copy per WithValue; use pointer if struct >1KB.
7. Alternative? — Explicit function parameters for testability; context values for cross-cutting concerns.

### Follow-Up Questions
**Q1:** Why store a copy not a pointer in context? **A1:** Pointer allows mutation after store, breaking immutability; copy is safer.
**Q2:** When to use pointer in context value? **A2:** Large structs (>512B) or when zero-copy is measured to be a bottleneck.
**Q3:** How to extend metadata without breaking callers? **A3:** Add fields to RequestMeta struct; zero values are safe defaults.
**Q4:** Can two packages accidentally share the same metaKey? **A4:** No — unexported struct types from different packages are distinct even if identically named.
**Q5:** How to test absence of metadata? **A5:** Pass context.Background() (no metadata injected); check ok == false in accessor.

---

## Q12: Graceful Shutdown  [Level 4 — Advanced]
> **Tags:** `#context` `#graceful-shutdown` `#os-signal` `#lifecycle`

### Problem Statement
Build an HTTP server that handles OS signals (SIGINT, SIGTERM) for graceful shutdown. On signal receipt, the server must: stop accepting new connections, wait up to 30 seconds for in-flight requests to complete, cancel all background workers via context, and exit cleanly. Model the full lifecycle with context propagation.

### Input / Output / Constraints
```
Input:  SIGINT received while 2 requests in flight (each 5s)
Output: Server stops accepting; waits ≤30s for in-flight; workers cancelled; clean exit
Constraints:
  • Must use context for worker lifecycle
  • Shutdown timeout must be enforced (not wait forever)
  • Must log each phase of shutdown
```

### Thought Process
1. Understand: signal.NotifyContext creates a context cancelled on OS signal. http.Server.Shutdown accepts a context for deadline. Workers get a separate cancel that fires after server shutdown.
2. Pattern: rootCtx from signal → http.Server.Shutdown(shutdownCtx) → cancel workers.
3. Edge cases: Shutdown ctx expires before all requests drain, double SIGINT (force kill), worker panics during shutdown.

### Brute Force
```go
// O(1) — no graceful shutdown, abrupt exit on signal
func bruteForce() {
	http.ListenAndServe(":8080", nil) // killed instantly on SIGINT
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better() {
	srv := &http.Server{Addr: ":8080"}
	go srv.ListenAndServe()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func backgroundWorker(ctx context.Context, id int) {
	log.Printf("[worker %d] started", id)
	select {
	case <-ctx.Done():
		log.Printf("[worker %d] stopped: %v", id, ctx.Err())
	case <-time.After(1 * time.Hour): // normal long-running work
		log.Printf("[worker %d] done", id)
	}
}

func Run() error {
	// Root context cancelled on SIGINT or SIGTERM
	rootCtx, stop := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Worker context: cancelled after server shuts down
	workerCtx, cancelWorkers := context.WithCancel(rootCtx)
	defer cancelWorkers()

	// Start background workers
	for i := 1; i <= 3; i++ {
		go backgroundWorker(workerCtx, i)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Simulate work; real handler would select on r.Context()
		time.Sleep(2 * time.Second)
		fmt.Fprintln(w, "ok")
	})

	srv := &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}

	// Start server in background
	srvErr := make(chan error, 1)
	go func() {
		log.Println("Server listening on :8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			srvErr <- err
		}
	}()

	// Wait for signal or server error
	select {
	case err := <-srvErr:
		return fmt.Errorf("server error: %w", err)
	case <-rootCtx.Done():
		log.Println("Shutdown signal received")
	}

	// Phase 1: drain in-flight HTTP requests (30s budget)
	shutdownCtx, shutdownCancel := context.WithTimeout(
		context.Background(), 30*time.Second)
	defer shutdownCancel()

	log.Println("Shutting down HTTP server...")
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP shutdown error: %v", err)
	}
	log.Println("HTTP server stopped")

	// Phase 2: cancel background workers
	log.Println("Stopping workers...")
	cancelWorkers()
	time.Sleep(500 * time.Millisecond) // give workers time to log
	log.Println("Shutdown complete")
	return nil
}

func main() {
	if err := Run(); err != nil {
		log.Fatal(err)
	}
}
```
**Time:** O(1) | **Space:** O(workers)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Pattern works for any number of workers; each independently listens on workerCtx.Done() |
| Edge Cases | Double SIGINT (impatient operator): second signal not caught; OS force-kills after 30s |
| Error Handling | Log each shutdown phase; emit metrics for slow shutdown (shutdown_duration_seconds) |
| Memory | Workers cancelled cleanly; no goroutine leaks after shutdown |
| Concurrency | signal.NotifyContext is goroutine-safe; Shutdown blocks until drain complete |

### Visual Explanation
```mermaid
flowchart TD
    A["SIGINT received"] --> B["rootCtx cancelled"]
    B --> C["Phase 1: srv.Shutdown(30s ctx)"]
    C --> D{"In-flight requests done?"}
    D -->|Yes ≤30s| E["HTTP server closed"]
    D -->|Timeout 30s| F["Force close connections"]
    E --> G["Phase 2: cancelWorkers()"]
    F --> G
    G --> H["workerCtx.Done() fires in all workers"]
    H --> I["Workers log and exit"]
    I --> J["Process exits cleanly"]
```
```
Trace: SIGINT → rootCtx done → Shutdown(30s) → in-flight drain →
       cancelWorkers() → all goroutines exit → main returns
```

### Interviewer Questions
1. Why this approach? — signal.NotifyContext + Shutdown is the stdlib-blessed pattern for graceful shutdown.
2. Can it be optimized? — Use errgroup for workers; collect errors during shutdown.
3. Scale to 10M? — Load balancer removes server from rotation before SIGTERM; drain window is the key.
4. Edge cases? — Kubernetes sends SIGTERM then SIGKILL after terminationGracePeriodSeconds; tune shutdown budget accordingly.
5. Goroutine-safe? — signal.NotifyContext and http.Server.Shutdown are goroutine-safe.
6. Memory impact? — No leaks when all cancels are deferred properly.
7. Alternative? — os/signal.Notify with manual channel; fx (Uber DI) lifecycle hooks.

### Follow-Up Questions
**Q1:** What does signal.NotifyContext return? **A1:** (ctx, stop); stop() deregisters the signal handler — always defer it.
**Q2:** What does http.Server.Shutdown do? **A2:** Closes listener, waits for active connections to finish, then returns.
**Q3:** What if Shutdown timeout expires? **A3:** Returns context.DeadlineExceeded; connections are force-closed.
**Q4:** Kubernetes grace period? **A4:** Set terminationGracePeriodSeconds > shutdown budget; default is 30s.
**Q5:** How to wait for workers to fully exit? **A5:** Use sync.WaitGroup in workers; call wg.Wait() before process exit.

---

## Q13: External API Timeout  [Level 4 — Advanced]
> **Tags:** `#context` `#external-api` `#retry` `#timeout` `#circuit-breaker`

### Problem Statement
Implement a resilient external API client that calls a third-party payment gateway. Apply a per-attempt timeout and a total operation budget across retries. If the operation budget is exhausted the function must return immediately without retrying. Distinguish permanent errors (4xx) from transient ones (5xx/timeout) for retry eligibility.

### Input / Output / Constraints
```
Input:  totalBudget=5s, perAttempt=1s, maxRetries=3, gateway returns 500 twice then 200
Output: success on attempt 3 with ~2s elapsed; or "budget exceeded" if all attempts timeout
Constraints:
  • Per-attempt timeout layered on top of total budget context
  • 4xx errors must NOT be retried
  • Must log attempt number and error on each failure
```

### Thought Process
1. Understand: Outer context holds total budget; each attempt gets child context with per-attempt timeout. If outer ctx expires mid-retry, the child fires first (min deadline) and the loop exits.
2. Pattern: outer ctx (total) → loop → child ctx (per-attempt) → http call → classify error → retry or abort.
3. Edge cases: 4xx should not retry, outer budget expires between retries, gateway returns 200 with error body.

### Brute Force
```go
// O(n) time — no per-attempt timeout, retries with full budget
func bruteForce(url string, maxRetries int) error {
	for i := 0; i < maxRetries; i++ {
		resp, err := http.Get(url)
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			return nil
		}
	}
	return errors.New("all retries failed")
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, url string, maxRetries int, perAttempt time.Duration) error {
	for i := 0; i < maxRetries; i++ {
		if ctx.Err() != nil { return ctx.Err() }
		aCtx, cancel := context.WithTimeout(ctx, perAttempt)
		err := callOnce(aCtx, url)
		cancel()
		if err == nil { return nil }
		log.Printf("attempt %d: %v", i+1, err)
	}
	return errors.New("all retries failed")
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

var ErrPermanent = errors.New("permanent error")

// callGateway makes a single HTTP attempt with per-attempt context.
func callGateway(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err // transient: timeout, network
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return nil, fmt.Errorf("%w: status %d", ErrPermanent, resp.StatusCode)
	}
	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("gateway error: status %d", resp.StatusCode)
	}
	return body, nil
}

// CallWithRetry — O(n) time, O(1) space
// Retries transient errors; aborts on permanent errors or budget exhaustion.
func CallWithRetry(
	totalCtx context.Context,
	url string,
	maxRetries int,
	perAttempt time.Duration,
) ([]byte, error) {
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if totalCtx.Err() != nil {
			return nil, fmt.Errorf("budget exhausted before attempt %d: %w",
				attempt, totalCtx.Err())
		}

		aCtx, cancel := context.WithTimeout(totalCtx, perAttempt)
		body, err := callGateway(aCtx, url)
		cancel()

		if err == nil {
			log.Printf("attempt %d: success", attempt)
			return body, nil
		}

		log.Printf("attempt %d: %v", attempt, err)

		// Permanent errors: do not retry
		if errors.Is(err, ErrPermanent) {
			return nil, err
		}
		lastErr = err
	}
	return nil, fmt.Errorf("all %d attempts failed: %w", maxRetries, lastErr)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	body, err := CallWithRetry(ctx, "https://httpbin.org/status/200", 3, 1*time.Second)
	if err != nil {
		log.Println("Error:", err)
		return
	}
	fmt.Printf("Response: %d bytes\n", len(body))
}
```
**Time:** O(maxRetries) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Add exponential backoff with jitter between retries to prevent thundering herd |
| Edge Cases | 429 Too Many Requests: honour Retry-After header before next attempt |
| Error Handling | Wrap errors at each layer; errors.Is traverses chain for ErrPermanent check |
| Memory | No accumulation; each attempt reuses same variables |
| Concurrency | For parallel calls use errgroup; first success cancels siblings |

### Visual Explanation
```mermaid
flowchart TD
    A["CallWithRetry(totalCtx 5s, url, retries=3, 1s)"] --> B["attempt 1"]
    B --> C["child ctx = min(totalCtx, now+1s)"]
    C --> D["callGateway → 500"]
    D --> E{"permanent?"}
    E -->|No| F["log, increment attempt"]
    F --> G["totalCtx.Err()?"]
    G -->|Yes| H["return budget exhausted"]
    G -->|No| B
    E -->|Yes| I["return ErrPermanent immediately"]
    D -->|200| J["return body, nil"]
```
```
Trace: attempt1 500 → attempt2 500 → attempt3 200 → return body
       OR: totalCtx expires mid-loop → return budget exhausted
```

### Interviewer Questions
1. Why this approach? — Composing per-attempt timeout on total budget ensures neither exceeds its budget.
2. Can it be optimized? — Add exponential backoff; use circuit breaker (gobreaker) to fast-fail.
3. Scale to 10M? — Backoff + jitter prevents synchronized retry storms; circuit breaker reduces load on degraded upstream.
4. Edge cases? — Retry on 408 Request Timeout; not on 400 Bad Request; check each 4xx individually.
5. Goroutine-safe? — Stateless function; safe for concurrent callers with independent contexts.
6. Memory impact? — Each attempt allocates one request + response buffer; GC'd after attempt.
7. Alternative? — hashicorp/go-retryablehttp for batteries-included retry with backoff.

### Follow-Up Questions
**Q1:** What is thundering herd? **A1:** All retries hitting the server simultaneously after a failure window; fixed with jitter.
**Q2:** How to implement exponential backoff? **A2:** `sleep = baseDelay * 2^attempt + rand.Intn(jitter)`; check ctx before sleep.
**Q3:** What is a circuit breaker? **A3:** After N consecutive failures, fast-fail without calling upstream for a cooldown period.
**Q4:** How to honour Retry-After header? **A4:** Parse header value, create a timer, select on timer and ctx.Done().
**Q5:** Idempotency on retry? **A5:** Assign idempotency key (UUID) on first attempt; send same key on retries so gateway deduplicates.

---

## Q14: Testing Cancellation  [Level 5 — Interview]
> **Tags:** `#context` `#testing` `#cancellation` `#table-driven` `#goleak`

### Problem Statement
Write comprehensive tests for a context-aware worker function. Cover: normal completion, cancellation before start, cancellation mid-execution, timeout expiry, and goroutine leak detection. Use table-driven tests, `testing/quick` for property testing, and `goleak` for leak detection. Demonstrate how to inject fake clocks for deterministic timeout tests.

### Input / Output / Constraints
```
Input:  table of scenarios: {name, setupCtx, expectErr, expectResult}
Output: all scenarios pass; goleak reports zero leaked goroutines after each test
Constraints:
  • Must test cancellation mid-execution (not just at start)
  • Must verify goroutine count returns to baseline
  • Must use t.Parallel() for independent test cases
```

### Thought Process
1. Understand: Testing context-aware code requires controlling when cancellation fires relative to work progress.
2. Pattern: Table-driven tests; goroutine with sync point to cancel mid-execution; goleak.VerifyTestMain for suite-level leak check.
3. Edge cases: Race between cancel and completion, test timeout vs ctx timeout, test isolation.

### Brute Force
```go
// Single test, no table, no leak detection
func TestWorker(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately
	err := DoWork(ctx)
	if err == nil {
		t.Error("expected error")
	}
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func TestWorker_Cancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := ProcessItems(ctx, []int{1,2,3})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("want Canceled, got %v", err)
	}
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package worker_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.uber.org/goleak"
)

// ProcessItems is the function under test (defined in worker package).
func ProcessItems(ctx context.Context, items []int) ([]int, error) {
	results := make([]int, 0, len(items))
	for _, item := range items {
		select {
		case <-ctx.Done():
			return results, ctx.Err()
		default:
			time.Sleep(10 * time.Millisecond) // simulate work
			results = append(results, item*2)
		}
	}
	return results, nil
}

func TestMain(m *testing.M) {
	// goleak checks for leaked goroutines after all tests complete
	goleak.VerifyTestMain(m)
}

func TestProcessItems(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		items      []int
		setupCtx   func() (context.Context, context.CancelFunc)
		wantErr    error
		wantLen    int
	}{
		{
			name:  "normal completion",
			items: []int{1, 2, 3},
			setupCtx: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 1*time.Second)
			},
			wantErr: nil,
			wantLen: 3,
		},
		{
			name:  "cancelled before start",
			items: []int{1, 2, 3},
			setupCtx: func() (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel() // pre-cancelled
				return ctx, cancel
			},
			wantErr: context.Canceled,
			wantLen: 0,
		},
		{
			name:  "timeout mid-execution",
			items: []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10},
			setupCtx: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 35*time.Millisecond)
			},
			wantErr: context.DeadlineExceeded,
			wantLen: -1, // partial; don't check exact count
		},
		{
			name:  "empty items",
			items: []int{},
			setupCtx: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 1*time.Second)
			},
			wantErr: nil,
			wantLen: 0,
		},
	}

	for _, tc := range tests {
		tc := tc // capture range variable
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctx, cancel := tc.setupCtx()
			defer cancel()

			results, err := ProcessItems(ctx, tc.items)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("want error %v, got %v", tc.wantErr, err)
				}
			} else if err != nil {
				t.Errorf("unexpected error: %v", err)
			}

			if tc.wantLen >= 0 && len(results) != tc.wantLen {
				t.Errorf("want %d results, got %d", tc.wantLen, len(results))
			}
		})
	}
}

// TestCancelMidExecution verifies partial results returned on mid-run cancel.
func TestCancelMidExecution(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel after 25ms — should interrupt after ~2 items (each 10ms)
	go func() {
		time.Sleep(25 * time.Millisecond)
		cancel()
	}()

	items := make([]int, 20)
	for i := range items { items[i] = i + 1 }

	results, err := ProcessItems(ctx, items)

	if !errors.Is(err, context.Canceled) {
		t.Errorf("want Canceled, got %v", err)
	}
	if len(results) == 0 || len(results) >= len(items) {
		t.Errorf("want partial results, got %d out of %d", len(results), len(items))
	}
	t.Logf("processed %d/%d items before cancel", len(results), len(items))
}
```
**Time:** O(n) per test | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | t.Parallel() runs tests concurrently; ensure test helpers are goroutine-safe |
| Edge Cases | goleak.VerifyTestMain catches leaks from all test cases including subtests |
| Error Handling | errors.Is traverses wrapped errors; never compare errors with == |
| Memory | Use -race flag to detect data races alongside context cancellation |
| Concurrency | `tc := tc` loop variable capture is critical before t.Parallel() |

### Visual Explanation
```mermaid
flowchart TD
    A["TestMain"] --> B["goleak.VerifyTestMain(m)"]
    B --> C["run all tests"]
    C --> D["TestProcessItems table"]
    D --> E["each sub-test: t.Parallel()"]
    E --> F["setupCtx()"]
    F --> G["ProcessItems(ctx, items)"]
    G --> H["assert err and len"]
    H --> I["cancel() deferred"]
    B --> J["after all tests: check goroutine count"]
    J --> K{"leaked goroutines?"}
    K -->|Yes| L["test FAIL"]
    K -->|No| M["test PASS"]
```
```
Trace: TestMain → all parallel subtests → each defers cancel →
       goleak checks post-test goroutine count → zero leaks → PASS
```

### Interviewer Questions
1. Why this approach? — Table-driven tests cover all scenarios without code duplication; goleak catches bugs invisible to assertions.
2. Can it be optimized? — Use httptest.Server for real HTTP context tests; testcontainers for DB context tests.
3. Scale to 10M? — Test parallelism via -parallel flag; benchmark with b.N iterations.
4. Edge cases? — `tc := tc` capture required before t.Parallel(); missing it causes all subtests to run the last tc.
5. Goroutine-safe? — Each subtest has independent ctx; no shared state.
6. Memory impact? — goleak holds goroutine snapshot; negligible overhead.
7. Alternative? — context/canceltest from Go team's experimental packages.

### Follow-Up Questions
**Q1:** What is goleak.VerifyTestMain? **A1:** Runs all tests, then checks goroutine count vs baseline; fails if any leaked.
**Q2:** Why `tc := tc` before t.Parallel()? **A2:** Range reuses loop variable; capture creates per-iteration copy.
**Q3:** How to test a timeout without time.Sleep? **A3:** Inject a fake clock (clock interface); advance it in tests.
**Q4:** errors.Is vs == for context errors? **A4:** Always use errors.Is; wrapped errors with %w are not == but are matched by Is.
**Q5:** How to detect data races in context tests? **A5:** Run `go test -race`; context package itself is race-free.

---

## Q15: Context in gRPC / Microservices  [Level 5 — Interview]
> **Tags:** `#context` `#grpc` `#microservices` `#deadline-propagation` `#metadata`

### Problem Statement
Design a microservice call chain where Service A calls Service B via gRPC, which calls Service C. The original HTTP request's deadline must propagate through all three services. If Service A's client has a 3s overall deadline, Service B and C must both respect it and cancel automatically. Show how gRPC propagates deadlines and how to extract/re-attach context metadata.

### Input / Output / Constraints
```
Input:  HTTP request to Service A with 3s deadline; B takes 1s, C takes 3s
Output: C is cancelled at T+3s from original deadline; B returns error to A
Constraints:
  • gRPC client must use ctx (not background) to propagate deadline
  • Metadata (trace ID) must be threaded through all hops
  • Must handle context.DeadlineExceeded from downstream
```

### Thought Process
1. Understand: gRPC passes context deadline as a wire-level deadline header; server-side creates a ctx that is cancelled when that deadline fires. No manual plumbing needed.
2. Pattern: Pass ctx from HTTP handler → gRPC call to B (ctx propagated) → gRPC call to C (ctx propagated).
3. Edge cases: Deadline already expired before RPC call, metadata stripping at gateway, local deadline tighter than propagated one.

### Brute Force
```go
// O(1) — ignores context; B and C get unlimited time
func bruteForce(client pb.ServiceBClient) {
	resp, err := client.DoWork(context.Background(), &pb.Request{}) // BAD
	_ = resp; _ = err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, client pb.ServiceBClient) (*pb.Response, error) {
	return client.DoWork(ctx, &pb.Request{}) // deadline propagated automatically
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const traceIDKey = "x-trace-id"

// --- Service A: HTTP handler calling Service B via gRPC ---

type ServiceAHandler struct {
	bConn *grpc.ClientConn
}

func (h *ServiceAHandler) Handle(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context() // already has HTTP deadline

	// Inject trace ID into outgoing gRPC metadata
	traceID := r.Header.Get("X-Trace-ID")
	if traceID == "" {
		traceID = fmt.Sprintf("trace-%d", time.Now().UnixNano())
	}
	ctx = metadata.AppendToOutgoingContext(ctx, traceIDKey, traceID)

	log.Printf("[A] calling B, traceID=%s", traceID)

	// gRPC call propagates ctx deadline automatically
	resp, err := callServiceB(ctx, h.bConn)
	if err != nil {
		st, _ := status.FromError(err)
		if st.Code() == codes.DeadlineExceeded {
			log.Printf("[A] B deadline exceeded: %v", err)
			http.Error(w, "upstream timeout", http.StatusGatewayTimeout)
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	fmt.Fprintln(w, resp)
}

func callServiceB(ctx context.Context, conn *grpc.ClientConn) (string, error) {
	// Simulated gRPC call — in real code: pb.NewServiceBClient(conn).DoWork(ctx, req)
	select {
	case <-ctx.Done():
		return "", status.FromContextError(ctx.Err()).Err()
	case <-time.After(1 * time.Second): // B's own work
		return callServiceC(ctx)
	}
}

func callServiceC(ctx context.Context) (string, error) {
	// Extract trace ID from incoming metadata (on server side)
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		if ids := md.Get(traceIDKey); len(ids) > 0 {
			log.Printf("[C] traceID=%s", ids[0])
		}
	}
	select {
	case <-ctx.Done():
		return "", status.FromContextError(ctx.Err()).Err()
	case <-time.After(3 * time.Second): // C is slow
		return "result from C", nil
	}
}

// --- Demo ---
func main() {
	// Simulate HTTP request with 3s deadline
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	ctx = metadata.AppendToOutgoingContext(ctx, traceIDKey, "trace-demo-001")
	log.Printf("[A] starting with 3s deadline")

	result, err := callServiceB(ctx, nil)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			log.Println("[A] deadline exceeded:", err)
		} else {
			log.Println("[A] error:", err)
		}
		return
	}
	fmt.Println("Result:", result)
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | gRPC deadline propagation is wire-native; no extra serialization overhead |
| Edge Cases | API gateway may strip deadlines; use middleware to re-inject from X-Request-Timeout header |
| Error Handling | status.FromContextError maps ctx.Err() to gRPC status codes (DeadlineExceeded, Canceled) |
| Memory | metadata propagated as HTTP/2 headers; minimal overhead |
| Concurrency | Each gRPC call has independent ctx; no shared state across RPCs |

### Visual Explanation
```mermaid
flowchart TD
    A["HTTP Client: deadline=3s"] --> B["Service A: r.Context() has 3s"]
    B --> C["gRPC call to B with ctx"]
    C --> D["gRPC wire: deadline header set"]
    D --> E["Service B: server ctx = remaining deadline"]
    E --> F["gRPC call to C with ctx"]
    F --> G["Service C: server ctx = remaining deadline"]
    G --> H{"work done before deadline?"}
    H -->|No — 3s elapsed| I["ctx.Done fires in C"]
    I --> J["C returns DeadlineExceeded"]
    J --> K["B propagates to A"]
    K --> L["A returns 504"]
```
```
Trace: A(3s) → B gRPC(~3s remaining) → C gRPC(~2s remaining after B's 1s) →
       C slow(3s) but only 2s budget → ctx.Done → error chain → A 504
```

### Interviewer Questions
1. Why this approach? — gRPC propagates deadline on the wire; no manual plumbing; ctx-first API enforces it.
2. Can it be optimized? — Use local deadline slightly shorter than propagated to ensure local cleanup before upstream gives up.
3. Scale to 10M? — Service mesh (Istio) enforces timeouts at proxy level; gRPC deadline is belt-and-suspenders.
4. Edge cases? — Deadline already expired before RPC; gRPC returns DeadlineExceeded immediately without network call.
5. Goroutine-safe? — metadata and ctx are goroutine-safe; gRPC client is goroutine-safe.
6. Memory impact? — Metadata propagated as HTTP/2 headers; negligible.
7. Alternative? — OpenTelemetry propagation for trace IDs; W3C TraceContext standard.

### Follow-Up Questions
**Q1:** How does gRPC know the deadline on the server side? **A1:** It reads the grpc-timeout header on the wire and creates a context with that remaining duration.
**Q2:** What gRPC status code maps to DeadlineExceeded? **A2:** codes.DeadlineExceeded.
**Q3:** How to add metadata on gRPC server response? **A3:** grpc.SetHeader(ctx, md) or grpc.SendHeader(ctx, md).
**Q4:** What is metadata.FromIncomingContext? **A4:** Extracts metadata map from server-side ctx populated by gRPC framework.
**Q5:** How does Istio add to context timeout? **A5:** Envoy proxy enforces route-level timeouts independently; gRPC context deadline is per-call.

---

## Q16: Preventing Context Leak in Long-Lived Services  [Level 5 — Interview]
> **Tags:** `#context` `#leak-prevention` `#long-lived` `#background-tasks`

### Problem Statement
A background job scheduler spawns tasks that use `context.WithCancel`. Tasks are registered dynamically and must be cancelled individually or all at once on shutdown. Implement a registry that tracks all active task contexts and cancels them cleanly on demand, without leaking goroutines or context nodes.

### Input / Output / Constraints
```
Input:  register 5 tasks; cancel task 2 individually; then cancel all on shutdown
Output: task 2 logs "cancelled"; remaining 4 log "cancelled" on shutdown; zero leaks
Constraints:
  • Must cancel individual tasks without affecting others
  • Must cancel all remaining tasks on shutdown
  • Must be goroutine-safe (concurrent registration/cancellation)
```

### Thought Process
1. Understand: Each task needs its own cancel func; registry holds a map of ID→cancel. Shutdown iterates map and calls all cancels.
2. Pattern: sync.Mutex guarded map[int]context.CancelFunc; register returns cancel; deregister removes on task exit.
3. Edge cases: Cancel called after task already exited, shutdown races with registration, duplicate IDs.

### Brute Force
```go
// O(n) — global slice, no individual cancel, no goroutine-safety
var cancels []context.CancelFunc
func register(ctx context.Context) context.Context {
	c, cancel := context.WithCancel(ctx)
	cancels = append(cancels, cancel)
	return c
}
func cancelAll() { for _, c := range cancels { c() } }
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
type Registry struct {
	mu      sync.Mutex
	cancels map[int]context.CancelFunc
	next    int
}
func (r *Registry) Register(parent context.Context) (context.Context, int) {
	ctx, cancel := context.WithCancel(parent)
	r.mu.Lock()
	id := r.next; r.next++
	r.cancels[id] = cancel
	r.mu.Unlock()
	return ctx, id
}
func (r *Registry) Cancel(id int) {
	r.mu.Lock(); defer r.mu.Unlock()
	if c, ok := r.cancels[id]; ok { c(); delete(r.cancels, id) }
}
func (r *Registry) Shutdown() {
	r.mu.Lock(); defer r.mu.Unlock()
	for id, c := range r.cancels { c(); delete(r.cancels, id) }
}
```
**Time:** O(1) register/cancel, O(n) shutdown | **Space:** O(n)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// TaskRegistry manages cancellable task contexts.
type TaskRegistry struct {
	mu      sync.Mutex
	tasks   map[int]context.CancelFunc
	nextID  int
	parent  context.Context
}

func NewTaskRegistry(parent context.Context) *TaskRegistry {
	return &TaskRegistry{
		tasks:  make(map[int]context.CancelFunc),
		parent: parent,
	}
}

// Register creates a child context for a new task and returns (ctx, id).
func (r *TaskRegistry) Register() (context.Context, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ctx, cancel := context.WithCancel(r.parent)
	id := r.nextID
	r.nextID++
	r.tasks[id] = cancel
	return ctx, id
}

// Deregister removes a task after it exits (prevents accumulation).
func (r *TaskRegistry) Deregister(id int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cancel, ok := r.tasks[id]; ok {
		cancel() // ensure cancel called even if caller forgot
		delete(r.tasks, id)
	}
}

// CancelTask cancels one task by ID.
func (r *TaskRegistry) CancelTask(id int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cancel, ok := r.tasks[id]; ok {
		cancel()
		delete(r.tasks, id)
	}
}

// Shutdown cancels all remaining tasks.
func (r *TaskRegistry) Shutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, cancel := range r.tasks {
		cancel()
		delete(r.tasks, id)
	}
}

func runTask(ctx context.Context, id int, wg *sync.WaitGroup, reg *TaskRegistry) {
	defer wg.Done()
	defer reg.Deregister(id)
	select {
	case <-ctx.Done():
		fmt.Printf("task %d: %v\n", id, ctx.Err())
	case <-time.After(10 * time.Second):
		fmt.Printf("task %d: completed\n", id)
	}
}

func main() {
	rootCtx := context.Background()
	reg := NewTaskRegistry(rootCtx)
	var wg sync.WaitGroup

	// Register 5 tasks
	for i := 0; i < 5; i++ {
		ctx, id := reg.Register()
		wg.Add(1)
		go runTask(ctx, id, &wg, reg)
	}

	time.Sleep(100 * time.Millisecond)

	// Cancel task 2 individually
	fmt.Println("Cancelling task 2...")
	reg.CancelTask(2)
	time.Sleep(50 * time.Millisecond)

	// Shutdown remaining tasks
	fmt.Println("Shutting down all...")
	reg.Shutdown()

	wg.Wait()
	fmt.Println("All tasks stopped")
}
```
**Time:** O(1) amortized | **Space:** O(n active tasks)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | O(1) per register/cancel; O(n) shutdown is acceptable since it happens once |
| Edge Cases | Deregister must call cancel to prevent leak if task exits via non-cancel path |
| Error Handling | If parent context cancelled, all child ctxs automatically cancel; Shutdown still runs for cleanup |
| Memory | Map grows with active tasks; shrinks via Deregister; bounded by max concurrent tasks |
| Concurrency | sync.Mutex protects map; cancel funcs are goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["NewTaskRegistry(rootCtx)"] --> B["Register(): child ctx, id"]
    B --> C["map[id] = cancel"]
    C --> D["go runTask(ctx, id)"]
    D --> E{"ctx.Done or timeout"}
    E -->|ctx.Done| F["task logs cancelled"]
    F --> G["Deregister(id) → cancel + delete"]
    A --> H["CancelTask(2) → cancel + delete"]
    A --> I["Shutdown() → cancel all + clear map"]
```
```
Trace: 5 tasks registered → task2 individually cancelled →
       remaining 4 cancelled by Shutdown → wg.Wait → all goroutines exit
```

### Interviewer Questions
1. Why this approach? — Registry centralises lifecycle management; individual + bulk cancel without leaks.
2. Can it be optimized? — sync.Map for higher concurrency; shard the map by ID range.
3. Scale to 10M? — shard registry into N buckets; each bucket has own mutex.
4. Edge cases? — Parent ctx cancelled: all children auto-cancel; Shutdown is still safe (cancels already-cancelled = no-op).
5. Goroutine-safe? — Mutex guards all map access.
6. Memory impact? — One map entry per active task; Deregister keeps map lean.
7. Alternative? — errgroup tracks goroutines but not individual cancellation; suitable for different use case.

### Follow-Up Questions
**Q1:** What if Deregister is called twice? **A1:** Second call is a no-op; key already deleted.
**Q2:** What if parent ctx cancelled before Shutdown? **A2:** All children auto-cancel via tree propagation; Shutdown clears the map.
**Q3:** Can tasks register their own sub-tasks? **A3:** Yes — pass their ctx as parent for nested registry.
**Q4:** How to get count of active tasks? **A4:** `r.mu.Lock(); n := len(r.tasks); r.mu.Unlock(); return n`.
**Q5:** How to await a specific task? **A5:** Return a done channel from Register; close it in runTask before Deregister.

---

## Q17: Context with Rate Limiting  [Level 5 — Interview]
> **Tags:** `#context` `#rate-limit` `#token-bucket` `#select`

### Problem Statement
Implement a context-aware rate-limited worker that processes jobs at most N per second using a token bucket. If the context is cancelled while waiting for a token, the worker must exit immediately without blocking. Show how context and rate limiting compose using `golang.org/x/time/rate`.

### Input / Output / Constraints
```
Input:  rate=2/s, burst=1, jobs=[1..10], cancel() at T+2s
Output: 4-5 jobs processed (2/s × 2s); remaining log "rate wait cancelled"
Constraints:
  • Must use rate.Limiter.Wait(ctx) not Sleep
  • Cancellation during Wait must return immediately
  • Must not process jobs faster than rate
```

### Thought Process
1. Understand: rate.Limiter.Wait(ctx) blocks until a token is available OR ctx is cancelled. This composes context cancellation with rate limiting cleanly.
2. Pattern: Create limiter; loop over jobs; call limiter.Wait(ctx); process if no error.
3. Edge cases: Burst allows first N jobs immediately, ctx cancelled mid-Wait, zero rate.

### Brute Force
```go
// O(n) — time.Sleep for rate limiting, cannot be cancelled mid-sleep
func bruteForce(jobs []int, perSec int) {
	interval := time.Second / time.Duration(perSec)
	for _, job := range jobs {
		time.Sleep(interval)
		fmt.Println("processed", job)
	}
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, jobs []int, r *rate.Limiter) error {
	for _, job := range jobs {
		if err := r.Wait(ctx); err != nil {
			return err
		}
		fmt.Println("processed", job)
	}
	return nil
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"golang.org/x/time/rate"
)

// RateLimitedWorker — O(n) time, O(1) space
// Processes jobs at ≤ rate/s; exits immediately on ctx cancellation.
func RateLimitedWorker(
	ctx context.Context,
	jobs []int,
	limiter *rate.Limiter,
) (processed int, err error) {
	for _, job := range jobs {
		// Wait for token; returns immediately if ctx cancelled
		if err := limiter.Wait(ctx); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				fmt.Printf("rate wait cancelled after %d jobs: %v\n", processed, err)
				return processed, err
			}
			return processed, fmt.Errorf("rate limiter: %w", err)
		}
		processed++
		fmt.Printf("job %d processed (total: %d)\n", job, processed)
	}
	return processed, nil
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())

	// 2 tokens/sec, burst of 1
	limiter := rate.NewLimiter(rate.Limit(2), 1)

	jobs := make([]int, 10)
	for i := range jobs { jobs[i] = i + 1 }

	// Cancel after 2 seconds
	go func() {
		time.Sleep(2 * time.Second)
		fmt.Println("cancelling...")
		cancel()
	}()

	n, err := RateLimitedWorker(ctx, jobs, limiter)
	fmt.Printf("processed %d jobs, err: %v\n", n, err)
}
```
**Time:** O(n) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | rate.Limiter is goroutine-safe; share one limiter across worker pool for global rate |
| Edge Cases | rate.Limiter.Reserve().Cancel() to return unused tokens if work is abandoned |
| Error Handling | limiter.Wait returns ctx error on cancellation; distinguish from internal limiter errors |
| Memory | Limiter is ~64 bytes; one per service endpoint |
| Concurrency | Multiple goroutines sharing one limiter enforces aggregate rate automatically |

### Visual Explanation
```mermaid
flowchart TD
    A["RateLimitedWorker(ctx, jobs, 2/s)"] --> B["job 1: limiter.Wait(ctx)"]
    B --> C{"token available?"}
    C -->|Yes| D["process job"]
    C -->|No| E{"ctx cancelled while waiting?"}
    E -->|Yes| F["return processed, ctx.Err()"]
    E -->|No| G["wait for token"]
    G --> C
    D --> H["next job"]
    H --> B
```
```
Trace: burst=1 → job1 immediate → job2 at 500ms → job3 at 1s →
       job4 at 1.5s → job5 at 2s → cancel() → Wait returns Canceled
```

### Interviewer Questions
1. Why this approach? — limiter.Wait(ctx) is the idiomatic compose point; single select statement handles both.
2. Can it be optimized? — Use limiter.Allow() for non-blocking; shed load when token unavailable.
3. Scale to 10M? — Distributed rate limiting via Redis (go-redis + sliding window); local limiter per pod.
4. Edge cases? — Burst > 0 allows initial spike; set burst=1 for strict rate.
5. Goroutine-safe? — rate.Limiter is goroutine-safe.
6. Memory impact? — One limiter ~64 bytes; negligible.
7. Alternative? — Channel-based ticker; time.NewTicker + select; less flexible than token bucket.

### Follow-Up Questions
**Q1:** Difference between rate.Limit and burst? **A1:** rate.Limit = tokens/second refill rate; burst = max tokens that can accumulate.
**Q2:** What does limiter.Allow() do? **A2:** Returns true if token available now; false otherwise — non-blocking.
**Q3:** Distributed rate limiting? **A3:** Redis INCR with expiry (fixed window) or Lua script (sliding window).
**Q4:** What is token bucket vs leaky bucket? **A4:** Token bucket allows bursting up to burst size; leaky bucket smooths output to fixed rate.
**Q5:** How to share limiter across services? **A5:** Single limiter process (sidecar) or Redis-backed; local limiter per replica for pod-level rate.

---

## Q18: Context Propagation in Worker Pools  [Level 6 — Production]
> **Tags:** `#context` `#worker-pool` `#production` `#errgroup` `#fan-out`

### Problem Statement
Build a production-grade parallel file processor using a worker pool pattern with `errgroup.WithContext`. The pool must: process N files concurrently, cancel all workers on the first error, respect an overall deadline context passed from the caller, and report which file caused the error. This is the pattern used in data pipelines and batch processing services.

### Input / Output / Constraints
```
Input:  files=["a.txt","b.txt","c.txt","d.txt"], maxWorkers=2, one file errors
Output: error includes failing filename; remaining in-flight workers cancelled
Constraints:
  • Must use errgroup.WithContext (not manual WaitGroup+channel)
  • First error cancels all other workers via context
  • Must not process more than maxWorkers files concurrently
```

### Thought Process
1. Understand: errgroup.WithContext creates a context that is cancelled when any goroutine returns a non-nil error. All other goroutines check ctx.Done() and exit.
2. Pattern: Semaphore channel for concurrency control; errgroup for error aggregation + cancellation.
3. Edge cases: All files error simultaneously, semaphore deadlock, file not found vs permission error.

### Brute Force
```go
// O(n) — sequential, no parallelism, no error cancellation
func bruteForce(files []string) error {
	for _, f := range files {
		if err := processFile(f); err != nil {
			return err
		}
	}
	return nil
}
```
**Time:** O(n) sequential | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, files []string, workers int) error {
	g, gCtx := errgroup.WithContext(ctx)
	sem := make(chan struct{}, workers)
	for _, f := range files {
		f := f
		g.Go(func() error {
			sem <- struct{}{}
			defer func() { <-sem }()
			return processFile(gCtx, f)
		})
	}
	return g.Wait()
}
```
**Time:** O(n/workers) | **Space:** O(workers)

### Best Solution
```go
package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"

	"golang.org/x/sync/errgroup"
)

// processFile simulates file processing; fails randomly for demo.
func processFile(ctx context.Context, name string) error {
	select {
	case <-ctx.Done():
		log.Printf("[%s] cancelled: %v", name, ctx.Err())
		return ctx.Err()
	case <-time.After(time.Duration(rand.Intn(500)+100) * time.Millisecond):
	}

	// Simulate one file failing
	if name == "c.txt" {
		return fmt.Errorf("processing %s: permission denied", name)
	}
	log.Printf("[%s] done", name)
	return nil
}

// ProcessFiles — O(n/maxWorkers) time, O(maxWorkers) space
// Processes files in parallel; cancels all on first error.
func ProcessFiles(
	ctx context.Context,
	files []string,
	maxWorkers int,
) error {
	// errgroup ctx is cancelled when any goroutine returns error
	g, gCtx := errgroup.WithContext(ctx)

	// Semaphore channel limits concurrency to maxWorkers
	sem := make(chan struct{}, maxWorkers)

	for _, file := range files {
		file := file // capture loop variable
		g.Go(func() error {
			// Acquire semaphore slot
			select {
			case sem <- struct{}{}:
			case <-gCtx.Done():
				return gCtx.Err()
			}
			defer func() { <-sem }() // release slot

			return processFile(gCtx, file)
		})
	}

	// Wait returns first non-nil error; gCtx already cancelled by then
	if err := g.Wait(); err != nil {
		return fmt.Errorf("batch processing failed: %w", err)
	}
	return nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	files := []string{"a.txt", "b.txt", "c.txt", "d.txt", "e.txt"}
	if err := ProcessFiles(ctx, files, 2); err != nil {
		log.Println("Error:", err)
		return
	}
	log.Println("All files processed successfully")
}
```
**Time:** O(n/maxWorkers) | **Space:** O(maxWorkers)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | maxWorkers tuned to I/O concurrency (files: disk IOPS); CPU-bound: GOMAXPROCS |
| Edge Cases | Semaphore acquire must also select on gCtx.Done() to avoid blocking after error cancellation |
| Error Handling | errgroup returns first error; all errors via multierr if all errors needed |
| Memory | Semaphore channel = maxWorkers slots; one goroutine per file bounded by semaphore |
| Concurrency | errgroup is goroutine-safe; context cancellation is broadcast to all workers |

### Visual Explanation
```mermaid
flowchart TD
    A["ProcessFiles(ctx, files, 2)"] --> B["errgroup.WithContext → gCtx"]
    B --> C["for each file: g.Go(...)"]
    C --> D["sem acquire (max 2 concurrent)"]
    D --> E["processFile(gCtx, file)"]
    E --> F{"error?"}
    F -->|Yes c.txt| G["errgroup cancels gCtx"]
    G --> H["other workers: ctx.Done fires"]
    H --> I["workers return ctx.Err()"]
    F -->|No| J["log done, release sem"]
    I --> K["g.Wait() returns first error"]
    J --> K
```
```
Trace: a.txt + b.txt start (sem=2) → b.txt done → c.txt starts → c.txt errors →
       gCtx cancelled → d.txt sees ctx.Done in sem-acquire → g.Wait returns error
```

### Interviewer Questions
1. Why this approach? — errgroup provides automatic context cancellation on first error; cleaner than manual WaitGroup+channel.
2. Can it be optimized? — Pre-sort files by size (smallest first) for better work distribution.
3. Scale to 10M? — Stream files from object storage; dynamically adjust maxWorkers based on queue depth.
4. Edge cases? — If semaphore acquire doesn't check gCtx.Done(), workers block after error cancellation.
5. Goroutine-safe? — errgroup, channels, and context are all goroutine-safe.
6. Memory impact? — One goroutine per file; bounded by maxWorkers active at a time.
7. Alternative? — conc.WaitGroup from sourcegraph/conc; ants goroutine pool.

### Follow-Up Questions
**Q1:** Does errgroup.Wait return all errors? **A1:** No — only first non-nil error; use multierr or custom error channel for all errors.
**Q2:** What happens to goroutines still running when Wait returns? **A2:** They continue running; gCtx is cancelled so they should exit via ctx.Done() check.
**Q3:** How to collect all errors? **A3:** Use error channel with buffer len(files); collect in Wait loop.
**Q4:** errgroup vs sync.WaitGroup? **A4:** errgroup adds context cancellation on first error; WaitGroup is simpler for error-free scenarios.
**Q5:** How to add progress reporting? **A5:** Send completed count to a channel; read in a progress goroutine.

---

## Q19: Context-Aware Circuit Breaker  [Level 6 — Production]
> **Tags:** `#context` `#circuit-breaker` `#resilience` `#production` `#state-machine`

### Problem Statement
Implement a context-aware circuit breaker that wraps external API calls. The circuit breaker has three states: Closed (normal), Open (fast-fail), HalfOpen (probe). Context cancellation must be respected in all states. If the context is cancelled while the circuit is open, return immediately without waiting for the reset timer. Track failure counts and reset windows using context deadlines.

### Input / Output / Constraints
```
Input:  threshold=3 failures, resetWindow=5s; 3 failures → Open; probe success → Closed
Output: Open state returns ErrCircuitOpen immediately; HalfOpen allows one probe
Constraints:
  • ctx cancellation must short-circuit all state waits
  • Thread-safe state transitions
  • Must expose state for monitoring
```

### Thought Process
1. Understand: Circuit breaker is a state machine; context adds time boundaries to state transitions. Open state waits for reset timer OR ctx.Done.
2. Pattern: sync.Mutex for state; context for reset window enforcement; atomic counter for failures.
3. Edge cases: Concurrent probes in HalfOpen, failure during HalfOpen (re-open), ctx expires in Closed state.

### Brute Force
```go
// O(1) — no circuit breaker, all calls pass through
func bruteForce(ctx context.Context, fn func() error) error {
	return fn()
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
type CB struct {
	mu         sync.Mutex
	failures   int
	threshold  int
	openUntil  time.Time
}
func (cb *CB) Do(fn func() error) error {
	cb.mu.Lock()
	if cb.failures >= cb.threshold && time.Now().Before(cb.openUntil) {
		cb.mu.Unlock()
		return errors.New("circuit open")
	}
	cb.mu.Unlock()
	err := fn()
	cb.mu.Lock(); defer cb.mu.Unlock()
	if err != nil { cb.failures++; cb.openUntil = time.Now().Add(5*time.Second) }
	return err
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

type State int

const (
	StateClosed   State = iota
	StateOpen
	StateHalfOpen
)

var ErrCircuitOpen = errors.New("circuit breaker open")

type CircuitBreaker struct {
	mu          sync.Mutex
	state       State
	failures    int
	threshold   int
	resetWindow time.Duration
	nextReset   time.Time
}

func NewCircuitBreaker(threshold int, resetWindow time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		threshold:   threshold,
		resetWindow: resetWindow,
		state:       StateClosed,
	}
}

func (cb *CircuitBreaker) State() State {
	cb.mu.Lock(); defer cb.mu.Unlock()
	return cb.state
}

// Do executes fn if circuit allows; respects ctx cancellation.
func (cb *CircuitBreaker) Do(ctx context.Context, fn func(context.Context) error) error {
	cb.mu.Lock()
	switch cb.state {
	case StateOpen:
		// Check if reset window expired
		if time.Now().After(cb.nextReset) {
			cb.state = StateHalfOpen
			cb.mu.Unlock()
		} else {
			remaining := time.Until(cb.nextReset)
			cb.mu.Unlock()
			// Wait for reset or ctx cancellation
			select {
			case <-ctx.Done():
				return fmt.Errorf("circuit open, ctx cancelled: %w", ctx.Err())
			case <-time.After(remaining):
				cb.mu.Lock()
				cb.state = StateHalfOpen
				cb.mu.Unlock()
			}
		}
	default:
		cb.mu.Unlock()
	}

	// Execute function
	err := fn(ctx)

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		cb.failures++
		if cb.state == StateHalfOpen || cb.failures >= cb.threshold {
			cb.state = StateOpen
			cb.nextReset = time.Now().Add(cb.resetWindow)
			cb.failures = 0
			fmt.Printf("circuit opened (failures: %d)\n", cb.failures)
		}
		return err
	}

	// Success
	cb.failures = 0
	cb.state = StateClosed
	return nil
}

func main() {
	cb := NewCircuitBreaker(3, 2*time.Second)

	// Simulate 3 failures → circuit opens
	for i := 1; i <= 4; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		err := cb.Do(ctx, func(ctx context.Context) error {
			if i <= 3 { return fmt.Errorf("upstream error %d", i) }
			return nil
		})
		cancel()
		fmt.Printf("call %d: err=%v state=%d\n", i, err, cb.State())
	}

	// Wait for reset window then probe
	time.Sleep(2100 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	err := cb.Do(ctx, func(ctx context.Context) error { return nil })
	fmt.Printf("probe: err=%v state=%d\n", err, cb.State())
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | One CB per upstream endpoint; shared across goroutines via mutex |
| Edge Cases | Concurrent HalfOpen probes: only first should probe; others return ErrCircuitOpen |
| Error Handling | Distinguish circuit-open errors from upstream errors for metrics and logging |
| Memory | CB is ~64 bytes; negligible |
| Concurrency | All state transitions under mutex; fn called outside lock to prevent deadlock |

### Visual Explanation
```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open: failures >= threshold
    Open --> HalfOpen: resetWindow elapsed
    HalfOpen --> Closed: probe success
    HalfOpen --> Open: probe failure
```
```
Trace: 3 failures → Open → wait 2s → HalfOpen → probe success → Closed
       OR ctx cancelled while Open → return ErrCircuitOpen + ctx.Err()
```

### Interviewer Questions
1. Why this approach? — CB prevents cascading failures; ctx integration ensures waiting doesn't block shutdown.
2. Can it be optimized? — Use atomic.Int32 for failure count; mutex only for state transitions.
3. Scale to 10M? — Per-endpoint CB; share via sync.Map; metrics exposed via Prometheus.
4. Edge cases? — Concurrent HalfOpen probes: use sync.Once or atomic compare-and-swap.
5. Goroutine-safe? — Mutex guards all state; fn called outside lock.
6. Memory impact? — One CB per endpoint; 10K endpoints = ~640KB.
7. Alternative? — gobreaker (sony/gobreaker); hystrix-go; resilience4j pattern.

### Follow-Up Questions
**Q1:** What is the half-open state for? **A1:** Probe one request to check if upstream recovered before fully reopening.
**Q2:** How to prevent multiple simultaneous probes in half-open? **A2:** Use a tryLock pattern or `sync/atomic` CAS on a probing flag.
**Q3:** How to expose CB state for monitoring? **A3:** Prometheus gauge: `circuit_breaker_state{endpoint="X"} 0|1|2`.
**Q4:** Difference from retry? **A4:** Retry re-attempts immediately; CB fast-fails until upstream recovers.
**Q5:** How to tune threshold and resetWindow? **A5:** threshold: 3-5 consecutive failures; resetWindow: 2×average_recovery_time.

---

## Q20: End-to-End Context Tracing  [Level 6 — Production]
> **Tags:** `#context` `#opentelemetry` `#tracing` `#production` `#observability`

### Problem Statement
Build a production observability layer that integrates context-based tracing across an HTTP server, a gRPC downstream call, and a database query. Each layer creates a span, attaches it to context, and propagates it. On any error or timeout, the span is marked failed. This mirrors real production setups using OpenTelemetry and Jaeger/Zipkin.

### Input / Output / Constraints
```
Input:  HTTP GET /order/1 with W3C traceparent header
Output: Jaeger trace shows: HTTP span → gRPC span → DB span; all linked
Constraints:
  • Span context must propagate via context.Context
  • Must record error on span if ctx cancelled or error returned
  • Must end spans via defer even on error paths
```

### Thought Process
1. Understand: OpenTelemetry Tracer.Start returns (ctx, span); the new ctx contains the span; passing ctx downstream propagates the trace.
2. Pattern: Extract from HTTP header → start root span → pass ctx to service → start child span → pass to DB → start leaf span.
3. Edge cases: Missing traceparent header (start new root trace), span.End() forgotten (open spans), error not recorded on span.

### Brute Force
```go
// O(1) — no tracing, no span propagation
func bruteForce(w http.ResponseWriter, r *http.Request) {
	result := queryDB(1)
	fmt.Fprintln(w, result)
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(w http.ResponseWriter, r *http.Request, tracer trace.Tracer) {
	ctx, span := tracer.Start(r.Context(), "http.handler")
	defer span.End()
	result, err := fetchOrder(ctx, 1, tracer)
	if err != nil {
		span.RecordError(err)
		http.Error(w, err.Error(), 500)
		return
	}
	fmt.Fprintln(w, result)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("order-service")

// HTTPHandler extracts trace context from W3C headers and starts root span.
func HTTPHandler(w http.ResponseWriter, r *http.Request) {
	// Extract parent span from incoming W3C traceparent header
	propagator := otel.GetTextMapPropagator()
	ctx := propagator.Extract(r.Context(), propagation.HeaderCarrier(r.Header))

	ctx, span := tracer.Start(ctx, "HTTP GET /order",
		trace.WithSpanKind(trace.SpanKindServer))
	defer span.End()

	span.SetAttributes(
		attribute.String("http.method", r.Method),
		attribute.String("http.url", r.URL.String()),
	)

	result, err := ServiceGetOrder(ctx, 1)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	span.SetStatus(codes.Ok, "")
	fmt.Fprintln(w, result)
}

// ServiceGetOrder creates a service-layer span and calls DB.
func ServiceGetOrder(ctx context.Context, orderID int) (string, error) {
	ctx, span := tracer.Start(ctx, "service.GetOrder")
	defer span.End()
	span.SetAttributes(attribute.Int("order.id", orderID))

	order, err := DBGetOrder(ctx, orderID)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return "", fmt.Errorf("service: %w", err)
	}
	return order, nil
}

// DBGetOrder creates a DB-layer span and executes the query.
func DBGetOrder(ctx context.Context, orderID int) (string, error) {
	ctx, span := tracer.Start(ctx, "db.query.orders")
	defer span.End()
	span.SetAttributes(
		attribute.String("db.system", "postgresql"),
		attribute.String("db.statement", "SELECT * FROM orders WHERE id=$1"),
	)

	// Respect context deadline
	qCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	_ = qCtx // In real code: db.QueryRowContext(qCtx, ...)

	// Simulate slow query that respects ctx
	select {
	case <-qCtx.Done():
		span.RecordError(qCtx.Err())
		span.SetStatus(codes.Error, qCtx.Err().Error())
		return "", fmt.Errorf("db: %w", qCtx.Err())
	case <-time.After(100 * time.Millisecond):
		return fmt.Sprintf("Order#%d", orderID), nil
	}
}

// withFakeDB demonstrates sql integration pattern (conceptual)
func withFakeDB(ctx context.Context, db *sql.DB, orderID int) (string, error) {
	ctx, span := tracer.Start(ctx, "db.query")
	defer span.End()
	row := db.QueryRowContext(ctx, "SELECT name FROM orders WHERE id=$1", orderID)
	var name string
	if err := row.Scan(&name); err != nil {
		span.RecordError(err)
		return "", err
	}
	return name, nil
}

func main() {
	// In production: configure OTLP exporter to Jaeger/Tempo
	// otel.SetTracerProvider(sdktrace.NewTracerProvider(...))
	// otel.SetTextMapPropagator(propagation.TraceContext{})

	// Demo: simulate request
	ctx, span := tracer.Start(context.Background(), "demo-root")
	defer span.End()

	result, err := ServiceGetOrder(ctx, 42)
	if err != nil {
		log.Println("Error:", err)
		return
	}
	fmt.Println("Result:", result)
}
```
**Time:** O(1) | **Space:** O(span data)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | OTel SDK batches spans; negligible overhead at scale (<1% CPU) |
| Edge Cases | Always defer span.End(); open spans are never exported and leak memory |
| Error Handling | span.RecordError() + span.SetStatus(codes.Error) required for error visibility in Jaeger |
| Memory | Each span ~1KB; batched and exported async; buffer tuned via WithBatchTimeout |
| Concurrency | OTel tracer is goroutine-safe; span is NOT shared across goroutines |

### Visual Explanation
```mermaid
flowchart TD
    A["HTTP request + traceparent header"] --> B["Extract W3C context → root span"]
    B --> C["ServiceGetOrder span (child of root)"]
    C --> D["DBGetOrder span (child of service)"]
    D --> E{"query within 2s?"}
    E -->|Yes| F["span.SetStatus OK; return result"]
    E -->|No| G["span.RecordError; span.SetStatus Error"]
    G --> H["error bubbles up; each span ends via defer"]
    F --> I["Jaeger: 3 linked spans in one trace"]
```
```
Trace: root span → service span → DB span →
       all linked by same TraceID → visible in Jaeger as single distributed trace
```

### Interviewer Questions
1. Why this approach? — OTel is the CNCF standard; vendor-neutral; context propagation is automatic.
2. Can it be optimized? — Sampling (TraceIDRatioBased) to reduce overhead on high-traffic paths.
3. Scale to 10M? — 1% sampling = 100K traces/s; Jaeger with Kafka backend handles this.
4. Edge cases? — Missing traceparent: start fresh root span; don't fail the request.
5. Goroutine-safe? — Tracer is goroutine-safe; span is not — never share a span across goroutines.
6. Memory impact? — Tune MaxExportBatchSize and ExportTimeout; unbounded queue risks OOM.
7. Alternative? — Datadog APM (ddtrace); AWS X-Ray; both wrap OTel or have native SDKs.

### Follow-Up Questions
**Q1:** What is W3C traceparent? **A1:** Standard HTTP header carrying trace-id, span-id, and flags for distributed tracing.
**Q2:** How to configure Jaeger exporter? **A2:** `otlptracegrpc.New(ctx, otlptracegrpc.WithEndpoint("jaeger:4317"))`.
**Q3:** What is sampling? **A3:** Only recording a fraction of traces to reduce storage and CPU overhead.
**Q4:** How to add custom attributes to a span? **A4:** `span.SetAttributes(attribute.String("key", "value"))`.
**Q5:** Baggage vs span attributes? **A5:** Baggage propagates key-value pairs to all downstream services; span attributes are local to one span.

---

## Company-Style Questions

### 🔵 Google Style (3Q — algorithm focused)

**G1.** Given a tree of goroutines where each node spawns two child goroutines, design a context propagation scheme that cancels the entire subtree rooted at a given node without affecting sibling subtrees. What is the minimum number of context.WithCancel calls required for N nodes?

**G2.** You have a context with a deadline set 10ms from now. Inside a tight loop processing 1M items, checking ctx.Done() on every iteration adds measurable overhead. Design an adaptive check strategy that reduces ctx.Done() checks while still honouring the deadline within ±1ms accuracy. Analyse the trade-offs.

**G3.** Implement a `context.Context` wrapper that records the call stack at the point where WithCancel/WithTimeout was called, and logs it when the context leaks (cancel not called within N seconds). What data structures and hooks are needed? Discuss the performance impact in production.

---

### 🟡 Uber Style (3Q — real-time systems)

**U1.** Uber's dispatch system processes 50K ride requests/second. Each request involves 3 downstream service calls (driver matching, pricing, ETA). If any single call times out, the request must fail fast and release all in-flight downstream calls. Design the context timeout hierarchy ensuring total p99 latency ≤ 200ms with individual service budgets.

**U2.** A surge-pricing goroutine updates prices every 100ms using a shared map. HTTP handlers read prices while processing requests. The goroutine must stop cleanly on context cancellation. Design a context-aware reader-writer pattern that allows concurrent reads, serialised writes, and clean shutdown, without holding a lock during context wait.

**U3.** During a Kafka consumer shutdown, messages in-flight must either complete processing or be returned to Kafka (not acknowledged). Design a context-based commit strategy where: (1) normal processing uses a 5s per-message timeout, (2) shutdown context cancels all pending messages, and (3) the consumer waits up to 30s for in-flight messages before force-stopping.

---

### 🟠 Amazon Style (3Q — distributed/reliability)

**A1.** An AWS Lambda function processes SQS messages with a 15-minute execution limit. The Lambda context provides a deadline; each SQS message must be processed within its individual visibility timeout (30s). Design a context composition strategy where (a) the Lambda deadline is the outer bound, (b) each message gets a 25s budget (leaving 5s buffer for ack), and (c) remaining messages are returned to SQS if Lambda deadline is imminent.

**A2.** DynamoDB conditional writes fail with ConditionalCheckFailedException (permanent, no retry) or ProvisionedThroughputExceededException (transient, retry with backoff). Implement a context-aware retry loop that: respects a total operation budget, uses exponential backoff with jitter, distinguishes permanent from transient errors, and cancels immediately if the operation context is cancelled mid-backoff.

**A3.** Design a health-check system for 1000 microservices where each check has a 2s individual timeout but the overall health-check round must complete in 10s. Use context to enforce both the per-check and global deadlines. Report which services timed out vs errored vs healthy. Handle the case where the global deadline fires before all individual checks complete.

---

### 🟢 Stripe Style (2Q — payment/correctness)

**S1.** A payment charge involves three atomic steps: reserve funds, create charge record, notify webhook. Each step has a strict 1s timeout. The charge must be idempotent: if any step fails, prior steps must be compensated (funds unreserved). Design a context-aware saga pattern where: each step uses its own context budget, compensation runs with a separate background context (not the failed one), and idempotency keys prevent double-charging on retry.

**S2.** Stripe's webhook delivery retries over 72 hours with exponential backoff (1min, 5min, 30min, 2hr, ...). Each delivery attempt has a 30s timeout. A background goroutine manages the retry schedule. Design the context architecture: the outer goroutine context represents the 72h window; each attempt uses a derived 30s context; the goroutine must stop cleanly on service shutdown without losing the retry schedule (persisted to Redis).

---

### 🔴 Razorpay Style (2Q — payment APIs/Indian banking)

**R1.** Razorpay's UPI payment flow involves: (1) calling NPCI gateway (2s timeout), (2) waiting for bank debit confirmation via callback (up to 30s), (3) updating payment status in MySQL (1s timeout). Design a context hierarchy where: the HTTP request has a 35s overall budget, each phase has its own budget, and if the NPCI call succeeds but bank confirmation times out, the payment is marked "pending" (not failed) and a background reconciliation job takes over using a new context independent of the original request.

**R2.** Indian banking APIs have strict rate limits: 100 TPS per payment aggregator. During festival sales (Diwali), Razorpay sees 10× traffic spikes. Design a context-aware admission control system that: (1) uses a token bucket for rate limiting with ctx-aware Wait, (2) prioritises retries over new requests using weighted queues, (3) sheds load with 429 responses when the system is overloaded, and (4) cancels queued requests that have been waiting longer than their caller's context deadline.

---
