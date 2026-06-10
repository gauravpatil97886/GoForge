# Go Type System

## What Is This?

Go's type system is a static, nominally typed system that enforces type safety at compile time while also supporting structural typing through interfaces. Every value in Go has a type known at compile time, and Go is strict about type conversions — no implicit coercions happen. The hybrid approach means types must match by name in most cases, but interface satisfaction is checked structurally (by method signature), enabling flexible polymorphism without inheritance.

## Why Does It Exist?

Before Go, large C/C++ codebases at Google suffered from slow compilation and tangled inheritance hierarchies that made code hard to refactor. Python and Ruby offered flexibility but sacrificed compile-time safety, leading to runtime type errors in production. Go was designed to eliminate an entire class of bugs (type mismatches, nil pointer dereferences on wrong types) at compile time while keeping interfaces flexible enough to decouple packages without forcing explicit declarations. The structural interface typing means two packages can interoperate without importing each other, eliminating the circular dependency problem common in Java.

## Who Uses This in Industry?

- **Google**: Go's type system was designed for Google's massive monorepo. Named types on domain concepts (UserID, RequestToken) prevent mixing up identically-shaped integers. The compiler's speed (type checking + compilation in seconds on millions of lines) enables continuous build/test cycles.
- **Uber**: Uber's Go microservices use type-safe generated protobuf structs extensively. Named types like `driver.ID` and `rider.ID` (both `int64` underneath) prevent passing the wrong ID to a function — a real class of bug in production systems.
- **Docker / Kubernetes**: The Kubernetes API server uses interface types heavily. The `runtime.Object` interface allows the API machinery to handle any resource type generically without knowing concrete types at compile time. Type switches dispatch behavior per resource type.
- **Cloudflare**: Cloudflare uses Go for high-throughput network services. Comparable struct types serve as map keys for connection tracking tables (IP + port as a struct key), which is both safe and faster than string concatenation.
- **Netflix**: Netflix's Go services use reflection-based JSON marshaling (encoding/json) to serialize arbitrary response structures, relying on Go's type system to generate correct wire formats from struct definitions.

## Industry Standards & Best Practices

**What senior engineers do:**
- Define named types for domain concepts (`type UserID int64`) so the compiler enforces semantic correctness, not just structural correctness.
- Use the safe form `x, ok := x.(T)` for type assertions — never the panic form in production code paths.
- Define narrow interfaces (1-3 methods) close to where they are used, not in the package that implements them.
- Use generics (Go 1.18+) for reusable collection/algorithm utilities instead of `interface{}`.
- Avoid `reflect` in hot paths; use it only in framework/library code that runs once or infrequently.

**What beginners do (and should stop doing):**
- Accept `interface{}` everywhere "for flexibility" — this loses all compile-time safety.
- Use type aliases instead of named types, inadvertently sharing the method set with the original.
- Write type assertion chains without the `ok` check, causing panics in production.
- Over-use reflection when a simple interface or generic would work.

## Why Go's Approach Is Unique

| Language | Interface Typing | Implicit Conversion | Generics |
|----------|-----------------|---------------------|----------|
| Java | Nominal (explicit `implements`) | Widening (int → long) | Yes (type erasure) |
| Python | Structural (duck typing, runtime) | Yes (int + float) | No (typing module only hints) |
| TypeScript | Structural (compile-time) | No | Yes |
| **Go** | **Structural for interfaces, nominal for types** | **No — explicit only** | **Yes (1.18, reified)** |

Go made deliberate tradeoffs: no inheritance (forces composition), no implicit conversion (forces clarity), no exception system (forces explicit error handling). The structural interface typing is the key insight — a type satisfies an interface simply by having the methods, with no `implements` keyword. This was chosen to allow decoupled package design in a monorepo where forcing explicit declarations would create import cycles.

---

## 1. Named Types

### Why Before How

When you write `type UserID int64`, you are creating a completely new type that is distinct from `int64`. The Go compiler will refuse to assign an `int64` directly to a `UserID` without an explicit conversion. This is not bureaucracy — it is a tool that prevents a real class of production bugs where two semantically different values share the same underlying representation.

A plain `int64` has no methods. A `UserID` can have methods like `String()` or `Validate()`, which makes it self-describing and testable.

```go
package main

import "fmt"

// Named type — completely new type, not just an alias
type UserID int64
type OrderID int64
type Celsius float64
type Fahrenheit float64

// Methods can only be attached to named types defined in the same package
func (u UserID) String() string {
	return fmt.Sprintf("user:%d", int64(u))
}

func (c Celsius) ToFahrenheit() Fahrenheit {
	return Fahrenheit(c*9/5 + 32)
}

func (f Fahrenheit) ToCelsius() Celsius {
	return Celsius((f - 32) * 5 / 9)
}

// The compiler prevents mixing UserID and OrderID even though both are int64
func processUser(id UserID) {
	fmt.Println("Processing", id)
}

func main() {
	var uid UserID = 42
	var oid OrderID = 42

	processUser(uid)
	// processUser(oid) // COMPILE ERROR: cannot use oid (type OrderID) as type UserID

	// Explicit conversion is required
	processUser(UserID(oid)) // works, but you had to think about it

	temp := Celsius(100)
	fmt.Printf("%.1f°C = %.1f°F\n", temp, temp.ToFahrenheit())

	fmt.Println(uid) // calls uid.String() automatically
}
```

### Type Alias vs Named Type

```go
package main

import "fmt"

// TYPE ALIAS: A = B means A and B are the SAME type
// Used for gradual refactoring / cross-package compatibility
type MyStringAlias = string // alias — identical to string, shares all methods

// NAMED TYPE: creates a brand-new distinct type
type MyStringType string // new type — no string methods inherited

func main() {
	var a MyStringAlias = "hello" // same as string, no conversion needed
	var b string = a              // works: they are the same type
	fmt.Println(b)

	var c MyStringType = "world"
	// var d string = c // COMPILE ERROR: cannot use c (type MyStringType) as type string
	var d string = string(c) // explicit conversion required
	fmt.Println(d)

	// Key difference: MyStringType does NOT have string's built-in methods
	// MyStringAlias DOES have string's built-in methods (it IS string)
}
```

**Common Pitfall**: Using `type A = B` (alias) when you wanted `type A B` (new type). Aliases do not provide type safety — they are purely for renaming, typically used when moving a type between packages during refactoring.

---

## 2. Type Assertions and Type Switches

### Why Before How

When a value is stored in an interface variable, the concrete type information is preserved at runtime but hidden from the type system. A type assertion is the mechanism to recover the concrete type. The two-return form (`v, ok := x.(T)`) is safe for production use. The single-return form (`v := x.(T)`) panics if the type does not match — this is acceptable only when the type mismatch would represent a programming error that should crash, not a runtime condition you expect to handle.

```go
package main

import "fmt"

type Animal interface {
	Sound() string
}

type Dog struct{ Name string }
type Cat struct{ Name string }
type Bird struct{ Name string }

func (d Dog) Sound() string  { return "Woof" }
func (c Cat) Sound() string  { return "Meow" }
func (b Bird) Sound() string { return "Tweet" }

// Bonus: Bird has Fly, which is not part of Animal
func (b Bird) Fly() string { return b.Name + " is flying" }

func describe(a Animal) {
	// Safe assertion — the ok pattern
	if dog, ok := a.(Dog); ok {
		fmt.Printf("Dog named %s says %s\n", dog.Name, dog.Sound())
		return
	}

	// Type switch — the idiomatic way to branch on multiple types
	switch v := a.(type) {
	case Cat:
		fmt.Printf("Cat named %s says %s\n", v.Name, v.Sound())
	case Bird:
		fmt.Printf("Bird named %s says %s and can fly: %s\n", v.Name, v.Sound(), v.Fly())
	default:
		fmt.Printf("Unknown animal: %T\n", v)
	}
}

func main() {
	animals := []Animal{
		Dog{Name: "Rex"},
		Cat{Name: "Whiskers"},
		Bird{Name: "Tweety"},
	}

	for _, a := range animals {
		describe(a)
	}

	// Unsafe assertion — panics if wrong type
	var a Animal = Dog{Name: "Buddy"}
	dog := a.(Dog) // safe here because we know it's a Dog
	fmt.Println("Direct assertion:", dog.Name)

	// This would panic at runtime:
	// cat := a.(Cat) // panic: interface conversion: main.Dog is not main.Cat
}
```

### The Empty Interface (any)

```go
package main

import "fmt"

// any is an alias for interface{} — Go 1.18+
// Accepts any value but loses all type information

func printAny(v any) {
	// Must use type switch or assertion to do anything useful
	switch x := v.(type) {
	case int:
		fmt.Printf("int: %d\n", x)
	case string:
		fmt.Printf("string: %q\n", x)
	case []int:
		fmt.Printf("[]int with %d elements\n", len(x))
	case map[string]int:
		fmt.Printf("map with %d keys\n", len(x))
	case nil:
		fmt.Println("nil value")
	default:
		fmt.Printf("unknown type: %T = %v\n", x, x)
	}
}

func main() {
	printAny(42)
	printAny("hello")
	printAny([]int{1, 2, 3})
	printAny(map[string]int{"a": 1})
	printAny(nil)
	printAny(3.14)
}
```

**Cost of `any`/`interface{}`**: Values stored in an interface cause a heap allocation (escape to heap) and an indirect function call through a vtable (itab). In hot loops, this adds up. Prefer concrete types or generics in performance-critical code.

---

## 3. Comparable Types

### Why Before How

Go maps require keys to be comparable — the runtime uses equality (`==`) to look up keys. Some types in Go cannot be compared with `==` at all: slices, maps, and functions. If you try to use them as map keys, the compiler rejects it. Understanding which types are comparable also matters for writing generic code with the `comparable` constraint.

```go
package main

import "fmt"

// Struct is comparable if ALL its fields are comparable
type Point struct {
	X, Y int
}

// This struct is NOT comparable because it contains a slice
type BadKey struct {
	Name  string
	Tags  []string // slices are not comparable
}

// Connection key — all fields are comparable, usable as map key
type ConnKey struct {
	SrcIP   string
	DstIP   string
	SrcPort uint16
	DstPort uint16
}

func main() {
	// Comparable: bool, int, float, complex, string, pointer, channel, array, struct (if fields are comparable)
	p1 := Point{1, 2}
	p2 := Point{1, 2}
	p3 := Point{3, 4}

	fmt.Println(p1 == p2) // true — struct equality is field-by-field
	fmt.Println(p1 == p3) // false

	// Struct as map key (all fields are comparable)
	connections := map[ConnKey]int{}
	connections[ConnKey{"1.2.3.4", "5.6.7.8", 54321, 443}] = 1
	connections[ConnKey{"1.2.3.4", "5.6.7.8", 54321, 443}]++ // increment
	fmt.Println("Connection count:", connections[ConnKey{"1.2.3.4", "5.6.7.8", 54321, 443}])

	// Arrays are comparable (unlike slices)
	arr1 := [3]int{1, 2, 3}
	arr2 := [3]int{1, 2, 3}
	fmt.Println(arr1 == arr2) // true

	// NOT comparable — will not compile if you try to use as map key or compare with ==
	// var s1 []int = []int{1, 2}
	// var s2 []int = []int{1, 2}
	// fmt.Println(s1 == s2)  // COMPILE ERROR: slice can only be compared to nil

	// Nil check on slice IS allowed
	var s []int
	fmt.Println(s == nil) // true — this is the only allowed slice comparison
}
```

**Comparable in Generics**: The `comparable` constraint means a type parameter can be used with `==` and as a map key. It does not mean the type supports `<` or `>` (that requires `constraints.Ordered`).

---

## 4. Generics (Go 1.18+)

### Why Before How

Before generics, Go developers wrote the same algorithm multiple times for different types, or used `interface{}` and lost type safety. The canonical example: a function to find the maximum value in a slice had to be written separately for `int`, `float64`, `string`, etc. Generics solve this with type parameters — placeholders for types that are filled in at compile time. Unlike Java generics (type erasure at runtime), Go generics are reified: the compiler may generate specialized code per type, making them as fast as non-generic versions.

```go
package main

import (
	"fmt"
)

// Basic generic function — T can be any comparable type
func Contains[T comparable](slice []T, item T) bool {
	for _, v := range slice {
		if v == item {
			return true
		}
	}
	return false
}

// Map: transform every element (T → U)
func Map[T, U any](slice []T, fn func(T) U) []U {
	result := make([]U, len(slice))
	for i, v := range slice {
		result[i] = fn(v)
	}
	return result
}

// Filter: keep elements matching a predicate
func Filter[T any](slice []T, fn func(T) bool) []T {
	var result []T
	for _, v := range slice {
		if fn(v) {
			result = append(result, v)
		}
	}
	return result
}

// Reduce: fold a slice to a single value
func Reduce[T, Acc any](slice []T, initial Acc, fn func(Acc, T) Acc) Acc {
	acc := initial
	for _, v := range slice {
		acc = fn(acc, v)
	}
	return acc
}

// Custom constraint: types that support < and >
// In production, use golang.org/x/exp/constraints.Ordered
type Ordered interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
		~float32 | ~float64 | ~string
}

// The ~ means "this type OR any named type with this underlying type"
// So ~int includes: int, type MyInt int, type UserID int, etc.
func Max[T Ordered](a, b T) T {
	if a > b {
		return a
	}
	return b
}

func Min[T Ordered](slice []T) T {
	if len(slice) == 0 {
		panic("empty slice")
	}
	m := slice[0]
	for _, v := range slice[1:] {
		if v < m {
			m = v
		}
	}
	return m
}

// Generic Stack data structure
type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(item T) {
	s.items = append(s.items, item)
}

func (s *Stack[T]) Pop() (T, bool) {
	var zero T
	if len(s.items) == 0 {
		return zero, false
	}
	top := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	return top, true
}

func (s *Stack[T]) Len() int {
	return len(s.items)
}

func main() {
	// Contains works for any comparable type
	fmt.Println(Contains([]int{1, 2, 3}, 2))           // true
	fmt.Println(Contains([]string{"a", "b"}, "c"))      // false

	// Map: double each int, convert to string
	doubled := Map([]int{1, 2, 3, 4}, func(n int) int { return n * 2 })
	fmt.Println(doubled) // [2 4 6 8]

	words := Map([]int{1, 2, 3}, func(n int) string {
		return fmt.Sprintf("item%d", n)
	})
	fmt.Println(words) // [item1 item2 item3]

	// Filter: keep evens
	evens := Filter([]int{1, 2, 3, 4, 5, 6}, func(n int) bool { return n%2 == 0 })
	fmt.Println(evens) // [2 4 6]

	// Reduce: sum
	sum := Reduce([]int{1, 2, 3, 4, 5}, 0, func(acc, n int) int { return acc + n })
	fmt.Println("sum:", sum) // 15

	// Max with different types
	fmt.Println(Max(3, 7))       // 7
	fmt.Println(Max(3.14, 2.71)) // 3.14
	fmt.Println(Max("apple", "banana")) // banana

	// Named type satisfying ~int constraint
	type Score int
	var s1, s2 Score = 85, 92
	fmt.Println(Max(s1, s2)) // 92

	// Generic Stack
	var intStack Stack[int]
	intStack.Push(10)
	intStack.Push(20)
	intStack.Push(30)
	if v, ok := intStack.Pop(); ok {
		fmt.Println("popped:", v) // 30
	}
	fmt.Println("stack length:", intStack.Len()) // 2
}
```

### When to Use Generics vs interface{}

| Situation | Use |
|-----------|-----|
| Collection utilities (Map, Filter, Reduce, Contains) | Generics |
| Function that operates on ANY type with no type-specific behavior | `any` / `interface{}` |
| Behavior varies by type (different logic per type) | Interface with methods |
| Need to inspect concrete type at runtime | Type switch on interface |
| Algorithm that works on numbers, strings (ordered types) | Generic with `Ordered` constraint |

---

## 5. Type Conversions

### Why Before How

Go has no implicit type conversion. This is a deliberate design choice — in C, implicit integer promotions and float-to-int truncations have caused countless bugs (famously the Ariane 5 rocket explosion was partly a numeric overflow from an implicit conversion). In Go, every conversion is written explicitly, so code reviewers and future maintainers can see exactly where type boundaries are crossed.

```go
package main

import (
	"fmt"
	"math"
	"unsafe"
)

func main() {
	// --- Numeric conversions (all explicit) ---
	var i int = 42
	var f float64 = float64(i) // must be explicit
	var u uint = uint(f)       // truncates decimal, must be explicit
	fmt.Println(i, f, u)       // 42 42 42

	// Truncation — the programmer must acknowledge this
	var big float64 = 3.99
	var truncated int = int(big) // 3, not 4 — truncation, not rounding
	fmt.Println(truncated)

	// Overflow — Go wraps around silently for integer types
	var max8 int8 = 127
	wrapped := int8(max8 + 1) // wraps to -128
	fmt.Println(wrapped)       // -128

	// Safer approach: check before converting
	bigVal := 300
	if bigVal > math.MaxInt8 {
		fmt.Println("value too large for int8")
	}

	// --- String conversions ---
	// int → string: converts the Unicode code point, NOT the decimal number
	r := rune(65)
	s := string(r)       // "A", not "65"
	fmt.Println(s)       // A

	// To get "65", use fmt.Sprintf or strconv
	numStr := fmt.Sprintf("%d", 65) // "65"
	fmt.Println(numStr)

	// []byte ↔ string (common in network code)
	b := []byte("hello")
	b[0] = 'H'
	back := string(b) // creates a new string (strings are immutable)
	fmt.Println(back) // Hello

	// --- Named type conversions ---
	type Meters float64
	type Feet float64

	m := Meters(1.0)
	// Explicit conversion between named types with same underlying type
	f2 := Feet(m * 3.28084)
	fmt.Printf("%.2f meters = %.2f feet\n", m, f2)

	// --- Unsafe conversions (use with extreme caution) ---
	// unsafe.Pointer allows reinterpreting memory
	// Only valid use: interop with C, or very specific performance optimizations
	x := uint64(0x0102030405060708)
	p := unsafe.Pointer(&x)
	// Reinterpret the uint64 as an array of 8 bytes
	bytes := (*[8]byte)(p)
	fmt.Printf("bytes: %v\n", bytes[:])
	// NOTE: byte order depends on platform endianness
}
```

**Common Pitfall**: `string(65)` returns `"A"` (the Unicode character), not `"65"`. This is a frequent source of bugs when converting integer IDs to strings for logging. Always use `strconv.Itoa(n)` or `fmt.Sprintf("%d", n)`.

---

## 6. Reflection Basics

### Why Before How

Reflection is the ability of a program to inspect and manipulate its own types and values at runtime. Go's type system is static — the compiler resolves types. But some problems genuinely require runtime type inspection: JSON marshaling cannot know at compile time what struct fields to serialize (the struct is passed as `interface{}`), ORM libraries cannot know the schema of user-defined models, and testing frameworks need to call arbitrary functions by name.

Reflection is expensive: it bypasses the type system, involves interface boxing, and prevents compiler optimizations. It is a tool for framework/library code, not for everyday application code.

```go
package main

import (
	"fmt"
	"reflect"
)

type User struct {
	ID    int    `json:"id" db:"user_id"`
	Name  string `json:"name" db:"full_name"`
	Email string `json:"email,omitempty" db:"email"`
	age   int    // unexported — reflect cannot set this from outside the package
}

func (u User) Greet() string {
	return "Hello, " + u.Name
}

func inspectType(v any) {
	t := reflect.TypeOf(v)
	val := reflect.ValueOf(v)

	fmt.Printf("Type: %v\n", t)
	fmt.Printf("Kind: %v\n", t.Kind())

	// Dereference pointer if needed
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
		val = val.Elem()
	}

	if t.Kind() != reflect.Struct {
		fmt.Println("Not a struct")
		return
	}

	fmt.Printf("Struct: %s with %d fields\n", t.Name(), t.NumField())
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		value := val.Field(i)

		// Read struct tags (used by encoding/json, gorm, etc.)
		jsonTag := field.Tag.Get("json")
		dbTag := field.Tag.Get("db")

		fmt.Printf("  Field: %-10s Type: %-8v Value: %-15v json:%q db:%q exported:%v\n",
			field.Name, field.Type, value, jsonTag, dbTag, field.IsExported())
	}

	// Inspect methods
	fmt.Printf("\nMethods on %s:\n", t.Name())
	// Methods on the value type
	vt := reflect.TypeOf(v)
	for i := 0; i < vt.NumMethod(); i++ {
		m := vt.Method(i)
		fmt.Printf("  Method: %s\n", m.Name)
	}
}

// Simplified JSON-like serializer using reflection
// This is how encoding/json works internally
func toMap(v any) map[string]any {
	result := map[string]any{}
	t := reflect.TypeOf(v)
	val := reflect.ValueOf(v)

	if t.Kind() == reflect.Ptr {
		t = t.Elem()
		val = val.Elem()
	}
	if t.Kind() != reflect.Struct {
		return result
	}

	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue // skip unexported fields
		}
		key := field.Name
		// Use json tag if present
		if tag := field.Tag.Get("json"); tag != "" && tag != "-" {
			// strip options like ,omitempty
			for j, c := range tag {
				if c == ',' {
					tag = tag[:j]
					break
				}
			}
			key = tag
		}
		result[key] = val.Field(i).Interface()
	}
	return result
}

// Reflect-based function caller — demonstrates dynamic dispatch
func callMethod(v any, methodName string, args ...any) {
	val := reflect.ValueOf(v)
	method := val.MethodByName(methodName)
	if !method.IsValid() {
		fmt.Printf("method %s not found\n", methodName)
		return
	}

	in := make([]reflect.Value, len(args))
	for i, arg := range args {
		in[i] = reflect.ValueOf(arg)
	}

	results := method.Call(in)
	for _, r := range results {
		fmt.Printf("Result: %v\n", r.Interface())
	}
}

func main() {
	u := User{ID: 1, Name: "Alice", Email: "alice@example.com", age: 30}

	fmt.Println("=== Type Inspection ===")
	inspectType(u)

	fmt.Println("\n=== Pointer Inspection ===")
	inspectType(&u)

	fmt.Println("\n=== Struct to Map ===")
	m := toMap(u)
	for k, v := range m {
		fmt.Printf("  %s: %v\n", k, v)
	}

	fmt.Println("\n=== Dynamic Method Call ===")
	callMethod(u, "Greet")
	callMethod(u, "NonExistent")

	// reflect.TypeOf vs reflect.ValueOf
	fmt.Println("\n=== Type vs Value ===")
	x := 42
	fmt.Println(reflect.TypeOf(x))  // int
	fmt.Println(reflect.ValueOf(x)) // 42

	// Modifying values through reflection (requires pointer)
	ptr := &u
	v := reflect.ValueOf(ptr).Elem()
	v.FieldByName("Name").SetString("Bob")
	fmt.Println("Modified name:", u.Name) // Bob
}
```

### Reflection Performance Cost

```go
package main

import (
	"fmt"
	"reflect"
	"time"
)

type Point struct{ X, Y int }

func directAccess(p Point) int {
	return p.X + p.Y
}

func reflectAccess(p any) int {
	v := reflect.ValueOf(p)
	x := int(v.FieldByName("X").Int())
	y := int(v.FieldByName("Y").Int())
	return x + y
}

func main() {
	p := Point{X: 3, Y: 4}
	const iterations = 1_000_000

	// Direct access benchmark
	start := time.Now()
	total := 0
	for i := 0; i < iterations; i++ {
		total += directAccess(p)
	}
	directTime := time.Since(start)

	// Reflection access benchmark
	start = time.Now()
	total2 := 0
	for i := 0; i < iterations; i++ {
		total2 += reflectAccess(p)
	}
	reflectTime := time.Since(start)

	fmt.Printf("Direct:     %v (total=%d)\n", directTime, total)
	fmt.Printf("Reflection: %v (total=%d)\n", reflectTime, total2)
	fmt.Printf("Reflect is ~%.0fx slower\n", float64(reflectTime)/float64(directTime))
	// Typical output: Reflection is ~10-50x slower
}
```

**When reflection is acceptable:**
- Serialization/deserialization (encoding/json, encoding/xml) — runs once per request, not in inner loops
- ORM schema mapping (GORM, sqlx) — runs at startup or per-query, not millions of times per second
- Test frameworks (testify assertions) — tests are not production hot paths
- Code generation input — reflect at init time, generate Go code, compile away the reflection

**When to avoid reflection:**
- Hot loops processing millions of events per second
- Any code on the critical path of a latency-sensitive service
- When a generic function or interface would solve the same problem

---

## 7. Putting It All Together: A Type-Safe Event System

This example combines named types, interfaces, type switches, generics, and comparability into a realistic production pattern.

```go
package main

import (
	"fmt"
	"time"
)

// Named types for domain concepts
type EventID string
type UserID int64
type TopicID string

// Comparable struct usable as map key
type EventKey struct {
	Topic TopicID
	ID    EventID
}

// Interface: structural typing — any type with these methods is an Event
type Event interface {
	EventID() EventID
	Timestamp() time.Time
	Topic() TopicID
}

// Concrete event types
type UserCreated struct {
	id        EventID
	ts        time.Time
	UserIDVal UserID
	Email     string
}

type OrderPlaced struct {
	id      EventID
	ts      time.Time
	UserID  UserID
	Amount  float64
	Items   int
}

type SystemAlert struct {
	id       EventID
	ts       time.Time
	Severity string
	Message  string
}

// Implement Event interface for all types
func (e UserCreated) EventID() EventID    { return e.id }
func (e UserCreated) Timestamp() time.Time { return e.ts }
func (e UserCreated) Topic() TopicID      { return "users" }

func (e OrderPlaced) EventID() EventID    { return e.id }
func (e OrderPlaced) Timestamp() time.Time { return e.ts }
func (e OrderPlaced) Topic() TopicID      { return "orders" }

func (e SystemAlert) EventID() EventID    { return e.id }
func (e SystemAlert) Timestamp() time.Time { return e.ts }
func (e SystemAlert) Topic() TopicID      { return "system" }

// Generic event bus — type-safe for the key, flexible for the value
type EventBus[K comparable] struct {
	events map[K][]Event
}

func NewEventBus[K comparable]() *EventBus[K] {
	return &EventBus[K]{events: make(map[K][]Event)}
}

func (b *EventBus[K]) Publish(key K, e Event) {
	b.events[key] = append(b.events[key], e)
}

func (b *EventBus[K]) Subscribe(key K) []Event {
	return b.events[key]
}

// Type switch dispatcher — routes events to handlers
func dispatch(e Event) {
	switch v := e.(type) {
	case UserCreated:
		fmt.Printf("[USER]   %s — new user %d <%s>\n", v.Timestamp().Format("15:04:05"), v.UserIDVal, v.Email)
	case OrderPlaced:
		fmt.Printf("[ORDER]  %s — user %d placed order: %d items, $%.2f\n",
			v.Timestamp().Format("15:04:05"), v.UserID, v.Items, v.Amount)
	case SystemAlert:
		fmt.Printf("[ALERT]  %s — [%s] %s\n", v.Timestamp().Format("15:04:05"), v.Severity, v.Message)
	default:
		fmt.Printf("[UNKNOWN] event type: %T id=%s\n", v, v.EventID())
	}
}

func main() {
	now := time.Now()

	events := []Event{
		UserCreated{id: "evt-001", ts: now, UserIDVal: 101, Email: "alice@example.com"},
		OrderPlaced{id: "evt-002", ts: now.Add(time.Second), UserID: 101, Amount: 59.99, Items: 3},
		SystemAlert{id: "evt-003", ts: now.Add(2 * time.Second), Severity: "WARN", Message: "high memory usage"},
		UserCreated{id: "evt-004", ts: now.Add(3 * time.Second), UserIDVal: 102, Email: "bob@example.com"},
	}

	fmt.Println("=== Dispatching Events ===")
	for _, e := range events {
		dispatch(e)
	}

	// Generic event bus keyed by TopicID (comparable)
	bus := NewEventBus[TopicID]()
	for _, e := range events {
		bus.Publish(e.Topic(), e)
	}

	fmt.Println("\n=== User Events ===")
	for _, e := range bus.Subscribe("users") {
		dispatch(e)
	}

	fmt.Println("\n=== Order Events ===")
	for _, e := range bus.Subscribe("orders") {
		dispatch(e)
	}

	// EventKey as a map key (comparable struct)
	seen := map[EventKey]bool{}
	for _, e := range events {
		key := EventKey{Topic: e.Topic(), ID: e.EventID()}
		seen[key] = true
	}
	fmt.Printf("\n=== Deduplication Map: %d unique events ===\n", len(seen))
}
```

---

## Summary: Go Type System Decision Tree

```
Do you need to operate on multiple types with the same logic?
  → YES: Is the behavior identical (just different types)?
      → YES: Use GENERICS (type parameters)
      → NO:  Does behavior vary per type? Use INTERFACES
  → NO: Use concrete types

Do you need semantic type safety (prevent mixing int IDs)?
  → YES: Use NAMED TYPES (type UserID int64)

Do you need to recover a concrete type from an interface?
  → ONE type:  Use safe assertion: v, ok := x.(ConcreteType)
  → MANY types: Use TYPE SWITCH

Do you need runtime type inspection for serialization/ORM?
  → YES: Use REFLECT (sparingly, not in hot paths)

Do you need the same type under a different name for refactoring?
  → YES: Use TYPE ALIAS (type NewName = OldName)
```

**Key Rules to Internalize:**
1. Go has NO implicit type conversion — every crossing of a type boundary is visible in code.
2. Named types are not just aliases — they create new types that the compiler tracks separately.
3. Interface satisfaction is structural — no `implements` keyword required.
4. Type assertions can panic — always use the two-return form in production.
5. `comparable` means usable with `==` and as a map key — slices, maps, and functions are not comparable.
6. Generics use reified types — the compiler generates specialized code, making them as fast as hand-written versions.
7. Reflection is 10-50x slower than direct access — use it in framework code, not hot paths.
