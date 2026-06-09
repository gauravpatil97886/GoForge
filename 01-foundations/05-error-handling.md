# Error Handling

## The error Interface

```go
type error interface {
    Error() string
}
```

All errors implement this interface.

## Returning Errors

```go
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

result, err := divide(10, 2)
if err != nil {
    log.Fatal(err)
}
```

## Creating Custom Errors

### Simple: errors.New()
```go
err := errors.New("something went wrong")
```

### Formatted: fmt.Errorf()
```go
err := fmt.Errorf("failed to parse config: %w", parseErr)
```

### Custom Type
```go
type ValidationError struct {
    Field string
    Value interface{}
}

func (e ValidationError) Error() string {
    return fmt.Sprintf("invalid %s: %v", e.Field, e.Value)
}

err := ValidationError{Field: "email", Value: "invalid@"}
```

## Error Wrapping (Go 1.13+)

```go
// Wrap an error
if err != nil {
    return fmt.Errorf("operation failed: %w", err)
}

// Unwrap it
if errors.Is(err, io.EOF) {
    // handle EOF
}

// Check for type
var typeErr *os.PathError
if errors.As(err, &typeErr) {
    fmt.Println("Path error:", typeErr.Path)
}
```

## defer + recover for Panics

```go
func safeOperation() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("Recovered from panic:", r)
        }
    }()
    
    // code that might panic
}
```

**Note**: Use error returns normally. Panic is for truly exceptional situations.

## Best Practices

✅ **DO**:
- Return errors, not panics
- Wrap errors with context: `fmt.Errorf("failed: %w", err)`
- Check errors immediately after operations
- Provide meaningful error messages

❌ **DON'T**:
- Ignore errors with `_ = err`
- Panic for expected errors
- Use error returns for control flow when not exceptional

## Practice

1. Write functions that return errors
2. Use errors.Is() and errors.As()
3. Create a custom error type
4. Practice wrapping errors

## Next Steps
→ Continue to [LEVEL 2: Intermediate Concepts](../02-intermediate/01-packages-modules.md)
