# Go Packages & Modules

## What Is This?

Go packages are the fundamental unit of code organization — every `.go` file belongs to a package, and a package is a collection of Go source files in the same directory that are compiled together. Go modules are a higher-level concept introduced in Go 1.11 and made the default in Go 1.16: a module is a versioned collection of related packages with an explicit dependency manifest (`go.mod`). Together, packages and modules form Go's entire code organization and dependency management system.

## Why Does It Exist?

Before modules (pre-2018), Go used `GOPATH` — a single workspace directory where all Go code had to live at `$GOPATH/src/github.com/user/repo`. This created severe problems: you could not have two projects depending on different versions of the same library, there was no versioning concept, and every developer's machine had to be configured identically. It also made CI/CD fragile and reproducible builds nearly impossible.

Go modules solve this by giving each project its own dependency graph with pinned, cryptographically verified versions. The `go.mod` file captures the minimum required versions; `go.sum` stores checksums so that `go get` can verify the exact bytes downloaded match what the author published. The design decision was to make dependency management a first-class language feature rather than a third-party tool (unlike npm, pip, or Maven).

## Who Uses This in Industry?

- **Google**: Manages one of the world's largest Go monorepos internally using a custom build system (Bazel), but all open-source Go projects (like gRPC-Go, protobuf-Go) are published as standard modules on `proxy.golang.org`. The module proxy itself is operated by Google and handles billions of requests.
- **Uber**: Runs hundreds of Go microservices, each as its own module. They use `internal/` packages extensively to enforce service boundary rules — code in `service-a/internal/` literally cannot be imported by `service-b`, enforced by the Go compiler.
- **Docker / Moby**: The Docker engine is written in Go and uses modules for all dependencies. Their `go.mod` lists over 100 direct dependencies. They use `go mod vendor` to vendor all dependencies into the repository for hermetic builds in CI.
- **Kubernetes**: Uses a complex multi-module workspace. The main `k8s.io/kubernetes` module imports `k8s.io/api`, `k8s.io/client-go`, etc. as separate versioned modules — an architecture that allows external consumers to import just `client-go` without pulling in the entire Kubernetes source tree.
- **Cloudflare**: Uses Go modules with private module proxies (`GOPROXY=https://internal-proxy.cloudflare.com,direct`) so internal packages are never accidentally published to the public internet.

## Industry Standards & Best Practices

**Senior engineers do:**
- Keep module paths aligned with the repository URL (e.g., `module github.com/company/service`)
- Run `go mod tidy` before every commit to keep `go.mod` and `go.sum` clean
- Use `internal/` aggressively to enforce API boundaries between subsystems
- Pin Go version in `go.mod` to match the CI/CD toolchain version
- Use `go mod vendor` in production deployments for hermetic, offline builds
- Set up a private GOPROXY for any internal modules
- Use semantic versioning properly — never break a v1 API; bump to v2 with a new import path

**Beginners typically do:**
- Put everything in `package main` or one giant package
- Use `go get -u` carelessly, pulling in unvetted version upgrades
- Ignore `go.sum` or commit it inconsistently
- Forget to run `go mod tidy`, leaving stale entries in `go.mod`
- Create circular imports that require full package restructuring to fix

## Why Go's Approach Is Unique

Go's module system is deliberately minimal compared to other languages:

| Language | Approach | Problem |
|----------|----------|---------|
| Node/npm | Semantic version ranges (`^1.2.3`) | "npm hell" — two packages require incompatible versions, resolution is non-deterministic |
| Python/pip | No standard lockfile (pre-Poetry) | Works on my machine, fails in prod |
| Java/Maven | Nearest-wins resolution | Transitive dependency hell, version conflicts at runtime |
| Go modules | **Minimal Version Selection (MVS)** | Always picks the minimum version that satisfies all constraints — fully deterministic |

Go's unique design choices:
1. **MVS is deterministic**: Given the same `go.mod`, every developer and CI system gets identical binaries. No `--frozen-lockfile` flag needed.
2. **Major versions change import paths**: `import "github.com/foo/bar/v2"` is a different package from `import "github.com/foo/bar"`. This eliminates the "diamond dependency" problem at the type level.
3. **The compiler enforces `internal/`**: No configuration, no linting rule — the compiler rejects invalid cross-package imports.
4. **Visibility via capitalization**: A single rule (capital letter = exported) replaces Java's `public`/`private`/`protected`/`package` quartet. Simpler, faster to read.

---

## 1. Packages — Basic

### Why Package Declaration Exists

Every `.go` file must start with `package <name>`. This declaration tells the compiler which compilation unit the file belongs to. All files in the same directory must share the same package name (with the exception of `_test.go` files, which can use `package foo_test` for black-box testing).

Naming rules that are industry-enforced (not just style suggestions):
- Package names are **lowercase, single word** — `http`, `json`, `strconv`, not `HttpClient` or `string_util`
- The package name is the default identifier callers use: `json.Marshal`, not `encoding_json.Marshal`
- Avoid stuttering: a package named `user` should export `User`, not `UserUser`

```go
// File: greet/greet.go
// module: example.com/hello (from go.mod in parent)
package greet

import "fmt"

// Exported: capital G — visible outside this package
func Greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}

// unexported: lowercase b — only visible within package greet
func buildPrefix(honorific string) string {
    return honorific + " "
}

// Exported type
type Greeter struct {
    Language string // exported field
    dialect  string // unexported field — only accessible within greet package
}

// Exported method
func (g Greeter) SayHello(name string) string {
    return fmt.Sprintf("[%s] Hello, %s", g.Language, name)
}
```

```go
// File: main.go
package main

import (
    "fmt"
    "example.com/hello/greet" // import path, not directory path
)

func main() {
    msg := greet.Greet("World")
    fmt.Println(msg) // Hello, World!

    g := greet.Greeter{Language: "EN"}
    // g.dialect = "cockney"  // COMPILE ERROR: unexported field
    fmt.Println(g.SayHello("Alice"))

    // greet.buildPrefix("Dr.")  // COMPILE ERROR: unexported function
}
```

```
# go.mod (in project root)
module example.com/hello

go 1.22
```

**Pitfall**: Many beginners name their package after the directory but add redundant context. A package in `pkg/database/` should be `package database`, not `package databasepkg`. Callers will write `database.Connect()`, which reads naturally.

---

## 2. The `init()` Function — Execution Order

`init()` runs automatically before `main()` — you cannot call it manually. Its primary use is one-time setup that must happen before any code in the package runs (registering drivers, validators, codecs).

**Execution order** (critical to understand):
1. All imported packages initialize first (recursively)
2. Package-level variables initialize in order of declaration
3. `init()` functions run in the order they appear in source, then across files in lexicographic filename order
4. A single package can have multiple `init()` functions, even in the same file

```go
// File: storage/postgres/driver.go
package postgres

import (
    "database/sql"
    "fmt"
)

// Package-level var initializes BEFORE init()
var driverName = "pgx"

func init() {
    // This runs automatically when the package is imported
    fmt.Printf("postgres driver %q registered\n", driverName)
    // In real code: sql.Register("postgres", &Driver{})
    _ = sql.Open // just to show the import is used
}

// Exported function the caller actually uses
func Connect(dsn string) string {
    return fmt.Sprintf("connected via %s to %s", driverName, dsn)
}
```

```go
// File: main.go
package main

import (
    "fmt"

    // Blank import: import ONLY for the side effect of running init()
    // The postgres package registers its SQL driver in init().
    // We never call postgres.Connect directly here.
    _ "example.com/hello/storage/postgres"
)

func main() {
    // By the time main() runs, postgres init() has already executed
    fmt.Println("main started")
}
```

**Output:**
```
postgres driver "pgx" registered
main started
```

**Industry use case**: The entire `database/sql` ecosystem in Go works this way. You write `import _ "github.com/lib/pq"` to register the PostgreSQL driver — the blank import triggers `init()`, which calls `sql.Register("postgres", &pq.Driver{})`. Your code then calls `sql.Open("postgres", dsn)` without ever directly referencing the `pq` package.

**Pitfall**: Overusing `init()` for complex setup logic creates hidden execution order bugs. Prefer explicit initialization functions (`func New() *Service`) that callers control. Use `init()` only for stateless registration patterns.

---

## 3. Internal Packages — Compiler-Enforced Boundaries

The `internal/` directory is not just a convention — the Go compiler **rejects** imports of `internal/` packages from outside the subtree rooted at the parent of `internal/`. This is the only access control mechanism in Go that is enforced by the compiler rather than tooling.

```
myservice/
├── go.mod
├── main.go
├── api/
│   └── handler.go          # CAN import internal/
├── internal/
│   ├── config/
│   │   └── config.go       # Cannot be imported outside myservice/
│   └── repository/
│       └── user_repo.go    # Cannot be imported outside myservice/
└── pkg/
    └── middleware/
        └── auth.go         # Public — other modules CAN import this
```

```go
// File: internal/config/config.go
package config

// Config holds service configuration.
// This type is internal — only code within myservice/ can use it.
type Config struct {
    DatabaseURL string
    Port        int
    Debug       bool
}

// Load reads configuration. Unexported helper only within this package.
func load(path string) (*Config, error) {
    // simplified
    return &Config{Port: 8080, Debug: false, DatabaseURL: "postgres://..."}, nil
}

// New is the exported constructor — still only accessible within myservice/
func New(path string) (*Config, error) {
    return load(path)
}
```

```go
// File: api/handler.go
package api

import (
    "fmt"
    "example.com/myservice/internal/config" // ALLOWED: same module tree
)

type Handler struct {
    cfg *config.Config
}

func NewHandler() *Handler {
    cfg, err := config.New("/etc/myservice/config.yaml")
    if err != nil {
        panic(err)
    }
    return &Handler{cfg: cfg}
}

func (h *Handler) ServeInfo() string {
    return fmt.Sprintf("running on port %d", h.cfg.Port)
}
```

```go
// File: main.go
package main

import (
    "fmt"
    "example.com/myservice/api"
    "example.com/myservice/internal/config" // ALLOWED: we are inside myservice/
)

func main() {
    h := api.NewHandler()
    fmt.Println(h.ServeInfo())

    cfg, _ := config.New("")
    fmt.Printf("debug mode: %v\n", cfg.Debug)
}
```

```
# go.mod
module example.com/myservice

go 1.22
```

If an **external** module tried `import "example.com/myservice/internal/config"`, the compiler error would be:
```
imports example.com/myservice/internal/config: use of internal package not allowed
```

**Industry use**: Kubernetes uses `internal/` to separate the core scheduler logic from the public client libraries. Uber uses it to prevent inter-service coupling — a Go microservice's internal packages form a hard API boundary.

---

## 4. Modules — `go.mod` and `go.sum` in Depth

### The `go.mod` File

```
module github.com/acme/payments

go 1.22

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/jackc/pgx/v5 v5.5.4
    go.uber.org/zap v1.26.0
)

require (
    // Indirect dependencies — brought in by the above
    github.com/bytedance/sonic v1.11.3 // indirect
    github.com/gin-contrib/sse v0.1.0 // indirect
)
```

- `module`: the canonical import path prefix for ALL packages in this module
- `go 1.22`: the minimum Go toolchain version; also controls language feature availability
- `require`: direct dependencies with their minimum acceptable versions
- `// indirect`: transitive dependency that your code doesn't import directly, but a direct dep needs

### The `go.sum` File

```
github.com/gin-gonic/gin v1.9.1 h1:4idEAncQnU5cB7BeOkPtxjfCSye0AAm1R0RVIqJ+Jmg=
github.com/gin-gonic/gin v1.9.1/go.mod h1:hPrL7YrpYKXt5YId3A/Tnip5kqbEAP+KLuI3SUcPTeU=
```

Each dependency has two hashes:
- `h1:` — SHA-256 of the zip archive contents (the actual code)
- `/go.mod h1:` — SHA-256 of just the `go.mod` file

These hashes are verified against the **Go checksum database** (`sum.golang.org`), a transparency log operated by Google. If someone tampers with a published module version, the hash won't match and `go` commands will fail with an error. This is Go's supply chain security mechanism.

```go
// File: main.go — shows a real module with external dependencies
package main

import (
    "fmt"
    "net/http"

    "github.com/gin-gonic/gin"
    "go.uber.org/zap"
)

func main() {
    logger, _ := zap.NewProduction()
    defer logger.Sync()

    r := gin.Default()

    r.GET("/health", func(c *gin.Context) {
        logger.Info("health check called",
            zap.String("path", c.Request.URL.Path),
        )
        c.JSON(http.StatusOK, gin.H{"status": "ok"})
    })

    fmt.Println("Starting server on :8080")
    r.Run(":8080")
}
```

**Essential module commands:**

```bash
# Initialize a new module
go mod init github.com/acme/payments

# Add a dependency (pins the latest tagged version)
go get github.com/gin-gonic/gin@v1.9.1

# Update to latest patch version
go get github.com/gin-gonic/gin@latest

# Remove unused deps, add missing ones — run before every commit
go mod tidy

# Vendor all dependencies into ./vendor/ for hermetic builds
go mod vendor

# Build using vendor/ directory
go build -mod=vendor ./...

# Show dependency graph
go mod graph

# Show why a package is needed
go mod why github.com/bytedance/sonic
```

**Pitfall**: Never run `go get -u ./...` in production repositories without reviewing what changes. This upgrades ALL indirect dependencies to their latest minor versions, which can introduce breaking changes masked by semver patches.

---

## 5. Semantic Versioning and Major Version Modules

Go modules enforce a rule called **import compatibility rule**: if a new version of a module breaks its API, it must change its import path. This is why v2+ modules have `/v2` in the path.

```
# v1 (go.mod)
module github.com/acme/sdk

# v2 (go.mod) — DIFFERENT module path
module github.com/acme/sdk/v2
```

This means a Go binary can import **both** v1 and v2 of the same library simultaneously, with no type conflicts, because they are treated as completely separate packages.

```go
// File: v2/client/client.go
// This is github.com/acme/sdk/v2 — a breaking API change from v1
package client

import "fmt"

// V2 changed the signature — added context parameter (breaking change)
type Config struct {
    Endpoint string
    Timeout  int
    // New in v2: RetryPolicy
    RetryPolicy string
}

func New(cfg Config) *Client {
    return &Client{cfg: cfg}
}

type Client struct {
    cfg Config
}

func (c *Client) Call(endpoint string) string {
    return fmt.Sprintf("calling %s with retry=%s", endpoint, c.cfg.RetryPolicy)
}
```

```go
// File: main.go — using v2 of a module
package main

import (
    "fmt"
    // Note the /v2 in the import path — required for major version 2+
    client "github.com/acme/sdk/v2/client"
)

func main() {
    c := client.New(client.Config{
        Endpoint:    "https://api.acme.com",
        Timeout:     30,
        RetryPolicy: "exponential",
    })
    fmt.Println(c.Call("/users"))
}
```

```
# go.mod for the consumer
module github.com/consumer/app

go 1.22

require github.com/acme/sdk/v2 v2.1.0
```

**Industry standard**: Never release a v2 unless you have a genuinely breaking API change. Most well-maintained Go libraries (like `go.uber.org/zap`) have stayed at v1 for years by designing their API carefully upfront. Breaking the import path is a significant cost to users.

---

## 6. Minimal Version Selection (MVS)

MVS is Go's most unique contribution to dependency management. Understanding it separates senior Go engineers from everyone else.

**The problem MVS solves:**

Suppose your app requires:
- `lib-A v1.5` which requires `lib-C >= v1.2`
- `lib-B v2.0` which requires `lib-C >= v1.4`

npm, pip, and Maven all have complex resolution algorithms that can produce different results on different machines or at different times. Go's MVS always produces the same answer: **select the minimum version that satisfies all constraints**, which in this case is `lib-C v1.4`.

The key insight: module authors only test against specific versions, not "any version >= 1.2". Using the minimum means you use the version the author actually tested. Upgrades are explicit and intentional.

```
# Demonstrating MVS with go mod graph output

# Your go.mod says:
require (
    github.com/foo/A v1.5.0
    github.com/foo/B v2.0.0
)

# A's go.mod says: require github.com/foo/C v1.2.0
# B's go.mod says: require github.com/foo/C v1.4.0

# MVS selects: github.com/foo/C v1.4.0
# Because 1.4.0 >= 1.2.0 AND 1.4.0 >= 1.4.0
# It never selects 1.5.0 or latest unless you explicitly ask for it
```

```go
// File: mvs_demo/main.go
// This demonstrates checking what versions are actually selected
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    // Read the build info — shows exactly what versions MVS selected
    info, ok := debug.ReadBuildInfo()
    if !ok {
        fmt.Println("build info not available")
        return
    }

    fmt.Printf("Main module: %s\n", info.Main.Path)
    fmt.Printf("Go version: %s\n", info.GoVersion)
    fmt.Println("\nDependencies (MVS-selected versions):")
    for _, dep := range info.Deps {
        replace := ""
        if dep.Replace != nil {
            replace = fmt.Sprintf(" => %s %s", dep.Replace.Path, dep.Replace.Version)
        }
        fmt.Printf("  %s %s%s\n", dep.Path, dep.Version, replace)
    }
}
```

```
# go.mod
module example.com/mvsdemo

go 1.22
```

**Comparison: Go MVS vs npm semver ranges**

| Scenario | npm behavior | Go MVS behavior |
|----------|-------------|-----------------|
| Two packages need `lib@^1.2` and `lib@^1.4` | May install two copies (hoisting) | Always installs exactly one: v1.4 |
| Reproducibility | Needs `package-lock.json` | `go.mod` + `go.sum` are sufficient |
| Security upgrade | `npm audit fix` may change many versions | `go get lib@v1.4.1` changes only that lib |
| Transitive update | Can happen silently | Never happens without explicit `go get` |

---

## 7. Workspace Mode (Go 1.18+)

Workspaces solve the problem of **developing multiple related modules simultaneously**. Before workspaces, you had to use `replace` directives in `go.mod` pointing to local paths — but those directives had to be removed before publishing, creating a constant source of errors.

**When to use workspaces:**
- You are developing `myapp` and `mypkg` simultaneously, and `myapp` imports `mypkg`
- You want to test changes to a library against the app that uses it before publishing
- You are working in a monorepo with multiple modules

**When NOT to use workspaces:**
- Your modules are independent and you're not changing both at once
- CI/CD — workspace files (`go.work`) should not affect production builds

```
# Directory structure for workspace example
workspace-demo/
├── go.work          # workspace file
├── calculator/
│   ├── go.mod
│   └── calc.go
└── app/
    ├── go.mod
    └── main.go
```

```go
// File: workspace-demo/calculator/calc.go
package calculator

// Add adds two integers.
func Add(a, b int) int {
    return a + b
}

// Multiply multiplies two integers.
func Multiply(a, b int) int {
    return a * b
}
```

```
# File: workspace-demo/calculator/go.mod
module example.com/calculator

go 1.22
```

```go
// File: workspace-demo/app/main.go
package main

import (
    "fmt"
    // This import works because go.work tells Go where to find this module locally
    "example.com/calculator"
)

func main() {
    fmt.Println(calculator.Add(3, 4))      // 7
    fmt.Println(calculator.Multiply(3, 4)) // 12
}
```

```
# File: workspace-demo/app/go.mod
module example.com/app

go 1.22

require example.com/calculator v0.0.0
```

```
# File: workspace-demo/go.work
# Created with: go work init ./calculator ./app
go 1.22

use (
    ./calculator
    ./app
)
```

With `go.work` present, when you run `go build ./...` from the workspace root, Go uses the local `./calculator` directory instead of trying to download `example.com/calculator` from the internet.

```bash
# Workspace commands
go work init ./module1 ./module2   # create go.work
go work use ./newmodule             # add a module to workspace
go work sync                        # sync go.sum files across modules

# To build without workspace (CI should do this):
GOWORK=off go build ./...
```

**The `replace` directive alternative** (avoid in favor of workspaces):
```
# In app/go.mod — DON'T DO THIS for local dev, use workspaces instead
replace example.com/calculator => ../calculator
```
The `replace` approach is still valid for permanently replacing a module (e.g., forking a library), but not for day-to-day local development.

---

## 8. Private Modules and GOPRIVATE

When your company has private Go modules hosted on an internal VCS or private GitHub repos, you need to configure Go to bypass the public module proxy and checksum database.

```bash
# Tell Go not to use the public proxy or checksum DB for internal packages
export GOPRIVATE=github.com/acme/*,gitlab.internal.acme.com/*

# Or configure separately:
export GONOSUMCHECK=github.com/acme/*    # skip sum DB verification
export GONOPROXY=github.com/acme/*       # fetch directly, bypass proxy

# For a private proxy (common at large companies):
export GOPROXY=https://goproxy.internal.acme.com,direct

# Authenticate with private repos (for CI):
git config --global url."https://${GITHUB_TOKEN}@github.com/acme/".insteadOf "https://github.com/acme/"
```

```go
// File: service/main.go — using private and public modules together
package main

import (
    "fmt"

    // Public module — fetched from proxy.golang.org
    "go.uber.org/zap"

    // Private module — fetched directly (GOPRIVATE configured)
    "github.com/acme/internal-sdk/v2/auth"
)

func main() {
    logger, _ := zap.NewProduction()
    defer logger.Sync()

    // auth is from your private internal-sdk module
    token := auth.GenerateToken("user-123")
    logger.Info("token generated", zap.String("token", token[:8]+"..."))
    fmt.Println("service started")
}
```

```
# go.mod
module github.com/acme/payments-service

go 1.22

require (
    github.com/acme/internal-sdk/v2 v2.3.1
    go.uber.org/zap v1.26.0
)
```

---

## 9. Package Organization Patterns

### The Standard Layout

The most widely adopted project layout in the Go community:

```
myservice/
├── go.mod
├── go.sum
├── main.go               # OR cmd/myservice/main.go for multi-binary projects
├── cmd/
│   ├── server/
│   │   └── main.go       # HTTP server binary
│   └── migrate/
│       └── main.go       # Database migration binary
├── internal/
│   ├── config/           # Service configuration (not exported)
│   ├── repository/       # Database access layer (not exported)
│   └── service/          # Business logic (not exported)
├── pkg/
│   ├── middleware/        # Reusable HTTP middleware (exported for external use)
│   └── validator/         # Input validation (exported for external use)
└── api/
    └── proto/             # Protobuf definitions
```

**Go stdlib is mostly flat** — packages like `net/http`, `encoding/json` are not deeply nested. Deeply nested packages (`a/b/c/d/e`) are usually a design smell in Go.

```go
// File: pkg/validator/validator.go
// This is in pkg/ — it's exported for use by other modules
package validator

import (
    "fmt"
    "strings"
)

// ValidationError holds validation failure details.
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed for %s: %s", e.Field, e.Message)
}

// ValidateEmail checks if an email address is valid.
// This is exported and can be used by other modules.
func ValidateEmail(email string) error {
    if !strings.Contains(email, "@") {
        return &ValidationError{Field: "email", Message: "must contain @"}
    }
    parts := strings.Split(email, "@")
    if len(parts[1]) == 0 {
        return &ValidationError{Field: "email", Message: "domain cannot be empty"}
    }
    return nil
}
```

```go
// File: internal/service/user_service.go
// This is in internal/ — ONLY code within this module can import it
package service

import (
    "fmt"

    // This internal package imports a pkg/ package — allowed
    "example.com/myservice/pkg/validator"
)

type UserService struct{}

// CreateUser is exported (capital C) but the whole package is internal.
// External modules cannot import this even though CreateUser is exported.
func (s *UserService) CreateUser(email, name string) (string, error) {
    if err := validator.ValidateEmail(email); err != nil {
        return "", fmt.Errorf("create user: %w", err)
    }
    return fmt.Sprintf("created user %s with email %s", name, email), nil
}
```

### Detecting and Fixing Circular Imports

Go **does not allow circular imports** — this is a compile-time error. Circular imports are always a sign that your package boundaries are wrong.

```
# Example of a circular import (WILL NOT COMPILE):
package A imports package B
package B imports package A  <- CIRCULAR
```

```bash
# Detect circular imports before they cause problems
go build ./...
# Error: import cycle not allowed
# package example.com/myapp/A
#     imports example.com/myapp/B
#     imports example.com/myapp/A

# Better tool for visualization:
go mod graph | head -20
```

**Fix pattern — extract shared types to a third package:**

```go
// BEFORE (circular — bad):
// package user imports package order (to get Order type)
// package order imports package user (to get User type)

// AFTER (fixed — good):
// package types defines shared types (no imports from user or order)
// package user imports types
// package order imports types
```

```go
// File: types/types.go — shared types package, no circular deps
package types

// UserID is the canonical type for user identifiers.
type UserID string

// OrderID is the canonical type for order identifiers.
type OrderID string

// Order is a shared type used by both user and order packages.
type Order struct {
    ID     OrderID
    UserID UserID
    Amount float64
}
```

```go
// File: user/user.go — imports types, does NOT import order
package user

import "example.com/myservice/types"

type User struct {
    ID     types.UserID
    Email  string
    Orders []types.Order // Uses shared type, no circular dep
}

func GetUser(id types.UserID) User {
    return User{ID: id, Email: "user@example.com"}
}
```

```go
// File: order/order.go — imports types, does NOT import user
package order

import "example.com/myservice/types"

func CreateOrder(userID types.UserID, amount float64) types.Order {
    return types.Order{
        ID:     types.OrderID("ord-001"),
        UserID: userID,
        Amount: amount,
    }
}
```

```
# go.mod
module example.com/myservice

go 1.22
```

---

## Quick Reference Card

```
PACKAGES
├── Every .go file: package <name>
├── Exported: CapitalLetter
├── Unexported: lowerLetter
├── init(): runs before main(), used for registration
├── Blank import: import _ "pkg" (triggers init() only)
└── internal/: compiler-enforced access control

MODULES
├── go mod init <module-path>
├── go.mod: module path + dependencies
├── go.sum: cryptographic checksums (never hand-edit)
├── go mod tidy: clean up go.mod and go.sum
├── go mod vendor: copy deps to ./vendor/
└── go mod graph: visualize dependency tree

VERSIONING
├── v1.x.x: import "github.com/foo/bar"
├── v2.x.x: import "github.com/foo/bar/v2"
└── MVS: always selects minimum satisfying version

WORKSPACE (go 1.18+)
├── go work init ./mod1 ./mod2
├── go.work: lists local module directories
└── GOWORK=off: disable workspace (use in CI)

PRIVATE MODULES
├── GOPRIVATE=github.com/myorg/*
├── GOPROXY=https://internal-proxy,direct
└── GONOSUMCHECK=github.com/myorg/*

LAYOUT CONVENTION
├── cmd/: binary entry points
├── internal/: private implementation
├── pkg/: exported reusable packages
└── api/: interface definitions (proto, openapi)
```

---

## Common Pitfalls Summary

| Pitfall | Problem | Fix |
|---------|---------|-----|
| `go get -u ./...` in CI | Upgrades all deps, breaks reproducibility | Pin versions; only upgrade intentionally |
| Missing `go mod tidy` | Stale or missing entries in `go.mod` | Run before every commit |
| Circular imports | Compile error, forces full restructure | Extract shared types to a third package |
| Using `replace` for local dev | Must remove before publishing | Use `go.work` instead |
| Deep package nesting | Hard to navigate, often circular | Keep packages shallow and focused |
| Everything in `package main` | Untestable, unmaintainable | Separate into domain packages |
| Not using `internal/` | API leaks, tight coupling between services | Use `internal/` for all non-public code |
| Ignoring `go.sum` in git | Breaks reproducible builds | Always commit `go.sum` |
