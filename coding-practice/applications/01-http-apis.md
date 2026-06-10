> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# Go HTTP APIs — Coding Practice

---
## Q1: Basic HTTP Server  [Level 1 — Beginner]
> **Tags:** `#http` `#server` `#net/http`

### Problem Statement
Build a minimal HTTP server in Go that listens on port 8080 and responds with "Hello, World!" to every GET request on the `/hello` path. Any other path should return a 404 Not Found. Use only the standard `net/http` package.

### Input / Output / Constraints
```
Input:  GET /hello HTTP/1.1
Output: 200 OK — body: "Hello, World!"
        GET /other → 404 Not Found
Constraints: stdlib only, port 8080, no external router
```

### Thought Process
1. Understand: Register a handler for `/hello`, use DefaultServeMux, start ListenAndServe.
2. Pattern: `http.HandleFunc` + `http.ListenAndServe` — the simplest server pattern.
3. Edge cases: Wrong path (404), wrong method (should still return 200 unless we check), port already in use.

### Brute Force
```go
// O(1) time, O(1) space — handler is constant work
package main

import (
    "fmt"
    "net/http"
)

func bruteForce() {
    // Register a catch-all and manually check the path inside
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path == "/hello" {
            fmt.Fprintln(w, "Hello, World!")
        } else {
            http.NotFound(w, r)
        }
    })
    http.ListenAndServe(":8080", nil)
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Use separate handler registrations — cleaner separation
func better() {
    http.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "Hello, World!")
    })
    // DefaultServeMux returns 404 for unregistered paths automatically
    http.ListenAndServe(":8080", nil)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
)

// helloHandler — O(1) time, O(1) space
func helloHandler(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
        return
    }
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    fmt.Fprintln(w, "Hello, World!")
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/hello", helloHandler)

    srv := &http.Server{
        Addr:    ":8080",
        Handler: mux,
    }

    log.Println("Server listening on :8080")
    if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
        log.Fatalf("server error: %v", err)
    }
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Single handler is stateless — scales horizontally behind a load balancer |
| Edge Cases | Wrong method, path trailing slash, URL encoding |
| Error Handling | Always check ListenAndServe error; ignore ErrServerClosed on graceful shutdown |
| Memory | DefaultServeMux holds registered patterns in a map — minimal overhead |
| Concurrency | Each request runs in its own goroutine; handler must be goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["Client GET /hello"] --> B["net/http listener :8080"]
    B --> C{Path == /hello?}
    C -->|Yes| D["helloHandler()"]
    C -->|No| E["404 Not Found"]
    D --> F["200 OK — Hello, World!"]
```
```
Trace: Request → ServeMux.ServeHTTP → pattern match → helloHandler → ResponseWriter.Write
```

### Interviewer Questions
1. Why use `http.NewServeMux()` over `http.DefaultServeMux`? Avoids global state — tests can create isolated muxes.
2. Can it be optimized? For Hello World, no — latency is dominated by network, not handler.
3. Scale to 10M? Add a reverse proxy (nginx/Envoy), horizontal pods, keep-alive connections.
4. Edge cases? Port conflict, panics in handler, slow clients holding connections.
5. Goroutine-safe? Yes — `fmt.Fprintln` on `http.ResponseWriter` is safe within a single handler invocation.
6. Memory impact? Negligible — each goroutine stack ~2 KB; Go scheduler multiplexes over OS threads.
7. Alternative? Use `http.ServeMux` pattern matching (Go 1.22 method+path syntax).

### Follow-Up Questions
**Q1:** What happens if you call `w.Write` after `w.WriteHeader`? **A1:** Headers are already sent; only the body write happens — no error but headers cannot change.
**Q2:** How do you set a custom Content-Type? **A2:** `w.Header().Set("Content-Type", "application/json")` before the first Write.
**Q3:** What does `http.NotFound` do internally? **A3:** Calls `http.Error(w, "404 page not found", 404)` which sets Content-Type and writes the body.
**Q4:** Can two handlers share the same path? **A4:** No — `ServeMux` panics on duplicate exact pattern registration.
**Q5:** How would you add TLS? **A5:** Replace `ListenAndServe` with `ListenAndServeTLS(addr, certFile, keyFile, handler)`.

---

## Q2: Custom ServeHTTP  [Level 1 — Beginner]
> **Tags:** `#http.Handler` `#ServeHTTP` `#interface`

### Problem Statement
Implement the `http.Handler` interface by creating a struct `GreetHandler` that holds a greeting message. Its `ServeHTTP` method should write the greeting followed by the request path to the response. This teaches how Go's HTTP server dispatches to any value that satisfies the Handler interface.

### Input / Output / Constraints
```
Input:  GreetHandler{Greeting: "Welcome"}, GET /api/users
Output: "Welcome — /api/users"
Constraints: Must implement http.Handler interface, no HandleFunc
```

### Thought Process
1. Understand: `http.Handler` requires one method: `ServeHTTP(ResponseWriter, *Request)`.
2. Pattern: Struct + method satisfies interface — dependency injection of config into handler.
3. Edge cases: Nil greeting, concurrent reads of struct fields.

### Brute Force
```go
// O(1) time, O(1) space
package main

import (
    "fmt"
    "net/http"
)

type GreetHandlerBrute struct{}

func (g GreetHandlerBrute) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Hardcoded — not reusable
    fmt.Fprintf(w, "Hello — %s", r.URL.Path)
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
type GreetHandler struct {
    Greeting string
}

func (g GreetHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    greeting := g.Greeting
    if greeting == "" {
        greeting = "Hello"
    }
    fmt.Fprintf(w, "%s — %s", greeting, r.URL.Path)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
)

// GreetHandler implements http.Handler — O(1) time, O(1) space
type GreetHandler struct {
    Greeting string
}

func (g *GreetHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    greeting := g.Greeting
    if greeting == "" {
        greeting = "Hello"
    }
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    w.WriteHeader(http.StatusOK)
    fmt.Fprintf(w, "%s — %s\n", greeting, r.URL.Path)
}

func main() {
    mux := http.NewServeMux()
    mux.Handle("/greet/", &GreetHandler{Greeting: "Welcome"})
    mux.Handle("/api/", &GreetHandler{Greeting: "API"})

    log.Println("Listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Stateless struct handler; safe for concurrent use if fields are read-only after init |
| Edge Cases | Empty greeting fallback, path sanitization to prevent log injection |
| Error Handling | Wrap fmt.Fprintf error check in production; ResponseWriter errors indicate client disconnect |
| Memory | Handler struct allocated once; reused across requests — zero per-request allocation |
| Concurrency | Pointer receiver is safe if Greeting is never mutated after registration |

### Visual Explanation
```mermaid
flowchart TD
    A["http.ListenAndServe"] --> B["ServeMux.ServeHTTP"]
    B --> C["Pattern match /greet/"]
    C --> D["GreetHandler.ServeHTTP"]
    D --> E["Write: Welcome — /greet/users"]
```
```
Trace: mux.Handle registers *GreetHandler → request arrives → mux calls .ServeHTTP → writes response
```

### Interviewer Questions
1. Why pointer vs value receiver on ServeHTTP? Pointer allows future mutation and consistent interface satisfaction.
2. Can it be optimized? Buffer writes with bufio for high-throughput, though for small responses it's unnecessary.
3. Scale to 10M? Handler is stateless — scales perfectly; add connection pooling upstream.
4. Edge cases? Nil receiver, concurrent writes to same ResponseWriter (don't do it), path injection.
5. Goroutine-safe? Yes, as long as struct fields are not mutated after server start.
6. Memory impact? One struct allocation at startup; zero per request.
7. Alternative? Use `http.HandlerFunc` adapter for plain functions — lighter syntax for one-off handlers.

### Follow-Up Questions
**Q1:** What is `http.HandlerFunc`? **A1:** A function type that implements `http.Handler` — it adapts `func(ResponseWriter, *Request)` to the Handler interface.
**Q2:** Can a struct implement multiple HTTP behaviors? **A2:** Yes — attach multiple methods and register each via `http.HandlerFunc(s.Method)`.
**Q3:** How do you pass dependencies (DB, logger) into a handler? **A3:** Embed them as fields in the handler struct — constructor injection pattern.
**Q4:** What is `http.StripPrefix`? **A4:** A middleware that removes a path prefix before passing to the next handler — useful for mounting sub-routers.
**Q5:** How does Go decide which handler to call? **A5:** `ServeMux` matches longest path prefix; exact patterns take priority over prefix patterns.

---

## Q3: JSON Request and Response  [Level 1 — Beginner]
> **Tags:** `#json` `#encoding/json` `#request-body` `#response`

### Problem Statement
Build an HTTP endpoint `POST /echo` that reads a JSON body `{"message": "..."}`, decodes it, and responds with `{"echo": "...", "length": N}` where N is the character count of the message. Return appropriate HTTP error codes for malformed JSON or missing fields.

### Input / Output / Constraints
```
Input:  POST /echo  Body: {"message": "hello"}
Output: 200 OK      Body: {"echo": "hello", "length": 5}
        malformed JSON → 400 Bad Request
Constraints: Use encoding/json, max body 1MB, Content-Type: application/json
```

### Thought Process
1. Understand: Decode JSON request body → validate → encode JSON response.
2. Pattern: `json.NewDecoder(r.Body).Decode(&req)` + `json.NewEncoder(w).Encode(resp)`.
3. Edge cases: Empty body, extra fields, very large body, wrong Content-Type.

### Brute Force
```go
// O(n) time where n = body size, O(n) space
package main

import (
    "encoding/json"
    "io"
    "net/http"
)

func bruteForceEcho(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    var m map[string]interface{}
    json.Unmarshal(body, &m) // ignores error — bad practice
    msg, _ := m["message"].(string)
    resp := map[string]interface{}{"echo": msg, "length": len(msg)}
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(resp)
}
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
type EchoReq  struct { Message string `json:"message"` }
type EchoResp struct { Echo string `json:"echo"`; Length int `json:"length"` }

func betterEcho(w http.ResponseWriter, r *http.Request) {
    var req EchoReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(EchoResp{Echo: req.Message, Length: len(req.Message)})
}
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "encoding/json"
    "io"
    "log"
    "net/http"
)

type EchoRequest struct {
    Message string `json:"message"`
}

type EchoResponse struct {
    Echo   string `json:"echo"`
    Length int    `json:"length"`
}

// echoHandler — O(n) time, O(n) space where n = message length
func echoHandler(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }

    // Limit body to 1 MB
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

    var req EchoRequest
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()
    if err := dec.Decode(&req); err != nil {
        writeJSONError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
        return
    }
    defer r.Body.Close()

    if req.Message == "" {
        writeJSONError(w, "message field is required", http.StatusUnprocessableEntity)
        return
    }

    writeJSON(w, http.StatusOK, EchoResponse{Echo: req.Message, Length: len(req.Message)})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    if err := json.NewEncoder(w).Encode(v); err != nil {
        log.Printf("writeJSON encode error: %v", err)
    }
}

func writeJSONError(w http.ResponseWriter, msg string, status int) {
    writeJSON(w, status, map[string]string{"error": msg})
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/echo", echoHandler)
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(n) | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Streaming decoder avoids reading full body into memory first |
| Edge Cases | MaxBytesReader prevents memory exhaustion; DisallowUnknownFields prevents silent data loss |
| Error Handling | Always return structured JSON errors — never leak internal error strings |
| Memory | json.Decoder streams; only the decoded struct is allocated on heap |
| Concurrency | Handler is stateless; safe for concurrent requests |

### Visual Explanation
```mermaid
flowchart TD
    A["POST /echo\n{message:hello}"] --> B["MaxBytesReader 1MB"]
    B --> C["json.Decode → EchoRequest"]
    C -->|decode error| D["400 Bad Request"]
    C -->|ok| E{"message empty?"}
    E -->|yes| F["422 Unprocessable"]
    E -->|no| G["json.Encode EchoResponse"]
    G --> H["200 OK {echo,length}"]
```
```
Trace: body → decoder → struct → validate → encode → response
```

### Interviewer Questions
1. Why stream decode instead of ReadAll+Unmarshal? Lower memory — decoder reads incrementally.
2. Can it be optimized? Use `sonic` or `json-iterator` for faster JSON parsing at high QPS.
3. Scale to 10M? Stateless — horizontal scale; add CDN/rate limiting at edge.
4. Edge cases? Null JSON, array instead of object, number in message field.
5. Goroutine-safe? Yes — no shared state.
6. Memory impact? Each request allocates one struct; GC reclaims quickly.
7. Alternative? Use `github.com/go-playground/validator` for struct validation tags.

### Follow-Up Questions
**Q1:** What does `DisallowUnknownFields` do? **A1:** Returns an error if the JSON contains keys not present in the target struct — prevents silent data loss.
**Q2:** How do you handle nested JSON objects? **A2:** Define nested structs and embed them as fields; json package handles recursion.
**Q3:** What is `json:"omitempty"`? **A3:** Omits the field from the encoded JSON output if it holds a zero value.
**Q4:** How do you pretty-print JSON in a response? **A4:** Use `json.MarshalIndent` or set encoder indent with `enc.SetIndent("", "  ")`.
**Q5:** What is the difference between `json.Marshal` and `json.NewEncoder`? **A5:** Marshal returns a byte slice (full buffer); Encoder streams directly to a Writer — prefer Encoder for HTTP responses.

---

## Q4: Route Parameters (Go 1.22)  [Level 2 — Easy]
> **Tags:** `#routing` `#go1.22` `#path-params` `#ServeMux`

### Problem Statement
Go 1.22 enhanced `http.ServeMux` to support method and wildcard routing. Build a simple user resource API: `GET /users/{id}` returns user info and `DELETE /users/{id}` deletes a user. Use `r.PathValue("id")` to extract the path parameter. Validate that the ID is a positive integer.

### Input / Output / Constraints
```
Input:  GET /users/42
Output: 200 {"id":42,"name":"Alice"}
        GET /users/abc → 400 Bad Request
        DELETE /users/99 → 204 No Content
Constraints: Go 1.22+, stdlib only, in-memory store
```

### Thought Process
1. Understand: Register `"GET /users/{id}"` pattern; use `r.PathValue` to get captured segment.
2. Pattern: Go 1.22 method+wildcard routing — no third-party router needed.
3. Edge cases: Non-integer id, negative id, id not found in store.

### Brute Force
```go
// O(1) time, O(1) space — map lookup
package main

import (
    "net/http"
    "strings"
)

func brutePath(w http.ResponseWriter, r *http.Request) {
    // manual path splitting — fragile
    parts := strings.Split(r.URL.Path, "/")
    if len(parts) < 3 {
        http.Error(w, "bad path", 400)
        return
    }
    id := parts[2]
    w.Write([]byte("id=" + id))
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Go 1.22 PathValue — clean, no manual parsing
func betterGet(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    // still need strconv.Atoi validation
    w.Write([]byte("user " + id))
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "strconv"
    "sync"
)

type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

type UserStore struct {
    mu    sync.RWMutex
    users map[int]User
}

func NewUserStore() *UserStore {
    return &UserStore{users: map[int]User{
        1: {1, "Alice"}, 2: {2, "Bob"}, 42: {42, "Charlie"},
    }}
}

func (s *UserStore) Get(id int) (User, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    u, ok := s.users[id]
    return u, ok
}

func (s *UserStore) Delete(id int) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    _, ok := s.users[id]
    delete(s.users, id)
    return ok
}

// parseID validates and parses the {id} path value
func parseID(w http.ResponseWriter, r *http.Request) (int, bool) {
    raw := r.PathValue("id")
    id, err := strconv.Atoi(raw)
    if err != nil || id <= 0 {
        http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
        return 0, false
    }
    return id, true
}

func main() {
    store := NewUserStore()
    mux := http.NewServeMux()

    // Go 1.22: method prefix in pattern
    mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
        id, ok := parseID(w, r)
        if !ok {
            return
        }
        user, found := store.Get(id)
        if !found {
            http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
            return
        }
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(user)
    })

    mux.HandleFunc("DELETE /users/{id}", func(w http.ResponseWriter, r *http.Request) {
        id, ok := parseID(w, r)
        if !ok {
            return
        }
        store.Delete(id)
        w.WriteHeader(http.StatusNoContent)
    })

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) map lookup | **Space:** O(n) for user store

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | In-memory store won't scale across pods — replace with database |
| Edge Cases | ID overflow (strconv.Atoi handles), concurrent delete+get race (RWMutex covers it) |
| Error Handling | Return JSON errors consistently; never mix text/plain and application/json |
| Memory | sync.Map or sharded map for very high concurrency |
| Concurrency | RWMutex allows concurrent reads; write lock for mutations |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /users/42"] --> B["ServeMux — pattern match\nGET /users/{id}"]
    B --> C["r.PathValue('id') = '42'"]
    C --> D["strconv.Atoi → 42"]
    D -->|invalid| E["400 Bad Request"]
    D -->|valid| F["store.Get(42)"]
    F -->|not found| G["404 Not Found"]
    F -->|found| H["json.Encode User → 200"]
```
```
Trace: /users/42 → PathValue("id")="42" → Atoi=42 → map[42] → encode → 200
```

### Interviewer Questions
1. What changed in Go 1.22 routing? Method prefix (`GET /path`) and wildcards (`{id}`) are now supported natively.
2. Can it be optimized? Use a trie-based router (chi, httprouter) for hundreds of routes.
3. Scale to 10M? Replace in-memory map with Redis/PostgreSQL; add caching layer.
4. Edge cases? Trailing slash, URL-encoded path segments, very large IDs.
5. Goroutine-safe? Yes — RWMutex protects the map.
6. Memory impact? O(n) for users in map; each request has minimal stack allocation.
7. Alternative? Use `gorilla/mux` or `chi` for richer routing before Go 1.22.

### Follow-Up Questions
**Q1:** What is `r.PathValue` vs `r.FormValue`? **A1:** PathValue extracts from URL path segments (Go 1.22 wildcards); FormValue parses query string or form body.
**Q2:** How do you match a wildcard that captures the rest of the path? **A2:** Use `{path...}` — a trailing wildcard matching everything including slashes.
**Q3:** What happens if no pattern matches in Go 1.22 mux? **A3:** Returns 405 Method Not Allowed if path matches but method doesn't; 404 if path doesn't match at all.
**Q4:** How do you add path prefix matching? **A4:** Register pattern ending with `/` — e.g., `/api/` matches all paths under `/api/`.
**Q5:** Can you register the same path with different methods? **A5:** Yes — `GET /users/{id}` and `DELETE /users/{id}` are separate patterns in Go 1.22.

---

## Q5: Query Parameters  [Level 2 — Easy]
> **Tags:** `#query-params` `#url.Values` `#filtering`

### Problem Statement
Build a `GET /products` endpoint that accepts query parameters: `category` (string), `min_price` (float), `max_price` (float), and `page` (int, default 1). Filter an in-memory product list and return paginated results. Validate that `min_price <= max_price` and `page >= 1`.

### Input / Output / Constraints
```
Input:  GET /products?category=books&min_price=10&max_price=50&page=2
Output: 200 {"products":[...],"page":2,"total":15}
        min_price > max_price → 400
Constraints: page size fixed at 10, all params optional
```

### Thought Process
1. Understand: Parse query params with `r.URL.Query()`, apply filters, paginate.
2. Pattern: `url.Values.Get()` returns empty string if absent → apply defaults.
3. Edge cases: Negative price, page 0, non-numeric values, empty results.

### Brute Force
```go
// O(n) time, O(n) space
func bruteProducts(w http.ResponseWriter, r *http.Request) {
    cat := r.URL.Query().Get("category")
    _ = cat // filter not applied in brute force
    // returns all products — ignores pagination
    w.Write([]byte(`{"products":[]}`))
}
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
func betterProducts(w http.ResponseWriter, r *http.Request) {
    q := r.URL.Query()
    category := q.Get("category")
    minPrice, _ := strconv.ParseFloat(q.Get("min_price"), 64)
    maxPrice, _ := strconv.ParseFloat(q.Get("max_price"), 64)
    // apply filters, ignore pagination
    _ = category; _ = minPrice; _ = maxPrice
}
```
**Time:** O(n) | **Space:** O(k) — k = filtered results

### Best Solution
```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "strconv"
    "strings"
)

type Product struct {
    ID       int     `json:"id"`
    Name     string  `json:"name"`
    Category string  `json:"category"`
    Price    float64 `json:"price"`
}

var catalog = []Product{
    {1, "Go Programming", "books", 29.99},
    {2, "Clean Code", "books", 39.99},
    {3, "Keyboard", "tech", 79.00},
    {4, "Mouse", "tech", 45.00},
    {5, "Design Patterns", "books", 49.99},
}

const pageSize = 10

type ProductsResponse struct {
    Products []Product `json:"products"`
    Page     int       `json:"page"`
    Total    int       `json:"total"`
    PageSize int       `json:"page_size"`
}

// productsHandler — O(n) time, O(k) space
func productsHandler(w http.ResponseWriter, r *http.Request) {
    q := r.URL.Query()

    // Parse optional filters
    category := strings.TrimSpace(q.Get("category"))

    var minPrice, maxPrice float64 = 0, 1<<53
    var err error
    if v := q.Get("min_price"); v != "" {
        minPrice, err = strconv.ParseFloat(v, 64)
        if err != nil || minPrice < 0 {
            http.Error(w, `{"error":"invalid min_price"}`, http.StatusBadRequest)
            return
        }
    }
    if v := q.Get("max_price"); v != "" {
        maxPrice, err = strconv.ParseFloat(v, 64)
        if err != nil || maxPrice < 0 {
            http.Error(w, `{"error":"invalid max_price"}`, http.StatusBadRequest)
            return
        }
    }
    if minPrice > maxPrice {
        http.Error(w, `{"error":"min_price must be <= max_price"}`, http.StatusBadRequest)
        return
    }

    page := 1
    if v := q.Get("page"); v != "" {
        page, err = strconv.Atoi(v)
        if err != nil || page < 1 {
            http.Error(w, `{"error":"invalid page"}`, http.StatusBadRequest)
            return
        }
    }

    // Filter
    var filtered []Product
    for _, p := range catalog {
        if category != "" && !strings.EqualFold(p.Category, category) {
            continue
        }
        if p.Price < minPrice || p.Price > maxPrice {
            continue
        }
        filtered = append(filtered, p)
    }

    total := len(filtered)
    start := (page - 1) * pageSize
    if start > total {
        start = total
    }
    end := start + pageSize
    if end > total {
        end = total
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(ProductsResponse{
        Products: filtered[start:end],
        Page:     page,
        Total:    total,
        PageSize: pageSize,
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /products", productsHandler)
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(n) filter | **Space:** O(k) filtered slice

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Move catalog to database with indexed columns for category and price |
| Edge Cases | XSS via category (sanitize), huge page number, float precision |
| Error Handling | Validate all params before processing; return descriptive errors |
| Memory | Avoid copying large product structs — use pointers or indices |
| Concurrency | Read-only catalog is safe; add RWMutex if catalog is mutable |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /products?category=books\n&min=10&max=50&page=1"] --> B["Parse query params"]
    B --> C{"Validate\nparams"}
    C -->|invalid| D["400 Bad Request"]
    C -->|valid| E["Filter catalog\nO(n)"]
    E --> F["Paginate\nslice[start:end]"]
    F --> G["200 OK\nJSON response"]
```
```
Trace: query parse → validate → filter loop → slice → encode → 200
```

### Interviewer Questions
1. Why use `r.URL.Query()` vs `r.FormValue`? Query() returns all values for multi-value params; FormValue only returns first.
2. Can it be optimized? Pre-sort/index products by price for O(log n) range queries.
3. Scale to 10M? Database query with WHERE clause and LIMIT/OFFSET + cursor pagination.
4. Edge cases? Float NaN, Inf, very large page numbers exceeding total pages.
5. Goroutine-safe? Yes — read-only catalog; parallel requests safe.
6. Memory impact? Filtered slice may be large — use cursor-based pagination to limit allocation.
7. Alternative? GraphQL for flexible field selection; gRPC for internal services.

### Follow-Up Questions
**Q1:** What is cursor-based vs offset pagination? **A1:** Cursor uses a stable ID/timestamp as a position marker; offset uses LIMIT/OFFSET — cursor is more stable for real-time data.
**Q2:** How do you handle multi-value query params like `?tag=go&tag=http`? **A2:** Use `r.URL.Query()["tag"]` which returns `[]string`.
**Q3:** How do you prevent SQL injection when using query params with a DB? **A3:** Use parameterized queries / prepared statements — never interpolate user input into SQL.
**Q4:** What is the `url.Values` type? **A4:** `map[string][]string` — the type returned by `url.ParseQuery` and `r.URL.Query()`.
**Q5:** How do you make query param parsing reusable? **A5:** Write a helper like `queryFloat(q url.Values, key string, def float64) (float64, error)`.

---

## Q6: Logging Middleware  [Level 2 — Easy]
> **Tags:** `#middleware` `#logging` `#handler-chain`

### Problem Statement
Implement a logging middleware that wraps any `http.Handler` and logs the HTTP method, URL path, status code, response size, and request duration for every incoming request. The middleware must capture the status code written by the downstream handler without modifying the response.

### Input / Output / Constraints
```
Input:  Any HTTP request through the middleware chain
Output: Log line: "GET /api/users 200 124B 1.2ms"
Constraints: Must not buffer response body, capture status via wrapped ResponseWriter
```

### Thought Process
1. Understand: Wrap `http.ResponseWriter` to intercept `WriteHeader` calls and track status + bytes.
2. Pattern: `responseRecorder` struct embedding `http.ResponseWriter` — intercept without buffering.
3. Edge cases: Handler panics (status 0), handler calls WriteHeader multiple times, streaming responses.

### Brute Force
```go
// O(1) time, O(1) space — but loses status code
func bruteLogger(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r) // status code lost
        log.Printf("%s %s %.2fms", r.Method, r.URL.Path, float64(time.Since(start).Microseconds())/1000)
    })
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
type statusRecorder struct {
    http.ResponseWriter
    status int
}
func (sr *statusRecorder) WriteHeader(code int) {
    sr.status = code
    sr.ResponseWriter.WriteHeader(code)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "time"
)

// responseRecorder captures status code and bytes written — O(1) overhead
type responseRecorder struct {
    http.ResponseWriter
    status       int
    bytesWritten int
}

func (rr *responseRecorder) WriteHeader(code int) {
    if rr.status == 0 { // only capture first WriteHeader call
        rr.status = code
    }
    rr.ResponseWriter.WriteHeader(code)
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
    if rr.status == 0 {
        rr.status = http.StatusOK // implicit 200 on first Write
    }
    n, err := rr.ResponseWriter.Write(b)
    rr.bytesWritten += n
    return n, err
}

func (rr *responseRecorder) statusCode() int {
    if rr.status == 0 {
        return http.StatusOK
    }
    return rr.status
}

// LoggingMiddleware wraps next with request/response logging
func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rec := &responseRecorder{ResponseWriter: w}

        next.ServeHTTP(rec, r)

        duration := time.Since(start)
        log.Printf(
            "%s %s %d %dB %.3fms",
            r.Method,
            r.URL.RequestURI(),
            rec.statusCode(),
            rec.bytesWritten,
            float64(duration.Nanoseconds())/1e6,
        )
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "Hello!")
    })

    logged := LoggingMiddleware(mux)
    log.Fatal(http.ListenAndServe(":8080", logged))
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Log asynchronously to avoid blocking request goroutines in high-throughput services |
| Edge Cases | Hijacked connections (WebSocket), handler panic (status 0 → default 200), chunked encoding |
| Error Handling | Wrap logger output in structured JSON (zap/zerolog) for log aggregators |
| Memory | responseRecorder is stack-allocated per request; minimal heap pressure |
| Concurrency | Each request has its own recorder — no sharing; safe |

### Visual Explanation
```mermaid
flowchart TD
    A["Request"] --> B["LoggingMiddleware"]
    B --> C["responseRecorder wraps w"]
    C --> D["next.ServeHTTP(rec, r)"]
    D --> E["handler writes status + body"]
    E --> F["log: METHOD PATH STATUS BYTES TIME"]
    F --> G["Response to client"]
```
```
Trace: request → recorder created → handler runs → WriteHeader captured → log written → response sent
```

### Interviewer Questions
1. Why wrap ResponseWriter instead of just timing? Need to capture status code — ResponseWriter.WriteHeader must be intercepted.
2. Can it be optimized? Use sync.Pool for responseRecorder to avoid per-request allocation.
3. Scale to 10M? Buffer logs in a channel; async writer goroutine flushes to disk/Kafka.
4. Edge cases? Multiple WriteHeader calls (only capture first), no WriteHeader (implicit 200).
5. Goroutine-safe? Yes — each request has its own recorder instance.
6. Memory impact? One small struct per request; GC pressure negligible.
7. Alternative? Use structured logging libraries (zap, zerolog) with fields instead of Printf.

### Follow-Up Questions
**Q1:** How do you chain multiple middlewares? **A1:** `handler = AuthMiddleware(LoggingMiddleware(RateLimitMiddleware(mux)))` — or use a middleware chain helper.
**Q2:** What is `http.ResponseController`? **A2:** Added in Go 1.20 — provides access to optional ResponseWriter interfaces (Flush, SetDeadline) safely.
**Q3:** How do you log request body without consuming it? **A3:** Use `io.TeeReader(r.Body, &buf)` and replace `r.Body` with the tee — body is read once, logged from buf.
**Q4:** How do you add request IDs for tracing? **A4:** Generate UUID in middleware, set on request context with `context.WithValue`, log alongside each line.
**Q5:** What is structured logging and why prefer it? **A5:** Key-value pairs (JSON) vs printf strings — parseable by log aggregators (Loki, Splunk) for filtering and alerting.

---

## Q7: Timing Middleware  [Level 2 — Easy]
> **Tags:** `#middleware` `#timing` `#performance`

### Problem Statement
Write a `TimingMiddleware` that measures handler execution time and adds an `X-Response-Time` header (in milliseconds) to every response. If the handler takes longer than a configurable threshold, also log a warning. The middleware should be configurable with a threshold duration.

### Input / Output / Constraints
```
Input:  Any request; threshold = 100ms
Output: Response header: X-Response-Time: 1.234ms
        Slow log: WARN slow request: GET /api/data 250.12ms > 100ms
Constraints: Non-intrusive, header set before body flush
```

### Thought Process
1. Understand: Record time before/after handler, set header, check threshold.
2. Pattern: Closure captures threshold; `time.Since` measures duration.
3. Edge cases: Header set after body written (too late), streaming responses.

### Brute Force
```go
// O(1) time — but header set too late for streaming
func bruteTiming(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        // Too late — headers already sent
        w.Header().Set("X-Response-Time", time.Since(start).String())
    })
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Use responseRecorder to set header before first write
func betterTiming(threshold time.Duration, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rec := &responseRecorder{ResponseWriter: w}
        next.ServeHTTP(rec, r)
        dur := time.Since(start)
        // Set trailer header — available after body
        w.Header().Set("X-Response-Time", fmt.Sprintf("%.3fms", float64(dur.Nanoseconds())/1e6))
    })
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "time"
)

// TimingMiddleware adds X-Response-Time header and warns on slow requests
func TimingMiddleware(threshold time.Duration, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()

        // Use a custom writer that buffers the first WriteHeader
        // so we can inject our header before headers are sent
        rec := &timingRecorder{ResponseWriter: w, headerWritten: false}
        next.ServeHTTP(rec, r)
        rec.flush() // ensure headers are sent

        dur := time.Since(start)
        ms := float64(dur.Nanoseconds()) / 1e6
        // Set as trailer if headers already sent, otherwise set normally
        w.Header().Set("X-Response-Time", fmt.Sprintf("%.3f ms", ms))

        if dur > threshold {
            log.Printf("WARN slow request: %s %s %.2fms > %s",
                r.Method, r.URL.Path, ms, threshold)
        }
    })
}

type timingRecorder struct {
    http.ResponseWriter
    headerWritten bool
    pendingStatus int
}

func (tr *timingRecorder) WriteHeader(code int) {
    if !tr.headerWritten {
        tr.pendingStatus = code
        tr.headerWritten = true
    }
}

func (tr *timingRecorder) Write(b []byte) (int, error) {
    if !tr.headerWritten {
        tr.flush()
    }
    return tr.ResponseWriter.Write(b)
}

func (tr *timingRecorder) flush() {
    if !tr.headerWritten {
        tr.pendingStatus = http.StatusOK
        tr.headerWritten = true
    }
    tr.ResponseWriter.WriteHeader(tr.pendingStatus)
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(200 * time.Millisecond)
        fmt.Fprintln(w, "done")
    })
    handler := TimingMiddleware(100*time.Millisecond, mux)
    log.Fatal(http.ListenAndServe(":8080", handler))
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Export timing as Prometheus histograms instead of (or in addition to) headers |
| Edge Cases | Header injection after flush, WebSocket upgrade hijacks ResponseWriter |
| Error Handling | Slow-request threshold should be configurable per route via context |
| Memory | Small struct per request; no body buffering |
| Concurrency | Per-request struct — no sharing |

### Visual Explanation
```mermaid
flowchart TD
    A["Request"] --> B["record start time"]
    B --> C["next.ServeHTTP(rec, r)"]
    C --> D["handler executes"]
    D --> E["calculate duration"]
    E --> F["set X-Response-Time header"]
    F --> G{duration > threshold?}
    G -->|yes| H["log WARN slow request"]
    G -->|no| I["response sent"]
    H --> I
```
```
Trace: start → handler → elapsed → header set → threshold check → log if slow → response
```

### Interviewer Questions
1. Why not set the header after ServeHTTP returns? Headers must be set before WriteHeader/Write — after they're sent, it's too late.
2. Can it be optimized? Use `sync/atomic` counter for concurrent slow-request tracking.
3. Scale to 10M? Emit metrics to Prometheus; alert via Grafana dashboards.
4. Edge cases? Streaming (chunked) responses, hijacked connections, panic in handler.
5. Goroutine-safe? Yes — per-request struct.
6. Memory impact? Negligible — struct lives for request duration only.
7. Alternative? Use OpenTelemetry spans for distributed tracing across services.

### Follow-Up Questions
**Q1:** What is an HTTP trailer? **A1:** Headers sent after the response body — useful for checksums or timing when values aren't known upfront.
**Q2:** How do you expose request timing as Prometheus metrics? **A2:** Use `prometheus/client_golang`; record histogram with `Observe(dur.Seconds())`.
**Q3:** What is `pprof`'s HTTP endpoint? **A3:** `/debug/pprof/` — import `net/http/pprof` to register profiling endpoints automatically.
**Q4:** How do you measure DB query time within a request? **A4:** Wrap DB calls with `time.Since(start)` and store in context; aggregate in middleware.
**Q5:** What is the P99 latency and why does it matter? **A5:** 99th percentile latency — the worst experience for 1 in 100 users; critical for SLA targets.

---

## Q8: Recovery Middleware  [Level 3 — Medium]
> **Tags:** `#middleware` `#recover` `#panic` `#resilience`

### Problem Statement
Implement a `RecoveryMiddleware` that catches panics in downstream handlers, logs the panic value and stack trace, and returns a 500 Internal Server Error response instead of crashing the server. Ensure it works correctly with the logging middleware when chained.

### Input / Output / Constraints
```
Input:  Handler that panics with any value
Output: 500 Internal Server Error — {"error":"internal server error"}
        Log: PANIC: runtime error: index out of range\n<stack trace>
Constraints: Must not expose panic details to client, log full stack
```

### Thought Process
1. Understand: `defer` + `recover()` inside the handler goroutine — recover only works in deferred functions.
2. Pattern: Wrap ServeHTTP call in deferred recover; use `debug.Stack()` for trace.
3. Edge cases: Panic with nil value, panic after partial response written (can't reset headers).

### Brute Force
```go
// O(1) — but incomplete error handling
func bruteRecover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                http.Error(w, "internal server error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```
**Time:** O(1) | **Space:** O(stack size)

### Better Solution
```go
import "runtime/debug"

func betterRecover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("PANIC: %v\n%s", err, debug.Stack())
                http.Error(w, `{"error":"internal server error"}`, 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```
**Time:** O(1) | **Space:** O(stack size)

### Best Solution
```go
package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "runtime/debug"
)

type errorResponse struct {
    Error     string `json:"error"`
    RequestID string `json:"request_id,omitempty"`
}

// RecoveryMiddleware catches panics and returns 500 — O(1) normal, O(stack) on panic
func RecoveryMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                // Log with full stack trace
                log.Printf("PANIC recovered: %v\n%s\nRequest: %s %s",
                    err, debug.Stack(), r.Method, r.URL.Path)

                // Check if headers already sent
                // If so, we can only close the connection
                w.Header().Set("Content-Type", "application/json")
                w.Header().Set("X-Content-Type-Options", "nosniff")
                w.WriteHeader(http.StatusInternalServerError)

                resp := errorResponse{Error: "internal server error"}
                if reqID := r.Header.Get("X-Request-ID"); reqID != "" {
                    resp.RequestID = reqID
                }
                json.NewEncoder(w).Encode(resp)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func main() {
    mux := http.NewServeMux()

    mux.HandleFunc("/panic", func(w http.ResponseWriter, r *http.Request) {
        panic(fmt.Errorf("something went terribly wrong"))
    })

    mux.HandleFunc("/ok", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "all good")
    })

    handler := RecoveryMiddleware(LoggingMiddleware(mux))
    log.Fatal(http.ListenAndServe(":8080", handler))
}
```
**Time:** O(1) normal, O(stack depth) on panic | **Space:** O(stack size)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Increment a panic counter metric for alerting on elevated panic rates |
| Edge Cases | Panic after partial write (headers sent) — connection must be closed; send error metric |
| Error Handling | Never expose internal error details to clients — security risk |
| Memory | Stack trace string can be large (KB); only allocated on panic path |
| Concurrency | Each goroutine has its own defer stack — no cross-goroutine recovery |

### Visual Explanation
```mermaid
flowchart TD
    A["Request"] --> B["RecoveryMiddleware\ndefer recover()"]
    B --> C["next.ServeHTTP"]
    C -->|normal| D["200 response"]
    C -->|panic!| E["recover() catches panic"]
    E --> F["log: PANIC + stack trace"]
    F --> G["500 Internal Server Error\nJSON error response"]
```
```
Trace: handler panics → defer fires → recover() → log stack → write 500 → goroutine continues
```

### Interviewer Questions
1. Why must recover be called in a deferred function? The Go runtime only invokes recover during the unwinding of a deferred function — calling it elsewhere returns nil.
2. Can it be optimized? No optimization needed — panic path is exceptional; normal path has zero overhead.
3. Scale to 10M? Add panic rate alerting via Prometheus; auto-restart pods on excessive panics.
4. Edge cases? `runtime.Goexit` is not a panic — recover doesn't catch it.
5. Goroutine-safe? Recover only works in the same goroutine — panics in spawned goroutines must be recovered there.
6. Memory impact? debug.Stack() allocates a string; only on panic path.
7. Alternative? Let Kubernetes restart crashed pods, but recovery middleware gives better observability.

### Follow-Up Questions
**Q1:** Can you recover a panic from a different goroutine? **A1:** No — each goroutine has its own stack; you must add deferred recover in every goroutine you spawn.
**Q2:** What is `runtime.Goexit()`? **A2:** Terminates the current goroutine without panicking — deferred functions still run but recover returns nil.
**Q3:** How do you distinguish panic from a nil pointer vs explicit panic? **A3:** Check the type of `err` from `recover()` — `runtime.Error` interface for runtime panics vs typed error values for explicit panics.
**Q4:** Should recovery middleware log the request body? **A4:** Yes for debugging — but redact sensitive fields (passwords, tokens); limit body size.
**Q5:** What happens if WriteHeader was already called when panic fires? **A5:** The status code is already sent; the body may be partially written — best effort is to close the connection.

---

## Q9: JWT Auth Middleware  [Level 3 — Medium]
> **Tags:** `#jwt` `#auth` `#middleware` `#security`

### Problem Statement
Implement a JWT authentication middleware using `golang-jwt/jwt/v5`. The middleware should validate a Bearer token from the `Authorization` header, extract claims (user ID, role), and inject them into the request context. Protected routes can then read claims from context. Return 401 for missing/invalid tokens and 403 for insufficient role.

### Input / Output / Constraints
```
Input:  Authorization: Bearer <jwt-token>
Output: 200 with handler response (valid token)
        401 Unauthorized (missing or malformed token)
        403 Forbidden (valid token but wrong role)
Constraints: HS256 signing, claims: {user_id, role, exp}, secret from env
```

### Thought Process
1. Understand: Extract header → parse JWT → validate signature+expiry → put claims in context → call next.
2. Pattern: Middleware chain with context propagation; `context.WithValue` for claims.
3. Edge cases: Expired token, wrong algorithm, tampered signature, missing claims.

### Brute Force
```go
// Insecure — no signature validation
func bruteAuth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if token == "" {
            http.Error(w, "unauthorized", 401)
            return
        }
        next.ServeHTTP(w, r) // accepts any token string — NEVER do this
    })
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Validate JWT but no context injection
import "github.com/golang-jwt/jwt/v5"

var jwtSecret = []byte(os.Getenv("JWT_SECRET"))

func betterAuth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
        _, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method")
            }
            return jwtSecret, nil
        })
        if err != nil {
            http.Error(w, "unauthorized", 401)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```
**Time:** O(n) token length | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
    "strings"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

type contextKey string

const claimsKey contextKey = "claims"

type Claims struct {
    UserID string `json:"user_id"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

var jwtSecret = []byte(func() string {
    s := os.Getenv("JWT_SECRET")
    if s == "" {
        return "dev-secret-change-in-production"
    }
    return s
}())

// JWTMiddleware validates Bearer JWT and injects claims into context
func JWTMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
            writeJSONErr(w, "missing or malformed authorization header", http.StatusUnauthorized)
            return
        }

        tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
        claims := &Claims{}

        token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
            }
            return jwtSecret, nil
        }, jwt.WithExpirationRequired())

        if err != nil || !token.Valid {
            writeJSONErr(w, "invalid or expired token", http.StatusUnauthorized)
            return
        }

        ctx := context.WithValue(r.Context(), claimsKey, claims)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// RequireRole is a role-checking middleware factory
func RequireRole(role string, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims, ok := r.Context().Value(claimsKey).(*Claims)
        if !ok || claims.Role != role {
            writeJSONErr(w, "forbidden: insufficient role", http.StatusForbidden)
            return
        }
        next.ServeHTTP(w, r)
    })
}

// ClaimsFromContext is a helper for handlers
func ClaimsFromContext(ctx context.Context) (*Claims, bool) {
    c, ok := ctx.Value(claimsKey).(*Claims)
    return c, ok
}

func writeJSONErr(w http.ResponseWriter, msg string, code int) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// IssueToken is a helper for testing
func IssueToken(userID, role string) (string, error) {
    claims := Claims{
        UserID: userID,
        Role:   role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
}

func main() {
    mux := http.NewServeMux()

    adminOnly := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims, _ := ClaimsFromContext(r.Context())
        json.NewEncoder(w).Encode(map[string]string{"user": claims.UserID, "role": claims.Role})
    })

    mux.Handle("/admin", JWTMiddleware(RequireRole("admin", adminOnly)))
    mux.Handle("/profile", JWTMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims, _ := ClaimsFromContext(r.Context())
        fmt.Fprintf(w, "Hello %s\n", claims.UserID)
    })))

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(n) — token parsing | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | JWT is stateless — no session store needed; scales horizontally |
| Edge Cases | Algorithm confusion attack (always check alg), token replay (add jti + blocklist) |
| Error Handling | Never reveal whether token expired vs invalid — information leakage |
| Memory | Claims struct allocated per request; GC quickly reclaims |
| Concurrency | jwtSecret is read-only after init — safe for concurrent use |

### Visual Explanation
```mermaid
flowchart TD
    A["Request + Bearer token"] --> B["Extract Authorization header"]
    B -->|missing| C["401 Unauthorized"]
    B -->|present| D["jwt.ParseWithClaims"]
    D -->|invalid sig/exp| E["401 Unauthorized"]
    D -->|valid| F["inject claims into context"]
    F --> G["RequireRole check"]
    G -->|wrong role| H["403 Forbidden"]
    G -->|ok| I["handler — reads claims from ctx"]
```
```
Trace: header → parse → validate → context.WithValue → handler → ClaimsFromContext
```

### Interviewer Questions
1. Why check the signing method before returning the key? Prevents algorithm confusion attacks — attacker could send `alg: none`.
2. Can it be optimized? Cache parsed JWKS (public keys) with TTL for RS256 verification.
3. Scale to 10M? Stateless JWT scales perfectly; use RS256 with JWKS endpoint for key rotation.
4. Edge cases? Expired token (check exp), future token (check nbf), missing required claims.
5. Goroutine-safe? Yes — context.WithValue creates a new context; no mutation.
6. Memory impact? Claims struct ~100 bytes; no pool needed at typical scale.
7. Alternative? Use OAuth2/OIDC with an identity provider (Auth0, Keycloak) for production.

### Follow-Up Questions
**Q1:** What is the difference between HS256 and RS256? **A1:** HS256 uses a shared secret (symmetric); RS256 uses a public/private key pair — RS256 is safer for multi-service architectures.
**Q2:** How do you revoke a JWT before expiry? **A2:** Maintain a token blocklist (Redis set of jti/user+iat) — checked on each request.
**Q3:** What is the `jti` claim? **A3:** JWT ID — a unique identifier for the token, used to detect replay attacks.
**Q4:** How do you refresh tokens securely? **A4:** Issue short-lived access tokens + long-lived refresh tokens; store refresh token hash server-side.
**Q5:** What is JWKS? **A5:** JSON Web Key Set — a public endpoint exposing RSA/EC public keys for verifying JWTs issued by an auth server.

---

## Q10: Rate Limiting Middleware  [Level 3 — Medium]
> **Tags:** `#rate-limiting` `#token-bucket` `#middleware` `#throttling`

### Problem Statement
Implement a per-IP rate-limiting middleware using the token bucket algorithm. Each IP gets a bucket with a configurable burst size and refill rate. If a request exceeds the limit, return `429 Too Many Requests` with a `Retry-After` header. Use `golang.org/x/time/rate` for the limiter.

### Input / Output / Constraints
```
Input:  10 requests/sec per IP, burst=20
        IP sends 25 requests in 1 second
Output: First 20: 200 OK; requests 21-25: 429 Too Many Requests
        Retry-After: 1
Constraints: Per-IP isolation, cleanup stale entries, thread-safe
```

### Thought Process
1. Understand: Map IP → `rate.Limiter`; call `limiter.Allow()` before handler.
2. Pattern: Lazy initialization with sync.Mutex; background cleanup goroutine for stale IPs.
3. Edge cases: IP spoofing via X-Forwarded-For, IPv6, cleanup race, zero rate.

### Brute Force
```go
// O(1) amortized — no cleanup (memory leak)
var limiters = map[string]*rate.Limiter{}
var mu sync.Mutex

func bruteLimit(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ip := r.RemoteAddr
        mu.Lock()
        l, ok := limiters[ip]
        if !ok {
            l = rate.NewLimiter(10, 20)
            limiters[ip] = l
        }
        mu.Unlock()
        if !l.Allow() {
            http.Error(w, "rate limited", 429)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```
**Time:** O(1) | **Space:** O(n IPs) — leaks

### Better Solution
```go
type visitor struct {
    limiter  *rate.Limiter
    lastSeen time.Time
}
// Store visitor with lastSeen, clean up in background
```
**Time:** O(1) | **Space:** O(n active IPs)

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net"
    "net/http"
    "sync"
    "time"

    "golang.org/x/time/rate"
)

type visitor struct {
    limiter  *rate.Limiter
    lastSeen time.Time
}

type RateLimiter struct {
    mu       sync.Mutex
    visitors map[string]*visitor
    rate     rate.Limit
    burst    int
    ttl      time.Duration
}

func NewRateLimiter(r rate.Limit, burst int, ttl time.Duration) *RateLimiter {
    rl := &RateLimiter{
        visitors: make(map[string]*visitor),
        rate:     r,
        burst:    burst,
        ttl:      ttl,
    }
    go rl.cleanup()
    return rl
}

func (rl *RateLimiter) getVisitor(ip string) *rate.Limiter {
    rl.mu.Lock()
    defer rl.mu.Unlock()
    v, ok := rl.visitors[ip]
    if !ok {
        l := rate.NewLimiter(rl.rate, rl.burst)
        rl.visitors[ip] = &visitor{limiter: l, lastSeen: time.Now()}
        return l
    }
    v.lastSeen = time.Now()
    return v.limiter
}

func (rl *RateLimiter) cleanup() {
    for range time.Tick(time.Minute) {
        rl.mu.Lock()
        for ip, v := range rl.visitors {
            if time.Since(v.lastSeen) > rl.ttl {
                delete(rl.visitors, ip)
            }
        }
        rl.mu.Unlock()
    }
}

// Middleware returns the HTTP middleware
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ip, _, err := net.SplitHostPort(r.RemoteAddr)
        if err != nil {
            ip = r.RemoteAddr
        }
        // Trust X-Forwarded-For only behind a known proxy
        if forwarded := r.Header.Get("X-Real-IP"); forwarded != "" {
            ip = forwarded
        }

        limiter := rl.getVisitor(ip)
        if !limiter.Allow() {
            w.Header().Set("Retry-After", "1")
            w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%v", rl.rate))
            http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
            return
        }
        next.ServeHTTP(w, r)
    })
}

func main() {
    rl := NewRateLimiter(rate.Limit(10), 20, 3*time.Minute)

    mux := http.NewServeMux()
    mux.HandleFunc("/api/data", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "data")
    })

    log.Fatal(http.ListenAndServe(":8080", rl.Middleware(mux)))
}
```
**Time:** O(1) per request | **Space:** O(n active IPs)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | In-process limiter won't share state across pods — use Redis + lua sliding window |
| Edge Cases | IP spoofing, IPv4-mapped IPv6, shared NAT (rate-limit by user ID + IP) |
| Error Handling | Return Retry-After and X-RateLimit-Remaining headers per RFC 6585 |
| Memory | One Limiter struct (~100 bytes) per active IP; cleanup prevents unbounded growth |
| Concurrency | sync.Mutex protects the map; rate.Limiter is goroutine-safe internally |

### Visual Explanation
```mermaid
flowchart TD
    A["Request from IP x.x.x.x"] --> B["Extract IP"]
    B --> C["getVisitor(ip) — get/create Limiter"]
    C --> D{"limiter.Allow()?"}
    D -->|no| E["429 Too Many Requests\nRetry-After: 1"]
    D -->|yes| F["next.ServeHTTP"]
    F --> G["200 Response"]
    H["background cleanup\nevery minute"] --> I["delete stale IPs\nlastSeen > TTL"]
```
```
Trace: request → IP extract → bucket check → allow/deny → cleanup goroutine removes stale entries
```

### Interviewer Questions
1. Why token bucket over fixed window? Token bucket smooths bursts; fixed window allows 2x rate at window boundaries.
2. Can it be optimized? Sliding window counter in Redis for distributed limiting.
3. Scale to 10M? Redis + Lua script for atomic per-user rate limiting across all pods.
4. Edge cases? Shared NAT (100 users behind 1 IP), load balancer IP, IPv6.
5. Goroutine-safe? Yes — Mutex guards map; rate.Limiter is internally safe.
6. Memory impact? O(active IPs) — capped by cleanup; ~100-200 bytes per visitor.
7. Alternative? Use `tollbooth`, `go-redis/redis_rate`, or API gateway (Kong, Nginx).

### Follow-Up Questions
**Q1:** What is the difference between token bucket and leaky bucket? **A1:** Token bucket allows bursts up to bucket size; leaky bucket enforces a constant output rate regardless of input bursts.
**Q2:** How do you implement sliding window rate limiting? **A2:** Keep a sorted set of request timestamps in Redis; count entries in the last N seconds.
**Q3:** What HTTP headers should a rate-limited response include? **A3:** `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
**Q4:** How do you rate-limit authenticated users differently from anonymous? **A4:** Extract user ID from JWT claims; use user ID as the limiter key instead of IP.
**Q5:** What is adaptive rate limiting? **A5:** Dynamically adjusting limits based on server load metrics — tighten limits when CPU/latency spikes.

---

## Q11: CORS Middleware  [Level 3 — Medium]
> **Tags:** `#cors` `#http-headers` `#security` `#preflight`

### Problem Statement
Implement a CORS middleware that handles preflight OPTIONS requests and sets appropriate Access-Control headers. Support configurable allowed origins (exact match and wildcard), methods, headers, and credentials flag. Return 403 if the request origin is not in the allowed list.

### Input / Output / Constraints
```
Input:  OPTIONS /api/data  Origin: https://app.example.com
Output: 204 No Content with CORS headers
        Origin not allowed → 403 Forbidden
Constraints: Support multiple origins, preflight caching via Max-Age
```

### Thought Process
1. Understand: Preflight (OPTIONS) needs Access-Control-Allow-* headers; simple requests just need Allow-Origin.
2. Pattern: Check origin against allowlist → set headers → short-circuit OPTIONS → call next.
3. Edge cases: Wildcard vs credentials (can't use * with credentials:true), case-sensitive origins.

### Brute Force
```go
// Allows ALL origins — insecure for production
func bruteCORS(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        next.ServeHTTP(w, r)
    })
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func betterCORS(allowed []string, next http.Handler) http.Handler {
    allowedSet := map[string]bool{}
    for _, o := range allowed { allowedSet[o] = true }
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        origin := r.Header.Get("Origin")
        if allowedSet[origin] {
            w.Header().Set("Access-Control-Allow-Origin", origin)
        }
        if r.Method == http.MethodOptions { w.WriteHeader(204); return }
        next.ServeHTTP(w, r)
    })
}
```
**Time:** O(1) | **Space:** O(n origins)

### Best Solution
```go
package main

import (
    "log"
    "net/http"
    "strings"
)

type CORSConfig struct {
    AllowedOrigins   []string
    AllowedMethods   []string
    AllowedHeaders   []string
    AllowCredentials bool
    MaxAge           int // seconds
}

func DefaultCORSConfig() CORSConfig {
    return CORSConfig{
        AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
        AllowedHeaders: []string{"Content-Type", "Authorization", "X-Request-ID"},
        MaxAge:         86400,
    }
}

type corsMiddleware struct {
    config     CORSConfig
    originSet  map[string]bool
    allowAll   bool
}

func CORSMiddleware(cfg CORSConfig, next http.Handler) http.Handler {
    cm := &corsMiddleware{
        config:    cfg,
        originSet: make(map[string]bool),
    }
    for _, o := range cfg.AllowedOrigins {
        if o == "*" {
            cm.allowAll = true
            break
        }
        cm.originSet[strings.ToLower(o)] = true
    }

    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        origin := r.Header.Get("Origin")
        if origin == "" {
            // Not a CORS request — pass through
            next.ServeHTTP(w, r)
            return
        }

        // Validate origin
        allowed := cm.allowAll || cm.originSet[strings.ToLower(origin)]
        if !allowed {
            http.Error(w, "CORS: origin not allowed", http.StatusForbidden)
            return
        }

        // Set CORS headers
        header := w.Header()
        if cm.allowAll && !cfg.AllowCredentials {
            header.Set("Access-Control-Allow-Origin", "*")
        } else {
            header.Set("Access-Control-Allow-Origin", origin)
            header.Add("Vary", "Origin")
        }

        if cfg.AllowCredentials {
            header.Set("Access-Control-Allow-Credentials", "true")
        }

        // Handle preflight
        if r.Method == http.MethodOptions {
            header.Set("Access-Control-Allow-Methods",
                strings.Join(cfg.AllowedMethods, ", "))
            header.Set("Access-Control-Allow-Headers",
                strings.Join(cfg.AllowedHeaders, ", "))
            if cfg.MaxAge > 0 {
                header.Set("Access-Control-Max-Age",
                    strings.TrimSpace(strings.Repeat("0", 0)+
                        http.StatusText(0)[:0]+
                        strings.TrimRight(strings.TrimLeft(
                            strings.TrimSpace(string(rune('0'+cfg.MaxAge/100%10))+
                                string(rune('0'+cfg.MaxAge/10%10))+
                                string(rune('0'+cfg.MaxAge%10))), "0"), "")))
                // simpler:
                header.Set("Access-Control-Max-Age", "86400")
            }
            w.WriteHeader(http.StatusNoContent)
            return
        }

        next.ServeHTTP(w, r)
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/api/data", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte(`{"data":"ok"}`))
    })

    cfg := DefaultCORSConfig()
    cfg.AllowedOrigins = []string{"https://app.example.com", "https://admin.example.com"}
    cfg.AllowCredentials = true

    log.Fatal(http.ListenAndServe(":8080", CORSMiddleware(cfg, mux)))
}
```
**Time:** O(1) | **Space:** O(n origins)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Stateless header manipulation — no scalability concerns |
| Edge Cases | `*` + credentials is spec-invalid; Vary header needed to prevent caching issues |
| Error Handling | 403 on disallowed origin; do not silently drop CORS headers |
| Memory | Origin set is built once at startup; O(n) where n = allowed origins count |
| Concurrency | Read-only after init — fully concurrent-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["Request with Origin header"] --> B{"Origin in allowlist?"}
    B -->|no| C["403 Forbidden"]
    B -->|yes| D["Set Allow-Origin header"]
    D --> E{Method == OPTIONS?}
    E -->|yes preflight| F["Set Allow-Methods/Headers/MaxAge\n204 No Content"]
    E -->|no| G["next.ServeHTTP — actual handler"]
```
```
Trace: request → origin check → headers set → preflight 204 OR pass to handler
```

### Interviewer Questions
1. Why add `Vary: Origin` header? Tells proxies/CDNs that the response varies by Origin — prevents caching a response for one origin and serving to another.
2. Can it be optimized? Pre-join allowed methods/headers string at init to avoid per-request allocation.
3. Scale to 10M? CORS is handled at edge/CDN (Cloudflare Workers) — no application-level CORS needed.
4. Edge cases? Null origin (sandboxed iframe), file:// origin, WebSocket upgrade.
5. Goroutine-safe? Yes — read-only map after initialization.
6. Memory impact? One map of origin strings; negligible.
7. Alternative? Use `rs/cors` library for battle-tested CORS handling.

### Follow-Up Questions
**Q1:** What is a CORS preflight request? **A1:** An OPTIONS request the browser sends first to ask the server if the actual request (with its method/headers) is permitted.
**Q2:** Why can't you use `*` with `Access-Control-Allow-Credentials: true`? **A2:** The CORS spec forbids it — the browser would reject the response; you must echo back the specific origin.
**Q3:** What is a simple request vs complex request? **A3:** Simple: GET/POST/HEAD with standard headers — no preflight. Complex: custom headers, non-standard methods — requires preflight.
**Q4:** How do you expose custom response headers to the browser? **A4:** Set `Access-Control-Expose-Headers: X-Custom-Header` — otherwise the browser hides them from JavaScript.
**Q5:** What is the `Vary` header's role in caching? **A5:** Instructs caches to store separate copies based on the named request headers — prevents one origin's cached response from being served to another.

---

## Q12: Input Validation  [Level 3 — Medium]
> **Tags:** `#validation` `#request-validation` `#go-playground/validator`

### Problem Statement
Build a `POST /users` endpoint that accepts a user registration payload and validates it: email must be valid, password must be 8-72 characters, age must be 18-120, and name must be 2-50 characters. Use `github.com/go-playground/validator/v10` and return structured validation errors listing all failures.

### Input / Output / Constraints
```
Input:  {"name":"A","email":"bad","password":"short","age":15}
Output: 400 {"errors":[{"field":"name","message":"min 2 chars"},
                        {"field":"email","message":"invalid email"},
                        {"field":"password","message":"min 8 chars"},
                        {"field":"age","message":"must be >= 18"}]}
Constraints: Return ALL validation errors, not just first
```

### Thought Process
1. Understand: Decode JSON → run validator → collect all field errors → return structured response.
2. Pattern: validator.Validate tags on struct fields; iterate `validator.ValidationErrors`.
3. Edge cases: Missing required fields, type mismatch (string where int expected), extra fields.

### Brute Force
```go
// O(n fields) — manual validation
func bruteValidate(u User) []string {
    var errs []string
    if len(u.Name) < 2 { errs = append(errs, "name too short") }
    if !strings.Contains(u.Email, "@") { errs = append(errs, "invalid email") }
    return errs
}
```
**Time:** O(n) | **Space:** O(n errors)

### Better Solution
```go
var validate = validator.New()
type User struct {
    Name  string `json:"name"  validate:"required,min=2,max=50"`
    Email string `json:"email" validate:"required,email"`
}
if err := validate.Struct(u); err != nil {
    // iterate err.(validator.ValidationErrors)
}
```
**Time:** O(n) | **Space:** O(n errors)

### Best Solution
```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "strings"

    "github.com/go-playground/validator/v10"
)

type RegisterRequest struct {
    Name     string `json:"name"     validate:"required,min=2,max=50"`
    Email    string `json:"email"    validate:"required,email"`
    Password string `json:"password" validate:"required,min=8,max=72"`
    Age      int    `json:"age"      validate:"required,min=18,max=120"`
}

type FieldError struct {
    Field   string `json:"field"`
    Message string `json:"message"`
}

type ValidationErrorResponse struct {
    Errors []FieldError `json:"errors"`
}

var validate = validator.New()

func init() {
    // Use JSON field names in errors instead of struct field names
    validate.RegisterTagNameFunc(func(fld interface{ Tag(string) string }) string {
        name := strings.SplitN(fld.Tag("json"), ",", 2)[0]
        if name == "-" {
            return ""
        }
        return name
    })
}

func formatValidationErrors(err error) []FieldError {
    var ve validator.ValidationErrors
    if !errors.As(err, &ve) {
        return []FieldError{{Field: "request", Message: err.Error()}}
    }

    errs := make([]FieldError, 0, len(ve))
    for _, fe := range ve {
        errs = append(errs, FieldError{
            Field:   fe.Field(),
            Message: humanizeError(fe),
        })
    }
    return errs
}

func humanizeError(fe validator.FieldError) string {
    switch fe.Tag() {
    case "required":
        return "this field is required"
    case "email":
        return "must be a valid email address"
    case "min":
        if fe.Kind().String() == "string" {
            return "must be at least " + fe.Param() + " characters"
        }
        return "must be at least " + fe.Param()
    case "max":
        if fe.Kind().String() == "string" {
            return "must be at most " + fe.Param() + " characters"
        }
        return "must be at most " + fe.Param()
    default:
        return "invalid value"
    }
}

func registerHandler(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

    var req RegisterRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(ValidationErrorResponse{
            Errors: []FieldError{{Field: "body", Message: "invalid JSON: " + err.Error()}},
        })
        return
    }

    if err := validate.Struct(req); err != nil {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(ValidationErrorResponse{
            Errors: formatValidationErrors(err),
        })
        return
    }

    // All valid — proceed with registration
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(map[string]string{"status": "user created", "email": req.Email})
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/users", registerHandler)
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(n fields) | **Space:** O(n errors)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Validation is CPU-bound; validator caches struct metadata — very fast |
| Edge Cases | Unicode string lengths (rune vs byte), HTML injection in name, bcrypt password before storage |
| Error Handling | Return ALL errors in one response — avoids repeated round-trips for form fixes |
| Memory | validator reuses cached struct metadata; per-request alloc is just the error slice |
| Concurrency | validator.Validate is goroutine-safe; shared instance is fine |

### Visual Explanation
```mermaid
flowchart TD
    A["POST /users JSON body"] --> B["json.Decode → RegisterRequest"]
    B -->|JSON error| C["400 invalid JSON"]
    B -->|ok| D["validate.Struct(req)"]
    D -->|no errors| E["201 Created"]
    D -->|has errors| F["collect ALL ValidationErrors"]
    F --> G["humanize field errors"]
    G --> H["400 {errors:[...]}"]
```
```
Trace: decode → validate all fields → collect errors → humanize → 400 with full error list
```

### Interviewer Questions
1. Why return all validation errors? Better UX — user fixes all issues in one go rather than sequential 400s.
2. Can it be optimized? validator uses reflection with caching; for extreme throughput use manual validation.
3. Scale to 10M? Validation is cheap; bottleneck will be DB — add rate limiting before validation.
4. Edge cases? Unicode names (use utf8.RuneCountInString for min/max), null JSON values, nested structs.
5. Goroutine-safe? Yes — validator.Validate is documented as safe for concurrent use.
6. Memory impact? Validation error slice proportional to number of failed fields — bounded.
7. Alternative? JSON Schema validation, protocol buffers for binary APIs with built-in validation.

### Follow-Up Questions
**Q1:** How do you validate conditional fields? **A1:** Use `validate:"required_if=OtherField value"` or implement custom validation functions.
**Q2:** How do you add custom validation rules? **A2:** `validate.RegisterValidation("phone", func(fl validator.FieldLevel) bool { ... })`.
**Q3:** What is `validate:"omitempty"`? **A3:** Skip validation if the field is the zero value — useful for optional fields.
**Q4:** How do you sanitize input vs validate? **A4:** Validation rejects bad input; sanitization transforms it (trim spaces, normalize unicode) — do both.
**Q5:** Why limit password to 72 chars max? **A5:** bcrypt silently truncates at 72 bytes — accepting longer passwords creates a false sense of security.

---

## Q13: Error Response Format  [Level 3 — Medium]
> **Tags:** `#error-handling` `#api-design` `#problem-details` `#RFC7807`

### Problem Statement
Design a consistent error response format following RFC 7807 (Problem Details for HTTP APIs). Implement helper functions that wrap different error types (not found, validation, internal) into a standardized JSON response with `type`, `title`, `status`, `detail`, and optional `instance` field. All handlers should use this format.

### Input / Output / Constraints
```
Input:  Resource not found
Output: {"type":"about:blank","title":"Not Found",
         "status":404,"detail":"user 42 not found",
         "instance":"/users/42"}
Constraints: Content-Type: application/problem+json, consistent across all error types
```

### Thought Process
1. Understand: RFC 7807 defines a machine-readable error format — standardizes API errors.
2. Pattern: Central error struct + factory functions per error type + single write helper.
3. Edge cases: Nil error, wrapping errors, concurrent error writes.

### Brute Force
```go
// O(1) — inconsistent error formats across handlers
func handleGet(w http.ResponseWriter, r *http.Request) {
    http.Error(w, "not found", 404)         // plain text
}
func handlePost(w http.ResponseWriter, r *http.Request) {
    json.NewEncoder(w).Encode(map[string]string{"error": "bad input"}) // different format
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
type ProblemDetail struct {
    Type     string `json:"type"`
    Title    string `json:"title"`
    Status   int    `json:"status"`
    Detail   string `json:"detail"`
    Instance string `json:"instance,omitempty"`
}
func writeProblem(w http.ResponseWriter, p ProblemDetail) {
    w.Header().Set("Content-Type", "application/problem+json")
    w.WriteHeader(p.Status)
    json.NewEncoder(w).Encode(p)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
)

// ProblemDetail follows RFC 7807
type ProblemDetail struct {
    Type     string         `json:"type"`
    Title    string         `json:"title"`
    Status   int            `json:"status"`
    Detail   string         `json:"detail"`
    Instance string         `json:"instance,omitempty"`
    Extra    map[string]any `json:"extra,omitempty"`
}

const problemContentType = "application/problem+json"

func WriteProblem(w http.ResponseWriter, r *http.Request, p ProblemDetail) {
    if p.Type == "" {
        p.Type = "about:blank"
    }
    if p.Instance == "" && r != nil {
        p.Instance = r.URL.RequestURI()
    }
    w.Header().Set("Content-Type", problemContentType)
    w.WriteHeader(p.Status)
    if err := json.NewEncoder(w).Encode(p); err != nil {
        log.Printf("WriteProblem encode error: %v", err)
    }
}

// Factory helpers

func NotFoundProblem(w http.ResponseWriter, r *http.Request, resource string) {
    WriteProblem(w, r, ProblemDetail{
        Title:  "Not Found",
        Status: http.StatusNotFound,
        Detail: fmt.Sprintf("%s not found", resource),
    })
}

func ValidationProblem(w http.ResponseWriter, r *http.Request, errors []FieldError) {
    extra := make(map[string]any)
    extra["validation_errors"] = errors
    WriteProblem(w, r, ProblemDetail{
        Type:   "https://api.example.com/errors/validation",
        Title:  "Validation Error",
        Status: http.StatusUnprocessableEntity,
        Detail: "one or more fields failed validation",
        Extra:  extra,
    })
}

func InternalProblem(w http.ResponseWriter, r *http.Request) {
    WriteProblem(w, r, ProblemDetail{
        Title:  "Internal Server Error",
        Status: http.StatusInternalServerError,
        Detail: "an unexpected error occurred",
    })
}

func ConflictProblem(w http.ResponseWriter, r *http.Request, detail string) {
    WriteProblem(w, r, ProblemDetail{
        Type:   "https://api.example.com/errors/conflict",
        Title:  "Conflict",
        Status: http.StatusConflict,
        Detail: detail,
    })
}

func main() {
    mux := http.NewServeMux()

    mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
        id := r.PathValue("id")
        if id == "99" {
            NotFoundProblem(w, r, "user "+id)
            return
        }
        fmt.Fprintf(w, `{"id":%s}`, id)
    })

    mux.HandleFunc("POST /users", func(w http.ResponseWriter, r *http.Request) {
        // Simulate validation error
        ValidationProblem(w, r, []FieldError{
            {Field: "email", Message: "must be a valid email"},
        })
    })

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Error formatting is trivial CPU — no concern |
| Edge Cases | Include request ID in Instance for distributed tracing correlation |
| Error Handling | Log 5xx errors server-side; return opaque messages to client for security |
| Memory | One ProblemDetail struct per error response — negligible |
| Concurrency | Stateless helper functions — fully concurrent |

### Visual Explanation
```mermaid
flowchart TD
    A["Handler error occurs"] --> B{Error type?}
    B -->|not found| C["NotFoundProblem()"]
    B -->|validation| D["ValidationProblem()"]
    B -->|internal| E["InternalProblem()"]
    C & D & E --> F["WriteProblem()"]
    F --> G["Content-Type: application/problem+json"]
    G --> H["HTTP Status + JSON body"]
```
```
Trace: error → factory function → WriteProblem → Content-Type set → status written → body encoded
```

### Interviewer Questions
1. Why RFC 7807 instead of a custom format? Standardized format — clients can parse errors generically; improves interoperability.
2. Can it be optimized? Pre-encode static error responses for common cases (404, 500).
3. Scale to 10M? Error format is irrelevant to scale; use request IDs for log correlation at scale.
4. Edge cases? Multiple errors in one response (use Extra.errors array), partial writes if headers sent.
5. Goroutine-safe? Yes — pure functions, no shared state.
6. Memory impact? Minimal — one small struct per error.
7. Alternative? Google's Error Model (google.rpc.Status) for gRPC/HTTP APIs.

### Follow-Up Questions
**Q1:** What is `application/problem+json` Content-Type? **A1:** RFC 7807-defined MIME type signaling a Problem Detail JSON body — allows clients to distinguish errors from normal responses.
**Q2:** What is the `type` field in RFC 7807? **A2:** A URI identifying the problem type — clients can look it up for documentation; `about:blank` is the default.
**Q3:** How do you add custom fields to the problem detail? **A3:** Use the `Extra` map or embed additional fields directly in an extended struct.
**Q4:** Should 4xx errors be logged server-side? **A4:** 400/404/422: usually no (client errors); 401/403: log for security audit; 429: log for abuse detection.
**Q5:** How do you test error response format? **A5:** `httptest.ResponseRecorder` + assert on Content-Type, status code, and JSON body structure.

---

## Q14: HTTP Client with Timeout  [Level 3 — Medium]
> **Tags:** `#http-client` `#timeout` `#context` `#transport`

### Problem Statement
Write a reusable HTTP client wrapper that enforces per-request timeouts, sets custom headers (User-Agent, API key), and parses JSON responses into a generic type. Use `context` for cancellation support. Demonstrate calling an external JSON API endpoint.

### Input / Output / Constraints
```
Input:  GET https://api.example.com/data  timeout=5s  apiKey="abc123"
Output: Parsed response struct or typed error (timeout, network, decode)
Constraints: Custom transport (TLS config, idle conns), context cancellation, no third-party client
```

### Thought Process
1. Understand: `http.Client` with `Transport` config → `http.NewRequestWithContext` → execute → decode.
2. Pattern: Wrapper struct with `Do[T any]` generic method; typed errors for different failure modes.
3. Edge cases: Timeout mid-stream, non-200 status, empty body, redirect loops.

### Brute Force
```go
// O(1) — no timeout, no error handling
func bruteGet(url string) []byte {
    resp, _ := http.Get(url) // no timeout — can hang forever
    body, _ := io.ReadAll(resp.Body)
    return body
}
```
**Time:** O(n) response size | **Space:** O(n)

### Better Solution
```go
client := &http.Client{Timeout: 5 * time.Second}
resp, err := client.Get(url)
if err != nil { return err }
defer resp.Body.Close()
json.NewDecoder(resp.Body).Decode(&result)
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
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

// APIClient is a configured HTTP client wrapper
type APIClient struct {
    client  *http.Client
    baseURL string
    apiKey  string
}

func NewAPIClient(baseURL, apiKey string, timeout time.Duration) *APIClient {
    transport := &http.Transport{
        DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
        TLSHandshakeTimeout:   5 * time.Second,
        ResponseHeaderTimeout: timeout / 2,
        MaxIdleConns:          100,
        MaxIdleConnsPerHost:   10,
        IdleConnTimeout:       90 * time.Second,
    }
    return &APIClient{
        client:  &http.Client{Transport: transport, Timeout: timeout},
        baseURL: baseURL,
        apiKey:  apiKey,
    }
}

type APIError struct {
    StatusCode int
    Body       string
}

func (e *APIError) Error() string {
    return fmt.Sprintf("API error %d: %s", e.StatusCode, e.Body)
}

// Get performs a GET request and decodes the JSON response into T
func Get[T any](ctx context.Context, c *APIClient, path string) (T, error) {
    var zero T
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
    if err != nil {
        return zero, fmt.Errorf("build request: %w", err)
    }
    req.Header.Set("User-Agent", "GoClient/1.0")
    req.Header.Set("Accept", "application/json")
    if c.apiKey != "" {
        req.Header.Set("X-API-Key", c.apiKey)
    }

    resp, err := c.client.Do(req)
    if err != nil {
        if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
            return zero, fmt.Errorf("request cancelled: %w", err)
        }
        return zero, fmt.Errorf("execute request: %w", err)
    }
    defer resp.Body.Close()

    // Limit response body to 10MB
    limitedBody := io.LimitReader(resp.Body, 10<<20)

    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        body, _ := io.ReadAll(limitedBody)
        return zero, &APIError{StatusCode: resp.StatusCode, Body: string(body)}
    }

    var result T
    if err := json.NewDecoder(limitedBody).Decode(&result); err != nil {
        return zero, fmt.Errorf("decode response: %w", err)
    }
    return result, nil
}

type Post struct {
    ID    int    `json:"id"`
    Title string `json:"title"`
    Body  string `json:"body"`
}

func main() {
    client := NewAPIClient("https://jsonplaceholder.typicode.com", "", 5*time.Second)

    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    post, err := Get[Post](ctx, client, "/posts/1")
    if err != nil {
        var apiErr *APIError
        if errors.As(err, &apiErr) {
            log.Printf("API returned %d: %s", apiErr.StatusCode, apiErr.Body)
        } else {
            log.Printf("request failed: %v", err)
        }
        return
    }
    log.Printf("Post: %s", post.Title)
}
```
**Time:** O(n) response size | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Reuse http.Client across requests — TCP connection pooling via Transport |
| Edge Cases | Redirect loops (set CheckRedirect), response too large (LimitReader), gzip response |
| Error Handling | Distinguish network errors from API errors from decode errors — each needs different handling |
| Memory | LimitReader prevents OOM on malicious/huge responses |
| Concurrency | http.Client is safe for concurrent use; Transport handles connection pooling |

### Visual Explanation
```mermaid
flowchart TD
    A["Get[T](ctx, client, path)"] --> B["NewRequestWithContext"]
    B --> C["Set headers: User-Agent, API-Key"]
    C --> D["client.Do(req)"]
    D -->|timeout/cancel| E["context error"]
    D -->|network error| F["wrapped error"]
    D -->|response| G{StatusCode 2xx?}
    G -->|no| H["APIError{status, body}"]
    G -->|yes| I["json.Decode → T"]
    I -->|error| J["decode error"]
    I -->|ok| K["return T, nil"]
```
```
Trace: build request → set headers → execute → check status → decode → return typed result
```

### Interviewer Questions
1. Why set both client.Timeout and Transport timeouts? Client.Timeout is total; Transport timeouts are per-phase — defense in depth against slow servers.
2. Can it be optimized? Enable HTTP/2, response caching with ETags, connection pooling already handled by Transport.
3. Scale to 10M? Circuit breaker pattern (gobreaker); connection pool tuning; retry with backoff.
4. Edge cases? DNS failure (no network), certificate errors, chunked response, gzip encoding.
5. Goroutine-safe? Yes — http.Client is documented as safe for concurrent use.
6. Memory impact? LimitReader caps at 10MB per response; Transport reuses TCP connections.
7. Alternative? Resty, go-resty for fluent API; heimdall for circuit breaking.

### Follow-Up Questions
**Q1:** What is `ResponseHeaderTimeout`? **A1:** Maximum time to wait for server to write response headers after request is sent — distinct from total request timeout.
**Q2:** Why reuse `http.Client` instead of creating per request? **A2:** Transport maintains a connection pool — new clients would create new pools, defeating connection reuse.
**Q3:** How do you handle gzip-encoded responses? **A3:** `http.Transport` automatically decompresses gzip responses when `Accept-Encoding: gzip` is set.
**Q4:** What is a circuit breaker pattern? **A4:** After N failures, open the circuit (fail fast for a period) to avoid cascading failures — implemented with libraries like `sony/gobreaker`.
**Q5:** How do you mock HTTP calls in tests? **A5:** Use `httptest.NewServer` with a custom handler to simulate the external service.

---

## Q15: HTTP Client Retry  [Level 4 — Advanced]
> **Tags:** `#retry` `#backoff` `#resilience` `#http-client`

### Problem Statement
Extend the API client from Q14 with automatic retry logic: retry on 429, 502, 503, 504 status codes and transient network errors. Implement exponential backoff with jitter, a maximum retry count, and respect the `Retry-After` header if present. Support context cancellation between retries.

### Input / Output / Constraints
```
Input:  Request that fails with 503 three times, succeeds on 4th
Output: Successful response after 3 retries with backoff
        maxRetries=3, baseDelay=100ms, maxDelay=30s
Constraints: Respect context cancellation, jitter to avoid thundering herd
```

### Thought Process
1. Understand: Retry loop → check retryable → compute delay (exp backoff + jitter) → respect Retry-After → sleep with ctx → retry.
2. Pattern: `time.Sleep` replaced by `select{case <-ctx.Done(): return, case <-time.After(delay): }`.
3. Edge cases: Non-retryable errors (400, 401), Retry-After parsing (seconds or HTTP date), context already cancelled.

### Brute Force
```go
// O(n) retries — fixed delay, no jitter
func bruteRetry(req *http.Request, n int) (*http.Response, error) {
    for i := 0; i < n; i++ {
        resp, err := http.DefaultClient.Do(req)
        if err == nil && resp.StatusCode < 500 { return resp, nil }
        time.Sleep(time.Second) // fixed — thundering herd
    }
    return nil, errors.New("max retries exceeded")
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
// Exponential backoff — still no jitter
delay := baseDelay
for i := 0; i < maxRetries; i++ {
    // attempt...
    delay *= 2
    if delay > maxDelay { delay = maxDelay }
    time.Sleep(delay)
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "net/http"
    "strconv"
    "time"
)

type RetryConfig struct {
    MaxRetries int
    BaseDelay  time.Duration
    MaxDelay   time.Duration
}

var DefaultRetryConfig = RetryConfig{
    MaxRetries: 3,
    BaseDelay:  100 * time.Millisecond,
    MaxDelay:   30 * time.Second,
}

func isRetryable(statusCode int, err error) bool {
    if err != nil {
        return true // network-level error — always retry
    }
    switch statusCode {
    case http.StatusTooManyRequests,
        http.StatusBadGateway,
        http.StatusServiceUnavailable,
        http.StatusGatewayTimeout:
        return true
    }
    return false
}

// jitterDelay adds ±25% random jitter to base delay
func jitterDelay(d time.Duration) time.Duration {
    jitter := time.Duration(rand.Int63n(int64(d) / 2))
    if rand.Intn(2) == 0 {
        return d + jitter/2
    }
    return d - jitter/2
}

// parseRetryAfter parses the Retry-After header (seconds or HTTP-date)
func parseRetryAfter(header string) time.Duration {
    if header == "" {
        return 0
    }
    if secs, err := strconv.Atoi(header); err == nil {
        return time.Duration(secs) * time.Second
    }
    if t, err := http.ParseTime(header); err == nil {
        d := time.Until(t)
        if d > 0 {
            return d
        }
    }
    return 0
}

// DoWithRetry executes the request factory with retry+backoff
func DoWithRetry(ctx context.Context, client *http.Client, cfg RetryConfig,
    buildReq func() (*http.Request, error)) (*http.Response, error) {

    delay := cfg.BaseDelay
    var lastErr error

    for attempt := 0; attempt <= cfg.MaxRetries; attempt++ {
        if attempt > 0 {
            // Check Retry-After from last response
            waitFor := jitterDelay(delay)

            select {
            case <-ctx.Done():
                return nil, fmt.Errorf("context cancelled during retry: %w", ctx.Err())
            case <-time.After(waitFor):
            }

            // Exponential backoff
            delay *= 2
            if delay > cfg.MaxDelay {
                delay = cfg.MaxDelay
            }
        }

        req, err := buildReq()
        if err != nil {
            return nil, fmt.Errorf("build request: %w", err)
        }
        req = req.WithContext(ctx)

        resp, err := client.Do(req)
        if err != nil {
            lastErr = err
            if !isRetryable(0, err) {
                return nil, err
            }
            continue
        }

        if !isRetryable(resp.StatusCode, nil) {
            return resp, nil
        }

        // Retryable status — check Retry-After
        if ra := resp.Header.Get("Retry-After"); ra != "" {
            if d := parseRetryAfter(ra); d > 0 && d < cfg.MaxDelay {
                delay = d
            }
        }
        resp.Body.Close()
        lastErr = fmt.Errorf("server returned %d", resp.StatusCode)
    }

    return nil, fmt.Errorf("max retries exceeded: %w", lastErr)
}

func main() {
    attempts := 0
    // Mock server that fails 2 times then succeeds
    _ = attempts
    fmt.Println("HTTP client retry implementation ready")
}
```
**Time:** O(n) retries | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Retry amplifies load on struggling downstream — add circuit breaker to stop retrying |
| Edge Cases | Non-idempotent POST requests should not retry without server confirmation of non-processing |
| Error Handling | Distinguish transient (503) from permanent (400) errors — only retry transient |
| Memory | No body buffering for retries — body is re-read on each attempt via request factory |
| Concurrency | Each call to DoWithRetry is independent; client safe for concurrent use |

### Visual Explanation
```mermaid
flowchart TD
    A["DoWithRetry(ctx)"] --> B["buildReq()"]
    B --> C["client.Do(req)"]
    C -->|network error| D{attempt < maxRetries?}
    C -->|5xx/429| D
    C -->|2xx/4xx| E["return response"]
    D -->|yes| F["jitterDelay + exp backoff"]
    F --> G{"ctx.Done?"}
    G -->|yes| H["return ctx error"]
    G -->|no| B
    D -->|no| I["return max retries error"]
```
```
Trace: attempt → fail → check retryable → sleep with jitter → retry → success on attempt N
```

### Interviewer Questions
1. Why use jitter in backoff? Prevents thundering herd — multiple clients retrying simultaneously after same failure.
2. Can it be optimized? Pre-warm TCP connections; use HTTP/2 for multiplexing.
3. Scale to 10M? Add circuit breaker; bulkhead pattern to isolate failure domains.
4. Edge cases? Non-idempotent POST (don't retry), 401 (re-auth then retry), body already consumed (use factory).
5. Goroutine-safe? Yes — independent state per DoWithRetry call.
6. Memory impact? O(1) — no response body buffering between retries.
7. Alternative? Use `hashicorp/go-retryablehttp` for production-ready retry client.

### Follow-Up Questions
**Q1:** What is the thundering herd problem? **A1:** When many clients retry simultaneously after a failure, overwhelming the recovering server — jitter spreads retries over time.
**Q2:** Why use a request factory function instead of reusing the request? **A2:** `http.Request.Body` is consumed on first use — a factory creates a fresh request (with new body) for each retry.
**Q3:** What is full jitter vs equal jitter? **A3:** Full jitter: `rand(0, base*2^attempt)`; equal jitter: `base*2^attempt/2 + rand(0, base*2^attempt/2)` — both prevent thundering herd.
**Q4:** What is a circuit breaker's half-open state? **A4:** After the open period, allow one request through — if it succeeds, close the circuit; if it fails, keep open.
**Q5:** How do you retry with a fresh auth token after 401? **A5:** In the retry loop, check for 401, call token refresh, update the Authorization header, then retry once.

---

## Q16: Streaming Response  [Level 4 — Advanced]
> **Tags:** `#streaming` `#flusher` `#SSE` `#chunked-encoding`

### Problem Statement
Implement a Server-Sent Events (SSE) endpoint `GET /events` that streams real-time events to the client. Each event should have an `id`, `event` type, and `data` field. Use `http.Flusher` to push events immediately without buffering. The stream should support client disconnection detection via context cancellation.

### Input / Output / Constraints
```
Input:  GET /events  Accept: text/event-stream
Output: Streaming:
        id: 1\nevent: update\ndata: {"count":1}\n\n
        id: 2\nevent: update\ndata: {"count":2}\n\n
Constraints: No response buffering, detect client disconnect, proper SSE format
```

### Thought Process
1. Understand: SSE is HTTP chunked transfer with specific text format; flush after each event.
2. Pattern: Check `http.Flusher` interface → write event → Flush() → select on ctx.Done().
3. Edge cases: Client disconnects mid-stream, Flusher not available (buffered test writers), events channel closed.

### Brute Force
```go
// No flush — events buffer until response ends
func bruteStream(w http.ResponseWriter, r *http.Request) {
    for i := 0; i < 10; i++ {
        fmt.Fprintf(w, "data: event %d\n\n", i)
        time.Sleep(time.Second)
    }
}
```
**Time:** O(n events) | **Space:** O(n — buffered)

### Better Solution
```go
func betterSSE(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok { http.Error(w, "streaming not supported", 500); return }
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    for i := 0; ; i++ {
        fmt.Fprintf(w, "data: %d\n\n", i)
        flusher.Flush()
        select {
        case <-r.Context().Done(): return
        case <-time.After(time.Second):
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
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "strconv"
    "time"
)

type SSEEvent struct {
    ID    int
    Event string
    Data  any
}

func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, e SSEEvent) error {
    data, err := json.Marshal(e.Data)
    if err != nil {
        return err
    }
    _, err = fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n",
        e.ID, e.Event, string(data))
    if err != nil {
        return err
    }
    flusher.Flush()
    return nil
}

type EventPayload struct {
    Count   int    `json:"count"`
    Message string `json:"message"`
}

// sseHandler streams events to the connected client
func sseHandler(eventSource <-chan SSEEvent) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        flusher, ok := w.(http.Flusher)
        if !ok {
            http.Error(w, "streaming unsupported", http.StatusInternalServerError)
            return
        }

        w.Header().Set("Content-Type", "text/event-stream")
        w.Header().Set("Cache-Control", "no-cache")
        w.Header().Set("Connection", "keep-alive")
        w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering

        // Send retry hint to client
        fmt.Fprintf(w, "retry: %s\n\n", strconv.Itoa(3000))
        flusher.Flush()

        ctx := r.Context()
        for {
            select {
            case <-ctx.Done():
                log.Printf("SSE client disconnected: %s", r.RemoteAddr)
                return
            case event, ok := <-eventSource:
                if !ok {
                    // Channel closed — stream ended
                    fmt.Fprintf(w, "event: close\ndata: stream ended\n\n")
                    flusher.Flush()
                    return
                }
                if err := writeSSEEvent(w, flusher, event); err != nil {
                    log.Printf("SSE write error: %v", err)
                    return
                }
            }
        }
    }
}

// generateEvents produces events on a channel for demonstration
func generateEvents(ctx context.Context) <-chan SSEEvent {
    ch := make(chan SSEEvent, 10)
    go func() {
        defer close(ch)
        for i := 1; ; i++ {
            select {
            case <-ctx.Done():
                return
            case <-time.After(time.Second):
                ch <- SSEEvent{
                    ID:    i,
                    Event: "update",
                    Data:  EventPayload{Count: i, Message: fmt.Sprintf("event %d", i)},
                }
            }
        }
    }()
    return ch
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    events := generateEvents(ctx)
    mux := http.NewServeMux()
    mux.HandleFunc("GET /events", sseHandler(events))

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(n events) | **Space:** O(1) per event

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | SSE holds long-lived connections — use nginx with buffering disabled; limit concurrent SSE clients |
| Edge Cases | Client reconnects (send Last-Event-ID header), nginx/CDN buffering (X-Accel-Buffering: no) |
| Error Handling | Detect write errors immediately — client disconnected; close channel/clean up |
| Memory | One goroutine per SSE client; 2KB stack + event buffer |
| Concurrency | Per-client goroutine pattern; event source channel decouples producer from consumers |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /events"] --> B["Check http.Flusher"]
    B -->|not supported| C["500 Error"]
    B -->|ok| D["Set SSE headers"]
    D --> E["event loop: select"]
    E -->|ctx.Done| F["client disconnected — return"]
    E -->|event from channel| G["writeSSEEvent: id/event/data\\n\\n"]
    G --> H["flusher.Flush()"]
    H --> E
    E -->|channel closed| I["send close event — return"]
```
```
Trace: connect → headers → loop → write event → flush → client reads → disconnect → return
```

### Interviewer Questions
1. Why call `Flush()` after each event? SSE requires immediate delivery — without flush, events buffer until the response buffer is full.
2. Can it be optimized? Fan-out pattern: one event producer → multiple subscriber channels via broker.
3. Scale to 10M? Use Redis pub/sub or Kafka for event distribution across pods; WebSocket for bidirectional.
4. Edge cases? Client Last-Event-ID for reconnection replay, nginx buffering, reverse proxy timeouts.
5. Goroutine-safe? Each client has its own goroutine; shared event source channel must be safe.
6. Memory impact? One goroutine (~2KB stack) per connected client; unbounded at scale.
7. Alternative? WebSocket for bidirectional; gRPC streaming for internal services.

### Follow-Up Questions
**Q1:** What is the difference between SSE and WebSocket? **A1:** SSE is server→client only, HTTP-based, auto-reconnects; WebSocket is bidirectional, separate protocol upgrade.
**Q2:** How does a client reconnect after disconnect? **A2:** Browser EventSource automatically reconnects; sends `Last-Event-ID` header with last received event ID.
**Q3:** What is the `retry` field in SSE? **A3:** Tells the client how many milliseconds to wait before reconnecting after a disconnect.
**Q4:** How do you fan out events to multiple SSE clients? **A4:** Maintain a broker with a map of subscriber channels; broadcast to all on each event.
**Q5:** How do you implement SSE behind nginx? **A5:** Set `proxy_buffering off` and `X-Accel-Buffering: no` to prevent nginx from buffering the stream.

---

## Q17: File Upload  [Level 4 — Advanced]
> **Tags:** `#file-upload` `#multipart` `#form-data` `#io`

### Problem Statement
Build a `POST /upload` endpoint that accepts a multipart file upload, validates the file type (only PNG/JPEG allowed), limits size to 10MB, and saves the file to disk with a UUID filename. Return the saved filename and original name in JSON. Prevent path traversal attacks.

### Input / Output / Constraints
```
Input:  POST /upload  Content-Type: multipart/form-data
        Field: file  (PNG or JPEG, ≤ 10MB)
Output: 200 {"filename":"<uuid>.png","original":"photo.png","size":204800}
        Invalid type → 415 Unsupported Media Type
        Too large → 413 Request Entity Too Large
Constraints: Validate magic bytes (not just extension), no path traversal
```

### Thought Process
1. Understand: `r.ParseMultipartForm` → `r.FormFile` → validate type → save with UUID.
2. Pattern: Read first 512 bytes for MIME detection (`http.DetectContentType`) before streaming.
3. Edge cases: Empty file, extension ≠ content, concurrent uploads to same path, directory traversal in filename.

### Brute Force
```go
// O(n) — no type validation, trusts extension
func bruteUpload(w http.ResponseWriter, r *http.Request) {
    r.ParseMultipartForm(10 << 20)
    file, header, _ := r.FormFile("file")
    defer file.Close()
    dst, _ := os.Create(header.Filename) // PATH TRAVERSAL vulnerability!
    io.Copy(dst, file)
}
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
// Validates type via extension — still insufficient
func betterUpload(w http.ResponseWriter, r *http.Request) {
    file, header, _ := r.FormFile("file")
    ext := filepath.Ext(header.Filename)
    if ext != ".png" && ext != ".jpg" { http.Error(w, "unsupported type", 415); return }
    name := uuid.New().String() + ext
    dst, _ := os.Create(filepath.Join("/uploads", name))
    io.Copy(dst, file)
}
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "crypto/rand"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
    "path/filepath"
    "strings"
)

const (
    maxUploadSize = 10 << 20 // 10 MB
    uploadDir     = "/tmp/uploads"
)

var allowedMIMEs = map[string]string{
    "image/jpeg": ".jpg",
    "image/png":  ".png",
}

type UploadResponse struct {
    Filename string `json:"filename"`
    Original string `json:"original"`
    Size     int64  `json:"size"`
    MIMEType string `json:"mime_type"`
}

func generateID() (string, error) {
    b := make([]byte, 16)
    if _, err := rand.Read(b); err != nil {
        return "", err
    }
    return hex.EncodeToString(b), nil
}

func detectMIME(file io.ReadSeeker) (string, error) {
    buf := make([]byte, 512)
    n, err := file.Read(buf)
    if err != nil && err != io.EOF {
        return "", err
    }
    // Reset to beginning
    if _, err := file.Seek(0, io.SeekStart); err != nil {
        return "", err
    }
    return http.DetectContentType(buf[:n]), nil
}

func uploadHandler(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }

    // Limit total request size
    r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize+1024)
    if err := r.ParseMultipartForm(maxUploadSize); err != nil {
        http.Error(w, `{"error":"file too large or invalid form"}`, http.StatusRequestEntityTooLarge)
        return
    }

    file, header, err := r.FormFile("file")
    if err != nil {
        http.Error(w, `{"error":"missing file field"}`, http.StatusBadRequest)
        return
    }
    defer file.Close()

    // Validate MIME type via magic bytes
    mimeType, err := detectMIME(file)
    if err != nil {
        http.Error(w, `{"error":"cannot read file"}`, http.StatusInternalServerError)
        return
    }
    ext, allowed := allowedMIMEs[strings.Split(mimeType, ";")[0]]
    if !allowed {
        http.Error(w, fmt.Sprintf(`{"error":"unsupported file type: %s"}`, mimeType),
            http.StatusUnsupportedMediaType)
        return
    }

    // Generate safe filename (no path traversal)
    id, err := generateID()
    if err != nil {
        http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
        return
    }
    safeFilename := id + ext

    // Ensure upload directory exists
    if err := os.MkdirAll(uploadDir, 0o750); err != nil {
        http.Error(w, `{"error":"cannot create upload dir"}`, http.StatusInternalServerError)
        return
    }

    dstPath := filepath.Join(uploadDir, safeFilename)
    dst, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
    if err != nil {
        http.Error(w, `{"error":"cannot create file"}`, http.StatusInternalServerError)
        return
    }
    defer dst.Close()

    written, err := io.Copy(dst, file)
    if err != nil {
        os.Remove(dstPath) // cleanup partial upload
        http.Error(w, `{"error":"upload failed"}`, http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(UploadResponse{
        Filename: safeFilename,
        Original: filepath.Base(header.Filename), // strip any path
        Size:     written,
        MIMEType: mimeType,
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("POST /upload", uploadHandler)
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(n) file size | **Space:** O(1) streaming

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Stream directly to S3/GCS instead of local disk for multi-pod deployments |
| Edge Cases | Path traversal via `../../../etc/passwd` in filename, zip bombs, malicious EXIF |
| Error Handling | Clean up partial uploads on error; return structured JSON errors |
| Memory | ParseMultipartForm buffers in memory up to limit then spills to disk temp files |
| Concurrency | Random hex UUID prevents filename collisions; O_EXCL flag is atomic |

### Visual Explanation
```mermaid
flowchart TD
    A["POST /upload multipart"] --> B["MaxBytesReader 10MB"]
    B --> C["ParseMultipartForm"]
    C -->|error| D["413 Too Large"]
    C -->|ok| E["FormFile('file')"]
    E --> F["detectMIME — read 512 bytes"]
    F --> G{allowed type?}
    G -->|no| H["415 Unsupported"]
    G -->|yes| I["generateID() → safe filename"]
    I --> J["io.Copy to /uploads/uuid.ext"]
    J -->|error| K["cleanup + 500"]
    J -->|ok| L["200 UploadResponse JSON"]
```
```
Trace: parse → magic bytes → UUID filename → stream to disk → JSON response
```

### Interviewer Questions
1. Why check magic bytes instead of file extension? Extensions are user-controlled and trivially spoofed — magic bytes detect actual file type.
2. Can it be optimized? Stream directly to object storage (S3) without touching local disk.
3. Scale to 10M? Pre-signed S3 upload URLs — client uploads directly to S3, bypassing your server entirely.
4. Edge cases? Zip bombs (image/png that's actually a zip), EXIF metadata with GPS, corrupted files.
5. Goroutine-safe? Yes — UUID ensures unique filenames; O_EXCL prevents race on creation.
6. Memory impact? ParseMultipartForm uses up to maxUploadSize RAM then spills to temp files.
7. Alternative? Multipart chunked upload for large files; resumable uploads via TUS protocol.

### Follow-Up Questions
**Q1:** What is a pre-signed URL? **A1:** A temporary S3/GCS URL granting direct upload access — server generates it, client uploads directly, bypassing your API server.
**Q2:** How do you scan uploaded files for malware? **A2:** Send to ClamAV or VirusTotal API after upload; quarantine until scanned.
**Q3:** What is EXIF stripping and why? **A3:** Remove embedded metadata (GPS coordinates, device info) from images before storing/serving — privacy protection.
**Q4:** How do you handle very large file uploads (>100MB)? **A4:** Use chunked/multipart upload protocol (TUS); upload chunks, reassemble on server or in S3.
**Q5:** What is `O_EXCL` flag? **A5:** Open fails if file exists — combined with UUID, provides atomic "create only if not exists" semantics.

---

## Q18: Graceful Shutdown  [Level 4 — Advanced]
> **Tags:** `#graceful-shutdown` `#signal` `#context` `#http.Server`

### Problem Statement
Implement graceful shutdown for an HTTP server: on SIGINT or SIGTERM, stop accepting new connections, wait up to 30 seconds for in-flight requests to complete, then exit. Active requests should complete normally; the shutdown should be logged.

### Input / Output / Constraints
```
Input:  SIGINT or SIGTERM signal
Output: Log: "Shutting down..." → wait for active requests → Log: "Server stopped"
        In-flight requests: complete normally
        New requests after signal: rejected with 503
Constraints: 30s shutdown timeout, proper os.Signal handling, exit code 0
```

### Thought Process
1. Understand: `os/signal.NotifyContext` → `srv.Shutdown(ctx)` waits for active requests.
2. Pattern: Start server in goroutine → block on signal → create shutdown context → Shutdown.
3. Edge cases: Shutdown context timeout (force kill), server start error, double signal.

### Brute Force
```go
// Abrupt — kills active requests
func bruteShutdown() {
    http.ListenAndServe(":8080", nil) // no signal handling — Ctrl+C kills immediately
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Basic signal handling — no timeout
func betterShutdown() {
    srv := &http.Server{Addr: ":8080", Handler: nil}
    go srv.ListenAndServe()
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, os.Interrupt)
    <-quit
    srv.Shutdown(context.Background()) // no deadline
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
    "os"
    "os/signal"
    "syscall"
    "time"
)

func buildServer() *http.Server {
    mux := http.NewServeMux()

    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        // Simulate slow request
        select {
        case <-r.Context().Done():
            return
        case <-time.After(500 * time.Millisecond):
        }
        fmt.Fprintln(w, "OK")
    })

    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        fmt.Fprintln(w, `{"status":"ok"}`)
    })

    return &http.Server{
        Addr:         ":8080",
        Handler:      mux,
        ReadTimeout:  15 * time.Second,
        WriteTimeout: 30 * time.Second,
        IdleTimeout:  60 * time.Second,
    }
}

func main() {
    srv := buildServer()

    // Start server in background
    serverErr := make(chan error, 1)
    go func() {
        log.Printf("HTTP server listening on %s", srv.Addr)
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            serverErr <- err
        }
        close(serverErr)
    }()

    // Wait for interrupt/terminate signal
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

    select {
    case err := <-serverErr:
        log.Fatalf("server error: %v", err)
    case sig := <-quit:
        log.Printf("received signal %s — initiating graceful shutdown", sig)
    }

    // Graceful shutdown with 30-second timeout
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    log.Println("shutting down — waiting for in-flight requests to complete...")
    if err := srv.Shutdown(ctx); err != nil {
        log.Printf("shutdown forced: %v", err)
        os.Exit(1)
    }

    // Wait for ListenAndServe goroutine to finish
    if err := <-serverErr; err != nil {
        log.Printf("post-shutdown server error: %v", err)
    }

    log.Println("server stopped gracefully")
}
```
**Time:** O(1) shutdown path | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Kubernetes sends SIGTERM with a 30s termination grace period — match your shutdown timeout |
| Edge Cases | WebSocket connections (not closed by Shutdown), long-polling, streaming responses |
| Error Handling | Log when shutdown is forced (timeout exceeded); alert ops |
| Memory | No extra allocation during shutdown path |
| Concurrency | srv.Shutdown is goroutine-safe; can be called from multiple goroutines |

### Visual Explanation
```mermaid
flowchart TD
    A["main()"] --> B["srv.ListenAndServe() in goroutine"]
    B --> C["serving requests"]
    A --> D["signal.Notify — wait for SIGINT/SIGTERM"]
    D --> E["signal received"]
    E --> F["context.WithTimeout 30s"]
    F --> G["srv.Shutdown(ctx)"]
    G --> H["stop accepting new connections"]
    H --> I["wait for in-flight requests"]
    I -->|complete in time| J["log: stopped gracefully"]
    I -->|timeout| K["force shutdown — exit 1"]
```
```
Trace: SIGTERM → Shutdown() → reject new → drain in-flight → close → exit 0
```

### Interviewer Questions
1. Why use `syscall.SIGTERM` instead of just `os.Interrupt`? SIGTERM is what Kubernetes/systemd sends; SIGINT is Ctrl+C — handle both in production.
2. Can it be optimized? Add `srv.RegisterOnShutdown` to notify long-lived goroutines.
3. Scale to 10M? Pre-stop hooks in Kubernetes; drain LB connections before SIGTERM.
4. Edge cases? WebSocket connections survive Shutdown; must track and close manually.
5. Goroutine-safe? Yes — `srv.Shutdown` is documented as safe for concurrent calls.
6. Memory impact? Negligible — shutdown is a one-time path.
7. Alternative? Use `tomb.v2` or `errgroup` for managing goroutine lifecycle.

### Follow-Up Questions
**Q1:** What is `srv.RegisterOnShutdown`? **A1:** Registers a function called when Shutdown begins — useful for signaling background goroutines to stop.
**Q2:** How does Kubernetes handle pod termination? **A2:** Sends SIGTERM → waits `terminationGracePeriodSeconds` (default 30s) → SIGKILL.
**Q3:** What happens to active WebSocket connections during Shutdown? **A3:** They remain open — Shutdown only stops the HTTP listener; WebSocket connections must be tracked and closed separately.
**Q4:** How do you do zero-downtime deployments? **A4:** Rolling update: new pods start, LB shifts traffic, old pods receive SIGTERM and drain.
**Q5:** What is a pre-stop hook? **A5:** Kubernetes lifecycle hook executed before SIGTERM — use to remove the pod from LB before shutdown begins.

---

## Q19: Health Check Endpoint  [Level 4 — Advanced]
> **Tags:** `#health-check` `#liveness` `#readiness` `#kubernetes`

### Problem Statement
Implement Kubernetes-style health check endpoints: `/healthz/live` (liveness — is the process alive?) and `/healthz/ready` (readiness — can it serve traffic?). Readiness checks should verify database connectivity and any required downstream services. Return structured JSON with individual component statuses.

### Input / Output / Constraints
```
Input:  GET /healthz/live   →  200 {"status":"ok"}  always (process running)
        GET /healthz/ready  →  200 {"status":"ok","checks":{...}} all pass
                            →  503 {"status":"degraded","checks":{...}} any fail
Constraints: Liveness never fails (only process restart fixes it); readiness fails fast
```

### Thought Process
1. Understand: Liveness = always 200; Readiness = check DB + dependencies, return 503 if any fail.
2. Pattern: Checker interface → run checks concurrently → aggregate results.
3. Edge cases: Check timeout, partial failure, check panics, slow checks blocking liveness.

### Brute Force
```go
// O(1) — no real checks
func bruteLive(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte(`{"status":"ok"}`))
}
func bruteReady(w http.ResponseWriter, r *http.Request) {
    // Always returns 200 — doesn't check DB
    w.Write([]byte(`{"status":"ok"}`))
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Single DB check — sequential
func betterReady(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if err := db.PingContext(r.Context()); err != nil {
            http.Error(w, `{"status":"error"}`, 503)
            return
        }
        w.Write([]byte(`{"status":"ok"}`))
    }
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "encoding/json"
    "log"
    "net/http"
    "sync"
    "time"
)

// Checker is a named health check
type Checker struct {
    Name    string
    Timeout time.Duration
    Check   func(ctx context.Context) error
}

type CheckResult struct {
    Status  string `json:"status"`
    Message string `json:"message,omitempty"`
}

type HealthResponse struct {
    Status string                 `json:"status"`
    Checks map[string]CheckResult `json:"checks,omitempty"`
}

// runChecks executes all checks concurrently with per-check timeouts
func runChecks(ctx context.Context, checkers []Checker) (map[string]CheckResult, bool) {
    results := make(map[string]CheckResult, len(checkers))
    var mu sync.Mutex
    var wg sync.WaitGroup
    allOK := true

    for _, c := range checkers {
        wg.Add(1)
        go func(checker Checker) {
            defer wg.Done()
            checkCtx, cancel := context.WithTimeout(ctx, checker.Timeout)
            defer cancel()

            result := CheckResult{Status: "ok"}
            if err := checker.Check(checkCtx); err != nil {
                result = CheckResult{Status: "error", Message: err.Error()}
                mu.Lock()
                allOK = false
                mu.Unlock()
            }

            mu.Lock()
            results[checker.Name] = result
            mu.Unlock()
        }(c)
    }

    wg.Wait()
    return results, allOK
}

func livenessHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(HealthResponse{Status: "ok"})
}

func readinessHandler(checkers []Checker) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
        defer cancel()

        checks, allOK := runChecks(ctx, checkers)

        status := "ok"
        httpStatus := http.StatusOK
        if !allOK {
            status = "degraded"
            httpStatus = http.StatusServiceUnavailable
        }

        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(httpStatus)
        json.NewEncoder(w).Encode(HealthResponse{Status: status, Checks: checks})
    }
}

// Mock checkers for demonstration
func dbChecker() Checker {
    return Checker{
        Name:    "database",
        Timeout: 2 * time.Second,
        Check: func(ctx context.Context) error {
            // db.PingContext(ctx)
            return nil // assume healthy
        },
    }
}

func cacheChecker() Checker {
    return Checker{
        Name:    "cache",
        Timeout: 1 * time.Second,
        Check: func(ctx context.Context) error {
            return nil // assume healthy
        },
    }
}

func main() {
    checkers := []Checker{dbChecker(), cacheChecker()}

    mux := http.NewServeMux()
    mux.HandleFunc("GET /healthz/live", livenessHandler)
    mux.HandleFunc("GET /healthz/ready", readinessHandler(checkers))

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(max check duration) | **Space:** O(n checkers)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Health checks add negligible load; cache results for 1-2s to prevent check storms |
| Edge Cases | Deadlock in check (timeout saves us), DB connection pool exhausted vs DB down |
| Error Handling | Never expose internal error details in readiness response — security risk |
| Memory | Concurrent checks — one goroutine per checker per request |
| Concurrency | sync.WaitGroup + sync.Mutex for safe concurrent result collection |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /healthz/ready"] --> B["context 5s timeout"]
    B --> C["run checkers concurrently"]
    C --> D["db check"]
    C --> E["cache check"]
    D & E --> F["collect results — WaitGroup"]
    F --> G{all ok?}
    G -->|yes| H["200 status:ok"]
    G -->|no| I["503 status:degraded"]
```
```
Trace: request → parallel checks → aggregate → 200 or 503
```

### Interviewer Questions
1. Why separate liveness from readiness? Liveness failure triggers pod restart; readiness failure removes pod from LB — different recovery actions.
2. Can it be optimized? Cache check results for a short window to prevent thundering health checks.
3. Scale to 10M? Health checks per pod; Kubernetes probes each pod independently.
4. Edge cases? Check panics (wrap in recover), check takes > timeout (ctx cancels it), startup probe.
5. Goroutine-safe? Yes — mutex protects shared results map.
6. Memory impact? O(n) goroutines for n checkers; short-lived.
7. Alternative? Use `alexliesenfeld/health` library for structured health checking.

### Follow-Up Questions
**Q1:** What is a startup probe in Kubernetes? **A1:** Like a liveness probe but only during startup — prevents liveness from killing a slow-starting container.
**Q2:** How do you differentiate DB down vs connection pool exhausted? **A2:** `db.Stats().OpenConnections == db.Stats().MaxOpenConnections` indicates pool exhaustion; ping failure indicates DB down.
**Q3:** Should health endpoints require authentication? **A3:** Usually no — they're accessed by the orchestrator; protect with network policy instead if needed.
**Q4:** What is circuit-breaker health checking? **A4:** Check the state of circuit breakers (open = degraded) as part of readiness.
**Q5:** What HTTP status code means "starting up"? **A5:** 503 — until the process is fully initialized, return 503 from readiness; Kubernetes won't send traffic.

---

## Q20: Testing with httptest  [Level 4 — Advanced]
> **Tags:** `#testing` `#httptest` `#table-driven` `#testify`

### Problem Statement
Write comprehensive table-driven tests for the echo handler from Q3 and the JWT middleware from Q9. Use `httptest.NewRecorder` for unit tests and `httptest.NewServer` for integration-style tests. Cover happy path, missing fields, invalid JSON, expired tokens, and wrong method.

### Input / Output / Constraints
```
Input:  Test cases covering all branches
Output: 100% branch coverage; tests use t.Run subtests
Constraints: No real network calls, no real JWTs from external service
```

### Thought Process
1. Understand: `httptest.NewRecorder()` captures response without a real server; `httptest.NewServer` starts a real local server.
2. Pattern: Table-driven tests; `t.Run` for subtests; assert status + body.
3. Edge cases: Concurrent test execution (`t.Parallel()`), shared handler state, goroutine leaks.

### Brute Force
```go
// O(n tests) — no table-driven, repetitive
func TestEcho_BruteForce(t *testing.T) {
    w := httptest.NewRecorder()
    r := httptest.NewRequest("POST", "/echo", strings.NewReader(`{"message":"hi"}`))
    echoHandler(w, r)
    if w.Code != 200 { t.Fail() }
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
// Table-driven — better coverage
func TestEcho(t *testing.T) {
    cases := []struct{ body string; wantStatus int }{
        {`{"message":"hi"}`, 200},
        {`{}`, 422},
        {`bad json`, 400},
    }
    for _, tc := range cases {
        w := httptest.NewRecorder()
        r := httptest.NewRequest("POST", "/echo", strings.NewReader(tc.body))
        r.Header.Set("Content-Type", "application/json")
        echoHandler(w, r)
        if w.Code != tc.wantStatus { t.Errorf("got %d want %d", w.Code, tc.wantStatus) }
    }
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

// ---- Echo Handler Tests ----

func TestEchoHandler(t *testing.T) {
    t.Parallel()
    tests := []struct {
        name       string
        method     string
        body       string
        wantStatus int
        wantEcho   string
        wantLen    int
    }{
        {
            name: "valid message",
            method: http.MethodPost,
            body: `{"message":"hello"}`,
            wantStatus: http.StatusOK,
            wantEcho: "hello", wantLen: 5,
        },
        {
            name: "empty message",
            method: http.MethodPost,
            body: `{"message":""}`,
            wantStatus: http.StatusUnprocessableEntity,
        },
        {
            name: "missing body",
            method: http.MethodPost,
            body: `{}`,
            wantStatus: http.StatusUnprocessableEntity,
        },
        {
            name: "invalid json",
            method: http.MethodPost,
            body: `not json`,
            wantStatus: http.StatusBadRequest,
        },
        {
            name: "wrong method",
            method: http.MethodGet,
            body: "",
            wantStatus: http.StatusMethodNotAllowed,
        },
    }

    for _, tt := range tests {
        tt := tt
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            req := httptest.NewRequest(tt.method, "/echo", strings.NewReader(tt.body))
            req.Header.Set("Content-Type", "application/json")
            rr := httptest.NewRecorder()

            echoHandler(rr, req)

            if rr.Code != tt.wantStatus {
                t.Errorf("status: got %d, want %d (body: %s)",
                    rr.Code, tt.wantStatus, rr.Body.String())
            }

            if tt.wantEcho != "" {
                var resp EchoResponse
                if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
                    t.Fatalf("decode response: %v", err)
                }
                if resp.Echo != tt.wantEcho {
                    t.Errorf("echo: got %q, want %q", resp.Echo, tt.wantEcho)
                }
                if resp.Length != tt.wantLen {
                    t.Errorf("length: got %d, want %d", resp.Length, tt.wantLen)
                }
            }
        })
    }
}

// ---- JWT Middleware Tests ----

func makeTestToken(t *testing.T, userID, role string, expiry time.Time) string {
    t.Helper()
    claims := Claims{
        UserID: userID,
        Role:   role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(expiry),
        },
    }
    tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
    if err != nil {
        t.Fatalf("make token: %v", err)
    }
    return tok
}

func TestJWTMiddleware(t *testing.T) {
    t.Parallel()

    downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims, ok := ClaimsFromContext(r.Context())
        if !ok {
            t.Error("claims not in context")
        }
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(map[string]string{"user": claims.UserID})
    })
    handler := JWTMiddleware(downstream)

    validToken := makeTestToken(t, "user-1", "admin", time.Now().Add(time.Hour))
    expiredToken := makeTestToken(t, "user-1", "admin", time.Now().Add(-time.Hour))

    tests := []struct {
        name       string
        authHeader string
        wantStatus int
    }{
        {"valid token", "Bearer " + validToken, http.StatusOK},
        {"no header", "", http.StatusUnauthorized},
        {"bad prefix", "Token " + validToken, http.StatusUnauthorized},
        {"expired token", "Bearer " + expiredToken, http.StatusUnauthorized},
        {"tampered token", "Bearer " + validToken + "x", http.StatusUnauthorized},
    }

    for _, tt := range tests {
        tt := tt
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            req := httptest.NewRequest(http.MethodGet, "/profile", nil)
            if tt.authHeader != "" {
                req.Header.Set("Authorization", tt.authHeader)
            }
            rr := httptest.NewRecorder()
            handler.ServeHTTP(rr, req)
            if rr.Code != tt.wantStatus {
                t.Errorf("status: got %d, want %d (body: %s)",
                    rr.Code, tt.wantStatus, rr.Body.String())
            }
        })
    }
}

// ---- Integration test with httptest.NewServer ----

func TestServerIntegration(t *testing.T) {
    mux := http.NewServeMux()
    mux.HandleFunc("POST /echo", echoHandler)

    srv := httptest.NewServer(mux)
    defer srv.Close()

    resp, err := srv.Client().Post(
        srv.URL+"/echo",
        "application/json",
        strings.NewReader(`{"message":"integration"}`),
    )
    if err != nil {
        t.Fatalf("request failed: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        t.Errorf("status: got %d, want 200", resp.StatusCode)
    }
}
```
**Time:** O(n tests) | **Space:** O(1) per test

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Tests run in parallel — `t.Parallel()` utilizes all CPUs |
| Edge Cases | Race conditions in tests using shared state — use `t.Parallel()` safely |
| Error Handling | Always call `t.Helper()` in test helpers for correct error attribution |
| Memory | httptest.ResponseRecorder buffers full response body — avoid for streaming tests |
| Concurrency | `tt := tt` captures loop variable for safe parallel subtests |

### Visual Explanation
```mermaid
flowchart TD
    A["TestEchoHandler"] --> B["for each test case"]
    B --> C["httptest.NewRequest"]
    C --> D["httptest.NewRecorder"]
    D --> E["echoHandler(rr, req)"]
    E --> F["assert rr.Code == wantStatus"]
    F --> G["assert response body if applicable"]
```
```
Trace: test case → fake request → fake recorder → handler → assert status+body
```

### Interviewer Questions
1. Why `tt := tt` in parallel subtests? Loop variable is captured by closure — without copy, all subtests would use last `tt` value.
2. Can it be optimized? Use benchmarks for hot paths; profile with `go test -bench`.
3. Scale to 10M? Testing doesn't scale with traffic — ensure tests cover edge cases at logical level.
4. Edge cases? t.Cleanup for teardown, context cancellation in subtests.
5. Goroutine-safe? t.Parallel allows parallel execution; test code must be goroutine-safe.
6. Memory impact? Each recorder buffers full response — use for small responses only.
7. Alternative? `testify/assert` for cleaner assertions; `gomock` for interface mocking.

### Follow-Up Questions
**Q1:** What is the difference between `httptest.NewRecorder` and `httptest.NewServer`? **A1:** Recorder is in-process (no TCP); NewServer starts a real local HTTP server — use recorder for units, server for integration.
**Q2:** How do you test middleware in isolation? **A2:** Pass a simple `http.HandlerFunc` as `next`; assert it was or wasn't called based on middleware logic.
**Q3:** How do you test streaming/SSE endpoints? **A3:** Use `httptest.NewServer` with a real HTTP client; collect events before timeout.
**Q4:** What is `t.Cleanup`? **A4:** Registers a function to run when the test (or subtest) finishes — replaces `defer` for test-level cleanup.
**Q5:** How do you measure test coverage? **A5:** `go test -coverprofile=c.out ./...` then `go tool cover -html=c.out` for visual report.

---

## Q21: REST Bookstore API  [Level 5 — Interview]
> **Tags:** `#REST` `#CRUD` `#api-design` `#interview`

### Problem Statement
Design and implement a complete RESTful Bookstore API with CRUD operations for books. Include: `GET /books` (list with pagination), `GET /books/{id}`, `POST /books`, `PUT /books/{id}`, `DELETE /books/{id}`. Use proper HTTP status codes, input validation, and in-memory storage. This is a common interview take-home problem.

### Input / Output / Constraints
```
Input:  POST /books {"title":"Go","author":"Kernighan","isbn":"978-0","year":2019}
Output: 201 Created {"id":1,"title":"Go","author":"Kernighan","isbn":"978-0","year":2019}
        GET /books?page=1&limit=10 → 200 {"books":[...],"total":N,"page":1}
Constraints: In-memory, thread-safe, proper REST semantics, idempotent PUT
```

### Thought Process
1. Understand: Standard CRUD with thread-safe map; auto-increment ID; proper HTTP methods and status codes.
2. Pattern: Handler struct with store; route-per-method (Go 1.22); unified error format.
3. Edge cases: PUT on non-existent book (upsert or 404), DELETE idempotency, concurrent writes.

### Brute Force
```go
// O(1) — no separation, global state
var books = map[int]Book{}
func handleBooks(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case "GET": // list
    case "POST": // create
    }
}
```
**Time:** O(1)/O(n) | **Space:** O(n)

### Better Solution
```go
// Separate handlers per method+route
type BookStore struct { mu sync.RWMutex; books map[int]Book; nextID int }
func (s *BookStore) List(w http.ResponseWriter, r *http.Request) { ... }
func (s *BookStore) Create(w http.ResponseWriter, r *http.Request) { ... }
```
**Time:** O(1)/O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "encoding/json"
    "errors"
    "log"
    "net/http"
    "strconv"
    "strings"
    "sync"
    "sync/atomic"
)

type Book struct {
    ID     int    `json:"id"`
    Title  string `json:"title"`
    Author string `json:"author"`
    ISBN   string `json:"isbn"`
    Year   int    `json:"year"`
}

type BookInput struct {
    Title  string `json:"title"`
    Author string `json:"author"`
    ISBN   string `json:"isbn"`
    Year   int    `json:"year"`
}

func (b BookInput) Validate() error {
    if strings.TrimSpace(b.Title) == "" {
        return errors.New("title is required")
    }
    if strings.TrimSpace(b.Author) == "" {
        return errors.New("author is required")
    }
    if b.Year < 1000 || b.Year > 2100 {
        return errors.New("year must be between 1000 and 2100")
    }
    return nil
}

type BookStore struct {
    mu     sync.RWMutex
    books  map[int]Book
    nextID atomic.Int64
}

func NewBookStore() *BookStore {
    s := &BookStore{books: make(map[int]Book)}
    s.nextID.Store(1)
    return s
}

var ErrNotFound = errors.New("not found")

func (s *BookStore) Create(input BookInput) Book {
    id := int(s.nextID.Add(1)) - 1
    b := Book{ID: id, Title: input.Title, Author: input.Author,
        ISBN: input.ISBN, Year: input.Year}
    s.mu.Lock()
    s.books[id] = b
    s.mu.Unlock()
    return b
}

func (s *BookStore) Get(id int) (Book, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    b, ok := s.books[id]
    if !ok {
        return Book{}, ErrNotFound
    }
    return b, nil
}

func (s *BookStore) Update(id int, input BookInput) (Book, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if _, ok := s.books[id]; !ok {
        return Book{}, ErrNotFound
    }
    b := Book{ID: id, Title: input.Title, Author: input.Author,
        ISBN: input.ISBN, Year: input.Year}
    s.books[id] = b
    return b, nil
}

func (s *BookStore) Delete(id int) {
    s.mu.Lock()
    delete(s.books, id)
    s.mu.Unlock()
}

func (s *BookStore) List(page, limit int) ([]Book, int) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    all := make([]Book, 0, len(s.books))
    for _, b := range s.books {
        all = append(all, b)
    }
    total := len(all)
    start := (page - 1) * limit
    if start >= total {
        return []Book{}, total
    }
    end := start + limit
    if end > total {
        end = total
    }
    return all[start:end], total
}

type BookHandler struct{ store *BookStore }

func (h *BookHandler) handleList(w http.ResponseWriter, r *http.Request) {
    page, _ := strconv.Atoi(r.URL.Query().Get("page"))
    limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
    if page < 1 { page = 1 }
    if limit < 1 || limit > 100 { limit = 10 }

    books, total := h.store.List(page, limit)
    writeJSON(w, http.StatusOK, map[string]any{
        "books": books, "total": total, "page": page, "limit": limit,
    })
}

func (h *BookHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
    var input BookInput
    if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
        return
    }
    if err := input.Validate(); err != nil {
        writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
        return
    }
    book := h.store.Create(input)
    writeJSON(w, http.StatusCreated, book)
}

func (h *BookHandler) handleGetOne(w http.ResponseWriter, r *http.Request) {
    id, err := strconv.Atoi(r.PathValue("id"))
    if err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
        return
    }
    book, err := h.store.Get(id)
    if errors.Is(err, ErrNotFound) {
        writeJSON(w, http.StatusNotFound, map[string]string{"error": "book not found"})
        return
    }
    writeJSON(w, http.StatusOK, book)
}

func (h *BookHandler) handleUpdate(w http.ResponseWriter, r *http.Request) {
    id, err := strconv.Atoi(r.PathValue("id"))
    if err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
        return
    }
    var input BookInput
    if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
        return
    }
    if err := input.Validate(); err != nil {
        writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
        return
    }
    book, err := h.store.Update(id, input)
    if errors.Is(err, ErrNotFound) {
        writeJSON(w, http.StatusNotFound, map[string]string{"error": "book not found"})
        return
    }
    writeJSON(w, http.StatusOK, book)
}

func (h *BookHandler) handleDelete(w http.ResponseWriter, r *http.Request) {
    id, err := strconv.Atoi(r.PathValue("id"))
    if err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
        return
    }
    h.store.Delete(id)
    w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(v)
}

func main() {
    store := NewBookStore()
    h := &BookHandler{store: store}

    mux := http.NewServeMux()
    mux.HandleFunc("GET /books", h.handleList)
    mux.HandleFunc("POST /books", h.handleCreate)
    mux.HandleFunc("GET /books/{id}", h.handleGetOne)
    mux.HandleFunc("PUT /books/{id}", h.handleUpdate)
    mux.HandleFunc("DELETE /books/{id}", h.handleDelete)

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) CRUD, O(n) list | **Space:** O(n) books

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Replace in-memory store with PostgreSQL + pgx; add connection pooling |
| Edge Cases | Concurrent create (atomic ID), concurrent update+delete, empty list (return [] not null) |
| Error Handling | Consistent JSON errors; 404 vs 410 Gone for deleted resources |
| Memory | O(n) books in map; for production use database |
| Concurrency | RWMutex for reads; full Lock for writes; atomic.Int64 for ID generation |

### Visual Explanation
```mermaid
flowchart TD
    A["HTTP Request"] --> B["ServeMux route match\nGET/POST/PUT/DELETE /books/{id}"]
    B --> C["BookHandler method"]
    C --> D["Parse + Validate input"]
    D -->|invalid| E["4xx error"]
    D -->|valid| F["BookStore operation\nCreate/Get/Update/Delete/List"]
    F -->|not found| G["404"]
    F -->|ok| H["JSON response 200/201/204"]
```
```
Trace: route → handler → validate → store → respond
```

### Interviewer Questions
1. Why use `atomic.Int64` for ID generation? Avoids holding the mutex for ID increment — reduces contention.
2. Can it be optimized? For reads, switch to sync.Map; for production, use DB sequences.
3. Scale to 10M? PostgreSQL with indexes, Redis cache for hot books, horizontal API pods.
4. Edge cases? Concurrent PUT+DELETE same ID, empty ISBN (make optional), year 0 default.
5. Goroutine-safe? RWMutex + atomic ID — yes.
6. Memory impact? O(n) — each Book ~200 bytes; 1M books ≈ 200MB.
7. Alternative? Use OpenAPI spec first, generate server stubs with oapi-codegen.

### Follow-Up Questions
**Q1:** Should DELETE return 200 or 204? **A1:** 204 No Content is conventional — no body to return; 200 with a body is acceptable if you return the deleted resource.
**Q2:** What is the difference between PUT and PATCH? **A2:** PUT replaces the entire resource; PATCH applies partial updates — PATCH requires merge logic.
**Q3:** How do you implement pagination with consistent results? **A3:** Sort by ID before slicing; cursor-based pagination is more stable than offset for concurrent writes.
**Q4:** What is HATEOAS? **A4:** Hypermedia As The Engine Of Application State — responses include links to related actions (e.g., `"_links":{"self":"/books/1"}`).
**Q5:** How do you version a REST API? **A5:** URL versioning (`/v1/books`), header versioning (`Accept: application/vnd.api+json;version=1`), or query param.

---

## Q22: WebSocket Upgrade  [Level 5 — Interview]
> **Tags:** `#websocket` `#gorilla/websocket` `#real-time` `#bidirectional`

### Problem Statement
Implement a WebSocket echo server using `gorilla/websocket`. The server should upgrade HTTP connections to WebSocket, echo each text message back with a timestamp prefix, handle ping/pong for connection keepalive, and cleanly close connections on client disconnect or server shutdown.

### Input / Output / Constraints
```
Input:  WS connect to ws://localhost:8080/ws
        Client sends: "hello"
Output: Server echoes: "[2024-01-15T10:30:00Z] hello"
        Ping → Pong (automatic keepalive)
Constraints: gorilla/websocket, handle concurrent clients, cleanup on disconnect
```

### Thought Process
1. Understand: HTTP → WebSocket upgrade → read/write loop → detect close → cleanup.
2. Pattern: One goroutine for read, one channel for write; close via context or closeHandler.
3. Edge cases: Client disconnects without close frame, network timeout, server shutdown mid-connection.

### Brute Force
```go
// O(1) per message — no concurrency safety
func bruteWS(upgrader websocket.Upgrader, w http.ResponseWriter, r *http.Request) {
    conn, _ := upgrader.Upgrade(w, r, nil)
    for {
        _, msg, err := conn.ReadMessage()
        if err != nil { break }
        conn.WriteMessage(websocket.TextMessage, msg)
    }
}
```
**Time:** O(n) messages | **Space:** O(1)

### Better Solution
```go
// Separate read/write goroutines with channel
func betterWS(conn *websocket.Conn) {
    send := make(chan []byte, 256)
    go func() { for msg := range send { conn.WriteMessage(websocket.TextMessage, msg) } }()
    for {
        _, msg, err := conn.ReadMessage()
        if err != nil { close(send); return }
        send <- append([]byte(time.Now().Format(time.RFC3339)+" "), msg...)
    }
}
```
**Time:** O(n) | **Space:** O(buffer)

### Best Solution
```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "sync"
    "time"

    "github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
    CheckOrigin: func(r *http.Request) bool {
        // Validate origin in production
        return true
    },
}

type Client struct {
    conn   *websocket.Conn
    send   chan []byte
    ctx    context.Context
    cancel context.CancelFunc
}

func newClient(conn *websocket.Conn) *Client {
    ctx, cancel := context.WithCancel(context.Background())
    return &Client{
        conn:   conn,
        send:   make(chan []byte, 256),
        ctx:    ctx,
        cancel: cancel,
    }
}

const (
    writeWait      = 10 * time.Second
    pongWait       = 60 * time.Second
    pingPeriod     = (pongWait * 9) / 10
    maxMessageSize = 512
)

func (c *Client) writePump(wg *sync.WaitGroup) {
    defer wg.Done()
    ticker := time.NewTicker(pingPeriod)
    defer func() {
        ticker.Stop()
        c.conn.Close()
    }()

    for {
        select {
        case message, ok := <-c.send:
            c.conn.SetWriteDeadline(time.Now().Add(writeWait))
            if !ok {
                c.conn.WriteMessage(websocket.CloseMessage, []byte{})
                return
            }
            if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
                return
            }
        case <-ticker.C:
            c.conn.SetWriteDeadline(time.Now().Add(writeWait))
            if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
                return
            }
        case <-c.ctx.Done():
            c.conn.WriteMessage(websocket.CloseMessage,
                websocket.FormatCloseMessage(websocket.CloseGoingAway, "server shutdown"))
            return
        }
    }
}

func (c *Client) readPump(wg *sync.WaitGroup) {
    defer func() {
        wg.Done()
        c.cancel()
        close(c.send)
    }()

    c.conn.SetReadLimit(maxMessageSize)
    c.conn.SetReadDeadline(time.Now().Add(pongWait))
    c.conn.SetPongHandler(func(string) error {
        c.conn.SetReadDeadline(time.Now().Add(pongWait))
        return nil
    })

    for {
        msgType, msg, err := c.conn.ReadMessage()
        if err != nil {
            if websocket.IsUnexpectedCloseError(err,
                websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
                log.Printf("WebSocket error: %v", err)
            }
            return
        }
        if msgType == websocket.TextMessage {
            echo := fmt.Sprintf("[%s] %s",
                time.Now().UTC().Format(time.RFC3339), string(msg))
            select {
            case c.send <- []byte(echo):
            default:
                // Buffer full — drop message
                log.Println("WebSocket: send buffer full, dropping message")
            }
        }
    }
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("WebSocket upgrade error: %v", err)
        return
    }

    client := newClient(conn)
    log.Printf("WebSocket client connected: %s", r.RemoteAddr)

    var wg sync.WaitGroup
    wg.Add(2)
    go client.readPump(&wg)
    go client.writePump(&wg)
    wg.Wait()

    log.Printf("WebSocket client disconnected: %s", r.RemoteAddr)
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/ws", wsHandler)
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        http.ServeFile(w, r, "index.html")
    })
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) per message | **Space:** O(buffer size per client)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | WebSocket connections are stateful — sticky sessions or Redis pub/sub for multi-pod fan-out |
| Edge Cases | Client behind NAT (ping/pong keepalive), message size limits, concurrent writes (separate pump) |
| Error Handling | Distinguish clean close vs abnormal closure; log unexpectedly closed connections |
| Memory | 256-slot channel × clients; tune buffer size by expected message rate |
| Concurrency | Separate read/write goroutines — gorilla/websocket requires only one concurrent reader and one writer |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /ws + Upgrade header"] --> B["upgrader.Upgrade()"]
    B --> C["newClient — send channel"]
    C --> D["readPump goroutine"]
    C --> E["writePump goroutine"]
    D -->|text message| F["format: [timestamp] msg"]
    F --> G["send <- echo"]
    G --> E
    E -->|send msg| H["conn.WriteMessage"]
    E -->|tick| I["conn.PingMessage"]
    D -->|error/close| J["cancel ctx — close send chan"]
    J --> E
    E -->|ctx.Done| K["WriteCloseMessage"]
```
```
Trace: upgrade → readPump loop → format → send channel → writePump → conn.Write
```

### Interviewer Questions
1. Why separate read and write goroutines? gorilla/websocket allows only one concurrent reader and one writer — separation prevents races.
2. Can it be optimized? Use `nhooyr.io/websocket` for stdlib-style API; message batching for high-throughput.
3. Scale to 10M? Centrifugo or Pusher for managed WebSocket; Redis pub/sub for cross-pod messages.
4. Edge cases? Message size limit prevents OOM; ping period must be < pong deadline.
5. Goroutine-safe? ReadMessage in one goroutine; WriteMessage in another — never share conn across goroutines.
6. Memory impact? ~256KB channel buffer per client; goroutine stacks ~2KB each.
7. Alternative? Server-Sent Events for server→client; gRPC bidirectional streaming for internal services.

### Follow-Up Questions
**Q1:** What is the WebSocket protocol? **A1:** RFC 6455 — full-duplex communication over a single TCP connection; upgraded from HTTP via `Upgrade: websocket` header.
**Q2:** How do you broadcast to all connected clients? **A2:** Maintain a hub/broker with a map of client channels; goroutine iterates the map on each broadcast message.
**Q3:** What is a sticky session? **A3:** LB always routes a client to the same pod — needed for stateful WebSocket; use IP hash or cookie-based affinity.
**Q4:** How do you handle authentication for WebSocket connections? **A4:** Validate JWT/session token on the initial HTTP upgrade request — WebSocket doesn't support headers after upgrade.
**Q5:** What is the difference between `CloseGoingAway` and `CloseAbnormalClosure`? **A5:** GoingAway (1001) = client/server intentionally closing; AbnormalClosure (1006) = connection dropped without close frame.

---

## Q23: Middleware Chain  [Level 5 — Interview]
> **Tags:** `#middleware` `#chain` `#composition` `#interview`

### Problem Statement
Implement a middleware chain builder that applies middlewares in left-to-right order. Build a full API with logging, recovery, CORS, rate limiting, and JWT auth middlewares chained together. Demonstrate that middleware executes in the correct order and that each can short-circuit the chain.

### Input / Output / Constraints
```
Input:  Chain(mux, logging, recovery, cors, rateLimit, auth)
Output: Request flows: logging → recovery → cors → rateLimit → auth → handler
        Each middleware can stop the chain by not calling next
Constraints: Type-safe chain, order guaranteed, composable
```

### Thought Process
1. Understand: Each middleware wraps the next — rightmost is innermost; leftmost is outermost.
2. Pattern: Fold list of middlewares; `Chain(h, m1, m2, m3)` = `m1(m2(m3(h)))`.
3. Edge cases: Empty middleware list, nil handler, middleware that modifies context.

### Brute Force
```go
// O(n) — manual chaining
handler := authMiddleware(rateLimitMiddleware(corsMiddleware(loggingMiddleware(mux))))
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
// Functional chain
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}
```
**Time:** O(n) build | **Space:** O(n)

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "strings"
)

// Middleware is a function that wraps an http.Handler
type Middleware func(http.Handler) http.Handler

// Chain applies middlewares to handler in left-to-right execution order.
// Chain(h, A, B, C) → request flows: A → B → C → h
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
    // Apply in reverse so A wraps B wraps C wraps h
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}

// TraceMiddleware adds execution order visibility for demonstration
func TraceMiddleware(name string) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // Add to request header for tracing (in production use context)
            existing := r.Header.Get("X-Middleware-Trace")
            if existing != "" {
                r.Header.Set("X-Middleware-Trace", existing+","+name)
            } else {
                r.Header.Set("X-Middleware-Trace", name)
            }
            log.Printf("[%s] before", name)
            next.ServeHTTP(w, r)
            log.Printf("[%s] after", name)
        })
    }
}

// ShortCircuitMiddleware demonstrates stopping the chain
func RequireAPIVersion(version string) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if r.Header.Get("X-API-Version") != version {
                http.Error(w, fmt.Sprintf(`{"error":"API version %s required"}`, version),
                    http.StatusBadRequest)
                return // short-circuit — next not called
            }
            next.ServeHTTP(w, r)
        })
    }
}

// WithRequestID generates a request ID and adds to context
func WithRequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        reqID := r.Header.Get("X-Request-ID")
        if reqID == "" {
            reqID = fmt.Sprintf("%d", randomID())
        }
        w.Header().Set("X-Request-ID", reqID)
        next.ServeHTTP(w, r)
    })
}

var idCounter int64

func randomID() int64 {
    idCounter++
    return idCounter
}

func main() {
    apiHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        trace := r.Header.Get("X-Middleware-Trace")
        fmt.Fprintf(w, `{"status":"ok","middleware_trace":"%s"}`, trace)
    })

    // Build middleware chain — executes left to right
    handler := Chain(
        apiHandler,
        TraceMiddleware("RequestID"),
        TraceMiddleware("Logging"),
        RecoveryMiddleware,     // from Q8
        TraceMiddleware("CORS"),
        RequireAPIVersion("v1"),
        TraceMiddleware("Auth"),
    )

    mux := http.NewServeMux()
    mux.Handle("/api/", http.StripPrefix("/api", handler))

    // Demonstrate the chain works
    log.Println("Middleware chain ready. Order: RequestID → Logging → Recovery → CORS → APIVersion → Auth → handler")
    log.Println("Chains applied in reverse so leftmost executes first")

    // Show how middlewares compose
    logChain := []string{"RequestID", "Logging", "Recovery", "CORS", "APIVersion", "Auth"}
    log.Printf("Execution order: %s", strings.Join(logChain, " → "))

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(n) chain build | **Space:** O(n) call stack depth

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Middleware chain is pure function composition — zero overhead at scale |
| Edge Cases | Middleware panic leaks through chain if no recovery; order matters (logging before auth) |
| Error Handling | Recovery middleware must be early in chain to catch panics from all inner middlewares |
| Memory | Each middleware adds one frame to the call stack per request |
| Concurrency | Stateless middlewares are safe; stateful (rate limiter) must use internal locking |

### Visual Explanation
```mermaid
flowchart LR
    A["Request"] --> B["RequestID"]
    B --> C["Logging"]
    C --> D["Recovery"]
    D --> E["CORS"]
    E --> F["APIVersion"]
    F -->|version mismatch| G["400 short-circuit"]
    F -->|ok| H["Auth"]
    H --> I["Handler"]
    I --> H --> F --> E --> D --> C --> B --> J["Response"]
```
```
Trace: each middleware calls next → chain unwinds in reverse after handler returns
```

### Interviewer Questions
1. Why apply middlewares in reverse when building chain? `Chain(h, A, B)` → `A(B(h))` — A is outermost; applying in reverse builds inside-out.
2. Can it be optimized? Pre-build handler chains at startup; avoid per-request allocation.
3. Scale to 10M? Move auth/rate-limit to API gateway (Kong, Envoy) for offloaded enforcement.
4. Edge cases? Middleware that modifies request body — must be careful not to consume it before later middlewares.
5. Goroutine-safe? Each request has its own call stack; middlewares sharing global state need locking.
6. Memory impact? O(n) call stack depth per request; negligible for typical middleware counts.
7. Alternative? Use `alice` library for named middleware chains; or `chi` router's built-in Use() method.

### Follow-Up Questions
**Q1:** What is the difference between `Use()` in chi vs manual chaining? **A1:** chi's `Use()` registers middlewares for all routes under a router; manual chaining applies to specific handlers.
**Q2:** How do you apply middleware to a subset of routes? **A2:** Create a sub-router with those middlewares; register specific routes on the sub-router.
**Q3:** Can middlewares communicate with each other? **A3:** Via request context — earlier middleware sets a value, later ones read it.
**Q4:** How do you test middleware in isolation? **A4:** Pass a noop `http.HandlerFunc` as next; assert the middleware's behavior independently.
**Q5:** What is an onion model for middlewares? **A5:** Visualizing middleware as layers of an onion — request passes through each layer inward; response passes outward.

---

## Q24: API Rate Limiting by User Tier  [Level 5 — Interview]
> **Tags:** `#rate-limiting` `#tiers` `#business-logic` `#interview`

### Problem Statement
Implement tiered rate limiting where free-tier users get 10 req/min, paid users get 100 req/min, and enterprise users get unlimited. Extract the user tier from JWT claims (Q9). Use a sliding window algorithm with per-user tracking. Return rate limit headers on every response.

### Input / Output / Constraints
```
Input:  JWT with claim "tier": "free"|"paid"|"enterprise"
Output: X-RateLimit-Limit: 10/100/∞
        X-RateLimit-Remaining: N
        X-RateLimit-Reset: <unix timestamp>
        429 when exceeded
Constraints: Sliding window, per-user tracking, cleanup stale users
```

### Thought Process
1. Understand: Extract user ID + tier from context → look up per-user window → count recent requests → enforce limit.
2. Pattern: Sliding window with circular buffer or sorted timestamp list per user.
3. Edge cases: New user (first request), tier change (invalidate old counter), cleanup goroutine.

### Brute Force
```go
// Fixed window — allows 2x at boundaries
var windows = map[string][]time.Time{}
func bruteLimit(userID string, limit int) bool {
    now := time.Now()
    minute := time.Minute
    windows[userID] = append(windows[userID], now)
    // filter old
    var recent []time.Time
    for _, t := range windows[userID] {
        if now.Sub(t) < minute { recent = append(recent, t) }
    }
    windows[userID] = recent
    return len(recent) <= limit
}
```
**Time:** O(n requests in window) | **Space:** O(n)

### Better Solution
```go
// Sliding window with cleanup
type UserWindow struct {
    requests []time.Time
    mu       sync.Mutex
}
func (w *UserWindow) Allow(limit int, window time.Duration) bool {
    w.mu.Lock(); defer w.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-window)
    j := 0
    for _, t := range w.requests { if t.After(cutoff) { w.requests[j] = t; j++ } }
    w.requests = w.requests[:j]
    if len(w.requests) >= limit { return false }
    w.requests = append(w.requests, now)
    return true
}
```
**Time:** O(n in window) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "sync"
    "time"
)

type Tier string

const (
    TierFree       Tier = "free"
    TierPaid       Tier = "paid"
    TierEnterprise Tier = "enterprise"
)

type TierConfig struct {
    Limit  int           // -1 = unlimited
    Window time.Duration
}

var tierConfigs = map[Tier]TierConfig{
    TierFree:       {Limit: 10, Window: time.Minute},
    TierPaid:       {Limit: 100, Window: time.Minute},
    TierEnterprise: {Limit: -1, Window: time.Minute},
}

type userBucket struct {
    mu       sync.Mutex
    requests []int64 // Unix nano timestamps
    lastSeen time.Time
}

func (b *userBucket) allow(cfg TierConfig) (allowed bool, remaining int, reset time.Time) {
    b.mu.Lock()
    defer b.mu.Unlock()

    if cfg.Limit == -1 {
        b.lastSeen = time.Now()
        return true, -1, time.Now().Add(cfg.Window)
    }

    now := time.Now()
    b.lastSeen = now
    cutoff := now.Add(-cfg.Window).UnixNano()

    // Slide window: remove old entries
    j := 0
    for _, ts := range b.requests {
        if ts > cutoff {
            b.requests[j] = ts
            j++
        }
    }
    b.requests = b.requests[:j]

    reset = now.Add(cfg.Window)
    if len(b.requests) >= cfg.Limit {
        return false, 0, reset
    }
    b.requests = append(b.requests, now.UnixNano())
    return true, cfg.Limit - len(b.requests), reset
}

type TieredRateLimiter struct {
    mu      sync.Mutex
    buckets map[string]*userBucket
}

func NewTieredLimiter() *TieredRateLimiter {
    rl := &TieredRateLimiter{buckets: make(map[string]*userBucket)}
    go rl.cleanup()
    return rl
}

func (rl *TieredRateLimiter) getBucket(userID string) *userBucket {
    rl.mu.Lock()
    defer rl.mu.Unlock()
    b, ok := rl.buckets[userID]
    if !ok {
        b = &userBucket{lastSeen: time.Now()}
        rl.buckets[userID] = b
    }
    return b
}

func (rl *TieredRateLimiter) cleanup() {
    for range time.Tick(5 * time.Minute) {
        rl.mu.Lock()
        for id, b := range rl.buckets {
            b.mu.Lock()
            stale := time.Since(b.lastSeen) > 10*time.Minute
            b.mu.Unlock()
            if stale {
                delete(rl.buckets, id)
            }
        }
        rl.mu.Unlock()
    }
}

func (rl *TieredRateLimiter) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims, ok := ClaimsFromContext(r.Context())
        if !ok {
            http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
            return
        }

        tier := Tier(claims.Role)
        cfg, known := tierConfigs[tier]
        if !known {
            cfg = tierConfigs[TierFree]
        }

        bucket := rl.getBucket(claims.UserID)
        allowed, remaining, reset := bucket.allow(cfg)

        // Set headers on every response
        if cfg.Limit != -1 {
            w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", cfg.Limit))
            if remaining >= 0 {
                w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
            }
            w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", reset.Unix()))
        } else {
            w.Header().Set("X-RateLimit-Limit", "unlimited")
        }

        if !allowed {
            w.Header().Set("Retry-After", "60")
            writeJSON(w, http.StatusTooManyRequests, map[string]string{
                "error": "rate limit exceeded",
                "tier":  string(tier),
            })
            return
        }

        next.ServeHTTP(w, r)
    })
}

func main() {
    rl := NewTieredLimiter()
    mux := http.NewServeMux()
    mux.HandleFunc("/api/data", func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(map[string]string{"data": "ok"})
    })

    _ = context.Background()
    handler := JWTMiddleware(rl.Middleware(mux))
    log.Fatal(http.ListenAndServe(":8080", handler))
}
```
**Time:** O(n in window) | **Space:** O(users × window requests)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | In-process won't share across pods — Redis sorted set for distributed sliding window |
| Edge Cases | Tier upgrade during active window — reset window on tier change |
| Error Handling | Always include Retry-After and rate limit headers in 429 responses |
| Memory | O(limit × users) in worst case — bounded by window size and limit |
| Concurrency | Per-user mutex; global mutex only for bucket map access |

### Visual Explanation
```mermaid
flowchart TD
    A["Request + JWT"] --> B["JWTMiddleware\nextract claims"]
    B --> C["TieredLimiter\nget user bucket"]
    C --> D["slide window\nremove old timestamps"]
    D --> E{count < limit?}
    E -->|no| F["429 Too Many Requests\n+ rate limit headers"]
    E -->|yes| G["append timestamp\nset remaining headers"]
    G --> H["next.ServeHTTP"]
    H --> I["200 response\n+ X-RateLimit-* headers"]
```
```
Trace: claims → tier config → bucket → slide → check → headers → pass or 429
```

### Interviewer Questions
1. Why sliding window over fixed window? Sliding window gives consistent rate regardless of window boundary; fixed window allows burst at edges.
2. Can it be optimized? Redis sorted set: `ZADD key timestamp`, `ZREMRANGEBYSCORE` for atomic sliding window.
3. Scale to 10M? Distributed rate limiting with Redis Lua script; token bucket in Redis for smoother limiting.
4. Edge cases? Tier downgrade (user keeps old higher limit until window expires), malicious user ID.
5. Goroutine-safe? Per-user mutex + global map mutex — correct.
6. Memory impact? O(limit) timestamps per user — bounded; cleanup removes stale users.
7. Alternative? `go-redis/redis_rate` for Redis-backed production rate limiting.

### Follow-Up Questions
**Q1:** What is Redis sorted set rate limiting? **A1:** Store request timestamps as scores; ZCOUNT in range [now-window, now] gives count; atomic with Lua.
**Q2:** How do you handle rate limit bypass via distributed requests? **A2:** All pods share the same Redis counter — impossible to bypass by distributing across IPs.
**Q3:** What is a leaky bucket vs sliding window? **A3:** Leaky bucket enforces constant rate (queue with constant drain); sliding window counts events in a rolling time window.
**Q4:** How do you notify users approaching their limit? **A4:** Send X-RateLimit-Remaining=0 warning header 20% before limit; email alert at 80%.
**Q5:** What is the CAP theorem implication for distributed rate limiting? **A5:** Rate limiting uses AP (availability+partition tolerance) — you accept slight over-counting under network partition rather than blocking all requests.

---

## Q25: HTTP/2 Push and Multiplexing  [Level 5 — Interview]
> **Tags:** `#http2` `#multiplexing` `#performance` `#interview`

### Problem Statement
Configure an HTTP/2 server with TLS, demonstrate server push for CSS/JS assets on the index page, and explain how HTTP/2 multiplexing benefits API responses. Implement a benchmark comparing HTTP/1.1 vs HTTP/2 for multiple concurrent requests.

### Input / Output / Constraints
```
Input:  GET / over HTTP/2 TLS
Output: Server pushes /static/style.css and /static/app.js before client requests them
        Multiple API calls multiplexed over single TCP connection
Constraints: TLS required for HTTP/2 in browsers, self-signed cert OK for testing
```

### Thought Process
1. Understand: HTTP/2 is auto-enabled with `http.ListenAndServeTLS`; push via `http.Pusher` interface.
2. Pattern: Check `w.(http.Pusher)` → call `Push(path, opts)` before serving main response.
3. Edge cases: Client doesn't support push, Pusher not available (HTTP/1.1), push overhead for small files.

### Brute Force
```go
// HTTP/1.1 only — no push, multiple round trips
func bruteIndex(w http.ResponseWriter, r *http.Request) {
    http.ServeFile(w, r, "index.html")
    // Client then makes 2 more requests for CSS and JS
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// HTTP/2 push — reduces round trips
func betterIndex(w http.ResponseWriter, r *http.Request) {
    if pusher, ok := w.(http.Pusher); ok {
        pusher.Push("/static/style.css", nil)
        pusher.Push("/static/app.js", nil)
    }
    http.ServeFile(w, r, "index.html")
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "crypto/tls"
    "fmt"
    "log"
    "net/http"
    "time"
)

var pushAssets = []string{
    "/static/style.css",
    "/static/app.js",
    "/static/fonts.css",
}

func indexHandler(w http.ResponseWriter, r *http.Request) {
    // Attempt server push for known assets
    if pusher, ok := w.(http.Pusher); ok {
        opts := &http.PushOptions{
            Header: http.Header{
                "Accept-Encoding": r.Header["Accept-Encoding"],
            },
        }
        for _, asset := range pushAssets {
            if err := pusher.Push(asset, opts); err != nil {
                log.Printf("HTTP/2 push failed for %s: %v", asset, err)
            }
        }
    }

    w.Header().Set("Content-Type", "text/html")
    fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/static/style.css">
  <script src="/static/app.js"></script>
</head>
<body><h1>HTTP/2 Demo</h1></body>
</html>`)
}

func apiHandler(w http.ResponseWriter, r *http.Request) {
    // Demonstrate multiplexed API call
    time.Sleep(10 * time.Millisecond) // simulate work
    fmt.Fprintf(w, `{"proto":"%s","time":"%s"}`,
        r.Proto, time.Now().Format(time.RFC3339Nano))
}

func buildTLSConfig() *tls.Config {
    return &tls.Config{
        MinVersion:               tls.VersionTLS12,
        PreferServerCipherSuites: true,
        CurvePreferences:         []tls.CurveID{tls.X25519, tls.CurveP256},
    }
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", indexHandler)
    mux.HandleFunc("/api/data", apiHandler)
    mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))

    srv := &http.Server{
        Addr:      ":8443",
        Handler:   mux,
        TLSConfig: buildTLSConfig(),
    }

    log.Println("HTTP/2 server starting on :8443")
    // HTTP/2 is automatically enabled with TLS
    if err := srv.ListenAndServeTLS("cert.pem", "key.pem"); err != nil {
        log.Fatal(err)
    }
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | HTTP/2 multiplexing reduces connection overhead — fewer TCP connections per client |
| Edge Cases | Server push deprecated in Chrome (2022) — use early hints (103) instead |
| Error Handling | Push failure is non-fatal — fall back to normal request gracefully |
| Memory | HTTP/2 flow control per-stream; SETTINGS_MAX_CONCURRENT_STREAMS limits parallelism |
| Concurrency | HTTP/2 streams are multiplexed on one TCP connection — Go stdlib handles this automatically |

### Visual Explanation
```mermaid
flowchart TD
    A["Client GET / HTTP/2"] --> B["indexHandler"]
    B --> C{w implements Pusher?}
    C -->|yes| D["Push style.css\nPush app.js"]
    D --> E["Serve index.html"]
    C -->|no HTTP/1.1| E
    E --> F["Client receives HTML\n+ pre-pushed assets"]
```
```
Trace: GET / → push CSS+JS → serve HTML → client skips CSS/JS requests (already cached)
```

### Interviewer Questions
1. What is HTTP/2 multiplexing? Multiple request/response streams over one TCP connection — no head-of-line blocking.
2. Can it be optimized? HTTP/3 (QUIC) eliminates TCP head-of-line blocking entirely.
3. Scale to 10M? HTTP/2 server push deprecated; use resource hints (<link rel=preload>), CDN.
4. Edge cases? Push rejected if client has resource cached; proxy may not forward PUSH frames.
5. Goroutine-safe? HTTP/2 stream handling is managed by stdlib — transparent to handlers.
6. Memory impact? Each HTTP/2 connection has a flow control buffer; streams share it.
7. Alternative? HTTP/3 + QUIC for even better multiplexing over UDP.

### Follow-Up Questions
**Q1:** What is HTTP/2 HPACK? **A1:** Header compression algorithm — reduces header size via Huffman encoding and shared dynamic table.
**Q2:** Why was server push deprecated in Chrome? **A2:** Measured negligible performance benefit in practice — cache digests were needed but never standardized.
**Q3:** What are Early Hints (103)? **A3:** Informational HTTP response allowing server to send preload hints before the final response is ready.
**Q4:** What is stream priority in HTTP/2? **A4:** Weights and dependencies allow clients/servers to prioritize streams — critical for page load performance.
**Q5:** How do you force HTTP/1.1 for testing? **A5:** Use `curl --http1.1` or disable HTTP/2 in `http.Transport{ForceAttemptHTTP2: false}`.

---

## Q26: Request Context and Cancellation  [Level 5 — Interview]
> **Tags:** `#context` `#cancellation` `#timeout` `#propagation`

### Problem Statement
Build a handler that calls three downstream services concurrently (user service, inventory service, payment service). Use `errgroup` to fan out requests concurrently and cancel all if any fail or if the request context is cancelled. Return a combined response or the first error encountered.

### Input / Output / Constraints
```
Input:  GET /checkout  (user ctx with 5s deadline)
Output: 200 {"user":{...},"inventory":{...},"payment":{...}}
        Any service fails → 502 Bad Gateway, cancel others
        Client cancels → 499 Client Closed Request
Constraints: Concurrent fan-out, context propagation, timeout per service
```

### Thought Process
1. Understand: `errgroup.WithContext` provides a group context; any error cancels the group.
2. Pattern: Launch goroutines via `g.Go()`; `g.Wait()` blocks until all done or first error.
3. Edge cases: Context already cancelled before start, partial results, client disconnect mid-flight.

### Brute Force
```go
// Sequential — wastes time
func bruteCheckout(ctx context.Context) error {
    user, err := fetchUser(ctx)
    if err != nil { return err }
    inv, err := fetchInventory(ctx)
    if err != nil { return err }
    pay, err := fetchPayment(ctx)
    _ = user; _ = inv; _ = pay
    return nil
}
```
**Time:** O(sum of service times) | **Space:** O(1)

### Better Solution
```go
// Concurrent but no cancellation propagation
var wg sync.WaitGroup
var mu sync.Mutex
var errs []error
wg.Add(3)
go func() { defer wg.Done(); if err := fetchUser(ctx); err != nil { mu.Lock(); errs = append(errs,err); mu.Unlock() } }()
// ...
wg.Wait()
```
**Time:** O(max service time) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "time"

    "golang.org/x/sync/errgroup"
)

type User      struct{ ID string `json:"id"`; Name string `json:"name"` }
type Inventory struct{ Available bool `json:"available"`; Qty int `json:"qty"` }
type Payment   struct{ Method string `json:"method"`; Last4 string `json:"last4"` }

type CheckoutResponse struct {
    User      User      `json:"user"`
    Inventory Inventory `json:"inventory"`
    Payment   Payment   `json:"payment"`
}

// simulateService simulates a downstream call with configurable delay/error
func simulateService[T any](ctx context.Context, name string, delay time.Duration, result T) (T, error) {
    select {
    case <-ctx.Done():
        var zero T
        return zero, fmt.Errorf("%s: context cancelled: %w", name, ctx.Err())
    case <-time.After(delay):
        log.Printf("service %s completed", name)
        return result, nil
    }
}

func checkoutHandler(w http.ResponseWriter, r *http.Request) {
    // Create errgroup with parent request context
    g, ctx := errgroup.WithContext(r.Context())

    var (
        user      User
        inventory Inventory
        payment   Payment
    )

    g.Go(func() error {
        svcCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
        defer cancel()
        u, err := simulateService(svcCtx, "user", 100*time.Millisecond,
            User{ID: "u1", Name: "Alice"})
        if err != nil {
            return fmt.Errorf("user service: %w", err)
        }
        user = u
        return nil
    })

    g.Go(func() error {
        svcCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
        defer cancel()
        inv, err := simulateService(svcCtx, "inventory", 150*time.Millisecond,
            Inventory{Available: true, Qty: 5})
        if err != nil {
            return fmt.Errorf("inventory service: %w", err)
        }
        inventory = inv
        return nil
    })

    g.Go(func() error {
        svcCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
        defer cancel()
        pay, err := simulateService(svcCtx, "payment", 200*time.Millisecond,
            Payment{Method: "card", Last4: "4242"})
        if err != nil {
            return fmt.Errorf("payment service: %w", err)
        }
        payment = pay
        return nil
    })

    if err := g.Wait(); err != nil {
        if r.Context().Err() != nil {
            // Client disconnected
            w.WriteHeader(499) // nginx convention for "Client Closed Request"
            return
        }
        http.Error(w, fmt.Sprintf(`{"error":"downstream service failed: %s"}`, err),
            http.StatusBadGateway)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(CheckoutResponse{
        User: user, Inventory: inventory, Payment: payment,
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /checkout", checkoutHandler)
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(max service time) concurrent | **Space:** O(n goroutines)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Fan-out pattern reduces latency to max (not sum) of service times |
| Edge Cases | Partial success: report which services failed; consider partial response pattern |
| Error Handling | Wrap errors with context (service name); distinguish timeout vs service error |
| Memory | One goroutine per service call; stack ~2KB; short-lived |
| Concurrency | errgroup.WithContext cancels all goroutines when one fails — clean shutdown |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /checkout"] --> B["errgroup.WithContext"]
    B --> C["g.Go: user svc"]
    B --> D["g.Go: inventory svc"]
    B --> E["g.Go: payment svc"]
    C & D & E --> F["concurrent execution"]
    F -->|all succeed| G["g.Wait() returns nil"]
    G --> H["200 CheckoutResponse"]
    F -->|any error| I["group ctx cancelled\nother goroutines see Done"]
    I --> J["g.Wait() returns error"]
    J --> K["502 Bad Gateway"]
```
```
Trace: fan-out 3 goroutines → concurrent calls → all complete → combine → 200
```

### Interviewer Questions
1. Why errgroup over WaitGroup? errgroup provides automatic cancellation on first error — WaitGroup requires manual error channel handling.
2. Can it be optimized? Cache service results in Redis; circuit breaker to fail fast on known-down services.
3. Scale to 10M? Service mesh (Istio) handles retries/timeouts; fan-out at application level only for critical paths.
4. Edge cases? All three fail simultaneously, one hangs (per-service timeout handles), partial data acceptable (use context.Background).
5. Goroutine-safe? Yes — each goroutine writes to its own variable; no sharing.
6. Memory impact? Three short-lived goroutines; negligible.
7. Alternative? Use `futures/promises` pattern with channels if you need partial results.

### Follow-Up Questions
**Q1:** How does `errgroup.WithContext` differ from a plain context? **A1:** It returns a derived context that is cancelled when the first goroutine in the group returns an error.
**Q2:** How do you collect partial results when some services fail? **A2:** Use a separate WaitGroup or atomic counters; collect results and errors independently; return what you have.
**Q3:** What is the scatter-gather pattern? **A3:** Fan-out requests to multiple sources (scatter); collect and merge responses (gather) — same as fan-out here.
**Q4:** How do you set per-service timeouts within the group context? **A4:** Derive a new context per goroutine: `svcCtx, cancel := context.WithTimeout(ctx, 2*time.Second)`.
**Q5:** What happens if errgroup parent context is already cancelled? **A5:** Goroutines started with `g.Go` should check `ctx.Done()` — they'll see it immediately and return an error.

---

## Q27: OpenAPI Spec Generation  [Level 6 — Production]
> **Tags:** `#openapi` `#swagger` `#documentation` `#production`

### Problem Statement
Add automatic OpenAPI 3.0 documentation to the Bookstore API (Q21) using `swaggo/swag` annotations. Generate the spec at build time and serve it via `/swagger/` endpoint. Include request/response schemas, authentication requirements, and example values. Set up the Swagger UI.

### Input / Output / Constraints
```
Input:  swag init + serve at /swagger/index.html
Output: Interactive Swagger UI with all endpoints documented
        GET /swagger/doc.json → OpenAPI 3.0 spec
Constraints: Annotations in code, no manual spec writing, JWT bearer security scheme
```

### Thought Process
1. Understand: swag parses Go comments with `// @` annotations → generates docs.json → serve with swagger-ui.
2. Pattern: Annotate `main.go` with API info; annotate handlers with path/params/responses.
3. Edge cases: Annotation typos, model references, authentication scheme definition.

### Brute Force
```go
// No documentation — developers guess from code
```

### Better Solution
```go
// Manual JSON spec maintained separately — gets out of sync
```

### Best Solution
```go
package main

// @title           Bookstore API
// @version         1.0
// @description     A simple bookstore REST API built with Go
// @termsOfService  http://swagger.io/terms/

// @contact.name   API Support
// @contact.email  support@example.com

// @license.name  MIT
// @license.url   https://opensource.org/licenses/MIT

// @host      localhost:8080
// @BasePath  /

// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Type "Bearer" followed by a space and JWT token

import (
    "log"
    "net/http"

    httpSwagger "github.com/swaggo/http-swagger"
    _ "your-module/docs" // generated by swag init
)

// GetBooks godoc
//
// @Summary     List all books
// @Description Get paginated list of books with optional filtering
// @Tags        books
// @Accept      json
// @Produce     json
// @Param       page   query int false "Page number" default(1)
// @Param       limit  query int false "Items per page" default(10)
// @Success     200  {object}  BooksListResponse
// @Failure     400  {object}  ErrorResponse
// @Router      /books [get]
func (h *BookHandler) GetBooksSwag(w http.ResponseWriter, r *http.Request) {
    h.handleList(w, r)
}

// CreateBook godoc
//
// @Summary     Create a book
// @Description Add a new book to the store
// @Tags        books
// @Accept      json
// @Produce     json
// @Param       book  body      BookInput  true  "Book data"
// @Success     201   {object}  Book
// @Failure     400   {object}  ErrorResponse
// @Failure     422   {object}  ErrorResponse
// @Security    BearerAuth
// @Router      /books [post]
func (h *BookHandler) CreateBookSwag(w http.ResponseWriter, r *http.Request) {
    h.handleCreate(w, r)
}

// BooksListResponse is the paginated books response
type BooksListResponse struct {
    Books []Book `json:"books" example:"[{\"id\":1,\"title\":\"Go\"}]"`
    Total int    `json:"total" example:"42"`
    Page  int    `json:"page"  example:"1"`
    Limit int    `json:"limit" example:"10"`
}

// ErrorResponse is the standard error format
type ErrorResponse struct {
    Error string `json:"error" example:"resource not found"`
}

func mainWithSwagger() {
    store := NewBookStore()
    h := &BookHandler{store: store}

    mux := http.NewServeMux()
    mux.HandleFunc("GET /books", h.GetBooksSwag)
    mux.HandleFunc("POST /books", h.CreateBookSwag)

    // Serve Swagger UI at /swagger/
    mux.Handle("/swagger/", httpSwagger.Handler(
        httpSwagger.URL("/swagger/doc.json"),
        httpSwagger.DeepLinking(true),
        httpSwagger.DocExpansion("list"),
    ))

    log.Println("Swagger UI: http://localhost:8080/swagger/index.html")
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Static spec generation — no runtime overhead beyond serving a JSON file |
| Edge Cases | Keep annotations in sync with actual handler behavior (use contract tests) |
| Error Handling | Document all possible status codes including 429, 503 |
| Memory | Swagger UI assets served as static files; spec loaded once |
| Concurrency | Static file serving — safe |

### Visual Explanation
```mermaid
flowchart TD
    A["swag init"] --> B["Parse @annotations in Go code"]
    B --> C["Generate docs/swagger.json"]
    C --> D["Embed in binary or serve from disk"]
    D --> E["GET /swagger/index.html → Swagger UI"]
    E --> F["UI fetches /swagger/doc.json"]
    F --> G["Interactive API documentation"]
```
```
Trace: annotation → swag tool → JSON spec → serve → browser renders UI
```

### Interviewer Questions
1. Why generate from code vs write spec first? Code-first avoids spec drift; spec-first (design-first) catches API design issues earlier.
2. Can it be optimized? Cache spec in memory; gzip compress the JSON response.
3. Scale to 10M? Serve spec from CDN; use API gateway for actual traffic — docs endpoint is separate.
4. Edge cases? Spec update during deployment — version the spec URL.
5. Goroutine-safe? Static file serving — safe.
6. Memory impact? Spec JSON typically <100KB; negligible.
7. Alternative? `ogen` for OpenAPI-first code generation; `huma` for annotation-free spec generation.

### Follow-Up Questions
**Q1:** What is the design-first vs code-first approach? **A1:** Design-first: write OpenAPI spec, generate server stubs; Code-first: write code, generate spec from annotations.
**Q2:** What tools generate Go code from OpenAPI? **A2:** `oapi-codegen`, `ogen`, `openapi-generator` — produce server interfaces, request/response types, validation.
**Q3:** How do you test that your implementation matches the spec? **A3:** Contract testing tools like `dredd` or `schemathesis` send requests from the spec and validate responses.
**Q4:** What is Redoc vs Swagger UI? **A4:** Both render OpenAPI specs; Redoc has better readability for reference docs; Swagger UI has "Try it out" for interaction.
**Q5:** How do you hide internal endpoints from the spec? **A5:** Don't add `@Router` annotation to internal handlers; or use build tags to conditionally include them.

---

## Q28: Database-backed API (pgx)  [Level 6 — Production]
> **Tags:** `#postgresql` `#pgx` `#transactions` `#production`

### Problem Statement
Replace the in-memory book store (Q21) with PostgreSQL using `pgx/v5`. Implement connection pooling via `pgxpool`, use parameterized queries to prevent SQL injection, wrap multi-step operations in transactions, and handle database errors (unique constraint, not found) with appropriate HTTP responses.

### Input / Output / Constraints
```
Input:  POST /books {"title":"Go","author":"Kernighan","isbn":"978-0","year":2019}
Output: 201 with book from DB (server-generated ID from serial/uuid)
        Duplicate ISBN → 409 Conflict
        DB down → 503 Service Unavailable
Constraints: pgxpool, parameterized queries, context propagation, migrations
```

### Thought Process
1. Understand: `pgxpool.New` → `pool.QueryRow` → scan → handle `pgx.ErrNoRows` and constraint errors.
2. Pattern: Repository pattern — DB operations in a separate layer; handlers call repository.
3. Edge cases: Connection pool exhaustion, serialization failures (retry), context timeout.

### Brute Force
```go
// String interpolation — SQL injection vulnerability
func bruteCreate(db *sql.DB, title string) error {
    _, err := db.Exec("INSERT INTO books (title) VALUES ('" + title + "')") // NEVER
    return err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Parameterized — safe but no pool
func betterCreate(db *sql.DB, ctx context.Context, b BookInput) (Book, error) {
    var book Book
    err := db.QueryRowContext(ctx,
        "INSERT INTO books (title,author,isbn,year) VALUES ($1,$2,$3,$4) RETURNING id,title,author,isbn,year",
        b.Title, b.Author, b.ISBN, b.Year).
        Scan(&book.ID, &book.Title, &book.Author, &book.ISBN, &book.Year)
    return book, err
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
    "os"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgconn"
    "github.com/jackc/pgx/v5/pgxpool"
)

// BookRepository handles all DB operations for books
type BookRepository struct {
    pool *pgxpool.Pool
}

func NewBookRepository(ctx context.Context) (*BookRepository, error) {
    dsn := os.Getenv("DATABASE_URL")
    if dsn == "" {
        dsn = "postgres://postgres:password@localhost:5432/bookstore?sslmode=disable"
    }

    config, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, fmt.Errorf("parse DSN: %w", err)
    }
    config.MaxConns = 25
    config.MinConns = 5

    pool, err := pgxpool.NewWithConfig(ctx, config)
    if err != nil {
        return nil, fmt.Errorf("create pool: %w", err)
    }

    if err := pool.Ping(ctx); err != nil {
        return nil, fmt.Errorf("ping DB: %w", err)
    }
    return &BookRepository{pool: pool}, nil
}

const pgUniqueViolation = "23505"

func (r *BookRepository) Create(ctx context.Context, input BookInput) (Book, error) {
    var book Book
    err := r.pool.QueryRow(ctx,
        `INSERT INTO books (title, author, isbn, year)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, author, isbn, year`,
        input.Title, input.Author, input.ISBN, input.Year,
    ).Scan(&book.ID, &book.Title, &book.Author, &book.ISBN, &book.Year)

    if err != nil {
        var pgErr *pgconn.PgError
        if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
            return Book{}, fmt.Errorf("isbn already exists: %w", ErrConflict)
        }
        return Book{}, fmt.Errorf("create book: %w", err)
    }
    return book, nil
}

func (r *BookRepository) GetByID(ctx context.Context, id int) (Book, error) {
    var book Book
    err := r.pool.QueryRow(ctx,
        `SELECT id, title, author, isbn, year FROM books WHERE id = $1`, id,
    ).Scan(&book.ID, &book.Title, &book.Author, &book.ISBN, &book.Year)

    if errors.Is(err, pgx.ErrNoRows) {
        return Book{}, ErrNotFound
    }
    if err != nil {
        return Book{}, fmt.Errorf("get book %d: %w", id, err)
    }
    return book, nil
}

func (r *BookRepository) List(ctx context.Context, offset, limit int) ([]Book, int, error) {
    // Use a transaction for consistent count + list
    tx, err := r.pool.Begin(ctx)
    if err != nil {
        return nil, 0, fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback(ctx)

    var total int
    if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM books").Scan(&total); err != nil {
        return nil, 0, fmt.Errorf("count books: %w", err)
    }

    rows, err := tx.Query(ctx,
        `SELECT id, title, author, isbn, year FROM books ORDER BY id LIMIT $1 OFFSET $2`,
        limit, offset)
    if err != nil {
        return nil, 0, fmt.Errorf("list books: %w", err)
    }
    defer rows.Close()

    var books []Book
    for rows.Next() {
        var b Book
        if err := rows.Scan(&b.ID, &b.Title, &b.Author, &b.ISBN, &b.Year); err != nil {
            return nil, 0, fmt.Errorf("scan book: %w", err)
        }
        books = append(books, b)
    }
    if err := rows.Err(); err != nil {
        return nil, 0, fmt.Errorf("rows error: %w", err)
    }
    if err := tx.Commit(ctx); err != nil {
        return nil, 0, fmt.Errorf("commit: %w", err)
    }

    if books == nil {
        books = []Book{} // return [] not null
    }
    return books, total, nil
}

var ErrConflict = errors.New("conflict")

func pgBookHandler(repo *BookRepository) http.Handler {
    mux := http.NewServeMux()

    mux.HandleFunc("GET /books/{id}", func(w http.ResponseWriter, r *http.Request) {
        id := 0
        fmt.Sscan(r.PathValue("id"), &id)
        book, err := repo.GetByID(r.Context(), id)
        if errors.Is(err, ErrNotFound) {
            writeJSON(w, http.StatusNotFound, map[string]string{"error": "book not found"})
            return
        }
        if err != nil {
            log.Printf("getBook: %v", err)
            writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database error"})
            return
        }
        writeJSON(w, http.StatusOK, book)
    })
    return mux
}

func mainDB() {
    ctx := context.Background()
    repo, err := NewBookRepository(ctx)
    if err != nil {
        log.Fatalf("connect DB: %v", err)
    }
    log.Fatal(http.ListenAndServe(":8080", pgBookHandler(repo)))
}
```
**Time:** O(1) CRUD with index | **Space:** O(n results)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | pgxpool manages connection reuse; tune MaxConns = (CPU cores * 2) + drives |
| Edge Cases | Pool exhaustion (return 503 with Retry-After), transaction deadlocks (retry 3x), migration state |
| Error Handling | Map PostgreSQL error codes to HTTP — constraint violation → 409, not found → 404 |
| Memory | Streaming rows.Next() avoids loading all results into memory |
| Concurrency | pgxpool is goroutine-safe; connections acquired/released atomically |

### Visual Explanation
```mermaid
flowchart TD
    A["POST /books"] --> B["Parse + Validate"]
    B --> C["repo.Create(ctx, input)"]
    C --> D["pgxpool.QueryRow\nINSERT...RETURNING"]
    D -->|unique violation| E["409 Conflict"]
    D -->|pool exhausted| F["503 Service Unavailable"]
    D -->|success| G["Scan → Book struct"]
    G --> H["201 Created + book JSON"]
```
```
Trace: handler → repo → pool → DB → scan → JSON response
```

### Interviewer Questions
1. Why use `pgxpool` instead of `database/sql`? pgx has better PostgreSQL type support, prepared statement caching, and COPY protocol support.
2. Can it be optimized? Prepared statements cached per connection; batch queries via `pgx.Batch`.
3. Scale to 10M? Read replicas for LIST queries; write to primary; connection pooler (PgBouncer) in front.
4. Edge cases? Migration failures (use golang-migrate), connection leak (always close rows), context timeout during transaction.
5. Goroutine-safe? pgxpool is safe; individual connections are not — never share across goroutines.
6. Memory impact? Each row scan allocates; streaming avoids buffering full result set.
7. Alternative? `sqlc` for type-safe generated queries; `gorm` for ORM-style access.

### Follow-Up Questions
**Q1:** What is PgBouncer? **A1:** A connection pooler for PostgreSQL — maintains a small pool of actual DB connections, multiple app connections multiplex through them.
**Q2:** What is a serializable transaction? **A2:** Highest isolation level — guarantees no anomalies; PostgreSQL uses SSI; may fail with serialization error (retry needed).
**Q3:** How do you run database migrations? **A3:** Use `golang-migrate/migrate` or `goose`; run on startup or as a separate init container in Kubernetes.
**Q4:** What is `RETURNING` in PostgreSQL? **A4:** Returns specified columns from modified rows in INSERT/UPDATE/DELETE — avoids a separate SELECT.
**Q5:** How do you prevent N+1 queries? **A5:** Use JOIN or batch loading; never query in a loop; use pgx.Batch for bulk operations.

---

## Q29: Prometheus Metrics  [Level 6 — Production]
> **Tags:** `#prometheus` `#metrics` `#observability` `#production`

### Problem Statement
Add Prometheus metrics to the Bookstore API: request count by method+path+status, request duration histogram, in-flight requests gauge, and a custom business metric (books created per minute). Expose metrics at `/metrics`. Integrate with the logging middleware.

### Input / Output / Constraints
```
Input:  Any HTTP request through instrumented handler
Output: GET /metrics → Prometheus text format
        http_requests_total{method="GET",path="/books",status="200"} 42
        http_request_duration_seconds_bucket{...}
Constraints: prometheus/client_golang, no blocking metrics collection
```

### Thought Process
1. Understand: Register metrics with `prometheus.NewRegistry()` → wrap handler with instrumented mux.
2. Pattern: `promhttp.InstrumentHandlerCounter` + `InstrumentHandlerDuration` wrappers, or custom middleware.
3. Edge cases: High-cardinality labels (don't use user ID as label), histogram buckets tuning.

### Brute Force
```go
// Global counter — no labels, limited insight
var reqCount = prometheus.NewCounter(prometheus.CounterOpts{Name: "requests_total"})
func bruteMetrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        reqCount.Inc()
        next.ServeHTTP(w, r)
    })
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Labeled counter + duration histogram
var httpReqs = prometheus.NewCounterVec(
    prometheus.CounterOpts{Name: "http_requests_total", Help: "Total HTTP requests"},
    []string{"method", "path", "status"},
)
var httpDur = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{Name: "http_request_duration_seconds", Buckets: prometheus.DefBuckets},
    []string{"method", "path"},
)
```
**Time:** O(1) | **Space:** O(label cardinality)

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "strconv"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
    requestsTotal   *prometheus.CounterVec
    requestDuration *prometheus.HistogramVec
    inFlight        prometheus.Gauge
    booksCreated    prometheus.Counter
}

func NewMetrics(reg prometheus.Registerer) *Metrics {
    return &Metrics{
        requestsTotal: promauto.With(reg).NewCounterVec(
            prometheus.CounterOpts{
                Name: "http_requests_total",
                Help: "Total number of HTTP requests",
            },
            []string{"method", "path", "status"},
        ),
        requestDuration: promauto.With(reg).NewHistogramVec(
            prometheus.HistogramOpts{
                Name:    "http_request_duration_seconds",
                Help:    "HTTP request duration in seconds",
                Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
            },
            []string{"method", "path"},
        ),
        inFlight: promauto.With(reg).NewGauge(
            prometheus.GaugeOpts{
                Name: "http_requests_in_flight",
                Help: "Number of in-flight HTTP requests",
            },
        ),
        booksCreated: promauto.With(reg).NewCounter(
            prometheus.CounterOpts{
                Name: "books_created_total",
                Help: "Total number of books created",
            },
        ),
    }
}

func (m *Metrics) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        m.inFlight.Inc()
        defer m.inFlight.Dec()

        rec := &responseRecorder{ResponseWriter: w}
        next.ServeHTTP(rec, r)

        duration := time.Since(start).Seconds()
        status := strconv.Itoa(rec.statusCode())

        // Use route pattern as label (not raw path — avoids cardinality explosion)
        path := r.Pattern // Go 1.22 — matched pattern e.g. "GET /books/{id}"
        if path == "" {
            path = r.URL.Path
        }

        m.requestsTotal.WithLabelValues(r.Method, path, status).Inc()
        m.requestDuration.WithLabelValues(r.Method, path).Observe(duration)
    })
}

func mainWithMetrics() {
    reg := prometheus.NewRegistry()
    reg.MustRegister(prometheus.NewGoCollector())
    reg.MustRegister(prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}))

    metrics := NewMetrics(reg)

    store := NewBookStore()
    h := &BookHandler{store: store}

    mux := http.NewServeMux()
    mux.HandleFunc("GET /books", h.handleList)
    mux.HandleFunc("POST /books", func(w http.ResponseWriter, r *http.Request) {
        h.handleCreate(w, r)
        if w.Header().Get("Content-Type") != "" {
            // rough check that creation succeeded
            metrics.booksCreated.Inc()
        }
    })

    // Expose metrics
    mux.Handle("GET /metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{
        EnableOpenMetrics: true,
    }))

    instrumented := metrics.Middleware(mux)
    fmt.Println("Metrics available at: http://localhost:8080/metrics")
    log.Fatal(http.ListenAndServe(":8080", instrumented))
}
```
**Time:** O(1) | **Space:** O(label cardinality)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Prometheus metrics are stored in memory — high cardinality labels cause OOM |
| Edge Cases | Use route pattern as path label (not raw URL) — /users/1 and /users/2 would explode cardinality |
| Error Handling | Metric recording should never fail a request — wrap in deferred recover |
| Memory | Each unique label combination allocates a counter/histogram — tune carefully |
| Concurrency | prometheus counters/histograms are goroutine-safe; atomic operations internally |

### Visual Explanation
```mermaid
flowchart TD
    A["Request"] --> B["metrics.Middleware"]
    B --> C["inFlight.Inc()"]
    C --> D["responseRecorder wraps w"]
    D --> E["next.ServeHTTP"]
    E --> F["handler response"]
    F --> G["record duration, status, path labels"]
    G --> H["requestsTotal.Inc()\nrequestDuration.Observe()"]
    H --> I["inFlight.Dec()"]
    I --> J["Response to client"]
    K["GET /metrics"] --> L["promhttp.Handler\ntext exposition format"]
```

### Interviewer Questions
1. Why use route pattern as label instead of URL path? Raw paths like /users/123 create unique label per user — unbounded cardinality causes OOM.
2. Can it be optimized? Pre-compute label combos; use Exemplars for trace correlation.
3. Scale to 10M? Prometheus federation or Thanos for long-term storage; remote write to Cortex/Mimir.
4. Edge cases? Metric name collision (promauto panics), missing labels (all must be populated).
5. Goroutine-safe? Yes — prometheus client uses sync/atomic internally.
6. Memory impact? O(labels × cardinality) — high-cardinality labels are the main risk.
7. Alternative? OpenTelemetry for vendor-neutral metrics; DataDog agent for managed APM.

### Follow-Up Questions
**Q1:** What is the difference between Counter, Gauge, and Histogram? **A1:** Counter: monotonically increasing; Gauge: goes up and down; Histogram: bucketed observations with sum and count.
**Q2:** What are Exemplars? **A2:** Sample observations linked to a trace ID — allows jumping from a Prometheus metric spike to the specific trace in Jaeger/Tempo.
**Q3:** What is `promauto`? **A3:** Wrapper that automatically registers metrics with the default (or custom) registry — avoids separate `prometheus.MustRegister` calls.
**Q4:** How do you alert on high error rates? **A4:** Prometheus rule: `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01` triggers alert.
**Q5:** What is the RED method? **A5:** Rate, Errors, Duration — three golden signals for monitoring request-driven services.

---

## Q30: Distributed Tracing  [Level 6 — Production]
> **Tags:** `#opentelemetry` `#tracing` `#observability` `#distributed`

### Problem Statement
Instrument the Bookstore API with OpenTelemetry distributed tracing. Create spans for HTTP handlers, database calls, and outgoing HTTP requests. Propagate trace context via W3C headers. Export traces to Jaeger. Show how to correlate traces with logs.

### Input / Output / Constraints
```
Input:  GET /books/1 with traceparent header
Output: Trace in Jaeger showing: HTTP handler span → DB query span
        Logs include trace_id and span_id
Constraints: OpenTelemetry SDK, W3C trace context propagation, OTLP exporter
```

### Thought Process
1. Understand: Initialize tracer provider → create spans around operations → propagate context.
2. Pattern: `otel.Tracer` → `tracer.Start(ctx, "operation")` → defer `span.End()`.
3. Edge cases: Sampling (not all traces captured), span attributes PII, trace context across async boundaries.

### Brute Force
```go
// Manual timing — no correlation across services
start := time.Now()
result := doWork()
log.Printf("work took %s", time.Since(start)) // isolated, not correlated
```

### Better Solution
```go
tracer := otel.Tracer("bookstore")
ctx, span := tracer.Start(ctx, "GetBook")
defer span.End()
span.SetAttributes(attribute.Int("book.id", id))
```

### Best Solution
```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"

    "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/codes"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
)

func initTracer(ctx context.Context) (func(context.Context) error, error) {
    exporter, err := otlptracehttp.New(ctx,
        otlptracehttp.WithEndpoint("localhost:4318"),
        otlptracehttp.WithInsecure(),
    )
    if err != nil {
        return nil, fmt.Errorf("create exporter: %w", err)
    }

    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter),
        sdktrace.WithSampler(sdktrace.AlwaysSample()),
        sdktrace.WithResource(resource.NewWithAttributes(
            semconv.SchemaURL,
            semconv.ServiceName("bookstore-api"),
            semconv.ServiceVersion("1.0.0"),
        )),
    )

    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.TraceContext{})

    return tp.Shutdown, nil
}

var tracer = otel.Tracer("bookstore")

func tracedGetBook(ctx context.Context, repo *BookRepository, id int) (Book, error) {
    ctx, span := tracer.Start(ctx, "BookRepository.GetByID")
    defer span.End()

    span.SetAttributes(
        attribute.Int("book.id", id),
        attribute.String("db.system", "postgresql"),
        attribute.String("db.operation", "SELECT"),
    )

    book, err := repo.GetByID(ctx, id)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return Book{}, err
    }

    span.SetAttributes(attribute.String("book.title", book.Title))
    span.SetStatus(codes.Ok, "")
    return book, nil
}

func mainWithTracing() {
    ctx := context.Background()

    shutdown, err := initTracer(ctx)
    if err != nil {
        log.Fatalf("init tracer: %v", err)
    }
    defer shutdown(ctx)

    repo, _ := NewBookRepository(ctx)
    _ = repo

    mux := http.NewServeMux()
    mux.HandleFunc("GET /books/{id}", func(w http.ResponseWriter, r *http.Request) {
        // span is automatically created by otelhttp middleware
        fmt.Fprintln(w, "traced")
    })

    // otelhttp automatically creates spans for each request
    // and propagates incoming W3C traceparent/tracestate headers
    handler := otelhttp.NewHandler(mux, "bookstore-api",
        otelhttp.WithMessageEvents(otelhttp.ReadEvents, otelhttp.WriteEvents),
    )

    log.Fatal(http.ListenAndServe(":8080", handler))
}
```
**Time:** O(1) per span | **Space:** O(n active spans)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Use head-based sampling (1-10%) in production; tail-based sampling for errors |
| Edge Cases | PII in span attributes (user IDs, emails) — sanitize before exporting |
| Error Handling | RecordError adds exception to span; SetStatus marks span as failed |
| Memory | Each span held in memory until exported; BatchSpanProcessor buffers async |
| Concurrency | OpenTelemetry SDK is goroutine-safe; context carries span reference |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /books/1\ntraceparent header"] --> B["otelhttp middleware\nextract trace context"]
    B --> C["create HTTP handler span"]
    C --> D["tracedGetBook(ctx)"]
    D --> E["create DB span\nspan.SetAttributes"]
    E --> F["repo.GetByID — DB query"]
    F --> G["span.End()"]
    G --> H["HTTP handler span.End()"]
    H --> I["BatchSpanProcessor\nexport to Jaeger via OTLP"]
```
```
Trace: incoming header → extract → HTTP span → DB child span → DB query → export → Jaeger
```

### Interviewer Questions
1. What is W3C Trace Context? The `traceparent` and `tracestate` HTTP headers — standard for propagating trace IDs across services.
2. Can it be optimized? Head-based sampling; Tail-based sampling keeps all error traces regardless of rate.
3. Scale to 10M? 1% sampling rate; send to Tempo/Jaeger via Otel Collector; correlation via trace ID in logs.
4. Edge cases? Clock skew between services (use monotonic timestamps), sampled vs unsampled spans in same trace.
5. Goroutine-safe? Yes — OTel SDK uses sync primitives; span context is immutable.
6. Memory impact? Each span ~1KB in memory; BatchSpanProcessor flushes periodically.
7. Alternative? Jaeger client directly (deprecated in favor of OTel); Zipkin for simpler setups.

### Follow-Up Questions
**Q1:** What is head-based vs tail-based sampling? **A1:** Head: decision made at trace start (fast, misses rare errors); Tail: decision after full trace collected (catches all errors, more complex).
**Q2:** How do you correlate traces with logs? **A2:** Inject trace_id and span_id into log fields; use Grafana Loki + Tempo for correlation.
**Q3:** What is a span attribute vs span event? **A3:** Attribute: key-value on the span itself; Event: timestamped annotation on the span timeline.
**Q4:** What is the OTel Collector? **A4:** A vendor-neutral proxy that receives telemetry, processes it, and exports to multiple backends simultaneously.
**Q5:** What is exemplar in metrics+traces? **A5:** A sample metric observation linked to a specific trace ID — enables jumping from metric anomaly directly to the causing trace.

---

## Q31: API Versioning  [Level 6 — Production]
> **Tags:** `#api-versioning` `#backward-compatibility` `#production`

### Problem Statement
Implement API versioning for the Bookstore API supporting three strategies: URL path versioning (`/v1/books`, `/v2/books`), header versioning (`X-API-Version: 2`), and content negotiation (`Accept: application/vnd.bookstore.v2+json`). V2 adds a `genre` field to the book response. Route requests to the correct handler version.

### Input / Output / Constraints
```
Input:  GET /v1/books  → Book without genre
        GET /v2/books  → Book with genre field
        X-API-Version: 2 header → v2 handler
Constraints: No breaking changes in v1, v2 is additive, deprecation headers for v1
```

### Thought Process
1. Understand: Three versioning approaches — URL (most common), header, content-type; each has tradeoffs.
2. Pattern: Version detection middleware → route to versioned handler.
3. Edge cases: Unknown version (default to latest or error), deprecation sunset date.

### Brute Force
```go
// URL prefix only — no header/content-type support
mux.HandleFunc("/v1/books", handleV1Books)
mux.HandleFunc("/v2/books", handleV2Books)
```

### Better Solution
```go
// Version detection via multiple strategies
func detectVersion(r *http.Request) string {
    if v := r.Header.Get("X-API-Version"); v != "" { return v }
    if strings.HasPrefix(r.URL.Path, "/v2/") { return "2" }
    return "1"
}
```

### Best Solution
```go
package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "strings"
)

type BookV1 struct {
    ID     int    `json:"id"`
    Title  string `json:"title"`
    Author string `json:"author"`
    Year   int    `json:"year"`
}

type BookV2 struct {
    ID     int    `json:"id"`
    Title  string `json:"title"`
    Author string `json:"author"`
    Year   int    `json:"year"`
    Genre  string `json:"genre"` // new in v2
}

const (
    V1 = "1"
    V2 = "2"
    defaultVersion = V2
    sunsetDateV1   = "2025-12-31"
)

func extractVersion(r *http.Request) string {
    // 1. URL path prefix: /v1/, /v2/
    if strings.HasPrefix(r.URL.Path, "/v1/") {
        return V1
    }
    if strings.HasPrefix(r.URL.Path, "/v2/") {
        return V2
    }

    // 2. Accept header: application/vnd.bookstore.v2+json
    accept := r.Header.Get("Accept")
    if strings.Contains(accept, "vnd.bookstore.v1") {
        return V1
    }
    if strings.Contains(accept, "vnd.bookstore.v2") {
        return V2
    }

    // 3. X-API-Version header
    if v := r.Header.Get("X-API-Version"); v != "" {
        return v
    }

    return defaultVersion
}

func VersionMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        version := extractVersion(r)

        // Add deprecation headers for v1
        if version == V1 {
            w.Header().Set("Deprecation", "true")
            w.Header().Set("Sunset", sunsetDateV1)
            w.Header().Set("Link", `</v2/books>; rel="successor-version"`)
        }

        w.Header().Set("X-API-Version", version)
        // Store version in request for handlers
        r.Header.Set("X-Resolved-Version", version)
        next.ServeHTTP(w, r)
    })
}

func booksVersionedHandler(w http.ResponseWriter, r *http.Request) {
    version := r.Header.Get("X-Resolved-Version")
    if version == "" {
        version = defaultVersion
    }

    switch version {
    case V1:
        books := []BookV1{{1, "Go Programming", "Kernighan", 2019}}
        w.Header().Set("Content-Type", "application/vnd.bookstore.v1+json")
        json.NewEncoder(w).Encode(map[string]any{"books": books, "version": "1"})

    case V2:
        books := []BookV2{{1, "Go Programming", "Kernighan", 2019, "Computer Science"}}
        w.Header().Set("Content-Type", "application/vnd.bookstore.v2+json")
        json.NewEncoder(w).Encode(map[string]any{"books": books, "version": "2"})

    default:
        http.Error(w, fmt.Sprintf(`{"error":"unsupported API version: %s"}`, version),
            http.StatusBadRequest)
    }
}

func main() {
    mux := http.NewServeMux()
    // URL path versioning
    mux.HandleFunc("/v1/books", booksVersionedHandler)
    mux.HandleFunc("/v2/books", booksVersionedHandler)
    mux.HandleFunc("/books", booksVersionedHandler) // header/accept versioning

    handler := VersionMiddleware(mux)
    log.Fatal(http.ListenAndServe(":8080", handler))
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | URL versioning is cache-friendly (CDN can cache /v1/ separately from /v2/) |
| Edge Cases | Unknown version → 400 or default to latest; sunset date must be communicated well in advance |
| Error Handling | Always return version in response headers; never silently fall back to wrong version |
| Memory | Versioned structs add code duplication — use field tags or transformers |
| Concurrency | Stateless version detection — fully concurrent |

### Visual Explanation
```mermaid
flowchart TD
    A["HTTP Request"] --> B["VersionMiddleware\nextractVersion"]
    B --> C{version source}
    C -->|/v1/ path| D["V1"]
    C -->|/v2/ path| E["V2"]
    C -->|X-API-Version header| F["from header"]
    C -->|Accept header| G["from content-type"]
    D -->|v1| H["add Deprecation/Sunset headers"]
    D & E & F & G --> I["booksVersionedHandler"]
    I -->|v1| J["BookV1 response"]
    I -->|v2| K["BookV2 with genre"]
```

### Interviewer Questions
1. What is the recommended versioning strategy? URL versioning for public APIs (most explicit, cache-friendly); header versioning for internal APIs.
2. Can it be optimized? Shared response struct with version-specific serialization.
3. Scale to 10M? Deploy v1 and v2 as separate services; API gateway routes by path prefix.
4. Edge cases? Client sends both URL v1 prefix and X-API-Version: 2 header — URL takes precedence.
5. Goroutine-safe? Stateless — yes.
6. Memory impact? Duplicate handler code; negligible runtime impact.
7. Alternative? GraphQL for flexible field selection without versioning; gRPC proto evolution.

### Follow-Up Questions
**Q1:** How long should you support an old API version? **A1:** Minimum 12 months after deprecation announcement; some companies (Stripe) support versions for 5+ years.
**Q2:** What is semantic versioning for APIs? **A2:** Major (breaking), minor (additive), patch (bug fixes) — but public APIs usually only expose major version.
**Q3:** How do you handle breaking schema changes in v2? **A3:** Create new endpoint/response types; v1 clients are unaffected; write migration guide.
**Q4:** What is API evolution vs versioning? **A4:** Evolution: backward-compatible changes without new version; versioning: explicit new version for breaking changes.
**Q5:** What is the Tolerant Reader pattern? **A5:** Clients ignore unknown fields — enables server to add new fields without breaking old clients.

---

## Q32-Q35: Short Interview Problems  [Levels 4-5]

---

## Q32: Implement http.RoundTripper  [Level 4 — Advanced]
> **Tags:** `#RoundTripper` `#http-client` `#transport` `#interceptor`

### Problem Statement
Implement a custom `http.RoundTripper` that adds authentication headers, logs requests/responses, and can be layered (chained) with other transports. Use it to transparently add Bearer token auth to all outgoing requests from an HTTP client.

### Input / Output / Constraints
```
Input:  Any outgoing HTTP request
Output: Request with Authorization: Bearer <token> header added automatically
        Log: → GET https://api.example.com/data  ← 200 42ms
Constraints: Must implement RoundTrip(r *http.Request) (*http.Response, error)
```

### Thought Process
1. Understand: `http.RoundTripper` is the transport layer — intercept every outgoing request.
2. Pattern: Wrap inner transport; modify request clone; call inner.RoundTrip.
3. Edge cases: Must not modify original request (clone it), nil inner transport, redirect handling.

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "time"
)

// AuthTransport adds Bearer token to all requests
type AuthTransport struct {
    Token     string
    Inner     http.RoundTripper
}

func (t *AuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    // Clone request — never mutate the original
    clone := req.Clone(req.Context())
    clone.Header.Set("Authorization", "Bearer "+t.Token)
    clone.Header.Set("User-Agent", "GoClient/1.0")

    inner := t.Inner
    if inner == nil {
        inner = http.DefaultTransport
    }

    start := time.Now()
    resp, err := inner.RoundTrip(clone)
    dur := time.Since(start)

    if err != nil {
        log.Printf("→ %s %s [ERROR] %v %.1fms", req.Method, req.URL, err, float64(dur.Milliseconds()))
        return nil, err
    }
    log.Printf("→ %s %s ← %d %.1fms", req.Method, req.URL, resp.StatusCode, float64(dur.Milliseconds()))
    return resp, nil
}

func main() {
    client := &http.Client{
        Transport: &AuthTransport{Token: "my-secret-token"},
    }
    resp, err := client.Get("https://httpbin.org/get")
    if err != nil {
        log.Fatal(err)
    }
    defer resp.Body.Close()
    fmt.Printf("Status: %d\n", resp.StatusCode)
}
```
**Time:** O(1) overhead | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Stateless transport — one instance shared across all requests |
| Edge Cases | Token refresh (check 401 and retry with new token), nil inner transport |
| Error Handling | Never swallow RoundTrip errors; wrap with context |
| Memory | Clone per request — O(request headers size) |
| Concurrency | RoundTrip must be goroutine-safe; read-only fields after construction |

---

## Q33: Long Polling  [Level 4 — Advanced]
> **Tags:** `#long-polling` `#real-time` `#comet` `#http`

### Problem Statement
Implement long polling for a notification service. The client sends `GET /notifications?since=<timestamp>` and the server holds the connection until a new notification arrives or 30 seconds elapse. On timeout, return empty with the current timestamp so the client can re-poll.

### Input / Output / Constraints
```
Input:  GET /notifications?since=1700000000
Output: 200 {"notifications":[...],"timestamp":1700000100}  — when new notification
        200 {"notifications":[],"timestamp":1700000030}   — on timeout (30s)
Constraints: Context cancellation, channel-based notification, no goroutine leaks
```

### Best Solution
```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "strconv"
    "sync"
    "time"
)

type Notification struct {
    ID      int    `json:"id"`
    Message string `json:"message"`
    Time    int64  `json:"time"`
}

type NotificationBroker struct {
    mu          sync.Mutex
    subscribers map[int64]chan Notification
    nextSubID   int64
}

func NewBroker() *NotificationBroker {
    return &NotificationBroker{
        subscribers: make(map[int64]chan Notification),
    }
}

func (b *NotificationBroker) Subscribe() (int64, <-chan Notification) {
    b.mu.Lock()
    defer b.mu.Unlock()
    id := b.nextSubID
    b.nextSubID++
    ch := make(chan Notification, 1)
    b.subscribers[id] = ch
    return id, ch
}

func (b *NotificationBroker) Unsubscribe(id int64) {
    b.mu.Lock()
    defer b.mu.Unlock()
    delete(b.subscribers, id)
}

func (b *NotificationBroker) Publish(n Notification) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, ch := range b.subscribers {
        select {
        case ch <- n:
        default: // subscriber too slow — drop
        }
    }
}

func longPollHandler(broker *NotificationBroker) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // Parse since timestamp
        since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
        _ = since // would filter notifications before this timestamp

        subID, notifCh := broker.Subscribe()
        defer broker.Unsubscribe(subID)

        timeout := time.NewTimer(30 * time.Second)
        defer timeout.Stop()

        select {
        case <-r.Context().Done():
            // Client disconnected
            return
        case n := <-notifCh:
            w.Header().Set("Content-Type", "application/json")
            json.NewEncoder(w).Encode(map[string]any{
                "notifications": []Notification{n},
                "timestamp":     time.Now().Unix(),
            })
        case <-timeout.C:
            w.Header().Set("Content-Type", "application/json")
            json.NewEncoder(w).Encode(map[string]any{
                "notifications": []Notification{},
                "timestamp":     time.Now().Unix(),
            })
        }
    }
}

func main() {
    broker := NewBroker()
    mux := http.NewServeMux()
    mux.HandleFunc("GET /notifications", longPollHandler(broker))

    // Simulate publishing notifications
    go func() {
        id := 0
        for range time.Tick(10 * time.Second) {
            id++
            broker.Publish(Notification{ID: id, Message: "new event", Time: time.Now().Unix()})
        }
    }()

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) per notification | **Space:** O(n subscribers)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Long polling holds connections — limit concurrent pollers; prefer SSE or WebSocket at scale |
| Edge Cases | Goroutine leak if subscribe but never unsubscribe (defer Unsubscribe) |
| Error Handling | Client disconnect detection via r.Context().Done() |
| Memory | One channel per subscriber; bounded by buffer size |
| Concurrency | Mutex protects subscribers map; channel per subscriber avoids cross-contamination |

---

## Q34: Reverse Proxy  [Level 5 — Interview]
> **Tags:** `#reverse-proxy` `#httputil` `#load-balancing` `#proxy`

### Problem Statement
Build a simple reverse proxy using `httputil.ReverseProxy` that load balances across multiple backend servers using round-robin. The proxy should strip a path prefix, add `X-Forwarded-For` and `X-Request-ID` headers, and handle backend failures gracefully by trying the next backend.

### Input / Output / Constraints
```
Input:  GET /api/users  proxy for backends: [backend1:8081, backend2:8082, backend3:8083]
Output: Request forwarded to backend (round-robin), prefixed path stripped
        Failed backend → try next; all fail → 502
Constraints: thread-safe round-robin, X-Forwarded-For, graceful error handling
```

### Best Solution
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "net/http/httputil"
    "net/url"
    "sync/atomic"
)

type LoadBalancer struct {
    backends []*url.URL
    counter  atomic.Uint64
    prefix   string
}

func NewLoadBalancer(backends []string, prefix string) (*LoadBalancer, error) {
    urls := make([]*url.URL, len(backends))
    for i, b := range backends {
        u, err := url.Parse(b)
        if err != nil {
            return nil, fmt.Errorf("parse backend %q: %w", b, err)
        }
        urls[i] = u
    }
    return &LoadBalancer{backends: urls, prefix: prefix}, nil
}

func (lb *LoadBalancer) nextBackend() *url.URL {
    idx := lb.counter.Add(1) - 1
    return lb.backends[idx%uint64(len(lb.backends))]
}

func (lb *LoadBalancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    target := lb.nextBackend()

    proxy := &httputil.ReverseProxy{
        Rewrite: func(pr *httputil.ProxyRequest) {
            pr.SetURL(target)
            pr.SetXForwarded()
            // Strip prefix
            if lb.prefix != "" {
                pr.Out.URL.Path = pr.Out.URL.Path[len(lb.prefix):]
                if pr.Out.URL.Path == "" {
                    pr.Out.URL.Path = "/"
                }
            }
            // Add request ID
            if id := r.Header.Get("X-Request-ID"); id != "" {
                pr.Out.Header.Set("X-Request-ID", id)
            }
        },
        ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
            log.Printf("proxy error to %s: %v", target, err)
            http.Error(w, `{"error":"backend unavailable"}`, http.StatusBadGateway)
        },
    }

    proxy.ServeHTTP(w, r)
}

func main() {
    lb, err := NewLoadBalancer(
        []string{"http://localhost:8081", "http://localhost:8082", "http://localhost:8083"},
        "/api",
    )
    if err != nil {
        log.Fatal(err)
    }

    mux := http.NewServeMux()
    mux.Handle("/api/", lb)

    log.Println("Reverse proxy listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```
**Time:** O(1) round-robin | **Space:** O(n backends)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Add health check per backend; skip unhealthy backends in rotation |
| Edge Cases | All backends down (502), backend slow (proxy timeout), WebSocket upgrade |
| Error Handling | ErrorHandler prevents default empty 502; try next backend on failure |
| Memory | One ReverseProxy created per request — use a shared proxy with custom director |
| Concurrency | atomic.Uint64 counter is goroutine-safe; no mutex needed |

---

## Q35: OAuth2 Client Credentials Flow  [Level 6 — Production]
> **Tags:** `#oauth2` `#client-credentials` `#token-refresh` `#production`

### Problem Statement
Implement an OAuth2 client credentials flow for server-to-server authentication. The client requests a token from the token endpoint, caches it until expiry (with 30-second buffer), automatically refreshes before expiry, and transparently injects the token into outgoing requests via a custom RoundTripper.

### Input / Output / Constraints
```
Input:  Outgoing API request to protected service
Output: Request automatically has Authorization: Bearer <token>
        Token auto-refreshed when <30s from expiry
Constraints: Thread-safe token cache, no token expiry during request, retry on 401
```

### Best Solution
```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "net/url"
    "strings"
    "sync"
    "time"
)

type TokenResponse struct {
    AccessToken string `json:"access_token"`
    ExpiresIn   int    `json:"expires_in"`
    TokenType   string `json:"token_type"`
}

type OAuth2Transport struct {
    ClientID     string
    ClientSecret string
    TokenURL     string
    Scopes       []string
    Inner        http.RoundTripper

    mu         sync.RWMutex
    token      string
    expiry     time.Time
    httpClient *http.Client
}

func (t *OAuth2Transport) fetchToken(ctx context.Context) error {
    form := url.Values{
        "grant_type":    {"client_credentials"},
        "client_id":     {t.ClientID},
        "client_secret": {t.ClientSecret},
    }
    if len(t.Scopes) > 0 {
        form.Set("scope", strings.Join(t.Scopes, " "))
    }

    req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.TokenURL,
        strings.NewReader(form.Encode()))
    if err != nil {
        return fmt.Errorf("build token request: %w", err)
    }
    req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

    client := t.httpClient
    if client == nil {
        client = http.DefaultClient
    }
    resp, err := client.Do(req)
    if err != nil {
        return fmt.Errorf("token request: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("token endpoint returned %d", resp.StatusCode)
    }

    var tok TokenResponse
    if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
        return fmt.Errorf("decode token: %w", err)
    }

    t.mu.Lock()
    defer t.mu.Unlock()
    t.token = tok.AccessToken
    // Buffer 30 seconds before actual expiry
    t.expiry = time.Now().Add(time.Duration(tok.ExpiresIn-30) * time.Second)
    return nil
}

func (t *OAuth2Transport) validToken() (string, bool) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    if t.token != "" && time.Now().Before(t.expiry) {
        return t.token, true
    }
    return "", false
}

func (t *OAuth2Transport) RoundTrip(req *http.Request) (*http.Response, error) {
    token, ok := t.validToken()
    if !ok {
        if err := t.fetchToken(req.Context()); err != nil {
            return nil, fmt.Errorf("fetch token: %w", err)
        }
        token, _ = t.validToken()
    }

    clone := req.Clone(req.Context())
    clone.Header.Set("Authorization", "Bearer "+token)

    inner := t.Inner
    if inner == nil {
        inner = http.DefaultTransport
    }

    resp, err := inner.RoundTrip(clone)
    if err != nil {
        return nil, err
    }

    // On 401, refresh token and retry once
    if resp.StatusCode == http.StatusUnauthorized {
        resp.Body.Close()
        t.mu.Lock()
        t.token = "" // invalidate
        t.mu.Unlock()

        if err := t.fetchToken(req.Context()); err != nil {
            return nil, fmt.Errorf("refresh token: %w", err)
        }
        token, _ = t.validToken()
        clone2 := req.Clone(req.Context())
        clone2.Header.Set("Authorization", "Bearer "+token)
        return inner.RoundTrip(clone2)
    }
    return resp, nil
}

func main() {
    transport := &OAuth2Transport{
        ClientID:     "my-client-id",
        ClientSecret: "my-client-secret",
        TokenURL:     "https://auth.example.com/oauth2/token",
        Scopes:       []string{"read:books", "write:books"},
    }

    client := &http.Client{Transport: transport}

    resp, err := client.Get("https://api.example.com/books")
    if err != nil {
        log.Fatalf("request failed: %v", err)
    }
    defer resp.Body.Close()
    log.Printf("Status: %d", resp.StatusCode)
}
```
**Time:** O(1) cached | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Token cached for lifetime — only one fetch per expiry cycle; safe across goroutines |
| Edge Cases | Concurrent expiry (multiple goroutines detecting expired token simultaneously — double fetch) |
| Error Handling | Single retry on 401; circuit breaker on token endpoint failures |
| Memory | Single token string cached; minimal overhead |
| Concurrency | RWMutex: multiple readers of valid token; exclusive writer for refresh |

---

## Company-Style Questions

### 🔵 Google Style (3Q — algorithm focused)

**G1.** Given an HTTP server serving millions of unique URLs, design a middleware that tracks the top-K most requested URLs in real time without unbounded memory growth. What data structure provides O(1) amortized updates and O(K) retrieval?

*Hint: Count-Min Sketch for frequency estimation + min-heap for top-K. Accept approximate counts — exact tracking would require O(unique URLs) memory.*

**G2.** Design an HTTP handler that implements a consistent-hash-based cache. Given N cache servers, requests for the same resource should always route to the same server (for cache locality), but adding/removing servers should only remap 1/N of keys. Implement `SelectServer(key string, servers []string) string`.

*Hint: Hash ring with virtual nodes. `hash(key) mod 2^32` → walk ring clockwise to nearest virtual node. Adding server only displaces keys between new node and its predecessor.*

**G3.** An API endpoint must aggregate results from 5 microservices. Service latencies are: P50=10ms, P99=200ms. If you call all 5 sequentially, what is the P99 total latency? If you call concurrently with a hedge at P50, what is the theoretical P99? Implement the hedged request pattern.

*Answer: Sequential P99 ≈ 5×200=1000ms. Hedged concurrent: if first response doesn't arrive by P50 (10ms), send a second request to a different instance — P99 ≈ P50(first) + P50(second) ≈ 20ms with high probability.*

---

### 🟡 Uber Style (3Q — real-time systems)

**U1.** Design a rate limiter for Uber's driver location updates: 1M drivers each sending location every 5 seconds. Each update must be processed within 100ms. The rate limiter must allow burst of 3 updates per driver while enforcing the 1 req/5s steady-state. Implement using token bucket with Redis atomic operations.

*Key insight: Redis EVAL Lua script for atomic read-modify-write of driver bucket. Lua: GET bucket, compute tokens based on elapsed time, allow/deny, SET with TTL.*

**U2.** Implement a surge pricing HTTP middleware for the Rides API. When the request rate for a geo-cell exceeds threshold, inject a `X-Surge-Multiplier` header into the request context. The surge calculation must run in <1ms and must not block ride requests. What data structure allows O(1) geo-cell lookup and atomic rate tracking?

*Hint: Geohash (base32) as map key → atomic counter. Background goroutine computes surge multipliers every second from counters.*

**U3.** The /matching endpoint receives 50K requests/sec and must fan-out to 3 services with P99 latency SLA of 500ms. Design the timeout/cancellation strategy: if the fanout context times out, which responses do you still return? How do you distinguish "service slow" from "service error"? Implement with errgroup and partial result collection.

*Answer: Use separate contexts per service (not shared cancel); collect all results even if some error; return partial data with degraded indicator for slow services.*

---

### 🟠 Amazon Style (3Q — distributed/reliability)

**A1.** Design a circuit breaker middleware for AWS service calls from an API handler. The breaker should: open after 5 failures in 10s, stay open for 30s (reject fast), half-open to test with 1 request, close on success. How do you handle concurrent requests in half-open state without a global lock?

*Answer: Use atomic state transitions (Closed=0, Open=1, HalfOpen=2). atomic.CompareAndSwap(HalfOpen, 1, Open/Closed) ensures only one request goes through in half-open state.*

**A2.** An S3-backed file service API must achieve 99.99% availability. Design the retry strategy for S3 calls considering: S3 returns 503 (throttling) and 500 (transient). Write the retry logic respecting idempotency (GET is safe, PUT with Content-MD5 is idempotent, POST is not). How do you ensure uploaded files are eventually consistent with the metadata DB?

*Pattern: Exponential backoff with jitter for 500/503; use conditional PUT (If-None-Match for create, If-Match for update); for consistency use the Saga pattern or outbox pattern with DB transaction.*

**A3.** A Lambda-style HTTP endpoint must handle 10K concurrent requests without OOMing. The handler reads a JSON body, calls a DB, and returns results. Analyze the memory profile: what allocates per request? How do you reduce allocations to <10 per request? Implement using `sync.Pool` for JSON buffers and `pgx` batching.

*Answer: Per request: HTTP request struct, body bytes, JSON decoded struct, response struct, response bytes ≈ 8 allocations minimum. Pool reusable buffers (bytes.Buffer, json.Decoder); use pgx row scanning into pre-allocated struct.*

---

### 🟢 Stripe Style (2Q — payment/correctness)

**S1.** Design an idempotent payment API endpoint `POST /charges`. Clients send an `Idempotency-Key` header. If the same key is received within 24 hours, return the original response without processing the charge again. The key must be stored transactionally with the charge record. Implement the idempotency check middleware with PostgreSQL upsert and distributed locking.

*Key: `INSERT INTO idempotency_keys (key, response, created_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO NOTHING RETURNING id` — if no row returned, key exists; return cached response. Use Redis SETNX for the lock during processing.*

**S2.** A webhook delivery handler must guarantee at-least-once delivery with exactly-once processing on the receiver side. The sender retries with exponential backoff for 72 hours. The receiver must be idempotent. Design the deduplication scheme: the sender includes `Stripe-Signature` (HMAC of payload+timestamp), `Idempotency-Key` (event ID), and `Retry-Count`. How do you verify authenticity and deduplicate simultaneously?

*Pattern: Verify HMAC first (reject tampered); check event ID in `processed_events` table (return 200 immediately if seen); process within a transaction; INSERT event ID (unique constraint prevents double-processing); commit.*

---

### 🔴 Razorpay Style (2Q — payment APIs/Indian banking)

**R1.** Design an HTTP API for UPI payment initiation (`POST /upi/pay`) that must handle the RBI mandate: payment processing must complete within 30 seconds or be auto-reversed. The upstream NPCI (National Payments Corporation of India) API has P99 of 8 seconds and occasionally hangs. Implement: 10-second timeout with automatic reversal on timeout, idempotent retry, and status polling endpoint. What happens if reversal itself fails?

*Pattern: Initiate UPI → 10s context timeout → if timeout, fire reversal goroutine + save PENDING_REVERSAL to DB → poll /status endpoint; if reversal fails, retry with exponential backoff up to 3 times, then alert ops; event sourcing for audit trail.*

**R2.** Build a payment webhook receiver for Razorpay notifications. The endpoint must: verify the `X-Razorpay-Signature` (HMAC-SHA256 of `razorpay_payment_id|razorpay_order_id` with webhook secret), handle duplicate deliveries (Razorpay retries for 24h), process payment status changes (authorized/captured/failed) atomically with order status updates, and respond within 5 seconds (Razorpay retries on timeout). Design the handler with proper error boundaries.

*Key: Compute `HMAC-SHA256(secret, "payment_id|order_id")` → compare with signature header (constant-time compare!). Use `crypto/subtle.ConstantTimeCompare` to prevent timing attacks. Process in DB transaction: check duplicate by razorpay_payment_id, update order status, publish event — respond 200 before async processing if > 5s risk.*
