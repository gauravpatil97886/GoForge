# Interfaces & Polymorphism

## What is an Interface?

An interface is a set of method signatures. Any type that implements all methods satisfies the interface.

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

## Implicit Satisfaction

Go has no `implements` keyword. Any type with matching method signatures **automatically** satisfies the interface.

```go
type MyReader struct {
    data string
}

func (mr MyReader) Read(p []byte) (n int, err error) {
    // implementation
    return len(p), nil
}

// MyReader now satisfies Reader interface automatically!
var r Reader = MyReader{data: "hello"}
```

## Interface Types

### Empty Interface
Matches any type:

```go
var i interface{}
i = 42
i = "hello"
i = []int{1, 2, 3}
```

### Type Assertion
```go
value := i.(string)   // panics if not a string

value, ok := i.(string)  // safer, returns ok bool
if ok {
    fmt.Println("String value:", value)
}
```

### Type Switch
```go
switch v := i.(type) {
case string:
    fmt.Println("String:", v)
case int:
    fmt.Println("Integer:", v)
default:
    fmt.Println("Unknown type")
}
```

## Composition with Interfaces

```go
type Shape interface {
    Area() float64
}

type Circle struct {
    radius float64
}

func (c Circle) Area() float64 {
    return math.Pi * c.radius * c.radius
}

// Polymorphism through interface
func printArea(s Shape) {
    fmt.Printf("Area: %f\n", s.Area())
}

printArea(Circle{radius: 5})
```

## Common Interfaces

```go
// io package
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

// fmt package
type Stringer interface {
    String() string
}

type error interface {
    Error() string
}
```

## Practice

1. Define your own interface
2. Create two types that satisfy it
3. Write a function that accepts the interface
4. Use type assertion and type switch

## Next Steps
→ Learn [Error Handling](./05-error-handling.md)
