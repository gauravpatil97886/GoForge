# Tools & Commands Reference

Essential Go commands and tools for development.

## Build & Run

```bash
go run main.go                    # Compile and run immediately
go build -o myapp                 # Build executable to 'myapp'
go build ./...                    # Build all packages in dir
go install ./cmd/myapp            # Build and install to GOPATH/bin
```

## Testing & Quality

```bash
go test ./...                     # Run all tests
go test -v ./...                  # Verbose output
go test -run TestName             # Run specific test
go test -race ./...               # Run with race detector
go test -bench . -benchmem        # Benchmark with memory stats
go test -cover ./...              # Show coverage
go test -coverprofile=cover.out ./...
go tool cover -html=cover.out     # View coverage in browser

go fmt ./...                       # Format code
go vet ./...                       # Lint code
golangci-lint run ./...           # Comprehensive linting
```

## Profiling

```bash
go test -cpuprofile=cpu.prof -bench . ./...
go tool pprof cpu.prof

go tool pprof http://localhost:6060/debug/pprof/heap  # Live profiling
```

## Dependencies

```bash
go mod init github.com/username/project    # Initialize module
go mod tidy                                 # Clean up dependencies
go mod download                             # Download deps
go mod vendor                               # Create vendor/ dir
go get -u ./...                             # Update packages
go get github.com/package@latest            # Get specific package
go list -m all                              # List all modules
```

## Useful Tools to Install

```bash
# Race detector
go install github.com/golang/tools/cmd/goimports@latest

# Linter
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Profiler UI
go install github.com/google/pprof@latest

# Code coverage
go install github.com/axw/gocov/gocov@latest

# Benchmark comparison
go install github.com/benchstat@latest
```

## Debugging

```bash
dlv debug ./cmd/main               # Debug with Delve
dlv test ./...

# OR use VS Code debugger with proper launch.json configuration
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "no Go files to compile" | Make sure you're in the right directory with `.go` files |
| Module not found | Run `go mod tidy` to fetch missing dependencies |
| Race detector finds data race | Use `-race` flag to reproduce, add synchronization |
| Coverage too low | Add tests for uncovered code paths |

## Environment Variables

```bash
GOPATH              # Workspace root (default ~/go)
GOROOT              # Go installation directory
GOPROXY             # Module proxy (default sum.golang.org)
GOSUMDB             # Checksum database
CGO_ENABLED         # Enable C bindings (0 or 1)
GOOS                # Target OS (linux, darwin, windows)
GOARCH              # Target architecture (amd64, arm64)
```

Build for specific OS/arch:
```bash
GOOS=linux GOARCH=amd64 go build -o myapp.linux
```

## Performance Tips

1. **Use `go test -benchstat`** to compare benchmark results
2. **Profile with pprof** to find bottlenecks
3. **Use atomic operations** instead of mutexes for simple counters
4. **Preallocate slices** with known capacity
5. **Reuse buffers** with `sync.Pool`
6. **Avoid unnecessary allocations** in hot paths

## VS Code Setup

Install Go extension, get language server, debugger:
```bash
go install github.com/golang/tools/gopls@latest
go install github.com/go-delve/delve/cmd/dlv@latest
```

Recommended extensions:
- Go (golang.go) - official extension
- code-runner - run code snippets
- Thunder Client / REST Client - test APIs
