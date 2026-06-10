# Go Testing & Benchmarking

## What Is This?

Go's testing package (`testing`) is a built-in, zero-dependency framework for writing unit tests, benchmarks, fuzz tests, and example-based documentation. Unlike most languages where testing requires a third-party framework, Go ships everything you need in the standard library — you just run `go test ./...` and the toolchain handles compilation, execution, and reporting. Tests live in `_test.go` files alongside the code they test.

## Why Does It Exist?

Before Go's integrated testing approach, the industry norm was fragmented: JUnit for Java, Mocha/Jest for Node, pytest for Python — each with their own runner, config format, and assertion style. Go's designers (who built Google's infrastructure) knew that testing culture collapses when the friction to write tests is high. By making `go test` a first-class toolchain command with no setup, they removed the excuse not to test. The design decision: testing is not optional ceremony — it is part of the language's build system. What was broken without it: teams spending days choosing frameworks, configuring CI, and debating assertion libraries instead of writing tests.

## Who Uses This in Industry?

- **Google**: Go's testing package was designed inside Google where billions of test runs execute per day. Internal Go codebases have enforced coverage gates and use `go test -race` on every CI run to catch data races before they reach production.
- **Uber**: Uber's Go services (handling millions of rides/second) use table-driven tests extensively for their fare calculation and routing engines. They run the race detector on all PRs — catching race conditions that would otherwise cause silent data corruption in concurrent dispatch systems.
- **Stripe**: Stripe's Go payment processing services maintain 80%+ test coverage. Their billing engine uses integration tests with build tags to separate unit tests (fast, always run) from integration tests (slow, run on merge). A failing test blocks deploy, not just alerts.
- **Cloudflare**: Cloudflare's DNS and CDN infrastructure — written largely in Go — uses benchmarks (`BenchmarkXxx`) to catch performance regressions. A PR that degrades throughput by 5% is automatically flagged. Their workers runtime uses fuzz testing to find edge cases in protocol parsing.
- **Docker/Kubernetes**: Kubernetes uses build-tag-separated integration tests against a real API server. Its test suite runs 10,000+ tests. The `t.Parallel()` pattern is used throughout to keep CI under 10 minutes despite the volume.

## Industry Standards & Best Practices

**What senior engineers do:**
- Write table-driven tests as the default — not individual test functions per case.
- Use `t.Helper()` in every test utility function so failure output points to the caller, not the helper.
- Use `t.Cleanup()` instead of `defer` for test teardown — it works correctly with subtests.
- Run `go test -race ./...` in CI — always. A race is a bug. Find it before production does.
- Use `go test -cover` to measure coverage but not to chase 100% — cover the behavior, not the lines.
- Keep benchmarks in the same package, run them with `-bench=. -benchmem` to catch allocations.
- Use fuzz testing (`FuzzXxx`) for any function that parses external input (JSON, URLs, protobufs).
- Build tags (`//go:build integration`) separate fast unit tests from slow integration tests.

**What beginners do (and shouldn't):**
- Write `if err != nil { t.Fatal(err) }` in a helper without `t.Helper()` — error points to wrong line.
- Use `os.Exit(1)` inside tests — it skips cleanup and panics the test runner.
- Write `assert` wrappers before reading what `t.Errorf` and `t.Fatalf` already provide.
- Import `testify` as reflex instead of evaluating whether stdlib is sufficient.

## Why Go's Approach Is Unique

**vs Java (JUnit):** JUnit requires annotations (`@Test`, `@Before`, `@After`), a test runner class, and Maven/Gradle setup. Go uses plain functions with naming conventions — no annotations, no class hierarchy, no config files. `go test` is the runner.

**vs Python (pytest):** pytest is powerful but separate from the build tool. Go's testing is integrated into `go build`'s dependency graph — test binaries are built with the same compiler, cache, and module system.

**vs Node (Jest/Mocha):** These require `npm install`, config files, and separate processes. `go test` compiles and runs with zero config from day one.

**The tradeoffs Go made:** No built-in `assert` library. `t.Errorf` is verbose but explicit — it forces you to write descriptive failure messages instead of cryptic `AssertionError: expected 4 but got 3`. Go's opinion: clear failure messages are more valuable than concise assertion calls. Subtests (`t.Run`) replace parameterized test frameworks. The race detector is compiled in, not bolted on.

---

## 1. Unit Tests — The Foundation

### Why Before How

A unit test verifies one unit of behavior in isolation. In Go, the convention is: one `_test.go` file per source file, test functions named `TestXxx`, accepting `*testing.T`. The test binary is compiled from `*_test.go` files and run by `go test`. There are no test classes, no lifecycle methods — just functions.

`t.Errorf` marks the test as failed but continues execution (lets all assertions run). `t.Fatalf` marks as failed and stops immediately (use when subsequent code would panic on bad state).

```go
// math/calculator.go
package math

// Add returns the sum of two integers.
func Add(a, b int) int {
	return a + b
}

// Divide returns a/b. Returns error if b is zero.
func Divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, fmt.Errorf("divide by zero: cannot divide %v by 0", a)
	}
	return a / b, nil
}
```

```go
// math/calculator_test.go
package math

import (
	"fmt"
	"testing"
)

// TestAdd is a basic unit test.
// Naming: Test + ExportedFunctionName. Convention is strict — must start with capital letter.
func TestAdd(t *testing.T) {
	result := Add(2, 3)
	if result != 5 {
		// t.Errorf marks test failed but continues running.
		// Always write a message that explains WHAT went wrong and with WHAT inputs.
		t.Errorf("Add(2, 3) = %d; want 5", result)
	}
}

// TestDivide demonstrates testing functions that return errors.
func TestDivide(t *testing.T) {
	// Test the happy path
	result, err := Divide(10, 2)
	if err != nil {
		t.Fatalf("Divide(10, 2) unexpected error: %v", err)
		// t.Fatalf stops this test immediately — used when further tests would be meaningless
	}
	if result != 5.0 {
		t.Errorf("Divide(10, 2) = %v; want 5.0", result)
	}

	// Test the error path
	_, err = Divide(10, 0)
	if err == nil {
		t.Error("Divide(10, 0) expected error, got nil")
	}
}
```

**Run:**
```bash
go test ./math/...
go test -v ./math/...   # verbose: shows each test name and PASS/FAIL
go test -run TestAdd    # run only tests matching regex "TestAdd"
```

**Common pitfall:** Writing `t.Fatal` when you mean `t.Error`. If you have 5 assertions and use `t.Fatal` on the first, the remaining 4 never run — you lose information about what else is broken.

---

## 2. Table-Driven Tests — The Go Standard

### Why Before How

Table-driven tests are the idiomatic Go pattern for testing multiple input/output combinations. Instead of writing `TestAdd_positives`, `TestAdd_negatives`, `TestAdd_zeros` as separate functions, you define a slice of test cases and loop over them. This is Go's answer to pytest's `@pytest.mark.parametrize` and JUnit's `@ParameterizedTest` — but built with plain language features, no framework magic.

The real power: `t.Run()` creates a named subtest for each case. Failed cases show which case failed by name. You can run a single case with `-run TestAdd/zero_plus_zero`.

```go
// math/calculator_test.go (continued)
package math

import (
	"fmt"
	"testing"
)

func TestAdd_TableDriven(t *testing.T) {
	// Define the test table — a slice of anonymous structs.
	// Each struct is one test case. Name the fields clearly.
	tests := []struct {
		name string // descriptive name — appears in test output
		a    int
		b    int
		want int
	}{
		{name: "positive numbers", a: 2, b: 3, want: 5},
		{name: "negative numbers", a: -1, b: -2, want: -3},
		{name: "zero plus zero", a: 0, b: 0, want: 0},
		{name: "positive plus negative", a: 10, b: -3, want: 7},
		{name: "large numbers", a: 1000000, b: 2000000, want: 3000000},
	}

	for _, tc := range tests {
		tc := tc // capture range variable — CRITICAL for parallel subtests (pre-Go 1.22)
		t.Run(tc.name, func(t *testing.T) {
			got := Add(tc.a, tc.b)
			if got != tc.want {
				t.Errorf("Add(%d, %d) = %d; want %d", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

// Table-driven test for a function that returns errors.
func TestDivide_TableDriven(t *testing.T) {
	tests := []struct {
		name      string
		a         float64
		b         float64
		want      float64
		wantErr   bool   // true if we expect an error
		errString string // substring we expect in the error message
	}{
		{name: "basic division", a: 10, b: 2, want: 5.0, wantErr: false},
		{name: "division by zero", a: 10, b: 0, want: 0, wantErr: true, errString: "divide by zero"},
		{name: "fractional result", a: 7, b: 2, want: 3.5, wantErr: false},
		{name: "negative dividend", a: -10, b: 2, want: -5.0, wantErr: false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got, err := Divide(tc.a, tc.b)

			if tc.wantErr {
				if err == nil {
					t.Fatalf("Divide(%v, %v) expected error, got nil", tc.a, tc.b)
				}
				if tc.errString != "" && !containsString(err.Error(), tc.errString) {
					t.Errorf("error message %q does not contain %q", err.Error(), tc.errString)
				}
				return // early return — don't check result when error expected
			}

			if err != nil {
				t.Fatalf("Divide(%v, %v) unexpected error: %v", tc.a, tc.b, err)
			}
			if got != tc.want {
				t.Errorf("Divide(%v, %v) = %v; want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

// containsString is a tiny helper — no need for strings.Contains import in test file
func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(substr); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
			return false
		}())
}
```

**Run a specific subtest:**
```bash
go test -run "TestDivide_TableDriven/division_by_zero" ./math/...
# Note: spaces in test names become underscores in the -run regex
```

**Common pitfall:** Forgetting `tc := tc` before Go 1.22. In Go 1.21 and earlier, the range variable `tc` is reused — all goroutines in parallel subtests would reference the last value. Go 1.22 changed loop variable semantics, but `tc := tc` is still a good habit for clarity.

---

## 3. Parallel Tests — Speed Up Your Test Suite

### Why Before How

By default, Go runs tests in a package sequentially. `t.Parallel()` signals that a test can run concurrently with other parallel tests. This is critical for large test suites — Kubernetes cuts CI time from 30 minutes to 8 minutes largely through parallelism. But parallelism introduces a constraint: parallel tests must not share mutable state.

The pattern: call `t.Parallel()` immediately after entering the test function (or subtest). The test pauses at that line, waits for all non-parallel tests in the package to finish, then runs concurrently with other parallel tests.

```go
// service/user_service_test.go
package service

import (
	"fmt"
	"testing"
)

// TestUserLookup_Parallel runs multiple lookups concurrently.
// Each subtest is independent — safe to parallelize.
func TestUserLookup_Parallel(t *testing.T) {
	t.Parallel() // This whole test runs parallel with others in the package

	tests := []struct {
		name   string
		userID int
		want   string
	}{
		{name: "existing user", userID: 1, want: "Alice"},
		{name: "another user", userID: 2, want: "Bob"},
		{name: "third user", userID: 3, want: "Charlie"},
	}

	for _, tc := range tests {
		tc := tc // capture — essential when subtests are parallel
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel() // Each subtest also runs in parallel with siblings

			// Simulate a lookup — no shared mutable state
			result := lookupUser(tc.userID)
			if result != tc.want {
				t.Errorf("lookupUser(%d) = %q; want %q", tc.userID, result, tc.want)
			}
		})
	}
}

// lookupUser is the function under test — purely functional, safe to call concurrently.
func lookupUser(id int) string {
	users := map[int]string{1: "Alice", 2: "Bob", 3: "Charlie"}
	return users[id]
}

// TestWithSharedDB shows the WRONG way — sharing state without synchronization.
// DO NOT DO THIS with t.Parallel():
//
// var sharedDB *sql.DB  // shared mutable state — race condition
// func TestBad(t *testing.T) {
//     t.Parallel()
//     sharedDB.Query(...)  // DATA RACE — don't do this
// }

// TestWithIsolatedDB shows the RIGHT way — each test gets its own state.
func TestWithIsolatedDB(t *testing.T) {
	t.Parallel()

	// Each parallel test creates its own isolated resource.
	db := newTestDB(t) // creates fresh in-memory DB for this test
	_ = db
	// ... test with isolated db
}

// newTestDB creates a fresh database for a test and registers cleanup.
func newTestDB(t *testing.T) string {
	t.Helper()
	db := fmt.Sprintf("test-db-%s", t.Name())
	t.Cleanup(func() {
		// cleanup runs after the test, even if it panics
		_ = fmt.Sprintf("closing %s", db)
	})
	return db
}
```

**Common pitfall:** Calling `t.Parallel()` after doing work. The test should pause at the start, not midway through setup. If you set up shared state before calling `t.Parallel()`, that setup runs sequentially (safe), but the parallel work after may conflict with other tests.

---

## 4. Test Helpers — t.Helper() and t.Cleanup()

### Why Before How

Test helpers are functions called from multiple tests to reduce duplication — creating test fixtures, asserting common conditions. Two problems without `t.Helper()`: (1) When a helper calls `t.Error`, the failure location shown is inside the helper, not the test that called it. `t.Helper()` marks the function as a helper so Go's test output skips it in stack traces. (2) Without `t.Cleanup()`, cleanup via `defer` only runs when the enclosing function returns — this breaks with subtests because the subtest's goroutine is different from the parent.

```go
// helpers_test.go
package service

import (
	"fmt"
	"os"
	"testing"
)

// assertEqual is a generic test helper.
// t.Helper() is MANDATORY — without it, failure lines point here, not to callers.
func assertEqual[T comparable](t *testing.T, got, want T) {
	t.Helper() // Must be the FIRST call in every helper
	if got != want {
		t.Errorf("got %v; want %v", got, want)
	}
}

// assertNoError is a common helper that wraps error checking.
func assertNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// createTempFile creates a temp file and registers cleanup automatically.
// t.Cleanup ensures the file is deleted even if the test panics.
func createTempFile(t *testing.T, content string) string {
	t.Helper()

	f, err := os.CreateTemp("", "test-*.txt")
	if err != nil {
		t.Fatalf("createTempFile: %v", err)
	}

	if _, err := f.WriteString(content); err != nil {
		t.Fatalf("createTempFile write: %v", err)
	}
	f.Close()

	// t.Cleanup registers a function to run when the test (or subtest) finishes.
	// Multiple Cleanup calls run in LIFO order — like defer.
	t.Cleanup(func() {
		os.Remove(f.Name())
	})

	return f.Name()
}

// setupTestEnvironment demonstrates chaining cleanup.
func setupTestEnvironment(t *testing.T) (string, string) {
	t.Helper()

	dir, err := os.MkdirTemp("", "test-env-*")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	t.Cleanup(func() {
		os.RemoveAll(dir) // cleanup runs after test completes
	})

	configFile := createTempFile(t, `{"debug": true}`)
	return dir, configFile
}

// TestWithHelpers demonstrates using the helpers above.
func TestWithHelpers(t *testing.T) {
	dir, config := setupTestEnvironment(t)

	assertEqual(t, dir != "", true)
	assertEqual(t, config != "", true)

	// After TestWithHelpers returns, t.Cleanup callbacks run:
	// 1. Remove configFile (registered last, runs first — LIFO)
	// 2. Remove dir
	fmt.Println("test running with dir:", dir)
}

// WHY t.Cleanup BEATS defer for subtests:
// defer runs when the enclosing function returns.
// t.Cleanup runs when the test (including subtests) finishes.
// If a subtest is run as a goroutine, defer in the parent won't clean up after it.
func TestCleanupVsDefer(t *testing.T) {
	t.Run("subtest", func(t *testing.T) {
		// This cleanup runs when THIS SUBTEST ends — correct.
		t.Cleanup(func() { /* cleanup subtest resources */ })

		// A defer here would also work for the subtest function,
		// but t.Cleanup is more explicit and integrates with t.Parallel().
	})
}
```

**Common pitfall:** Forgetting `t.Helper()` in helpers. Your test output will say the failure is on line 12 of `helpers_test.go` instead of line 45 of `user_service_test.go`. Always add it.

---

## 5. Mocking — Interfaces Make It Trivial

### Why Before How

Go's approach to mocking flows from its interface system: interfaces are implicit, small, and defined by the consumer. If your function depends on a `Database` interface (not a concrete `*sql.DB`), you can pass a mock that implements the same interface. No reflection, no code generation required for basic mocks — just implement the interface in your test file.

This is a deliberate contrast to Java/C# where mocking requires frameworks (Mockito, Moq) that use reflection to generate proxy classes at runtime. Go mocks are plain structs. They're readable, debuggable, and don't require `go generate`.

```go
// emailservice/emailer.go
package emailservice

import "fmt"

// EmailSender is the interface our service depends on.
// Small interfaces (1-2 methods) are idiomatic Go.
type EmailSender interface {
	Send(to, subject, body string) error
}

// WelcomeService uses an EmailSender — it doesn't care about the concrete type.
type WelcomeService struct {
	sender EmailSender
}

func NewWelcomeService(sender EmailSender) *WelcomeService {
	return &WelcomeService{sender: sender}
}

func (ws *WelcomeService) SendWelcome(userEmail string) error {
	subject := "Welcome to the platform!"
	body := fmt.Sprintf("Hi %s, thanks for signing up.", userEmail)
	return ws.sender.Send(userEmail, subject, body)
}
```

```go
// emailservice/emailer_test.go
package emailservice

import (
	"errors"
	"testing"
)

// MockEmailSender is a hand-written mock — no frameworks needed.
// It records calls so tests can assert on behavior, not just output.
type MockEmailSender struct {
	// Calls records every call made to Send.
	Calls []SendCall
	// ReturnErr controls what Send returns — set per test.
	ReturnErr error
}

type SendCall struct {
	To      string
	Subject string
	Body    string
}

// Send implements the EmailSender interface.
func (m *MockEmailSender) Send(to, subject, body string) error {
	m.Calls = append(m.Calls, SendCall{To: to, Subject: subject, Body: body})
	return m.ReturnErr
}

// TestSendWelcome_Success verifies the happy path.
func TestSendWelcome_Success(t *testing.T) {
	mock := &MockEmailSender{}
	svc := NewWelcomeService(mock)

	err := svc.SendWelcome("alice@example.com")
	if err != nil {
		t.Fatalf("SendWelcome unexpected error: %v", err)
	}

	// Assert that Send was called exactly once.
	if len(mock.Calls) != 1 {
		t.Fatalf("Send called %d times; want 1", len(mock.Calls))
	}

	// Assert it was called with the correct recipient.
	call := mock.Calls[0]
	if call.To != "alice@example.com" {
		t.Errorf("Send.To = %q; want %q", call.To, "alice@example.com")
	}
	if call.Subject != "Welcome to the platform!" {
		t.Errorf("Send.Subject = %q; want %q", call.Subject, "Welcome to the platform!")
	}
}

// TestSendWelcome_SenderFails verifies error propagation.
func TestSendWelcome_SenderFails(t *testing.T) {
	mock := &MockEmailSender{
		ReturnErr: errors.New("SMTP connection refused"),
	}
	svc := NewWelcomeService(mock)

	err := svc.SendWelcome("bob@example.com")
	if err == nil {
		t.Fatal("expected error when sender fails, got nil")
	}
}

// FuncMock demonstrates mocking with a function field — lighter than a full struct.
// Useful when the interface has just one method.
type FuncEmailSender struct {
	SendFunc func(to, subject, body string) error
}

func (f *FuncEmailSender) Send(to, subject, body string) error {
	return f.SendFunc(to, subject, body)
}

func TestSendWelcome_FuncMock(t *testing.T) {
	called := false
	mock := &FuncEmailSender{
		SendFunc: func(to, subject, body string) error {
			called = true
			return nil
		},
	}

	svc := NewWelcomeService(mock)
	_ = svc.SendWelcome("carol@example.com")

	if !called {
		t.Error("Send was not called")
	}
}
```

**Common pitfall:** Making interfaces too large. If your `Database` interface has 50 methods, every mock must implement 50 methods. Refactor to smaller interfaces: `UserReader`, `UserWriter`, `UserDeleter`. The mock only implements what the code under test actually needs.

---

## 6. Integration Tests — Build Tags

### Why Before How

Integration tests hit real external systems: databases, HTTP services, message queues. They're slow (seconds vs milliseconds) and require setup. If they run on every `go test ./...`, they slow down the feedback loop and fail in environments without the external systems. Build tags solve this: tag integration tests with `//go:build integration`, and they only run when you explicitly pass `-tags integration`.

This is standard at Stripe (fast tests in development, integration tests in CI), Kubernetes (unit tests always, integration tests require `kind` cluster), and Cloudflare.

```go
// store/db_integration_test.go

//go:build integration
// +build integration
// The second line is for Go 1.16 compatibility. Go 1.17+ only needs the first line.

package store

import (
	"database/sql"
	"fmt"
	"os"
	"testing"

	_ "github.com/lib/pq" // postgres driver — only needed for integration tests
)

// TestUserStore_Integration tests against a real PostgreSQL database.
// This only compiles and runs with: go test -tags integration ./store/...
func TestUserStore_Integration(t *testing.T) {
	// Skip with a clear message if environment not configured.
	// Better than failing with a cryptic connection error.
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := db.Ping(); err != nil {
		t.Fatalf("db.Ping: %v — is Postgres running?", err)
	}

	// Create a test table unique to this test run to avoid conflicts.
	tableName := fmt.Sprintf("test_users_%d", os.Getpid())
	_, err = db.Exec(fmt.Sprintf(`CREATE TABLE %s (id SERIAL PRIMARY KEY, name TEXT)`, tableName))
	if err != nil {
		t.Fatalf("CREATE TABLE: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(fmt.Sprintf("DROP TABLE %s", tableName))
	})

	// Insert a user
	_, err = db.Exec(fmt.Sprintf("INSERT INTO %s (name) VALUES ($1)", tableName), "Alice")
	if err != nil {
		t.Fatalf("INSERT: %v", err)
	}

	// Query it back
	var name string
	err = db.QueryRow(fmt.Sprintf("SELECT name FROM %s WHERE id = 1", tableName)).Scan(&name)
	if err != nil {
		t.Fatalf("SELECT: %v", err)
	}

	if name != "Alice" {
		t.Errorf("got name %q; want %q", name, "Alice")
	}
}
```

**Run only unit tests (default):**
```bash
go test ./...
```

**Run integration tests:**
```bash
go test -tags integration ./...
TEST_DATABASE_URL="postgres://user:pass@localhost/testdb" go test -tags integration ./store/...
```

**Common pitfall:** Using `t.Skip` without a message. `t.Skip("reason")` leaves a clear trace in CI that the test was intentionally skipped, not silently missing. Always explain why.

---

## 7. Benchmarks — Measuring Performance

### Why Before How

Benchmarks answer: "How fast is this code, and how much memory does it allocate?" They're essential before and after optimization. Without benchmarks, you're guessing. Cloudflare uses benchmarks to ensure their DNS lookup code stays under 100 microseconds. Uber's fare calculation benchmarks catch if a refactor accidentally adds an allocation per ride (millions of rides = meaningful cost).

`func BenchmarkXxx(b *testing.B)` is the signature. The test runner controls `b.N` — the number of iterations. It starts small and increases until the benchmark runs for at least 1 second (by default). Your code goes in a loop: `for i := 0; i < b.N; i++ { ... }`.

```go
// math/calculator_bench_test.go
package math

import (
	"fmt"
	"strings"
	"testing"
)

// BenchmarkAdd measures the cost of Add.
// b.N is controlled by the test runner — do not set it manually.
func BenchmarkAdd(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Add(100, 200) // The code under measurement
	}
}

// BenchmarkStringConcatenation compares two approaches.
// Run with: go test -bench=BenchmarkString -benchmem ./math/...
func BenchmarkStringConcat_Plus(b *testing.B) {
	words := []string{"the", "quick", "brown", "fox"}
	b.ResetTimer() // reset timer after setup — setup time shouldn't be measured

	for i := 0; i < b.N; i++ {
		result := ""
		for _, w := range words {
			result += w // each += allocates a new string — O(n²) allocations
		}
		_ = result // prevent compiler from optimizing away the work
	}
}

func BenchmarkStringConcat_Builder(b *testing.B) {
	words := []string{"the", "quick", "brown", "fox"}
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		var sb strings.Builder
		for _, w := range words {
			sb.WriteString(w) // single allocation, amortized growth
		}
		_ = sb.String()
	}
}

// BenchmarkWithSubBenchmarks runs multiple sub-benchmarks.
// Useful for comparing across input sizes (scaling characteristics).
func BenchmarkDivide(b *testing.B) {
	cases := []struct {
		name string
		a, b float64
	}{
		{"small", 10, 3},
		{"large", 1e15, 7},
	}

	for _, bc := range cases {
		bc := bc
		b.Run(bc.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				_, _ = Divide(bc.a, bc.b)
			}
		})
	}
}

// BenchmarkAllocations shows how -benchmem reports allocations.
// -benchmem output: "N ns/op   X B/op   Y allocs/op"
// X B/op = bytes allocated per operation
// Y allocs/op = heap allocations per operation
func BenchmarkMapLookup(b *testing.B) {
	m := make(map[string]int, 1000)
	for i := 0; i < 1000; i++ {
		m[fmt.Sprintf("key%d", i)] = i
	}

	b.ResetTimer() // don't measure map construction
	b.ReportAllocs() // equivalent to running with -benchmem for this benchmark

	for i := 0; i < b.N; i++ {
		_ = m["key500"]
	}
}

// BenchmarkParallel measures throughput under concurrent load.
// This is how Cloudflare tests their concurrent request handlers.
func BenchmarkAdd_Parallel(b *testing.B) {
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			Add(100, 200)
		}
	})
}
```

**Run benchmarks:**
```bash
go test -bench=. ./math/...                    # run all benchmarks
go test -bench=BenchmarkStringConcat -benchmem # with allocation stats
go test -bench=. -benchtime=5s ./math/...      # run for 5 seconds instead of 1
go test -bench=. -count=5 ./math/...           # run each benchmark 5 times (for stable results)
```

**Sample output:**
```
BenchmarkStringConcat_Plus-8      5000000    320 ns/op    128 B/op    4 allocs/op
BenchmarkStringConcat_Builder-8  20000000     78 ns/op     64 B/op    1 allocs/op
```

**Common pitfall:** Not using `b.ResetTimer()` after expensive setup. If you're building a 10,000-element map before the benchmark loop, that construction time contaminates your results. Call `b.ResetTimer()` after setup and before the loop.

**Common pitfall:** Not discarding results. `_ = result` prevents the compiler from optimizing away the entire function call (dead code elimination). If you don't use the result, the compiler may skip the function — your benchmark measures zero work.

---

## 8. Profiling During Tests

### Why Before How

Benchmarks tell you HOW FAST. Profiling tells you WHY SLOW. `go test` can generate CPU and memory profiles during a benchmark run — the same profiles you'd analyze with `pprof`. This is how senior engineers find the hot path: run the benchmark, profile it, read the flame graph, fix the bottleneck. No external profiler needed.

```bash
# Generate CPU profile
go test -bench=BenchmarkStringConcat_Plus -cpuprofile=cpu.out ./math/...

# Generate memory (heap) profile  
go test -bench=BenchmarkAllocations -memprofile=mem.out ./math/...

# Analyze with pprof — opens interactive shell
go tool pprof cpu.out

# In pprof shell:
# top        — show top CPU consumers
# list Add   — show annotated source for Add function
# web        — open flame graph in browser (requires graphviz)

# One-liner: generate and open flame graph
go test -bench=. -cpuprofile=cpu.out ./math/... && go tool pprof -http=:8080 cpu.out
```

```go
// You can also trigger profiling programmatically in tests:
// math/profile_test.go
package math

import (
	"os"
	"runtime/pprof"
	"testing"
)

func TestCPUProfile(t *testing.T) {
	f, err := os.Create("cpu.prof")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	if err := pprof.StartCPUProfile(f); err != nil {
		t.Fatal(err)
	}
	defer pprof.StopCPUProfile()

	// Code to profile
	for i := 0; i < 1000000; i++ {
		Add(i, i+1)
	}

	// Profile written to cpu.prof — analyze with: go tool pprof cpu.prof
}
```

---

## 9. Fuzzing — Go 1.18+

### Why Before How

Fuzzing is automated adversarial testing: the engine generates random inputs and tries to crash or trigger unexpected behavior. Go 1.18 made fuzzing a first-class language feature — the first major language to do so in its standard toolchain. This is not a niche tool. Cloudflare uses fuzz testing on their TLS/protocol parsers. Docker uses it on image manifest parsing. Any function that parses untrusted external input is a fuzzing target: JSON parsers, URL parsers, protocol decoders, compression algorithms.

The key insight: you already know what properties should hold (`parse(encode(x)) == x`, no panics on any input, output length never exceeds input length). Fuzzing finds inputs that violate those properties.

```go
// parser/url_parser.go
package parser

import (
	"fmt"
	"strings"
)

// ParseSimpleURL parses a URL of the form "scheme://host/path".
// This is intentionally simplified for demonstration.
func ParseSimpleURL(raw string) (scheme, host, path string, err error) {
	if !strings.Contains(raw, "://") {
		return "", "", "", fmt.Errorf("missing ://")
	}

	parts := strings.SplitN(raw, "://", 2)
	scheme = parts[0]
	rest := parts[1]

	if idx := strings.Index(rest, "/"); idx >= 0 {
		host = rest[:idx]
		path = rest[idx:]
	} else {
		host = rest
		path = "/"
	}

	if scheme == "" {
		return "", "", "", fmt.Errorf("empty scheme")
	}
	return scheme, host, path, nil
}
```

```go
// parser/url_parser_fuzz_test.go
package parser

import (
	"strings"
	"testing"
)

// FuzzParseSimpleURL fuzzes the URL parser.
// The function signature is: FuzzXxx(f *testing.F)
func FuzzParseSimpleURL(f *testing.F) {
	// Seed corpus — initial valid inputs for the fuzzer to mutate.
	// These should be representative of real inputs.
	f.Add("https://example.com/path")
	f.Add("http://localhost:8080/api/v1")
	f.Add("ftp://files.example.com/file.txt")
	f.Add("://missing-scheme")
	f.Add("")

	// The fuzz target — called with the seed corpus first, then mutations.
	f.Fuzz(func(t *testing.T, input string) {
		// Property 1: ParseSimpleURL must never panic on any input.
		// The fuzzer will call this with millions of mutations looking for panics.
		scheme, host, path, err := ParseSimpleURL(input)

		// Property 2: If no error, results must be consistent.
		if err == nil {
			if scheme == "" {
				t.Errorf("ParseSimpleURL(%q) returned empty scheme with nil error", input)
			}
			if host == "" && !strings.Contains(input, "://") {
				t.Errorf("ParseSimpleURL(%q) returned empty host", input)
			}
			// Reconstruct and verify round-trip property
			reconstructed := scheme + "://" + host + path
			if !strings.HasPrefix(reconstructed, scheme+"://") {
				t.Errorf("round-trip failed for %q", input)
			}
		}
	})
}
```

**Run fuzz tests:**
```bash
# Run the seed corpus only (fast — like a regular test):
go test -run FuzzParseSimpleURL ./parser/...

# Run the fuzzer for 30 seconds (generates and tests millions of inputs):
go test -fuzz FuzzParseSimpleURL -fuzztime=30s ./parser/...

# If the fuzzer finds a crash, it writes the failing input to:
# testdata/fuzz/FuzzParseSimpleURL/<hash>
# That input is then part of the regression corpus forever.

# Run only the saved corpus (reproduces past failures):
go test -run FuzzParseSimpleURL ./parser/...
```

**Common pitfall:** Not adding a seed corpus. Without seeds, the fuzzer starts from random bytes — less efficient. Add representative inputs including edge cases (empty string, max length, special characters).

---

## 10. Race Detector

### Why Before How

Go's race detector instruments every memory access at compile time and detects when two goroutines access the same variable concurrently without synchronization. It adds ~5-10x runtime overhead, which is why you don't run it in production — but you ALWAYS run it in tests and CI. Uber found that without `-race` in CI, data races slipped through code review, caused silent data corruption in production, and took days to diagnose. With `-race`, they're caught in seconds.

```go
// counter/counter.go
package counter

import "sync"

// SafeCounter is goroutine-safe — race detector will find no issues.
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

// UnsafeCounter is NOT goroutine-safe — intentional for demonstration.
type UnsafeCounter struct {
	count int // no synchronization
}

func (c *UnsafeCounter) Increment() {
	c.count++ // RACE CONDITION: concurrent read-modify-write
}
```

```go
// counter/counter_test.go
package counter

import (
	"sync"
	"testing"
)

// TestSafeCounter_Race verifies SafeCounter under concurrent access.
// Run with: go test -race ./counter/...
// The race detector will find no issues here — correctly synchronized.
func TestSafeCounter_Race(t *testing.T) {
	c := &SafeCounter{}
	var wg sync.WaitGroup

	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.Increment()
		}()
	}

	wg.Wait()

	got := c.Value()
	if got != 1000 {
		t.Errorf("SafeCounter.Value() = %d; want 1000", got)
	}
}

// TestUnsafeCounter_Race demonstrates what a race looks like.
// go test -race WILL report a data race on UnsafeCounter.
// This test may also produce wrong results (non-deterministic).
func TestUnsafeCounter_Race(t *testing.T) {
	c := &UnsafeCounter{}
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.Increment()
		}()
	}

	wg.Wait()
	// Result may not be 100 — concurrent increments are lost.
	// With -race: "DATA RACE: Read at 0x... by goroutine N, Write at 0x... by goroutine M"
	t.Logf("UnsafeCounter value: %d (expected 100, may differ)", c.count)
}
```

**Run with race detector:**
```bash
go test -race ./...                    # all packages
go test -race -count=10 ./counter/...  # run 10 times — races are non-deterministic
```

**CI recommendation:**
```bash
# In .github/workflows/ci.yml or equivalent:
go test -race -timeout 5m ./...
```

---

## 11. Coverage

### Why Before How

Coverage measures which lines of code were executed during tests. It's a proxy for test quality — not a guarantee. 100% coverage with trivial tests is worthless. 70% coverage with well-chosen tests is valuable. Google's internal policy: coverage below a threshold blocks merging. The `go test -cover` flag is built-in. `go tool cover -html` generates an HTML report coloring covered/uncovered lines.

```bash
# Basic coverage — shows percentage per package
go test -cover ./...
# Output: ok  calculator   coverage: 87.5% of statements

# Generate coverage data file
go test -coverprofile=coverage.out ./...

# View as HTML — opens browser with red/green line highlighting
go tool cover -html=coverage.out

# Show per-function coverage
go tool cover -func=coverage.out

# Coverage for specific packages only
go test -coverprofile=coverage.out -coverpkg=./math/... ./...
```

```go
// coverage/threshold_test.go
package coverage

import (
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// TestCoverageThreshold is a meta-test: it fails if coverage drops below 80%.
// Used in some organizations as an automated coverage gate.
// Note: This is a demonstration pattern — many teams use CI scripts instead.
func TestCoverageThreshold(t *testing.T) {
	t.Skip("meta-test: run manually or in CI with: go test -cover ./...")

	cmd := exec.Command("go", "test", "-cover", "./...")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go test failed: %v\n%s", err, out)
	}

	// Parse "coverage: 87.5% of statements"
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "coverage:") {
			parts := strings.Fields(line)
			for i, p := range parts {
				if p == "coverage:" && i+1 < len(parts) {
					pct, err := strconv.ParseFloat(strings.TrimSuffix(parts[i+1], "%"), 64)
					if err == nil && pct < 80.0 {
						t.Errorf("coverage %.1f%% is below threshold 80%%", pct)
					}
				}
			}
		}
	}
}
```

---

## 12. Example Tests — Documentation That Compiles

### Why Before How

Example functions serve dual purpose: (1) they appear as runnable examples in `go doc` and pkg.go.dev documentation, and (2) they're executed as tests. If the output comment doesn't match actual output, the test fails. This is Go's guarantee that documentation stays in sync with code — something Javadoc and docstrings can never provide. `godoc` renders these examples in the browser with a "Run" button.

```go
// math/example_test.go
package math_test // Note: _test suffix allows external package perspective (like a user)

import (
	"fmt"
)

// ExampleAdd demonstrates the Add function.
// The "// Output:" comment is verified at test time.
// This also appears in `go doc math Add` as a runnable example.
func ExampleAdd() {
	result := Add(2, 3)
	fmt.Println(result)
	// Output:
	// 5
}

// ExampleDivide shows normal usage and error handling.
func ExampleDivide() {
	result, err := Divide(10, 2)
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Println(result)
	// Output:
	// 5
}

// ExampleDivide_byZero shows the error case.
// The suffix _byZero creates a second example for the same function.
func ExampleDivide_byZero() {
	_, err := Divide(10, 0)
	fmt.Println(err)
	// Output:
	// divide by zero: cannot divide 10 by 0
}

// ExampleAdd_table demonstrates multiple calls — output must match exactly.
func ExampleAdd_table() {
	pairs := [][2]int{{1, 2}, {3, 4}, {5, 6}}
	for _, p := range pairs {
		fmt.Printf("%d + %d = %d\n", p[0], p[1], Add(p[0], p[1]))
	}
	// Output:
	// 1 + 2 = 3
	// 3 + 4 = 7
	// 5 + 6 = 11
}

// ExampleWithUnorderedOutput demonstrates unordered output matching.
// Use when output order is non-deterministic (e.g., map iteration).
func ExampleMapKeys() {
	m := map[string]int{"a": 1, "b": 2}
	for k := range m {
		fmt.Println(k)
	}
	// Unordered output:
	// a
	// b
}

// Placeholder functions used in examples
func Add(a, b int) int          { return a + b }
func Divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, fmt.Errorf("divide by zero: cannot divide %v by 0", a)
	}
	return a / b, nil
}

func MapKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
```

**Run example tests:**
```bash
go test -run Example ./math/...
go test -v -run Example ./math/...  # verbose shows each example
```

---

## Summary: The Complete Test Command Reference

```bash
# Run all tests
go test ./...

# Verbose output (show each test name)
go test -v ./...

# Run specific test by name (regex)
go test -run TestAdd ./math/...
go test -run "TestDivide_TableDriven/division_by_zero" ./math/...

# Run with race detector (ALWAYS in CI)
go test -race ./...

# Run with coverage
go test -cover ./...
go test -coverprofile=cov.out ./... && go tool cover -html=cov.out

# Run benchmarks
go test -bench=. -benchmem ./...
go test -bench=BenchmarkAdd -benchtime=5s ./math/...

# Run integration tests (build tag)
go test -tags integration ./...

# Run fuzz test for 30 seconds
go test -fuzz FuzzParseSimpleURL -fuzztime=30s ./parser/...

# Profile a benchmark
go test -bench=BenchmarkStringConcat -cpuprofile=cpu.out ./math/...
go tool pprof -http=:8080 cpu.out

# Timeout (prevent hanging tests)
go test -timeout 30s ./...

# Run tests multiple times (detect flaky tests)
go test -count=10 ./...

# Show test binary without running (check compilation)
go test -c -o /dev/null ./...
```

---

## Quick Reference: testing.T Methods

| Method | Effect | When to Use |
|--------|--------|-------------|
| `t.Error(args...)` | Log + mark failed, continue | Non-fatal assertion |
| `t.Errorf(fmt, args...)` | Log formatted + mark failed, continue | Non-fatal with formatting |
| `t.Fatal(args...)` | Log + mark failed + stop test | Fatal error, further code is meaningless |
| `t.Fatalf(fmt, args...)` | Log formatted + mark failed + stop | Fatal with formatting |
| `t.Log(args...)` | Log only (shown on failure or -v) | Debug info |
| `t.Logf(fmt, args...)` | Log formatted | Debug with formatting |
| `t.Skip(reason)` | Mark skipped + stop test | Test not applicable in this environment |
| `t.Helper()` | Mark as helper function | Every test utility function |
| `t.Cleanup(fn)` | Register teardown | Resource cleanup |
| `t.Run(name, fn)` | Create subtest | Table-driven test cases |
| `t.Parallel()` | Mark as parallel | Independent tests |
| `t.TempDir()` | Create + auto-cleanup temp dir | File-based tests |
