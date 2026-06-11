# Arrays, Strings & Sliding Window in Go

> GoForge DSA Series — Module 01

---

## Why Go for DSA

Go occupies a unique position for interview coding. It is close enough to C to force you to think about memory, yet high-level enough to stay out of your way. The things that catch candidates off-guard are almost always Go-specific idioms:

| Concern | Python | Java | Go |
|---|---|---|---|
| Array vs slice | list (heap) | `int[]` (fixed) | slice (header + backing array) |
| String mutability | immutable | immutable | immutable, but `[]byte` cast is O(n) copy |
| Sort | `sorted()` O(n log n) | `Arrays.sort` O(n log n) | `sort.Slice` O(n log n) |
| HashMap | `dict` | `HashMap<K,V>` | `map[K]V` (no generics needed for most DSA) |
| Rune iteration | automatic | `charAt` by code unit | `for _, r := range s` gives rune; `s[i]` gives byte |

**The three most common Go-specific mistakes in interviews:**

1. Treating `s[i]` as a character — it is a `byte` (uint8). For Unicode, use `[]rune(s)`.
2. Forgetting that slice assignment shares the backing array. After `b := a[1:3]`, writing `b[0]` also mutates `a[1]`.
3. Using `+` to build strings in a loop — O(n²) because each `+` allocates. Use `strings.Builder`.

---

## Go-Specific Tips for Arrays and Strings

### 1. Slice Tricks Every Go Developer Knows

```go
// Append element
s = append(s, x)

// Delete index i (order-preserving, O(n))
s = append(s[:i], s[i+1:]...)

// Delete index i (swap with last, O(1), order-destroying)
s[i] = s[len(s)-1]
s = s[:len(s)-1]

// Reverse in-place
for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
    s[i], s[j] = s[j], s[i]
}

// Copy into new slice (avoid shared backing array)
dst := make([]int, len(src))
copy(dst, src)

// Two-dimensional slice
matrix := make([][]int, rows)
for i := range matrix {
    matrix[i] = make([]int, cols)
}
```

### 2. strings.Builder vs bytes.Buffer

`strings.Builder` is the right choice for concatenating strings piece-by-piece (zero-copy `String()` call at the end). `bytes.Buffer` is better when you need `io.ReadWriter` semantics or are mixing reads and writes.

```go
// Preferred for string construction in DSA
var sb strings.Builder
sb.WriteByte('a')
sb.WriteString("bc")
result := sb.String() // no allocation

// bytes.Buffer when you need io interfaces
var buf bytes.Buffer
fmt.Fprintf(&buf, "%d", num)
```

### 3. Rune vs Byte Iteration

```go
s := "héllo"

// Byte iteration — wrong for multibyte runes
for i := 0; i < len(s); i++ {
    fmt.Printf("%c", s[i]) // garbled for non-ASCII
}

// Rune iteration — correct
for i, r := range s {
    fmt.Printf("index %d rune %c\n", i, r)
}

// Convert once when you need random access by character
runes := []rune(s)
fmt.Println(runes[1]) // 'é'
```

### 4. sort.Slice and sort.Search Idioms

```go
// Sort slice of ints
nums := []int{3, 1, 4, 1, 5}
sort.Ints(nums)

// Sort with custom comparator
sort.Slice(words, func(i, j int) bool {
    return words[i] < words[j]
})

// Sort struct slice
type Interval struct{ start, end int }
intervals := []Interval{{1, 3}, {0, 2}}
sort.Slice(intervals, func(i, j int) bool {
    return intervals[i].start < intervals[j].start
})

// Binary search — sort.SearchInts returns insertion point
idx := sort.SearchInts(nums, target)
if idx < len(nums) && nums[idx] == target {
    // found
}

// Generic binary search (Go 1.21+)
idx, found := slices.BinarySearch(nums, target)
```

---

## Two-Sum Problems

---

### Q1: Two Sum (Return Indices)

**Problem:** Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`. Exactly one solution exists. You may not use the same element twice.

**Constraints:**
- `2 <= nums.length <= 10^4`
- `-10^9 <= nums[i] <= 10^9`
- Exactly one valid answer exists

**Approach:** Walk the array once. For each element, check whether `target - nums[i]` already lives in a hashmap. If yes, return the pair. If no, store `nums[i] → i` in the map.

**Solution:**

```go
func twoSum(nums []int, target int) []int {
    // seen maps value → index
    seen := make(map[int]int, len(nums))

    for i, n := range nums {
        complement := target - n
        if j, ok := seen[complement]; ok {
            return []int{j, i}
        }
        seen[n] = i
    }
    return nil // unreachable per constraints
}
```

- **Time:** O(n) — single pass
- **Space:** O(n) — hashmap

**Go-specific notes:** `make(map[int]int, len(nums))` pre-allocates the map to avoid incremental rehashing. The two-value map lookup `j, ok := seen[complement]` is idiomatic Go; never omit `ok` or you will silently treat a missing key as zero.

**Similar problems:** Q2 (Two Sum II), Q3 (3Sum), Two Sum IV (BST), Two Sum Less Than K

---

### Q2: Two Sum II (Sorted Array, Two Pointers)

**Problem:** Given a 1-indexed sorted array `numbers`, find two numbers that sum to `target`. Return their 1-based indices. Use only O(1) extra space.

**Constraints:**
- `2 <= numbers.length <= 3 * 10^4`
- `-1000 <= numbers[i] <= 1000`
- Array is sorted in non-decreasing order
- Exactly one solution

**Approach:** Place one pointer at the left end and one at the right end. If their sum equals target, done. If too small, advance left. If too large, retreat right. Works because the array is sorted.

**Solution:**

```go
func twoSumII(numbers []int, target int) []int {
    left, right := 0, len(numbers)-1

    for left < right {
        sum := numbers[left] + numbers[right]
        switch {
        case sum == target:
            return []int{left + 1, right + 1} // 1-indexed
        case sum < target:
            left++
        default:
            right--
        }
    }
    return nil
}
```

- **Time:** O(n)
- **Space:** O(1)

**Go-specific notes:** `switch` without a condition is idiomatic Go for chained if-else. The `default` branch replaces `case sum > target`, keeping it clean.

**Similar problems:** Q1 (Two Sum), Q3 (3Sum), Container With Most Water

---

### Q3: 3Sum (Unique Triplets)

**Problem:** Given an integer array `nums`, return all unique triplets `[nums[i], nums[j], nums[k]]` such that `i != j != k` and `nums[i] + nums[j] + nums[k] == 0`.

**Constraints:**
- `3 <= nums.length <= 3000`
- `-10^5 <= nums[i] <= 10^5`

**Approach:** Sort the array. For each index `i`, run two-pointer search on the suffix `[i+1 .. n-1]`. Skip duplicate values of `i` and of the two-pointer endpoints to guarantee unique triplets.

**Solution:**

```go
func threeSum(nums []int) [][]int {
    sort.Ints(nums)
    result := [][]int{}
    n := len(nums)

    for i := 0; i < n-2; i++ {
        // Skip duplicate values for the first element
        if i > 0 && nums[i] == nums[i-1] {
            continue
        }
        // Early termination: smallest possible sum already positive
        if nums[i] > 0 {
            break
        }

        left, right := i+1, n-1
        for left < right {
            sum := nums[i] + nums[left] + nums[right]
            switch {
            case sum == 0:
                result = append(result, []int{nums[i], nums[left], nums[right]})
                // Skip duplicates for left and right
                for left < right && nums[left] == nums[left+1] {
                    left++
                }
                for left < right && nums[right] == nums[right-1] {
                    right--
                }
                left++
                right--
            case sum < 0:
                left++
            default:
                right--
            }
        }
    }
    return result
}
```

- **Time:** O(n²) — outer loop O(n), inner two-pointer O(n)
- **Space:** O(1) excluding output

**Go-specific notes:** `[][]int{}` initialises to a non-nil empty slice, which serialises to `[]` in JSON rather than `null`. Prefer this over `var result [][]int` when callers downstream care about nil vs empty.

**Similar problems:** Q4 (4Sum), 3Sum Closest, 3Sum Smaller

---

### Q4: 4Sum

**Problem:** Given `nums` and integer `target`, return all unique quadruplets `[a, b, c, d]` such that `a + b + c + d == target`.

**Constraints:**
- `1 <= nums.length <= 200`
- `-10^9 <= nums[i] <= 10^9`

**Approach:** Sort and nest two loops for the first two elements, then use two-pointer for the inner pair. Skip duplicates at every level. Watch for integer overflow when summing four values near `10^9`.

**Solution:**

```go
func fourSum(nums []int, target int) [][]int {
    sort.Ints(nums)
    n := len(nums)
    result := [][]int{}

    for i := 0; i < n-3; i++ {
        if i > 0 && nums[i] == nums[i-1] {
            continue
        }
        for j := i + 1; j < n-2; j++ {
            if j > i+1 && nums[j] == nums[j-1] {
                continue
            }
            left, right := j+1, n-1
            for left < right {
                // Cast to int64 to avoid overflow
                sum := int64(nums[i]) + int64(nums[j]) +
                    int64(nums[left]) + int64(nums[right])
                t64 := int64(target)
                switch {
                case sum == t64:
                    result = append(result, []int{nums[i], nums[j], nums[left], nums[right]})
                    for left < right && nums[left] == nums[left+1] {
                        left++
                    }
                    for left < right && nums[right] == nums[right-1] {
                        right--
                    }
                    left++
                    right--
                case sum < t64:
                    left++
                default:
                    right--
                }
            }
        }
    }
    return result
}
```

- **Time:** O(n³)
- **Space:** O(1) excluding output

**Go-specific notes:** Go's `int` is 64-bit on most platforms but the spec does not guarantee it. Use explicit `int64` casts when summing large values to be safe in interviews. Mention this aloud — it impresses interviewers.

**Similar problems:** Q3 (3Sum), K-Sum generalisation

---

## Subarray Problems

---

### Q5: Maximum Subarray (Kadane's Algorithm)

**Problem:** Given an integer array `nums`, find the subarray with the largest sum and return its sum.

**Constraints:**
- `1 <= nums.length <= 10^5`
- `-10^4 <= nums[i] <= 10^4`

**Approach:** Kadane's algorithm. Walk forward keeping `currentSum`. At each step, decide: extend the running subarray by adding `nums[i]`, or start fresh at `nums[i]`. Update `maxSum` at every step.

**Solution:**

```go
func maxSubArray(nums []int) int {
    maxSum := nums[0]
    currentSum := nums[0]

    for i := 1; i < len(nums); i++ {
        // Extend or restart
        if currentSum < 0 {
            currentSum = nums[i]
        } else {
            currentSum += nums[i]
        }
        if currentSum > maxSum {
            maxSum = currentSum
        }
    }
    return maxSum
}
```

**Bonus — return the subarray indices:**

```go
func maxSubArrayWithIndices(nums []int) (int, int, int) {
    maxSum := nums[0]
    currentSum := nums[0]
    start, end, tempStart := 0, 0, 0

    for i := 1; i < len(nums); i++ {
        if currentSum < 0 {
            currentSum = nums[i]
            tempStart = i
        } else {
            currentSum += nums[i]
        }
        if currentSum > maxSum {
            maxSum = currentSum
            start = tempStart
            end = i
        }
    }
    return maxSum, start, end
}
```

- **Time:** O(n)
- **Space:** O(1)

**Go-specific notes:** Initialise `maxSum` and `currentSum` with `nums[0]`, not `math.MinInt32`, because the problem asks for the largest sum which may be negative. Starting with `math.MinInt32` works too but is less readable.

**Similar problems:** Q6 (Maximum Product Subarray), Maximum Sum Circular Subarray, Maximum Subarray Min-Product

---

### Q6: Maximum Product Subarray

**Problem:** Given `nums`, find the subarray with the largest product and return the product.

**Constraints:**
- `1 <= nums.length <= 2 * 10^4`
- `-10 <= nums[i] <= 10`

**Approach:** Unlike sum, a large negative product can flip to large positive when multiplied by another negative. Track both `maxProd` and `minProd` at each step. At each element, the new max is `max(nums[i], maxProd*nums[i], minProd*nums[i])` and similarly for min.

**Solution:**

```go
func maxProduct(nums []int) int {
    maxProd := nums[0]
    minProd := nums[0]
    result := nums[0]

    for i := 1; i < len(nums); i++ {
        n := nums[i]
        // Swap when n is negative because multiplying flips max↔min
        if n < 0 {
            maxProd, minProd = minProd, maxProd
        }
        if n > maxProd*n {
            maxProd = n
        } else {
            maxProd = maxProd * n
        }
        if n < minProd*n {
            minProd = n
        } else {
            minProd = minProd * n
        }
        if maxProd > result {
            result = maxProd
        }
    }
    return result
}
```

- **Time:** O(n)
- **Space:** O(1)

**Go-specific notes:** Go lacks a built-in `max`/`min` for `int` before Go 1.21. In older codebases you write explicit comparisons. Since Go 1.21 you can use `max(a, b)` and `min(a, b)` as builtins.

**Similar problems:** Q5 (Maximum Subarray), Maximum Product of Three Numbers

---

### Q7: Subarray Sum Equals K

**Problem:** Given array `nums` and integer `k`, return the total number of subarrays whose sum equals `k`.

**Constraints:**
- `1 <= nums.length <= 2 * 10^4`
- `-1000 <= nums[i] <= 1000`
- `-10^7 <= k <= 10^7`

**Approach:** Prefix sums. For each prefix sum `p`, the number of subarrays ending here with sum `k` equals the count of previous prefix sums equal to `p - k`. Store prefix sum counts in a map. Initialise the map with `{0: 1}` to handle subarrays that start at index 0.

**Solution:**

```go
func subarraySum(nums []int, k int) int {
    // prefixCount[sum] = number of times this prefix sum was seen
    prefixCount := map[int]int{0: 1}
    count := 0
    sum := 0

    for _, n := range nums {
        sum += n
        // How many previous prefixes allow a subarray ending here to sum to k?
        count += prefixCount[sum-k]
        prefixCount[sum]++
    }
    return count
}
```

- **Time:** O(n)
- **Space:** O(n)

**Go-specific notes:** Reading from a map with a missing key returns the zero value (0 for `int`) in Go. The line `count += prefixCount[sum-k]` is safe even when `sum-k` is not present — no panic, no ok-check needed here because zero is the correct contribution.

**Similar problems:** Q8 (Minimum Size Subarray Sum), Contiguous Array, Subarray Sum Divisible by K

---

### Q8: Minimum Size Subarray Sum

**Problem:** Given a positive integer `target` and array `nums` of positive integers, return the minimum length of a subarray whose sum is at least `target`. Return 0 if no such subarray exists.

**Constraints:**
- `1 <= target <= 10^9`
- `1 <= nums.length <= 10^5`
- `1 <= nums[i] <= 10^4`

**Approach:** Sliding window (variable size). Expand the right pointer, adding to `windowSum`. When `windowSum >= target`, record the window length and shrink from the left as far as possible while maintaining the condition.

**Solution:**

```go
func minSubArrayLen(target int, nums []int) int {
    minLen := len(nums) + 1 // sentinel "infinity"
    windowSum := 0
    left := 0

    for right, n := range nums {
        windowSum += n
        for windowSum >= target {
            width := right - left + 1
            if width < minLen {
                minLen = width
            }
            windowSum -= nums[left]
            left++
        }
    }

    if minLen == len(nums)+1 {
        return 0
    }
    return minLen
}
```

- **Time:** O(n) — each element enters and leaves the window at most once
- **Space:** O(1)

**Go-specific notes:** Using `len(nums) + 1` as a sentinel avoids importing `math` just for `math.MaxInt`. Check at the end: if `minLen` is still the sentinel, return 0.

**Similar problems:** Q9 (Longest Substring Without Repeating Characters), Q11 (Sliding Window Maximum), Shortest Subarray with Sum at Least K (negatives — needs deque)

---

## Sliding Window

---

### Q9: Longest Substring Without Repeating Characters

**Problem:** Given a string `s`, find the length of the longest substring with no repeating characters.

**Constraints:**
- `0 <= len(s) <= 5 * 10^4`
- `s` consists of English letters, digits, symbols, spaces

**Approach:** Sliding window with a hashmap tracking the last-seen index of each byte. When a duplicate is found, jump `left` past the previous occurrence — do not just increment by 1.

**Solution:**

```go
func lengthOfLongestSubstring(s string) int {
    // lastSeen maps byte → last index where it appeared
    lastSeen := make(map[byte]int)
    maxLen := 0
    left := 0

    for right := 0; right < len(s); right++ {
        ch := s[right]
        if idx, ok := lastSeen[ch]; ok && idx >= left {
            // Move left past the duplicate
            left = idx + 1
        }
        lastSeen[ch] = right
        if width := right - left + 1; width > maxLen {
            maxLen = width
        }
    }
    return maxLen
}
```

- **Time:** O(n)
- **Space:** O(min(n, charset)) — at most 128 for ASCII

**Go-specific notes:** Iterating with `s[right]` gives a `byte`. This is correct here because the problem treats each byte as a distinct character. If the input were arbitrary Unicode, convert to `[]rune` first. The guard `idx >= left` is critical — a stale entry from before the current window must be ignored.

**Similar problems:** Q10 (Minimum Window Substring), Q12 (Longest Repeating Character Replacement), Longest Substring with At Most K Distinct Characters

---

### Q10: Minimum Window Substring

**Problem:** Given strings `s` and `t`, return the minimum window in `s` that contains every character of `t` (including duplicates). If no such window exists, return `""`.

**Constraints:**
- `1 <= len(s), len(t) <= 10^5`
- `s` and `t` consist of uppercase and lowercase English letters

**Approach:** Sliding window. Use two frequency maps: `need` (characters required from `t`) and `have` (characters in current window). Track `formed` — how many distinct characters in `t` are satisfied. When all are satisfied, try to shrink from the left.

**Solution:**

```go
func minWindow(s string, t string) string {
    if len(s) == 0 || len(t) == 0 {
        return ""
    }

    need := make(map[byte]int)
    for i := 0; i < len(t); i++ {
        need[t[i]]++
    }

    have := make(map[byte]int)
    formed := 0
    required := len(need) // distinct chars in t

    left := 0
    minStart, minLen := 0, len(s)+1

    for right := 0; right < len(s); right++ {
        ch := s[right]
        have[ch]++
        if cnt, ok := need[ch]; ok && have[ch] == cnt {
            formed++
        }

        // Shrink while window is valid
        for formed == required {
            if right-left+1 < minLen {
                minLen = right - left + 1
                minStart = left
            }
            leftCh := s[left]
            have[leftCh]--
            if cnt, ok := need[leftCh]; ok && have[leftCh] < cnt {
                formed--
            }
            left++
        }
    }

    if minLen == len(s)+1 {
        return ""
    }
    return s[minStart : minStart+minLen]
}
```

- **Time:** O(|s| + |t|)
- **Space:** O(|s| + |t|)

**Go-specific notes:** String slicing `s[start:end]` does not copy — it returns a slice header pointing into the original string's backing array. This is correct and O(1). Returning the slice directly avoids an unnecessary allocation.

**Similar problems:** Q13 (Permutation in String), Smallest Range Covering Elements from K Lists, Minimum Window Subsequence

---

### Q11: Sliding Window Maximum (Deque)

**Problem:** Given array `nums` and integer `k`, return an array of the maximum values in each window of size `k`.

**Constraints:**
- `1 <= nums.length <= 10^5`
- `-10^4 <= nums[i] <= 10^4`
- `1 <= k <= nums.length`

**Approach:** Maintain a monotonic decreasing deque of indices. The front of the deque is always the index of the maximum in the current window. Before adding a new element, pop the back while the back's value is smaller than the incoming element (it can never be a future maximum). Also pop the front if it has fallen outside the window.

**Solution:**

```go
func maxSlidingWindow(nums []int, k int) []int {
    n := len(nums)
    result := make([]int, 0, n-k+1)
    // deque stores indices; values are monotonically decreasing
    deque := make([]int, 0, k)

    for i, n2 := range nums {
        // Remove elements outside the window from the front
        for len(deque) > 0 && deque[0] < i-k+1 {
            deque = deque[1:]
        }
        // Remove smaller elements from the back
        for len(deque) > 0 && nums[deque[len(deque)-1]] < n2 {
            deque = deque[:len(deque)-1]
        }
        deque = append(deque, i)

        // Window is full — record maximum (front of deque)
        if i >= k-1 {
            result = append(result, nums[deque[0]])
        }
    }
    return result
}
```

- **Time:** O(n) — each index enters and leaves the deque at most once
- **Space:** O(k)

**Go-specific notes:** Go does not have a built-in deque. A `[]int` slice works perfectly: `append` for push-back, `deque[1:]` for pop-front, `deque[:len-1]` for pop-back. The only concern is that `deque[1:]` does not free the underlying memory. For very large inputs, use a circular buffer or `container/ring`. In interviews, the slice approach is always acceptable.

**Similar problems:** Q8 (Minimum Size Subarray Sum), Jump Game VI, Longest Continuous Subarray With Absolute Diff Less Than or Equal to Limit

---

### Q12: Longest Repeating Character Replacement

**Problem:** Given string `s` and integer `k`, you can replace at most `k` characters in `s` with any letter. Return the length of the longest substring containing only one distinct letter after the replacements.

**Constraints:**
- `1 <= len(s) <= 10^5`
- `s` consists of uppercase English letters
- `0 <= k <= len(s)`

**Approach:** Sliding window. Track the frequency of each character in the window and the count of the most frequent character (`maxFreq`). A window of length `windowLen` is valid if `windowLen - maxFreq <= k` (we only need to replace the minority characters). When invalid, shrink from the left.

**Solution:**

```go
func characterReplacement(s string, k int) int {
    freq := [26]int{}
    maxFreq := 0
    left := 0
    maxLen := 0

    for right := 0; right < len(s); right++ {
        idx := s[right] - 'A'
        freq[idx]++
        if freq[idx] > maxFreq {
            maxFreq = freq[idx]
        }

        // Window size minus max frequency = chars to replace
        for right-left+1-maxFreq > k {
            freq[s[left]-'A']--
            left++
            // Recompute maxFreq after shrink (optional optimisation: only decrement)
            // Note: maxFreq never needs to increase when shrinking.
            // We can leave it as-is because a smaller window with the same
            // maxFreq is never worse than what we already recorded.
        }
        if width := right - left + 1; width > maxLen {
            maxLen = width
        }
    }
    return maxLen
}
```

- **Time:** O(n)
- **Space:** O(1) — fixed-size array of 26

**Go-specific notes:** Using `[26]int` (array, not slice) is idiomatic Go for fixed-size character frequency tables. It lives on the stack and requires no `make`. Byte arithmetic `s[right] - 'A'` gives a zero-based index; `'A'` is an untyped rune constant that fits in `byte`.

**Similar problems:** Q9 (Longest Substring Without Repeating Characters), Longest Subarray of 1s After Deleting One Element, Max Consecutive Ones III

---

### Q13: Permutation in String

**Problem:** Given strings `s1` and `s2`, return `true` if any permutation of `s1` is a substring of `s2`.

**Constraints:**
- `1 <= len(s1), len(s2) <= 10^4`
- Both strings consist of lowercase English letters

**Approach:** Fixed-size sliding window of length `len(s1)`. Compare the frequency array of the current window in `s2` against the frequency array of `s1`. Slide one character at a time.

**Solution:**

```go
func checkInclusion(s1 string, s2 string) bool {
    if len(s1) > len(s2) {
        return false
    }

    var need, have [26]int
    for i := 0; i < len(s1); i++ {
        need[s1[i]-'a']++
        have[s2[i]-'a']++
    }
    if need == have {
        return true
    }

    for i := len(s1); i < len(s2); i++ {
        // Add new right character
        have[s2[i]-'a']++
        // Remove old left character
        have[s2[i-len(s1)]-'a']--
        if need == have {
            return true
        }
    }
    return false
}
```

- **Time:** O(|s2|)
- **Space:** O(1) — two fixed-size arrays

**Go-specific notes:** Comparing two `[26]int` arrays with `==` is valid Go — arrays (not slices!) support direct equality comparison. This is a clean O(1) check that replaces the common "count matches" variable approach. You cannot do `slice1 == slice2` in Go; it is a compile error.

**Similar problems:** Q10 (Minimum Window Substring), Q14 (Valid Anagram), Find All Anagrams in a String

---

## String Problems

---

### Q14: Valid Anagram

**Problem:** Given strings `s` and `t`, return `true` if `t` is an anagram of `s`.

**Constraints:**
- `1 <= len(s), len(t) <= 5 * 10^4`
- `s` and `t` consist of lowercase English letters
- Follow-up: what if inputs contain Unicode characters?

**Approach:** Count character frequencies in `s`, decrement for each character in `t`. If any frequency ends non-zero, not an anagram.

**Solution:**

```go
// ASCII version — O(1) space
func isAnagram(s string, t string) bool {
    if len(s) != len(t) {
        return false
    }
    var count [26]int
    for i := 0; i < len(s); i++ {
        count[s[i]-'a']++
        count[t[i]-'a']--
    }
    return count == [26]int{}
}

// Unicode version — follow-up answer
func isAnagramUnicode(s string, t string) bool {
    if len(s) != len(t) {
        return false
    }
    freq := make(map[rune]int)
    for _, r := range s {
        freq[r]++
    }
    for _, r := range t {
        freq[r]--
        if freq[r] < 0 {
            return false
        }
    }
    return true
}
```

- **Time:** O(n)
- **Space:** O(1) ASCII, O(k) Unicode where k is alphabet size

**Go-specific notes:** `count == [26]int{}` compares against the zero-value array — idiomatic and avoids a loop. In the Unicode version, `for _, r := range s` iterates over runes automatically. Always offer both versions in interviews; it shows you understand Go's string model.

**Similar problems:** Q13 (Permutation in String), Q15 (Group Anagrams), Find All Anagrams in a String

---

### Q15: Group Anagrams

**Problem:** Given an array of strings `strs`, group the anagrams together. Return the groups in any order.

**Constraints:**
- `1 <= len(strs) <= 10^4`
- `0 <= len(strs[i]) <= 100`
- `strs[i]` consists of lowercase English letters

**Approach:** Canonical key: sort each word's characters to form a key. Words that are anagrams share the same sorted key. Use a map from key to list of words.

**Solution:**

```go
func groupAnagrams(strs []string) [][]string {
    groups := make(map[string][]string)

    for _, word := range strs {
        // Sort characters to create a canonical key
        b := []byte(word)
        sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
        key := string(b)
        groups[key] = append(groups[key], word)
    }

    result := make([][]string, 0, len(groups))
    for _, g := range groups {
        result = append(result, g)
    }
    return result
}

// Alternative: frequency array as key (avoids O(w log w) sort per word)
func groupAnagramsFreq(strs []string) [][]string {
    groups := make(map[[26]int][]string)
    for _, word := range strs {
        var key [26]int
        for i := 0; i < len(word); i++ {
            key[word[i]-'a']++
        }
        groups[key] = append(groups[key], word)
    }
    result := make([][]string, 0, len(groups))
    for _, g := range groups {
        result = append(result, g)
    }
    return result
}
```

- **Time:** O(n · w log w) sort version, O(n · w) frequency version — n words, w max word length
- **Space:** O(n · w)

**Go-specific notes:** In `groupAnagramsFreq`, a `[26]int` array is used as a map key. Go allows any comparable type as a map key; arrays are comparable, but slices are not. This is a common interview talking point.

**Similar problems:** Q14 (Valid Anagram), Q13 (Permutation in String)

---

### Q16: Longest Palindromic Substring

**Problem:** Given string `s`, return the longest palindromic substring.

**Constraints:**
- `1 <= len(s) <= 1000`
- `s` consists of digits and English letters

**Approach:** Expand-around-centre. For each centre (each character for odd-length, each pair for even-length palindromes), expand outward as long as characters match. Track the maximum span.

**Solution:**

```go
func longestPalindrome(s string) string {
    if len(s) == 0 {
        return ""
    }
    start, maxLen := 0, 1

    expand := func(left, right int) {
        for left >= 0 && right < len(s) && s[left] == s[right] {
            if right-left+1 > maxLen {
                maxLen = right - left + 1
                start = left
            }
            left--
            right++
        }
    }

    for i := 0; i < len(s); i++ {
        expand(i, i)   // odd length
        expand(i, i+1) // even length
    }
    return s[start : start+maxLen]
}
```

- **Time:** O(n²)
- **Space:** O(1)

**Go-specific notes:** Closures in Go capture variables by reference. The inner `expand` function mutates `start` and `maxLen` directly. This pattern is cleaner than returning multiple values from a helper and is idiomatic Go.

**Similar problems:** Q17 (Palindrome Partitioning), Palindromic Substrings (count), Shortest Palindrome, Longest Palindromic Subsequence (DP)

---

### Q17: Palindrome Partitioning

**Problem:** Given string `s`, partition it into substrings such that every substring is a palindrome. Return all possible partitions.

**Constraints:**
- `1 <= len(s) <= 16`
- `s` consists of lowercase English letters

**Approach:** Backtracking. At each step, try every prefix of the remaining string. If the prefix is a palindrome, add it to the current path and recurse on the suffix. Backtrack by popping after the recursive call.

**Solution:**

```go
func partition(s string) [][]string {
    result := [][]string{}
    path := []string{}

    var isPalin func(l, r int) bool
    isPalin = func(l, r int) bool {
        for l < r {
            if s[l] != s[r] {
                return false
            }
            l++
            r--
        }
        return true
    }

    var backtrack func(start int)
    backtrack = func(start int) {
        if start == len(s) {
            // Make a copy of path before appending
            tmp := make([]string, len(path))
            copy(tmp, path)
            result = append(result, tmp)
            return
        }
        for end := start; end < len(s); end++ {
            if isPalin(start, end) {
                path = append(path, s[start:end+1])
                backtrack(end + 1)
                path = path[:len(path)-1] // backtrack
            }
        }
    }

    backtrack(0)
    return result
}
```

- **Time:** O(n · 2^n) — up to 2^(n-1) partitions, O(n) to copy each
- **Space:** O(n) recursion stack

**Go-specific notes:** The `copy(tmp, path)` call is mandatory. Without it, all entries in `result` point to the same underlying slice that `path` keeps mutating. This is the single most common backtracking bug in Go.

**Similar problems:** Palindrome Partitioning II (minimum cuts — DP), Q16 (Longest Palindromic Substring)

---

### Q18: Word Break

**Problem:** Given string `s` and dictionary `wordDict`, return `true` if `s` can be segmented into a sequence of dictionary words.

**Constraints:**
- `1 <= len(s) <= 300`
- `1 <= len(wordDict) <= 1000`
- `1 <= len(wordDict[i]) <= 20`

**Approach:** Dynamic programming. `dp[i]` is true if `s[0..i-1]` can be segmented. Transition: `dp[i]` is true if there exists some `j < i` where `dp[j]` is true and `s[j..i-1]` is in the dictionary.

**Solution:**

```go
func wordBreak(s string, wordDict []string) bool {
    wordSet := make(map[string]bool, len(wordDict))
    for _, w := range wordDict {
        wordSet[w] = true
    }

    n := len(s)
    dp := make([]bool, n+1)
    dp[0] = true // empty prefix is always segmentable

    for i := 1; i <= n; i++ {
        for j := 0; j < i; j++ {
            if dp[j] && wordSet[s[j:i]] {
                dp[i] = true
                break
            }
        }
    }
    return dp[n]
}
```

- **Time:** O(n² · m) where m is the cost of map lookup (average O(1))
- **Space:** O(n + dict size)

**Go-specific notes:** `s[j:i]` creates a string header pointing into `s`'s memory — no copy. Map lookup with a string key computes the hash on the fly, so frequent short lookups are fast. Prefer `map[string]bool` with `wordSet[key]` over `map[string]struct{}` with `_, ok := wordSet[key]` in interview settings for readability.

**Similar problems:** Word Break II (return all sentences), Word Break III (case-insensitive)

---

## Matrix Problems

---

### Q19: Rotate Image (90 Degrees Clockwise)

**Problem:** Given an `n x n` matrix, rotate it 90 degrees clockwise in-place.

**Constraints:**
- `n == matrix.length == matrix[i].length`
- `1 <= n <= 20`
- `-1000 <= matrix[i][j] <= 1000`

**Approach:** Two-step in-place transformation. Step 1: transpose the matrix (swap `[i][j]` with `[j][i]`). Step 2: reverse each row. The composition equals a 90-degree clockwise rotation.

**Solution:**

```go
func rotate(matrix [][]int) {
    n := len(matrix)

    // Step 1: Transpose — reflect across the main diagonal
    for i := 0; i < n; i++ {
        for j := i + 1; j < n; j++ {
            matrix[i][j], matrix[j][i] = matrix[j][i], matrix[i][j]
        }
    }

    // Step 2: Reverse each row
    for i := 0; i < n; i++ {
        left, right := 0, n-1
        for left < right {
            matrix[i][left], matrix[i][right] = matrix[i][right], matrix[i][left]
            left++
            right--
        }
    }
}
```

- **Time:** O(n²)
- **Space:** O(1)

**Go-specific notes:** Go's multiple assignment `a, b = b, a` is a true atomic swap with no temporary variable needed. This is idiomatic and often faster than a three-variable swap because the compiler can use register exchanges.

**Similar problems:** Q20 (Spiral Matrix), Rotate Array (1D), Determine if Two Events Have Conflict

---

### Q20: Spiral Matrix

**Problem:** Given an `m x n` matrix, return all elements in spiral order (clockwise from the top-left corner).

**Constraints:**
- `m == matrix.length`
- `n == matrix[i].length`
- `1 <= m, n <= 10`
- `-100 <= matrix[i][j] <= 100`

**Approach:** Shrinking boundary. Maintain four boundaries: `top`, `bottom`, `left`, `right`. Traverse the current layer (right across top, down the right side, left across bottom, up the left side), then shrink the boundary inward and repeat.

**Solution:**

```go
func spiralOrder(matrix [][]int) []int {
    m, n := len(matrix), len(matrix[0])
    result := make([]int, 0, m*n)
    top, bottom, left, right := 0, m-1, 0, n-1

    for top <= bottom && left <= right {
        // Traverse right across the top row
        for col := left; col <= right; col++ {
            result = append(result, matrix[top][col])
        }
        top++

        // Traverse down the right column
        for row := top; row <= bottom; row++ {
            result = append(result, matrix[row][right])
        }
        right--

        // Traverse left across the bottom row (if still valid)
        if top <= bottom {
            for col := right; col >= left; col-- {
                result = append(result, matrix[bottom][col])
            }
            bottom--
        }

        // Traverse up the left column (if still valid)
        if left <= right {
            for row := bottom; row >= top; row-- {
                result = append(result, matrix[row][left])
            }
            left++
        }
    }
    return result
}
```

- **Time:** O(m × n)
- **Space:** O(1) excluding output

**Go-specific notes:** `make([]int, 0, m*n)` pre-allocates the result slice to avoid repeated backing-array reallocations during `append`. Always pre-allocate when you know the final size.

**Similar problems:** Q19 (Rotate Image), Spiral Matrix II (fill), Diagonal Traverse

---

### Q21: Set Matrix Zeroes

**Problem:** Given an `m x n` matrix, if any element is zero, set its entire row and column to zeros. Do it in-place.

**Constraints:**
- `m == matrix.length`
- `n == matrix[0].length`
- `1 <= m, n <= 200`
- `-2^31 <= matrix[i][j] <= 2^31 - 1`

**Approach:** Use the first row and first column as markers to avoid extra space. First, check whether the first row or column itself contains a zero (store in two booleans). Then scan the rest of the matrix: if `matrix[i][j] == 0`, mark `matrix[0][j] = 0` and `matrix[i][0] = 0`. Finally, zero out marked rows/columns, then handle the first row and column using the saved booleans.

**Solution:**

```go
func setZeroes(matrix [][]int) {
    m, n := len(matrix), len(matrix[0])
    firstRowZero := false
    firstColZero := false

    // Check if first row contains a zero
    for j := 0; j < n; j++ {
        if matrix[0][j] == 0 {
            firstRowZero = true
            break
        }
    }
    // Check if first column contains a zero
    for i := 0; i < m; i++ {
        if matrix[i][0] == 0 {
            firstColZero = true
            break
        }
    }

    // Use first row/col as markers for the rest
    for i := 1; i < m; i++ {
        for j := 1; j < n; j++ {
            if matrix[i][j] == 0 {
                matrix[0][j] = 0
                matrix[i][0] = 0
            }
        }
    }

    // Zero out rows and columns based on markers
    for i := 1; i < m; i++ {
        for j := 1; j < n; j++ {
            if matrix[0][j] == 0 || matrix[i][0] == 0 {
                matrix[i][j] = 0
            }
        }
    }

    // Handle first row
    if firstRowZero {
        for j := 0; j < n; j++ {
            matrix[0][j] = 0
        }
    }
    // Handle first column
    if firstColZero {
        for i := 0; i < m; i++ {
            matrix[i][0] = 0
        }
    }
}
```

- **Time:** O(m × n)
- **Space:** O(1)

**Go-specific notes:** The ordering matters — zero out the interior first (rows 1..m-1, cols 1..n-1) before handling row 0 and col 0, or the markers get corrupted. Explain this explicitly in the interview.

**Similar problems:** Q19 (Rotate Image), Game of Life (similar in-place marking technique)

---

### Q22: Search a 2D Matrix

**Problem:** Given an `m x n` matrix where each row is sorted and the first integer of each row is greater than the last integer of the previous row, determine if `target` is in the matrix.

**Constraints:**
- `m == matrix.length`
- `n == matrix[0].length`
- `1 <= m, n <= 100`
- `-10^4 <= matrix[i][j], target <= 10^4`

**Approach:** Treat the matrix as a flat sorted array of `m * n` elements. Binary search on virtual indices `0..m*n-1`. Map virtual index `mid` to `matrix[mid/n][mid%n]`.

**Solution:**

```go
func searchMatrix(matrix [][]int, target int) bool {
    m, n := len(matrix), len(matrix[0])
    low, high := 0, m*n-1

    for low <= high {
        mid := low + (high-low)/2
        val := matrix[mid/n][mid%n]
        switch {
        case val == target:
            return true
        case val < target:
            low = mid + 1
        default:
            high = mid - 1
        }
    }
    return false
}
```

- **Time:** O(log(m × n))
- **Space:** O(1)

**Go-specific notes:** `mid = low + (high-low)/2` prevents integer overflow — always prefer this over `(low+high)/2` even though Go's `int` is 64-bit in practice. It is a habit that prevents bugs when porting code.

**Bonus — Search a 2D Matrix II** (each row and column is sorted independently, not the stricter version above):

```go
// Start at top-right corner
func searchMatrixII(matrix [][]int, target int) bool {
    if len(matrix) == 0 {
        return false
    }
    row, col := 0, len(matrix[0])-1
    for row < len(matrix) && col >= 0 {
        val := matrix[row][col]
        if val == target {
            return true
        } else if val > target {
            col--
        } else {
            row++
        }
    }
    return false
}
```

**Similar problems:** Search in Rotated Sorted Array, Search a 2D Matrix II

---

## Interview Patterns — Cheat Sheet

### Pattern 1: Two Pointers

**When to use:** Sorted array, sum/product target, removing duplicates, palindrome check, partitioning.

```go
// Template — converging pointers
func twoPointers(nums []int, target int) (int, int) {
    left, right := 0, len(nums)-1
    for left < right {
        val := compute(nums[left], nums[right])
        if val == target {
            return left, right
        } else if val < target {
            left++
        } else {
            right--
        }
    }
    return -1, -1
}

// Template — same-direction (fast/slow or read/write)
func removeDuplicates(nums []int) int {
    write := 1
    for read := 1; read < len(nums); read++ {
        if nums[read] != nums[read-1] {
            nums[write] = nums[read]
            write++
        }
    }
    return write
}
```

**Recognise by:** "sorted array", "find pair/triplet", "no extra space", "two indices moving toward each other".

---

### Pattern 2: Sliding Window

**When to use:** Substring/subarray with a constraint (longest, shortest, exactly k, at most k distinct). Input is a string or array.

```go
// Template — variable-size window (find minimum/maximum length)
func slidingWindow(nums []int, target int) int {
    left := 0
    windowState := 0        // sum, count, or map
    best := len(nums) + 1   // or 0, depending on min vs max

    for right, val := range nums {
        // Expand: incorporate nums[right] into window state
        windowState += val

        // Shrink: while window satisfies condition, record and shrink
        for windowState >= target {
            best = min(best, right-left+1)
            windowState -= nums[left]
            left++
        }
    }
    if best == len(nums)+1 {
        return 0
    }
    return best
}

// Template — fixed-size window (e.g., permutation check)
func fixedWindow(s string, k int) bool {
    var freq [26]int
    // Seed the first window
    for i := 0; i < k; i++ {
        freq[s[i]-'a']++
    }
    // Slide
    for i := k; i < len(s); i++ {
        if checkCondition(freq) {
            return true
        }
        freq[s[i]-'a']++
        freq[s[i-k]-'a']--
    }
    return checkCondition(freq)
}
```

**Key invariant:** Every element enters the window once and leaves once → O(n).

---

### Pattern 3: Prefix Sum

**When to use:** Count or find subarrays with a target sum, range sum queries, difference arrays.

```go
// Template — count subarrays with sum = k
func prefixSumCount(nums []int, k int) int {
    // CRITICAL: seed with {0: 1} to handle subarrays starting at index 0
    prefixCount := map[int]int{0: 1}
    count := 0
    runningSum := 0

    for _, n := range nums {
        runningSum += n
        // How many previous prefixes make a subarray ending here sum to k?
        count += prefixCount[runningSum-k]
        prefixCount[runningSum]++
    }
    return count
}

// Template — range sum query (immutable array)
func buildPrefixSum(nums []int) []int {
    prefix := make([]int, len(nums)+1)
    for i, n := range nums {
        prefix[i+1] = prefix[i] + n
    }
    return prefix
}

// Query sum of nums[l..r] inclusive:
// prefix[r+1] - prefix[l]
```

**Recognise by:** "sum equals k", "divisible by k", "range sum queries", "count subarrays".

---

### Pattern 4: HashMap Frequency Count

**When to use:** Anagram/permutation detection, character frequency, "first unique", sliding window with character constraints.

```go
// Template — character frequency with [26]int (lowercase ASCII only)
func freqArray(s string) [26]int {
    var freq [26]int
    for i := 0; i < len(s); i++ {
        freq[s[i]-'a']++
    }
    return freq
}

// Template — general frequency map
func freqMap(items []string) map[string]int {
    freq := make(map[string]int, len(items))
    for _, item := range items {
        freq[item]++
    }
    return freq
}

// Template — sliding window with "at most k distinct" constraint
func atMostKDistinct(s string, k int) int {
    freq := make(map[byte]int)
    left := 0
    maxLen := 0

    for right := 0; right < len(s); right++ {
        freq[s[right]]++
        // Shrink while we have more than k distinct characters
        for len(freq) > k {
            freq[s[left]]--
            if freq[s[left]] == 0 {
                delete(freq, s[left])
            }
            left++
        }
        if width := right - left + 1; width > maxLen {
            maxLen = width
        }
    }
    return maxLen
}
```

**Recognise by:** "anagram", "permutation", "frequency", "count occurrences", "first/last unique".

---

## Complexity Quick Reference

| Problem | Time | Space | Pattern |
|---|---|---|---|
| Q1 Two Sum | O(n) | O(n) | HashMap |
| Q2 Two Sum II | O(n) | O(1) | Two Pointers |
| Q3 3Sum | O(n²) | O(1) | Sort + Two Pointers |
| Q4 4Sum | O(n³) | O(1) | Sort + Two Pointers |
| Q5 Max Subarray | O(n) | O(1) | Kadane / DP |
| Q6 Max Product Subarray | O(n) | O(1) | DP (track min+max) |
| Q7 Subarray Sum = K | O(n) | O(n) | Prefix Sum + HashMap |
| Q8 Min Size Subarray Sum | O(n) | O(1) | Sliding Window |
| Q9 Longest No-Repeat Substring | O(n) | O(charset) | Sliding Window |
| Q10 Minimum Window Substring | O(n) | O(n) | Sliding Window |
| Q11 Sliding Window Maximum | O(n) | O(k) | Monotonic Deque |
| Q12 Longest Repeating Replacement | O(n) | O(1) | Sliding Window |
| Q13 Permutation in String | O(n) | O(1) | Fixed Sliding Window |
| Q14 Valid Anagram | O(n) | O(1) | Frequency Array |
| Q15 Group Anagrams | O(n·w) | O(n·w) | HashMap |
| Q16 Longest Palindromic Substring | O(n²) | O(1) | Expand Around Centre |
| Q17 Palindrome Partitioning | O(n·2^n) | O(n) | Backtracking |
| Q18 Word Break | O(n²) | O(n) | DP |
| Q19 Rotate Image | O(n²) | O(1) | Transpose + Reverse |
| Q20 Spiral Matrix | O(mn) | O(1) | Boundary Simulation |
| Q21 Set Matrix Zeroes | O(mn) | O(1) | In-place Marking |
| Q22 Search 2D Matrix | O(log mn) | O(1) | Binary Search |

---

## Go Pitfalls Summary

| Pitfall | Wrong | Correct |
|---|---|---|
| String indexing | `s[i]` → `byte` not character | Use `[]rune(s)[i]` for characters |
| String building in loop | `result += s` → O(n²) | `strings.Builder` |
| Slice equality | `a == b` → compile error | `reflect.DeepEqual` or manual loop |
| Array equality | `a == b` → works! | Valid for `[N]T` |
| Map zero value | `m["key"]` panics if missing | Returns zero value — safe |
| Nil slice vs empty | `var s []int` (nil) | `s := []int{}` (non-nil, length 0) |
| Slice shared backing | `b := a[1:3]` — shares memory | `copy(b, a[1:3])` to decouple |
| Modifying slice in loop | Closure captures loop var by ref | Copy the variable inside the closure |
| Overflow | `(a + b) / 2` for binary search mid | `a + (b-a)/2` |

---

*GoForge DSA Series | Module 01 — Arrays, Strings & Sliding Window*
