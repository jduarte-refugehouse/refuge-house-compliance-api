// Client search/filter for the policy manual at /site-index. Operates on the
// server-rendered DOM: filters items by title/path as you type, collapses empty
// groups, and keeps a live visible-count.
(function () {
  'use strict';

  var search = document.getElementById('idx-search');
  var items = [].slice.call(document.querySelectorAll('.idx-item'));
  var groups = [].slice.call(document.querySelectorAll('.idx-group'));
  var totalEl = document.getElementById('idx-visible');
  var emptyEl = document.getElementById('idx-empty');

  function apply() {
    var q = (search && search.value ? search.value : '').trim().toLowerCase();
    var visible = 0;

    items.forEach(function (it) {
      var hit = !q || (it.dataset.search || '').indexOf(q) !== -1;
      it.hidden = !hit;
      if (hit) visible++;
    });

    groups.forEach(function (g) {
      var shown = g.querySelectorAll('.idx-item:not([hidden])').length;
      g.hidden = shown === 0;
      var c = g.querySelector('.idx-group-count');
      if (c) c.textContent = String(shown);
    });

    if (totalEl) totalEl.textContent = String(visible);
    if (emptyEl) emptyEl.hidden = visible !== 0;
  }

  if (search) {
    search.addEventListener('input', apply);
    // Press Escape to clear.
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { search.value = ''; apply(); }
    });
  }

  apply();
})();
