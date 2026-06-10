# Go Arrays & Slices

## What Is This?

Arrays in Go are fixed-size, value-typed sequences of elements of the same type. Slices are dynamically-sized, reference-typed views into an underlying array. Slices are built on top of arrays — they do not own their memory directly, but instead hold a pointer to an array, a length, and a capacity.

## Why Does It Exist?

Go deliberately separated the array concept (fixed, stack-friendly, value semantics) from the slice concept (dynamic, heap-friendly, reference semantics) to give developers explicit control over memory layout and allocation cost. In most languages, arrays and dynamic lists are one blended abstraction (Java's `ArrayList`, Python's `list`). Go splits them because a 16-byte cryptographic key should never trigger a heap allocation just because you stored it, while a growing list of HTTP requests absolutely must live on the heap. Without slices, every dynamic collection would require manual pointer arithmetic. Without arrays, there would be no zero-allocation fixed-size buffers.

## Who Uses This in Industry?

- **Google**: The Bigtable client library and gRPC runtime use pre-allocated slices with `make([]byte, 0, n)` to avoid allocations in hot paths, since every allocation adds GC pressure in high-QPS servers.
- **Kubernetes**: The scheduler's pod queue is managed as a slice of `*v1.Pod`. Slice sorting (`sort.SliceStable`) is used to reorder pods by priority before binding decisions. The `append` + `copy` delete pattern appears in multiple controllers for removing items from watch caches.
- **Cloudflare**: Their DNS resolver uses fixed-size `[512]byte` arrays on the stack for UDP packet buffers, avoiding heap allocation for the common case and falling back to slices only for larger DNS responses.
- **Docker**: The layer diffing code in containerd uses `[]string` slices of file paths with filter and sort patterns to compute filesystem diffs between container layers.
- **Uber's Go infrastructure**: Their RPC middleware chains are stored as `[]Handler` slices, pre-allocated with known capacity to avoid mid-request reallocations.

## Industry Standards & Best Practices

**Senior engineers do:**
- Pre-allocate with `make([]T, 0, expectedLen)` any time the upper-bound size is known at the call site.
- Use `copy` to break the backing-array alias when returning a sub-slice from a function (prevents the memory-leak anti-pattern).
- Prefer the three-index slice `s[low:high:max]` when handing a slice to external code, to prevent the callee from silently appending into your buffer.
- Use `sort.SliceStable` instead of `sort.Slice` when stability matters (equal elements must preserve input order).
- Avoid `append` in tight loops without pre-allocation — the repeated doubling strategy hides O(n) copy costs.

**Beginners do:**
- `append` into slices with no pre-allocation, creating 20+ tiny heap allocations for a slice that ends up with 100 elements.
- Return `data[start:end]` from a large buffer without copying, keeping a multi-MB array alive for a 3-element result.
- Assume `a := b` for slices makes an independent copy (it does not — they share the backing array).

## Why Go's Approach Is Unique

Python lists, Java ArrayLists, and JavaScript arrays all hide their implementation behind a single abstraction. Go exposes the distinction between the fixed-size backing array and the slice header explicitly. This means:

- **No hidden copies**: In Java, passing an `int[]` to a method and modifying it mutates the caller's data. In Go, passing a `[4]int` copies the array entirely. Passing a `[]int` shares the backing array. Both behaviors are predictable because they are structurally different types.
- **Stack-allocated arrays**: A `[64]byte` declared in a function body lives on the stack unless it escapes — zero heap pressure. Python has no equivalent.
- **Explicit capacity**: Go's `make([]T, len, cap)` separates logical length from physical capacity, a distinction Python exposes only through `list.__sizeof__()` internals.
- **No null references by accident**: A nil slice in Go is valid and iterable (zero iterations). You never get a NullPointerException from iterating a nil slice.
- **Trade-off**: The aliasing behavior of slices is a source of subtle bugs that Go programmers must learn. Go chose shared backing arrays because the performance gain (avoiding copies) outweighs the cognitive cost for systems programmers.

---

## 1. Arrays — Fixed Size, Value Semantics

### Why Before How

Arrays are for data whose size is known at compile time and whose value-copy semantics are desirable: cryptographic keys, fixed-format binary headers, small lookup tables. Because Go arrays are values, assigning or passing one copies all elements. This is expensive for large arrays but optimal for small, immutable data — the compiler can keep the entire array in registers.

Arrays are also comparable with `==`, which slices are not. This is only possible because the size is part of the type: `[4]byte` and `[8]byte` are completely different types.

```go
// example_01_arrays.go
package main

import "fmt"

func main() {
	// --- Declaration and initialization ---
	var a [3]int                    // zero value: [0, 0, 0]
	b := [3]int{10, 20, 30}        // literal
	c := [...]int{100, 200, 300}   // compiler infers length: [3]int

	fmt.Println(a, b, c)

	// --- Value semantics: assignment copies ---
	x := [3]int{1, 2, 3}
	y := x       // full copy — y is independent
	y[0] = 999
	fmt.Println("x:", x) // x: [1 2 3]  — unchanged
	fmt.Println("y:", y) // y: [999 2 3]

	// --- Arrays are comparable ---
	p := [3]int{1, 2, 3}
	q := [3]int{1, 2, 3}
	r := [3]int{7, 8, 9}
	fmt.Println(p == q) // true
	fmt.Println(p == r) // false

	// --- Iterating ---
	grades := [5]int{88, 92, 76, 95, 81}
	sum := 0
	for _, v := range grades {
		sum += v
	}
	fmt.Printf("Average: %.1f\n", float64(sum)/float64(len(grades)))

	// --- Passing to a function COPIES the array ---
	original := [3]int{1, 2, 3}
	noEffect(original)
	fmt.Println("after noEffect:", original) // [1 2 3] — unchanged

	// --- Pass pointer to mutate ---
	mutate(&original)
	fmt.Println("after mutate:", original) // [100 2 3]
}

func noEffect(arr [3]int) {
	arr[0] = 100 // modifies the copy only
}

func mutate(arr *[3]int) {
	arr[0] = 100 // modifies through pointer
}
```

**Pitfall**: `[4]byte` and `[5]byte` are distinct types. You cannot assign one to the other, and a function expecting `[4]byte` will not accept `[5]byte`. The size is baked into the type.

**When to use arrays (not slices)**:
- Cryptographic keys: `[32]byte` for AES-256
- UUID: `[16]byte`
- Fixed binary protocol headers
- Small lookup tables where you want guaranteed stack allocation

---

## 2. Slice Internals — The Three-Field Struct

### Why Before How

A slice is not a data structure on its own. It is a small descriptor — three words wide — that describes a window into an array:

```
┌──────────┬────────┬──────────┐
│  *array  │  len   │   cap    │
│ (ptr)    │ (int)  │  (int)   │
└──────────┴────────┴──────────┘
     8B         8B       8B     = 24 bytes on 64-bit
```

- `ptr`: points to the first element visible through this slice
- `len`: how many elements are accessible via this slice
- `cap`: how many elements are in the backing array starting from `ptr`

This design means copying a slice copies only the 24-byte header. Both the original and the copy see the same backing array. This is efficient but creates the aliasing gotcha covered in section 5.

```go
// example_02_slice_internals.go
package main

import (
	"fmt"
	"unsafe"
)

func main() {
	// --- Slice header size ---
	var s []int
	fmt.Println("slice header size:", unsafe.Sizeof(s)) // 24 bytes

	// --- nil slice is valid ---
	var nilSlice []int
	fmt.Println("nil slice len:", len(nilSlice))     // 0
	fmt.Println("nil slice cap:", cap(nilSlice))     // 0
	fmt.Println("nil == nil:", nilSlice == nil)      // true
	// range over nil slice: zero iterations — no panic
	for _, v := range nilSlice {
		fmt.Println(v) // never executes
	}

	// --- make: control len and cap ---
	// make([]T, len, cap)
	preallocated := make([]int, 0, 10)
	fmt.Printf("len=%d cap=%d\n", len(preallocated), cap(preallocated))

	// --- len vs cap distinction ---
	full := make([]int, 5, 10)
	fmt.Printf("len=%d cap=%d\n", len(full), cap(full))
	// full[7] = 1  // panic: index 7 out of range [len=5]
	// cap controls what append can use without reallocating

	// --- Slice literal vs make ---
	literal := []int{1, 2, 3}     // len=3, cap=3
	grown := append(literal, 4)   // triggers reallocation: new backing array
	fmt.Println(literal)          // [1 2 3]  — unchanged backing array
	fmt.Println(grown)            // [1 2 3 4] — new backing array

	// Prove they are different backing arrays after realloc:
	grown[0] = 999
	fmt.Println("literal[0] after grown[0]=999:", literal[0]) // 1 — independent
}
```

### How append() Grows

When `append` needs more capacity, it allocates a new array, copies all elements, and returns a new slice header. The growth strategy in Go's runtime is approximately:
- For small slices: double the capacity
- For larger slices: grow by ~1.25x to balance memory vs. copy cost (exact formula changed in Go 1.18)

This means a loop that appends one element at a time to an unpreallocated slice triggers O(log n) allocations for n elements. Each allocation copies the entire existing content. Pre-allocating eliminates all of these.

---

## 3. Slice Operations

### Slicing Syntax

```go
// example_03_slice_operations.go
package main

import "fmt"

func main() {
	s := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}

	// --- Two-index slice: s[low:high] ---
	// includes elements at index low through high-1
	a := s[2:5]
	fmt.Println(a)                              // [2 3 4]
	fmt.Printf("len=%d cap=%d\n", len(a), cap(a)) // len=3 cap=8

	// cap extends to end of backing array: indices 2..9 = 8 elements

	// --- Three-index slice: s[low:high:max] ---
	// limits cap to (max - low), preventing callee from appending into s
	b := s[2:5:5]
	fmt.Printf("len=%d cap=%d\n", len(b), cap(b)) // len=3 cap=3
	// Appending to b now always allocates a new array — s is protected

	// --- Append to nil slice ---
	var result []int
	for i := 0; i < 5; i++ {
		result = append(result, i*i)
	}
	fmt.Println(result) // [0 1 4 9 16]

	// --- Append multiple elements at once ---
	base := []int{1, 2, 3}
	extra := []int{4, 5, 6}
	combined := append(base, extra...) // spread operator
	fmt.Println(combined) // [1 2 3 4 5 6]

	// --- copy() ---
	src := []int{10, 20, 30, 40, 50}
	dst := make([]int, 3)
	n := copy(dst, src) // copies min(len(dst), len(src)) elements
	fmt.Println(dst, "copied:", n) // [10 20 30] copied: 3

	// --- Delete element: order-preserving ---
	data := []int{1, 2, 3, 4, 5}
	i := 2 // delete index 2
	data = append(data[:i], data[i+1:]...)
	fmt.Println(data) // [1 2 4 5]

	// --- Delete element: order-independent (faster) ---
	data2 := []int{1, 2, 3, 4, 5}
	j := 2 // delete index 2
	data2[j] = data2[len(data2)-1]
	data2 = data2[:len(data2)-1]
	fmt.Println(data2) // [1 2 5 4]  — order not preserved

	// --- Clear a slice (Go 1.21+) ---
	// clear(s) — zeroes all elements, keeps len/cap
	nums := []int{1, 2, 3}
	clear(nums)
	fmt.Println(nums) // [0 0 0]
}
```

---

## 4. The Shared Backing Array — Aliasing Gotcha

### Why This Matters

This is the single most common source of subtle bugs for developers new to Go. Because slices share their backing array, mutations through one slice are visible through all others that overlap the same array.

```go
// example_04_aliasing.go
package main

import "fmt"

func main() {
	original := []int{1, 2, 3, 4, 5}

	// sub shares the same backing array as original
	sub := original[1:3]
	fmt.Println("sub:", sub)           // [2 3]
	fmt.Println("original:", original) // [1 2 3 4 5]

	// Mutating through sub changes original!
	sub[0] = 999
	fmt.Println("after sub[0]=999:")
	fmt.Println("sub:", sub)           // [999 3]
	fmt.Println("original:", original) // [1 999 3 4 5]  ← surprise!

	// --- Append can also hit this ---
	a := []int{1, 2, 3, 4, 5}
	b := a[:3] // len=3 cap=5 — still connected to a

	// append to b doesn't allocate (cap is 5, len is 3)
	// it writes into position 3 of a's backing array
	b = append(b, 99)
	fmt.Println("a after append to b:", a) // [1 2 3 99 5]  ← a[3] changed!

	// FIX: use three-index slice to cap b
	a2 := []int{1, 2, 3, 4, 5}
	b2 := a2[:3:3] // cap=3, so append always allocates new array
	b2 = append(b2, 99)
	fmt.Println("a2 after safe append:", a2) // [1 2 3 4 5]  ← unchanged
}
```

**Rule**: When you extract a sub-slice and hand it to code you do not fully control, always use `s[low:high:high]` to set cap equal to len.

---

## 5. The Backing Array Memory Leak

### Why This Is Critical in Production

This is one of the most important performance gotchas in Go. It appears in code reviews at every major Go shop and has caused production memory leaks at Cloudflare, in Kubernetes controllers, and in numerous internal services.

```go
// example_05_memory_leak.go
package main

import (
	"fmt"
	"runtime"
)

// BAD: keeps entire large buffer alive
func readFirstFewBad(largeBuf []byte) []byte {
	// We only need the first 10 bytes, but the returned slice
	// holds a pointer into largeBuf — the entire 10MB stays allocated
	// until the returned slice is garbage collected.
	return largeBuf[:10]
}

// GOOD: copy breaks the reference to the large buffer
func readFirstFewGood(largeBuf []byte) []byte {
	result := make([]byte, 10)
	copy(result, largeBuf[:10])
	return result
	// largeBuf can now be GC'd independently of result
}

func printMemStats(label string) {
	var m runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m)
	fmt.Printf("%s: HeapAlloc = %d KB\n", label, m.HeapAlloc/1024)
}

func main() {
	printMemStats("start")

	// Simulate loading a large buffer (e.g., reading a large file into memory)
	largeBuf := make([]byte, 10*1024*1024) // 10 MB
	for i := range largeBuf {
		largeBuf[i] = byte(i)
	}
	printMemStats("after large alloc")

	// BAD path: sub-slice keeps 10MB alive
	leaked := readFirstFewBad(largeBuf)
	largeBuf = nil // we think we released it — but leaked still holds the ref
	printMemStats("after nil largeBuf (bad path — still leaked)")
	_ = leaked

	// GOOD path:
	largeBuf2 := make([]byte, 10*1024*1024)
	safe := readFirstFewGood(largeBuf2)
	largeBuf2 = nil // now truly released — safe owns its own 10-byte array
	printMemStats("after nil largeBuf2 (good path — released)")
	_ = safe

	fmt.Println("\nLeaked slice contents:", leaked[:5])
	fmt.Println("Safe slice contents:  ", safe[:5])
}
```

**The pattern to memorize:**

```go
// NEVER return this from a function that received a large slice:
return bigSlice[start:end]

// ALWAYS do this instead:
result := make([]T, end-start)
copy(result, bigSlice[start:end])
return result
```

This same pattern appears in:
- Reading headers from a network packet buffer
- Extracting tokens from a lexer's input buffer
- Sub-matching from a regex result
- Any time you cache a portion of a larger data structure

---

## 6. Slice Performance — Pre-allocation

```go
// example_06_preallocation.go
package main

import (
	"fmt"
	"time"
)

// BAD: no pre-allocation — O(n log n) allocations total
func buildSliceBad(n int) []int {
	var s []int
	for i := 0; i < n; i++ {
		s = append(s, i)
	}
	return s
}

// GOOD: pre-allocated — single allocation, O(n) appends
func buildSliceGood(n int) []int {
	s := make([]int, 0, n)
	for i := 0; i < n; i++ {
		s = append(s, i)
	}
	return s
}

// BETTER: when all values are known, assign directly
func buildSliceBetter(n int) []int {
	s := make([]int, n) // len=n, cap=n
	for i := 0; i < n; i++ {
		s[i] = i
	}
	return s
}

func benchmark(name string, fn func(int) []int, n int) {
	start := time.Now()
	for i := 0; i < 1000; i++ {
		fn(n)
	}
	fmt.Printf("%-20s 1000 runs: %v\n", name, time.Since(start))
}

func main() {
	n := 10_000
	benchmark("bad (no prealloc)", buildSliceBad, n)
	benchmark("good (make 0,n)", buildSliceGood, n)
	benchmark("better (make n)", buildSliceBetter, n)

	// --- Demonstrate cap growth without pre-allocation ---
	var growing []int
	caps := []int{}
	prevCap := 0
	for i := 0; i < 20; i++ {
		growing = append(growing, i)
		if cap(growing) != prevCap {
			caps = append(caps, cap(growing))
			prevCap = cap(growing)
		}
	}
	fmt.Println("\nCapacity growth steps (no pre-alloc):", caps)
	// Roughly: 1 2 4 8 16 ...  — each step copies the whole slice
}
```

**Production rule**: In any function that builds a slice from a loop where you know (or can estimate) the output size, always use `make([]T, 0, expectedSize)`. In Kubernetes source code, this appears in virtually every informer and lister.

---

## 7. 2D Slices

### Why Before How

Go has no native 2D array syntax for dynamic sizes. You build 2D structures as slices of slices. The naive approach allocates each row independently (many small allocations). The efficient approach allocates one large backing array and divides it into rows — a single allocation for the entire matrix.

```go
// example_07_2d_slices.go
package main

import "fmt"

// NAIVE: rows × 1 allocations (n+1 total)
func make2DNaive(rows, cols int) [][]int {
	grid := make([][]int, rows)
	for i := range grid {
		grid[i] = make([]int, cols)
	}
	return grid
}

// EFFICIENT: 1 allocation for the data, 1 for the row headers
func make2DEfficient(rows, cols int) [][]int {
	// Single large backing array
	flat := make([]int, rows*cols)
	// Row header slice
	grid := make([][]int, rows)
	for i := range grid {
		// Each row points to a slice of flat
		grid[i] = flat[i*cols : (i+1)*cols]
	}
	return grid
}

func printGrid(grid [][]int) {
	for _, row := range grid {
		fmt.Println(row)
	}
}

func main() {
	// Naive 2D slice
	g1 := make2DNaive(3, 4)
	g1[0][0] = 1
	g1[1][2] = 5
	g1[2][3] = 9
	fmt.Println("Naive 2D:")
	printGrid(g1)

	// Efficient 2D slice
	g2 := make2DEfficient(3, 4)
	g2[0][0] = 1
	g2[1][2] = 5
	g2[2][3] = 9
	fmt.Println("\nEfficient 2D:")
	printGrid(g2)

	// IMPORTANT: with efficient version, rows share backing array.
	// Slicing a row with [low:high:high] prevents cross-row contamination.
	// (For a matrix where rows are never re-sliced, this is fine.)

	// Jagged 2D (rows of different lengths)
	jagged := make([][]int, 4)
	for i := range jagged {
		jagged[i] = make([]int, i+1) // row i has i+1 elements
	}
	fmt.Println("\nJagged 2D:")
	printGrid(jagged)
}
```

---

## 8. Common Algorithms on Slices

### Filter, Map, Reduce

Go 1.18+ generics and Go 1.21's `slices` package provide standard utilities. Before generics, these were written inline per type.

```go
// example_08_functional.go
package main

import "fmt"

// Generic filter — works for any comparable type
func Filter[T any](s []T, keep func(T) bool) []T {
	// Pre-allocate at half capacity as a heuristic
	result := make([]T, 0, len(s)/2+1)
	for _, v := range s {
		if keep(v) {
			result = append(result, v)
		}
	}
	return result
}

// Generic map — transform each element
func Map[T, U any](s []T, transform func(T) U) []U {
	result := make([]U, len(s))
	for i, v := range s {
		result[i] = transform(v)
	}
	return result
}

// Generic reduce — fold to a single value
func Reduce[T, U any](s []T, initial U, combine func(U, T) U) U {
	acc := initial
	for _, v := range s {
		acc = combine(acc, v)
	}
	return acc
}

func main() {
	numbers := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

	// Filter: keep only even numbers
	evens := Filter(numbers, func(n int) bool { return n%2 == 0 })
	fmt.Println("Evens:", evens) // [2 4 6 8 10]

	// Map: square each number
	squared := Map(numbers, func(n int) int { return n * n })
	fmt.Println("Squared:", squared) // [1 4 9 16 25 36 49 64 81 100]

	// Reduce: sum all numbers
	sum := Reduce(numbers, 0, func(acc, n int) int { return acc + n })
	fmt.Println("Sum:", sum) // 55

	// Chain: sum of squares of even numbers
	result := Reduce(
		Map(
			Filter(numbers, func(n int) bool { return n%2 == 0 }),
			func(n int) int { return n * n },
		),
		0,
		func(acc, n int) int { return acc + n },
	)
	fmt.Println("Sum of squares of evens:", result) // 220
}
```

---

## 9. Sorting Slices

```go
// example_09_sorting.go
package main

import (
	"fmt"
	"sort"
)

type Person struct {
	Name string
	Age  int
}

func main() {
	// --- Sort primitives ---
	nums := []int{5, 2, 8, 1, 9, 3}
	sort.Ints(nums)
	fmt.Println("Sorted ints:", nums)

	words := []string{"banana", "apple", "cherry", "date"}
	sort.Strings(words)
	fmt.Println("Sorted strings:", words)

	// --- sort.Slice: custom comparator ---
	people := []Person{
		{"Alice", 30},
		{"Bob", 25},
		{"Charlie", 35},
		{"Diana", 25},
	}

	// Sort by age, then by name — UNSTABLE (equal-age order not preserved)
	sort.Slice(people, func(i, j int) bool {
		if people[i].Age != people[j].Age {
			return people[i].Age < people[j].Age
		}
		return people[i].Name < people[j].Name
	})
	fmt.Println("\nSorted by age (sort.Slice):")
	for _, p := range people {
		fmt.Printf("  %s: %d\n", p.Name, p.Age)
	}

	// --- sort.SliceStable: preserves relative order of equal elements ---
	people2 := []Person{
		{"Alice", 30},
		{"Bob", 25},
		{"Charlie", 35},
		{"Diana", 25},
	}
	sort.SliceStable(people2, func(i, j int) bool {
		return people2[i].Age < people2[j].Age
	})
	fmt.Println("\nSorted by age (sort.SliceStable — Bob before Diana):")
	for _, p := range people2 {
		fmt.Printf("  %s: %d\n", p.Name, p.Age)
	}
	// Bob (25) appears before Diana (25) because they were in that order originally

	// --- sort.Search: binary search ---
	sorted := []int{1, 3, 6, 10, 15, 21, 28, 36, 45, 55}
	target := 15
	// sort.Search returns the smallest index i such that condition(i) is true
	idx := sort.Search(len(sorted), func(i int) bool {
		return sorted[i] >= target
	})
	if idx < len(sorted) && sorted[idx] == target {
		fmt.Printf("\nFound %d at index %d\n", target, idx)
	} else {
		fmt.Printf("\n%d not found\n", target)
	}

	// --- Check if sorted ---
	fmt.Println("\nIs sorted:", sort.IntsAreSorted(nums))
}
```

---

## 10. Go 1.21 slices Package

Go 1.21 introduced the `slices` package in the standard library, providing type-safe generic utilities.

```go
// example_10_slices_package.go
package main

import (
	"cmp"
	"fmt"
	"slices"
)

func main() {
	s := []int{3, 1, 4, 1, 5, 9, 2, 6, 5, 3}

	// --- Sort ---
	sorted := slices.Clone(s)
	slices.Sort(sorted)
	fmt.Println("Sorted:", sorted)

	// --- Sort with custom comparator ---
	words := []string{"banana", "Apple", "cherry"}
	slices.SortFunc(words, func(a, b string) int {
		return cmp.Compare(a, b)
	})
	fmt.Println("Sorted words:", words)

	// --- Binary search (requires sorted slice) ---
	idx, found := slices.BinarySearch(sorted, 5)
	fmt.Printf("BinarySearch 5: idx=%d found=%v\n", idx, found)

	// --- Contains ---
	fmt.Println("Contains 9:", slices.Contains(s, 9))
	fmt.Println("Contains 7:", slices.Contains(s, 7))

	// --- Index ---
	fmt.Println("Index of 9:", slices.Index(s, 9)) // first occurrence

	// --- Max / Min ---
	fmt.Println("Max:", slices.Max(s))
	fmt.Println("Min:", slices.Min(s))

	// --- Reverse ---
	rev := slices.Clone(s)
	slices.Reverse(rev)
	fmt.Println("Reversed:", rev)

	// --- Compact: remove adjacent duplicates ---
	dupes := []int{1, 1, 2, 3, 3, 3, 4, 4, 5}
	compacted := slices.Compact(dupes)
	fmt.Println("Compact:", compacted) // [1 2 3 4 5]

	// --- Equal ---
	a := []int{1, 2, 3}
	b := []int{1, 2, 3}
	fmt.Println("Equal:", slices.Equal(a, b)) // true

	// --- Insert ---
	inserted := slices.Insert(a, 1, 99) // insert 99 at index 1
	fmt.Println("Insert:", inserted) // [1 99 2 3]

	// --- Delete ---
	deleted := slices.Delete(slices.Clone(sorted), 2, 5) // delete indices [2,5)
	fmt.Println("Delete [2:5]:", deleted)
}
```

---

## Summary: Decision Guide

| Scenario | Use |
|---|---|
| Fixed-size, stack-friendly, value semantics | `[N]T` array |
| Dynamic size, unknown at compile time | `[]T` slice |
| Size known at build time, will grow | `make([]T, 0, n)` |
| Size known, all positions will be set | `make([]T, n)` |
| Sub-slice handed to external code | `s[lo:hi:hi]` three-index |
| Keep only small part of large buffer | `copy` into new slice |
| Need equality comparison on a collection | Array (not slice) |
| Passing to function without copying | Slice (pointer semantics) |

## Key Rules to Remember

1. **Slices are headers, not data.** Assigning `b := a` for slices shares the backing array.
2. **Three-index slice** `s[lo:hi:hi]` caps the capacity — protect your buffer from appends.
3. **Pre-allocate** with `make([]T, 0, n)` when the size is predictable. It is one of the highest-value micro-optimizations in Go.
4. **Break the alias** with `copy` before returning a sub-slice from a large buffer. This prevents the backing-array memory leak.
5. **Append returns a new slice.** Always use `s = append(s, elem)` — discarding the return value is a bug.
6. **nil slice is valid.** `len(nil) == 0`, range over nil slice is zero iterations. No nil check needed before range.
7. **sort.SliceStable** when equal-element order matters. `sort.Slice` may reorder equals.
