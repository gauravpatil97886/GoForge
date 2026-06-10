# Go Microservices and Patterns

## What Is This?

Microservices is an architectural style where a large application is broken into small, independently deployable services that each own a specific business capability and communicate over a network. Each service runs in its own process, has its own data store, and is deployed independently. Go has become the dominant language for building microservices because its compiled binaries, low memory footprint, fast startup time, and built-in concurrency primitives make it uniquely suited for cloud-native infrastructure.

## Why Does It Exist?

Monolithic applications become a bottleneck as they grow — a single deploy pipeline, a single point of failure, teams blocking each other, and the inability to scale individual components independently. Microservices emerged to solve these problems: you can deploy the payment service without touching the user service, scale the recommendation engine without scaling the entire app, and let teams own their services end-to-end. The tradeoff is distributed systems complexity: network failures, service discovery, distributed tracing, and eventual consistency. Go was designed for exactly this tradeoff — its lightweight goroutines, fast HTTP servers, and static binaries make the operational cost of running many small services manageable.

## Who Uses This in Industry?

- **Google**: Go was created at Google. Google runs microservices across Search, YouTube, and internal tools. gRPC itself was born at Google (Stubby protocol) and open-sourced as gRPC. Google uses Go for infrastructure tooling at scale.
- **Uber**: Uber runs 4,000+ Go microservices handling ride dispatch, pricing, driver location, payments, and notifications. They built Yarpc (their own RPC framework) and Zap (structured logger) in Go because standard library wasn't fast enough at their scale.
- **Docker**: Docker Engine, Docker CLI, Docker Compose — all written in Go. The entire container ecosystem is Go.
- **Kubernetes**: Every component — kube-apiserver, kubelet, kube-scheduler, kube-proxy, etcd client — is written in Go. The CNCF ecosystem (Prometheus, Consul, Envoy's control plane, Jaeger, Linkerd2) is predominantly Go.
- **Cloudflare**: Cloudflare's edge network services, including their DNS resolver (1.1.1.1), are written in Go. They handle millions of requests per second with small Go binaries.
- **Netflix**: Netflix uses Go for their chaos engineering tools, internal CLIs, and high-throughput data pipeline components. Their API gateway handles millions of daily requests with Go services.
- **Dropbox**: Migrated performance-critical backend services from Python to Go, reporting 5x throughput improvements.

## Industry Standards and Best Practices

**Production-grade microservices always include:**
- Structured logging (JSON format, correlation IDs, trace IDs in every log line)
- Metrics exposition (Prometheus /metrics endpoint, RED metrics: Rate, Errors, Duration)
- Distributed tracing (OpenTelemetry, spans on every service call)
- Health check endpoints (/health/live and /health/ready for Kubernetes probes)
- Graceful shutdown (drain in-flight requests before exiting)
- Circuit breakers on outbound calls (prevent cascade failures)
- Retry with exponential backoff and jitter
- Configuration from environment (12-factor app)
- Context propagation (deadlines, cancellation, trace context passed through every call)

**What senior engineers do vs. beginners:**
- Beginners: log.Println, no metrics, no tracing, panic on shutdown signal
- Senior: slog/zap with JSON output, Prometheus histograms, OpenTelemetry spans, os.Signal + context.WithCancel for graceful shutdown
- Beginners: hardcoded config values, one big main.go
- Senior: Viper + environment variables, cmd/service/main.go + internal/service + internal/handler layout
- Beginners: HTTP client with no timeout, no retry
- Senior: HTTP client with timeout, context propagation, circuit breaker, retry with jitter

## Why Go's Approach Is Unique

Java requires a JVM (200MB+ overhead per service), Spring Boot takes 10-30 seconds to start, and each service needs significant memory. Python's GIL limits true parallelism. Node.js is single-threaded and struggles with CPU-bound tasks.

Go compiles to a single static binary (typically 5-20MB), starts in milliseconds, uses ~10MB RAM at idle, and goroutines (2KB stack) allow tens of thousands of concurrent connections on a single machine. There is no runtime dependency — you copy the binary to a container and run it. This makes Go perfect for microservices: fast builds, fast deploys, tiny containers, low operational cost per service.

Go's standard library includes a production-grade HTTP server, TLS support, JSON encoding, and a context package — most microservice primitives are built-in, not third-party.

---

## Part 1: Service Structure — The Standard Layout

### Why This Layout Exists

When a monolith is split into microservices, each service needs a clean internal structure. The Go community converged on a standard layout that separates concerns: what the binary is (`cmd/`), what is internal business logic (`internal/`), and what can be shared across services (`pkg/`). This layout is used in Kubernetes, Docker, Prometheus, and most major Go open-source projects.

```
myservice/
├── cmd/
│   └── server/
│       └── main.go          # Binary entrypoint, wires everything together
├── internal/
│   ├── handler/
│   │   └── handler.go       # HTTP or gRPC handlers
│   ├── service/
│   │   └── service.go       # Business logic
│   ├── repository/
│   │   └── repository.go    # Data access layer
│   └── config/
│       └── config.go        # Configuration structs
├── pkg/
│   └── middleware/
│       └── middleware.go    # Shared middleware (can be imported by other services)
├── proto/
│   └── user.proto           # Protocol Buffers definitions
├── Dockerfile
├── go.mod
└── go.sum
```

**Why `internal/`?** The Go compiler enforces that packages under `internal/` cannot be imported by code outside the parent directory. This gives you hard encapsulation — your service's business logic cannot accidentally be imported by another service, preventing hidden coupling.

```go
// internal/config/config.go
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all service configuration.
// All fields are read from environment variables (12-factor app principle).
type Config struct {
	HTTPPort    int
	GRPCPort    int
	DatabaseURL string
	LogLevel    string
	ServiceName string
	Environment string
}

// Load reads configuration from environment variables with defaults.
// This is the 12-factor app approach: config lives in the environment, not code.
func Load() (*Config, error) {
	cfg := &Config{
		HTTPPort:    getEnvInt("HTTP_PORT", 8080),
		GRPCPort:    getEnvInt("GRPC_PORT", 9090),
		DatabaseURL: getEnv("DATABASE_URL", ""),
		LogLevel:    getEnv("LOG_LEVEL", "info"),
		ServiceName: getEnv("SERVICE_NAME", "myservice"),
		Environment: getEnv("ENVIRONMENT", "development"),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	return cfg, nil
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}
```

```go
// internal/service/user_service.go
package service

import (
	"context"
	"fmt"
)

// User represents the domain model.
type User struct {
	ID    string
	Name  string
	Email string
}

// UserRepository defines the data access contract.
// Service depends on the interface, not the concrete implementation.
// This is the Dependency Inversion Principle — enables testing with mocks.
type UserRepository interface {
	FindByID(ctx context.Context, id string) (*User, error)
	Save(ctx context.Context, user *User) error
}

// UserService contains the business logic.
// It knows nothing about HTTP, gRPC, or databases — only domain rules.
type UserService struct {
	repo UserRepository
}

// NewUserService creates a UserService with its dependencies injected.
// Dependency injection via constructor — no global state.
func NewUserService(repo UserRepository) *UserService {
	return &UserService{repo: repo}
}

func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
	if id == "" {
		return nil, fmt.Errorf("user id cannot be empty")
	}
	user, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("finding user %s: %w", id, err)
	}
	return user, nil
}

func (s *UserService) CreateUser(ctx context.Context, name, email string) (*User, error) {
	if name == "" || email == "" {
		return nil, fmt.Errorf("name and email are required")
	}
	user := &User{
		ID:    generateID(), // simplified
		Name:  name,
		Email: email,
	}
	if err := s.repo.Save(ctx, user); err != nil {
		return nil, fmt.Errorf("saving user: %w", err)
	}
	return user, nil
}

func generateID() string {
	return "usr_" + "randomid" // In production: use uuid or ulid
}
```

```go
// cmd/server/main.go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Load config first — fail fast if misconfigured
	// cfg, err := config.Load()
	// if err != nil {
	//     log.Fatalf("loading config: %v", err)
	// }

	// Wire dependencies: repo -> service -> handler
	// repo := repository.NewPostgresUserRepository(cfg.DatabaseURL)
	// svc := service.NewUserService(repo)
	// h := handler.NewUserHandler(svc)

	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		// Check database connectivity, cache availability, etc.
		w.WriteHeader(http.StatusOK)
	})

	srv := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in a goroutine so we can listen for shutdown signals
	go func() {
		log.Printf("Server listening on :8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Block until we receive an OS signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// Give in-flight requests 30 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Println("Server exited cleanly")
	fmt.Fprintln(os.Stdout, "done")
}
```

**Common Pitfall:** Putting business logic in main.go, or mixing HTTP handler code with database queries. Always layer: handler → service → repository.

---

## Part 2: Health Checks — Kubernetes Probes

### Why Health Checks Matter

Kubernetes uses two types of probes to manage your service:
- **Liveness probe** (`/health/live`): Is the process running? If this fails, Kubernetes restarts the container.
- **Readiness probe** (`/health/ready`): Is the service ready to accept traffic? If this fails, Kubernetes removes the pod from the load balancer but does NOT restart it.

The distinction is critical. A service might be alive (process running) but not ready (still loading caches, database not connected yet). Without this distinction, Kubernetes would send traffic to a service that isn't ready, causing 500 errors.

```go
// internal/health/health.go
package health

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

// Checker represents a dependency that can be checked.
type Checker interface {
	Check(ctx context.Context) error
	Name() string
}

// DatabaseChecker checks database connectivity.
type DatabaseChecker struct {
	db *sql.DB
}

func NewDatabaseChecker(db *sql.DB) *DatabaseChecker {
	return &DatabaseChecker{db: db}
}

func (d *DatabaseChecker) Name() string { return "database" }

func (d *DatabaseChecker) Check(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return d.db.PingContext(ctx)
}

// Handler manages health check endpoints.
type Handler struct {
	checkers []Checker
}

func NewHandler(checkers ...Checker) *Handler {
	return &Handler{checkers: checkers}
}

type healthResponse struct {
	Status  string            `json:"status"`
	Checks  map[string]string `json:"checks,omitempty"`
	Version string            `json:"version,omitempty"`
}

// LiveHandler responds to Kubernetes liveness probes.
// Should only fail if the process itself is broken (deadlock, OOM, etc.).
// Keep it simple — just return 200.
func (h *Handler) LiveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(healthResponse{Status: "alive"})
}

// ReadyHandler responds to Kubernetes readiness probes.
// Should check all dependencies: database, cache, required services.
// If any check fails, returns 503 — Kubernetes stops sending traffic here.
func (h *Handler) ReadyHandler(w http.ResponseWriter, r *http.Request) {
	checks := make(map[string]string)
	allOK := true

	for _, checker := range h.checkers {
		if err := checker.Check(r.Context()); err != nil {
			checks[checker.Name()] = err.Error()
			allOK = false
		} else {
			checks[checker.Name()] = "ok"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if !allOK {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(healthResponse{Status: "not ready", Checks: checks})
		return
	}
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(healthResponse{Status: "ready", Checks: checks})
}
```

**Common Pitfall:** Making the liveness probe check external dependencies like a database. If the database goes down, Kubernetes will restart all your pods in a death loop. Liveness should only fail for process-level issues. Readiness checks external deps.

---

## Part 3: Structured Logging with slog (Go 1.21+)

### Why Structured Logging

`log.Println("user not found")` produces unstructured text that is impossible to query at scale. When you have 4,000 microservices each emitting thousands of log lines per second, you need logs in JSON format with consistent fields so your log aggregator (Datadog, Splunk, Elasticsearch) can index and search them. Structured logging adds context: trace IDs, user IDs, request IDs, latency — all as queryable key-value fields.

```go
// internal/logging/logger.go
package logging

import (
	"context"
	"log/slog"
	"os"
)

// contextKey is unexported to prevent collisions
type contextKey string

const loggerKey contextKey = "logger"

// NewLogger creates a production JSON logger.
// In development you might use slog.NewTextHandler for human-readable output.
func NewLogger(serviceName, environment, level string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: lvl,
		// AddSource adds file:line to every log entry — useful in production
		AddSource: environment == "production",
	}

	handler := slog.NewJSONHandler(os.Stdout, opts)

	// Add service-level fields that appear in every log line
	return slog.New(handler).With(
		slog.String("service", serviceName),
		slog.String("environment", environment),
	)
}

// WithContext stores a logger in a context.
// Pass this context through your entire request lifecycle to get
// trace IDs and request IDs in every log line automatically.
func WithContext(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey, logger)
}

// FromContext retrieves the logger from context.
// Falls back to the default logger if none is set.
func FromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
		return logger
	}
	return slog.Default()
}

// WithRequestID returns a logger enriched with a request ID.
// Call this in your HTTP middleware and store via WithContext.
func WithRequestID(logger *slog.Logger, requestID string) *slog.Logger {
	return logger.With(slog.String("request_id", requestID))
}

// WithTraceID returns a logger enriched with OpenTelemetry trace and span IDs.
func WithTraceID(logger *slog.Logger, traceID, spanID string) *slog.Logger {
	return logger.With(
		slog.String("trace_id", traceID),
		slog.String("span_id", spanID),
	)
}
```

```go
// Example usage in an HTTP handler
package handler

import (
	"log/slog"
	"net/http"
	"time"
)

func RequestLoggingMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap ResponseWriter to capture status code
			lrw := &loggingResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			// Add request-scoped fields to logger, store in context
			reqLogger := logger.With(
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("remote_addr", r.RemoteAddr),
				slog.String("request_id", r.Header.Get("X-Request-ID")),
			)

			ctx := r.Context()
			// In production: extract trace ID from context here
			r = r.WithContext(ctx)

			next.ServeHTTP(lrw, r)

			// Log after the request completes — includes status code and latency
			reqLogger.Info("request completed",
				slog.Int("status", lrw.statusCode),
				slog.Duration("latency", time.Since(start)),
			)
		})
	}
}

type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}
```

**Common Pitfall:** Calling `slog.Info(...)` on a global logger instead of the context-enriched logger. You lose all the per-request context (trace ID, user ID, request ID) that makes log correlation possible.

---

## Part 4: Metrics with Prometheus

### Why Prometheus Metrics

Prometheus is the CNCF standard for metrics. It scrapes your `/metrics` endpoint on a schedule and stores time series data. With Grafana dashboards, you get real-time visibility into your service: how many requests per second, what percentage are errors, how long requests take. The RED method (Rate, Errors, Duration) is the industry standard for HTTP service metrics.

```go
// internal/metrics/metrics.go
package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ServiceMetrics holds all Prometheus metrics for a service.
// Defined as a struct so they can be injected as a dependency.
type ServiceMetrics struct {
	// Counters only go up — great for requests, errors
	RequestsTotal *prometheus.CounterVec

	// Histograms track distributions — great for latency, payload size
	RequestDuration *prometheus.HistogramVec

	// Gauges go up and down — great for active connections, queue depth
	ActiveRequests prometheus.Gauge

	// Summary for percentile calculations (less flexible than histograms)
	RequestSizeBytes *prometheus.SummaryVec
}

// NewServiceMetrics creates and registers all metrics.
// The service name is used as a prefix (e.g., "userservice_requests_total").
func NewServiceMetrics(serviceName string) *ServiceMetrics {
	m := &ServiceMetrics{
		RequestsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: serviceName,
				Name:      "requests_total",
				Help:      "Total number of HTTP requests processed",
			},
			// Labels allow slicing metrics: "show me error rates for /users endpoints"
			[]string{"method", "path", "status"},
		),
		RequestDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: serviceName,
				Name:      "request_duration_seconds",
				Help:      "HTTP request duration in seconds",
				// Buckets define histogram bucket boundaries.
				// These cover 1ms to 10s — typical for web services.
				Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
			},
			[]string{"method", "path"},
		),
		ActiveRequests: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Namespace: serviceName,
				Name:      "active_requests",
				Help:      "Number of HTTP requests currently being processed",
			},
		),
	}

	// Register with the default registry
	prometheus.MustRegister(
		m.RequestsTotal,
		m.RequestDuration,
		m.ActiveRequests,
	)

	return m
}

// Middleware wraps an HTTP handler and records metrics for every request.
func (m *ServiceMetrics) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.ActiveRequests.Inc()
		defer m.ActiveRequests.Dec()

		start := time.Now()
		lrw := &statusRecorder{ResponseWriter: w, statusCode: 200}

		next.ServeHTTP(lrw, r)

		duration := time.Since(start).Seconds()
		statusStr := strconv.Itoa(lrw.statusCode)

		// Record the metrics
		m.RequestsTotal.WithLabelValues(r.Method, r.URL.Path, statusStr).Inc()
		m.RequestDuration.WithLabelValues(r.Method, r.URL.Path).Observe(duration)
	})
}

// Handler returns the Prometheus HTTP handler for /metrics
func Handler() http.Handler {
	return promhttp.Handler()
}

type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.statusCode = status
	r.ResponseWriter.WriteHeader(status)
}
```

```go
// Usage in main.go
// mux.Handle("/metrics", metrics.Handler())
// 
// Kubernetes ServiceMonitor scrapes /metrics every 15 seconds.
// Grafana queries: 
//   rate(userservice_requests_total{status=~"5.."}[5m]) / rate(userservice_requests_total[5m])
//   This gives you error rate — alert if > 0.01 (1%)
//
//   histogram_quantile(0.99, rate(userservice_request_duration_seconds_bucket[5m]))
//   This gives you P99 latency — alert if > 500ms
```

**Common Pitfall:** Using high-cardinality labels (like user IDs or request IDs) on Prometheus metrics. Each unique label combination creates a new time series. Adding `user_id` as a label with 10 million users creates 10 million time series and OOMs your Prometheus.

---

## Part 5: Distributed Tracing with OpenTelemetry

### Why Distributed Tracing

When a single user request goes through an API gateway → user service → order service → payment service → database, a single log line in the user service tells you nothing about what happened in the other services. Distributed tracing creates a `trace_id` that follows the request across all services, creating a waterfall diagram showing exactly where time was spent and where errors occurred. OpenTelemetry (OTel) is the CNCF standard — write once, export to Jaeger, Zipkin, Datadog, or any backend.

```go
// internal/tracing/tracing.go
package tracing

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
)

// InitTracer sets up OpenTelemetry with an OTLP HTTP exporter.
// In production, the endpoint points to a collector (Jaeger, Zipkin, Datadog agent).
// Returns a shutdown function — call it in your graceful shutdown sequence.
func InitTracer(ctx context.Context, serviceName, collectorURL string) (func(context.Context) error, error) {
	// Export spans to an OpenTelemetry collector
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(collectorURL),
		otlptracehttp.WithInsecure(), // Use TLS in production
	)
	if err != nil {
		return nil, fmt.Errorf("creating OTLP exporter: %w", err)
	}

	// Resource identifies your service in traces
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			attribute.String("environment", "production"),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("creating resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		// BatchSpanProcessor buffers and sends spans asynchronously — better performance
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		// Sample 100% in dev, 10% in production (adjust based on traffic volume)
		sdktrace.WithSampler(sdktrace.TraceIDRatioBased(1.0)),
	)

	// Set global tracer provider and propagator
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, // W3C Trace Context standard
		propagation.Baggage{},
	))

	return tp.Shutdown, nil
}

// StartSpan starts a child span from the context.
// The span name should be: "service.operation" e.g. "userservice.GetUser"
func StartSpan(ctx context.Context, tracerName, spanName string) (context.Context, trace.Span) {
	tracer := otel.Tracer(tracerName)
	return tracer.Start(ctx, spanName)
}
```

```go
// Example: adding tracing to a service method
package service

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

type TracedUserService struct {
	inner *UserService
}

func (s *TracedUserService) GetUser(ctx context.Context, id string) (*User, error) {
	// Start a span — it inherits the trace context from ctx
	ctx, span := otel.Tracer("userservice").Start(ctx, "UserService.GetUser")
	defer span.End() // Always end the span, even on error

	// Add attributes — these appear as metadata on the span in Jaeger UI
	span.SetAttributes(attribute.String("user.id", id))

	user, err := s.inner.GetUser(ctx, id)
	if err != nil {
		// Record the error on the span — turns it red in trace visualization
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	span.SetAttributes(attribute.String("user.email", user.Email))
	span.SetStatus(codes.Ok, "")
	return user, nil
}

// Placeholder types for compilation
type User struct {
	ID    string
	Name  string
	Email string
}

type UserService struct{}

func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
	if id == "" {
		return nil, fmt.Errorf("id required")
	}
	return &User{ID: id, Name: "Test", Email: "test@example.com"}, nil
}
```

---

## Part 6: gRPC — Service-to-Service Communication

### Why gRPC Over REST for Internal Services

REST over HTTP/1.1 uses text (JSON), requires serialization/deserialization on every call, and doesn't have a schema. gRPC uses Protocol Buffers (binary, 3-10x smaller than JSON), HTTP/2 (multiplexed streams, header compression), and has a strongly-typed schema in `.proto` files. For internal service-to-service calls where you control both ends, gRPC gives significantly better throughput and latency. Kubernetes, Docker, etcd, and most CNCF projects use gRPC for internal communication.

```protobuf
// proto/user/v1/user.proto
syntax = "proto3";

package user.v1;

option go_package = "github.com/myorg/myservice/gen/user/v1;userv1";

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  rpc CreateUser(CreateUserRequest) returns (CreateUserResponse);
  // Server-streaming RPC — server sends multiple responses
  rpc ListUsers(ListUsersRequest) returns (stream ListUsersResponse);
}

message GetUserRequest {
  string id = 1;
}

message GetUserResponse {
  User user = 1;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
}

message CreateUserResponse {
  User user = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
}

message ListUsersResponse {
  User user = 1;
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  int64 created_at = 4; // Unix timestamp
}
```

```go
// internal/grpcserver/server.go
// After running: protoc --go_out=. --go-grpc_out=. proto/user/v1/user.proto
package grpcserver

import (
	"context"
	"fmt"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

// Stub types representing generated protobuf code
// In real code these come from the generated pb.go files

type User struct {
	Id        string
	Name      string
	Email     string
	CreatedAt int64
}

type GetUserRequest struct{ Id string }
type GetUserResponse struct{ User *User }
type CreateUserRequest struct{ Name, Email string }
type CreateUserResponse struct{ User *User }

// UserServiceServer is the gRPC server implementation.
// It implements the generated UserServiceServer interface.
type UserServiceServer struct {
	// Embed the unimplemented server for forward compatibility
	// This means your code won't break when new RPCs are added to the proto
	// UnimplementedUserServiceServer

	svc *domainUserService
}

type domainUserService struct{}

func (d *domainUserService) GetUser(ctx context.Context, id string) (*User, error) {
	if id == "" {
		return nil, fmt.Errorf("id required")
	}
	return &User{Id: id, Name: "Test User", Email: "test@example.com"}, nil
}

func NewUserServiceServer(svc *domainUserService) *UserServiceServer {
	return &UserServiceServer{svc: svc}
}

// GetUser implements the GetUser RPC.
// gRPC errors are returned using the google.golang.org/grpc/status package.
// Error codes map to HTTP status codes in gRPC-gateway.
func (s *UserServiceServer) GetUser(ctx context.Context, req *GetUserRequest) (*GetUserResponse, error) {
	if req.Id == "" {
		// codes.InvalidArgument maps to HTTP 400
		return nil, status.Error(codes.InvalidArgument, "id is required")
	}

	user, err := s.svc.GetUser(ctx, req.Id)
	if err != nil {
		// codes.Internal maps to HTTP 500
		return nil, status.Errorf(codes.Internal, "getting user: %v", err)
	}
	if user == nil {
		// codes.NotFound maps to HTTP 404
		return nil, status.Errorf(codes.NotFound, "user %s not found", req.Id)
	}

	return &GetUserResponse{User: user}, nil
}

// StartGRPCServer starts the gRPC server with standard middleware.
func StartGRPCServer(addr string) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listening on %s: %w", addr, err)
	}

	// Interceptors are gRPC's version of HTTP middleware
	srv := grpc.NewServer(
		// UnaryInterceptor runs for every RPC call
		grpc.ChainUnaryInterceptor(
			loggingInterceptor,
			recoveryInterceptor,
		),
	)

	// Register your service
	// userv1.RegisterUserServiceServer(srv, NewUserServiceServer(...))

	// Reflection lets tools like grpcurl discover your service schema
	// Enable in development/staging, disable in production for security
	reflection.Register(srv)

	fmt.Printf("gRPC server listening on %s\n", addr)
	return srv.Serve(lis)
}

func loggingInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	// log.Printf("gRPC call: %s", info.FullMethod)
	resp, err := handler(ctx, req)
	// log.Printf("gRPC call %s completed, err: %v", info.FullMethod, err)
	return resp, err
}

func recoveryInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (resp interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = status.Errorf(codes.Internal, "panic: %v", r)
		}
	}()
	return handler(ctx, req)
}
```

```go
// internal/grpcclient/client.go — gRPC client with connection pooling
package grpcclient

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
)

// NewUserServiceClient creates a gRPC client connection.
// In Kubernetes, target is just the service DNS name: "user-service:9090"
// gRPC handles client-side load balancing across multiple pods.
func NewConnection(target string) (*grpc.ClientConn, error) {
	conn, err := grpc.NewClient(
		target,
		grpc.WithTransportCredentials(insecure.NewCredentials()), // Use TLS in production
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			// Send keepalive ping if no activity for 30s
			Time:                30 * time.Second,
			Timeout:             10 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("connecting to %s: %w", target, err)
	}
	return conn, nil
}

// CallWithTimeout is a helper that calls a gRPC method with a timeout.
// Always set timeouts — without them, a slow upstream can block your goroutine forever.
func CallWithTimeout[T any](
	ctx context.Context,
	timeout time.Duration,
	fn func(context.Context) (T, error),
) (T, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return fn(ctx)
}

// Example client usage:
// conn, _ := NewConnection("user-service:9090")
// client := userv1.NewUserServiceClient(conn)
// resp, err := CallWithTimeout(ctx, 5*time.Second, func(ctx context.Context) (*userv1.GetUserResponse, error) {
//     return client.GetUser(ctx, &userv1.GetUserRequest{Id: "usr_123"})
// })
func Example() {
	fmt.Println("gRPC client example")
}
```

---

## Part 7: Circuit Breaker and Retry Patterns

### Why Circuit Breakers

In a microservices system, if Service A calls Service B and B is down or slow, A's goroutines pile up waiting for B to respond, exhausting A's connection pool. A then becomes slow, causing Service C (which calls A) to also back up. This is a cascade failure — one slow service takes down the entire system. A circuit breaker detects repeated failures and "opens" — subsequent calls fail immediately (fast fail) instead of waiting, giving the downstream service time to recover. After a timeout, it tries again (half-open state).

```go
// internal/resilience/circuit_breaker.go
package resilience

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// State represents the circuit breaker state machine.
type State int

const (
	StateClosed   State = iota // Normal operation: requests pass through
	StateOpen                  // Failure threshold hit: requests fail fast
	StateHalfOpen              // Recovery probe: one request allowed through
)

func (s State) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

var ErrCircuitOpen = errors.New("circuit breaker is open")

// CircuitBreaker implements the circuit breaker pattern.
// Use one per downstream dependency, not per request.
type CircuitBreaker struct {
	mu sync.Mutex

	name string

	// Thresholds
	failureThreshold int           // Open circuit after this many consecutive failures
	successThreshold int           // Close circuit after this many consecutive successes (half-open)
	timeout          time.Duration // How long to stay open before trying again

	// State
	state            State
	consecutiveFails int
	consecutiveOK    int
	openedAt         time.Time
}

// NewCircuitBreaker creates a circuit breaker with sensible defaults.
func NewCircuitBreaker(name string) *CircuitBreaker {
	return &CircuitBreaker{
		name:             name,
		failureThreshold: 5,
		successThreshold: 2,
		timeout:          30 * time.Second,
		state:            StateClosed,
	}
}

// Execute runs fn through the circuit breaker.
// Returns ErrCircuitOpen immediately if the circuit is open.
func (cb *CircuitBreaker) Execute(ctx context.Context, fn func(context.Context) error) error {
	cb.mu.Lock()
	state := cb.currentState()
	if state == StateOpen {
		cb.mu.Unlock()
		return fmt.Errorf("%w: %s", ErrCircuitOpen, cb.name)
	}
	cb.mu.Unlock()

	err := fn(ctx)

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		cb.consecutiveFails++
		cb.consecutiveOK = 0
		if cb.state == StateHalfOpen || cb.consecutiveFails >= cb.failureThreshold {
			cb.state = StateOpen
			cb.openedAt = time.Now()
		}
		return err
	}

	// Success
	cb.consecutiveOK++
	cb.consecutiveFails = 0
	if cb.state == StateHalfOpen && cb.consecutiveOK >= cb.successThreshold {
		cb.state = StateClosed
	}
	return nil
}

// currentState checks if we should transition from open to half-open.
// Must be called with cb.mu held.
func (cb *CircuitBreaker) currentState() State {
	if cb.state == StateOpen && time.Since(cb.openedAt) > cb.timeout {
		cb.state = StateHalfOpen
		cb.consecutiveOK = 0
	}
	return cb.state
}

// RetryWithBackoff retries fn with exponential backoff and jitter.
// Jitter is critical — without it, all retrying clients hit the server at the same time
// (thundering herd), making the problem worse. With jitter, they spread out.
func RetryWithBackoff(ctx context.Context, maxAttempts int, fn func() error) error {
	var err error
	baseDelay := 100 * time.Millisecond

	for attempt := 0; attempt < maxAttempts; attempt++ {
		err = fn()
		if err == nil {
			return nil
		}

		// Don't retry if context is cancelled
		if ctx.Err() != nil {
			return ctx.Err()
		}

		if attempt < maxAttempts-1 {
			// Exponential backoff: 100ms, 200ms, 400ms, 800ms...
			delay := baseDelay * (1 << uint(attempt))
			// Cap at 30 seconds
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
			// Add jitter: randomize +/- 20% of delay to avoid thundering herd
			// jitter := time.Duration(rand.Int63n(int64(delay / 5)))
			// delay += jitter

			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return fmt.Errorf("after %d attempts: %w", maxAttempts, err)
}
```

```go
// Example: using circuit breaker + retry together
package example

import (
	"context"
	"fmt"
	"time"
)

type OrderServiceClient struct {
	cb *CircuitBreaker
}

type CircuitBreaker struct{}

var ErrCircuitOpen = fmt.Errorf("circuit open")

func (cb *CircuitBreaker) Execute(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx) // Simplified for illustration
}

func NewOrderServiceClient() *OrderServiceClient {
	return &OrderServiceClient{
		cb: &CircuitBreaker{}, // NewCircuitBreaker("order-service")
	}
}

func (c *OrderServiceClient) PlaceOrder(ctx context.Context, userID string) error {
	// Retry up to 3 times, with the circuit breaker wrapping each attempt
	return RetryWithBackoff(ctx, 3, func() error {
		return c.cb.Execute(ctx, func(ctx context.Context) error {
			// Actual HTTP/gRPC call here
			return callOrderService(ctx, userID)
		})
	})
}

func RetryWithBackoff(ctx context.Context, maxAttempts int, fn func() error) error {
	var err error
	for i := 0; i < maxAttempts; i++ {
		err = fn()
		if err == nil {
			return nil
		}
		if i < maxAttempts-1 {
			select {
			case <-time.After(100 * time.Millisecond * (1 << uint(i))):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return err
}

func callOrderService(ctx context.Context, userID string) error {
	fmt.Printf("calling order service for user %s\n", userID)
	return nil
}
```

**Common Pitfall:** Not using a circuit breaker at all, or using `time.Sleep` for retries without jitter. At Uber scale, naive retry without jitter caused retry storms that amplified outages.

---

## Part 8: Graceful Shutdown

### Why Graceful Shutdown Matters

When Kubernetes rolls out a new version of your service, it sends `SIGTERM` to the old pod. If your service just exits immediately, in-flight requests get aborted — users see 500 errors or broken responses. Graceful shutdown means: stop accepting new requests, let existing requests finish (up to a timeout), close database connections and flush telemetry, then exit.

```go
// cmd/server/main.go — complete graceful shutdown example
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type Server struct {
	http     *http.Server
	logger   *slog.Logger
	shutdown []func(context.Context) error // shutdown hooks
	mu       sync.Mutex
}

func NewServer(addr string, handler http.Handler, logger *slog.Logger) *Server {
	return &Server{
		http: &http.Server{
			Addr:    addr,
			Handler: handler,
			// Always set these — without them, a slow client can hold a connection forever
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      30 * time.Second,
			IdleTimeout:       120 * time.Second,
		},
		logger: logger,
	}
}

// OnShutdown registers a hook called during graceful shutdown.
// Use for: closing DB connections, flushing traces, draining queues.
func (s *Server) OnShutdown(fn func(context.Context) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shutdown = append(s.shutdown, fn)
}

// Run starts the server and blocks until a shutdown signal is received.
func (s *Server) Run() error {
	// Channel is buffered — signal package requires buffer of at least 1
	quit := make(chan os.Signal, 1)
	// SIGINT = Ctrl+C, SIGTERM = Kubernetes pod termination
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	serverErrors := make(chan error, 1)
	go func() {
		s.logger.Info("HTTP server starting", slog.String("addr", s.http.Addr))
		if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrors <- err
		}
	}()

	select {
	case err := <-serverErrors:
		return fmt.Errorf("server error: %w", err)
	case sig := <-quit:
		s.logger.Info("shutdown signal received", slog.String("signal", sig.String()))
	}

	return s.shutdown()
}

func (s *Server) shutdown() error {
	// 30 seconds total for graceful shutdown
	// Kubernetes default terminationGracePeriodSeconds is 30
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Step 1: Stop accepting new HTTP requests, wait for in-flight to complete
	s.logger.Info("stopping HTTP server")
	if err := s.http.Shutdown(ctx); err != nil {
		return fmt.Errorf("HTTP shutdown: %w", err)
	}

	// Step 2: Run all registered shutdown hooks
	s.mu.Lock()
	hooks := s.shutdown
	s.mu.Unlock()

	for _, fn := range hooks {
		if err := fn(ctx); err != nil {
			s.logger.Error("shutdown hook failed", slog.Any("error", err))
			// Continue running other hooks even if one fails
		}
	}

	s.logger.Info("server shutdown complete")
	return nil
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	srv := NewServer(":8080", mux, logger)

	// Register shutdown hooks
	srv.OnShutdown(func(ctx context.Context) error {
		logger.Info("closing database connection")
		// db.Close()
		return nil
	})
	srv.OnShutdown(func(ctx context.Context) error {
		logger.Info("flushing trace exporter")
		// tracerProvider.Shutdown(ctx)
		return nil
	})

	if err := srv.Run(); err != nil {
		logger.Error("server failed", slog.Any("error", err))
		os.Exit(1)
	}

	fmt.Println("server exited cleanly")
}
```

**Common Pitfall:** Kubernetes sends `SIGTERM`, then waits `terminationGracePeriodSeconds` (default 30s), then sends `SIGKILL`. If your shutdown takes longer than 30 seconds (e.g., you're waiting for a 2-minute database query), Kubernetes will kill the process and you lose the in-flight work. Design requests to have timeouts shorter than your graceful shutdown window.

---

## Part 9: Service Discovery

### Why Service Discovery

In a static system, you hardcode `http://payment-service:80`. In Kubernetes, you can do this too — Kubernetes provides DNS-based service discovery out of the box. When you create a Service object, Kubernetes creates a DNS entry: `payment-service.namespace.svc.cluster.local`. Every pod can resolve this DNS name to the ClusterIP, which load-balances across pods.

For non-Kubernetes environments, Consul provides service discovery with health checking — services register themselves, and clients query Consul for the current list of healthy instances.

```go
// internal/discovery/kubernetes.go
// In Kubernetes, service discovery is automatic via DNS.
// You simply use the service name as the hostname.
package discovery

import (
	"fmt"
	"net/http"
	"time"
)

// KubernetesTarget builds a service URL from Kubernetes DNS conventions.
// Pattern: <service-name>.<namespace>.svc.cluster.local:<port>
// For same namespace, you can just use: <service-name>:<port>
func KubernetesTarget(serviceName, namespace string, port int) string {
	return fmt.Sprintf("http://%s.%s.svc.cluster.local:%d", serviceName, namespace, port)
}

// NewHTTPClient creates an HTTP client suitable for service-to-service calls.
// Always set timeouts — the zero value means no timeout, which can leak goroutines.
func NewHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			// How long to wait for connection to be established
			// Separate from the overall request timeout
			IdleConnTimeout: 90 * time.Second,
		},
	}
}

// Example:
// target := KubernetesTarget("payment-service", "production", 8080)
// resp, err := client.Get(target + "/v1/payments")
// The Kubernetes Service object load-balances this across all healthy payment-service pods.

func Example() {
	target := KubernetesTarget("payment-service", "production", 8080)
	fmt.Println("Service URL:", target)
}
```

---

## Summary: The Complete Microservice Checklist

A production-grade Go microservice includes all of the following:

| Concern | Tool/Pattern | Why |
|---|---|---|
| Structure | cmd/ internal/ pkg/ | Separation of concerns, import control |
| Config | env vars + Viper | 12-factor app, no hardcoded values |
| Logging | slog/zap JSON | Queryable in log aggregators |
| Metrics | Prometheus client_golang | RED metrics, Grafana dashboards |
| Tracing | OpenTelemetry | Distributed request visibility |
| Health | /health/live + /health/ready | Kubernetes probes |
| gRPC | protoc + grpc-go | Typed, fast inter-service comms |
| Resilience | Circuit breaker + retry | Prevent cascade failures |
| Shutdown | os.Signal + http.Server.Shutdown | No dropped requests on deploy |
| Service discovery | Kubernetes DNS / Consul | Dynamic service location |
