# Strings & Runes

## What Is This?

In Go, a string is an immutable sequence of bytes — not characters. A rune is a single Unicode code point, represented as `int32`. Go separates the concept of "raw bytes" (strings, `[]byte`) from "human-readable characters" (runes) so that programs can correctly handle every language on Earth without special libraries or configuration.

## Why Does It Exist?

Before UTF-8 became dominant, most languages (Java, Python 2, C) stored text either as ASCII bytes or as fixed-width UTF-16/UCS-2. Both approaches break when you mix languages: ASCII overflows on emojis, and fixed-width UTF-16 wastes memory for English text while still failing on characters outside the Basic Multilingual Plane. Go was designed at Google in 2007 specifically to build systems used by billions of people worldwide. Its creator Rob Pike co-invented UTF-8 itself, so Go baked UTF-8 directly into the language: source files are UTF-8, string literals are UTF-8, and the `for range` loop decodes UTF-8 automatically. The `rune` type exists because indexing into a string with `s[i]` gives a raw byte, which is wrong for multi-byte characters — you need an explicit type to mean "one decoded character."

## Who Uses This in Industry?

- **Google**: Processes search queries in 150+ languages. Go services that handle query parsing rely on Go's UTF-8 string model to correctly tokenize Japanese kanji, Arabic script, and emoji without per-language codec libraries.
- **Cloudflare**: Handles billions of HTTP requests per day, many containing UTF-8 URLs, headers, and JSON bodies. Go's `strings` and `bytes` packages allow zero-copy substring searching directly on the incoming byte buffer, which is critical at Cloudflare's throughput.
- **Uber**: Builds routing and dispatch services where driver and rider names come from dozens of languages. Go's rune-aware string handling means names are truncated correctly (at code point boundaries, not mid-character) when displayed in notifications.
- **Docker / Kubernetes**: Parse YAML manifests, container image names, and registry URLs. Both projects rely heavily on `strings.Split`, `strings.TrimSpace`, and `strings.HasPrefix` — functions that are correct by default for UTF-8 input.
- **Netflix**: Subtitle and localization pipelines process multilingual content. Go services use `utf8.RuneCountInString` rather than `len()` to measure display width correctly for subtitles in CJK (Chinese-Japanese-Korean) scripts.

## Industry Standards & Best Practices

**Senior engineers do:**
- Use `strings.Builder` for any string assembly inside a loop (avoids O(n²) allocations).
- Compile regular expressions once at package level (`var re = regexp.MustCompile(...)`) and reuse the compiled form — not inside hot functions.
- Distinguish between `len(s)` (byte count) and `utf8.RuneCountInString(s)` (character count) and choose deliberately.
- Use `[]byte` when they need mutation or when passing to I/O functions — and convert back to `string` only when necessary.
- Validate UTF-8 with `utf8.Valid(b)` at trust boundaries (incoming HTTP bodies, file reads) before processing.
- Use `strings.NewReader(s)` to turn a string into an `io.Reader` without allocating a new buffer.

**Beginners do (and shouldn't):**
- Concatenate strings in a loop with `+=`, allocating a new string on every iteration.
- Use `len(s)` to count characters, getting wrong answers for emoji and non-ASCII text.
- Slice strings at arbitrary byte positions, producing corrupted multi-byte characters.
- Recompile the same regular expression inside a loop, paying the compilation cost every call.
- Assume `string(someInt)` produces a decimal number (it produces the Unicode character for that code point).

## Why Go's Approach Is Unique

| Language | String Model | Consequence |
|---|---|---|
| Java | UTF-16 internally | `length()` counts UTF-16 code units; surrogate pairs (emoji) count as 2 |
| Python 3 | Abstract Unicode characters | Correct character count but memory overhead; `bytes` is a separate type |
| JavaScript | UTF-16 | Same surrogate-pair problem as Java; `str.length` lies for emoji |
| C | Raw bytes | No encoding awareness at all; correct usage is programmer's responsibility |
| **Go** | **UTF-8 bytes, runes for decoding** | `len()` is bytes (fast, honest); `for range` is characters (correct, UTF-8 aware) |

Go's tradeoff: it does not hide the byte/character distinction. You must opt in to character-level operations. This is more explicit than Python but far more honest than Java's "UTF-16 but we call it chars." For systems programming (network parsers, databases, CLIs), Go's approach is the most predictable — you always know whether you're working at the byte level or the Unicode level.

---

## 1. Strings Are Byte Slices (Basic)

### Why Before How

A Go string is defined as "an immutable sequence of bytes." Under the hood it is a struct with a pointer to a backing array and a length — exactly like a read-only `[]byte`. Immutability is not a limitation; it is a safety guarantee. Because strings cannot be modified, multiple goroutines can read the same string value simultaneously with no synchronization. This is why Go's HTTP server can pass the same URL string to many goroutines without copying it.

The fundamental rule: **`s[i]` gives you byte `i`, not character `i`.**

```go
// Example 1: String internals and byte indexing
package main

import "fmt"

func main() {
	s := "Hello, 世界" // "World" in Chinese — 9 characters, but more than 9 bytes

	fmt.Println("String value:   ", s)
	fmt.Println("len(s) bytes:   ", len(s))  // 13 — counts bytes
	fmt.Printf("s[7] as byte:    %d\n", s[7])  // 228 — first byte of '世', not '世'
	fmt.Printf("s[7] as char:    %c\n", s[7])  // garbage — partial multi-byte rune

	// Iterating by BYTE index — WRONG for non-ASCII
	fmt.Println("\n-- Byte iteration (wrong for Unicode) --")
	for i := 0; i < len(s); i++ {
		fmt.Printf("byte[%2d] = %3d  %c\n", i, s[i], s[i])
	}

	// Iterating by RUNE — CORRECT
	fmt.Println("\n-- Rune iteration (correct) --")
	for i, r := range s {
		fmt.Printf("index[%2d] rune=U+%04X  char=%c\n", i, r, r)
	}
}
```

Notice in the rune iteration: the index `i` jumps by 1 for ASCII characters but by 3 for the Chinese characters (which are 3 bytes each in UTF-8). The index is always the byte offset of the start of the rune.

### Strings vs []byte

```go
// Example 2: string vs []byte — when to use each
package main

import (
	"fmt"
	"strings"
)

func main() {
	// string: use when value is conceptually text and will not be mutated
	greeting := "Hello"

	// []byte: use when you need to mutate, or pass to I/O functions
	buf := []byte(greeting) // allocates a copy — you now own this memory
	buf[0] = 'J'
	modified := string(buf) // converts back — another allocation

	fmt.Println(greeting) // Hello — original unchanged (strings are immutable)
	fmt.Println(modified) // Jello

	// Zero-copy substring: slicing a string creates a new string header
	// pointing into the SAME backing array — no allocation
	s := "Cloudflare processes HTTP at scale"
	sub := s[11:19] // "processes" — shares memory with s
	fmt.Println(sub)
	fmt.Println(strings.Contains(s, "HTTP")) // true

	// Byte slice operations for mutation
	data := []byte("  trim me  ")
	data = []byte(strings.TrimSpace(string(data)))
	fmt.Println(string(data)) // "trim me"
}
```

**Common Pitfall 1: Using `s[i]` to get a character when `s` contains non-ASCII text.**

```go
// BUG: This breaks for any string with characters outside ASCII
name := "René" // "René" — é is 2 bytes (0xC3 0xA9)
fmt.Printf("Last char: %c\n", name[len(name)-1]) // prints © (wrong!) — that's byte 0xA9 alone
// FIX: Convert to []rune first
runes := []rune(name)
fmt.Printf("Last char: %c\n", runes[len(runes)-1]) // prints é (correct)
```

---

## 2. Runes and Unicode (Intermediate)

### Why Before How

A rune is just `int32` with a semantic meaning: it represents a Unicode code point. The word "rune" is a deliberate choice to avoid confusion with "character" (ambiguous) or "char" (usually means byte in C). When Go iterates a string with `for range`, it automatically decodes each UTF-8 sequence into the corresponding `rune` value. This is where the language does the heavy lifting.

Key facts:
- `rune` = `int32` = a Unicode code point (0 to 1,114,111)
- `byte` = `uint8` = one raw byte (0 to 255)
- UTF-8 encodes each rune as 1–4 bytes
- `len(s)` = number of bytes; `utf8.RuneCountInString(s)` = number of runes (characters)

```go
// Example 3: Runes, Unicode, and correct character counting
package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	samples := []string{
		"Hello",       // pure ASCII
		"Héllo",       // é is 2 bytes
		"世界",          // each character is 3 bytes
		"Hello 🌍",    // emoji is 4 bytes
	}

	for _, s := range samples {
		byteLen := len(s)
		runeLen := utf8.RuneCountInString(s)
		fmt.Printf("%-12q  bytes=%-3d  runes=%-3d\n", s, byteLen, runeLen)
	}

	// Converting string to rune slice enables correct indexing
	s := "Hello 🌍"
	runes := []rune(s)
	fmt.Printf("\nLast rune: %c (U+%04X)\n", runes[len(runes)-1], runes[len(runes)-1])

	// Validating UTF-8
	valid := []byte{72, 101, 108, 108, 111}       // "Hello" — valid UTF-8
	invalid := []byte{72, 0xFF, 108, 108, 111}    // 0xFF is not valid UTF-8
	fmt.Printf("\nValid UTF-8:   %v\n", utf8.Valid(valid))
	fmt.Printf("Invalid UTF-8: %v\n", utf8.Valid(invalid))

	// DecodeRuneInString — lower-level, used in parsers
	s2 := "世界"
	r, size := utf8.DecodeRuneInString(s2)
	fmt.Printf("\nFirst rune of %q: %c (U+%04X), encoded in %d bytes\n", s2, r, r, size)
}
```

### Slicing Strings Safely

```go
// Example 4: Safe string slicing at rune boundaries
package main

import (
	"fmt"
	"unicode/utf8"
)

// truncateRunes cuts a string to at most n runes, not n bytes.
// This is what Uber uses in notification truncation pipelines.
func truncateRunes(s string, n int) string {
	count := 0
	for i := range s { // for range gives byte index of each rune
		if count == n {
			return s[:i] // safe to slice here — i is a rune boundary
		}
		count++
	}
	return s // fewer than n runes
}

// truncateBytes demonstrates the BUG: slicing at byte position
func truncateBytesBUG(s string, n int) string {
	if n >= len(s) {
		return s
	}
	return s[:n] // WRONG: might cut in the middle of a multi-byte rune
}

func main() {
	s := "Hello 世界 🌍"

	safe := truncateRunes(s, 8)
	unsafe := truncateBytesBUG(s, 8)

	fmt.Printf("Original:      %q  (%d runes)\n", s, utf8.RuneCountInString(s))
	fmt.Printf("Safe 8 runes:  %q\n", safe)
	fmt.Printf("Unsafe 8 bytes: %q\n", unsafe) // may show replacement character or garbage
}
```

**Common Pitfall 2: Slicing a string at a byte offset that lands in the middle of a multi-byte UTF-8 sequence.**

The safe pattern: always slice at an index produced by `for i := range s` (which gives rune-boundary byte offsets), or convert to `[]rune` first.

---

## 3. String Builders and the strings Package (Intermediate)

### Why Before How

String concatenation with `+=` creates a new allocation on every operation. For a loop that runs 1,000 times, you get 1,000 allocations and copy O(n²) total bytes. `strings.Builder` maintains an internal `[]byte` that grows like a slice (doubling capacity), so it performs O(n) total work. This is not a micro-optimization — it is the difference between a 1ms response and a 1s response in a tight formatting loop.

```go
// Example 5: strings.Builder vs += and the strings package
package main

import (
	"fmt"
	"strings"
)

func buildWithConcat(words []string) string {
	result := ""
	for _, w := range words {
		result += w + ", " // O(n^2) — new allocation every iteration
	}
	return strings.TrimSuffix(result, ", ")
}

func buildWithBuilder(words []string) string {
	var sb strings.Builder
	for i, w := range words {
		sb.WriteString(w)
		if i < len(words)-1 {
			sb.WriteString(", ")
		}
	}
	return sb.String() // single allocation at the end
}

func main() {
	words := []string{"apple", "banana", "cherry", "date", "elderberry"}

	fmt.Println(buildWithConcat(words))
	fmt.Println(buildWithBuilder(words))

	// Practical strings package functions used daily in production
	s := "  Hello, World!  "

	fmt.Println(strings.TrimSpace(s))                      // "Hello, World!"
	fmt.Println(strings.ToUpper("hello"))                  // "HELLO"
	fmt.Println(strings.ToLower("HELLO"))                  // "hello"
	fmt.Println(strings.Contains(s, "World"))              // true
	fmt.Println(strings.HasPrefix("Dockerfile", "Docker")) // true
	fmt.Println(strings.HasSuffix("main.go", ".go"))       // true
	fmt.Println(strings.Count("cheese", "e"))              // 3
	fmt.Println(strings.Replace("oink oink oink", "oink", "moo", 2)) // "moo moo oink"
	fmt.Println(strings.ReplaceAll("foo bar foo", "foo", "baz"))      // "baz bar baz"

	// Split and Join — the bread and butter of config parsing
	csv := "alice,bob,charlie,david"
	parts := strings.Split(csv, ",")
	fmt.Println(parts)                      // [alice bob charlie david]
	fmt.Println(strings.Join(parts, " | ")) // alice | bob | charlie | david

	// Fields splits on any whitespace — useful for log parsing
	log := "  GET   /api/users   200  "
	fields := strings.Fields(log)
	fmt.Println(fields) // [GET /api/users 200]
}
```

### strconv: Numbers and Strings

```go
// Example 6: strconv — converting between strings and numbers
package main

import (
	"fmt"
	"strconv"
)

func main() {
	// Integer <-> string
	n := 42
	s := strconv.Itoa(n) // int to string: "42"
	fmt.Printf("Itoa:  %q (type: %T)\n", s, s)

	// TRAP: string(42) does NOT give "42" — it gives "*" (Unicode code point 42)
	wrong := string(42)
	fmt.Printf("string(42): %q  <-- this is a bug waiting to happen\n", wrong)

	// string -> int
	num, err := strconv.Atoi("123")
	if err != nil {
		fmt.Println("Error:", err)
	} else {
		fmt.Printf("Atoi:  %d (type: %T)\n", num, num)
	}

	// Error handling for invalid input
	_, err = strconv.Atoi("abc")
	fmt.Println("Atoi error:", err) // strconv.Atoi: parsing "abc": invalid syntax

	// Floats
	f := 3.14159
	fs := strconv.FormatFloat(f, 'f', 2, 64) // format: f=decimal, 2 decimal places, 64-bit
	fmt.Printf("FormatFloat: %q\n", fs)       // "3.14"

	pf, err := strconv.ParseFloat("2.718", 64)
	if err == nil {
		fmt.Printf("ParseFloat: %f\n", pf) // 2.718000
	}

	// Booleans
	fmt.Println(strconv.FormatBool(true))          // "true"
	b, _ := strconv.ParseBool("true")
	fmt.Println(b) // true

	// ParseInt with base — useful for parsing hex IDs, permissions
	val, _ := strconv.ParseInt("FF", 16, 64) // hex to int64
	fmt.Printf("0xFF = %d\n", val)            // 255

	octal, _ := strconv.ParseInt("755", 8, 64) // octal (file permissions)
	fmt.Printf("0755 = %d\n", octal)            // 493
}
```

**Common Pitfall 3: Writing `string(someInt)` expecting a decimal number.**

`string(65)` produces `"A"` — the character with Unicode code point 65. Use `strconv.Itoa(65)` to get `"65"`. The Go compiler emits a warning for `string(int)` conversions in newer versions, but it still compiles.

---

## 4. Converting Between Types (Intermediate)

### Why Before How

Go deliberately requires explicit conversions between `string`, `[]byte`, and `[]rune`. This is intentional: each conversion may or may not allocate memory, and the language makes you opt in. Understanding when allocations happen helps you write zero-allocation parsers, which is how Cloudflare and Fastly achieve their throughput.

```go
// Example 7: Type conversions — allocations and io.Reader integration
package main

import (
	"fmt"
	"io"
	"strings"
)

func main() {
	// string -> []byte: ALWAYS allocates (you get a mutable copy)
	s := "hello"
	b := []byte(s)
	b[0] = 'H'
	fmt.Println(string(b)) // "Hello"
	fmt.Println(s)         // "hello" — original unchanged

	// []byte -> string: ALWAYS allocates (copy into immutable string)
	bytes := []byte{'G', 'o', 'l', 'a', 'n', 'g'}
	str := string(bytes)
	fmt.Println(str) // "Golang"

	// string -> []rune: allocates (each rune is int32, always 4 bytes)
	text := "Hello 世界"
	runes := []rune(text)
	fmt.Printf("Rune count: %d, rune slice: %v\n", len(runes), runes)

	// []rune -> string: allocates (re-encodes as UTF-8)
	back := string(runes)
	fmt.Println(back) // "Hello 世界"

	// strings.NewReader: turn a string into io.Reader WITHOUT allocating a copy
	// This is what production servers use to feed string data into parsers
	reader := strings.NewReader("application/json; charset=utf-8")
	content, err := io.ReadAll(reader)
	if err == nil {
		fmt.Println(string(content)) // "application/json; charset=utf-8"
	}

	// strings.NewReplacer: efficient multi-replacement (one pass, not chained Replace calls)
	r := strings.NewReplacer(
		"<", "&lt;",
		">", "&gt;",
		"&", "&amp;",
	)
	html := r.Replace("<b>Hello & World</b>")
	fmt.Println(html) // &lt;b&gt;Hello &amp; World&lt;/b&gt;
}
```

---

## 5. Regular Expressions (Advanced)

### Why Before How

Regular expressions are the standard tool for parsing structured text: log lines, URLs, email addresses, version strings, config values. The `regexp` package uses RE2 syntax (not PCRE), which guarantees linear-time matching — no catastrophic backtracking. This is why Go's `regexp` is safe to use on untrusted input without risking a ReDoS (regular expression denial of service) attack. Google, Cloudflare, and Uber all rely on this safety property in services that handle user-supplied data.

The critical production rule: **compile once, use many times.** `regexp.MustCompile` at package initialization costs milliseconds once. Compiling inside a handler costs the same milliseconds on every request.

```go
// Example 8: Regular expressions — compile once, named groups, safe reuse
package main

import (
	"fmt"
	"regexp"
)

// Package-level compiled regexps: paid once at startup, never again.
// regexp.MustCompile panics if the pattern is invalid — appropriate at init time
// because a bad pattern is a programming error, not a runtime error.
var (
	emailRe   = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	logLineRe = regexp.MustCompile(
		`(?P<ip>\d{1,3}(?:\.\d{1,3}){3})\s+-\s+-\s+\[(?P<time>[^\]]+)\]\s+"(?P<method>[A-Z]+)\s+(?P<path>\S+)[^"]*"\s+(?P<status>\d{3})`,
	)
	semverRe = regexp.MustCompile(`^v?(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)(?:-(?P<pre>[a-zA-Z0-9.]+))?$`)
)

func validateEmail(email string) bool {
	return emailRe.MatchString(email)
}

// extractNamedGroups extracts a map of name->value from a named-capture regex match.
func extractNamedGroups(re *regexp.Regexp, s string) map[string]string {
	match := re.FindStringSubmatch(s)
	if match == nil {
		return nil
	}
	result := make(map[string]string)
	for i, name := range re.SubexpNames() {
		if i != 0 && name != "" {
			result[name] = match[i]
		}
	}
	return result
}

func main() {
	// Email validation
	emails := []string{
		"user@example.com",
		"bad-email",
		"also.bad@",
		"valid+tag@company.org",
	}
	for _, e := range emails {
		fmt.Printf("%-28s valid=%v\n", e, validateEmail(e))
	}

	fmt.Println()

	// Log line parsing with named capture groups
	logLine := `192.168.1.1 - - [10/Jun/2026:14:23:01 +0000] "GET /api/users HTTP/1.1" 200`
	fields := extractNamedGroups(logLineRe, logLine)
	if fields != nil {
		fmt.Printf("IP:     %s\n", fields["ip"])
		fmt.Printf("Method: %s\n", fields["method"])
		fmt.Printf("Path:   %s\n", fields["path"])
		fmt.Printf("Status: %s\n", fields["status"])
	}

	fmt.Println()

	// Semantic version parsing
	versions := []string{"v1.2.3", "2.0.0-beta.1", "1.0.0", "invalid"}
	for _, v := range versions {
		m := extractNamedGroups(semverRe, v)
		if m != nil {
			fmt.Printf("%-15s  major=%s minor=%s patch=%s pre=%q\n",
				v, m["major"], m["minor"], m["patch"], m["pre"])
		} else {
			fmt.Printf("%-15s  NOT A SEMVER\n", v)
		}
	}

	fmt.Println()

	// FindAllString — find all matches in a string
	text := "Contact us at support@example.com or sales@company.org for help."
	allEmails := emailRe.FindAllString(text, -1) // -1 means find all
	fmt.Println("Emails found:", allEmails)

	// ReplaceAllString — redact sensitive data (common in logging pipelines)
	redactRe := regexp.MustCompile(`\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b`)
	card := "Payment processed for card 4111 1111 1111 1111 successfully"
	redacted := redactRe.ReplaceAllString(card, "[REDACTED]")
	fmt.Println(redacted)
}
```

---

## 6. Putting It Together — Real-World Pattern (Advanced)

This example shows how the pieces combine in a realistic HTTP request parser, the kind found in API gateway code at Cloudflare or Kong:

```go
// Example 9: Production-style HTTP header parser
package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// ContentType represents a parsed HTTP Content-Type header.
type ContentType struct {
	MIMEType string
	Charset  string
	Params   map[string]string
}

// ParseContentType parses "application/json; charset=UTF-8; boundary=something"
// This pattern appears in every HTTP framework written in Go.
func ParseContentType(header string) ContentType {
	ct := ContentType{Params: make(map[string]string)}
	if header == "" {
		return ct
	}

	parts := strings.Split(header, ";")
	ct.MIMEType = strings.TrimSpace(strings.ToLower(parts[0]))

	for _, part := range parts[1:] {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(kv[0]))
		val := strings.Trim(strings.TrimSpace(kv[1]), `"`) // strip optional quotes

		ct.Params[key] = val
		if key == "charset" {
			ct.Charset = strings.ToUpper(val)
		}
	}
	return ct
}

// SanitizeInput removes control characters and validates UTF-8.
// Used at trust boundaries before storing user input.
func SanitizeInput(s string) (string, bool) {
	if !utf8.ValidString(s) {
		return "", false
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		// Skip control characters (except tab, newline, carriage return)
		if r < 32 && r != '\t' && r != '\n' && r != '\r' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String(), true
}

func main() {
	headers := []string{
		"application/json",
		"text/html; charset=UTF-8",
		`multipart/form-data; boundary="----WebKitFormBoundary"; charset=utf-8`,
		"",
	}

	for _, h := range headers {
		ct := ParseContentType(h)
		fmt.Printf("MIME: %-25q  Charset: %-8q  Params: %v\n",
			ct.MIMEType, ct.Charset, ct.Params)
	}

	fmt.Println()

	inputs := []string{
		"Hello, World!",
		"café au lait",
		"Hello\x00World", // null byte — reject
		"正常テキスト",         // valid Japanese
	}

	for _, input := range inputs {
		clean, ok := SanitizeInput(input)
		fmt.Printf("%-20q  ok=%-5v  clean=%q\n", input, ok, clean)
	}
}
```

---

## Top 3 String Bugs Go Beginners Hit

### Bug 1: `len(s)` returns bytes, not characters

```go
// WRONG assumption
s := "日本語"
fmt.Println(len(s))        // prints 9, not 3
fmt.Println(s[0])          // prints 230 (first byte of 日), not '日'

// CORRECT
import "unicode/utf8"
fmt.Println(utf8.RuneCountInString(s)) // 3
for _, r := range s {
    fmt.Printf("%c ", r) // 日 本 語
}
```

### Bug 2: `string(intValue)` is not a decimal conversion

```go
// WRONG: expecting "65"
code := 65
fmt.Println(string(code))       // prints "A" — Unicode code point 65
fmt.Println(fmt.Sprintf("%d", code)) // prints "65" — but use strconv for non-formatting

// CORRECT
import "strconv"
fmt.Println(strconv.Itoa(code)) // "65"
```

### Bug 3: Concatenating strings in a loop

```go
// WRONG: O(n²) allocations
result := ""
for i := 0; i < 10000; i++ {
    result += "x" // allocates and copies on every iteration
}

// CORRECT: O(n) with strings.Builder
var sb strings.Builder
sb.Grow(10000) // optional: pre-allocate if size is known
for i := 0; i < 10000; i++ {
    sb.WriteByte('x')
}
result := sb.String()
```

---

## Quick Reference

| Operation | Function / Method | Notes |
|---|---|---|
| Byte count | `len(s)` | Fast, always bytes |
| Rune count | `utf8.RuneCountInString(s)` | Character count |
| Int to string | `strconv.Itoa(n)` | NOT `string(n)` |
| String to int | `strconv.Atoi(s)` | Returns `(int, error)` |
| Build string | `strings.Builder` | Use in loops |
| Split | `strings.Split(s, sep)` | Returns `[]string` |
| Join | `strings.Join(parts, sep)` | Inverse of Split |
| Trim whitespace | `strings.TrimSpace(s)` | Both ends |
| Contains | `strings.Contains(s, sub)` | Boolean |
| Validate UTF-8 | `utf8.Valid(b)` | On `[]byte` |
| String as Reader | `strings.NewReader(s)` | No allocation |
| Compile regex | `regexp.MustCompile(pat)` | Once, at package level |
