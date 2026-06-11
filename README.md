<div align="center">

<img src="https://img.shields.io/badge/Go-1.25+-00ACD7?style=for-the-badge&logo=go&logoColor=white" alt="Go Version"/>
<img src="https://img.shields.io/badge/Status-Active-F5C000?style=for-the-badge" alt="Status"/>
<img src="https://img.shields.io/badge/License-MIT-34D058?style=for-the-badge" alt="License"/>
<img src="https://img.shields.io/badge/Platform-GoForge-FF6B3C?style=for-the-badge" alt="GoForge"/>
<img src="https://img.shields.io/github/stars/gauravpatil97886/GoForge?style=for-the-badge&color=C084FC" alt="Stars"/>

# GoForge

### *Forge Your Go Mastery — From Zero to Production*

**The most comprehensive Go learning platform on GitHub.**  
Theory + Practice + Interview Prep, all in one place.

[**Launch Platform →**](https://gauravpatil97886.github.io/GoForge/) · [**Browse Topics**](#topics) · [**Practice Questions**](#coding-practice) · [**Interview Prep**](#interview-prep)

---

</div>

## What Is GoForge?

GoForge is a **self-hosted, browser-based learning platform** for Go (Golang). It runs entirely as a static site — no backend, no build step — and is deployed for free on GitHub Pages.

Every topic opens with **why it exists**, **who uses it in industry**, and **what makes Go's approach unique** before showing a single line of code. Then it walks you from beginner syntax all the way to production-grade patterns.

```
Learn Concept → Understand Why → Basic Code → Medium Problems →
Advanced Patterns → Interview Questions → Production Scenarios → Company Style Questions
```

---

## Topics

### Foundations
| Topic | Level | What You'll Learn |
|-------|-------|-------------------|
| Getting Started | Beginner | Go toolchain, workspace, modules, first program |
| Variables & Types | Beginner | All types, zero values, type inference, constants |
| Functions & Methods | Beginner-Intermediate | First-class functions, receivers, variadic, defer |
| Interfaces | Intermediate | Duck typing, composition, implicit satisfaction |
| Error Handling | Intermediate | `error` interface, wrapping, sentinel errors, custom types |
| Control Flow | Beginner | for loops (the only loop), switch, labels, goto |
| Closures | Intermediate | Capture mechanics, function factories, common pitfalls |
| Strings & Runes | Beginner | UTF-8 internals, rune vs byte, string manipulation |

### Intermediate
| Topic | Level | What You'll Learn |
|-------|-------|-------------------|
| Packages & Modules | Intermediate | go.mod, visibility, init(), circular deps |
| Pointers & Memory | Intermediate | Stack vs heap, escape analysis, when to use pointers |
| Structs & Embedding | Intermediate | Struct composition, promoted fields, method sets |
| Arrays & Slices | Intermediate | Internals, three-index slices, copy semantics, pitfalls |
| Maps | Intermediate | Internals, nil map, concurrent safety, patterns |
| Type System | Advanced | Type aliases vs definitions, assertions, generics intro |

### Concurrency
| Topic | Level | What You'll Learn |
|-------|-------|-------------------|
| Goroutines | Intermediate | GMP scheduler, goroutine lifecycle, leaks |
| Channels | Intermediate | Buffered, unbuffered, direction, closing patterns |
| Select | Advanced | Multi-channel select, timeouts, fan-in |
| Sync Primitives | Advanced | Mutex, RWMutex, WaitGroup, Once, Cond |
| Atomic Operations | Advanced | Lock-free programming, memory ordering |
| Context | Advanced | Cancellation trees, deadlines, value propagation |
| Advanced Patterns | Production | Worker pools, pipelines, rate limiters, circuit breakers |

### Advanced
| Topic | Level | What You'll Learn |
|-------|-------|-------------------|
| Generics | Advanced | Type parameters, constraints, type inference, patterns |
| Reflection | Advanced | `reflect` package, use cases, performance tradeoffs |
| Testing & Benchmarking | Advanced | Table tests, subtests, fuzz, benchmarks, testcontainers |
| Memory & GC | Advanced | GC internals, escape analysis, pprof, memory profiles |
| Performance | Production | CPU profiling, optimization patterns, zero-alloc techniques |

### Applications
| Topic | Level | What You'll Learn |
|-------|-------|-------------------|
| HTTP & Web | Intermediate | `net/http`, middleware, routing, WebSockets |
| REST APIs | Advanced | RESTful design, validation, authentication, versioning |
| Databases | Advanced | `database/sql`, connection pools, migrations, GORM |
| Microservices | Production | gRPC, service discovery, distributed tracing |
| CLI Tools | Intermediate | `cobra`, `flag`, config management, shell integration |

### Patterns
| Pattern | Description |
|---------|-------------|
| Design Patterns | All 23 GoF patterns implemented in idiomatic Go |
| Concurrency Patterns | Worker Pool, Fan-In/Out, Pipeline, Pub-Sub, Singleflight |
| Error Patterns | Sentinel, typed, wrapped, functional error handling |
| Functional Patterns | Options pattern, builders, functional options |

---

## Coding Practice

**800+ structured questions** across 6 difficulty levels.

| Level | Name | Description |
|-------|------|-------------|
| L1 | Beginner | Basic syntax, types, simple programs |
| L2 | Easy | Small problem solving, simple data structures |
| L3 | Medium | Algorithm thinking, logic building |
| L4 | Advanced | Real-world patterns, system design components |
| L5 | Interview | Frequently asked at FAANG/unicorns |
| L6 | Production | Real engineering problems at scale |

Every question includes:
- Problem statement with constraints
- Step-by-step thought process (how an engineer thinks)
- Brute force → Better → Optimal solution with complexity
- Production considerations (scale, edge cases, memory)
- Mermaid visual diagram (Level 3+)
- 7 interviewer follow-up questions
- 5 deep-dive Q&A

### Practice Coverage

```
coding-practice/
├── foundations/
│   ├── 01-variables-types.md       (20 questions, L1-L5)
│   ├── 02-functions-closures.md    (20 questions, L1-L5)
│   ├── 03-interfaces.md            (30 questions, L1-L6)
│   └── 04-error-handling.md        (20 questions, L1-L6)
├── intermediate/
│   ├── 01-arrays-slices.md         (30 questions, L1-L6)
│   ├── 02-maps.md                  (25 questions, L1-L6)
│   └── 03-structs.md               (25 questions, L1-L6)
├── concurrency/
│   ├── 01-goroutines.md            (35 questions, L1-L6)
│   ├── 02-channels.md              (50+ questions, L1-L6)
│   ├── 03-sync-primitives.md       (25 questions, L1-L6)
│   ├── 04-context.md               (25 questions, L1-L6)
│   └── 05-patterns.md              (50+ questions, L1-L6)
├── advanced/
│   ├── 01-generics.md              (25 questions, L1-L6)
│   └── 02-testing.md               (25 questions, L1-L6)
└── applications/
    ├── 01-http-apis.md             (50+ questions, L2-L6)
    └── 02-databases.md             (50+ questions, L2-L6)
```

---

## Interview Prep

| File | Coverage |
|------|---------|
| `beginner.md` | 50 Go fundamentals questions (types, syntax, gotchas) |
| `intermediate.md` | 50 questions on data structures, concurrency, interfaces |
| `advanced.md` | 50 questions on GMP, memory, generics, system design |
| `company-google.md` | Google-style algorithms + scale questions |
| `company-uber.md` | Uber-style real-time + geospatial systems |
| `company-stripe.md` | Stripe-style payment reliability + correctness |
| `concurrency-interviews.md` | Dedicated concurrency interview deep-dive |

---

## CTC-Wise Preparation

Band-by-band roadmaps for cracking Go roles at every salary level:

| Guide | Target |
|-------|--------|
| `ctc-prep/roadmap.md` | The 4 CTC bands, skill matrix, company comparison, sprint plans |
| `ctc-prep/10-15-lpa.md` | Service companies & startups — fundamentals, 50 DSA problems, 30-day plan |
| `ctc-prep/15-25-lpa.md` | PhonePe, CRED, Razorpay tier — GMP internals, system design, full interview sim |
| `ctc-prep/25-plus-lpa.md` | FAANG senior/staff — runtime internals, distributed systems, 90-day plan |

## System Design

Full case studies with Go implementations:

| File | Coverage |
|------|---------|
| `system-design/01-fundamentals.md` | 5-step framework, scalability, CAP, consistency, load balancing |
| `system-design/02-databases-storage.md` | PostgreSQL, Redis, sharding, consistent hashing, CQRS |
| `system-design/03-caching-messaging.md` | Cache patterns, singleflight, Kafka, outbox, DLQ |
| `system-design/04-case-studies.md` | URL shortener, rate limiter, notifications, distributed cache, scheduler |

## DSA in Go

100 LeetCode-style problems with complete idiomatic Go solutions:

| File | Problems |
|------|---------|
| `dsa-go/01-arrays-strings.md` | Two-sum family, sliding window, strings, matrix (25) |
| `dsa-go/02-trees-graphs.md` | Trees, BST, BFS/DFS, Dijkstra, Trie, Union-Find (25) |
| `dsa-go/03-dynamic-programming.md` | 1D/2D/interval/tree DP, knapsack, LIS (25) |
| `dsa-go/04-concurrency-ds.md` | Thread-safe structures, heap, monotonic stack, build-from-scratch (25) |

---

## Features

| Feature | Details |
|---------|---------|
| Dark / Light Mode | Golden dark theme + clean paper light theme, persisted |
| Full-text Search | `Ctrl+K` — instant search across all 63+ topics |
| Progress Tracking | Check off topics as you complete them, persisted locally |
| Bookmarks | Bookmark any topic, accessible from the sidebar |
| Responsive | Mobile, tablet, desktop — all breakpoints handled |
| Auto TOC | Table of contents auto-generated, highlights current section |
| Reading Progress | Bar at top shows position in the current topic |
| Keyboard Shortcuts | `Ctrl+K` search, `←/→` prev/next topic |
| Stats Dashboard | See your overall progress across all categories |
| Mermaid Diagrams | Architecture and flow diagrams rendered inline |
| Syntax Highlighting | All Go code blocks highlighted with dark/light theme |

---

## Running Locally

GitHub Pages serves files over HTTP so `fetch()` works. For local development, you need a local HTTP server (browsers block `fetch()` on `file://`):

```bash
# Option 1: Python (no install needed)
cd /path/to/GoForge
python3 -m http.server 8080
# Open: http://localhost:8080

# Option 2: Node.js
npx serve .

# Option 3: VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

---

## Deployment

Deploys automatically to GitHub Pages on every push to `main`.

- **URL:** `https://gauravpatil97886.github.io/GoForge/`
- **Build:** No build step — pure HTML/CSS/JS (`.nojekyll` disables Jekyll)
- **CDN:** marked.js, highlight.js, mermaid.js loaded from CDN at runtime

---

## Tech Stack

```
Frontend:  HTML5, CSS3 (CSS Variables, Grid, Flexbox), Vanilla JS (ES2020+)
Rendering: marked.js (Markdown), highlight.js (syntax), mermaid.js (diagrams)
Storage:   localStorage (progress, bookmarks, theme, recent topics)
Routing:   Hash-based (#topic-path) for shareable deep links
Hosting:   GitHub Pages (static, free, zero cost)
```

---

## Contributing

1. Fork the repository
2. Add or improve a topic in the relevant directory
3. Follow the content format: Why → What → Industry → Code → Practice
4. Open a pull request

Content guidelines are in `STRUCTURE.md`.

---

<div align="center">

**© 2026 Gaurav Patil — GoForge Platform. All Rights Reserved.**

Built with Go's philosophy: simple, clear, and practical.

[Back to top](#-goforge)

</div>
