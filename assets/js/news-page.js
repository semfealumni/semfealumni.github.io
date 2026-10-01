/* SEMFE Alumni: the «Τι νέο» page (whats-new/).
 *
 * The list is changelog.json (Claude's suggestions, in the repository) after
 * the admins' decisions in Firestore newsOverrides/ (assets/js/news.js holds
 * the rules of who sees what).
 *   - A visitor sees only what an admin approved. The decisions are read with
 *     one plain request to Firestore's REST address: no Firebase library, no
 *     cookies, nothing stored in the browser.
 *   - An admin (signed in) sees, above the list, what waits for approval
 *     (Δημοσίευση, or Δημοσίευση όλων), can reword any entry
 *     (Επεξεργασία) or take it off the list (Αφαίρεση). Removed entries wait
 *     in a closed «Αφαιρεμένα» box below the list, one click from Επαναφορά.
 * firestore.rules is what really decides who may change a decision. */
(function () {
  'use strict';
  var N = window.SEMFE_NEWS, A = window.SemfeAuth, C = window.SEMFE || {}, U = window.SEMFE_UTIL || {};
  var app = document.getElementById('news-app');
  if (!N || !app) return;
  var root = (A && A.root) || './';
  var esc = (A && A.esc) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var MONTHS = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
  var updates = null, docs = {}, decided = false, loadErr = '';
  var me = null, admin = false, editing = null, busy = false, note = '', noteBad = false;

  function merge(a, b) { var o = {}, k; for (k in a || {}) o[k] = a[k]; for (k in b || {}) o[k] = b[k]; return o; }
  function day(d) { var p = String(d).split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }

  /* ---- the two things the list is made of ---- */
  fetch(root + 'changelog.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) { updates = (j && j.updates) || []; render(); })
    .catch(function () { loadErr = 'Η λίστα δεν φορτώθηκε. Δοκιμάστε ξανά σε λίγο.'; render(); });

  var F = C.FIREBASE || {};
  if (A && A.configured && window.fetch) {
    // what is public; if this fails (or the rules are not published yet),
    // nothing counts as approved and visitors see nothing: the safe side
    fetch(N.restUrl(F.projectId, F.apiKey))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (!admin) docs = N.parseRest(j); }, function () {})
      .then(function () { decided = true; render(); });
  } else decided = true;

  // passive: a visitor who never signed in does not download the sign-in
  // library just to be told they are not an admin
  if (A) A.onChange(function (u) {
    me = u;
    admin = !!(u && A.configured && A.isAdmin(u));
    editing = null; note = '';
    if (admin) {
      // an admin reads every decision through their own sign-in
      A.db().then(function (db) { return db.collection(N.COLLECTION).get(); }).then(function (qs) {
        var d = {};
        qs.forEach(function (x) { d[x.id] = x.data(); });
        docs = d; decided = true; render();
      }, function (e) { say(readHelp(e), true); });
    }
    render();
  }, { passive: true });

  /* ---- drawing ---- */
  function render() {
    if (loadErr) { app.innerHTML = '<p class="form-error">' + esc(loadErr) + '</p>'; return; }
    if (!updates || !decided) return;                        // the "Φόρτωση…" stays
    var keep = focusKey();
    var s = N.split(updates, docs), h = '';
    if (admin && A.noteMenu) A.noteMenu({ newsPending: s.pending.length });
    h += '<p class="news-note ' + (noteBad ? 'form-error' : 'form-ok') + '" role="status" tabindex="-1">' + esc(note) + '</p>';
    if (admin) {
      h += '<section class="news-review" aria-labelledby="news-review-h"><div class="news-review-head">' +
        '<h2 id="news-review-h">Περιμένουν έγκριση <span class="news-count">' + s.pending.length + '</span></h2>' +
        (s.pending.length > 1 ? '<button type="button" class="btn btn-primary btn-sm" data-act="approve-all">Δημοσίευση όλων (' + s.pending.length + ')</button>' : '') +
        '</div>' +
        (s.pending.length
          ? '<p class="muted">Ο Claude προτείνει μια εγγραφή με κάθε αλλαγή στον ιστότοπο. Τις βλέπετε μόνο εσείς, οι διαχειριστές, μέχρι να τις δημοσιεύσετε.</p>' + list(s.pending, 'pending')
          : '<p class="muted">Τίποτα δεν περιμένει έγκριση.</p>') +
        '</section>' +
        '<h2 class="news-h">Δημοσιευμένα</h2>';
    } else h += '<h2 class="sr-only">Οι αλλαγές του ιστότοπου</h2>';
    h += s.approved.length ? list(s.approved, 'approved') : '<p class="muted">Δεν υπάρχουν ακόμα νέα.</p>';
    if (admin && s.removed.length)
      h += '<details class="news-removed"' + (s.removed.some(function (r) { return r.id === editing; }) ? ' open' : '') + '><summary>Αφαιρεμένα (' + s.removed.length + ')</summary>' +
        '<p class="muted">Δεν τα βλέπει κανείς. Η Επαναφορά τα δημοσιεύει ξανά.</p>' + list(s.removed, 'removed') + '</details>';
    app.innerHTML = h;
    restoreFocus(keep);
  }
  function list(items, kind) {
    return '<ol class="news-list">' + items.map(function (r) { return item(r, kind); }).join('') + '</ol>';
  }
  function item(r, kind) {
    if (admin && editing === r.id) return '<li class="news-item">' + form(r) + '</li>';
    var href = r.url ? (/^https:\/\//.test(r.url) ? r.url : root + r.url) : '';
    var title = href ? '<a href="' + esc(href) + '"' + (/^https:/.test(href) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(r.title) + '</a>' : esc(r.title);
    var acts = '';
    if (admin) acts = '<div class="news-acts">' +
      (kind === 'pending' ? btn('approve', r, 'Δημοσίευση', 'btn-primary') : '') +
      (kind === 'removed' ? btn('restore', r, 'Επαναφορά', 'btn-outline') : btn('edit', r, 'Επεξεργασία', 'btn-ghost') + btn('remove', r, 'Αφαίρεση', 'btn-ghost')) +
      '</div>';
    return '<li class="news-item"><time datetime="' + esc(r.date) + '">' + esc(day(r.date)) + '</time>' +
      '<h3>' + title + '</h3>' + (r.summary ? '<p>' + esc(r.summary) + '</p>' : '') +
      (admin && r.edited ? '<p class="news-edited">Με τη δική σας διατύπωση.</p>' : '') + acts + '</li>';
  }
  function btn(act, r, label, cls) {
    return '<button type="button" class="btn btn-sm ' + cls + '" data-act="' + act + '" data-id="' + esc(r.id) + '"' +
      ' aria-label="' + esc(label + ': ' + r.title) + '"' + (busy ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }
  function form(r) {
    var id = esc(r.id);
    return '<form class="news-form" data-id="' + id + '">' +
      '<div class="field"><label for="nt-' + id + '">Τίτλος</label><input id="nt-' + id + '" name="title" maxlength="' + N.TITLE_MAX + '" value="' + esc(r.title) + '"></div>' +
      '<div class="field"><label for="ns-' + id + '">Κείμενο</label><textarea id="ns-' + id + '" name="summary" rows="4" maxlength="' + N.SUMMARY_MAX + '">' + esc(r.summary) + '</textarea></div>' +
      '<p class="muted news-hint">Αν σβήσετε ένα πεδίο, επιστρέφει το αρχικό κείμενο.</p>' +
      '<div class="news-acts"><button type="submit" class="btn btn-primary btn-sm"' + (busy ? ' disabled' : '') + '>Αποθήκευση</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Άκυρο</button></div></form>';
  }

  /* the focus survives a redraw: the same button, or the field being typed in */
  function focusKey() {
    var f = document.activeElement;
    if (!f || !app.contains(f)) return null;
    return { act: f.getAttribute('data-act'), id: f.getAttribute('data-id'), name: f.name, form: f.form && f.form.getAttribute('data-id') };
  }
  function restoreFocus(k) {
    if (!k) return;
    var el = null;
    if (k.form && k.name) el = app.querySelector('form[data-id="' + k.form + '"] [name="' + k.name + '"]');
    else if (k.act) el = app.querySelector('[data-act="' + k.act + '"]' + (k.id ? '[data-id="' + k.id + '"]' : ''));
    if (el) try { el.focus({ preventScroll: true }); } catch (e) {}
  }

  function say(msg, bad) { note = msg; noteBad = !!bad; render(); }
  function readHelp(e) { return 'Δεν διαβάστηκαν οι αποφάσεις: ' + (A.friendly ? A.friendly(e) : e.message); }
  function writeHelp(e) {
    var m = A.friendly ? A.friendly(e) : e.message;
    if (e && /permission/.test(e.code || e.message || ''))
      m += ' Αν η σελίδα «Τι νέο» μόλις προστέθηκε, δημοσιεύστε τους κανόνες: firebase deploy --only firestore:rules --project semfe-alumni';
    return m;
  }

  /* ---- an admin's decisions ---- */
  var DONE = { approve: 'Δημοσιεύτηκε.', 'approve-all': 'Δημοσιεύτηκαν όλα.', remove: 'Αφαιρέθηκε από τη λίστα (βρίσκεται στα «Αφαιρεμένα»).', restore: 'Δημοσιεύτηκε ξανά.', edit: 'Αποθηκεύτηκε.' };
  function write(action, ids, patchOf) {
    if (busy || !admin || !me) return;
    busy = true; render();
    A.freshToken(me).then(function () { return A.db(); }).then(function (db) {
      var batch = db.batch(), FV = window.firebase.firestore.FieldValue;
      ids.forEach(function (id) {
        var p = patchOf(id);
        batch.set(db.collection(N.COLLECTION).doc(id), merge(p, { t: FV.serverTimestamp(), by: me.email || '' }), { merge: true });
      });
      return batch.commit().then(function () {
        ids.forEach(function (id) { docs[id] = merge(docs[id], patchOf(id)); });
      });
    }).then(function () {
      busy = false; editing = null; say(DONE[action]);
      var n = app.querySelector('.news-note'); if (n) try { n.focus({ preventScroll: true }); } catch (e) {}
    }, function (e) { busy = false; say(writeHelp(e), true); });
  }
  function entry(id) { return (updates || []).filter(function (e) { return e.id === id; })[0]; }

  app.addEventListener('click', function (e) {
    var b = U.closest ? U.closest(e.target, '[data-act]') : null;
    if (!b || !admin) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'cancel') { editing = null; note = ''; render(); return; }
    if (act === 'edit') { editing = id; note = ''; render(); var f = app.querySelector('form[data-id="' + id + '"] input'); if (f) f.focus(); return; }
    if (act === 'approve-all') {
      var ids = N.split(updates, docs).pending.map(function (r) { return r.id; });
      if (ids.length) write(act, ids, function () { return N.patchFor('approve'); });
      return;
    }
    if (id && entry(id)) write(act, [id], function () { return N.patchFor(act, docs[id]); });
  });
  app.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.classList || !f.classList.contains('news-form')) return;
    e.preventDefault();
    var id = f.getAttribute('data-id'), en = entry(id);
    if (!en) return;
    // the changelog's own wording is stored as "nothing", so a later fix to
    // changelog.json still shows through
    // (f.elements, not f.title: a form's .title is its own title attribute)
    var t = String(f.elements.title.value).trim(), s = String(f.elements.summary.value).trim();
    var fields = { title: t === en.title ? '' : t, summary: s === (en.summary || '') ? '' : s };
    write('edit', [id], function () { return N.patchFor('edit', docs[id], fields); });
  });
  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && editing) { editing = null; render(); }
  });
})();
