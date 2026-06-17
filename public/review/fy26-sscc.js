// Client engine for the FY-26 SSCC desk-review portal (/review/fy26-sscc).
// Operates entirely on the server-rendered DOM: hydrates saved state from
// localStorage, wires Met/Not Met/N·A controls, classification, reviewer notes,
// progress, filtering, JSON export, print, and "Freeze for archive".
(function () {
  'use strict';

  // Bump the version suffix if the persisted shape ever changes.
  var REVIEW_ID = 'fy26-sscc-desk-review';
  var KEY = 'rh-' + REVIEW_ID + '-v2';

  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }
  state.items = state.items || {};

  var items = [].slice.call(document.querySelectorAll('.item'));
  var revInput = document.getElementById('rev');
  if (revInput) revInput.value = state.reviewer || '';

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota / private mode */ }
  }

  // Hydrate saved status / classification / notes onto each row.
  items.forEach(function (it) {
    var id = it.dataset.id;
    var s = state.items[id] || {};
    if (s.status) {
      it.dataset.status = s.status;
      var b = it.querySelector('.st[data-v="' + s.status + '"]');
      if (b) b.classList.add('active');
    }
    if (s.cls) it.dataset.class = s.cls;
    var sel = it.querySelector('.class-sel');
    if (sel) sel.value = it.dataset.class;
    var ta = it.querySelector('.notes');
    if (ta && s.notes) { ta.value = s.notes; it.classList.add('has-notes'); }
  });

  // Wire per-row controls.
  items.forEach(function (it) {
    var id = it.dataset.id;

    it.querySelectorAll('.st').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (document.body.classList.contains('archived')) return;
        var v = btn.dataset.v;
        var cur = it.dataset.status;
        it.querySelectorAll('.st').forEach(function (b) { b.classList.remove('active'); });
        if (cur === v) {
          it.dataset.status = 'pending';
        } else {
          it.dataset.status = v;
          btn.classList.add('active');
        }
        (state.items[id] = state.items[id] || {}).status = it.dataset.status;
        save();
        refresh();
      });
    });

    var sel = it.querySelector('.class-sel');
    if (sel) {
      sel.addEventListener('change', function (e) {
        it.dataset.class = e.target.value;
        (state.items[id] = state.items[id] || {}).cls = e.target.value;
        save();
        refresh();
      });
    }

    var ta = it.querySelector('.notes');
    if (ta) {
      ta.addEventListener('input', function () {
        (state.items[id] = state.items[id] || {}).notes = ta.value;
        if (ta.value) it.classList.add('has-notes'); else it.classList.remove('has-notes');
        save();
      });
    }

    // "+ note" reveals the reviewer-notes field (separate from the read-only
    // mapping summary). Focus it when opened.
    var noteToggle = it.querySelector('.note-toggle');
    if (noteToggle) {
      noteToggle.addEventListener('click', function () {
        var open = it.classList.toggle('show-notes');
        if (open && ta) ta.focus();
      });
    }
  });

  if (revInput) {
    revInput.addEventListener('input', function () { state.reviewer = revInput.value; save(); });
  }

  function refresh() {
    var reviewed = 0, trans = 0, legacy = 0, unmapped = 0;
    var counts = {};
    items.forEach(function (it) {
      if (it.dataset.status !== 'pending') reviewed++;
      if (it.dataset.class === 'transitioning') trans++;
      if (it.dataset.class === 'legacy') legacy++;
      if (it.dataset.class === 'unmapped') unmapped++;
      var gk = it.dataset.group || 'all';
      counts[gk] = counts[gk] || { n: 0, done: 0 };
      counts[gk].n++;
      if (it.dataset.status !== 'pending') counts[gk].done++;
    });
    setText('t-reviewed', reviewed);
    setText('t-trans', trans);
    setText('t-legacy', legacy);
    setText('t-unmapped', unmapped);
    var pct = items.length ? Math.round((reviewed / items.length) * 100) : 0;
    var bar = document.getElementById('bar');
    if (bar) bar.style.width = pct + '%';
    setText('pct', pct + '%');
    document.querySelectorAll('.g-count').forEach(function (el) {
      var c = counts[el.dataset.count];
      if (c) el.textContent = c.done + '/' + c.n;
    });
  }

  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  // Filter by status.
  var filter = document.getElementById('filter');
  if (filter) {
    filter.addEventListener('change', function (e) {
      var f = e.target.value;
      items.forEach(function (it) {
        var show = f === 'all' || it.dataset.status === f;
        it.classList.toggle('dim', !show);
      });
    });
  }

  // Collapsible groups.
  document.querySelectorAll('.group-head').forEach(function (h) {
    h.addEventListener('click', function () {
      var g = h.closest('.group');
      g.classList.toggle('collapsed');
      h.setAttribute('aria-expanded', String(!g.classList.contains('collapsed')));
    });
  });

  // JSON export.
  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      var out = {
        reviewId: REVIEW_ID,
        reviewer: state.reviewer || '',
        exportedAt: new Date().toISOString(),
        archived: state.archived || null,
        items: {}
      };
      items.forEach(function (it) {
        var labelEl = it.querySelector('.item-label') || it.querySelector('.item-text');
        var notesEl = it.querySelector('.notes');
        out.items[it.dataset.id] = {
          label: labelEl ? labelEl.textContent.trim() : '',
          status: it.dataset.status,
          classification: it.dataset.class,
          notes: notesEl ? (notesEl.value || '') : ''
        };
      });
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = REVIEW_ID + '-results.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
    });
  }

  // Freeze for archive — locks the record read-only (Export/Print still allowed).
  function applyArchived() {
    if (state.archived) {
      document.body.classList.add('archived');
      var banner = document.getElementById('archBanner');
      if (banner) {
        banner.textContent = '🔒 Archived ' + new Date(state.archived).toLocaleString() +
          ' · this record is frozen (read-only).';
      }
    }
  }
  var archiveBtn = document.getElementById('archiveBtn');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', function () {
      if (!confirm('Freeze this review for archive? It becomes read-only. (You can still Export and Print.)')) return;
      state.archived = new Date().toISOString();
      save();
      applyArchived();
    });
  }

  applyArchived();
  refresh();
})();
