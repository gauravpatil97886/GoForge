# Go Structs & Embedding

## What Is This?

A struct in Go is a composite data type that groups named fields of different types under a single name. Embedding is Go's mechanism for composing types by placing one struct (or interface) directly inside another without giving it a field name, causing its fields and methods to be "promoted" to the outer type. Together, structs and embedding are Go's answer to object-oriented design — without classes, inheritance, or virtual dispatch.

## Why Does It Exist?

Classical inheritance (Java, C++, Python) creates tight coupling: a child class is permanently locked to its parent's implementation. When a parent changes, every child is affected. The "diamond problem" in C++ and the fragile base class problem in Java are direct consequences. Go's designers looked at years of production pain from deep inheritance hierarchies and chose a different path: **composition over inheritance**. Instead of `Dog extends Animal`, you write a `Dog` struct that *contains* an `Animal`. You get code reuse without coupling. Embedding takes this further by making the composition feel natural — promoted methods mean you don't need to write delegating boilerplate. The result is code that is easier to change, easier to test in isolation, and easier to reason about.

## Who Uses This in Industry?

- **Google**: The `net/http` standard library (written at Google) uses struct embedding throughout — `http.Server` embeds configuration, and handler types compose behavior by embedding base types. Internal Google services model domain objects as structs with JSON/protobuf tags for serialization across microservices.
- **Kubernetes**: Kubernetes API objects are the canonical industry example of embedding at scale. Every Kubernetes resource (`Pod`, `Deployment`, `Service`) embeds `metav1.TypeMeta` and `metav1.ObjectMeta` to inherit standard fields like `Name`, `Namespace`, `Labels`, and `Annotations`. This is how ~50 different resource types all share the same metadata behavior without a single line of duplicated code.
- **Uber**: Uber's Go services use struct embedding to build middleware chains. A base `BaseHandler` struct holds shared dependencies (logger, metrics client, config), and each handler embeds it, gaining those capabilities automatically.
- **Docker / Moby**: Docker's daemon internals use embedding to compose subsystems — the main `Daemon` struct embeds multiple sub-components (image store, network controller, volume driver) so their methods are callable directly on the daemon.
- **Cloudflare**: High-throughput network services at Cloudflare use structs with careful value-vs-pointer receiver discipline to control memory allocation and avoid GC pressure in hot paths.
- **HashiCorp (Terraform/Vault)**: Plugin SDKs use struct embedding to let plugin authors inherit standard resource CRUD behavior and override only what they need.

## Industry Standards & Best Practices

**What senior engineers do:**
- Embed for "is-a-kind-of" relationships only when the promoted interface makes semantic sense. If you embed just to avoid typing a field name, that is a code smell.
- Use pointer receivers consistently on a type once any method requires mutation. Mixing pointer and value receivers on the same type confuses the method set rules and leads to subtle interface-satisfaction bugs.
- Add struct tags from day one on any type that touches JSON, a database, or a configuration file. Retrofitting tags later breaks existing serialized data.
- Prefer small, focused structs that embed each other over large "god structs" that hold everything.
- Use `//go:generate` with `stringer` or `mockgen` on structs that need generated code.

**What beginners do (and should stop):**
- Put everything in one massive struct.
- Use value receivers everywhere because "it looks cleaner," then wonder why mutations do not stick.
- Copy a struct that contains a `sync.Mutex`, which silently creates a data race.
- Embed types just to reduce typing, creating hidden coupling.

## Why Go's Approach Is Unique

| Feature | Java/C++ | Python | Go |
|---|---|---|---|
| Reuse mechanism | Inheritance (`extends`) | Inheritance + mixins | Embedding (composition) |
| Method dispatch | Virtual / polymorphic | Dynamic (duck typing) | Static + interface satisfaction |
| Coupling | Tight (child depends on parent impl) | Moderate | Loose (embed and override freely) |
| Diamond problem | Yes (C++), partially (Java) | Yes (MRO resolves it) | Does not exist — ambiguity is a compile error |
| "Inheritance" cost | vtable overhead (C++) | `__mro__` lookup | Zero — promoted methods are direct calls |

Go deliberately has no `class`, no `extends`, no `super`, and no constructors. This is not an omission; it is a design decision. The Go team observed that inheritance hierarchies in large codebases become maintenance burdens, so they removed the mechanism entirely and replaced it with something strictly more flexible.

---

## 1. Struct Basics

### Why Before How

A struct is the primary way to model a domain concept in Go. Before writing any function, ask: "what data belongs together?" That grouping becomes a struct. Field tags are metadata annotations read at runtime via reflection — they do not affect the struct's memory layout or type system, but they are the standard contract between your struct and serialization libraries.

### Zero Values

Every field in a struct has a well-defined zero value when the struct is created without explicit initialization. `int` fields are `0`, `string` fields are `""`, pointer fields are `nil`, and boolean fields are `false`. This predictability is intentional — Go code rarely needs nil checks for structs themselves.

```go
// example_01_struct_basics.go
package main

import (
	"fmt"
	"reflect"
)

// User models a system user.
// Field tags tell encoding/json how to serialize this struct.
type User struct {
	ID        int    `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name,omitempty"` // omit if empty string
	Email     string `json:"email"`
	Age       int    `json:"age,omitempty"`
	active    bool   // unexported: only accessible within this package
}

// Address uses anonymous (embedded) fields — uncommon for plain data,
// but valid Go. The field name becomes the type name.
type Coordinates struct {
	Lat float64
	Lng float64
}

// Location embeds Coordinates as a named field (NOT embedding — this is a normal field).
type Location struct {
	Address     string
	Coordinates Coordinates // named field, not embedded
}

// Point is comparable — all fields are comparable types.
type Point struct {
	X, Y int
}

// Slice-containing struct: NOT comparable with ==
type Polygon struct {
	Vertices []Point
}

func main() {
	// Zero value — all fields are their type's zero value
	var u User
	fmt.Printf("Zero value user: %+v\n", u)
	// Output: Zero value user: {ID:0 FirstName: LastName: Email: Age:0 active:false}

	// Struct literal — positional (fragile, avoid in production)
	p1 := Point{1, 2}

	// Struct literal — named fields (preferred)
	p2 := Point{X: 10, Y: 20}

	// Struct comparison: works because all fields are comparable
	fmt.Println("p1 == p2:", p1 == p2)   // false
	fmt.Println("p1 == p1:", p1 == p1)   // true

	// Structs containing slices/maps/functions cannot use ==
	// poly1 := Polygon{Vertices: []Point{{1,2}}}
	// poly2 := Polygon{Vertices: []Point{{1,2}}}
	// poly1 == poly2  // COMPILE ERROR: invalid operation

	// Inspect field tags at runtime via reflection
	t := reflect.TypeOf(User{})
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if tag, ok := field.Tag.Lookup("json"); ok {
			fmt.Printf("Field %-12s json tag: %q\n", field.Name, tag)
		}
	}

	_ = p2
}
```

**Common Pitfall:** Using positional struct literals (`Point{1, 2}`) means adding a field anywhere in the struct silently shifts all values and causes a compilation error in other packages — or worse, compiles but assigns values to wrong fields. Always use named fields except in tests for trivial types.

---

## 2. Methods on Structs — The Critical Distinction

### Why This Matters More Than Almost Anything Else

The difference between a value receiver and a pointer receiver is the single most common source of subtle bugs for Go beginners. It also directly determines whether a type satisfies an interface.

**Value receiver** (`func (u User) Method()`): Go copies the entire struct. The method works on the copy. Mutations are invisible to the caller. Appropriate for read-only operations on small structs.

**Pointer receiver** (`func (u *User) Method()`): Go passes the address of the struct. Mutations affect the original. Required whenever the method needs to change state. Required for large structs where copying is expensive.

**The rule senior engineers follow:** If *any* method on a type uses a pointer receiver, use pointer receivers for *all* methods on that type. Mixing them creates asymmetric method sets that break interface satisfaction in non-obvious ways.

```go
// example_02_methods.go
package main

import "fmt"

type Counter struct {
	count int
	name  string
}

// Value receiver: reads but does not modify. Returns a new value.
// Calling this on a nil pointer would panic — but Go won't let you call
// a value receiver method on a nil pointer at the call site.
func (c Counter) Value() int {
	return c.count
}

func (c Counter) String() string {
	return fmt.Sprintf("Counter(%s)=%d", c.name, c.count)
}

// Pointer receiver: modifies state. THIS IS THE CORRECT WAY to mutate.
func (c *Counter) Increment() {
	c.count++
}

func (c *Counter) Reset() {
	c.count = 0
}

func (c *Counter) Add(n int) {
	c.count += n
}

// WHY THIS DEMONSTRATES THE BUG:
// If Increment used a value receiver, this would silently do nothing.
func demonstrateReceiverBug() {
	c := Counter{name: "demo"}
	c.Increment() // works — Go auto-takes the address: (&c).Increment()
	c.Increment()
	fmt.Println("After 2 increments:", c.Value()) // 2

	// The bug scenario: value receiver that looks like mutation
	// If Increment were: func (c Counter) Increment() { c.count++ }
	// Then c.count would still be 0 here. The increment happened on a copy.
}

// Method sets determine interface satisfaction.
// Stringer interface from fmt package.
type Stringer interface {
	String() string
}

func printStringer(s Stringer) {
	fmt.Println(s.String())
}

func main() {
	demonstrateReceiverBug()

	c := &Counter{name: "main", count: 5}
	c.Add(10)
	fmt.Println(c) // uses String() method via fmt.Stringer

	// *Counter has method set: {Value, String, Increment, Reset, Add}
	// Counter  has method set: {Value, String}  (no pointer receivers)
	// Therefore *Counter satisfies Stringer, and so does Counter
	// (because String has a value receiver, accessible from both)

	var s Stringer = c         // *Counter satisfies Stringer
	printStringer(s)

	cVal := Counter{name: "value", count: 3}
	printStringer(cVal)        // Counter also satisfies Stringer (String is value receiver)

	// This would NOT compile if String() used a pointer receiver:
	// var s2 Stringer = Counter{} // compile error: Counter does not implement Stringer
}
```

### Method Set Rules (Memorize This)

| Type | Accessible Methods |
|---|---|
| `T` (value) | Methods with value receiver `(t T)` |
| `*T` (pointer) | Methods with value receiver `(t T)` AND pointer receiver `(t *T)` |

This asymmetry exists because Go can always take the address of an addressable value to call a pointer method, but it cannot always dereference a value to get a pointer (non-addressable values like map elements and function return values are not addressable).

---

## 3. Struct Embedding

### Why Embedding Exists

Without embedding, composing behavior requires writing delegation boilerplate:

```go
// WITHOUT embedding — manual delegation
type Animal struct{ Name string }
func (a Animal) Speak() string { return a.Name + " speaks" }

type Dog struct { animal Animal }
// Must manually delegate EVERY method:
func (d Dog) Speak() string { return d.animal.Speak() }
```

With embedding, the delegation is automatic:

```go
// WITH embedding — methods promoted automatically
type Dog struct { Animal }  // no field name = embedded
// Dog now has Speak() without writing any delegation code
```

```go
// example_03_embedding.go
package main

import "fmt"

// Base type — will be embedded
type Animal struct {
	Name    string
	Species string
}

func (a Animal) Describe() string {
	return fmt.Sprintf("%s is a %s", a.Name, a.Species)
}

func (a Animal) Speak() string {
	return a.Name + " makes a sound"
}

// Dog embeds Animal — all of Animal's exported fields and methods
// are promoted to Dog.
type Dog struct {
	Animal        // embedded — no field name
	Breed  string
}

// Dog OVERRIDES Speak() — this shadows Animal.Speak()
func (d Dog) Speak() string {
	return d.Name + " barks" // d.Name is promoted from Animal
}

// GuideDog embeds Dog, which embeds Animal — multi-level promotion
type GuideDog struct {
	Dog
	HandlerName string
}

// Accessing the embedded type directly by its type name
func demonstrateAccess() {
	d := Dog{
		Animal: Animal{Name: "Rex", Species: "Canis lupus familiaris"},
		Breed:  "German Shepherd",
	}

	// Promoted field access
	fmt.Println(d.Name)    // same as d.Animal.Name
	fmt.Println(d.Species) // same as d.Animal.Species

	// Promoted method call
	fmt.Println(d.Describe()) // Animal.Describe — not overridden

	// Overridden method
	fmt.Println(d.Speak())        // "Rex barks" — Dog.Speak
	fmt.Println(d.Animal.Speak()) // "Rex makes a sound" — explicitly call Animal.Speak

	// Multi-level embedding
	gd := GuideDog{
		Dog:         d,
		HandlerName: "Alice",
	}
	fmt.Println(gd.Name)     // promoted through Dog -> Animal
	fmt.Println(gd.Speak())  // Dog.Speak (closest embedding wins)
	fmt.Println(gd.Describe()) // Animal.Describe (promoted through two levels)
}

func main() {
	demonstrateAccess()
}
```

### Embedding Pointer vs Value

```go
// example_04_pointer_embedding.go
package main

import "fmt"

type Logger struct {
	prefix string
}

func (l *Logger) Log(msg string) {
	fmt.Printf("[%s] %s\n", l.prefix, msg)
}

// Embedding a value: Logger is copied when Service is copied.
// All Service instances share nothing — each has its own Logger.
type ServiceValue struct {
	Logger        // value embedding
	Name   string
}

// Embedding a pointer: all Services created from the same *Logger
// share the same logger instance. Useful for shared state (e.g., a connection pool).
type ServicePointer struct {
	*Logger       // pointer embedding
	Name string
}

func main() {
	// Value embedding
	svc1 := ServiceValue{
		Logger: Logger{prefix: "SVC1"},
		Name:   "UserService",
	}
	svc1.Log("started") // promoted method, called on the embedded Logger value

	// Pointer embedding
	sharedLogger := &Logger{prefix: "SHARED"}
	svc2 := ServicePointer{Logger: sharedLogger, Name: "OrderService"}
	svc3 := ServicePointer{Logger: sharedLogger, Name: "PaymentService"}

	svc2.Log("order created")   // uses sharedLogger
	svc3.Log("payment received") // uses the same sharedLogger

	// PITFALL: if sharedLogger is nil, calling Log() panics
	// var broken ServicePointer // Logger field is nil *Logger
	// broken.Log("crash")       // panic: nil pointer dereference
}
```

---

## 4. Interface Embedding

Interface embedding is fundamentally different from struct embedding. When an interface embeds another interface, it creates a new interface that requires all methods of both. This is how Go builds the standard library.

```go
// example_05_interface_embedding.go
package main

import (
	"fmt"
	"strings"
)

// Narrow interfaces — each does one thing (interface segregation)
type Reader interface {
	Read() string
}

type Writer interface {
	Write(data string)
}

// ReadWriter embeds both — a type satisfying ReadWriter must implement all 3 methods.
// This is identical to how io.ReadWriter works in the standard library.
type ReadWriter interface {
	Reader
	Writer
}

// Closer interface
type Closer interface {
	Close() error
}

// ReadWriteCloser is the Go equivalent of io.ReadWriteCloser
type ReadWriteCloser interface {
	ReadWriter
	Closer
}

// Buffer implements ReadWriteCloser
type Buffer struct {
	data   strings.Builder
	closed bool
}

func (b *Buffer) Read() string {
	return b.data.String()
}

func (b *Buffer) Write(data string) {
	if !b.closed {
		b.data.WriteString(data)
	}
}

func (b *Buffer) Close() error {
	b.closed = true
	return nil
}

// processRW only needs read/write — narrower interface
func processRW(rw ReadWriter) {
	rw.Write("hello from processRW")
	fmt.Println("Read back:", rw.Read())
}

// processRWC needs full capabilities
func processRWC(rwc ReadWriteCloser) {
	rwc.Write(" + more data")
	fmt.Println("Full read:", rwc.Read())
	_ = rwc.Close()
}

func main() {
	buf := &Buffer{}

	// *Buffer satisfies all three interfaces
	processRW(buf)
	processRWC(buf)
}
```

---

## 5. Struct Tags in Depth

### Why Tags Exist

Struct tags are the contract between your Go type system and external systems (JSON APIs, SQL databases, validation libraries, gRPC/protobuf, configuration parsers). They are invisible to normal Go code but are readable at runtime via `reflect.StructTag`. Without tags, you would need separate DTO types or manual marshaling code for every struct.

```go
// example_06_struct_tags.go
package main

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

// ProductRequest represents an inbound API request.
// Tags configure: JSON serialization, hypothetical DB mapping, and validation.
type ProductRequest struct {
	// json:"name" — serializes as "name" not "Name"
	// validate:"required,min=1,max=100" — used by github.com/go-playground/validator
	Name string `json:"name" validate:"required,min=1,max=100" db:"product_name"`

	// omitempty: field is omitted from JSON output if value is zero/empty/nil
	Description string `json:"description,omitempty" db:"description"`

	// Price must be > 0 in validation
	Price float64 `json:"price" validate:"required,gt=0" db:"price"`

	// "-" means: never include this field in JSON serialization
	InternalCode string `json:"-" db:"internal_code"`

	// Pointer + omitempty: null in JSON when nil, absent when omitempty + nil
	Discount *float64 `json:"discount,omitempty" db:"discount"`

	// Tags can have multiple keys for different libraries
	Tags []string `json:"tags,omitempty" db:"-"` // db:"-" means skip in SQL mapping
}

// parseTag demonstrates manually reading struct tags — useful when writing
// your own serialization library or ORM-like code.
func parseTag(v interface{}) {
	t := reflect.TypeOf(v)
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}

	fmt.Printf("Struct: %s\n", t.Name())
	fmt.Printf("%-15s %-30s %-30s %s\n", "Field", "JSON Tag", "DB Tag", "Validate Tag")
	fmt.Println(strings.Repeat("-", 90))

	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		jsonTag := field.Tag.Get("json")
		dbTag := field.Tag.Get("db")
		validateTag := field.Tag.Get("validate")
		fmt.Printf("%-15s %-30s %-30s %s\n", field.Name, jsonTag, dbTag, validateTag)
	}
}

func main() {
	parseTag(ProductRequest{})

	// JSON serialization respects tags
	discount := 0.1
	req := ProductRequest{
		Name:         "Widget",
		Price:        29.99,
		InternalCode: "SKU-001",  // will NOT appear in JSON
		Discount:     &discount,
		Tags:         []string{"sale", "featured"},
	}

	data, _ := json.MarshalIndent(req, "", "  ")
	fmt.Println("\nJSON output:")
	fmt.Println(string(data))

	// InternalCode is absent from JSON. Description is absent (omitempty + empty).
	// Discount appears because it is non-nil.

	// Unmarshal also uses tags
	jsonInput := `{"name":"Gadget","price":49.99,"description":"A fine gadget"}`
	var parsed ProductRequest
	_ = json.Unmarshal([]byte(jsonInput), &parsed)
	fmt.Printf("\nParsed: %+v\n", parsed)
}
```

---

## 6. Composition Patterns

### The Mixin Pattern

A mixin provides a set of methods that any struct can acquire by embedding. Unlike inheritance, multiple mixins can be embedded without conflict (unless they have methods with the same name, which is a compile error at call time).

```go
// example_07_composition_patterns.go
package main

import (
	"fmt"
	"time"
)

// --- Mixin 1: Timestamps ---
// Any struct that embeds Timestamps gets created/updated tracking for free.
type Timestamps struct {
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (t *Timestamps) Touch() {
	now := time.Now()
	if t.CreatedAt.IsZero() {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
}

func (t Timestamps) Age() time.Duration {
	return time.Since(t.CreatedAt)
}

// --- Mixin 2: SoftDelete ---
// Any struct embedding SoftDelete gets soft-deletion semantics.
type SoftDelete struct {
	DeletedAt *time.Time
}

func (s *SoftDelete) Delete() {
	now := time.Now()
	s.DeletedAt = &now
}

func (s SoftDelete) IsDeleted() bool {
	return s.DeletedAt != nil
}

// --- Domain type composing both mixins ---
type Article struct {
	Timestamps              // mixin 1
	SoftDelete              // mixin 2
	ID      int
	Title   string
	Content string
}

// --- Decorator Pattern via Embedding + Interface ---

type DataStore interface {
	Get(id int) string
	Set(id int, value string)
}

// InMemoryStore is the base implementation.
type InMemoryStore struct {
	data map[int]string
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{data: make(map[int]string)}
}

func (s *InMemoryStore) Get(id int) string {
	return s.data[id]
}

func (s *InMemoryStore) Set(id int, value string) {
	s.data[id] = value
}

// LoggingStore DECORATES InMemoryStore by embedding the interface.
// It intercepts all calls and adds logging. This is the decorator pattern.
// Embedding the interface (not the concrete type) means LoggingStore satisfies
// DataStore and can wrap ANY DataStore implementation.
type LoggingStore struct {
	DataStore              // embed the interface
	logger func(string)
}

func NewLoggingStore(inner DataStore) *LoggingStore {
	return &LoggingStore{
		DataStore: inner,
		logger:    func(s string) { fmt.Println("[LOG]", s) },
	}
}

// Override only Set — Get is promoted from the embedded DataStore.
func (l *LoggingStore) Set(id int, value string) {
	l.logger(fmt.Sprintf("Set called: id=%d value=%q", id, value))
	l.DataStore.Set(id, value) // delegate to wrapped store
}

func (l *LoggingStore) Get(id int) string {
	result := l.DataStore.Get(id)
	l.logger(fmt.Sprintf("Get called: id=%d result=%q", id, result))
	return result
}

func main() {
	// Mixin pattern
	a := Article{ID: 1, Title: "Go Structs", Content: "..."}
	a.Touch() // from Timestamps mixin
	fmt.Printf("Article created: %v\n", a.CreatedAt.Format(time.RFC3339))
	fmt.Printf("Is deleted: %v\n", a.IsDeleted()) // from SoftDelete mixin
	a.Delete()
	fmt.Printf("Is deleted: %v\n", a.IsDeleted())

	fmt.Println()

	// Decorator pattern
	base := NewInMemoryStore()
	store := NewLoggingStore(base) // wraps base with logging

	store.Set(1, "hello")
	val := store.Get(1)
	fmt.Println("Got:", val)

	// The logging store satisfies DataStore
	var ds DataStore = store
	ds.Set(2, "world")
}
```

---

## 7. Common Pitfalls

### Pitfall 1: Copying a Struct That Contains a Mutex

This is one of the most dangerous bugs in Go. A `sync.Mutex` must not be copied after first use. If your struct contains a mutex (or anything that wraps one, like `sync.WaitGroup`, `sync.Map`), you must always pass and store it as a pointer.

```go
// example_08_mutex_copy_pitfall.go
package main

import (
	"fmt"
	"sync"
)

// SafeCounter is CORRECT: all methods use pointer receivers,
// so the mutex is never copied during method calls.
type SafeCounter struct {
	mu    sync.Mutex
	count int
}

func (c *SafeCounter) Increment() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.count++
}

func (c *SafeCounter) Value() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.count
}

// WRONG: This function takes SafeCounter by value — it copies the mutex.
// The go vet tool and staticcheck will catch this.
// func brokenProcess(c SafeCounter) { c.Increment() } // vet: passes lock by value

// CORRECT: Always pass mutex-containing structs by pointer.
func correctProcess(c *SafeCounter) {
	c.Increment()
}

// Also WRONG: storing in a non-pointer field.
type WrongContainer struct {
	counter SafeCounter // copying WrongContainer copies the mutex
}

// CORRECT: store as pointer
type CorrectContainer struct {
	counter *SafeCounter
}

func main() {
	c := &SafeCounter{}

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			correctProcess(c)
		}()
	}
	wg.Wait()

	fmt.Println("Final count:", c.Value()) // always 1000

	// go vet ./... would catch any mutex copy violations in your codebase
	fmt.Println("Run 'go vet ./...' to catch mutex copy bugs automatically")
}
```

### Pitfall 2: Ambiguous Promoted Methods

When two embedded types have methods with the same name, calling that method on the outer type is a compile error. You must explicitly select which embedded type's method to call.

```go
// example_09_ambiguous_embedding.go
package main

import "fmt"

type A struct{ name string }
type B struct{ name string }

func (a A) Greet() string { return "Hello from A: " + a.name }
func (b B) Greet() string { return "Hello from B: " + b.name }
func (a A) Describe() string { return "I am A" }

type C struct {
	A
	B
}

func main() {
	c := C{
		A: A{name: "Alpha"},
		B: B{name: "Beta"},
	}

	// c.Greet() would be a COMPILE ERROR:
	// "ambiguous selector c.Greet"
	// You must explicitly qualify which Greet you want:
	fmt.Println(c.A.Greet()) // "Hello from A: Alpha"
	fmt.Println(c.B.Greet()) // "Hello from B: Beta"

	// Describe() exists only on A, not B, so it is unambiguous and promoted.
	fmt.Println(c.Describe()) // "I am A"

	// SOLUTION: Override at the outer level to resolve ambiguity permanently.
	// See the commented method below.
}

// If you define Greet on C, the ambiguity is resolved — C.Greet takes precedence.
func (c C) Greet() string {
	return fmt.Sprintf("Hello from C (wrapping %s and %s)", c.A.name, c.B.name)
}

// Now c.Greet() works and calls C.Greet, not A or B.
```

### Summary: The Rules

1. **Value vs Pointer Receiver:** If any method mutates the struct, use `*T` for ALL methods on that type.
2. **Interface satisfaction:** `T` satisfies an interface only if all interface methods have value receivers. `*T` satisfies any interface whose methods are value or pointer receivers.
3. **Never copy a mutex:** Structs containing `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, or `sync.Map` must be passed by pointer. Run `go vet` to catch violations.
4. **Embedding is not inheritance:** Embedded types are independent. The outer type does not "become" the inner type. A `Dog` embedding `Animal` is not substitutable for an `Animal` unless both implement the same interface.
5. **Ambiguous selectors fail at compile time:** If two embedded types share a method name and the outer type does not override it, any call to that method is a compile error.
6. **Tags are strings, not code:** Struct tags have no effect on compilation or runtime behavior unless something uses `reflect.StructTag` to read them. A typo in a tag silently does nothing.
7. **Pointer embedding and nil:** Embedding a pointer type (`*Logger`) means the zero value of the outer struct has a nil embedded pointer. Calling methods on it panics. Always initialize pointer-embedded fields.
