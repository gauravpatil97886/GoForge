# Pointers & Memory Management

## Understanding Pointers

```go
var x int = 42
var p *int = &x        // & = address-of, pointer to x

*p = 100               // * = dereference, modify x
fmt.Println(x)         // 100
```

## Pointer Receivers

```go
type Point struct {
    X, Y float64
}

// Value receiver - method gets a copy
func (p Point) Distance() float64 {
    return math.Sqrt(p.X*p.X + p.Y*p.Y)
}

// Pointer receiver - method can modify the original
func (p *Point) Scale(factor float64) {
    p.X *= factor
    p.Y *= factor
}

point := Point{3, 4}
point.Scale(2)         // Works - compiler auto-derefs
```

## When to Use Pointers

✅ **Use pointer receiver when:**
- Method modifies the receiver
- Receiver is large struct (avoid copying)
- For consistency with other methods

✅ **Use value receiver when:**
- Receiver won't be modified
- Receiver is small
- It's safe to share copies

## nil Pointers

```go
var p *int
p == nil               // true

*p = 42                // PANIC - nil dereference
```

Always check nil before dereferencing:
```go
if p != nil {
    value := *p
}
```

## Memory Model & Sync

Pointers and goroutines interact via the memory model:
- Data races are undefined behavior
- Use channels/mutex for safe concurrent access
- See Part 7 of Concurrency Guide

## Common Patterns

### Option Pattern
```go
type Config struct {
    Timeout time.Duration
}

func New(timeout time.Duration) *Config {
    c := &Config{Timeout: timeout}
    return c
}
```

### Escaping to Heap

```go
func makePoint() *Point {
    p := Point{1, 2}
    return &p              // p escapes to heap
}
```

Use `go build -m` to see escape analysis.

---

**Next:** [Structs & Embedded Types](./03-structs-embedding.md)
