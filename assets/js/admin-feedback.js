/* SEMFE Alumni: the admin page's «Σχόλια μελών» inbox (feedback/ in Firestore).
 *
 * Every message sent from the Σχόλια page, newest first: who sent it, from
 * which page, the screenshots (click to enlarge) and the text. An admin
 * closes a ticket with a short answer (and a link, if it helps); the feedback
 * Cloud Function (functions/feedback.js) then e-mails that answer to the
 * sender, when their address is confirmed. A ticket can also be closed from
 * the repository, with a file in _feedback-resolutions/ (see its README).
 * Shown only to admins; firestore.rules is what actually decides. */
(function () {
  'use strict';
  var A = window.SemfeAuth, U = window.SEMFE_UTIL || {};
  var sec = document.getElementById('feedback'), app = document.getElementById('admin-feedback');
  if (!A || !sec || !app) return;
  var esc = A.esc;
  var KIND = { problem: 'Πρόβλημα', idea: 'Πρόταση', other: 'Άλλο' };
  var db = null, unsub = null, all = null, err = null, view = 'open', closing = null, drafts = {}, me = null, jumped = false, msgs = {};
  var shotCache = {};              // ticket -> [data URLs] once fetched, 'loading', or 'error'

  A.onChange(function (u) {
    me = u;
    if (unsub) { unsub(); unsub = null; }
    all = null; err = null; closing = null; shotCache = {};
    if (!u || !A.configured || !A.isAdmin(u)) { sec.hidden = true; app.innerHTML = ''; return; }
    sec.hidden = false;
    render();
    A.db().then(function (d) {
      db = d;
      unsub = db.collection('feedback').onSnapshot(function (qs) {
        var l = [];
        qs.forEach(function (doc) { var x = doc.data(); x.ticket = x.ticket || doc.id; x.id = doc.id; l.push(x); });
        l.sort(function (a, b) { return ms(b.createdAt) - ms(a.createdAt) || String(b.ticket).localeCompare(a.ticket); });
        all = l; err = null;
        // an answer being typed is never redrawn under the admin's hands (it
        // would cut an input method short and lose the selection); the list
        // catches up when the form closes
        if (closing && l.some(function (x) { return x.ticket === closing; })) paintCounts(); else render();
        A.noteMenu({ fbOpen: l.filter(function (x) { return x.status !== 'closed'; }).length });
        if (!jumped && location.hash === '#feedback') { jumped = true; var h = app.querySelector('h2'); if (h) { h.scrollIntoView(); h.focus({ preventScroll: true }); } }
      }, function (e) { err = A.friendly(e); render(); });
    }, function (e) { err = A.friendly(e); render(); });
  });

  function ms(t) { return t && t.toMillis ? t.toMillis() : 0; }
  function when(t) {
    var v = ms(t); if (!v) return '';
    var d = new Date(v), two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function q(sel) { return app.querySelector(sel); }
  function counts() {
    var o = { open: 0, closed: 0, all: (all || []).length };
    (all || []).forEach(function (x) { o[x.status === 'closed' ? 'closed' : 'open']++; });
    return o;
  }

  function render() {
    // keep what is being typed in an open answer form, and where the focus was
    var f = document.activeElement, focusSel = null, pos = null;
    if (f && app.contains(f)) {
      focusSel = f.id ? '#' + f.id : f.getAttribute('data-act') ? '[data-t="' + f.closest('[data-t]').getAttribute('data-t') + '"] [data-act="' + f.getAttribute('data-act') + '"]'
        : f.hasAttribute('data-view-tab') ? '[data-view-tab="' + f.getAttribute('data-view-tab') + '"]' : null;
      if (f.selectionStart != null) pos = f.selectionStart;
    }
    var c = counts();
    var head = '<h2 id="afb-h" tabindex="-1">Σχόλια μελών</h2>' +
      '<p class="muted">Τα μηνύματα από τη σελίδα <a href="' + A.root + 'feedback/">Σχόλια και προβλήματα</a>. Κλείστε ένα με μια σύντομη απάντηση: ο αποστολέας τη λαμβάνει με e-mail (αν το e-mail του είναι επιβεβαιωμένο) και τη βλέπει και στη σελίδα.</p>';
    if (err) { app.innerHTML = head + '<div class="notice err"><p>' + esc(err) + '</p><p>Αν η σελίδα Σχόλια είναι καινούργια, δημοσιεύστε ξανά το firestore.rules (FEEDBACK-SETUP.md).</p></div>'; return; }
    if (!all) { app.innerHTML = head + '<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση…</div>'; return; }
    var tabs = TABS.map(function (t) {
      return '<button type="button" data-view-tab="' + t[0] + '" aria-pressed="' + (view === t[0]) + '">' + t[1] + ' (' + c[t[0]] + ')</button>';
    }).join('');
    var list = all.filter(function (x) { return view === 'all' || (view === 'closed') === (x.status === 'closed'); });
    app.innerHTML = head + '<div class="filters" role="group" aria-label="Ποια μηνύματα">' + tabs + '</div>' +
      (list.length ? list.map(card).join('') : '<p class="muted">' + (view === 'open' ? 'Κανένα ανοιχτό μήνυμα.' : 'Κανένα μήνυμα εδώ.') + '</p>');
    wire();
    loadShots(list);
    // the old control is gone with the old markup: put the focus back on the
    // same control, without scrolling the page to it
    if (focusSel) {
      var el = app.querySelector(focusSel);
      if (el) { el.focus({ preventScroll: true }); if (pos != null) try { el.setSelectionRange(pos, pos); } catch (e) {} }
    }
  }
  var TABS = [['open', 'Ανοιχτά'], ['closed', 'Ολοκληρωμένα'], ['all', 'Όλα']];
  function paintCounts() {
    var c = counts();
    TABS.forEach(function (t) { var b = app.querySelector('[data-view-tab="' + t[0] + '"]'); if (b) b.textContent = t[1] + ' (' + c[t[0]] + ')'; });
  }

  /* the screenshots live beside the ticket (feedback/<ticket>/shots/1..5) and
     are fetched only for the tickets on screen, once each */
  function loadShots(list) {
    list.forEach(function (x) {
      var t = x.ticket;
      if (!x.shots || shotCache[t]) return;
      shotCache[t] = 'loading';
      db.collection('feedback').doc(t).collection('shots').get().then(function (qs) {
        var l = [];
        qs.forEach(function (d) { var u = (d.data() || {}).url; if (/^data:image\/jpeg;base64,/.test(u || '')) l.push([+d.id, u]); });
        shotCache[t] = l.sort(function (a, b) { return a[0] - b[0]; }).map(function (p) { return p[1]; });
        paintShots(t);
      }, function () { shotCache[t] = 'error'; paintShots(t); });
    });
  }
  function shotsHtml(t, n) {
    var c = shotCache[t];
    if (c === 'error') return '<p class="form-error">Τα στιγμιότυπα δεν φορτώθηκαν.</p>';
    if (!Array.isArray(c)) return '<p class="muted"><span class="spinner" aria-hidden="true"></span>' + n + (n === 1 ? ' στιγμιότυπο' : ' στιγμιότυπα') + '…</p>';
    return c.map(function (u, i) {
      return '<a class="fb-thumb" href="' + esc(u) + '" data-view="' + i + '"><img src="' + esc(u) + '" alt="Στιγμιότυπο ' + (i + 1) + ' του ' + esc(t) + '"></a>';
    }).join('');
  }
  function paintShots(t) {
    var box = app.querySelector('[data-t="' + t + '"] [data-shots]'), x = (all || []).filter(function (y) { return y.ticket === t; })[0];
    if (!box || !x) return;
    box.innerHTML = shotsHtml(t, x.shots);
    viewers(box);
  }
  function viewers(box) {
    var links = Array.prototype.slice.call(box.querySelectorAll('a[data-view]'));
    links.forEach(function (a, i) {
      a.addEventListener('click', function (e) { e.preventDefault(); if (U.lightbox) U.lightbox(links, i); });
    });
  }

  function card(x) {
    var closed = x.status === 'closed', t = x.ticket;
    var mail = x.email ? esc(x.email) + (x.emailVerified ? '' : ' <span class="badge muted">μη επιβεβαιωμένο</span>') : '<span class="muted">χωρίς e-mail</span>';
    var shots = x.shots ? shotsHtml(t, x.shots) : '';
    var sentBits = [];
    if (x.mailError) sentBits.push('<span class="form-error">E-mail: ' + esc(x.mailError) + '</span>');
    if (closed && x.resolutionSentAt) sentBits.push('Η απάντηση στάλθηκε με e-mail ' + esc(when(x.resolutionSentAt)) + '.');
    var form = closing === t
      ? '<form class="form sub-form afb-close" data-close-form novalidate>' +
        '<div class="field"><label for="afb-res-' + esc(t) + '">Τι κάναμε (το κείμενο πηγαίνει στον αποστολέα όπως είναι)</label>' +
        '<textarea id="afb-res-' + esc(t) + '" rows="4" maxlength="5000" required>' + esc((drafts[t] || {}).text || '') + '</textarea></div>' +
        '<div class="field"><label for="afb-url-' + esc(t) + '">Σύνδεσμος για να το δει (προαιρετικό)</label>' +
        '<input id="afb-url-' + esc(t) + '" type="url" maxlength="500" placeholder="https://…" value="' + esc((drafts[t] || {}).url || '') + '"></div>' +
        '<p class="muted" style="margin:0">' + (x.email && x.emailVerified ? 'Θα σταλεί e-mail στο ' + esc(x.email) + '.' : 'Ο αποστολέας δεν έχει επιβεβαιωμένο e-mail: θα δει την απάντηση στη σελίδα Σχόλια.') + '</p>' +
        '<div class="form-error" data-close-msg role="alert"></div>' +
        '<p class="section-foot"><button type="submit" class="btn btn-dark btn-sm" data-act="send">Κλείσιμο και αποστολή απάντησης</button> ' +
        '<button type="button" class="btn btn-outline btn-sm" data-act="cancel">Άκυρο</button></p></form>'
      : '';
    return '<article class="panel afb-card" data-t="' + esc(t) + '">' +
      '<div class="fb-item-head"><code>' + esc(t) + '</code><span class="badge ' + (closed ? 'ok">Ολοκληρώθηκε' : 'warn">Ανοιχτό') + '</span>' +
      '<span class="muted">' + esc([when(x.createdAt), KIND[x.kind] || ''].filter(Boolean).join(' · ')) + '</span></div>' +
      '<p class="afb-from"><strong>' + esc(x.name || '(χωρίς όνομα)') + '</strong> · ' + mail + '</p>' +
      (x.page && /^https?:\/\//.test(x.page) ? '<p class="afb-page">Σελίδα: <a href="' + esc(x.page) + '">' + esc(x.page) + '</a></p>' : '') +
      (shots ? '<div class="fb-thumbs" data-shots>' + shots + '</div>' : '') +
      '<p class="fb-text">' + esc(x.message || '') + '</p>' +
      (closed && x.resolution ? '<div class="fb-answer"><strong>Απάντηση' + (x.resolvedAt ? ' (' + esc(when(x.resolvedAt)) + (x.resolvedBy ? ', ' + esc(x.resolvedBy === 'repo' ? 'από το αποθετήριο' : x.resolvedBy) : '') + ')' : '') + '</strong><p>' + esc(x.resolution) + '</p>' +
        (x.resolutionUrl ? '<p><a href="' + esc(x.resolutionUrl) + '">' + esc(x.resolutionUrl) + '</a></p>' : '') + '</div>' : '') +
      (sentBits.length ? '<p class="muted afb-mail">' + sentBits.join(' ') + '</p>' : '') +
      (msgs[t] ? '<p class="form-ok" role="status">' + esc(msgs[t]) + '</p>' : '') +
      form +
      (closing === t ? '' : '<p class="section-foot afb-actions">' +
        (closed ? '<button type="button" class="btn btn-outline btn-sm" data-act="reopen">Άνοιγμα ξανά</button>'
          : '<button type="button" class="btn btn-dark btn-sm" data-act="close">Κλείσιμο με απάντηση</button>') +
        ' <button type="button" class="btn btn-danger btn-sm" data-act="delete">Διαγραφή</button></p>') +
      '</article>';
  }

  function wire() {
    Array.prototype.forEach.call(app.querySelectorAll('[data-view-tab]'), function (b) {
      b.addEventListener('click', function () { view = b.getAttribute('data-view-tab'); closing = null; render(); });
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-shots]'), viewers);
    Array.prototype.forEach.call(app.querySelectorAll('[data-t]'), function (cardEl) {
      var t = cardEl.getAttribute('data-t');
      var act = function (name, fn) { var b = cardEl.querySelector('[data-act="' + name + '"]'); if (b) b.addEventListener('click', function () { fn(b); }); };
      act('close', function () { closing = t; msgs[t] = ''; render(); var ta = document.getElementById('afb-res-' + t); if (ta) ta.focus(); });
      act('cancel', function () { closing = null; render(); focusAct(t, 'close'); });
      act('reopen', function (b) { b.disabled = true; update(t, { status: 'open' }, 'Άνοιξε ξανά.', 'close'); });
      act('delete', function (b) {
        if (!window.confirm('Οριστική διαγραφή του μηνύματος ' + t + ' και των εικόνων του;\n\nΔεν αναιρείται. (Αν θέλετε απλώς να το ολοκληρώσετε, πατήστε «Κλείσιμο με απάντηση».)')) return;
        b.disabled = true;
        // the ticket and its screenshots together
        var ref = db.collection('feedback').doc(t), batch = db.batch();
        for (var i = 1; i <= 5; i++) batch.delete(ref.collection('shots').doc(String(i)));
        batch.delete(ref);
        batch.commit().then(function () { delete shotCache[t]; var h = q('#afb-h'); if (h) h.focus({ preventScroll: true }); },
          function (e) { b.disabled = false; window.alert(A.friendly(e)); });
      });
      var form = cardEl.querySelector('[data-close-form]');
      if (form) {
        var ta = form.querySelector('textarea'), url = form.querySelector('input[type=url]');
        var keep = function () { drafts[t] = { text: ta.value, url: url.value }; };
        ta.addEventListener('input', keep); url.addEventListener('input', keep);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var msg = form.querySelector('[data-close-msg]'), text = ta.value.trim(), link = url.value.trim();
          if (!text) { msg.textContent = 'Γράψτε τι κάναμε: αυτό θα διαβάσει ο αποστολέας.'; ta.focus(); return; }
          if (link && !/^https:\/\/[^\s]+$/i.test(link)) { msg.textContent = 'Ο σύνδεσμος πρέπει να ξεκινά με https://'; url.focus(); return; }
          form.querySelector('[data-act="send"]').disabled = true;
          update(t, {
            status: 'closed', resolution: text.slice(0, 5000), resolutionUrl: link.slice(0, 500),
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp(), resolvedBy: String((me && me.email) || '').slice(0, 200)
          }, 'Ολοκληρώθηκε.', 'reopen', function () { delete drafts[t]; closing = null; });
        });
      }
    });
  }
  function focusAct(t, name) {
    var b = app.querySelector('[data-t="' + t + '"] [data-act="' + name + '"]');
    if (b) b.focus(); else { var h = q('#afb-h'); if (h) h.focus(); }
  }
  function update(t, patch, done, next, before) {
    db.collection('feedback').doc(t).update(patch).then(function () {
      if (before) before();
      msgs[t] = done;
      render();
      focusAct(t, next);
    }, function (e) {
      render();                                  // first redraw (buttons enabled again), then say why
      var m = app.querySelector('[data-t="' + t + '"] [data-close-msg]');
      if (m) m.textContent = A.friendly(e); else window.alert(A.friendly(e));
    });
  }
})();
