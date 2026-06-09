/* ── Go Learning — script.js ──────────────────────────── */

const STORAGE_KEY = 'go-learning-checked';

// ── Load saved checkboxes from localStorage ──────────────
function loadChecked() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

// ── Save checked IDs to localStorage ────────────────────
function saveChecked(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {/* storage unavailable */}
}

// ── Build a stable ID for each checkbox ─────────────────
function checkboxId(checkbox) {
  const label = checkbox.closest('.topic-item');
  return label ? label.querySelector('span').textContent.trim() : null;
}

// ── Update the progress bar ──────────────────────────────
function updateProgress() {
  const all     = document.querySelectorAll('.topic-item input[type="checkbox"]');
  const checked = document.querySelectorAll('.topic-item input[type="checkbox"]:checked');
  const total   = all.length;
  const done    = checked.length;
  const pct     = total ? Math.round((done / total) * 100) : 0;

  const fill  = document.getElementById('progressFill');
  const label = document.getElementById('progressLabel');
  if (fill)  fill.style.width = pct + '%';
  if (label) label.textContent = `${done} / ${total} topics`;
}

// ── Accordion toggle ─────────────────────────────────────
function initAccordions() {
  document.querySelectorAll('.level-header').forEach(header => {
    header.addEventListener('click', () => {
      const card   = header.closest('.level-card');
      const list   = card.querySelector('.topic-list');
      const btn    = card.querySelector('.level-toggle');
      const isOpen = !list.hidden;

      list.hidden = isOpen;
      btn.setAttribute('aria-expanded', String(!isOpen));
      btn.classList.toggle('rotated', !isOpen);
      card.classList.toggle('open', !isOpen);
    });
  });
}

// ── Checkbox persistence + progress ─────────────────────
function initCheckboxes() {
  const saved = loadChecked();

  const all = document.querySelectorAll('.topic-item input[type="checkbox"]');

  // restore saved state
  all.forEach(cb => {
    const id = checkboxId(cb);
    if (id && saved.includes(id)) cb.checked = true;
  });

  updateProgress();

  // listen for changes
  all.forEach(cb => {
    cb.addEventListener('change', () => {
      const currentChecked = [];
      document.querySelectorAll('.topic-item input[type="checkbox"]:checked').forEach(c => {
        const id = checkboxId(c);
        if (id) currentChecked.push(id);
      });
      saveChecked(currentChecked);
      updateProgress();
    });
  });
}

// ── Scroll-reveal: fade in sections ─────────────────────
function initReveal() {
  const targets = document.querySelectorAll('.level-card, .ref-card, .interview-card');
  targets.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  });

  if (!('IntersectionObserver' in window)) {
    targets.forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  targets.forEach(el => observer.observe(el));
}

// ── Boot ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAccordions();
  initCheckboxes();
  initReveal();
});
