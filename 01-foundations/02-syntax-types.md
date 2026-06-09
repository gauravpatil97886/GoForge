# Basic Syntax & Data Types

## Variables & Constants

```go
// Explicit declaration
var name string = "Go"
var count int = 42

// Short declaration (inside functions only)
name := "Go"
count := 42

// Constants
const maxRetries = 3
const defaultTimeout = 30 * time.Second
```

## Data Types

### Primitive Types
```go
bool       // true, false
string     // "hello"
int, int64 // 42
float64    // 3.14
byte       // uint8, alias for uint8
rune       // int32, unicode code point
```

### Zero Values
```go
var s string    // "" (empty string)
var n int       // 0
var b bool      // false
var f float64   // 0.0
```

## Collections

### Arrays (fixed size)
```go
var arr [3]int
arr = [3]int{1, 2, 3}
arr[0] = 10
len(arr)
```

### Slices (dynamic size)
```go
slice := []int{1, 2, 3}
slice = append(slice, 4)
slice = slice[1:]        // slice from index 1 onward
len(slice)
cap(slice)               // capacity
```

### Maps
```go
m := make(map[string]int)
m["one"] = 1
m["two"] = 2

value, ok := m["one"]    // comma-ok form
delete(m, "one")
```

## Type Conversions

```go
i := 42
f := float64(i)
s := fmt.Sprint(i)
```

## Practice

1. Create variables of each primitive type
2. Create arrays, slices, and maps
3. Use the comma-ok form to check map values

## Next Steps
→ Learn [Functions & Methods](./03-functions-methods.md)
