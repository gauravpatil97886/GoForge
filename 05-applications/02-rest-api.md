# Go REST APIs: From Handler to Production

## What Is This?

A REST API (Representational State Transfer Application Programming Interface) is an HTTP-based service where resources are identified by URLs, and standard HTTP methods (GET, POST, PUT, DELETE, PATCH) define what action to take on those resources. In Go, REST APIs are built using the standard `net/http` package or lightweight router libraries like `chi` or `gorilla/mux`, with each endpoint mapped to a handler function that reads input from the request, calls business logic, and writes JSON responses.

## Why Does It Exist?

Before REST, remote service communication used SOAP (XML over HTTP with a rigid envelope format) or custom binary protocols — both required generated stubs and heavy tooling on both client and server. REST emerged as a constraint set on HTTP itself: use the verbs and status codes that HTTP already defines, use URLs to identify things (nouns), and use JSON as the payload format. This made APIs trivially consumable from any language without generated clients. The design decision was to use the existing web as the protocol rather than build a new one on top of it.

## Who Uses This in Industry?

- **Stripe**: Their REST API is widely considered the gold standard of API design. Consistent error format (`{ "error": { "code": "...", "message": "...", "param": "..." } }`), predictable resource naming, idempotency keys on every mutation, exhaustive status codes, and versioning via `Stripe-Version` request headers. Every Go backend team studies Stripe's API docs.
- **Uber**: Uber's Go microservices expose REST APIs internally for their dispatch, pricing, and mapping services. They use `net/http` with `chi` routing, JWT authentication via middleware, and structured JSON logging per request. Their Go adoption was driven by REST handler throughput — Go handles ~5x the req/s of their equivalent Python services per CPU core.
- **Cloudflare**: Their Workers and DNS management APIs are built in Go and serve millions of API calls per day. They use header-based API versioning, OAuth2 + API token auth, and rate limiting middleware implemented with Redis counters.
- **Docker / Kubernetes**: Docker's daemon exposes a REST API (the Docker Engine API). Kubernetes' API server is a sophisticated REST API in Go that supports watches (long-polling), pagination via `continue` tokens, and resource versioning (`apps/v1`, `batch/v1`). These are the most widely used REST APIs in infrastructure engineering.
- **GitHub**: GitHub's REST API (and the Go SDK for it) follows semantic versioning, uses `Link` headers for pagination, and returns consistent error envelopes. Many Go CLI tools use it as their API backend.

## Industry Standards & Best Practices

**What senior engineers do:**
- Version from day one. Even internal APIs. `/v1/` in the URL path is cheap to add upfront and extremely expensive to retrofit later.
- Return a consistent error envelope on every non-2xx response. Clients should be able to read `response.error.code` and branch on it, not parse free-form error strings.
- Use HTTP status codes correctly. `201 Created` for successful POST that creates a resource. `204 No Content` for DELETE. `422 Unprocessable Entity` for validation failures (not `400 Bad Request`, which means malformed HTTP). `409 Conflict` for duplicate key violations.
- Always set `Content-Type: application/json` on JSON responses.
- Validate all input before it reaches business logic. Return descriptive validation errors (which field, what constraint).
- Use `httptest` for handler unit tests — no running server required.
- Write middleware for cross-cutting concerns (auth, logging, rate limiting, recovery). Never put auth logic inside a handler.
- Instrument with structured logging per request: method, path, status, latency, request ID.

**What beginners do wrong:**
- Return `200 OK` for everything, including errors, with `{ "success": false }` in the body — breaks HTTP semantics and client error handling.
- Put authentication logic inside handlers — duplicated, inconsistent, easy to accidentally skip.
- No input validation — open to panics, injection, and silent data corruption.
- Return Go error strings directly to clients — leaks internal implementation details.
- No request ID / correlation ID — impossible to trace a request through logs.

## Why Go's Approach Is Unique

Java's Spring Boot and Python's Django/FastAPI provide full frameworks with routing, serialization, dependency injection, and validation built in. They are opinionated and generate a lot of the boilerplate. Node.js/Express is minimal but relies on a callback/async model that obscures request flow when many middleware layers stack.

Go's `net/http` is in the standard library and is production-grade on its own. The `http.Handler` interface (`ServeHTTP(ResponseWriter, *Request)`) is a single method — any type implementing it is a valid HTTP handler. This means middleware is just a function wrapping a handler, routers are just handlers with routing tables, and the entire middleware chain is type-safe and inspectable at compile time.

The tradeoff: more explicit wiring. You assemble your middleware stack and route table by hand. In return, there are no hidden layers, no magic annotation processors, and the execution path through your API is always readable from top to bottom in `main.go`. Go engineers typically reach for `chi` (lightweight, idiomatic) or `gin` (batteries included) over writing raw `net/http` for routing, but the standard library handles the actual HTTP correctly without any framework.

---

## 1. RESTful Conventions and HTTP Semantics

### Why Before How

REST constraints exist to make APIs predictable. If every team invents their own conventions, clients must read documentation for every API. If everyone follows REST, a developer who has used one REST API can correctly guess how to use another.

The rules:
- **Nouns, not verbs in URLs**: `/users` not `/getUsers`, `/orders/42` not `/fetchOrder?id=42`
- **HTTP methods carry the verb**: `GET /users` (list), `POST /users` (create), `GET /users/42` (get one), `PUT /users/42` (full replace), `PATCH /users/42` (partial update), `DELETE /users/42` (delete)
- **Status codes are semantic**: Use them to communicate what happened, not just `200` vs `500`
- **Collections are plural**: `/users`, `/products`, `/orders`
- **Nesting expresses ownership**: `/users/42/orders` means "orders belonging to user 42"

| HTTP Method | URL | Meaning | Success Status |
|---|---|---|---|
| GET | /users | List users | 200 OK |
| POST | /users | Create user | 201 Created |
| GET | /users/42 | Get user 42 | 200 OK |
| PUT | /users/42 | Replace user 42 | 200 OK |
| PATCH | /users/42 | Update fields | 200 OK |
| DELETE | /users/42 | Delete user 42 | 204 No Content |

---

## 2. Project Structure and the Base Server

```go
// File: main.go
// This file wires together the entire REST API.
// In production, this pattern is used by Uber's Go services and Docker's daemon.

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
    // Build the handler/router (see router.go)
    handler := NewRouter()

    srv := &http.Server{
        Addr:         ":8080",
        Handler:      handler,
        ReadTimeout:  10 * time.Second, // Time to read the full request body
        WriteTimeout: 30 * time.Second, // Time to write the full response
        IdleTimeout:  120 * time.Second, // Keep-alive connection timeout
    }

    // Graceful shutdown: finish in-flight requests before stopping.
    // Kubernetes sends SIGTERM before killing the pod — this handles that.
    done := make(chan struct{})
    go func() {
        quit := make(chan os.Signal, 1)
        signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
        <-quit

        log.Println("Shutting down server...")
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()

        if err := srv.Shutdown(ctx); err != nil {
            log.Printf("Server forced shutdown: %v", err)
        }
        close(done)
    }()

    log.Printf("Server listening on %s", srv.Addr)
    if err := srv.ListenAndServe(); err != http.ErrServerClosed {
        log.Fatalf("ListenAndServe: %v", err)
    }

    <-done
    log.Println("Server stopped")
}
```

---

## 3. JSON Encoding and Decoding

### Why Before How

`encoding/json` is the standard library package for JSON. Two patterns:
- `json.NewDecoder(r.Body).Decode(&target)` — streaming decoder, correct for request bodies (does not buffer the whole body in memory before parsing)
- `json.NewEncoder(w).Encode(data)` — streaming encoder, correct for response writing

Never use `json.Unmarshal(body, &target)` for request bodies because `io.ReadAll` buffers the entire body first — wasteful for large payloads and vulnerable to memory exhaustion if there is no size limit.

```go
// File: response.go
// Centralized response writing helpers used throughout the API.

package main

import (
    "encoding/json"
    "log"
    "net/http"
)

// writeJSON writes a JSON response with the given status code.
// This is the ONLY place in the codebase that writes responses — consistency guaranteed.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    if err := json.NewEncoder(w).Encode(data); err != nil {
        // If we can't encode the response, log it but don't write again
        // (headers are already sent)
        log.Printf("writeJSON encode error: %v", err)
    }
}

// APIError is the consistent error envelope used across the entire API.
// Clients parse this struct — never change the field names.
type APIError struct {
    Code    string      `json:"code"`
    Message string      `json:"message"`
    Details interface{} `json:"details,omitempty"`
}

type errorResponse struct {
    Error APIError `json:"error"`
}

// writeError writes a structured error response.
// Every non-2xx response in the API goes through here.
func writeError(w http.ResponseWriter, status int, code, message string, details interface{}) {
    writeJSON(w, status, errorResponse{
        Error: APIError{
            Code:    code,
            Message: message,
            Details: details,
        },
    })
}

// decodeJSON decodes the request body into dest, enforcing a size limit.
// Returns the APIError to send to the client if decoding fails.
func decodeJSON(r *http.Request, dest interface{}) *APIError {
    // Limit request body to 1MB to prevent memory exhaustion attacks
    r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)

    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields() // Catch typos in field names

    if err := dec.Decode(dest); err != nil {
        return &APIError{
            Code:    "invalid_request",
            Message: "Request body is not valid JSON: " + err.Error(),
        }
    }
    return nil
}
```

---

## 4. Router Setup and URL Parameters

```go
// File: router.go
// go get github.com/go-chi/chi/v5

package main

import (
    "net/http"
    "time"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
)

// UserHandler holds the handler's dependencies (DB, cache, etc.)
// Dependency injection via struct fields — testable and explicit.
type UserHandler struct {
    store UserStorer
}

// NewRouter assembles the complete route table with middleware.
// Reading this function tells you the entire API surface area.
func NewRouter() http.Handler {
    r := chi.NewRouter()

    // --- Global middleware (applied to every request) ---
    r.Use(middleware.RequestID)       // Adds X-Request-Id header
    r.Use(middleware.RealIP)          // Sets RemoteAddr from X-Real-IP
    r.Use(RequestLogger)              // Structured request logging (custom)
    r.Use(middleware.Recoverer)       // Recovers from panics, returns 500
    r.Use(middleware.Timeout(30 * time.Second)) // Global request timeout

    // --- Health check (no auth) ---
    r.Get("/health", HealthHandler)
    r.Get("/ready", ReadyHandler)

    // --- API v1 ---
    r.Route("/v1", func(r chi.Router) {
        // --- Auth middleware for all v1 routes ---
        r.Use(JWTMiddleware)

        // User routes
        userHandler := &UserHandler{store: &InMemoryUserStore{}}
        r.Route("/users", func(r chi.Router) {
            r.Get("/", userHandler.ListUsers)       // GET /v1/users
            r.Post("/", userHandler.CreateUser)     // POST /v1/users
            r.Route("/{userID}", func(r chi.Router) {
                r.Get("/", userHandler.GetUser)     // GET /v1/users/42
                r.Put("/", userHandler.UpdateUser)  // PUT /v1/users/42
                r.Delete("/", userHandler.DeleteUser) // DELETE /v1/users/42
            })
        })

        // Rate-limited routes
        r.Group(func(r chi.Router) {
            r.Use(RateLimitMiddleware(100)) // 100 req/min
            r.Get("/search", SearchHandler)
        })
    })

    return r
}

func HealthHandler(w http.ResponseWriter, r *http.Request) {
    writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func ReadyHandler(w http.ResponseWriter, r *http.Request) {
    // In production: check DB connection, cache, etc.
    writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func SearchHandler(w http.ResponseWriter, r *http.Request) {
    q := r.URL.Query().Get("q")
    writeJSON(w, http.StatusOK, map[string]string{"query": q})
}
```

---

## 5. Input Validation

### Why Before How

Input validation is the boundary between the untrusted external world and your trusted business logic. Every field from the client — no matter how it's documented — must be validated before use. Validation failures are `422 Unprocessable Entity` (the request was syntactically valid JSON, but semantically wrong), not `400 Bad Request` (malformed HTTP or unparseable JSON).

Return ALL validation errors at once, not just the first one. Making clients fix errors one at a time is a terrible user experience.

```go
// File: users.go

package main

import (
    "fmt"
    "net/http"
    "regexp"
    "strings"
    "sync"
    "time"

    "github.com/go-chi/chi/v5"
)

// --- Domain types ---

type User struct {
    ID        string    `json:"id"`
    Name      string    `json:"name"`
    Email     string    `json:"email"`
    Role      string    `json:"role"`
    CreatedAt time.Time `json:"created_at"`
}

type CreateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
    Role  string `json:"role"`
}

type UpdateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

// ValidationError holds one validation failure.
type ValidationError struct {
    Field   string `json:"field"`
    Message string `json:"message"`
}

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
var validRoles = map[string]bool{"user": true, "admin": true, "readonly": true}

// validateCreateUser validates the request and returns all field errors.
// Returns nil if valid.
func validateCreateUser(req CreateUserRequest) []ValidationError {
    var errs []ValidationError

    req.Name = strings.TrimSpace(req.Name)
    if req.Name == "" {
        errs = append(errs, ValidationError{Field: "name", Message: "name is required"})
    } else if len(req.Name) > 100 {
        errs = append(errs, ValidationError{Field: "name", Message: "name must be 100 characters or fewer"})
    }

    req.Email = strings.TrimSpace(strings.ToLower(req.Email))
    if req.Email == "" {
        errs = append(errs, ValidationError{Field: "email", Message: "email is required"})
    } else if !emailRegex.MatchString(req.Email) {
        errs = append(errs, ValidationError{Field: "email", Message: "email must be a valid email address"})
    }

    if req.Role == "" {
        req.Role = "user" // Default value
    } else if !validRoles[req.Role] {
        errs = append(errs, ValidationError{
            Field:   "role",
            Message: fmt.Sprintf("role must be one of: user, admin, readonly"),
        })
    }

    return errs
}

// --- UserStorer interface for testability ---

type UserStorer interface {
    GetAll() []User
    GetByID(id string) (*User, bool)
    Create(req CreateUserRequest) User
    Update(id string, req UpdateUserRequest) (*User, bool)
    Delete(id string) bool
}

// InMemoryUserStore is used in examples and tests.
// In production, replace with a database-backed store.
type InMemoryUserStore struct {
    mu      sync.RWMutex
    users   map[string]User
    counter int
}

func (s *InMemoryUserStore) GetAll() []User {
    s.mu.RLock()
    defer s.mu.RUnlock()
    out := make([]User, 0, len(s.users))
    for _, u := range s.users {
        out = append(out, u)
    }
    return out
}

func (s *InMemoryUserStore) GetByID(id string) (*User, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    u, ok := s.users[id]
    if !ok {
        return nil, false
    }
    return &u, true
}

func (s *InMemoryUserStore) Create(req CreateUserRequest) User {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.users == nil {
        s.users = make(map[string]User)
    }
    s.counter++
    u := User{
        ID:        fmt.Sprintf("%d", s.counter),
        Name:      req.Name,
        Email:     req.Email,
        Role:      req.Role,
        CreatedAt: time.Now(),
    }
    s.users[u.ID] = u
    return u
}

func (s *InMemoryUserStore) Update(id string, req UpdateUserRequest) (*User, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    u, ok := s.users[id]
    if !ok {
        return nil, false
    }
    if req.Name != "" {
        u.Name = req.Name
    }
    if req.Email != "" {
        u.Email = req.Email
    }
    s.users[id] = u
    return &u, true
}

func (s *InMemoryUserStore) Delete(id string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    if _, ok := s.users[id]; !ok {
        return false
    }
    delete(s.users, id)
    return true
}

// --- Handlers ---

// ListUsers handles GET /v1/users
func (h *UserHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
    users := h.store.GetAll()
    if users == nil {
        users = []User{} // Return empty array, not JSON null
    }
    writeJSON(w, http.StatusOK, map[string]interface{}{
        "users": users,
        "total": len(users),
    })
}

// GetUser handles GET /v1/users/{userID}
func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "userID")

    user, ok := h.store.GetByID(id)
    if !ok {
        writeError(w, http.StatusNotFound, "user_not_found",
            fmt.Sprintf("No user with id %s", id), nil)
        return
    }

    writeJSON(w, http.StatusOK, map[string]interface{}{"user": user})
}

// CreateUser handles POST /v1/users
func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if apiErr := decodeJSON(r, &req); apiErr != nil {
        writeError(w, http.StatusBadRequest, apiErr.Code, apiErr.Message, nil)
        return
    }

    // Validate all fields and return all errors at once
    if errs := validateCreateUser(req); len(errs) > 0 {
        writeError(w, http.StatusUnprocessableEntity,
            "validation_error", "Request validation failed", errs)
        return
    }

    user := h.store.Create(req)
    writeJSON(w, http.StatusCreated, map[string]interface{}{"user": user})
}

// UpdateUser handles PUT /v1/users/{userID}
func (h *UserHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "userID")

    var req UpdateUserRequest
    if apiErr := decodeJSON(r, &req); apiErr != nil {
        writeError(w, http.StatusBadRequest, apiErr.Code, apiErr.Message, nil)
        return
    }

    user, ok := h.store.Update(id, req)
    if !ok {
        writeError(w, http.StatusNotFound, "user_not_found",
            fmt.Sprintf("No user with id %s", id), nil)
        return
    }

    writeJSON(w, http.StatusOK, map[string]interface{}{"user": user})
}

// DeleteUser handles DELETE /v1/users/{userID}
func (h *UserHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "userID")

    if !h.store.Delete(id) {
        writeError(w, http.StatusNotFound, "user_not_found",
            fmt.Sprintf("No user with id %s", id), nil)
        return
    }

    // 204 No Content — successful delete returns no body
    w.WriteHeader(http.StatusNoContent)
}
```

**Common Pitfall**: Returning `200 OK` for a create operation that should be `201 Created`. Stripe uses `201 Created` — it tells the client a new resource exists and the `Location` header tells it where to find it.

---

## 6. Authentication: JWT and API Key Middleware

### Why Before How

Authentication is a cross-cutting concern — it applies to many routes. In Go, this means middleware: a function that wraps a handler, inspects the request, and either calls the next handler (auth passed) or returns an error (auth failed). This keeps auth logic in one place, tested independently of handlers.

JWT (JSON Web Token) is used for user-facing APIs — the token contains claims (user ID, roles) and is cryptographically signed. API key middleware is used for server-to-server APIs — a static secret passed in the `Authorization` header or `X-API-Key` header.

```go
// File: middleware.go
// go get github.com/golang-jwt/jwt/v5

package main

import (
    "context"
    "net/http"
    "strings"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userClaimsKey contextKey = "userClaims"

// Claims is the JWT payload structure.
type Claims struct {
    UserID string `json:"user_id"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

var jwtSecret = []byte("your-256-bit-secret-from-env-not-hardcoded")

// GenerateToken creates a signed JWT for a user.
// Call this at login and return it to the client.
func GenerateToken(userID, role string) (string, error) {
    claims := Claims{
        UserID: userID,
        Role:   role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            Issuer:    "myapp-api",
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(jwtSecret)
}

// JWTMiddleware validates the Bearer token and stores claims in context.
// Any route wrapped with this middleware can retrieve claims from context.
func JWTMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" {
            writeError(w, http.StatusUnauthorized, "missing_token",
                "Authorization header is required", nil)
            return
        }

        parts := strings.SplitN(authHeader, " ", 2)
        if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
            writeError(w, http.StatusUnauthorized, "invalid_token_format",
                "Authorization header must be: Bearer <token>", nil)
            return
        }

        tokenStr := parts[1]
        claims := &Claims{}

        token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
            // Verify signing algorithm — CRITICAL security check
            // Without this, an attacker can forge tokens with alg:none
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, jwt.ErrSignatureInvalid
            }
            return jwtSecret, nil
        })

        if err != nil || !token.Valid {
            writeError(w, http.StatusUnauthorized, "invalid_token",
                "Token is invalid or expired", nil)
            return
        }

        // Store claims in context for downstream handlers
        ctx := context.WithValue(r.Context(), userClaimsKey, claims)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// GetClaims retrieves JWT claims from the request context.
// Returns nil if not set (route not protected by JWTMiddleware).
func GetClaims(r *http.Request) *Claims {
    claims, _ := r.Context().Value(userClaimsKey).(*Claims)
    return claims
}

// RequireRole returns a middleware that checks if the user has the required role.
// Chain after JWTMiddleware: r.Use(JWTMiddleware, RequireRole("admin"))
func RequireRole(role string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            claims := GetClaims(r)
            if claims == nil || claims.Role != role {
                writeError(w, http.StatusForbidden, "insufficient_permissions",
                    "You do not have permission to access this resource", nil)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}

// APIKeyMiddleware validates a static API key from X-API-Key header.
// Use this for server-to-server calls where JWT overhead is unnecessary.
func APIKeyMiddleware(validKeys map[string]string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := r.Header.Get("X-API-Key")
            if key == "" {
                key = r.URL.Query().Get("api_key") // Also accept as query param
            }

            clientName, ok := validKeys[key]
            if !ok {
                writeError(w, http.StatusUnauthorized, "invalid_api_key",
                    "The provided API key is invalid", nil)
                return
            }

            // Optionally store client name in context for logging
            ctx := context.WithValue(r.Context(), contextKey("client"), clientName)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

---

## 7. Request Logging Middleware

```go
// File: logging.go

package main

import (
    "log/slog"
    "net/http"
    "time"

    "github.com/go-chi/chi/v5/middleware"
)

// RequestLogger is structured middleware that logs every request.
// In production, replace slog with zap or zerolog for JSON output.
func RequestLogger(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()

        // chi's WrapResponseWriter captures the status code
        ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

        next.ServeHTTP(ww, r)

        duration := time.Since(start)
        requestID := middleware.GetReqID(r.Context())

        slog.Info("request",
            slog.String("request_id", requestID),
            slog.String("method", r.Method),
            slog.String("path", r.URL.Path),
            slog.Int("status", ww.Status()),
            slog.Int("bytes", ww.BytesWritten()),
            slog.Duration("duration", duration),
            slog.String("remote_addr", r.RemoteAddr),
        )
    })
}
```

---

## 8. Rate Limiting Middleware

### Why Before How

Rate limiting protects your API from abuse (deliberate or accidental). Without it, a single buggy client can exhaust your database connections or CPU. The simplest approach for single-instance deployments is an in-memory token bucket per IP. For multi-instance deployments (the normal production case), use Redis-backed counters so the limit is enforced across all replicas.

```go
// File: ratelimit.go

package main

import (
    "net/http"
    "sync"
    "time"
)

// tokenBucket implements a simple token bucket per key.
type tokenBucket struct {
    mu       sync.Mutex
    tokens   float64
    maxTokens float64
    refillRate float64 // tokens per second
    lastRefill time.Time
}

func newTokenBucket(maxTokens float64, refillPerSecond float64) *tokenBucket {
    return &tokenBucket{
        tokens:     maxTokens,
        maxTokens:  maxTokens,
        refillRate: refillPerSecond,
        lastRefill: time.Now(),
    }
}

func (b *tokenBucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()

    now := time.Now()
    elapsed := now.Sub(b.lastRefill).Seconds()
    b.tokens = min(b.maxTokens, b.tokens+elapsed*b.refillRate)
    b.lastRefill = now

    if b.tokens < 1 {
        return false
    }
    b.tokens--
    return true
}

func min(a, b float64) float64 {
    if a < b {
        return a
    }
    return b
}

// InMemoryRateLimiter holds per-IP buckets.
// For multi-instance deployments, replace with Redis-backed rate limiter.
type InMemoryRateLimiter struct {
    mu             sync.Mutex
    buckets        map[string]*tokenBucket
    requestsPerMin int
}

func NewInMemoryRateLimiter(requestsPerMin int) *InMemoryRateLimiter {
    rl := &InMemoryRateLimiter{
        buckets:        make(map[string]*tokenBucket),
        requestsPerMin: requestsPerMin,
    }
    // Clean up stale buckets periodically
    go func() {
        ticker := time.NewTicker(10 * time.Minute)
        for range ticker.C {
            rl.mu.Lock()
            rl.buckets = make(map[string]*tokenBucket)
            rl.mu.Unlock()
        }
    }()
    return rl
}

func (rl *InMemoryRateLimiter) Allow(ip string) bool {
    rl.mu.Lock()
    bucket, ok := rl.buckets[ip]
    if !ok {
        bucket = newTokenBucket(float64(rl.requestsPerMin), float64(rl.requestsPerMin)/60.0)
        rl.buckets[ip] = bucket
    }
    rl.mu.Unlock()
    return bucket.Allow()
}

// RateLimitMiddleware returns a middleware that limits requests per IP.
func RateLimitMiddleware(requestsPerMin int) func(http.Handler) http.Handler {
    limiter := NewInMemoryRateLimiter(requestsPerMin)

    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ip := r.RemoteAddr
            // Strip port from IP
            if idx := len(ip) - 1; idx > 0 {
                for i := len(ip) - 1; i >= 0; i-- {
                    if ip[i] == ':' {
                        ip = ip[:i]
                        break
                    }
                }
            }

            if !limiter.Allow(ip) {
                w.Header().Set("Retry-After", "60")
                writeError(w, http.StatusTooManyRequests, "rate_limit_exceeded",
                    "Too many requests. Please retry after 60 seconds.", nil)
                return
            }

            next.ServeHTTP(w, r)
        })
    }
}
```

---

## 9. API Versioning

### Why Before How

API versioning lets you evolve your API without breaking existing clients. You make breaking changes (rename a field, change a type, remove an endpoint) in a new version while old clients continue using the previous version. Stripe ships new versions yearly and supports old versions for years.

Two main strategies:
- **URL versioning** (`/v1/users`): Simple, visible, easily cacheable. Used by Stripe, Twitter, GitHub. The industry default.
- **Header versioning** (`API-Version: 2024-01-01`): Cleaner URLs but harder to test in a browser. Used by Stripe for minor field changes within a major version.

Go's chi router makes URL versioning trivial with `r.Route("/v1", ...)` and `r.Route("/v2", ...)`.

```go
// File: versioning.go

package main

import (
    "net/http"

    "github.com/go-chi/chi/v5"
)

// VersionedRouter shows how to maintain two API versions simultaneously.
// v1 is the old API, v2 adds pagination and changes the user response shape.
func VersionedRouter() http.Handler {
    r := chi.NewRouter()

    r.Route("/v1", func(r chi.Router) {
        r.Use(JWTMiddleware)
        // v1 returns users as a flat array
        r.Get("/users", V1ListUsers)
        r.Post("/users", V1CreateUser)
    })

    r.Route("/v2", func(r chi.Router) {
        r.Use(JWTMiddleware)
        // v2 adds pagination metadata and new field names
        r.Get("/users", V2ListUsers)
        r.Post("/users", V2CreateUser)
        // v2 adds a new endpoint not in v1
        r.Get("/users/{userID}/activity", V2GetUserActivity)
    })

    return r
}

// V1 response: simple array
type V1UsersResponse struct {
    Users []User `json:"users"`
}

// V2 response: paginated with metadata
type V2UsersResponse struct {
    Data       []UserV2       `json:"data"`
    Pagination PaginationMeta `json:"pagination"`
}

type UserV2 struct {
    ID          string `json:"id"`
    DisplayName string `json:"display_name"` // renamed from "name"
    Email       string `json:"email"`
    Role        string `json:"role"`
}

type PaginationMeta struct {
    Total  int    `json:"total"`
    Limit  int    `json:"limit"`
    Offset int    `json:"offset"`
    Next   string `json:"next,omitempty"`
}

func V1ListUsers(w http.ResponseWriter, r *http.Request) {
    // Old behavior preserved — existing clients unaffected
    writeJSON(w, http.StatusOK, V1UsersResponse{Users: []User{}})
}

func V2ListUsers(w http.ResponseWriter, r *http.Request) {
    // New behavior with pagination
    writeJSON(w, http.StatusOK, V2UsersResponse{
        Data: []UserV2{},
        Pagination: PaginationMeta{
            Total: 0, Limit: 20, Offset: 0,
        },
    })
}

func V1CreateUser(w http.ResponseWriter, r *http.Request) {
    writeJSON(w, http.StatusCreated, map[string]string{"id": "1"})
}

func V2CreateUser(w http.ResponseWriter, r *http.Request) {
    writeJSON(w, http.StatusCreated, map[string]string{"id": "1"})
}

func V2GetUserActivity(w http.ResponseWriter, r *http.Request) {
    userID := chi.URLParam(r, "userID")
    writeJSON(w, http.StatusOK, map[string]interface{}{
        "user_id": userID,
        "events":  []interface{}{},
    })
}
```

---

## 10. OpenAPI / Swagger Documentation

### Why Before How

OpenAPI (formerly Swagger) is a machine-readable specification of your API — what endpoints exist, what they accept, what they return, what authentication they require. From a single YAML/JSON spec you can generate interactive documentation (Swagger UI), client SDKs in any language, and integration tests. Stripe publishes their OpenAPI spec and thousands of tools consume it.

In Go, you can either write the spec by hand and validate that your handlers match it, or use libraries like `swaggo/swag` to generate the spec from code comments.

```go
// File: docs.go
// go get github.com/swaggo/swag/cmd/swag
// go get github.com/swaggo/http-swagger
// Run: swag init -g main.go

package main

// Swaggo annotations go in comments above handler functions.
// swag init parses these and generates docs/swagger.json

// @title           Go REST API Example
// @version         1.0
// @description     A production-ready REST API built in Go
// @termsOfService  http://example.com/terms/

// @contact.name   API Support
// @contact.url    http://example.com/support
// @contact.email  support@example.com

// @license.name  Apache 2.0
// @license.url   http://www.apache.org/licenses/LICENSE-2.0.html

// @host      localhost:8080
// @BasePath  /v1

// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization

// @Summary      List all users
// @Description  Returns all users. Requires authentication.
// @Tags         users
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  map[string]interface{}
// @Failure      401  {object}  errorResponse
// @Router       /users [get]
func ListUsersSwagger(w http.ResponseWriter, r *http.Request) {
    // Same as ListUsers — annotations are in comments only
}

// @Summary      Create a user
// @Description  Creates a new user account
// @Tags         users
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        request  body  CreateUserRequest  true  "User details"
// @Success      201  {object}  map[string]interface{}
// @Failure      400  {object}  errorResponse
// @Failure      422  {object}  errorResponse  "Validation error"
// @Failure      401  {object}  errorResponse
// @Router       /users [post]
func CreateUserSwagger(w http.ResponseWriter, r *http.Request) {}

/*
To serve Swagger UI alongside your API:

import httpSwagger "github.com/swaggo/http-swagger"
import _ "myapp/docs" // generated by swag init

r.Get("/swagger/*", httpSwagger.Handler(
    httpSwagger.URL("http://localhost:8080/swagger/doc.json"),
))
*/
```

---

## 11. Testing REST Handlers with httptest

### Why Before How

`net/http/httptest` provides `httptest.NewRecorder()` (a fake `http.ResponseWriter` that captures the response) and `httptest.NewServer()` (a real HTTP server on a random port for integration tests). With `NewRecorder`, you can call your handler directly without starting a server — tests are fast, isolated, and require no ports.

```go
// File: users_test.go

package main

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
)

func newTestHandler() *UserHandler {
    return &UserHandler{store: &InMemoryUserStore{}}
}

// TestCreateUser_Success tests the full happy path through the handler.
func TestCreateUser_Success(t *testing.T) {
    handler := newTestHandler()

    body := `{"name": "Alice", "email": "alice@example.com", "role": "user"}`
    req := httptest.NewRequest(http.MethodPost, "/v1/users", bytes.NewBufferString(body))
    req.Header.Set("Content-Type", "application/json")

    rr := httptest.NewRecorder()
    handler.CreateUser(rr, req)

    if rr.Code != http.StatusCreated {
        t.Errorf("expected status 201, got %d. Body: %s", rr.Code, rr.Body.String())
    }

    var resp map[string]interface{}
    if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
        t.Fatalf("decode response: %v", err)
    }

    user, ok := resp["user"].(map[string]interface{})
    if !ok {
        t.Fatal("response missing 'user' field")
    }
    if user["name"] != "Alice" {
        t.Errorf("expected name Alice, got %v", user["name"])
    }
    if user["id"] == "" || user["id"] == nil {
        t.Error("expected non-empty id in response")
    }
}

// TestCreateUser_ValidationError tests that invalid input returns 422 with field errors.
func TestCreateUser_ValidationError(t *testing.T) {
    handler := newTestHandler()

    tests := []struct {
        name           string
        body           string
        expectedStatus int
        expectedCode   string
    }{
        {
            name:           "missing name",
            body:           `{"email": "alice@example.com"}`,
            expectedStatus: http.StatusUnprocessableEntity,
            expectedCode:   "validation_error",
        },
        {
            name:           "invalid email",
            body:           `{"name": "Alice", "email": "not-an-email"}`,
            expectedStatus: http.StatusUnprocessableEntity,
            expectedCode:   "validation_error",
        },
        {
            name:           "invalid role",
            body:           `{"name": "Alice", "email": "a@b.com", "role": "superadmin"}`,
            expectedStatus: http.StatusUnprocessableEntity,
            expectedCode:   "validation_error",
        },
        {
            name:           "malformed json",
            body:           `{invalid json`,
            expectedStatus: http.StatusBadRequest,
            expectedCode:   "invalid_request",
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            req := httptest.NewRequest(http.MethodPost, "/v1/users",
                bytes.NewBufferString(tt.body))
            req.Header.Set("Content-Type", "application/json")
            rr := httptest.NewRecorder()

            handler.CreateUser(rr, req)

            if rr.Code != tt.expectedStatus {
                t.Errorf("expected %d, got %d. Body: %s",
                    tt.expectedStatus, rr.Code, rr.Body.String())
            }

            var resp errorResponse
            if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
                t.Fatalf("decode error response: %v", err)
            }
            if resp.Error.Code != tt.expectedCode {
                t.Errorf("expected error code %q, got %q", tt.expectedCode, resp.Error.Code)
            }
        })
    }
}

// TestGetUser_NotFound tests the 404 response.
func TestGetUser_NotFound(t *testing.T) {
    handler := newTestHandler()

    req := httptest.NewRequest(http.MethodGet, "/v1/users/999", nil)
    // chi URL params are set via context in real routing.
    // For unit tests, we can use chi's RouteContext:
    rctx := chi.NewRouteContext()
    rctx.URLParams.Add("userID", "999")
    req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

    rr := httptest.NewRecorder()
    handler.GetUser(rr, req)

    if rr.Code != http.StatusNotFound {
        t.Errorf("expected 404, got %d", rr.Code)
    }
}

// TestDeleteUser_Success tests the 204 No Content response.
func TestDeleteUser_Success(t *testing.T) {
    handler := newTestHandler()
    ctx := context.Background()

    // Create a user first
    user := handler.store.Create(CreateUserRequest{
        Name: "DeleteMe", Email: "del@example.com", Role: "user",
    })

    req := httptest.NewRequest(http.MethodDelete, "/v1/users/"+user.ID, nil)
    rctx := chi.NewRouteContext()
    rctx.URLParams.Add("userID", user.ID)
    req = req.WithContext(context.WithValue(ctx, chi.RouteCtxKey, rctx))

    rr := httptest.NewRecorder()
    handler.DeleteUser(rr, req)

    if rr.Code != http.StatusNoContent {
        t.Errorf("expected 204, got %d. Body: %s", rr.Code, rr.Body.String())
    }
    if rr.Body.Len() != 0 {
        t.Errorf("expected empty body on 204, got: %s", rr.Body.String())
    }
}

// TestFullStack_Integration tests the full router with httptest.NewServer.
// This exercises routing, middleware, and handlers together.
func TestFullStack_Integration(t *testing.T) {
    ts := httptest.NewServer(NewRouter())
    defer ts.Close()

    client := ts.Client()

    // Health check — no auth required
    resp, err := client.Get(ts.URL + "/health")
    if err != nil {
        t.Fatalf("health check: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        t.Errorf("health check: expected 200, got %d", resp.StatusCode)
    }

    // Authenticated endpoint without token — should get 401
    resp2, err := client.Get(ts.URL + "/v1/users")
    if err != nil {
        t.Fatalf("users without auth: %v", err)
    }
    defer resp2.Body.Close()

    if resp2.StatusCode != http.StatusUnauthorized {
        t.Errorf("expected 401 without token, got %d", resp2.StatusCode)
    }
}

// Missing imports needed for the test file
import (
    "context"
    "github.com/go-chi/chi/v5"
)
```

---

## 12. Complete Mini REST API: Putting It All Together

```go
// File: complete_api.go
// This is a self-contained example of a production-style REST API.
// Copy-paste and run with: go run complete_api.go

package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "strings"
    "syscall"
    "time"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
)

// ---- Domain ----

type Product struct {
    ID          string    `json:"id"`
    Name        string    `json:"name"`
    Price       float64   `json:"price"`
    Description string    `json:"description,omitempty"`
    CreatedAt   time.Time `json:"created_at"`
}

type CreateProductRequest struct {
    Name        string  `json:"name"`
    Price       float64 `json:"price"`
    Description string  `json:"description"`
}

// ---- Response helpers ----

func jsonResponse(w http.ResponseWriter, status int, data any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(data)
}

func errorJSON(w http.ResponseWriter, status int, code, msg string) {
    jsonResponse(w, status, map[string]any{
        "error": map[string]string{"code": code, "message": msg},
    })
}

// ---- In-memory store ----

type store struct {
    products map[string]Product
    seq      int
}

func newStore() *store {
    s := &store{products: make(map[string]Product)}
    // Seed data
    s.seq++
    s.products["1"] = Product{ID: "1", Name: "Gopher Plushie", Price: 29.99, CreatedAt: time.Now()}
    return s
}

// ---- Handlers ----

type productHandler struct{ store *store }

func (h *productHandler) list(w http.ResponseWriter, r *http.Request) {
    items := make([]Product, 0, len(h.store.products))
    for _, p := range h.store.products {
        items = append(items, p)
    }
    jsonResponse(w, http.StatusOK, map[string]any{"products": items, "total": len(items)})
}

func (h *productHandler) get(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    p, ok := h.store.products[id]
    if !ok {
        errorJSON(w, http.StatusNotFound, "not_found", "product not found")
        return
    }
    jsonResponse(w, http.StatusOK, map[string]any{"product": p})
}

func (h *productHandler) create(w http.ResponseWriter, r *http.Request) {
    var req CreateProductRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        errorJSON(w, http.StatusBadRequest, "invalid_json", err.Error())
        return
    }

    // Validate
    var errs []map[string]string
    if strings.TrimSpace(req.Name) == "" {
        errs = append(errs, map[string]string{"field": "name", "message": "required"})
    }
    if req.Price <= 0 {
        errs = append(errs, map[string]string{"field": "price", "message": "must be greater than 0"})
    }
    if len(errs) > 0 {
        jsonResponse(w, http.StatusUnprocessableEntity, map[string]any{
            "error": map[string]any{"code": "validation_error", "details": errs},
        })
        return
    }

    h.store.seq++
    id := fmt.Sprintf("%d", h.store.seq)
    p := Product{
        ID:          id,
        Name:        req.Name,
        Price:       req.Price,
        Description: req.Description,
        CreatedAt:   time.Now(),
    }
    h.store.products[id] = p

    w.Header().Set("Location", "/v1/products/"+id)
    jsonResponse(w, http.StatusCreated, map[string]any{"product": p})
}

func (h *productHandler) delete(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    if _, ok := h.store.products[id]; !ok {
        errorJSON(w, http.StatusNotFound, "not_found", "product not found")
        return
    }
    delete(h.store.products, id)
    w.WriteHeader(http.StatusNoContent)
}

// ---- Main ----

func runServer() error {
    r := chi.NewRouter()
    r.Use(middleware.RequestID)
    r.Use(middleware.Recoverer)

    r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
        jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
    })

    ph := &productHandler{store: newStore()}
    r.Route("/v1/products", func(r chi.Router) {
        r.Get("/", ph.list)
        r.Post("/", ph.create)
        r.Get("/{id}", ph.get)
        r.Delete("/{id}", ph.delete)
    })

    srv := &http.Server{
        Addr:         ":8080",
        Handler:      r,
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 30 * time.Second,
    }

    done := make(chan struct{})
    go func() {
        quit := make(chan os.Signal, 1)
        signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
        <-quit
        ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
        defer cancel()
        srv.Shutdown(ctx)
        close(done)
    }()

    slog.Info("server started", "addr", srv.Addr)
    if err := srv.ListenAndServe(); err != http.ErrServerClosed {
        return err
    }
    <-done
    slog.Info("server stopped")
    return nil
}

func main() {
    if err := runServer(); err != nil {
        slog.Error("server error", "err", err)
        os.Exit(1)
    }
}
```

---

## Summary: REST API Production Checklist

| Concern | Pattern | Tool/Package |
|---|---|---|
| Routing | `r.Route("/v1", ...)` with URL params | `chi` |
| JSON response | Centralized `writeJSON` helper | `encoding/json` |
| JSON decoding | `json.NewDecoder(r.Body).Decode` | `encoding/json` |
| Input validation | Validate all fields, return all errors | Custom validators |
| Error format | `{ "error": { "code", "message", "details" } }` | Consistent envelope |
| Authentication | JWT middleware, `context.WithValue` | `golang-jwt/jwt` |
| Authorization | `RequireRole` middleware | Middleware chain |
| Rate limiting | Token bucket per IP or Redis counter | Custom / `go-redis` |
| API versioning | URL prefix `/v1/`, `/v2/` | chi route groups |
| Documentation | OpenAPI annotations | `swaggo/swag` |
| Handler testing | `httptest.NewRecorder` | `net/http/httptest` |
| Integration tests | `httptest.NewServer` | `net/http/httptest` |
| Graceful shutdown | `srv.Shutdown(ctx)` on SIGTERM | `net/http` |
| Request logging | Structured per-request log | `log/slog` |
