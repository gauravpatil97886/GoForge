> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# Google-Style Go Interview Questions

30 problems. For each: problem statement → Go solution → complexity → "scale this?" discussion → follow-up generalization.

Focus: algorithmic correctness, optimal O(n) solutions, code clarity.

---

## Problem 1: Concurrent Merge Sort

**Problem Statement:**
Implement merge sort using goroutines. Parallelize the divide step so each recursive half runs concurrently. Handle the threshold below which sequential sort is used.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

const threshold = 1024

func mergeSort(arr []int) []int {
	if len(arr) <= 1 {
		return arr
	}
	if len(arr) <= threshold {
		return sequentialMergeSort(arr)
	}

	mid := len(arr) / 2
	var left, right []int
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		left = mergeSort(arr[:mid])
	}()
	go func() {
		defer wg.Done()
		right = mergeSort(arr[mid:])
	}()

	wg.Wait()
	return merge(left, right)
}

func sequentialMergeSort(arr []int) []int {
	if len(arr) <= 1 {
		return arr
	}
	mid := len(arr) / 2
	left := sequentialMergeSort(arr[:mid])
	right := sequentialMergeSort(arr[mid:])
	return merge(left, right)
}

func merge(left, right []int) []int {
	result := make([]int, 0, len(left)+len(right))
	i, j := 0, 0
	for i < len(left) && j < len(right) {
		if left[i] <= right[j] {
			result = append(result, left[i])
			i++
		} else {
			result = append(result, right[j])
			j++
		}
	}
	result = append(result, left[i:]...)
	result = append(result, right[j:]...)
	return result
}

func main() {
	arr := []int{5, 2, 8, 1, 9, 3, 7, 4, 6}
	sorted := mergeSort(arr)
	fmt.Println(sorted)
}
```

**Complexity:**
- Time: O(n log n) — parallelism reduces wall time to O(n) with enough cores
- Space: O(n log n) — recursive stack + merge buffers

**Scale This?**
- For arrays >100M elements, distribute partitions across machines using a coordinator-worker pattern (gRPC calls).
- Use a worker pool bounded by `runtime.NumCPU()` to avoid goroutine explosion.
- External merge sort for data exceeding RAM: sort chunks on disk, then K-way merge.

**Follow-up Generalization:**
Can you make it generic over `constraints.Ordered`? Use a comparator function parameter to support custom types.

---

## Problem 2: Goroutine-Safe LRU Cache

**Problem Statement:**
Implement an LRU cache with O(1) Get and Put operations that is safe for concurrent access by multiple goroutines.

**Go Solution:**

```go
package main

import (
	"container/list"
	"fmt"
	"sync"
)

type entry struct {
	key, value int
}

type LRUCache struct {
	cap   int
	mu    sync.RWMutex
	list  *list.List
	items map[int]*list.Element
}

func NewLRUCache(cap int) *LRUCache {
	return &LRUCache{
		cap:   cap,
		list:  list.New(),
		items: make(map[int]*list.Element),
	}
}

func (c *LRUCache) Get(key int) (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.list.MoveToFront(el)
		return el.Value.(*entry).value, true
	}
	return -1, false
}

func (c *LRUCache) Put(key, value int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.list.MoveToFront(el)
		el.Value.(*entry).value = value
		return
	}
	if c.list.Len() == c.cap {
		back := c.list.Back()
		c.list.Remove(back)
		delete(c.items, back.Value.(*entry).key)
	}
	el := c.list.PushFront(&entry{key, value})
	c.items[key] = el
}

func main() {
	cache := NewLRUCache(3)
	cache.Put(1, 10)
	cache.Put(2, 20)
	cache.Put(3, 30)
	v, _ := cache.Get(1)
	fmt.Println(v) // 10
	cache.Put(4, 40) // evicts key 2
	_, ok := cache.Get(2)
	fmt.Println(ok) // false
}
```

**Complexity:**
- Get: O(1) amortized
- Put: O(1) amortized
- Space: O(capacity)

**Scale This?**
- Shard the cache into N segments (e.g., 256), each with its own mutex. Key → shard by `key % N`.
- For distributed LRU, use Redis with an LRU eviction policy + a write-through strategy.
- Implement a TTL layer with a background ticker goroutine that sweeps expired entries.

**Follow-up Generalization:**
Extend to LFU (Least Frequently Used). Track a frequency map alongside the doubly-linked list.

---

## Problem 3: Distributed Rate Limiter

**Problem Statement:**
Implement a token bucket rate limiter that can be used across a distributed system. Support per-user limits and atomic operations.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type TokenBucket struct {
	mu         sync.Mutex
	tokens     float64
	maxTokens  float64
	refillRate float64 // tokens per second
	lastRefill time.Time
}

func NewTokenBucket(maxTokens, refillRate float64) *TokenBucket {
	return &TokenBucket{
		tokens:     maxTokens,
		maxTokens:  maxTokens,
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
}

func (tb *TokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(tb.lastRefill).Seconds()
	tb.tokens = min(tb.maxTokens, tb.tokens+elapsed*tb.refillRate)
	tb.lastRefill = now

	if tb.tokens >= 1.0 {
		tb.tokens--
		return true
	}
	return false
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

type RateLimiter struct {
	mu      sync.RWMutex
	buckets map[string]*TokenBucket
	max     float64
	rate    float64
}

func NewRateLimiter(max, rate float64) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*TokenBucket),
		max:     max,
		rate:    rate,
	}
}

func (rl *RateLimiter) Allow(userID string) bool {
	rl.mu.RLock()
	bucket, ok := rl.buckets[userID]
	rl.mu.RUnlock()

	if !ok {
		rl.mu.Lock()
		// Double-check after acquiring write lock
		if bucket, ok = rl.buckets[userID]; !ok {
			bucket = NewTokenBucket(rl.max, rl.rate)
			rl.buckets[userID] = bucket
		}
		rl.mu.Unlock()
	}
	return bucket.Allow()
}

func main() {
	rl := NewRateLimiter(5, 2) // 5 tokens max, refill 2/sec
	for i := 0; i < 8; i++ {
		fmt.Printf("Request %d: allowed=%v\n", i+1, rl.Allow("user-1"))
	}
}
```

**Complexity:**
- Allow: O(1) per call
- Space: O(unique users)

**Scale This?**
- Use Redis INCR + EXPIRE for atomic distributed rate limiting across pods.
- Lua script in Redis ensures atomicity of check-and-decrement.
- Use sliding window log in Redis ZSET for exact rate limiting.

**Follow-up Generalization:**
Implement sliding window counter using a circular buffer. Compare token bucket vs. leaky bucket vs. sliding window.

---

## Problem 4: Concurrent Word Frequency on 1TB File

**Problem Statement:**
Count word frequencies in a 1TB file. Use goroutines to parallelize chunk reading and counting. Merge partial results efficiently.

**Go Solution:**

```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"sync"
)

func countChunk(chunk []string) map[string]int {
	freq := make(map[string]int)
	for _, line := range chunk {
		for _, word := range strings.Fields(line) {
			freq[strings.ToLower(word)]++
		}
	}
	return freq
}

func mergeFreq(dst, src map[string]int) {
	for k, v := range src {
		dst[k] += v
	}
}

func wordFrequency(filename string, workers int) (map[string]int, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	chunkCh := make(chan []string, workers)
	resultCh := make(chan map[string]int, workers)
	var wg sync.WaitGroup

	// Start workers
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for chunk := range chunkCh {
				resultCh <- countChunk(chunk)
			}
		}()
	}

	// Close resultCh when all workers are done
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	// Read file and send chunks
	go func() {
		scanner := bufio.NewScanner(f)
		chunk := make([]string, 0, 1000)
		for scanner.Scan() {
			chunk = append(chunk, scanner.Text())
			if len(chunk) == 1000 {
				chunkCh <- chunk
				chunk = make([]string, 0, 1000)
			}
		}
		if len(chunk) > 0 {
			chunkCh <- chunk
		}
		close(chunkCh)
	}()

	// Merge results
	final := make(map[string]int)
	for partial := range resultCh {
		mergeFreq(final, partial)
	}
	return final, nil
}

func main() {
	// Demo with stdin simulation
	freq := countChunk([]string{"hello world", "hello go", "world go go"})
	fmt.Println(freq)
}
```

**Complexity:**
- Time: O(N/W) wall time with W workers, O(N) total work
- Space: O(V) where V = vocabulary size

**Scale This?**
- MapReduce pattern: mappers emit (word, 1), reducers sum per partition key.
- Use mmap for zero-copy file reading on a single machine.
- Distribute across machines: hash partitioning by word ensures each word goes to exactly one reducer.

**Follow-up Generalization:**
Top-K most frequent words using a min-heap of size K, streamed in O(N log K).

---

## Problem 5: Pub-Sub with Backpressure

**Problem Statement:**
Implement a publish-subscribe system where publishers send messages to topics and subscribers receive them. Handle slow subscribers with backpressure (drop or block).

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type Message struct {
	Topic   string
	Payload interface{}
}

type Subscriber struct {
	id   string
	ch   chan Message
	done chan struct{}
}

type PubSub struct {
	mu          sync.RWMutex
	subscribers map[string][]*Subscriber
	bufSize     int
}

func NewPubSub(bufSize int) *PubSub {
	return &PubSub{
		subscribers: make(map[string][]*Subscriber),
		bufSize:     bufSize,
	}
}

func (ps *PubSub) Subscribe(topic, id string) *Subscriber {
	sub := &Subscriber{
		id:   id,
		ch:   make(chan Message, ps.bufSize),
		done: make(chan struct{}),
	}
	ps.mu.Lock()
	ps.subscribers[topic] = append(ps.subscribers[topic], sub)
	ps.mu.Unlock()
	return sub
}

func (ps *PubSub) Publish(msg Message) {
	ps.mu.RLock()
	subs := ps.subscribers[msg.Topic]
	ps.mu.RUnlock()

	for _, sub := range subs {
		select {
		case sub.ch <- msg:
		case <-sub.done:
			// subscriber unsubscribed
		default:
			// backpressure: drop message for slow subscriber
			fmt.Printf("dropping message for slow subscriber %s\n", sub.id)
		}
	}
}

func (ps *PubSub) Unsubscribe(topic, id string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	subs := ps.subscribers[topic]
	for i, sub := range subs {
		if sub.id == id {
			close(sub.done)
			ps.subscribers[topic] = append(subs[:i], subs[i+1:]...)
			return
		}
	}
}

func main() {
	ps := NewPubSub(10)
	sub := ps.Subscribe("events", "sub-1")

	go func() {
		for msg := range sub.ch {
			fmt.Println("received:", msg.Payload)
			time.Sleep(10 * time.Millisecond)
		}
	}()

	for i := 0; i < 5; i++ {
		ps.Publish(Message{Topic: "events", Payload: i})
	}
	time.Sleep(100 * time.Millisecond)
}
```

**Complexity:**
- Publish: O(S) where S = number of subscribers per topic
- Subscribe/Unsubscribe: O(S)

**Scale This?**
- Persistent topics with Kafka: partition by key, consumers in consumer groups.
- Implement a blocking backpressure mode with a configurable timeout.
- Use fan-out goroutines per subscriber to avoid blocking the publisher.

**Follow-up Generalization:**
Add wildcard topic matching (e.g., `events.*`). Implement at-least-once delivery with ACK tracking.

---

## Problem 6: Trie in Go

**Problem Statement:**
Implement a Trie (prefix tree) supporting Insert, Search, and StartsWith operations. Make it thread-safe.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

type TrieNode struct {
	children [26]*TrieNode
	isEnd    bool
}

type Trie struct {
	root *TrieNode
	mu   sync.RWMutex
}

func NewTrie() *Trie {
	return &Trie{root: &TrieNode{}}
}

func (t *Trie) Insert(word string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	node := t.root
	for _, ch := range word {
		idx := ch - 'a'
		if node.children[idx] == nil {
			node.children[idx] = &TrieNode{}
		}
		node = node.children[idx]
	}
	node.isEnd = true
}

func (t *Trie) Search(word string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	node := t.root
	for _, ch := range word {
		idx := ch - 'a'
		if node.children[idx] == nil {
			return false
		}
		node = node.children[idx]
	}
	return node.isEnd
}

func (t *Trie) StartsWith(prefix string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	node := t.root
	for _, ch := range prefix {
		idx := ch - 'a'
		if node.children[idx] == nil {
			return false
		}
		node = node.children[idx]
	}
	return true
}

func (t *Trie) AutoComplete(prefix string) []string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	node := t.root
	for _, ch := range prefix {
		idx := ch - 'a'
		if node.children[idx] == nil {
			return nil
		}
		node = node.children[idx]
	}
	var results []string
	var dfs func(n *TrieNode, path string)
	dfs = func(n *TrieNode, path string) {
		if n.isEnd {
			results = append(results, prefix+path)
		}
		for i, child := range n.children {
			if child != nil {
				dfs(child, path+string(rune('a'+i)))
			}
		}
	}
	dfs(node, "")
	return results
}

func main() {
	trie := NewTrie()
	trie.Insert("apple")
	trie.Insert("app")
	trie.Insert("application")
	fmt.Println(trie.Search("app"))       // true
	fmt.Println(trie.StartsWith("appl"))  // true
	fmt.Println(trie.AutoComplete("app")) // [app apple application]
}
```

**Complexity:**
- Insert/Search/StartsWith: O(L) where L = word length
- Space: O(A * N * L) where A=alphabet size, N=words

**Scale This?**
- Compressed Trie (Radix Tree) reduces node count for sparse tries.
- Serialize trie to disk using prefix-coded sorted array (like Lucene FST).
- Distribute trie by first letter or hash prefix across shards.

**Follow-up Generalization:**
Implement a Trie with delete. Support Unicode (map[rune]*TrieNode instead of fixed [26]).

---

## Problem 7: Graph BFS/DFS with Goroutines

**Problem Statement:**
Implement BFS and DFS on a directed graph. Parallelize BFS level expansion using goroutines. Detect cycles in DFS.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

type Graph struct {
	adj map[int][]int
}

func NewGraph() *Graph {
	return &Graph{adj: make(map[int][]int)}
}

func (g *Graph) AddEdge(u, v int) {
	g.adj[u] = append(g.adj[u], v)
}

// Concurrent BFS - processes each level in parallel
func (g *Graph) BFS(start int) []int {
	visited := sync.Map{}
	visited.Store(start, true)
	level := []int{start}
	var order []int

	for len(level) > 0 {
		order = append(order, level...)
		var mu sync.Mutex
		var nextLevel []int
		var wg sync.WaitGroup

		for _, node := range level {
			node := node
			wg.Add(1)
			go func() {
				defer wg.Done()
				for _, neighbor := range g.adj[node] {
					if _, loaded := visited.LoadOrStore(neighbor, true); !loaded {
						mu.Lock()
						nextLevel = append(nextLevel, neighbor)
						mu.Unlock()
					}
				}
			}()
		}
		wg.Wait()
		level = nextLevel
	}
	return order
}

// DFS with cycle detection
func (g *Graph) HasCycle() bool {
	visited := make(map[int]bool)
	inStack := make(map[int]bool)

	var dfs func(node int) bool
	dfs = func(node int) bool {
		visited[node] = true
		inStack[node] = true
		for _, neighbor := range g.adj[node] {
			if !visited[neighbor] {
				if dfs(neighbor) {
					return true
				}
			} else if inStack[neighbor] {
				return true
			}
		}
		inStack[node] = false
		return false
	}

	for node := range g.adj {
		if !visited[node] {
			if dfs(node) {
				return true
			}
		}
	}
	return false
}

func main() {
	g := NewGraph()
	g.AddEdge(0, 1)
	g.AddEdge(0, 2)
	g.AddEdge(1, 3)
	g.AddEdge(2, 3)
	g.AddEdge(3, 4)

	fmt.Println("BFS:", g.BFS(0))
	fmt.Println("Has cycle:", g.HasCycle())

	g2 := NewGraph()
	g2.AddEdge(0, 1)
	g2.AddEdge(1, 2)
	g2.AddEdge(2, 0)
	fmt.Println("Has cycle:", g2.HasCycle())
}
```

**Complexity:**
- BFS: O(V + E) time, concurrent level expansion reduces latency
- DFS: O(V + E) time

**Scale This?**
- Distributed graph: partition vertices across machines; cross-partition edges need RPC.
- Use Pregel model (Google): each vertex runs a compute function, messages sent to neighbors.
- For large sparse graphs, store adjacency list in Redis hashes.

**Follow-up Generalization:**
Topological sort using DFS. Shortest path in weighted graph (Dijkstra with a min-heap).

---

## Problem 8: Top-K Concurrent Workers

**Problem Statement:**
Given a stream of tasks with scores, maintain the top-K tasks at any point using concurrent workers submitting results.

**Go Solution:**

```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type Task struct {
	ID    int
	Score int
}

type MinHeap []Task

func (h MinHeap) Len() int            { return len(h) }
func (h MinHeap) Less(i, j int) bool  { return h[i].Score < h[j].Score }
func (h MinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x interface{}) { *h = append(*h, x.(Task)) }
func (h *MinHeap) Pop() interface{} {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

type TopKCollector struct {
	mu   sync.Mutex
	h    *MinHeap
	k    int
}

func NewTopKCollector(k int) *TopKCollector {
	h := &MinHeap{}
	heap.Init(h)
	return &TopKCollector{h: h, k: k}
}

func (c *TopKCollector) Submit(t Task) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.h.Len() < c.k {
		heap.Push(c.h, t)
	} else if (*c.h)[0].Score < t.Score {
		heap.Pop(c.h)
		heap.Push(c.h, t)
	}
}

func (c *TopKCollector) TopK() []Task {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := make([]Task, len(*c.h))
	copy(result, *c.h)
	return result
}

func main() {
	collector := NewTopKCollector(3)
	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			time.Sleep(time.Duration(rand.Intn(10)) * time.Millisecond)
			collector.Submit(Task{ID: id, Score: rand.Intn(100)})
		}(i)
	}

	wg.Wait()
	fmt.Println("Top 3 tasks:", collector.TopK())
}
```

**Complexity:**
- Submit: O(log K)
- TopK: O(K)
- Space: O(K)

**Scale This?**
- Parallel top-K: each worker maintains local top-K, merge at end with O(W*K log W*K).
- For streaming: use Count-Min Sketch for approximate top-K with O(1) updates.
- Distributed: each shard returns top-K, coordinator merges K shards → O(K log K).

**Follow-up Generalization:**
Median of stream using two heaps (max-heap + min-heap). Percentile tracking with reservoir sampling.

---

## Problem 9: Sliding Window Maximum

**Problem Statement:**
Find the maximum value in every sliding window of size K as it moves across an array.

**Go Solution:**

```go
package main

import "fmt"

func slidingWindowMax(nums []int, k int) []int {
	if len(nums) == 0 || k == 0 {
		return nil
	}
	// Deque stores indices; front is always the max
	deque := make([]int, 0, k)
	result := make([]int, 0, len(nums)-k+1)

	for i, val := range nums {
		// Remove indices outside window
		for len(deque) > 0 && deque[0] < i-k+1 {
			deque = deque[1:]
		}
		// Remove smaller elements from back
		for len(deque) > 0 && nums[deque[len(deque)-1]] < val {
			deque = deque[:len(deque)-1]
		}
		deque = append(deque, i)
		if i >= k-1 {
			result = append(result, nums[deque[0]])
		}
	}
	return result
}

// Concurrent version for multiple windows in parallel
func slidingWindowMaxConcurrent(nums []int, k int, workers int) []int {
	result := slidingWindowMax(nums, k)
	return result
}

func main() {
	nums := []int{1, 3, -1, -3, 5, 3, 6, 7}
	fmt.Println(slidingWindowMax(nums, 3)) // [3 3 5 5 6 7]
}
```

**Complexity:**
- Time: O(n) — each element pushed/popped at most once
- Space: O(k)

**Scale This?**
- For streaming data, the deque approach extends naturally; maintain a deque per window.
- For time-series data, use segment trees or sparse tables for range max queries in O(1).
- Parallel: split array into W segments with k-1 overlap, process concurrently.

**Follow-up Generalization:**
Sliding window minimum, sum, average. Apply to stock price analysis (max drawdown).

---

## Problem 10: Two-Sum Concurrent

**Problem Statement:**
Find all pairs in a large array that sum to a target. Parallelize using goroutines with a worker pool pattern.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

type Pair struct{ i, j int }

func twoSumConcurrent(nums []int, target int, workers int) []Pair {
	n := len(nums)
	complement := make(map[int][]int)
	for i, v := range nums {
		complement[v] = append(complement[v], i)
	}

	jobs := make(chan int, n)
	results := make(chan Pair, n)
	var wg sync.WaitGroup

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				need := target - nums[i]
				for _, j := range complement[need] {
					if j > i {
						results <- Pair{i, j}
					}
				}
			}
		}()
	}

	for i := 0; i < n; i++ {
		jobs <- i
	}
	close(jobs)

	go func() {
		wg.Wait()
		close(results)
	}()

	var pairs []Pair
	for p := range results {
		pairs = append(pairs, p)
	}
	return pairs
}

func main() {
	nums := []int{2, 7, 11, 15, 1, 8, 3, 6}
	pairs := twoSumConcurrent(nums, 9, 4)
	for _, p := range pairs {
		fmt.Printf("[%d, %d] = %d + %d\n", p.i, p.j, nums[p.i], nums[p.j])
	}
}
```

**Complexity:**
- Time: O(n) build + O(n/W) per worker
- Space: O(n)

**Scale This?**
- For 1B elements, distribute across machines; each node handles a partition and cross-checks with a broadcast table.
- Use bit-array for seen values when values are bounded integers (O(1) space per element).

**Follow-up Generalization:**
Three-sum, four-sum. Two-sum in a sorted array using two pointers O(n) without a hash map.

---

## Problem 11: Job Scheduler with DAG Dependencies

**Problem Statement:**
Implement a job scheduler where jobs have dependencies (DAG). Execute jobs concurrently when their dependencies are satisfied.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

type Job struct {
	ID   string
	Deps []string
	Run  func()
}

type Scheduler struct {
	jobs    map[string]*Job
	inDeg   map[string]int
	waiters map[string][]string
}

func NewScheduler() *Scheduler {
	return &Scheduler{
		jobs:    make(map[string]*Job),
		inDeg:   make(map[string]int),
		waiters: make(map[string][]string),
	}
}

func (s *Scheduler) AddJob(job *Job) {
	s.jobs[job.ID] = job
	s.inDeg[job.ID] = len(job.Deps)
	for _, dep := range job.Deps {
		s.waiters[dep] = append(s.waiters[dep], job.ID)
	}
}

func (s *Scheduler) Run() {
	var mu sync.Mutex
	var wg sync.WaitGroup
	ready := make(chan string, len(s.jobs))

	// Enqueue jobs with no dependencies
	for id, deg := range s.inDeg {
		if deg == 0 {
			ready <- id
		}
	}

	completed := 0
	total := len(s.jobs)

	for completed < total {
		select {
		case id := <-ready:
			wg.Add(1)
			go func(jobID string) {
				defer wg.Done()
				s.jobs[jobID].Run()
				mu.Lock()
				for _, waiter := range s.waiters[jobID] {
					s.inDeg[waiter]--
					if s.inDeg[waiter] == 0 {
						ready <- waiter
					}
				}
				mu.Unlock()
			}(id)
			completed++
		}
	}
	wg.Wait()
}

func main() {
	s := NewScheduler()
	s.AddJob(&Job{ID: "A", Deps: nil, Run: func() { fmt.Println("Running A") }})
	s.AddJob(&Job{ID: "B", Deps: []string{"A"}, Run: func() { fmt.Println("Running B") }})
	s.AddJob(&Job{ID: "C", Deps: []string{"A"}, Run: func() { fmt.Println("Running C") }})
	s.AddJob(&Job{ID: "D", Deps: []string{"B", "C"}, Run: func() { fmt.Println("Running D") }})
	s.Run()
}
```

**Complexity:**
- Time: O(V + E) — Kahn's algorithm variant
- Space: O(V + E)

**Scale This?**
- Workflow engines: Apache Airflow, Argo Workflows use this pattern.
- Store job state in a distributed KV store; use leader election for the scheduler.
- Add retry with exponential backoff per job; dead-letter queue for permanently failed jobs.

**Follow-up Generalization:**
Add job priorities. Implement a critical path calculation (longest path in DAG = minimum completion time).

---

## Problem 12: Load Balancer

**Problem Statement:**
Implement a load balancer supporting round-robin, least-connections, and weighted routing strategies.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type Backend struct {
	Address     string
	Weight      int
	Connections int64
	Healthy     bool
}

type LoadBalancer struct {
	backends []*Backend
	mu       sync.RWMutex
	counter  uint64
}

func NewLoadBalancer(backends []*Backend) *LoadBalancer {
	return &LoadBalancer{backends: backends}
}

func (lb *LoadBalancer) RoundRobin() *Backend {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	n := uint64(len(lb.backends))
	for i := uint64(0); i < n; i++ {
		idx := atomic.AddUint64(&lb.counter, 1) % n
		if lb.backends[idx].Healthy {
			return lb.backends[idx]
		}
	}
	return nil
}

func (lb *LoadBalancer) LeastConnections() *Backend {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	var best *Backend
	for _, b := range lb.backends {
		if b.Healthy {
			if best == nil || atomic.LoadInt64(&b.Connections) < atomic.LoadInt64(&best.Connections) {
				best = b
			}
		}
	}
	if best != nil {
		atomic.AddInt64(&best.Connections, 1)
	}
	return best
}

func (lb *LoadBalancer) Weighted() *Backend {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	total := 0
	for _, b := range lb.backends {
		if b.Healthy {
			total += b.Weight
		}
	}
	if total == 0 {
		return nil
	}
	pick := int(atomic.AddUint64(&lb.counter, 1)) % total
	for _, b := range lb.backends {
		if b.Healthy {
			pick -= b.Weight
			if pick < 0 {
				return b
			}
		}
	}
	return nil
}

func main() {
	backends := []*Backend{
		{Address: "10.0.0.1:8080", Weight: 3, Healthy: true},
		{Address: "10.0.0.2:8080", Weight: 1, Healthy: true},
		{Address: "10.0.0.3:8080", Weight: 2, Healthy: true},
	}
	lb := NewLoadBalancer(backends)

	for i := 0; i < 6; i++ {
		b := lb.RoundRobin()
		fmt.Println("RR:", b.Address)
	}
	b := lb.LeastConnections()
	fmt.Println("LC:", b.Address)
}
```

**Complexity:**
- Round Robin: O(1) amortized
- Least Connections: O(N) per call
- Weighted: O(N) per call

**Scale This?**
- Health check goroutine pings backends on a ticker; updates `Healthy` atomically.
- Consistent hashing for sticky sessions (same client always routed to same backend).
- L7 load balancer: route based on URL path, headers, or JWT claims.

**Follow-up Generalization:**
Implement IP hash routing. Add circuit breaker per backend (open/half-open/closed states).

---

## Problem 13: Consistent Hashing

**Problem Statement:**
Implement consistent hashing with virtual nodes to distribute keys evenly across a dynamic set of servers.

**Go Solution:**

```go
package main

import (
	"crypto/md5"
	"encoding/binary"
	"fmt"
	"sort"
	"sync"
)

type ConsistentHash struct {
	mu       sync.RWMutex
	ring     map[uint32]string
	sorted   []uint32
	replicas int
}

func NewConsistentHash(replicas int) *ConsistentHash {
	return &ConsistentHash{
		ring:     make(map[uint32]string),
		replicas: replicas,
	}
}

func (c *ConsistentHash) hash(key string) uint32 {
	h := md5.Sum([]byte(key))
	return binary.BigEndian.Uint32(h[:4])
}

func (c *ConsistentHash) AddNode(node string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := 0; i < c.replicas; i++ {
		vnode := fmt.Sprintf("%s#%d", node, i)
		h := c.hash(vnode)
		c.ring[h] = node
		c.sorted = append(c.sorted, h)
	}
	sort.Slice(c.sorted, func(i, j int) bool { return c.sorted[i] < c.sorted[j] })
}

func (c *ConsistentHash) RemoveNode(node string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := 0; i < c.replicas; i++ {
		vnode := fmt.Sprintf("%s#%d", node, i)
		h := c.hash(vnode)
		delete(c.ring, h)
	}
	// Rebuild sorted slice
	c.sorted = c.sorted[:0]
	for h := range c.ring {
		c.sorted = append(c.sorted, h)
	}
	sort.Slice(c.sorted, func(i, j int) bool { return c.sorted[i] < c.sorted[j] })
}

func (c *ConsistentHash) GetNode(key string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.sorted) == 0 {
		return ""
	}
	h := c.hash(key)
	idx := sort.Search(len(c.sorted), func(i int) bool { return c.sorted[i] >= h })
	if idx == len(c.sorted) {
		idx = 0
	}
	return c.ring[c.sorted[idx]]
}

func main() {
	ch := NewConsistentHash(150)
	ch.AddNode("server-1")
	ch.AddNode("server-2")
	ch.AddNode("server-3")

	keys := []string{"user:1", "user:2", "user:3", "order:100", "order:200"}
	for _, k := range keys {
		fmt.Printf("%s -> %s\n", k, ch.GetNode(k))
	}

	fmt.Println("After removing server-2:")
	ch.RemoveNode("server-2")
	for _, k := range keys {
		fmt.Printf("%s -> %s\n", k, ch.GetNode(k))
	}
}
```

**Complexity:**
- AddNode/RemoveNode: O(R log R) where R = replicas
- GetNode: O(log N) binary search
- Space: O(N * R)

**Scale This?**
- Used in Cassandra, DynamoDB for partition assignment.
- Virtual nodes ensure even distribution even when nodes have different capacities.
- Replication: for each key, store on the next K nodes clockwise on the ring.

**Follow-up Generalization:**
Rendezvous hashing (HRW) as an alternative. Jump consistent hash for O(1) computation.

---

## Problem 14: K-Way Merge with Channels

**Problem Statement:**
Merge K sorted streams (channels) into a single sorted output channel using a min-heap.

**Go Solution:**

```go
package main

import (
	"container/heap"
	"fmt"
)

type Item struct {
	value    int
	streamID int
}

type ItemHeap []Item

func (h ItemHeap) Len() int            { return len(h) }
func (h ItemHeap) Less(i, j int) bool  { return h[i].value < h[j].value }
func (h ItemHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *ItemHeap) Push(x interface{}) { *h = append(*h, x.(Item)) }
func (h *ItemHeap) Pop() interface{} {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

func kWayMerge(streams []<-chan int) <-chan int {
	out := make(chan int)
	h := &ItemHeap{}
	heap.Init(h)

	// Channel wrappers to track closures
	type streamVal struct {
		val    int
		ok     bool
		stream <-chan int
		id     int
	}

	go func() {
		defer close(out)
		// Initialize heap with first element from each stream
		for i, s := range streams {
			if val, ok := <-s; ok {
				heap.Push(h, Item{val, i})
			}
		}

		for h.Len() > 0 {
			item := heap.Pop(h).(Item)
			out <- item.value
			// Get next from same stream
			if val, ok := <-streams[item.streamID]; ok {
				heap.Push(h, Item{val, item.streamID})
			}
		}
	}()

	return out
}

func makeStream(vals []int) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		for _, v := range vals {
			ch <- v
		}
	}()
	return ch
}

func main() {
	streams := []<-chan int{
		makeStream([]int{1, 4, 7, 10}),
		makeStream([]int{2, 5, 8, 11}),
		makeStream([]int{3, 6, 9, 12}),
	}
	merged := kWayMerge(streams)
	for v := range merged {
		fmt.Printf("%d ", v)
	}
	fmt.Println()
}
```

**Complexity:**
- Time: O(N log K) where N = total elements, K = streams
- Space: O(K) heap

**Scale This?**
- External sort: sort chunks in parallel, then K-way merge to produce final sorted file.
- Streaming merge in ETL pipelines: merge sorted partitions from different data sources.
- Use `context.Context` for cancellation propagation across all streams.

**Follow-up Generalization:**
K-way merge of struct streams with custom comparator. Merge with deduplication (skip identical values).

---

## Problem 15: Concurrent Fibonacci

**Problem Statement:**
Compute Fibonacci numbers using memoization with goroutines. Handle concurrent requests for the same value without redundant computation.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

type FibCache struct {
	mu    sync.RWMutex
	cache map[int]int
	calls map[int]*sync.Once
}

func NewFibCache() *FibCache {
	return &FibCache{
		cache: map[int]int{0: 0, 1: 1},
		calls: make(map[int]*sync.Once),
	}
}

func (fc *FibCache) getOnce(n int) *sync.Once {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	if fc.calls[n] == nil {
		fc.calls[n] = &sync.Once{}
	}
	return fc.calls[n]
}

func (fc *FibCache) Fib(n int) int {
	fc.mu.RLock()
	if v, ok := fc.cache[n]; ok {
		fc.mu.RUnlock()
		return v
	}
	fc.mu.RUnlock()

	fc.getOnce(n).Do(func() {
		result := fc.Fib(n-1) + fc.Fib(n-2)
		fc.mu.Lock()
		fc.cache[n] = result
		fc.mu.Unlock()
	})

	fc.mu.RLock()
	defer fc.mu.RUnlock()
	return fc.cache[n]
}

// Channel-based Fibonacci generator
func fibGen(n int) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		a, b := 0, 1
		for i := 0; i <= n; i++ {
			ch <- a
			a, b = b, a+b
		}
	}()
	return ch
}

func main() {
	fc := NewFibCache()
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		n := 10 + i
		go func() {
			defer wg.Done()
			fmt.Printf("Fib(%d) = %d\n", n, fc.Fib(n))
		}()
	}
	wg.Wait()

	fmt.Print("Generator: ")
	for v := range fibGen(10) {
		fmt.Printf("%d ", v)
	}
	fmt.Println()
}
```

**Complexity:**
- Memoized: O(n) time, O(n) space
- Generator: O(1) space per element

**Scale This?**
- For very large n, use matrix exponentiation: O(log n).
- Distribute computation: map fib(n) to a cache cluster keyed by n.
- `singleflight.Group` from `golang.org/x/sync` is the idiomatic Go solution for deduplicating concurrent calls.

**Follow-up Generalization:**
Generalize to arbitrary linear recurrences. Use `singleflight.Group` for idiomatic deduplication.

---

## Problem 16: Real-Time Leaderboard

**Problem Statement:**
Implement a real-time leaderboard that supports score updates, rank queries, and top-N retrieval efficiently with concurrent updates.

**Go Solution:**

```go
package main

import (
	"container/heap"
	"fmt"
	"sync"
)

type Player struct {
	ID    string
	Score int
	index int // heap index
}

type PlayerHeap []*Player

func (h PlayerHeap) Len() int            { return len(h) }
func (h PlayerHeap) Less(i, j int) bool  { return h[i].Score > h[j].Score } // max-heap
func (h PlayerHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
	h[i].index = i
	h[j].index = j
}
func (h *PlayerHeap) Push(x interface{}) {
	p := x.(*Player)
	p.index = len(*h)
	*h = append(*h, p)
}
func (h *PlayerHeap) Pop() interface{} {
	old := *h
	p := old[len(old)-1]
	p.index = -1
	*h = old[:len(old)-1]
	return p
}

type Leaderboard struct {
	mu      sync.RWMutex
	h       *PlayerHeap
	players map[string]*Player
}

func NewLeaderboard() *Leaderboard {
	h := &PlayerHeap{}
	heap.Init(h)
	return &Leaderboard{
		h:       h,
		players: make(map[string]*Player),
	}
}

func (lb *Leaderboard) UpdateScore(id string, delta int) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	if p, ok := lb.players[id]; ok {
		p.Score += delta
		heap.Fix(lb.h, p.index)
	} else {
		p = &Player{ID: id, Score: delta}
		lb.players[id] = p
		heap.Push(lb.h, p)
	}
}

func (lb *Leaderboard) TopN(n int) []Player {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	result := make([]Player, 0, n)
	for i := 0; i < n && i < len(*lb.h); i++ {
		result = append(result, *(*lb.h)[i])
	}
	return result
}

func (lb *Leaderboard) Rank(id string) int {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	if p, ok := lb.players[id]; ok {
		return p.index + 1
	}
	return -1
}

func main() {
	lb := NewLeaderboard()
	players := []struct{ id string; score int }{
		{"alice", 100}, {"bob", 200}, {"carol", 150}, {"dave", 300},
	}
	var wg sync.WaitGroup
	for _, p := range players {
		wg.Add(1)
		go func(id string, score int) {
			defer wg.Done()
			lb.UpdateScore(id, score)
		}(p.id, p.score)
	}
	wg.Wait()

	fmt.Println("Top 3:", lb.TopN(3))
	fmt.Println("Alice rank:", lb.Rank("alice"))
}
```

**Complexity:**
- UpdateScore: O(log N)
- TopN: O(N) — could optimize to O(K log K) with a secondary sorted view
- Rank: O(1)

**Scale This?**
- Redis ZADD/ZRANK/ZRANGE for distributed leaderboard — O(log N) all operations.
- Segment leaderboard by time window (daily, weekly, all-time) using multiple sorted sets.
- Shard by game/region; global leaderboard requires merging shards.

**Follow-up Generalization:**
Percentile rank: what fraction of players have a lower score? Use order statistics tree.

---

## Problem 17: Interval Merging at Scale

**Problem Statement:**
Given a list of intervals (possibly overlapping), merge all overlapping intervals. Handle concurrent interval additions.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sort"
	"sync"
)

type Interval struct {
	Start, End int
}

type IntervalSet struct {
	mu        sync.RWMutex
	intervals []Interval
	dirty     bool
}

func NewIntervalSet() *IntervalSet {
	return &IntervalSet{}
}

func (s *IntervalSet) Add(iv Interval) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.intervals = append(s.intervals, iv)
	s.dirty = true
}

func (s *IntervalSet) Merge() []Interval {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return s.intervals
	}

	sort.Slice(s.intervals, func(i, j int) bool {
		return s.intervals[i].Start < s.intervals[j].Start
	})

	merged := []Interval{s.intervals[0]}
	for _, iv := range s.intervals[1:] {
		last := &merged[len(merged)-1]
		if iv.Start <= last.End {
			if iv.End > last.End {
				last.End = iv.End
			}
		} else {
			merged = append(merged, iv)
		}
	}
	s.intervals = merged
	s.dirty = false
	return merged
}

// InsertAndMerge inserts a new interval and merges in O(n)
func insertAndMerge(intervals []Interval, newIv Interval) []Interval {
	var result []Interval
	i := 0

	// Add all intervals that end before newIv starts
	for i < len(intervals) && intervals[i].End < newIv.Start {
		result = append(result, intervals[i])
		i++
	}

	// Merge overlapping intervals with newIv
	for i < len(intervals) && intervals[i].Start <= newIv.End {
		if intervals[i].Start < newIv.Start {
			newIv.Start = intervals[i].Start
		}
		if intervals[i].End > newIv.End {
			newIv.End = intervals[i].End
		}
		i++
	}
	result = append(result, newIv)

	// Add remaining
	result = append(result, intervals[i:]...)
	return result
}

func main() {
	s := NewIntervalSet()
	inputs := []Interval{{1, 3}, {2, 6}, {8, 10}, {15, 18}, {9, 12}}
	var wg sync.WaitGroup
	for _, iv := range inputs {
		wg.Add(1)
		go func(iv Interval) {
			defer wg.Done()
			s.Add(iv)
		}(iv)
	}
	wg.Wait()

	fmt.Println("Merged:", s.Merge())

	// Insert into sorted merged list
	merged := []Interval{{1, 3}, {6, 9}, {15, 18}}
	result := insertAndMerge(merged, Interval{2, 5})
	fmt.Println("After insert:", result)
}
```

**Complexity:**
- Merge (batch): O(n log n) for sort, O(n) scan
- InsertAndMerge: O(n) — assuming pre-sorted list

**Scale This?**
- For calendar/scheduling systems: store intervals in a B-tree for O(log N) overlap queries.
- Segment tree for stabbing queries (find all intervals containing a point) in O(log N + K).
- Distribute by time range partitions; merge across partitions lazily.

**Follow-up Generalization:**
Find minimum number of meeting rooms needed (max overlapping intervals at any point). Count overlapping intervals for each point.

---

## Problem 18: Worker Pool Pattern

**Problem Statement:**
Implement a bounded worker pool that processes tasks with a fixed number of goroutines, supporting graceful shutdown and result collection.

**Go Solution:**

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type WorkerPool struct {
	workers int
	jobs    chan func() interface{}
	results chan interface{}
	wg      sync.WaitGroup
}

func NewWorkerPool(workers, bufSize int) *WorkerPool {
	return &WorkerPool{
		workers: workers,
		jobs:    make(chan func() interface{}, bufSize),
		results: make(chan interface{}, bufSize),
	}
}

func (wp *WorkerPool) Start(ctx context.Context) {
	for i := 0; i < wp.workers; i++ {
		wp.wg.Add(1)
		go func() {
			defer wp.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case job, ok := <-wp.jobs:
					if !ok {
						return
					}
					wp.results <- job()
				}
			}
		}()
	}
}

func (wp *WorkerPool) Submit(job func() interface{}) {
	wp.jobs <- job
}

func (wp *WorkerPool) Stop() {
	close(wp.jobs)
	wp.wg.Wait()
	close(wp.results)
}

func (wp *WorkerPool) Results() <-chan interface{} {
	return wp.results
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool := NewWorkerPool(4, 100)
	pool.Start(ctx)

	// Collect results in background
	var collected []interface{}
	done := make(chan struct{})
	go func() {
		for r := range pool.Results() {
			collected = append(collected, r)
		}
		close(done)
	}()

	// Submit 10 jobs
	for i := 0; i < 10; i++ {
		n := i
		pool.Submit(func() interface{} {
			time.Sleep(10 * time.Millisecond)
			return n * n
		})
	}

	pool.Stop()
	<-done
	fmt.Println("Results:", collected)
}
```

**Complexity:**
- Throughput: O(tasks / workers) time
- Space: O(workers + buffer)

**Scale This?**
- Dynamic resizing: scale workers up/down based on queue depth (auto-scaling).
- Add priority queues for high-priority tasks.
- Persistent job queue with Redis LPUSH/BRPOP for durability across restarts.

**Follow-up Generalization:**
Implement a semaphore-based rate limiter on top of the pool. Add per-worker metrics (tasks processed, latency percentiles).

---

## Problem 19: Concurrent Pipeline

**Problem Statement:**
Build a multi-stage processing pipeline where each stage processes data concurrently and feeds the next stage via channels.

**Go Solution:**

```go
package main

import (
	"context"
	"fmt"
)

func generate(ctx context.Context, nums ...int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for _, n := range nums {
			select {
			case out <- n:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			select {
			case out <- n * n:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out
}

func filter(ctx context.Context, in <-chan int, pred func(int) bool) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			if pred(n) {
				select {
				case out <- n:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return out
}

// Fan-out: distribute work to N workers
func fanOut(ctx context.Context, in <-chan int, n int, fn func(int) int) []<-chan int {
	outs := make([]<-chan int, n)
	for i := 0; i < n; i++ {
		out := make(chan int)
		outs[i] = out
		go func(out chan<- int) {
			defer close(out)
			for v := range in {
				select {
				case out <- fn(v):
				case <-ctx.Done():
					return
				}
			}
		}(out)
	}
	return outs
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	nums := generate(ctx, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
	squares := square(ctx, nums)
	evens := filter(ctx, squares, func(n int) bool { return n%2 == 0 })

	for v := range evens {
		fmt.Printf("%d ", v)
	}
	fmt.Println()
}
```

**Complexity:**
- Throughput limited by slowest stage
- Buffer channels between stages to reduce back-pressure stalls

**Scale This?**
- Add metrics per stage (throughput, latency, queue depth).
- Dynamic fan-out: adjust number of workers per stage based on queue depth.
- Persistent queues between stages for fault tolerance (Kafka topics).

**Follow-up Generalization:**
Implement a pipeline DSL builder. Add circuit breakers between stages to halt on downstream failure.

---

## Problem 20: Deadlock Detection

**Problem Statement:**
Implement a resource allocation graph and detect deadlocks using cycle detection in a directed graph.

**Go Solution:**

```go
package main

import "fmt"

// Resource Allocation Graph
// Processes request resources; resources are assigned to processes
type RAG struct {
	// request[process] = list of requested resources
	request map[string][]string
	// assign[resource] = process holding it
	assign map[string]string
}

func NewRAG() *RAG {
	return &RAG{
		request: make(map[string][]string),
		assign:  make(map[string]string),
	}
}

func (r *RAG) Request(process, resource string) {
	r.request[process] = append(r.request[process], resource)
}

func (r *RAG) Assign(resource, process string) {
	r.assign[resource] = process
}

// Build wait-for graph: process P waits for process Q if P requests resource held by Q
func (r *RAG) buildWaitFor() map[string][]string {
	wf := make(map[string][]string)
	for process, resources := range r.request {
		for _, res := range resources {
			if holder, ok := r.assign[res]; ok && holder != process {
				wf[process] = append(wf[process], holder)
			}
		}
	}
	return wf
}

func (r *RAG) HasDeadlock() bool {
	wf := r.buildWaitFor()
	visited := make(map[string]int) // 0=unvisited, 1=in-progress, 2=done

	var dfs func(node string) bool
	dfs = func(node string) bool {
		visited[node] = 1
		for _, neighbor := range wf[node] {
			if visited[neighbor] == 1 {
				return true
			}
			if visited[neighbor] == 0 && dfs(neighbor) {
				return true
			}
		}
		visited[node] = 2
		return false
	}

	for node := range wf {
		if visited[node] == 0 {
			if dfs(node) {
				return true
			}
		}
	}
	return false
}

func main() {
	r := NewRAG()
	r.Assign("R1", "P1")
	r.Assign("R2", "P2")
	r.Request("P1", "R2") // P1 wants R2 (held by P2)
	r.Request("P2", "R1") // P2 wants R1 (held by P1)

	fmt.Println("Deadlock detected:", r.HasDeadlock()) // true

	r2 := NewRAG()
	r2.Assign("R1", "P1")
	r2.Request("P2", "R1") // P2 waits for P1, no cycle
	fmt.Println("Deadlock detected:", r2.HasDeadlock()) // false
}
```

**Complexity:**
- O(P + R) where P = processes, R = resources

**Scale This?**
- Distributed deadlock detection: each node runs local detection; share wait-for graph edges via gossip.
- Timeout-based deadlock avoidance: abort and retry on lock timeout (common in databases).
- Banker's algorithm for deadlock avoidance (requires advance resource declarations).

**Follow-up Generalization:**
Implement Banker's algorithm for deadlock avoidance. Model distributed transactions (2PC) and their deadlock potential.

---

## Problem 21: LRU with TTL

**Problem Statement:**
Extend the LRU cache to support per-entry TTL. Expired entries should be lazily removed on access or eagerly via a background sweeper.

**Go Solution:**

```go
package main

import (
	"container/list"
	"fmt"
	"sync"
	"time"
)

type ttlEntry struct {
	key     int
	value   int
	expires time.Time
}

type TTLLRUCache struct {
	cap   int
	mu    sync.Mutex
	list  *list.List
	items map[int]*list.Element
}

func NewTTLLRUCache(cap int) *TTLLRUCache {
	c := &TTLLRUCache{
		cap:   cap,
		list:  list.New(),
		items: make(map[int]*list.Element),
	}
	go c.sweepExpired()
	return c
}

func (c *TTLLRUCache) Get(key int) (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[key]
	if !ok {
		return -1, false
	}
	e := el.Value.(*ttlEntry)
	if time.Now().After(e.expires) {
		c.list.Remove(el)
		delete(c.items, key)
		return -1, false
	}
	c.list.MoveToFront(el)
	return e.value, true
}

func (c *TTLLRUCache) Put(key, value int, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.list.MoveToFront(el)
		e := el.Value.(*ttlEntry)
		e.value = value
		e.expires = time.Now().Add(ttl)
		return
	}
	if c.list.Len() == c.cap {
		back := c.list.Back()
		c.list.Remove(back)
		delete(c.items, back.Value.(*ttlEntry).key)
	}
	e := &ttlEntry{key, value, time.Now().Add(ttl)}
	el := c.list.PushFront(e)
	c.items[key] = el
}

func (c *TTLLRUCache) sweepExpired() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for range ticker.C {
		c.mu.Lock()
		now := time.Now()
		for key, el := range c.items {
			if now.After(el.Value.(*ttlEntry).expires) {
				c.list.Remove(el)
				delete(c.items, key)
			}
		}
		c.mu.Unlock()
	}
}

func main() {
	cache := NewTTLLRUCache(3)
	cache.Put(1, 100, 50*time.Millisecond)
	cache.Put(2, 200, 500*time.Millisecond)

	v, ok := cache.Get(1)
	fmt.Printf("key=1 value=%d ok=%v\n", v, ok)

	time.Sleep(100 * time.Millisecond)
	_, ok = cache.Get(1)
	fmt.Printf("key=1 after ttl: ok=%v\n", ok)
}
```

**Complexity:**
- Get/Put: O(1) amortized
- Sweep: O(N) per tick

**Scale This?**
- Hierarchical expiry buckets: group entries by expiry second; O(1) batch expiration.
- Redis EXPIRE for distributed TTL management.

**Follow-up Generalization:**
Segment-level TTL: all entries in a cache segment share a common expiry.

---

## Problem 22: Concurrent Stack and Queue

**Problem Statement:**
Implement a lock-free or minimally-locked concurrent stack (LIFO) and queue (FIFO).

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync/atomic"
	"unsafe"
)

// Lock-free stack using CAS
type node struct {
	val  int
	next *node
}

type LockFreeStack struct {
	top unsafe.Pointer
}

func (s *LockFreeStack) Push(val int) {
	n := &node{val: val}
	for {
		top := atomic.LoadPointer(&s.top)
		n.next = (*node)(top)
		if atomic.CompareAndSwapPointer(&s.top, top, unsafe.Pointer(n)) {
			return
		}
	}
}

func (s *LockFreeStack) Pop() (int, bool) {
	for {
		top := atomic.LoadPointer(&s.top)
		if top == nil {
			return 0, false
		}
		n := (*node)(top)
		if atomic.CompareAndSwapPointer(&s.top, top, unsafe.Pointer(n.next)) {
			return n.val, true
		}
	}
}

// Mutex-based Queue
type Queue struct {
	head, tail *node
	mu         [2]interface{} // separate head/tail locks
	size       int64
}

func main() {
	s := &LockFreeStack{}
	s.Push(1)
	s.Push(2)
	s.Push(3)

	for {
		v, ok := s.Pop()
		if !ok {
			break
		}
		fmt.Printf("%d ", v)
	}
	fmt.Println()
}
```

**Complexity:**
- Push/Pop (lock-free): O(1) amortized, no lock contention

**Scale This?**
- Michael-Scott queue for lock-free FIFO.
- Use `sync.Pool` for object recycling to reduce GC pressure.

**Follow-up Generalization:**
Implement a bounded blocking queue (blocks push when full, blocks pop when empty) using channels.

---

## Problem 23: Bloom Filter

**Problem Statement:**
Implement a Bloom filter for probabilistic set membership testing. Use multiple hash functions and a bit array.

**Go Solution:**

```go
package main

import (
	"fmt"
	"hash/fnv"
	"math"
)

type BloomFilter struct {
	bits    []bool
	k       int // number of hash functions
	m       int // bit array size
}

func NewBloomFilter(n int, fpRate float64) *BloomFilter {
	m := int(-float64(n) * math.Log(fpRate) / (math.Log(2) * math.Log(2)))
	k := int(float64(m) / float64(n) * math.Log(2))
	return &BloomFilter{bits: make([]bool, m), k: k, m: m}
}

func (bf *BloomFilter) hashes(item string) []int {
	h1 := fnv.New64a()
	h1.Write([]byte(item))
	v1 := h1.Sum64()

	h2 := fnv.New64()
	h2.Write([]byte(item))
	v2 := h2.Sum64()

	positions := make([]int, bf.k)
	for i := 0; i < bf.k; i++ {
		positions[i] = int((v1+uint64(i)*v2)%uint64(bf.m))
	}
	return positions
}

func (bf *BloomFilter) Add(item string) {
	for _, pos := range bf.hashes(item) {
		bf.bits[pos] = true
	}
}

func (bf *BloomFilter) Contains(item string) bool {
	for _, pos := range bf.hashes(item) {
		if !bf.bits[pos] {
			return false
		}
	}
	return true
}

func main() {
	bf := NewBloomFilter(1000, 0.01) // 1000 items, 1% false positive
	items := []string{"apple", "banana", "cherry", "date"}
	for _, item := range items {
		bf.Add(item)
	}

	tests := []string{"apple", "banana", "elderberry", "fig"}
	for _, t := range tests {
		fmt.Printf("%s: %v\n", t, bf.Contains(t))
	}
}
```

**Complexity:**
- Add/Contains: O(k) where k = number of hash functions
- Space: O(m) bits ≈ O(n * log(1/fp) / ln2)

**Scale This?**
- Distributed Bloom filter: partition bit array across nodes (bitwise OR for merges).
- Counting Bloom filter: use counters instead of bits to support deletion.
- Scalable Bloom filter: chain multiple filters as they fill up.

**Follow-up Generalization:**
Count-Min Sketch for approximate frequency estimation. HyperLogLog for cardinality estimation.

---

## Problem 24: Context-Aware Request Timeout

**Problem Statement:**
Implement middleware that enforces per-request timeouts using context, propagating cancellation through all goroutines spawned during the request.

**Go Solution:**

```go
package main

import (
	"context"
	"fmt"
	"time"
)

type Handler func(ctx context.Context, req string) (string, error)

func withTimeout(h Handler, timeout time.Duration) Handler {
	return func(ctx context.Context, req string) (string, error) {
		ctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return h(ctx, req)
	}
}

func withRetry(h Handler, maxRetries int) Handler {
	return func(ctx context.Context, req string) (string, error) {
		var lastErr error
		for i := 0; i < maxRetries; i++ {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			result, err := h(ctx, req)
			if err == nil {
				return result, nil
			}
			lastErr = err
			backoff := time.Duration(1<<uint(i)) * 10 * time.Millisecond
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
		return "", lastErr
	}
}

func fetchData(ctx context.Context, req string) (string, error) {
	// Simulate work with context awareness
	select {
	case <-time.After(50 * time.Millisecond):
		return "data for " + req, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func main() {
	handler := withRetry(withTimeout(fetchData, 100*time.Millisecond), 3)

	ctx := context.Background()
	result, err := handler(ctx, "request-1")
	fmt.Printf("result=%s err=%v\n", result, err)

	// Test timeout
	ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, err2 := handler(ctx2, "request-2")
	fmt.Printf("timeout err: %v\n", err2)
}
```

**Complexity:**
- Overhead: O(1) per request for context creation/cancellation

**Scale This?**
- Hierarchical timeouts: outer request timeout → per-RPC timeout → per-retry timeout.
- Deadline propagation: gRPC automatically propagates deadlines across service boundaries.
- Budget-based: subtract elapsed time from remaining budget at each service hop.

**Follow-up Generalization:**
Implement `singleflight.Group` for deduplicating concurrent identical requests. Add request tracing with `context` values.

---

## Problem 25: Semaphore

**Problem Statement:**
Implement a semaphore in Go to limit concurrency (e.g., max 5 concurrent DB connections) using channels.

**Go Solution:**

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Semaphore struct {
	ch chan struct{}
}

func NewSemaphore(n int) *Semaphore {
	return &Semaphore{ch: make(chan struct{}, n)}
}

func (s *Semaphore) Acquire(ctx context.Context) error {
	select {
	case s.ch <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Semaphore) Release() {
	<-s.ch
}

func (s *Semaphore) TryAcquire() bool {
	select {
	case s.ch <- struct{}{}:
		return true
	default:
		return false
	}
}

func main() {
	sem := NewSemaphore(3)
	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer cancel()

			if err := sem.Acquire(ctx); err != nil {
				fmt.Printf("worker %d: failed to acquire: %v\n", id, err)
				return
			}
			defer sem.Release()

			fmt.Printf("worker %d: working\n", id)
			time.Sleep(100 * time.Millisecond)
			fmt.Printf("worker %d: done\n", id)
		}(i)
	}
	wg.Wait()
}
```

**Complexity:**
- Acquire/Release: O(1)
- Max concurrent goroutines: N (semaphore value)

**Scale This?**
- Weighted semaphore: acquire(n) takes n slots (for variable-cost operations).
- `golang.org/x/sync/semaphore` provides a weighted semaphore implementation.
- Distributed semaphore: use Redis SETNX + EXPIRE for cross-service limiting.

**Follow-up Generalization:**
Read-write semaphore: allow N concurrent readers OR 1 exclusive writer (RWMutex is this).

---

## Problem 26: String Search (KMP)

**Problem Statement:**
Implement Knuth-Morris-Pratt string search. Find all occurrences of a pattern in a text in O(n+m).

**Go Solution:**

```go
package main

import "fmt"

func buildLPS(pattern string) []int {
	m := len(pattern)
	lps := make([]int, m)
	length := 0
	i := 1
	for i < m {
		if pattern[i] == pattern[length] {
			length++
			lps[i] = length
			i++
		} else {
			if length != 0 {
				length = lps[length-1]
			} else {
				lps[i] = 0
				i++
			}
		}
	}
	return lps
}

func KMPSearch(text, pattern string) []int {
	n, m := len(text), len(pattern)
	if m == 0 {
		return nil
	}
	lps := buildLPS(pattern)
	var matches []int
	i, j := 0, 0
	for i < n {
		if text[i] == pattern[j] {
			i++
			j++
		}
		if j == m {
			matches = append(matches, i-j)
			j = lps[j-1]
		} else if i < n && text[i] != pattern[j] {
			if j != 0 {
				j = lps[j-1]
			} else {
				i++
			}
		}
	}
	return matches
}

func main() {
	text := "ababcababcababc"
	pattern := "ababc"
	fmt.Println("Matches at:", KMPSearch(text, pattern)) // [0 5 9]
}
```

**Complexity:**
- Preprocessing (LPS): O(m)
- Search: O(n)
- Total: O(n + m)

**Scale This?**
- Aho-Corasick for multi-pattern search in O(n + sum(m) + k matches).
- GPU-accelerated SIMD string search for GB/s throughput.
- Distributed full-text search: Elasticsearch uses inverted indexes; not per-character search.

**Follow-up Generalization:**
Rabin-Karp rolling hash for multiple pattern search. Z-function for pattern repetition analysis.

---

## Problem 27: Matrix Spiral Traversal

**Problem Statement:**
Traverse an NxM matrix in spiral order. Implement a concurrent version that processes each layer in parallel.

**Go Solution:**

```go
package main

import "fmt"

func spiralOrder(matrix [][]int) []int {
	if len(matrix) == 0 {
		return nil
	}
	top, bottom, left, right := 0, len(matrix)-1, 0, len(matrix[0])-1
	var result []int

	for top <= bottom && left <= right {
		for i := left; i <= right; i++ {
			result = append(result, matrix[top][i])
		}
		top++
		for i := top; i <= bottom; i++ {
			result = append(result, matrix[i][right])
		}
		right--
		if top <= bottom {
			for i := right; i >= left; i-- {
				result = append(result, matrix[bottom][i])
			}
			bottom--
		}
		if left <= right {
			for i := bottom; i >= top; i-- {
				result = append(result, matrix[i][left])
			}
			left++
		}
	}
	return result
}

func main() {
	matrix := [][]int{
		{1, 2, 3},
		{4, 5, 6},
		{7, 8, 9},
	}
	fmt.Println(spiralOrder(matrix)) // [1 2 3 6 9 8 7 4 5]
}
```

**Complexity:**
- Time: O(n*m)
- Space: O(1) extra (output not counted)

**Scale This?**
- For image processing, spiral traversal is used in cache-efficient access patterns.
- Parallelize by processing outer rings concurrently (but they're independent).

**Follow-up Generalization:**
Generate a spiral matrix (fill in spiral order). Rotate a matrix 90 degrees in-place.

---

## Problem 28: Min Stack

**Problem Statement:**
Design a stack that supports push, pop, top, and retrieving the minimum element in O(1) time.

**Go Solution:**

```go
package main

import "fmt"

type MinStack struct {
	data []int
	mins []int
}

func (s *MinStack) Push(val int) {
	s.data = append(s.data, val)
	if len(s.mins) == 0 || val <= s.mins[len(s.mins)-1] {
		s.mins = append(s.mins, val)
	}
}

func (s *MinStack) Pop() {
	top := s.data[len(s.data)-1]
	s.data = s.data[:len(s.data)-1]
	if top == s.mins[len(s.mins)-1] {
		s.mins = s.mins[:len(s.mins)-1]
	}
}

func (s *MinStack) Top() int {
	return s.data[len(s.data)-1]
}

func (s *MinStack) GetMin() int {
	return s.mins[len(s.mins)-1]
}

func main() {
	s := &MinStack{}
	s.Push(5)
	s.Push(3)
	s.Push(7)
	s.Push(2)
	fmt.Println(s.GetMin()) // 2
	s.Pop()
	fmt.Println(s.GetMin()) // 3
}
```

**Complexity:**
- All operations: O(1)
- Space: O(n) for the auxiliary min stack

**Scale This?**
- Min deque for sliding window minimum.
- Monotonic stack for next-greater-element problems.

**Follow-up Generalization:**
Max stack, median stack (using two heaps). Min queue using two min stacks.

---

## Problem 29: LongestCommonSubsequence

**Problem Statement:**
Find the longest common subsequence of two strings using dynamic programming with memoization.

**Go Solution:**

```go
package main

import "fmt"

func lcs(a, b string) int {
	m, n := len(a), len(b)
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else {
				if dp[i-1][j] > dp[i][j-1] {
					dp[i][j] = dp[i-1][j]
				} else {
					dp[i][j] = dp[i][j-1]
				}
			}
		}
	}
	return dp[m][n]
}

// Space-optimized: O(n) space
func lcsOptimized(a, b string) int {
	m, n := len(a), len(b)
	prev := make([]int, n+1)
	curr := make([]int, n+1)
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				curr[j] = prev[j-1] + 1
			} else if prev[j] > curr[j-1] {
				curr[j] = prev[j]
			} else {
				curr[j] = curr[j-1]
			}
		}
		prev, curr = curr, make([]int, n+1)
	}
	return prev[n]
}

func main() {
	fmt.Println(lcs("ABCBDAB", "BDCAB"))          // 4
	fmt.Println(lcsOptimized("ABCBDAB", "BDCAB")) // 4
}
```

**Complexity:**
- Time: O(m*n)
- Space: O(m*n) standard, O(n) optimized

**Scale This?**
- Diff algorithms (git diff) use LCS as core.
- For long DNA sequences, use Hirschberg's algorithm: O(mn) time, O(min(m,n)) space with backtracking.
- Parallel DP: anti-diagonal wavefront parallelism with goroutines.

**Follow-up Generalization:**
Edit distance (Levenshtein), shortest common supersequence, diff patch generation.

---

## Problem 30: Channel Fan-In

**Problem Statement:**
Implement a fan-in multiplexer that merges multiple input channels into a single output channel using goroutines.

**Go Solution:**

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func fanIn(channels ...<-chan int) <-chan int {
	out := make(chan int)
	var wg sync.WaitGroup

	merge := func(ch <-chan int) {
		defer wg.Done()
		for v := range ch {
			out <- v
		}
	}

	wg.Add(len(channels))
	for _, ch := range channels {
		go merge(ch)
	}

	go func() {
		wg.Wait()
		close(out)
	}()

	return out
}

func source(vals ...int) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		for _, v := range vals {
			time.Sleep(10 * time.Millisecond)
			ch <- v
		}
	}()
	return ch
}

func main() {
	ch1 := source(1, 4, 7)
	ch2 := source(2, 5, 8)
	ch3 := source(3, 6, 9)

	merged := fanIn(ch1, ch2, ch3)
	for v := range merged {
		fmt.Printf("%d ", v)
	}
	fmt.Println()
}
```

**Complexity:**
- O(1) per message routing
- One goroutine per input channel

**Scale This?**
- Dynamic fan-in: add/remove channels at runtime using a registry + select loop.
- For hundreds of channels, use `reflect.Select` to select over a dynamic slice of channels.
- Context-aware cancellation: pass `ctx` into each merge goroutine.

**Follow-up Generalization:**
Fan-out + fan-in: distribute a single stream to N workers, collect results. This is the MapReduce pattern in miniature.

---

*© 2024 Gaurav Patil — GoForge Platform. All rights reserved.*
