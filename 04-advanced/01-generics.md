# Go Generics

## What Is This?

Generics (introduced in Go 1.18, February 2022) let you write functions and data structures that work with any type while keeping full compile-time type safety. Instead of writing the same logic for `[]int`, `[]string`, and `[]float64` separately — or collapsing everything into `interface{}` and losing type information — you write one version parameterized by a type variable, and the compiler generates the specific code for each concrete type you actually use.

## Why Does It Exist?

Before Go 1.18, Go had two unsatisfying options for type-agnostic code:

1. **`interface{}`** — accept any value, but lose all type information. Every consumer needs a runtime type assertion (`v.(string)`), which can panic. The compiler cannot catch type mismatches. IDE tooling gets no autocomplete.
2. **Code generation** (`go generate` + stringer, genny, etc.) — write one template, generate one file per type. Correct, but painful to maintain: every new type requires another code-gen run, the generated files litter the repo, diffs are noisy.

Neither option was acceptable for something as common as "a sorted list" or "a set of T". The Go team resisted generics for over a decade because every proposed design either added too much complexity or too much runtime cost. The final design (based on GCShape stenciling) achieves near-zero runtime overhead while keeping the syntax minimal and the mental model simple. Without generics, the entire Go ecosystem duplicated utility code endlessly — each major project had its own `MapSlice`, `FilterSlice`, `ContainsKey` functions written for concrete types.

## Who Uses This in Industry?

- **Google**: The `golang.org/x/exp/slices` and `golang.org/x/exp/maps` packages (now promoted to stdlib in Go 1.21 as `slices` and `maps`) use generics to replace the dozens of hand-rolled helpers scattered across internal codebases. Google's internal Go monorepo enforces use of `slices.Contains` over manual loops.
- **Uber**: Uber's `fx` dependency injection framework uses generic constraints in its v2 rewrite to give compile-time guarantees on `Provide`/`Invoke` calls that previously required runtime reflection checks.
- **Kubernetes**: The `controller-runtime` library uses `client.Object` constraints and generic reconciler scaffolding so teams can write typed reconcilers — `Reconciler[*appsv1.Deployment]` — instead of casting from `unstructured.Unstructured` everywhere.
- **Cloudflare**: Workers infrastructure tooling uses generic result/option types (`Result[T, E]`, `Option[T]`) instead of the classic `(value, error)` tuple, making pipelines compositional without losing type info.
- **samber/lo**: The most-starred Go utility library post-1.18. It is pure generics: `lo.Filter`, `lo.Map`, `lo.Reduce`, `lo.GroupBy`, etc. Over 16k GitHub stars as of 2025. This library exists entirely because generics exist.
- **HashiCorp Terraform**: Provider SDK uses generic collection helpers to reduce boilerplate in schema handling across hundreds of resource types.

## Industry Standards & Best Practices

**Senior engineers do:**
- Add type parameters only when the same algorithm applies to multiple types and duplication would be the alternative.
- Write constraint interfaces in a shared `constraints` package so they can be reused across the codebase.
- Use `~T` (underlying type) in constraints to accept both named types and their bases (e.g., `type UserID int` satisfies `~int`).
- Rely on type inference — never write `Map[string, int](slice, fn)` when `Map(slice, fn)` infers correctly.
- Benchmark generic vs. interface{} code; for hot paths with value types generics are faster because they avoid heap allocation.

**Beginners tend to:**
- Reach for generics reflexively for every function that touches multiple types, creating unreadable signatures.
- Define constraints inline in function signatures instead of naming them.
- Add generics to functions that already work fine with interfaces (e.g., `io.Reader` — don't generify this).

**The canonical rule**: If you're writing the same code body twice for different types, consider generics. If you're writing code that needs to accept "anything that implements a behavior", use an interface.

## Why Go's Approach Is Unique

**Java** generics use type erasure: the JVM sees `List<Object>` at runtime, so you can't do `new T()` or create `T[]`. Go's generics use GCShape stenciling: the compiler creates one copy of the code per "shape" (same memory layout + GC pointer map), so `Stack[int]` and `Stack[int32]` may share an implementation while `Stack[*User]` gets its own. This is a middle ground between C++ (full monomorphization, code bloat) and Java (full erasure, runtime overhead).

**Python** generics (typing module) are purely for static analysis (mypy/pyright). They have zero runtime effect. Go generics are enforced by the compiler.

**C++ templates** are Turing-complete and evaluated at compile time — you can do arithmetic, recursion, and pattern matching in templates. Go deliberately chose not to go there. No template metaprogramming. No specialization (you can't write a fast-path for `Stack[int]` vs. the general `Stack[T]`). The tradeoff: simpler, faster compiler; predictable compile times; much easier to understand a Go generic function by reading it once.

**TypeScript** generics are closest to Go's in feel but live in a structurally-typed world. Go is nominally typed (two structs with identical fields are not the same type), which makes Go's constraint system more rigorous.

---

## 1. The Problem Generics Solve — Before and After

### Before Go 1.18: The interface{} Tax

```go
package main

import "fmt"

// Before generics: one function per type, or lose safety
func SumInts(nums []int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func SumFloat64s(nums []float64) float64 {
    total := 0.0
    for _, n := range nums {
        total += n
    }
    return total
}

// Or: accept interface{} and panic at runtime on bad input
func SumAny(nums []interface{}) interface{} {
    // Must type-assert every value. Can panic.
    total := 0
    for _, n := range nums {
        total += n.(int) // runtime panic if not int
    }
    return total
}

func main() {
    ints := []int{1, 2, 3, 4, 5}
    floats := []float64{1.1, 2.2, 3.3}

    fmt.Println(SumInts(ints))
    fmt.Println(SumFloat64s(floats))
    // SumAny needs []interface{} - can't pass []int directly
}
```

**Pitfall**: `SumAny` above will panic on any non-int value — and the compiler cannot warn you. You only find out at runtime.

---

## 2. Basic Type Parameters — Your First Generic Function

WHY: A type parameter is a placeholder filled in at compile time. The compiler checks that every operation you perform on the parameter is valid for the type the caller provides.

```go
package main

import "fmt"

// Map transforms a slice of type T into a slice of type U.
// T and U can be any types — the constraint "any" means no restriction.
// The compiler generates the appropriate code for each concrete (T, U) pair used.
func Map[T, U any](s []T, fn func(T) U) []U {
    result := make([]U, len(s))
    for i, v := range s {
        result[i] = fn(v)
    }
    return result
}

// Filter returns elements of s for which keep returns true.
func Filter[T any](s []T, keep func(T) bool) []T {
    var result []T
    for _, v := range s {
        if keep(v) {
            result = append(result, v)
        }
    }
    return result
}

// Reduce folds a slice into a single value.
func Reduce[T, Acc any](s []T, initial Acc, fn func(Acc, T) Acc) Acc {
    acc := initial
    for _, v := range s {
        acc = fn(acc, v)
    }
    return acc
}

func main() {
    nums := []int{1, 2, 3, 4, 5}

    // Map: []int -> []string
    strs := Map(nums, func(n int) string {
        return fmt.Sprintf("item-%d", n)
    })
    fmt.Println(strs) // [item-1 item-2 item-3 item-4 item-5]

    // Filter: keep even numbers
    evens := Filter(nums, func(n int) bool { return n%2 == 0 })
    fmt.Println(evens) // [2 4]

    // Reduce: sum
    sum := Reduce(nums, 0, func(acc, n int) int { return acc + n })
    fmt.Println(sum) // 15

    // Works on strings too — same functions, different types
    words := []string{"hello", "world", "go"}
    lengths := Map(words, func(s string) int { return len(s) })
    fmt.Println(lengths) // [5 5 2]
}
```

**Pitfall**: `any` as a constraint means you can only use operations defined on ALL types: assignment, comparison (only if comparable), passing to functions. You cannot call methods, add, or index without a more specific constraint.

---

## 3. Type Constraints — Restricting What T Can Be

WHY: `any` is too permissive for math. You need to tell the compiler "T must support the `+` operator." Constraints are interfaces that list what types are acceptable.

```go
package main

import "fmt"

// Number is a constraint: T must be one of these types.
// The | syntax creates a union of acceptable types.
type Number interface {
    int | int8 | int16 | int32 | int64 |
        uint | uint8 | uint16 | uint32 | uint64 |
        float32 | float64
}

// Sum works on any numeric slice — compile-time safe.
func Sum[T Number](nums []T) T {
    var total T // zero value of T
    for _, n := range nums {
        total += n // safe because Number guarantees + operator
    }
    return total
}

// Min returns the minimum of two values.
// "comparable" is a built-in constraint: supports == and !=.
// "ordered" would be needed for <; use the golang.org/x/exp/constraints package
// or define it inline:
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
        ~float32 | ~float64 | ~string
}

func Min[T Ordered](a, b T) T {
    if a < b {
        return a
    }
    return b
}

func Max[T Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}

func main() {
    fmt.Println(Sum([]int{1, 2, 3}))         // 6
    fmt.Println(Sum([]float64{1.5, 2.5}))    // 4
    fmt.Println(Min(3, 7))                    // 3
    fmt.Println(Min("apple", "banana"))       // apple
    fmt.Println(Max(3.14, 2.71))              // 3.14
}
```

**Pitfall**: Without the `~` prefix, a named type like `type Celsius float64` would NOT satisfy `float64` in the constraint. With `~float64`, it does. Always use `~` for constraints that should apply to all types with a given underlying type.

---

## 4. The Tilde (~) and Underlying Types

WHY: In Go, `type Celsius float64` is a distinct type from `float64`. A constraint of `float64` would reject `Celsius`. The `~` prefix says "accept any type whose underlying type is float64", which includes named types.

```go
package main

import "fmt"

type Celsius float64
type Fahrenheit float64
type Meters float64
type Feet float64

// ~float64 accepts float64, Celsius, Fahrenheit, Meters, Feet — all of them
type PhysicalUnit interface {
    ~float64
}

func Add[T PhysicalUnit](a, b T) T {
    return a + b
}

func Scale[T PhysicalUnit](v T, factor float64) T {
    return T(float64(v) * factor)
}

// comparable is built-in: any type that supports == and !=
// Useful for Sets, Maps, deduplication
func Contains[T comparable](slice []T, item T) bool {
    for _, v := range slice {
        if v == item {
            return true
        }
    }
    return false
}

func Deduplicate[T comparable](slice []T) []T {
    seen := make(map[T]struct{})
    result := []T{}
    for _, v := range slice {
        if _, ok := seen[v]; !ok {
            seen[v] = struct{}{}
            result = append(result, v)
        }
    }
    return result
}

func main() {
    fmt.Println(Add(Celsius(100), Celsius(50)))        // 150
    fmt.Println(Add(Meters(5.0), Meters(3.0)))         // 8

    fmt.Println(Scale(Celsius(100), 1.5))              // 150
    fmt.Println(Scale(Feet(6.0), 0.5))                 // 3

    nums := []int{1, 2, 3, 2, 1, 4}
    fmt.Println(Deduplicate(nums))                     // [1 2 3 4]

    words := []string{"go", "rust", "go", "java"}
    fmt.Println(Deduplicate(words))                    // [go rust java]

    fmt.Println(Contains(nums, 3))    // true
    fmt.Println(Contains(words, "c")) // false
}
```

**Pitfall**: You cannot use `~` with interface types or pointer types. `~*int` is not valid. The underlying type in `~T` must be a non-interface, non-pointer type.

---

## 5. Generic Structs — Data Structures That Work for Any Type

WHY: Before generics, every Go project had a `type Stack struct { items []interface{} }` with type assertions scattered everywhere. Now you write it once.

```go
package main

import (
    "errors"
    "fmt"
)

// Stack[T] is a generic LIFO stack.
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(item T) {
    s.items = append(s.items, item)
}

func (s *Stack[T]) Pop() (T, error) {
    var zero T
    if len(s.items) == 0 {
        return zero, errors.New("stack is empty")
    }
    top := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return top, nil
}

func (s *Stack[T]) Peek() (T, error) {
    var zero T
    if len(s.items) == 0 {
        return zero, errors.New("stack is empty")
    }
    return s.items[len(s.items)-1], nil
}

func (s *Stack[T]) Size() int { return len(s.items) }
func (s *Stack[T]) IsEmpty() bool { return len(s.items) == 0 }

// Optional[T] represents a value that may or may not be present.
// Like Rust's Option<T> or Java's Optional<T>.
type Optional[T any] struct {
    value   T
    present bool
}

func Some[T any](v T) Optional[T] { return Optional[T]{value: v, present: true} }
func None[T any]() Optional[T]    { return Optional[T]{} }

func (o Optional[T]) Get() (T, bool)  { return o.value, o.present }
func (o Optional[T]) IsPresent() bool { return o.present }
func (o Optional[T]) OrElse(defaultVal T) T {
    if o.present {
        return o.value
    }
    return defaultVal
}

func main() {
    // Typed stack — no type assertions needed
    intStack := &Stack[int]{}
    intStack.Push(10)
    intStack.Push(20)
    intStack.Push(30)

    v, _ := intStack.Pop()
    fmt.Println(v)            // 30
    fmt.Println(intStack.Size()) // 2

    // String stack — same implementation, different type
    strStack := &Stack[string]{}
    strStack.Push("hello")
    strStack.Push("world")
    top, _ := strStack.Peek()
    fmt.Println(top) // world

    // Optional
    name := Some("Alice")
    missing := None[string]()

    fmt.Println(name.OrElse("unknown"))    // Alice
    fmt.Println(missing.OrElse("unknown")) // unknown

    if v, ok := name.Get(); ok {
        fmt.Println("Got:", v) // Got: Alice
    }
}
```

**Pitfall**: Note the method receiver syntax `func (s *Stack[T])` — you include the type parameter in the receiver but you do NOT add a new constraint there. The constraint is declared on the struct definition only.

---

## 6. Multiple Type Parameters and Pairs

WHY: Some algorithms naturally involve two types — a key and a value, two halves of a zip, or input/output of a transform. Multiple type parameters express this cleanly.

```go
package main

import "fmt"

// Pair holds two values of potentially different types.
type Pair[A, B any] struct {
    First  A
    Second B
}

func MakePair[A, B any](a A, b B) Pair[A, B] {
    return Pair[A, B]{First: a, Second: b}
}

// Zip combines two slices element-by-element into a slice of Pairs.
// If slices have different lengths, stops at the shorter one.
func Zip[A, B any](a []A, b []B) []Pair[A, B] {
    n := len(a)
    if len(b) < n {
        n = len(b)
    }
    result := make([]Pair[A, B], n)
    for i := 0; i < n; i++ {
        result[i] = Pair[A, B]{First: a[i], Second: b[i]}
    }
    return result
}

// Unzip splits a slice of Pairs back into two slices.
func Unzip[A, B any](pairs []Pair[A, B]) ([]A, []B) {
    as := make([]A, len(pairs))
    bs := make([]B, len(pairs))
    for i, p := range pairs {
        as[i] = p.First
        bs[i] = p.Second
    }
    return as, bs
}

// MapToSlice converts a map into a slice of Pairs.
// Useful when you need ordered iteration.
func MapToSlice[K comparable, V any](m map[K]V) []Pair[K, V] {
    result := make([]Pair[K, V], 0, len(m))
    for k, v := range m {
        result = append(result, Pair[K, V]{First: k, Second: v})
    }
    return result
}

func main() {
    names := []string{"Alice", "Bob", "Charlie"}
    ages := []int{30, 25, 35}

    zipped := Zip(names, ages)
    for _, p := range zipped {
        fmt.Printf("%s is %d years old\n", p.First, p.Second)
    }
    // Alice is 30 years old
    // Bob is 25 years old
    // Charlie is 35 years old

    backNames, backAges := Unzip(zipped)
    fmt.Println(backNames) // [Alice Bob Charlie]
    fmt.Println(backAges)  // [30 25 35]

    scores := map[string]int{"math": 95, "science": 87}
    pairs := MapToSlice(scores)
    fmt.Printf("Found %d subjects\n", len(pairs)) // Found 2 subjects

    p := MakePair("hello", 42)
    fmt.Println(p.First, p.Second) // hello 42
}
```

---

## 7. Custom Constraint Interfaces — Organizing Constraints

WHY: When multiple functions need the same set of type restrictions, define a named constraint interface. This is the same as defining a named interface for behavior, just applied to generics.

```go
package main

import "fmt"

// Stringer constraint: T must have a String() method.
// Note: this is different from fmt.Stringer — we define our own for illustration.
type Stringable interface {
    String() string
}

// Numeric captures all integer and float types for math operations.
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
        ~float32 | ~float64
}

// SignedInteger captures only signed integers.
type SignedInteger interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}

// Abs returns the absolute value of a signed integer.
func Abs[T SignedInteger](v T) T {
    if v < 0 {
        return -v
    }
    return v
}

// Clamp restricts v to [min, max].
func Clamp[T Numeric](v, min, max T) T {
    if v < min {
        return min
    }
    if v > max {
        return max
    }
    return v
}

// Average computes the mean of a slice of numbers.
func Average[T Numeric](nums []T) float64 {
    if len(nums) == 0 {
        return 0
    }
    var sum T
    for _, n := range nums {
        sum += n
    }
    return float64(sum) / float64(len(nums))
}

// PrintAll prints any slice of Stringable values.
func PrintAll[T Stringable](items []T) {
    for _, item := range items {
        fmt.Println(item.String())
    }
}

type Point struct{ X, Y float64 }

func (p Point) String() string {
    return fmt.Sprintf("(%.1f, %.1f)", p.X, p.Y)
}

type Color struct{ R, G, B uint8 }

func (c Color) String() string {
    return fmt.Sprintf("#%02X%02X%02X", c.R, c.G, c.B)
}

func main() {
    fmt.Println(Abs(-42))         // 42
    fmt.Println(Abs(int32(-100))) // 100

    fmt.Println(Clamp(150, 0, 100))     // 100
    fmt.Println(Clamp(-5, 0, 100))      // 0
    fmt.Println(Clamp(50.0, 0.0, 100.0)) // 50

    fmt.Printf("%.2f\n", Average([]int{1, 2, 3, 4, 5}))       // 3.00
    fmt.Printf("%.2f\n", Average([]float64{1.5, 2.5, 3.5}))   // 2.50

    points := []Point{{1, 2}, {3, 4}, {5, 6}}
    PrintAll(points)
    // (1.0, 2.0)
    // (3.0, 4.0)
    // (5.0, 6.0)

    colors := []Color{{255, 0, 0}, {0, 255, 0}, {0, 0, 255}}
    PrintAll(colors)
    // #FF0000
    // #00FF00
    // #0000FF
}
```

**Pitfall**: A constraint interface can contain type sets (union types) OR method signatures, but not both in the same interface used as a constraint. As of Go 1.21, you cannot write `interface { ~int; String() string }` as a type constraint — the compiler rejects it when used in a generic. Define separate constraints and embed them if needed.

---

## 8. Type Inference — When You Can Omit Type Parameters

WHY: Writing `Map[string, int](slice, fn)` is verbose. Go's type inference engine can deduce type parameters from the argument types in most cases. You should rely on inference — only specify type parameters when inference fails.

```go
package main

import "fmt"

func Identity[T any](v T) T { return v }

func Keys[K comparable, V any](m map[K]V) []K {
    result := make([]K, 0, len(m))
    for k := range m {
        result = append(result, k)
    }
    return result
}

func Values[K comparable, V any](m map[K]V) []V {
    result := make([]V, 0, len(m))
    for _, v := range m {
        result = append(result, v)
    }
    return result
}

func Ptr[T any](v T) *T { return &v }

func Must[T any](v T, err error) T {
    if err != nil {
        panic(err)
    }
    return v
}

func main() {
    // Type inference works: Go sees the argument type and deduces T
    fmt.Println(Identity(42))       // no need for Identity[int](42)
    fmt.Println(Identity("hello"))  // no need for Identity[string]("hello")
    fmt.Println(Identity(3.14))     // no need for Identity[float64](3.14)

    m := map[string]int{"a": 1, "b": 2, "c": 3}

    // K and V inferred from map type
    keys := Keys(m)
    fmt.Println(len(keys)) // 3

    vals := Values(m)
    fmt.Println(len(vals)) // 3

    // Ptr: T inferred from argument
    p := Ptr(42)
    fmt.Println(*p) // 42

    sp := Ptr("hello")
    fmt.Println(*sp) // hello

    // When inference fails: no argument to infer from
    // Must specify explicitly:
    // none := None[string]() — no argument, so T must be explicit
    // keys2 := Keys[string, int](m) — explicit, but unnecessary here

    // Must: useful for ignoring errors in tests/main
    // result := Must(strconv.Atoi("42")) — T inferred as int
    fmt.Println("Type inference eliminates boilerplate")
}
```

**Pitfall**: Inference works for function calls but NOT for struct instantiation. `Stack{}` is a compile error — you must write `Stack[int]{}` or `Stack[string]{}`. The compiler cannot infer struct type parameters from an empty literal.

---

## 9. Standard Library Generic Functions (Go 1.21+)

WHY: Go 1.21 added `slices` and `maps` packages with generic functions. These replace hand-rolled helpers and produce idiomatic, efficient code. Every Go project should use them instead of manual loops for common operations.

```go
package main

import (
    "cmp"
    "fmt"
    "maps"
    "slices"
)

type Employee struct {
    Name   string
    Salary float64
    Dept   string
}

func main() {
    nums := []int{5, 2, 8, 1, 9, 3, 7, 4, 6}

    // slices.Sort — generic sort, works on any ordered type
    sorted := slices.Clone(nums) // don't mutate original
    slices.Sort(sorted)
    fmt.Println(sorted) // [1 2 3 4 5 6 7 8 9]

    // slices.SortFunc — sort by custom key
    employees := []Employee{
        {"Alice", 90000, "Engineering"},
        {"Bob", 75000, "Marketing"},
        {"Charlie", 95000, "Engineering"},
    }
    slices.SortFunc(employees, func(a, b Employee) int {
        return cmp.Compare(b.Salary, a.Salary) // descending by salary
    })
    for _, e := range employees {
        fmt.Printf("%-10s $%.0f\n", e.Name, e.Salary)
    }
    // Charlie    $95000
    // Alice      $90000
    // Bob        $75000

    // slices.Contains — replaces manual Contains loops
    words := []string{"go", "rust", "python", "java"}
    fmt.Println(slices.Contains(words, "go"))    // true
    fmt.Println(slices.Contains(words, "cobol")) // false

    // slices.Index — find first index
    fmt.Println(slices.Index(words, "rust")) // 1
    fmt.Println(slices.Index(words, "c"))    // -1

    // slices.Max / slices.Min
    fmt.Println(slices.Max(nums)) // 9
    fmt.Println(slices.Min(nums)) // 1

    // slices.Reverse — in-place
    rev := slices.Clone(nums)
    slices.Reverse(rev)
    fmt.Println(rev) // [6 4 7 3 9 1 8 2 5]

    // maps.Keys / maps.Values
    scores := map[string]int{"Alice": 95, "Bob": 87, "Charlie": 92}
    keys := slices.Sorted(maps.Keys(scores))
    fmt.Println(keys) // [Alice Bob Charlie]

    vals := slices.Collect(maps.Values(scores))
    fmt.Println(len(vals)) // 3

    // maps.Clone — deep copy of map
    copy := maps.Clone(scores)
    copy["Dave"] = 78
    fmt.Println(len(scores), len(copy)) // 3 4 (original unchanged)
}
```

**Pitfall**: `slices.Sort` requires an `Ordered` constraint. It will NOT compile for slices of custom structs. Use `slices.SortFunc` with a comparator for structs.

---

## 10. Generic Limitations — What Go Generics Cannot Do

WHY: Understanding the limitations helps you decide when generics are the right tool and when to use interfaces, code generation, or a different design.

```go
package main

import "fmt"

// LIMITATION 1: No specialization
// You cannot write a "fast path" for a specific type T.
// In C++ you can specialize a template for int. Go cannot.

// This is the only way — one implementation for all T:
func StringifySlice[T any](items []T) []string {
    result := make([]string, len(items))
    for i, v := range items {
        result[i] = fmt.Sprintf("%v", v)
    }
    return result
}

// LIMITATION 2: No generic methods (only generic functions and types)
// This is INVALID Go:
//
// type Processor struct{}
// func (p Processor) Process[T any](v T) T { return v }  // compile error
//
// Workaround: use a generic function instead of a generic method.

type Processor[T any] struct{} // Generic TYPE is fine

func (p Processor[T]) Process(v T) T { return v } // Method on generic type is fine

// LIMITATION 3: No variance
// In Java, List<Integer> is a subtype of List<Number> (covariance).
// In Go, Stack[int] is NOT assignable to Stack[Number].
// This is intentional — Go chose invariance for simplicity.

// LIMITATION 4: Cannot use type parameters as keys in type switches
func typeCheck[T any](v T) string {
    // This does NOT work:
    // switch v.(type) {  <-- compile error, T is not an interface
    //
    // Workaround: convert to interface{} first (loses generic benefits)
    switch any(v).(type) {
    case int:
        return "int"
    case string:
        return "string"
    default:
        return "other"
    }
}

// LIMITATION 5: Cannot instantiate T directly (no "new T()" like Java)
// Workaround: use *new(T) to get zero value, or require a factory function
func ZeroOf[T any]() T {
    var zero T
    return zero // this works for the zero value
}

// LIMITATION 6: No operator overloading means generic math needs constraints
// You can add constraints for built-in operators, but not for custom ones

func main() {
    ints := []int{1, 2, 3}
    strs := []string{"a", "b", "c"}

    fmt.Println(StringifySlice(ints)) // [1 2 3]
    fmt.Println(StringifySlice(strs)) // [a b c]

    p := Processor[int]{}
    fmt.Println(p.Process(42)) // 42

    fmt.Println(typeCheck(42))       // int
    fmt.Println(typeCheck("hello"))  // string
    fmt.Println(typeCheck(3.14))     // other

    fmt.Println(ZeroOf[int]())    // 0
    fmt.Println(ZeroOf[string]()) // (empty string)
}
```

---

## 11. When to Use Generics vs. Interfaces vs. Code Generation

WHY: Using the wrong tool creates complexity. This decision tree covers the three main Go approaches to type-agnostic code.

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

// ============================================================
// USE AN INTERFACE when: you need behavioral polymorphism.
// "Any type that can do X" — accept the interface, not a type param.
// ============================================================

// Good: interface-based. Any type that implements io.Reader works.
func ReadAll(r io.Reader) ([]byte, error) {
    buf := make([]byte, 0, 512)
    tmp := make([]byte, 512)
    for {
        n, err := r.Read(tmp)
        buf = append(buf, tmp[:n]...)
        if err == io.EOF {
            return buf, nil
        }
        if err != nil {
            return nil, err
        }
    }
}

// Bad: don't genericize this — io.Reader IS the right abstraction
// func ReadAllGeneric[T io.Reader](r T) ([]byte, error) { ... }
// This adds no value: you can't call r.Read without the interface anyway.

// ============================================================
// USE GENERICS when: same algorithm, multiple concrete types, no shared interface.
// ============================================================

// Good: generics for collection algorithms
func GroupBy[T any, K comparable](items []T, key func(T) K) map[K][]T {
    result := make(map[K][]T)
    for _, item := range items {
        k := key(item)
        result[k] = append(result[k], item)
    }
    return result
}

// Good: generics for type-safe data structures
type Result[T any] struct {
    Value T
    Err   error
}

func OK[T any](v T) Result[T]  { return Result[T]{Value: v} }
func Err[T any](e error) Result[T] { return Result[T]{Err: e} }

func (r Result[T]) Unwrap() T {
    if r.Err != nil {
        panic(r.Err)
    }
    return r.Value
}

// ============================================================
// USE CODE GENERATION when: the logic per type is different, or performance
// requires zero overhead and specialization.
// Example: protobuf, stringer, database row scanners.
// ============================================================

type Person struct {
    Name string
    Age  int
    Dept string
}

func main() {
    // Interface example
    r := strings.NewReader("hello, go generics")
    data, _ := ReadAll(r)
    fmt.Println(string(data)) // hello, go generics

    // Generics example
    people := []Person{
        {"Alice", 30, "Engineering"},
        {"Bob", 25, "Marketing"},
        {"Charlie", 35, "Engineering"},
        {"Dave", 28, "Marketing"},
    }

    byDept := GroupBy(people, func(p Person) string { return p.Dept })
    fmt.Println("Engineering:", len(byDept["Engineering"])) // 2
    fmt.Println("Marketing:", len(byDept["Marketing"]))     // 2

    // Result type
    r1 := OK(42)
    fmt.Println(r1.Unwrap()) // 42

    r2 := OK("hello")
    fmt.Println(r2.Unwrap()) // hello
}
```

**Summary table:**

| Situation | Use |
|-----------|-----|
| "Any type that implements behavior X" | Interface |
| "Same algorithm for multiple unrelated types" | Generics |
| "Different logic per type, or maximum performance" | Code generation |
| "Existing code uses `interface{}`" | Migrate to generics if type safety matters |

---

## 12. Real-World Generic Utility Package

WHY: A production Go codebase consolidates generic utilities into a shared package. This shows what that looks like at scale.

```go
package main

import (
    "fmt"
    "sort"
    "strings"
)

// --- Collection utilities ---

func Map[T, U any](s []T, fn func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s {
        out[i] = fn(v)
    }
    return out
}

func Filter[T any](s []T, fn func(T) bool) []T {
    var out []T
    for _, v := range s {
        if fn(v) {
            out = append(out, v)
        }
    }
    return out
}

func Reduce[T, Acc any](s []T, init Acc, fn func(Acc, T) Acc) Acc {
    acc := init
    for _, v := range s {
        acc = fn(acc, v)
    }
    return acc
}

func GroupBy[T any, K comparable](s []T, key func(T) K) map[K][]T {
    m := make(map[K][]T)
    for _, v := range s {
        k := key(v)
        m[k] = append(m[k], v)
    }
    return m
}

func Chunk[T any](s []T, size int) [][]T {
    var chunks [][]T
    for size < len(s) {
        s, chunks = s[size:], append(chunks, s[0:size:size])
    }
    return append(chunks, s)
}

func Flatten[T any](nested [][]T) []T {
    var result []T
    for _, inner := range nested {
        result = append(result, inner...)
    }
    return result
}

// --- Map utilities ---

func MapKeys[K comparable, V any](m map[K]V) []K {
    keys := make([]K, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    return keys
}

func MapValues[K comparable, V any](m map[K]V) []V {
    vals := make([]V, 0, len(m))
    for _, v := range m {
        vals = append(vals, v)
    }
    return vals
}

func MapFilter[K comparable, V any](m map[K]V, fn func(K, V) bool) map[K]V {
    result := make(map[K]V)
    for k, v := range m {
        if fn(k, v) {
            result[k] = v
        }
    }
    return result
}

// --- Demo ---

type Order struct {
    ID       int
    Customer string
    Amount   float64
    Status   string
}

func main() {
    orders := []Order{
        {1, "Alice", 150.00, "completed"},
        {2, "Bob", 75.50, "pending"},
        {3, "Alice", 200.00, "completed"},
        {4, "Charlie", 50.00, "cancelled"},
        {5, "Bob", 300.00, "completed"},
    }

    // Get all completed orders
    completed := Filter(orders, func(o Order) bool {
        return o.Status == "completed"
    })
    fmt.Printf("Completed orders: %d\n", len(completed)) // 3

    // Get customer names (deduplicated manually for demo)
    names := Map(orders, func(o Order) string { return o.Customer })
    sort.Strings(names)
    fmt.Println("Customers:", strings.Join(names, ", "))

    // Total revenue from completed orders
    revenue := Reduce(completed, 0.0, func(acc float64, o Order) float64 {
        return acc + o.Amount
    })
    fmt.Printf("Total revenue: $%.2f\n", revenue) // $650.00

    // Group by customer
    byCustomer := GroupBy(orders, func(o Order) string { return o.Customer })
    for customer, orders := range byCustomer {
        total := Reduce(orders, 0.0, func(acc float64, o Order) float64 {
            return acc + o.Amount
        })
        fmt.Printf("%s: %d orders, $%.2f total\n", customer, len(orders), total)
    }

    // Chunk orders into batches of 2
    batches := Chunk(orders, 2)
    fmt.Printf("Batches: %d (sizes: %d, %d, %d)\n",
        len(batches), len(batches[0]), len(batches[1]), len(batches[2]))
}
```

---

## Key Takeaways

1. **Generics = compile-time type safety without code duplication.** The alternative was `interface{}` (runtime panics) or copy-paste (maintenance hell).

2. **Use `~T` in constraints** to accept named types with underlying type `T`. Without it, `type Celsius float64` fails a `float64` constraint.

3. **Rely on type inference** — only write explicit type parameters when the compiler cannot infer them (struct literals, functions with no typed arguments).

4. **Generic structs need the type parameter in the receiver** (`func (s *Stack[T])`) but constraints are only stated in the struct definition.

5. **No generic methods** — if you need a method to be generic, either make the struct generic or make a standalone generic function.

6. **The standard library now has `slices` and `maps` packages** (Go 1.21). Use them. They are battle-tested, generic, and replace the most common hand-rolled helpers.

7. **Generics ≠ interfaces.** If the algorithm needs to call a method or satisfy a behavior, use an interface. If the algorithm is purely structural (sort, filter, group), use generics.
