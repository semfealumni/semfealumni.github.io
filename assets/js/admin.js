/* SEMFE Alumni: the admin page. Lists every membership application, lets an
 * admin approve / reject / reset it, record the year's dues, delete it, and
 * export the list (CSV) or copy the e-mail addresses of those who asked for
 * the newsletter or job announcements. Below it, every registered account
 * (with or without an application), from the accounts Cloud Function
 * (functions/accounts.js): search, CSV, delete, and MERGE two accounts of one
 * person (the kept one receives the other's application, dues, directory card
 * and sign-in methods; the other is deleted).
 * Who is an admin is decided by isAdmin() in firestore.rules; ADMIN_EMAILS in
 * config.js only decides whether this page tries. */
(function () {
  'use strict';
  var A = window.SemfeAuth;
  var app = document.getElementById('admin-app');
  if (!A || !app) return;
  var esc = A.esc, db = null, FV = null, unsub = null, all = [], filter = 'pending', query = '', me = null, keepFocus = null;
  // registered accounts: the list (null while loading), its error, search, view, the ticked rows
  var users = null, usersErr = null, uq = '', uview = 'all', picked = [], merging = false, uMsg = null;
  var YEAR = new Date().getFullYear();
  var STAGES = { graduate: 'Απόφοιτος', 'final-year': 'Τελειόφοιτος', faculty: 'ΔΕΠ' };
  var PROVIDER = { 'google.com': 'Google', 'facebook.com': 'Facebook', 'oidc.linkedin': 'LinkedIn', linkedin: 'LinkedIn', password: 'E-mail' };
  function providerName(p) { return PROVIDER[p] || String(p || ''); }
  var STATUS = { pending: ['warn', 'Σε αναμονή'], active: ['ok', 'Ενεργό μέλος'], rejected: ['err', 'Απορρίφθηκε'] };

  function html(s) { app.innerHTML = s; }
  A.onChange(function (u) {
    me = u;
    if (unsub) { unsub(); unsub = null; }
    // a different account (or none) starts from a clean users list: signing out
    // and in again without a reload must not leave the old spinner behind
    users = null; usersErr = null; picked = []; merging = false; uMsg = null;
    if (!A.configured) return html('<div class="notice warn"><strong>Η σύνδεση μελών δεν έχει ενεργοποιηθεί ακόμα.</strong><p>Δείτε το FIREBASE-SETUP.md.</p></div>');
    if (!u) {
      html('<div class="panel" style="max-width:640px"><h2>Μόνο για διαχειριστές</h2><p>Συνδεθείτε με τον λογαριασμό διαχειριστή.</p><button type="button" class="btn btn-primary" data-open>Σύνδεση</button></div>');
      app.querySelector('[data-open]').addEventListener('click', function (e) { A.open('signin', e.currentTarget); });
      return;
    }
    if (!A.isAdmin(u)) {
      return html('<div class="notice err"><strong>Δεν έχετε πρόσβαση σε αυτή τη σελίδα.</strong><p>Είστε συνδεδεμένος/η ως ' + esc(u.email || A.displayName(u)) +
        (u.email && !u.emailVerified ? ' (το e-mail δεν έχει επιβεβαιωθεί)' : '') + '. Η σελίδα είναι μόνο για τους διαχειριστές του μητρώου μελών.</p></div>');
    }
    html('<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση αιτήσεων…</div>');
    A.db().then(function (d) {
      db = d; FV = firebase.firestore.FieldValue;
      unsub = db.collection('members').onSnapshot(function (qs) {
        all = [];
        qs.forEach(function (doc) { var x = doc.data(); x.id = doc.id; all.push(x); });
        all.sort(function (a, b) { return ts(b.createdAt) - ts(a.createdAt); });
        render();
        A.noteMenu({ pending: all.filter(function (m) { return (m.status || 'pending') === 'pending'; }).length });
        if (users === null && !usersErr) loadUsers();
      }, function (e) {
        html('<div class="notice err"><strong>Δεν ήταν δυνατή η φόρτωση</strong><p>' + esc(A.friendly(e)) + '</p><p>Αν μόλις ρυθμίσατε το Firebase, βεβαιωθείτε ότι δημοσιεύσατε το firestore.rules και ότι το ' + esc(u.email) + ' υπάρχει και στο isAdmin() των κανόνων.</p></div>');
      });
    }, function (e) { html('<div class="notice err"><p>' + esc(A.friendly(e)) + '</p></div>'); });
  });

  function ts(t) { return t && t.toMillis ? t.toMillis() : 0; }
  function date(t) { var ms = ts(t); if (!ms) return ''; var d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
  function fold(s) { s = String(s || '').toLowerCase(); if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); return s.replace(/ς/g, 'σ'); }
  function visible() {
    var q = fold(query);
    return all.filter(function (m) {
      if (filter !== 'all' && (m.status || 'pending') !== filter) return false;
      return !q || fold([m.firstName, m.lastName, m.email, m.employer, m.city, m.gradYear, m.phone].join(' ')).indexOf(q) !== -1;
    });
  }

  /* Every change redraws the page, and a redraw would drop keyboard focus on
     <body>. So note what had focus and put it back on the same control, or on
     the nearest one left when that control is gone (an approved row leaves
     the "pending" list, for example). */
  function focusKey() {
    var el = document.activeElement;
    if (!el || el === document.body || !app.contains(el)) return null;
    var tr = el.closest ? el.closest('tr[data-id]') : null, rows = app.querySelectorAll('tr[data-id]');
    return {
      sel: el.id ? '#' + el.id
        : el.hasAttribute('data-filter') ? '[data-filter="' + el.getAttribute('data-filter') + '"]'
        : el.hasAttribute('data-copy') ? '[data-copy="' + el.getAttribute('data-copy') + '"]'
        : el.hasAttribute('data-csv') ? '[data-csv]'
        : null,
      id: tr ? tr.getAttribute('data-id') : null,
      act: el.getAttribute('data-act'),
      row: tr ? Array.prototype.indexOf.call(rows, tr) : -1,
      pos: el.id === 'adm-q' ? el.selectionStart : null
    };
  }
  function restoreFocus(k) {
    if (!k) return;
    var el = null;
    if (k.sel) el = app.querySelector(k.sel);
    if (!el && k.id) {
      var tr = app.querySelector('tr[data-id="' + cssEsc(k.id) + '"]');
      if (tr) el = tr.querySelector('[data-act="' + k.act + '"]') || tr.querySelector('button');
      // the row left this list (approved, say): the focus goes to the list's
      // own filter, never onto the next person's buttons, where a second Enter
      // would approve someone else
      if (!el) el = app.querySelector('[data-filter][aria-pressed="true"]');
    }
    if (!el) return;
    el.focus({ preventScroll: true });                   // a redraw must not scroll the page
    if (k.pos != null) try { el.setSelectionRange(k.pos, k.pos); } catch (e) {}
  }
  function cssEsc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'); }

  /* The frame (filters, search box, buttons) is built ONCE and only the
     figures and the table are redrawn. Rebuilding the search box on every
     keystroke would break typing with an input method (Android keyboards,
     the Greek accent key), which composes a word across several events. */
  function render() {
    var keep = focusKey() || keepFocus;
    keepFocus = null;
    if (!app.querySelector('[data-admin-frame]')) buildFrame();
    var count = function (st) { return all.filter(function (m) { return (m.status || 'pending') === st; }).length; };
    var paidNow = all.filter(function (m) { return m.status === 'active' && (m.duesYears || []).indexOf(YEAR) !== -1; }).length;
    var list = visible();
    app.querySelector('[data-tiles]').innerHTML =
      tile(all.length, 'Αιτήσεις συνολικά') + tile(count('pending'), 'Σε αναμονή') + tile(count('active'), 'Ενεργά μέλη') + tile(paidNow, 'Συνδρομή ' + YEAR);
    app.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(filter === b.getAttribute('data-filter'))); });
    app.querySelector('[data-csv]').textContent = 'Εξαγωγή CSV (' + list.length + ')';
    app.querySelector('[data-list]').innerHTML = !list.length ? '<p class="muted">Καμία αίτηση σε αυτή την κατηγορία.</p>'
      : '<div class="table-wrap"><table class="data stack"><thead><tr><th>Μέλος</th><th>Κατάσταση</th><th>ΣΕΜΦΕ</th><th>Εργασία</th><th>Αίτηση</th><th>Συνδρομές</th><th>Ενέργειες</th></tr></thead><tbody>' +
        list.map(row).join('') + '</tbody></table></div>';
    wireRows();
    // focus inside the frame (search box, filters, buttons) was never lost; only rows are redrawn
    if (keep && keep.id) restoreFocus(keep);
  }
  function buildFrame() {
    html('<div data-admin-frame><div class="tiles" data-tiles></div>' +
      '<div class="dir-tools">' +
      '<div class="filters" role="group" aria-label="Κατάσταση" style="margin:0">' +
      [['pending', 'Σε αναμονή'], ['active', 'Ενεργά'], ['rejected', 'Απορρίφθηκαν'], ['all', 'Όλες']].map(function (f) {
        return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="adm-q" class="sr-only">Αναζήτηση</label><input id="adm-q" type="search" placeholder="Αναζήτηση: όνομα, e-mail, εργοδότης…" value="' + esc(query) + '"></div></div>' +
      '<div class="section-foot" style="margin:0 0 16px">' +
      '<button type="button" class="btn btn-outline btn-sm" data-csv>Εξαγωγή CSV</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-copy="consentNewsletter">Αντιγραφή e-mail: newsletter</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-copy="consentJobs">Αντιγραφή e-mail: θέσεις εργασίας</button>' +
      '<span class="form-ok" data-msg role="status"></span></div>' +
      '<div data-list></div>' +
      '<div class="panel users-panel" id="users" style="margin-top:32px"><h2 tabindex="-1">Εγγεγραμμένοι χρήστες</h2>' +
      '<p class="muted intro">Όλοι οι λογαριασμοί σύνδεσης, με ή χωρίς αίτηση μέλους: όνομα, e-mail, τρόποι σύνδεσης, πότε γράφτηκαν και πότε μπήκαν τελευταία φορά. ' +
      'Όταν ένα άτομο έχει δύο λογαριασμούς (π.χ. έναν με Google κι έναν με LinkedIn), τσεκάρετε τους δύο και πατήστε <strong>«Ένωση επιλεγμένων»</strong>: η αίτηση, οι συνδρομές, η καταχώριση στον κατάλογο και οι τρόποι σύνδεσης μεταφέρονται στον λογαριασμό που κρατάτε και ο άλλος διαγράφεται. ' +
      'Όσοι έχουν το ίδιο όνομα ή e-mail με άλλον λογαριασμό σημειώνονται <em>«Πιθανό διπλό»</em>. Το κάθε μέλος μπορεί επίσης να ενώσει μόνο του τους λογαριασμούς του, από τη σελίδα «Ο λογαριασμός μου».</p>' +
      '<div class="dir-tools"><div class="field"><label for="usr-q" class="sr-only">Αναζήτηση χρηστών</label><input id="usr-q" type="search" placeholder="Αναζήτηση: όνομα ή e-mail" value="' + esc(uq) + '"></div>' +
      '<div class="filters" role="group" aria-label="Εμφάνιση χρηστών" style="margin:0">' +
      [['all', 'Όλοι'], ['noapp', 'Χωρίς αίτηση'], ['dup', 'Πιθανά διπλά']].map(function (f) {
        return '<button type="button" data-ufilter="' + f[0] + '" aria-pressed="' + (uview === f[0]) + '">' + f[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="section-foot" style="margin:0 0 12px"><button type="button" class="btn btn-dark btn-sm" data-umerge disabled>Ένωση επιλεγμένων</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-ucsv>Εξαγωγή CSV</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-ureload>Ανανέωση</button>' +
      '<span class="muted" data-ucount role="status"></span></div>' +
      '<div data-umsg role="status"></div><div data-umerge-box></div><div data-users><div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση χρηστών…</div></div></div></div>');
    wireFrame();
    wireUsersFrame();
  }
  function tile(v, l) { return '<div class="tile"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
  function row(m) {
    var st = STATUS[m.status || 'pending'] || STATUS.pending, years = (m.duesYears || []).slice().sort();
    var li = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(m.linkedin || '') ? m.linkedin : '';
    var paid = years.indexOf(YEAR) !== -1;
    return '<tr data-id="' + esc(m.id) + '">' +
      '<td data-label="Μέλος"><strong>' + esc(m.firstName + ' ' + m.lastName) + '</strong><br><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>' + (m.phone ? '<br>' + esc(m.phone) : '') +
      (li ? '<br><a href="' + esc(li) + '" target="_blank" rel="noopener">LinkedIn</a>' : '') + (m.note ? '<br><em class="muted">«' + esc(m.note) + '»</em>' : '') + '</td>' +
      '<td data-label="Κατάσταση"><span class="badge ' + st[0] + '">' + st[1] + '</span>' + (m.reviewedBy ? '<br><small class="muted">' + esc(m.reviewedBy) + ' ' + date(m.reviewedAt) + '</small>' : '') + '</td>' +
      '<td data-label="ΣΕΜΦΕ">' + esc(STAGES[m.stage] || m.stage || '') + (m.entryYear ? '<br>Εισ. ' + esc(m.entryYear) : '') + (m.gradYear ? '<br>Αποφ. ' + esc(m.gradYear) : '') + (m.direction ? '<br>' + esc(m.direction) : '') + '</td>' +
      '<td data-label="Εργασία">' + ([esc([m.position, m.employer].filter(Boolean).join(', ')), m.city ? '<span class="muted">' + esc(m.city) + '</span>' : '']
        .filter(Boolean).join('<br>') || '—') + '</td>' +
      '<td data-label="Αίτηση">' + date(m.createdAt) + '<br><small class="muted">' + esc(providerName(m.provider)) + '</small></td>' +
      '<td data-label="Συνδρομές">' + (years.length ? esc(years.join(', ')) : '—') + '</td>' +
      '<td class="acts" data-label="Ενέργειες"><div class="acts-in">' +
      (m.status !== 'active' ? '<button type="button" class="btn btn-dark btn-sm" data-act="approve">Έγκριση</button> ' : '') +
      '<button type="button" class="btn btn-outline btn-sm" data-act="dues" aria-pressed="' + paid + '">' + (paid ? '✓ Πλήρωσε ' + YEAR : 'Πλήρωσε ' + YEAR) + '</button> ' +
      (m.status !== 'rejected' ? '<button type="button" class="btn btn-outline btn-sm" data-act="reject">Απόρριψη</button> ' : '') +
      (m.status !== 'pending' ? '<button type="button" class="btn btn-outline btn-sm" data-act="pending">Σε αναμονή</button> ' : '') +
      '<button type="button" class="btn btn-danger btn-sm" data-act="delete">Διαγραφή</button></div></td></tr>';
  }

  function wireFrame() {
    var msg = app.querySelector('[data-msg]');
    app.querySelectorAll('[data-filter]').forEach(function (b) { b.addEventListener('click', function () { filter = b.getAttribute('data-filter'); render(); }); });
    var q = app.querySelector('#adm-q');
    q.addEventListener('input', function () { query = q.value; render(); });
    app.querySelector('[data-csv]').addEventListener('click', function () { downloadCsv(visible()); });
    app.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-copy');
        var emails = all.filter(function (m) { return m.status === 'active' && m[key]; }).map(function (m) { return m.email; });
        window.SEMFE_UTIL.copyText(emails.join(', '), function (ok) {
          msg.className = ok ? 'form-ok' : 'form-error';
          msg.textContent = ok ? 'Αντιγράφηκαν ' + emails.length + ' διευθύνσεις (ενεργά μέλη). Επικολλήστε τις στο πεδίο Bcc.' : 'Η αντιγραφή απέτυχε.';
        });
      });
    });
  }
  function wireRows() {
    app.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.closest('tr').getAttribute('data-id'), m = all.filter(function (x) { return x.id === id; })[0];
        if (m) act(b.getAttribute('data-act'), m, b);
      });
    });
  }

  function act(kind, m, btn) {
    var ref = db.collection('members').doc(m.id), who = m.firstName + ' ' + m.lastName;
    var stamp = { reviewedAt: FV.serverTimestamp(), reviewedBy: me.email };
    var job;
    if (kind === 'approve') job = ref.update(merge({ status: 'active' }, stamp));
    else if (kind === 'pending' || kind === 'reject') {
      if (kind === 'reject' && !window.confirm('Απόρριψη της αίτησης του/της ' + who + ';')) return;
      job = ref.update(merge({ status: kind === 'reject' ? 'rejected' : 'pending' }, stamp))
        .then(function () { return db.collection('directory').doc(m.id).delete(); });
    } else if (kind === 'dues') {
      var paid = (m.duesYears || []).indexOf(YEAR) !== -1;
      job = ref.update(merge({ duesYears: paid ? FV.arrayRemove(YEAR) : FV.arrayUnion(YEAR) }, stamp));
    } else if (kind === 'delete') {
      if (!window.confirm('Οριστική διαγραφή της αίτησης του/της ' + who + ';\n\nΟ λογαριασμός σύνδεσης παραμένει· διαγράφεται από τη λίστα «Εγγεγραμμένοι χρήστες» πιο κάτω.')) return;
      job = db.collection('directory').doc(m.id).delete().catch(function () {}).then(function () { return ref.delete(); });
    }
    if (!job) return;
    keepFocus = focusKey();        // disabling the focused button drops focus: remember it first
    btn.disabled = true;
    job.catch(function (e) { btn.disabled = false; window.alert(A.friendly(e)); });
  }
  function merge(a, b) { for (var k in b) a[k] = b[k]; return a; }

  /* ---- registered accounts ---------------------------------------------- */
  var METHOD = { google: 'Google', linkedin: 'LinkedIn', facebook: 'Facebook', password: 'E-mail' };
  var APP_RANK = { active: 3, pending: 2, rejected: 1 };
  function loadUsers() {
    usersErr = null;
    var box = app.querySelector('[data-users]');
    if (box && users === null) box.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση χρηστών…</div>';
    return A.callAccounts({ action: 'list' }).then(function (j) {
      users = (j.accounts || []).slice();
      var here = {}; users.forEach(function (u) { here[u.uid] = 1; });
      picked = picked.filter(function (uid) { return here[uid]; });
      markDuplicates();
      renderUsers();
    }, function (e) {
      usersErr = e; users = null;
      renderUsers();
    });
  }
  function uName(u) {
    var a = u.application;
    return a && (a.firstName || a.lastName) ? (a.firstName + ' ' + a.lastName).trim() : (u.name || '');
  }
  /* the same name (in any order, accents and case ignored), or the same e-mail
     (the sign-in address or the one on the application), as another account */
  function markDuplicates() {
    var byKey = {};
    users.forEach(function (u) {
      u._keys = [];
      var n = fold(uName(u)).split(/\s+/).filter(Boolean).sort().join(' ');
      if (n.indexOf(' ') !== -1) u._keys.push('n:' + n);         // a full name, not a lone first name
      [u.email, u.application && u.application.email].forEach(function (e) {
        e = String(e || '').trim().toLowerCase();
        if (e && u._keys.indexOf('e:' + e) === -1) u._keys.push('e:' + e);
      });
      u._keys.forEach(function (k) { (byKey[k] = byKey[k] || []).push(u.uid); });
    });
    users.forEach(function (u) {
      u._dup = u._keys.some(function (k) { return byKey[k].length > 1; });
      u._group = u._keys.filter(function (k) { return byKey[k].length > 1; }).sort()[0] || '';
    });
  }
  function visibleUsers() {
    var q = fold(uq);
    var list = users.filter(function (u) {
      if (uview === 'noapp' && u.application) return false;
      if (uview === 'dup' && !u._dup) return false;
      return !q || fold([uName(u), u.name, u.email, u.application && u.application.email].join(' ')).indexOf(q) !== -1;
    });
    list.sort(uview === 'dup'
      ? function (a, b) { return a._group < b._group ? -1 : a._group > b._group ? 1 : (a.created || 0) - (b.created || 0); }
      : function (a, b) { return (b.created || 0) - (a.created || 0); });
    return list;
  }
  function day(ms) { if (!ms) return '—'; var d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
  function renderUsers() {
    var box = app.querySelector('[data-users]');
    if (!box) return;
    var countEl = app.querySelector('[data-ucount]'), mergeBtn = app.querySelector('[data-umerge]');
    var msgEl = app.querySelector('[data-umsg]');
    msgEl.innerHTML = uMsg ? '<div class="notice ' + uMsg.cls + '"><p>' + esc(uMsg.text) + '</p></div>' : '';
    app.querySelectorAll('[data-ufilter]').forEach(function (b) { b.setAttribute('aria-pressed', String(uview === b.getAttribute('data-ufilter'))); });
    if (usersErr) {
      countEl.textContent = '';
      mergeBtn.disabled = true;
      box.innerHTML = usersErr.code === 'semfe/accounts-unreachable'
        ? '<div class="notice warn"><strong>Η λίστα χρηστών δεν είναι διαθέσιμη ακόμα</strong><p>Χρειάζεται η νέα λειτουργία «accounts» στο Firebase. Από τον φάκελο του site τρέξτε: ' +
          '<code>firebase deploy --only functions --project semfe-alumni</code> (οδηγίες στο FIREBASE-SETUP.md, «Λίστα χρηστών και ένωση λογαριασμών»).</p>' +
          '<p><button type="button" class="btn btn-outline btn-sm" data-uretry>Δοκιμή ξανά</button></p></div>'
        : '<div class="notice err"><strong>Δεν ήταν δυνατή η φόρτωση των χρηστών</strong><p>' + esc(A.friendly(usersErr)) + '</p>' +
          '<p><button type="button" class="btn btn-outline btn-sm" data-uretry>Δοκιμή ξανά</button></p></div>';
      var r = box.querySelector('[data-uretry]');
      if (r) r.addEventListener('click', function () { box.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση χρηστών…</div>'; loadUsers(); });
      return;
    }
    if (!users) return;
    var list = visibleUsers(), dups = users.filter(function (u) { return u._dup; }).length, noapp = users.filter(function (u) { return !u.application; }).length;
    countEl.textContent = list.length + ' από ' + users.length + ' λογαριασμούς · ' + noapp + ' χωρίς αίτηση' + (dups ? ' · ' + dups + ' πιθανά διπλά' : '');
    mergeBtn.disabled = picked.length !== 2 || merging;
    mergeBtn.textContent = 'Ένωση επιλεγμένων' + (picked.length ? ' (' + picked.length + ')' : '');
    app.querySelector('[data-ucsv]').textContent = 'Εξαγωγή CSV (' + list.length + ')';
    box.innerHTML = !list.length ? '<p class="muted">Κανένας λογαριασμός εδώ.</p>'
      : '<div class="table-wrap"><table class="data stack users"><thead><tr><th><span class="sr-only">Επιλογή</span></th><th>Χρήστης</th><th>Τρόποι σύνδεσης</th><th>Αίτηση</th><th>Εγγραφή</th><th>Τελευταία σύνδεση</th><th>Ενέργειες</th></tr></thead><tbody>' +
        list.map(userRow).join('') + '</tbody></table></div>';
    box.querySelectorAll('[data-pick]').forEach(function (c) {
      c.addEventListener('change', function () {
        var uid = c.getAttribute('data-pick');
        picked = picked.filter(function (x) { return x !== uid; });
        if (c.checked) picked.push(uid);
        if (picked.length > 2) picked = picked.slice(-2);          // two at a time: the oldest tick goes
        uMsg = null;
        renderUsers();
        var again = app.querySelector('[data-pick="' + cssEsc(uid) + '"]'); if (again) again.focus();
      });
    });
    box.querySelectorAll('[data-udel]').forEach(function (b) {
      b.addEventListener('click', function () { deleteUser(b.getAttribute('data-udel'), b); });
    });
    renderMergeBox();
  }
  function userRow(u) {
    var a = u.application, st = a ? (STATUS[a.status] || STATUS.pending) : null, self = me && u.uid === me.uid, name = uName(u);
    var methods = (u.methods || []).map(function (k) { return '<span class="chip-sm">' + esc(METHOD[k] || k) + '</span>'; }).join(' ') || '<span class="muted">—</span>';
    return '<tr data-uid="' + esc(u.uid) + '"' + (picked.indexOf(u.uid) !== -1 ? ' class="picked"' : '') + '>' +
      '<td class="pick" data-label="Επιλογή"><input type="checkbox" data-pick="' + esc(u.uid) + '" aria-label="Επιλογή: ' + esc(name || u.email || u.uid) + '"' + (picked.indexOf(u.uid) !== -1 ? ' checked' : '') + '></td>' +
      '<td data-label="Χρήστης"><strong>' + (name ? esc(name) : '<span class="muted">(χωρίς όνομα)</span>') + '</strong>' +
      (self ? ' <span class="badge muted">εσείς</span>' : '') + (u._dup ? ' <span class="badge warn">Πιθανό διπλό</span>' : '') +
      (u.email ? '<br><a href="mailto:' + esc(u.email) + '">' + esc(u.email) + '</a>' + (u.emailVerified ? '' : ' <small class="muted">(ανεπιβεβαίωτο)</small>') : '<br><span class="muted">χωρίς e-mail</span>') +
      (a && a.email && a.email.toLowerCase() !== String(u.email || '').toLowerCase() ? '<br><small class="muted">στην αίτηση: ' + esc(a.email) + '</small>' : '') + '</td>' +
      '<td data-label="Τρόποι σύνδεσης">' + methods + '</td>' +
      '<td data-label="Αίτηση">' + (st ? '<span class="badge ' + st[0] + '">' + st[1] + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td data-label="Εγγραφή">' + day(u.created) + '</td>' +
      '<td data-label="Τελευταία σύνδεση">' + day(u.lastSeen) + '</td>' +
      '<td class="acts" data-label="Ενέργειες">' + (self ? '' : '<button type="button" class="btn btn-danger btn-sm" data-udel="' + esc(u.uid) + '">Διαγραφή</button>') + '</td></tr>';
  }
  function byUid(uid) { return (users || []).filter(function (u) { return u.uid === uid; })[0]; }
  function describe(u) {
    var a = u.application, bits = [];
    if (u.email) bits.push(u.email);
    bits.push((u.methods || []).map(function (k) { return METHOD[k] || k; }).join(' + ') || 'χωρίς τρόπο σύνδεσης');
    bits.push(a ? 'αίτηση: ' + (STATUS[a.status] || STATUS.pending)[1] + ((a.duesYears || []).length ? ', συνδρομές ' + a.duesYears.join(', ') : '') : 'χωρίς αίτηση');
    bits.push('από ' + day(u.created));
    return bits.join(' · ');
  }
  function renderMergeBox() {
    var box = app.querySelector('[data-umerge-box]');
    if (!box) return;
    if (!merging || picked.length !== 2) { box.innerHTML = ''; return; }
    var two = picked.map(byUid).filter(Boolean);
    if (two.length !== 2) { box.innerHTML = ''; return; }
    // keep, by default: the further-along application, else the older account; never yourself as the one removed
    var rank = function (u) { return u.application ? APP_RANK[u.application.status] || 2 : 0; };
    two.sort(function (x, y) { return (rank(y) - rank(x)) || ((x.created || 0) - (y.created || 0)); });
    if (me && two[1].uid === me.uid) two.reverse();
    var chosen = box.querySelector('input[name="keep"]:checked');
    var keepUid = chosen && picked.indexOf(chosen.value) !== -1 ? chosen.value : two[0].uid;
    box.innerHTML = '<div class="merge-box" id="umerge"><h3 tabindex="-1">Ένωση δύο λογαριασμών</h3>' +
      '<p class="muted">Ποιος λογαριασμός μένει; Ο άλλος διαγράφεται, αφού μεταφερθούν η αίτηση μέλους του, οι συνδρομές, η καταχώριση στον κατάλογο και οι τρόποι σύνδεσής του.</p>' +
      '<fieldset class="keep-pick"><legend class="sr-only">Ο λογαριασμός που μένει</legend>' +
      two.map(function (u) {
        return '<label class="keep-opt"><input type="radio" name="keep" value="' + esc(u.uid) + '"' + (u.uid === keepUid ? ' checked' : '') + (me && u.uid !== me.uid && two.some(function (o) { return o.uid === me.uid; }) ? ' disabled' : '') + '>' +
          '<span><strong>' + esc(uName(u) || '(χωρίς όνομα)') + '</strong><br><small class="muted">' + esc(describe(u)) + '</small></span></label>';
      }).join('') + '</fieldset>' +
      '<p class="muted" style="font-size:.88rem">Δεν μεταφέρονται: ο κωδικός (e-mail και κωδικός) του λογαριασμού που φεύγει, και ένα δεύτερο Google αν ο λογαριασμός που μένει έχει ήδη Google. Όταν υπάρχουν δύο αιτήσεις, συμπληρώνονται τα κενά της μίας από την άλλη και κρατιέται η πιο προχωρημένη κατάσταση.</p>' +
      '<div class="section-foot" style="margin:0"><button type="button" class="btn btn-danger btn-sm" data-umerge-go>Ένωση (οριστική)</button><button type="button" class="btn btn-outline btn-sm" data-umerge-x>Ακύρωση</button></div>' +
      '<div class="form-error" data-umerge-msg role="alert"></div></div>';
    box.querySelector('[data-umerge-x]').addEventListener('click', function () { merging = false; renderUsers(); var b = app.querySelector('[data-umerge]'); if (b) b.focus(); });
    box.querySelector('[data-umerge-go]').addEventListener('click', function () { runAdminMerge(box.querySelector('input[name="keep"]:checked').value, this); });
  }
  function runAdminMerge(keepUid, btn) {
    var dropUid = picked.filter(function (x) { return x !== keepUid; })[0], keep = byUid(keepUid), drop = byUid(dropUid);
    var msg = app.querySelector('[data-umerge-msg]');
    if (!keep || !drop) return;
    if (!window.confirm('Ένωση: μένει ο λογαριασμός «' + (uName(keep) || keep.email) + '» (' + (keep.email || 'χωρίς e-mail') + ') και διαγράφεται ο «' + (uName(drop) || drop.email) + '» (' + (drop.email || 'χωρίς e-mail') + ').\n\nΔεν αναιρείται. Συνέχεια;')) return;
    btn.disabled = true; msg.textContent = '';
    A.callAccounts({ action: 'merge', keep: keepUid, drop: dropUid }).then(function (j) {
      merging = false; picked = [];
      var rep = j.report || {};
      uMsg = rep.partial
        ? { cls: 'err', text: 'Η ένωση έγινε μόνο εν μέρει: ο λογαριασμός ' + (drop.email || uName(drop)) + ' κρατήθηκε, γιατί ένας τρόπος σύνδεσής του δεν μεταφέρθηκε. ' + adminSummary(rep) + ' Δοκιμάστε ξανά σε λίγο.' }
        : { cls: 'ok', text: 'Ενώθηκαν: έμεινε ο λογαριασμός ' + (keep.email || uName(keep)) + ', διαγράφηκε ο ' + (drop.email || uName(drop)) + '. ' + adminSummary(rep) };
      return loadUsers().then(function () { var h = app.querySelector('#users h2'); if (h) h.focus(); });
    }, function (e) {
      btn.disabled = false;
      msg.textContent = A.friendly(e);
    });
  }
  function adminSummary(r) {
    var bits = [];
    if (r.application === 'moved') bits.push('Η αίτηση μεταφέρθηκε.');
    else if (r.application === 'merged') bits.push('Οι δύο αιτήσεις έγιναν μία.');
    if ((r.moved || []).length) bits.push('Νέοι τρόποι σύνδεσης: ' + r.moved.map(function (k) { return METHOD[k] || k; }).join(', ') + '.');
    var nm = (r.notMoved || []).map(function (x) { return (METHOD[x.method] || x.method) + (x.email ? ' (' + x.email + ')' : ''); });
    if (nm.length) bits.push('Δεν μεταφέρθηκαν: ' + nm.join(', ') + '.');
    return bits.join(' ');
  }
  function deleteUser(uid, btn) {
    var u = byUid(uid);
    if (!u) return;
    if (!window.confirm('Οριστική διαγραφή του λογαριασμού «' + (uName(u) || '(χωρίς όνομα)') + '» (' + (u.email || 'χωρίς e-mail') + ');\n\nΔιαγράφονται ο λογαριασμός σύνδεσης, η αίτηση μέλους, η καταχώριση στον κατάλογο και η σύνδεση LinkedIn. Δεν αναιρείται.')) return;
    btn.disabled = true;
    A.callAccounts({ action: 'delete', uid: uid }).then(function () {
      picked = picked.filter(function (x) { return x !== uid; });
      uMsg = { cls: 'ok', text: 'Διαγράφηκε ο λογαριασμός ' + (u.email || uName(u) || uid) + '.' };
      return loadUsers();
    }, function (e) { btn.disabled = false; window.alert(A.friendly(e)); });
  }
  function wireUsersFrame() {
    var q = app.querySelector('#usr-q');
    q.addEventListener('input', function () { uq = q.value; renderUsers(); });
    app.querySelectorAll('[data-ufilter]').forEach(function (b) { b.addEventListener('click', function () { uview = b.getAttribute('data-ufilter'); renderUsers(); }); });
    app.querySelector('[data-umerge]').addEventListener('click', function () {
      merging = true; uMsg = null; renderUsers();
      var h = app.querySelector('#umerge h3'); if (h) { h.focus(); if (h.scrollIntoView) h.scrollIntoView({ block: 'nearest' }); }
    });
    app.querySelector('[data-ureload]').addEventListener('click', function () { uMsg = null; loadUsers(); });
    app.querySelector('[data-ucsv]').addEventListener('click', function () {
      if (!users) return;
      csv([['name', 'Όνομα'], ['email', 'E-mail'], ['verified', 'Επιβεβαιωμένο e-mail'], ['methods', 'Τρόποι σύνδεσης'], ['app', 'Αίτηση'],
        ['created', 'Εγγραφή'], ['lastSeen', 'Τελευταία σύνδεση'], ['dup', 'Πιθανό διπλό'], ['uid', 'Κωδικός λογαριασμού']],
        visibleUsers().map(function (u) {
          return { name: uName(u), email: u.email, verified: !!u.emailVerified, methods: (u.methods || []).map(function (k) { return METHOD[k] || k; }).join(' + '),
            app: u.application ? (STATUS[u.application.status] || STATUS.pending)[1] : '', created: u.created ? new Date(u.created).toISOString().slice(0, 10) : '',
            lastSeen: u.lastSeen ? new Date(u.lastSeen).toISOString().slice(0, 10) : '', dup: !!u._dup, uid: u.uid };
        }), 'semfe-users-');
    });
  }

  function downloadCsv(list) {
    csv([['firstName', 'Όνομα'], ['lastName', 'Επώνυμο'], ['email', 'E-mail'], ['phone', 'Τηλέφωνο'], ['status', 'Κατάσταση'], ['stage', 'Ιδιότητα'],
      ['entryYear', 'Εισαγωγή'], ['gradYear', 'Αποφοίτηση'], ['direction', 'Κατεύθυνση'], ['position', 'Θέση'], ['employer', 'Εργοδότης'], ['city', 'Πόλη'],
      ['linkedin', 'LinkedIn'], ['duesYears', 'Συνδρομές'], ['consentNewsletter', 'Newsletter'], ['consentJobs', 'Θέσεις εργασίας'],
      ['consentDirectory', 'Κατάλογος'], ['note', 'Σημείωση'], ['createdAt', 'Αίτηση'], ['provider', 'Σύνδεση']], list, 'semfe-members-');
  }
  function csv(cols, list, prefix) {
    var cell = function (v, key) {
      if (v && v.toMillis) v = new Date(v.toMillis()).toISOString().slice(0, 10);
      if (Array.isArray(v)) v = v.join(' ');
      if (typeof v === 'boolean') v = v ? 'ναι' : 'όχι';
      if (key === 'provider') v = providerName(v);
      v = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;           // stop spreadsheet formula injection
      return '"' + v.replace(/"/g, '""') + '"';
    };
    // ";" between columns: Excel in Greek (and most European) settings expects
    // it, and with "," would put every value in the first column
    var text = '﻿' + cols.map(function (c) { return cell(c[1]); }).join(';') + '\r\n' +
      list.map(function (m) { return cols.map(function (c) { return cell(m[c[0]], c[0]); }).join(';'); }).join('\r\n');
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = prefix + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 500);
  }
})();
