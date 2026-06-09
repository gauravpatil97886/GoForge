# Repository Structure

This repository is organized to teach Go from fundamentals to advanced topics in a logical progression.

## Directory Structure

```
Go-Learning/
├── README.md                          # Main guide & table of contents
├── quick-reference.md                 # Cheat sheet for quick lookup
├── common-pitfalls.md                 # Common mistakes & solutions
├── tools-commands.md                  # Go tools and commands
│
├── 01-foundations/                    # Start here
│   ├── 01-getting-started.md         # Installation & setup
│   ├── 02-syntax-types.md            # Variables, types, collections
│   ├── 03-functions-methods.md       # Functions, methods, closures
│   ├── 04-interfaces.md              # Interfaces & polymorphism
│   └── 05-error-handling.md          # Error patterns
│
├── 02-intermediate/                   # Build on fundamentals
│   ├── 01-packages-modules.md        # Packages & go.mod
│   ├── 02-pointers-memory.md         # Pointers, memory management
│   ├── 03-structs-embedding.md       # Struct composition
│   ├── 04-collections.md             # Slices, arrays deep dive
│   └── 05-maps.md                    # Maps & data structures
│
├── 03-concurrency/                    # Go's superpower! ⭐
│   ├── 01-foundations.md             # Goroutines & channels intro
│   ├── 02-goroutines.md              # Deep dive into goroutines
│   ├── 03-channels.md                # Channel patterns
│   ├── 04-scheduler.md               # GMP scheduler explained
│   ├── 05-synchronization.md         # Mutexes, atomics, sync primitives
│   ├── 06-advanced-patterns.md       # Complex concurrent patterns
│   └── CONCURRENCY_GUIDE.md          # Complete concurrency reference
│
├── 04-advanced/                       # Advanced topics
│   ├── 01-reflection.md              # Reflection API
│   ├── 02-memory-gc.md               # Memory management, GC
│   ├── 03-context.md                 # Context package deep dive
│   ├── 04-testing.md                 # Testing, benchmarking
│   └── 05-performance.md             # Optimization techniques
│
├── 05-applications/                   # Real-world usage
│   ├── 01-web-services.md            # Building web services
│   ├── 02-databases.md               # Database integration
│   ├── 03-rest-apis.md               # REST API design
│   └── 04-microservices.md           # Microservices patterns
│
├── interview-prep/                    # Interview preparation
│   ├── beginner.md                   # Beginner questions
│   ├── intermediate.md               # Intermediate questions
│   ├── advanced.md                   # Advanced questions
│   └── concurrency-interviews.md     # Deep concurrency Qs
│
└── examples/                          # Code examples (to be created)
    ├── hello-world/
    ├── goroutine-pool/
    ├── web-server/
    └── ...
```

## Reading Order by Goal

### Goal: Learn Go Basics
1. 01-foundations/ (all files, in order)
2. quick-reference.md (bookmark for lookup)
3. common-pitfalls.md (learn what to avoid)

### Goal: Master Concurrency
1. Review 01-foundations/ quickly
2. 03-concurrency/CONCURRENCY_GUIDE.md (comprehensive)
3. interview-prep/concurrency-interviews.md (deep questions)
4. examples/ (run code examples)

### Goal: Prepare for Interviews
1. All of 01-foundations/
2. 02-intermediate/ (skim)
3. 03-concurrency/ (deep study)
4. interview-prep/ (all files)
5. common-pitfalls.md (repeatedly)

### Goal: Build Production Applications
1. 01-foundations + 02-intermediate (quick review)
2. 03-concurrency (master it)
3. 04-advanced (all files)
4. 05-applications (specific needs)
5. tools-commands.md (reference)

## How to Use This Repo

- **Read sequentially** for concepts you're learning
- **Use quick-reference.md** when you need to look something up
- **Study interview-prep/** before interviews
- **Reference common-pitfalls.md** when debugging
- **Run examples/** to see patterns in action
- **Skip sections** you already know well

## Tips for Learning

1. **Type the code** - don't copy/paste
2. **Modify examples** - change values, break things, fix them
3. **Use `-race`** - `go test -race ./...` catches concurrency bugs
4. **Use `go vet`** - catches common mistakes
5. **Run tests** - write tests for each concept
6. **Read real code** - study stdlib implementations

## Key Concepts by Level

| Level | Focus | Key Concepts |
|-------|-------|--------------|
| Foundations | Basics | Variables, types, functions, interfaces, errors |
| Intermediate | Structure | Packages, pointers, structs, collections |
| Concurrency | Go's Strength | Goroutines, channels, scheduler, patterns |
| Advanced | Depth | Reflection, memory, context, testing, perf |
| Applications | Real-world | Web, databases, APIs, microservices |

## When to Use Each File

- **README.md** - Start here, table of contents
- **quick-reference.md** - During coding, fast lookup
- **common-pitfalls.md** - When debugging
- **CONCURRENCY_GUIDE.md** - Deepest concurrency knowledge
- **interview-prep/** - Before interviews or to test knowledge
- **tools-commands.md** - When you need to build/test/deploy

---

Good luck with your Go learning journey! 🚀
