# Go HTTP and Web Servers

## What Is This?

Go's `net/http` package is a production-grade HTTP client and server built into the standard library. It provides everything needed to build HTTP/1.1 and HTTP/2 servers and clients without any external dependencies: routing, middleware composition, TLS, connection pooling, graceful shutdown, and streaming I/O. An HTTP server in Go is a function that maps incoming requests to response writers, structured around the `http.Handler` interface.

## Why Does It Exist?

Go was designed at Google specifically for building networked services at scale. The language team needed an HTTP library that could handle tens of thousands of concurrent connections per process, with predictable latency and without the overhead of a framework. Rather than building a thin wrapper over a C library (like Python's http.server) or requiring a heavyweight application server (like Java's Tomcat/Jetty), Go's designers embedded a full production-quality HTTP stack into the standard library itself. The `net/http` package was designed so that adding a new route takes one line, but the underlying server can be configured to handle every production requirement: timeouts, TLS, keep-alives, graceful shutdown, and HTTP/2.

## Who Uses This in Industry?

- **Google**: The Go compiler distribution server, Go module proxy (proxy.golang.org), and numerous internal RPC services run on `net/http`. It is also the transport layer under gRPC-Go.
- **Docker / containerd**: The Docker daemon's REST API (`/var/run/docker.sock`) is served by `net/http`. Every `docker run`, `docker ps`, and `docker build` command hits a Go HTTP handler.
- **Kubernetes**: The Kubernetes API server (`kube-apiserver`) is the most complex Go HTTP application in the world. It handles watch streams (long-poll chunked responses), admission webhooks, and the entire control plane API — all on `net/http` with custom middleware for auth, audit logging, and API versioning.
- **Cloudflare**: Cloudflare's Go services (DNS resolver, Workers runtime edge proxy, Argo Tunnel) handle millions of requests per second. They use raw `net/http` with custom `http.Handler` middleware chains for request routing, rate limiting, and observability.
- **Stripe, Twilio**: Payment and communications API companies use Go HTTP servers for their webhook delivery systems, where high throughput and low latency are critical.

## Industry Standards and Best Practices

**Senior engineers do:**
- Always set `ReadTimeout`, `WriteTimeout`, and `IdleTimeout` on `http.Server`. An unconfigured server is vulnerable to Slowloris attacks and resource leaks.
- Implement graceful shutdown with `server.Shutdown(ctx)` so in-flight requests complete before the process exits.
- Use the `http.Handler` interface for middleware composition rather than global state.
- Never use `http.DefaultServeMux` in production services — always create an explicit `http.NewServeMux()` to avoid route pollution from imported packages.
- Use `http.Client` with a non-default timeout and a configured transport for outbound requests. The zero-value `http.Client{}` has no timeout and will hang forever.
- Log request ID, latency, and status code on every request (structured logging middleware).

**Beginners do:**
- Use `http.ListenAndServe("0.0.0.0:8080", nil)` with no timeout configuration.
- Forget that `http.ListenAndServe` blocks and wonder why the program exits.
- Share mutable state between handler goroutines without synchronization.
- Forget to read and close `r.Body`, leaking connections.
- Use `http.Get()` or `http.Post()` with no timeout for outbound requests.

## Why Go's Approach Is Unique

**Compared to Node.js/Express**: Node.js uses a single-threaded event loop; every request runs on the same thread and must yield via async/await to allow other requests to run. Go uses a goroutine per connection, which can block on I/O without affecting other goroutines. This means Go HTTP handlers can use synchronous code (no async/await) while still handling tens of thousands of concurrent connections.

**Compared to Java/Spring**: Spring requires annotations, dependency injection containers, and a significant framework layer. Go's `net/http` is a standard interface — `ServeHTTP(ResponseWriter, *Request)` — that any type can implement. Middleware is just a function that wraps a handler. There is no magic.

**Compared to Python/Django/Flask**: Python's GIL and interpreted execution mean that a Python HTTP server requires multiple worker processes or async frameworks to use multiple CPUs. A single Go HTTP server process uses all CPUs natively via goroutines and GOMAXPROCS.

**The key design decision**: Everything in `net/http` is an interface. `http.Handler`, `http.ResponseWriter`, `http.RoundTripper` (for the client) are all interfaces. This means the standard library, third-party routers (chi, gorilla/mux), and your own code all compose seamlessly using the same interface contracts.

---

## 1. Basic HTTP Server

### Why Before How

The absolute minimum Go HTTP server is four lines. `http.HandleFunc` registers a handler function on the default ServeMux. `http.ListenAndServe` starts the TCP listener and dispatches requests to the ServeMux. Each incoming connection is handled in its own goroutine automatically by the runtime.

```go
// 01_basic_server.go
package main

import (
	"fmt"
	"log"
	"net/http"
)

func helloHandler(w http.ResponseWriter, r *http.Request) {
	// w is the response writer — write headers and body through it.
	// r is the request — URL, headers, body, method are all here.
	fmt.Fprintln(w, "Hello, Go!")
}

func main() {
	// Register handler on the default ServeMux (package-level singleton).
	// Pattern "/" matches all paths not matched by more specific patterns.
	http.HandleFunc("/", helloHandler)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"status":"ok"}`)
	})

	// ListenAndServe blocks. It returns only on error (e.g., port already in use).
	log.Println("Server listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}
```

**Common pitfall**: Using `nil` as the handler passes requests to `http.DefaultServeMux`. This is convenient for quick scripts but dangerous in production — any imported package that calls `http.HandleFunc` at init time pollutes your routes. Always use explicit muxes in production.

---

## 2. http.ServeMux: Routing

### Why Before How

`http.ServeMux` is Go's built-in HTTP router. It matches incoming request paths against registered patterns and dispatches to the appropriate handler. Go 1.22 significantly enhanced the mux with method-based routing and path parameter support, removing the need for third-party routers for many use cases.

```go
// 02_servemux.go
package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	// Always create an explicit ServeMux — never use the default in production.
	mux := http.NewServeMux()

	// Go 1.21 and earlier: pattern matching rules
	// - Exact match: "/foo" matches only /foo
	// - Subtree match: "/foo/" matches /foo/, /foo/bar, /foo/bar/baz
	// - Longer patterns win over shorter patterns
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// "/" is a catch-all. Without the exact path check, it matches everything.
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprintln(w, "root")
	})

	mux.HandleFunc("/users/", func(w http.ResponseWriter, r *http.Request) {
		// Strips the "/users/" prefix. r.URL.Path is still the full path.
		fmt.Fprintf(w, "users subtree: %s\n", r.URL.Path)
	})

	// Go 1.22+: method and path parameter routing built in.
	// Pattern syntax: "METHOD /path/{param}" or "METHOD /path/{param...}"
	mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id") // Extract path parameter (Go 1.22+)
		fmt.Fprintf(w, "GET user id: %s\n", id)
	})

	mux.HandleFunc("POST /users", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "create user")
	})

	mux.HandleFunc("DELETE /users/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		fmt.Fprintf(w, "DELETE user id: %s\n", id)
	})

	// Wildcard suffix: matches /files/any/path/here
	mux.HandleFunc("GET /files/{path...}", func(w http.ResponseWriter, r *http.Request) {
		path := r.PathValue("path")
		fmt.Fprintf(w, "file path: %s\n", path)
	})

	log.Println("Server on :8080 (requires Go 1.22+ for method routing)")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

---

## 3. The http.Handler Interface

### Why Before How

`http.Handler` is a single-method interface:
```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```
Any type with a `ServeHTTP` method is an HTTP handler. This includes `http.ServeMux`, your own structs (which can carry dependencies like database connections), and `http.HandlerFunc` (a function type that satisfies the interface). Using structs as handlers is the idiomatic way to inject dependencies without global variables.

```go
// 03_handler_interface.go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

// UserStore simulates a database.
type UserStore interface {
	GetUser(id string) (User, error)
}

type User struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// inMemoryStore is a test implementation.
type inMemoryStore struct {
	users map[string]User
}

func (s *inMemoryStore) GetUser(id string) (User, error) {
	u, ok := s.users[id]
	if !ok {
		return User{}, fmt.Errorf("user %s not found", id)
	}
	return u, nil
}

// UserHandler is a struct that implements http.Handler.
// It carries its dependencies (the store) — no global variables needed.
type UserHandler struct {
	store UserStore
}

// ServeHTTP satisfies the http.Handler interface.
// The struct can now be passed to any function that accepts http.Handler.
func (h *UserHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}

	user, err := h.store.GetUser(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func main() {
	store := &inMemoryStore{
		users: map[string]User{
			"1": {ID: "1", Name: "Alice"},
			"2": {ID: "2", Name: "Bob"},
		},
	}

	handler := &UserHandler{store: store}

	mux := http.NewServeMux()
	// Handler struct registered directly — no adapter needed.
	mux.Handle("GET /users/{id}", handler)

	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

---

## 4. Middleware Pattern

### Why Before How

Middleware is a function that takes an `http.Handler` and returns a new `http.Handler`. The returned handler runs some code before and/or after calling the wrapped handler. Middleware chains are how production services add cross-cutting concerns (authentication, request logging, panic recovery, rate limiting, CORS) to every handler without repeating code.

The pattern is:
```go
func MyMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // before
        next.ServeHTTP(w, r)
        // after
    })
}
```

```go
// 04_middleware.go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"time"
)

// ---- Logging Middleware ----

// responseWriter wraps http.ResponseWriter to capture the status code.
// http.ResponseWriter doesn't expose the status code after WriteHeader is called.
type responseWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.bytes += n
	return n, err
}

// LoggingMiddleware logs method, path, status, latency, and bytes for every request.
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(wrapped, r)

		log.Printf("%s %s %d %s %d bytes",
			r.Method, r.URL.Path, wrapped.status,
			time.Since(start).Round(time.Microsecond), wrapped.bytes,
		)
	})
}

// ---- Recovery Middleware ----

// RecoveryMiddleware catches panics in downstream handlers, returns 500,
// and logs the stack trace. Without this, a panic kills the goroutine
// but the server continues — the client sees a closed connection, not a 500.
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("PANIC recovered: %v\n%s", rec, debug.Stack())
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ---- Request ID Middleware ----

type contextKey string

const requestIDKey contextKey = "requestID"

// RequestIDMiddleware generates a unique request ID and stores it in the context.
// Downstream handlers retrieve it with r.Context().Value(requestIDKey).
func RequestIDMiddleware(next http.Handler) http.Handler {
	var counter uint64
	var mu struct{ _ [0]func() } // zero-size field to avoid accidental copying
	_ = mu

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		counter++
		id := fmt.Sprintf("req-%d-%d", time.Now().UnixNano(), counter)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ---- Auth Middleware ----

// AuthMiddleware checks for a bearer token. Returns 401 if missing or invalid.
// In production, validate a JWT or look up a session token.
func AuthMiddleware(validToken string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := r.Header.Get("Authorization")
			if token != "Bearer "+validToken {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ---- Chain Helper ----

// Chain applies middleware in order: Chain(a, b, c)(handler) = a(b(c(handler)))
// The first middleware in the list is the outermost (runs first).
func Chain(middlewares ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(final http.Handler) http.Handler {
		for i := len(middlewares) - 1; i >= 0; i-- {
			final = middlewares[i](final)
		}
		return final
	}
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /hello", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "hello world")
	})

	mux.HandleFunc("GET /panic", func(w http.ResponseWriter, r *http.Request) {
		panic("intentional panic for demonstration")
	})

	mux.HandleFunc("GET /protected", func(w http.ResponseWriter, r *http.Request) {
		id := r.Context().Value(requestIDKey)
		fmt.Fprintf(w, "protected resource, request id: %v\n", id)
	})

	// Apply middleware chain to the entire mux.
	// Order: Recovery -> RequestID -> Logging -> (router) -> handler
	stack := Chain(
		RecoveryMiddleware,
		RequestIDMiddleware,
		LoggingMiddleware,
	)

	log.Fatal(http.ListenAndServe(":8080", stack(mux)))
}
```

---

## 5. Request Handling: Parsing Inputs

```go
// 05_request_handling.go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
)

// CreateUserRequest is the expected JSON body for POST /users.
type CreateUserRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Age   int    `json:"age"`
}

// parseJSONBody decodes a JSON request body into dst.
// It enforces a size limit to prevent memory exhaustion from huge payloads.
func parseJSONBody(r *http.Request, dst interface{}) error {
	// Limit body size: reject payloads over 1MB.
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	defer r.Body.Close()

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields() // reject unknown JSON fields (strict mode)
	return dec.Decode(dst)
}

func createUserHandler(w http.ResponseWriter, r *http.Request) {
	// Parse JSON body
	var req CreateUserRequest
	if err := parseJSONBody(r, &req); err != nil {
		http.Error(w, fmt.Sprintf("invalid body: %v", err), http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.Email == "" {
		http.Error(w, "name and email are required", http.StatusUnprocessableEntity)
		return
	}
	fmt.Fprintf(w, "created user: %s <%s>\n", req.Name, req.Email)
}

func listUsersHandler(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters: GET /users?page=2&limit=20&filter=active
	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	filter := q.Get("filter") // empty string if not present

	fmt.Fprintf(w, "page=%d limit=%d filter=%q\n", page, limit, filter)
}

func updateUserHandler(w http.ResponseWriter, r *http.Request) {
	// Path parameter (Go 1.22+)
	id := r.PathValue("id")

	// Request headers
	contentType := r.Header.Get("Content-Type")
	userAgent := r.Header.Get("User-Agent")

	fmt.Fprintf(w, "update user id=%s content-type=%s user-agent=%s\n",
		id, contentType, userAgent)
}

func formHandler(w http.ResponseWriter, r *http.Request) {
	// Parse form data (application/x-www-form-urlencoded or multipart/form-data)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	name := r.FormValue("name")     // works for both GET query params and POST form body
	email := r.PostFormValue("email") // POST body only, ignores query params

	fmt.Fprintf(w, "form: name=%s email=%s\n", name, email)
}

func uploadHandler(w http.ResponseWriter, r *http.Request) {
	// Parse multipart form with 10MB max memory (rest goes to temp files)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "bad multipart", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("upload")
	if err != nil {
		http.Error(w, "missing file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	fmt.Fprintf(w, "received file: %s (%d bytes)\n", header.Filename, header.Size)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /users", createUserHandler)
	mux.HandleFunc("GET /users", listUsersHandler)
	mux.HandleFunc("PUT /users/{id}", updateUserHandler)
	mux.HandleFunc("POST /form", formHandler)
	mux.HandleFunc("POST /upload", uploadHandler)

	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

---

## 6. Response Writing

```go
// 06_responses.go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// JSONResponse writes a JSON response with the given status code.
// Sets Content-Type and handles encoding errors gracefully.
func JSONResponse(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status) // must be called before Write, and only once

	if err := json.NewEncoder(w).Encode(v); err != nil {
		// Can't call w.WriteHeader again — headers already sent.
		// Log the error; the client will see a truncated response.
		log.Printf("JSON encode error: %v", err)
	}
}

// APIError is a structured error response.
type APIError struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	TraceID string `json:"trace_id,omitempty"`
}

func errorHandler(w http.ResponseWriter, r *http.Request) {
	JSONResponse(w, http.StatusUnprocessableEntity, APIError{
		Error: "validation failed",
		Code:  "VALIDATION_ERROR",
	})
}

func successHandler(w http.ResponseWriter, r *http.Request) {
	type Response struct {
		ID        int    `json:"id"`
		Name      string `json:"name"`
		CreatedAt string `json:"created_at"`
	}
	JSONResponse(w, http.StatusCreated, Response{
		ID:        42,
		Name:      "Alice",
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// streamHandler sends a streaming response (Server-Sent Events style).
// Uses http.Flusher to push chunks to the client incrementally.
func streamHandler(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	for i := 0; i < 5; i++ {
		fmt.Fprintf(w, "data: event %d\n\n", i)
		flusher.Flush() // send the chunk to the client immediately
		time.Sleep(500 * time.Millisecond)
	}
}

// redirectHandler demonstrates HTTP redirects.
func redirectHandler(w http.ResponseWriter, r *http.Request) {
	// 301: permanent redirect (browser caches it)
	// 302: temporary redirect
	// 303: redirect after POST (use GET for the redirect)
	http.Redirect(w, r, "/new-location", http.StatusMovedPermanently)
}

// downloadHandler sends a file download with correct headers.
func downloadHandler(w http.ResponseWriter, r *http.Request) {
	content := []byte("report data line 1\nreport data line 2\n")

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="report.csv"`)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(content)))
	w.WriteHeader(http.StatusOK)
	w.Write(content)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/error", errorHandler)
	mux.HandleFunc("/success", successHandler)
	mux.HandleFunc("/stream", streamHandler)
	mux.HandleFunc("/redirect", redirectHandler)
	mux.HandleFunc("/download", downloadHandler)

	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

---

## 7. Production Server Configuration: Timeouts

### Why Before How

An HTTP server without timeouts is vulnerable to resource exhaustion attacks. A slow client that never finishes sending its request body holds a connection and a goroutine forever. An overloaded upstream that never responds will make all handler goroutines block forever. Timeouts are not optional in production.

```go
// 07_timeouts.go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"
)

func slowHandler(w http.ResponseWriter, r *http.Request) {
	// Simulate slow processing. In production, use context-aware operations.
	ctx := r.Context()
	select {
	case <-time.After(3 * time.Second):
		fmt.Fprintln(w, "done")
	case <-ctx.Done():
		// Client disconnected or server write timeout hit.
		log.Printf("request cancelled: %v", ctx.Err())
		// Don't write to w — the connection is already being closed.
	}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/slow", slowHandler)
	mux.HandleFunc("/fast", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "fast response")
	})

	server := &http.Server{
		Addr:    ":8080",
		Handler: mux,

		// ReadTimeout: max time to read the ENTIRE request (headers + body).
		// If the client sends headers slowly (Slowloris attack), this kills it.
		ReadTimeout: 5 * time.Second,

		// ReadHeaderTimeout: max time to read ONLY the request headers.
		// Useful when body reading timeout is controlled per-handler.
		// If set, takes precedence over ReadTimeout for the header phase.
		ReadHeaderTimeout: 2 * time.Second,

		// WriteTimeout: max time to write the response after the request is read.
		// Starts after reading the request body completes.
		// For streaming handlers, this limits total streaming time.
		WriteTimeout: 10 * time.Second,

		// IdleTimeout: max time to wait for the next request on a keep-alive connection.
		// Keeps-alive allow connection reuse but hold file descriptors.
		// Set this to prevent idle connections from accumulating.
		IdleTimeout: 120 * time.Second,
	}

	log.Println("Server with timeouts on :8080")
	log.Fatal(server.ListenAndServe())
}
```

---

## 8. Graceful Shutdown

### Why Before How

When a process receives SIGTERM (from Kubernetes, systemd, or `docker stop`), it should stop accepting new connections and wait for in-flight requests to complete before exiting. Without graceful shutdown, a rolling deployment or pod restart drops active requests, causing errors for clients. `http.Server.Shutdown(ctx)` does exactly this: it closes the listener immediately (no new connections), then waits for active connections to finish (subject to the context deadline).

```go
// 08_graceful_shutdown.go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Simulate a slow handler (e.g., a database query)
		time.Sleep(2 * time.Second)
		fmt.Fprintln(w, "response after slow work")
	})

	server := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start the server in a goroutine so it doesn't block.
	go func() {
		log.Println("Server listening on :8080")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			// ErrServerClosed is the expected error from Shutdown() — not fatal.
			log.Fatalf("ListenAndServe: %v", err)
		}
	}()

	// Block until we receive SIGINT (Ctrl+C) or SIGTERM (from container orchestrator).
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Received signal %v, starting graceful shutdown...", sig)

	// Give in-flight requests up to 30 seconds to complete.
	// After 30 seconds, Shutdown() forces-closes remaining connections.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Shutdown error (forced): %v", err)
	}

	log.Println("Server shut down cleanly")
	// Perform other cleanup here: close database connections, flush logs, etc.
}
```

---

## 9. TLS: HTTPS Server

```go
// 09_tls.go
package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "Secure response! TLS: %v\n", r.TLS != nil)
	})

	// Redirect HTTP to HTTPS
	go func() {
		redirect := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			target := "https://" + r.Host + r.URL.RequestURI()
			http.Redirect(w, r, target, http.StatusMovedPermanently)
		})
		log.Fatal(http.ListenAndServe(":8080", redirect))
	}()

	// TLS configuration following Mozilla's Modern compatibility profile.
	// See: https://ssl-config.mozilla.org/
	tlsConfig := &tls.Config{
		// Minimum TLS version: reject TLS 1.0 and 1.1 (deprecated, insecure)
		MinVersion: tls.VersionTLS12,

		// Prefer server cipher suite order for forward secrecy
		PreferServerCipherSuites: true,

		// Modern cipher suites (TLS 1.2)
		CipherSuites: []uint16{
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		},

		// HTTP/2 is enabled by default when using TLS — no extra config needed.
	}

	server := &http.Server{
		Addr:         ":8443",
		Handler:      mux,
		TLSConfig:    tlsConfig,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// ListenAndServeTLS loads the certificate and private key from files.
	// For development, generate self-signed certs:
	//   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
	log.Println("HTTPS server on :8443")
	log.Fatal(server.ListenAndServeTLS("cert.pem", "key.pem"))
}
```

### Automatic TLS with Let's Encrypt

```go
// 09b_autocert.go
package main

import (
	"fmt"
	"golang.org/x/crypto/acme/autocert"
	"log"
	"net/http"
	"time"
)

// autocert handles ACME certificate provisioning and renewal automatically.
// Requirements:
//   - The server must be publicly reachable on port 80 (for HTTP-01 challenge)
//     or port 443 (for TLS-ALPN-01 challenge)
//   - The domain must have DNS pointing to this server
func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello from HTTPS with auto-renewed Let's Encrypt cert!")
	})

	// certManager handles certificate renewal and caching.
	certManager := autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist("yourdomain.com", "www.yourdomain.com"),
		Cache:      autocert.DirCache("/var/cache/autocert"), // persist certs across restarts
	}

	// HTTP server for ACME HTTP-01 challenge (port 80 must be open)
	go func() {
		log.Fatal(http.ListenAndServe(":80", certManager.HTTPHandler(nil)))
	}()

	server := &http.Server{
		Addr:         ":443",
		Handler:      mux,
		TLSConfig:    certManager.TLSConfig(), // uses autocert for GetCertificate
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Fatal(server.ListenAndServeTLS("", "")) // empty strings: TLSConfig provides certs
}
```

---

## 10. HTTP Client: Outbound Requests

### Why Before How

`http.DefaultClient` has no timeout. Any outbound request using `http.Get()`, `http.Post()`, or `http.DefaultClient` can hang forever if the remote server stops responding. In production, every outbound HTTP call must use a client with timeouts configured. Connection pooling is handled automatically by `http.Transport`, but you must understand its settings to avoid connection exhaustion under load.

```go
// 10_http_client.go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"time"
)

// newHTTPClient creates a production-configured HTTP client.
// This client is safe to reuse across goroutines and across requests.
// NEVER create a new http.Client per request — it does not reuse connections.
func newHTTPClient() *http.Client {
	transport := &http.Transport{
		// DialContext controls TCP dial behavior.
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,  // TCP connection timeout
			KeepAlive: 30 * time.Second, // TCP keep-alive interval
		}).DialContext,

		// TLS handshake timeout
		TLSHandshakeTimeout: 5 * time.Second,

		// Time waiting for the server's first response byte after the request is sent.
		// This is the "time to first byte" timeout.
		ResponseHeaderTimeout: 10 * time.Second,

		// Max idle connections across all hosts (controls connection pool size)
		MaxIdleConns: 100,

		// Max idle connections per host.
		// Default is 2, which is often too low for high-traffic services.
		MaxIdleConnsPerHost: 20,

		// Max total connections per host (0 = unlimited)
		MaxConnsPerHost: 0,

		// How long idle connections stay in the pool before being closed.
		IdleConnTimeout: 90 * time.Second,

		// Disable HTTP/2 if needed (e.g., backend only supports HTTP/1.1)
		// ForceAttemptHTTP2: false,
	}

	return &http.Client{
		Transport: transport,
		// Overall timeout for the entire request (including redirects).
		// This is the last line of defense if ResponseHeaderTimeout is not enough.
		Timeout: 30 * time.Second,
	}
}

// GitHub API response type
type GitHubUser struct {
	Login     string `json:"login"`
	Name      string `json:"name"`
	PublicRepos int  `json:"public_repos"`
}

// getGitHubUser fetches a GitHub user, demonstrating context-aware client usage.
func getGitHubUser(ctx context.Context, client *http.Client, username string) (*GitHubUser, error) {
	url := fmt.Sprintf("https://api.github.com/users/%s", username)

	// Use NewRequestWithContext to attach the caller's context.
	// This allows the caller to cancel the request (e.g., if the HTTP handler's
	// context is cancelled because the client disconnected).
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "MyApp/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute request: %w", err)
	}
	defer resp.Body.Close() // ALWAYS close the body to return the connection to the pool

	if resp.StatusCode != http.StatusOK {
		// Read and discard the error body to allow connection reuse.
		io.Copy(io.Discard, resp.Body)
		return nil, fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	// Limit response body size to prevent memory exhaustion
	body := io.LimitReader(resp.Body, 1<<20) // 1MB limit

	var user GitHubUser
	if err := json.NewDecoder(body).Decode(&user); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &user, nil
}

// withRetry retries a function up to maxRetries times with exponential backoff.
// Only retries on transient errors (network errors, 5xx responses).
func withRetry(ctx context.Context, maxRetries int, fn func() error) error {
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(attempt*attempt) * 100 * time.Millisecond
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return ctx.Err()
			}
			log.Printf("retry attempt %d after %v", attempt, backoff)
		}

		lastErr = fn()
		if lastErr == nil {
			return nil
		}

		// Don't retry on context cancellation
		if errors.Is(lastErr, context.Canceled) || errors.Is(lastErr, context.DeadlineExceeded) {
			return lastErr
		}
	}
	return fmt.Errorf("after %d retries: %w", maxRetries, lastErr)
}

func main() {
	client := newHTTPClient()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var user *GitHubUser
	err := withRetry(ctx, 3, func() error {
		var err error
		user, err = getGitHubUser(ctx, client, "golang")
		return err
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("User: %s (%s), repos: %d\n", user.Login, user.Name, user.PublicRepos)
}
```

---

## 11. Complete Production API Server

This example assembles all the patterns into a minimal but production-quality REST API.

```go
// 11_production_server.go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// ---- Domain ----

type Product struct {
	ID    int     `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

// ProductStore is an in-memory thread-safe product store.
type ProductStore struct {
	mu       sync.RWMutex
	products map[int]Product
	nextID   int
}

func NewProductStore() *ProductStore {
	s := &ProductStore{products: make(map[int]Product), nextID: 1}
	// Seed with initial data
	s.products[1] = Product{ID: 1, Name: "Widget", Price: 9.99}
	s.products[2] = Product{ID: 2, Name: "Gadget", Price: 24.99}
	s.nextID = 3
	return s
}

func (s *ProductStore) List() []Product {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]Product, 0, len(s.products))
	for _, p := range s.products {
		list = append(list, p)
	}
	return list
}

func (s *ProductStore) Get(id int) (Product, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.products[id]
	if !ok {
		return Product{}, fmt.Errorf("product %d not found", id)
	}
	return p, nil
}

func (s *ProductStore) Create(p Product) Product {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.ID = s.nextID
	s.nextID++
	s.products[p.ID] = p
	return p
}

// ---- Handlers ----

type ProductHandler struct {
	store  *ProductStore
	logger *slog.Logger
}

func (h *ProductHandler) list(w http.ResponseWriter, r *http.Request) {
	products := h.store.List()
	respondJSON(w, http.StatusOK, products)
}

func (h *ProductHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "id must be an integer")
		return
	}

	product, err := h.store.Get(id)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, product)
}

func (h *ProductHandler) create(w http.ResponseWriter, r *http.Request) {
	var p Product
	if err := decodeJSONBody(r, &p); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if p.Name == "" {
		respondError(w, http.StatusUnprocessableEntity, "name is required")
		return
	}
	if p.Price <= 0 {
		respondError(w, http.StatusUnprocessableEntity, "price must be positive")
		return
	}

	created := h.store.Create(p)
	respondJSON(w, http.StatusCreated, created)
}

func (h *ProductHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /products", h.list)
	mux.HandleFunc("GET /products/{id}", h.get)
	mux.HandleFunc("POST /products", h.create)
}

// ---- Helpers ----

type errorResponse struct {
	Error string `json:"error"`
}

func respondJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, errorResponse{Error: msg})
}

func decodeJSONBody(r *http.Request, dst interface{}) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}

// ---- Middleware ----

func loggingMiddleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"latency_ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("PANIC: %v\n%s", rec, debug.Stack())
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ---- Main ----

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	store := NewProductStore()
	handler := &ProductHandler{store: store, logger: logger}

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Apply middleware: recovery is outermost (catches panics in logging too)
	finalHandler := recoveryMiddleware(loggingMiddleware(logger, mux))

	server := &http.Server{
		Addr:              ":8080",
		Handler:           finalHandler,
		ReadTimeout:       5 * time.Second,
		ReadHeaderTimeout: 2 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("server starting", "addr", ":8080")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
	logger.Info("server stopped")
}
```

---

## 12. Third-Party Routers: chi

### Why Before How

Go's standard `http.ServeMux` (even with Go 1.22 enhancements) lacks some features used in larger APIs: middleware mounting per-route-group, URL parameter constraints, nested routing, and a cleaner API for route-groups. The `chi` router (github.com/go-chi/chi/v5) fills this gap while remaining 100% compatible with `net/http`. Every chi handler is an `http.Handler`. You can mix chi with standard library middleware transparently.

```go
// 12_chi_router.go
// go get github.com/go-chi/chi/v5
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Article struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

func main() {
	r := chi.NewRouter()

	// Built-in chi middleware
	r.Use(middleware.RequestID)    // adds X-Request-ID header
	r.Use(middleware.RealIP)       // uses X-Forwarded-For for r.RemoteAddr
	r.Use(middleware.Logger)       // structured request logging
	r.Use(middleware.Recoverer)    // panic recovery with stack trace
	r.Use(middleware.Timeout(30 * time.Second)) // per-request timeout

	// Health endpoint (no middleware beyond global)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	// API v1 route group with shared prefix and auth middleware
	r.Route("/api/v1", func(r chi.Router) {
		// Middleware applies only to routes in this group
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Example: API key check
				if r.Header.Get("X-API-Key") == "" {
					http.Error(w, `{"error":"missing api key"}`, http.StatusUnauthorized)
					return
				}
				next.ServeHTTP(w, r)
			})
		})

		r.Get("/articles", func(w http.ResponseWriter, r *http.Request) {
			articles := []Article{
				{ID: "1", Title: "Go HTTP", Content: "..."},
				{ID: "2", Title: "Go Concurrency", Content: "..."},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(articles)
		})

		// Sub-resource routes with URL parameters
		r.Route("/articles/{articleID}", func(r chi.Router) {
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				id := chi.URLParam(r, "articleID")
				a := Article{ID: id, Title: "Sample Article", Content: "body"}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(a)
			})

			r.Put("/", func(w http.ResponseWriter, r *http.Request) {
				id := chi.URLParam(r, "articleID")
				fmt.Fprintf(w, `{"updated":"%s"}`, id)
			})

			r.Delete("/", func(w http.ResponseWriter, r *http.Request) {
				id := chi.URLParam(r, "articleID")
				fmt.Fprintf(w, `{"deleted":"%s"}`, id)
			})
		})
	})

	// Mount a sub-router at a prefix (useful for modular apps)
	adminRouter := chi.NewRouter()
	adminRouter.Get("/stats", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, `{"goroutines":42,"uptime":"24h"}`)
	})
	r.Mount("/admin", adminRouter)

	log.Fatal(http.ListenAndServe(":8080", r))
}
```

---

## Common Pitfalls

1. **No server timeouts**: Using `http.ListenAndServe(addr, mux)` directly sets no timeouts. Always construct an `http.Server` struct with all timeouts set.

2. **Not closing response body**: `resp.Body.Close()` must be called after every successful `client.Do(req)` call, even if you don't read the body. Missing this leaks the connection and eventually exhausts the connection pool.

3. **Creating http.Client per request**: `http.Client` contains the connection pool (`http.Transport`). Creating a new client per request defeats connection reuse. Create one client at startup and reuse it.

4. **Using http.DefaultServeMux in production**: Imported packages can register routes on `http.DefaultServeMux` at init time (notably `net/http/pprof`). Always create an explicit `http.NewServeMux()`.

5. **Not reading the entire error response body**: After a non-2xx response, you must `io.Copy(io.Discard, resp.Body)` before closing the body. Otherwise the connection cannot be reused.

6. **WriteHeader called after Write**: Calling `w.Write(...)` automatically sends a 200 status. Calling `w.WriteHeader(404)` after that has no effect. Always call `WriteHeader` before `Write`.

7. **Forgetting http.ErrServerClosed**: After calling `server.Shutdown()`, `ListenAndServe` returns `http.ErrServerClosed`. This is not an error — it is the expected shutdown signal. Check for it explicitly:
   ```go
   if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
       log.Fatal(err)
   }
   ```

8. **pprof on the public port**: `import _ "net/http/pprof"` registers CPU/memory profiling endpoints on `http.DefaultServeMux`. If you use `http.DefaultServeMux` as your production handler and expose it publicly, you expose your profiling data. Serve pprof on a separate internal-only port.

9. **context.WithTimeout in handlers without cancelling**: Always `defer cancel()` immediately after `context.WithTimeout`. Failing to call cancel leaks the timer goroutine.

10. **JSON decoder not checking for unknown fields**: `json.Decoder` silently ignores unknown fields by default. Use `dec.DisallowUnknownFields()` in strict APIs to catch client bugs early.
