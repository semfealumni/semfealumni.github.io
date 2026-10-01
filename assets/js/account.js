/* SEMFE Alumni: the "Ο λογαριασμός μου" page.
 * Signed out: sign-in / register buttons. Signed in: the membership
 * application (members/{uid}), its status, the directory listing
 * (directory/{uid}), linked sign-in methods and account deletion.
 * Every write here must satisfy firestore.rules; the field names and types
 * below are the ones those rules check (tools/rules-test/ tests exactly these).
 *
 * The page is redrawn from state on every change (the members/{uid} listener
 * fires on our own writes too, and again when their server time resolves), so
 * every redraw first saves what is on screen and puts it back: whatever is
 * typed in the form (draft), the half-filled delete box, and keyboard focus.
 * Messages live in module state (formErr, dirMsg) and are also announced. */
(function () {
  'use strict';
  var A = window.SemfeAuth, C = window.SEMFE || {}, U = window.SEMFE_UTIL || {}, PO = window.SEMFE_PROFILE;
  var app = document.getElementById('account-app');
  if (!A || !app || !PO) return;
  var esc = A.esc, FV = null, db = null, unsub = null, user = null, member = null, dirEntry = null;
  var editing = false, deleted = false, autoDirTried = false, linked = [];
  var draft = null, formErr = '', dirMsg = null, refocus = null, applyScrolled = false, deleteShown = false, delBox = null;
  // sign-in methods: the set-password form (open, what is typed), the merge box,
  // a method that turned out to belong to another account, deep links already followed
  var pwOpen = false, pwBox = null, mergeOpen = false, conflict = null, jumped = {};
  var TAKEN = ['auth/credential-already-in-use', 'auth/email-already-in-use', 'auth/account-exists-with-different-credential'];
  var YEAR = new Date().getFullYear();
  var STAGES = { graduate: 'Απόφοιτος/η ΣΕΜΦΕ', 'final-year': 'Τελειόφοιτος/η ΣΕΜΦΕ', faculty: 'Μέλος ΔΕΠ ΣΕΜΦΕ' };
  var DIRECTIONS = ['Εφαρμοσμένα Μαθηματικά', 'Εφαρμοσμένη Φυσική', 'Άλλη / δεν ισχύει'];

  function html(s) { app.innerHTML = s; }
  function isFaculty(m) { return !!m && m.stage === 'faculty'; }
  function statusBadge(m) {
    if (!m) return '<span class="badge muted">Χωρίς αίτηση</span>';
    if (m.status === 'active') return '<span class="badge ok">' + (isFaculty(m) ? 'Πρόσβαση μέλους' : 'Ενεργό μέλος') + '</span>';
    if (m.status === 'rejected') return '<span class="badge err">Η αίτηση δεν εγκρίθηκε</span>';
    return '<span class="badge warn">Η αίτηση εκκρεμεί</span>';
  }

  A.onChange(function (u) {
    user = u;
    if (unsub) { unsub(); unsub = null; }
    member = null; dirEntry = null; editing = false; draft = null; formErr = ''; dirMsg = null; refocus = null;
    autoDirTried = false; delBox = null; pwOpen = false; pwBox = null; mergeOpen = false; conflict = null;
    linked = u ? A.providers(u) : [];
    if (deleted) {                  // keep the "account deleted" message on screen…
      if (!u) return;
      deleted = false;              // …until someone signs in again on this page
    }
    if (!A.configured) return renderOffline();
    if (!u) return renderSignedOut();
    html('<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση του λογαριασμού σας…</div>');
    // LinkedIn connected through the Cloud Function shows up only in the token's claims
    A.providersAsync(u).then(function (l) {
      if (l.join() !== linked.join()) { linked = l; if (user === u && app.querySelector('.linked')) render(); }
    });
    A.db().then(function (d) {
      db = d; FV = firebase.firestore.FieldValue;
      unsub = db.collection('members').doc(u.uid).onSnapshot(function (snap) {
        member = snap.exists ? snap.data() : null;
        if (member && member.status === 'active') {
          db.collection('directory').doc(u.uid).get().then(function (ds) {
            dirEntry = ds.exists ? ds.data() : null;
            // asked to be listed when applying, and has just been approved: list them once
            if (!dirEntry && member.consentDirectory && !autoDirTried) {
              autoDirTried = true;
              return writeDirectory().then(render, render);
            }
            render();
          }, function () { dirEntry = null; render(); });
        } else { dirEntry = null; render(); }
      }, function (e) { renderError(e); });
    }, renderError);
  });

  function renderOffline() {
    html('<div class="panel"><h2>Η σύνδεση μελών ανοίγει σύντομα</h2>' +
      '<p>Σύντομα θα μπορείτε να δημιουργήσετε λογαριασμό με <strong>' + esc(A.methodsText('e-mail')) + '</strong>, να κάνετε την αίτηση μέλους από εδώ και να μπαίνετε στην περιοχή μελών.</p>' +
      '<p>Μέχρι τότε, μπορείτε να κάνετε αίτηση μέσω της ηλεκτρονικής φόρμας.</p>' +
      '<div class="section-foot" style="margin-top:8px"><a class="btn btn-dark" href="' + esc(C.legacyApplyFormUrl) + '" target="_blank" rel="noopener">Ηλεκτρονική φόρμα αίτησης</a><a class="btn btn-outline" href="' + A.root + 'support/#eggrafi">Πώς γίνομαι μέλος</a></div></div>');
  }
  function renderSignedOut() {
    html('<div class="acct-grid"><div class="panel"><h2>Συνδεθείτε ή δημιουργήστε λογαριασμό</h2>' +
      '<p>Με τον λογαριασμό σας κάνετε την <strong>αίτηση μέλους</strong>, βλέπετε την κατάσταση της εγγραφής και της συνδρομής σας και μπαίνετε στην <strong>περιοχή μελών</strong>.</p>' +
      '<p>Συνδεθείτε με <strong>' + esc(A.methodsText('e-mail και κωδικό')) + '</strong>.</p>' +
      '<div class="section-foot" style="margin-top:8px"><button type="button" class="btn btn-primary" data-open="register">Νέος λογαριασμός</button><button type="button" class="btn btn-outline" data-open="signin">Έχω ήδη λογαριασμό</button></div></div>' +
      '<div class="panel"><h2 style="font-size:1.1rem">Γιατί λογαριασμός;</h2><ul class="checklist">' +
      '<li>Αίτηση μέλους χωρίς χαρτιά, σε δύο λεπτά</li><li>Βλέπετε πότε ενεργοποιείται η ιδιότητά σας</li>' +
      '<li>Πρόσβαση στον κατάλογο μελών (αν το επιθυμείτε)</li><li>Διαγράφετε τα στοιχεία σας όποτε θέλετε</li></ul></div></div>');
    Array.prototype.forEach.call(app.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () { A.open(b.getAttribute('data-open'), b); });
    });
    if (/register|apply/.test(location.hash)) A.open('register');
    else if (/signin/.test(location.hash)) A.open('signin');
  }
  function renderError(e) {
    html('<div class="notice err"><strong>Δεν ήταν δυνατή η φόρτωση</strong><p>' + esc(A.friendly(e)) + '</p></div>');
  }

  /* an e-mail + password account with nothing else linked must confirm its
     address before applying (firestore.rules emailConfirmed() agrees) */
  function needsEmailCheck() {
    return user && !user.emailVerified && (user.providerData || []).some(function (p) { return p.providerId === 'password'; })
      && !(user.providerData || []).some(function (p) { return p.providerId !== 'password'; });
  }
  /* connecting another sign-in method needs a proven address: otherwise
     someone could register with another person's e-mail, never confirm it,
     attach their own Google/Facebook/LinkedIn, and keep a way in after the
     real owner takes the address back (functions/linkedin.js refuses LinkedIn
     outright in that case) */
  function linkNeedsVerifiedEmail() {
    return !!(user && user.email && !user.emailVerified);
  }

  /* what has keyboard focus, as a selector that finds its replacement after a
     redraw (and the panel it was in, for when the control itself is gone) */
  function focusKey() {
    var el = document.activeElement;
    if (!el || el === document.body || !app.contains(el)) return null;
    var attrs = ['data-dir', 'data-edit', 'data-cancel', 'data-verified', 'data-resend', 'data-send-verify', 'data-verified-li',
      'data-reset', 'data-signout', 'data-del-open', 'data-del-go', 'data-setpw', 'data-pw-cancel', 'data-merge-open', 'data-merge-cancel',
      'data-merge-conflict', 'data-prompt-hide'], sel = el.id ? '#' + el.id : null;
    for (var i = 0; !sel && i < attrs.length; i++) if (el.hasAttribute(attrs[i])) sel = '[' + attrs[i] + ']';
    ['data-link', 'data-prompt', 'data-merge-with'].forEach(function (a) { if (!sel && el.hasAttribute(a)) sel = '[' + a + '="' + el.getAttribute(a) + '"]'; });
    if (!sel && el.type === 'submit') sel = '#apply [type=submit]';
    var panel = el.closest ? el.closest('.panel[id]') : null, caret = null;
    try { if (typeof el.selectionStart === 'number') caret = [el.selectionStart, el.selectionEnd, el.selectionDirection || 'none']; } catch (e) {}
    return { sel: sel, panel: panel ? '#' + panel.id : null, caret: caret };
  }
  function restoreFocus(k) {
    if (!k) return;
    if (typeof k === 'string') k = { sel: k };
    var el = (k.sel && app.querySelector(k.sel)) || (k.panel && app.querySelector(k.panel + ' h2'));
    if (el && el.hidden) el = k.panel && app.querySelector(k.panel + ' h2');
    if (!el) return;
    try { el.focus(); } catch (e) {}
    // the new field starts with the caret at 0: put it (and any selection) back where it was
    if (k.caret) try { el.setSelectionRange(k.caret[0], k.caret[1], k.caret[2]); } catch (e) {}
  }
  /* the form's fields exactly as typed (so a redraw can put them back) */
  function formValues(form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return o;
  }

  function render(fresh) {
    // keep what is on screen: a redraw must never lose typing or focus
    var keep = refocus || focusKey();
    refocus = null;
    var form = app.querySelector('form[data-apply]');
    if (form && !fresh) draft = formValues(form);
    var del = app.querySelector('[data-del-box]');
    if (del && !del.hidden) delBox = { confirm: (app.querySelector('#del-confirm') || {}).value || '', pass: (app.querySelector('#del-pass') || {}).value || '' };
    else if (del) delBox = null;
    var pwf = app.querySelector('[data-pw-form]');
    if (pwf) pwBox = { a: pwf.elements['pw-new'].value, b: pwf.elements['pw-new2'].value };
    var mf = app.querySelector('[data-merge-pw]');
    var mergeTyped = mf ? { email: mf.elements['merge-email'].value, pass: mf.elements['merge-pass'].value } : null;
    var name = A.displayName(user);
    var s = '<div class="panel profile-head">' + A.avatarHtml(name, user.photoURL, 'avatar-lg') +
      '<div class="who"><strong>' + esc(name) + '</strong><span class="muted">' + esc(user.email || '') + '</span></div>' + statusBadge(member) + '</div>';

    if (needsEmailCheck()) {
      s += '<div class="notice warn" style="margin-top:18px"><strong>Επιβεβαιώστε το e-mail σας</strong>' +
        '<p>Σας στείλαμε e-mail στο ' + esc(user.email) + '. Πατήστε τον σύνδεσμο που περιέχει (δείτε και τα ανεπιθύμητα) και μετά το «Το επιβεβαίωσα». Χωρίς επιβεβαίωση δεν μπορείτε να υποβάλετε αίτηση μέλους.</p>' +
        '<p class="section-foot" style="margin:0"><button type="button" class="btn btn-dark btn-sm" data-verified>Το επιβεβαίωσα</button><button type="button" class="btn btn-outline btn-sm" data-resend>Αποστολή ξανά</button></p>' +
        '<p class="form-ok" data-verify-msg role="status" style="margin:8px 0 0"></p></div>';
    }

    s += addMethodPrompt();
    s += '<div class="acct-grid" style="margin-top:18px"><div>';
    s += membershipPanel();
    s += '</div><div>';
    s += methodsPanel();
    s += dangerPanel();
    s += '</div></div>';
    html(s);
    wire();
    if (delBox) {
      app.querySelector('[data-del-box]').hidden = false;
      app.querySelector('[data-del-open]').hidden = true;
      app.querySelector('#del-confirm').value = delBox.confirm;
      if (app.querySelector('#del-pass')) app.querySelector('#del-pass').value = delBox.pass || '';   // kept in memory only, never stored
    }
    if (pwBox && app.querySelector('[data-pw-form]')) { app.querySelector('#pw-new').value = pwBox.a; app.querySelector('#pw-new2').value = pwBox.b; }
    if (mergeTyped && app.querySelector('[data-merge-pw]')) { app.querySelector('#merge-email').value = mergeTyped.email; app.querySelector('#merge-pass').value = mergeTyped.pass; }
    // what the account menu shows (auth.js keeps it for this browser)
    A.noteMenu({ app: member ? (member.status || 'pending') : null, methods: linked.length });
    restoreFocus(keep);
    // arriving at account/#apply (straight after registering): show the form, once
    if (/apply/.test(location.hash) && !member && !applyScrolled) {
      applyScrolled = true;
      var f = document.getElementById('apply'); if (f && f.scrollIntoView) f.scrollIntoView({ block: 'start' });
    }
    // arriving at account/#methods or #apply from the account menu: the panels are drawn
    // only now, after the browser's own jump to the fragment, so go there once ourselves
    var hm = /^#(methods|apply)$/.exec(location.hash);
    if (hm && !jumped[hm[1]] && (hm[1] === 'methods' || member)) {
      jumped[hm[1]] = true;
      var jh = app.querySelector('#' + hm[1] + ' h2');
      if (jh) { if (jh.scrollIntoView) jh.scrollIntoView({ block: 'start' }); try { jh.focus({ preventScroll: true }); } catch (e) { jh.focus(); } }
    }
    // arriving at account/#delete (from the data-deletion page): the panel is drawn only now,
    // after the browser's own jump to the fragment, so go there once ourselves
    if (/^#delete$/.test(location.hash) && !deleteShown) {
      deleteShown = true;
      var dh = app.querySelector('#delete h2');
      if (dh) { if (dh.scrollIntoView) dh.scrollIntoView({ block: 'start' }); try { dh.focus({ preventScroll: true }); } catch (e) { dh.focus(); } }
    }
  }
  function say(msg) { if (msg && U.announce) U.announce(msg); }

  function membershipPanel() {
    if (!member || editing || draft) return applyForm();
    var m = member, faculty = isFaculty(m), s = '<div class="panel" id="apply"><h2 tabindex="-1">Η ιδιότητα μέλους</h2>';
    if (m.status === 'active') {
      var paid = (m.duesYears || []).slice().sort();
      s += faculty
        ? '<div class="notice ok"><strong>Έχετε πρόσβαση στην περιοχή μελών.</strong><p>Ως μέλος ΔΕΠ ΣΕΜΦΕ δεν χρειάζεται συνδρομή.</p></div>'
        : '<div class="notice ok"><strong>Είστε ενεργό μέλος του Συλλόγου.</strong><p>' +
          esc(paid.length ? 'Συνδρομές που έχουμε καταγράψει: ' + paid.join(', ') + '.' : 'Δεν έχει καταγραφεί ακόμα συνδρομή.') +
          (paid.indexOf(YEAR) === -1 ? ' Η συνδρομή ' + YEAR + ' (' + esc(C.annualFee || 10) + '€) <a href="' + A.root + 'support/#katathesi">κατατίθεται εδώ</a>.' : '') + '</p></div>';
      s += '<p><a class="btn btn-dark" href="' + A.root + 'members/">Περιοχή μελών</a></p>' + directoryBox();
    } else if (m.status === 'rejected') {
      s += '<div class="notice err"><strong>Η αίτησή σας δεν εγκρίθηκε.</strong><p>' + (m.adminNote ? esc(m.adminNote) + ' ' : '') +
        'Για οποιαδήποτε απορία <a href="' + A.root + 'contact/">επικοινωνήστε μαζί μας</a>.</p></div>';
    } else if (faculty) {
      s += '<div class="notice warn"><strong>Λάβαμε το αίτημά σας.</strong><p>Ως μέλος ΔΕΠ ΣΕΜΦΕ δεν χρειάζεται συνδρομή. Μόλις επιβεβαιώσουμε την ιδιότητά σας, θα σας δώσουμε πρόσβαση στην περιοχή μελών και θα σας ενημερώσουμε με e-mail.</p></div>';
    } else {
      s += '<div class="notice warn"><strong>Λάβαμε την αίτησή σας.</strong><p>Επόμενο βήμα: καταθέστε τη συνδρομή των <strong>' + esc(C.annualFee || 10) + '€</strong> ' +
        '(<a href="' + A.root + 'support/#katathesi">τρόποι πληρωμής</a>) γράφοντας στην αιτιολογία το ονοματεπώνυμο, το e-mail σας και το έτος συνδρομής. ' +
        'Μόλις ελέγξουμε τα στοιχεία σας, η ιδιότητα μέλους ενεργοποιείται εδώ και θα σας ενημερώσουμε με e-mail.</p></div>';
    }
    s += '<dl class="kv" style="margin:18px 0">' +
      '<dt>Ονοματεπώνυμο</dt><dd>' + esc(m.firstName + ' ' + m.lastName) + '</dd>' +
      '<dt>E-mail</dt><dd>' + esc(m.email) + '</dd>' +
      (m.phone ? '<dt>Τηλέφωνο</dt><dd>' + esc(m.phone) + '</dd>' : '') +
      '<dt>Ιδιότητα</dt><dd>' + esc(STAGES[m.stage] || m.stage) + '</dd>' +
      (m.entryYear ? '<dt>Εισαγωγή</dt><dd>' + esc(m.entryYear) + '</dd>' : '') +
      (m.gradYear ? '<dt>Αποφοίτηση</dt><dd>' + esc(m.gradYear) + '</dd>' : '') +
      (m.direction ? '<dt>Κατεύθυνση</dt><dd>' + esc(m.direction) + '</dd>' : '') +
      (m.employer || m.position ? '<dt>Εργασία</dt><dd>' + esc([m.position, m.employer].filter(Boolean).join(', ')) + '</dd>' : '') +
      (m.industry ? '<dt>Κλάδος</dt><dd>' + esc(PO.industryLabel(m.industry)) + '</dd>' : '') +
      (m.city ? '<dt>Πόλη</dt><dd>' + esc(m.city) + '</dd>' : '') +
      (m.country ? '<dt>Χώρα</dt><dd>' + esc(PO.countryName(m.country)) + '</dd>' : '') +
      (m.gender ? '<dt>Φύλο</dt><dd>' + esc(PO.genderLabel(m.gender)) + '</dd>' : '') +
      (/^https:\/\//i.test(m.linkedin || '') ? '<dt>LinkedIn</dt><dd><a href="' + esc(m.linkedin) + '" target="_blank" rel="noopener">' + esc(m.linkedin.replace(/^https?:\/\/(www\.)?/, '')) + '</a></dd>' : '') +
      '<dt>Newsletter</dt><dd>' + (m.consentNewsletter ? 'Ναι' : 'Όχι') + '</dd>' +
      '<dt>Θέσεις εργασίας</dt><dd>' + (m.consentJobs ? 'Ναι' : 'Όχι') + '</dd>' +
      '</dl><button type="button" class="btn btn-outline" data-edit>Επεξεργασία στοιχείων</button></div>';
    return s;
  }

  function directoryBox() {
    return '<fieldset style="margin-top:18px"><legend>Κατάλογος μελών</legend>' +
      '<label class="check"><input type="checkbox" data-dir' + (dirEntry ? ' checked' : '') + '><span>Να εμφανίζομαι στον κατάλογο της περιοχής μελών (ονοματεπώνυμο, έτος αποφοίτησης, κατεύθυνση, εργασία, πόλη, LinkedIn). Τον βλέπουν μόνο ενεργά μέλη.</span></label>' +
      '<div class="' + (dirMsg ? dirMsg.cls : 'form-error') + '" data-dir-msg role="status">' + esc(dirMsg ? dirMsg.text : '') + '</div></fieldset>';
  }

  function field(id, label, value, opts) {
    opts = opts || {};
    var req = opts.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
    var hintId = opts.hint ? 'f-' + id + '-hint' : '';
    var attrs = (opts.type ? ' type="' + opts.type + '"' : '') + (opts.auto ? ' autocomplete="' + opts.auto + '"' : '') +
      (opts.max ? ' maxlength="' + opts.max + '"' : '') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
      (opts.required ? ' required aria-required="true"' : '') + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.readonly ? ' readonly' : '') + (hintId ? ' aria-describedby="' + hintId + '" data-hint="' + hintId + '"' : '');
    return '<div class="field"><label for="f-' + id + '">' + label + req + '</label><input id="f-' + id + '" name="' + id + '" value="' + esc(value == null ? '' : value) + '"' + attrs + '>' +
      (opts.hint ? '<span class="hint" id="' + hintId + '">' + opts.hint + '</span>' : '') + '</div>';
  }
  function select(id, label, value, options, required) {
    return '<div class="field"><label for="f-' + id + '">' + label + (required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label><select id="f-' + id + '" name="' + id + '"' + (required ? ' required aria-required="true"' : '') + '>' +
      '<option value="">Επιλέξτε…</option>' + options.map(function (o) {
        var v = typeof o === 'string' ? o : o[0], l = typeof o === 'string' ? o : o[1];
        return '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select></div>';
  }
  function check(id, label, checked, required) {
    return '<label class="check"><input type="checkbox" id="f-' + id + '" name="' + id + '"' + (checked ? ' checked' : '') + (required ? ' required aria-required="true"' : '') + '><span>' + label + '</span></label>';
  }

  function applyForm() {
    var m = draft || member || {}, parts = String(user.displayName || '').trim().split(/\s+/);
    // once reviewed, the name is the vetted one (firestore.rules freezes it)
    var frozen = !!member && member.status !== 'pending';
    var first = frozen ? member.firstName : m.firstName != null ? m.firstName : (parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '');
    var last = frozen ? member.lastName : m.lastName != null ? m.lastName : (parts.length > 1 ? parts[parts.length - 1] : '');
    var nameHint = frozen ? 'Για αλλαγή ονόματος <a href="' + A.root + 'contact/">επικοινωνήστε με τον Σύλλογο</a>.' : '';
    var blocked = needsEmailCheck();
    var msg = formErr || (blocked ? 'Επιβεβαιώστε πρώτα το e-mail σας (δείτε παραπάνω).' : '');
    var active = !!member && member.status === 'active';
    return '<div class="panel" id="apply"><h2 tabindex="-1">' + (member ? 'Επεξεργασία στοιχείων' : 'Αίτηση μέλους') + '</h2>' +
      (member ? '' : '<p class="muted intro">Συμπληρώστε τα στοιχεία σας. Τα πεδία με <span class="req">*</span> είναι υποχρεωτικά. Θα τα ελέγξουμε και θα ενεργοποιήσουμε την ιδιότητα μέλους μόλις λάβουμε τη συνδρομή των ' + esc(C.annualFee || 10) + '€ (δεν ισχύει για μέλη ΔΕΠ).</p>') +
      '<form class="form" novalidate data-apply>' +
      '<div class="row">' + field('firstName', 'Όνομα', first, { required: true, auto: 'given-name', max: 80, readonly: frozen, hint: nameHint }) +
      field('lastName', 'Επώνυμο', last, { required: true, auto: 'family-name', max: 80, readonly: frozen }) + '</div>' +
      '<div class="row">' + field('email', 'E-mail επικοινωνίας', m.email || user.email || '', { required: true, auto: 'email', max: 200, inputmode: 'email' }) +
      field('phone', 'Κινητό τηλέφωνο', m.phone, { type: 'tel', auto: 'tel', max: 40, inputmode: 'tel', hint: 'Προαιρετικό' }) + '</div>' +
      '<div class="row">' + select('stage', 'Ιδιότητα', m.stage || '', [['graduate', STAGES.graduate], ['final-year', STAGES['final-year']], ['faculty', STAGES.faculty]], true) +
      select('direction', 'Κατεύθυνση', m.direction || '', DIRECTIONS, false) + '</div>' +
      '<div class="row">' + field('entryYear', 'Έτος εισαγωγής', m.entryYear, { inputmode: 'numeric', max: 4, placeholder: 'π.χ. 2008' }) +
      field('gradYear', 'Έτος αποφοίτησης', m.gradYear, { inputmode: 'numeric', max: 4, placeholder: 'π.χ. 2013', hint: 'Κενό αν είστε τελειόφοιτος/η' }) + '</div>' +
      '<div class="row">' + field('position', 'Θέση εργασίας', m.position, { auto: 'organization-title', max: 120 }) + field('employer', 'Εργοδότης / Ίδρυμα', m.employer, { auto: 'organization', max: 120 }) + '</div>' +
      '<div class="row">' + select('industry', 'Κλάδος', m.industry || '', PO.INDUSTRIES, false) +
      select('gender', 'Φύλο', m.gender || '', PO.GENDERS, false) + '</div>' +
      '<div class="row">' + field('city', 'Πόλη', m.city, { max: 80, auto: 'address-level2' }) +
      select('country', 'Χώρα', m.country != null && m.country !== '' ? m.country : (draft ? '' : PO.splitPlace(m.city).country), PO.COUNTRIES, false) + '</div>' +
      '<p class="muted" style="font-size:.88rem;margin:-4px 0 0">Ο κλάδος, η χώρα και το φύλο είναι προαιρετικά. Τα στοιχεία σπουδών, εργασίας και τόπου μετρώνται μόνο <strong>ανώνυμα</strong>, ως σύνολα, στα <a href="' + A.root + 'analytics/#meli" target="_blank" rel="noopener">στατιστικά των μελών</a>· ομάδες κάτω από 3 ατόμων δεν εμφανίζονται.</p>' +
      field('linkedin', 'Προφίλ LinkedIn', m.linkedin, { type: 'url', max: 200, placeholder: 'https://www.linkedin.com/in/…', hint: 'Ο πιο εύκολος τρόπος να επιβεβαιώσουμε ότι είστε απόφοιτος ΣΕΜΦΕ.' }) +
      '<div class="field"><label for="f-note">Σημείωση προς το Δ.Σ.</label><textarea id="f-note" name="note" maxlength="1000" aria-describedby="f-note-hint" data-hint="f-note-hint">' + esc(m.note || '') + '</textarea><span class="hint" id="f-note-hint">Προαιρετικό</span></div>' +
      '<fieldset><legend>Επικοινωνία</legend><div class="form" style="gap:10px">' +
      check('consentNewsletter', 'Θέλω να λαμβάνω το ενημερωτικό newsletter του Συλλόγου.', m.consentNewsletter) +
      check('consentJobs', 'Θέλω να λαμβάνω ανακοινώσεις θέσεων εργασίας και πρακτικής άσκησης.', m.consentJobs) +
      check('consentDirectory', (active ? 'Θέλω να εμφανίζομαι' : 'Όταν ενεργοποιηθεί η ιδιότητά μου, θέλω να εμφανίζομαι') + ' στον κατάλογο μελών (τον βλέπουν μόνο ενεργά μέλη).', m.consentDirectory) +
      check('acceptedPrivacy', 'Έχω διαβάσει την <a href="' + A.root + 'privacy/" target="_blank" rel="noopener">πολιτική απορρήτου</a> και συμφωνώ να αποθηκευτούν τα στοιχεία μου για την τήρηση του μητρώου μελών.', m.acceptedPrivacy, true) +
      '</div></fieldset>' +
      '<div class="form-error" role="alert" id="apply-msg" tabindex="-1" data-form-msg>' + esc(msg) + '</div>' +
      '<div class="section-foot" style="margin-top:0"><button type="submit" class="btn btn-primary"' + (blocked || saving ? ' disabled' : '') + '>' + (saving ? 'Αποθήκευση…' : member ? 'Αποθήκευση' : 'Υποβολή αίτησης') + '</button>' +
      (member ? '<button type="button" class="btn btn-outline" data-cancel>Ακύρωση</button>' : '') + '</div>' +
      '</form></div>';
  }

  /* the ways this account can sign in: every method the site offers, whether
     it is connected, and what can be added */
  function available() {
    return A.enabledProviders().concat(user && user.email ? ['password'] : []);
  }
  function methodName(k) { return k === 'password' ? 'e-mail και κωδικό' : (A.providerInfo(k) || {}).name || k; }
  function methodsPanel() {
    var rows = '', blocked = linkNeedsVerifiedEmail(), missing = false;
    A.enabledProviders().concat(['password']).forEach(function (k) {
      var info = k === 'password' ? { name: 'E-mail και κωδικός' } : A.providerInfo(k);
      var on = linked.indexOf(k) !== -1;
      if (!on && (k !== 'password' || user.email)) missing = true;
      var dis = blocked ? ' disabled aria-describedby="link-needs-email"' : '';
      var action = on
        ? (k === 'password' ? '<button type="button" class="btn btn-outline btn-sm" data-reset>Αλλαγή κωδικού</button>' : '<span class="badge ok">Συνδεδεμένο</span>')
        : (k === 'password' ? (user.email ? '<button type="button" class="btn btn-outline btn-sm" data-setpw aria-expanded="' + pwOpen + '"' + dis + '>Ορισμός κωδικού</button>' : '<span class="badge muted">Ανενεργό</span>')
          : '<button type="button" class="btn btn-outline btn-sm" data-link="' + k + '"' + dis + '>Σύνδεση</button>');
      rows += '<div class="row"><span>' + A.icon(k) + esc(info.name) + '</span>' + action + '</div>';
    });
    // (an e-mail + password account that still has to confirm already has the box at the top)
    var liNote = blocked && missing && !needsEmailCheck()
      ? '<p class="muted" id="link-needs-email" style="font-size:.88rem;margin:10px 0 0">Για να συνδέσετε κι άλλον τρόπο σύνδεσης χρειάζεται επιβεβαιωμένο e-mail (' + esc(user.email) + '). ' +
        '<button type="button" class="link-btn" data-send-verify>Στείλτε μου e-mail επιβεβαίωσης</button> · <button type="button" class="link-btn" data-verified-li>Το επιβεβαίωσα</button></p>'
      : blocked && missing ? '<p class="muted" id="link-needs-email" style="font-size:.88rem;margin:10px 0 0">Για να συνδέσετε κι άλλον τρόπο σύνδεσης, επιβεβαιώστε πρώτα το e-mail σας (δείτε παραπάνω).</p>'
      : '';
    var pw = pwOpen && linked.indexOf('password') === -1 && user.email && !blocked
      ? '<form class="form sub-form" data-pw-form novalidate><p class="muted" style="margin:0 0 10px">Θα μπαίνετε και με <strong>' + esc(user.email) + '</strong> και αυτόν τον κωδικό.</p>' +
        '<div class="field"><label for="pw-new">Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)</label><input id="pw-new" name="pw-new" type="password" autocomplete="new-password" minlength="8" required></div>' +
        '<div class="field"><label for="pw-new2">Ξανά ο ίδιος κωδικός</label><input id="pw-new2" name="pw-new2" type="password" autocomplete="new-password" required></div>' +
        '<div class="form-error" data-pw-msg role="alert"></div>' +
        '<div class="section-foot" style="margin:0"><button type="submit" class="btn btn-dark btn-sm">Αποθήκευση κωδικού</button><button type="button" class="btn btn-outline btn-sm" data-pw-cancel>Ακύρωση</button></div></form>'
      : '';
    var clash = conflict
      ? '<div class="notice warn" style="margin:14px 0 0" data-clash><strong>' + esc(conflict.title) + '</strong><p>' + esc(conflict.text) + '</p>' +
        '<p class="section-foot" style="margin:8px 0 0"><button type="button" class="btn btn-dark btn-sm" data-merge-conflict>Ένωση των δύο λογαριασμών</button></p></div>'
      : '';
    return '<div class="panel" id="methods"><h2 tabindex="-1">Τρόποι σύνδεσης</h2><p class="muted intro">Συνδέστε περισσότερους τρόπους στον ίδιο λογαριασμό, για να μπαίνετε με όποιον σας βολεύει.</p>' +
      '<div class="linked">' + rows + '</div>' + pw + liNote + clash + '<div class="form-error" data-methods-msg role="status"></div>' +
      mergeSection() +
      '<p style="margin:14px 0 0"><button type="button" class="btn btn-outline btn-sm" data-signout>Αποσύνδεση</button></p></div>';
  }
  /* "Do you have a second account here?": sign in to it as well, and it is
     merged into this one (the server moves its application and ways in). */
  function mergeSection() {
    if (!mergeOpen) return '<p style="margin:12px 0 0"><button type="button" class="link-btn" data-merge-open aria-expanded="false">Έχετε και δεύτερο λογαριασμό εδώ; Ενώστε τους σε έναν</button></p>';
    var btns = A.enabledProviders().map(function (k) {
      return '<button type="button" class="btn btn-outline btn-sm prov-sm" data-merge-with="' + k + '">' + A.icon(k) + 'Με ' + esc(A.providerInfo(k).name) + '</button>';
    }).join('');
    return '<div class="merge-box" id="merge"><h3 tabindex="-1">Ένωση με άλλον λογαριασμό σας</h3>' +
      '<p class="muted">Αν φτιάξατε κατά λάθος και δεύτερο λογαριασμό (π.χ. μία φορά με Google και μία με LinkedIn), συνδεθείτε εδώ και σε εκείνον. ' +
      'Η αίτηση μέλους, οι συνδρομές και οι τρόποι σύνδεσής του μεταφέρονται σε αυτόν τον λογαριασμό' + (user.email ? ' (' + esc(user.email) + ')' : '') + ' και ο άλλος διαγράφεται.</p>' +
      '<p class="muted" style="margin:0 0 8px"><strong>Συνδεθείτε στον άλλο λογαριασμό:</strong></p>' +
      '<div class="section-foot" style="margin:0 0 12px">' + btns + '</div>' +
      '<form class="form sub-form" data-merge-pw novalidate><p class="muted" style="margin:0 0 8px">…ή με το e-mail και τον κωδικό του:</p>' +
      '<div class="field"><label for="merge-email">E-mail του άλλου λογαριασμού</label><input id="merge-email" name="merge-email" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false"></div>' +
      '<div class="field"><label for="merge-pass">Κωδικός του άλλου λογαριασμού</label><input id="merge-pass" name="merge-pass" type="password" autocomplete="off"></div>' +
      '<div class="section-foot" style="margin:0"><button type="submit" class="btn btn-dark btn-sm">Σύνδεση και ένωση</button><button type="button" class="btn btn-outline btn-sm" data-merge-cancel>Ακύρωση</button></div></form>' +
      '<div class="form-error" data-merge-msg role="status"></div></div>';
  }
  /* one method only: say so at the top, name the others, and offer them */
  var PROMPT_KEY = 'semfe:no-method-prompt:';
  function addMethodPrompt() {
    if (!user || needsEmailCheck() || linkNeedsVerifiedEmail() || linked.length !== 1) return '';
    try { if (localStorage.getItem(PROMPT_KEY + user.uid)) return ''; } catch (e) {}
    var missing = available().filter(function (k) { return linked.indexOf(k) === -1; });
    if (!missing.length) return '';
    var names = missing.map(methodName), list = names.length < 2 ? names[0] : names.slice(0, -1).join(', ') + ' ή ' + names[names.length - 1];
    return '<div class="notice info add-method" style="margin-top:18px"><strong>Προσθέστε κι άλλον τρόπο σύνδεσης</strong>' +
      '<p>Μπαίνετε μόνο με ' + esc(methodName(linked[0])) + '. Συνδέστε και ' + esc(list) + ', ώστε να μπαίνετε με όποιον σας βολεύει και να μη χάσετε την πρόσβαση αν ξεχάσετε έναν.</p>' +
      '<p class="section-foot" style="margin:10px 0 0">' + missing.map(function (k) {
        return '<button type="button" class="btn btn-dark btn-sm" data-prompt="' + k + '">' + (k === 'password' ? 'Ορισμός κωδικού' : 'Σύνδεση ' + esc(methodName(k))) + '</button>';
      }).join('') + '<button type="button" class="btn btn-outline btn-sm" data-prompt-hide>Όχι τώρα</button></p></div>';
  }

  function dangerPanel() {
    // decided by what reauth() can use: a popup provider, else the password
    // (a LinkedIn connected through the Cloud Function is only a claim, not a way to re-prove)
    var pd = A.providers(user);
    var pwOnly = pd.indexOf('password') !== -1 && pd.every(function (k) { return k === 'password'; });
    return '<div class="panel" id="delete"><h2 tabindex="-1">Διαγραφή λογαριασμού</h2>' +
      '<p class="muted intro">Διαγράφει οριστικά τον λογαριασμό σας, την αίτηση μέλους και την καταχώρισή σας στον κατάλογο.</p>' +
      '<div data-del-box hidden class="form" style="margin-bottom:12px">' +
      '<div class="field"><label for="del-confirm">Γράψτε <strong>ΔΙΑΓΡΑΦΗ</strong> για επιβεβαίωση</label><input id="del-confirm" autocomplete="off" autocapitalize="characters"></div>' +
      (pwOnly ? '<div class="field"><label for="del-pass">Ο κωδικός σας</label><input id="del-pass" type="password" autocomplete="current-password"></div>' : '') +
      '<div class="form-error" data-del-msg role="alert"></div>' +
      '<button type="button" class="btn btn-danger" data-del-go>Οριστική διαγραφή</button></div>' +
      '<button type="button" class="btn btn-danger btn-sm" data-del-open>Διαγραφή λογαριασμού</button></div>';
  }

  /* reload the user and refresh the ID token, so the rules (and the LinkedIn
     function) see email_verified; msgEl gets the outcome */
  function checkVerified(msgEl, focusAfter) {
    user.reload().then(function () { return user.getIdToken(true); }).then(function () {
      user = firebase.auth().currentUser;
      if (user.emailVerified) { formErr = ''; refocus = focusAfter; render(); A.flash('Το e-mail σας επιβεβαιώθηκε.'); }
      else if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = 'Δεν έχει επιβεβαιωθεί ακόμα. Πατήστε τον σύνδεσμο στο e-mail και δοκιμάστε ξανά.'; }
    }, function (err) { if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = A.friendly(err); } });
  }
  function sendVerify(msgEl) {
    user.sendEmailVerification({ url: location.href.split('#')[0] }).then(function () {
      if (msgEl) { msgEl.className = 'form-ok'; msgEl.textContent = 'Σας στείλαμε e-mail επιβεβαίωσης στο ' + user.email + '.'; }
    }, function (err) { if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = A.friendly(err); } });
  }

  function wire() {
    var q = function (s) { return app.querySelector(s); };
    var on = function (s, ev, fn) { var el = q(s); if (el) el.addEventListener(ev, fn); };
    on('[data-edit]', 'click', function () { editing = true; refocus = '#f-email'; render(); });
    on('[data-cancel]', 'click', function () { editing = false; draft = null; formErr = ''; refocus = '[data-edit]'; render(true); });
    on('[data-apply]', 'submit', function (e) { e.preventDefault(); submitApplication(e.target); });
    on('[data-signout]', 'click', function () { A.signOut(); });
    on('[data-dir]', 'change', function (e) { toggleDirectory(e.target); });
    on('[data-resend]', 'click', function () { sendVerify(q('[data-verify-msg]')); });
    on('[data-verified]', 'click', function () { checkVerified(q('[data-verify-msg]'), '#apply h2'); });
    on('[data-send-verify]', 'click', function () { sendVerify(q('[data-methods-msg]')); });
    on('[data-verified-li]', 'click', function () { checkVerified(q('[data-methods-msg]'), '#methods h2'); });
    Array.prototype.forEach.call(app.querySelectorAll('[data-link]'), function (b) {
      b.addEventListener('click', function () { linkProvider(b.getAttribute('data-link'), b); });
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-prompt]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-prompt');
        if (k === 'password') return openPasswordForm();
        linkProvider(k, b);
      });
    });
    on('[data-prompt-hide]', 'click', function () {
      try { localStorage.setItem(PROMPT_KEY + user.uid, '1'); } catch (e) {}
      refocus = '#methods h2'; render();
    });
    on('[data-setpw]', 'click', openPasswordForm);
    on('[data-pw-cancel]', 'click', function () { pwOpen = false; pwBox = null; refocus = '[data-setpw]'; render(); });
    on('[data-pw-form]', 'submit', function (e) { e.preventDefault(); setPassword(e.target); });
    on('[data-merge-open]', 'click', function () { mergeOpen = true; A.prepareMerge(); refocus = '#merge h3'; render(); });
    on('[data-merge-cancel]', 'click', function () { mergeOpen = false; refocus = '[data-merge-open]'; render(); });
    on('[data-merge-conflict]', 'click', function () {
      var c = conflict, btn = this, msg = q('[data-methods-msg]');
      if (!c) return;
      if (c.provider === 'linkedin' && A.linkedinViaFunction()) return A.linkedinStart('merge');   // through the Cloud Function: leaves the page
      if (c.provider === 'password') { conflict = null; mergeOpen = true; refocus = '#merge-email'; render(); return; }
      runMerge(c.credential ? { credential: c.credential } : { provider: c.provider }, btn, msg);
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-merge-with]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-merge-with');
        if (k === 'linkedin' && A.linkedinViaFunction()) return A.linkedinStart('merge');
        runMerge({ provider: k }, b, q('[data-merge-msg]'));
      });
    });
    on('[data-merge-pw]', 'submit', function (e) {
      e.preventDefault();
      var f = e.target, msg = q('[data-merge-msg]');
      var em = f.elements['merge-email'].value.trim(), pw = f.elements['merge-pass'].value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || !pw) { msg.className = 'form-error'; msg.textContent = 'Γράψτε το e-mail και τον κωδικό του ΑΛΛΟΥ λογαριασμού σας.'; return; }
      runMerge({ email: em, password: pw }, f.querySelector('[type=submit]'), msg);
    });
    on('[data-reset]', 'click', function () {
      var msg = q('[data-methods-msg]');
      firebase.auth().sendPasswordResetEmail(user.email).then(function () {
        msg.className = 'form-ok'; msg.textContent = 'Σας στείλαμε e-mail με σύνδεσμο για νέο κωδικό.';
      }, function (err) { msg.className = 'form-error'; msg.textContent = A.friendly(err); });
    });
    on('[data-del-open]', 'click', function () { q('[data-del-box]').hidden = false; this.hidden = true; delBox = { confirm: '', pass: '' }; q('#del-confirm').focus(); });
    on('[data-del-go]', 'click', deleteAccount);
  }

  function readForm(form) {
    var v = function (n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var c = function (n) { var el = form.elements[n]; return !!(el && el.checked); };
    var y = function (n) {
      var el = form.elements[n];
      if (el && el.validity && el.validity.badInput) return NaN;   // e.g. "2013-": the browser reports ""
      var s = v(n); if (!s) return null;
      return /^\d{4}$/.test(s) ? parseInt(s, 10) : NaN;
    };
    return {
      firstName: v('firstName'), lastName: v('lastName'), email: v('email'), phone: v('phone'),
      stage: v('stage'), direction: v('direction'), entryYear: y('entryYear'), gradYear: y('gradYear'),
      position: v('position'), employer: v('employer'), city: v('city'), linkedin: v('linkedin'), note: v('note'),
      gender: v('gender'), industry: v('industry'), country: v('country'),
      consentNewsletter: c('consentNewsletter'), consentJobs: c('consentJobs'), consentDirectory: c('consentDirectory'),
      acceptedPrivacy: c('acceptedPrivacy')
    };
  }
  function validate(d, form) {
    var bad = function (name, msg) {
      var el = form.elements[name];
      if (el) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', ((el.getAttribute('data-hint') || '') + ' apply-msg').trim());
        el.focus();
      }
      return msg;
    };
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) {
      el.removeAttribute('aria-invalid');
      var h = el.getAttribute('data-hint');
      if (h) el.setAttribute('aria-describedby', h); else el.removeAttribute('aria-describedby');
    });
    if (!d.firstName) return bad('firstName', 'Γράψτε το όνομά σας.');
    if (!d.lastName) return bad('lastName', 'Γράψτε το επώνυμό σας.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return bad('email', 'Γράψτε μια έγκυρη διεύθυνση e-mail.');
    if (!d.stage) return bad('stage', 'Επιλέξτε την ιδιότητά σας.');
    var yearOk = function (x) { return x === null || (x >= 1950 && x <= YEAR + 1); };
    if (!yearOk(d.entryYear)) return bad('entryYear', 'Το έτος εισαγωγής δεν φαίνεται σωστό.');
    if (!yearOk(d.gradYear)) return bad('gradYear', 'Το έτος αποφοίτησης δεν φαίνεται σωστό.');
    if (d.entryYear && d.gradYear && d.gradYear < d.entryYear) return bad('gradYear', 'Το έτος αποφοίτησης είναι πριν από το έτος εισαγωγής.');
    if (d.linkedin) {
      if (!/^https?:\/\//i.test(d.linkedin)) d.linkedin = 'https://' + d.linkedin;
      if (!/^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(d.linkedin.replace(/^http:/i, 'https:'))) return bad('linkedin', 'Γράψτε τη διεύθυνση του προφίλ σας στο LinkedIn (linkedin.com/in/…).');
      d.linkedin = d.linkedin.replace(/^http:/i, 'https:');
    }
    if (!d.acceptedPrivacy) return bad('acceptedPrivacy', 'Για να υποβάλετε αίτηση, χρειάζεται να συμφωνήσετε με την πολιτική απορρήτου.');
    return '';
  }
  // while a save is on its way, the redraws its own write causes must not
  // bring back an enabled button (a second click sent it twice)
  var saving = false;
  function submitApplication(form) {
    if (saving) return;
    var msg = form.querySelector('[data-form-msg]'), btn = form.querySelector('[type=submit]');
    var d = readForm(form), err = validate(d, form);
    msg.className = 'form-error';
    if (err) { formErr = err; msg.textContent = err; say(err); return; }
    msg.textContent = '';
    btn.disabled = true;
    var wasNew = !member;
    var ref = db.collection('members').doc(user.uid);
    var provider = ((user.providerData || [])[0] || {}).providerId || (linked.indexOf('linkedin') !== -1 ? 'linkedin' : 'unknown');
    // Firestore shows our write to the listener before the server accepts it, and
    // rolls it back if refused: keep what was typed so a refusal redraws it
    draft = formValues(form); draft.linkedin = d.linkedin; formErr = '';
    // a reviewed name is frozen (firestore.rules): send the stored one
    if (member && member.status !== 'pending') { d.firstName = member.firstName; d.lastName = member.lastName; }
    d.provider = provider.slice(0, 40);
    d.updatedAt = FV.serverTimestamp();
    var existing = !!member;
    if (!existing) { d.status = 'pending'; d.createdAt = FV.serverTimestamp(); }
    saving = true;
    // the rules read the sign-in token: after confirming the e-mail it may still say "not confirmed"
    var job = A.freshToken(user).catch(function () {}).then(function () { return existing ? ref.update(d) : ref.set(d); });
    job.then(function () {
      saving = false;
      editing = false; draft = null; formErr = '';
      // an active member: the directory follows the form (listed, updated, or removed)
      if (member && member.status === 'active') {
        if (d.consentDirectory) writeDirectory().catch(function () {});
        else if (dirEntry) db.collection('directory').doc(user.uid).delete().then(function () { dirEntry = null; render(); }, function () {});
      }
      A.flash(wasNew ? 'Η αίτησή σας υποβλήθηκε. Ευχαριστούμε!' : 'Τα στοιχεία σας αποθηκεύτηκαν.');
      refocus = '#apply h2';
      render(true);
    }, function (e) {
      saving = false;
      formErr = A.friendly(e);
      editing = !wasNew;
      refocus = '#apply-msg';
      render();
      say(formErr);
    });
  }

  function directoryData() {
    var m = member;
    return {
      name: m.firstName + ' ' + m.lastName, gradYear: m.gradYear || null,
      direction: m.direction || '', employer: m.employer || '', position: m.position || '',
      city: PO.placeLine(m.city, m.country), linkedin: m.linkedin || '', updatedAt: FV.serverTimestamp()
    };
  }
  function writeDirectory() { return db.collection('directory').doc(user.uid).set(directoryData()).then(function () { dirEntry = {}; }); }
  function toggleDirectory(box) {
    box.disabled = true;
    dirMsg = null;
    var want = box.checked;
    var job = A.freshToken(user).catch(function () {})
      .then(function () { return want ? writeDirectory() : db.collection('directory').doc(user.uid).delete().then(function () { dirEntry = null; }); })
      .then(function () {
        // remember the choice on the application too, so it is not re-listed automatically
        if (member.consentDirectory !== want) return db.collection('members').doc(user.uid).update({ consentDirectory: want, updatedAt: FV.serverTimestamp() });
      });
    job.then(function () {
      dirMsg = { cls: 'form-ok', text: want ? 'Εμφανίζεστε στον κατάλογο μελών.' : 'Αφαιρεθήκατε από τον κατάλογο μελών.' };
      refocus = '[data-dir]';
      render();
      say(dirMsg.text);
    }, function (e) {
      dirMsg = { cls: 'form-error', text: A.friendly(e) };
      refocus = '[data-dir]';
      render();
      say(dirMsg.text);
    });
  }

  /* connect another provider to this account; if it already opens ANOTHER
     account here, offer to merge the two instead of just saying no */
  function linkProvider(k, b) {
    var msg = app.querySelector('[data-methods-msg]');
    if (b) b.disabled = true;
    conflict = null;
    A.link(k).then(function () {
      user = firebase.auth().currentUser;
      // linkWithPopup keeps the uid, so onChange does not fire; the async
      // list keeps a LinkedIn that was connected through the Cloud Function
      return A.providersAsync(user).then(function (l) {
        linked = l;
        refocus = '#methods h2';
        render();
        A.flash('Το ' + A.providerInfo(k).name + ' συνδέθηκε με τον λογαριασμό σας.');
      });
    }, function (err) {
      if (b) { b.disabled = false; try { b.focus(); } catch (e) {} }     // disabling it had dropped keyboard focus
      if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request' || err.code === 'auth/user-cancelled')) return;
      if (err && TAKEN.indexOf(err.code) !== -1) {
        var name = A.providerInfo(k).name;
        A.prepareMerge();                        // the merge button below will open a popup: be ready for it
        conflict = { provider: k, credential: err.credential || null,
          title: 'Αυτό το ' + name + ' ανοίγει ήδη άλλον λογαριασμό εδώ',
          text: 'Μάλλον τον φτιάξατε κι εσείς, σε άλλη επίσκεψη. Μπορείτε να ενώσετε τους δύο λογαριασμούς σε αυτόν: η αίτηση μέλους και οι τρόποι σύνδεσης του άλλου μεταφέρονται εδώ, και ο άλλος διαγράφεται.' };
        refocus = '[data-merge-conflict]';
        render();
        return;
      }
      if (msg) { msg.className = 'form-error'; msg.textContent = A.friendly(err); }
    });
  }
  function openPasswordForm() {
    pwOpen = true; refocus = '#pw-new'; render();
    var f = app.querySelector('[data-pw-form]');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  }
  /* add e-mail + password to an account that signs in some other way */
  function setPassword(f) {
    var msg = f.querySelector('[data-pw-msg]'), btn = f.querySelector('[type=submit]');
    var a = f.elements['pw-new'].value, b = f.elements['pw-new2'].value;
    msg.className = 'form-error';
    if (a.length < 8) { msg.textContent = 'Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.'; f.elements['pw-new'].focus(); return; }
    if (a !== b) { msg.textContent = 'Οι δύο κωδικοί δεν είναι ίδιοι.'; f.elements['pw-new2'].focus(); return; }
    btn.disabled = true; msg.textContent = '';
    var link = function () { return user.linkWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, a)); };
    link().catch(function (err) {
      // Firebase wants a recent sign-in before adding a password: prove it, then once more
      if (err && err.code === 'auth/requires-recent-login') return A.reauth(user).then(link);
      throw err;
    }).then(function () {
      user = firebase.auth().currentUser;
      return A.providersAsync(user).then(function (l) {
        linked = l; pwOpen = false; pwBox = null; refocus = '#methods h2'; render();
        A.flash('Ορίστηκε κωδικός. Μπορείτε πλέον να μπαίνετε και με το ' + user.email + ' και αυτόν τον κωδικό.');
      });
    }, function (err) {
      btn.disabled = false;
      if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) { msg.textContent = 'Ακυρώθηκε.'; return; }
      if (err && TAKEN.indexOf(err.code) !== -1) {
        pwOpen = false; pwBox = null;
        conflict = { provider: 'password', title: 'Υπάρχει ήδη άλλος λογαριασμός με το ' + user.email,
          text: 'Μάλλον τον φτιάξατε κι εσείς με e-mail και κωδικό. Μπορείτε να ενώσετε τους δύο λογαριασμούς: πατήστε το κουμπί και γράψτε τον κωδικό ΕΚΕΙΝΟΥ του λογαριασμού.' };
        refocus = '[data-merge-conflict]'; render(); return;
      }
      msg.textContent = A.friendly(err);
    });
  }
  /* sign in to the other account (auth.js keeps this page's session as it is),
     then the server merges it into this one */
  function runMerge(how, btn, msg) {
    if (btn) btn.disabled = true;
    if (msg) { msg.className = 'form-ok'; msg.textContent = 'Ένωση λογαριασμών…'; }
    A.mergeWith(how).then(function (report) {
      user = firebase.auth().currentUser;
      conflict = null; mergeOpen = false;
      return A.providersAsync(user).then(function (l) {
        linked = l; refocus = '#methods h2'; render();
        A.flash(A.mergeSummary(report));
      });
    }, function (err) {
      if (btn) { btn.disabled = false; try { btn.focus(); } catch (e) {} }
      if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request' || err.code === 'auth/user-cancelled')) { if (msg) msg.textContent = ''; return; }
      if (err && err.code === 'semfe/merge-cancelled') { if (msg) { msg.className = 'form-ok'; msg.textContent = 'Η ένωση ακυρώθηκε: δεν άλλαξε τίποτα.'; } return; }
      if (msg) { msg.className = 'form-error'; msg.textContent = A.friendly(err); }
    });
  }

  function deleteAccount() {
    var q = function (s) { return app.querySelector(s); };
    var msg = q('[data-del-msg]'), btn = q('[data-del-go]');
    // «διαγραφή», «Διαγραφή» and «ΔΙΑΓΡΑΦΗ» all count (accents are dropped before comparing)
    var typed = q('#del-confirm').value.trim();
    if (typed.normalize) typed = typed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (typed.toUpperCase() !== 'ΔΙΑΓΡΑΦΗ') { msg.textContent = 'Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.'; return; }
    var pass = q('#del-pass');
    btn.disabled = true; msg.className = 'form-error'; msg.textContent = '';
    var prove = function () { return pass ? A.reauthPassword(pass.value) : A.reauth(user); };
    // prove identity FIRST: deleting the sign-in account removes the right to delete its data.
    // "Recent" is measured on the server's own clock (the token's sign-in and issue
    // times), not this device's, and not the account's last sign-in on another device.
    var proof = user.getIdTokenResult(true).then(function (r) {
      var signedIn = Date.parse(r && r.authTime), issued = Date.parse(r && r.issuedAtTime);
      return isFinite(signedIn) && isFinite(issued) && issued - signedIn < 4 * 60 * 1000;
    }, function () { return false; }).then(function (recent) { return recent ? null : prove(); });
    proof.then(function () {
      if (unsub) { unsub(); unsub = null; }
      return db.collection('directory').doc(user.uid).delete().catch(function () {});
    }).then(function () {
      return db.collection('members').doc(user.uid).delete();
    }).then(function () {
      deleted = true;
      // still refused as "not recent" (a slow click): prove it once more and try again
      return user.delete().catch(function (e) {
        if (!e || e.code !== 'auth/requires-recent-login') throw e;
        return prove().then(function () { return user.delete(); }).catch(function (e2) {
          throw { code: 'semfe/delete-half', cause: e2 };
        });
      });
    }).then(function () {
      try { localStorage.removeItem('semfe:auth-hint'); } catch (e) {}
      html('<div class="notice ok" tabindex="-1" id="deleted-msg"><strong>Ο λογαριασμός σας διαγράφηκε.</strong><p>Διαγράψαμε τον λογαριασμό σύνδεσης, την αίτηση μέλους και την καταχώρισή σας στον κατάλογο.</p></div>');
      var d = document.getElementById('deleted-msg'); if (d) d.focus();
    }).catch(function (e) {
      deleted = false;
      btn.disabled = false;
      if (e && e.code === 'semfe/delete-half') {
        // the application and the directory card are gone, the sign-in is not
        msg.textContent = 'Η αίτηση μέλους και η καταχώριση στον κατάλογο διαγράφηκαν, αλλά ο λογαριασμός σύνδεσης όχι ακόμα (' +
          A.friendly(e.cause) + '). Πατήστε ξανά «Διαγραφή» για να ολοκληρωθεί.';
        return;
      }
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request' || e.code === 'auth/user-cancelled')) { msg.textContent = 'Η διαγραφή ακυρώθηκε.'; return; }
      msg.textContent = A.friendly(e);
    });
  }
})();
