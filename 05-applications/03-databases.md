# Go Databases: From SQL to NoSQL in Production

## What Is This?

Go's database ecosystem is built around the `database/sql` standard library package, which provides a generic interface for relational databases, and third-party drivers/libraries that implement that interface for specific databases like PostgreSQL, MySQL, and SQLite. Beyond relational databases, Go has first-class clients for NoSQL stores like MongoDB and Redis. Together, these tools form the persistence layer of virtually every Go backend service.

## Why Does It Exist?

Before `database/sql`, every database driver had its own completely different API. You had to rewrite your entire data layer when switching databases, and no shared patterns existed for connection pooling, prepared statements, or transactions. The Go team created `database/sql` as a driver-agnostic interface: your application code talks to `database/sql`, and the driver handles the database-specific wire protocol underneath. This meant the same query patterns, the same transaction idioms, and the same connection pool configuration work regardless of which database engine sits behind it.

## Who Uses This in Industry?

- **Google**: Uses Go for internal infrastructure services — Spanner clients and Cloud SQL proxies are written using `database/sql`-compatible interfaces. Go's low latency and tight connection pooling control matter when hundreds of microservices share database connections.
- **Uber**: Famously migrated core backend services from Python to Go, specifically because Go's `database/sql` connection pool and prepared statement caching handled their MySQL traffic at scale where Python's DB-API 2.0 implementations were choking. Their Docstore abstraction layer for NoSQL is also built in Go.
- **Cloudflare**: Uses Go with PostgreSQL for their analytics pipeline and configuration storage. Their use of `QueryContext` with deadline propagation means runaway queries never block the HTTP handler goroutine indefinitely.
- **Docker/Kubernetes**: Both use SQLite via `database/sql` for local state (Docker's local trust store, Kubernetes' etcd interaction layer) and PostgreSQL for production deployments of their control plane components.
- **Stripe**: Runs Go services that use `database/sql` with `sqlx` for their financial ledger queries — correctness via transactions and auditability via prepared statements are non-negotiable in fintech.

## Industry Standards & Best Practices

**What senior engineers do:**
- Always use `QueryContext` / `ExecContext` — never bare `Query`/`Exec`. Context propagation means HTTP request cancellations flow into database calls, preventing query pile-ups under load.
- Size the connection pool intentionally: `SetMaxOpenConns` to match your database's `max_connections` divided by the number of app instances. Leaving it at default (unlimited) is a production incident waiting to happen.
- Always `defer rows.Close()` immediately after checking the `rows, err` return. Leaking cursors exhausts connection pool slots.
- Check `rows.Err()` after the iteration loop — network errors during streaming results will not surface until this call.
- Use migrations (golang-migrate or goose) checked into the repo, applied at deploy time. Never run `ALTER TABLE` by hand in production.
- Use `sqlx` over raw `database/sql` for struct scanning — it eliminates an entire class of "scanning to wrong column index" bugs.
- Wrap every multi-statement mutation in a transaction. Even single-statement deletes on large tables benefit from `defer tx.Rollback()` as a safety net.

**What beginners do wrong:**
- Open a new `sql.DB` per request — catastrophic. `sql.DB` is a long-lived connection pool, open it once at startup.
- Ignore `rows.Err()` — silent data truncation bugs.
- Build queries with `fmt.Sprintf` — SQL injection vulnerability.
- Never set connection pool limits — database runs out of connections under load.

## Why Go's Approach Is Unique

Java uses JDBC (similar interface concept) but adds heavyweight ORM layers (Hibernate) that generate unpredictable SQL. Python's SQLAlchemy is expressive but its implicit session/unit-of-work model hides what queries are actually running. Node.js database libraries tend toward callback/Promise chains that obscure control flow when errors occur mid-transaction.

Go's `database/sql` is intentionally thin. There is no ORM built into the standard library. Go engineers write SQL directly, which means the query you write is exactly the query that runs. Combined with Go's explicit error handling, every step of a database interaction — open, prepare, query, scan, close — surfaces errors the caller must handle. This verbosity is a feature: in a financial system, you want to know exactly when and why a write failed, not have it silently swallowed by a framework's "smart retry" logic.

The tradeoff is more boilerplate than Django's ORM or Hibernate. `sqlx` and `pgx` address this ergonomically while preserving the explicit-SQL philosophy.

---

## 1. Opening a Connection and the Connection Pool

### Why Before How

`sql.Open` does NOT open a real connection — it just validates the driver name and DSN format, then returns a `*sql.DB` pool object. The first real connection happens on the first `Query` or `Ping`. This matters: a misconfigured DSN will not fail at `Open`, it will fail at `Ping`. Always call `db.Ping()` at startup to catch configuration errors before your server starts accepting traffic.

`*sql.DB` is goroutine-safe and is designed to be shared across the entire application. It manages a pool of idle connections. Creating a new `sql.DB` per request is one of the most common catastrophic mistakes in Go codebases.

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "time"

    _ "github.com/lib/pq" // PostgreSQL driver — blank import registers the driver
)

// Config holds database connection settings — in production, load from env vars
type Config struct {
    Host     string
    Port     int
    User     string
    Password string
    DBName   string
    SSLMode  string
}

// NewDB opens and configures a production-ready connection pool.
// This function should be called once at application startup.
func NewDB(cfg Config) (*sql.DB, error) {
    dsn := fmt.Sprintf(
        "host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
        cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode,
    )

    db, err := sql.Open("postgres", dsn)
    if err != nil {
        // This only fails if the driver name is unknown — not a network error
        return nil, fmt.Errorf("sql.Open: %w", err)
    }

    // --- Connection pool tuning ---
    // Rule of thumb: (number of CPU cores * 2) + effective_spindle_count
    // For a 4-core app talking to a 100-connection PG instance running 5 app replicas:
    // 100 / 5 = 20 max connections per replica
    db.SetMaxOpenConns(20)

    // Idle connections are kept open to avoid connection setup latency on bursts.
    // Idle count should equal MaxOpen for steady-state workloads.
    db.SetMaxIdleConns(20)

    // Connections older than this are closed and replaced.
    // Prevents stale connections after database restarts or network blips.
    db.SetConnMaxLifetime(5 * time.Minute)

    // Idle connections unused this long are closed.
    db.SetConnMaxIdleTime(1 * time.Minute)

    // Verify the database is actually reachable at startup
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    if err := db.PingContext(ctx); err != nil {
        db.Close()
        return nil, fmt.Errorf("db.PingContext: %w", err)
    }

    return db, nil
}

func main() {
    cfg := Config{
        Host:     "localhost",
        Port:     5432,
        User:     "golearn",
        Password: "secret",
        DBName:   "golearn_db",
        SSLMode:  "disable",
    }

    db, err := NewDB(cfg)
    if err != nil {
        log.Fatalf("failed to connect to database: %v", err)
    }
    defer db.Close()

    log.Println("Connected to database successfully")

    // Print pool stats — useful to log periodically in production
    stats := db.Stats()
    log.Printf("Pool: open=%d idle=%d wait=%d\n",
        stats.OpenConnections, stats.Idle, stats.WaitCount)
}
```

**Common Pitfall**: Using `db.SetMaxOpenConns(0)` (the default) means unlimited connections. Under a traffic spike, Go will happily try to open thousands of connections to PostgreSQL, which has a hard `max_connections` limit (default 100). Every new connection beyond that gets `FATAL: sorry, too many clients already`. Always set an explicit limit.

---

## 2. Querying Data: Query, QueryRow, Exec

### Why Before How

`database/sql` has three execution methods with distinct semantics:
- `QueryContext` — returns multiple rows. You must iterate and close them.
- `QueryRowContext` — returns exactly one row. Errors are deferred to `Scan`.
- `ExecContext` — for INSERT/UPDATE/DELETE. Returns `sql.Result` (last insert ID, rows affected), not rows.

Using `Query` for an INSERT is not just wrong semantically — if you forget to close the returned `*sql.Rows`, you leak a connection from the pool.

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "time"

    _ "github.com/lib/pq"
)

type User struct {
    ID        int
    Name      string
    Email     string
    CreatedAt time.Time
}

// QueryMultipleRows demonstrates correct iteration pattern.
// The defer rows.Close() + rows.Err() check pattern is non-negotiable.
func GetAllUsers(ctx context.Context, db *sql.DB) ([]User, error) {
    // Always use parameterized queries — never fmt.Sprintf
    query := `SELECT id, name, email, created_at FROM users ORDER BY id`

    rows, err := db.QueryContext(ctx, query)
    if err != nil {
        return nil, fmt.Errorf("QueryContext: %w", err)
    }
    defer rows.Close() // MUST be deferred immediately after error check

    var users []User
    for rows.Next() {
        var u User
        // Scan order must EXACTLY match SELECT column order
        if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt); err != nil {
            return nil, fmt.Errorf("rows.Scan: %w", err)
        }
        users = append(users, u)
    }

    // rows.Err() catches errors that occurred DURING iteration
    // (e.g., network failure mid-stream). Missing this is a silent data bug.
    if err := rows.Err(); err != nil {
        return nil, fmt.Errorf("rows.Err: %w", err)
    }

    return users, nil
}

// GetUserByID demonstrates QueryRow for single-row lookups.
func GetUserByID(ctx context.Context, db *sql.DB, id int) (*User, error) {
    query := `SELECT id, name, email, created_at FROM users WHERE id = $1`

    var u User
    // QueryRowContext never returns an error itself — the error is held internally
    // and surfaces only on Scan. sql.ErrNoRows is the "not found" sentinel.
    err := db.QueryRowContext(ctx, query, id).Scan(
        &u.ID, &u.Name, &u.Email, &u.CreatedAt,
    )
    if err == sql.ErrNoRows {
        return nil, nil // Caller decides if "not found" is an error
    }
    if err != nil {
        return nil, fmt.Errorf("QueryRowContext.Scan: %w", err)
    }

    return &u, nil
}

// CreateUser demonstrates Exec for INSERT with result inspection.
func CreateUser(ctx context.Context, db *sql.DB, name, email string) (int64, error) {
    query := `INSERT INTO users (name, email, created_at) VALUES ($1, $2, NOW()) RETURNING id`

    // For PostgreSQL RETURNING, we use QueryRow not Exec
    var id int64
    err := db.QueryRowContext(ctx, query, name, email).Scan(&id)
    if err != nil {
        return 0, fmt.Errorf("insert user: %w", err)
    }
    return id, nil
}

// UpdateUser demonstrates Exec and checking rows affected.
func UpdateUserName(ctx context.Context, db *sql.DB, id int, newName string) error {
    query := `UPDATE users SET name = $1 WHERE id = $2`

    result, err := db.ExecContext(ctx, query, newName, id)
    if err != nil {
        return fmt.Errorf("ExecContext: %w", err)
    }

    rowsAffected, err := result.RowsAffected()
    if err != nil {
        return fmt.Errorf("RowsAffected: %w", err)
    }
    if rowsAffected == 0 {
        return fmt.Errorf("user %d not found", id)
    }

    return nil
}

func main() {
    // Assumes a running PostgreSQL with the users table
    db, _ := sql.Open("postgres", "host=localhost user=golearn dbname=golearn_db sslmode=disable")
    defer db.Close()

    ctx := context.Background()

    // Create
    id, err := CreateUser(ctx, db, "Alice", "alice@example.com")
    if err != nil {
        log.Printf("create user: %v", err)
    } else {
        log.Printf("Created user with ID: %d", id)
    }

    // Read one
    user, err := GetUserByID(ctx, db, int(id))
    if err != nil {
        log.Printf("get user: %v", err)
    } else if user != nil {
        log.Printf("Found: %+v", *user)
    }

    // Read all
    users, err := GetAllUsers(ctx, db)
    if err != nil {
        log.Printf("get all users: %v", err)
    } else {
        log.Printf("Total users: %d", len(users))
    }

    // Update
    if err := UpdateUserName(ctx, db, int(id), "Alice Smith"); err != nil {
        log.Printf("update user: %v", err)
    }
}
```

---

## 3. Prepared Statements: sql.Stmt and SQL Injection Prevention

### Why Before How

A prepared statement is a query template that is compiled once by the database and executed many times with different parameters. Two critical benefits:

1. **SQL injection prevention**: Parameters are never interpolated into the query string. The database always treats them as data, not SQL. `fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", userInput)` is a critical security vulnerability. `db.QueryContext(ctx, "SELECT * FROM users WHERE name = $1", userInput)` is safe.

2. **Performance**: For queries executed in tight loops (e.g., batch inserts), the database parses and plans the query once, then reuses the plan. This can be 5-10x faster for bulk operations.

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"

    _ "github.com/lib/pq"
)

type Product struct {
    ID       int
    Name     string
    Price    float64
    Category string
}

// ProductStore demonstrates prepared statements in a struct (repository pattern).
// In production, prepare statements once at service startup, not per-request.
type ProductStore struct {
    db          *sql.DB
    stmtGetByID *sql.Stmt
    stmtCreate  *sql.Stmt
    stmtDelete  *sql.Stmt
}

// NewProductStore prepares all statements at initialization time.
// If any preparation fails, the service shouldn't start.
func NewProductStore(db *sql.DB) (*ProductStore, error) {
    s := &ProductStore{db: db}
    var err error

    s.stmtGetByID, err = db.Prepare(
        `SELECT id, name, price, category FROM products WHERE id = $1`,
    )
    if err != nil {
        return nil, fmt.Errorf("prepare stmtGetByID: %w", err)
    }

    s.stmtCreate, err = db.Prepare(
        `INSERT INTO products (name, price, category) VALUES ($1, $2, $3) RETURNING id`,
    )
    if err != nil {
        s.stmtGetByID.Close()
        return nil, fmt.Errorf("prepare stmtCreate: %w", err)
    }

    s.stmtDelete, err = db.Prepare(
        `DELETE FROM products WHERE id = $1`,
    )
    if err != nil {
        s.stmtGetByID.Close()
        s.stmtCreate.Close()
        return nil, fmt.Errorf("prepare stmtDelete: %w", err)
    }

    return s, nil
}

// Close releases all prepared statement resources.
func (s *ProductStore) Close() {
    s.stmtGetByID.Close()
    s.stmtCreate.Close()
    s.stmtDelete.Close()
}

func (s *ProductStore) GetByID(ctx context.Context, id int) (*Product, error) {
    var p Product
    err := s.stmtGetByID.QueryRowContext(ctx, id).Scan(
        &p.ID, &p.Name, &p.Price, &p.Category,
    )
    if err == sql.ErrNoRows {
        return nil, nil
    }
    if err != nil {
        return nil, fmt.Errorf("GetByID scan: %w", err)
    }
    return &p, nil
}

func (s *ProductStore) Create(ctx context.Context, p Product) (int64, error) {
    var id int64
    err := s.stmtCreate.QueryRowContext(ctx, p.Name, p.Price, p.Category).Scan(&id)
    if err != nil {
        return 0, fmt.Errorf("Create scan: %w", err)
    }
    return id, nil
}

// BatchInsert demonstrates performance benefit of prepared statements in a loop.
// Without prepared statements, the DB parses/plans the query N times.
// With them, parse/plan happens once.
func (s *ProductStore) BatchInsert(ctx context.Context, products []Product) error {
    for _, p := range products {
        if _, err := s.Create(ctx, p); err != nil {
            return fmt.Errorf("BatchInsert at %s: %w", p.Name, err)
        }
    }
    return nil
}

func main() {
    db, err := sql.Open("postgres", "host=localhost user=golearn dbname=golearn_db sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    store, err := NewProductStore(db)
    if err != nil {
        log.Fatalf("failed to init product store: %v", err)
    }
    defer store.Close()

    ctx := context.Background()

    id, err := store.Create(ctx, Product{Name: "Widget", Price: 9.99, Category: "tools"})
    if err != nil {
        log.Printf("create: %v", err)
    } else {
        log.Printf("Created product ID: %d", id)
    }

    // SQL injection attempt — completely safe with prepared statements
    // The input below is treated as a string value, never executed as SQL
    maliciousInput := "'; DROP TABLE products; --"
    _ = maliciousInput // would be passed as a parameter value, not interpolated
}
```

**Common Pitfall**: Preparing a statement inside a function that is called per-request. Each `db.Prepare` is a round-trip to the database. If you call it 1000 times/second, you are sending 1000 unnecessary prepare commands. Always prepare once, reuse many times.

---

## 4. Transactions: Begin, Commit, Rollback

### Why Before How

A transaction groups multiple SQL statements into an atomic unit: either all succeed (commit) or none take effect (rollback). Without transactions, a failure between two related writes (e.g., deducting from account A before adding to account B) leaves the database in an inconsistent state.

The canonical Go transaction pattern uses `defer tx.Rollback()`. This looks odd — why rollback after committing? Because `Rollback` on an already-committed transaction is a no-op. If the function returns early due to an error before `Commit`, the deferred `Rollback` fires and cleans up. If `Commit` succeeds, the subsequent `Rollback` in the deferred call does nothing. This pattern makes early returns safe without any special handling.

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"

    _ "github.com/lib/pq"
)

type Transfer struct {
    FromAccountID int
    ToAccountID   int
    Amount        float64
}

// TransferFunds demonstrates the canonical transaction pattern.
// This is a classic bank transfer — both the debit and credit must succeed together.
func TransferFunds(ctx context.Context, db *sql.DB, t Transfer) error {
    tx, err := db.BeginTx(ctx, &sql.TxOptions{
        Isolation: sql.LevelSerializable, // Prevents phantom reads in financial ops
        ReadOnly:  false,
    })
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    // KEY PATTERN: defer rollback IMMEDIATELY after BeginTx.
    // If Commit succeeds, this Rollback is a no-op.
    // If anything fails before Commit, this cleans up automatically.
    defer tx.Rollback()

    // Step 1: Debit from source account
    var fromBalance float64
    err = tx.QueryRowContext(ctx,
        `SELECT balance FROM accounts WHERE id = $1 FOR UPDATE`,
        t.FromAccountID,
    ).Scan(&fromBalance)
    if err == sql.ErrNoRows {
        return fmt.Errorf("source account %d not found", t.FromAccountID)
    }
    if err != nil {
        return fmt.Errorf("fetch source account: %w", err)
    }

    if fromBalance < t.Amount {
        return fmt.Errorf("insufficient funds: have %.2f, need %.2f", fromBalance, t.Amount)
    }

    _, err = tx.ExecContext(ctx,
        `UPDATE accounts SET balance = balance - $1 WHERE id = $2`,
        t.Amount, t.FromAccountID,
    )
    if err != nil {
        return fmt.Errorf("debit account: %w", err)
    }

    // Step 2: Credit to destination account
    var toExists bool
    err = tx.QueryRowContext(ctx,
        `SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1)`,
        t.ToAccountID,
    ).Scan(&toExists)
    if err != nil {
        return fmt.Errorf("check dest account: %w", err)
    }
    if !toExists {
        return fmt.Errorf("destination account %d not found", t.ToAccountID)
    }

    _, err = tx.ExecContext(ctx,
        `UPDATE accounts SET balance = balance + $1 WHERE id = $2`,
        t.Amount, t.ToAccountID,
    )
    if err != nil {
        return fmt.Errorf("credit account: %w", err)
    }

    // Step 3: Record the transfer in an audit log
    _, err = tx.ExecContext(ctx,
        `INSERT INTO transfers (from_id, to_id, amount, created_at) VALUES ($1, $2, $3, NOW())`,
        t.FromAccountID, t.ToAccountID, t.Amount,
    )
    if err != nil {
        return fmt.Errorf("record transfer: %w", err)
    }

    // Commit atomically — all three statements take effect together, or none do
    if err := tx.Commit(); err != nil {
        return fmt.Errorf("commit: %w", err)
    }

    return nil // defer tx.Rollback() fires here but is a no-op
}

// WithTransaction is a reusable helper that wraps any function in a transaction.
// This is the "functional options" pattern for transactions, used in larger codebases
// to avoid repeating the begin/defer-rollback/commit boilerplate everywhere.
func WithTransaction(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return fmt.Errorf("begin: %w", err)
    }
    defer tx.Rollback()

    if err := fn(tx); err != nil {
        return err
    }

    return tx.Commit()
}

func main() {
    db, err := sql.Open("postgres", "host=localhost user=golearn dbname=golearn_db sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    ctx := context.Background()

    // Using direct transaction function
    err = TransferFunds(ctx, db, Transfer{
        FromAccountID: 1,
        ToAccountID:   2,
        Amount:        100.00,
    })
    if err != nil {
        log.Printf("transfer failed: %v", err)
    }

    // Using reusable WithTransaction helper
    err = WithTransaction(ctx, db, func(tx *sql.Tx) error {
        _, err := tx.ExecContext(ctx, `UPDATE accounts SET status = 'verified' WHERE id = $1`, 1)
        return err
    })
    if err != nil {
        log.Printf("update status: %v", err)
    }
}
```

**Common Pitfall**: Forgetting `defer tx.Rollback()` and relying on explicit rollback calls in each error branch. When a new code path is added to the function later, it's easy to forget the rollback, leaving the transaction open and the connection stuck. The deferred pattern is defensive by default.

---

## 5. Connection Pool Tuning in Production

### Why Before How

The connection pool is the single biggest operational lever for database performance. Too few connections: requests queue up and latency spikes. Too many: the database is overwhelmed and starts refusing connections. The pool settings interact with your database server's `max_connections`, your number of application replicas, and your workload's query latency distribution.

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "net/http"
    "time"

    _ "github.com/lib/pq"
)

// PoolConfig encapsulates all tunable pool parameters.
// Load these from environment variables in production.
type PoolConfig struct {
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxLifetime time.Duration
    ConnMaxIdleTime time.Duration
}

// ProductionPoolConfig returns settings appropriate for a
// high-traffic web service sharing a PostgreSQL instance.
func ProductionPoolConfig(pgMaxConns int, appReplicas int) PoolConfig {
    // Don't use more than your share of the database's connections.
    // Reserve 10% for administrative connections (psql, monitoring).
    maxPerReplica := int(float64(pgMaxConns) * 0.9 / float64(appReplicas))
    if maxPerReplica < 5 {
        maxPerReplica = 5
    }

    return PoolConfig{
        MaxOpenConns: maxPerReplica,
        // Idle = MaxOpen means connections are always ready on burst.
        // Lower it only if you pay per connection (e.g., RDS Proxy pricing).
        MaxIdleConns:    maxPerReplica,
        ConnMaxLifetime: 5 * time.Minute,  // Rotate before NAT gateway timeout
        ConnMaxIdleTime: 30 * time.Second, // Return unused connections promptly
    }
}

func ConfigurePool(db *sql.DB, cfg PoolConfig) {
    db.SetMaxOpenConns(cfg.MaxOpenConns)
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
    db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)
}

// PoolStatsHandler exposes pool metrics for Prometheus/Grafana scraping.
// Mount this at /debug/db/stats in your internal health check server.
func PoolStatsHandler(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        stats := db.Stats()
        log.Printf(
            "db pool: max_open=%d open=%d in_use=%d idle=%d wait_count=%d wait_duration=%s",
            stats.MaxOpenConnections,
            stats.OpenConnections,
            stats.InUse,
            stats.Idle,
            stats.WaitCount,
            stats.WaitDuration,
        )
        // In production, write these as Prometheus metrics
        // prometheus.MustRegister(prometheus.NewGaugeFunc(...))
        w.WriteHeader(http.StatusOK)
    }
}

// MonitorPool logs pool stats periodically — useful for capacity planning.
func MonitorPool(ctx context.Context, db *sql.DB, interval time.Duration) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            stats := db.Stats()
            if stats.WaitCount > 0 {
                log.Printf("WARNING: pool contention detected. wait_count=%d wait_duration=%s",
                    stats.WaitCount, stats.WaitDuration)
            }
        }
    }
}

func main() {
    db, err := sql.Open("postgres", "host=localhost user=golearn dbname=golearn_db sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Configure for a 100-connection PG instance with 5 app replicas
    cfg := ProductionPoolConfig(100, 5)
    ConfigurePool(db, cfg)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // Start pool monitoring in background
    go MonitorPool(ctx, db, 30*time.Second)

    // Health check server
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/db/stats", PoolStatsHandler(db))
    log.Println("Server starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```

---

## 6. sqlx: Ergonomic SQL with Struct Scanning

### Why Before How

`database/sql` requires listing every struct field in every `rows.Scan()` call in column order. Add a new column to the table, add a new field to your struct, and forget to update the Scan — compile succeeds, runtime silently ignores the new column or panics on a column count mismatch. `sqlx` solves this by using struct field names (or `db:""` tags) to automatically map columns to fields, eliminating an entire class of maintenance bugs.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    "github.com/jmoiron/sqlx"
    _ "github.com/lib/pq"
)

// The `db` struct tag maps database column names to struct fields.
// Column name in DB: "created_at" → struct field: CreatedAt time.Time
type User struct {
    ID        int       `db:"id"`
    Name      string    `db:"name"`
    Email     string    `db:"email"`
    Role      string    `db:"role"`
    CreatedAt time.Time `db:"created_at"`
}

type UserRepository struct {
    db *sqlx.DB
}

func NewUserRepository(dsn string) (*UserRepository, error) {
    db, err := sqlx.Connect("postgres", dsn)
    if err != nil {
        return nil, fmt.Errorf("sqlx.Connect: %w", err)
    }
    return &UserRepository{db: db}, nil
}

// GetByID uses Get — like QueryRow but scans directly into a struct.
func (r *UserRepository) GetByID(ctx context.Context, id int) (*User, error) {
    var u User
    err := r.db.GetContext(ctx, &u,
        `SELECT id, name, email, role, created_at FROM users WHERE id = $1`, id)
    if err != nil {
        return nil, fmt.Errorf("GetByID: %w", err)
    }
    return &u, nil
}

// GetByRole uses Select — scans multiple rows directly into a slice of structs.
func (r *UserRepository) GetByRole(ctx context.Context, role string) ([]User, error) {
    var users []User
    err := r.db.SelectContext(ctx, &users,
        `SELECT id, name, email, role, created_at FROM users WHERE role = $1 ORDER BY name`,
        role,
    )
    if err != nil {
        return nil, fmt.Errorf("GetByRole: %w", err)
    }
    return users, nil
}

// Create uses NamedExec — use struct field names as query parameters.
// No more positional $1, $2... — column names drive the binding.
func (r *UserRepository) Create(ctx context.Context, u *User) error {
    query := `
        INSERT INTO users (name, email, role, created_at)
        VALUES (:name, :email, :role, :created_at)
        RETURNING id`

    // NamedQuery for RETURNING
    rows, err := r.db.NamedQueryContext(ctx, query, u)
    if err != nil {
        return fmt.Errorf("Create NamedQuery: %w", err)
    }
    defer rows.Close()

    if rows.Next() {
        if err := rows.Scan(&u.ID); err != nil {
            return fmt.Errorf("Create scan id: %w", err)
        }
    }
    return rows.Err()
}

// GetByIDs demonstrates sqlx.In — expands a slice into a variadic IN clause.
// Standard database/sql has no clean way to do this.
func (r *UserRepository) GetByIDs(ctx context.Context, ids []int) ([]User, error) {
    if len(ids) == 0 {
        return nil, nil
    }

    // sqlx.In rewrites "WHERE id IN (?)" with the correct number of placeholders
    // and returns the flattened args slice
    query, args, err := sqlx.In(`SELECT id, name, email, role, created_at FROM users WHERE id IN (?)`, ids)
    if err != nil {
        return nil, fmt.Errorf("sqlx.In: %w", err)
    }

    // Rebind converts ? placeholders to $1, $2... for PostgreSQL
    query = r.db.Rebind(query)

    var users []User
    if err := r.db.SelectContext(ctx, &users, query, args...); err != nil {
        return nil, fmt.Errorf("GetByIDs select: %w", err)
    }
    return users, nil
}

// BulkInsert demonstrates NamedExec with a slice of structs — one roundtrip for N rows.
func (r *UserRepository) BulkInsert(ctx context.Context, users []User) error {
    _, err := r.db.NamedExecContext(ctx,
        `INSERT INTO users (name, email, role, created_at) VALUES (:name, :email, :role, :created_at)`,
        users,
    )
    return err
}

func main() {
    repo, err := NewUserRepository("host=localhost user=golearn dbname=golearn_db sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer repo.db.Close()

    ctx := context.Background()

    // Create with named params — no column order dependency
    u := &User{
        Name:      "Bob",
        Email:     "bob@example.com",
        Role:      "admin",
        CreatedAt: time.Now(),
    }
    if err := repo.Create(ctx, u); err != nil {
        log.Printf("create: %v", err)
    } else {
        log.Printf("Created user ID: %d", u.ID)
    }

    // Fetch multiple by IDs — no manual IN clause building
    users, err := repo.GetByIDs(ctx, []int{1, 2, 3})
    if err != nil {
        log.Printf("get by ids: %v", err)
    } else {
        log.Printf("Found %d users", len(users))
    }
}
```

---

## 7. Context-Aware Queries

### Why Before How

Every `database/sql` function has a `Context` variant (`QueryContext`, `ExecContext`, `BeginTx`). Using context-aware variants is mandatory in production for two reasons:

1. **Request cancellation**: When an HTTP client disconnects, Go's `net/http` cancels the request context. If your database query uses that context, the query is cancelled at the database level, freeing the connection immediately rather than waiting for the query to finish.

2. **Timeout propagation**: A `context.WithTimeout` wrapping a database call prevents any single query from holding a connection indefinitely.

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "net/http"
    "time"

    _ "github.com/lib/pq"
)

var db *sql.DB

// SearchHandler demonstrates context flowing from HTTP request to database.
// When the client closes the connection, ctx is cancelled, and the DB query stops.
func SearchHandler(w http.ResponseWriter, r *http.Request) {
    // r.Context() is cancelled if:
    // 1. The client disconnects
    // 2. A timeout middleware fires
    // 3. The server shuts down
    ctx := r.Context()

    term := r.URL.Query().Get("q")
    if term == "" {
        http.Error(w, "missing q parameter", http.StatusBadRequest)
        return
    }

    // Query inherits the HTTP request's cancellation signal
    rows, err := db.QueryContext(ctx,
        `SELECT id, name FROM products WHERE name ILIKE $1 LIMIT 50`,
        "%"+term+"%",
    )
    if err != nil {
        if ctx.Err() != nil {
            // Client disconnected — not an error worth logging loudly
            log.Printf("query cancelled by client: %v", ctx.Err())
            return
        }
        http.Error(w, "database error", http.StatusInternalServerError)
        return
    }
    defer rows.Close()

    // ... scan and write response
    w.WriteHeader(http.StatusOK)
}

// SlowQueryWithTimeout wraps a potentially slow query in an explicit timeout.
// Use this for analytics queries that must not block the main app.
func SlowQueryWithTimeout(parentCtx context.Context, db *sql.DB) error {
    // Add a tighter deadline for this specific query, regardless of parent timeout
    ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
    defer cancel()

    var count int
    err := db.QueryRowContext(ctx,
        `SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '30 days'`,
    ).Scan(&count)
    if err != nil {
        if ctx.Err() == context.DeadlineExceeded {
            return fmt.Errorf("report query timed out after 5s")
        }
        return fmt.Errorf("report query: %w", err)
    }

    log.Printf("Orders last 30 days: %d", count)
    return nil
}

// HealthCheck demonstrates context with a short timeout for liveness probes.
func HealthCheck(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
        defer cancel()

        if err := db.PingContext(ctx); err != nil {
            http.Error(w, "db unhealthy: "+err.Error(), http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
        fmt.Fprint(w, "ok")
    }
}

func main() {
    var err error
    db, err = sql.Open("postgres", "host=localhost user=golearn dbname=golearn_db sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    mux := http.NewServeMux()
    mux.HandleFunc("/search", SearchHandler)
    mux.HandleFunc("/health", HealthCheck(db))

    log.Println("Listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```

---

## 8. Database Migrations

### Why Before How

A migration is a versioned, incremental change to the database schema (or data). Migrations are committed to the repo alongside the application code that depends on them. When you deploy a new version of the app, the migration runs first, ensuring the schema matches what the code expects.

Without migrations: developers run `ALTER TABLE` by hand on the production database, changes aren't tracked, rollbacks are manual, and staging environments drift from production. With migrations: schema changes are reviewed in PRs, applied automatically at deploy time, and reversible.

Two popular tools: **golang-migrate** (schema-focused, supports 40+ sources and databases) and **goose** (supports Go functions as migrations for data transforms, more flexible).

```go
// --- Using golang-migrate programmatically ---
// go get -u github.com/golang-migrate/migrate/v4
// go get -u github.com/golang-migrate/migrate/v4/database/postgres
// go get -u github.com/golang-migrate/migrate/v4/source/file

package main

import (
    "database/sql"
    "fmt"
    "log"

    "github.com/golang-migrate/migrate/v4"
    "github.com/golang-migrate/migrate/v4/database/postgres"
    _ "github.com/golang-migrate/migrate/v4/source/file"
    _ "github.com/lib/pq"
)

// RunMigrations applies all pending up migrations.
// Call this at application startup before serving requests.
func RunMigrations(db *sql.DB, migrationsDir string) error {
    driver, err := postgres.WithInstance(db, &postgres.Config{})
    if err != nil {
        return fmt.Errorf("create postgres driver: %w", err)
    }

    m, err := migrate.NewWithDatabaseInstance(
        "file://"+migrationsDir, // directory containing *.up.sql files
        "postgres",
        driver,
    )
    if err != nil {
        return fmt.Errorf("create migrator: %w", err)
    }

    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("run migrations: %w", err)
    }

    version, dirty, err := m.Version()
    if err != nil && err != migrate.ErrNilVersion {
        return fmt.Errorf("get version: %w", err)
    }
    log.Printf("Database at migration version %d (dirty: %v)", version, dirty)
    return nil
}

func main() {
    db, err := sql.Open("postgres", "host=localhost user=golearn dbname=golearn_db sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    if err := RunMigrations(db, "./migrations"); err != nil {
        log.Fatalf("migrations failed: %v", err)
    }

    log.Println("Migrations applied, starting server...")
}

/*
Migration file layout in ./migrations/:
  000001_create_users.up.sql
  000001_create_users.down.sql
  000002_add_email_index.up.sql
  000002_add_email_index.down.sql

000001_create_users.up.sql:
  CREATE TABLE users (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      email      VARCHAR(255) NOT NULL UNIQUE,
      role       VARCHAR(50)  NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

000001_create_users.down.sql:
  DROP TABLE IF EXISTS users;

000002_add_email_index.up.sql:
  CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

000002_add_email_index.down.sql:
  DROP INDEX IF EXISTS idx_users_email;
*/
```

**Using goose for Go-based migrations** (data migrations that need application logic):

```go
// go get github.com/pressly/goose/v3

package migrations

import (
    "context"
    "database/sql"

    "github.com/pressly/goose/v3"
)

func init() {
    goose.AddMigrationContext(upHashPasswords, downHashPasswords)
}

// upHashPasswords is a data migration — needs Go code to bcrypt existing passwords.
// This cannot be expressed in plain SQL.
func upHashPasswords(ctx context.Context, tx *sql.Tx) error {
    rows, err := tx.QueryContext(ctx, `SELECT id, password FROM users WHERE password_hashed = false`)
    if err != nil {
        return err
    }
    defer rows.Close()

    for rows.Next() {
        var id int
        var plaintext string
        if err := rows.Scan(&id, &plaintext); err != nil {
            return err
        }
        // bcrypt the password and update
        // hashed, _ := bcrypt.GenerateFromPassword([]byte(plaintext), bcrypt.DefaultCost)
        _, err = tx.ExecContext(ctx,
            `UPDATE users SET password = $1, password_hashed = true WHERE id = $2`,
            "hashed_"+plaintext, id, // placeholder — use bcrypt in real code
        )
        if err != nil {
            return err
        }
    }
    return rows.Err()
}

func downHashPasswords(ctx context.Context, tx *sql.Tx) error {
    // Irreversible migration — passwords cannot be un-hashed
    return nil
}
```

---

## 9. Testing with Databases: testcontainers-go and Mock DB

### Why Before How

Unit tests that hit a real database are slow and brittle (depend on external state). Integration tests that skip the database miss real SQL bugs. The solution is a two-layer strategy:

- **Mock/stub DB** (unit tests): Use `sqlmock` to set expectations on queries without a real database. Fast, deterministic, good for testing business logic.
- **testcontainers-go** (integration tests): Spin up a real PostgreSQL Docker container for the test run, run actual queries against it. Catches real bugs (wrong SQL syntax, missing indexes causing timeouts, constraint violations).

```go
package store_test

import (
    "context"
    "testing"

    "github.com/DATA-DOG/go-sqlmock"
    "github.com/jmoiron/sqlx"
)

// TestGetUserByID_Found uses sqlmock to test the happy path without a real DB.
func TestGetUserByID_Found(t *testing.T) {
    // Create a mock db and a controller
    mockDB, mock, err := sqlmock.New()
    if err != nil {
        t.Fatalf("sqlmock.New: %v", err)
    }
    defer mockDB.Close()

    // Wrap in sqlx for convenience
    db := sqlx.NewDb(mockDB, "postgres")

    // Set expectation: a specific query will be executed with argument 42
    rows := sqlmock.NewRows([]string{"id", "name", "email", "role", "created_at"}).
        AddRow(42, "Alice", "alice@example.com", "admin", "2024-01-01T00:00:00Z")

    mock.ExpectQuery(`SELECT id, name, email, role, created_at FROM users WHERE id = \$1`).
        WithArgs(42).
        WillReturnRows(rows)

    repo := &UserRepository{db: db}
    user, err := repo.GetByID(context.Background(), 42)
    if err != nil {
        t.Errorf("unexpected error: %v", err)
    }
    if user == nil {
        t.Fatal("expected user, got nil")
    }
    if user.Name != "Alice" {
        t.Errorf("expected Alice, got %s", user.Name)
    }

    // Verify all expectations were met
    if err := mock.ExpectationsWereMet(); err != nil {
        t.Errorf("unmet expectations: %v", err)
    }
}

// TestGetUserByID_NotFound tests the sql.ErrNoRows handling.
func TestGetUserByID_NotFound(t *testing.T) {
    mockDB, mock, _ := sqlmock.New()
    defer mockDB.Close()
    db := sqlx.NewDb(mockDB, "postgres")

    mock.ExpectQuery(`SELECT id, name, email, role, created_at FROM users WHERE id = \$1`).
        WithArgs(999).
        WillReturnRows(sqlmock.NewRows([]string{"id", "name", "email", "role", "created_at"}))

    repo := &UserRepository{db: db}
    user, err := repo.GetByID(context.Background(), 999)
    if err != nil {
        t.Errorf("unexpected error: %v", err)
    }
    if user != nil {
        t.Errorf("expected nil user, got %+v", user)
    }

    if err := mock.ExpectationsWereMet(); err != nil {
        t.Errorf("unmet expectations: %v", err)
    }
}
```

```go
// Integration test with testcontainers-go
// go get github.com/testcontainers/testcontainers-go

package store_test

import (
    "context"
    "testing"

    "github.com/jmoiron/sqlx"
    _ "github.com/lib/pq"
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
    "github.com/testcontainers/testcontainers-go/wait"
)

func TestIntegration_CreateAndGetUser(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping integration test")
    }

    ctx := context.Background()

    // Start a real PostgreSQL container
    pgContainer, err := postgres.RunContainer(ctx,
        testcontainers.WithImage("postgres:16-alpine"),
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("testuser"),
        postgres.WithPassword("testpass"),
        testcontainers.WithWaitStrategy(
            wait.ForLog("database system is ready to accept connections"),
        ),
    )
    if err != nil {
        t.Fatalf("start postgres container: %v", err)
    }
    t.Cleanup(func() { pgContainer.Terminate(ctx) })

    connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        t.Fatalf("get connection string: %v", err)
    }

    db, err := sqlx.Connect("postgres", connStr)
    if err != nil {
        t.Fatalf("connect: %v", err)
    }
    defer db.Close()

    // Apply schema
    _, err = db.ExecContext(ctx, `
        CREATE TABLE users (
            id         SERIAL PRIMARY KEY,
            name       VARCHAR(255) NOT NULL,
            email      VARCHAR(255) NOT NULL UNIQUE,
            role       VARCHAR(50)  NOT NULL DEFAULT 'user',
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `)
    if err != nil {
        t.Fatalf("create table: %v", err)
    }

    repo := &UserRepository{db: db}

    // Test real SQL against real PostgreSQL
    user := &User{Name: "TestUser", Email: "test@example.com", Role: "user"}
    // ... assert create and get behavior
    _ = repo
    _ = user
    t.Log("Integration test passed")
}

// Placeholder types for compilation
type UserRepository struct{ db *sqlx.DB }
type User struct {
    ID    int    `db:"id"`
    Name  string `db:"name"`
    Email string `db:"email"`
    Role  string `db:"role"`
}

func (r *UserRepository) GetByID(ctx context.Context, id int) (*User, error) {
    var u User
    err := r.db.GetContext(ctx, &u,
        `SELECT id, name, email, role, created_at FROM users WHERE id = $1`, id)
    if err != nil {
        return nil, err
    }
    return &u, nil
}
```

---

## 10. NoSQL: MongoDB with mongo-driver

### Why Before How

MongoDB's official Go driver (`go.mongodb.org/mongo-driver`) is used when your data is document-oriented (variable schema, nested structures) or when you need horizontal sharding at write scale. The driver follows the same principles as `database/sql`: long-lived client, context-aware operations, explicit error handling.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    "go.mongodb.org/mongo-driver/bson"
    "go.mongodb.org/mongo-driver/bson/primitive"
    "go.mongodb.org/mongo-driver/mongo"
    "go.mongodb.org/mongo-driver/mongo/options"
)

type BlogPost struct {
    ID        primitive.ObjectID `bson:"_id,omitempty"`
    Title     string             `bson:"title"`
    Content   string             `bson:"content"`
    Tags      []string           `bson:"tags"`
    AuthorID  string             `bson:"author_id"`
    Published bool               `bson:"published"`
    CreatedAt time.Time          `bson:"created_at"`
}

type PostRepository struct {
    collection *mongo.Collection
}

func NewPostRepository(uri, database string) (*PostRepository, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
    if err != nil {
        return nil, fmt.Errorf("mongo.Connect: %w", err)
    }

    if err := client.Ping(ctx, nil); err != nil {
        return nil, fmt.Errorf("mongo.Ping: %w", err)
    }

    coll := client.Database(database).Collection("posts")
    return &PostRepository{collection: coll}, nil
}

func (r *PostRepository) Create(ctx context.Context, post *BlogPost) error {
    post.CreatedAt = time.Now()
    result, err := r.collection.InsertOne(ctx, post)
    if err != nil {
        return fmt.Errorf("InsertOne: %w", err)
    }
    post.ID = result.InsertedID.(primitive.ObjectID)
    return nil
}

func (r *PostRepository) FindPublished(ctx context.Context, tag string) ([]BlogPost, error) {
    filter := bson.M{
        "published": true,
        "tags":      tag, // MongoDB checks if tag is in the tags array
    }
    opts := options.Find().
        SetSort(bson.D{{Key: "created_at", Value: -1}}).
        SetLimit(20)

    cursor, err := r.collection.Find(ctx, filter, opts)
    if err != nil {
        return nil, fmt.Errorf("Find: %w", err)
    }
    defer cursor.Close(ctx)

    var posts []BlogPost
    if err := cursor.All(ctx, &posts); err != nil {
        return nil, fmt.Errorf("cursor.All: %w", err)
    }
    return posts, nil
}

// UpdatePublished toggles a post's published status.
func (r *PostRepository) Publish(ctx context.Context, id primitive.ObjectID) error {
    filter := bson.M{"_id": id}
    update := bson.M{
        "$set": bson.M{
            "published": true,
        },
    }
    result, err := r.collection.UpdateOne(ctx, filter, update)
    if err != nil {
        return fmt.Errorf("UpdateOne: %w", err)
    }
    if result.MatchedCount == 0 {
        return fmt.Errorf("post %s not found", id.Hex())
    }
    return nil
}

func main() {
    repo, err := NewPostRepository("mongodb://localhost:27017", "blog")
    if err != nil {
        log.Fatalf("init repo: %v", err)
    }

    ctx := context.Background()

    post := &BlogPost{
        Title:    "Go and MongoDB",
        Content:  "Production patterns...",
        Tags:     []string{"go", "mongodb", "backend"},
        AuthorID: "user123",
    }

    if err := repo.Create(ctx, post); err != nil {
        log.Printf("create: %v", err)
    } else {
        log.Printf("Created post: %s", post.ID.Hex())
    }

    if err := repo.Publish(ctx, post.ID); err != nil {
        log.Printf("publish: %v", err)
    }

    posts, err := repo.FindPublished(ctx, "go")
    if err != nil {
        log.Printf("find: %v", err)
    } else {
        log.Printf("Found %d posts tagged 'go'", len(posts))
    }
}
```

---

## 11. NoSQL: Redis with go-redis

### Why Before How

Redis is used for caching (reducing database load), session storage (stateless auth), rate limiting (counter increments), and pub/sub messaging. `go-redis` is the de facto standard client for Go, with full support for Redis 7 commands, pipelining, and cluster mode.

```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "time"

    "github.com/redis/go-redis/v9"
)

type CachedUserStore struct {
    rdb   *redis.Client
    cache *redis.Client
}

func NewRedisClient(addr string) *redis.Client {
    return redis.NewClient(&redis.Options{
        Addr:         addr,
        Password:     "",
        DB:           0,
        PoolSize:     20,             // Match to your workload
        MinIdleConns: 5,
        DialTimeout:  2 * time.Second,
        ReadTimeout:  1 * time.Second,
        WriteTimeout: 1 * time.Second,
    })
}

// CacheUser stores a user struct in Redis with TTL.
func CacheUser(ctx context.Context, rdb *redis.Client, userID int, user interface{}) error {
    key := fmt.Sprintf("user:%d", userID)

    data, err := json.Marshal(user)
    if err != nil {
        return fmt.Errorf("marshal user: %w", err)
    }

    // SET key value EX 300
    return rdb.Set(ctx, key, data, 5*time.Minute).Err()
}

// GetCachedUser retrieves a user from cache. Returns redis.Nil if not found.
func GetCachedUser(ctx context.Context, rdb *redis.Client, userID int, dest interface{}) error {
    key := fmt.Sprintf("user:%d", userID)

    data, err := rdb.Get(ctx, key).Bytes()
    if err == redis.Nil {
        return redis.Nil // Cache miss — caller should fetch from DB
    }
    if err != nil {
        return fmt.Errorf("redis GET: %w", err)
    }

    return json.Unmarshal(data, dest)
}

// RateLimiter uses Redis INCR + EXPIRE for a sliding window rate limiter.
// Returns true if the request is allowed, false if rate limit exceeded.
func RateLimiter(ctx context.Context, rdb *redis.Client, userID string, limitPerMinute int) (bool, error) {
    key := fmt.Sprintf("rate:%s:%d", userID, time.Now().Unix()/60) // 1-minute window

    pipe := rdb.Pipeline()
    incr := pipe.Incr(ctx, key)
    pipe.Expire(ctx, key, 2*time.Minute) // 2 min TTL to allow for clock drift

    _, err := pipe.Exec(ctx)
    if err != nil {
        return false, fmt.Errorf("pipeline exec: %w", err)
    }

    count := incr.Val()
    return count <= int64(limitPerMinute), nil
}

// DistributedLock implements a simple Redis-based distributed lock (Redlock-lite).
// For production, use the official Redlock algorithm with multiple Redis nodes.
func AcquireLock(ctx context.Context, rdb *redis.Client, lockKey string, ttl time.Duration) (bool, error) {
    // SET NX (set if not exists) — atomic test-and-set
    ok, err := rdb.SetNX(ctx, "lock:"+lockKey, "1", ttl).Result()
    if err != nil {
        return false, fmt.Errorf("SetNX: %w", err)
    }
    return ok, nil
}

func ReleaseLock(ctx context.Context, rdb *redis.Client, lockKey string) error {
    return rdb.Del(ctx, "lock:"+lockKey).Err()
}

// Pipeline batches multiple commands in a single round-trip.
func GetMultipleCounters(ctx context.Context, rdb *redis.Client, keys []string) ([]int64, error) {
    pipe := rdb.Pipeline()
    cmds := make([]*redis.IntCmd, len(keys))
    for i, k := range keys {
        cmds[i] = pipe.IncrBy(ctx, k, 0) // Read without incrementing
    }

    if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
        return nil, fmt.Errorf("pipeline: %w", err)
    }

    results := make([]int64, len(keys))
    for i, cmd := range cmds {
        results[i] = cmd.Val()
    }
    return results, nil
}

func main() {
    rdb := NewRedisClient("localhost:6379")
    defer rdb.Close()

    ctx := context.Background()

    // Test connection
    if err := rdb.Ping(ctx).Err(); err != nil {
        log.Fatalf("redis ping: %v", err)
    }

    // Cache example
    type User struct {
        ID   int    `json:"id"`
        Name string `json:"name"`
    }

    user := User{ID: 1, Name: "Alice"}
    if err := CacheUser(ctx, rdb, user.ID, user); err != nil {
        log.Printf("cache user: %v", err)
    }

    var cached User
    err := GetCachedUser(ctx, rdb, 1, &cached)
    switch err {
    case nil:
        log.Printf("Cache hit: %+v", cached)
    case redis.Nil:
        log.Println("Cache miss — fetch from DB")
    default:
        log.Printf("Redis error: %v", err)
    }

    // Rate limiter
    allowed, err := RateLimiter(ctx, rdb, "user:42", 100)
    if err != nil {
        log.Printf("rate limiter error: %v", err)
    } else if !allowed {
        log.Println("Rate limit exceeded")
    }

    // Distributed lock
    acquired, _ := AcquireLock(ctx, rdb, "payment:process:order123", 30*time.Second)
    if acquired {
        log.Println("Lock acquired, processing...")
        defer ReleaseLock(ctx, rdb, "payment:process:order123")
    } else {
        log.Println("Another instance is processing this order")
    }
}
```

---

## Summary: Production Database Checklist

| Concern | Pattern | Library |
|---|---|---|
| Connection pool | `SetMaxOpenConns` + `SetConnMaxLifetime` | `database/sql` |
| Struct scanning | `db` tags + `SelectContext`/`GetContext` | `sqlx` |
| SQL injection | Parameterized queries always | `database/sql` |
| Transactions | `BeginTx` + `defer tx.Rollback()` | `database/sql` |
| Schema management | File-based versioned migrations | `golang-migrate` or `goose` |
| Context propagation | `*Context` variants everywhere | `database/sql` |
| Unit testing | SQL expectation mocking | `go-sqlmock` |
| Integration testing | Real DB in Docker | `testcontainers-go` |
| Document store | BSON-tagged structs, cursor pattern | `mongo-driver` |
| Cache / rate limit | Pipeline, SetNX, key TTL | `go-redis` |
