# Go Reflection

## What Is This?

Reflection is Go's ability to inspect and manipulate values, types, and struct metadata at runtime — when the exact types are not known at compile time. Using the `reflect` package, your code can ask "what type is this value?", "what fields does this struct have?", and "what is the value of this field?" without knowing the answer at compile time. You can even set field values, call methods, and create new values dynamically.

## Why Does It Exist?

Go is a statically typed language: the compiler knows every type at compile time and rejects programs that misuse them. This is exactly what you want for application code. But some categories of code are fundamentally type-agnostic: a JSON encoder cannot know in advance the struct you'll pass it. A dependency injection container cannot know in advance which types your application will register. An ORM cannot know in advance your database model structs.

Before reflection existed as a proper abstraction, these tools would require either: (a) you to implement a code-generation step, (b) you to hand-write a serializer for every struct, or (c) the runtime to expose an unsafe, undocumented mechanism. The `reflect` package provides a safe, documented way to write code that is generic over types at runtime, not compile time. It is the foundation that makes `encoding/json`, `encoding/gob`, `database/sql` struct scanning, and frameworks like `wire` and `GORM` possible in Go.

## Who Uses This in Industry?

- **Google**: The `encoding/json` package in Go's standard library is maintained by Google and uses reflection as its core mechanism. Every Go HTTP API that calls `json.Marshal` is using reflection. At Google scale, this covers millions of services.
- **Uber**: `uber-go/fx` (Uber's dependency injection framework) uses reflection to inspect the parameter and return types of constructor functions at startup, wiring the dependency graph automatically without code generation.
- **HashiCorp (Terraform, Vault, Consul)**: The `mapstructure` library (written by HashiCorp's Mitchell Hashimoto) uses reflection to decode maps of `interface{}` values into concrete structs — critical for reading HCL/JSON configuration files into typed Go structs.
- **GORM** (used by thousands of companies): The GORM ORM uses reflection to read struct field tags like `` `gorm:"column:user_name;primaryKey"` `` to build SQL queries, map result rows back to struct fields, and generate schema migrations.
- **Kubernetes**: The `controller-runtime` library's informer cache uses reflection to handle arbitrary resource types. The `apimachinery` package uses `reflect.DeepEqual` for diffing object states.
- **Docker**: The Docker daemon uses reflection in its API serialization layer to handle versioned API structs across client/server boundaries.

## Industry Standards & Best Practices

**Senior engineers do:**
- Cache `reflect.Type` values at package init time, not inside hot paths. `reflect.TypeOf(MyStruct{})` is an allocation — computing it once and storing it in a package-level variable is standard.
- Use struct tags as metadata anchors. The `encoding/json` tag convention (`json:"field_name,omitempty"`) is the standard — every major library follows the same pattern.
- Add reflection only at framework/library boundaries. Application code almost never needs direct reflection; it uses the frameworks (json, sql, etc.) that do.
- Validate reflection-based code with real structs in tests, since compiler type-checking does not cover reflection errors.
- Write fallbacks: when a field is not found or a type assertion fails, return a clear error rather than panicking.

**Beginners tend to:**
- Use reflection where a simple interface would suffice. If you can express the behavior as a method on an interface, do that — it's 10-100x faster.
- Panic on `reflect.Value.Interface()` when called on unexported fields (which reflection cannot access).
- Call `Value.Set()` on non-addressable values (only values obtained via `reflect.New` or pointer dereference are addressable/settable).

**The canonical rule**: Reflection is a last resort for application code and a first resort for framework/tooling code. When writing a library that operates on arbitrary user-defined types, reflection is the right tool. When writing business logic, it is almost always wrong.

## Why Go's Approach Is Unique

**Java** reflection is deeply embedded in the JVM and historically central to Spring, Hibernate, and JAX-RS. It's powerful but encourages annotation-heavy, magic-filled code. Java also recently added `java.lang.invoke.MethodHandles` for faster reflective calls.

**Python** treats everything as a dictionary lookup at runtime — there is no sharp line between normal code and "reflective" code. `getattr(obj, 'name')` is idiomatic Python, not an escape hatch.

**JavaScript/Node** has no real compile-time types, so runtime type inspection is built into the language (`typeof`, `instanceof`, `Object.keys`).

**Go's approach**: Reflection is explicitly marked as an advanced tool by living in a separate package (`reflect`). The performance cost is visible: `reflect.ValueOf(x)` boxes `x` into an interface, which may heap-allocate. The API is intentionally verbose to discourage casual use. Go also added generics (1.18) specifically to reduce the number of cases where reflection is needed — `encoding/json` is being gradually rewritten with generics internally. This "reflection is powerful but expensive and verbose" design philosophy makes Go codebases readable: when you see `reflect.`, you know something unusual is happening.

---

## 1. reflect.TypeOf and reflect.ValueOf — The Entry Points

WHY: Everything in the reflect package starts from these two functions. `TypeOf` gives you metadata about the type. `ValueOf` gives you a handle on the actual data. They are the bridge from static Go to the dynamic reflection world.

```go
package main

import (
    "fmt"
    "reflect"
)

type Person struct {
    Name string
    Age  int
}

func main() {
    // Basic types
    x := 42
    s := "hello"
    f := 3.14

    fmt.Println(reflect.TypeOf(x)) // int
    fmt.Println(reflect.TypeOf(s)) // string
    fmt.Println(reflect.TypeOf(f)) // float64

    // Value operations
    vx := reflect.ValueOf(x)
    fmt.Println(vx.Type())     // int
    fmt.Println(vx.Kind())     // int
    fmt.Println(vx.Int())      // 42
    fmt.Println(vx.Interface()) // 42 (back to interface{})

    // Struct
    p := Person{"Alice", 30}
    tp := reflect.TypeOf(p)
    vp := reflect.ValueOf(p)

    fmt.Println(tp)          // main.Person
    fmt.Println(tp.Kind())   // struct  (Kind is always a basic category)
    fmt.Println(tp.Name())   // Person  (Name is the type name within its package)
    fmt.Println(tp.PkgPath()) // main   (package where it's defined)

    // Value from struct
    fmt.Println(vp.Field(0).String()) // Alice
    fmt.Println(vp.Field(1).Int())    // 30

    // Pointer
    pp := &p
    tpp := reflect.TypeOf(pp)
    fmt.Println(tpp)           // *main.Person
    fmt.Println(tpp.Kind())    // ptr
    fmt.Println(tpp.Elem())    // main.Person (the type being pointed to)
    fmt.Println(tpp.Elem().Kind()) // struct
}
```

**Pitfall**: `reflect.ValueOf(x)` when `x` is a value (not a pointer) gives you a non-addressable, non-settable value. You cannot call `.Set()` on it. To modify a value via reflection, you must pass a pointer.

---

## 2. Kinds vs Types — Understanding the Distinction

WHY: This distinction trips up every Go developer new to reflection. `Type` is specific (`main.Person`, `int`, `[]string`). `Kind` is the underlying category (`struct`, `int`, `slice`). You switch on `Kind` to write generic handling code; you compare `Type` for exact type matching.

```go
package main

import (
    "fmt"
    "reflect"
)

type UserID int
type Email string
type Scores []float64

func describeValue(v interface{}) {
    t := reflect.TypeOf(v)
    val := reflect.ValueOf(v)

    fmt.Printf("Type: %-20s Kind: %-10s", t, val.Kind())

    switch val.Kind() {
    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
        fmt.Printf("Value: %d\n", val.Int())
    case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
        fmt.Printf("Value: %d\n", val.Uint())
    case reflect.Float32, reflect.Float64:
        fmt.Printf("Value: %f\n", val.Float())
    case reflect.String:
        fmt.Printf("Value: %q\n", val.String())
    case reflect.Bool:
        fmt.Printf("Value: %t\n", val.Bool())
    case reflect.Slice:
        fmt.Printf("Len: %d\n", val.Len())
    case reflect.Struct:
        fmt.Printf("Fields: %d\n", val.NumField())
    case reflect.Ptr:
        fmt.Printf("Elem: %s\n", t.Elem())
    default:
        fmt.Printf("Value: %v\n", val.Interface())
    }
}

func main() {
    describeValue(42)
    describeValue(UserID(100))
    describeValue("hello")
    describeValue(Email("test@example.com"))
    describeValue(3.14)
    describeValue(true)
    describeValue([]int{1, 2, 3})
    describeValue(Scores{9.5, 8.7})

    // Type comparison vs Kind comparison
    var uid UserID = 99
    t := reflect.TypeOf(uid)

    fmt.Println(t == reflect.TypeOf(int(0)))    // false: UserID != int
    fmt.Println(t.Kind() == reflect.TypeOf(int(0)).Kind()) // true: both Kind == int
}
```

**Pitfall**: Never compare `reflect.Kind` to a type directly. `val.Kind() == reflect.TypeOf(int(0))` will not compile — `Kind()` returns `reflect.Kind` (an int), not `reflect.Type`. Compare kinds with the `reflect.Int`, `reflect.String`, etc. constants.

---

## 3. Struct Field Iteration — Reading Names, Types, and Tags

WHY: The `encoding/json` package, `GORM`, `mapstructure`, and virtually every marshaling/unmarshaling library in Go uses this exact mechanism. They read struct tags at startup (or first use) to know how to serialize each field.

```go
package main

import (
    "fmt"
    "reflect"
)

type User struct {
    ID        int     `json:"id" db:"user_id" validate:"required"`
    Name      string  `json:"name" db:"full_name" validate:"required,min=2"`
    Email     string  `json:"email" db:"email_address" validate:"required,email"`
    Password  string  `json:"-" db:"password_hash"` // json:"-" means omit in JSON
    Age       int     `json:"age,omitempty" db:"age"`
    internal  string  // unexported — reflection can see it but cannot read its value
}

func inspectStruct(v interface{}) {
    t := reflect.TypeOf(v)
    if t.Kind() == reflect.Ptr {
        t = t.Elem()
    }
    if t.Kind() != reflect.Struct {
        fmt.Println("not a struct")
        return
    }

    fmt.Printf("Struct: %s (%d fields)\n", t.Name(), t.NumField())
    fmt.Println(strings.Repeat("-", 60))

    for i := 0; i < t.NumField(); i++ {
        field := t.Field(i) // reflect.StructField

        exported := field.IsExported()
        jsonTag := field.Tag.Get("json")
        dbTag := field.Tag.Get("db")
        validateTag := field.Tag.Get("validate")

        fmt.Printf("Field: %-12s Type: %-8s Exported: %-5t\n",
            field.Name, field.Type, exported)
        if jsonTag != "" {
            fmt.Printf("  json: %q\n", jsonTag)
        }
        if dbTag != "" {
            fmt.Printf("  db:   %q\n", dbTag)
        }
        if validateTag != "" {
            fmt.Printf("  validate: %q\n", validateTag)
        }
    }
}

// Simulate what encoding/json does: map field names to their indexes
func buildJSONMapping(t reflect.Type) map[string]int {
    if t.Kind() == reflect.Ptr {
        t = t.Elem()
    }
    mapping := make(map[string]int)
    for i := 0; i < t.NumField(); i++ {
        field := t.Field(i)
        if !field.IsExported() {
            continue
        }
        jsonTag := field.Tag.Get("json")
        if jsonTag == "-" {
            continue // skip this field
        }
        name := field.Name
        if jsonTag != "" {
            // json:"name,omitempty" -> take only "name" part
            parts := strings.SplitN(jsonTag, ",", 2)
            if parts[0] != "" {
                name = parts[0]
            }
        }
        mapping[name] = i
    }
    return mapping
}

import "strings"

func main() {
    inspectStruct(User{})

    mapping := buildJSONMapping(reflect.TypeOf(User{}))
    fmt.Println("\nJSON field name -> struct index:")
    for name, idx := range mapping {
        fmt.Printf("  %q -> field[%d]\n", name, idx)
    }
}
```

**Pitfall**: `field.Tag.Get("json")` returns the raw tag string including options like `",omitempty"`. You almost always need to split on `,` to get just the field name. Libraries like `encoding/json` do this split internally — replicate it if building your own marshaler.

---

## 4. Setting Values — Modifying Struct Fields via Reflection

WHY: ORMs, configuration loaders, and mock frameworks need to write values into struct fields. This requires the value to be addressable (passed as a pointer) and the field to be exported.

```go
package main

import (
    "fmt"
    "reflect"
    "strconv"
)

type Config struct {
    Host    string
    Port    int
    Debug   bool
    Timeout float64
}

// FillFromMap fills a struct's fields from a map[string]string.
// This is what libraries like envconfig and mapstructure do.
func FillFromMap(dest interface{}, data map[string]string) error {
    // dest must be a pointer to a struct
    v := reflect.ValueOf(dest)
    if v.Kind() != reflect.Ptr || v.Elem().Kind() != reflect.Struct {
        return fmt.Errorf("dest must be a pointer to a struct")
    }

    v = v.Elem() // dereference the pointer to get the struct value
    t := v.Type()

    for i := 0; i < t.NumField(); i++ {
        field := t.Field(i)
        fieldVal := v.Field(i)

        if !field.IsExported() {
            continue // cannot set unexported fields
        }

        strVal, ok := data[field.Name]
        if !ok {
            continue // no value provided for this field
        }

        // Set the field based on its Kind
        switch field.Type.Kind() {
        case reflect.String:
            fieldVal.SetString(strVal)

        case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
            n, err := strconv.ParseInt(strVal, 10, 64)
            if err != nil {
                return fmt.Errorf("field %s: cannot parse %q as int: %w", field.Name, strVal, err)
            }
            fieldVal.SetInt(n)

        case reflect.Bool:
            b, err := strconv.ParseBool(strVal)
            if err != nil {
                return fmt.Errorf("field %s: cannot parse %q as bool: %w", field.Name, strVal, err)
            }
            fieldVal.SetBool(b)

        case reflect.Float32, reflect.Float64:
            f, err := strconv.ParseFloat(strVal, 64)
            if err != nil {
                return fmt.Errorf("field %s: cannot parse %q as float: %w", field.Name, strVal, err)
            }
            fieldVal.SetFloat(f)
        }
    }
    return nil
}

func main() {
    cfg := &Config{}

    data := map[string]string{
        "Host":    "localhost",
        "Port":    "8080",
        "Debug":   "true",
        "Timeout": "30.5",
    }

    if err := FillFromMap(cfg, data); err != nil {
        fmt.Println("Error:", err)
        return
    }

    fmt.Printf("Host: %s\n", cfg.Host)      // localhost
    fmt.Printf("Port: %d\n", cfg.Port)      // 8080
    fmt.Printf("Debug: %t\n", cfg.Debug)    // true
    fmt.Printf("Timeout: %.1f\n", cfg.Timeout) // 30.5

    // Direct field set by name
    v := reflect.ValueOf(cfg).Elem()
    v.FieldByName("Host").SetString("production.example.com")
    fmt.Println(cfg.Host) // production.example.com
}
```

**Pitfall**: If you call `reflect.ValueOf(cfg)` where `cfg` is NOT a pointer, you get a non-addressable value and `.Set()` will panic with "reflect: reflect.Value.SetString using value obtained using unexported field" or "reflect.Value.SetString using unaddressable value". Always pass a pointer.

---

## 5. Calling Methods Dynamically

WHY: Dependency injection frameworks, plugin systems, and RPC dispatchers need to call methods without knowing their signatures at compile time. `MethodByName` + `Call` makes this possible.

```go
package main

import (
    "fmt"
    "reflect"
)

type Calculator struct {
    Memory float64
}

func (c *Calculator) Add(a, b float64) float64      { return a + b }
func (c *Calculator) Subtract(a, b float64) float64 { return a - b }
func (c *Calculator) Multiply(a, b float64) float64 { return a * b }
func (c *Calculator) Store(v float64)               { c.Memory = v }
func (c *Calculator) Recall() float64               { return c.Memory }

// dispatch calls a method by name with given arguments using reflection.
func dispatch(obj interface{}, methodName string, args ...interface{}) ([]interface{}, error) {
    v := reflect.ValueOf(obj)
    method := v.MethodByName(methodName)
    if !method.IsValid() {
        return nil, fmt.Errorf("method %q not found on %T", methodName, obj)
    }

    // Convert args to []reflect.Value
    in := make([]reflect.Value, len(args))
    for i, arg := range args {
        in[i] = reflect.ValueOf(arg)
    }

    // Call the method
    out := method.Call(in)

    // Convert results back to []interface{}
    results := make([]interface{}, len(out))
    for i, r := range out {
        results[i] = r.Interface()
    }
    return results, nil
}

// listMethods prints all exported methods of a value.
func listMethods(obj interface{}) {
    t := reflect.TypeOf(obj)
    fmt.Printf("Methods on %s:\n", t)
    for i := 0; i < t.NumMethod(); i++ {
        m := t.Method(i)
        fmt.Printf("  %s%s\n", m.Name, m.Type.String()[len(t.String()):])
    }
}

func main() {
    calc := &Calculator{}

    // List all methods
    listMethods(calc)

    // Call methods dynamically
    result, _ := dispatch(calc, "Add", 10.0, 5.0)
    fmt.Println("Add(10, 5) =", result[0]) // 15

    result, _ = dispatch(calc, "Multiply", 4.0, 7.0)
    fmt.Println("Multiply(4, 7) =", result[0]) // 28

    // Method with no return value
    dispatch(calc, "Store", 99.0)
    result, _ = dispatch(calc, "Recall")
    fmt.Println("Recall() =", result[0]) // 99

    // Error case
    _, err := dispatch(calc, "Divide", 10.0, 2.0)
    fmt.Println("Divide error:", err) // method "Divide" not found
}
```

**Pitfall**: `method.Call(in)` panics if the argument types do not match the method's parameter types exactly. In production code, check `method.Type().NumIn()` and each `method.Type().In(i)` before calling. Also, calling a method on a value (not pointer) receiver works differently — if the method is defined on `*T`, you must pass a `*T`.

---

## 6. Creating New Values — reflect.New and reflect.MakeSlice

WHY: When you don't know the type at compile time but need to create instances of it, `reflect.New` and `reflect.MakeSlice` let you construct values dynamically. This is how `encoding/json` allocates the structs it fills in.

```go
package main

import (
    "fmt"
    "reflect"
)

type Product struct {
    ID    int
    Name  string
    Price float64
}

// createZero creates a zero value of the same type as the template.
func createZero(template interface{}) interface{} {
    t := reflect.TypeOf(template)
    if t.Kind() == reflect.Ptr {
        t = t.Elem()
    }
    return reflect.New(t).Interface() // returns *T
}

// makeTypedSlice creates a []T where T is the element type of template.
func makeTypedSlice(elementTemplate interface{}, length, capacity int) interface{} {
    elemType := reflect.TypeOf(elementTemplate)
    sliceType := reflect.SliceOf(elemType)
    return reflect.MakeSlice(sliceType, length, capacity).Interface()
}

// makeTypedMap creates a map[K]V.
func makeTypedMap(keyTemplate, valueTemplate interface{}) interface{} {
    keyType := reflect.TypeOf(keyTemplate)
    valType := reflect.TypeOf(valueTemplate)
    mapType := reflect.MapOf(keyType, valType)
    return reflect.MakeMap(mapType).Interface()
}

// cloneStruct creates a deep copy of a struct using reflection.
func cloneStruct(src interface{}) interface{} {
    srcVal := reflect.ValueOf(src)
    if srcVal.Kind() == reflect.Ptr {
        srcVal = srcVal.Elem()
    }
    dst := reflect.New(srcVal.Type()).Elem()
    dst.Set(srcVal) // shallow copy of all fields
    return dst.Addr().Interface()
}

func main() {
    // Create new zero instance of same type
    p := Product{ID: 1, Name: "Widget", Price: 9.99}
    newP := createZero(p).(*Product)
    fmt.Printf("New product: %+v\n", *newP) // {ID:0 Name: Price:0}

    // Populate the new instance
    v := reflect.ValueOf(newP).Elem()
    v.FieldByName("ID").SetInt(2)
    v.FieldByName("Name").SetString("Gadget")
    v.FieldByName("Price").SetFloat(19.99)
    fmt.Printf("Filled product: %+v\n", *newP) // {ID:2 Name:Gadget Price:19.99}

    // Make a typed slice dynamically
    slice := makeTypedSlice(Product{}, 0, 5)
    fmt.Printf("Slice type: %T\n", slice) // []main.Product

    // Make a typed map dynamically
    m := makeTypedMap("", 0)
    fmt.Printf("Map type: %T\n", m) // map[string]int

    // Clone
    original := &Product{ID: 10, Name: "Original", Price: 50.0}
    cloned := cloneStruct(original).(*Product)
    cloned.Name = "Clone"
    fmt.Println("Original:", original.Name) // Original
    fmt.Println("Clone:", cloned.Name)      // Clone

    // reflect.New with direct use
    t := reflect.TypeOf(Product{})
    ptrToProduct := reflect.New(t)            // *Product (pointer)
    productVal := ptrToProduct.Elem()         // Product (the struct)
    productVal.FieldByName("Name").SetString("Reflected")
    result := ptrToProduct.Interface().(*Product)
    fmt.Printf("Reflected product: %+v\n", *result)
}
```

**Pitfall**: `reflect.New(t)` always returns a pointer to a zero value of type `t`. Call `.Elem()` to get the struct itself (addressable/settable). Never call `.Set()` directly on the `reflect.New` result — call it on `.Elem()`.

---

## 7. Interface Reflection — How encoding/json Works

WHY: The most important practical application of reflection in Go. Understanding this tells you what `json.Marshal` and `json.Unmarshal` actually do, which helps you write correct struct tags and understand performance costs.

```go
package main

import (
    "fmt"
    "reflect"
    "strconv"
    "strings"
)

// MiniJSONEncoder is a simplified version of encoding/json's marshal logic.
// Real encoding/json handles many more cases, but this shows the core mechanism.
func MiniJSONEncoder(v interface{}) (string, error) {
    return encodeValue(reflect.ValueOf(v))
}

func encodeValue(v reflect.Value) (string, error) {
    // Handle pointer: dereference
    if v.Kind() == reflect.Ptr {
        if v.IsNil() {
            return "null", nil
        }
        return encodeValue(v.Elem())
    }

    switch v.Kind() {
    case reflect.String:
        return strconv.Quote(v.String()), nil

    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
        return strconv.FormatInt(v.Int(), 10), nil

    case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
        return strconv.FormatUint(v.Uint(), 10), nil

    case reflect.Float32, reflect.Float64:
        return strconv.FormatFloat(v.Float(), 'f', -1, 64), nil

    case reflect.Bool:
        if v.Bool() {
            return "true", nil
        }
        return "false", nil

    case reflect.Slice:
        if v.IsNil() {
            return "null", nil
        }
        parts := make([]string, v.Len())
        for i := 0; i < v.Len(); i++ {
            encoded, err := encodeValue(v.Index(i))
            if err != nil {
                return "", err
            }
            parts[i] = encoded
        }
        return "[" + strings.Join(parts, ",") + "]", nil

    case reflect.Map:
        if v.IsNil() {
            return "null", nil
        }
        parts := []string{}
        for _, key := range v.MapKeys() {
            keyEncoded, err := encodeValue(key)
            if err != nil {
                return "", err
            }
            valEncoded, err := encodeValue(v.MapIndex(key))
            if err != nil {
                return "", err
            }
            parts = append(parts, keyEncoded+":"+valEncoded)
        }
        return "{" + strings.Join(parts, ",") + "}", nil

    case reflect.Struct:
        return encodeStruct(v)

    case reflect.Interface:
        if v.IsNil() {
            return "null", nil
        }
        return encodeValue(v.Elem())

    default:
        return "null", nil
    }
}

func encodeStruct(v reflect.Value) (string, error) {
    t := v.Type()
    parts := []string{}

    for i := 0; i < t.NumField(); i++ {
        field := t.Field(i)
        fieldVal := v.Field(i)

        // Skip unexported fields
        if !field.IsExported() {
            continue
        }

        // Read json tag
        jsonTag := field.Tag.Get("json")
        if jsonTag == "-" {
            continue // explicitly excluded
        }

        name := field.Name
        omitempty := false

        if jsonTag != "" {
            tagParts := strings.SplitN(jsonTag, ",", 2)
            if tagParts[0] != "" {
                name = tagParts[0]
            }
            if len(tagParts) > 1 && tagParts[1] == "omitempty" {
                omitempty = true
            }
        }

        // omitempty: skip zero values
        if omitempty && fieldVal.IsZero() {
            continue
        }

        encoded, err := encodeValue(fieldVal)
        if err != nil {
            return "", fmt.Errorf("field %s: %w", field.Name, err)
        }

        parts = append(parts, strconv.Quote(name)+":"+encoded)
    }

    return "{" + strings.Join(parts, ",") + "}", nil
}

type Address struct {
    Street string `json:"street"`
    City   string `json:"city"`
    Zip    string `json:"zip,omitempty"`
}

type Person struct {
    ID      int     `json:"id"`
    Name    string  `json:"name"`
    Email   string  `json:"email,omitempty"`
    Age     int     `json:"age,omitempty"`
    Address Address `json:"address"`
    Secret  string  `json:"-"`
}

func main() {
    p := Person{
        ID:     1,
        Name:   "Alice",
        Email:  "alice@example.com",
        Age:    0, // omitempty: will be skipped
        Address: Address{
            Street: "123 Main St",
            City:   "Springfield",
            Zip:    "", // omitempty: will be skipped
        },
        Secret: "password123", // json:"-": always skipped
    }

    result, err := MiniJSONEncoder(p)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println(result)
    // {"id":1,"name":"Alice","email":"alice@example.com","address":{"street":"123 Main St","city":"Springfield"}}

    // Slice of structs
    people := []Person{
        {ID: 1, Name: "Alice"},
        {ID: 2, Name: "Bob"},
    }
    result, _ = MiniJSONEncoder(people)
    fmt.Println(result)
    // [{"id":1,"name":"Alice","address":{"street":"","city":""}},{"id":2,"name":"Bob","address":{"street":"","city":""}}]
}
```

**Pitfall**: This encoder is simplified. Real `encoding/json` handles: cycles (via pointer tracking), `json.Marshaler` interface, `time.Time` specially, HTML escaping, large float precision, and much more. Never write production JSON encoding from scratch — use `encoding/json`.

---

## 8. Performance — Caching reflect.Type and When to Avoid Reflection

WHY: Reflection is 10-100x slower than direct code for the same operation. Every call to `reflect.TypeOf` allocates. Every `reflect.ValueOf` boxes the value. In hot paths (serializing millions of requests/second), this matters. The standard pattern is to pay the reflection cost once at startup.

```go
package main

import (
    "fmt"
    "reflect"
    "sync"
    "time"
)

// BAD: reflection on every call — do not do this in hot paths
func slowGetFieldName(v interface{}, index int) string {
    return reflect.TypeOf(v).Field(index).Name // allocates on every call
}

// GOOD: cache the reflect.Type at package level or first use
var (
    personType     reflect.Type
    personTypeOnce sync.Once
    fieldNameCache = make(map[reflect.Type][]string)
    fieldCacheMu   sync.RWMutex
)

type Person struct {
    ID    int
    Name  string
    Email string
}

func init() {
    personType = reflect.TypeOf(Person{})
}

func fastGetFieldNames(t reflect.Type) []string {
    fieldCacheMu.RLock()
    if names, ok := fieldNameCache[t]; ok {
        fieldCacheMu.RUnlock()
        return names
    }
    fieldCacheMu.RUnlock()

    // Build the cache entry
    names := make([]string, t.NumField())
    for i := 0; i < t.NumField(); i++ {
        names[i] = t.Field(i).Name
    }

    fieldCacheMu.Lock()
    fieldNameCache[t] = names
    fieldCacheMu.Unlock()

    return names
}

// Benchmark: direct field access vs. reflection
func benchmarkDirect(p Person, n int) time.Duration {
    start := time.Now()
    for i := 0; i < n; i++ {
        _ = p.Name // direct field access
    }
    return time.Since(start)
}

func benchmarkReflection(p Person, n int) time.Duration {
    start := time.Now()
    for i := 0; i < n; i++ {
        v := reflect.ValueOf(p)
        _ = v.FieldByName("Name").String() // reflection on every iteration
    }
    return time.Since(start)
}

func benchmarkCachedType(p Person, n int) time.Duration {
    t := reflect.TypeOf(p) // compute type ONCE, outside loop
    start := time.Now()
    for i := 0; i < n; i++ {
        v := reflect.ValueOf(p)
        idx, _ := t.FieldByName("Name") // at least type is not recomputed
        _ = v.Field(idx.Index[0]).String()
    }
    return time.Since(start)
}

func main() {
    p := Person{ID: 1, Name: "Alice", Email: "alice@example.com"}
    n := 100_000

    directTime := benchmarkDirect(p, n)
    reflectTime := benchmarkReflection(p, n)
    cachedTime := benchmarkCachedType(p, n)

    fmt.Printf("Direct:     %v for %d iterations\n", directTime, n)
    fmt.Printf("Reflection: %v for %d iterations (~%.0fx slower)\n",
        reflectTime, n, float64(reflectTime)/float64(directTime))
    fmt.Printf("Cached type:%v for %d iterations\n", cachedTime, n)

    // Cached field names — pay once
    names := fastGetFieldNames(reflect.TypeOf(p))
    fmt.Println("Fields:", names) // [ID Name Email]

    // The same call uses the cache
    names2 := fastGetFieldNames(reflect.TypeOf(p))
    fmt.Println("Cached:", names2) // [ID Name Email]

    // Use cases where reflection cost is acceptable:
    // 1. Startup/initialization (wire, fx, GORM model registration)
    // 2. Low-frequency paths (config loading, CLI flag parsing)
    // 3. When the alternative is code generation that must be maintained
    //
    // Use cases where reflection is unacceptable:
    // 1. Per-request hot paths in HTTP handlers
    // 2. Tight loops processing millions of items
    // 3. Any place where profiling shows it in the top functions
}
```

**Pitfall**: `reflect.DeepEqual` is extremely slow — it traverses the entire value tree recursively. For struct comparison in tests, it's fine. For production code comparing values in a loop, compute a hash or compare specific fields directly.

---

## 9. Safer Alternatives — Code Generation and Type Assertions

WHY: For new code, always ask: "Can I use generics, interfaces, or code generation instead?" These alternatives are faster, safer, and produce better compiler errors.

```go
package main

import (
    "fmt"
    "strconv"
)

// ALTERNATIVE 1: Type assertions (fast, safe for known types)
// Use when: you have a small, known set of types to handle
func processValue(v interface{}) string {
    switch val := v.(type) {
    case int:
        return "int: " + strconv.Itoa(val)
    case string:
        return "string: " + val
    case float64:
        return "float64: " + strconv.FormatFloat(val, 'f', 2, 64)
    case bool:
        return "bool: " + strconv.FormatBool(val)
    case []int:
        return fmt.Sprintf("[]int with %d elements", len(val))
    default:
        return fmt.Sprintf("unknown type: %T", v)
    }
}

// ALTERNATIVE 2: Interfaces (the Go way for behavior polymorphism)
// Use when: all types share a common behavior
type Serializable interface {
    Serialize() string
}

type JsonRecord struct {
    Key   string
    Value string
}

func (r JsonRecord) Serialize() string {
    return fmt.Sprintf(`{"%s":"%s"}`, r.Key, r.Value)
}

type CSVRecord struct {
    Fields []string
}

func (r CSVRecord) Serialize() string {
    result := ""
    for i, f := range r.Fields {
        if i > 0 {
            result += ","
        }
        result += f
    }
    return result
}

func WriteAll(records []Serializable) {
    for _, r := range records {
        fmt.Println(r.Serialize())
    }
}

// ALTERNATIVE 3: Generics (Go 1.18+) — type safety without reflection
// Use when: same algorithm, multiple concrete types
func ToStrings[T fmt.Stringer](items []T) []string {
    result := make([]string, len(items))
    for i, item := range items {
        result[i] = item.String()
    }
    return result
}

// ALTERNATIVE 4: go generate + custom code
// For maximum performance, generate per-type code.
// Example: running `go generate` would produce:
//   func MarshalUserJSON(u User) ([]byte, error) { ... }
// with zero reflection overhead.
// Tools: stringer, protoc, ent schema, sqlc

// When reflection IS the right choice:
// 1. Building a library that handles arbitrary user types (GORM, mapstructure, fx)
// 2. Implementing generic serialization/deserialization (encoding/json)
// 3. Test utilities that compare or print any struct
// 4. Dependency injection containers

func main() {
    // Type assertions — fast, readable
    fmt.Println(processValue(42))
    fmt.Println(processValue("hello"))
    fmt.Println(processValue([]int{1, 2, 3}))

    // Interface-based polymorphism
    records := []Serializable{
        JsonRecord{"name", "Alice"},
        CSVRecord{[]string{"Alice", "30", "Engineering"}},
    }
    WriteAll(records)
    // {"name":"Alice"}
    // Alice,30,Engineering

    // When to pick each approach:
    fmt.Println(`
Decision guide:
- "Do I know all types at compile time?"
    YES -> Use type switch or interfaces
    NO  -> Continue...
- "Is performance critical (hot path)?"
    YES -> Use go generate or accept the design constraint
    NO  -> Continue...
- "Am I writing a library/framework?"
    YES -> Use reflection (with caching)
    NO  -> Reconsider — can you make types satisfy an interface?
`)
}
```

---

## Key Takeaways

1. **Reflection is the foundation of Go's marshaling ecosystem.** `encoding/json`, `encoding/gob`, `database/sql` row scanning, GORM, and `mapstructure` all depend on it. You use reflection indirectly every time you call `json.Marshal`.

2. **`reflect.TypeOf` gives you the type; `reflect.ValueOf` gives you the value.** You need `ValueOf` to read or write data; you can use `TypeOf` alone to inspect struct tags at startup.

3. **Kind is the category (int, struct, slice, ptr); Type is the specific type (main.Person, []string).** Switch on `Kind` for generic handling; compare `Type` for exact matching.

4. **Setting a value requires passing a pointer.** `reflect.ValueOf(x).Set(...)` panics if `x` is not addressable. Always use `reflect.ValueOf(&x).Elem()` or `reflect.New(t)` to get a settable value.

5. **Cache `reflect.Type` outside hot loops.** `reflect.TypeOf(x)` is not free — compute it once at package init or first use, store in a package-level variable or sync.Map.

6. **Unexported fields are invisible to `Set`.** Reflection can SEE unexported fields (their name and type) but cannot GET or SET their values. Attempting to call `.Interface()` on an unexported field panics.

7. **The performance cost is real.** Reflection is 10-100x slower than direct code. For request-handling hot paths, prefer type assertions, interfaces, or code generation. For startup/config/framework code, reflection's flexibility is worth the cost.

8. **Go 1.18 generics reduce the need for reflection.** Many patterns that required `reflect` for type-agnostic behavior can now be expressed with generic functions and constraints at compile time with zero runtime overhead.
