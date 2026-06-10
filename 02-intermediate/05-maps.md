# Go Maps

## What Is This?

A map in Go is a built-in hash table data structure that associates keys with values, providing average O(1) time complexity for insertions, lookups, and deletions. It is a reference type — the variable itself holds a pointer to the underlying hash table, not the data directly. Maps can use any comparable type as a key (strings, integers, structs without slices/maps/functions) and any type as a value.

## Why Does It Exist?

Before maps, the only way to do key-based lookup in most languages was linear search through slices (O(n)), which becomes unacceptable at scale. The Go designers built maps directly into the language — not as a library type — because associative lookup is so fundamental that it needs first-class syntax support (`m[key]`, `delete(m, key)`, range iteration). The alternative (writing a hash table from scratch every time, or depending on a third-party library with no standardized interface) was exactly the fragmented landscape Go was designed to escape. The design decision to make maps a reference type (not a value type like structs) was deliberate: passing a map to a function should share the same underlying data, not copy it.

## Who Uses This in Industry?

- **Google**: Internal service meshes and RPC routing tables use maps to resolve service names to endpoint addresses at microsecond speed. Every gRPC load balancer maintains a `map[string][]Endpoint` internally.
- **Uber**: The driver-dispatch system maps `rideID -> driverState` in memory for sub-millisecond assignment decisions. Their Go microservices process millions of these lookups per second.
- **Kubernetes**: The API server's internal object cache (`k8s.io/client-go/tools/cache`) is built on maps keyed by namespace/name. Every `kubectl get pod` triggers a map lookup, not a database query.
- **Cloudflare**: Their Go-based DNS resolver maintains an in-memory `map[string][]DNSRecord` for the hottest domains, handling 50+ million DNS queries per second.
- **Docker**: The container runtime maps container IDs to running process metadata — the entire container lifecycle management is orchestrated through maps.
- **HashiCorp Consul**: Service discovery is literally a map: `map[serviceName][]ServiceInstance`. Every Consul agent maintains this map locally and syncs it via gossip protocol.

## Industry Standards & Best Practices

**What senior engineers do:**

1. Always use the comma-ok idiom (`v, ok := m[key]`) when the key may not exist — never assume a zero value means "not found" vs "found and is zero."
2. Pre-size maps with `make(map[K]V, expectedSize)` to avoid repeated rehashing when the final size is roughly known.
3. Protect shared maps with `sync.RWMutex` (read-heavy workloads) or `sync.Map` (write-once-read-many or high-contention scenarios) — never share a plain map across goroutines without synchronization.
4. Use `map[string]struct{}` for sets, not `map[string]bool` — `struct{}` consumes zero bytes.
5. For high-throughput concurrent workloads, use sharded maps to reduce lock contention instead of one global mutex.

**What beginners do wrong:**

1. Write to a nil map and panic in production.
2. Assume map iteration order is stable between runs.
3. Share a map across goroutines without synchronization ("it worked in testing" — only because the race wasn't triggered yet).
4. Use `map[string]bool` for sets and wonder why memory is higher than expected.

## Why Go's Approach Is Unique

**vs Python**: Python's `dict` has been ordered (insertion order) since Python 3.7. Go deliberately keeps maps unordered — iteration order is randomized on purpose (starting Go 1.0, explicitly since 1.1) to prevent developers from accidentally depending on an implementation detail that could change. This forced correctness is a Go design value.

**vs Java**: Java's `HashMap` is also unordered, but Java provides `LinkedHashMap` (insertion order) and `TreeMap` (sorted) in the standard library. Go provides neither in stdlib — if you need ordering, you sort keys yourself or use a slice of pairs. The tradeoff: Go's stdlib stays minimal, forcing explicit intent.

**vs JavaScript**: JS object property access (`obj[key]`) and `Map` both exist. Go collapses this into one consistent construct with explicit syntax.

**The concurrency tradeoff**: Java's `ConcurrentHashMap` is thread-safe by default. Go chose to make plain maps NOT thread-safe. This was intentional: making every map operation take a lock would impose overhead on the (majority) single-goroutine use case to protect the (minority) concurrent use case. Go instead provides `sync.Map` for when you need it. This is the Go philosophy: pay only for what you use.

---

## 1. Map Basics

### Why Before How

A map's zero value is `nil`. A nil map is readable (returns zero values for missing keys), but writing to a nil map panics at runtime. This asymmetry exists because Go maps are reference types — a nil map has no backing hash table allocated, so reads can safely return "nothing found," but writes need somewhere to write to. `make` allocates that backing storage.

Iteration order is intentionally randomized. Starting in Go 1.1, the runtime explicitly randomizes the starting point of map iteration on each run. This was added after developers in the wild wrote code that happened to work because iteration order was stable in testing — then broke in production when the implementation changed. Randomization forces correctness.

```go
package main

import "fmt"

func main() {
	// --- Declaration and initialization ---

	// Method 1: make (zero-value initialized, no entries)
	m1 := make(map[string]int)

	// Method 2: map literal (declare + populate in one step)
	m2 := map[string]int{
		"alice": 42,
		"bob":   17,
		"carol": 99,
	}

	// Method 3: var declaration — produces a nil map
	var m3 map[string]int
	// m3["key"] = 1  // PANIC: assignment to entry in nil map
	// Reading from nil map is safe — returns zero value
	fmt.Println("nil map read:", m3["anything"]) // 0, no panic

	// --- Basic operations ---
	m1["score"] = 100
	m1["level"] = 5

	// Single-value get: returns zero if key missing
	val := m1["score"]
	fmt.Println("score:", val) // 100

	missing := m1["nonexistent"]
	fmt.Println("missing key:", missing) // 0 (zero value for int)

	// --- Comma-ok idiom: the RIGHT way to check if a key exists ---
	// Never rely on zero value meaning "not found"
	v, ok := m1["score"]
	fmt.Printf("score: %d, exists: %v\n", v, ok) // 100, true

	v, ok = m1["ghost"]
	fmt.Printf("ghost: %d, exists: %v\n", v, ok) // 0, false

	// --- Delete ---
	m2["alice"] = 55          // update
	delete(m2, "carol")       // remove
	delete(m2, "nonexistent") // deleting non-existent key is a no-op (safe)

	// --- Iteration: order is RANDOM every run ---
	fmt.Println("\nMap iteration (random order each run):")
	for key, value := range m2 {
		fmt.Printf("  %s -> %d\n", key, value)
	}

	// Iterate keys only
	for key := range m2 {
		fmt.Println("  key:", key)
	}

	// --- Length ---
	fmt.Println("len:", len(m2))
}
```

**Common pitfall — confusing zero value with missing key:**

```go
package main

import "fmt"

func main() {
	scores := map[string]int{
		"alice": 0, // Alice scored zero (legitimate zero value)
	}

	// WRONG: this does NOT distinguish "scored 0" from "not in map"
	if scores["alice"] == 0 {
		fmt.Println("alice not found") // Wrong! Alice IS in the map with score 0
	}

	// RIGHT: use comma-ok
	if score, ok := scores["alice"]; ok {
		fmt.Printf("alice found with score %d\n", score) // Correct
	}

	if _, ok := scores["bob"]; !ok {
		fmt.Println("bob not found") // Correct
	}
}
```

---

## 2. Map Internals

### Why Before How

Understanding internals helps you write faster code and avoid surprises. Go's map is a hash table divided into buckets (each bucket holds 8 key-value pairs). When the load factor (entries / buckets) exceeds ~6.5, Go triggers a rehash — it allocates a new, larger set of buckets and migrates entries incrementally (not all at once, to avoid latency spikes). This incremental rehash is why you sometimes see two map sizes in memory profilers.

Pre-sizing with `make(map[K]V, hint)` avoids rehashing by allocating enough buckets upfront. For a map you expect to hold 1 million entries, not pre-sizing means ~20 rehash cycles during population — each cycle copies all existing entries. Pre-sizing eliminates those copies.

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	const N = 1_000_000

	// Without pre-sizing: triggers multiple rehashes during insertion
	start := time.Now()
	m1 := make(map[int]int)
	for i := 0; i < N; i++ {
		m1[i] = i
	}
	fmt.Printf("Without hint: %v\n", time.Since(start))

	// With pre-sizing: allocates enough buckets upfront, no rehashing
	start = time.Now()
	m2 := make(map[int]int, N)
	for i := 0; i < N; i++ {
		m2[i] = i
	}
	fmt.Printf("With hint:    %v\n", time.Since(start))
	// Pre-sized version is typically 30-50% faster for large maps
}
```

**Why iteration order is random — a deeper look:**

```go
package main

import "fmt"

func main() {
	m := map[string]int{"a": 1, "b": 2, "c": 3, "d": 4, "e": 5}

	// Run this program multiple times — order changes every execution.
	// This is not a bug; it is a FEATURE that prevents order-dependent bugs.
	fmt.Println("Run 1 of iteration:")
	for k, v := range m {
		fmt.Printf("  %s=%d\n", k, v)
	}

	// Even within the same program run, two iterations of the SAME map
	// may produce different orders (though in practice they often don't
	// within a single run — but you must NEVER depend on that).
	fmt.Println("Run 2 of same map:")
	for k, v := range m {
		fmt.Printf("  %s=%d\n", k, v)
	}
}
```

---

## 3. Common Map Patterns

### Why Before How

These patterns appear in virtually every Go production codebase. Learning them as named idioms (not just one-off tricks) lets you recognize them in code reviews and apply them correctly under time pressure.

```go
package main

import (
	"fmt"
	"sort"
)

func main() {
	// --- Pattern 1: Frequency counting ---
	// Use case: log analysis, word frequency, histogram building
	words := []string{"go", "is", "fast", "go", "is", "great", "go"}

	wordCount := make(map[string]int)
	for _, word := range words {
		wordCount[word]++ // If key missing, zero value (0) is returned, then +1
		// Equivalent to: wordCount[word] = wordCount[word] + 1
	}
	fmt.Println("Word counts:", wordCount)

	// --- Pattern 2: Grouping / bucketing ---
	// Use case: group database rows by category, partition events by user
	type Event struct {
		UserID string
		Action string
	}
	events := []Event{
		{"u1", "login"}, {"u2", "purchase"}, {"u1", "logout"},
		{"u3", "login"}, {"u2", "login"},
	}

	byUser := make(map[string][]Event)
	for _, e := range events {
		byUser[e.UserID] = append(byUser[e.UserID], e)
		// append(nil, item) works fine — nil slice is valid input to append
	}
	for user, evts := range byUser {
		fmt.Printf("User %s: %d events\n", user, len(evts))
	}

	// --- Pattern 3: Set (map[K]struct{}) ---
	// Use case: deduplication, membership testing, tag tracking
	// struct{} uses zero bytes — more memory-efficient than map[string]bool
	seen := make(map[string]struct{})
	items := []string{"apple", "banana", "apple", "cherry", "banana"}

	var unique []string
	for _, item := range items {
		if _, exists := seen[item]; !exists {
			seen[item] = struct{}{} // empty struct literal
			unique = append(unique, item)
		}
	}
	fmt.Println("Unique items:", unique)

	// Membership test
	if _, ok := seen["apple"]; ok {
		fmt.Println("apple is in the set")
	}

	// --- Pattern 4: Inverted index / reverse lookup ---
	// Use case: search engines, tag systems, permission lookups
	userRoles := map[string]string{
		"alice": "admin",
		"bob":   "editor",
		"carol": "admin",
		"dave":  "viewer",
	}

	roleToUsers := make(map[string][]string)
	for user, role := range userRoles {
		roleToUsers[role] = append(roleToUsers[role], user)
	}
	// Sort for deterministic output (maps are unordered)
	for role, users := range roleToUsers {
		sort.Strings(users)
		fmt.Printf("Role %s: %v\n", role, users)
	}

	// --- Pattern 5: Memoization / caching ---
	// Use case: expensive computations, API response caching
	cache := make(map[int]int)
	var fib func(n int) int
	fib = func(n int) int {
		if n <= 1 {
			return n
		}
		if result, ok := cache[n]; ok {
			return result // cache hit
		}
		result := fib(n-1) + fib(n-2)
		cache[n] = result // store in cache
		return result
	}
	fmt.Println("fib(40):", fib(40)) // Fast because of memoization
}
```

---

## 4. Maps as Function Arguments (Reference Semantics)

### Why Before How

Maps are reference types. When you pass a map to a function, both the caller and the callee point to the same underlying hash table. Modifications inside the function are visible to the caller. This is a frequent source of subtle bugs for developers coming from languages where you explicitly choose pass-by-reference.

```go
package main

import "fmt"

// This function modifies the caller's map — no pointer needed
func addEntry(m map[string]int, key string, value int) {
	m[key] = value
}

// This function reassigns the local variable — does NOT affect caller
// (the map header is copied, but not the underlying data)
func tryReplace(m map[string]int) {
	m = map[string]int{"completely": 1, "new": 2} // local reassignment only
}

// To return a new map, return it explicitly
func filtered(m map[string]int, threshold int) map[string]int {
	result := make(map[string]int)
	for k, v := range m {
		if v >= threshold {
			result[k] = v
		}
	}
	return result
}

func main() {
	original := map[string]int{"a": 1, "b": 2, "c": 3}

	addEntry(original, "d", 4)
	fmt.Println("After addEntry:", original) // map includes "d" — reference semantics

	tryReplace(original)
	fmt.Println("After tryReplace:", original) // unchanged — local reassignment

	high := filtered(original, 3)
	fmt.Println("Filtered (>=3):", high) // c:3, d:4
}
```

**The "cannot take address of map value" pitfall:**

```go
package main

import "fmt"

type Config struct {
	Value int
	Label string
}

func main() {
	configs := map[string]Config{
		"timeout": {Value: 30, Label: "seconds"},
	}

	// DOES NOT COMPILE: cannot take the address of a map value
	// ptr := &configs["timeout"]

	// WHY: map values may be relocated during rehashing.
	// A pointer to a map value would become dangling after rehash.
	// Go prevents this at compile time.

	// WORKAROUND 1: Read, modify, write back
	c := configs["timeout"] // copy
	c.Value = 60
	configs["timeout"] = c // write back
	fmt.Println("Updated:", configs["timeout"])

	// WORKAROUND 2: Use map of pointers when you need stable addresses
	ptrMap := map[string]*Config{
		"timeout": {Value: 30, Label: "seconds"},
	}
	ptrMap["timeout"].Value = 90 // OK: modifying value through pointer
	fmt.Println("Pointer map:", *ptrMap["timeout"])
}
```

---

## 5. Concurrency-Safe Maps

### Why Before How

Go's built-in map is NOT safe for concurrent use. If two goroutines read and write to the same map simultaneously without synchronization, the program has a data race — a bug that corrupts memory and can cause crashes or silent incorrect behavior. The Go race detector (`go run -race`) will catch this.

Go provides three tools for concurrent map access, each with different tradeoffs:

1. **`sync.Mutex` + plain map**: Simple, best when reads and writes are roughly equal.
2. **`sync.RWMutex` + plain map**: Best for read-heavy workloads (many readers, few writers). Multiple goroutines can hold the read lock simultaneously.
3. **`sync.Map`**: Best for write-once-read-many patterns, or when keys are disjoint across goroutines. Has higher overhead per operation but reduces contention in specific patterns.

```go
package main

import (
	"fmt"
	"sync"
)

// --- Pattern 1: RWMutex-protected map (recommended for most cases) ---

type SafeCache struct {
	mu    sync.RWMutex
	store map[string]string
}

func NewSafeCache() *SafeCache {
	return &SafeCache{
		store: make(map[string]string),
	}
}

func (c *SafeCache) Set(key, value string) {
	c.mu.Lock()         // Exclusive write lock
	defer c.mu.Unlock()
	c.store[key] = value
}

func (c *SafeCache) Get(key string) (string, bool) {
	c.mu.RLock()         // Shared read lock — multiple goroutines can hold this
	defer c.mu.RUnlock()
	v, ok := c.store[key]
	return v, ok
}

func (c *SafeCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.store, key)
}

// --- Pattern 2: sync.Map (write-once-read-many, or disjoint key sets) ---

func syncMapExample() {
	var sm sync.Map

	// Store
	sm.Store("key1", "value1")
	sm.Store("key2", "value2")

	// Load
	if v, ok := sm.Load("key1"); ok {
		fmt.Println("sync.Map Load:", v)
	}

	// LoadOrStore: atomic get-or-set
	actual, loaded := sm.LoadOrStore("key1", "new_value")
	fmt.Printf("LoadOrStore: actual=%v, loaded=%v\n", actual, loaded)
	// loaded=true because key1 already existed

	// Range over all entries
	sm.Range(func(key, value any) bool {
		fmt.Printf("  sync.Map entry: %v -> %v\n", key, value)
		return true // return false to stop iteration
	})

	// Delete
	sm.Delete("key2")
}

func main() {
	cache := NewSafeCache()

	var wg sync.WaitGroup

	// Launch 10 writers
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("user-%d", i)
			cache.Set(key, fmt.Sprintf("data-%d", i))
		}(i)
	}

	// Launch 20 readers concurrently with writers
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("user-%d", i%10)
			if v, ok := cache.Get(key); ok {
				_ = v // use value
			}
		}(i)
	}

	wg.Wait()
	fmt.Println("RWMutex cache operations completed safely")

	syncMapExample()
}
```

**Sharded map for high-throughput concurrent workloads:**

```go
package main

import (
	"fmt"
	"hash/fnv"
	"sync"
)

// ShardedMap splits a map into N independent shards, each with its own lock.
// Under high concurrency, goroutines accessing different shards don't contend.
// Used in production systems like Kubernetes informer caches.

const numShards = 32

type shard struct {
	mu    sync.RWMutex
	store map[string]any
}

type ShardedMap struct {
	shards [numShards]*shard
}

func NewShardedMap() *ShardedMap {
	sm := &ShardedMap{}
	for i := 0; i < numShards; i++ {
		sm.shards[i] = &shard{store: make(map[string]any)}
	}
	return sm
}

func (sm *ShardedMap) getShard(key string) *shard {
	h := fnv.New32a()
	h.Write([]byte(key))
	return sm.shards[h.Sum32()%numShards]
}

func (sm *ShardedMap) Set(key string, value any) {
	s := sm.getShard(key)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.store[key] = value
}

func (sm *ShardedMap) Get(key string) (any, bool) {
	s := sm.getShard(key)
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.store[key]
	return v, ok
}

func main() {
	sm := NewShardedMap()

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("session-%d", i)
			sm.Set(key, i*100)
		}(i)
	}
	wg.Wait()

	v, ok := sm.Get("session-42")
	fmt.Printf("session-42: value=%v, found=%v\n", v, ok)
}
```

---

## 6. Ordered Maps and Alternatives

### Why Before How

Go's standard library has no ordered map. This is a deliberate design decision: an ordered map requires either a balanced BST (O(log n) operations) or a linked hash map (more memory, more complexity). The Go authors decided this use case is not universal enough to justify the stdlib inclusion — most programs either don't need ordering, or need a specific ordering that a general-purpose ordered map might not provide anyway.

When you need deterministic key ordering (reports, test output, config serialization), the idiomatic Go approach is: collect keys into a slice, sort the slice, then iterate.

```go
package main

import (
	"fmt"
	"sort"
)

func main() {
	prices := map[string]float64{
		"banana":     0.49,
		"apple":      1.29,
		"cherry":     3.99,
		"date":       5.49,
		"elderberry": 7.99,
	}

	// --- Sorted iteration (the idiomatic Go approach) ---
	keys := make([]string, 0, len(prices))
	for k := range prices {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	fmt.Println("Sorted by key:")
	for _, k := range keys {
		fmt.Printf("  %-12s $%.2f\n", k, prices[k])
	}

	// --- Sort by value (e.g., cheapest first) ---
	type kv struct {
		Key   string
		Value float64
	}
	pairs := make([]kv, 0, len(prices))
	for k, v := range prices {
		pairs = append(pairs, kv{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].Value < pairs[j].Value
	})

	fmt.Println("\nSorted by price:")
	for _, p := range pairs {
		fmt.Printf("  %-12s $%.2f\n", p.Key, p.Value)
	}

	// --- When to choose map vs slice for lookup ---
	// Use MAP when:
	//   - You need O(1) lookup by key
	//   - Keys are not integers or are sparse
	//   - You need fast membership testing
	//   - You need fast delete by key

	// Use SLICE when:
	//   - You iterate sequentially in order
	//   - Keys are dense integers (use slice index directly)
	//   - You need ordering as a first-class property
	//   - Set is small (<20 items) — linear search is faster than hash overhead

	// Hybrid: slice for order, map for lookup
	type Product struct {
		ID   string
		Name string
	}
	var orderedProducts []Product          // preserves insertion order
	productIndex := map[string]int{}       // maps ID -> index in slice

	addProduct := func(p Product) {
		productIndex[p.ID] = len(orderedProducts)
		orderedProducts = append(orderedProducts, p)
	}
	addProduct(Product{"p3", "Cherry"})
	addProduct(Product{"p1", "Apple"})
	addProduct(Product{"p2", "Banana"})

	// O(1) lookup by ID
	if idx, ok := productIndex["p1"]; ok {
		fmt.Println("\nLookup p1:", orderedProducts[idx].Name)
	}
	// Iterate in insertion order
	fmt.Println("Insertion order:")
	for _, p := range orderedProducts {
		fmt.Printf("  %s: %s\n", p.ID, p.Name)
	}
}
```

---

## 7. Struct Keys and Complex Map Patterns

### Why Before How

Any comparable type can be a map key — not just strings and integers. Structs whose fields are all comparable types (no slices, maps, or functions) are automatically comparable and can be used as keys. This enables multi-dimensional lookups without string concatenation hacks.

```go
package main

import "fmt"

// Struct key: all fields must be comparable
type Point struct {
	X, Y int
}

type CacheKey struct {
	UserID   string
	Resource string
	Version  int
}

func main() {
	// --- Struct as map key ---
	grid := map[Point]string{
		{0, 0}: "origin",
		{1, 0}: "right",
		{0, 1}: "up",
		{1, 1}: "diagonal",
	}

	fmt.Println("grid[{1,0}]:", grid[Point{1, 0}])

	// Mark visited cells in a graph traversal
	visited := map[Point]bool{}
	for _, p := range []Point{{0, 0}, {1, 0}, {0, 1}} {
		visited[p] = true
	}
	fmt.Println("visited {1,0}:", visited[Point{1, 0}])
	fmt.Println("visited {5,5}:", visited[Point{5, 5}]) // false, not visited

	// --- Multi-key cache ---
	permCache := make(map[CacheKey]bool)
	permCache[CacheKey{"user-1", "articles", 2}] = true
	permCache[CacheKey{"user-1", "videos", 1}] = false

	key := CacheKey{"user-1", "articles", 2}
	if allowed, ok := permCache[key]; ok {
		fmt.Printf("Permission for %+v: %v\n", key, allowed)
	}

	// --- Nested maps ---
	// Use case: 2D config tables, role-permission matrices
	permissions := map[string]map[string]bool{
		"admin":  {"read": true, "write": true, "delete": true},
		"editor": {"read": true, "write": true, "delete": false},
		"viewer": {"read": true, "write": false, "delete": false},
	}

	checkPermission := func(role, action string) bool {
		if actions, ok := permissions[role]; ok {
			return actions[action] // returns false if action not in inner map
		}
		return false
	}

	fmt.Println("admin delete:", checkPermission("admin", "delete"))   // true
	fmt.Println("viewer write:", checkPermission("viewer", "write"))   // false
	fmt.Println("unknown role:", checkPermission("unknown", "read"))   // false
}
```

---

## 8. Common Pitfalls Summary

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	// --- Pitfall 1: Writing to nil map PANICS ---
	var nilMap map[string]int
	// nilMap["key"] = 1  // runtime panic: assignment to entry in nil map

	// Fix: initialize before use
	nilMap = make(map[string]int)
	nilMap["key"] = 1
	fmt.Println("Fixed nil map write:", nilMap)

	// --- Pitfall 2: Assuming zero value means key is absent ---
	scores := map[string]int{"alice": 0}
	// WRONG: alice IS in the map, just scored 0
	if scores["alice"] == 0 {
		// This incorrectly treats a legitimate 0 score as "not found"
	}
	// RIGHT:
	if _, ok := scores["alice"]; ok {
		fmt.Println("alice found (may have score 0)")
	}

	// --- Pitfall 3: Assuming map iteration order is stable ---
	m := map[int]string{1: "one", 2: "two", 3: "three"}
	first := ""
	for k, v := range m {
		if first == "" {
			first = fmt.Sprintf("%d=%s", k, v)
		}
	}
	// Do NOT write code like: "the first key is always 1"
	fmt.Println("First (random):", first)

	// --- Pitfall 4: Unsynchronized concurrent access (data race) ---
	sharedMap := make(map[int]int)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			mu.Lock()
			sharedMap[i] = i * i // safe with mutex
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	fmt.Println("Concurrent writes completed safely, len:", len(sharedMap))

	// --- Pitfall 5: Modifying a map while ranging over it ---
	// Deleting or adding during range is defined behavior in Go,
	// but the effect on range is unpredictable: new entries may or may
	// not be visited. For safe modification, collect changes first.
	counts := map[string]int{"a": 1, "b": 0, "c": 3, "d": 0}

	// UNSAFE approach: modifying during range (allowed but unpredictable)
	// for k, v := range counts { if v == 0 { delete(counts, k) } }

	// SAFE approach: collect keys to delete, then delete after range
	var toDelete []string
	for k, v := range counts {
		if v == 0 {
			toDelete = append(toDelete, k)
		}
	}
	for _, k := range toDelete {
		delete(counts, k)
	}
	fmt.Println("After safe delete:", counts) // only a:1, c:3 remain

	// --- Pitfall 6: Passing map to function and expecting copy semantics ---
	original := map[string]int{"x": 10}
	modifyMap(original)
	fmt.Println("After modifyMap:", original) // x=99, NOT x=10
	// Maps are reference types — the function modifies the original
}

func modifyMap(m map[string]int) {
	m["x"] = 99 // modifies the caller's map, not a local copy
}
```

---

## Quick Reference

| Operation | Syntax | Notes |
|---|---|---|
| Create empty | `make(map[K]V)` | Always use make or literal |
| Create with hint | `make(map[K]V, n)` | Pre-allocates for n entries |
| Create with data | `map[K]V{k: v}` | Map literal |
| Read | `v := m[k]` | Returns zero value if missing |
| Safe read | `v, ok := m[k]` | ok=false if key absent |
| Write | `m[k] = v` | Panics on nil map |
| Delete | `delete(m, k)` | No-op if key missing |
| Length | `len(m)` | Number of entries |
| Iterate | `for k, v := range m` | Random order |
| Set pattern | `map[K]struct{}` | Zero-byte values |
| Increment | `m[k]++` | Works on zero value |
| Nil check | `m == nil` | Before writing to unknown map |

## When to Use What

| Need | Solution |
|---|---|
| Fast lookup, single goroutine | `map[K]V` |
| Concurrent read-heavy | `sync.RWMutex` + map |
| Write-once, many readers | `sync.Map` |
| Very high concurrency | Sharded map |
| Ordered iteration | `[]K` (sorted) + `map[K]V` |
| Set (membership) | `map[K]struct{}` |
| Multi-key lookup | Struct key |
| Stable address to value | `map[K]*V` (map of pointers) |
