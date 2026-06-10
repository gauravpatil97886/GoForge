# Functional Patterns in Go

## What Is This?

Functional patterns in Go are design techniques borrowed from functional programming — immutability, higher-order functions, composable option types — adapted to Go's imperative, statically-typed style. They allow you to write APIs and data pipelines that are predictable, testable, and extensible without sacrificing Go's simplicity. These are not "FP in Go" as a philosophical statement — they are practical, production-proven patterns used in the most important Go libraries.

## Why Does It Exist?

Go's struct-based APIs had a recurring problem: how do you add optional configuration to a function or constructor without breaking existing callers? Java uses Builder classes with 30 setter methods. Python uses `**kwargs`. Neither fits Go's explicit, type-safe style. Dave Cheney's 2014 blog post "Functional options for friendly APIs" — inspired by Rob Pike's earlier pattern — solved this by making configuration a slice of functions. Meanwhile, generics (Go 1.18) finally made Map/Filter/Reduce expressible without `interface{}` boxing. The result is a set of patterns that solve real API design problems Go developers faced at scale.

## Who Uses This in Industry?

- **Google / gRPC**: The `google.golang.org/grpc` package uses the Functional Options pattern extensively. `grpc.Dial(addr, grpc.WithInsecure(), grpc.WithBlock(), grpc.WithTimeout(5*time.Second))` — each `With*` function is an `Option` — callers compose the behavior they need without modifying any function signature.
- **Uber / Zap logger**: `zap.NewProduction(zap.WithCaller(true), zap.AddStacktrace(zap.ErrorLevel))` — the entire zap logger configuration API is Functional Options. Adding new configuration never breaks existing callers. Uber's entire observability stack is built on this pattern.
- **Cloudflare**: Their `cloudflare-go` SDK uses method-chaining Builder pattern for API request construction — `client.ZoneList().WithName("example.com").WithStatus("active")`. The builder accumulates parameters and validates them before executing.
- **Kubernetes / controller-runtime**: The operator SDK's reconciler setup uses functional options for configuring watch predicates, rate limiters, and max concurrent reconciles. This allows new configuration knobs to be added without breaking the hundreds of existing controllers.
- **Docker**: The `moby/moby` codebase uses pipeline patterns (channel-based) for image build stages — each stage (parse Dockerfile, fetch layers, execute RUN commands, commit) is a function that takes a stream and produces a stream with error propagation built in.

## Industry Standards & Best Practices

**What senior Go engineers do:**
- Use Functional Options for any constructor that has more than 2-3 optional parameters
- Never add a new positional parameter to a widely-used constructor — use `WithXxx` option instead
- Use the Builder pattern when the construction process is multi-step and order matters
- Copy slices/maps in constructors when creating "immutable" value objects — prevent aliasing bugs
- Use generics for Map/Filter/Reduce instead of `interface{}` — maintain type safety
- Validate all options at construction time, not at use time
- Document the zero value behavior: what does the type do with no options set?

**What beginners do:**
- Add a new boolean/int parameter to an existing function — breaks all callers
- Create a `Config` struct with 20 exported fields and document "set these before calling Init()"
- Use `interface{}` slices for generic collection operations — no type safety
- Mutate shared state in pipeline stages — creates data races
- Return concrete types from builders instead of interfaces — prevents mocking

## Why Go's Approach Is Unique

Go has no default parameter values (by design — the spec explicitly excludes them). It has no method overloading. It has no named arguments. These constraints make functional patterns MORE important in Go than in other languages, because they're often the only clean way to solve the "optional configuration" problem.

| Aspect | Go | Java | Python | Node.js |
|--------|----|----|--------|---------|
| Optional params | Functional Options (pattern) | Method overloading / Builder | `**kwargs` | Destructuring default objects |
| Generics | Since 1.18 (type params) | Since Java 5 | Duck-typed (no generics) | TypeScript generics |
| Immutability | By convention (copy) | `final`, immutable libraries | Tuples, `frozen`, `@dataclass(frozen=True)` | `Object.freeze()`, `readonly` |
| First-class functions | Yes (closures, function types) | Lambda (since Java 8) | First-class | First-class |
| Pipelines | Channels + goroutines | Stream API (Java 8+) | Generator chains | async iterators |

Go's key tradeoff: functional patterns require explicit discipline (you must copy to get immutability, you must define the option type) whereas Haskell/Rust enforce these at the type system level. Go chooses simplicity + explicitness over compile-time guarantees.

---

## Part 1: Functional Options Pattern

### Why functional options: the API evolution problem

Imagine you ship `NewServer(addr string, timeout time.Duration)`. Six months later, you need TLS, max connections, and a custom logger. You cannot add parameters without breaking every existing caller. The options pattern solves this permanently: the signature becomes `NewServer(addr string, opts ...Option)` and new options are additive — existing callers are never broken.

```go
package main

import (
	"fmt"
	"log"
	"net"
	"time"
)

// --- Example 1: Basic Functional Options ---

// Config holds all the server's configurable behavior.
// Never exported directly — options functions are the API.
type serverConfig struct {
	readTimeout    time.Duration
	writeTimeout   time.Duration
	maxConnections int
	idleTimeout    time.Duration
	logger         *log.Logger
	tlsCertFile    string
	tlsKeyFile     string
}

// defaultConfig returns the sensible defaults.
// This is critical — callers should get working behavior with zero options.
func defaultConfig() serverConfig {
	return serverConfig{
		readTimeout:    30 * time.Second,
		writeTimeout:   30 * time.Second,
		maxConnections: 1000,
		idleTimeout:    60 * time.Second,
		logger:         log.Default(),
	}
}

// Option is a function that modifies a serverConfig.
// This is the core type of the pattern.
type Option func(*serverConfig)

// --- Option constructors: each returns an Option function ---

// WithReadTimeout sets the read timeout. Default: 30s
func WithReadTimeout(d time.Duration) Option {
	return func(c *serverConfig) {
		c.readTimeout = d
	}
}

// WithWriteTimeout sets the write timeout. Default: 30s
func WithWriteTimeout(d time.Duration) Option {
	return func(c *serverConfig) {
		c.writeTimeout = d
	}
}

// WithMaxConnections sets the maximum simultaneous connections. Default: 1000
func WithMaxConnections(n int) Option {
	return func(c *serverConfig) {
		c.maxConnections = n
	}
}

// WithLogger sets a custom logger. Default: log.Default()
func WithLogger(l *log.Logger) Option {
	return func(c *serverConfig) {
		c.logger = l
	}
}

// WithTLS enables TLS using the provided certificate and key files.
func WithTLS(certFile, keyFile string) Option {
	return func(c *serverConfig) {
		c.tlsCertFile = certFile
		c.tlsKeyFile = keyFile
	}
}

// Server is the server type.
type Server struct {
	addr   string
	config serverConfig
	ln     net.Listener
}

// NewServer creates a Server. opts are applied in order over the defaults.
// Adding new options NEVER breaks existing callers — this is the key promise.
func NewServer(addr string, opts ...Option) (*Server, error) {
	cfg := defaultConfig() // start from sensible defaults

	// Apply each option in order — later options override earlier ones
	for _, opt := range opts {
		opt(&cfg)
	}

	// Validate after applying all options
	if cfg.readTimeout <= 0 {
		return nil, fmt.Errorf("readTimeout must be positive")
	}
	if cfg.maxConnections <= 0 {
		return nil, fmt.Errorf("maxConnections must be positive")
	}
	if (cfg.tlsCertFile == "") != (cfg.tlsKeyFile == "") {
		return nil, fmt.Errorf("WithTLS requires both certFile and keyFile")
	}

	return &Server{addr: addr, config: cfg}, nil
}

func (s *Server) Addr() string { return s.addr }
func (s *Server) Config() serverConfig { return s.config }

func main() {
	// --- Minimal usage: use all defaults ---
	s1, err := NewServer(":8080")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Server 1: addr=%s timeout=%v maxConn=%d\n",
		s1.Addr(), s1.Config().readTimeout, s1.Config().maxConnections)

	// --- Production usage: override specific settings ---
	s2, err := NewServer(":443",
		WithReadTimeout(10*time.Second),
		WithWriteTimeout(10*time.Second),
		WithMaxConnections(5000),
		WithTLS("/etc/ssl/cert.pem", "/etc/ssl/key.pem"),
	)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Server 2: addr=%s timeout=%v maxConn=%d tls=%v\n",
		s2.Addr(), s2.Config().readTimeout, s2.Config().maxConnections,
		s2.Config().tlsCertFile != "")

	// --- Options can be stored and reused ---
	productionOptions := []Option{
		WithReadTimeout(10 * time.Second),
		WithMaxConnections(10000),
	}
	s3, _ := NewServer(":9090", productionOptions...)
	fmt.Printf("Server 3: timeout=%v maxConn=%d\n",
		s3.Config().readTimeout, s3.Config().maxConnections)
}
```

**Common pitfalls:**
- Not providing defaults: callers who pass no options get a zero-value struct — this is usually broken behavior
- Validating inside option functions (not in the constructor): validation runs on incomplete state
- Making `Option` a method (not a function type): harder to compose, can't be stored in slices

---

## Part 2: Pipeline with Error Propagation

### Why pipelines: staged data processing at scale

A pipeline transforms data through a series of stages, where each stage reads from its input, processes, and writes to its output. When a stage fails, the error propagates downstream and all stages shut down cleanly. This is how Cloudflare processes DNS queries, how Docker builds images, and how data ingestion systems work at scale.

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// --- Example 2: Type-safe pipeline stages ---

// Stage is a function that transforms T -> U, potentially failing with an error.
// Stages are composable — the output type of one must match the input of the next.
type Stage[T, U any] func(ctx context.Context, input T) (U, error)

// Pipeline chains two stages together. If stage1 fails, stage2 is never called.
func Pipeline[T, U, V any](
	stage1 Stage[T, U],
	stage2 Stage[U, V],
) Stage[T, V] {
	return func(ctx context.Context, input T) (V, error) {
		var zero V
		if err := ctx.Err(); err != nil {
			return zero, fmt.Errorf("pipeline: context: %w", err)
		}
		mid, err := stage1(ctx, input)
		if err != nil {
			return zero, fmt.Errorf("stage1: %w", err)
		}
		result, err := stage2(ctx, mid)
		if err != nil {
			return zero, fmt.Errorf("stage2: %w", err)
		}
		return result, nil
	}
}

// --- Example 3: Channel-based pipeline for streaming data ---

type Record struct {
	ID   int
	Data string
}

type ProcessedRecord struct {
	ID     int
	Words  []string
	Length int
}

// parseRecord is stage 1: validates and normalizes raw strings
func parseRecord(ctx context.Context, raw string) (Record, error) {
	if strings.TrimSpace(raw) == "" {
		return Record{}, errors.New("empty record")
	}
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 {
		return Record{}, fmt.Errorf("invalid format, expected 'id:data', got %q", raw)
	}
	var id int
	if _, err := fmt.Sscan(parts[0], &id); err != nil {
		return Record{}, fmt.Errorf("parse id: %w", err)
	}
	return Record{ID: id, Data: strings.TrimSpace(parts[1])}, nil
}

// processRecord is stage 2: transforms a Record into a ProcessedRecord
func processRecord(ctx context.Context, r Record) (ProcessedRecord, error) {
	if r.Data == "" {
		return ProcessedRecord{}, fmt.Errorf("record %d: empty data", r.ID)
	}
	words := strings.Fields(r.Data)
	return ProcessedRecord{
		ID:     r.ID,
		Words:  words,
		Length: len(r.Data),
	}, nil
}

// --- Channel-based streaming pipeline ---
// Each stage runs in a goroutine, processing items concurrently.

// generate feeds raw strings into the pipeline
func generate(ctx context.Context, inputs []string) (<-chan string, <-chan error) {
	out := make(chan string)
	errc := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errc)
		for _, input := range inputs {
			select {
			case <-ctx.Done():
				errc <- ctx.Err()
				return
			case out <- input:
			}
		}
	}()

	return out, errc
}

// parseStage reads strings, parses them into Records
func parseStage(ctx context.Context, in <-chan string) (<-chan Record, <-chan error) {
	out := make(chan Record)
	errc := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errc)
		for raw := range in {
			r, err := parseRecord(ctx, raw)
			if err != nil {
				errc <- fmt.Errorf("parse stage: %w", err)
				return
			}
			select {
			case <-ctx.Done():
				errc <- ctx.Err()
				return
			case out <- r:
			}
		}
	}()

	return out, errc
}

// processStage reads Records, transforms them into ProcessedRecords
func processStage(ctx context.Context, in <-chan Record) (<-chan ProcessedRecord, <-chan error) {
	out := make(chan ProcessedRecord)
	errc := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errc)
		for r := range in {
			pr, err := processRecord(ctx, r)
			if err != nil {
				errc <- fmt.Errorf("process stage: %w", err)
				return
			}
			select {
			case <-ctx.Done():
				errc <- ctx.Err()
				return
			case out <- pr:
			}
		}
	}()

	return out, errc
}

func main() {
	ctx := context.Background()

	// --- Functional stage composition ---
	fullPipeline := Pipeline(
		Stage[string, Record](parseRecord),
		Stage[Record, ProcessedRecord](processRecord),
	)

	result, err := fullPipeline(ctx, "42:hello world from Go")
	if err != nil {
		fmt.Println("Pipeline error:", err)
	} else {
		fmt.Printf("Result: ID=%d Words=%v Length=%d\n", result.ID, result.Words, result.Length)
	}

	// Error propagation: stage1 fails, stage2 never runs
	_, err = fullPipeline(ctx, "not-valid")
	fmt.Println("Expected error:", err)

	// --- Channel-based streaming pipeline ---
	inputs := []string{
		"1:hello world",
		"2:functional patterns in Go",
		"3:pipeline with error propagation",
	}

	rawCh, genErr := generate(ctx, inputs)
	recordCh, parseErr := parseStage(ctx, rawCh)
	resultCh, procErr := processStage(ctx, recordCh)

	// Collect results
	var results []ProcessedRecord
	for pr := range resultCh {
		results = append(results, pr)
	}

	// Check errors from all stages
	for _, errc := range []<-chan error{genErr, parseErr, procErr} {
		if err := <-errc; err != nil {
			fmt.Println("Pipeline error:", err)
			break
		}
	}

	for _, r := range results {
		fmt.Printf("ID=%d words=%d length=%d\n", r.ID, len(r.Words), r.Length)
	}
}
```

---

## Part 3: Map, Filter, Reduce with Generics

### Why generics for collections

Before Go 1.18, every "generic" collection operation required either code generation (`go generate`), reflection (slow, no type safety), or `interface{}` everywhere (runtime panics). Generics make Map/Filter/Reduce first-class operations that the compiler type-checks. You write less boilerplate, catch more errors at compile time.

```go
package main

import (
	"fmt"
	"strings"
)

// --- Example 4: Type-safe Map/Filter/Reduce ---

// Map applies f to each element, returning a new slice.
// The result type U can be different from the input type T.
func Map[T, U any](slice []T, f func(T) U) []U {
	result := make([]U, len(slice))
	for i, v := range slice {
		result[i] = f(v)
	}
	return result
}

// Filter returns elements for which predicate returns true.
func Filter[T any](slice []T, predicate func(T) bool) []T {
	var result []T
	for _, v := range slice {
		if predicate(v) {
			result = append(result, v)
		}
	}
	return result
}

// Reduce collapses a slice to a single value by applying f iteratively.
// initial is the starting accumulator value.
func Reduce[T, U any](slice []T, initial U, f func(U, T) U) U {
	acc := initial
	for _, v := range slice {
		acc = f(acc, v)
	}
	return acc
}

// FlatMap maps each element to a slice, then flattens all slices into one.
func FlatMap[T, U any](slice []T, f func(T) []U) []U {
	var result []U
	for _, v := range slice {
		result = append(result, f(v)...)
	}
	return result
}

// Partition splits a slice into two: elements where predicate is true, and where false.
func Partition[T any](slice []T, predicate func(T) bool) (trueSlice, falseSlice []T) {
	for _, v := range slice {
		if predicate(v) {
			trueSlice = append(trueSlice, v)
		} else {
			falseSlice = append(falseSlice, v)
		}
	}
	return
}

// GroupBy groups elements by a key function.
func GroupBy[T any, K comparable](slice []T, key func(T) K) map[K][]T {
	result := make(map[K][]T)
	for _, v := range slice {
		k := key(v)
		result[k] = append(result[k], v)
	}
	return result
}

// --- Example 5: Practical usage ---

type Product struct {
	Name     string
	Category string
	Price    float64
	InStock  bool
}

func main() {
	products := []Product{
		{Name: "Laptop", Category: "electronics", Price: 999.99, InStock: true},
		{Name: "Phone", Category: "electronics", Price: 699.99, InStock: false},
		{Name: "Shirt", Category: "clothing", Price: 29.99, InStock: true},
		{Name: "Pants", Category: "clothing", Price: 49.99, InStock: true},
		{Name: "Headphones", Category: "electronics", Price: 199.99, InStock: true},
		{Name: "Jacket", Category: "clothing", Price: 89.99, InStock: false},
	}

	// --- Filter: only in-stock products ---
	inStock := Filter(products, func(p Product) bool { return p.InStock })
	fmt.Printf("In stock: %d products\n", len(inStock))

	// --- Map: extract names ---
	names := Map(inStock, func(p Product) string { return p.Name })
	fmt.Println("In-stock names:", strings.Join(names, ", "))

	// --- Reduce: total value of in-stock inventory ---
	totalValue := Reduce(inStock, 0.0, func(acc float64, p Product) float64 {
		return acc + p.Price
	})
	fmt.Printf("Total in-stock value: $%.2f\n", totalValue)

	// --- Chain: in-stock electronics under $500 ---
	affordable := Filter(
		Filter(products, func(p Product) bool { return p.InStock }),
		func(p Product) bool {
			return p.Category == "electronics" && p.Price < 500
		},
	)
	fmt.Printf("Affordable electronics in stock: %d\n", len(affordable))

	// --- GroupBy: organize by category ---
	byCategory := GroupBy(products, func(p Product) string { return p.Category })
	for cat, prods := range byCategory {
		catNames := Map(prods, func(p Product) string { return p.Name })
		fmt.Printf("  %s: %s\n", cat, strings.Join(catNames, ", "))
	}

	// --- Partition: split into in-stock / out-of-stock ---
	available, unavailable := Partition(products, func(p Product) bool { return p.InStock })
	fmt.Printf("Available: %d, Unavailable: %d\n", len(available), len(unavailable))

	// --- FlatMap: get all words from all product names ---
	words := FlatMap(products, func(p Product) []string {
		return strings.Fields(p.Name)
	})
	fmt.Printf("All name words: %v\n", words)
}
```

---

## Part 4: Option/Maybe Type in Go

### Why Option types: nil pointer discipline

`nil` pointer dereferences are Go's most common runtime panic. The Option type (inspired by Rust's `Option<T>` and Haskell's `Maybe`) forces callers to explicitly handle the "absent" case at compile time, rather than discovering it as a panic at runtime.

```go
package main

import (
	"errors"
	"fmt"
)

// --- Example 6: Option type ---

// Option[T] represents a value that may or may not be present.
// It forces callers to explicitly handle both cases.
type Option[T any] struct {
	value    T
	hasValue bool
}

// Some wraps a present value.
func Some[T any](v T) Option[T] {
	return Option[T]{value: v, hasValue: true}
}

// None represents the absence of a value.
func None[T any]() Option[T] {
	return Option[T]{}
}

// IsSome returns true if a value is present.
func (o Option[T]) IsSome() bool { return o.hasValue }

// IsNone returns true if no value is present.
func (o Option[T]) IsNone() bool { return !o.hasValue }

// Unwrap returns the value or panics if none — use only when you're certain.
func (o Option[T]) Unwrap() T {
	if !o.hasValue {
		panic("Option.Unwrap: called on None")
	}
	return o.value
}

// UnwrapOr returns the value, or def if none.
func (o Option[T]) UnwrapOr(def T) T {
	if o.hasValue {
		return o.value
	}
	return def
}

// UnwrapOrElse returns the value, or calls f() if none.
func (o Option[T]) UnwrapOrElse(f func() T) T {
	if o.hasValue {
		return o.value
	}
	return f()
}

// Map applies f if Some, returns None if None.
func OptionMap[T, U any](o Option[T], f func(T) U) Option[U] {
	if o.IsNone() {
		return None[U]()
	}
	return Some(f(o.value))
}

// FlatMap (also called AndThen) applies f if Some; f itself returns Option[U].
func OptionFlatMap[T, U any](o Option[T], f func(T) Option[U]) Option[U] {
	if o.IsNone() {
		return None[U]()
	}
	return f(o.value)
}

// ToError converts an Option to a (value, error) pair.
func (o Option[T]) ToError(err error) (T, error) {
	if o.IsNone() {
		var zero T
		return zero, err
	}
	return o.value, nil
}

// --- Practical usage ---

type User struct {
	ID    int
	Name  string
	Email string
}

type UserDB struct {
	users map[int]User
}

func NewUserDB() *UserDB {
	return &UserDB{
		users: map[int]User{
			1: {ID: 1, Name: "Alice", Email: "alice@example.com"},
			2: {ID: 2, Name: "Bob", Email: "bob@example.com"},
		},
	}
}

// FindUser returns Some(user) if found, None if not.
// The Option return type FORCES callers to handle the absent case.
func (db *UserDB) FindUser(id int) Option[User] {
	u, ok := db.users[id]
	if !ok {
		return None[User]()
	}
	return Some(u)
}

// FindEmail returns the email of a user if found.
func (db *UserDB) FindEmail(id int) Option[string] {
	return OptionMap(db.FindUser(id), func(u User) string {
		return u.Email
	})
}

var ErrUserNotFound = errors.New("user not found")

func main() {
	db := NewUserDB()

	// --- Pattern match on presence ---
	user := db.FindUser(1)
	if user.IsSome() {
		fmt.Printf("Found: %s\n", user.Unwrap().Name)
	}

	missing := db.FindUser(999)
	if missing.IsNone() {
		fmt.Println("User 999 not found")
	}

	// --- Default value ---
	guest := User{ID: 0, Name: "Guest"}
	actual := db.FindUser(999).UnwrapOr(guest)
	fmt.Printf("Using default: %s\n", actual.Name)

	// --- Computed default ---
	expensive := db.FindUser(999).UnwrapOrElse(func() User {
		return User{ID: -1, Name: "Anonymous"} // only computed if needed
	})
	fmt.Printf("Computed default: %s\n", expensive.Name)

	// --- Chained transformations (no nil checks needed) ---
	email := db.FindEmail(1)
	fmt.Printf("Email: %s\n", email.UnwrapOr("no-email@default.com"))

	noEmail := db.FindEmail(999)
	fmt.Printf("Missing email: %s\n", noEmail.UnwrapOr("no-email@default.com"))

	// --- Convert to traditional error ---
	u, err := db.FindUser(1).ToError(ErrUserNotFound)
	if err == nil {
		fmt.Printf("To error success: %s\n", u.Name)
	}

	_, err = db.FindUser(999).ToError(ErrUserNotFound)
	if errors.Is(err, ErrUserNotFound) {
		fmt.Println("Correctly wrapped as ErrUserNotFound")
	}
}
```

---

## Part 5: Builder Pattern with Method Chaining

### Why builder: complex object construction with validation

Some objects require a multi-step construction process with interdependencies that can't be expressed by a simple constructor or even functional options. SQL query builders, HTTP request builders, and email composers are examples where you need to accumulate state over multiple method calls and then validate the complete object before use.

```go
package main

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// --- Example 7: SQL Query Builder ---

type QueryBuilder struct {
	table      string
	conditions []string
	columns    []string
	orderBy    string
	limit      int
	offset     int
	errs       []error // accumulate errors during building
}

// NewQuery starts building a SELECT query for the given table.
func NewQuery(table string) *QueryBuilder {
	if table == "" {
		return &QueryBuilder{errs: []error{errors.New("table name cannot be empty")}}
	}
	return &QueryBuilder{
		table:   table,
		columns: []string{"*"},
	}
}

// Select specifies which columns to return.
func (q *QueryBuilder) Select(columns ...string) *QueryBuilder {
	if len(columns) > 0 {
		q.columns = columns
	}
	return q
}

// Where adds a WHERE condition. Multiple calls are AND-ed together.
func (q *QueryBuilder) Where(condition string) *QueryBuilder {
	if condition == "" {
		q.errs = append(q.errs, errors.New("Where: condition cannot be empty"))
		return q
	}
	q.conditions = append(q.conditions, condition)
	return q
}

// OrderBy sets the ORDER BY clause.
func (q *QueryBuilder) OrderBy(column string, desc bool) *QueryBuilder {
	if column == "" {
		q.errs = append(q.errs, errors.New("OrderBy: column cannot be empty"))
		return q
	}
	if desc {
		q.orderBy = column + " DESC"
	} else {
		q.orderBy = column + " ASC"
	}
	return q
}

// Limit sets the maximum number of rows to return.
func (q *QueryBuilder) Limit(n int) *QueryBuilder {
	if n <= 0 {
		q.errs = append(q.errs, fmt.Errorf("Limit: must be positive, got %d", n))
		return q
	}
	q.limit = n
	return q
}

// Offset sets the number of rows to skip.
func (q *QueryBuilder) Offset(n int) *QueryBuilder {
	if n < 0 {
		q.errs = append(q.errs, fmt.Errorf("Offset: must be non-negative, got %d", n))
		return q
	}
	q.offset = n
	return q
}

// Build validates the accumulated state and constructs the SQL string.
func (q *QueryBuilder) Build() (string, error) {
	if len(q.errs) > 0 {
		msgs := make([]string, len(q.errs))
		for i, e := range q.errs {
			msgs[i] = e.Error()
		}
		return "", fmt.Errorf("query builder errors: %s", strings.Join(msgs, "; "))
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("SELECT %s FROM %s",
		strings.Join(q.columns, ", "), q.table))

	if len(q.conditions) > 0 {
		sb.WriteString(" WHERE ")
		sb.WriteString(strings.Join(q.conditions, " AND "))
	}

	if q.orderBy != "" {
		sb.WriteString(" ORDER BY ")
		sb.WriteString(q.orderBy)
	}

	if q.limit > 0 {
		sb.WriteString(fmt.Sprintf(" LIMIT %d", q.limit))
	}

	if q.offset > 0 {
		sb.WriteString(fmt.Sprintf(" OFFSET %d", q.offset))
	}

	return sb.String(), nil
}

// --- Example 8: HTTP Request Builder ---

type HTTPRequestBuilder struct {
	method  string
	url     string
	headers map[string]string
	body    string
	timeout time.Duration
	errs    []error
}

type HTTPRequest struct {
	Method  string
	URL     string
	Headers map[string]string
	Body    string
	Timeout time.Duration
}

func NewHTTPRequest(method, url string) *HTTPRequestBuilder {
	b := &HTTPRequestBuilder{
		headers: make(map[string]string),
		timeout: 30 * time.Second,
	}

	method = strings.ToUpper(method)
	validMethods := map[string]bool{"GET": true, "POST": true, "PUT": true, "DELETE": true, "PATCH": true}
	if !validMethods[method] {
		b.errs = append(b.errs, fmt.Errorf("invalid HTTP method: %q", method))
	} else {
		b.method = method
	}

	if url == "" {
		b.errs = append(b.errs, errors.New("URL cannot be empty"))
	} else {
		b.url = url
	}

	return b
}

func (b *HTTPRequestBuilder) WithHeader(key, value string) *HTTPRequestBuilder {
	b.headers[key] = value
	return b
}

func (b *HTTPRequestBuilder) WithBody(body string) *HTTPRequestBuilder {
	if b.method == "GET" {
		b.errs = append(b.errs, errors.New("GET requests cannot have a body"))
		return b
	}
	b.body = body
	return b
}

func (b *HTTPRequestBuilder) WithTimeout(d time.Duration) *HTTPRequestBuilder {
	if d <= 0 {
		b.errs = append(b.errs, fmt.Errorf("timeout must be positive, got %v", d))
		return b
	}
	b.timeout = d
	return b
}

func (b *HTTPRequestBuilder) WithJSON(body string) *HTTPRequestBuilder {
	b.WithHeader("Content-Type", "application/json")
	b.WithBody(body)
	return b
}

func (b *HTTPRequestBuilder) Build() (*HTTPRequest, error) {
	if len(b.errs) > 0 {
		msgs := make([]string, len(b.errs))
		for i, e := range b.errs {
			msgs[i] = e.Error()
		}
		return nil, fmt.Errorf("request builder: %s", strings.Join(msgs, "; "))
	}

	return &HTTPRequest{
		Method:  b.method,
		URL:     b.url,
		Headers: b.headers,
		Body:    b.body,
		Timeout: b.timeout,
	}, nil
}

func main() {
	// --- SQL Builder ---
	query, err := NewQuery("users").
		Select("id", "name", "email").
		Where("active = true").
		Where("created_at > '2024-01-01'").
		OrderBy("name", false).
		Limit(10).
		Offset(20).
		Build()

	if err != nil {
		fmt.Println("Query error:", err)
	} else {
		fmt.Println("SQL:", query)
	}

	// --- Invalid builder state accumulates errors ---
	_, err = NewQuery("").
		Where("").
		Limit(-5).
		Build()
	fmt.Println("Expected errors:", err)

	// --- HTTP Request Builder ---
	req, err := NewHTTPRequest("POST", "https://api.example.com/users").
		WithHeader("Authorization", "Bearer token123").
		WithJSON(`{"name":"Alice","email":"alice@example.com"}`).
		WithTimeout(10 * time.Second).
		Build()

	if err != nil {
		fmt.Println("Request error:", err)
	} else {
		fmt.Printf("Request: %s %s timeout=%v headers=%d body_len=%d\n",
			req.Method, req.URL, req.Timeout, len(req.Headers), len(req.Body))
	}

	// --- Invalid: GET with body ---
	_, err = NewHTTPRequest("GET", "https://api.example.com/users").
		WithBody("this should fail").
		Build()
	fmt.Println("Expected GET body error:", err)
}
```

---

## Part 6: Immutable Data Structures via Copying

### Why immutability: eliminating aliasing bugs

Aliasing occurs when two variables point to the same underlying data, and mutating one unexpectedly changes the other. In a concurrent system, shared mutable state requires locks everywhere. Immutable values — where modification returns a new copy — eliminate entire classes of bugs: no data races, no unexpected mutations in called functions, no need to defensively copy before sharing.

```go
package main

import (
	"fmt"
)

// --- Example 9: Immutable value via private fields + copy-on-write methods ---

// ImmutableConfig represents server configuration that cannot be mutated.
// All fields are unexported. Modification returns a NEW copy.
type ImmutableConfig struct {
	host     string
	port     int
	maxConns int
	debug    bool
	tags     []string // stored as a slice — needs careful copy
}

// NewImmutableConfig creates the initial configuration.
func NewImmutableConfig(host string, port int) ImmutableConfig {
	return ImmutableConfig{
		host:     host,
		port:     port,
		maxConns: 100,
		tags:     []string{},
	}
}

// Getters — read-only access to each field
func (c ImmutableConfig) Host() string    { return c.host }
func (c ImmutableConfig) Port() int       { return c.port }
func (c ImmutableConfig) MaxConns() int   { return c.maxConns }
func (c ImmutableConfig) Debug() bool     { return c.debug }
func (c ImmutableConfig) Tags() []string  {
	// Return a copy — prevent callers from mutating the internal slice
	tags := make([]string, len(c.tags))
	copy(tags, c.tags)
	return tags
}

// WithHost returns a NEW config with host changed. Original is untouched.
func (c ImmutableConfig) WithHost(host string) ImmutableConfig {
	c.host = host // c is a value copy (not a pointer) — original unchanged
	return c
}

func (c ImmutableConfig) WithPort(port int) ImmutableConfig {
	c.port = port
	return c
}

func (c ImmutableConfig) WithMaxConns(n int) ImmutableConfig {
	c.maxConns = n
	return c
}

func (c ImmutableConfig) WithDebug(debug bool) ImmutableConfig {
	c.debug = debug
	return c
}

func (c ImmutableConfig) WithTag(tag string) ImmutableConfig {
	// Must copy the slice — slices share backing array
	tags := make([]string, len(c.tags), len(c.tags)+1)
	copy(tags, c.tags)
	tags = append(tags, tag)
	c.tags = tags
	return c
}

// --- Example 10: Demonstrating immutability guarantees ---

func configureForProduction(base ImmutableConfig) ImmutableConfig {
	return base.
		WithMaxConns(10000).
		WithDebug(false).
		WithTag("production")
}

func configureForStaging(base ImmutableConfig) ImmutableConfig {
	return base.
		WithMaxConns(100).
		WithDebug(true).
		WithTag("staging")
}

func main() {
	// Base config
	base := NewImmutableConfig("localhost", 8080)
	fmt.Printf("base: host=%s port=%d maxConn=%d debug=%v tags=%v\n",
		base.Host(), base.Port(), base.MaxConns(), base.Debug(), base.Tags())

	// Derive specialized configs — base is NEVER modified
	prod := configureForProduction(base)
	staging := configureForStaging(base)

	fmt.Printf("prod: host=%s maxConn=%d debug=%v tags=%v\n",
		prod.Host(), prod.MaxConns(), prod.Debug(), prod.Tags())

	fmt.Printf("staging: host=%s maxConn=%d debug=%v tags=%v\n",
		staging.Host(), staging.MaxConns(), staging.Debug(), staging.Tags())

	// PROOF: base was never modified
	fmt.Printf("base (unchanged): maxConn=%d debug=%v tags=%v\n",
		base.MaxConns(), base.Debug(), base.Tags())

	// PROOF: tags don't share backing array
	prodTags := prod.Tags() // returns a COPY
	prodTags[0] = "mutated" // this does NOT affect prod's internal tags
	fmt.Printf("prod tags after external mutation attempt: %v\n", prod.Tags())

	// --- Immutable config enables safe concurrent use ---
	// Since ImmutableConfig is a value type with no shared mutable state,
	// it can be passed to multiple goroutines without any synchronization.
	done := make(chan bool, 3)
	for i := 0; i < 3; i++ {
		go func(id int) {
			// Each goroutine gets a VALUE copy — no data race possible
			localConfig := prod.WithTag(fmt.Sprintf("worker-%d", id))
			fmt.Printf("goroutine %d: tags=%v\n", id, localConfig.Tags())
			done <- true
		}(i)
	}
	for i := 0; i < 3; i++ {
		<-done
	}

	// PROOF: prod was never modified by the goroutines
	fmt.Printf("prod after goroutines: tags=%v\n", prod.Tags())
}
```

---

## Summary: Functional Pattern Selection Guide

```
Choose Functional Options when:
  [x] A constructor has more than 2-3 optional parameters
  [x] You need the API to be extensible without breaking existing callers
  [x] Used by: grpc.Dial, zap.NewProduction, http.NewServeMux

Choose Pipeline when:
  [x] Data flows through N sequential transformations
  [x] Each stage may fail and you want clean error propagation
  [x] Stages can run concurrently (use channels)
  [x] Used by: Docker image build, DNS query processing, data ingestion

Choose Map/Filter/Reduce when:
  [x] Transforming or aggregating collections
  [x] Go 1.18+ — use generics, not interface{}
  [x] Used by: data processing, report generation, stream transformation

Choose Option type when:
  [x] A function may legitimately return "nothing"
  [x] You want to force callers to handle the absent case
  [x] Avoid nil pointer panics by construction
  [x] Used by: database lookups, cache hits, optional configuration

Choose Builder when:
  [x] Object construction is multi-step with interdependencies
  [x] You want to accumulate errors and report them all at Build() time
  [x] The constructed object is only valid when complete
  [x] Used by: SQL query builders, HTTP request builders, email composers

Choose Immutable values when:
  [x] Values are shared across goroutines (eliminates locks)
  [x] You want to derive specialized configs from a base
  [x] You need a complete audit trail of configuration changes
  [x] Used by: configuration management, event sourcing, caching keys
```
