# Getting Started with Go

## Installation & Setup

### Install Go
- Download from https://golang.org/dl/
- Verify: `go version`
- Set GOPATH: `echo $GOPATH` (typically `~/go`)

### Your First Program

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello, Go!")
}
```

Save as `hello.go` and run:
```bash
go run hello.go
```

## Go Workspace Structure

```
$GOPATH/
  bin/       # compiled executables
  pkg/       # compiled packages
  src/       # source code
    github.com/username/project/
```

## Key Commands

| Command | Purpose |
|---------|---------|
| `go run` | Compile and run immediately |
| `go build` | Compile to executable |
| `go test` | Run tests |
| `go fmt` | Format code |
| `go vet` | Lint code |
| `go doc` | View documentation |

## Go Modules (go.mod)

Modern Go uses modules for dependency management:

```bash
go mod init github.com/username/myproject
go mod tidy      # download dependencies
go mod download  # cache dependencies
```

## Next Steps
→ Learn [Basic Syntax & Data Types](./02-syntax-types.md)
