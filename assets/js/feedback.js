/* SEMFE Alumni: the «Σχόλια» page (feedback/).
 *
 * A signed-in member writes a message, with up to 5 screenshots if they like,
 * and gets a ticket number (SEMFE-YYMMDD-XXXX), which is also the id of the
 * document in feedback/ (the screenshots are feedback/<ticket>/shots/1..5).
 * Everything after that happens elsewhere:
 *   - functions/feedback.js e-mails the admins a copy (screenshots attached)
 *     and the sender a confirmation with the ticket number;
 *   - an admin closes the ticket from the admin page, or a file in
 *     _feedback-resolutions/ closes it (tools/feedback-sync.mjs), and the same
 *     function e-mails the sender how it was resolved;
 *   - tools/feedback-sync.mjs also copies every ticket to a private GitHub
 *     repository, where they can be read and acted on.
 * Below the form: the sender's own messages, with their status and answer.
 * What may be written is decided by firestore.rules (feedback/{ticket}). */
(function () {
  'use strict';
  var A = window.SemfeAuth, U = window.SEMFE_UTIL || {};
  var L = window.SEMFE_I18N, T = L.t;
  var app = document.getElementById('feedback-app');
  if (!A || !app) return;
  var esc = A.esc;
  var MAX_SHOTS = 5, MAX_MSG = 5000;
  var SHOT_BUDGET = 170 * 1024;          // characters per screenshot: 5 of them stay well under Firestore's 1 MB a document
  var KINDS = [['problem', T('Κάτι δεν λειτουργεί', 'Something does not work')], ['idea', T('Πρόταση ή ιδέα', 'A suggestion or idea')], ['other', T('Κάτι άλλο', 'Something else')]];
  var KIND_NAME = { problem: T('Πρόβλημα', 'Problem'), idea: T('Πρόταση', 'Suggestion'), other: T('Άλλο', 'Other') };
  var GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;   // an admin's answer is Greek: marked so on the English page
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I: the number is read aloud and typed

  var user = null, db = null, shots = [], sent = null, mine = null, mineErr = null, busy = false, working = 0;
  var draft = { kind: 'problem', message: '', page: fromPage() };

  /* the page the member came from: ?from=/semfealumni/… (links from the site
     add it), else the previous page when it was on this site */
  function fromPage() {
    try {
      var p = new URLSearchParams(location.search).get('from');
      if (p && /^\/[^/]/.test(p)) return (location.origin + p).slice(0, 500);
      if (document.referrer) {
        var r = new URL(document.referrer);
        if (r.origin === location.origin && r.pathname.indexOf('/feedback') === -1) return r.href.slice(0, 500);
      }
    } catch (e) {}
    return '';
  }
  function ticketNumber() {
    var d = new Date(), two = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = 'SEMFE-' + String(d.getFullYear()).slice(2) + two(d.getMonth() + 1) + two(d.getDate()) + '-';
    var r = [];
    try { r = Array.prototype.slice.call(window.crypto.getRandomValues(new Uint32Array(4))); } catch (e) {}
    for (var i = 0; i < 4; i++) s += ALPHA[(r[i] !== undefined ? r[i] : Math.floor(Math.random() * 1e9)) % ALPHA.length];
    return s;
  }
  function ms(t) { return t && t.toMillis ? t.toMillis() : 0; }
  function when(t) {
    var v = ms(t); if (!v) return '';
    var d = new Date(v);
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function q(sel) { return app.querySelector(sel); }

  A.onChange(function (u) {
    var was = user && user.uid;
    user = u;
    if (!u || u.uid !== was) { sent = null; mine = null; mineErr = null; shots = []; draft.message = ''; }
    render();
    if (u && A.configured) {
      A.db().then(function (d) { db = d; loadMine(); }, function (e) { mineErr = A.friendly(e); paintMine(); });
    }
  });

  /* ---- drawing ------------------------------------------------------------ */
  function render() {
    if (!A.configured) {
      app.innerHTML = '<div class="notice warn"><strong>' + T('Η αποστολή σχολίων ανοίγει σύντομα.', 'Sending feedback opens soon.') + '</strong>' +
        T('<p>Μέχρι τότε, γράψτε μας από τη σελίδα <a href="' + A.home + 'contact/">Επικοινωνία</a>.</p></div>',
          '<p>Until then, write to us from the <a href="' + A.home + 'contact/">Contact</a> page.</p></div>');
      return;
    }
    if (!user) {
      app.innerHTML = '<div class="panel fb-signin"><h2>' + T('Συνδεθείτε για να μας γράψετε', 'Sign in to write to us') + '</h2>' +
        '<p>' + T('Τα σχόλια και οι αναφορές προβλημάτων στέλνονται από τον λογαριασμό σας, ώστε να σας απαντήσουμε με e-mail και να βλέπετε εδώ τι έγινε με το καθένα.',
          'Feedback and problem reports are sent from your account, so that we can reply to you by e-mail and you can see here what happened with each one.') + '</p>' +
        '<p class="section-foot" style="margin-top:14px"><button type="button" class="btn btn-primary" data-open-signin>' + T('Σύνδεση ή εγγραφή', 'Sign in or register') + '</button></p>' +
        '<p class="muted" style="margin:14px 0 0">' + T('Χωρίς λογαριασμό μπορείτε να μας γράψετε από τη σελίδα <a href="' + A.home + 'contact/">Επικοινωνία</a>.',
          'Without an account, you can write to us from the <a href="' + A.home + 'contact/">Contact</a> page.') + '</p></div>';
      q('[data-open-signin]').addEventListener('click', function (e) { A.open('signin', e.currentTarget); });
      return;
    }
    app.innerHTML = '<div class="fb-grid"><div data-fb-main></div>' +
      '<section class="panel fb-mine" aria-labelledby="fb-mine-h"><h2 id="fb-mine-h">' + T('Τα μηνύματά μου', 'My messages') + '</h2><div data-mine aria-live="polite"></div></section></div>';
    paintMain();
    paintMine();
  }

  function paintMain() {
    var box = q('[data-fb-main]');
    if (!box) return;
    if (sent) {
      box.innerHTML = '<section class="panel fb-thanks" aria-labelledby="fb-thanks-h">' +
        '<h2 id="fb-thanks-h" tabindex="-1">' + T('Ευχαριστούμε, το λάβαμε', 'Thank you, we have received it') + '</h2>' +
        '<p>' + T('Ο αριθμός του μηνύματός σας:', 'Your message number:') + '</p><p class="fb-ticket"><code>' + esc(sent.ticket) + '</code>' +
        '<button type="button" class="btn btn-outline btn-sm" data-copy-ticket>' + T('Αντιγραφή', 'Copy') + '</button></p>' +
        '<p>' + (sent.mailed
          ? T('Θα λάβετε επιβεβαίωση με αυτόν τον αριθμό στο <strong>' + esc(sent.email) + '</strong>, και όταν το εξετάσουμε, θα σας γράψουμε στο ίδιο e-mail τι κάναμε.',
            'You will receive a confirmation with this number at <strong>' + esc(sent.email) + '</strong>, and once we have looked into it, we will write to the same address to tell you what we did.')
          : T('Θα βλέπετε εδώ, στα «Τα μηνύματά μου», πότε το εξετάσαμε και τι κάναμε.', 'You will see here, under My messages, when we looked into it and what we did.') +
            (sent.email ? T(' (Για να λαμβάνετε και e-mail, επιβεβαιώστε το ' + esc(sent.email) + ' από τη σελίδα «Ο λογαριασμός μου».)',
              ' (To receive e-mails as well, confirm ' + esc(sent.email) + ' on the My account page.)') : '')) + '</p>' +
        '<p class="section-foot" style="margin-top:16px"><button type="button" class="btn btn-dark" data-new>' + T('Νέο μήνυμα', 'New message') + '</button></p></section>';
      q('[data-new]').addEventListener('click', function () { sent = null; paintMain(); var m = q('#fb-message'); if (m) m.focus(); });
      q('[data-copy-ticket]').addEventListener('click', function (e) {
        var b = e.currentTarget;
        if (U.copyText) U.copyText(sent.ticket, function (ok) { b.textContent = ok ? T('Αντιγράφηκε', 'Copied') : T('Αντιγραφή', 'Copy'); });
      });
      return;
    }
    var kinds = KINDS.map(function (k) {
      return '<label class="fb-kind"><input type="radio" name="kind" value="' + k[0] + '"' + (draft.kind === k[0] ? ' checked' : '') + '><span>' + esc(k[1]) + '</span></label>';
    }).join('');
    var mail = user.email
      ? (user.emailVerified ? T('Θα σας απαντήσουμε στο <strong>' + esc(user.email) + '</strong>.', 'We will reply to <strong>' + esc(user.email) + '</strong>.')
        : T('Το e-mail σας (' + esc(user.email) + ') δεν έχει επιβεβαιωθεί, οπότε θα βλέπετε την απάντηση μόνο εδώ, κάτω από τα «Τα μηνύματά μου».',
          'Your e-mail address (' + esc(user.email) + ') has not been confirmed, so you will see the reply only here, under My messages.'))
      : T('Ο λογαριασμός σας δεν έχει e-mail, οπότε θα βλέπετε την απάντηση εδώ, κάτω από τα «Τα μηνύματά μου».',
        'Your account has no e-mail address, so you will see the reply here, under My messages.');
    box.innerHTML = '<section class="panel" aria-labelledby="fb-h"><h2 id="fb-h">' + T('Στείλτε μας σχόλια', 'Send us feedback') + '</h2>' +
      '<p class="muted intro">' + T('Ένα πρόβλημα που βρήκατε στον ιστότοπο, μια ιδέα ή ό,τι άλλο θέλετε να μας πείτε. Κάθε μήνυμα παίρνει αριθμό, και σας γράφουμε όταν το έχουμε εξετάσει.',
        'A problem you found on the website, an idea, or anything else you would like to tell us. Every message gets a number, and we write to you once we have looked into it.') + '</p>' +
      '<form class="form" data-fb-form novalidate>' +
      '<fieldset class="fb-kinds"><legend>' + T('Τι αφορά;', 'What is it about?') + '</legend>' + kinds + '</fieldset>' +
      '<div class="field"><label for="fb-message">' + T('Το μήνυμά σας', 'Your message') + ' <span class="req" aria-hidden="true">*</span></label>' +
      '<textarea id="fb-message" name="message" rows="7" maxlength="' + MAX_MSG + '" required aria-required="true" aria-describedby="fb-message-hint">' + esc(draft.message) + '</textarea>' +
      '<span class="hint" id="fb-message-hint">' + T('Αν κάτι δεν λειτουργεί: τι κάνατε, τι περιμένατε να γίνει και τι έγινε.', 'If something does not work: what you did, what you expected to happen and what happened.') + ' <span data-count></span></span></div>' +
      '<div class="field"><label for="fb-page">' + T('Σε ποια σελίδα;', 'On which page?') + ' <span class="hint">' + T('(προαιρετικό)', '(optional)') + '</span></label>' +
      '<input id="fb-page" name="page" type="url" inputmode="url" maxlength="500" value="' + esc(draft.page) + '" placeholder="https://…"></div>' +
      '<div class="field"><span class="lbl" id="fb-shots-l">' + T('Στιγμιότυπα οθόνης', 'Screenshots') + ' <span class="hint">' + T('(προαιρετικό, έως ' + MAX_SHOTS + ')', '(optional, up to ' + MAX_SHOTS + ')') + '</span></span>' +
      '<div class="fb-drop" data-drop><p>' + T('Σύρετε εικόνες εδώ, επικολλήστε μία (Ctrl+V) ή ', 'Drag images here, paste one (Ctrl+V) or ') +
      '<label class="link-btn fb-pick">' + T('επιλέξτε αρχεία', 'choose files') + '<input type="file" accept="image/*" multiple data-files aria-labelledby="fb-shots-l"></label>.</p>' +
      '<div class="fb-thumbs" data-thumbs></div><p class="form-error" data-shots-msg role="status"></p></div></div>' +
      '<p class="muted fb-mail">' + mail + '</p>' +
      '<div class="form-error" data-fb-msg role="alert"></div>' +
      '<p class="section-foot"><button type="submit" class="btn btn-primary" data-send>' + T('Αποστολή', 'Send') + '</button></p>' +
      '</form></section>';
    var form = q('[data-fb-form]'), ta = q('#fb-message');
    Array.prototype.forEach.call(form.querySelectorAll('input[name=kind]'), function (r) {
      r.addEventListener('change', function () { draft.kind = r.value; });
    });
    ta.addEventListener('input', function () {
      draft.message = ta.value; paintCount();
      if (ta.hasAttribute('aria-invalid')) { ta.removeAttribute('aria-invalid'); q('[data-fb-msg]').textContent = ''; }
    });
    q('#fb-page').addEventListener('input', function (e) { draft.page = e.target.value; });
    q('[data-files]').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    var drop = q('[data-drop]');
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer) addFiles(e.dataTransfer.files); });
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    paintCount();
    paintShots();
  }
  function paintCount() {
    var c = q('[data-count]');
    if (c) c.textContent = draft.message.length > MAX_MSG - 500 ? '(' + draft.message.length + ' / ' + MAX_MSG + T(' χαρακτήρες)', ' characters)') : '';
  }

  /* ---- screenshots: shrunk to JPEG in the browser, kept as data URLs ------ */
  // a pasted image counts wherever the focus is (clicking the drop zone
  // leaves it on the page), and a file dropped next to the zone must not make
  // the browser leave the page and lose the message
  document.addEventListener('paste', function (e) {
    if (!q('[data-fb-form]')) return;
    var items = (e.clipboardData && e.clipboardData.items) || [], files = [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) files.push(items[i].getAsFile());
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  ['dragover', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
    });
  });
  // one image at a time, so a tall one cut into several pieces takes the
  // room that is really left
  var queue = Promise.resolve();
  function addFiles(list) {
    var msg = q('[data-shots-msg]');
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return f && /^image\//.test(f.type || ''); });
    if (msg) msg.textContent = '';
    if (!files.length) { if (list && list.length && msg) msg.textContent = T('Μόνο εικόνες (π.χ. PNG ή JPG).', 'Images only (for example PNG or JPG).'); return; }
    var room = MAX_SHOTS - shots.length - working;
    if (room <= 0) { if (msg) msg.textContent = T('Έως ' + MAX_SHOTS + ' εικόνες ανά μήνυμα.', 'Up to ' + MAX_SHOTS + ' images per message.'); return; }
    if (files.length > room && msg) msg.textContent = T('Κρατήθηκαν οι πρώτες ' + room + ': έως ' + MAX_SHOTS + ' εικόνες ανά μήνυμα.',
      (room === 1 ? 'Only the first was kept' : 'Only the first ' + room + ' were kept') + ': up to ' + MAX_SHOTS + ' images per message.');
    files.slice(0, room).forEach(function (f) {
      working++; paintShots();
      queue = queue.then(function () {
        var left = MAX_SHOTS - shots.length - (working - 1);
        return shrink(f, Math.max(1, left)).then(function (urls) {
          working--;
          var name = String(f.name || T('εικόνα', 'image')).slice(0, 80);
          urls.forEach(function (url, i) { shots.push({ url: url, name: urls.length > 1 ? name + ' (' + (i + 1) + '/' + urls.length + ')' : name }); });
          paintShots();
        }, function () {
          working--; paintShots();
          var m = q('[data-shots-msg]'); if (m) m.textContent = T('Δεν ήταν δυνατή η ανάγνωση της εικόνας «' + (f.name || '') + '».', 'The image “' + (f.name || '') + '” could not be read.');
        });
      });
    });
  }
  /* a JPEG of at most SHOT_BUDGET characters per piece. A very tall image (a
     phone's "long screenshot") is cut into pieces about twice as tall as they
     are wide, up to `pieces`, so each stays readable; shrinking it whole
     would leave a strip a few pixels wide. */
  function shrink(file, pieces) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onerror = reject;
      rd.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var W = img.naturalWidth || 1, H = img.naturalHeight || 1;
          var n = H > W * 2.5 ? Math.min(pieces, Math.ceil(H / (W * 2))) : 1;
          var step = Math.ceil(H / n), out = [];
          for (var k = 0; k < n; k++) {
            var y = k * step, h = Math.min(step, H - y);
            var url = piece(img, y, W, h);
            if (!url) return reject(new Error('too big'));
            out.push(url);
          }
          resolve(out);
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }
  function piece(img, y, W, h) {
    var scale = Math.min(1, 1400 / W, 2800 / h), quality = 0.82, url = '';
    for (var round = 0; round < 14; round++) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(W * scale));
      c.height = Math.max(1, Math.round(h * scale));
      var g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);      // transparent PNG areas become white, not black
      g.drawImage(img, 0, y, W, h, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', quality);
      if (url.length <= SHOT_BUDGET) break;
      if (quality > 0.55) quality -= 0.12; else scale *= 0.8;
    }
    return /^data:image\/jpeg;base64,/.test(url) && url.length <= SHOT_BUDGET ? url : null;
  }
  function paintShots() {
    var box = q('[data-thumbs]');
    if (!box) return;
    box.innerHTML = shots.map(function (s, i) {
      return '<figure class="fb-thumb"><a href="' + esc(s.url) + '" data-view="' + i + '"><img src="' + esc(s.url) + '" alt="' + T('Στιγμιότυπο ', 'Screenshot ') + (i + 1) + ': ' + esc(s.name) + '"></a>' +
        '<button type="button" class="fb-x" data-remove="' + i + '" aria-label="' + T('Αφαίρεση του στιγμιότυπου ', 'Remove screenshot ') + (i + 1) + '">×</button></figure>';
    }).join('') + (working ? '<p class="muted fb-working"><span class="spinner" aria-hidden="true"></span>' + T('Προετοιμασία εικόνας…', 'Preparing the image…') + '</p>' : '');
    Array.prototype.forEach.call(box.querySelectorAll('[data-remove]'), function (b) {
      b.addEventListener('click', function () {
        shots.splice(+b.getAttribute('data-remove'), 1); paintShots();
        var next = box.querySelector('[data-remove]') || q('[data-files]'); if (next) next.focus();
      });
    });
    viewers(box);
    var send = q('[data-send]');
    if (send) send.disabled = busy || working > 0;
  }
  function viewers(box) {
    var links = Array.prototype.slice.call(box.querySelectorAll('a[data-view]'));
    links.forEach(function (a, i) {
      a.addEventListener('click', function (e) {
        e.preventDefault();                  // a data: address cannot be opened in a tab
        if (U.lightbox) U.lightbox(links, i);
      });
    });
  }

  /* ---- sending ------------------------------------------------------------ */
  function send() {
    var msg = q('[data-fb-msg]'), ta = q('#fb-message'), btn = q('[data-send]');
    var text = draft.message.trim();
    msg.textContent = '';
    if (!text) { ta.setAttribute('aria-invalid', 'true'); msg.textContent = T('Γράψτε πρώτα το μήνυμά σας.', 'Please write your message first.'); ta.focus(); return; }
    if (working) return;
    var page = draft.page.trim();
    if (page && !/^https?:\/\//i.test(page)) page = '';
    busy = true; btn.disabled = true; btn.textContent = T('Αποστολή…', 'Sending…');
    var u = user;
    // the rules check the e-mail and "confirmed" flag against the sign-in
    // token itself, so read them from a fresh token rather than the user object
    u.getIdTokenResult(true).then(function (r) {
      var c = (r && r.claims) || {};
      var base = {
        uid: u.uid, email: c.email || '', emailVerified: c.email_verified === true,
        name: String(A.displayName(u) || '').slice(0, 120), kind: draft.kind, message: text.slice(0, MAX_MSG),
        page: page.slice(0, 500), shots: shots.length,
        ua: String(navigator.userAgent || '').slice(0, 400), status: 'open',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      var urls = shots.map(function (s) { return s.url; });
      var attempt = function (left) {
        // the ticket and its screenshots (feedback/<ticket>/shots/1..5) land
        // together or not at all; the rules allow the pictures only in this batch
        var t = ticketNumber(), data = Object.assign({ ticket: t }, base), ref = db.collection('feedback').doc(t), b = db.batch();
        b.set(ref, data);
        urls.forEach(function (u, i) { b.set(ref.collection('shots').doc(String(i + 1)), { url: u }); });
        return b.commit().then(function () { return data; }, function (e) {
          // the number is already taken (a write to someone else's ticket is refused): draw another
          if (left > 0 && e && e.code === 'permission-denied') return attempt(left - 1);
          throw e;
        });
      };
      return attempt(1);
    }).then(function (data) {
      busy = false;
      sent = { ticket: data.ticket, email: data.email, mailed: !!(data.email && data.emailVerified) };
      shots = []; draft.message = ''; draft.page = '';
      if (mine) mine.unshift(Object.assign({}, data, { createdAt: null }));
      paintMain(); paintMine();
      var h = q('#fb-thanks-h'); if (h) h.focus();
      if (U.announce) U.announce(T('Το μήνυμα στάλθηκε. Αριθμός ' + data.ticket + '.', 'Your message was sent. Number ' + data.ticket + '.'));
    }, function (e) {
      busy = false; btn.disabled = false; btn.textContent = T('Αποστολή', 'Send');
      msg.textContent = A.friendly(e);
    });
  }

  /* ---- the member's own messages ----------------------------------------- */
  function loadMine() {
    if (!db || !user) return;
    var uid = user.uid;
    db.collection('feedback').where('uid', '==', uid).get().then(function (qs) {
      if (!user || user.uid !== uid) return;
      var l = [];
      qs.forEach(function (d) { var x = d.data(); x.ticket = x.ticket || d.id; l.push(x); });
      l.sort(function (a, b) { return (ms(b.createdAt) || Infinity) - (ms(a.createdAt) || Infinity) || String(b.ticket).localeCompare(a.ticket); });
      mine = l; mineErr = null; paintMine();
    }, function (e) { mineErr = A.friendly(e); paintMine(); });
  }
  function paintMine() {
    var box = q('[data-mine]');
    if (!box) return;
    if (mineErr) { box.innerHTML = '<p class="form-error">' + esc(mineErr) + '</p>'; return; }
    if (!mine) { box.innerHTML = '<p class="muted"><span class="spinner" aria-hidden="true"></span>' + T('Φόρτωση…', 'Loading…') + '</p>'; return; }
    if (!mine.length) { box.innerHTML = '<p class="muted">' + T('Δεν μας έχετε γράψει ακόμα. Ό,τι στείλετε θα εμφανίζεται εδώ, με την απάντησή μας.', 'You have not written to us yet. Whatever you send will appear here, with our reply.') + '</p>'; return; }
    box.innerHTML = '<ul class="fb-list">' + mine.map(function (m) {
      var closed = m.status === 'closed', text = String(m.message || '');
      return '<li class="fb-item"><div class="fb-item-head"><code>' + esc(m.ticket) + '</code>' +
        '<span class="badge ' + (closed ? 'ok">' + T('Ολοκληρώθηκε', 'Resolved') : 'warn">' + T('Σε εξέταση', 'Under review')) + '</span></div>' +
        '<p class="muted fb-meta">' + esc([when(m.createdAt) || T('Μόλις τώρα', 'Just now'), KIND_NAME[m.kind] || '', m.shots ? (m.shots + T(' εικ.', m.shots === 1 ? ' image' : ' images')) : ''].filter(Boolean).join(' · ')) + '</p>' +
        '<p class="fb-text">' + esc(text.length > 280 ? text.slice(0, 280) + '…' : text) + '</p>' +
        (closed && m.resolution ? '<div class="fb-answer"><strong>' + T('Η απάντησή μας', 'Our reply') + (m.resolvedAt ? ' (' + esc(when(m.resolvedAt)) + ')' : '') + '</strong><p' + (L.en && GREEK.test(m.resolution) ? ' lang="el"' : '') + '>' + esc(m.resolution) + '</p>' +
          (m.resolutionUrl && /^https:\/\//.test(m.resolutionUrl) ? '<p><a href="' + esc(m.resolutionUrl) + '">' + T('Δείτε το', 'See it') + '</a></p>' : '') + '</div>' : '') +
        '</li>';
    }).join('') + '</ul>';
  }
})();
