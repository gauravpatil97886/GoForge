> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# Go Databases — Coding Practice

---
## Q1: Open and Ping a Database  [Level 1 — Beginner]
> **Tags:** `#database` `#sql` `#connection` `#ping`

### Problem Statement
Write a Go program that opens a connection to a PostgreSQL database using `database/sql` and `lib/pq`. After opening, verify the connection is alive by calling `db.Ping()`. Handle errors from both `sql.Open` and `Ping` separately.

### Input / Output / Constraints
```
Input:  DSN string "postgres://user:pass@localhost:5432/mydb?sslmode=disable"
Output: "Connected to database successfully" or error message
Constraints: Must call Ping, must defer db.Close, DSN from env var
```

### Thought Process
1. Understand: sql.Open does not actually connect — it just validates the DSN. Ping forces the driver to connect.
2. Pattern: Open → Ping → defer Close → use.
3. Edge cases: Wrong DSN format, unreachable host, wrong credentials.

### Brute Force
```go
// O(1) time, O(1) space
func bruteForce(dsn string) error {
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        return err
    }
    return db.Ping()
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(dsn string) (*sql.DB, error) {
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        return nil, fmt.Errorf("sql.Open: %w", err)
    }
    if err := db.Ping(); err != nil {
        db.Close()
        return nil, fmt.Errorf("db.Ping: %w", err)
    }
    return db, nil
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
    "log"
    "os"

    _ "github.com/lib/pq"
)

// OpenDB — O(1) time, O(1) space
func OpenDB() (*sql.DB, error) {
    dsn := os.Getenv("DATABASE_URL")
    if dsn == "" {
        return nil, fmt.Errorf("DATABASE_URL env var not set")
    }
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        return nil, fmt.Errorf("sql.Open failed: %w", err)
    }
    if err := db.Ping(); err != nil {
        db.Close()
        return nil, fmt.Errorf("db.Ping failed: %w", err)
    }
    return db, nil
}

func main() {
    db, err := OpenDB()
    if err != nil {
        log.Fatalf("cannot connect: %v", err)
    }
    defer db.Close()
    fmt.Println("Connected to database successfully")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Single connection; set pool limits before serving traffic |
| Edge Cases | Empty DSN, wrong driver name, TLS cert mismatch |
| Error Handling | Wrap errors with %w for unwrapping in tests |
| Memory | db.Close deferred; avoid leaking on error path |
| Concurrency | *sql.DB is goroutine-safe after Ping |

### Visual Explanation
```mermaid
flowchart TD
    A["Read DSN from env"] --> B["sql.Open(driver, dsn)"]
    B --> C{Error?}
    C -- yes --> D["Return error"]
    C -- no --> E["db.Ping()"]
    E --> F{Error?}
    F -- yes --> G["db.Close() + return error"]
    F -- no --> H["Return *sql.DB"]
```
```
Trace: os.Getenv → sql.Open (validates DSN) → db.Ping (real TCP connect) → return db
```

### Interviewer Questions
1. Why this approach? sql.Open is lazy; Ping confirms reachability early.
2. Can it be optimized? Read DSN once at startup, reuse pool.
3. Scale to 10M? Use pgbouncer or connection pooler in front.
4. Edge cases? TLS errors, IPv6 addresses in DSN, timeout.
5. Goroutine-safe? Yes, *sql.DB manages pool internally.
6. Memory impact? One pool per process; negligible.
7. Alternative? pgx driver has native pool with better metrics.

### Follow-Up Questions
**Q1:** What does sql.Open actually do? **A1:** Validates the DSN and registers the driver; no TCP connection yet.
**Q2:** When does the real connection happen? **A2:** On the first Ping, Query, or Exec call.
**Q3:** Why defer db.Close? **A3:** Ensures connection pool is released even on panic.
**Q4:** What if DATABASE_URL is wrong format? **A4:** sql.Open returns an error for unparseable DSNs.
**Q5:** How do you test without a real DB? **A5:** Use sqlmock or an in-memory SQLite driver.

---

---
## Q2: QueryRow and Scan  [Level 1 — Beginner]
> **Tags:** `#queryrow` `#scan` `#sql` `#select`

### Problem Statement
Write a function `GetUserByID` that queries a single user row from a `users` table using `db.QueryRow`. Scan the result into a `User` struct. Handle `sql.ErrNoRows` explicitly and return a descriptive error.

### Input / Output / Constraints
```
Input:  db *sql.DB, userID int
Output: User{ID, Name, Email} or error
Constraints: Return sql.ErrNoRows as sentinel, table: users(id, name, email)
```

### Thought Process
1. Understand: QueryRow always returns a Row; the error surfaces on Scan.
2. Pattern: QueryRow → Scan → check errors.ErrNoRows.
3. Edge cases: userID <= 0, NULL columns, connection lost mid-query.

### Brute Force
```go
// O(1) time, O(1) space
func bruteForce(db *sql.DB, id int) (User, error) {
    row := db.QueryRow("SELECT id, name, email FROM users WHERE id = $1", id)
    var u User
    err := row.Scan(&u.ID, &u.Name, &u.Email)
    return u, err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(db *sql.DB, id int) (User, error) {
    var u User
    err := db.QueryRow(
        "SELECT id, name, email FROM users WHERE id = $1", id,
    ).Scan(&u.ID, &u.Name, &u.Email)
    if errors.Is(err, sql.ErrNoRows) {
        return User{}, fmt.Errorf("user %d not found", id)
    }
    return u, err
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "errors"
    "fmt"
    "log"
)

type User struct {
    ID    int
    Name  string
    Email string
}

// GetUserByID — O(1) time, O(1) space
func GetUserByID(db *sql.DB, id int) (User, error) {
    if id <= 0 {
        return User{}, fmt.Errorf("invalid user id: %d", id)
    }
    const q = `SELECT id, name, email FROM users WHERE id = $1`
    var u User
    err := db.QueryRow(q, id).Scan(&u.ID, &u.Name, &u.Email)
    switch {
    case errors.Is(err, sql.ErrNoRows):
        return User{}, fmt.Errorf("user %d: %w", id, sql.ErrNoRows)
    case err != nil:
        return User{}, fmt.Errorf("GetUserByID query: %w", err)
    }
    return u, nil
}

func main() {
    // db, _ := OpenDB()  // see Q1
    log.Println("GetUserByID defined; wire up db to test")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Single row lookup; add index on id (PK) |
| Edge Cases | NULL email → use sql.NullString, negative ids |
| Error Handling | Wrap ErrNoRows so callers can errors.Is check |
| Memory | One row scanned into stack-allocated struct |
| Concurrency | QueryRow is goroutine-safe on *sql.DB |

### Visual Explanation
```mermaid
flowchart TD
    A["GetUserByID(db, id)"] --> B["Validate id > 0"]
    B --> C["db.QueryRow(q, id)"]
    C --> D["row.Scan(&u.ID, &u.Name, &u.Email)"]
    D --> E{err?}
    E -- ErrNoRows --> F["return fmt.Errorf wrap ErrNoRows"]
    E -- other err --> G["return wrapped error"]
    E -- nil --> H["return User struct"]
```
```
Trace: id=5 → QueryRow → Scan → User{5,"Alice","a@b.com"} returned
```

### Interviewer Questions
1. Why this approach? QueryRow is idiomatic for single-row lookups.
2. Can it be optimized? Prepared statement if called in a hot loop.
3. Scale to 10M? Primary key lookup is O(log n) with B-tree index.
4. Edge cases? NULL columns crash Scan without sql.Null* types.
5. Goroutine-safe? Yes, pool manages connections.
6. Memory impact? Single struct on stack, no heap allocations.
7. Alternative? pgx rows.Scan with named columns via pgx/v5.

### Follow-Up Questions
**Q1:** Why not use Query instead? **A1:** QueryRow is simpler; Query requires rows.Close to avoid connection leak.
**Q2:** How to handle nullable email? **A2:** Use `var email sql.NullString` and scan into it.
**Q3:** What if Scan column count mismatches? **A3:** Runtime error: expected N destination arguments in Scan.
**Q4:** Can you reuse the query string? **A4:** Yes, declare as package-level const.
**Q5:** How to mock this in tests? **A5:** Use sqlmock: mock.ExpectQuery with WillReturnRows.

---

---
## Q3: Query Multiple Rows  [Level 1 — Beginner]
> **Tags:** `#query` `#rows` `#scan` `#iteration`

### Problem Statement
Write a function `ListUsers` that fetches all rows from a `users` table using `db.Query`. Iterate with `rows.Next()`, scan each row, and check `rows.Err()` after the loop. Ensure rows are closed even on early return.

### Input / Output / Constraints
```
Input:  db *sql.DB
Output: []User or error
Constraints: defer rows.Close, check rows.Err(), handle empty result as []User{}
```

### Thought Process
1. Understand: db.Query returns *sql.Rows; must close or connection leaks.
2. Pattern: Query → defer Close → loop Next → Scan → check Err.
3. Edge cases: Empty table, scan error mid-loop, network drop.

### Brute Force
```go
// O(n) time, O(n) space
func bruteForce(db *sql.DB) ([]User, error) {
    rows, err := db.Query("SELECT id, name, email FROM users")
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var users []User
    for rows.Next() {
        var u User
        rows.Scan(&u.ID, &u.Name, &u.Email)
        users = append(users, u)
    }
    return users, nil
}
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
func better(db *sql.DB) ([]User, error) {
    rows, err := db.Query("SELECT id, name, email FROM users ORDER BY id")
    if err != nil {
        return nil, fmt.Errorf("query: %w", err)
    }
    defer rows.Close()
    var users []User
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
            return nil, fmt.Errorf("scan: %w", err)
        }
        users = append(users, u)
    }
    return users, rows.Err()
}
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
    "log"
)

// ListUsers — O(n) time, O(n) space
func ListUsers(db *sql.DB) ([]User, error) {
    const q = `SELECT id, name, email FROM users ORDER BY id`
    rows, err := db.Query(q)
    if err != nil {
        return nil, fmt.Errorf("ListUsers query: %w", err)
    }
    defer rows.Close()

    users := make([]User, 0, 16)
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
            return nil, fmt.Errorf("ListUsers scan: %w", err)
        }
        users = append(users, u)
    }
    if err := rows.Err(); err != nil {
        return nil, fmt.Errorf("ListUsers rows.Err: %w", err)
    }
    return users, nil
}

func main() {
    log.Println("ListUsers defined; wire up db to test")
}
```
**Time:** O(n) | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Paginate large tables; fetching all rows is dangerous at scale |
| Edge Cases | Empty table returns empty slice, not nil |
| Error Handling | rows.Err must be checked; scan errors returned immediately |
| Memory | Pre-allocate slice with estimated capacity |
| Concurrency | Each goroutine should call Query separately |

### Visual Explanation
```mermaid
flowchart TD
    A["db.Query(q)"] --> B{err?}
    B -- yes --> C["return error"]
    B -- no --> D["defer rows.Close()"]
    D --> E["rows.Next() loop"]
    E --> F["rows.Scan(&u)"]
    F --> G{scan err?}
    G -- yes --> H["return error"]
    G -- no --> I["append to slice"]
    I --> E
    E -- done --> J["rows.Err()"]
    J --> K["return users"]
```
```
Trace: Query → 3 rows → Scan×3 → rows.Err()==nil → return [u1,u2,u3]
```

### Interviewer Questions
1. Why this approach? Idiomatic Go database iteration pattern.
2. Can it be optimized? Use LIMIT/OFFSET or cursor pagination.
3. Scale to 10M? Stream rows and process in batches, don't load all.
4. Edge cases? Network interruption sets rows.Err after loop.
5. Goroutine-safe? db.Query is safe; rows object is not shared.
6. Memory impact? O(n) — dangerous for large tables.
7. Alternative? pgx.Rows with CollectRows helper.

### Follow-Up Questions
**Q1:** What happens if you forget rows.Close? **A1:** Connection held open until GC; pool exhaustion under load.
**Q2:** Why pre-allocate the slice? **A2:** Reduces GC pressure from repeated append growth.
**Q3:** Why check rows.Err after loop? **A3:** Network errors during streaming appear there, not in Next.
**Q4:** Can you use rows.Columns()? **A4:** Yes, to dynamically read column names for generic scanners.
**Q5:** Difference between Query and QueryContext? **A5:** QueryContext accepts context for timeout/cancellation.

---

---
## Q4: INSERT UPDATE DELETE  [Level 2 — Easy]
> **Tags:** `#insert` `#update` `#delete` `#exec` `#rowsaffected`

### Problem Statement
Write three functions: `CreateUser`, `UpdateUserEmail`, and `DeleteUser`. Each uses `db.Exec`. For INSERT, return the new ID using `RETURNING id`. For UPDATE and DELETE, verify `RowsAffected` is exactly 1 and return an error otherwise.

### Input / Output / Constraints
```
Input:  db *sql.DB, name/email strings, userID int
Output: newID int64 or error; rows affected count
Constraints: Use RETURNING for INSERT, check RowsAffected, wrap errors
```

### Thought Process
1. Understand: Exec returns sql.Result with LastInsertId and RowsAffected.
2. Pattern: Exec → check err → check RowsAffected.
3. Edge cases: Duplicate email (UNIQUE constraint), delete non-existent id.

### Brute Force
```go
// O(1) time, O(1) space
func bruteForce(db *sql.DB, name, email string) (int64, error) {
    res, err := db.Exec("INSERT INTO users(name,email) VALUES($1,$2)", name, email)
    if err != nil {
        return 0, err
    }
    return res.LastInsertId()
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// PostgreSQL uses RETURNING; LastInsertId not supported by pq driver
func better(db *sql.DB, name, email string) (int64, error) {
    var id int64
    err := db.QueryRow(
        "INSERT INTO users(name,email) VALUES($1,$2) RETURNING id",
        name, email,
    ).Scan(&id)
    return id, err
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

// CreateUser — O(1) time, O(1) space
func CreateUser(db *sql.DB, name, email string) (int64, error) {
    var id int64
    err := db.QueryRow(
        `INSERT INTO users(name, email) VALUES($1, $2) RETURNING id`,
        name, email,
    ).Scan(&id)
    if err != nil {
        return 0, fmt.Errorf("CreateUser: %w", err)
    }
    return id, nil
}

// UpdateUserEmail — O(1) time, O(1) space
func UpdateUserEmail(db *sql.DB, userID int, newEmail string) error {
    res, err := db.Exec(
        `UPDATE users SET email=$1 WHERE id=$2`, newEmail, userID,
    )
    if err != nil {
        return fmt.Errorf("UpdateUserEmail exec: %w", err)
    }
    n, _ := res.RowsAffected()
    if n != 1 {
        return fmt.Errorf("UpdateUserEmail: expected 1 row affected, got %d", n)
    }
    return nil
}

// DeleteUser — O(1) time, O(1) space
func DeleteUser(db *sql.DB, userID int) error {
    res, err := db.Exec(`DELETE FROM users WHERE id=$1`, userID)
    if err != nil {
        return fmt.Errorf("DeleteUser exec: %w", err)
    }
    n, _ := res.RowsAffected()
    if n != 1 {
        return fmt.Errorf("DeleteUser: user %d not found", userID)
    }
    return nil
}

func main() {
    fmt.Println("CRUD functions defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Each is a single-row operation; use batch insert for bulk |
| Edge Cases | UNIQUE violation returns pq error code 23505 |
| Error Handling | Parse pq.Error for constraint name to return user-friendly msg |
| Memory | Result object tiny; no heap concern |
| Concurrency | db.Exec is goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["CreateUser(name,email)"] --> B["QueryRow INSERT RETURNING id"]
    B --> C["Scan &id"]
    C --> D["return id"]

    E["UpdateUserEmail(id,email)"] --> F["db.Exec UPDATE"]
    F --> G["RowsAffected == 1?"]
    G -- no --> H["error: not found"]
    G -- yes --> I["return nil"]
```
```
Trace: INSERT → RETURNING id=42 → Scan → return 42
```

### Interviewer Questions
1. Why RETURNING instead of LastInsertId? **A1:** pq driver does not implement LastInsertId for PostgreSQL.
2. Can it be optimized? Batch inserts with COPY for bulk loads.
3. Scale to 10M? Write to queue, async DB write, return 202 Accepted.
4. Edge cases? UNIQUE, FK violations need typed error parsing.
5. Goroutine-safe? Yes.
6. Memory impact? Negligible for single rows.
7. Alternative? sqlc generates type-safe CRUD functions from SQL.

### Follow-Up Questions
**Q1:** How to detect a duplicate email error? **A1:** Cast err to *pq.Error and check Code == "23505".
**Q2:** Why check RowsAffected for DELETE? **A2:** Silent success on missing row is a bug; caller expects confirmation.
**Q3:** What does db.Exec return for INSERT? **A3:** sql.Result with RowsAffected and driver-specific LastInsertId.
**Q4:** How to do bulk insert efficiently? **A4:** Use COPY protocol via pq.CopyIn or batch VALUES.
**Q5:** Should UPDATE return the updated row? **A5:** Use UPDATE ... RETURNING * for optimistic concurrency checks.

---

---
## Q5: Prepared Statements  [Level 2 — Easy]
> **Tags:** `#prepared-statement` `#stmt` `#performance` `#sql-injection`

### Problem Statement
Write a function `PreparedInsertUsers` that prepares a single INSERT statement once and then executes it in a loop for a slice of users. Use `db.Prepare`, defer `stmt.Close`, and execute with `stmt.Exec` per user. Explain the performance and security benefits.

### Input / Output / Constraints
```
Input:  db *sql.DB, users []User
Output: error if any insert fails
Constraints: Prepare once, Exec N times, defer stmt.Close, rollback on failure
```

### Thought Process
1. Understand: Prepare sends SQL to DB once; subsequent Exec only sends params.
2. Pattern: Prepare → defer Close → loop Exec.
3. Edge cases: Empty slice, prepare fails, exec fails mid-loop.

### Brute Force
```go
// O(n) time, O(1) space — but N round trips for SQL parse
func bruteForce(db *sql.DB, users []User) error {
    for _, u := range users {
        _, err := db.Exec("INSERT INTO users(name,email) VALUES($1,$2)", u.Name, u.Email)
        if err != nil {
            return err
        }
    }
    return nil
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
func better(db *sql.DB, users []User) error {
    stmt, err := db.Prepare("INSERT INTO users(name,email) VALUES($1,$2)")
    if err != nil {
        return fmt.Errorf("prepare: %w", err)
    }
    defer stmt.Close()
    for _, u := range users {
        if _, err := stmt.Exec(u.Name, u.Email); err != nil {
            return fmt.Errorf("exec: %w", err)
        }
    }
    return nil
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

// PreparedInsertUsers — O(n) time, O(1) space
func PreparedInsertUsers(db *sql.DB, users []User) error {
    if len(users) == 0 {
        return nil
    }
    const q = `INSERT INTO users(name, email) VALUES($1, $2)`
    stmt, err := db.Prepare(q)
    if err != nil {
        return fmt.Errorf("PreparedInsertUsers prepare: %w", err)
    }
    defer stmt.Close()

    for i, u := range users {
        if _, err := stmt.Exec(u.Name, u.Email); err != nil {
            return fmt.Errorf("PreparedInsertUsers exec[%d]: %w", i, err)
        }
    }
    return nil
}

func main() {
    fmt.Println("PreparedInsertUsers defined")
}
```
**Time:** O(n) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Prepared stmt cached on server; reduces parse overhead per call |
| Edge Cases | stmt invalid after connection recycle; pool re-prepares automatically |
| Error Handling | Return index of failed row for partial failure reporting |
| Memory | stmt held open until Close; don't leak in long-lived services |
| Concurrency | *sql.Stmt is goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["db.Prepare(INSERT ...)"] --> B{err?}
    B -- yes --> C["return error"]
    B -- no --> D["defer stmt.Close()"]
    D --> E["for each user"]
    E --> F["stmt.Exec(name, email)"]
    F --> G{err?}
    G -- yes --> H["return wrapped error"]
    G -- no --> E
    E -- done --> I["return nil"]
```
```
Trace: Prepare×1 → Exec×N users → Close → return nil
```

### Interviewer Questions
1. Why prepared statements? Parse once, execute many; prevents SQL injection.
2. Can it be optimized? Use COPY for bulk inserts; faster than prepared.
3. Scale to 10M? Batch insert with multi-row VALUES or COPY.
4. Edge cases? Pool reconnects transparently re-prepare the stmt.
5. Goroutine-safe? Yes, *sql.Stmt is safe for concurrent use.
6. Memory impact? One server-side plan per prepared statement.
7. Alternative? sqlc or squirrel query builder with parameterized queries.

### Follow-Up Questions
**Q1:** Does Prepare prevent SQL injection? **A1:** Yes — params are always sent separately from SQL text.
**Q2:** What happens if the connection drops mid-loop? **A2:** Pool picks a new connection; stmt is transparently re-prepared.
**Q3:** When should you NOT use Prepare? **A3:** One-off queries; overhead of prepare round trip isn't worth it.
**Q4:** Is stmt.Close required? **A4:** Yes; leaks server-side plan cache entries otherwise.
**Q5:** How to use prepared stmt in a transaction? **A5:** Use tx.Stmt(stmt) to bind the prepared stmt to a transaction.

---

---
## Q6: Transactions Begin Commit Rollback  [Level 2 — Easy]
> **Tags:** `#transaction` `#begin` `#commit` `#rollback` `#acid`

### Problem Statement
Write a function `TransferBalance` that transfers an amount between two bank accounts atomically. Use `db.Begin`, execute two UPDATE statements inside the transaction, and call `tx.Commit`. If any step fails, call `tx.Rollback`. Ensure the balance never goes negative.

### Input / Output / Constraints
```
Input:  db *sql.DB, fromID, toID int, amount float64
Output: error
Constraints: Both UPDATEs in one transaction, check balance >= amount, rollback on error
```

### Thought Process
1. Understand: Both debits and credits must succeed or both must fail.
2. Pattern: Begin → Exec debit → Exec credit → Commit (or Rollback).
3. Edge cases: Insufficient funds, same account transfer, negative amount.

### Brute Force
```go
// O(1) time, O(1) space — no balance check
func bruteForce(db *sql.DB, from, to int, amt float64) error {
    tx, _ := db.Begin()
    tx.Exec("UPDATE accounts SET balance=balance-$1 WHERE id=$2", amt, from)
    tx.Exec("UPDATE accounts SET balance=balance+$1 WHERE id=$2", amt, to)
    return tx.Commit()
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(db *sql.DB, from, to int, amt float64) error {
    tx, err := db.Begin()
    if err != nil {
        return err
    }
    if _, err = tx.Exec("UPDATE accounts SET balance=balance-$1 WHERE id=$2 AND balance>=$1", amt, from); err != nil {
        tx.Rollback()
        return err
    }
    if _, err = tx.Exec("UPDATE accounts SET balance=balance+$1 WHERE id=$2", amt, to); err != nil {
        tx.Rollback()
        return err
    }
    return tx.Commit()
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

// TransferBalance — O(1) time, O(1) space
func TransferBalance(db *sql.DB, fromID, toID int, amount float64) error {
    if amount <= 0 {
        return fmt.Errorf("amount must be positive, got %f", amount)
    }
    if fromID == toID {
        return fmt.Errorf("fromID and toID must differ")
    }

    tx, err := db.Begin()
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback() // no-op if Commit succeeds

    res, err := tx.Exec(
        `UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1`,
        amount, fromID,
    )
    if err != nil {
        return fmt.Errorf("debit: %w", err)
    }
    if n, _ := res.RowsAffected(); n == 0 {
        return fmt.Errorf("insufficient funds or account %d not found", fromID)
    }

    if _, err = tx.Exec(
        `UPDATE accounts SET balance = balance + $1 WHERE id = $2`,
        amount, toID,
    ); err != nil {
        return fmt.Errorf("credit: %w", err)
    }

    return tx.Commit()
}

func main() {
    fmt.Println("TransferBalance defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Use FOR UPDATE to lock rows; prevents double-spend |
| Edge Cases | fromID == toID, amount == 0, negative balance via race |
| Error Handling | defer tx.Rollback is safe after Commit (no-op) |
| Memory | Transaction context held until Commit/Rollback |
| Concurrency | SELECT FOR UPDATE serializes concurrent transfers on same account |

### Visual Explanation
```mermaid
flowchart TD
    A["db.Begin()"] --> B["UPDATE debit (balance >= amount)"]
    B --> C{RowsAffected==1?}
    C -- no --> D["return insufficient funds"]
    C -- yes --> E["UPDATE credit"]
    E --> F{err?}
    F -- yes --> G["tx.Rollback (via defer)"]
    F -- no --> H["tx.Commit()"]
    H --> I["return nil"]
```
```
Trace: Begin → debit 100 from acc1 → credit 100 to acc2 → Commit
```

### Interviewer Questions
1. Why this approach? Atomicity ensures no partial state.
2. Can it be optimized? Use SELECT FOR UPDATE to avoid phantom reads.
3. Scale to 10M? Saga pattern for distributed transactions.
4. Edge cases? Deadlock if two concurrent reverse transfers; use ordered locks.
5. Goroutine-safe? tx is not safe for concurrent goroutines.
6. Memory impact? Transaction held open until Commit; avoid long transactions.
7. Alternative? Optimistic locking with version column and retry.

### Follow-Up Questions
**Q1:** Why defer tx.Rollback? **A1:** Automatic cleanup on any return path; Commit makes it a no-op.
**Q2:** What isolation level does Begin use? **A2:** READ COMMITTED by default in PostgreSQL.
**Q3:** How to use a higher isolation level? **A3:** db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable}).
**Q4:** Can two transactions deadlock? **A4:** Yes if they lock rows in reverse order; use consistent ordering.
**Q5:** What is a distributed transaction? **A5:** Spans multiple databases; needs 2-phase commit or saga pattern.

---

---
## Q7: Defer tx.Rollback Pattern  [Level 2 — Easy]
> **Tags:** `#defer` `#rollback` `#pattern` `#transaction`

### Problem Statement
Demonstrate the idiomatic Go pattern of `defer tx.Rollback()` in a multi-step transaction. Write `CreateOrderWithItems` that inserts into `orders` and `order_items` tables. Show why deferring Rollback is safe even after Commit succeeds.

### Input / Output / Constraints
```
Input:  db *sql.DB, order Order, items []OrderItem
Output: orderID int64, error
Constraints: defer tx.Rollback, return orderID from RETURNING, all-or-nothing
```

### Thought Process
1. Understand: After tx.Commit, calling tx.Rollback returns ErrTxDone — harmless.
2. Pattern: Begin → defer Rollback → work → Commit → Rollback is no-op.
3. Edge cases: items slice empty, FK violation on order_items.

### Brute Force
```go
// O(n) time, O(1) space — manual rollback, error-prone
func bruteForce(db *sql.DB, o Order, items []OrderItem) (int64, error) {
    tx, err := db.Begin()
    if err != nil {
        return 0, err
    }
    var oid int64
    if err = tx.QueryRow("INSERT INTO orders(user_id) VALUES($1) RETURNING id", o.UserID).Scan(&oid); err != nil {
        tx.Rollback()
        return 0, err
    }
    for _, item := range items {
        if _, err = tx.Exec("INSERT INTO order_items(order_id,product_id,qty) VALUES($1,$2,$3)", oid, item.ProductID, item.Qty); err != nil {
            tx.Rollback()
            return 0, err
        }
    }
    return oid, tx.Commit()
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
// defer Rollback pattern — cleaner
func better(db *sql.DB, o Order, items []OrderItem) (int64, error) {
    tx, err := db.Begin()
    if err != nil {
        return 0, err
    }
    defer tx.Rollback() // safe: no-op after Commit
    var oid int64
    if err = tx.QueryRow("INSERT INTO orders(user_id) VALUES($1) RETURNING id", o.UserID).Scan(&oid); err != nil {
        return 0, err
    }
    for _, item := range items {
        if _, err = tx.Exec("INSERT INTO order_items(order_id,product_id,qty) VALUES($1,$2,$3)", oid, item.ProductID, item.Qty); err != nil {
            return 0, err
        }
    }
    return oid, tx.Commit()
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

type Order struct{ UserID int }
type OrderItem struct{ ProductID, Qty int }

// CreateOrderWithItems — O(n) time, O(1) space
func CreateOrderWithItems(db *sql.DB, o Order, items []OrderItem) (int64, error) {
    if len(items) == 0 {
        return 0, fmt.Errorf("order must have at least one item")
    }

    tx, err := db.Begin()
    if err != nil {
        return 0, fmt.Errorf("begin: %w", err)
    }
    defer tx.Rollback() // no-op after successful Commit

    var orderID int64
    err = tx.QueryRow(
        `INSERT INTO orders(user_id, created_at) VALUES($1, NOW()) RETURNING id`,
        o.UserID,
    ).Scan(&orderID)
    if err != nil {
        return 0, fmt.Errorf("insert order: %w", err)
    }

    stmt, err := tx.Prepare(
        `INSERT INTO order_items(order_id, product_id, qty) VALUES($1, $2, $3)`,
    )
    if err != nil {
        return 0, fmt.Errorf("prepare items stmt: %w", err)
    }
    defer stmt.Close()

    for i, item := range items {
        if _, err := stmt.Exec(orderID, item.ProductID, item.Qty); err != nil {
            return 0, fmt.Errorf("insert item[%d]: %w", i, err)
        }
    }

    if err := tx.Commit(); err != nil {
        return 0, fmt.Errorf("commit: %w", err)
    }
    return orderID, nil
}

func main() {
    fmt.Println("CreateOrderWithItems defined")
}
```
**Time:** O(n) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Use batch insert for items instead of prepared loop |
| Edge Cases | FK violation if user_id or product_id doesn't exist |
| Error Handling | defer Rollback eliminates every manual rollback call |
| Memory | Transaction open for duration; keep it short |
| Concurrency | tx is single-goroutine; pass context for timeout |

### Visual Explanation
```mermaid
flowchart TD
    A["db.Begin()"] --> B["defer tx.Rollback()"]
    B --> C["INSERT order RETURNING id"]
    C --> D["tx.Prepare(insert item)"]
    D --> E["for each item: stmt.Exec"]
    E --> F{all ok?}
    F -- yes --> G["tx.Commit()"]
    G --> H["defer Rollback = no-op"]
    F -- no --> I["return error → defer Rollback fires"]
```
```
Trace: Begin → defer → INSERT order 99 → INSERT 3 items → Commit → Rollback(no-op)
```

### Interviewer Questions
1. Why defer Rollback? Eliminates duplicate rollback calls on every error path.
2. Can it be optimized? Batch item inserts into single multi-row VALUES.
3. Scale to 10M? Event-sourced order creation with async projection.
4. Edge cases? Empty items, FK violations, duplicate order submission.
5. Goroutine-safe? tx must not be shared across goroutines.
6. Memory impact? Transaction log held on DB side; avoid large transactions.
7. Alternative? Outbox pattern for distributed reliability.

### Follow-Up Questions
**Q1:** What does Rollback return after Commit? **A1:** sql.ErrTxDone — safely ignored.
**Q2:** Should you check the defer Rollback error? **A2:** Only if you need to log rollback failures; usually safe to ignore.
**Q3:** Can you use tx.Prepare inside a transaction? **A3:** Yes; the stmt is scoped to that transaction.
**Q4:** What if Commit fails? **A4:** Defer Rollback fires and undoes all changes.
**Q5:** How to set a tx timeout? **A5:** Use db.BeginTx(ctx, nil) with a context.WithTimeout.

---

---
## Q8: Connection Pool Configuration  [Level 2 — Easy]
> **Tags:** `#connection-pool` `#setmaxopenconns` `#setmaxidleconns` `#performance`

### Problem Statement
Write a function `ConfigurePool` that takes a `*sql.DB` and sets appropriate connection pool parameters: `SetMaxOpenConns`, `SetMaxIdleConns`, and `SetConnMaxLifetime`. Explain when each matters and what the tradeoffs are.

### Input / Output / Constraints
```
Input:  db *sql.DB, maxOpen, maxIdle int, lifetime time.Duration
Output: configured *sql.DB
Constraints: maxIdle <= maxOpen, lifetime > 0, document why each value matters
```

### Thought Process
1. Understand: Pool manages reuse of TCP connections to DB server.
2. Pattern: Set limits before serving traffic; tune based on DB server max_connections.
3. Edge cases: maxOpen=0 means unlimited (dangerous), maxIdle=0 means no reuse.

### Brute Force
```go
// O(1) time, O(1) space — no validation
func bruteForce(db *sql.DB) {
    db.SetMaxOpenConns(25)
    db.SetMaxIdleConns(25)
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(db *sql.DB, maxOpen, maxIdle int, lifetime time.Duration) {
    db.SetMaxOpenConns(maxOpen)
    db.SetMaxIdleConns(maxIdle)
    db.SetConnMaxLifetime(lifetime)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
    "time"
)

// ConfigurePool — O(1) time, O(1) space
func ConfigurePool(db *sql.DB, maxOpen, maxIdle int, lifetime time.Duration) error {
    if maxOpen <= 0 {
        return fmt.Errorf("maxOpen must be > 0, got %d", maxOpen)
    }
    if maxIdle < 0 {
        return fmt.Errorf("maxIdle must be >= 0, got %d", maxIdle)
    }
    if maxIdle > maxOpen {
        maxIdle = maxOpen // idle can't exceed open
    }
    if lifetime <= 0 {
        return fmt.Errorf("lifetime must be > 0")
    }

    db.SetMaxOpenConns(maxOpen)       // max simultaneous connections
    db.SetMaxIdleConns(maxIdle)       // connections kept ready in pool
    db.SetConnMaxLifetime(lifetime)   // recycle old connections (avoids stale)
    db.SetConnMaxIdleTime(5 * time.Minute) // close idle conns sooner

    return nil
}

func main() {
    fmt.Println("ConfigurePool defined")
    // Typical web service: 25 open, 10 idle, 5min lifetime
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | maxOpen x num_instances must not exceed DB max_connections |
| Edge Cases | maxOpen=0 unlimited; can exhaust DB; always set it |
| Error Handling | db.Stats() exposes WaitCount for tuning |
| Memory | Each idle conn holds a TCP socket; don't set maxIdle too high |
| Concurrency | Pool handles concurrency; tune based on p99 latency and load tests |

### Visual Explanation
```mermaid
flowchart TD
    A["Request arrives"] --> B{Idle conn available?}
    B -- yes --> C["Reuse idle conn"]
    B -- no --> D{Open < MaxOpen?}
    D -- yes --> E["Open new conn"]
    D -- no --> F["Wait in queue"]
    C & E --> G["Execute query"]
    G --> H["Return to idle pool"]
    H --> I{Idle > MaxIdle?}
    I -- yes --> J["Close conn"]
    I -- no --> K["Keep in pool"]
```
```
Trace: maxOpen=25, maxIdle=10, lifetime=5m → pool recycles after 5 minutes
```

### Interviewer Questions
1. Why configure pool? Default unlimited open conns can overwhelm DB.
2. Can it be optimized? Instrument db.Stats and auto-tune based on WaitCount.
3. Scale to 10M? PgBouncer in front reduces DB connection count further.
4. Edge cases? AWS RDS has max_connections based on instance RAM.
5. Goroutine-safe? Pool operations are fully goroutine-safe.
6. Memory impact? Each idle conn = ~TCP socket + buffers (~4KB each).
7. Alternative? pgx pool has finer-grained health checks and metrics.

### Follow-Up Questions
**Q1:** What is SetConnMaxLifetime? **A1:** Maximum time a conn can be reused; forces reconnect to avoid stale conns.
**Q2:** What is SetConnMaxIdleTime? **A2:** Max time a conn stays idle before being closed; saves server resources.
**Q3:** How do you monitor pool health? **A3:** db.Stats() returns OpenConnections, InUse, Idle, WaitCount.
**Q4:** What is a good maxOpen for a web service? **A4:** Typically 10–25 per instance; test with load testing.
**Q5:** What happens when all conns are busy? **A5:** Query blocks until a conn is available or context times out.

---

---
## Q9: QueryContext with Timeout  [Level 3 — Medium]
> **Tags:** `#context` `#querycontext` `#timeout` `#cancellation`

### Problem Statement
Write a function `GetUserWithTimeout` that wraps `GetUserByID` but adds a 2-second timeout using `context.WithTimeout`. Demonstrate passing a context through the call stack and handling `context.DeadlineExceeded`.

### Input / Output / Constraints
```
Input:  db *sql.DB, userID int
Output: User or error (with context error on timeout)
Constraints: Use context.WithTimeout(2s), defer cancel, use QueryRowContext
```

### Thought Process
1. Understand: DB queries can hang; context enforces a deadline.
2. Pattern: WithTimeout → defer cancel → QueryRowContext(ctx).
3. Edge cases: Slow DB, network partition, user exists but query times out.

### Brute Force
```go
// O(1) time, O(1) space — fixed 2s timeout
func bruteForce(db *sql.DB, id int) (User, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    var u User
    err := db.QueryRowContext(ctx, "SELECT id,name,email FROM users WHERE id=$1", id).Scan(&u.ID, &u.Name, &u.Email)
    return u, err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, db *sql.DB, id int) (User, error) {
    tctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()
    var u User
    err := db.QueryRowContext(tctx,
        "SELECT id, name, email FROM users WHERE id=$1", id,
    ).Scan(&u.ID, &u.Name, &u.Email)
    if errors.Is(err, context.DeadlineExceeded) {
        return User{}, fmt.Errorf("GetUser timed out: %w", err)
    }
    return u, err
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "time"
)

// GetUserWithTimeout — O(1) time, O(1) space
func GetUserWithTimeout(ctx context.Context, db *sql.DB, userID int) (User, error) {
    tctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()

    const q = `SELECT id, name, email FROM users WHERE id = $1`
    var u User
    err := db.QueryRowContext(tctx, q, userID).Scan(&u.ID, &u.Name, &u.Email)
    switch {
    case errors.Is(err, context.DeadlineExceeded):
        return User{}, fmt.Errorf("GetUserWithTimeout: query timed out after 2s: %w", err)
    case errors.Is(err, context.Canceled):
        return User{}, fmt.Errorf("GetUserWithTimeout: request canceled: %w", err)
    case errors.Is(err, sql.ErrNoRows):
        return User{}, fmt.Errorf("user %d not found: %w", userID, sql.ErrNoRows)
    case err != nil:
        return User{}, fmt.Errorf("GetUserWithTimeout: %w", err)
    }
    return u, nil
}

func main() {
    fmt.Println("GetUserWithTimeout defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Always pass context from HTTP handler to DB call |
| Edge Cases | Context already expired before query starts; check ctx.Err() first |
| Error Handling | Distinguish DeadlineExceeded vs Canceled for observability |
| Memory | context carries deadline; negligible overhead |
| Concurrency | QueryRowContext cancels the in-flight query on timeout |

### Visual Explanation
```mermaid
flowchart TD
    A["HTTP Request ctx"] --> B["context.WithTimeout(ctx, 2s)"]
    B --> C["defer cancel()"]
    C --> D["db.QueryRowContext(tctx, q, id)"]
    D --> E{Response within 2s?}
    E -- yes --> F["Scan → return User"]
    E -- no --> G["context.DeadlineExceeded"]
    G --> H["return timeout error"]
```
```
Trace: ctx+2s → QueryRowContext → DB slow → DeadlineExceeded after 2s
```

### Interviewer Questions
1. Why use context? Prevents goroutine leak from hanging DB calls.
2. Can it be optimized? Use per-request context from HTTP server; no extra timeout needed.
3. Scale to 10M? Circuit breaker (gobreaker) on top of context timeout.
4. Edge cases? Parent context already cancelled before this function called.
5. Goroutine-safe? Yes; context.WithTimeout creates a new safe context.
6. Memory impact? One goroutine per WithTimeout timer; cancel releases it.
7. Alternative? pgx supports context natively with better cancellation.

### Follow-Up Questions
**Q1:** What happens to the DB query when context is cancelled? **A1:** Driver sends a cancellation to the DB server; query is aborted.
**Q2:** Why defer cancel()? **A2:** Releases timer resources even if query finishes before deadline.
**Q3:** What if parent context already has a shorter timeout? **A3:** child context adopts the earlier deadline; WithTimeout is min(parent, 2s).
**Q4:** How to propagate context in a service? **A4:** Accept ctx as first parameter in every function in the call chain.
**Q5:** How to test timeout behavior? **A5:** Use sqlmock with delay, or inject a context already past deadline.

---

---
## Q10: sql.ErrNoRows Handling  [Level 3 — Medium]
> **Tags:** `#errnorows` `#sentinel-error` `#errors.Is` `#not-found`

### Problem Statement
Write a `UserRepository` with `FindByEmail` that returns a custom `ErrNotFound` error when the user doesn't exist, wrapping `sql.ErrNoRows`. Show how callers use `errors.Is` to distinguish "not found" from other DB errors. Demonstrate proper error sentinel definition.

### Input / Output / Constraints
```
Input:  email string
Output: *User or ErrNotFound or other error
Constraints: Define var ErrNotFound, wrap sql.ErrNoRows, callers use errors.Is
```

### Thought Process
1. Understand: sql.ErrNoRows is a sentinel; wrap it in domain error for abstraction.
2. Pattern: QueryRow → Scan → wrap ErrNoRows → caller errors.Is(err, ErrNotFound).
3. Edge cases: Empty email, case-sensitive email match, multiple rows (impossible with UNIQUE).

### Brute Force
```go
// O(1) time, O(1) space — leaks sql.ErrNoRows to caller
func bruteForce(db *sql.DB, email string) (*User, error) {
    var u User
    err := db.QueryRow("SELECT id,name,email FROM users WHERE email=$1", email).
        Scan(&u.ID, &u.Name, &u.Email)
    return &u, err // caller must know about sql.ErrNoRows
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
var ErrNotFound = errors.New("not found")

func better(db *sql.DB, email string) (*User, error) {
    var u User
    err := db.QueryRow("SELECT id,name,email FROM users WHERE email=$1", email).
        Scan(&u.ID, &u.Name, &u.Email)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, ErrNotFound
    }
    if err != nil {
        return nil, err
    }
    return &u, nil
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

type UserRepository struct {
    db *sql.DB
}

// FindByEmail — O(1) time, O(1) space
func (r *UserRepository) FindByEmail(email string) (*User, error) {
    if email == "" {
        return nil, fmt.Errorf("FindByEmail: email cannot be empty")
    }
    const q = `SELECT id, name, email FROM users WHERE email = $1`
    var u User
    err := r.db.QueryRow(q, email).Scan(&u.ID, &u.Name, &u.Email)
    switch {
    case errors.Is(err, sql.ErrNoRows):
        return nil, fmt.Errorf("user with email %q: %w", email, ErrNotFound)
    case err != nil:
        return nil, fmt.Errorf("FindByEmail query: %w", err)
    }
    return &u, nil
}

func main() {
    // Example caller usage:
    // u, err := repo.FindByEmail("a@b.com")
    // if errors.Is(err, ErrNotFound) { ... }
    fmt.Println("UserRepository.FindByEmail defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Index on email column is critical for this query |
| Edge Cases | Case-insensitive match: use LOWER(email) or citext extension |
| Error Handling | Wrapping preserves the chain for errors.Is/As traversal |
| Memory | Single struct allocated on heap; pointer returned |
| Concurrency | Repository is goroutine-safe if db is |

### Visual Explanation
```mermaid
flowchart TD
    A["FindByEmail(email)"] --> B["QueryRow WHERE email=$1"]
    B --> C["Scan into User"]
    C --> D{err?}
    D -- ErrNoRows --> E["fmt.Errorf wrap ErrNotFound"]
    D -- other --> F["fmt.Errorf wrap err"]
    D -- nil --> G["return *User"]
    E --> H["caller: errors.Is(err, ErrNotFound)"]
```
```
Trace: email="x@y.com" → no row → ErrNoRows → wrap ErrNotFound → caller handles
```

### Interviewer Questions
1. Why wrap ErrNoRows? Repository abstraction hides DB-specific errors.
2. Can it be optimized? Cache hot user lookups in Redis.
3. Scale to 10M? Read replica for FindByEmail; write to primary only.
4. Edge cases? Empty email, email with spaces, very long email.
5. Goroutine-safe? Yes, *sql.DB is safe.
6. Memory impact? Single allocation per call; fine.
7. Alternative? Return (User, bool, error) tuple; bool signals found/not-found.

### Follow-Up Questions
**Q1:** Why not return sql.ErrNoRows directly? **A1:** Leaks DB layer to domain logic; breaks if you switch DB drivers.
**Q2:** How does errors.Is work with wrapped errors? **A2:** It unwraps the error chain until it finds a match.
**Q3:** When to use errors.As vs errors.Is? **A3:** errors.As when you need the value (e.g. *pq.Error); Is for sentinel check.
**Q4:** Should ErrNotFound be exported? **A4:** Yes, so callers in other packages can use errors.Is(err, repo.ErrNotFound).
**Q5:** How to add a user-friendly message? **A5:** Use fmt.Errorf with context but wrap the sentinel with %w.

---

---
## Q11: Batch Insert  [Level 3 — Medium]
> **Tags:** `#batch-insert` `#performance` `#multi-row` `#copy`

### Problem Statement
Write `BatchInsertUsers` that inserts a slice of users efficiently. Compare three approaches: naive loop, multi-row VALUES construction with `lib/pq.Array`, and PostgreSQL COPY protocol via `pq.CopyIn`. Measure the tradeoffs.

### Input / Output / Constraints
```
Input:  db *sql.DB, users []User (up to 10,000)
Output: error
Constraints: Single round trip preferred, handle partial failure, max 10K rows
```

### Thought Process
1. Understand: INSERT loop = N round trips; multi-row VALUES = 1 round trip; COPY = fastest bulk loader.
2. Pattern: Build parameterized multi-row INSERT or use pq.CopyIn.
3. Edge cases: Empty slice, exceeds parameter limit (65535 in pq), UNIQUE violations.

### Brute Force
```go
// O(n) time, O(1) space — N round trips
func bruteForce(db *sql.DB, users []User) error {
    for _, u := range users {
        if _, err := db.Exec("INSERT INTO users(name,email) VALUES($1,$2)", u.Name, u.Email); err != nil {
            return err
        }
    }
    return nil
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
// Multi-row VALUES — single round trip
func better(db *sql.DB, users []User) error {
    if len(users) == 0 {
        return nil
    }
    vals := make([]interface{}, 0, len(users)*2)
    placeholders := make([]string, 0, len(users))
    for i, u := range users {
        placeholders = append(placeholders, fmt.Sprintf("($%d,$%d)", i*2+1, i*2+2))
        vals = append(vals, u.Name, u.Email)
    }
    q := "INSERT INTO users(name,email) VALUES " + strings.Join(placeholders, ",")
    _, err := db.Exec(q, vals...)
    return err
}
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"

    "github.com/lib/pq"
)

// BatchInsertUsers via COPY — O(n) time, O(n) space
func BatchInsertUsers(db *sql.DB, users []User) error {
    if len(users) == 0 {
        return nil
    }
    tx, err := db.Begin()
    if err != nil {
        return fmt.Errorf("begin: %w", err)
    }
    defer tx.Rollback()

    stmt, err := tx.Prepare(pq.CopyIn("users", "name", "email"))
    if err != nil {
        return fmt.Errorf("prepare COPY: %w", err)
    }
    defer stmt.Close()

    for i, u := range users {
        if _, err := stmt.Exec(u.Name, u.Email); err != nil {
            return fmt.Errorf("COPY row[%d]: %w", i, err)
        }
    }
    // Flush the COPY buffer
    if _, err := stmt.Exec(); err != nil {
        return fmt.Errorf("COPY flush: %w", err)
    }
    return tx.Commit()
}

func main() {
    fmt.Println("BatchInsertUsers defined")
}
```
**Time:** O(n) | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | COPY is 10-100x faster than multi-row INSERT for large batches |
| Edge Cases | pq param limit is 65535; chunk batches > 32K rows |
| Error Handling | COPY aborts entire batch on first error; wrap in transaction |
| Memory | Buffer entire batch in memory before flushing |
| Concurrency | Each goroutine gets its own tx; don't share tx |

### Visual Explanation
```mermaid
flowchart TD
    A["BatchInsertUsers(users)"] --> B["tx.Begin()"]
    B --> C["tx.Prepare(pq.CopyIn)"]
    C --> D["for each user: stmt.Exec(name, email)"]
    D --> E["stmt.Exec() — flush buffer"]
    E --> F["tx.Commit()"]
    F --> G["return nil"]
```
```
Trace: 1000 users → 1 COPY stmt → stream rows → flush → Commit → 1 round trip
```

### Interviewer Questions
1. Why COPY over multi-row INSERT? COPY bypasses WAL for temp tables; far faster for bulk loads.
2. Can it be optimized? COPY FREEZE for initial load; UNLOGGED tables.
3. Scale to 10M? Stream from S3 via COPY FROM STDIN.
4. Edge cases? Unique constraint fails entire COPY; use staging table + INSERT ON CONFLICT.
5. Goroutine-safe? Each COPY in its own tx; safe.
6. Memory impact? Rows buffered until flush; chunk 1K rows at a time.
7. Alternative? pgx CopyFrom API is even cleaner.

### Follow-Up Questions
**Q1:** What is the pq parameter limit? **A1:** 65535 total parameters in one query.
**Q2:** How to handle UNIQUE violations in batch? **A2:** Use INSERT ON CONFLICT DO NOTHING or staging table + deduplicate.
**Q3:** Is COPY transactional? **A3:** Yes, when wrapped in a transaction; rolled back on error.
**Q4:** How to batch very large datasets? **A4:** Chunk into 1000-row batches and insert in a loop.
**Q5:** What is COPY FREEZE? **A5:** Skips WAL for initial table loads; faster but not safe for concurrent use.

---

---
## Q12: Upsert ON CONFLICT  [Level 3 — Medium]
> **Tags:** `#upsert` `#on-conflict` `#idempotent` `#postgres`

### Problem Statement
Write `UpsertUser` that inserts a user or updates `name` and `updated_at` if a row with the same `email` already exists, using PostgreSQL `INSERT ... ON CONFLICT (email) DO UPDATE`. Return the resulting `id` in both cases.

### Input / Output / Constraints
```
Input:  db *sql.DB, name, email string
Output: id int64, error
Constraints: ON CONFLICT on email column, RETURNING id, idempotent operation
```

### Thought Process
1. Understand: Upsert avoids separate SELECT + INSERT logic; atomic and race-free.
2. Pattern: INSERT ... ON CONFLICT DO UPDATE ... RETURNING id.
3. Edge cases: Concurrent upserts on same email, EXCLUDED reference.

### Brute Force
```go
// O(1) time, O(1) space — two separate queries, not atomic
func bruteForce(db *sql.DB, name, email string) (int64, error) {
    var id int64
    err := db.QueryRow("SELECT id FROM users WHERE email=$1", email).Scan(&id)
    if err == sql.ErrNoRows {
        err = db.QueryRow("INSERT INTO users(name,email) VALUES($1,$2) RETURNING id", name, email).Scan(&id)
    }
    return id, err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(db *sql.DB, name, email string) (int64, error) {
    var id int64
    err := db.QueryRow(`
        INSERT INTO users(name, email, updated_at)
        VALUES($1, $2, NOW())
        ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name, updated_at = NOW()
        RETURNING id`,
        name, email,
    ).Scan(&id)
    return id, err
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

// UpsertUser — O(1) time, O(1) space
func UpsertUser(db *sql.DB, name, email string) (int64, error) {
    if name == "" || email == "" {
        return 0, fmt.Errorf("UpsertUser: name and email required")
    }
    const q = `
        INSERT INTO users(name, email, created_at, updated_at)
        VALUES($1, $2, NOW(), NOW())
        ON CONFLICT (email) DO UPDATE
            SET name       = EXCLUDED.name,
                updated_at = NOW()
        RETURNING id`

    var id int64
    if err := db.QueryRow(q, name, email).Scan(&id); err != nil {
        return 0, fmt.Errorf("UpsertUser: %w", err)
    }
    return id, nil
}

func main() {
    fmt.Println("UpsertUser defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Single atomic operation; no race between check and insert |
| Edge Cases | ON CONFLICT requires UNIQUE index on email |
| Error Handling | Other constraint violations still surface as errors |
| Memory | Single row operation |
| Concurrency | Atomic at DB level; safe for concurrent callers |

### Visual Explanation
```mermaid
flowchart TD
    A["UpsertUser(name, email)"] --> B["INSERT ... ON CONFLICT"]
    B --> C{email exists?}
    C -- no --> D["INSERT new row"]
    C -- yes --> E["UPDATE name, updated_at"]
    D & E --> F["RETURNING id"]
    F --> G["Scan &id"]
    G --> H["return id"]
```
```
Trace: email new → INSERT row id=5 → return 5
       email exists → UPDATE name → RETURNING existing id=5 → return 5
```

### Interviewer Questions
1. Why ON CONFLICT over separate SELECT+INSERT? Atomic; eliminates race condition.
2. Can it be optimized? Add partial index if conflict column has NULLs.
3. Scale to 10M? Batch upserts with ON CONFLICT in multi-row INSERT.
4. Edge cases? DO NOTHING vs DO UPDATE — choose based on business logic.
5. Goroutine-safe? Yes; atomicity guaranteed by DB.
6. Memory impact? Negligible.
7. Alternative? MySQL: INSERT ... ON DUPLICATE KEY UPDATE.

### Follow-Up Questions
**Q1:** What is EXCLUDED? **A1:** A virtual table holding the row that would have been inserted.
**Q2:** When to use DO NOTHING? **A2:** When re-insert of same data is acceptable and no update needed.
**Q3:** Can upsert return different columns for insert vs update? **A3:** No; RETURNING runs after either path; same columns.
**Q4:** Does ON CONFLICT require a constraint? **A4:** Yes; must reference an existing UNIQUE constraint or index.
**Q5:** How to upsert in bulk? **A5:** INSERT INTO ... (multi-row VALUES) ON CONFLICT DO UPDATE.

---

---
## Q13: Pagination — Cursor and Offset  [Level 3 — Medium]
> **Tags:** `#pagination` `#cursor` `#offset` `#limit` `#performance`

### Problem Statement
Implement two pagination strategies for `users` table: `PageByOffset(page, pageSize int)` using LIMIT/OFFSET, and `PageByCursor(lastID int64, pageSize int)` using cursor-based (keyset) pagination. Explain when each is appropriate.

### Input / Output / Constraints
```
Input:  page=2, pageSize=10 or lastID=50, pageSize=10
Output: []User, nextCursor int64
Constraints: ORDER BY id, return empty slice on last page, handle edge cases
```

### Thought Process
1. Understand: OFFSET scans skipped rows; cursor jumps directly to position.
2. Pattern: OFFSET = LIMIT n OFFSET m; cursor = WHERE id > lastID LIMIT n.
3. Edge cases: page=0, lastID=0 (first page), empty result.

### Brute Force
```go
// O(n) time (offset scans), O(n) space
func bruteForce(db *sql.DB, page, pageSize int) ([]User, error) {
    offset := (page - 1) * pageSize
    rows, _ := db.Query("SELECT id,name,email FROM users ORDER BY id LIMIT $1 OFFSET $2", pageSize, offset)
    defer rows.Close()
    var users []User
    for rows.Next() {
        var u User
        rows.Scan(&u.ID, &u.Name, &u.Email)
        users = append(users, u)
    }
    return users, rows.Err()
}
```
**Time:** O(n+offset) | **Space:** O(n)

### Better Solution
```go
// Cursor pagination — O(n) time, O(n) space, consistent at scale
func better(db *sql.DB, lastID int64, pageSize int) ([]User, int64, error) {
    rows, err := db.Query(
        "SELECT id,name,email FROM users WHERE id > $1 ORDER BY id LIMIT $2",
        lastID, pageSize,
    )
    if err != nil {
        return nil, 0, err
    }
    defer rows.Close()
    var users []User
    for rows.Next() {
        var u User
        rows.Scan(&u.ID, &u.Name, &u.Email)
        users = append(users, u)
    }
    var nextCursor int64
    if len(users) == pageSize {
        nextCursor = int64(users[len(users)-1].ID)
    }
    return users, nextCursor, rows.Err()
}
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

// PageByOffset — O(offset+n) time, O(n) space
func PageByOffset(db *sql.DB, page, pageSize int) ([]User, error) {
    if page < 1 {
        page = 1
    }
    if pageSize < 1 || pageSize > 100 {
        pageSize = 10
    }
    offset := (page - 1) * pageSize
    const q = `SELECT id, name, email FROM users ORDER BY id LIMIT $1 OFFSET $2`
    rows, err := db.Query(q, pageSize, offset)
    if err != nil {
        return nil, fmt.Errorf("PageByOffset: %w", err)
    }
    defer rows.Close()
    return scanUsers(rows)
}

// PageByCursor — O(n) time, O(n) space; consistent under concurrent inserts
func PageByCursor(db *sql.DB, lastID int64, pageSize int) (users []User, nextCursor int64, err error) {
    if pageSize < 1 || pageSize > 100 {
        pageSize = 10
    }
    const q = `SELECT id, name, email FROM users WHERE id > $1 ORDER BY id LIMIT $2`
    rows, err := db.Query(q, lastID, pageSize)
    if err != nil {
        return nil, 0, fmt.Errorf("PageByCursor: %w", err)
    }
    defer rows.Close()
    users, err = scanUsers(rows)
    if err != nil {
        return nil, 0, err
    }
    if len(users) == pageSize {
        nextCursor = int64(users[len(users)-1].ID)
    }
    return users, nextCursor, nil
}

func scanUsers(rows *sql.Rows) ([]User, error) {
    var users []User
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
            return nil, fmt.Errorf("scan: %w", err)
        }
        users = append(users, u)
    }
    return users, rows.Err()
}

func main() {
    fmt.Println("PageByOffset and PageByCursor defined")
}
```
**Time:** O(n) cursor / O(offset+n) offset | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Cursor is O(log n) with index; offset degrades at large pages |
| Edge Cases | New inserts shift offset pages; cursor is stable |
| Error Handling | Cap pageSize to prevent large result sets |
| Memory | Return slice sized to pageSize |
| Concurrency | Read-only queries; safe for concurrent use |

### Visual Explanation
```mermaid
flowchart TD
    A["OFFSET: page=3, size=10"] --> B["OFFSET 20 LIMIT 10"]
    B --> C["DB scans 30 rows, returns last 10"]

    D["CURSOR: lastID=50, size=10"] --> E["WHERE id > 50 LIMIT 10"]
    E --> F["DB seeks to id=51 directly via index"]
    F --> G["Returns rows 51-60, nextCursor=60"]
```
```
Trace: cursor lastID=0 → rows 1-10, nextCursor=10 → rows 11-20, nextCursor=20
```

### Interviewer Questions
1. Why cursor over offset? Stable results under inserts; O(log n) vs O(n) at large offsets.
2. Can it be optimized? Composite cursor for non-unique sort columns.
3. Scale to 10M? Cursor pagination is the only viable strategy.
4. Edge cases? Deleted rows cause cursor to skip nothing; offset shifts pages.
5. Goroutine-safe? Read queries are safe.
6. Memory impact? Return only pageSize rows per call.
7. Alternative? Relay-style pagination with opaque base64 encoded cursor.

### Follow-Up Questions
**Q1:** What is a keyset cursor? **A1:** Uses the last seen value of ORDER BY column(s) as the WHERE condition.
**Q2:** How to paginate with non-unique sort (created_at)? **A2:** Use composite cursor: WHERE (created_at, id) > ($1, $2).
**Q3:** Can OFFSET pagination miss rows? **A3:** Yes, if rows are inserted or deleted between pages.
**Q4:** How to return total count with offset pagination? **A4:** Add COUNT(*) OVER() window function or a separate COUNT query.
**Q5:** What is seek method? **A5:** Another name for keyset/cursor pagination.

---

---
## Q14: Aggregate Queries  [Level 3 — Medium]
> **Tags:** `#aggregate` `#count` `#group-by` `#sum` `#avg`

### Problem Statement
Write `GetOrderStats` that returns per-user order statistics: count of orders, total amount, and average amount. Use GROUP BY, COUNT, SUM, and AVG. Return results as a slice of `UserOrderStats` structs.

### Input / Output / Constraints
```
Input:  db *sql.DB
Output: []UserOrderStats{UserID, Name, OrderCount, TotalAmount, AvgAmount}
Constraints: JOIN users and orders tables, handle users with zero orders via LEFT JOIN
```

### Thought Process
1. Understand: Aggregate functions collapse multiple rows per group.
2. Pattern: LEFT JOIN → GROUP BY user_id → SELECT COUNT/SUM/AVG → COALESCE for NULLs.
3. Edge cases: Users with no orders (NULL from LEFT JOIN), NULL amounts.

### Brute Force
```go
// O(n*m) time — queries orders per user in a loop (N+1 problem)
func bruteForce(db *sql.DB, users []User) ([]UserOrderStats, error) {
    var stats []UserOrderStats
    for _, u := range users {
        var s UserOrderStats
        s.UserID = u.ID
        db.QueryRow("SELECT COUNT(*), COALESCE(SUM(amount),0) FROM orders WHERE user_id=$1", u.ID).
            Scan(&s.OrderCount, &s.TotalAmount)
        stats = append(stats, s)
    }
    return stats, nil
}
```
**Time:** O(n*m) N+1 queries | **Space:** O(n)

### Better Solution
```go
// Single JOIN query
func better(db *sql.DB) ([]UserOrderStats, error) {
    const q = `
        SELECT u.id, u.name, COUNT(o.id), COALESCE(SUM(o.amount),0), COALESCE(AVG(o.amount),0)
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id, u.name
        ORDER BY u.id`
    rows, _ := db.Query(q)
    defer rows.Close()
    var stats []UserOrderStats
    for rows.Next() {
        var s UserOrderStats
        rows.Scan(&s.UserID, &s.Name, &s.OrderCount, &s.TotalAmount, &s.AvgAmount)
        stats = append(stats, s)
    }
    return stats, rows.Err()
}
```
**Time:** O(n log n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

type UserOrderStats struct {
    UserID      int
    Name        string
    OrderCount  int
    TotalAmount float64
    AvgAmount   float64
}

// GetOrderStats — O(n log n) time, O(n) space
func GetOrderStats(db *sql.DB) ([]UserOrderStats, error) {
    const q = `
        SELECT
            u.id,
            u.name,
            COUNT(o.id)                   AS order_count,
            COALESCE(SUM(o.amount), 0)    AS total_amount,
            COALESCE(AVG(o.amount), 0)    AS avg_amount
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id, u.name
        ORDER BY u.id`

    rows, err := db.Query(q)
    if err != nil {
        return nil, fmt.Errorf("GetOrderStats query: %w", err)
    }
    defer rows.Close()

    var stats []UserOrderStats
    for rows.Next() {
        var s UserOrderStats
        if err := rows.Scan(&s.UserID, &s.Name, &s.OrderCount, &s.TotalAmount, &s.AvgAmount); err != nil {
            return nil, fmt.Errorf("GetOrderStats scan: %w", err)
        }
        stats = append(stats, s)
    }
    return stats, rows.Err()
}

func main() {
    fmt.Println("GetOrderStats defined")
}
```
**Time:** O(n log n) | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Index on orders.user_id is critical |
| Edge Cases | COALESCE prevents NULL scan errors for users with no orders |
| Error Handling | rows.Err checked after loop for streaming errors |
| Memory | All results in memory; paginate for large user tables |
| Concurrency | Read-only; safe on read replica |

### Visual Explanation
```mermaid
flowchart TD
    A["users LEFT JOIN orders"] --> B["GROUP BY u.id, u.name"]
    B --> C["COUNT(o.id)"]
    B --> D["SUM(o.amount)"]
    B --> E["AVG(o.amount)"]
    C & D & E --> F["COALESCE nulls → 0"]
    F --> G["ORDER BY u.id"]
    G --> H["Scan into []UserOrderStats"]
```
```
Trace: user 1 has 3 orders → COUNT=3, SUM=300, AVG=100
       user 2 has 0 orders → COUNT=0, SUM=0 (COALESCE), AVG=0
```

### Interviewer Questions
1. Why LEFT JOIN? Includes users with zero orders; INNER JOIN would exclude them.
2. Can it be optimized? Materialized view for expensive aggregates refreshed periodically.
3. Scale to 10M? Pre-aggregate in nightly batch job; serve from summary table.
4. Edge cases? NULL amounts need COALESCE; deleted orders need soft-delete filter.
5. Goroutine-safe? Yes; read-only query.
6. Memory impact? Load all stats in memory; paginate if user count is large.
7. Alternative? Time-series DB (TimescaleDB) for heavy aggregation workloads.

### Follow-Up Questions
**Q1:** What is the difference between COUNT(*) and COUNT(o.id)? **A1:** COUNT(*) counts all rows; COUNT(o.id) skips NULL values (users with no orders).
**Q2:** Why COALESCE for SUM? **A2:** SUM returns NULL when there are no rows; COALESCE converts to 0.
**Q3:** How to add HAVING clause? **A3:** After GROUP BY: HAVING COUNT(o.id) > 5.
**Q4:** When to use a window function vs GROUP BY? **A4:** Window functions compute aggregate without collapsing rows.
**Q5:** How to get running total? **A5:** SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at).

---

---
## Q15: In-Memory SQLite Test  [Level 4 — Advanced]
> **Tags:** `#testing` `#sqlite` `#in-memory` `#testdb` `#unit-test`

### Problem Statement
Write a test helper `NewTestDB` that creates an in-memory SQLite database, runs migrations to create a `users` table, and returns a `*sql.DB` for use in unit tests. Write a table-driven test for `GetUserByID` using this helper.

### Input / Output / Constraints
```
Input:  t *testing.T
Output: *sql.DB (in-memory SQLite), auto-cleanup via t.Cleanup
Constraints: Use mattn/go-sqlite3, no real DB needed, table-driven tests
```

### Thought Process
1. Understand: SQLite in-memory DB isolates tests from network; fast and repeatable.
2. Pattern: sql.Open(":memory:") → CREATE TABLE → seed → test → cleanup.
3. Edge cases: SQLite uses $1 placeholders? No — uses ? placeholders.

### Brute Force
```go
// O(1) time, O(1) space — no cleanup
func bruteForce(t *testing.T) *sql.DB {
    db, _ := sql.Open("sqlite3", ":memory:")
    db.Exec("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT)")
    return db
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("open sqlite: %v", err)
    }
    t.Cleanup(func() { db.Close() })
    _, err = db.Exec(`CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE)`)
    if err != nil {
        t.Fatalf("migrate: %v", err)
    }
    return db
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main_test

import (
    "database/sql"
    "errors"
    "testing"

    _ "github.com/mattn/go-sqlite3"
)

// NewTestDB — O(1) time, O(1) space
func NewTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("NewTestDB open: %v", err)
    }
    t.Cleanup(func() { db.Close() })

    const schema = `
        CREATE TABLE IF NOT EXISTS users (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT    NOT NULL,
            email TEXT    NOT NULL UNIQUE
        )`
    if _, err := db.Exec(schema); err != nil {
        t.Fatalf("NewTestDB schema: %v", err)
    }
    return db
}

func TestGetUserByID(t *testing.T) {
    db := NewTestDB(t)

    // Seed: SQLite uses ? not $1
    res, err := db.Exec(`INSERT INTO users(name, email) VALUES(?, ?)`, "Alice", "alice@example.com")
    if err != nil {
        t.Fatalf("seed: %v", err)
    }
    id, _ := res.LastInsertId()

    tests := []struct {
        name    string
        id      int
        wantErr bool
        wantName string
    }{
        {"found", int(id), false, "Alice"},
        {"not found", 9999, true, ""},
        {"invalid id", 0, true, ""},
    }

    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            // Adapted GetUserByID using ? placeholder for SQLite
            var u User
            err := db.QueryRow(`SELECT id, name, email FROM users WHERE id = ?`, tc.id).
                Scan(&u.ID, &u.Name, &u.Email)
            if tc.wantErr {
                if err == nil {
                    t.Errorf("expected error, got nil")
                }
                return
            }
            if err != nil {
                t.Fatalf("unexpected error: %v", err)
            }
            if u.Name != tc.wantName {
                t.Errorf("got name %q, want %q", u.Name, tc.wantName)
            }
        })
    }
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | In-memory tests run in microseconds; no network dependency |
| Edge Cases | SQLite uses ? not $1; abstract placeholder behind query builder |
| Error Handling | t.Fatalf stops test immediately on setup failure |
| Memory | In-memory DB lives only for test duration |
| Concurrency | Use separate DB per test for parallel safety |

### Visual Explanation
```mermaid
flowchart TD
    A["TestGetUserByID"] --> B["NewTestDB(t)"]
    B --> C["sql.Open sqlite3 :memory:"]
    C --> D["CREATE TABLE users"]
    D --> E["t.Cleanup(db.Close)"]
    E --> F["Seed: INSERT Alice"]
    F --> G["Table-driven test loop"]
    G --> H["QueryRow by id"]
    H --> I{found?}
    I -- yes --> J["assert name == Alice"]
    I -- no --> K["assert error returned"]
```
```
Trace: Open :memory: → CREATE TABLE → INSERT → test found → test not-found → Cleanup
```

### Interviewer Questions
1. Why SQLite in-memory? No external dependency; fast; isolated per test.
2. Can it be optimized? testcontainers-go for exact PostgreSQL behavior.
3. Scale to 10M? Not applicable to unit tests; use integration test environment.
4. Edge cases? SQLite diverges from PostgreSQL in type system and some functions.
5. Goroutine-safe? Use separate DB per parallel test.
6. Memory impact? Each :memory: DB is ~1MB; fine for tests.
7. Alternative? sqlmock for pure interface mocking without a DB.

### Follow-Up Questions
**Q1:** What is t.Cleanup? **A1:** Registers a cleanup function run when the test ends; like defer but scoped to test.
**Q2:** Why t.Helper()? **A2:** Marks the function as a helper so test failures report the caller's line.
**Q3:** How to run tests in parallel with shared DB? **A3:** Use t.Parallel() and give each test its own in-memory DB.
**Q4:** What is testcontainers-go? **A4:** Spins up a real Docker PostgreSQL container for integration tests.
**Q5:** How to abstract ? vs $1 placeholders? **A5:** Use squirrel query builder with PlaceholderFormat(squirrel.Dollar).

---

---
## Q16: Repository Pattern  [Level 4 — Advanced]
> **Tags:** `#repository-pattern` `#interface` `#dependency-injection` `#testability`

### Problem Statement
Implement a `UserRepository` interface with `Create`, `FindByID`, `Update`, and `Delete` methods. Provide a `postgresUserRepo` concrete implementation using `*sql.DB`. Write a mock implementation for testing. Show how dependency injection improves testability.

### Input / Output / Constraints
```
Input:  UserRepository interface, *sql.DB
Output: Concrete impl + mock impl
Constraints: Interface in domain package, impl in infra package, injectable
```

### Thought Process
1. Understand: Repository pattern decouples domain from persistence technology.
2. Pattern: Define interface → inject into service → swap impl for tests.
3. Edge cases: Mock must match interface exactly; nil db in impl.

### Brute Force
```go
// Direct db coupling — hard to test
type UserService struct { db *sql.DB }
func (s *UserService) GetUser(id int) (User, error) {
    // directly uses s.db
    return GetUserByID(s.db, id)
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
type UserRepository interface {
    FindByID(id int) (User, error)
    Create(u User) (int64, error)
}
type postgresRepo struct{ db *sql.DB }
func NewUserRepo(db *sql.DB) UserRepository { return &postgresRepo{db: db} }
func (r *postgresRepo) FindByID(id int) (User, error) { return GetUserByID(r.db, id) }
func (r *postgresRepo) Create(u User) (int64, error)  { return CreateUser(r.db, u.Name, u.Email) }
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
)

// UserRepository — domain interface
type UserRepository interface {
    Create(ctx context.Context, u User) (int64, error)
    FindByID(ctx context.Context, id int) (User, error)
    Update(ctx context.Context, u User) error
    Delete(ctx context.Context, id int) error
}

// postgresUserRepo — infrastructure implementation
type postgresUserRepo struct{ db *sql.DB }

func NewUserRepository(db *sql.DB) UserRepository {
    return &postgresUserRepo{db: db}
}

func (r *postgresUserRepo) Create(ctx context.Context, u User) (int64, error) {
    var id int64
    err := r.db.QueryRowContext(ctx,
        `INSERT INTO users(name, email) VALUES($1, $2) RETURNING id`,
        u.Name, u.Email,
    ).Scan(&id)
    return id, err
}

func (r *postgresUserRepo) FindByID(ctx context.Context, id int) (User, error) {
    var u User
    err := r.db.QueryRowContext(ctx,
        `SELECT id, name, email FROM users WHERE id = $1`, id,
    ).Scan(&u.ID, &u.Name, &u.Email)
    if errors.Is(err, sql.ErrNoRows) {
        return User{}, fmt.Errorf("user %d: %w", id, ErrNotFound)
    }
    return u, err
}

func (r *postgresUserRepo) Update(ctx context.Context, u User) error {
    res, err := r.db.ExecContext(ctx,
        `UPDATE users SET name=$1, email=$2 WHERE id=$3`, u.Name, u.Email, u.ID,
    )
    if err != nil {
        return err
    }
    if n, _ := res.RowsAffected(); n == 0 {
        return fmt.Errorf("user %d: %w", u.ID, ErrNotFound)
    }
    return nil
}

func (r *postgresUserRepo) Delete(ctx context.Context, id int) error {
    res, err := r.db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
    if err != nil {
        return err
    }
    if n, _ := res.RowsAffected(); n == 0 {
        return fmt.Errorf("user %d: %w", id, ErrNotFound)
    }
    return nil
}

// MockUserRepository — for unit tests
type MockUserRepository struct {
    Users map[int]User
    NextID int64
}

func NewMockUserRepo() *MockUserRepository {
    return &MockUserRepository{Users: make(map[int]User), NextID: 1}
}

func (m *MockUserRepository) Create(_ context.Context, u User) (int64, error) {
    id := m.NextID
    m.NextID++
    u.ID = int(id)
    m.Users[u.ID] = u
    return id, nil
}

func (m *MockUserRepository) FindByID(_ context.Context, id int) (User, error) {
    u, ok := m.Users[id]
    if !ok {
        return User{}, fmt.Errorf("user %d: %w", id, ErrNotFound)
    }
    return u, nil
}

func (m *MockUserRepository) Update(_ context.Context, u User) error {
    if _, ok := m.Users[u.ID]; !ok {
        return fmt.Errorf("user %d: %w", u.ID, ErrNotFound)
    }
    m.Users[u.ID] = u
    return nil
}

func (m *MockUserRepository) Delete(_ context.Context, id int) error {
    if _, ok := m.Users[id]; !ok {
        return fmt.Errorf("user %d: %w", id, ErrNotFound)
    }
    delete(m.Users, id)
    return nil
}

func main() {
    fmt.Println("UserRepository pattern defined")
}
```
**Time:** O(1) per op | **Space:** O(n) mock

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Swap postgres impl for distributed cache without changing service code |
| Edge Cases | Interface must include context parameter for timeouts |
| Error Handling | Domain errors (ErrNotFound) not DB errors exposed to callers |
| Memory | Mock stores users in map; fine for tests |
| Concurrency | Mock not goroutine-safe; add sync.RWMutex if parallel tests use it |

### Visual Explanation
```mermaid
flowchart TD
    A["UserService"] --> B["UserRepository interface"]
    B --> C["postgresUserRepo (production)"]
    B --> D["MockUserRepository (tests)"]
    C --> E["*sql.DB → PostgreSQL"]
    D --> F["map[int]User in memory"]
```
```
Trace: Service calls repo.FindByID → in prod hits PG, in test hits mock map
```

### Interviewer Questions
1. Why repository pattern? Decouples business logic from persistence; easy to test.
2. Can it be optimized? Add caching layer implementing same interface.
3. Scale to 10M? Repository can transparently add read replicas.
4. Edge cases? Context propagation; mock must handle cancellation.
5. Goroutine-safe? Add mutex to mock; postgres impl is safe via pool.
6. Memory impact? Mock holds all test data in RAM; acceptable.
7. Alternative? CQRS separates read/write repositories.

### Follow-Up Questions
**Q1:** Where should the interface live? **A1:** In the domain package; implementation in infrastructure package.
**Q2:** Should the interface be minimal? **A2:** Yes; only methods callers actually need (Interface Segregation Principle).
**Q3:** How to test with sqlmock? **A3:** DATA-QUERY-MOCK: mock.ExpectQuery with exact SQL regex.
**Q4:** Can you have multiple implementations? **A4:** Yes: postgres, redis-cache, in-memory mock all satisfy same interface.
**Q5:** What is the difference from DAO pattern? **A5:** Repository is domain-model focused; DAO is table/persistence focused.

---

---
## Q17: N+1 Problem and Fix  [Level 4 — Advanced]
> **Tags:** `#n+1` `#join` `#performance` `#eager-loading`

### Problem Statement
Demonstrate the N+1 query problem: fetching users then querying orders for each. Then fix it with a single JOIN query that returns users with their order counts. Show how to identify N+1 with logging and how JOIN eliminates it.

### Input / Output / Constraints
```
Input:  db *sql.DB, userIDs []int
Output: []UserWithOrderCount
Constraints: Show N+1 version and JOIN fix, explain query count difference
```

### Thought Process
1. Understand: N+1 = 1 query for N users + N queries for each user's orders.
2. Pattern: Replace loop+query with JOIN or IN clause.
3. Edge cases: Empty userIDs, users with no orders.

### Brute Force
```go
// O(n) queries — N+1 problem
func bruteForce(db *sql.DB) ([]UserWithOrderCount, error) {
    users, _ := ListUsers(db) // 1 query
    var result []UserWithOrderCount
    for _, u := range users { // N queries
        var count int
        db.QueryRow("SELECT COUNT(*) FROM orders WHERE user_id=$1", u.ID).Scan(&count)
        result = append(result, UserWithOrderCount{User: u, OrderCount: count})
    }
    return result, nil
}
```
**Time:** O(n) queries | **Space:** O(n)

### Better Solution
```go
// Fix: JOIN in one query
type UserWithOrderCount struct {
    User
    OrderCount int
}

func better(db *sql.DB) ([]UserWithOrderCount, error) {
    rows, err := db.Query(`
        SELECT u.id, u.name, u.email, COUNT(o.id) as order_count
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id, u.name, u.email
        ORDER BY u.id`)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var result []UserWithOrderCount
    for rows.Next() {
        var r UserWithOrderCount
        rows.Scan(&r.ID, &r.Name, &r.Email, &r.OrderCount)
        result = append(result, r)
    }
    return result, rows.Err()
}
```
**Time:** O(n log n) single query | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
    "strings"
)

type UserWithOrderCount struct {
    User
    OrderCount int
}

// GetUsersWithOrderCountNPlus1 — ANTI-PATTERN: N+1 queries
func GetUsersWithOrderCountNPlus1(db *sql.DB) ([]UserWithOrderCount, error) {
    users, err := ListUsers(db) // Query 1
    if err != nil {
        return nil, err
    }
    result := make([]UserWithOrderCount, 0, len(users))
    for _, u := range users {
        var count int
        // Query 2..N+1 — one per user!
        err := db.QueryRow(
            `SELECT COUNT(*) FROM orders WHERE user_id = $1`, u.ID,
        ).Scan(&count)
        if err != nil {
            return nil, fmt.Errorf("count orders for user %d: %w", u.ID, err)
        }
        result = append(result, UserWithOrderCount{User: u, OrderCount: count})
    }
    return result, nil
}

// GetUsersWithOrderCountJOIN — FIXED: single JOIN query
func GetUsersWithOrderCountJOIN(db *sql.DB) ([]UserWithOrderCount, error) {
    const q = `
        SELECT u.id, u.name, u.email, COUNT(o.id) AS order_count
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id, u.name, u.email
        ORDER BY u.id`

    rows, err := db.Query(q)
    if err != nil {
        return nil, fmt.Errorf("GetUsersWithOrderCountJOIN: %w", err)
    }
    defer rows.Close()

    result := make([]UserWithOrderCount, 0)
    for rows.Next() {
        var r UserWithOrderCount
        if err := rows.Scan(&r.ID, &r.Name, &r.Email, &r.OrderCount); err != nil {
            return nil, fmt.Errorf("scan: %w", err)
        }
        result = append(result, r)
    }
    return result, rows.Err()
}

// GetUsersWithOrderCountIN — Alternative fix: IN clause for selective fetch
func GetUsersWithOrderCountIN(db *sql.DB, userIDs []int) ([]UserWithOrderCount, error) {
    if len(userIDs) == 0 {
        return nil, nil
    }
    placeholders := make([]string, len(userIDs))
    args := make([]interface{}, len(userIDs))
    for i, id := range userIDs {
        placeholders[i] = fmt.Sprintf("$%d", i+1)
        args[i] = id
    }
    q := fmt.Sprintf(`
        SELECT u.id, u.name, u.email, COUNT(o.id) AS order_count
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        WHERE u.id IN (%s)
        GROUP BY u.id, u.name, u.email
        ORDER BY u.id`, strings.Join(placeholders, ","))

    rows, err := db.Query(q, args...)
    if err != nil {
        return nil, fmt.Errorf("GetUsersWithOrderCountIN: %w", err)
    }
    defer rows.Close()
    var result []UserWithOrderCount
    for rows.Next() {
        var r UserWithOrderCount
        rows.Scan(&r.ID, &r.Name, &r.Email, &r.OrderCount)
        result = append(result, r)
    }
    return result, rows.Err()
}

func main() {
    fmt.Println("N+1 demo and fix defined")
}
```
**Time:** O(n log n) JOIN | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | N+1 kills performance at scale; always profile query count |
| Edge Cases | Large IN list can hit query plan limits; batch if > 1000 ids |
| Error Handling | JOIN returns correct zero-counts via COALESCE |
| Memory | Single result set vs N round trips |
| Concurrency | Read-only; safe on read replica |

### Visual Explanation
```mermaid
flowchart TD
    A["N+1: ListUsers (1 query)"] --> B["for each user"]
    B --> C["SELECT COUNT orders WHERE user_id=? (N queries)"]
    C --> D["Total: N+1 round trips"]

    E["JOIN fix: 1 query"] --> F["LEFT JOIN + GROUP BY"]
    F --> G["1 round trip, DB does the aggregation"]
```
```
Trace N+1: 100 users → 101 queries
Trace JOIN: 100 users → 1 query
```

### Interviewer Questions
1. Why this approach? JOIN pushes aggregation to DB; reduces network round trips.
2. Can it be optimized? DataLoader pattern for GraphQL; batch by key.
3. Scale to 10M? Index on orders.user_id; query planner uses index scan.
4. Edge cases? IN list > 1000 items; chunk into batches.
5. Goroutine-safe? Read queries are safe.
6. Memory impact? Single result set in memory vs N sequential allocations.
7. Alternative? Preload in ORM (sqlboiler/ent eager loading).

### Follow-Up Questions
**Q1:** How to detect N+1 in production? **A1:** Query logging, pgbadger, or APM tools (Datadog, New Relic) show repeated queries.
**Q2:** What is DataLoader? **A2:** Batches and deduplicates N requests into one query per tick.
**Q3:** When is N+1 acceptable? **A3:** When N is always 1 or when prefetching would load unused data.
**Q4:** How does an ORM cause N+1? **A4:** Lazy loading relations: accessing .Orders on a User triggers a query per user.
**Q5:** What is eager loading? **A5:** Preloading related data in the same query or a batched follow-up query.

---

---
## Q18: Migration Pattern  [Level 4 — Advanced]
> **Tags:** `#migrations` `#schema` `#versioning` `#golang-migrate`

### Problem Statement
Implement a simple database migration runner `RunMigrations` that applies SQL migration files in order using a `schema_migrations` table to track applied versions. Show how to embed migration files and run them at startup. Mention golang-migrate as the production alternative.

### Input / Output / Constraints
```
Input:  db *sql.DB, migrations []Migration{Version, SQL}
Output: error; schema_migrations table tracks applied versions
Constraints: Idempotent, skip already-applied, ordered by version
```

### Thought Process
1. Understand: Migrations must be applied in order and only once.
2. Pattern: Create tracking table → check applied → apply missing → record.
3. Edge cases: Partial failure mid-migration, out-of-order versions.

### Brute Force
```go
// O(n) time — no tracking, runs all migrations every time
func bruteForce(db *sql.DB, sqls []string) error {
    for _, s := range sqls {
        db.Exec(s)
    }
    return nil
}
```
**Time:** O(n) | **Space:** O(1)

### Better Solution
```go
type Migration struct{ Version int; SQL string }

func better(db *sql.DB, migrations []Migration) error {
    db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INT PRIMARY KEY)`)
    for _, m := range migrations {
        var v int
        err := db.QueryRow("SELECT version FROM schema_migrations WHERE version=$1", m.Version).Scan(&v)
        if err == nil {
            continue // already applied
        }
        if _, err := db.Exec(m.SQL); err != nil {
            return err
        }
        db.Exec("INSERT INTO schema_migrations(version) VALUES($1)", m.Version)
    }
    return nil
}
```
**Time:** O(n) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
    "sort"
)

type Migration struct {
    Version int
    Name    string
    SQL     string
}

// RunMigrations — O(n log n) time, O(1) space
func RunMigrations(db *sql.DB, migrations []Migration) error {
    // Create tracking table
    _, err := db.Exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT NOW()
        )`)
    if err != nil {
        return fmt.Errorf("create migrations table: %w", err)
    }

    // Sort by version
    sort.Slice(migrations, func(i, j int) bool {
        return migrations[i].Version < migrations[j].Version
    })

    for _, m := range migrations {
        // Check if already applied
        var count int
        err := db.QueryRow(
            `SELECT COUNT(*) FROM schema_migrations WHERE version = $1`, m.Version,
        ).Scan(&count)
        if err != nil {
            return fmt.Errorf("check migration %d: %w", m.Version, err)
        }
        if count > 0 {
            continue // already applied
        }

        // Apply in transaction
        tx, err := db.Begin()
        if err != nil {
            return fmt.Errorf("begin migration %d: %w", m.Version, err)
        }
        defer tx.Rollback()

        if _, err := tx.Exec(m.SQL); err != nil {
            return fmt.Errorf("apply migration %d (%s): %w", m.Version, m.Name, err)
        }
        if _, err := tx.Exec(
            `INSERT INTO schema_migrations(version, name) VALUES($1, $2)`,
            m.Version, m.Name,
        ); err != nil {
            return fmt.Errorf("record migration %d: %w", m.Version, err)
        }
        if err := tx.Commit(); err != nil {
            return fmt.Errorf("commit migration %d: %w", m.Version, err)
        }
        fmt.Printf("Applied migration %d: %s\n", m.Version, m.Name)
    }
    return nil
}

func main() {
    migrations := []Migration{
        {1, "create_users", `CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE)`},
        {2, "add_created_at", `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`},
    }
    fmt.Printf("RunMigrations defined with %d migrations\n", len(migrations))
}
```
**Time:** O(n log n) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Use golang-migrate or goose in production; battle-tested |
| Edge Cases | Never modify applied migrations; only add new ones |
| Error Handling | Each migration in its own transaction; atomic apply+record |
| Memory | Migrations loaded once at startup |
| Concurrency | Add advisory lock (pg_try_advisory_lock) to prevent concurrent runs |

### Visual Explanation
```mermaid
flowchart TD
    A["RunMigrations(db, migrations)"] --> B["CREATE TABLE schema_migrations IF NOT EXISTS"]
    B --> C["Sort migrations by version"]
    C --> D["for each migration"]
    D --> E["SELECT COUNT FROM schema_migrations WHERE version=?"]
    E --> F{applied?}
    F -- yes --> G["skip"]
    F -- no --> H["BEGIN tx"]
    H --> I["Exec migration SQL"]
    I --> J["INSERT INTO schema_migrations"]
    J --> K["COMMIT"]
    K --> D
```
```
Trace: v1 not applied → apply CREATE TABLE → record v1 → v2 not applied → apply ALTER → record v2
```

### Interviewer Questions
1. Why transactional migrations? Schema change and tracking record are atomic.
2. Can it be optimized? Use golang-migrate; handles up/down, embedded files.
3. Scale to 10M? Blue-green deployments; backward-compatible migrations only.
4. Edge cases? Concurrent startup; use advisory lock to serialize.
5. Goroutine-safe? Single-threaded at startup; lock prevents parallel runs.
6. Memory impact? Migrations loaded once; negligible.
7. Alternative? goose, flyway, atlas, sqitch.

### Follow-Up Questions
**Q1:** What is golang-migrate? **A1:** A library that runs versioned SQL/Go migrations with up/down support.
**Q2:** How to embed migration files? **A2:** Use //go:embed migrations/*.sql with embed.FS.
**Q3:** What is an advisory lock? **A3:** pg_try_advisory_lock(key) — DB-level mutex to prevent concurrent migrations.
**Q4:** What is a zero-downtime migration? **A4:** Add column as nullable first, backfill, then add NOT NULL constraint.
**Q5:** Should you commit migrations to git? **A5:** Yes; never modify applied migrations; always add new ones.

---

---
## Q19: Redis SET GET EXPIRE INCR  [Level 5 — Interview]
> **Tags:** `#redis` `#go-redis` `#cache` `#expire` `#incr`

### Problem Statement
Write a `RedisCache` service that wraps `go-redis/v9` with four operations: `Set` (with TTL), `Get`, `Delete`, and `IncrBy`. Use these to implement a rate limiter that allows N requests per user per minute. Handle `redis.Nil` for missing keys.

### Input / Output / Constraints
```
Input:  rdb *redis.Client, userID string, limit int
Output: allowed bool, remaining int, error
Constraints: Use INCR + EXPIRE for atomic counter, handle redis.Nil, TTL=60s
```

### Thought Process
1. Understand: INCR is atomic; EXPIRE sets TTL. Together they form a sliding window counter.
2. Pattern: INCR key → if new key (val==1) EXPIRE 60s → check val <= limit.
3. Edge cases: Redis down, key expired mid-check, limit=0.

### Brute Force
```go
// O(1) time, O(1) space — two round trips, not atomic
func bruteForce(rdb *redis.Client, userID string) (bool, error) {
    ctx := context.Background()
    key := "rate:" + userID
    val, _ := rdb.Get(ctx, key).Int()
    if val >= 10 {
        return false, nil
    }
    rdb.Incr(ctx, key)
    rdb.Expire(ctx, key, time.Minute)
    return true, nil
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
// Atomic INCR+EXPIRE pattern
func better(rdb *redis.Client, userID string, limit int) (bool, int, error) {
    ctx := context.Background()
    key := fmt.Sprintf("rate_limit:%s", userID)
    val, err := rdb.Incr(ctx, key).Result()
    if err != nil {
        return false, 0, err
    }
    if val == 1 {
        rdb.Expire(ctx, key, time.Minute)
    }
    remaining := limit - int(val)
    if remaining < 0 {
        remaining = 0
    }
    return val <= int64(limit), remaining, nil
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
)

type RedisCache struct {
    rdb *redis.Client
}

func NewRedisCache(addr string) *RedisCache {
    rdb := redis.NewClient(&redis.Options{
        Addr:         addr,
        DialTimeout:  2 * time.Second,
        ReadTimeout:  1 * time.Second,
        WriteTimeout: 1 * time.Second,
        PoolSize:     10,
    })
    return &RedisCache{rdb: rdb}
}

// Set — O(1) time, O(1) space
func (c *RedisCache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
    return c.rdb.Set(ctx, key, value, ttl).Err()
}

// Get — O(1) time, O(1) space
func (c *RedisCache) Get(ctx context.Context, key string) (string, error) {
    val, err := c.rdb.Get(ctx, key).Result()
    if errors.Is(err, redis.Nil) {
        return "", fmt.Errorf("key %q not found: %w", key, ErrNotFound)
    }
    return val, err
}

// Delete — O(1) time, O(1) space
func (c *RedisCache) Delete(ctx context.Context, key string) error {
    return c.rdb.Del(ctx, key).Err()
}

// IncrBy — O(1) time, O(1) space
func (c *RedisCache) IncrBy(ctx context.Context, key string, delta int64) (int64, error) {
    return c.rdb.IncrBy(ctx, key, delta).Result()
}

// RateLimit — allows limit requests per minute per userID
// Returns: allowed, remaining, error
func (c *RedisCache) RateLimit(ctx context.Context, userID string, limit int) (bool, int, error) {
    key := fmt.Sprintf("rate_limit:%s", userID)

    // INCR is atomic; first increment sets val=1
    val, err := c.rdb.Incr(ctx, key).Result()
    if err != nil {
        // Fail open: allow on Redis error to avoid blocking users
        return true, limit, fmt.Errorf("RateLimit INCR: %w", err)
    }

    // Set expiry only on first increment (atomic window start)
    if val == 1 {
        if err := c.rdb.Expire(ctx, key, time.Minute).Err(); err != nil {
            return true, limit, fmt.Errorf("RateLimit EXPIRE: %w", err)
        }
    }

    remaining := limit - int(val)
    if remaining < 0 {
        remaining = 0
    }
    return val <= int64(limit), remaining, nil
}

func main() {
    cache := NewRedisCache("localhost:6379")
    ctx := context.Background()

    _ = cache.Set(ctx, "user:1:name", "Alice", 5*time.Minute)
    name, _ := cache.Get(ctx, "user:1:name")
    fmt.Println("Got:", name)

    allowed, remaining, _ := cache.RateLimit(ctx, "user:1", 100)
    fmt.Printf("Allowed: %v, Remaining: %d\n", allowed, remaining)
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Redis single-node can handle 100K+ ops/sec |
| Edge Cases | redis.Nil for missing key must be handled explicitly |
| Error Handling | Fail open vs fail closed on Redis error — business decision |
| Memory | Each key uses ~100 bytes; evict with maxmemory-policy |
| Concurrency | INCR is atomic; no race conditions |

### Visual Explanation
```mermaid
flowchart TD
    A["RateLimit(userID, limit=100)"] --> B["INCR rate_limit:userID"]
    B --> C{val == 1?}
    C -- yes --> D["EXPIRE 60s (start window)"]
    C -- no --> E["skip EXPIRE"]
    D & E --> F{val <= limit?}
    F -- yes --> G["return allowed=true, remaining=limit-val"]
    F -- no --> H["return allowed=false, remaining=0"]
```
```
Trace: req1 → INCR=1 → EXPIRE 60s → allowed
       req101 → INCR=101 → 101>100 → denied
       after 60s → key expired → INCR=1 → window resets
```

### Interviewer Questions
1. Why INCR+EXPIRE? INCR is atomic; avoids race between GET and SET.
2. Can it be optimized? Lua script for atomic INCR+EXPIRE in one round trip.
3. Scale to 10M? Redis Cluster; shard by userID hash.
4. Edge cases? Redis down: fail open or use local fallback counter.
5. Goroutine-safe? All Redis operations are safe; client pools connections.
6. Memory impact? One key per user per window; auto-expires.
7. Alternative? Token bucket or sliding window via Redis Lua or Redis Cell module.

### Follow-Up Questions
**Q1:** What is redis.Nil? **A1:** The error returned when a key does not exist; equivalent to sql.ErrNoRows.
**Q2:** How to make INCR+EXPIRE atomic? **A2:** Use a Lua script: INCR and EXPIRE in the same script = atomic.
**Q3:** What is Redis SETNX? **A3:** SET if Not eXists — used for distributed locks.
**Q4:** What eviction policy is best for a cache? **A4:** allkeys-lru evicts least recently used when memory is full.
**Q5:** How to handle Redis cluster with go-redis? **A5:** Use redis.NewClusterClient with cluster addresses.

---

---
## Q20: Redis Lua Script Atomic Rate Limiter  [Level 5 — Interview]
> **Tags:** `#redis` `#lua` `#atomic` `#rate-limiting` `#sliding-window`

### Problem Statement
Improve the Q19 rate limiter by making INCR and EXPIRE atomic using a Redis Lua script. Write `AtomicRateLimit` that uses `rdb.Eval` with a Lua script that atomically increments the counter and sets expiry only if it does not already have one. Explain why Lua scripts are atomic in Redis.

### Input / Output / Constraints
```
Input:  rdb *redis.Client, key string, limit int, window time.Duration
Output: allowed bool, count int64, error
Constraints: Lua script runs atomically, single round trip, use KEYS and ARGV
```

### Thought Process
1. Understand: Redis is single-threaded; Lua scripts run without interruption.
2. Pattern: EVAL lua_script 1 key limit window_seconds.
3. Edge cases: Script error, wrong number of keys/args, Redis version < 2.6.

### Brute Force
```go
// O(1) time — two commands, not atomic
func bruteForce(rdb *redis.Client, key string, limit int) (bool, error) {
    ctx := context.Background()
    val, _ := rdb.Incr(ctx, key).Result()
    rdb.Expire(ctx, key, time.Minute) // race possible between these two
    return val <= int64(limit), nil
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
var rateLimitScript = redis.NewScript(`
local val = redis.call('INCR', KEYS[1])
if val == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return val`)

func better(ctx context.Context, rdb *redis.Client, key string, limit, window int) (bool, int64, error) {
    val, err := rateLimitScript.Run(ctx, rdb, []string{key}, limit, window).Int64()
    return val <= int64(limit), val, err
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
)

// Lua script: atomic INCR + conditional EXPIRE
// KEYS[1] = rate limit key
// ARGV[1] = limit (for reference, not used in script logic)
// ARGV[2] = window in seconds
var rateLimitLua = redis.NewScript(`
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return current
`)

// AtomicRateLimit — O(1) time, O(1) space, single round trip
func AtomicRateLimit(ctx context.Context, rdb *redis.Client, userID string, limit int, window time.Duration) (allowed bool, count int64, err error) {
    key := fmt.Sprintf("rl:%s", userID)
    windowSecs := int(window.Seconds())

    result, err := rateLimitLua.Run(ctx, rdb, []string{key}, limit, windowSecs).Int64()
    if err != nil {
        // Fail open: Redis unavailable shouldn't block all users
        return true, 0, fmt.Errorf("AtomicRateLimit eval: %w", err)
    }
    return result <= int64(limit), result, nil
}

// RateLimitMiddleware wraps an HTTP handler with rate limiting
func RateLimitMiddlewareDemo(userID string, rdb *redis.Client, limit int) {
    ctx := context.Background()
    allowed, count, err := AtomicRateLimit(ctx, rdb, userID, limit, time.Minute)
    if err != nil {
        fmt.Printf("Rate limit check error: %v (allowing request)\n", err)
        return
    }
    if !allowed {
        fmt.Printf("Rate limit exceeded for user %s: count=%d limit=%d\n", userID, count, limit)
        return
    }
    fmt.Printf("Request allowed for user %s: count=%d/%d\n", userID, count, limit)
}

func main() {
    fmt.Println("AtomicRateLimit defined")
    fmt.Println("Lua script is atomic: Redis executes it in a single step, no interleaving")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | EVALSHA sends script hash after first load; reduces bandwidth |
| Edge Cases | Window reset race eliminated by Lua atomicity |
| Error Handling | Fail open vs fail closed decision belongs to business |
| Memory | One key per user per window; auto-expires |
| Concurrency | Redis single-thread + Lua = no race conditions |

### Visual Explanation
```mermaid
flowchart TD
    A["AtomicRateLimit(userID, 100, 60s)"] --> B["rateLimitLua.Run(ctx, rdb, keys, args)"]
    B --> C["Redis: INCR rl:userID (atomic start)"]
    C --> D{current == 1?}
    D -- yes --> E["EXPIRE rl:userID 60"]
    D -- no --> F["skip"]
    E & F --> G["return current"]
    G --> H{current <= 100?}
    H -- yes --> I["allowed=true"]
    H -- no --> J["allowed=false"]
```
```
Trace: Lua executes atomically → INCR=1 → EXPIRE 60s → return 1 → allowed
       concurrent request → INCR=2 (no race) → no EXPIRE → return 2 → allowed
```

### Interviewer Questions
1. Why Lua for atomicity? Redis is single-threaded; Lua blocks all other commands during execution.
2. Can it be optimized? Use EVALSHA after first EVAL to avoid re-sending script body.
3. Scale to 10M? Redis Cluster with hash tags to co-locate keys on same node.
4. Edge cases? Script exceeds time limit: redis.conf lua-time-limit (default 5s).
5. Goroutine-safe? Yes; concurrent callers serialize at Redis level.
6. Memory impact? Script cached in Redis after first EVAL; ~1KB overhead.
7. Alternative? Redis modules (RedisCell) implement token bucket natively.

### Follow-Up Questions
**Q1:** What is EVALSHA? **A1:** Runs script by SHA1 hash; avoids re-sending script body on every call.
**Q2:** Can Lua scripts be rolled back? **A2:** No; Redis has no transactions with rollback; use MULTI/EXEC for that.
**Q3:** What happens if Lua errors mid-script? **A3:** Redis returns an error; partial writes before the error persist.
**Q4:** What is the Redis MULTI/EXEC alternative? **A4:** MULTI/EXEC queues commands; WATCH adds optimistic locking.
**Q5:** What is the sliding window rate limit? **A5:** Tracks requests in a rolling time window using sorted sets (ZADD/ZCOUNT).

---

---
## Q21: SELECT FOR UPDATE — Pessimistic Locking  [Level 4 — Advanced]
> **Tags:** `#select-for-update` `#locking` `#pessimistic` `#concurrency`

### Problem Statement
Write `ReserveInventory` that uses `SELECT ... FOR UPDATE` inside a transaction to lock a product row while checking and decrementing stock. Prevent overselling when multiple goroutines attempt to reserve simultaneously.

### Input / Output / Constraints
```
Input:  db *sql.DB, productID int, quantity int
Output: error (ErrInsufficientStock if qty < requested)
Constraints: SELECT FOR UPDATE, check stock, UPDATE in same transaction
```

### Thought Process
1. Understand: FOR UPDATE locks the row until transaction commits; other transactions wait.
2. Pattern: BEGIN → SELECT stock FOR UPDATE → check → UPDATE → COMMIT.
3. Edge cases: Concurrent reservations, stock exactly equals requested, product not found.

### Brute Force
```go
// O(1) — race condition: two goroutines read same stock simultaneously
func bruteForce(db *sql.DB, productID, qty int) error {
    var stock int
    db.QueryRow("SELECT stock FROM products WHERE id=$1", productID).Scan(&stock)
    if stock < qty {
        return errors.New("insufficient stock")
    }
    db.Exec("UPDATE products SET stock=stock-$1 WHERE id=$2", qty, productID)
    return nil
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
var ErrInsufficientStock = errors.New("insufficient stock")

func better(db *sql.DB, productID, qty int) error {
    tx, err := db.Begin()
    if err != nil { return err }
    defer tx.Rollback()
    var stock int
    err = tx.QueryRow("SELECT stock FROM products WHERE id=$1 FOR UPDATE", productID).Scan(&stock)
    if err != nil { return err }
    if stock < qty { return ErrInsufficientStock }
    _, err = tx.Exec("UPDATE products SET stock=stock-$1 WHERE id=$2", qty, productID)
    if err != nil { return err }
    return tx.Commit()
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "errors"
    "fmt"
)

var ErrInsufficientStock = errors.New("insufficient stock")

// ReserveInventory — O(1) time, O(1) space
func ReserveInventory(db *sql.DB, productID, quantity int) error {
    if quantity <= 0 {
        return fmt.Errorf("quantity must be positive, got %d", quantity)
    }
    tx, err := db.Begin()
    if err != nil {
        return fmt.Errorf("begin: %w", err)
    }
    defer tx.Rollback()

    var stock int
    err = tx.QueryRow(
        `SELECT stock FROM products WHERE id = $1 FOR UPDATE`,
        productID,
    ).Scan(&stock)
    switch {
    case errors.Is(err, sql.ErrNoRows):
        return fmt.Errorf("product %d: %w", productID, ErrNotFound)
    case err != nil:
        return fmt.Errorf("select for update: %w", err)
    }

    if stock < quantity {
        return fmt.Errorf("product %d has %d in stock, requested %d: %w",
            productID, stock, quantity, ErrInsufficientStock)
    }

    if _, err := tx.Exec(
        `UPDATE products SET stock = stock - $1 WHERE id = $2`,
        quantity, productID,
    ); err != nil {
        return fmt.Errorf("update stock: %w", err)
    }
    return tx.Commit()
}

func main() {
    fmt.Println("ReserveInventory defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | FOR UPDATE serializes; throughput limited by lock contention |
| Edge Cases | Deadlock if two transactions lock products in reverse order |
| Error Handling | Retry on deadlock (pq error 40P01) with exponential backoff |
| Memory | Lock held until commit; keep transaction short |
| Concurrency | Only one goroutine proceeds past SELECT FOR UPDATE at a time |

### Visual Explanation
```mermaid
flowchart TD
    A["Goroutine 1: BEGIN"] --> B["SELECT stock FOR UPDATE → stock=10, row LOCKED"]
    C["Goroutine 2: BEGIN"] --> D["SELECT stock FOR UPDATE → WAITS"]
    B --> E["stock >= qty? → UPDATE stock=10-3=7"]
    E --> F["COMMIT → lock released"]
    F --> D
    D --> G["SELECT stock FOR UPDATE → stock=7"]
    G --> H["stock >= qty? → UPDATE"]
```
```
Trace: G1 locks row → G2 waits → G1 commits → G2 proceeds with updated stock
```

### Interviewer Questions
1. Why FOR UPDATE? Prevents two concurrent transactions from reading same stale stock value.
2. Can it be optimized? Optimistic locking with version column; retry on conflict.
3. Scale to 10M? Partition products; shard by category to reduce lock contention.
4. Edge cases? Deadlock — retry with pg error code 40P01.
5. Goroutine-safe? Lock enforced at DB level; goroutines serialize safely.
6. Memory impact? Row lock held in DB; no Go memory concern.
7. Alternative? Optimistic locking: UPDATE WHERE version=$v AND stock>=$qty; check RowsAffected.

### Follow-Up Questions
**Q1:** What is FOR UPDATE SKIP LOCKED? **A1:** Skips locked rows; useful for job queue processing.
**Q2:** What is optimistic locking? **A2:** Read-modify-write with a version check; retry if version changed.
**Q3:** When does deadlock occur? **A3:** Two transactions lock the same rows in different orders.
**Q4:** How to detect deadlock in pq? **A4:** Check pq.Error.Code == "40P01" (deadlock_detected).
**Q5:** What is advisory lock? **A5:** Application-level lock using pg_advisory_lock(key); not tied to a row.

---

---
## Q22: SQL Injection Prevention  [Level 4 — Advanced]
> **Tags:** `#sql-injection` `#security` `#parameterized` `#prepared`

### Problem Statement
Demonstrate a SQL injection vulnerability in Go and its fix. Show an unsafe `SearchUsers` that builds a query by string concatenation, then write the safe version using parameterized queries. Explain why parameterized queries are immune to injection.

### Input / Output / Constraints
```
Input:  db *sql.DB, searchTerm string (may contain SQL metacharacters)
Output: []User or error
Constraints: Safe version uses $1 parameter, never string concatenate user input
```

### Thought Process
1. Understand: String concat embeds user input directly into SQL; attacker can change query semantics.
2. Pattern: Never fmt.Sprintf into SQL; always use $1 placeholders.
3. Edge cases: Quotes, semicolons, UNION SELECT in input.

### Brute Force
```go
// VULNERABLE — never do this
func bruteForce(db *sql.DB, term string) ([]User, error) {
    q := "SELECT id,name,email FROM users WHERE name LIKE '%" + term + "%'"
    // term = "'; DROP TABLE users; --" → catastrophic
    rows, err := db.Query(q)
    if err != nil { return nil, err }
    defer rows.Close()
    return scanUsers(rows)
}
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
// SAFE — parameterized
func better(db *sql.DB, term string) ([]User, error) {
    rows, err := db.Query(
        "SELECT id,name,email FROM users WHERE name ILIKE $1",
        "%"+term+"%",
    )
    if err != nil { return nil, err }
    defer rows.Close()
    return scanUsers(rows)
}
```
**Time:** O(n) | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
    "strings"
)

// SearchUsersUNSAFE — NEVER USE — SQL injection demo
func SearchUsersUNSAFE(db *sql.DB, name string) ([]User, error) {
    // INJECTION: attacker sends name = "' OR '1'='1"
    q := fmt.Sprintf(
        "SELECT id, name, email FROM users WHERE name LIKE '%%%s%%'", name,
    )
    rows, err := db.Query(q)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    return scanUsers(rows)
}

// SearchUsersSAFE — parameterized, injection-proof
func SearchUsersSAFE(db *sql.DB, name string) ([]User, error) {
    name = strings.TrimSpace(name)
    if name == "" {
        return []User{}, nil
    }
    const q = `SELECT id, name, email FROM users WHERE name ILIKE $1 ORDER BY id LIMIT 50`
    rows, err := db.Query(q, "%"+name+"%")
    if err != nil {
        return nil, fmt.Errorf("SearchUsers: %w", err)
    }
    defer rows.Close()
    return scanUsers(rows)
}

func main() {
    fmt.Println("SearchUsersSAFE defined")
    fmt.Println("Rule: NEVER concatenate user input into SQL strings")
}
```
**Time:** O(n) | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Parameterized queries also benefit from plan caching |
| Edge Cases | Wildcards in LIKE: sanitize % and _ if not intended as wildcards |
| Error Handling | Injection attempt produces DB syntax error; log and alert |
| Memory | Same as safe query scan |
| Concurrency | Parameterized queries are safe for concurrent use |

### Visual Explanation
```mermaid
flowchart TD
    A["User input: ' OR 1=1 --"] --> B{Concatenated?}
    B -- yes --> C["Query: WHERE name LIKE '%' OR 1=1 --%'"]
    C --> D["Returns ALL rows — injection succeeded"]
    B -- no --> E["Query: WHERE name ILIKE $1"]
    E --> F["DB treats input as literal string"]
    F --> G["No rows match — injection failed"]
```
```
Trace UNSAFE: input "'; DROP TABLE users; --" → executes DROP
Trace SAFE:   input "'; DROP TABLE users; --" → literal string, no match
```

### Interviewer Questions
1. Why parameterized? DB driver sends SQL and params separately; SQL structure can't change.
2. Can it be optimized? Prepared statements additionally cache the plan.
3. Scale to 10M? Same; parameterization is zero overhead.
4. Edge cases? LIKE wildcards in user input may cause full scans; sanitize % and _.
5. Goroutine-safe? Yes.
6. Memory impact? Negligible.
7. Alternative? ORM/query builder that always parameterizes; code review linting for raw queries.

### Follow-Up Questions
**Q1:** What is second-order SQL injection? **A1:** Stored value injected into a later query; same fix — parameterize on read.
**Q2:** Does an ORM prevent injection? **A2:** If you use its query builder; raw query methods still need parameterization.
**Q3:** What is ILIKE? **A3:** Case-insensitive LIKE in PostgreSQL.
**Q4:** How to sanitize LIKE wildcards? **A4:** Escape % and _ in user input: strings.ReplaceAll(name, "%", "\\%").
**Q5:** Can error messages reveal schema? **A5:** Yes; return generic errors to clients, log details server-side.

---

---
## Q23: Read Replica Routing  [Level 4 — Advanced]
> **Tags:** `#read-replica` `#routing` `#scalability` `#cqrs`

### Problem Statement
Design a `DBPool` that holds a primary write DB and one or more read replicas. Route `Exec` and write queries to primary; route `Query` and read queries to a replica using round-robin. Show the struct and key methods.

### Input / Output / Constraints
```
Input:  primary *sql.DB, replicas []*sql.DB
Output: DBPool with Read() and Write() methods
Constraints: Round-robin replica selection, atomic counter, goroutine-safe
```

### Thought Process
1. Understand: Primary handles writes; replicas handle reads to scale read throughput.
2. Pattern: Atomic counter mod len(replicas) for round-robin.
3. Edge cases: No replicas (fall back to primary), replica lag.

### Brute Force
```go
// Not goroutine-safe counter
type DBPool struct { primary *sql.DB; replicas []*sql.DB; idx int }
func (p *DBPool) Read() *sql.DB {
    if len(p.replicas) == 0 { return p.primary }
    r := p.replicas[p.idx % len(p.replicas)]
    p.idx++
    return r
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
import "sync/atomic"
type DBPool struct { primary *sql.DB; replicas []*sql.DB; counter uint64 }
func (p *DBPool) Read() *sql.DB {
    if len(p.replicas) == 0 { return p.primary }
    n := atomic.AddUint64(&p.counter, 1)
    return p.replicas[n % uint64(len(p.replicas))]
}
func (p *DBPool) Write() *sql.DB { return p.primary }
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
    "sync/atomic"
)

type DBPool struct {
    primary  *sql.DB
    replicas []*sql.DB
    counter  uint64
}

func NewDBPool(primary *sql.DB, replicas ...*sql.DB) *DBPool {
    return &DBPool{primary: primary, replicas: replicas}
}

// Write — always returns primary
func (p *DBPool) Write() *sql.DB { return p.primary }

// Read — round-robin over replicas, falls back to primary if none
func (p *DBPool) Read() *sql.DB {
    if len(p.replicas) == 0 {
        return p.primary
    }
    n := atomic.AddUint64(&p.counter, 1)
    return p.replicas[n%uint64(len(p.replicas))]
}

// ExecContext routes to primary
func (p *DBPool) ExecContext(ctx interface{}, query string, args ...interface{}) {
    fmt.Printf("ExecContext → primary: %s\n", query)
    // p.Write().ExecContext(ctx, query, args...)
}

// QueryContext routes to replica
func (p *DBPool) QueryContext(ctx interface{}, query string, args ...interface{}) {
    fmt.Printf("QueryContext → replica: %s\n", query)
    // p.Read().QueryContext(ctx, query, args...)
}

func main() {
    fmt.Println("DBPool read-replica routing defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Add replicas to scale reads horizontally |
| Edge Cases | Replica lag: stale reads after write; use primary for read-after-write |
| Error Handling | Detect replica failure; remove from pool and alert |
| Memory | One *sql.DB per server; ~4KB overhead each |
| Concurrency | atomic.AddUint64 is lock-free and goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["Query (read)"] --> B["DBPool.Read()"]
    B --> C["atomic counter mod N"]
    C --> D["replica[0] or replica[1] or replica[2]"]

    E["Exec (write)"] --> F["DBPool.Write()"]
    F --> G["primary DB"]
```
```
Trace: reads → replica0, replica1, replica2, replica0 ... (round-robin)
       writes → primary always
```

### Interviewer Questions
1. Why round-robin? Simple; distributes load evenly across healthy replicas.
2. Can it be optimized? Weighted round-robin; health-check to remove failing replicas.
3. Scale to 10M? Add replicas; read throughput scales linearly.
4. Edge cases? Replica lag causes stale reads; use primary for critical reads.
5. Goroutine-safe? atomic.AddUint64 is lock-free.
6. Memory impact? Negligible; one counter per pool.
7. Alternative? pgx with pgxpool supports read/write split natively.

### Follow-Up Questions
**Q1:** What is replica lag? **A1:** Time between primary write and replica replication; typically milliseconds.
**Q2:** How to do read-after-write consistency? **A2:** Route reads for the same user session to primary for a short window.
**Q3:** What is CQRS? **A3:** Command Query Responsibility Segregation; separate models for reads and writes.
**Q4:** How to detect replica failure? **A4:** Periodic db.Ping() in background; remove failed replicas from pool.
**Q5:** What is synchronous replication? **A5:** Primary waits for replica to confirm write; zero lag but slower writes.

---

---
## Q24: Database Health Check  [Level 5 — Interview]
> **Tags:** `#health-check` `#observability` `#readiness` `#liveness`

### Problem Statement
Write a `HealthCheck` function that checks DB connectivity and reports stats (open connections, wait count). Expose it as an HTTP handler returning JSON. Distinguish between liveness (process alive) and readiness (can serve traffic).

### Input / Output / Constraints
```
Input:  db *sql.DB, ctx context.Context
Output: JSON {"status":"ok","open_conns":5,"wait_count":0} or {"status":"degraded"}
Constraints: Use db.PingContext, db.Stats(), 1s timeout, proper HTTP status codes
```

### Thought Process
1. Understand: Liveness = is the process running; Readiness = is the DB reachable.
2. Pattern: PingContext(1s) → Stats → marshal JSON → return 200 or 503.
3. Edge cases: DB timeout, high wait count signals pool saturation.

### Brute Force
```go
// O(1) — no stats, no timeout
func bruteForce(db *sql.DB) bool {
    return db.Ping() == nil
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(db *sql.DB, w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), time.Second)
    defer cancel()
    if err := db.PingContext(ctx); err != nil {
        http.Error(w, `{"status":"degraded"}`, http.StatusServiceUnavailable)
        return
    }
    fmt.Fprintf(w, `{"status":"ok"}`)
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "net/http"
    "time"
)

type HealthStatus struct {
    Status      string `json:"status"`
    OpenConns   int    `json:"open_conns"`
    IdleConns   int    `json:"idle_conns"`
    WaitCount   int64  `json:"wait_count"`
    MaxOpenConns int   `json:"max_open_conns"`
}

// DBHealthCheck — O(1) time, O(1) space
func DBHealthCheck(ctx context.Context, db *sql.DB) (HealthStatus, error) {
    tctx, cancel := context.WithTimeout(ctx, time.Second)
    defer cancel()

    status := HealthStatus{Status: "ok"}
    stats := db.Stats()
    status.OpenConns = stats.OpenConnections
    status.IdleConns = stats.Idle
    status.WaitCount = stats.WaitCount
    status.MaxOpenConns = stats.MaxOpenConnections

    if err := db.PingContext(tctx); err != nil {
        status.Status = "degraded"
        return status, fmt.Errorf("ping: %w", err)
    }
    if stats.WaitCount > 100 {
        status.Status = "degraded" // pool saturation warning
    }
    return status, nil
}

// HealthHandler — HTTP handler for Kubernetes readiness probe
func HealthHandler(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        status, err := DBHealthCheck(r.Context(), db)
        w.Header().Set("Content-Type", "application/json")
        if err != nil || status.Status == "degraded" {
            w.WriteHeader(http.StatusServiceUnavailable)
        }
        json.NewEncoder(w).Encode(status)
    }
}

func main() {
    fmt.Println("DBHealthCheck and HealthHandler defined")
}
```
**Time:** O(1) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Health endpoint called every few seconds by Kubernetes; must be fast |
| Edge Cases | PingContext timeout should be much less than readiness probe periodSeconds |
| Error Handling | Return 503 so load balancer removes pod from rotation |
| Memory | No allocations beyond JSON encoding |
| Concurrency | db.Stats() is goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["GET /health/ready"] --> B["context.WithTimeout(1s)"]
    B --> C["db.PingContext(ctx)"]
    C --> D{ping ok?}
    D -- no --> E["status=degraded, 503"]
    D -- yes --> F["db.Stats()"]
    F --> G{WaitCount > 100?}
    G -- yes --> H["status=degraded, 503"]
    G -- no --> I["status=ok, 200"]
    E & H & I --> J["JSON response"]
```
```
Trace: Ping OK + WaitCount=5 → 200 {"status":"ok","open_conns":10}
```

### Interviewer Questions
1. Why separate liveness and readiness? Liveness restart loop; readiness controls traffic routing.
2. Can it be optimized? Cache last check result for 1s to avoid DB spam.
3. Scale to 10M? Health check is read-only; minimal DB load.
4. Edge cases? DB slow but not down; PingContext timeout length matters.
5. Goroutine-safe? Yes; db.Stats and PingContext are safe.
6. Memory impact? JSON encoding ~200 bytes; negligible.
7. Alternative? Expose Prometheus metrics: db_wait_count, db_open_conns gauges.

### Follow-Up Questions
**Q1:** What is the difference between liveness and readiness? **A1:** Liveness: is process healthy (restart if not); Readiness: can it serve requests (remove from LB if not).
**Q2:** How does Kubernetes use readiness probe? **A2:** Removes pod from Service endpoints; traffic stops until probe passes.
**Q3:** What db.Stats fields matter most? **A3:** WaitCount (pool contention), OpenConnections (current usage), MaxOpenConnections.
**Q4:** How to handle cascading health check failures? **A4:** Circuit breaker; if DB is down, don't re-try on every request.
**Q5:** What is a degraded state? **A5:** Service partially functional; may still serve cached responses.

---

---
## Q25: Optimistic Locking with Version Column  [Level 5 — Interview]
> **Tags:** `#optimistic-locking` `#version` `#concurrency` `#retry`

### Problem Statement
Implement `UpdateUserOptimistic` that uses a `version` column for optimistic locking. Read the current version, update only if version matches, increment version. Return `ErrConflict` if the row was modified by another writer. Implement a retry loop.

### Input / Output / Constraints
```
Input:  db *sql.DB, u User (with Version field), retries int
Output: updated User or ErrConflict after retries exhausted
Constraints: UPDATE WHERE id=$1 AND version=$2, check RowsAffected, retry loop
```

### Thought Process
1. Understand: Read version → update with version check → if RowsAffected==0 → someone else updated.
2. Pattern: SELECT → UPDATE WHERE version=v → check rows → retry.
3. Edge cases: Max retries exceeded, starvation under high contention.

### Brute Force
```go
// No retry, no conflict detection
func bruteForce(db *sql.DB, u User) error {
    _, err := db.Exec("UPDATE users SET name=$1, version=version+1 WHERE id=$2", u.Name, u.ID)
    return err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
var ErrConflict = errors.New("optimistic lock conflict")

func better(db *sql.DB, u User) error {
    res, err := db.Exec(
        "UPDATE users SET name=$1, version=$2+1 WHERE id=$3 AND version=$4",
        u.Name, u.Version, u.ID, u.Version,
    )
    if err != nil { return err }
    if n, _ := res.RowsAffected(); n == 0 {
        return ErrConflict
    }
    return nil
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "errors"
    "fmt"
    "time"
)

var ErrConflict = errors.New("optimistic lock conflict")

type VersionedUser struct {
    User
    Version int
}

// UpdateUserOptimistic — O(retries) time, O(1) space
func UpdateUserOptimistic(db *sql.DB, u VersionedUser, maxRetries int) (VersionedUser, error) {
    for attempt := 0; attempt <= maxRetries; attempt++ {
        // Read current state
        var current VersionedUser
        err := db.QueryRow(
            `SELECT id, name, email, version FROM users WHERE id = $1`, u.ID,
        ).Scan(&current.ID, &current.Name, &current.Email, &current.Version)
        if err != nil {
            return VersionedUser{}, fmt.Errorf("read: %w", err)
        }

        // Apply update with version check
        res, err := db.Exec(
            `UPDATE users SET name=$1, email=$2, version=version+1
             WHERE id=$3 AND version=$4`,
            u.Name, u.Email, u.ID, current.Version,
        )
        if err != nil {
            return VersionedUser{}, fmt.Errorf("update: %w", err)
        }
        if n, _ := res.RowsAffected(); n == 1 {
            u.Version = current.Version + 1
            return u, nil // success
        }
        // Version mismatch — another writer modified the row; retry
        if attempt < maxRetries {
            time.Sleep(time.Duration(attempt+1) * 10 * time.Millisecond)
        }
    }
    return VersionedUser{}, fmt.Errorf("after %d retries: %w", maxRetries, ErrConflict)
}

func main() {
    fmt.Println("UpdateUserOptimistic defined")
}
```
**Time:** O(retries) | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | No DB-level locking; high read throughput |
| Edge Cases | Starvation if contention is very high; use jitter in retry sleep |
| Error Handling | Return ErrConflict to caller after max retries; let caller decide |
| Memory | No locks held; minimal memory |
| Concurrency | Each goroutine reads and updates independently |

### Visual Explanation
```mermaid
flowchart TD
    A["Read user with version=3"] --> B["UPDATE WHERE version=3"]
    B --> C{RowsAffected==1?}
    C -- yes --> D["Success: version now 4"]
    C -- no --> E["Conflict: another writer changed version"]
    E --> F{retries left?}
    F -- yes --> G["sleep + retry from read"]
    F -- no --> H["return ErrConflict"]
```
```
Trace: read v=3 → UPDATE WHERE v=3 → another writer already set v=4 → rows=0 → retry → success
```

### Interviewer Questions
1. Why optimistic over pessimistic? No lock held; better throughput under low contention.
2. Can it be optimized? Skip re-read in retry; just re-attempt UPDATE with incremented version.
3. Scale to 10M? Optimistic works well at scale; conflicts rare if contention is low.
4. Edge cases? High contention → livelock; add jitter to sleep.
5. Goroutine-safe? Yes; no shared state between goroutines.
6. Memory impact? Negligible.
7. Alternative? Event sourcing; append-only log; no update conflicts.

### Follow-Up Questions
**Q1:** When to prefer pessimistic locking? **A1:** High contention; when retry cost is high (payment processing).
**Q2:** What is ABA problem? **A2:** Value changes A→B→A; version column prevents it (version monotonically increases).
**Q3:** What is a version column? **A3:** An integer incremented on every update; reader validates it hasn't changed.
**Q4:** How to implement version in DB schema? **A4:** version INTEGER NOT NULL DEFAULT 0; increment in every UPDATE.
**Q5:** What is Compare-And-Swap (CAS)? **A5:** Atomic operation: update only if current value equals expected; optimistic locking is software CAS.

---

---
## Q26: Connection Leak Detection  [Level 5 — Interview]
> **Tags:** `#connection-leak` `#debugging` `#db-stats` `#profiling`

### Problem Statement
Write `DetectConnectionLeak` that monitors `db.Stats().OpenConnections` over time in a background goroutine. Alert (log + increment metric) if open connections grow steadily without decreasing. Demonstrate a common leak (forgetting `rows.Close`) and the fix.

### Input / Output / Constraints
```
Input:  db *sql.DB, threshold int, interval time.Duration
Output: starts background monitor; logs leak warnings
Constraints: Use ticker, compare consecutive samples, goroutine-safe
```

### Thought Process
1. Understand: Leaked connections hold pool slots; eventually exhaust pool.
2. Pattern: Ticker → sample Stats → compare → alert if monotonically increasing.
3. Edge cases: Spike vs steady growth, threshold tuning.

### Brute Force
```go
// Check once — not a monitor
func bruteForce(db *sql.DB) {
    stats := db.Stats()
    if stats.OpenConnections > 20 {
        log.Println("WARNING: high connection count")
    }
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(ctx context.Context, db *sql.DB, threshold int) {
    go func() {
        ticker := time.NewTicker(5 * time.Second)
        defer ticker.Stop()
        var prev int
        for {
            select {
            case <-ctx.Done(): return
            case <-ticker.C:
                n := db.Stats().OpenConnections
                if n > threshold && n > prev {
                    log.Printf("LEAK WARNING: open conns growing: %d → %d", prev, n)
                }
                prev = n
            }
        }
    }()
}
```
**Time:** O(1) per tick | **Space:** O(1)

### Best Solution
```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "time"
)

// DetectConnectionLeak — monitors open connections in background
func DetectConnectionLeak(ctx context.Context, db *sql.DB, threshold int, interval time.Duration) {
    go func() {
        ticker := time.NewTicker(interval)
        defer ticker.Stop()
        samples := make([]int, 0, 5)
        for {
            select {
            case <-ctx.Done():
                return
            case <-ticker.C:
                stats := db.Stats()
                n := stats.OpenConnections
                samples = append(samples, n)
                if len(samples) > 5 {
                    samples = samples[1:]
                }
                // Alert if above threshold AND steadily growing
                if n > threshold && isMonotonicallyIncreasing(samples) {
                    log.Printf("CONNECTION LEAK ALERT: open=%d wait=%d inUse=%d",
                        n, stats.WaitCount, stats.InUse)
                }
            }
        }
    }()
}

func isMonotonicallyIncreasing(s []int) bool {
    if len(s) < 3 {
        return false
    }
    for i := 1; i < len(s); i++ {
        if s[i] <= s[i-1] {
            return false
        }
    }
    return true
}

// LEAK example — missing rows.Close
func LeakyQuery(db *sql.DB) error {
    rows, err := db.Query("SELECT id FROM users")
    if err != nil {
        return err
    }
    // BUG: forgot defer rows.Close() — connection held forever
    for rows.Next() {
        var id int
        rows.Scan(&id)
    }
    return nil // rows never closed!
}

// FIXED example
func FixedQuery(db *sql.DB) error {
    rows, err := db.Query("SELECT id FROM users")
    if err != nil {
        return err
    }
    defer rows.Close() // FIXED
    for rows.Next() {
        var id int
        rows.Scan(&id)
    }
    return rows.Err()
}

func main() {
    fmt.Println("DetectConnectionLeak defined")
}
```
**Time:** O(1) per tick | **Space:** O(1)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Monitor is lightweight; one goroutine per service |
| Edge Cases | Spikes are normal; only alert on sustained growth |
| Error Handling | Alert via log, Prometheus counter, PagerDuty |
| Memory | 5-sample sliding window; negligible |
| Concurrency | db.Stats() is goroutine-safe |

### Visual Explanation
```mermaid
flowchart TD
    A["ticker every 5s"] --> B["db.Stats().OpenConnections"]
    B --> C["append to 5-sample window"]
    C --> D{n > threshold AND monotonically increasing?}
    D -- yes --> E["log LEAK ALERT"]
    D -- no --> F["no action"]
    E & F --> A
```
```
Trace: [5,6,7,8,9] all increasing AND >threshold → ALERT
       [5,8,3,7,9] not monotonic → no alert (spike, not leak)
```

### Interviewer Questions
1. Why monitor Stats? Early warning before pool exhaustion.
2. Can it be optimized? Expose as Prometheus gauge; alert on rate of increase.
3. Scale to 10M? Each service instance monitors its own pool.
4. Edge cases? Load test spike looks like leak; use sustained growth filter.
5. Goroutine-safe? Stats is safe; goroutine uses no shared mutable state.
6. Memory impact? 5-sample slice; negligible.
7. Alternative? pprof goroutine dump; goleak in tests.

### Follow-Up Questions
**Q1:** What are the most common causes of connection leaks? **A1:** Forgetting rows.Close, tx.Commit/Rollback, or returning early without cleanup.
**Q2:** How to catch leaks in tests? **A2:** Use goleak library: goleak.VerifyNone(t) asserts no goroutine leaks.
**Q3:** What does db.Stats().WaitCount indicate? **A3:** Total queries that waited for a free connection; high = pool saturation.
**Q4:** How does context cancellation help? **A4:** If caller context is cancelled, query returns; no orphaned connection.
**Q5:** What is a goroutine leak? **A5:** Goroutine blocked indefinitely; holds resources; similar concept to connection leak.

---

---
## Q27: Soft Delete Pattern  [Level 6 — Production]
> **Tags:** `#soft-delete` `#deleted-at` `#audit` `#filter`

### Problem Statement
Implement soft delete for the `users` table using a `deleted_at TIMESTAMP` column. Write `SoftDeleteUser`, `ListActiveUsers` (excludes deleted), and `ListAllUsers` (includes deleted). Show how to add a partial index for performance and why soft delete aids auditing.

### Input / Output / Constraints
```
Input:  db *sql.DB, userID int
Output: SoftDeleteUser sets deleted_at=NOW(); queries filter by deleted_at IS NULL
Constraints: Partial index on deleted_at IS NULL, never actually DELETE rows
```

### Thought Process
1. Understand: Soft delete preserves audit trail; hard delete is irreversible.
2. Pattern: UPDATE deleted_at=NOW() instead of DELETE; filter WHERE deleted_at IS NULL.
3. Edge cases: Already deleted user, unique email constraint on active users only.

### Brute Force
```go
// Hard delete — irreversible, loses audit trail
func bruteForce(db *sql.DB, id int) error {
    _, err := db.Exec("DELETE FROM users WHERE id=$1", id)
    return err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
func better(db *sql.DB, id int) error {
    _, err := db.Exec("UPDATE users SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL", id)
    return err
}
```
**Time:** O(1) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "errors"
    "fmt"
)

// SoftDeleteUser — O(1) time, O(1) space
func SoftDeleteUser(db *sql.DB, userID int) error {
    res, err := db.Exec(
        `UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        userID,
    )
    if err != nil {
        return fmt.Errorf("SoftDeleteUser: %w", err)
    }
    if n, _ := res.RowsAffected(); n == 0 {
        return fmt.Errorf("user %d: %w", userID, ErrNotFound)
    }
    return nil
}

// ListActiveUsers — excludes soft-deleted rows
func ListActiveUsers(db *sql.DB) ([]User, error) {
    const q = `SELECT id, name, email FROM users WHERE deleted_at IS NULL ORDER BY id`
    rows, err := db.Query(q)
    if err != nil {
        return nil, fmt.Errorf("ListActiveUsers: %w", err)
    }
    defer rows.Close()
    return scanUsers(rows)
}

// ListAllUsers — includes deleted; for admin/audit views
func ListAllUsers(db *sql.DB) ([]User, error) {
    const q = `SELECT id, name, email FROM users ORDER BY id`
    rows, err := db.Query(q)
    if err != nil {
        return nil, fmt.Errorf("ListAllUsers: %w", err)
    }
    defer rows.Close()
    return scanUsers(rows)
}

// Schema with partial index for performance:
// CREATE INDEX idx_users_active ON users(id) WHERE deleted_at IS NULL;
// CREATE UNIQUE INDEX idx_users_email_active ON users(email) WHERE deleted_at IS NULL;

func main() {
    fmt.Println("Soft delete pattern defined")
}
```
**Time:** O(n) list | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Partial index on deleted_at IS NULL keeps active queries fast |
| Edge Cases | Re-activation: set deleted_at=NULL; unique email only among active users |
| Error Handling | Already-deleted returns ErrNotFound to prevent double-delete |
| Memory | Deleted rows accumulate; archive to cold storage periodically |
| Concurrency | UPDATE is atomic; safe for concurrent soft deletes |

### Visual Explanation
```mermaid
flowchart TD
    A["SoftDeleteUser(id)"] --> B["UPDATE SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL"]
    B --> C{RowsAffected==1?}
    C -- no --> D["ErrNotFound (already deleted or not exists)"]
    C -- yes --> E["User soft-deleted"]

    F["ListActiveUsers"] --> G["WHERE deleted_at IS NULL"]
    G --> H["Uses partial index → fast"]
```
```
Trace: DELETE id=5 → UPDATE deleted_at=NOW() → row hidden from active queries
```

### Interviewer Questions
1. Why soft delete? Audit trail, recovery, compliance requirements.
2. Can it be optimized? Partial index on active rows; archived deleted rows to separate table.
3. Scale to 10M? Table bloats with deleted rows; periodic archival job.
4. Edge cases? UNIQUE constraint on email must be partial (active only).
5. Goroutine-safe? Yes.
6. Memory impact? Table grows over time; monitor and archive.
7. Alternative? Event sourcing; never update records, only append events.

### Follow-Up Questions
**Q1:** How to create unique email for active users only? **A1:** CREATE UNIQUE INDEX ON users(email) WHERE deleted_at IS NULL.
**Q2:** How to restore a soft-deleted user? **A2:** UPDATE users SET deleted_at=NULL WHERE id=$1.
**Q3:** What is the performance impact of soft delete? **A3:** All queries need WHERE deleted_at IS NULL; partial index mitigates.
**Q4:** When to archive deleted rows? **A4:** When table size or query performance degrades; move to archive_users table.
**Q5:** What is GDPR impact? **A5:** GDPR right-to-erasure may require hard delete despite soft delete preference.

---

---
## Q28: Full-Text Search  [Level 6 — Production]
> **Tags:** `#full-text-search` `#tsvector` `#tsquery` `#gin-index`

### Problem Statement
Implement `SearchUsersByName` using PostgreSQL full-text search with `tsvector` and `tsquery`. Add a GIN index on the tsvector column. Compare with ILIKE for performance. Show how to highlight matches with `ts_headline`.

### Input / Output / Constraints
```
Input:  db *sql.DB, query string
Output: []User sorted by relevance (ts_rank)
Constraints: Use to_tsvector, plainto_tsquery, GIN index, return rank score
```

### Thought Process
1. Understand: Full-text search tokenizes and stems words; faster and smarter than LIKE.
2. Pattern: to_tsvector column @@ plainto_tsquery → ts_rank for ordering.
3. Edge cases: Empty query, special characters, multiple languages.

### Brute Force
```go
// ILIKE — slow full scan, no stemming
func bruteForce(db *sql.DB, q string) ([]User, error) {
    rows, err := db.Query(
        "SELECT id,name,email FROM users WHERE name ILIKE $1", "%"+q+"%",
    )
    if err != nil { return nil, err }
    defer rows.Close()
    return scanUsers(rows)
}
```
**Time:** O(n) full scan | **Space:** O(n)

### Better Solution
```go
// Full-text search with ranking
func better(db *sql.DB, query string) ([]User, error) {
    const q = `
        SELECT id, name, email
        FROM users
        WHERE to_tsvector('english', name) @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank(to_tsvector('english', name), plainto_tsquery('english', $1)) DESC`
    rows, err := db.Query(q, query)
    if err != nil { return nil, err }
    defer rows.Close()
    return scanUsers(rows)
}
```
**Time:** O(log n) with GIN | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "fmt"
)

type UserSearchResult struct {
    User
    Rank     float64
    Headline string
}

// SearchUsersByName — O(log n) time with GIN index, O(n) space
func SearchUsersByName(db *sql.DB, query string) ([]UserSearchResult, error) {
    if query == "" {
        return nil, nil
    }
    const q = `
        SELECT
            u.id,
            u.name,
            u.email,
            ts_rank(to_tsvector('english', u.name), plainto_tsquery('english', $1)) AS rank,
            ts_headline('english', u.name, plainto_tsquery('english', $1),
                'StartSel=<b>, StopSel=</b>, MaxWords=10') AS headline
        FROM users u
        WHERE to_tsvector('english', u.name) @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT 20`

    rows, err := db.Query(q, query)
    if err != nil {
        return nil, fmt.Errorf("SearchUsersByName: %w", err)
    }
    defer rows.Close()

    var results []UserSearchResult
    for rows.Next() {
        var r UserSearchResult
        if err := rows.Scan(&r.ID, &r.Name, &r.Email, &r.Rank, &r.Headline); err != nil {
            return nil, fmt.Errorf("scan: %w", err)
        }
        results = append(results, r)
    }
    return results, rows.Err()
}

// Schema:
// ALTER TABLE users ADD COLUMN name_tsv tsvector
//     GENERATED ALWAYS AS (to_tsvector('english', name)) STORED;
// CREATE INDEX idx_users_name_gin ON users USING GIN(name_tsv);

func main() {
    fmt.Println("SearchUsersByName full-text search defined")
}
```
**Time:** O(log n) with GIN | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | GIN index makes FTS fast; ILIKE does full scan |
| Edge Cases | Special chars in query: use websearch_to_tsquery for user-facing search |
| Error Handling | Invalid tsquery syntax returns error; validate or sanitize input |
| Memory | GIN index is larger than B-tree; plan index storage |
| Concurrency | Read-only; route to read replica |

### Visual Explanation
```mermaid
flowchart TD
    A["SearchUsersByName('alice')"] --> B["plainto_tsquery → 'alice':tsquery"]
    B --> C["GIN index lookup on name_tsv"]
    C --> D["Matching rows"]
    D --> E["ts_rank for relevance score"]
    E --> F["ts_headline for highlighted snippet"]
    F --> G["ORDER BY rank DESC LIMIT 20"]
```
```
Trace: query="alice" → tsquery='alice' → GIN → [Alice Johnson, Alice Wong] → ranked → returned
```

### Interviewer Questions
1. Why FTS over ILIKE? Stemming, ranking, GIN index support; ILIKE is sequential scan.
2. Can it be optimized? Generated stored tsvector column with GIN index.
3. Scale to 10M? Elasticsearch for advanced search; PostgreSQL FTS adequate for 10M rows.
4. Edge cases? Multi-language content needs per-language tsvector config.
5. Goroutine-safe? Read-only query; safe.
6. Memory impact? GIN index size ~20-30% of data size.
7. Alternative? pg_trgm extension for trigram-based search (good for partial matches).

### Follow-Up Questions
**Q1:** What is tsvector? **A1:** Preprocessed document representation: lexemes with positions and weights.
**Q2:** What is tsquery? **A2:** Parsed search query with AND/OR/NOT operators and stemmed terms.
**Q3:** What is ts_rank? **A3:** Relevance score based on term frequency and position in document.
**Q4:** What is GIN index? **A4:** Generalized Inverted iNdex; optimal for FTS, JSONB, array columns.
**Q5:** What is websearch_to_tsquery? **A5:** Accepts Google-style queries with quotes and minus; safer for user input.

---

---
## Q29: JSONB Queries  [Level 6 — Production]
> **Tags:** `#jsonb` `#postgres` `#json-operators` `#flexible-schema`

### Problem Statement
Write `GetUsersByMetadata` that queries users with a `metadata JSONB` column. Use PostgreSQL JSONB operators (`->`, `->>`, `@>`) to filter users where `metadata->>'role' = 'admin'`. Show how to index JSONB paths with GIN and extract nested values.

### Input / Output / Constraints
```
Input:  db *sql.DB, role string
Output: []User where metadata->>'role' = role
Constraints: Use ->> operator, GIN index on metadata, handle missing keys
```

### Thought Process
1. Understand: JSONB stores JSON in binary format; supports indexing and operators.
2. Pattern: WHERE metadata->>'role' = $1 or metadata @> '{"role":"admin"}'.
3. Edge cases: Missing key returns NULL (not error), malformed JSON on insert.

### Brute Force
```go
// Full scan without index
func bruteForce(db *sql.DB, role string) ([]User, error) {
    rows, err := db.Query(
        "SELECT id,name,email FROM users WHERE metadata->>'role' = $1", role,
    )
    if err != nil { return nil, err }
    defer rows.Close()
    return scanUsers(rows)
}
```
**Time:** O(n) | **Space:** O(n)

### Better Solution
```go
// @> containment operator — uses GIN index
func better(db *sql.DB, role string) ([]User, error) {
    rows, err := db.Query(
        "SELECT id,name,email FROM users WHERE metadata @> jsonb_build_object('role', $1::text)",
        role,
    )
    if err != nil { return nil, err }
    defer rows.Close()
    return scanUsers(rows)
}
```
**Time:** O(log n) with GIN | **Space:** O(n)

### Best Solution
```go
package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
)

type UserWithMeta struct {
    User
    Metadata map[string]interface{}
}

// GetUsersByMetadata — O(log n) with GIN index, O(n) space
func GetUsersByMetadata(db *sql.DB, role string) ([]UserWithMeta, error) {
    // @> (containment) operator uses GIN index efficiently
    const q = `
        SELECT id, name, email, metadata
        FROM users
        WHERE metadata @> jsonb_build_object('role', $1::text)
        ORDER BY id`

    rows, err := db.Query(q, role)
    if err != nil {
        return nil, fmt.Errorf("GetUsersByMetadata: %w", err)
    }
    defer rows.Close()

    var results []UserWithMeta
    for rows.Next() {
        var u UserWithMeta
        var metaBytes []byte
        if err := rows.Scan(&u.ID, &u.Name, &u.Email, &metaBytes); err != nil {
            return nil, fmt.Errorf("scan: %w", err)
        }
        if err := json.Unmarshal(metaBytes, &u.Metadata); err != nil {
            return nil, fmt.Errorf("unmarshal metadata: %w", err)
        }
        results = append(results, u)
    }
    return results, rows.Err()
}

// UpdateUserMetadataField — set a single JSONB field atomically
func UpdateUserMetadataField(db *sql.DB, userID int, key, value string) error {
    _, err := db.Exec(
        `UPDATE users SET metadata = metadata || jsonb_build_object($1::text, $2::text) WHERE id = $3`,
        key, value, userID,
    )
    return err
}

// Schema:
// ALTER TABLE users ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';
// CREATE INDEX idx_users_metadata_gin ON users USING GIN(metadata);

func main() {
    fmt.Println("JSONB queries defined")
}
```
**Time:** O(log n) with GIN | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | GIN index on metadata enables fast JSONB path queries |
| Edge Cases | Missing key returns NULL; use COALESCE(metadata->>'role', 'user') |
| Error Handling | Invalid JSON on insert rejected by DB; validate before insert |
| Memory | JSONB stored in binary; efficient storage |
| Concurrency | || operator is atomic; safe for concurrent field updates |

### Visual Explanation
```mermaid
flowchart TD
    A["GetUsersByMetadata('admin')"] --> B["jsonb_build_object('role','admin')"]
    B --> C["WHERE metadata @> {role:admin}"]
    C --> D["GIN index lookup"]
    D --> E["Matching rows"]
    E --> F["Scan metadata bytes"]
    F --> G["json.Unmarshal into map"]
    G --> H["return []UserWithMeta"]
```
```
Trace: metadata={"role":"admin","tier":"gold"} @> {"role":"admin"} → match
       metadata={"role":"user"} @> {"role":"admin"} → no match
```

### Interviewer Questions
1. Why @> over ->>? @> uses GIN index; ->> requires expression index.
2. Can it be optimized? jsonb_path_ops GIN index smaller and faster for containment.
3. Scale to 10M? GIN index handles large JSONB columns efficiently.
4. Edge cases? JSONB key names are case-sensitive; consistent naming convention needed.
5. Goroutine-safe? Yes; read query.
6. Memory impact? JSONB in DB ~20% larger than plain JSON.
7. Alternative? Normalize common fields to columns; use JSONB only for truly variable data.

### Follow-Up Questions
**Q1:** What is the difference between -> and ->>? **A1:** -> returns JSONB; ->> returns text (extracts as string).
**Q2:** When to use JSONB vs separate columns? **A2:** Separate columns for frequently queried fields; JSONB for variable/optional attributes.
**Q3:** What is jsonb_path_ops? **A3:** Alternative GIN opclass optimized for containment queries; smaller index.
**Q4:** How to query nested JSONB? **A4:** metadata -> 'address' ->> 'city' = 'Mumbai' or jsonpath: metadata @? '$.address.city ? (@ == "Mumbai")'.
**Q5:** How to update a nested JSONB field? **A5:** jsonb_set(metadata, '{address,city}', '"Mumbai"').

---

---
## Q30: Event Store Pattern  [Level 6 — Production]
> **Tags:** `#event-store` `#event-sourcing` `#append-only` `#cqrs`

### Problem Statement
Implement an append-only `EventStore` that persists domain events (type, payload, aggregate_id, version) to a PostgreSQL `events` table. Write `AppendEvent` and `LoadEvents` for an aggregate. Show how version guarantees ordering and prevents conflicts.

### Input / Output / Constraints
```
Input:  db *sql.DB, aggregateID string, eventType string, payload []byte, expectedVersion int
Output: error (ErrVersionConflict if version mismatch)
Constraints: INSERT with version check, SELECT ordered by version, append-only table
```

### Thought Process
1. Understand: Event sourcing stores state changes as immutable events; replay to reconstruct state.
2. Pattern: INSERT with expected version check (optimistic); SELECT ORDER BY version to replay.
3. Edge cases: Concurrent appends at same version, large payload, missing aggregate.

### Brute Force
```go
// No version check — allows duplicate version numbers
func bruteForce(db *sql.DB, aggID, evType string, payload []byte) error {
    _, err := db.Exec(
        "INSERT INTO events(aggregate_id, event_type, payload) VALUES($1,$2,$3)",
        aggID, evType, payload,
    )
    return err
}
```
**Time:** O(1) | **Space:** O(1)

### Better Solution
```go
var ErrVersionConflict = errors.New("version conflict")

func better(db *sql.DB, aggID string, expectedVer int, evType string, payload []byte) error {
    _, err := db.Exec(`
        INSERT INTO events(aggregate_id, version, event_type, payload)
        SELECT $1, COALESCE(MAX(version),0)+1, $3, $4
        FROM events WHERE aggregate_id=$1
        HAVING COALESCE(MAX(version),0) = $2`,
        aggID, expectedVer, evType, payload,
    )
    return err
}
```
**Time:** O(log n) | **Space:** O(1)

### Best Solution
```go
package main

import (
    "database/sql"
    "errors"
    "fmt"
    "time"
)

var ErrVersionConflict = errors.New("version conflict")

type Event struct {
    ID          int64
    AggregateID string
    Version     int
    EventType   string
    Payload     []byte
    OccurredAt  time.Time
}

// AppendEvent — O(log n) time, O(1) space
func AppendEvent(db *sql.DB, aggregateID, eventType string, payload []byte, expectedVersion int) error {
    // UNIQUE(aggregate_id, version) prevents concurrent duplicates
    const q = `
        INSERT INTO events(aggregate_id, version, event_type, payload, occurred_at)
        VALUES($1,
            (SELECT COALESCE(MAX(version), 0) + 1 FROM events WHERE aggregate_id = $1),
            $2, $3, NOW())
        WHERE (SELECT COALESCE(MAX(version), 0) FROM events WHERE aggregate_id = $1) = $4`

    res, err := db.Exec(q, aggregateID, eventType, payload, expectedVersion)
    if err != nil {
        // UNIQUE violation = concurrent write at same version
        return fmt.Errorf("AppendEvent: %w", err)
    }
    if n, _ := res.RowsAffected(); n == 0 {
        return fmt.Errorf("aggregate %s at version %d: %w",
            aggregateID, expectedVersion, ErrVersionConflict)
    }
    return nil
}

// LoadEvents — O(n) time, O(n) space — replay all events for aggregate
func LoadEvents(db *sql.DB, aggregateID string) ([]Event, error) {
    const q = `
        SELECT id, aggregate_id, version, event_type, payload, occurred_at
        FROM events
        WHERE aggregate_id = $1
        ORDER BY version ASC`

    rows, err := db.Query(q, aggregateID)
    if err != nil {
        return nil, fmt.Errorf("LoadEvents: %w", err)
    }
    defer rows.Close()

    var events []Event
    for rows.Next() {
        var e Event
        if err := rows.Scan(&e.ID, &e.AggregateID, &e.Version,
            &e.EventType, &e.Payload, &e.OccurredAt); err != nil {
            return nil, fmt.Errorf("LoadEvents scan: %w", err)
        }
        events = append(events, e)
    }
    return events, rows.Err()
}

// Schema:
// CREATE TABLE events (
//     id           BIGSERIAL PRIMARY KEY,
//     aggregate_id TEXT NOT NULL,
//     version      INT NOT NULL,
//     event_type   TEXT NOT NULL,
//     payload      JSONB NOT NULL,
//     occurred_at  TIMESTAMP NOT NULL DEFAULT NOW(),
//     UNIQUE(aggregate_id, version)
// );
// CREATE INDEX idx_events_aggregate ON events(aggregate_id, version);

func main() {
    fmt.Println("EventStore AppendEvent and LoadEvents defined")
}
```
**Time:** O(log n) append, O(n) load | **Space:** O(n)

### Production Considerations
| Aspect | Details |
|--------|---------|
| Scalability | Append-only; no UPDATE contention; scales to millions of events |
| Edge Cases | UNIQUE(aggregate_id, version) prevents split-brain concurrent writes |
| Error Handling | UNIQUE violation → ErrVersionConflict → caller retries with new version |
| Memory | Events never deleted; use table partitioning by time for archival |
| Concurrency | Optimistic concurrency via version; no locks needed |

### Visual Explanation
```mermaid
flowchart TD
    A["AppendEvent(aggID, 'UserUpdated', payload, expectedVersion=3)"] --> B["SELECT MAX(version) FROM events WHERE aggregate_id=$1"]
    B --> C{MAX(version)==3?}
    C -- no --> D["ErrVersionConflict"]
    C -- yes --> E["INSERT version=4"]
    E --> F["UNIQUE constraint guards against race"]
    F --> G["Event persisted"]

    H["LoadEvents(aggID)"] --> I["SELECT * ORDER BY version ASC"]
    I --> J["Replay events to rebuild state"]
```
```
Trace: v0 → UserCreated → v1 → EmailChanged → v2 → NameUpdated → v3 → replay = current state
```

### Interviewer Questions
1. Why append-only? Immutable audit log; replay enables time-travel debugging.
2. Can it be optimized? Snapshots every N events to avoid full replay.
3. Scale to 10M? Partition events table by time; use Kafka for event streaming.
4. Edge cases? Large payloads: store in S3, reference by key in events table.
5. Goroutine-safe? UNIQUE constraint serializes concurrent appends.
6. Memory impact? Events accumulate; snapshot + archive old events.
7. Alternative? EventStoreDB, Kafka topics with log compaction.

### Follow-Up Questions
**Q1:** What is event sourcing? **A1:** State derived by replaying ordered sequence of immutable events.
**Q2:** What is a snapshot? **A2:** Checkpoint of aggregate state at version N; skip replaying all earlier events.
**Q3:** What is CQRS with event sourcing? **A3:** Commands write events; queries read from projections (read models) built from events.
**Q4:** How to handle schema evolution of events? **A4:** Version event types; upcasters transform old event schemas to new.
**Q5:** What is eventual consistency? **A5:** Read models may lag behind event stream; briefly stale but consistent eventually.

---

## Company-Style Questions

### Google Style (3Q — algorithm focused)

**G1:** Given a `users` table with 100M rows and a query `SELECT * FROM users WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 20`, a BTREE index on `created_at` exists but query is slow. Walk through your diagnosis: explain the query plan, identify why the index may not be used, and propose the fix.

**Answer:** Run `EXPLAIN (ANALYZE, BUFFERS)`. If the planner estimates many matching rows it may prefer a seq scan. Fix: ensure statistics are current (`ANALYZE users`), verify index exists with correct column order, consider a covering index `(created_at DESC, id, name, email)` to avoid heap fetches. If range is large, cursor-based pagination eliminates the sort entirely.

**G2:** Design an in-memory LRU cache in Go backed by a Redis hash for persistence. The cache should: hold 1000 entries in-process, fall through to Redis on miss, fall through to PostgreSQL on Redis miss, write-through on insert. Describe the data structures and concurrency primitives needed.

**Answer:** Go layer: `sync.RWMutex` + `container/list` + `map[string]*list.Element` for LRU eviction. Redis layer: `HGET/HSET` with TTL. DB layer: `QueryRow`. Write-through: on DB hit, write to Redis (SETEX), then to local cache. Eviction: on local cap hit, remove LRU element, optionally delete from Redis. Key insight: RWMutex allows concurrent reads; write lock only on eviction or new insert.

**G3:** You need to perform a `JOIN` across two tables that each have 50M rows: `orders(id, user_id, amount, created_at)` and `users(id, name, country)`. The query filters by `users.country = 'IN'` and `orders.created_at > NOW() - INTERVAL '30 days'`. How do you optimize this query for sub-second response?

**Answer:** Indexes needed: `users(country, id)` partial index or regular; `orders(created_at, user_id)` composite. The planner should drive from the filtered side (fewer rows). Use `EXPLAIN` to verify Hash Join vs Nested Loop. If `country='IN'` returns 10% of users, index on users.country reduces the scan. Partial index `WHERE country='IN'` can be even faster. Partition orders by created_at range to eliminate historical partitions. Consider materialized view refreshed hourly for dashboard queries.

---

### Uber Style (3Q — real-time systems)

**U1:** Uber's dispatch system assigns drivers to riders with sub-100ms latency. How would you design the DB schema and queries for matching available drivers within 2km of a rider? What PostgreSQL extensions would you use?

**Answer:** Use PostGIS extension: `drivers(id, location GEOGRAPHY(POINT), status TEXT)`. Query: `SELECT id, ST_Distance(location, ST_MakePoint($lon,$lat)::geography) AS dist FROM drivers WHERE status='available' AND ST_DWithin(location, ST_MakePoint($lon,$lat)::geography, 2000) ORDER BY dist LIMIT 5`. Index: `CREATE INDEX idx_drivers_location ON drivers USING GIST(location) WHERE status='available'`. Redis GEOADD/GEORADIUS for sub-millisecond lookups with eventual consistency fallback to PostGIS.

**U2:** Uber needs idempotent trip creation — if the mobile client retries the same request (network drop), the second call should return the existing trip, not create a duplicate. Design the DB schema and Go implementation.

**Answer:** Add `idempotency_key UUID UNIQUE` column to trips table. Client generates UUID before the request and sends it in the header. Server: `INSERT INTO trips(idempotency_key, ...) VALUES($1, ...) ON CONFLICT (idempotency_key) DO UPDATE SET last_seen_at=NOW() RETURNING *`. If RowsAffected==0 and conflict occurred, SELECT the existing trip and return it. Store idempotency keys with TTL in Redis for fast dedup before hitting DB.

**U3:** Design a surge pricing system that recalculates multiplier every 30 seconds based on demand/supply ratio in a city zone. The calculation reads from a `rides_requested` counter and a `drivers_available` counter, both stored in Redis. How do you ensure the recalculation is correct under concurrent writes?

**Answer:** Use Redis Lua script to atomically read both counters and compute ratio: `local demand = redis.call('GET', KEYS[1]); local supply = redis.call('GET', KEYS[2]); return demand/supply`. Store result in `surge:zone:{id}` key with 30s TTL. Use a dedicated goroutine with ticker for recalculation; only one instance recalculates using Redis `SET NX` distributed lock. Write surge multiplier back to Redis; read it in dispatch path from Redis cache, not DB.

---

### Amazon Style (3Q — distributed/reliability)

**A1:** An AWS Lambda function writes order events to RDS PostgreSQL. Under high load (10K events/sec), connection pool exhaustion causes 503 errors. The Lambda has 500 concurrent instances, each opening its own DB connection. How do you fix this architectural issue?

**Answer:** Lambda cannot maintain persistent connection pools. Solution: use RDS Proxy — it pools connections at the proxy layer; Lambda instances connect to proxy, which maintains a small pool to RDS. Configure RDS Proxy max connections based on RDS instance class. Alternatively, use SQS queue between Lambda and DB writer: Lambda writes to SQS, single consumer writes to DB in batches. This decouples burst traffic from DB connection limits.

**A2:** You need 99.99% uptime for a payment write API backed by PostgreSQL. Design the failover strategy. Consider: primary-replica setup, health checks, automatic failover, data loss risk.

**Answer:** Use AWS RDS Multi-AZ with synchronous replication — RPO=0 (no data loss). RDS promotes replica automatically on primary failure (typically 30-60s RTO). Application uses a single DNS endpoint that RDS updates; Go app uses `db.PingContext` with retry loop on startup. For RPO=0 guarantee in Go: retry failed writes with idempotency key for the failover window. Add circuit breaker: if >50% of requests fail for 10s, open circuit and return 503 rather than queueing.

**A3:** During a database migration (adding a NOT NULL column with default), the table lock blocks production writes for 30 seconds on a 50M row table. How do you perform this migration with zero downtime?

**Answer:** Phase 1: `ALTER TABLE orders ADD COLUMN discount_pct NUMERIC DEFAULT 0` — this is fast; new column is nullable with default. Phase 2: Backfill in batches: `UPDATE orders SET discount_pct=0 WHERE id BETWEEN $1 AND $2 AND discount_pct IS NULL` in 1000-row batches with small sleeps. Phase 3: `ALTER TABLE orders ALTER COLUMN discount_pct SET NOT NULL` — fast in PostgreSQL 12+ when no NULLs remain. Deploy app code that handles both old schema (no column) and new schema concurrently.

---

### Stripe Style (2Q — payment/correctness)

**S1:** Stripe processes $1B/day in payments. Describe how you would implement idempotent payment processing in Go+PostgreSQL, ensuring that network retries never charge a customer twice.

**Answer:** Schema: `payments(id, idempotency_key UUID UNIQUE, user_id, amount, status, created_at)`. Handler: extract `Idempotency-Key` header. Use `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, status`. If no row returned (conflict), SELECT existing payment and return its current status. Process payment only if status='pending'. Use SELECT FOR UPDATE to lock the row during processing and prevent duplicate processing from concurrent retries. Record successful charge in same transaction: `UPDATE payments SET status='completed', processor_ref=$1 WHERE id=$2 AND status='pending'`. If RowsAffected==0, another process completed it; return existing state.

**S2:** Stripe needs to reconcile payment events from a bank with its own ledger. Both tables have millions of rows and the reconciliation query must run within 5 minutes on a 32-core RDS instance. Design the SQL and Go orchestration for parallel reconciliation.

**Answer:** Partition reconciliation by date: split date range into N chunks, one per goroutine. Each goroutine runs: `SELECT p.id, p.amount, b.amount FROM payments p FULL OUTER JOIN bank_events b ON p.bank_ref=b.ref WHERE p.created_at::date=$1 AND (p.amount!=b.amount OR b.ref IS NULL OR p.bank_ref IS NULL)`. Use `errgroup.WithContext` for parallel execution with shared context cancellation. Index: `payments(bank_ref, created_at)`, `bank_events(ref, event_date)`. Write discrepancies to `reconciliation_issues` table. Limit goroutines to GOMAXPROCS to avoid overwhelming DB with parallel connections.

---

### Razorpay Style (2Q — payment APIs/Indian banking)

**R1:** Razorpay processes UPI payments that must complete in under 30 seconds per NPCI mandate. A Go service receives a UPI callback, updates payment status, and triggers a webhook. The webhook delivery may fail (retry needed). Design the DB schema and Go implementation ensuring at-least-once webhook delivery without duplicate charges.

**Answer:** Schema: `payments(id, upi_txn_id UNIQUE, status, amount, updated_at)`, `webhook_jobs(id, payment_id, url, attempts, last_attempt_at, status, payload JSONB)`. UPI callback handler: `UPDATE payments SET status=$1 WHERE upi_txn_id=$2 AND status='pending' RETURNING id`. If RowsAffected==1: `INSERT INTO webhook_jobs(payment_id, url, payload) VALUES(...)`. Worker: poll `webhook_jobs WHERE status='pending' AND last_attempt_at < NOW()-INTERVAL '30s' ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED`. Deliver webhook, update `attempts++, last_attempt_at=NOW()`. On success: `status='delivered'`. On 3 failures: `status='failed'`, alert. SKIP LOCKED enables multiple worker pods without double-delivery.

**R2:** Razorpay's settlement engine needs to compute daily payouts to 50,000 merchants every night. Each merchant's payout = sum of successful payments in the last 24 hours minus platform fee. The computation must complete in under 10 minutes and generate an audit trail. Design the SQL and Go implementation.

**Answer:** Single SQL CTE: `WITH settlements AS (SELECT merchant_id, SUM(amount) AS gross, SUM(amount*0.02) AS fee, SUM(amount*0.98) AS net FROM payments WHERE status='success' AND created_at BETWEEN $1 AND $2 GROUP BY merchant_id) INSERT INTO payout_batches(merchant_id, gross, fee, net, period_start, period_end, status) SELECT merchant_id, gross, fee, net, $1, $2, 'pending' FROM settlements RETURNING *`. Run in one query — DB does the aggregation. Go orchestration: single goroutine runs the CTE at midnight, then spawns worker goroutines (`errgroup`) to initiate IMPS/NEFT transfers per batch row, update status='processing'. Index: `payments(merchant_id, status, created_at)` covering index. Estimated time: aggregate 50K merchants from 10M rows ~2-3 minutes with proper indexing.

---
