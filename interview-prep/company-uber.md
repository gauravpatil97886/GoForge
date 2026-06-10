> © 2024 Gaurav Patil — GoForge Platform. All rights reserved.

# Uber-Style Go Interview Questions

25 problems focused on real-time systems, geospatial, rate limiting, reliability.
For each: problem → Go implementation → production notes.

---

## Problem 1: Ride-Matching System

**Problem Statement:**
Match a rider's request to the nearest available driver. Maintain a pool of available drivers; on a ride request, find the closest driver and assign them atomically.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"math"
	"sync"
)

type Location struct {
	Lat, Lng float64
}

type Driver struct {
	ID       string
	Location Location
	mu       sync.Mutex
	busy     bool
}

type RideMatchingSystem struct {
	mu      sync.RWMutex
	drivers map[string]*Driver
}

func NewRideMatchingSystem() *RideMatchingSystem {
	return &RideMatchingSystem{drivers: make(map[string]*Driver)}
}

func haversine(a, b Location) float64 {
	const R = 6371.0 // Earth radius in km
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180
	lat1 := a.Lat * math.Pi / 180
	lat2 := b.Lat * math.Pi / 180
	x := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Atan2(math.Sqrt(x), math.Sqrt(1-x))
}

func (s *RideMatchingSystem) AddDriver(d *Driver) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.drivers[d.ID] = d
}

func (s *RideMatchingSystem) Match(riderLoc Location) *Driver {
	s.mu.RLock()
	drivers := make([]*Driver, 0, len(s.drivers))
	for _, d := range s.drivers {
		drivers = append(drivers, d)
	}
	s.mu.RUnlock()

	var bestDriver *Driver
	bestDist := math.MaxFloat64

	for _, d := range drivers {
		d.mu.Lock()
		if d.busy {
			d.mu.Unlock()
			continue
		}
		dist := haversine(riderLoc, d.Location)
		if dist < bestDist {
			// Release previous best, lock current
			if bestDriver != nil {
				bestDriver.mu.Unlock()
			}
			bestDist = dist
			bestDriver = d
			// Keep lock on bestDriver
		} else {
			d.mu.Unlock()
		}
	}

	if bestDriver != nil {
		bestDriver.busy = true
		bestDriver.mu.Unlock()
	}
	return bestDriver
}

func main() {
	sys := NewRideMatchingSystem()
	sys.AddDriver(&Driver{ID: "D1", Location: Location{37.7749, -122.4194}})
	sys.AddDriver(&Driver{ID: "D2", Location: Location{37.7751, -122.4185}})
	sys.AddDriver(&Driver{ID: "D3", Location: Location{37.7740, -122.4200}})

	rider := Location{37.7750, -122.4190}
	driver := sys.Match(rider)
	if driver != nil {
		fmt.Printf("Matched rider to driver: %s\n", driver.ID)
	}
}
```

**Production Notes:**
- Use a spatial index (quadtree, geohash grid) to avoid O(N) linear scan. Uber uses S2 geometry cells.
- Driver locations are updated ~4/sec via websocket; use a write-heavy spatial store (Redis GEO commands: GEOADD, GEORADIUS).
- Atomic assignment via Redis SETNX to prevent double-booking across multiple dispatch servers.
- At scale: partition geographic regions; each region has a dedicated dispatch service. Cross-region fallback handled by a coordinator.
- Real Uber: uses a combination of H3 hexagonal grid indexing and a custom dispatch service written in Go.

---

## Problem 2: Geo-Fence Checker

**Problem Statement:**
Given a set of polygonal geo-fences (e.g., city boundaries, surge zones), determine which fences a given coordinate falls inside. Support concurrent fence registration and queries.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"sync"
)

type Point struct{ X, Y float64 }

type GeoFence struct {
	ID      string
	Polygon []Point
}

// Ray casting algorithm: odd crossings = inside
func (f *GeoFence) Contains(p Point) bool {
	inside := false
	n := len(f.Polygon)
	j := n - 1
	for i := 0; i < n; i++ {
		vi, vj := f.Polygon[i], f.Polygon[j]
		if ((vi.Y > p.Y) != (vj.Y > p.Y)) &&
			(p.X < (vj.X-vi.X)*(p.Y-vi.Y)/(vj.Y-vi.Y)+vi.X) {
			inside = !inside
		}
		j = i
	}
	return inside
}

type GeoFenceRegistry struct {
	mu     sync.RWMutex
	fences map[string]*GeoFence
}

func NewGeoFenceRegistry() *GeoFenceRegistry {
	return &GeoFenceRegistry{fences: make(map[string]*GeoFence)}
}

func (r *GeoFenceRegistry) Register(f *GeoFence) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fences[f.ID] = f
}

func (r *GeoFenceRegistry) Query(p Point) []string {
	r.mu.RLock()
	fences := make([]*GeoFence, 0, len(r.fences))
	for _, f := range r.fences {
		fences = append(fences, f)
	}
	r.mu.RUnlock()

	var wg sync.WaitGroup
	var mu sync.Mutex
	var matches []string

	for _, f := range fences {
		f := f
		wg.Add(1)
		go func() {
			defer wg.Done()
			if f.Contains(p) {
				mu.Lock()
				matches = append(matches, f.ID)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return matches
}

func main() {
	r := NewGeoFenceRegistry()
	r.Register(&GeoFence{
		ID: "downtown",
		Polygon: []Point{{0, 0}, {10, 0}, {10, 10}, {0, 10}},
	})
	r.Register(&GeoFence{
		ID: "surge-zone",
		Polygon: []Point{{5, 5}, {15, 5}, {15, 15}, {5, 15}},
	})

	p := Point{7, 7}
	fmt.Println("Fences containing (7,7):", r.Query(p))
}
```

**Production Notes:**
- Pre-index fences with a bounding-box check before expensive ray-casting to skip obviously non-matching fences.
- Use R-tree or geohash grid for spatial indexing: O(log N) queries instead of O(N).
- Uber's geo-fence checker processes ~1M events/sec; written in Go with pre-compiled fence geometry.
- For real-time surge zone updates, use a pub-sub system to broadcast fence changes to all query nodes.
- Handle anti-meridian crossings (fences spanning ±180 longitude) with coordinate normalization.

---

## Problem 3: Surge Pricing Calculator

**Problem Statement:**
Calculate dynamic surge multipliers based on supply (available drivers) and demand (pending requests) in a geographic cell. Update prices in real-time.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

type Cell struct {
	ID      string
	drivers int64 // atomic
	riders  int64 // atomic
}

type SurgePricingEngine struct {
	mu    sync.RWMutex
	cells map[string]*Cell
}

func NewSurgePricingEngine() *SurgePricingEngine {
	return &SurgePricingEngine{cells: make(map[string]*Cell)}
}

func (e *SurgePricingEngine) getOrCreate(cellID string) *Cell {
	e.mu.RLock()
	c, ok := e.cells[cellID]
	e.mu.RUnlock()
	if ok {
		return c
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if c, ok = e.cells[cellID]; ok {
		return c
	}
	c = &Cell{ID: cellID}
	e.cells[cellID] = c
	return c
}

func (e *SurgePricingEngine) UpdateDriverCount(cellID string, delta int64) {
	c := e.getOrCreate(cellID)
	atomic.AddInt64(&c.drivers, delta)
}

func (e *SurgePricingEngine) UpdateRiderCount(cellID string, delta int64) {
	c := e.getOrCreate(cellID)
	atomic.AddInt64(&c.riders, delta)
}

// Surge multiplier: 1.0x base, scales with demand/supply ratio
func (e *SurgePricingEngine) GetMultiplier(cellID string) float64 {
	c := e.getOrCreate(cellID)
	drivers := float64(atomic.LoadInt64(&c.drivers))
	riders := float64(atomic.LoadInt64(&c.riders))

	if drivers <= 0 {
		return 5.0 // max surge when no drivers
	}
	ratio := riders / drivers
	if ratio <= 1.0 {
		return 1.0 // no surge
	}
	// Logarithmic surge: smoother than linear
	multiplier := 1.0 + math.Log(ratio)*0.5
	return math.Round(multiplier*4) / 4 // round to nearest 0.25x
}

func (e *SurgePricingEngine) StartDecay(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			e.mu.RLock()
			for _, c := range e.cells {
				// Decay unmatched demand over time
				riders := atomic.LoadInt64(&c.riders)
				if riders > 0 {
					atomic.AddInt64(&c.riders, -riders/10) // 10% decay per tick
				}
			}
			e.mu.RUnlock()
		}
	}()
}

func main() {
	engine := NewSurgePricingEngine()
	engine.StartDecay(time.Second)

	engine.UpdateDriverCount("cell-A", 3)
	engine.UpdateRiderCount("cell-A", 9)

	fmt.Printf("Surge multiplier for cell-A: %.2fx\n", engine.GetMultiplier("cell-A"))

	engine.UpdateDriverCount("cell-B", 10)
	engine.UpdateRiderCount("cell-B", 5)
	fmt.Printf("Surge multiplier for cell-B: %.2fx\n", engine.GetMultiplier("cell-B"))
}
```

**Production Notes:**
- Surge is computed per H3 hexagonal cell (resolution 7 ≈ 5km² cells). Uber uses H3 open-source library.
- Smooth surge changes to avoid sudden jumps: apply exponential moving average on the multiplier.
- Machine learning model (not just ratio): factors in time-of-day, events, weather, historical patterns.
- Multiplier is cached per cell with a 5-second TTL; recomputed asynchronously in the background.
- A/B test different surge algorithms per market; feature flags control which pricing model is active.

---

## Problem 4: Driver Location Tracker

**Problem Statement:**
Track real-time GPS locations of millions of drivers. Support efficient nearest-driver queries, location history retrieval, and atomic location updates.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type GPSUpdate struct {
	DriverID  string
	Lat, Lng  float64
	Timestamp time.Time
	Speed     float64 // km/h
	Bearing   float64 // degrees
}

type LocationHistory struct {
	updates []GPSUpdate
	mu      sync.RWMutex
	maxSize int
}

func NewLocationHistory(maxSize int) *LocationHistory {
	return &LocationHistory{
		updates: make([]GPSUpdate, 0, maxSize),
		maxSize: maxSize,
	}
}

func (h *LocationHistory) Add(u GPSUpdate) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.updates) >= h.maxSize {
		// Circular buffer: overwrite oldest
		h.updates = append(h.updates[1:], u)
	} else {
		h.updates = append(h.updates, u)
	}
}

func (h *LocationHistory) Recent(n int) []GPSUpdate {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if n > len(h.updates) {
		n = len(h.updates)
	}
	result := make([]GPSUpdate, n)
	copy(result, h.updates[len(h.updates)-n:])
	return result
}

type LocationTracker struct {
	mu       sync.RWMutex
	current  map[string]*GPSUpdate
	history  map[string]*LocationHistory
	histSize int
}

func NewLocationTracker(histSize int) *LocationTracker {
	return &LocationTracker{
		current:  make(map[string]*GPSUpdate),
		history:  make(map[string]*LocationHistory),
		histSize: histSize,
	}
}

func (t *LocationTracker) Update(u GPSUpdate) {
	t.mu.Lock()
	update := u
	t.current[u.DriverID] = &update
	if t.history[u.DriverID] == nil {
		t.history[u.DriverID] = NewLocationHistory(t.histSize)
	}
	hist := t.history[u.DriverID]
	t.mu.Unlock()
	hist.Add(u)
}

func (t *LocationTracker) GetCurrent(driverID string) (*GPSUpdate, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	u, ok := t.current[driverID]
	return u, ok
}

func (t *LocationTracker) GetHistory(driverID string, n int) []GPSUpdate {
	t.mu.RLock()
	hist := t.history[driverID]
	t.mu.RUnlock()
	if hist == nil {
		return nil
	}
	return hist.Recent(n)
}

func main() {
	tracker := NewLocationTracker(100)

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			tracker.Update(GPSUpdate{
				DriverID:  fmt.Sprintf("driver-%d", id),
				Lat:       37.77 + float64(id)*0.001,
				Lng:       -122.42 + float64(id)*0.001,
				Timestamp: time.Now(),
				Speed:     30.0,
			})
		}(i)
	}
	wg.Wait()

	u, ok := tracker.GetCurrent("driver-0")
	if ok {
		fmt.Printf("Driver-0 at: (%.4f, %.4f)\n", u.Lat, u.Lng)
	}
}
```

**Production Notes:**
- Uber processes ~1M GPS updates/sec. Each driver app sends updates every 4 seconds.
- Location data flows through Kafka; a Go service consumes events and writes to Redis GEO sorted sets.
- For trip replay and fraud detection, store compressed location history in S3 (encoded with polyline or protocol buffers).
- Dead reckoning: estimate position between updates using last known speed and bearing to fill gaps.
- Privacy: location history auto-deleted after 30 days per GDPR/CCPA requirements.

---

## Problem 5: Trip Dispatch Queue with Priority

**Problem Statement:**
Implement a priority queue for trip dispatch where VIP riders, long-distance trips, and surge zone requests get prioritized over standard requests.

**Go Implementation:**

```go
package main

import (
	"container/heap"
	"fmt"
	"sync"
	"time"
)

type Priority int

const (
	PriorityLow    Priority = 0
	PriorityNormal Priority = 1
	PriorityHigh   Priority = 2
	PriorityVIP    Priority = 3
)

type TripRequest struct {
	ID        string
	RiderID   string
	Priority  Priority
	CreatedAt time.Time
	Location  struct{ Lat, Lng float64 }
	index     int
}

type TripHeap []*TripRequest

func (h TripHeap) Len() int { return len(h) }
func (h TripHeap) Less(i, j int) bool {
	if h[i].Priority != h[j].Priority {
		return h[i].Priority > h[j].Priority // higher priority first
	}
	return h[i].CreatedAt.Before(h[j].CreatedAt) // FIFO within same priority
}
func (h TripHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
	h[i].index = i
	h[j].index = j
}
func (h *TripHeap) Push(x interface{}) {
	req := x.(*TripRequest)
	req.index = len(*h)
	*h = append(*h, req)
}
func (h *TripHeap) Pop() interface{} {
	old := *h
	req := old[len(old)-1]
	req.index = -1
	*h = old[:len(old)-1]
	return req
}

type DispatchQueue struct {
	mu   sync.Mutex
	heap *TripHeap
	cond *sync.Cond
}

func NewDispatchQueue() *DispatchQueue {
	h := &TripHeap{}
	heap.Init(h)
	dq := &DispatchQueue{heap: h}
	dq.cond = sync.NewCond(&dq.mu)
	return dq
}

func (dq *DispatchQueue) Enqueue(req *TripRequest) {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	heap.Push(dq.heap, req)
	dq.cond.Signal()
}

func (dq *DispatchQueue) Dequeue() *TripRequest {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	for dq.heap.Len() == 0 {
		dq.cond.Wait()
	}
	return heap.Pop(dq.heap).(*TripRequest)
}

func (dq *DispatchQueue) Len() int {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	return dq.heap.Len()
}

func main() {
	dq := NewDispatchQueue()

	requests := []*TripRequest{
		{ID: "R1", Priority: PriorityNormal, CreatedAt: time.Now()},
		{ID: "R2", Priority: PriorityVIP, CreatedAt: time.Now().Add(time.Millisecond)},
		{ID: "R3", Priority: PriorityHigh, CreatedAt: time.Now().Add(2 * time.Millisecond)},
		{ID: "R4", Priority: PriorityLow, CreatedAt: time.Now().Add(3 * time.Millisecond)},
	}
	for _, r := range requests {
		dq.Enqueue(r)
	}

	for dq.Len() > 0 {
		req := dq.Dequeue()
		fmt.Printf("Dispatching: %s (priority: %d)\n", req.ID, req.Priority)
	}
}
```

**Production Notes:**
- Dispatch queues are per-region; Uber has hundreds of regional dispatch services globally.
- Starvation prevention: low-priority requests get their priority bumped after waiting >60 seconds.
- Queue length is monitored; if it exceeds a threshold, trigger surge pricing to reduce demand or bring in more drivers.
- Persist dispatch queue in Redis sorted sets (score = priority * MAX_TIME - created_at); survives pod restarts.
- Dequeue is done by driver-acceptance workers, not pushed; drivers poll or receive a push notification.

---

## Problem 6: Rate Limiter per Driver/Rider (Sliding Window)

**Problem Statement:**
Implement a sliding window rate limiter that enforces per-user request limits. A user can make at most N requests in any rolling window of T seconds.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type SlidingWindowLimiter struct {
	mu       sync.Mutex
	windows  map[string][]time.Time
	maxReqs  int
	window   time.Duration
}

func NewSlidingWindowLimiter(maxReqs int, window time.Duration) *SlidingWindowLimiter {
	return &SlidingWindowLimiter{
		windows: make(map[string][]time.Time),
		maxReqs: maxReqs,
		window:  window,
	}
}

func (l *SlidingWindowLimiter) Allow(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.window)

	// Evict timestamps outside the window
	times := l.windows[userID]
	valid := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= l.maxReqs {
		l.windows[userID] = valid
		return false
	}

	l.windows[userID] = append(valid, now)
	return true
}

func (l *SlidingWindowLimiter) RemainingQuota(userID string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := time.Now().Add(-l.window)
	count := 0
	for _, t := range l.windows[userID] {
		if t.After(cutoff) {
			count++
		}
	}
	return l.maxReqs - count
}

// Compact: clean up empty entries periodically
func (l *SlidingWindowLimiter) Compact() {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := time.Now().Add(-l.window)
	for id, times := range l.windows {
		valid := times[:0]
		for _, t := range times {
			if t.After(cutoff) {
				valid = append(valid, t)
			}
		}
		if len(valid) == 0 {
			delete(l.windows, id)
		} else {
			l.windows[id] = valid
		}
	}
}

func main() {
	limiter := NewSlidingWindowLimiter(3, time.Second)

	userID := "rider-42"
	for i := 0; i < 5; i++ {
		allowed := limiter.Allow(userID)
		fmt.Printf("Request %d: allowed=%v remaining=%d\n",
			i+1, allowed, limiter.RemainingQuota(userID))
	}

	time.Sleep(1100 * time.Millisecond)
	fmt.Println("After 1.1s:")
	fmt.Printf("Request 6: allowed=%v\n", limiter.Allow(userID))
}
```

**Production Notes:**
- In-process sliding window is for single-node limiting. For distributed rate limiting across pods, use Redis ZSET:
  - ZADD key timestamp timestamp → add current request
  - ZREMRANGEBYSCORE key 0 (now-window) → evict old entries
  - ZCARD key → count remaining, all in a Lua script for atomicity.
- Separate limits for riders vs. drivers; API endpoints have different limits (ride-request: 1/min, location-update: 1/4sec).
- Rate limit headers (X-RateLimit-Remaining, X-RateLimit-Reset) are returned to clients.
- Graduated responses: first breach → 429 Too Many Requests; repeated abuse → account flag for review.

---

## Problem 7: Circuit Breaker for Payment Calls

**Problem Statement:**
Implement a circuit breaker that wraps payment service calls. It opens when error rate exceeds a threshold and half-opens to probe recovery.

**Go Implementation:**

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type State int

const (
	StateClosed   State = iota // normal operation
	StateOpen                  // blocking calls
	StateHalfOpen              // probing recovery
)

var ErrCircuitOpen = errors.New("circuit breaker is open")

type CircuitBreaker struct {
	mu              sync.Mutex
	state           State
	failureCount    int64
	successCount    int64
	lastFailure     time.Time
	threshold       int64
	successRequired int64
	timeout         time.Duration
}

func NewCircuitBreaker(threshold, successRequired int64, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		threshold:       threshold,
		successRequired: successRequired,
		timeout:         timeout,
	}
}

func (cb *CircuitBreaker) Call(fn func() error) error {
	cb.mu.Lock()
	state := cb.state

	switch state {
	case StateOpen:
		if time.Since(cb.lastFailure) > cb.timeout {
			cb.state = StateHalfOpen
			atomic.StoreInt64(&cb.successCount, 0)
			cb.mu.Unlock()
		} else {
			cb.mu.Unlock()
			return ErrCircuitOpen
		}
	default:
		cb.mu.Unlock()
	}

	err := fn()

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		atomic.AddInt64(&cb.failureCount, 1)
		cb.lastFailure = time.Now()
		if atomic.LoadInt64(&cb.failureCount) >= cb.threshold || cb.state == StateHalfOpen {
			cb.state = StateOpen
			fmt.Println("Circuit opened")
		}
		return err
	}

	// Success
	if cb.state == StateHalfOpen {
		sc := atomic.AddInt64(&cb.successCount, 1)
		if sc >= cb.successRequired {
			cb.state = StateClosed
			atomic.StoreInt64(&cb.failureCount, 0)
			fmt.Println("Circuit closed (recovered)")
		}
	} else {
		atomic.StoreInt64(&cb.failureCount, 0)
	}
	return nil
}

func (cb *CircuitBreaker) State() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

func main() {
	cb := NewCircuitBreaker(3, 2, 500*time.Millisecond)

	callCount := 0
	paymentCall := func() error {
		callCount++
		if callCount <= 4 {
			return errors.New("payment service unavailable")
		}
		return nil
	}

	for i := 0; i < 8; i++ {
		err := cb.Call(paymentCall)
		states := []string{"CLOSED", "OPEN", "HALF-OPEN"}
		fmt.Printf("Call %d: err=%v state=%s\n", i+1, err, states[cb.State()])
		if errors.Is(err, ErrCircuitOpen) {
			time.Sleep(600 * time.Millisecond) // wait for half-open
		}
	}
}
```

**Production Notes:**
- Uber uses circuit breakers extensively via their in-house `yarpc` framework (now open-source).
- Metrics to track: error rate (not just count), latency percentiles (p99 spike often precedes errors).
- Sliding window circuit breaker: count errors in last N seconds, not cumulative.
- Half-open with limited concurrency: only let 1 request through in half-open state; use a semaphore.
- Fallback behavior when open: return cached result, serve degraded response, or queue for retry.
- Alert on state transitions; a circuit opening is a production incident signal.

---

## Problem 8: Real-Time ETA Calculator

**Problem Statement:**
Estimate time of arrival (ETA) for a trip given current driver location, rider location, traffic data, and historical speed profiles.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

type Segment struct {
	Distance float64 // km
	BaseSpeed float64 // km/h
}

type TrafficLayer struct {
	mu         sync.RWMutex
	multipliers map[string]float64 // segment ID → speed multiplier (0.2=very slow, 1.0=free flow)
}

func NewTrafficLayer() *TrafficLayer {
	return &TrafficLayer{multipliers: make(map[string]float64)}
}

func (t *TrafficLayer) Update(segmentID string, multiplier float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.multipliers[segmentID] = multiplier
}

func (t *TrafficLayer) GetMultiplier(segmentID string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if m, ok := t.multipliers[segmentID]; ok {
		return m
	}
	return 1.0 // free flow default
}

type ETACalculator struct {
	traffic       *TrafficLayer
	historicalAvg map[string]map[int]float64 // segID → hour → avg speed
	mu            sync.RWMutex
}

func NewETACalculator(traffic *TrafficLayer) *ETACalculator {
	return &ETACalculator{
		traffic:       traffic,
		historicalAvg: make(map[string]map[int]float64),
	}
}

func (e *ETACalculator) AddHistoricalData(segID string, hour int, avgSpeed float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.historicalAvg[segID] == nil {
		e.historicalAvg[segID] = make(map[int]float64)
	}
	e.historicalAvg[segID][hour] = avgSpeed
}

func (e *ETACalculator) effectiveSpeed(segID string, baseSpeed float64) float64 {
	hour := time.Now().Hour()
	e.mu.RLock()
	if hourData, ok := e.historicalAvg[segID]; ok {
		if hist, ok := hourData[hour]; ok {
			baseSpeed = hist
		}
	}
	e.mu.RUnlock()
	trafficMult := e.traffic.GetMultiplier(segID)
	return baseSpeed * trafficMult
}

func (e *ETACalculator) CalculateETA(segments []Segment, segIDs []string) time.Duration {
	totalSeconds := 0.0
	for i, seg := range segments {
		speed := e.effectiveSpeed(segIDs[i], seg.BaseSpeed)
		if speed <= 0 {
			speed = 5.0 // minimum 5 km/h
		}
		totalSeconds += (seg.Distance / speed) * 3600
	}
	return time.Duration(math.Round(totalSeconds)) * time.Second
}

// Haversine distance in km
func distance(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func main() {
	traffic := NewTrafficLayer()
	traffic.Update("seg-1", 0.5) // 50% speed due to traffic
	traffic.Update("seg-2", 0.8)

	eta := NewETACalculator(traffic)
	eta.AddHistoricalData("seg-1", time.Now().Hour(), 40.0) // historical avg: 40 km/h

	segments := []Segment{
		{Distance: 2.5, BaseSpeed: 50.0},
		{Distance: 1.8, BaseSpeed: 60.0},
	}
	segIDs := []string{"seg-1", "seg-2"}

	arrival := eta.CalculateETA(segments, segIDs)
	fmt.Printf("ETA: %v (%.0f seconds)\n", arrival, arrival.Seconds())
}
```

**Production Notes:**
- Uber's ETA model uses a combination of real-time traffic (HERE, Google Maps, proprietary probes), historical speed profiles (per road segment per hour per day-of-week), and ML-based correction.
- ETA is recomputed every 30 seconds during a trip; push updated ETA to both rider and driver apps.
- Uncertainty: return ETA with a confidence interval (e.g., "8-12 min") based on traffic variance.
- A/B test ETA accuracy; optimize for mean absolute error (MAE) vs. actual arrival time.
- For global coverage, use road network graph with 100M+ edges; shortest-path with Dijkstra/A*.

---

## Problem 9: Exponential Backoff GPS Retry

**Problem Statement:**
Implement a retry mechanism for GPS API calls with exponential backoff, jitter, and context-based cancellation.

**Go Implementation:**

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"time"
)

type RetryConfig struct {
	MaxAttempts    int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	Multiplier     float64
	JitterFactor   float64
}

func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:    5,
		InitialBackoff: 100 * time.Millisecond,
		MaxBackoff:     30 * time.Second,
		Multiplier:     2.0,
		JitterFactor:   0.3,
	}
}

var ErrNonRetryable = errors.New("non-retryable error")

func WithRetry(ctx context.Context, cfg RetryConfig, fn func(ctx context.Context) error) error {
	var lastErr error
	backoff := cfg.InitialBackoff

	for attempt := 0; attempt < cfg.MaxAttempts; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		lastErr = fn(ctx)
		if lastErr == nil {
			return nil
		}

		// Don't retry non-retryable errors
		if errors.Is(lastErr, ErrNonRetryable) {
			return lastErr
		}

		if attempt == cfg.MaxAttempts-1 {
			break
		}

		// Exponential backoff with full jitter
		jitter := time.Duration(float64(backoff) * cfg.JitterFactor * (rand.Float64()*2 - 1))
		sleep := backoff + jitter
		if sleep < 0 {
			sleep = 0
		}
		if sleep > cfg.MaxBackoff {
			sleep = cfg.MaxBackoff
		}

		fmt.Printf("Attempt %d failed: %v. Retrying in %v\n", attempt+1, lastErr, sleep)

		select {
		case <-time.After(sleep):
		case <-ctx.Done():
			return ctx.Err()
		}

		// Compute next backoff
		nextBackoff := time.Duration(float64(backoff) * cfg.Multiplier)
		if nextBackoff > cfg.MaxBackoff {
			nextBackoff = cfg.MaxBackoff
		}
		backoff = nextBackoff
		_ = math.Log(1) // import usage
	}
	return fmt.Errorf("all %d attempts failed: %w", cfg.MaxAttempts, lastErr)
}

func main() {
	attemptCount := 0
	gpsCall := func(ctx context.Context) error {
		attemptCount++
		if attemptCount < 3 {
			return errors.New("GPS service timeout")
		}
		fmt.Println("GPS call succeeded!")
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cfg := RetryConfig{
		MaxAttempts:    5,
		InitialBackoff: 50 * time.Millisecond,
		MaxBackoff:     2 * time.Second,
		Multiplier:     2.0,
		JitterFactor:   0.2,
	}

	err := WithRetry(ctx, cfg, gpsCall)
	fmt.Printf("Final result: err=%v attempts=%d\n", err, attemptCount)
}
```

**Production Notes:**
- Full jitter is preferred over equal jitter for distributed systems (avoids thundering herd at retry boundaries).
- Uber's driver app retries GPS uploads: if connectivity is lost, buffer updates locally and retry with backoff.
- Use `golang.org/x/net/context` deadlines to propagate overall request deadlines through retries.
- Circuit breaker + retry: retry handles transient errors; circuit breaker handles systemic failures.
- Different retry policies per operation: idempotent operations (GET, PUT) can retry freely; non-idempotent (POST payment) need deduplication tokens.

---

## Problem 10: Concurrent Notification Dispatcher

**Problem Statement:**
Dispatch notifications (push, SMS, email) to millions of riders and drivers concurrently. Support multiple channels, per-user preferences, and graceful degradation.

**Go Implementation:**

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Channel string

const (
	ChannelPush  Channel = "push"
	ChannelSMS   Channel = "sms"
	ChannelEmail Channel = "email"
)

type Notification struct {
	UserID   string
	Message  string
	Channels []Channel
	Priority int
}

type Sender interface {
	Send(ctx context.Context, userID, message string) error
	Channel() Channel
}

type MockSender struct {
	channel Channel
	delay   time.Duration
}

func (s *MockSender) Channel() Channel { return s.channel }
func (s *MockSender) Send(ctx context.Context, userID, message string) error {
	select {
	case <-time.After(s.delay):
		fmt.Printf("[%s] Sent to %s: %s\n", s.channel, userID, message)
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type Dispatcher struct {
	senders map[Channel]Sender
	workers int
	queue   chan Notification
	wg      sync.WaitGroup
}

func NewDispatcher(workers int, senders ...Sender) *Dispatcher {
	d := &Dispatcher{
		senders: make(map[Channel]Sender),
		workers: workers,
		queue:   make(chan Notification, 1000),
	}
	for _, s := range senders {
		d.senders[s.Channel()] = s
	}
	return d
}

func (d *Dispatcher) Start(ctx context.Context) {
	for i := 0; i < d.workers; i++ {
		d.wg.Add(1)
		go func() {
			defer d.wg.Done()
			for {
				select {
				case notif, ok := <-d.queue:
					if !ok {
						return
					}
					d.dispatch(ctx, notif)
				case <-ctx.Done():
					return
				}
			}
		}()
	}
}

func (d *Dispatcher) dispatch(ctx context.Context, notif Notification) {
	var wg sync.WaitGroup
	for _, ch := range notif.Channels {
		sender, ok := d.senders[ch]
		if !ok {
			continue
		}
		ch := ch
		sender := sender
		wg.Add(1)
		go func() {
			defer wg.Done()
			chCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			if err := sender.Send(chCtx, notif.UserID, notif.Message); err != nil {
				fmt.Printf("[%s] Failed for %s: %v\n", ch, notif.UserID, err)
			}
		}()
	}
	wg.Wait()
}

func (d *Dispatcher) Enqueue(n Notification) {
	d.queue <- n
}

func (d *Dispatcher) Stop() {
	close(d.queue)
	d.wg.Wait()
}

func main() {
	dispatcher := NewDispatcher(4,
		&MockSender{channel: ChannelPush, delay: 10 * time.Millisecond},
		&MockSender{channel: ChannelSMS, delay: 50 * time.Millisecond},
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dispatcher.Start(ctx)

	for i := 0; i < 5; i++ {
		dispatcher.Enqueue(Notification{
			UserID:   fmt.Sprintf("user-%d", i),
			Message:  "Your driver is arriving!",
			Channels: []Channel{ChannelPush, ChannelSMS},
		})
	}

	time.Sleep(200 * time.Millisecond)
	dispatcher.Stop()
}
```

**Production Notes:**
- Uber sends 10M+ notifications/day. Core platform: Go service reading from Kafka, writing to APN/GCM/Twilio.
- Fan-out per user: try push first; if undelivered after 30s, escalate to SMS.
- Deduplication: use a Redis SET with notification hash + 24h TTL to prevent duplicate sends.
- Per-user preference store: riders opt-in/out per channel; fetched from a low-latency config service.
- Rate limiting per user: max 5 push notifications per hour to avoid spamming.

---

## Problem 11: Trip State Machine

**Problem Statement:**
Implement a trip lifecycle state machine. Trips transition between states (requested → accepted → en_route → arrived → in_progress → completed/cancelled). Ensure transitions are atomic and auditable.

**Go Implementation:**

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

type TripState string

const (
	StateRequested  TripState = "requested"
	StateAccepted   TripState = "accepted"
	StateEnRoute    TripState = "en_route"
	StateArrived    TripState = "arrived"
	StateInProgress TripState = "in_progress"
	StateCompleted  TripState = "completed"
	StateCancelled  TripState = "cancelled"
)

type StateTransition struct {
	From      TripState
	To        TripState
	Timestamp time.Time
	ActorID   string
}

type Trip struct {
	ID         string
	mu         sync.Mutex
	State      TripState
	History    []StateTransition
	DriverID   string
	RiderID    string
}

var validTransitions = map[TripState][]TripState{
	StateRequested:  {StateAccepted, StateCancelled},
	StateAccepted:   {StateEnRoute, StateCancelled},
	StateEnRoute:    {StateArrived, StateCancelled},
	StateArrived:    {StateInProgress, StateCancelled},
	StateInProgress: {StateCompleted, StateCancelled},
}

func (t *Trip) Transition(to TripState, actorID string) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	allowed, ok := validTransitions[t.State]
	if !ok {
		return fmt.Errorf("no transitions allowed from state %s", t.State)
	}
	valid := false
	for _, s := range allowed {
		if s == to {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid transition from %s to %s: %w", t.State, to, errors.New("invalid transition"))
	}

	t.History = append(t.History, StateTransition{
		From:      t.State,
		To:        to,
		Timestamp: time.Now(),
		ActorID:   actorID,
	})
	t.State = to
	fmt.Printf("Trip %s: %s → %s (by %s)\n", t.ID, t.History[len(t.History)-1].From, to, actorID)
	return nil
}

func (t *Trip) CurrentState() TripState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.State
}

func main() {
	trip := &Trip{ID: "trip-001", State: StateRequested, RiderID: "rider-1"}

	steps := []struct {
		state TripState
		actor string
	}{
		{StateAccepted, "driver-42"},
		{StateEnRoute, "driver-42"},
		{StateArrived, "driver-42"},
		{StateInProgress, "system"},
		{StateCompleted, "system"},
	}

	for _, s := range steps {
		if err := trip.Transition(s.state, s.actor); err != nil {
			fmt.Printf("Error: %v\n", err)
		}
	}

	// Invalid transition
	err := trip.Transition(StateAccepted, "driver-42")
	fmt.Println("Invalid transition:", err)
}
```

**Production Notes:**
- Trip state is stored in a distributed DB (Uber uses Schemaless, their own MySQL-backed document store).
- Each transition emits an event to Kafka; downstream services (billing, analytics, driver score) consume events.
- Optimistic locking: include `version` field; CAS on DB write to prevent concurrent transitions.
- Cancellation is allowed from multiple states but triggers different compensation logic (no charge vs. cancellation fee).
- Saga pattern for distributed state: trip transitions may require coordinating driver state, payment auth, and map routing.

---

## Problem 12: Dynamic Pricing Goroutine Pool

**Problem Statement:**
Implement a goroutine pool that concurrently computes dynamic prices for thousands of active trips and caches results with a short TTL.

**Go Implementation:**

```go
package main

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type PriceRequest struct {
	TripID     string
	BasePrice  float64
	SurgeMult  float64
	Distance   float64
	DurationMs int
}

type PriceResult struct {
	TripID    string
	FinalPrice float64
	ComputedAt time.Time
	Err        error
}

type PriceCache struct {
	mu      sync.RWMutex
	entries map[string]*cacheEntry
	ttl     time.Duration
}

type cacheEntry struct {
	result    PriceResult
	expiresAt time.Time
}

func NewPriceCache(ttl time.Duration) *PriceCache {
	c := &PriceCache{entries: make(map[string]*cacheEntry), ttl: ttl}
	go c.evict()
	return c
}

func (c *PriceCache) Get(tripID string) (PriceResult, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if e, ok := c.entries[tripID]; ok && time.Now().Before(e.expiresAt) {
		return e.result, true
	}
	return PriceResult{}, false
}

func (c *PriceCache) Set(r PriceResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[r.TripID] = &cacheEntry{result: r, expiresAt: time.Now().Add(c.ttl)}
}

func (c *PriceCache) evict() {
	ticker := time.NewTicker(c.ttl)
	defer ticker.Stop()
	for range ticker.C {
		c.mu.Lock()
		now := time.Now()
		for id, e := range c.entries {
			if now.After(e.expiresAt) {
				delete(c.entries, id)
			}
		}
		c.mu.Unlock()
	}
}

type PricingPool struct {
	workers int
	jobs    chan PriceRequest
	results chan PriceResult
	cache   *PriceCache
	wg      sync.WaitGroup
}

func NewPricingPool(workers int, cache *PriceCache) *PricingPool {
	return &PricingPool{
		workers: workers,
		jobs:    make(chan PriceRequest, workers*2),
		results: make(chan PriceResult, workers*2),
		cache:   cache,
	}
}

func computePrice(req PriceRequest) PriceResult {
	// Simulate computation
	time.Sleep(time.Duration(rand.Intn(20)) * time.Millisecond)
	perKm := 1.5
	perMin := 0.25
	finalPrice := (req.BasePrice + req.Distance*perKm + float64(req.DurationMs)/60000*perMin) * req.SurgeMult
	finalPrice = math.Round2(finalPrice)
	return PriceResult{TripID: req.TripID, FinalPrice: finalPrice, ComputedAt: time.Now()}
}

// Simplified math.Round2 shim
func math_round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func (p *PricingPool) Start(ctx context.Context) {
	for i := 0; i < p.workers; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for {
				select {
				case req, ok := <-p.jobs:
					if !ok {
						return
					}
					if r, hit := p.cache.Get(req.TripID); hit {
						p.results <- r
						continue
					}
					result := PriceResult{
						TripID:     req.TripID,
						FinalPrice: math_round2((req.BasePrice+req.Distance*1.5+float64(req.DurationMs)/60000*0.25)*req.SurgeMult),
						ComputedAt: time.Now(),
					}
					p.cache.Set(result)
					p.results <- result
				case <-ctx.Done():
					return
				}
			}
		}()
	}
}

func (p *PricingPool) Submit(req PriceRequest) { p.jobs <- req }
func (p *PricingPool) Results() <-chan PriceResult { return p.results }
func (p *PricingPool) Stop() {
	close(p.jobs)
	p.wg.Wait()
	close(p.results)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cache := NewPriceCache(5 * time.Second)
	pool := NewPricingPool(8, cache)
	pool.Start(ctx)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		count := 0
		for r := range pool.Results() {
			fmt.Printf("Trip %s: $%.2f\n", r.TripID, r.FinalPrice)
			count++
			if count == 5 {
				return
			}
		}
	}()

	for i := 0; i < 5; i++ {
		pool.Submit(PriceRequest{
			TripID:     fmt.Sprintf("trip-%d", i),
			BasePrice:  2.50,
			SurgeMult:  1.5,
			Distance:   float64(5 + i),
			DurationMs: (15 + i) * 60 * 1000,
		})
	}

	wg.Wait()
	pool.Stop()
}
```

**Production Notes:**
- Price computation is read-heavy; cache aggressively with short TTL (5-10s for surge, longer for base fare).
- Use `singleflight` to deduplicate concurrent price requests for the same trip ID.
- Dynamic pricing is computed at the pricing service boundary; trip service consumes it via gRPC with a timeout.
- Price audit log: every computed price is stored for regulatory compliance and dispute resolution.

---

## Problem 13: Driver Supply/Demand Balancer

**Problem Statement:**
Implement a balancer that monitors supply (available drivers) and demand (pending ride requests) per geographic zone and triggers incentive programs to rebalance.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Zone struct {
	ID      string
	drivers int64 // atomic: available drivers
	demand  int64 // atomic: pending requests
}

func (z *Zone) SupplyRatio() float64 {
	d := atomic.LoadInt64(&z.drivers)
	r := atomic.LoadInt64(&z.demand)
	if r == 0 {
		return float64(d) // infinite ratio if no demand
	}
	return float64(d) / float64(r)
}

type IncentiveAction string

const (
	ActionBoostIncentive   IncentiveAction = "BOOST_INCENTIVE"   // pay drivers more to come to zone
	ActionSurgePricing     IncentiveAction = "SURGE_PRICING"     // reduce demand via higher prices
	ActionNoAction         IncentiveAction = "NO_ACTION"
	ActionRelaxIncentive   IncentiveAction = "RELAX_INCENTIVE"   // too many drivers, reduce incentives
)

type BalancerEvent struct {
	ZoneID    string
	Action    IncentiveAction
	Ratio     float64
	Timestamp time.Time
}

type SupplyDemandBalancer struct {
	mu      sync.RWMutex
	zones   map[string]*Zone
	events  chan BalancerEvent
	lowRatio  float64 // below this → boost incentives
	highRatio float64 // above this → relax incentives
}

func NewBalancer(low, high float64) *SupplyDemandBalancer {
	return &SupplyDemandBalancer{
		zones:     make(map[string]*Zone),
		events:    make(chan BalancerEvent, 100),
		lowRatio:  low,
		highRatio: high,
	}
}

func (b *SupplyDemandBalancer) UpsertZone(zoneID string, drivers, demand int64) {
	b.mu.Lock()
	z, ok := b.zones[zoneID]
	if !ok {
		z = &Zone{ID: zoneID}
		b.zones[zoneID] = z
	}
	b.mu.Unlock()
	atomic.StoreInt64(&z.drivers, drivers)
	atomic.StoreInt64(&z.demand, demand)
}

func (b *SupplyDemandBalancer) Evaluate() {
	b.mu.RLock()
	zones := make([]*Zone, 0, len(b.zones))
	for _, z := range b.zones {
		zones = append(zones, z)
	}
	b.mu.RUnlock()

	var wg sync.WaitGroup
	for _, z := range zones {
		z := z
		wg.Add(1)
		go func() {
			defer wg.Done()
			ratio := z.SupplyRatio()
			var action IncentiveAction
			switch {
			case ratio < b.lowRatio:
				action = ActionBoostIncentive
			case ratio < 1.0:
				action = ActionSurgePricing
			case ratio > b.highRatio:
				action = ActionRelaxIncentive
			default:
				action = ActionNoAction
			}
			if action != ActionNoAction {
				b.events <- BalancerEvent{
					ZoneID:    z.ID,
					Action:    action,
					Ratio:     ratio,
					Timestamp: time.Now(),
				}
			}
		}()
	}
	wg.Wait()
}

func (b *SupplyDemandBalancer) Events() <-chan BalancerEvent {
	return b.events
}

func (b *SupplyDemandBalancer) StartLoop(interval time.Duration, ctx interface{ Done() <-chan struct{} }) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				b.Evaluate()
			case <-ctx.Done():
				return
			}
		}
	}()
}

func main() {
	balancer := NewBalancer(0.5, 2.0)

	balancer.UpsertZone("downtown", 5, 20)  // under-supply
	balancer.UpsertZone("airport", 15, 3)   // over-supply
	balancer.UpsertZone("midtown", 8, 10)   // balanced

	balancer.Evaluate()

	close := make(chan struct{})
	timeout := time.After(100 * time.Millisecond)
	go func() {
		<-timeout
		close <- struct{}{}
	}()

	for {
		select {
		case event := <-balancer.Events():
			fmt.Printf("Zone %s: action=%s ratio=%.2f\n",
				event.ZoneID, event.Action, event.Ratio)
		case <-close:
			fmt.Println("Evaluation complete")
			return
		}
	}
}
```

**Production Notes:**
- Supply-demand balance runs as a continuous control loop; Uber calls this the "marketplace balancing" system.
- Incentive boosts are push notifications to off-duty drivers with financial incentives ("Earn an extra $10 in the next hour in downtown").
- The feedback loop has hysteresis: avoid oscillating between actions by requiring ratio to cross threshold for >2 consecutive evaluations.
- Machine learning predicts demand 15-30 minutes ahead; preemptively incentivizes drivers to position near anticipated demand.
- Metrics: publish supply ratio per zone per minute to a time-series DB (InfluxDB/Prometheus) for dashboards and alerting.

---

## Problem 14: WebSocket Hub for Real-Time Driver Tracking

**Problem Statement:**
Implement a WebSocket hub that pushes real-time driver location updates to subscribed rider clients.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type LocationMessage struct {
	DriverID string
	Lat, Lng float64
	Bearing  float64
	Speed    float64
}

type Client struct {
	ID      string
	TripID  string
	channel chan LocationMessage
	done    chan struct{}
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string][]*Client // tripID → clients watching that trip
}

func NewHub() *Hub {
	return &Hub{clients: make(map[string][]*Client)}
}

func (h *Hub) Subscribe(tripID, clientID string) *Client {
	c := &Client{
		ID:      clientID,
		TripID:  tripID,
		channel: make(chan LocationMessage, 20),
		done:    make(chan struct{}),
	}
	h.mu.Lock()
	h.clients[tripID] = append(h.clients[tripID], c)
	h.mu.Unlock()
	return c
}

func (h *Hub) Unsubscribe(tripID, clientID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	clients := h.clients[tripID]
	for i, c := range clients {
		if c.ID == clientID {
			close(c.done)
			h.clients[tripID] = append(clients[:i], clients[i+1:]...)
			return
		}
	}
}

func (h *Hub) Broadcast(tripID string, msg LocationMessage) {
	h.mu.RLock()
	clients := make([]*Client, len(h.clients[tripID]))
	copy(clients, h.clients[tripID])
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.channel <- msg:
		case <-c.done:
		default:
			// Client too slow: drop update (location will be re-sent next tick)
		}
	}
}

func main() {
	hub := NewHub()

	// Rider subscribes to trip
	rider1 := hub.Subscribe("trip-100", "rider-app-1")
	rider2 := hub.Subscribe("trip-100", "rider-app-2")

	// Consume updates
	for _, rider := range []*Client{rider1, rider2} {
		rider := rider
		go func() {
			for msg := range rider.channel {
				fmt.Printf("Client %s: driver at (%.4f, %.4f) speed=%.1fkm/h\n",
					rider.ID, msg.Lat, msg.Lng, msg.Speed)
			}
		}()
	}

	// Simulate driver location updates
	for i := 0; i < 3; i++ {
		hub.Broadcast("trip-100", LocationMessage{
			DriverID: "driver-42",
			Lat:      37.7749 + float64(i)*0.001,
			Lng:      -122.4194 + float64(i)*0.001,
			Speed:    30.0,
		})
		time.Sleep(4 * time.Second / 3)
	}

	hub.Unsubscribe("trip-100", "rider-app-1")
	time.Sleep(100 * time.Millisecond)
}
```

**Production Notes:**
- Each Go pod handles ~10K concurrent WebSocket connections; scale horizontally behind an L7 load balancer (sticky sessions by trip ID).
- Pub-sub backend: each pod subscribes to a Redis channel for the trips it is serving; driver location updates are published from the location service.
- Heartbeat: send a ping every 30s; close connection if no pong within 10s.
- Battery optimization: send updates at 1/4s rate; reduce to 1/sec when rider app is backgrounded.
- Graceful shutdown: drain all connections with a final "driver location unavailable" message before pod restarts.

---

## Problem 15: Idempotent Payment Processor

**Problem Statement:**
Implement a payment processor that guarantees idempotency: submitting the same payment request multiple times (due to retries) produces exactly one charge.

**Go Implementation:**

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

type PaymentStatus string

const (
	StatusPending   PaymentStatus = "pending"
	StatusSucceeded PaymentStatus = "succeeded"
	StatusFailed    PaymentStatus = "failed"
)

type Payment struct {
	IdempotencyKey string
	TripID         string
	RiderID        string
	Amount         float64
	Status         PaymentStatus
	ProcessedAt    time.Time
	Error          string
}

type PaymentProcessor struct {
	mu       sync.Mutex
	payments map[string]*Payment
	inflight map[string]*sync.Once
}

func NewPaymentProcessor() *PaymentProcessor {
	return &PaymentProcessor{
		payments: make(map[string]*Payment),
		inflight: make(map[string]*sync.Once),
	}
}

func (p *PaymentProcessor) Process(key string, pay *Payment) (*Payment, error) {
	p.mu.Lock()
	// Check if already processed
	if existing, ok := p.payments[key]; ok {
		p.mu.Unlock()
		return existing, nil
	}
	// Get or create a Once for this key
	if p.inflight[key] == nil {
		p.inflight[key] = &sync.Once{}
	}
	once := p.inflight[key]
	p.mu.Unlock()

	var result *Payment
	var err error

	once.Do(func() {
		// Simulate payment gateway call
		result = &Payment{
			IdempotencyKey: key,
			TripID:         pay.TripID,
			RiderID:        pay.RiderID,
			Amount:         pay.Amount,
			Status:         StatusSucceeded,
			ProcessedAt:    time.Now(),
		}

		// Simulate failure for odd amounts
		if int(pay.Amount)%2 != 0 {
			result.Status = StatusFailed
			result.Error = "insufficient funds"
			err = errors.New(result.Error)
		}

		p.mu.Lock()
		p.payments[key] = result
		delete(p.inflight, key)
		p.mu.Unlock()
	})

	p.mu.Lock()
	if stored, ok := p.payments[key]; ok {
		p.mu.Unlock()
		return stored, err
	}
	p.mu.Unlock()
	return result, err
}

func main() {
	processor := NewPaymentProcessor()

	// Simulate concurrent retries for same payment
	payment := &Payment{
		TripID:  "trip-100",
		RiderID: "rider-1",
		Amount:  24.50,
	}

	var wg sync.WaitGroup
	results := make([]*Payment, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		i := i
		go func() {
			defer wg.Done()
			result, err := processor.Process("pay-trip-100-v1", payment)
			results[i] = result
			if err != nil {
				fmt.Printf("Attempt %d error: %v\n", i+1, err)
			}
		}()
	}
	wg.Wait()

	// All results should reference the same processed payment
	fmt.Printf("Processed at: %v (all %d attempts got same result)\n",
		results[0].ProcessedAt.Format(time.RFC3339), len(results))
	fmt.Printf("Status: %s Amount: $%.2f\n", results[0].Status, results[0].Amount)
}
```

**Production Notes:**
- Idempotency key is generated by the client (UUID); stored with the payment record.
- In production, idempotency is enforced at the DB level with a UNIQUE constraint on the key.
- `sync.Once` ensures in-process deduplication; DB unique key ensures cross-node deduplication.
- Store idempotency keys for 24-48 hours; safe to retry within that window.
- Stripe-style: return the original response for duplicate keys, even if the original failed.

---

## Problem 16: Concurrent Trip Receipt Generator

**Problem Statement:**
Generate detailed trip receipts concurrently for millions of completed trips. Fetch fare breakdown, driver rating, route map, and promotions in parallel.

**Go Implementation:**

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Receipt struct {
	TripID       string
	FareBreakdown map[string]float64
	DriverRating  float64
	RoutePolyline string
	Promotions   []string
	GeneratedAt  time.Time
}

type ReceiptBuilder struct {
	tripID string
}

func (rb *ReceiptBuilder) fetchFare(ctx context.Context) (map[string]float64, error) {
	select {
	case <-time.After(30 * time.Millisecond):
		return map[string]float64{"base": 2.50, "distance": 8.40, "time": 3.20, "surge": 1.50}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (rb *ReceiptBuilder) fetchDriverRating(ctx context.Context) (float64, error) {
	select {
	case <-time.After(20 * time.Millisecond):
		return 4.85, nil
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

func (rb *ReceiptBuilder) fetchRoute(ctx context.Context) (string, error) {
	select {
	case <-time.After(50 * time.Millisecond):
		return "encoded_polyline_data", nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (rb *ReceiptBuilder) fetchPromotions(ctx context.Context) ([]string, error) {
	select {
	case <-time.After(15 * time.Millisecond):
		return []string{"PROMO10", "FIRST_RIDE_FREE"}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (rb *ReceiptBuilder) Build(ctx context.Context) (*Receipt, error) {
	type result struct {
		field string
		value interface{}
		err   error
	}
	results := make(chan result, 4)

	var wg sync.WaitGroup
	wg.Add(4)

	go func() { defer wg.Done(); v, e := rb.fetchFare(ctx); results <- result{"fare", v, e} }()
	go func() { defer wg.Done(); v, e := rb.fetchDriverRating(ctx); results <- result{"rating", v, e} }()
	go func() { defer wg.Done(); v, e := rb.fetchRoute(ctx); results <- result{"route", v, e} }()
	go func() { defer wg.Done(); v, e := rb.fetchPromotions(ctx); results <- result{"promos", v, e} }()

	go func() {
		wg.Wait()
		close(results)
	}()

	receipt := &Receipt{TripID: rb.tripID, GeneratedAt: time.Now()}
	for r := range results {
		if r.err != nil {
			return nil, fmt.Errorf("fetching %s: %w", r.field, r.err)
		}
		switch r.field {
		case "fare":
			receipt.FareBreakdown = r.value.(map[string]float64)
		case "rating":
			receipt.DriverRating = r.value.(float64)
		case "route":
			receipt.RoutePolyline = r.value.(string)
		case "promos":
			receipt.Promotions = r.value.([]string)
		}
	}
	return receipt, nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	builder := &ReceiptBuilder{tripID: "trip-12345"}
	receipt, err := builder.Build(ctx)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Printf("Receipt for %s:\n", receipt.TripID)
	fmt.Printf("  Fare: %v\n", receipt.FareBreakdown)
	fmt.Printf("  Driver rating: %.2f\n", receipt.DriverRating)
	fmt.Printf("  Promotions: %v\n", receipt.Promotions)
	fmt.Printf("  Generated in: %v\n", time.Since(receipt.GeneratedAt))
}
```

**Production Notes:**
- Fan-out pattern is critical for receipt generation: total latency = max(individual fetch latencies), not sum.
- Non-critical fields (promotions, route) use a timeout and gracefully degrade if unavailable.
- Cache receipts immutably after generation; they never change once the trip is settled.
- Email receipt is queued asynchronously via the notification service; in-app receipt is served synchronously.

---

## Problem 17: Hot-Cold Driver Partition

**Problem Statement:**
Classify drivers as "hot" (actively driving in a busy zone) or "cold" (idle, far from demand). Efficiently route new dispatch requests to hot drivers first.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type DriverTier string

const (
	TierHot  DriverTier = "hot"
	TierWarm DriverTier = "warm"
	TierCold DriverTier = "cold"
)

type DriverProfile struct {
	ID            string
	Tier          DriverTier
	LastActivity  time.Time
	Zone          string
	TripsToday    int
	AvgRating     float64
}

type HotColdPartition struct {
	mu      sync.RWMutex
	drivers map[string]*DriverProfile
	hot     map[string]*DriverProfile
	warm    map[string]*DriverProfile
	cold    map[string]*DriverProfile
}

func NewHotColdPartition() *HotColdPartition {
	return &HotColdPartition{
		drivers: make(map[string]*DriverProfile),
		hot:     make(map[string]*DriverProfile),
		warm:    make(map[string]*DriverProfile),
		cold:    make(map[string]*DriverProfile),
	}
}

func (p *HotColdPartition) classify(d *DriverProfile) DriverTier {
	idleDuration := time.Since(d.LastActivity)
	switch {
	case idleDuration < 5*time.Minute && d.TripsToday > 3:
		return TierHot
	case idleDuration < 15*time.Minute:
		return TierWarm
	default:
		return TierCold
	}
}

func (p *HotColdPartition) Upsert(d *DriverProfile) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Remove from current tier
	if old, ok := p.drivers[d.ID]; ok {
		switch old.Tier {
		case TierHot:
			delete(p.hot, d.ID)
		case TierWarm:
			delete(p.warm, d.ID)
		case TierCold:
			delete(p.cold, d.ID)
		}
	}

	d.Tier = p.classify(d)
	p.drivers[d.ID] = d
	switch d.Tier {
	case TierHot:
		p.hot[d.ID] = d
	case TierWarm:
		p.warm[d.ID] = d
	case TierCold:
		p.cold[d.ID] = d
	}
}

func (p *HotColdPartition) GetByTier(tier DriverTier) []*DriverProfile {
	p.mu.RLock()
	defer p.mu.RUnlock()
	var source map[string]*DriverProfile
	switch tier {
	case TierHot:
		source = p.hot
	case TierWarm:
		source = p.warm
	case TierCold:
		source = p.cold
	}
	result := make([]*DriverProfile, 0, len(source))
	for _, d := range source {
		result = append(result, d)
	}
	return result
}

func (p *HotColdPartition) Stats() map[DriverTier]int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return map[DriverTier]int{
		TierHot:  len(p.hot),
		TierWarm: len(p.warm),
		TierCold: len(p.cold),
	}
}

func main() {
	partition := NewHotColdPartition()

	drivers := []*DriverProfile{
		{ID: "D1", LastActivity: time.Now().Add(-2 * time.Minute), TripsToday: 5, Zone: "downtown"},
		{ID: "D2", LastActivity: time.Now().Add(-8 * time.Minute), TripsToday: 2, Zone: "midtown"},
		{ID: "D3", LastActivity: time.Now().Add(-30 * time.Minute), TripsToday: 1, Zone: "suburb"},
		{ID: "D4", LastActivity: time.Now().Add(-1 * time.Minute), TripsToday: 8, Zone: "downtown"},
	}

	for _, d := range drivers {
		partition.Upsert(d)
	}

	stats := partition.Stats()
	fmt.Println("Driver counts by tier:", stats)

	hotDrivers := partition.GetByTier(TierHot)
	fmt.Printf("Hot drivers (%d): ", len(hotDrivers))
	for _, d := range hotDrivers {
		fmt.Printf("%s ", d.ID)
	}
	fmt.Println()
}
```

**Production Notes:**
- Hot drivers are scored higher in the dispatch algorithm; cold drivers receive incentives to reactivate.
- Re-classification runs as a background job every 60s; use Redis sorted sets to maintain per-tier lists.
- Tier boundaries are tunable per city and time-of-day; downtown at rush hour has different thresholds than suburbs at 2am.
- Track tier transitions in analytics: time spent in each tier, transition rates → optimize incentive spend.

---

## Problem 18: Adaptive Timeout Manager

**Problem Statement:**
Implement a timeout manager that adapts per-service timeouts based on recent p99 latency observations, preventing cascading failures.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"math"
	"sort"
	"sync"
	"time"
)

type LatencyTracker struct {
	mu      sync.Mutex
	samples []time.Duration
	maxSize int
	pos     int
	full    bool
}

func NewLatencyTracker(windowSize int) *LatencyTracker {
	return &LatencyTracker{
		samples: make([]time.Duration, windowSize),
		maxSize: windowSize,
	}
}

func (lt *LatencyTracker) Record(d time.Duration) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	lt.samples[lt.pos] = d
	lt.pos = (lt.pos + 1) % lt.maxSize
	if lt.pos == 0 {
		lt.full = true
	}
}

func (lt *LatencyTracker) Percentile(p float64) time.Duration {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	n := lt.maxSize
	if !lt.full {
		n = lt.pos
	}
	if n == 0 {
		return 100 * time.Millisecond
	}
	sorted := make([]time.Duration, n)
	copy(sorted, lt.samples[:n])
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	idx := int(math.Ceil(p/100.0*float64(n))) - 1
	if idx < 0 {
		idx = 0
	}
	return sorted[idx]
}

type AdaptiveTimeoutManager struct {
	mu       sync.RWMutex
	trackers map[string]*LatencyTracker
	factor   float64 // timeout = p99 * factor
	minTO    time.Duration
	maxTO    time.Duration
}

func NewAdaptiveTimeoutManager(factor float64, min, max time.Duration) *AdaptiveTimeoutManager {
	return &AdaptiveTimeoutManager{
		trackers: make(map[string]*LatencyTracker),
		factor:   factor,
		minTO:    min,
		maxTO:    max,
	}
}

func (m *AdaptiveTimeoutManager) Record(service string, latency time.Duration) {
	m.mu.RLock()
	t, ok := m.trackers[service]
	m.mu.RUnlock()
	if !ok {
		m.mu.Lock()
		if t, ok = m.trackers[service]; !ok {
			t = NewLatencyTracker(100)
			m.trackers[service] = t
		}
		m.mu.Unlock()
	}
	t.Record(latency)
}

func (m *AdaptiveTimeoutManager) Timeout(service string) time.Duration {
	m.mu.RLock()
	t, ok := m.trackers[service]
	m.mu.RUnlock()
	if !ok {
		return m.maxTO
	}
	p99 := t.Percentile(99)
	timeout := time.Duration(float64(p99) * m.factor)
	if timeout < m.minTO {
		return m.minTO
	}
	if timeout > m.maxTO {
		return m.maxTO
	}
	return timeout
}

func main() {
	mgr := NewAdaptiveTimeoutManager(1.5, 50*time.Millisecond, 5*time.Second)

	// Simulate recording latencies
	latencies := []time.Duration{
		80 * time.Millisecond,
		120 * time.Millisecond,
		95 * time.Millisecond,
		200 * time.Millisecond, // spike
		100 * time.Millisecond,
	}
	for _, l := range latencies {
		mgr.Record("payment-service", l)
	}

	timeout := mgr.Timeout("payment-service")
	fmt.Printf("Adaptive timeout for payment-service: %v\n", timeout)

	// After more healthy samples, timeout should shrink
	for i := 0; i < 10; i++ {
		mgr.Record("payment-service", 90*time.Millisecond)
	}
	timeout2 := mgr.Timeout("payment-service")
	fmt.Printf("After more healthy samples: %v\n", timeout2)
}
```

**Production Notes:**
- Adaptive timeouts prevent domino failures: if service A degrades to 500ms p99, don't wait 5s before failing.
- Timeout must be set to p99 * safety factor (1.2-2x); too tight → false failures; too loose → cascades.
- Combine with circuit breaker: if the adapted timeout causes the circuit to open, switch to a fallback.
- Update timeouts gradually using exponential moving average on p99 to avoid thrashing.

---

## Problem 19: Real-Time Fraud Detection Stream

**Problem Statement:**
Detect fraudulent trip patterns in real-time: multiple simultaneous trips from the same account, impossible speed between locations, or payment method velocity abuse.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

type TripEvent struct {
	TripID    string
	RiderID   string
	Lat, Lng  float64
	Timestamp time.Time
	PaymentID string
}

type FraudSignal struct {
	RiderID    string
	TripID     string
	SignalType string
	Detail     string
}

type FraudDetector struct {
	mu             sync.RWMutex
	activeTrips    map[string][]string   // riderID → active tripIDs
	lastLocation   map[string]*TripEvent // riderID → last known event
	paymentVelocity map[string][]time.Time // paymentID → recent use times
	signals        chan FraudSignal
}

func NewFraudDetector() *FraudDetector {
	return &FraudDetector{
		activeTrips:     make(map[string][]string),
		lastLocation:    make(map[string]*TripEvent),
		paymentVelocity: make(map[string][]time.Time),
		signals:         make(chan FraudSignal, 1000),
	}
}

func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func (fd *FraudDetector) Process(event TripEvent) {
	fd.mu.Lock()
	defer fd.mu.Unlock()

	// Rule 1: Multiple simultaneous trips from same rider
	trips := fd.activeTrips[event.RiderID]
	if len(trips) > 1 {
		fd.signals <- FraudSignal{
			RiderID:    event.RiderID,
			TripID:     event.TripID,
			SignalType: "SIMULTANEOUS_TRIPS",
			Detail:     fmt.Sprintf("%d active trips", len(trips)),
		}
	}

	// Rule 2: Impossible speed (>300 km/h between updates)
	if last, ok := fd.lastLocation[event.RiderID]; ok {
		dist := haversineKm(last.Lat, last.Lng, event.Lat, event.Lng)
		elapsed := event.Timestamp.Sub(last.Timestamp).Hours()
		if elapsed > 0 && dist/elapsed > 300 {
			fd.signals <- FraudSignal{
				RiderID:    event.RiderID,
				TripID:     event.TripID,
				SignalType: "IMPOSSIBLE_SPEED",
				Detail:     fmt.Sprintf("%.1f km/h detected", dist/elapsed),
			}
		}
	}

	// Rule 3: Payment method velocity (>5 uses in 10 minutes)
	cutoff := event.Timestamp.Add(-10 * time.Minute)
	recent := fd.paymentVelocity[event.PaymentID]
	valid := recent[:0]
	for _, t := range recent {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	valid = append(valid, event.Timestamp)
	fd.paymentVelocity[event.PaymentID] = valid
	if len(valid) > 5 {
		fd.signals <- FraudSignal{
			RiderID:    event.RiderID,
			TripID:     event.TripID,
			SignalType: "PAYMENT_VELOCITY",
			Detail:     fmt.Sprintf("%d uses in 10min", len(valid)),
		}
	}

	fd.lastLocation[event.RiderID] = &event
	fd.activeTrips[event.RiderID] = append(fd.activeTrips[event.RiderID], event.TripID)
}

func (fd *FraudDetector) Signals() <-chan FraudSignal { return fd.signals }

func main() {
	fd := NewFraudDetector()

	go func() {
		for signal := range fd.Signals() {
			fmt.Printf("FRAUD SIGNAL [%s] rider=%s trip=%s: %s\n",
				signal.SignalType, signal.RiderID, signal.TripID, signal.Detail)
		}
	}()

	base := time.Now()
	events := []TripEvent{
		{TripID: "T1", RiderID: "R1", Lat: 37.77, Lng: -122.41, Timestamp: base, PaymentID: "PM1"},
		{TripID: "T2", RiderID: "R1", Lat: 37.78, Lng: -122.40, Timestamp: base.Add(time.Second), PaymentID: "PM1"},
		// Impossible speed: jumped 1000km in 1 second
		{TripID: "T3", RiderID: "R1", Lat: 47.77, Lng: -122.41, Timestamp: base.Add(2 * time.Second), PaymentID: "PM1"},
	}

	for _, e := range events {
		fd.Process(e)
	}
	time.Sleep(100 * time.Millisecond)
}
```

**Production Notes:**
- Stream-processing pipeline: Kafka → Go fraud detection service → action service (block/flag/allow).
- Rule-based detection catches known patterns; ML models (gradient boosting on feature vectors) catch novel patterns.
- Low false-positive tolerance: most signals create a "review" flag, not immediate block.
- Feature store: pre-computed features (rider's historical trip velocity, device fingerprint, account age) fetched in <10ms.
- Real-time scoring latency: <50ms P99 to not delay trip start; run fraud check async and cancel if fraud detected post-match.

---

## Problem 20: Config Hot-Reload Without Restart

**Problem Statement:**
Implement a configuration manager that watches for file changes and hot-reloads config values atomically, without restarting the service.

**Go Implementation:**

```go
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

type Config struct {
	MaxDriversPerZone  int     `json:"max_drivers_per_zone"`
	SurgeMultiplierMax float64 `json:"surge_multiplier_max"`
	DispatchRadiusKm   float64 `json:"dispatch_radius_km"`
	FeatureFlags       map[string]bool `json:"feature_flags"`
}

type AtomicConfig struct {
	ptr unsafe.Pointer
}

func NewAtomicConfig(c *Config) *AtomicConfig {
	ac := &AtomicConfig{}
	atomic.StorePointer(&ac.ptr, unsafe.Pointer(c))
	return ac
}

func (ac *AtomicConfig) Load() *Config {
	return (*Config)(atomic.LoadPointer(&ac.ptr))
}

func (ac *AtomicConfig) Store(c *Config) {
	atomic.StorePointer(&ac.ptr, unsafe.Pointer(c))
}

type ConfigManager struct {
	current   *AtomicConfig
	mu        sync.RWMutex
	listeners []func(*Config)
	filePath  string
}

func NewConfigManager(filePath string) (*ConfigManager, error) {
	cm := &ConfigManager{filePath: filePath}
	cfg, err := cm.loadFromFile()
	if err != nil {
		return nil, err
	}
	cm.current = NewAtomicConfig(cfg)
	return cm, nil
}

func (cm *ConfigManager) loadFromFile() (*Config, error) {
	data, err := os.ReadFile(cm.filePath)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (cm *ConfigManager) Get() *Config {
	return cm.current.Load()
}

func (cm *ConfigManager) OnChange(fn func(*Config)) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.listeners = append(cm.listeners, fn)
}

func (cm *ConfigManager) WatchFile(interval time.Duration) {
	go func() {
		var lastMod time.Time
		for {
			info, err := os.Stat(cm.filePath)
			if err == nil && info.ModTime().After(lastMod) {
				if cfg, err := cm.loadFromFile(); err == nil {
					cm.current.Store(cfg)
					lastMod = info.ModTime()
					fmt.Println("Config reloaded")
					cm.mu.RLock()
					for _, fn := range cm.listeners {
						fn(cfg)
					}
					cm.mu.RUnlock()
				}
			}
			time.Sleep(interval)
		}
	}()
}

func main() {
	// Write initial config
	initialCfg := `{"max_drivers_per_zone":50,"surge_multiplier_max":4.0,"dispatch_radius_km":5.0,"feature_flags":{"new_dispatch":true}}`
	os.WriteFile("/tmp/uber-config.json", []byte(initialCfg), 0644)

	cm, err := NewConfigManager("/tmp/uber-config.json")
	if err != nil {
		fmt.Println("Error:", err)
		return
	}

	cm.OnChange(func(cfg *Config) {
		fmt.Printf("Config changed! MaxDrivers=%d SurgeMax=%.1f\n",
			cfg.MaxDriversPerZone, cfg.SurgeMultiplierMax)
	})

	cm.WatchFile(100 * time.Millisecond)

	cfg := cm.Get()
	fmt.Printf("Initial config: maxDrivers=%d surgeMax=%.1f\n",
		cfg.MaxDriversPerZone, cfg.SurgeMultiplierMax)

	// Simulate file change
	time.Sleep(150 * time.Millisecond)
	newCfg := `{"max_drivers_per_zone":100,"surge_multiplier_max":3.5,"dispatch_radius_km":8.0,"feature_flags":{"new_dispatch":true,"ml_dispatch":true}}`
	os.WriteFile("/tmp/uber-config.json", []byte(newCfg), 0644)

	time.Sleep(300 * time.Millisecond)
	cfg = cm.Get()
	fmt.Printf("Updated config: maxDrivers=%d surgeMax=%.1f\n",
		cfg.MaxDriversPerZone, cfg.SurgeMultiplierMax)
}
```

**Production Notes:**
- Use `fsnotify` (inotify/kqueue) for real-time file change events instead of polling.
- Config validation before swap: reject malformed configs, alert on schema violations.
- Feature flags via LaunchDarkly or internal flagging systems; hot-reload enables instant rollout/rollback.
- Audit log every config change with diff: who changed what, when, and what the old value was.
- Config changes should be atomic at the application level: all goroutines see the new config simultaneously via the atomic pointer swap.

---

## Problem 21: Geo-Hashing for Proximity Search

**Problem Statement:**
Implement geohash-based proximity search to find drivers within a configurable radius without scanning all drivers.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"math"
	"strings"
	"sync"
)

// Simplified geohash: encode lat/lng to a grid cell
const base32 = "0123456789bcdefghjkmnpqrstuvwxyz"

func encode(lat, lng float64, precision int) string {
	minLat, maxLat := -90.0, 90.0
	minLng, maxLng := -180.0, 180.0

	var hash strings.Builder
	bits := 0
	bitsTotal := 0
	even := true
	var ch int

	for hash.Len() < precision {
		if even {
			mid := (minLng + maxLng) / 2
			if lng >= mid {
				ch |= bits
				minLng = mid
			} else {
				maxLng = mid
			}
		} else {
			mid := (minLat + maxLat) / 2
			if lat >= mid {
				ch |= bits
				minLat = mid
			} else {
				maxLat = mid
			}
		}
		even = !even
		if bits > 1 {
			bits >>= 1
		} else {
			hash.WriteByte(base32[ch])
			bits = 16
			bitsTotal += 5
			ch = 0
		}
		_ = bitsTotal
	}
	return hash.String()
}

// Simplified: compute prefix for neighborhood search
func neighbors(hash string) []string {
	// In production use a proper geohash library
	// This returns a simplified approximation
	result := []string{hash}
	prefix := hash[:len(hash)-1]
	for _, c := range base32 {
		candidate := prefix + string(c)
		if candidate != hash {
			result = append(result, candidate)
		}
	}
	return result
}

type GeoIndex struct {
	mu      sync.RWMutex
	buckets map[string]map[string]struct{ Lat, Lng float64 } // hash → driverID → loc
}

func NewGeoIndex() *GeoIndex {
	return &GeoIndex{buckets: make(map[string]map[string]struct{ Lat, Lng float64 })}
}

func (g *GeoIndex) Add(driverID string, lat, lng float64, precision int) {
	h := encode(lat, lng, precision)
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.buckets[h] == nil {
		g.buckets[h] = make(map[string]struct{ Lat, Lng float64 })
	}
	g.buckets[h][driverID] = struct{ Lat, Lng float64 }{lat, lng}
}

func (g *GeoIndex) NearbyDrivers(lat, lng, radiusKm float64, precision int) []string {
	queryHash := encode(lat, lng, precision)
	cells := neighbors(queryHash)

	g.mu.RLock()
	defer g.mu.RUnlock()

	var found []string
	for _, cell := range cells {
		for id, loc := range g.buckets[cell] {
			dist := haversineGeo(lat, lng, loc.Lat, loc.Lng)
			if dist <= radiusKm {
				found = append(found, id)
			}
		}
	}
	return found
}

func haversineGeo(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func main() {
	idx := NewGeoIndex()
	drivers := []struct {
		id       string
		lat, lng float64
	}{
		{"D1", 37.7749, -122.4194},
		{"D2", 37.7751, -122.4200},
		{"D3", 37.7800, -122.4100}, // ~700m away
		{"D4", 37.8000, -122.4000}, // ~3km away
	}

	for _, d := range drivers {
		idx.Add(d.id, d.lat, d.lng, 6)
	}

	riderLat, riderLng := 37.7750, -122.4195
	nearby := idx.NearbyDrivers(riderLat, riderLng, 1.0, 6)
	fmt.Println("Drivers within 1km:", nearby)
}
```

**Production Notes:**
- Uber uses H3 (hexagonal hierarchical geospatial index) instead of geohash; H3 cells have more uniform area.
- Store geohash → driver list in Redis hash/set for distributed access; update on every location ping.
- Precision tradeoff: geohash length 6 ≈ 1.2km x 0.6km cells; length 7 ≈ 0.15km x 0.15km cells.
- Search neighboring cells to handle boundary effects (rider is at cell edge, driver is in adjacent cell).
- For very high driver density (Times Square on New Year's Eve), short-precision geohash cells can have thousands of entries; further filter by exact distance.

---

## Problem 22: Saga Pattern for Trip Booking

**Problem Statement:**
Implement a distributed saga for trip booking: reserve a driver, authorize payment, update availability — with compensating transactions on failure.

**Go Implementation:**

```go
package main

import (
	"errors"
	"fmt"
	"time"
)

type SagaStep struct {
	Name       string
	Execute    func() error
	Compensate func() error
}

type Saga struct {
	steps     []SagaStep
	completed []SagaStep
}

func NewSaga(steps ...SagaStep) *Saga {
	return &Saga{steps: steps}
}

func (s *Saga) Execute() error {
	for _, step := range s.steps {
		fmt.Printf("Executing: %s\n", step.Name)
		if err := step.Execute(); err != nil {
			fmt.Printf("Step %s failed: %v. Starting compensation...\n", step.Name, err)
			s.compensate()
			return fmt.Errorf("saga failed at %s: %w", step.Name, err)
		}
		s.completed = append(s.completed, step)
	}
	return nil
}

func (s *Saga) compensate() {
	for i := len(s.completed) - 1; i >= 0; i-- {
		step := s.completed[i]
		if step.Compensate != nil {
			fmt.Printf("Compensating: %s\n", step.Name)
			if err := step.Compensate(); err != nil {
				fmt.Printf("Compensation failed for %s: %v (requires manual intervention)\n", step.Name, err)
			}
		}
	}
}

func bookTrip(tripID, driverID, riderID string, amount float64) error {
	driverReserved := false
	paymentAuthed := false

	saga := NewSaga(
		SagaStep{
			Name: "ReserveDriver",
			Execute: func() error {
				fmt.Printf("Reserving driver %s for trip %s\n", driverID, tripID)
				driverReserved = true
				return nil // simulate success
			},
			Compensate: func() error {
				if driverReserved {
					fmt.Printf("Releasing driver %s\n", driverID)
				}
				return nil
			},
		},
		SagaStep{
			Name: "AuthorizePayment",
			Execute: func() error {
				fmt.Printf("Authorizing $%.2f for rider %s\n", amount, riderID)
				paymentAuthed = true
				return nil
			},
			Compensate: func() error {
				if paymentAuthed {
					fmt.Printf("Voiding payment authorization for rider %s\n", riderID)
				}
				return nil
			},
		},
		SagaStep{
			Name: "UpdateAvailability",
			Execute: func() error {
				// Simulate failure
				time.Sleep(10 * time.Millisecond)
				return errors.New("availability service timeout")
			},
			Compensate: nil, // availability update is idempotent, no compensation needed
		},
	)

	return saga.Execute()
}

func main() {
	err := bookTrip("trip-999", "driver-42", "rider-1", 15.50)
	if err != nil {
		fmt.Println("Booking failed:", err)
	} else {
		fmt.Println("Booking succeeded")
	}
}
```

**Production Notes:**
- Saga pattern replaces 2-phase commit (2PC) for distributed transactions; avoids distributed locks.
- Each step writes its state to a durable log (Kafka or DB) before executing; enables replay on crash.
- Choreography vs. orchestration: orchestration (as above) has a central coordinator; choreography has services react to events.
- Idempotent compensations: safe to run multiple times if the saga orchestrator crashes mid-compensation.
- Uber uses sagas for the trip booking flow: driver assignment, payment authorization, and mapping service updates.

---

## Problem 23: Real-Time Metrics Aggregator

**Problem Statement:**
Aggregate per-second metrics (request count, error rate, latency histogram) from multiple service instances in real-time.

**Go Implementation:**

```go
package main

import (
	"fmt"
	"math"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Histogram struct {
	mu      sync.Mutex
	buckets []float64 // upper bounds in ms
	counts  []int64
	total   int64
	sum     float64
}

func NewHistogram(buckets []float64) *Histogram {
	return &Histogram{
		buckets: buckets,
		counts:  make([]int64, len(buckets)+1),
	}
}

func (h *Histogram) Observe(valueMs float64) {
	h.mu.Lock()
	h.sum += valueMs
	h.mu.Unlock()
	atomic.AddInt64(&h.total, 1)
	for i, b := range h.buckets {
		if valueMs <= b {
			atomic.AddInt64(&h.counts[i], 1)
			return
		}
	}
	atomic.AddInt64(&h.counts[len(h.buckets)], 1) // overflow bucket
}

func (h *Histogram) Percentile(p float64) float64 {
	total := atomic.LoadInt64(&h.total)
	if total == 0 {
		return 0
	}
	target := int64(math.Ceil(p / 100 * float64(total)))
	var cumulative int64
	for i, b := range h.buckets {
		cumulative += atomic.LoadInt64(&h.counts[i])
		if cumulative >= target {
			return b
		}
	}
	return h.buckets[len(h.buckets)-1]
}

type ServiceMetrics struct {
	Requests int64
	Errors   int64
	Latency  *Histogram
}

func NewServiceMetrics() *ServiceMetrics {
	return &ServiceMetrics{
		Latency: NewHistogram([]float64{1, 5, 10, 25, 50, 100, 250, 500, 1000}),
	}
}

type MetricsAggregator struct {
	mu       sync.RWMutex
	services map[string]*ServiceMetrics
}

func NewMetricsAggregator() *MetricsAggregator {
	return &MetricsAggregator{services: make(map[string]*ServiceMetrics)}
}

func (a *MetricsAggregator) getOrCreate(service string) *ServiceMetrics {
	a.mu.RLock()
	m, ok := a.services[service]
	a.mu.RUnlock()
	if ok {
		return m
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if m, ok = a.services[service]; ok {
		return m
	}
	m = NewServiceMetrics()
	a.services[service] = m
	return m
}

func (a *MetricsAggregator) RecordRequest(service string, latencyMs float64, isError bool) {
	m := a.getOrCreate(service)
	atomic.AddInt64(&m.Requests, 1)
	if isError {
		atomic.AddInt64(&m.Errors, 1)
	}
	m.Latency.Observe(latencyMs)
}

func (a *MetricsAggregator) Report(service string) {
	a.mu.RLock()
	m, ok := a.services[service]
	a.mu.RUnlock()
	if !ok {
		fmt.Printf("No metrics for %s\n", service)
		return
	}
	reqs := atomic.LoadInt64(&m.Requests)
	errs := atomic.LoadInt64(&m.Errors)
	errorRate := 0.0
	if reqs > 0 {
		errorRate = float64(errs) / float64(reqs) * 100
	}
	fmt.Printf("Service: %s | Requests: %d | Error rate: %.1f%% | p50: %.0fms | p99: %.0fms\n",
		service, reqs, errorRate, m.Latency.Percentile(50), m.Latency.Percentile(99))
	_ = sort.Search // usage
}

func main() {
	agg := NewMetricsAggregator()

	var wg sync.WaitGroup
	services := []string{"dispatch", "payment", "maps"}
	latencies := []float64{15, 8, 120, 45, 200, 30, 90, 5, 300, 60}

	for _, svc := range services {
		for i, lat := range latencies {
			wg.Add(1)
			svc := svc
			lat := lat
			isErr := i%7 == 0
			go func() {
				defer wg.Done()
				agg.RecordRequest(svc, lat, isErr)
			}()
		}
	}
	wg.Wait()

	for _, svc := range services {
		agg.Report(svc)
	}
}
```

**Production Notes:**
- Export metrics in Prometheus format; scrape every 15 seconds.
- Use atomic operations for counters; avoid mutex contention for high-frequency increments.
- HDRHistogram or DDSketch for accurate quantile estimation across distributed instances without merging all raw samples.
- Alert thresholds: error rate >1% → page; p99 >500ms → alert; p99 >2s → page.
- Uber's M3 is a distributed time-series metrics platform built on top of Prometheus and Graphite patterns, written in Go.

---

## Problem 24: Graceful Shutdown with In-Flight Request Draining

**Problem Statement:**
Implement graceful shutdown for an Uber-style service: stop accepting new requests, wait for in-flight requests to complete, then exit cleanly.

**Go Implementation:**

```go
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type Server struct {
	inFlight int64
	mu       sync.RWMutex
	shutdown int32 // atomic bool
	done     chan struct{}
}

func NewServer() *Server {
	return &Server{done: make(chan struct{})}
}

func (s *Server) Handle(ctx context.Context, req string) error {
	// Check if shutting down
	if atomic.LoadInt32(&s.shutdown) == 1 {
		return fmt.Errorf("server shutting down, request rejected")
	}

	atomic.AddInt64(&s.inFlight, 1)
	defer atomic.AddInt64(&s.inFlight, -1)

	// Simulate request processing
	select {
	case <-time.After(100 * time.Millisecond):
		fmt.Printf("Processed: %s\n", req)
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Server) Shutdown(ctx context.Context) error {
	// Stop accepting new requests
	atomic.StoreInt32(&s.shutdown, 1)
	fmt.Println("Shutdown initiated: no longer accepting requests")

	// Wait for in-flight requests to drain
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if atomic.LoadInt64(&s.inFlight) == 0 {
			fmt.Println("All in-flight requests completed")
			close(s.done)
			return nil
		}
		select {
		case <-ticker.C:
			fmt.Printf("Waiting for %d in-flight requests...\n", atomic.LoadInt64(&s.inFlight))
		case <-ctx.Done():
			return fmt.Errorf("shutdown timed out with %d requests still in flight", atomic.LoadInt64(&s.inFlight))
		}
	}
}

func main() {
	srv := NewServer()

	// Handle OS signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	// Start some in-flight requests
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			srv.Handle(ctx, fmt.Sprintf("request-%d", id))
		}(i)
	}

	// Simulate shutdown after 50ms
	go func() {
		time.Sleep(50 * time.Millisecond)
		sigCh <- syscall.SIGTERM
	}()

	<-sigCh
	fmt.Println("Received shutdown signal")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		fmt.Println("Shutdown error:", err)
		os.Exit(1)
	}

	wg.Wait()
	fmt.Println("Server exited cleanly")
}
```

**Production Notes:**
- Kubernetes sends SIGTERM before SIGKILL (default grace period: 30s). Use this window for draining.
- Load balancers should stop routing traffic before SIGTERM; use readiness probe returning 503 to signal this.
- Drain order: (1) stop accepting new connections, (2) drain in-flight, (3) close DB connections, (4) flush metrics buffers, (5) exit.
- Uber services set shutdown grace period to 60s for dispatch (long-lived WebSocket connections need time to cleanly hand off).
- Log `inFlight` count during shutdown to Splunk; if stuck, enables debugging without a crash.

---

## Problem 25: Distributed Tracing Context Propagation

**Problem Statement:**
Implement trace context propagation across goroutines and simulated service calls. Track span tree for a complete trip booking flow.

**Go Implementation:**

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Simplified: generate random IDs without uuid dependency
func newID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

type Span struct {
	TraceID  string
	SpanID   string
	ParentID string
	Name     string
	Start    time.Time
	End      time.Time
	Tags     map[string]string
	mu       sync.Mutex
}

func (s *Span) Finish() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.End = time.Now()
	fmt.Printf("SPAN [%s] parent=%s duration=%v\n",
		s.Name, s.ParentID, s.End.Sub(s.Start))
}

type traceKey struct{}

func StartSpan(ctx context.Context, name string) (context.Context, *Span) {
	parent, _ := ctx.Value(traceKey{}).(*Span)

	span := &Span{
		SpanID: newID(),
		Name:   name,
		Start:  time.Now(),
		Tags:   make(map[string]string),
	}

	if parent != nil {
		span.TraceID = parent.TraceID
		span.ParentID = parent.SpanID
	} else {
		span.TraceID = newID()
		span.ParentID = "root"
	}

	return context.WithValue(ctx, traceKey{}, span), span
}

// Simulate service calls with trace propagation
func bookTripWithTracing(ctx context.Context) error {
	ctx, span := StartSpan(ctx, "BookTrip")
	defer span.Finish()

	var wg sync.WaitGroup
	var dispatchErr, paymentErr, mapsErr error

	wg.Add(3)
	go func() {
		defer wg.Done()
		_, s := StartSpan(ctx, "DispatchService.ReserveDriver")
		time.Sleep(30 * time.Millisecond)
		s.Tags["driver_id"] = "driver-42"
		s.Finish()
	}()
	go func() {
		defer wg.Done()
		_, s := StartSpan(ctx, "PaymentService.AuthorizePayment")
		time.Sleep(50 * time.Millisecond)
		s.Tags["amount"] = "$15.50"
		s.Finish()
	}()
	go func() {
		defer wg.Done()
		_, s := StartSpan(ctx, "MapsService.ComputeETA")
		time.Sleep(20 * time.Millisecond)
		s.Tags["eta_minutes"] = "8"
		s.Finish()
	}()

	wg.Wait()

	if dispatchErr != nil || paymentErr != nil || mapsErr != nil {
		return fmt.Errorf("booking failed")
	}

	_, confirmSpan := StartSpan(ctx, "NotificationService.SendConfirmation")
	time.Sleep(10 * time.Millisecond)
	confirmSpan.Finish()

	return nil
}

func main() {
	ctx := context.Background()
	_ = uuid.New // ensure import noted (in practice, use a real UUID library)

	fmt.Println("Starting trip booking with distributed tracing...")
	if err := bookTripWithTracing(ctx); err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Println("Trip booked successfully")
}
```

**Production Notes:**
- Uber uses Jaeger (open-sourced by Uber) for distributed tracing; OpenTelemetry is the emerging standard.
- Trace ID propagates via HTTP headers (X-B3-TraceId) or gRPC metadata between services.
- Sample rate: trace 1% of requests in production, 100% for errors and slow requests (tail-based sampling).
- Traces reveal the critical path: the parallel dispatch+payment+maps fan-out in the example above takes max(30, 50, 20) = 50ms, not 100ms sequential.
- Span tags and logs (key-value annotations) are searchable in Jaeger UI for debugging production incidents.

---

*© 2024 Gaurav Patil — GoForge Platform. All rights reserved.*
