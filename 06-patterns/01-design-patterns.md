# Go Design Patterns

## What Is This?

Design patterns are proven, reusable solutions to commonly occurring software design problems. They are not code libraries you import — they are templates for how to structure code to solve recurring problems like object creation, composing behavior, and defining communication protocols between objects. The Gang of Four (GoF) book catalogued 23 patterns in 1994 for object-oriented languages; Go implements all of them, but many become simpler or take entirely different forms because Go uses interfaces and composition rather than class hierarchies.

## Why Does It Exist?

Without patterns, every programmer reinvents the same wheels differently: one team's configuration object looks nothing like another's, adding new behaviors requires modifying existing classes (violating Open/Closed Principle), and two-line changes in requirements require rewriting entire subsystems. Design patterns provide a shared vocabulary and proven structure so that when a senior engineer says "use the Strategy pattern here," every team member understands the intent, the structure, and the constraints. They exist because humans kept solving the same problems badly until someone catalogued the good solutions.

## Who Uses This in Industry?

- **Google**: Go's `http.Handler` interface is a textbook Decorator/Chain-of-Responsibility pattern. The gRPC interceptor system uses the Chain pattern. The `context` package uses the Decorator pattern to add deadlines and values without modifying types.
- **Uber**: Uber's Zap logger uses the Builder pattern (via `zap.NewProductionConfig().Build()`). Their YARPC framework uses the Middleware (Decorator) pattern for cross-cutting concerns across 4,000+ services.
- **Docker**: Docker's `io.Reader`/`io.Writer` interfaces enable the Decorator pattern — layering gzip, encryption, and buffering on top of a file writer without changing any type.
- **Kubernetes**: Kubernetes controllers use the Observer pattern (watch-list on the API server). The plugin system uses Strategy. Every controller reconcile loop is a Template Method pattern.
- **Netflix**: Netflix's Hystrix circuit breaker (ported to Go as hystrix-go) is a Proxy pattern. Their configuration system uses the Builder pattern.

## Industry Standards and Best Practices

**What senior engineers do:**
- Use Functional Options (Builder variant) for configuring structs — never a 15-argument constructor
- Use interface-based Dependency Injection instead of global singletons
- Use sync.Once for true lazy singletons — not double-checked locking anti-patterns
- Use function values as Strategies instead of creating a new interface for every variation
- Apply Table-Driven tests — Go's most important pattern for testing
- Wrap errors with `%w` (Error wrapping pattern) for structured error chains

**What beginners do:**
- Create a singleton via a global var and hope for the best under concurrent access
- Create a 10-parameter struct constructor and wonder why callsites are unreadable
- Implement Observer by returning a single value from a function instead of using channels
- Copy-paste the same switch statement everywhere instead of using a Strategy map

**When to use patterns (vs. when not to):**
- Use patterns to solve a real problem you have, not to demonstrate that you know patterns
- Overuse of patterns makes code harder to read ("pattern soup")
- Go's interface system means many patterns are implicit — you don't need to name them

## Why Go's Approach Is Unique

Java and C++ implement patterns through class inheritance: you extend an abstract class to change behavior. Python uses inheritance too, but also supports duck typing. Go has no inheritance — only interfaces and composition.

This changes patterns fundamentally:
- **Decorator**: In Java you extend a base class. In Go you wrap a value that implements an interface — cleaner, no class hierarchy.
- **Strategy**: In Java you create an abstract Strategy class with concrete subclasses. In Go you pass a `func(...)` value — one line.
- **Observer**: In Java you maintain a list of observer objects. In Go you use channels — the Observer pattern is a first-class language feature.
- **Template Method**: In Java you create an abstract class with hook methods. In Go you use struct embedding to share implementation.
- **Singleton**: In Java you use double-checked locking (error-prone). In Go `sync.Once` handles it correctly and idiomatically.

Go's interface-based design means patterns are often lighter and more composable than in OOP languages. The language was designed by people who saw the complexity Java patterns created and deliberately chose a simpler path.

---

## Part 1: Creational Patterns

Creational patterns handle object construction — how objects are created, initialized, and configured.

---

### Pattern 1: Singleton with sync.Once

**WHY**: Sometimes you genuinely need exactly one instance of something — a database connection pool, a configuration registry, a metrics collector. The naive approach (`var db *DB` set in `init()`) has race conditions. Java's double-checked locking is notoriously hard to get right. Go's `sync.Once` guarantees the initialization function runs exactly once, even under concurrent access, with no boilerplate.

```go
// pattern_singleton.go
package patterns

import (
	"database/sql"
	"fmt"
	"sync"
)

// DBPool is a thread-safe singleton database connection pool.
// The zero value is ready to use — no initialization needed before calling Get().
type DBPool struct {
	once sync.Once
	db   *sql.DB
	err  error
}

// Get returns the shared database connection pool, initializing it on first call.
// Subsequent calls return the same instance immediately — sync.Once is lock-free after init.
func (p *DBPool) Get(dsn string) (*sql.DB, error) {
	p.once.Do(func() {
		db, err := sql.Open("postgres", dsn)
		if err != nil {
			p.err = fmt.Errorf("opening database: %w", err)
			return
		}
		// Configure the pool
		db.SetMaxOpenConns(25)
		db.SetMaxIdleConns(5)
		p.db = db
	})
	return p.db, p.err
}

// Package-level singleton — the idiomatic Go approach.
// This variable is never exported. External code calls GetDB().
var globalDBPool DBPool

// GetDB returns the package-level database singleton.
// Safe to call from multiple goroutines concurrently.
func GetDB(dsn string) (*sql.DB, error) {
	return globalDBPool.Get(dsn)
}

// --- Alternative: function-based singleton ---

var (
	configOnce     sync.Once
	globalConfig   *AppConfig
	globalConfigErr error
)

type AppConfig struct {
	Port int
	DSN  string
}

// GetConfig loads configuration exactly once.
// The error is captured and returned on every subsequent call too.
func GetConfig() (*AppConfig, error) {
	configOnce.Do(func() {
		// Simulate loading from environment or file
		globalConfig = &AppConfig{Port: 8080, DSN: "postgres://localhost/mydb"}
	})
	return globalConfig, globalConfigErr
}

// PITFALL: Do NOT reset sync.Once for testing. Instead, inject dependencies.
// If you find yourself wanting to reset a singleton, it's a design smell —
// the code should receive the dependency via a constructor, not a global.
```

---

### Pattern 2: Factory Method

**WHY**: Factory encapsulates object creation. Instead of callers knowing which concrete type to instantiate (and all its constructor parameters), they call a factory function that returns an interface. This decouples callers from implementations — you can add a new storage backend (Redis, DynamoDB, in-memory) without changing any calling code.

```go
// pattern_factory.go
package patterns

import (
	"fmt"
	"strings"
)

// Logger defines the contract every logger must fulfill.
// Callers depend on this interface, not any concrete type.
type Logger interface {
	Info(msg string, fields map[string]interface{})
	Error(msg string, err error, fields map[string]interface{})
}

// jsonLogger writes structured JSON logs — used in production.
type jsonLogger struct {
	serviceName string
}

func (l *jsonLogger) Info(msg string, fields map[string]interface{}) {
	fmt.Printf(`{"level":"info","service":"%s","msg":"%s","fields":%v}`+"\n",
		l.serviceName, msg, fields)
}

func (l *jsonLogger) Error(msg string, err error, fields map[string]interface{}) {
	fmt.Printf(`{"level":"error","service":"%s","msg":"%s","error":"%v","fields":%v}`+"\n",
		l.serviceName, msg, err, fields)
}

// textLogger writes human-readable logs — used in development.
type textLogger struct {
	prefix string
}

func (l *textLogger) Info(msg string, fields map[string]interface{}) {
	fmt.Printf("[INFO]  %s %s %v\n", l.prefix, msg, fields)
}

func (l *textLogger) Error(msg string, err error, fields map[string]interface{}) {
	fmt.Printf("[ERROR] %s %s error=%v %v\n", l.prefix, msg, err, fields)
}

// noopLogger silently discards all logs — used in tests.
type noopLogger struct{}

func (l *noopLogger) Info(msg string, fields map[string]interface{})              {}
func (l *noopLogger) Error(msg string, err error, fields map[string]interface{}) {}

// NewLogger is the factory function.
// Callers never import jsonLogger or textLogger directly.
// To add a new logger type, you only change this function.
func NewLogger(format, serviceName string) (Logger, error) {
	switch strings.ToLower(format) {
	case "json":
		return &jsonLogger{serviceName: serviceName}, nil
	case "text":
		return &textLogger{prefix: serviceName}, nil
	case "noop", "test":
		return &noopLogger{}, nil
	default:
		return nil, fmt.Errorf("unknown logger format %q: supported: json, text, noop", format)
	}
}

// Cache is a second factory example — creating different cache backends.
type Cache interface {
	Get(key string) (string, bool)
	Set(key, value string)
}

type inMemoryCache struct {
	data map[string]string
}

func (c *inMemoryCache) Get(key string) (string, bool) {
	v, ok := c.data[key]
	return v, ok
}
func (c *inMemoryCache) Set(key, value string) { c.data[key] = value }

type noopCache struct{}

func (c *noopCache) Get(key string) (string, bool) { return "", false }
func (c *noopCache) Set(key, value string)          {}

// NewCache creates the appropriate cache based on configuration.
// In production: returns a Redis-backed cache.
// In tests: returns a noop or in-memory cache.
func NewCache(cacheType string) (Cache, error) {
	switch cacheType {
	case "memory":
		return &inMemoryCache{data: make(map[string]string)}, nil
	case "noop":
		return &noopCache{}, nil
	default:
		return nil, fmt.Errorf("unknown cache type: %s", cacheType)
	}
}
```

---

### Pattern 3: Builder — Functional Options (Go-Idiomatic)

**WHY**: When a struct has many optional fields, the choices are: (1) a big constructor with 15 parameters — callers forget which is which; (2) a Config struct — but then you need two types per object; (3) Functional Options — the Go community's answer, used in gRPC, Zap, and countless Go libraries. Each option is a function that modifies the object. Options are composable, self-documenting, and backward-compatible (add new options without breaking callers).

```go
// pattern_builder_functional_options.go
package patterns

import (
	"fmt"
	"time"
)

// HTTPClient is what we're building.
type HTTPClient struct {
	timeout         time.Duration
	retries         int
	userAgent       string
	baseURL         string
	maxIdleConns    int
	tlsSkipVerify   bool // NEVER true in production
	headers         map[string]string
}

// Option is a function that modifies an HTTPClient.
// This is the Functional Options pattern — each Option is independently usable.
type Option func(*HTTPClient)

// WithTimeout sets the request timeout.
// Documentation lives on the option function, not a sprawling constructor.
func WithTimeout(d time.Duration) Option {
	return func(c *HTTPClient) {
		c.timeout = d
	}
}

// WithRetries sets the number of retry attempts.
func WithRetries(n int) Option {
	return func(c *HTTPClient) {
		c.retries = n
	}
}

// WithUserAgent sets the User-Agent header.
func WithUserAgent(ua string) Option {
	return func(c *HTTPClient) {
		c.userAgent = ua
	}
}

// WithBaseURL sets the base URL for all requests.
func WithBaseURL(url string) Option {
	return func(c *HTTPClient) {
		c.baseURL = url
	}
}

// WithHeader adds a default header to every request.
func WithHeader(key, value string) Option {
	return func(c *HTTPClient) {
		if c.headers == nil {
			c.headers = make(map[string]string)
		}
		c.headers[key] = value
	}
}

// WithMaxIdleConns configures connection pool size.
func WithMaxIdleConns(n int) Option {
	return func(c *HTTPClient) {
		c.maxIdleConns = n
	}
}

// NewHTTPClient creates a client with defaults, then applies options.
// Defaults represent the safe, sensible baseline.
// Options represent intentional deviations from the default.
func NewHTTPClient(opts ...Option) *HTTPClient {
	// Start with safe defaults
	c := &HTTPClient{
		timeout:      10 * time.Second,
		retries:      3,
		userAgent:    "my-service/1.0",
		maxIdleConns: 10,
		headers:      make(map[string]string),
	}

	// Apply each option in order
	for _, opt := range opts {
		opt(c)
	}

	return c
}

func (c *HTTPClient) String() string {
	return fmt.Sprintf("HTTPClient{timeout:%v, retries:%d, baseURL:%q, userAgent:%q}",
		c.timeout, c.retries, c.baseURL, c.userAgent)
}

// Usage demonstrates how clean the callsite is:
func demonstrateFunctionalOptions() {
	// Minimal — uses all defaults
	simple := NewHTTPClient()
	fmt.Println(simple)

	// Production client with explicit configuration
	production := NewHTTPClient(
		WithTimeout(30*time.Second),
		WithRetries(5),
		WithBaseURL("https://api.payment.internal"),
		WithUserAgent("order-service/2.1.0"),
		WithHeader("X-Internal-Service", "order-service"),
		WithMaxIdleConns(50),
	)
	fmt.Println(production)

	// Test client — fast timeout, no retries
	test := NewHTTPClient(
		WithTimeout(100*time.Millisecond),
		WithRetries(0),
		WithBaseURL("http://localhost:8080"),
	)
	fmt.Println(test)
}
```

**PITFALL**: Don't confuse Functional Options with the Options Struct pattern. Options Struct (`NewClient(Config{Timeout: 10s})`) requires callers to always pass all fields. Functional Options only require callers to specify what differs from the default.

---

### Pattern 4: Prototype (Clone)

**WHY**: When creating an object is expensive (involves network calls, database reads, complex computation), and you need many similar objects, cloning a prototype is cheaper than rebuilding from scratch. In Go, this is usually just a method that returns a deep copy.

```go
// pattern_prototype.go
package patterns

import "fmt"

// QueryBuilder builds SQL queries and can be cloned.
// Used when you have a base query that gets customized many ways.
type QueryBuilder struct {
	table      string
	conditions []string
	orderBy    string
	limit      int
	fields     []string
}

func NewQueryBuilder(table string) *QueryBuilder {
	return &QueryBuilder{
		table:  table,
		fields: []string{"*"},
		limit:  100,
	}
}

// Clone creates a deep copy of this QueryBuilder.
// This is the Prototype pattern — create once, clone many.
func (q *QueryBuilder) Clone() *QueryBuilder {
	clone := *q // shallow copy of the struct
	// Deep copy slices — shallow copy shares underlying arrays
	clone.conditions = make([]string, len(q.conditions))
	copy(clone.conditions, q.conditions)
	clone.fields = make([]string, len(q.fields))
	copy(clone.fields, q.fields)
	return &clone
}

func (q *QueryBuilder) Where(condition string) *QueryBuilder {
	q.conditions = append(q.conditions, condition)
	return q
}

func (q *QueryBuilder) OrderBy(field string) *QueryBuilder {
	q.orderBy = field
	return q
}

func (q *QueryBuilder) Limit(n int) *QueryBuilder {
	q.limit = n
	return q
}

func (q *QueryBuilder) Select(fields ...string) *QueryBuilder {
	q.fields = fields
	return q
}

func (q *QueryBuilder) Build() string {
	return fmt.Sprintf("SELECT %v FROM %s WHERE %v ORDER BY %s LIMIT %d",
		q.fields, q.table, q.conditions, q.orderBy, q.limit)
}

func demonstratePrototype() {
	// Create a base query
	base := NewQueryBuilder("users").
		Where("deleted_at IS NULL").
		OrderBy("created_at DESC")

	// Clone and customize — base is unchanged
	activeUsers := base.Clone().Where("status = 'active'").Limit(50)
	adminUsers := base.Clone().Where("role = 'admin'").Select("id", "email", "role")

	fmt.Println(activeUsers.Build())
	fmt.Println(adminUsers.Build())
	fmt.Println(base.Build()) // base unchanged
}
```

---

## Part 2: Structural Patterns

Structural patterns define how objects and types are composed to form larger structures.

---

### Pattern 5: Adapter (Interface Wrapping)

**WHY**: You have two types that do the same thing but have different interfaces. You can't change the external library's interface, and you can't change the internal interface your code depends on. An Adapter wraps one interface to make it look like the other — no modification of either type needed. This is one of Go's strongest patterns because wrapping an interface is just a struct with a field.

```go
// pattern_adapter.go
package patterns

import (
	"context"
	"fmt"
	"time"
)

// --- Internal domain interface ---

// Notifier is your internal abstraction for sending notifications.
type Notifier interface {
	Send(ctx context.Context, recipient, message string) error
}

// --- External library (you cannot modify this) ---

// AWSEmailClient represents an AWS SDK email client you're using.
// Its interface doesn't match your Notifier interface.
type AWSEmailClient struct {
	region string
}

func NewAWSEmailClient(region string) *AWSEmailClient {
	return &AWSEmailClient{region: region}
}

// SendEmail has a completely different signature than Notifier.Send
func (c *AWSEmailClient) SendEmail(to, subject, body string, opts ...interface{}) error {
	fmt.Printf("AWS SES: sending to=%s subject=%s body=%s region=%s\n",
		to, subject, body, c.region)
	return nil
}

// --- Adapter ---

// emailNotifierAdapter adapts AWSEmailClient to the Notifier interface.
// This is the Adapter pattern — wrapping an incompatible interface.
type emailNotifierAdapter struct {
	client  *AWSEmailClient
	subject string // default subject
}

// NewEmailNotifier creates a Notifier backed by AWSEmailClient.
// External callers see only the Notifier interface — the AWS SDK is hidden.
func NewEmailNotifier(client *AWSEmailClient, subject string) Notifier {
	return &emailNotifierAdapter{client: client, subject: subject}
}

// Send adapts the Notifier.Send call to AWSEmailClient.SendEmail.
func (a *emailNotifierAdapter) Send(ctx context.Context, recipient, message string) error {
	// Check context before the (potentially slow) network call
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	return a.client.SendEmail(recipient, a.subject, message)
}

// --- Second example: adapting a legacy logger to slog ---

// LegacyLogger is a logger from an old codebase you can't change.
type LegacyLogger struct{}

func (l *LegacyLogger) Log(level, message string) {
	fmt.Printf("[%s] %s at %s\n", level, message, time.Now().Format(time.RFC3339))
}

// OurLogger is the interface your new code uses.
type OurLogger interface {
	Info(msg string)
	Warn(msg string)
	Error(msg string)
}

// legacyLoggerAdapter makes LegacyLogger work as OurLogger.
type legacyLoggerAdapter struct {
	legacy *LegacyLogger
}

func NewLegacyLoggerAdapter(l *LegacyLogger) OurLogger {
	return &legacyLoggerAdapter{legacy: l}
}

func (a *legacyLoggerAdapter) Info(msg string)  { a.legacy.Log("INFO", msg) }
func (a *legacyLoggerAdapter) Warn(msg string)  { a.legacy.Log("WARN", msg) }
func (a *legacyLoggerAdapter) Error(msg string) { a.legacy.Log("ERROR", msg) }
```

---

### Pattern 6: Decorator / Middleware (HTTP and gRPC)

**WHY**: Cross-cutting concerns — logging, authentication, rate limiting, metrics, tracing — should not live inside your business logic. The Decorator pattern wraps behavior around a core function without modifying it. In Go's HTTP ecosystem, this is called "middleware." Every production HTTP server uses this pattern. Go's `http.Handler` interface (one method: `ServeHTTP`) makes decoration trivially clean.

```go
// pattern_decorator_middleware.go
package patterns

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// --- HTTP Middleware Decorators ---

// AuthMiddleware verifies the request has a valid auth token.
// It decorates the next handler — if auth fails, the inner handler never runs.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		// Add user info to context for downstream handlers
		ctx := context.WithValue(r.Context(), "user_id", extractUserID(token))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractUserID(token string) string { return "usr_" + token[:4] }

// TimingMiddleware records request latency.
func TimingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("request %s %s took %v\n", r.Method, r.URL.Path, time.Since(start))
	})
}

// RateLimitMiddleware allows N requests per second per IP.
func RateLimitMiddleware(requestsPerSec int) func(http.Handler) http.Handler {
	// In production: use golang.org/x/time/rate or a token bucket
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Simplified — real implementation uses a rate limiter
			next.ServeHTTP(w, r)
		})
	}
}

// Chain combines multiple middleware into one.
// Execution order: first in = outermost = first to run.
// chain(A, B, C)(handler) => A(B(C(handler)))
func Chain(middlewares ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(final http.Handler) http.Handler {
		// Apply in reverse so the first middleware in the list is outermost
		for i := len(middlewares) - 1; i >= 0; i-- {
			final = middlewares[i](final)
		}
		return final
	}
}

func demonstrateMiddlewareChain() {
	myHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "hello from handler")
	})

	// Wrap handler with three layers of decoration
	// Request flows: TimingMiddleware -> RateLimitMiddleware -> AuthMiddleware -> handler
	wrapped := Chain(
		TimingMiddleware,
		RateLimitMiddleware(100),
		AuthMiddleware,
	)(myHandler)

	http.Handle("/api/", wrapped)
}

// --- Decorator for non-HTTP types ---

// Storage is an interface for key-value storage.
type Storage interface {
	Get(key string) (string, error)
	Set(key, value string) error
}

// inMemoryStorage is the base implementation.
type inMemoryStorage struct {
	data map[string]string
}

func NewInMemoryStorage() Storage {
	return &inMemoryStorage{data: make(map[string]string)}
}

func (s *inMemoryStorage) Get(key string) (string, error) {
	v, ok := s.data[key]
	if !ok {
		return "", fmt.Errorf("key %q not found", key)
	}
	return v, nil
}

func (s *inMemoryStorage) Set(key, value string) error {
	s.data[key] = value
	return nil
}

// LoggingStorage decorates Storage with logging.
// Note: this works for ANY Storage implementation — memory, Redis, DynamoDB.
// The Decorator pattern enables composition without knowing the inner type.
type LoggingStorage struct {
	inner Storage
}

func NewLoggingStorage(inner Storage) Storage {
	return &LoggingStorage{inner: inner}
}

func (s *LoggingStorage) Get(key string) (string, error) {
	start := time.Now()
	val, err := s.inner.Get(key)
	fmt.Printf("storage.Get key=%q took=%v err=%v\n", key, time.Since(start), err)
	return val, err
}

func (s *LoggingStorage) Set(key, value string) error {
	start := time.Now()
	err := s.inner.Set(key, value)
	fmt.Printf("storage.Set key=%q took=%v err=%v\n", key, time.Since(start), err)
	return err
}
```

---

### Pattern 7: Facade

**WHY**: A complex subsystem with many moving parts (database, cache, message queue, email service) should not be exposed directly to callers. A Facade provides a simple, high-level interface that hides the complexity. Callers do `orderService.PlaceOrder(...)` without knowing it touches 5 different services.

```go
// pattern_facade.go
package patterns

import (
	"context"
	"fmt"
)

// --- Complex subsystems (many moving parts) ---

type inventory struct{}

func (i *inventory) Reserve(productID string, qty int) error {
	fmt.Printf("inventory: reserved %d of %s\n", qty, productID)
	return nil
}

type payment struct{}

func (p *payment) Charge(userID, amount string) (string, error) {
	txID := "txn_" + amount
	fmt.Printf("payment: charged %s to user %s, txn=%s\n", amount, userID, txID)
	return txID, nil
}

type emailService struct{}

func (e *emailService) SendReceipt(email, orderID string) error {
	fmt.Printf("email: sent receipt for order %s to %s\n", orderID, email)
	return nil
}

type warehouse struct{}

func (w *warehouse) CreateShipment(orderID, address string) error {
	fmt.Printf("warehouse: creating shipment for order %s to %s\n", orderID, address)
	return nil
}

// --- Facade ---

// OrderResult contains the output of placing an order.
type OrderResult struct {
	OrderID       string
	TransactionID string
}

// OrderFacade provides a single, simple interface to place an order.
// Internally it coordinates: inventory check, payment, email, and warehouse.
// Callers don't know or care about the subsystems.
type OrderFacade struct {
	inventory *inventory
	payment   *payment
	email     *emailService
	warehouse *warehouse
}

func NewOrderFacade() *OrderFacade {
	return &OrderFacade{
		inventory: &inventory{},
		payment:   &payment{},
		email:     &emailService{},
		warehouse: &warehouse{},
	}
}

// PlaceOrder is the single simple method exposed to callers.
// It hides the complexity of coordinating 4 subsystems.
func (f *OrderFacade) PlaceOrder(ctx context.Context, userID, productID, amount, email, address string) (*OrderResult, error) {
	// Step 1: Reserve inventory
	if err := f.inventory.Reserve(productID, 1); err != nil {
		return nil, fmt.Errorf("reserving inventory: %w", err)
	}

	// Step 2: Process payment
	txnID, err := f.payment.Charge(userID, amount)
	if err != nil {
		// In production: roll back inventory reservation here
		return nil, fmt.Errorf("processing payment: %w", err)
	}

	orderID := "ord_" + txnID

	// Step 3: Notify warehouse (could be async in production)
	if err := f.warehouse.CreateShipment(orderID, address); err != nil {
		return nil, fmt.Errorf("creating shipment: %w", err)
	}

	// Step 4: Send email receipt (non-critical, log but don't fail)
	if err := f.email.SendReceipt(email, orderID); err != nil {
		fmt.Printf("warning: failed to send email receipt: %v\n", err)
	}

	return &OrderResult{OrderID: orderID, TransactionID: txnID}, nil
}
```

---

### Pattern 8: Proxy

**WHY**: A Proxy stands in for another object and controls access to it. Common uses: lazy initialization (don't connect to DB until first use), access control (check permissions before forwarding), caching (cache results to avoid expensive calls), remote proxies (local stub that calls a remote service). The Proxy and the real object implement the same interface — callers can't tell the difference.

```go
// pattern_proxy.go
package patterns

import (
	"fmt"
	"sync"
	"time"
)

// DataFetcher is the interface both the real object and proxy implement.
type DataFetcher interface {
	Fetch(id string) (string, error)
}

// realDataFetcher makes expensive network calls.
type realDataFetcher struct {
	endpoint string
}

func newRealDataFetcher(endpoint string) *realDataFetcher {
	return &realDataFetcher{endpoint: endpoint}
}

func (f *realDataFetcher) Fetch(id string) (string, error) {
	// Simulate slow network call
	time.Sleep(100 * time.Millisecond)
	fmt.Printf("real fetch from %s: id=%s\n", f.endpoint, id)
	return "data_for_" + id, nil
}

// cachingProxy is a Proxy that caches results from realDataFetcher.
// Callers use DataFetcher interface — they never know they're hitting a cache.
type cachingProxy struct {
	mu    sync.RWMutex
	inner DataFetcher
	cache map[string]cachedEntry
	ttl   time.Duration
}

type cachedEntry struct {
	value  string
	expiry time.Time
}

func NewCachingProxy(inner DataFetcher, ttl time.Duration) DataFetcher {
	return &cachingProxy{
		inner: inner,
		cache: make(map[string]cachedEntry),
		ttl:   ttl,
	}
}

func (p *cachingProxy) Fetch(id string) (string, error) {
	// Try cache first (read lock — allows concurrent reads)
	p.mu.RLock()
	if entry, ok := p.cache[id]; ok && time.Now().Before(entry.expiry) {
		p.mu.RUnlock()
		fmt.Printf("cache hit: id=%s\n", id)
		return entry.value, nil
	}
	p.mu.RUnlock()

	// Cache miss — fetch from real source
	value, err := p.inner.Fetch(id)
	if err != nil {
		return "", err
	}

	// Store in cache (write lock)
	p.mu.Lock()
	p.cache[id] = cachedEntry{value: value, expiry: time.Now().Add(p.ttl)}
	p.mu.Unlock()

	return value, nil
}

func demonstrateProxy() {
	real := newRealDataFetcher("https://api.example.com")
	proxy := NewCachingProxy(real, 5*time.Minute)

	// First call — hits real fetcher
	v1, _ := proxy.Fetch("user_123")
	fmt.Println(v1)

	// Second call — cache hit, instant
	v2, _ := proxy.Fetch("user_123")
	fmt.Println(v2)
}
```

---

## Part 3: Behavioral Patterns

Behavioral patterns define how objects communicate and distribute responsibility.

---

### Pattern 9: Observer with Channels

**WHY**: When one event should trigger actions in multiple independent parts of the system, the Observer pattern decouples the event producer from the consumers. Naively, the producer would need to know about and call every consumer — tight coupling. With Observer, the producer just broadcasts; consumers subscribe. In Go, channels are first-class observers.

```go
// pattern_observer.go
package patterns

import (
	"fmt"
	"sync"
)

// Event represents something that happened in the system.
type Event struct {
	Type    string
	Payload interface{}
}

// EventBus is a pub/sub event bus using channels.
// Publishers emit events; subscribers receive them.
// Subscribers are decoupled from publishers — neither knows about the other.
type EventBus struct {
	mu          sync.RWMutex
	subscribers map[string][]chan Event
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string][]chan Event),
	}
}

// Subscribe creates a channel that receives events of the given type.
// Returns a channel and an unsubscribe function.
// Buffer size prevents slow consumers from blocking publishers.
func (eb *EventBus) Subscribe(eventType string, bufferSize int) (<-chan Event, func()) {
	ch := make(chan Event, bufferSize)

	eb.mu.Lock()
	eb.subscribers[eventType] = append(eb.subscribers[eventType], ch)
	eb.mu.Unlock()

	// Unsubscribe function — call this when the subscriber is done
	unsubscribe := func() {
		eb.mu.Lock()
		defer eb.mu.Unlock()
		subs := eb.subscribers[eventType]
		for i, sub := range subs {
			if sub == ch {
				eb.subscribers[eventType] = append(subs[:i], subs[i+1:]...)
				close(ch)
				break
			}
		}
	}

	return ch, unsubscribe
}

// Publish sends an event to all subscribers.
// Uses non-blocking send — slow subscribers drop events rather than block publishers.
// For guaranteed delivery, use a persistent queue (Kafka, SQS).
func (eb *EventBus) Publish(event Event) {
	eb.mu.RLock()
	subs := eb.subscribers[event.Type]
	eb.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- event:
		default:
			fmt.Printf("warning: subscriber channel full for event type %s, dropping event\n", event.Type)
		}
	}
}

func demonstrateObserver() {
	bus := NewEventBus()

	// Subscribe to "user.created" events
	emailCh, unsubEmail := bus.Subscribe("user.created", 10)
	auditCh, unsubAudit := bus.Subscribe("user.created", 10)
	defer unsubEmail()
	defer unsubAudit()

	var wg sync.WaitGroup

	// Email service: sends welcome email when user is created
	wg.Add(1)
	go func() {
		defer wg.Done()
		for event := range emailCh {
			fmt.Printf("email service: sending welcome email to %v\n", event.Payload)
		}
	}()

	// Audit service: logs user creation
	wg.Add(1)
	go func() {
		defer wg.Done()
		for event := range auditCh {
			fmt.Printf("audit service: logged user creation %v\n", event.Payload)
		}
	}()

	// Publisher — knows nothing about email or audit services
	bus.Publish(Event{Type: "user.created", Payload: "alice@example.com"})
	bus.Publish(Event{Type: "user.created", Payload: "bob@example.com"})

	// Unsubscribe closes channels, goroutines exit
	unsubEmail()
	unsubAudit()
	wg.Wait()
}
```

---

### Pattern 10: Strategy with Function Values

**WHY**: The Strategy pattern allows swapping algorithms at runtime without changing the code that uses them. Classic OOP requires an abstract Strategy class with concrete subclasses. In Go, a function is a first-class value — a Strategy is just a `func`. This is dramatically simpler than Java's approach of creating a new interface and multiple implementing types for every variation.

```go
// pattern_strategy.go
package patterns

import (
	"fmt"
	"sort"
)

// SortStrategy is a function type — the Strategy interface.
// Any function matching this signature IS a strategy, with no boilerplate.
type SortStrategy func(data []int)

// BubbleSort is a concrete strategy.
func BubbleSort(data []int) {
	n := len(data)
	for i := 0; i < n-1; i++ {
		for j := 0; j < n-i-1; j++ {
			if data[j] > data[j+1] {
				data[j], data[j+1] = data[j+1], data[j]
			}
		}
	}
}

// QuickSort is another concrete strategy.
func QuickSort(data []int) {
	sort.Ints(data) // stdlib quicksort
}

// MergeSort is a third concrete strategy.
func MergeSort(data []int) {
	// Simplified: use stdlib for illustration
	sort.Stable(sort.IntSlice(data))
}

// DataProcessor uses a SortStrategy — the algorithm is injected, not hardcoded.
type DataProcessor struct {
	sortStrategy SortStrategy
}

func NewDataProcessor(strategy SortStrategy) *DataProcessor {
	return &DataProcessor{sortStrategy: strategy}
}

// SetStrategy allows changing the strategy at runtime.
func (p *DataProcessor) SetStrategy(strategy SortStrategy) {
	p.sortStrategy = strategy
}

func (p *DataProcessor) Process(data []int) []int {
	result := make([]int, len(data))
	copy(result, data)
	p.sortStrategy(result)
	return result
}

// More practical example: pricing strategies in an e-commerce system
type PriceStrategy func(basePrice float64) float64

func RegularPrice(base float64) float64      { return base }
func MemberDiscount(base float64) float64    { return base * 0.9 }   // 10% off
func FlashSaleDiscount(base float64) float64 { return base * 0.7 }   // 30% off
func BulkDiscount(base float64) float64      { return base * 0.85 }  // 15% off for bulk
func FreeItem(_ float64) float64             { return 0 }             // promotional free item

type ShoppingCart struct {
	pricing PriceStrategy
}

func NewShoppingCart(pricing PriceStrategy) *ShoppingCart {
	return &ShoppingCart{pricing: pricing}
}

func (c *ShoppingCart) CalculateTotal(items []float64) float64 {
	var total float64
	for _, item := range items {
		total += c.pricing(item)
	}
	return total
}

func demonstrateStrategy() {
	items := []float64{10.0, 25.0, 5.0, 40.0}

	regular := NewShoppingCart(RegularPrice)
	member := NewShoppingCart(MemberDiscount)
	sale := NewShoppingCart(FlashSaleDiscount)

	fmt.Printf("Regular: $%.2f\n", regular.CalculateTotal(items))
	fmt.Printf("Member:  $%.2f\n", member.CalculateTotal(items))
	fmt.Printf("Sale:    $%.2f\n", sale.CalculateTotal(items))

	// Strategy can be an anonymous function for one-off customizations
	custom := NewShoppingCart(func(base float64) float64 {
		if base > 20 {
			return base * 0.8 // 20% off items over $20
		}
		return base
	})
	fmt.Printf("Custom:  $%.2f\n", custom.CalculateTotal(items))
}
```

---

### Pattern 11: Command

**WHY**: The Command pattern encapsulates a request as an object. This enables: undo/redo, queuing operations, logging commands, transactional batches. In Go, a Command is typically a struct with an `Execute() error` method, or simply a `func() error` value stored in a slice.

```go
// pattern_command.go
package patterns

import (
	"fmt"
	"strings"
)

// Command is the command interface.
type Command interface {
	Execute() error
	Undo() error
	Description() string
}

// TextEditor is the receiver — the object that commands act on.
type TextEditor struct {
	content strings.Builder
}

func (e *TextEditor) Content() string { return e.content.String() }

// --- Concrete Commands ---

// AppendCommand appends text to the editor.
type AppendCommand struct {
	editor *TextEditor
	text   string
}

func NewAppendCommand(editor *TextEditor, text string) Command {
	return &AppendCommand{editor: editor, text: text}
}

func (c *AppendCommand) Execute() error {
	c.editor.content.WriteString(c.text)
	return nil
}

func (c *AppendCommand) Undo() error {
	current := c.editor.content.String()
	if len(current) >= len(c.text) {
		c.editor.content.Reset()
		c.editor.content.WriteString(current[:len(current)-len(c.text)])
	}
	return nil
}

func (c *AppendCommand) Description() string {
	return fmt.Sprintf("Append(%q)", c.text)
}

// --- Command History (enables undo/redo) ---

// CommandHistory tracks executed commands for undo support.
type CommandHistory struct {
	history []Command
}

func (h *CommandHistory) Execute(cmd Command) error {
	if err := cmd.Execute(); err != nil {
		return err
	}
	h.history = append(h.history, cmd)
	return nil
}

func (h *CommandHistory) Undo() error {
	if len(h.history) == 0 {
		return fmt.Errorf("nothing to undo")
	}
	last := h.history[len(h.history)-1]
	h.history = h.history[:len(h.history)-1]
	return last.Undo()
}

func (h *CommandHistory) Log() {
	for i, cmd := range h.history {
		fmt.Printf("  [%d] %s\n", i, cmd.Description())
	}
}

func demonstrateCommand() {
	editor := &TextEditor{}
	history := &CommandHistory{}

	history.Execute(NewAppendCommand(editor, "Hello"))
	history.Execute(NewAppendCommand(editor, ", World"))
	history.Execute(NewAppendCommand(editor, "!"))

	fmt.Println("Content:", editor.Content()) // Hello, World!
	fmt.Println("History:")
	history.Log()

	history.Undo()
	fmt.Println("After undo:", editor.Content()) // Hello, World
}
```

---

### Pattern 12: Template Method via Embedding

**WHY**: Template Method defines the skeleton of an algorithm, letting subclasses override specific steps. In Java, you extend an abstract class and override hook methods. In Go, you use struct embedding plus interface composition — no inheritance needed. The template calls interface methods; concrete types override those methods by implementing the interface.

```go
// pattern_template_method.go
package patterns

import (
	"fmt"
	"time"
)

// ReportGenerator defines the template: the fixed steps of generating a report.
// Specific report types override only the steps that differ.
type ReportGenerator struct {
	// Hook: concrete types provide their own data fetching and formatting.
	fetcher   func() ([]string, error)
	formatter func(data []string) string
	title     string
}

func NewReportGenerator(title string, fetcher func() ([]string, error), formatter func([]string) string) *ReportGenerator {
	return &ReportGenerator{
		fetcher:   fetcher,
		formatter: formatter,
		title:     title,
	}
}

// Generate is the template method — the algorithm skeleton.
// Steps 1 and 4 are fixed; steps 2 and 3 are overridable hooks.
func (g *ReportGenerator) Generate() (string, error) {
	// Step 1 (fixed): log start time
	start := time.Now()
	fmt.Printf("generating report: %s\n", g.title)

	// Step 2 (hook): fetch data — concrete types customize this
	data, err := g.fetcher()
	if err != nil {
		return "", fmt.Errorf("fetching data: %w", err)
	}

	// Step 3 (hook): format the report — concrete types customize this
	report := g.formatter(data)

	// Step 4 (fixed): log completion time
	fmt.Printf("report generated in %v\n", time.Since(start))

	return report, nil
}

func demonstrateTemplateMethod() {
	// CSV report: same template, different data source and format
	csvReport := NewReportGenerator(
		"Sales CSV",
		func() ([]string, error) {
			return []string{"Alice,100", "Bob,200", "Carol,150"}, nil
		},
		func(data []string) string {
			return "name,amount\n" + joinLines(data)
		},
	)

	// HTML report: same template, different format
	htmlReport := NewReportGenerator(
		"Sales HTML",
		func() ([]string, error) {
			return []string{"Alice: $100", "Bob: $200"}, nil
		},
		func(data []string) string {
			rows := ""
			for _, d := range data {
				rows += "<tr><td>" + d + "</td></tr>"
			}
			return "<table>" + rows + "</table>"
		},
	)

	for _, gen := range []*ReportGenerator{csvReport, htmlReport} {
		out, err := gen.Generate()
		if err != nil {
			fmt.Println("error:", err)
			continue
		}
		fmt.Println(out)
	}
}

func joinLines(lines []string) string {
	result := ""
	for _, l := range lines {
		result += l + "\n"
	}
	return result
}
```

---

## Part 4: Go-Specific Patterns

These patterns are unique to Go or much cleaner in Go than in other languages.

---

### Pattern 13: Error Wrapping and Sentinel Errors

**WHY**: Go uses explicit error returns instead of exceptions. Without conventions, error handling becomes a mess of `if err != nil { return err }` that loses context. The error wrapping pattern (Go 1.13+) creates error chains: each layer adds context without losing the original error. `errors.Is` and `errors.As` allow callers to inspect the error chain.

```go
// pattern_error_wrapping.go
package patterns

import (
	"errors"
	"fmt"
)

// --- Sentinel errors: named errors for known failure modes ---

// ErrNotFound indicates a resource does not exist.
// Callers can check: errors.Is(err, ErrNotFound)
var (
	ErrNotFound      = errors.New("not found")
	ErrUnauthorized  = errors.New("unauthorized")
	ErrAlreadyExists = errors.New("already exists")
)

// --- Custom error types: when you need to carry extra data ---

// ValidationError carries field-level validation details.
// Callers can use errors.As to extract the specific field information.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("validation error: field %q: %s", e.Field, e.Message)
}

// --- Error wrapping in action ---

type UserRepository struct{}

func (r *UserRepository) FindByEmail(email string) (*User, error) {
	if email == "" {
		return nil, &ValidationError{Field: "email", Message: "cannot be empty"}
	}
	if email == "banned@example.com" {
		return nil, ErrUnauthorized
	}
	// Simulate not found
	return nil, fmt.Errorf("querying database for %q: %w", email, ErrNotFound)
}

type UserService2 struct {
	repo *UserRepository
}

func (s *UserService2) GetUserByEmail(email string) (*User, error) {
	user, err := s.repo.FindByEmail(email)
	if err != nil {
		// %w wraps the error — the original error is still accessible via errors.Is/As
		// This adds context (which operation failed) without losing the original error type
		return nil, fmt.Errorf("UserService.GetUserByEmail(%q): %w", email, err)
	}
	return user, nil
}

func demonstrateErrorWrapping() {
	svc := &UserService2{repo: &UserRepository{}}

	_, err := svc.GetUserByEmail("")
	if err != nil {
		// Check for specific error types anywhere in the chain
		var valErr *ValidationError
		if errors.As(err, &valErr) {
			fmt.Printf("validation failed: field=%s msg=%s\n", valErr.Field, valErr.Message)
		}
	}

	_, err = svc.GetUserByEmail("notexist@example.com")
	if err != nil {
		// errors.Is unwraps the chain — finds ErrNotFound even though it's wrapped
		if errors.Is(err, ErrNotFound) {
			fmt.Println("user not found — show 404 page")
		}
		fmt.Printf("full error chain: %v\n", err)
		// Output: full error chain: UserService.GetUserByEmail("notexist@example.com"):
		//         querying database for "notexist@example.com": not found
	}
}
```

---

### Pattern 14: Table-Driven Tests

**WHY**: In Go, tests are code. Table-driven tests are the Go community's most important testing pattern. Instead of writing one test function per case (resulting in copy-pasted boilerplate), you define a table of test cases as a slice of structs and range over them. This is how the Go standard library tests are written.

```go
// pattern_table_driven_test.go
package patterns

import (
	"errors"
	"testing"
)

// Function under test
func Divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, fmt.Errorf("division by zero: %w", errors.New("invalid operand"))
	}
	return a / b, nil
}

func TestDivide(t *testing.T) {
	// Table: each row is one test case.
	// Adding a new case = adding one row to the table.
	// No new test functions, no copy-paste.
	tests := []struct {
		name    string  // test case name — shown in output on failure
		a, b    float64
		want    float64
		wantErr bool    // true if we expect an error
	}{
		{
			name: "positive numbers",
			a:    10, b: 2,
			want: 5,
		},
		{
			name: "negative dividend",
			a:    -10, b: 2,
			want: -5,
		},
		{
			name: "fractional result",
			a:    1, b: 3,
			want: 0.3333333333333333,
		},
		{
			name:    "division by zero",
			a:       10, b: 0,
			wantErr: true,
		},
		{
			name: "both zero",
			a:    0, b: 1,
			want: 0,
		},
	}

	for _, tt := range tests {
		// t.Run creates a sub-test — each case has its own name and can be run individually
		t.Run(tt.name, func(t *testing.T) {
			// t.Parallel() can be added here to run cases concurrently
			got, err := Divide(tt.a, tt.b)

			if (err != nil) != tt.wantErr {
				t.Errorf("Divide(%v, %v): got error %v, wantErr %v", tt.a, tt.b, err, tt.wantErr)
				return
			}

			if !tt.wantErr && got != tt.want {
				t.Errorf("Divide(%v, %v): got %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}
```

**PITFALL**: Not naming your test cases (`name: ""`) — when a test fails, you see `--- FAIL: TestDivide/` with no description. Always name every test case.

---

### Summary: Pattern Selection Guide

| Problem | Pattern | Go Approach |
|---|---|---|
| Need exactly one instance | Singleton | `sync.Once` |
| Creating objects without specifying concrete type | Factory | Function returning interface |
| Many optional constructor parameters | Builder | Functional Options (`...Option`) |
| Clone an existing object | Prototype | Deep copy method |
| Incompatible interfaces | Adapter | Struct wrapping the foreign type |
| Add behavior without modifying type | Decorator | Struct wrapping the interface |
| Simplify a complex subsystem | Facade | Single struct with high-level methods |
| Control access to an object | Proxy | Struct implementing same interface |
| Multiple independent reactions to one event | Observer | Channels + goroutines |
| Swap algorithms at runtime | Strategy | `func` type values |
| Encapsulate requests for undo/queue | Command | Struct with `Execute() error` |
| Fixed algorithm, variable steps | Template Method | Struct embedding + `func` fields |
| Rich error context | Error wrapping | `fmt.Errorf("context: %w", err)` |
| Multiple test scenarios | Table-Driven | Slice of structs + `t.Run` |
