> © 2025 Gaurav Patil — GoForge Platform. All rights reserved.

# Dynamic Programming in Go

---

## Why Dynamic Programming?

Dynamic Programming (DP) is the backbone of optimization interviews at every top tech company. It shows up in pricing engines, route planners, sequence aligners, and compiler optimizers. Understanding DP separates engineers who can reason about overlapping subproblems from those who reach for brute-force recursion and time out on large inputs.

## What is DP?

DP is an algorithmic strategy that solves complex problems by breaking them into overlapping subproblems, solving each once, and storing the results. It applies when a problem has:

1. **Optimal substructure** — the optimal solution of the whole is built from optimal solutions of its parts.
2. **Overlapping subproblems** — the same subproblems recur many times.

## Industry Context

| Domain | DP Application |
|---|---|
| E-commerce | Optimal pricing, knapsack-style inventory selection |
| Navigation | Shortest path with constraints (gas, tolls) |
| Bioinformatics | DNA sequence alignment (LCS / edit distance) |
| Compilers | Optimal expression parsing (interval DP) |
| Finance | Option pricing, portfolio optimization |
| NLP | Sequence-to-sequence models rely on DP decoding |

---

## DP in Go vs Python/Java

Go has no built-in memoization decorator (unlike Python's `@lru_cache`). You build it explicitly. This is actually a strength — you control the key type, capacity, and eviction.

### Memoization with `map[string]int`

```go
memo := make(map[string]int)
var dp func(i, j int) int
dp = func(i, j int) int {
    key := fmt.Sprintf("%d,%d", i, j)
    if v, ok := memo[key]; ok {
        return v
    }
    // ... compute result
    memo[key] = result
    return result
}
```

**Pro tip:** For two-integer keys, encode as a single int64 to avoid string allocation:

```go
key := int64(i)<<32 | int64(j)
memo := make(map[int64]int)
```

### Slice-Based Tabulation

```go
dp := make([]int, n+1)   // 1D
dp := make([][]int, m+1) // 2D — allocate each row separately
for i := range dp {
    dp[i] = make([]int, n+1)
}
```

### Go Closure-Based Memoization (reusable pattern)

```go
func memoize(f func(int) int) func(int) int {
    cache := make(map[int]int)
    return func(n int) int {
        if v, ok := cache[n]; ok {
            return v
        }
        v := f(n)
        cache[n] = v
        return v
    }
}
```

---

## The DP Framework (5 Steps)

1. **Define state clearly** — `dp[i]` means ___ for the first `i` elements.
2. **Write recurrence relation** — express `dp[i]` in terms of smaller subproblems.
3. **Identify base cases** — smallest subproblems with known answers.
4. **Choose top-down (memo) or bottom-up (tabulation)** — memo is easier to write; tabulation is cache-friendly.
5. **Space optimize** — if `dp[i]` only depends on `dp[i-1]`, use two variables instead of an array.

---

## 1D DP

---

### Q1: Climbing Stairs (Fibonacci) — Level 1

**Problem Statement**
You are climbing a staircase with `n` steps. Each time you can climb 1 or 2 steps. Return the number of distinct ways to reach the top.

**Constraints:** `1 <= n <= 45`

**DP State**
`dp[i]` = number of distinct ways to reach step `i`.

**Recurrence Relation**
```
dp[i] = dp[i-1] + dp[i-2]
```
You can arrive at step `i` from step `i-1` (one step) or from step `i-2` (two steps).

**Base Cases**
```
dp[1] = 1
dp[2] = 2
```

**Complete Go Solution**

```go
package main

import "fmt"

// Bottom-up tabulation — O(n) time, O(n) space
func climbStairs(n int) int {
    if n <= 2 {
        return n
    }
    dp := make([]int, n+1)
    dp[1] = 1
    dp[2] = 2
    for i := 3; i <= n; i++ {
        dp[i] = dp[i-1] + dp[i-2]
    }
    return dp[n]
}

func main() {
    fmt.Println(climbStairs(2))  // 2
    fmt.Println(climbStairs(5))  // 8
    fmt.Println(climbStairs(10)) // 89
}
```

**Space-Optimized Version — O(1) space**

```go
func climbStairsOpt(n int) int {
    if n <= 2 {
        return n
    }
    prev2, prev1 := 1, 2
    for i := 3; i <= n; i++ {
        prev2, prev1 = prev1, prev1+prev2
    }
    return prev1
}
```

**Complexity**
- Time: O(n)
- Space: O(1) optimized, O(n) tabulated

---

### Q2: House Robber — Level 2

**Problem Statement**
You are a robber planning to rob houses along a street. Each house has some amount of money. You cannot rob two adjacent houses (the alarm will trigger). Return the maximum amount you can rob.

**Constraints:** `1 <= nums.length <= 100`, `0 <= nums[i] <= 400`

**DP State**
`dp[i]` = maximum money robbed from the first `i` houses.

**Recurrence Relation**
```
dp[i] = max(dp[i-1], dp[i-2] + nums[i])
```
Either skip house `i` (take `dp[i-1]`), or rob it (take `dp[i-2] + nums[i]`).

**Base Cases**
```
dp[0] = nums[0]
dp[1] = max(nums[0], nums[1])
```

**Complete Go Solution**

```go
package main

import "fmt"

func rob(nums []int) int {
    n := len(nums)
    if n == 1 {
        return nums[0]
    }
    dp := make([]int, n)
    dp[0] = nums[0]
    dp[1] = max(nums[0], nums[1])
    for i := 2; i < n; i++ {
        dp[i] = max(dp[i-1], dp[i-2]+nums[i])
    }
    return dp[n-1]
}

func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}

func main() {
    fmt.Println(rob([]int{1, 2, 3, 1}))       // 4
    fmt.Println(rob([]int{2, 7, 9, 3, 1}))    // 12
    fmt.Println(rob([]int{2, 1, 1, 2}))        // 4
}
```

**Space-Optimized Version**

```go
func robOpt(nums []int) int {
    prev2, prev1 := 0, 0
    for _, v := range nums {
        prev2, prev1 = prev1, max(prev1, prev2+v)
    }
    return prev1
}
```

**Complexity**
- Time: O(n)
- Space: O(1) optimized

---

### Q3: House Robber II (Circular) — Level 3

**Problem Statement**
Same as House Robber, but houses are arranged in a circle — the first and last house are adjacent. Return the maximum amount you can rob.

**Constraints:** `1 <= nums.length <= 100`

**Key Insight**
Since houses 0 and n-1 are adjacent, we cannot rob both. Run `rob` (linear version) twice:
- Range `[0, n-2]` (exclude last)
- Range `[1, n-1]` (exclude first)

Return the maximum of both.

**Complete Go Solution**

```go
package main

import "fmt"

func robRange(nums []int, start, end int) int {
    prev2, prev1 := 0, 0
    for i := start; i <= end; i++ {
        prev2, prev1 = prev1, max(prev1, prev2+nums[i])
    }
    return prev1
}

func robII(nums []int) int {
    n := len(nums)
    if n == 1 {
        return nums[0]
    }
    if n == 2 {
        return max(nums[0], nums[1])
    }
    return max(robRange(nums, 0, n-2), robRange(nums, 1, n-1))
}

func main() {
    fmt.Println(robII([]int{2, 3, 2}))        // 3
    fmt.Println(robII([]int{1, 2, 3, 1}))     // 4
    fmt.Println(robII([]int{1, 2, 3}))         // 3
}
```

**Complexity**
- Time: O(n) — two linear passes
- Space: O(1)

---

### Q4: Coin Change — Level 3

**Problem Statement**
Given coins of different denominations and a total `amount`, return the fewest number of coins needed to make up that amount. Return -1 if it is not possible.

**Constraints:** `1 <= coins.length <= 12`, `1 <= coins[i] <= 2^31 - 1`, `0 <= amount <= 10^4`

**DP State**
`dp[i]` = minimum number of coins to make amount `i`.

**Recurrence Relation**
```
dp[i] = min over all coins c where c <= i: dp[i-c] + 1
```

**Base Cases**
```
dp[0] = 0
dp[i] = infinity for i > 0 (initially)
```

**Complete Go Solution**

```go
package main

import "fmt"

func coinChange(coins []int, amount int) int {
    const inf = 1<<31 - 1
    dp := make([]int, amount+1)
    for i := 1; i <= amount; i++ {
        dp[i] = inf
    }
    for i := 1; i <= amount; i++ {
        for _, c := range coins {
            if c <= i && dp[i-c] != inf {
                if dp[i-c]+1 < dp[i] {
                    dp[i] = dp[i-c] + 1
                }
            }
        }
    }
    if dp[amount] == inf {
        return -1
    }
    return dp[amount]
}

func main() {
    fmt.Println(coinChange([]int{1, 5, 6, 9}, 11)) // 2 (5+6)
    fmt.Println(coinChange([]int{2}, 3))             // -1
    fmt.Println(coinChange([]int{1, 2, 5}, 11))      // 3 (5+5+1)
}
```

**Complexity**
- Time: O(amount * len(coins))
- Space: O(amount)

---

### Q5: Coin Change II (Combinations) — Level 3

**Problem Statement**
Return the number of combinations that make up the given `amount` using the coins. Each coin may be used unlimited times. Order does not matter (combinations, not permutations).

**Constraints:** `1 <= coins.length <= 300`, `0 <= amount <= 5000`

**Key Difference from Coin Change I**
We count combinations (2+3 is the same as 3+2), so we iterate coins in the outer loop.

**DP State**
`dp[i]` = number of ways to make amount `i`.

**Recurrence Relation**
```
dp[i] += dp[i - coin]  for each coin
```

**Complete Go Solution**

```go
package main

import "fmt"

func change(amount int, coins []int) int {
    dp := make([]int, amount+1)
    dp[0] = 1 // one way to make 0: use no coins
    for _, coin := range coins {
        for i := coin; i <= amount; i++ {
            dp[i] += dp[i-coin]
        }
    }
    return dp[amount]
}

func main() {
    fmt.Println(change(5, []int{1, 2, 5}))   // 4
    fmt.Println(change(3, []int{2}))           // 0
    fmt.Println(change(10, []int{10}))         // 1
}
```

**Why outer=coins, inner=amount?**
Iterating coins in the outer loop ensures each combination is counted once. Swapping produces permutations (each ordering counted separately).

**Complexity**
- Time: O(amount * len(coins))
- Space: O(amount)

---

### Q6: Jump Game — Level 2

**Problem Statement**
Given an array `nums` where `nums[i]` is the maximum jump length from position `i`, return `true` if you can reach the last index.

**Constraints:** `1 <= nums.length <= 10^4`, `0 <= nums[i] <= 10^5`

**Greedy / DP Approach**
Track the furthest index reachable. If we ever reach a position beyond our current max-reach, we are stuck.

**Complete Go Solution**

```go
package main

import "fmt"

// Greedy (O(n) time, O(1) space) — better than DP table here
func canJump(nums []int) bool {
    maxReach := 0
    for i, v := range nums {
        if i > maxReach {
            return false
        }
        if i+v > maxReach {
            maxReach = i + v
        }
    }
    return true
}

// DP version for comparison — O(n^2) time, O(n) space
func canJumpDP(nums []int) bool {
    n := len(nums)
    dp := make([]bool, n)
    dp[0] = true
    for i := 1; i < n; i++ {
        for j := 0; j < i; j++ {
            if dp[j] && j+nums[j] >= i {
                dp[i] = true
                break
            }
        }
    }
    return dp[n-1]
}

func main() {
    fmt.Println(canJump([]int{2, 3, 1, 1, 4})) // true
    fmt.Println(canJump([]int{3, 2, 1, 0, 4})) // false
}
```

**Complexity**
- Time: O(n) greedy
- Space: O(1)

---

### Q7: Jump Game II (Minimum Jumps) — Level 3

**Problem Statement**
Given `nums` where `nums[i]` is max jump from position `i`, return the minimum number of jumps to reach the last index. It is guaranteed you can reach the last index.

**DP State**
`dp[i]` = minimum jumps to reach index `i`.

**Recurrence Relation**
```
dp[i] = min over j < i where j + nums[j] >= i: dp[j] + 1
```

**Complete Go Solution**

```go
package main

import "fmt"

// Greedy BFS-style — O(n) time, O(1) space
func jump(nums []int) int {
    jumps, curEnd, farthest := 0, 0, 0
    for i := 0; i < len(nums)-1; i++ {
        if i+nums[i] > farthest {
            farthest = i + nums[i]
        }
        if i == curEnd {
            jumps++
            curEnd = farthest
        }
    }
    return jumps
}

// DP version — O(n^2) time, O(n) space
func jumpDP(nums []int) int {
    n := len(nums)
    dp := make([]int, n)
    for i := range dp {
        dp[i] = 1<<31 - 1
    }
    dp[0] = 0
    for i := 1; i < n; i++ {
        for j := 0; j < i; j++ {
            if j+nums[j] >= i && dp[j]+1 < dp[i] {
                dp[i] = dp[j] + 1
            }
        }
    }
    return dp[n-1]
}

func main() {
    fmt.Println(jump([]int{2, 3, 1, 1, 4})) // 2
    fmt.Println(jump([]int{2, 3, 0, 1, 4})) // 2
}
```

**Complexity**
- Time: O(n) greedy
- Space: O(1)

---

### Q8: Decode Ways — Level 3

**Problem Statement**
A message encoded as digits (A=1, B=2, ..., Z=26). Given a string `s` of digits, return the number of ways to decode it.

**Constraints:** `1 <= s.length <= 100`, `s[i]` is a digit.

**DP State**
`dp[i]` = number of ways to decode the first `i` characters of `s`.

**Recurrence Relation**
```
// single digit decode (if s[i-1] != '0')
dp[i] += dp[i-1]

// two digit decode (if "10" <= s[i-2..i-1] <= "26")
dp[i] += dp[i-2]
```

**Base Cases**
```
dp[0] = 1  // empty string: one way (do nothing)
dp[1] = 1 if s[0] != '0', else 0
```

**Complete Go Solution**

```go
package main

import "fmt"

func numDecodings(s string) int {
    n := len(s)
    dp := make([]int, n+1)
    dp[0] = 1
    if s[0] != '0' {
        dp[1] = 1
    }
    for i := 2; i <= n; i++ {
        // single digit
        if s[i-1] != '0' {
            dp[i] += dp[i-1]
        }
        // two digits
        twoDigit := (int(s[i-2]-'0'))*10 + int(s[i-1]-'0')
        if twoDigit >= 10 && twoDigit <= 26 {
            dp[i] += dp[i-2]
        }
    }
    return dp[n]
}

func main() {
    fmt.Println(numDecodings("12"))     // 2  ("AB" or "L")
    fmt.Println(numDecodings("226"))    // 3  ("BZ", "VF", "BBF")
    fmt.Println(numDecodings("06"))     // 0  (leading zero invalid)
    fmt.Println(numDecodings("11106"))  // 2
}
```

**Space-Optimized Version**

```go
func numDecodingsOpt(s string) int {
    prev2, prev1 := 1, 0
    if s[0] != '0' {
        prev1 = 1
    }
    for i := 2; i <= len(s); i++ {
        cur := 0
        if s[i-1] != '0' {
            cur += prev1
        }
        two := (int(s[i-2]-'0'))*10 + int(s[i-1]-'0')
        if two >= 10 && two <= 26 {
            cur += prev2
        }
        prev2, prev1 = prev1, cur
    }
    return prev1
}
```

**Complexity**
- Time: O(n)
- Space: O(1) optimized

---

## 2D DP

---

### Q9: Longest Common Subsequence — Level 3

**Problem Statement**
Given two strings `text1` and `text2`, return the length of their longest common subsequence. A subsequence need not be contiguous.

**Constraints:** `1 <= text1.length, text2.length <= 1000`

**DP State**
`dp[i][j]` = LCS length of `text1[0..i-1]` and `text2[0..j-1]`.

**Recurrence Relation**
```
if text1[i-1] == text2[j-1]:
    dp[i][j] = dp[i-1][j-1] + 1
else:
    dp[i][j] = max(dp[i-1][j], dp[i][j-1])
```

**Complete Go Solution**

```go
package main

import "fmt"

func longestCommonSubsequence(text1, text2 string) int {
    m, n := len(text1), len(text2)
    dp := make([][]int, m+1)
    for i := range dp {
        dp[i] = make([]int, n+1)
    }
    for i := 1; i <= m; i++ {
        for j := 1; j <= n; j++ {
            if text1[i-1] == text2[j-1] {
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

func main() {
    fmt.Println(longestCommonSubsequence("abcde", "ace"))   // 3
    fmt.Println(longestCommonSubsequence("abc", "abc"))     // 3
    fmt.Println(longestCommonSubsequence("abc", "def"))     // 0
}
```

**Space-Optimized Version — O(n) space**

```go
func lcsOpt(text1, text2 string) int {
    m, n := len(text1), len(text2)
    prev := make([]int, n+1)
    for i := 1; i <= m; i++ {
        curr := make([]int, n+1)
        for j := 1; j <= n; j++ {
            if text1[i-1] == text2[j-1] {
                curr[j] = prev[j-1] + 1
            } else if prev[j] > curr[j-1] {
                curr[j] = prev[j]
            } else {
                curr[j] = curr[j-1]
            }
        }
        prev = curr
    }
    return prev[n]
}
```

**Complexity**
- Time: O(m * n)
- Space: O(n) optimized

---

### Q10: Edit Distance — Level 4

**Problem Statement**
Given two strings `word1` and `word2`, return the minimum number of operations (insert, delete, replace) needed to convert `word1` into `word2`.

**Constraints:** `0 <= word1.length, word2.length <= 500`

**DP State**
`dp[i][j]` = minimum operations to convert `word1[0..i-1]` to `word2[0..j-1]`.

**Recurrence Relation**
```
if word1[i-1] == word2[j-1]:
    dp[i][j] = dp[i-1][j-1]           // no operation needed
else:
    dp[i][j] = 1 + min(
        dp[i-1][j],    // delete from word1
        dp[i][j-1],    // insert into word1
        dp[i-1][j-1]   // replace in word1
    )
```

**Base Cases**
```
dp[i][0] = i  // delete all chars of word1
dp[0][j] = j  // insert all chars of word2
```

**Complete Go Solution**

```go
package main

import "fmt"

func minDistance(word1, word2 string) int {
    m, n := len(word1), len(word2)
    dp := make([][]int, m+1)
    for i := range dp {
        dp[i] = make([]int, n+1)
        dp[i][0] = i
    }
    for j := 0; j <= n; j++ {
        dp[0][j] = j
    }
    for i := 1; i <= m; i++ {
        for j := 1; j <= n; j++ {
            if word1[i-1] == word2[j-1] {
                dp[i][j] = dp[i-1][j-1]
            } else {
                dp[i][j] = 1 + min3(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
            }
        }
    }
    return dp[m][n]
}

func min3(a, b, c int) int {
    if a < b {
        if a < c {
            return a
        }
        return c
    }
    if b < c {
        return b
    }
    return c
}

func main() {
    fmt.Println(minDistance("horse", "ros"))     // 3
    fmt.Println(minDistance("intention", "execution")) // 5
    fmt.Println(minDistance("", "abc"))           // 3
}
```

**Complexity**
- Time: O(m * n)
- Space: O(m * n), reducible to O(min(m,n)) with rolling array

---

### Q11: Unique Paths — Level 2

**Problem Statement**
A robot starts at the top-left of an `m x n` grid and wants to reach the bottom-right. It can only move right or down. Return the number of unique paths.

**Constraints:** `1 <= m, n <= 100`

**DP State**
`dp[i][j]` = number of unique paths to reach cell `(i, j)`.

**Recurrence Relation**
```
dp[i][j] = dp[i-1][j] + dp[i][j-1]
```

**Complete Go Solution**

```go
package main

import "fmt"

func uniquePaths(m, n int) int {
    dp := make([][]int, m)
    for i := range dp {
        dp[i] = make([]int, n)
        dp[i][0] = 1
    }
    for j := 0; j < n; j++ {
        dp[0][j] = 1
    }
    for i := 1; i < m; i++ {
        for j := 1; j < n; j++ {
            dp[i][j] = dp[i-1][j] + dp[i][j-1]
        }
    }
    return dp[m-1][n-1]
}

func main() {
    fmt.Println(uniquePaths(3, 7)) // 28
    fmt.Println(uniquePaths(3, 2)) // 3
}
```

**Space-Optimized — O(n) space**

```go
func uniquePathsOpt(m, n int) int {
    dp := make([]int, n)
    for j := range dp {
        dp[j] = 1
    }
    for i := 1; i < m; i++ {
        for j := 1; j < n; j++ {
            dp[j] += dp[j-1]
        }
    }
    return dp[n-1]
}
```

**Complexity**
- Time: O(m * n)
- Space: O(n) optimized

---

### Q12: Minimum Path Sum — Level 3

**Problem Statement**
Given an `m x n` grid of non-negative integers, find a path from top-left to bottom-right that minimizes the sum of all numbers along the path. You may only move right or down.

**DP State**
`dp[i][j]` = minimum sum to reach cell `(i, j)`.

**Recurrence Relation**
```
dp[i][j] = grid[i][j] + min(dp[i-1][j], dp[i][j-1])
```

**Complete Go Solution**

```go
package main

import "fmt"

func minPathSum(grid [][]int) int {
    m, n := len(grid), len(grid[0])
    dp := make([][]int, m)
    for i := range dp {
        dp[i] = make([]int, n)
    }
    dp[0][0] = grid[0][0]
    for i := 1; i < m; i++ {
        dp[i][0] = dp[i-1][0] + grid[i][0]
    }
    for j := 1; j < n; j++ {
        dp[0][j] = dp[0][j-1] + grid[0][j]
    }
    for i := 1; i < m; i++ {
        for j := 1; j < n; j++ {
            from := dp[i-1][j]
            if dp[i][j-1] < from {
                from = dp[i][j-1]
            }
            dp[i][j] = grid[i][j] + from
        }
    }
    return dp[m-1][n-1]
}

func main() {
    grid := [][]int{{1, 3, 1}, {1, 5, 1}, {4, 2, 1}}
    fmt.Println(minPathSum(grid)) // 7  (1→3→1→1→1)
}
```

**Complexity**
- Time: O(m * n)
- Space: O(m * n), reducible to O(n)

---

### Q13: Maximal Square — Level 4

**Problem Statement**
Given an `m x n` binary matrix of `'0'`s and `'1'`s, find the largest square containing only `'1'`s and return its area.

**DP State**
`dp[i][j]` = side length of the largest square whose bottom-right corner is at `(i, j)`.

**Recurrence Relation**
```
if matrix[i][j] == '1':
    dp[i][j] = min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1
else:
    dp[i][j] = 0
```

**Intuition:** The square ending at `(i,j)` is limited by the smallest square among the three neighbors above, left, and diagonal.

**Complete Go Solution**

```go
package main

import "fmt"

func maximalSquare(matrix [][]byte) int {
    if len(matrix) == 0 {
        return 0
    }
    m, n := len(matrix), len(matrix[0])
    dp := make([][]int, m+1)
    for i := range dp {
        dp[i] = make([]int, n+1)
    }
    maxSide := 0
    for i := 1; i <= m; i++ {
        for j := 1; j <= n; j++ {
            if matrix[i-1][j-1] == '1' {
                mn := dp[i-1][j]
                if dp[i][j-1] < mn {
                    mn = dp[i][j-1]
                }
                if dp[i-1][j-1] < mn {
                    mn = dp[i-1][j-1]
                }
                dp[i][j] = mn + 1
                if dp[i][j] > maxSide {
                    maxSide = dp[i][j]
                }
            }
        }
    }
    return maxSide * maxSide
}

func main() {
    matrix := [][]byte{
        {'1', '0', '1', '0', '0'},
        {'1', '0', '1', '1', '1'},
        {'1', '1', '1', '1', '1'},
        {'1', '0', '0', '1', '0'},
    }
    fmt.Println(maximalSquare(matrix)) // 4
}
```

**Complexity**
- Time: O(m * n)
- Space: O(m * n), reducible to O(n)

---

### Q14: Regular Expression Matching — Level 5

**Problem Statement**
Implement regular expression matching with `.` (matches any single character) and `*` (matches zero or more of the preceding element). Return `true` if `s` matches `p`.

**Constraints:** `1 <= s.length <= 20`, `1 <= p.length <= 30`

**DP State**
`dp[i][j]` = true if `s[0..i-1]` matches `p[0..j-1]`.

**Recurrence Relation**
```
// p[j-1] is '*'
dp[i][j] = dp[i][j-2]                           // zero occurrences
         | (dp[i-1][j] && match(s[i-1], p[j-2])) // one or more occurrences

// p[j-1] is not '*'
dp[i][j] = dp[i-1][j-1] && match(s[i-1], p[j-1])

match(sc, pc) = sc == pc || pc == '.'
```

**Complete Go Solution**

```go
package main

import "fmt"

func isMatch(s, p string) bool {
    m, n := len(s), len(p)
    dp := make([][]bool, m+1)
    for i := range dp {
        dp[i] = make([]bool, n+1)
    }
    dp[0][0] = true
    // handle patterns like a*, a*b*, a*b*c* matching empty string
    for j := 2; j <= n; j++ {
        if p[j-1] == '*' {
            dp[0][j] = dp[0][j-2]
        }
    }
    for i := 1; i <= m; i++ {
        for j := 1; j <= n; j++ {
            if p[j-1] == '*' {
                dp[i][j] = dp[i][j-2] // zero occurrences
                if j >= 2 && (p[j-2] == '.' || p[j-2] == s[i-1]) {
                    dp[i][j] = dp[i][j] || dp[i-1][j]
                }
            } else if p[j-1] == '.' || p[j-1] == s[i-1] {
                dp[i][j] = dp[i-1][j-1]
            }
        }
    }
    return dp[m][n]
}

func main() {
    fmt.Println(isMatch("aa", "a"))    // false
    fmt.Println(isMatch("aa", "a*"))   // true
    fmt.Println(isMatch("ab", ".*"))   // true
    fmt.Println(isMatch("aab", "c*a*b")) // true
}
```

**Complexity**
- Time: O(m * n)
- Space: O(m * n)

---

## Interval DP

Interval DP problems define state over intervals `[i, j]` and combine results from sub-intervals. The standard fill order is by increasing interval length.

---

### Q15: Burst Balloons — Level 5

**Problem Statement**
You have `n` balloons labeled with numbers `nums[0..n-1]`. Bursting balloon `i` earns `nums[i-1] * nums[i] * nums[i+1]` coins (treat out-of-bounds as 1). Return maximum coins from bursting all balloons.

**Constraints:** `1 <= n <= 300`, `0 <= nums[i] <= 100`

**Key Insight**
Think of the **last** balloon burst in interval `[i, j]`, not the first. If `k` is the last burst, it contributes `nums[i-1] * nums[k] * nums[j+1]`.

**DP State**
`dp[i][j]` = maximum coins from bursting all balloons in `[i, j]`, where boundaries `i-1` and `j+1` are intact.

**Recurrence Relation**
```
dp[i][j] = max over k in [i..j]:
    nums[i-1] * nums[k] * nums[j+1] + dp[i][k-1] + dp[k+1][j]
```

**Complete Go Solution**

```go
package main

import "fmt"

func maxCoins(nums []int) int {
    // pad with 1 on both sides
    n := len(nums)
    arr := make([]int, n+2)
    arr[0], arr[n+1] = 1, 1
    copy(arr[1:], nums)
    n += 2

    dp := make([][]int, n)
    for i := range dp {
        dp[i] = make([]int, n)
    }

    // fill by increasing interval length
    for length := 1; length <= n-2; length++ {
        for i := 1; i <= n-2-length+1; i++ {
            j := i + length - 1
            for k := i; k <= j; k++ {
                coins := arr[i-1]*arr[k]*arr[j+1] + dp[i][k-1] + dp[k+1][j]
                if coins > dp[i][j] {
                    dp[i][j] = coins
                }
            }
        }
    }
    return dp[1][n-2]
}

func main() {
    fmt.Println(maxCoins([]int{3, 1, 5, 8})) // 167
    fmt.Println(maxCoins([]int{1, 5}))        // 10
}
```

**Complexity**
- Time: O(n^3)
- Space: O(n^2)

---

### Q16: Minimum Cost to Cut a Stick — Level 4

**Problem Statement**
You have a wooden stick of length `n`. Given an array `cuts` of positions where you can make cuts, each cut costs the current length of the stick being cut. Return the minimum total cost to make all cuts.

**Constraints:** `2 <= n <= 10^6`, `1 <= cuts.length <= min(n-1, 100)`

**Key Insight**
Add 0 and n as sentinel positions. Sort cuts. `dp[i][j]` = min cost to make all cuts between `cuts[i]` and `cuts[j]`.

**DP State**
`dp[i][j]` = minimum cost to make all cuts in the open interval `(cuts[i], cuts[j])`.

**Recurrence Relation**
```
dp[i][j] = min over k in (i..j):
    (cuts[j] - cuts[i]) + dp[i][k] + dp[k][j]
```

**Complete Go Solution**

```go
package main

import (
    "fmt"
    "sort"
)

func minCost(n int, cuts []int) int {
    cuts = append([]int{0}, cuts...)
    cuts = append(cuts, n)
    sort.Ints(cuts)
    m := len(cuts)

    dp := make([][]int, m)
    for i := range dp {
        dp[i] = make([]int, m)
    }

    for length := 2; length < m; length++ {
        for i := 0; i+length < m; i++ {
            j := i + length
            dp[i][j] = 1<<31 - 1
            for k := i + 1; k < j; k++ {
                cost := cuts[j] - cuts[i] + dp[i][k] + dp[k][j]
                if cost < dp[i][j] {
                    dp[i][j] = cost
                }
            }
        }
    }
    return dp[0][m-1]
}

func main() {
    fmt.Println(minCost(7, []int{1, 3, 4, 5})) // 16
    fmt.Println(minCost(9, []int{5, 6, 1, 4, 2})) // 22
}
```

**Complexity**
- Time: O(m^3) where m = len(cuts) + 2
- Space: O(m^2)

---

### Q17: Strange Printer — Level 5

**Problem Statement**
A printer can print a sequence of the same character at once and can start a new sequence each turn. Given a string `s`, return the minimum number of turns to print `s`.

**Key Insight**
If `s[i] == s[j]`, the turn used to print `s[i]` can be extended to cover `s[j]` for free.

**DP State**
`dp[i][j]` = minimum turns to print `s[i..j]`.

**Recurrence Relation**
```
dp[i][j] = dp[i][j-1] + 1   (baseline: one new turn for s[j])
for k in [i, j-1] where s[k] == s[j]:
    dp[i][j] = min(dp[i][j], dp[i][k] + dp[k+1][j-1])
```

**Complete Go Solution**

```go
package main

import "fmt"

func strangePrinter(s string) int {
    n := len(s)
    dp := make([][]int, n)
    for i := range dp {
        dp[i] = make([]int, n)
    }

    for i := n - 1; i >= 0; i-- {
        dp[i][i] = 1
        for j := i + 1; j < n; j++ {
            dp[i][j] = dp[i][j-1] + 1
            for k := i; k < j; k++ {
                if s[k] == s[j] {
                    val := dp[k+1][j-1]
                    if k+1 > j-1 {
                        val = 0
                    }
                    candidate := dp[i][k] + val
                    if candidate < dp[i][j] {
                        dp[i][j] = candidate
                    }
                }
            }
        }
    }
    return dp[0][n-1]
}

func main() {
    fmt.Println(strangePrinter("aaabbb")) // 2
    fmt.Println(strangePrinter("aba"))    // 2
    fmt.Println(strangePrinter("leetcode")) // 6
}
```

**Complexity**
- Time: O(n^3)
- Space: O(n^2)

---

## Tree DP

Tree DP problems define state at each node and combine results from children. Post-order traversal (children before parent) is the natural fill order.

---

### Q18: House Robber III (Tree) — Level 4

**Problem Statement**
Houses are arranged as a binary tree. You cannot rob two directly connected houses. Return the maximum amount you can rob.

**DP State**
For each node, return a pair: `(rob, skip)` where `rob` = max money if this node is robbed, `skip` = max money if this node is not robbed.

**Recurrence Relation**
```
rob  = node.Val + left.skip + right.skip
skip = max(left.rob, left.skip) + max(right.rob, right.skip)
```

**Complete Go Solution**

```go
package main

import "fmt"

type TreeNode struct {
    Val   int
    Left  *TreeNode
    Right *TreeNode
}

func robTree(root *TreeNode) int {
    rob, skip := dfs(root)
    if rob > skip {
        return rob
    }
    return skip
}

// returns (robThis, skipThis)
func dfs(node *TreeNode) (int, int) {
    if node == nil {
        return 0, 0
    }
    lRob, lSkip := dfs(node.Left)
    rRob, rSkip := dfs(node.Right)

    robThis := node.Val + lSkip + rSkip
    skipThis := maxOf(lRob, lSkip) + maxOf(rRob, rSkip)
    return robThis, skipThis
}

func maxOf(a, b int) int {
    if a > b {
        return a
    }
    return b
}

func main() {
    //      3
    //     / \
    //    2   3
    //     \   \
    //      3   1
    root := &TreeNode{3,
        &TreeNode{2, nil, &TreeNode{3, nil, nil}},
        &TreeNode{3, nil, &TreeNode{1, nil, nil}},
    }
    fmt.Println(robTree(root)) // 7
}
```

**Complexity**
- Time: O(n) — visit each node once
- Space: O(h) call stack, h = tree height

---

### Q19: Diameter of Binary Tree via DP — Level 3

**Problem Statement**
Return the length of the diameter of a binary tree. The diameter is the longest path between any two nodes (path may not pass through the root).

**DP State**
For each node, `depth(node)` = length of the longest path going down from that node.

**Key Insight**
The diameter through a node = `depth(left) + depth(right)`. Track the global maximum.

**Complete Go Solution**

```go
package main

import "fmt"

func diameterOfBinaryTree(root *TreeNode) int {
    maxDia := 0
    var depth func(*TreeNode) int
    depth = func(node *TreeNode) int {
        if node == nil {
            return 0
        }
        l := depth(node.Left)
        r := depth(node.Right)
        if l+r > maxDia {
            maxDia = l + r
        }
        if l > r {
            return l + 1
        }
        return r + 1
    }
    depth(root)
    return maxDia
}

func main() {
    //     1
    //    / \
    //   2   3
    //  / \
    // 4   5
    root := &TreeNode{1,
        &TreeNode{2, &TreeNode{4, nil, nil}, &TreeNode{5, nil, nil}},
        &TreeNode{3, nil, nil},
    }
    fmt.Println(diameterOfBinaryTree(root)) // 3
}
```

**Complexity**
- Time: O(n)
- Space: O(h)

---

### Q20: Maximum Path Sum in Tree — Level 4

**Problem Statement**
Given a binary tree, find the maximum path sum. A path is any sequence of nodes from any node to any node without revisiting. Nodes may have negative values.

**DP State**
For each node, `gain(node)` = maximum path sum going downward through that node (or 0 if negative).

**Key Insight**
The best path through a node = `node.Val + gain(left) + gain(right)`. Update global max, but return `node.Val + max(gain(left), gain(right))` (can only continue in one direction up the tree).

**Complete Go Solution**

```go
package main

import "fmt"

func maxPathSum(root *TreeNode) int {
    best := -1 << 62
    var gain func(*TreeNode) int
    gain = func(node *TreeNode) int {
        if node == nil {
            return 0
        }
        l := gain(node.Left)
        if l < 0 {
            l = 0
        }
        r := gain(node.Right)
        if r < 0 {
            r = 0
        }
        pathThrough := node.Val + l + r
        if pathThrough > best {
            best = pathThrough
        }
        if l > r {
            return node.Val + l
        }
        return node.Val + r
    }
    gain(root)
    return best
}

func main() {
    //   -10
    //   /  \
    //  9   20
    //     /  \
    //    15   7
    root := &TreeNode{-10,
        &TreeNode{9, nil, nil},
        &TreeNode{20, &TreeNode{15, nil, nil}, &TreeNode{7, nil, nil}},
    }
    fmt.Println(maxPathSum(root)) // 42  (15 + 20 + 7)
}
```

**Complexity**
- Time: O(n)
- Space: O(h)

---

## Partition DP

---

### Q21: Partition Equal Subset Sum (0/1 Knapsack) — Level 4

**Problem Statement**
Given an integer array `nums`, return `true` if you can partition it into two subsets with equal sum.

**Key Insight**
Find a subset with sum = `total / 2`. This is the classic 0/1 knapsack: each number is either included or not.

**DP State**
`dp[s]` = true if a subset with sum `s` is achievable.

**Recurrence Relation**
```
for each num in nums (iterate backwards to avoid reuse):
    dp[s] = dp[s] || dp[s - num]
```

**Complete Go Solution**

```go
package main

import "fmt"

func canPartition(nums []int) bool {
    total := 0
    for _, v := range nums {
        total += v
    }
    if total%2 != 0 {
        return false
    }
    target := total / 2
    dp := make([]bool, target+1)
    dp[0] = true
    for _, num := range nums {
        // iterate backwards — critical for 0/1 knapsack (no reuse)
        for s := target; s >= num; s-- {
            dp[s] = dp[s] || dp[s-num]
        }
    }
    return dp[target]
}

func main() {
    fmt.Println(canPartition([]int{1, 5, 11, 5})) // true  ([1,5,5] and [11])
    fmt.Println(canPartition([]int{1, 2, 3, 5}))  // false
    fmt.Println(canPartition([]int{3, 3, 3, 4, 5})) // true
}
```

**Why iterate backwards?**
Forward iteration allows a number to be used multiple times (unbounded knapsack). Backward prevents reuse.

**Complexity**
- Time: O(n * target)
- Space: O(target)

---

### Q22: Target Sum — Level 3

**Problem Statement**
Given an array `nums` and a target, assign `+` or `-` to each number. Return the number of ways to achieve the target.

**Constraints:** `1 <= nums.length <= 20`, `0 <= nums[i] <= 1000`

**Key Insight (Math reduction)**
Let `P` = sum of positive group, `N` = sum of negative group.
`P - N = target`, `P + N = total` → `P = (total + target) / 2`.
Count subsets with sum = `P` — this is an unbounded-count knapsack.

**Complete Go Solution**

```go
package main

import "fmt"

func findTargetSumWays(nums []int, target int) int {
    total := 0
    for _, v := range nums {
        total += v
    }
    if (total+target)%2 != 0 || total+target < 0 {
        return 0
    }
    goal := (total + target) / 2
    dp := make([]int, goal+1)
    dp[0] = 1
    for _, num := range nums {
        for s := goal; s >= num; s-- {
            dp[s] += dp[s-num]
        }
    }
    return dp[goal]
}

func main() {
    fmt.Println(findTargetSumWays([]int{1, 1, 1, 1, 1}, 3)) // 5
    fmt.Println(findTargetSumWays([]int{1}, 1))              // 1
    fmt.Println(findTargetSumWays([]int{1, 0}, 1))           // 2
}
```

**Complexity**
- Time: O(n * goal)
- Space: O(goal)

---

### Q23: Ones and Zeroes (Multi-dimensional Knapsack) — Level 4

**Problem Statement**
Given an array of binary strings `strs` and integers `m` (max 0s) and `n` (max 1s), return the size of the largest subset of `strs` such that there are at most `m` 0s and `n` 1s.

**DP State**
`dp[i][j]` = max strings in subset using at most `i` zeros and `j` ones.

**Recurrence Relation**
```
for each string with zeros0 zeros and ones1 ones:
    for i from m downto zeros0:
        for j from n downto ones1:
            dp[i][j] = max(dp[i][j], dp[i-zeros0][j-ones1] + 1)
```

**Complete Go Solution**

```go
package main

import (
    "fmt"
    "strings"
)

func findMaxForm(strs []string, m, n int) int {
    dp := make([][]int, m+1)
    for i := range dp {
        dp[i] = make([]int, n+1)
    }
    for _, s := range strs {
        zeros := strings.Count(s, "0")
        ones := strings.Count(s, "1")
        for i := m; i >= zeros; i-- {
            for j := n; j >= ones; j-- {
                if dp[i-zeros][j-ones]+1 > dp[i][j] {
                    dp[i][j] = dp[i-zeros][j-ones] + 1
                }
            }
        }
    }
    return dp[m][n]
}

func main() {
    fmt.Println(findMaxForm([]string{"10","0001","111001","1","0"}, 5, 3)) // 4
    fmt.Println(findMaxForm([]string{"10","0","1"}, 1, 1))                 // 2
}
```

**Complexity**
- Time: O(len(strs) * m * n)
- Space: O(m * n)

---

## Advanced

---

### Q24: Longest Increasing Subsequence (LIS with Binary Search) — Level 4

**Problem Statement**
Given an integer array `nums`, return the length of the longest strictly increasing subsequence.

**Constraints:** `1 <= nums.length <= 2500`

**O(n log n) Approach — Patience Sorting**
Maintain a list `tails` where `tails[i]` is the smallest tail element of all increasing subsequences of length `i+1`.

**Recurrence Intuition**
- If `nums[i] > tails.last()`, extend by appending.
- Otherwise, binary search for the first tail `>= nums[i]` and replace it (maintaining the invariant for future better subsequences).

**Complete Go Solution**

```go
package main

import (
    "fmt"
    "sort"
)

// O(n^2) DP for reference
func lisDP(nums []int) int {
    n := len(nums)
    dp := make([]int, n)
    for i := range dp {
        dp[i] = 1
    }
    best := 1
    for i := 1; i < n; i++ {
        for j := 0; j < i; j++ {
            if nums[j] < nums[i] && dp[j]+1 > dp[i] {
                dp[i] = dp[j] + 1
            }
        }
        if dp[i] > best {
            best = dp[i]
        }
    }
    return best
}

// O(n log n) patience sorting
func lengthOfLIS(nums []int) int {
    tails := []int{}
    for _, num := range nums {
        // binary search: first index in tails >= num
        pos := sort.SearchInts(tails, num)
        if pos == len(tails) {
            tails = append(tails, num)
        } else {
            tails[pos] = num
        }
    }
    return len(tails)
}

func main() {
    fmt.Println(lengthOfLIS([]int{10, 9, 2, 5, 3, 7, 101, 18})) // 4
    fmt.Println(lengthOfLIS([]int{0, 1, 0, 3, 2, 3}))            // 4
    fmt.Println(lengthOfLIS([]int{7, 7, 7, 7}))                   // 1
}
```

**Walkthrough for `[10, 9, 2, 5, 3, 7, 101, 18]`**

| num | tails after |
|-----|-------------|
| 10  | [10] |
| 9   | [9] |
| 2   | [2] |
| 5   | [2, 5] |
| 3   | [2, 3] |
| 7   | [2, 3, 7] |
| 101 | [2, 3, 7, 101] |
| 18  | [2, 3, 7, 18] |

Length = 4.

**Complexity**
- Time: O(n log n)
- Space: O(n)

---

### Q25: Russian Doll Envelopes — Level 5

**Problem Statement**
You have envelopes `[w, h]`. Envelope `A` fits inside envelope `B` if both `A.w < B.w` and `A.h < B.h`. Return the maximum number of envelopes you can Russian doll.

**Key Insight**
Sort by width ascending. For equal widths, sort by height **descending** (prevents using two envelopes with same width). Then run LIS on heights.

**Why descending for equal widths?**
If two envelopes have the same width, we cannot nest them. Sorting heights descending ensures that for a group with the same width, only one can be picked by LIS (since LIS is strictly increasing and the heights decrease within the group).

**Complete Go Solution**

```go
package main

import (
    "fmt"
    "sort"
)

func maxEnvelopes(envelopes [][]int) int {
    sort.Slice(envelopes, func(i, j int) bool {
        if envelopes[i][0] == envelopes[j][0] {
            return envelopes[i][1] > envelopes[j][1] // descending height
        }
        return envelopes[i][0] < envelopes[j][0] // ascending width
    })

    // LIS on heights
    tails := []int{}
    for _, e := range envelopes {
        h := e[1]
        pos := sort.SearchInts(tails, h)
        if pos == len(tails) {
            tails = append(tails, h)
        } else {
            tails[pos] = h
        }
    }
    return len(tails)
}

func main() {
    fmt.Println(maxEnvelopes([][]int{{5,4},{6,4},{6,7},{2,3}})) // 3  ([2,3]->[5,4]->[6,7])
    fmt.Println(maxEnvelopes([][]int{{1,1},{1,1},{1,1}}))       // 1
    fmt.Println(maxEnvelopes([][]int{{4,5},{4,6},{6,7},{2,3},{1,1}})) // 4
}
```

**Complexity**
- Time: O(n log n) — sorting + LIS with binary search
- Space: O(n)

---

## DP Pattern Cheat Sheet

| Pattern | State Definition | Recurrence Shape | Example Problems |
|---|---|---|---|
| **Linear 1D** | `dp[i]` over prefix of length `i` | `dp[i] = f(dp[i-1], dp[i-2])` | Climbing Stairs, House Robber, Decode Ways |
| **Knapsack (0/1)** | `dp[w]` = best value using weight ≤ w | iterate weight backwards | Partition Equal Subset Sum, Target Sum, Ones and Zeroes |
| **Unbounded Knapsack** | `dp[w]` = best value, unlimited reuse | iterate weight forwards | Coin Change, Coin Change II |
| **2D Grid** | `dp[i][j]` = answer at cell `(i,j)` | from top/left neighbors | Unique Paths, Min Path Sum, Maximal Square |
| **String 2D** | `dp[i][j]` = answer for first `i` of s1, first `j` of s2 | compare characters | LCS, Edit Distance, Regex Matching |
| **Interval DP** | `dp[i][j]` = answer for subarray `[i..j]` | split at some `k` in `[i..j]` | Burst Balloons, Min Cost Cut, Strange Printer |
| **Tree DP** | `dp[node]` = answer for subtree rooted at node | combine children results | House Robber III, Diameter, Max Path Sum |
| **LIS / Subsequence** | `dp[i]` = best subsequence ending at index `i` | scan all `j < i` | LIS, Russian Doll Envelopes |

### Go-Specific Implementation Notes

| Concern | Recommendation |
|---|---|
| Memoization key (2D) | `int64(i)<<32 | int64(j)` is faster than `fmt.Sprintf` |
| Avoiding allocation in loops | Pre-allocate 2D slice outside the loop |
| Closure recursion | Declare `var dp func(...)` before assigning to allow self-reference |
| Infinity sentinel | `const inf = 1<<31 - 1` (use `1<<62` for int64 problems) |
| Bottom-up fill order | Interval DP: increasing length; 2D DP: row by row |
| Binary search | `sort.SearchInts(slice, x)` returns first index ≥ x (use for LIS) |

### Decision Tree: Which DP Type?

```
Problem involves...
├── A linear sequence, one pass?
│   ├── Current depends on k previous → 1D DP
│   └── Current element chosen or not → Knapsack
├── Two sequences compared?
│   └── 2D string DP (LCS, Edit Distance)
├── A grid with movement constraints?
│   └── 2D grid DP (Unique Paths, Min Path Sum)
├── A subarray/substring in isolation?
│   └── Interval DP (fill by length)
├── A tree structure?
│   └── Tree DP (post-order DFS)
└── Finding optimal subsequence?
    └── LIS-style DP (O(n log n) if sorted)
```

---

> © 2025 Gaurav Patil — GoForge Platform. All rights reserved.
