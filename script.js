/* ═══════════════════════════════════════════════════════════════
   GoForge — script.js
   "Forge Your Go Mastery"
   Full SPA: markdown rendering, sidebar navigation, search,
   theme toggling, progress tracking, bookmarks, hash routing,
   table of contents, reading progress, stats modal.
   © 2024 Gaurav Patil — GoForge Platform. All Rights Reserved.
   ═══════════════════════════════════════════════════════════════ */

/* ── PLATFORM CONFIG ─────────────────────────────────────────── */
const PLATFORM = {
  name:      'GoForge',
  tagline:   'Forge Your Go Mastery',
  version:   '2.0',
  copyright: '© 2024 Gaurav Patil — GoForge Platform. All Rights Reserved.',
};

/* ── NAVIGATION DATA ─────────────────────────────────────────── */
const NAVIGATION = [
  { id: 'foundations', title: 'Foundations', emoji: '🏗', color: '#00ACD7',
    desc: 'Variables, types, functions, interfaces & error handling.',
    topics: [
      { title: 'Getting Started',     path: '01-foundations/01-getting-started.md' },
      { title: 'Variables & Types',   path: '01-foundations/02-variables-types.md' },
      { title: 'Functions & Methods', path: '01-foundations/03-functions-methods.md' },
      { title: 'Interfaces',          path: '01-foundations/04-interfaces.md' },
      { title: 'Error Handling',      path: '01-foundations/05-error-handling.md' },
      { title: 'Control Flow',        path: '01-foundations/06-control-flow.md' },
      { title: 'Closures',            path: '01-foundations/07-closures.md' },
      { title: 'Strings & Runes',     path: '01-foundations/08-strings-runes.md' },
    ]},
  { id: 'intermediate', title: 'Intermediate', emoji: '⚙️', color: '#7c3aed',
    desc: 'Packages, pointers, structs, slices, maps & type system.',
    topics: [
      { title: 'Packages & Modules',  path: '02-intermediate/01-packages-modules.md' },
      { title: 'Pointers & Memory',   path: '02-intermediate/02-pointers-memory.md' },
      { title: 'Structs & Embedding', path: '02-intermediate/03-structs-embedding.md' },
      { title: 'Arrays & Slices',     path: '02-intermediate/04-arrays-slices.md' },
      { title: 'Maps',                path: '02-intermediate/05-maps.md' },
      { title: 'Type System',         path: '02-intermediate/06-type-system.md' },
    ]},
  { id: 'concurrency', title: 'Concurrency', emoji: '⚡', color: '#f59e0b',
    desc: 'Goroutines, channels, select, sync primitives & context.',
    topics: [
      { title: 'Concurrency Basics',  path: '03-concurrency/01-foundations.md' },
      { title: 'Goroutines',          path: '03-concurrency/02-goroutines.md' },
      { title: 'Channels',            path: '03-concurrency/03-channels.md' },
      { title: 'Select Statement',    path: '03-concurrency/04-select.md' },
      { title: 'Sync Primitives',     path: '03-concurrency/05-sync-primitives.md' },
      { title: 'Atomic Operations',   path: '03-concurrency/06-atomic.md' },
      { title: 'Context Package',     path: '03-concurrency/07-context.md' },
      { title: 'Advanced Patterns',   path: '03-concurrency/08-advanced-patterns.md' },
    ]},
  { id: 'advanced', title: 'Advanced', emoji: '🔬', color: '#10b981',
    desc: 'Generics, reflection, testing, memory & performance.',
    topics: [
      { title: 'Generics',                 path: '04-advanced/01-generics.md' },
      { title: 'Reflection',               path: '04-advanced/02-reflection.md' },
      { title: 'Testing & Benchmarking',   path: '04-advanced/03-testing-benchmarking.md' },
      { title: 'Memory & GC',              path: '04-advanced/04-memory-gc.md' },
      { title: 'Performance',              path: '04-advanced/05-performance.md' },
    ]},
  { id: 'applications', title: 'Applications', emoji: '🌐', color: '#ef4444',
    desc: 'HTTP servers, REST APIs, databases, microservices & CLI.',
    topics: [
      { title: 'HTTP & Web Servers', path: '05-applications/01-http-web.md' },
      { title: 'REST API Design',    path: '05-applications/02-rest-api.md' },
      { title: 'Databases',          path: '05-applications/03-databases.md' },
      { title: 'Microservices',      path: '05-applications/04-microservices.md' },
      { title: 'CLI Tools',          path: '05-applications/05-cli-tools.md' },
    ]},
  { id: 'patterns', title: 'Patterns', emoji: '🎨', color: '#8b5cf6',
    desc: 'Design patterns, concurrency patterns & functional style.',
    topics: [
      { title: 'Design Patterns',       path: '06-patterns/01-design-patterns.md' },
      { title: 'Concurrency Patterns',  path: '06-patterns/02-concurrency-patterns.md' },
      { title: 'Error Patterns',        path: '06-patterns/03-error-patterns.md' },
      { title: 'Functional Patterns',   path: '06-patterns/04-functional-patterns.md' },
    ]},
  { id: 'practice', title: 'Practice', emoji: '💻', color: '#06b6d4',
    desc: 'Hands-on coding exercises at every difficulty level.',
    topics: [
      { title: 'Variables & Types',        path: 'coding-practice/foundations/01-variables-types.md', level: 'mixed' },
      { title: 'Functions & Closures',     path: 'coding-practice/foundations/02-functions-closures.md', level: 'mixed' },
      { title: 'Interfaces Practice',      path: 'coding-practice/foundations/03-interfaces.md', level: 'mixed' },
      { title: 'Error Handling Practice',  path: 'coding-practice/foundations/04-error-handling.md', level: 'mixed' },
      { title: 'Arrays & Slices',          path: 'coding-practice/intermediate/01-arrays-slices.md', level: 'mixed' },
      { title: 'Maps Practice',            path: 'coding-practice/intermediate/02-maps.md', level: 'mixed' },
      { title: 'Structs Practice',         path: 'coding-practice/intermediate/03-structs.md', level: 'mixed' },
      { title: 'Goroutines Practice',      path: 'coding-practice/concurrency/01-goroutines.md', level: 'mixed' },
      { title: 'Channels Practice',        path: 'coding-practice/concurrency/02-channels.md', level: 'mixed' },
      { title: 'Sync Primitives',          path: 'coding-practice/concurrency/03-sync-primitives.md', level: 'mixed' },
      { title: 'Context Practice',         path: 'coding-practice/concurrency/04-context.md', level: 'mixed' },
      { title: 'Concurrency Patterns',     path: 'coding-practice/concurrency/05-patterns.md', level: 'mixed' },
      { title: 'Generics Practice',        path: 'coding-practice/advanced/01-generics.md', level: 'mixed' },
      { title: 'Testing Practice',         path: 'coding-practice/advanced/02-testing.md', level: 'mixed' },
      { title: 'HTTP APIs Practice',       path: 'coding-practice/applications/01-http-apis.md', level: 'mixed' },
      { title: 'Databases Practice',       path: 'coding-practice/applications/02-databases.md', level: 'mixed' },
    ]},
  { id: 'interview', title: 'Interview', emoji: '🎯', color: '#f97316',
    desc: 'Google, Uber, Stripe-style Q&A and system design challenges.',
    topics: [
      { title: 'Beginner Q&A',           path: 'interview-prep/beginner.md',                level: 'beginner' },
      { title: 'Intermediate Q&A',       path: 'interview-prep/intermediate.md',            level: 'intermediate' },
      { title: 'Advanced Q&A',           path: 'interview-prep/advanced.md',                level: 'advanced' },
      { title: 'Concurrency Interviews', path: 'interview-prep/concurrency-interviews.md',  level: 'advanced' },
      { title: 'Google Style',           path: 'interview-prep/company-google.md',          level: 'advanced' },
      { title: 'Uber Style',             path: 'interview-prep/company-uber.md',            level: 'advanced' },
      { title: 'Stripe Style',           path: 'interview-prep/company-stripe.md',          level: 'advanced' },
    ]},
];

/* ── APP STATE ───────────────────────────────────────────────── */
const STATE = {
  currentPath:    null,
  progress:       {},
  bookmarks:      [],
  recentTopics:   [],
  searchOpen:     false,
  sidebarOpen:    false,
  searchSelected: -1,
  searchIndex:    [],
  theme:          'dark',
  tocObserver:    null,
};

/* ── LOCAL STORAGE KEYS ──────────────────────────────────────── */
const KEYS = {
  progress:  'gf-progress-v2',
  bookmarks: 'gf-bookmarks-v2',
  recent:    'gf-recent-v2',
  theme:     'gf-theme-v1',
};

/* ══════════════════════════════════════════════════════════════
   INITIALIZATION
   ══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  loadPersistedState();
  initLibraries();
  buildSearchIndex();
  renderNav();
  bindEventListeners();
  handleInitialRoute();
});

/** Restore state from localStorage */
function loadPersistedState() {
  // Progress
  try {
    const p = JSON.parse(localStorage.getItem(KEYS.progress) || '{}');
    STATE.progress = (p && typeof p === 'object') ? p : {};
  } catch { STATE.progress = {}; }

  // Bookmarks
  try {
    const b = JSON.parse(localStorage.getItem(KEYS.bookmarks) || '[]');
    STATE.bookmarks = Array.isArray(b) ? b : [];
  } catch { STATE.bookmarks = []; }

  // Recent topics
  try {
    const r = JSON.parse(localStorage.getItem(KEYS.recent) || '[]');
    STATE.recentTopics = Array.isArray(r) ? r : [];
  } catch { STATE.recentTopics = []; }

  // Theme: saved → system preference → dark
  const savedTheme = localStorage.getItem(KEYS.theme);
  if (savedTheme === 'light' || savedTheme === 'dark') {
    STATE.theme = savedTheme;
  } else {
    STATE.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(STATE.theme, false);
}

/** Configure marked.js and mermaid */
function initLibraries() {
  // Custom marked renderer — intercept code blocks for mermaid + copy buttons
  const renderer = new marked.Renderer();

  renderer.code = function (code, lang) {
    // Mermaid diagrams
    if (lang === 'mermaid') {
      return `<div class="mermaid-wrap"><div class="mermaid">${escapeHtml(code)}</div></div>`;
    }
    // Syntax highlighted code block
    let highlighted;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } else {
        highlighted = hljs.highlightAuto(code).value;
      }
    } catch {
      highlighted = escapeHtml(code);
    }
    const langLabel = lang || 'text';
    const safeCode  = escapeAttr(code);
    return `<pre><div class="code-block-chrome">
      <span class="code-lang">${escapeHtml(langLabel)}</span>
      <button class="copy-btn" data-raw="${safeCode}" onclick="handleCopyBtn(this)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      </button>
    </div><code class="hljs language-${escapeHtml(langLabel)}">${highlighted}</code></pre>`;
  };

  // Heading renderer: add id anchors for TOC
  renderer.heading = function (text, level) {
    const slug = slugify(text);
    return `<h${level} id="${slug}">${text}</h${level}>`;
  };

  marked.use({ renderer, gfm: true, breaks: false });

  // Mermaid
  mermaid.initialize({
    startOnLoad:   false,
    theme:         STATE.theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily:    'JetBrains Mono, monospace',
    themeVariables: {
      background:     '#1a2236',
      primaryColor:   '#1a2236',
      primaryBorderColor: '#00ACD7',
      lineColor:      '#00ACD7',
      fontFamily:     'JetBrains Mono, monospace',
    },
  });
}

/** Build flat search index from NAVIGATION */
function buildSearchIndex() {
  STATE.searchIndex = [];
  for (const section of NAVIGATION) {
    for (const topic of section.topics) {
      STATE.searchIndex.push({
        title:     topic.title,
        path:      topic.path,
        section:   section.title,
        sectionId: section.id,
        emoji:     section.emoji,
        color:     section.color,
        level:     topic.level || null,
      });
    }
  }
}

/** Handle initial URL hash or show welcome */
function handleInitialRoute() {
  const hash = location.hash.slice(1);
  if (hash) {
    const match = STATE.searchIndex.find(t => t.path === hash);
    if (match) {
      loadTopic(match.path, false);
      return;
    }
  }
  showWelcome();
}

/* ══════════════════════════════════════════════════════════════
   NAVIGATION RENDERING
   ══════════════════════════════════════════════════════════════ */

/** Build the full sidebar nav tree */
function renderNav() {
  const nav = document.getElementById('nav-tree');
  if (!nav) return;
  nav.innerHTML = '';
  for (const section of NAVIGATION) {
    nav.appendChild(buildSectionEl(section));
  }
  updateProgressDisplay();
  updateSidebarStats();
}

/** Create a collapsible sidebar section */
function buildSectionEl(section) {
  const wrapper  = document.createElement('div');
  wrapper.className = 'nav-section';
  wrapper.dataset.id = section.id;

  const hasActive = section.topics.some(t => t.path === STATE.currentPath);
  if (hasActive) wrapper.classList.add('open');

  // Section header
  const header = document.createElement('div');
  header.className = 'nav-section-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', String(hasActive));
  header.innerHTML = `
    <span class="nav-section-dot" style="background:${section.color};color:${section.color}"></span>
    <span class="nav-section-emoji">${section.emoji}</span>
    <span class="nav-section-title">${escapeHtml(section.title)}</span>
    <span class="nav-section-count">${section.topics.length}</span>
    <svg class="nav-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="m9 18 6-6-6-6"/>
    </svg>`;

  header.addEventListener('click', () => toggleSection(wrapper));
  header.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(wrapper); }
  });

  // Topics list
  const topicList = document.createElement('div');
  topicList.className = 'nav-topics';
  topicList.style.display = hasActive ? 'block' : 'none';

  for (const topic of section.topics) {
    topicList.appendChild(buildTopicItem(topic));
  }

  wrapper.appendChild(header);
  wrapper.appendChild(topicList);
  return wrapper;
}

/** Build a single nav topic item */
function buildTopicItem(topic) {
  const item = document.createElement('div');
  item.className = 'nav-topic' + (topic.path === STATE.currentPath ? ' active' : '');
  item.dataset.path = topic.path;
  item.setAttribute('role', 'treeitem');
  item.setAttribute('tabindex', '0');
  item.setAttribute('aria-label', topic.title);

  const isDone = !!STATE.progress[topic.path];
  item.innerHTML = `
    <input type="checkbox" class="nav-checkbox" ${isDone ? 'checked' : ''}
      aria-label="Mark '${escapeAttr(topic.title)}' complete"
      data-path="${escapeAttr(topic.path)}" />
    <span class="nav-topic-title">${escapeHtml(topic.title)}</span>`;

  item.addEventListener('click', e => {
    if (e.target.classList.contains('nav-checkbox')) return;
    loadTopic(topic.path);
    if (window.innerWidth <= 1024) closeSidebar();
  });
  item.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadTopic(topic.path);
  });

  const cb = item.querySelector('.nav-checkbox');
  cb.addEventListener('change', e => {
    e.stopPropagation();
    toggleProgress(topic.path, cb.checked);
  });

  return item;
}

/** Toggle section open/closed */
function toggleSection(wrapper) {
  const isOpen    = wrapper.classList.contains('open');
  const topicList = wrapper.querySelector('.nav-topics');
  const header    = wrapper.querySelector('.nav-section-header');
  wrapper.classList.toggle('open', !isOpen);
  topicList.style.display = isOpen ? 'none' : 'block';
  header.setAttribute('aria-expanded', String(!isOpen));
}

/** Update which nav item is highlighted as active */
function updateActiveNav(path) {
  document.querySelectorAll('.nav-topic').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });

  if (!path) return;
  const item = document.querySelector(`.nav-topic[data-path="${CSS.escape(path)}"]`);
  if (item) {
    const section = item.closest('.nav-section');
    if (section && !section.classList.contains('open')) toggleSection(section);
    setTimeout(() => item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 120);
  }
}

/** Filter nav items by query string */
function filterSidebar(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.nav-section').forEach(section => {
    const items = section.querySelectorAll('.nav-topic');
    let visible = 0;
    items.forEach(item => {
      const title = item.querySelector('.nav-topic-title').textContent.toLowerCase();
      const match = !q || title.includes(q);
      item.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    section.style.display = (visible === 0 && q) ? 'none' : '';
    if (q && visible > 0) {
      section.querySelector('.nav-topics').style.display = 'block';
      section.classList.add('open');
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   TOPIC LOADING & RENDERING
   ══════════════════════════════════════════════════════════════ */

/** Load a markdown topic by file path */
async function loadTopic(path, pushHistory = true) {
  STATE.currentPath = path;

  if (pushHistory) {
    history.pushState({ path }, '', `#${path}`);
  } else {
    history.replaceState({ path }, '', `#${path}`);
  }

  showPanel('loading');
  trackRecent(path);
  updateActiveNav(path);

  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    await renderMarkdown(md, path);
  } catch (err) {
    console.warn('GoForge: failed to load topic:', path, err.message);
    showPanel('error');
    const errEl = document.getElementById('error-message');
    if (errEl) errEl.textContent = `"${path}" could not be loaded. This topic may not exist yet — check back soon!`;
  }
}

/** Parse and inject markdown into the DOM */
async function renderMarkdown(markdown, path) {
  const body = document.getElementById('markdown-body');
  body.innerHTML = marked.parse(markdown);

  // Highlight any remaining unhighlighted code blocks
  document.querySelectorAll('#markdown-body pre code:not(.hljs)').forEach(block => {
    hljs.highlightElement(block);
  });

  // Render mermaid diagrams
  await renderMermaidDiagrams();

  // Add copy buttons to code blocks that don't have them
  addCopyButtons();

  // Breadcrumb
  updateBreadcrumb(path);

  // Topic meta (reading time, level)
  updateTopicMeta(markdown, path);

  // Footer prev/next
  renderFooterNav(path);

  // TOC
  generateTOC();

  // Bookmark state
  updateBookmarkBtn(path);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Reading progress
  setupReadingProgress();

  showPanel('content');
}

/** Run mermaid on all .mermaid elements */
async function renderMermaidDiagrams() {
  const nodes = document.querySelectorAll('#markdown-body .mermaid');
  if (!nodes.length) return;
  try {
    await mermaid.run({ nodes });
  } catch (e) { /* mermaid errors are non-fatal */ }
}

/** Add copy buttons to any pre blocks without chrome */
function addCopyButtons() {
  document.querySelectorAll('#markdown-body pre').forEach(pre => {
    if (pre.querySelector('.code-block-chrome')) return;
    const code = pre.querySelector('code');
    if (!code) return;

    const rawText = code.textContent || '';
    const langClass = [...code.classList].find(c => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : 'code';

    const chrome = document.createElement('div');
    chrome.className = 'code-block-chrome';
    chrome.innerHTML = `
      <span class="code-lang">${escapeHtml(lang)}</span>
      <button class="copy-btn" data-raw="${escapeAttr(rawText)}" onclick="handleCopyBtn(this)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      </button>`;
    pre.insertBefore(chrome, pre.firstChild);
    if (code) code.style.paddingTop = '46px';
  });
}

/** Handle copy button click */
async function handleCopyBtn(btn) {
  const text = btn.dataset.raw || btn.closest('pre')?.querySelector('code')?.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Copied!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy`;
    }, 2200);
  } catch {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
  }
}

/** Update breadcrumb trail */
function updateBreadcrumb(path) {
  const entry = STATE.searchIndex.find(t => t.path === path);
  const secEl = document.getElementById('breadcrumb-section');
  const topEl = document.getElementById('breadcrumb-topic');
  if (secEl) secEl.textContent = entry ? entry.section : '';
  if (topEl) topEl.textContent = entry ? entry.title : '';
}

/** Update topic meta bar (reading time, level badge) */
function updateTopicMeta(markdown, path) {
  const timeEl  = document.getElementById('meta-time');
  const levelEl = document.getElementById('meta-level');
  const entry   = STATE.searchIndex.find(t => t.path === path);

  // Estimate reading time
  const mins = estimateReadTime(markdown);
  if (timeEl) {
    timeEl.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${mins} min read`;
  }

  // Level badge
  if (levelEl) {
    const level = entry?.level;
    const levelMap = {
      beginner:     { label: 'Beginner',     color: 'var(--l1)' },
      easy:         { label: 'Easy',         color: 'var(--l2)' },
      medium:       { label: 'Medium',       color: 'var(--l3)' },
      advanced:     { label: 'Advanced',     color: 'var(--l4)' },
      interview:    { label: 'Interview',    color: 'var(--l5)' },
      production:   { label: 'Production',   color: 'var(--l6)' },
      intermediate: { label: 'Intermediate', color: 'var(--l3)' },
      mixed:        { label: 'Mixed',        color: 'var(--accent)' },
    };
    if (level && levelMap[level]) {
      const { label, color } = levelMap[level];
      levelEl.textContent = label;
      levelEl.style.color = color;
      levelEl.style.borderColor = color;
      levelEl.style.background = `${color}18`;
      levelEl.style.display = '';
    } else {
      levelEl.style.display = 'none';
    }
  }

  // Mark done button
  updateMarkDoneBtn();
}

/** Estimate reading time (words ÷ 200) */
function estimateReadTime(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Render prev/next topic navigation */
function renderFooterNav(path) {
  const flat = STATE.searchIndex;
  const idx  = flat.findIndex(t => t.path === path);

  const prevBtn   = document.getElementById('prev-btn');
  const nextBtn   = document.getElementById('next-btn');
  const prevTitle = document.getElementById('prev-title');
  const nextTitle = document.getElementById('next-title');

  const prev = flat[idx - 1];
  const next = flat[idx + 1];

  if (prevBtn) {
    prevBtn.style.visibility = prev ? 'visible' : 'hidden';
    if (prev && prevTitle) {
      prevTitle.textContent = prev.title;
      prevBtn.onclick = () => loadTopic(prev.path);
    }
  }
  if (nextBtn) {
    nextBtn.style.visibility = next ? 'visible' : 'hidden';
    if (next && nextTitle) {
      nextTitle.textContent = next.title;
      nextBtn.onclick = () => loadTopic(next.path);
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   TABLE OF CONTENTS
   ══════════════════════════════════════════════════════════════ */

/** Generate TOC from h2/h3 headings in rendered content */
function generateTOC() {
  const toc    = document.getElementById('toc');
  const tocNav = document.getElementById('toc-nav');
  if (!toc || !tocNav) return;

  // Disconnect previous observer
  if (STATE.tocObserver) { STATE.tocObserver.disconnect(); STATE.tocObserver = null; }

  const headings = [...document.querySelectorAll('#markdown-body h2, #markdown-body h3')];

  if (headings.length < 3) {
    toc.hidden = true;
    return;
  }

  tocNav.innerHTML = headings.map(h => {
    const isH3    = h.tagName === 'H3';
    const id      = h.id || slugify(h.textContent);
    if (!h.id) h.id = id;
    return `<a href="#${id}" class="toc-link${isH3 ? ' toc-h3' : ''}" data-id="${id}"
      onclick="event.preventDefault();scrollToHeading('${id}')">${escapeHtml(h.textContent)}</a>`;
  }).join('');

  toc.hidden = false;

  // IntersectionObserver to highlight active heading
  const links = tocNav.querySelectorAll('a[data-id]');
  STATE.tocObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.remove('toc-active'));
        const active = tocNav.querySelector(`a[data-id="${entry.target.id}"]`);
        if (active) active.classList.add('toc-active');
      }
    });
  }, { rootMargin: `-${58 + 16}px 0px -70% 0px`, threshold: 0 });

  headings.forEach(h => STATE.tocObserver.observe(h));
}

function scrollToHeading(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 58;
  const top = el.getBoundingClientRect().top + window.scrollY - offset - 16;
  window.scrollTo({ top, behavior: 'smooth' });
}

/* ══════════════════════════════════════════════════════════════
   READING PROGRESS
   ══════════════════════════════════════════════════════════════ */

/** Thin gradient bar that fills as the user scrolls */
function setupReadingProgress() {
  const fill = document.getElementById('reading-progress-fill');
  if (!fill) return;

  const update = () => {
    const scrollTop    = window.scrollY;
    const docHeight    = document.documentElement.scrollHeight;
    const windowHeight = window.innerHeight;
    const pct = docHeight <= windowHeight ? 100 : (scrollTop / (docHeight - windowHeight)) * 100;
    fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  };

  // Remove previous listener if any
  if (window._readingProgressHandler) {
    window.removeEventListener('scroll', window._readingProgressHandler, { passive: true });
  }
  window._readingProgressHandler = update;
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/* ══════════════════════════════════════════════════════════════
   PANEL MANAGEMENT
   ══════════════════════════════════════════════════════════════ */

function showPanel(name) {
  const welcome  = document.getElementById('welcome');
  const wrapper  = document.getElementById('content-wrapper');
  const loading  = document.getElementById('loading');
  const errorEl  = document.getElementById('error-state');

  if (welcome)  welcome.style.display  = (name === 'welcome')  ? '' : 'none';
  if (wrapper)  wrapper.style.display  = (name === 'content')  ? '' : 'none';
  if (loading)  loading.style.display  = (name === 'loading')  ? 'flex' : 'none';
  if (errorEl)  errorEl.style.display  = (name === 'error')    ? 'flex' : 'none';
}

/* ══════════════════════════════════════════════════════════════
   WELCOME SCREEN
   ══════════════════════════════════════════════════════════════ */

function showWelcome() {
  STATE.currentPath = null;
  history.replaceState({}, '', location.pathname + location.search);
  updateActiveNav(null);
  renderWelcome();
  showPanel('welcome');
  updateMarkDoneBtn();
}

/** Render the full welcome screen HTML */
function renderWelcome() {
  const container = document.getElementById('welcome');
  if (!container) return;

  const lastVisited = STATE.recentTopics.find(p => STATE.searchIndex.some(t => t.path === p));
  const lastEntry   = lastVisited ? STATE.searchIndex.find(t => t.path === lastVisited) : null;

  const { total, completed, pct } = calculateStats();

  container.innerHTML = `

    <!-- HERO -->
    <div class="welcome-hero">
      <div class="welcome-badge">
        <span class="badge-dot"></span>
        Go 1.22+ · Production Ready
      </div>
      <h1 class="hero-title">Forge Your<br><span class="gradient-text">Go Mastery</span></h1>
      <p class="hero-subtitle">
        The most comprehensive Go programming platform — from syntax and interfaces
        to distributed systems and top-company interview prep.
      </p>
      <div class="welcome-stats-grid">
        <div class="wstat-card">
          <span class="wstat-num">35+</span>
          <span class="wstat-label">Topics</span>
        </div>
        <div class="wstat-card">
          <span class="wstat-num">800+</span>
          <span class="wstat-label">Questions</span>
        </div>
        <div class="wstat-card">
          <span class="wstat-num">6</span>
          <span class="wstat-label">Difficulty Levels</span>
        </div>
        <div class="wstat-card">
          <span class="wstat-num">${pct}%</span>
          <span class="wstat-label">Your Progress</span>
        </div>
      </div>
    </div>

    ${lastEntry ? `
    <!-- CONTINUE CARD -->
    <div class="welcome-section">
      <div class="welcome-section-title">Continue Learning</div>
      <div id="continue-card" onclick="loadTopic('${escapeAttr(lastEntry.path)}')">
        <div class="continue-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>
        <div class="continue-body">
          <div class="continue-label">Pick up where you left off</div>
          <div class="continue-title">${escapeHtml(lastEntry.title)}</div>
          <div class="continue-section">${lastEntry.emoji} ${escapeHtml(lastEntry.section)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--accent);flex-shrink:0">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </div>
    </div>` : ''}

    <!-- LEARNING PATH -->
    <div class="welcome-section">
      <div class="welcome-section-title">Learning Path</div>
      <div class="learning-path">
        ${NAVIGATION.map(section => {
          const done = section.topics.filter(t => STATE.progress[t.path]).length;
          const tot  = section.topics.length;
          return `<button class="lp-card" style="--lp-color:${section.color}"
            onclick="loadFirstTopic('${escapeAttr(section.id)}')"
            aria-label="Start ${escapeHtml(section.title)}">
            <div class="lp-card-header">
              <span class="lp-emoji">${section.emoji}</span>
              <span class="lp-title">${escapeHtml(section.title)}</span>
            </div>
            <div class="lp-desc">${escapeHtml(section.desc)}</div>
            <div class="lp-meta">
              <span class="lp-count">${done}/${tot} done</span>
              <svg class="lp-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </div>
          </button>`;
        }).join('')}
      </div>
    </div>

    <!-- FEATURED TOPICS -->
    <div class="welcome-section">
      <div class="welcome-section-title">Featured Topics</div>
      <div class="featured-grid">
        <button class="featured-card" onclick="loadTopic('03-concurrency/02-goroutines.md')" aria-label="Open Goroutines">
          <span class="featured-card-emoji">⚡</span>
          <div class="featured-card-title">Goroutines Deep Dive</div>
          <div class="featured-card-desc">Understand Go's lightweight concurrency model, the runtime scheduler, and goroutine lifecycle.</div>
        </button>
        <button class="featured-card" onclick="loadTopic('03-concurrency/03-channels.md')" aria-label="Open Channels">
          <span class="featured-card-emoji">📡</span>
          <div class="featured-card-title">Channels & Communication</div>
          <div class="featured-card-desc">Typed conduits for goroutine communication. Buffered vs unbuffered, directional channels.</div>
        </button>
        <button class="featured-card" onclick="loadTopic('interview-prep/concurrency-interviews.md')" aria-label="Open Interview Prep">
          <span class="featured-card-emoji">🎯</span>
          <div class="featured-card-title">Concurrency Interviews</div>
          <div class="featured-card-desc">Real interview questions on goroutines, race conditions, deadlocks, and channel patterns.</div>
        </button>
      </div>
    </div>
  `;
}

/** Load the first topic of a given section ID */
function loadFirstTopic(sectionId) {
  const section = NAVIGATION.find(s => s.id === sectionId);
  if (section?.topics?.length) loadTopic(section.topics[0].path);
}

/* ══════════════════════════════════════════════════════════════
   SEARCH
   ══════════════════════════════════════════════════════════════ */

function openSearch() {
  STATE.searchOpen    = true;
  STATE.searchSelected = -1;

  const overlay = document.getElementById('search-overlay');
  const modal   = document.getElementById('search-modal');
  const input   = document.getElementById('search-input');

  overlay.hidden = false;
  modal.hidden   = false;
  document.body.style.overflow = 'hidden';

  input.value = '';
  setTimeout(() => input.focus(), 40);
  renderSearchResults('');
}

function closeSearch() {
  STATE.searchOpen = false;
  document.getElementById('search-overlay').hidden = true;
  document.getElementById('search-modal').hidden   = true;
  document.body.style.overflow = '';
}

/** Simple fuzzy search with scoring */
function fuzzySearch(query, items) {
  if (!query.trim()) return items.slice(0, 20);
  const q = query.toLowerCase();

  const scored = [];
  for (const item of items) {
    const title   = item.title.toLowerCase();
    const section = item.section.toLowerCase();
    let score = -1;

    if (title === q)            score = 120;
    else if (title.startsWith(q)) score = 100;
    else if (title.includes(q)) score = 80;
    else if (section.includes(q)) score = 40;
    else {
      // Character-order fuzzy matching
      let ti = 0, qi = 0, matched = 0;
      while (ti < title.length && qi < q.length) {
        if (title[ti] === q[qi]) { qi++; matched++; }
        ti++;
      }
      if (qi === q.length) score = matched * 8;
    }

    if (score >= 0) scored.push({ item, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 16).map(r => r.item);
}

/** Render search results list */
function renderSearchResults(query) {
  const container = document.getElementById('search-results');
  if (!container) return;

  const results = fuzzySearch(query, STATE.searchIndex);
  STATE.searchSelected = -1;

  if (results.length === 0) {
    container.innerHTML = `
      <div class="search-empty">
        <div class="search-empty-icon">🔍</div>
        <p>No results for "<strong>${escapeHtml(query)}</strong>"</p>
        <p class="search-empty-tips">Try: "goroutine", "channel", "interface", "error"</p>
      </div>`;
    return;
  }

  // Group results by section for a cleaner display
  let lastSection = null;
  let html = '';
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (item.section !== lastSection) {
      if (lastSection !== null) html += `<div style="height:1px"></div>`;
      html += `<div class="search-section-divider">
        <span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:6px;height:6px;border-radius:50%;background:${item.color};display:inline-block"></span>
          ${escapeHtml(item.section)}
        </span>
      </div>`;
      lastSection = item.section;
    }
    html += `<div class="search-result-item" role="option" data-path="${escapeAttr(item.path)}" data-index="${i}"
      onclick="selectSearchResult('${escapeAttr(item.path)}')" aria-selected="false">
      <div class="sri-icon">${item.emoji}</div>
      <div class="sri-body">
        <div class="sri-title">${highlightQuery(item.title, query)}</div>
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

/** Highlight matching text in search results */
function highlightQuery(text, query) {
  if (!query.trim()) return escapeHtml(text);
  const re = new RegExp(`(${escapeRegex(query.trim())})`, 'gi');
  return escapeHtml(text).replace(re, '<mark>$1</mark>');
}

function selectSearchResult(path) {
  closeSearch();
  loadTopic(path);
}

function moveSearchSelection(dir) {
  const items = document.querySelectorAll('.search-result-item');
  if (!items.length) return;
  if (STATE.searchSelected >= 0) items[STATE.searchSelected]?.classList.remove('selected');
  STATE.searchSelected = (STATE.searchSelected + dir + items.length) % items.length;
  const sel = items[STATE.searchSelected];
  if (sel) {
    sel.classList.add('selected');
    sel.scrollIntoView({ block: 'nearest' });
  }
}

/* ══════════════════════════════════════════════════════════════
   THEME
   ══════════════════════════════════════════════════════════════ */

function toggleTheme() {
  applyTheme(STATE.theme === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme, save = true) {
  STATE.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  // Swap highlight.js CSS
  const hljsLink = document.getElementById('hljs-theme');
  if (hljsLink) {
    hljsLink.href = theme === 'dark'
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
  }

  // Update mermaid theme + re-render diagrams
  try {
    mermaid.initialize({
      startOnLoad:   false,
      theme:         theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily:    'JetBrains Mono, monospace',
    });
    const diagrams = document.querySelectorAll('#markdown-body .mermaid');
    if (diagrams.length) mermaid.run({ nodes: diagrams });
  } catch (e) { /* non-fatal */ }

  if (save) localStorage.setItem(KEYS.theme, theme);
}

/* ══════════════════════════════════════════════════════════════
   PROGRESS TRACKING
   ══════════════════════════════════════════════════════════════ */

function toggleProgress(path, checked) {
  if (checked) {
    STATE.progress[path] = true;
  } else {
    delete STATE.progress[path];
  }
  saveProgress();
  updateProgressDisplay();
  updateSidebarStats();
  updateMarkDoneBtn();
}

function toggleCurrentProgress() {
  if (!STATE.currentPath) return;
  const isDone = !!STATE.progress[STATE.currentPath];
  toggleProgress(STATE.currentPath, !isDone);

  // Sync sidebar checkbox
  const cb = document.querySelector(`.nav-checkbox[data-path="${CSS.escape(STATE.currentPath)}"]`);
  if (cb) cb.checked = !isDone;
}

function saveProgress() {
  try { localStorage.setItem(KEYS.progress, JSON.stringify(STATE.progress)); } catch {}
}

function calculateStats() {
  const total     = STATE.searchIndex.length;
  const completed = Object.keys(STATE.progress).filter(k => STATE.progress[k]).length;
  const pct       = total ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pct };
}

function updateProgressDisplay() {
  const { completed, total, pct } = calculateStats();

  // Header pill
  const headerFill = document.getElementById('progress-fill');
  const headerText = document.getElementById('progress-text');
  if (headerFill) headerFill.style.width = pct + '%';
  if (headerText) headerText.textContent = pct + '%';

  // Sidebar footer bar
  const sbFill = document.getElementById('sidebar-progress-fill');
  const sbText = document.getElementById('sidebar-progress-text');
  if (sbFill) sbFill.style.width = pct + '%';
  if (sbText) sbText.textContent = `${completed} / ${total}`;
}

function updateSidebarStats() {
  const { completed } = calculateStats();
  const doneEl = document.getElementById('stat-done');
  if (doneEl) doneEl.textContent = completed;
}

function updateMarkDoneBtn() {
  const btn      = document.getElementById('btn-mark-done');
  const textEl   = document.getElementById('mark-done-text');
  if (!btn || !textEl) return;

  if (!STATE.currentPath) {
    btn.classList.remove('done');
    textEl.textContent = 'Mark Complete';
    return;
  }
  const isDone = !!STATE.progress[STATE.currentPath];
  btn.classList.toggle('done', isDone);
  textEl.textContent = isDone ? 'Completed ✓' : 'Mark Complete';
}

/* ══════════════════════════════════════════════════════════════
   BOOKMARKS
   ══════════════════════════════════════════════════════════════ */

function toggleBookmark() {
  if (!STATE.currentPath) return;
  const idx = STATE.bookmarks.indexOf(STATE.currentPath);
  if (idx >= 0) {
    STATE.bookmarks.splice(idx, 1);
  } else {
    STATE.bookmarks.unshift(STATE.currentPath);
  }
  try { localStorage.setItem(KEYS.bookmarks, JSON.stringify(STATE.bookmarks)); } catch {}
  updateBookmarkBtn(STATE.currentPath);
}

function updateBookmarkBtn(path) {
  const btn    = document.getElementById('btn-bookmark');
  const textEl = document.getElementById('bookmark-text');
  if (!btn || !textEl) return;

  const isBookmarked = STATE.bookmarks.includes(path);
  btn.classList.toggle('bookmarked', isBookmarked);

  // Update icon
  const svgPath = isBookmarked
    ? '<path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="currentColor"/>'
    : '<path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>';
  btn.querySelector('svg').innerHTML = svgPath;
  textEl.textContent = isBookmarked ? 'Bookmarked' : 'Bookmark';
}

/* ══════════════════════════════════════════════════════════════
   STATS MODAL
   ══════════════════════════════════════════════════════════════ */

function showStats() {
  const modal = document.getElementById('stats-modal');
  const body  = document.getElementById('stats-body');
  if (!modal || !body) return;

  const { total, completed, pct } = calculateStats();

  const sectionRows = NAVIGATION.map(section => {
    const done = section.topics.filter(t => STATE.progress[t.path]).length;
    const tot  = section.topics.length;
    const sp   = tot ? Math.round((done / tot) * 100) : 0;
    return `<div class="stats-section-row">
      <span class="stats-section-dot" style="background:${section.color}"></span>
      <span class="stats-section-emoji" style="font-size:.85rem">${section.emoji}</span>
      <span class="stats-section-name">${escapeHtml(section.title)}</span>
      <span class="stats-section-bar">
        <span class="stats-section-bar-fill" style="width:${sp}%;background:${section.color}"></span>
      </span>
      <span class="stats-section-count" style="color:${section.color}">${done}/${tot}</span>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="stats-overview">
      <div class="stats-big-num">${pct}%</div>
      <div class="stats-big-label">${completed} of ${total} topics completed</div>
      <div class="stats-overall-bar">
        <div class="stats-overall-fill" style="width:${pct}%"></div>
      </div>
    </div>
    <div style="margin-top:16px">
      ${sectionRows}
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-size:.72rem;color:var(--text-muted);font-family:var(--font-mono)">
        Bookmarks: ${STATE.bookmarks.length} saved
      </div>
    </div>`;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeStatsModal() {
  const modal = document.getElementById('stats-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════════════════════
   SIDEBAR TOGGLE
   ══════════════════════════════════════════════════════════════ */

function toggleSidebar() {
  STATE.sidebarOpen ? closeSidebar() : openSidebar();
}

function openSidebar() {
  STATE.sidebarOpen = true;
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').style.display = 'block';
  document.getElementById('menu-toggle').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  STATE.sidebarOpen = false;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').style.display = 'none';
  document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════════════════════
   RECENT TOPICS
   ══════════════════════════════════════════════════════════════ */

function trackRecent(path) {
  STATE.recentTopics = [path, ...STATE.recentTopics.filter(p => p !== path)].slice(0, 8);
  try { localStorage.setItem(KEYS.recent, JSON.stringify(STATE.recentTopics)); } catch {}
}

/* ══════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS & EVENT LISTENERS
   ══════════════════════════════════════════════════════════════ */

function bindEventListeners() {
  // Logo
  const logo = document.getElementById('logo');
  if (logo) logo.addEventListener('click', e => {
    e.preventDefault();
    showWelcome();
    if (window.innerWidth <= 1024) closeSidebar();
  });

  // Hamburger
  document.getElementById('menu-toggle')?.addEventListener('click', toggleSidebar);

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  // Search trigger
  document.getElementById('search-bar')?.addEventListener('click', openSearch);

  // Sidebar filter
  const filterInput = document.getElementById('sidebar-filter');
  const filterClear = document.getElementById('sidebar-filter-clear');
  filterInput?.addEventListener('input', e => {
    const q = e.target.value;
    if (filterClear) filterClear.style.display = q ? '' : 'none';
    filterSidebar(q);
  });
  filterClear?.addEventListener('click', () => {
    if (filterInput) filterInput.value = '';
    filterClear.style.display = 'none';
    filterSidebar('');
    filterInput?.focus();
  });

  // Search input
  document.getElementById('search-input')?.addEventListener('input', e => {
    renderSearchResults(e.target.value);
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    // Ctrl/Cmd + K → open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      STATE.searchOpen ? closeSearch() : openSearch();
      return;
    }

    // Escape → close modals
    if (e.key === 'Escape') {
      if (STATE.searchOpen) { closeSearch(); return; }
      const statsModal = document.getElementById('stats-modal');
      if (statsModal?.style.display === 'flex') { closeStatsModal(); return; }
      if (STATE.sidebarOpen && window.innerWidth <= 1024) { closeSidebar(); return; }
    }

    // Arrow navigation in search
    if (STATE.searchOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSelection(1); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); moveSearchSelection(-1); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const selected = document.querySelector('.search-result-item.selected');
        if (selected) {
          selectSearchResult(selected.dataset.path);
        } else {
          const first = document.querySelector('.search-result-item');
          if (first) selectSearchResult(first.dataset.path);
        }
      }
    }
  });

  // Browser back/forward
  window.addEventListener('popstate', e => {
    const path = e.state?.path || location.hash.slice(1);
    if (path) {
      loadTopic(path, false);
    } else {
      showWelcome();
    }
  });

  // Close sidebar when clicking overlay
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

  // Responsive: auto-close sidebar on resize to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024 && STATE.sidebarOpen) {
      closeSidebar();
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ══════════════════════════════════════════════════════════════ */

/** Escape HTML for safe insertion */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for use inside HTML attribute values */
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape for use in RegExp */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Create a URL-safe slug from text */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
