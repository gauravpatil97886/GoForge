# Functions & Methods

## Functions

### Basic Function
```go
func add(a, b int) int {
    return a + b
}

result := add(2, 3)
```

### Multiple Return Values
```go
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, fmt.Errorf("division by zero")
    }
    return a / b, nil
}

result, err := divide(10, 2)
```

### Named Return Values
```go
func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return  // implicit return x, y
}
```

### Variadic Functions
```go
func sum(numbers ...int) int {
    total := 0
    for _, n := range numbers {
        total += n
    }
    return total
}

sum(1, 2, 3, 4, 5)
```

## Methods

Methods are functions with a receiver.

```go
type Rectangle struct {
    width, height float64
}

// Receiver syntax: func (receiver ReceiverType) MethodName()
func (r Rectangle) Area() float64 {
    return r.width * r.height
}

// Pointer receiver (can modify)
func (r *Rectangle) Scale(factor float64) {
    r.width *= factor
    r.height *= factor
}

rect := Rectangle{width: 10, height: 5}
fmt.Println(rect.Area())      // 50
rect.Scale(2)                 // Now 20x10
```

## Function Values & Callbacks

```go
// Functions are first-class values
var fn func(int) int = func(x int) int {
    return x * 2
}

result := fn(5)  // 10
```

## Defer

```go
func example() {
    defer fmt.Println("third")
    fmt.Println("first")
    defer fmt.Println("second")
    // Output: first, second, third (LIFO stack)
}
```

## Closures

```go
func makeCounter() func() int {
    count := 0
    return func() int {
        count++
        return count
    }
}

counter := makeCounter()
counter()  // 1
counter()  // 2
```

## Practice

1. Write a function with multiple return values
2. Implement methods on a struct
3. Create a function that returns a function
4. Use defer in a context like file handling

## Next Steps
→ Learn [Interfaces & Polymorphism](./04-interfaces.md)
