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
  var L = window.SEMFE_I18N, T = L.t;
  var A = window.SemfeAuth, C = window.SEMFE || {}, U = window.SEMFE_UTIL || {}, PO = window.SEMFE_PROFILE, AL = window.SEMFE_ALERTS;
  var app = document.getElementById('account-app');
  if (!A || !app || !PO) return;
  var esc = A.esc, FV = null, db = null, unsub = null, user = null, member = null, dirEntry = null;
  var editing = false, deleted = false, autoDirTried = false, linked = [];
  var draft = null, formErr = '', dirMsg = null, refocus = null, applyScrolled = false, deleteShown = false, delBox = null;
  // sign-in methods: the set-password form (open, what is typed), the merge box,
  // a method that turned out to belong to another account, deep links already followed
  var pwOpen = false, pwBox = null, mergeOpen = false, conflict = null, jumped = {};
  // the e-mail alerts (alertPrefs/{uid}): null while loading, {} when none chosen yet
  var alerts = null, alertsDraft = null, alertsMsg = null;
  var TAKEN = ['auth/credential-already-in-use', 'auth/email-already-in-use', 'auth/account-exists-with-different-credential'];
  var YEAR = new Date().getFullYear();
  var STAGES = { graduate: T('Απόφοιτος/η ΣΕΜΦΕ', 'SEMFE graduate'), 'final-year': T('Τελειόφοιτος/η ΣΕΜΦΕ', 'SEMFE final-year student'), faculty: T('Μέλος ΔΕΠ ΣΕΜΦΕ', 'SEMFE faculty member') };
  // the Greek name is what is STORED (members/{uid}.direction); the second is what is shown
  var DIRECTIONS = [['Εφαρμοσμένα Μαθηματικά', T('Εφαρμοσμένα Μαθηματικά', 'Applied Mathematics')],
    ['Εφαρμοσμένη Φυσική', T('Εφαρμοσμένη Φυσική', 'Applied Physics')],
    ['Άλλη / δεν ισχύει', T('Άλλη / δεν ισχύει', 'Other / not applicable')]];
  function directionLabel(v) {
    for (var i = 0; i < DIRECTIONS.length; i++) if (DIRECTIONS[i][0] === v) return DIRECTIONS[i][1];
    return v;
  }
  // the fee as the page's language writes it: "10€" / "€10"
  function fee() { var n = C.annualFee || 10; return T(n + '€', '€' + n); }
  // the e-mail alert topics carry their English wording in t.en
  function topicLabel(t) { return L.en && t.en ? t.en.label : t.label; }
  function topicHint(t) { return L.en && t.en ? t.en.hint : t.hint; }

  function html(s) { app.innerHTML = s; }
  function isFaculty(m) { return !!m && m.stage === 'faculty'; }
  function statusBadge(m) {
    if (!m) return '<span class="badge muted">' + T('Χωρίς αίτηση', 'No application') + '</span>';
    if (m.status === 'active') return '<span class="badge ok">' + (isFaculty(m) ? T('Πρόσβαση μέλους', 'Member access') : T('Ενεργό μέλος', 'Active member')) + '</span>';
    if (m.status === 'rejected') return '<span class="badge err">' + T('Η αίτηση δεν εγκρίθηκε', 'Application not approved') + '</span>';
    return '<span class="badge warn">' + T('Η αίτηση εκκρεμεί', 'Application pending') + '</span>';
  }

  A.onChange(function (u) {
    user = u;
    if (unsub) { unsub(); unsub = null; }
    member = null; dirEntry = null; editing = false; draft = null; formErr = ''; dirMsg = null; refocus = null;
    autoDirTried = false; delBox = null; pwOpen = false; pwBox = null; mergeOpen = false; conflict = null;
    alerts = null; alertsDraft = null; alertsMsg = null;
    linked = u ? A.providers(u) : [];
    if (deleted) {                  // keep the "account deleted" message on screen…
      if (!u) return;
      deleted = false;              // …until someone signs in again on this page
    }
    if (!A.configured) return renderOffline();
    if (!u && A.pending && A.pending()) return renderPending(A.pending());
    if (!u) return renderSignedOut();
    html('<div class="loading"><span class="spinner" aria-hidden="true"></span>' + T('Φόρτωση του λογαριασμού σας…', 'Loading your account…') + '</div>');
    // LinkedIn connected through the Cloud Function shows up only in the token's claims
    A.providersAsync(u).then(function (l) {
      if (l.join() !== linked.join()) { linked = l; if (user === u && app.querySelector('.linked')) render(); }
    });
    A.db().then(function (d) {
      db = d; FV = firebase.firestore.FieldValue;
      db.collection('alertPrefs').doc(u.uid).get().then(function (snap) {
        if (user !== u) return;
        alerts = snap.exists ? snap.data() || {} : {};
        if (member) render();
      }, function () { if (user !== u) return; alerts = { failed: true }; if (member) render(); });
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
    html('<div class="panel"><h2>' + T('Η σύνδεση μελών ανοίγει σύντομα', 'Member sign-in opens soon') + '</h2>' +
      T('<p>Σύντομα θα μπορείτε να δημιουργήσετε λογαριασμό με <strong>' + esc(A.methodsText('e-mail')) + '</strong>, να κάνετε την αίτηση μέλους από εδώ και να μπαίνετε στην περιοχή μελών.</p>',
        '<p>Soon you will be able to create an account with <strong>' + esc(A.methodsText('e-mail')) + '</strong>, make your membership application here and enter the members\' area.</p>') +
      '<p>' + T('Μέχρι τότε, μπορείτε να κάνετε αίτηση μέσω της ηλεκτρονικής φόρμας.', 'Until then, you can apply through the online form.') + '</p>' +
      '<div class="section-foot" style="margin-top:8px"><a class="btn btn-dark" href="' + esc(C.legacyApplyFormUrl) + '" target="_blank" rel="noopener">' + T('Ηλεκτρονική φόρμα αίτησης', 'Online application form') + '</a><a class="btn btn-outline" href="' + A.home + 'support/#eggrafi">' + T('Πώς γίνομαι μέλος', 'How to become a member') + '</a></div></div>');
  }
  function renderSignedOut() {
    html('<div class="acct-grid"><div class="panel"><h2>' + T('Συνδεθείτε ή δημιουργήστε λογαριασμό', 'Sign in or create an account') + '</h2>' +
      T('<p>Με τον λογαριασμό σας κάνετε την <strong>αίτηση μέλους</strong>, βλέπετε την κατάσταση της εγγραφής και της συνδρομής σας και μπαίνετε στην <strong>περιοχή μελών</strong>.</p>',
        '<p>With your account you make your <strong>membership application</strong>, see the status of your membership and your fee, and enter the <strong>members\' area</strong>.</p>') +
      '<p>' + T('Συνδεθείτε με ', 'Sign in with ') + '<strong>' + esc(A.methodsText(T('e-mail και κωδικό', 'e-mail and password'))) + '</strong>.</p>' +
      '<div class="section-foot" style="margin-top:8px"><button type="button" class="btn btn-primary" data-open="register">' + T('Νέος λογαριασμός', 'New account') + '</button><button type="button" class="btn btn-outline" data-open="signin">' + T('Έχω ήδη λογαριασμό', 'I already have an account') + '</button></div></div>' +
      '<div class="panel"><h2 style="font-size:1.1rem">' + T('Γιατί λογαριασμός;', 'Why an account?') + '</h2><ul class="checklist">' +
      '<li>' + T('Αίτηση μέλους χωρίς χαρτιά, σε δύο λεπτά', 'A membership application with no paperwork, in two minutes') + '</li><li>' + T('Βλέπετε πότε ενεργοποιείται η ιδιότητά σας', 'You see when your membership becomes active') + '</li>' +
      '<li>' + T('Πρόσβαση στον κατάλογο μελών (αν το επιθυμείτε)', 'Access to the members\' directory (if you wish)') + '</li><li>' + T('Διαγράφετε τα στοιχεία σας όποτε θέλετε', 'You can delete your details whenever you like') + '</li></ul></div></div>');
    Array.prototype.forEach.call(app.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () { A.open(b.getAttribute('data-open'), b); });
    });
    if (/register|apply/.test(location.hash)) A.open('register');
    else if (/signin/.test(location.hash)) A.open('signin');
  }
  /* an e-mail + password account that has not confirmed its address is held
     by auth.js (the page hears null): it cannot use the site until it does */
  function renderPending(p) {
    html('<div class="panel" id="verify-pending"><h2 tabindex="-1">' + T('Επιβεβαιώστε το e-mail σας', 'Confirm your e-mail') + '</h2>' +
      T('<p>Ο λογαριασμός με το <strong>' + esc(p.email) + '</strong> ενεργοποιείται μόλις πατήσετε τον σύνδεσμο που σας στείλαμε με e-mail. ' +
      'Μετά μπαίνετε εδώ κανονικά και κάνετε την <strong>αίτηση μέλους</strong>.</p>',
        '<p>The account for <strong>' + esc(p.email) + '</strong> becomes active as soon as you press the link we sent you by e-mail. ' +
        'Then you come in here as usual and make your <strong>membership application</strong>.</p>') +
      '<div class="section-foot" style="margin-top:8px"><button type="button" class="btn btn-primary" data-open="verify">' + T('Επιβεβαίωση e-mail', 'Confirm e-mail') + '</button>' +
      '<button type="button" class="btn btn-outline" data-signout>' + T('Αποσύνδεση', 'Sign out') + '</button></div></div>');
    app.querySelector('[data-open]').addEventListener('click', function (e) { A.open('verify', e.currentTarget); });
    app.querySelector('[data-signout]').addEventListener('click', function () { A.signOut(); });
  }
  function renderError(e) {
    html('<div class="notice err"><strong>' + T('Δεν ήταν δυνατή η φόρτωση', 'Your account could not be loaded') + '</strong><p>' + esc(A.friendly(e)) + '</p></div>');
  }

  /* (an e-mail + password account with nothing else linked that has not
     confirmed its address never reaches this page signed in: auth.js holds it
     at the «Επιβεβαιώστε το e-mail σας» card, and renderPending() shows) */
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
    var attrs = ['data-dir', 'data-edit', 'data-cancel', 'data-send-verify', 'data-verified-li',
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
    var af = app.querySelector('form[data-alerts]');
    if (af) alertsDraft = alertsChecked(af);
    var mf = app.querySelector('[data-merge-pw]');
    var mergeTyped = mf ? { email: mf.elements['merge-email'].value, pass: mf.elements['merge-pass'].value } : null;
    var name = A.displayName(user);
    var s = '<div class="panel profile-head">' + A.avatarHtml(name, user.photoURL, 'avatar-lg') +
      '<div class="who"><strong>' + esc(name) + '</strong><span class="muted">' + esc(user.email || '') + '</span></div>' + statusBadge(member) + '</div>';


    s += addMethodPrompt();
    s += '<div class="acct-grid" style="margin-top:18px"><div>';
    s += membershipPanel();
    s += alertsPanel();
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
    var hm = /^#(methods|apply|alerts)$/.exec(location.hash);
    if (hm && !jumped[hm[1]] && (hm[1] === 'methods' || (member && (hm[1] === 'apply' || app.querySelector('#alerts'))))) {
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
    var m = member, faculty = isFaculty(m), s = '<div class="panel" id="apply"><h2 tabindex="-1">' + T('Η ιδιότητα μέλους', 'Your membership') + '</h2>';
    var yes = T('Ναι', 'Yes'), no = T('Όχι', 'No');
    if (m.status === 'active') {
      var paid = (m.duesYears || []).slice().sort();
      s += faculty
        ? '<div class="notice ok"><strong>' + T('Έχετε πρόσβαση στην περιοχή μελών.', 'You have access to the members\' area.') + '</strong><p>' + T('Ως μέλος ΔΕΠ ΣΕΜΦΕ δεν χρειάζεται συνδρομή.', 'As a SEMFE faculty member you do not pay a membership fee.') + '</p></div>'
        : '<div class="notice ok"><strong>' + T('Είστε ενεργό μέλος του Συλλόγου.', 'You are an active member of the Association.') + '</strong><p>' +
          esc(paid.length ? T('Συνδρομές που έχουμε καταγράψει: ' + paid.join(', ') + '.', 'Fees we have recorded: ' + paid.join(', ') + '.') : T('Δεν έχει καταγραφεί ακόμα συνδρομή.', 'No fee has been recorded yet.')) +
          (paid.indexOf(YEAR) === -1 ? T(' Η συνδρομή ' + YEAR + ' (' + esc(fee()) + ') <a href="' + A.home + 'support/#katathesi">κατατίθεται εδώ</a>.',
            ' The ' + YEAR + ' fee (' + esc(fee()) + ') <a href="' + A.home + 'support/#katathesi">can be paid here</a>.') : '') + '</p></div>';
      s += '<p><a class="btn btn-dark" href="' + A.home + 'members/">' + T('Περιοχή μελών', 'Members\' area') + '</a></p>' + directoryBox();
    } else if (m.status === 'rejected') {
      s += '<div class="notice err"><strong>' + T('Η αίτησή σας δεν εγκρίθηκε.', 'Your application was not approved.') + '</strong><p>' + (m.adminNote ? esc(m.adminNote) + ' ' : '') +
        T('Για οποιαδήποτε απορία <a href="' + A.home + 'contact/">επικοινωνήστε μαζί μας</a>.', 'If you have any questions, <a href="' + A.home + 'contact/">please contact us</a>.') + '</p></div>';
    } else if (faculty) {
      s += '<div class="notice warn"><strong>' + T('Λάβαμε το αίτημά σας.', 'We have received your request.') + '</strong><p>' +
        T('Ως μέλος ΔΕΠ ΣΕΜΦΕ δεν χρειάζεται συνδρομή. Μόλις επιβεβαιώσουμε την ιδιότητά σας, θα σας δώσουμε πρόσβαση στην περιοχή μελών και θα σας ενημερώσουμε με e-mail.',
          'As a SEMFE faculty member you do not pay a membership fee. As soon as we confirm your position, we will give you access to the members\' area and let you know by e-mail.') + '</p></div>';
    } else {
      s += '<div class="notice warn"><strong>' + T('Λάβαμε την αίτησή σας.', 'We have received your application.') + '</strong><p>' +
        T('Επόμενο βήμα: καταθέστε τη συνδρομή των <strong>' + esc(fee()) + '</strong> ' +
        '(<a href="' + A.home + 'support/#katathesi">τρόποι πληρωμής</a>) γράφοντας στην αιτιολογία το ονοματεπώνυμο, το e-mail σας και το έτος συνδρομής. ' +
        'Μόλις ελέγξουμε τα στοιχεία σας, η ιδιότητα μέλους ενεργοποιείται εδώ και θα σας ενημερώσουμε με e-mail.',
          'Next step: pay the <strong>' + esc(fee()) + '</strong> membership fee ' +
          '(<a href="' + A.home + 'support/#katathesi">ways to pay</a>), writing your full name, your e-mail address and the year of the fee in the payment reference. ' +
          'Once we have checked your details, your membership becomes active here and we will let you know by e-mail.') + '</p></div>';
    }
    s += '<dl class="kv" style="margin:18px 0">' +
      '<dt>' + T('Ονοματεπώνυμο', 'Full name') + '</dt><dd>' + esc(m.firstName + ' ' + m.lastName) + '</dd>' +
      '<dt>E-mail</dt><dd>' + esc(m.email) + '</dd>' +
      (m.phone ? '<dt>' + T('Τηλέφωνο', 'Phone') + '</dt><dd>' + esc(m.phone) + '</dd>' : '') +
      '<dt>' + T('Ιδιότητα', 'Role') + '</dt><dd>' + esc(STAGES[m.stage] || m.stage) + '</dd>' +
      (m.entryYear ? '<dt>' + T('Εισαγωγή', 'Year of entry') + '</dt><dd>' + esc(m.entryYear) + '</dd>' : '') +
      (m.gradYear ? '<dt>' + T('Αποφοίτηση', 'Graduated') + '</dt><dd>' + esc(m.gradYear) + '</dd>' : '') +
      (m.direction ? '<dt>' + T('Κατεύθυνση', 'Specialisation') + '</dt><dd>' + esc(directionLabel(m.direction)) + '</dd>' : '') +
      (m.employer || m.position ? '<dt>' + T('Εργασία', 'Work') + '</dt><dd>' + esc([m.position, m.employer].filter(Boolean).join(', ')) + '</dd>' : '') +
      (m.industry ? '<dt>' + T('Κλάδος', 'Industry') + '</dt><dd>' + esc(PO.industryLabel(m.industry, L.lang)) + '</dd>' : '') +
      (m.city ? '<dt>' + T('Πόλη', 'City') + '</dt><dd>' + esc(m.city) + '</dd>' : '') +
      (m.country ? '<dt>' + T('Χώρα', 'Country') + '</dt><dd>' + esc(PO.countryName(m.country, L.lang)) + '</dd>' : '') +
      (m.gender ? '<dt>' + T('Φύλο', 'Gender') + '</dt><dd>' + esc(PO.genderLabel(m.gender, L.lang)) + '</dd>' : '') +
      (/^https:\/\//i.test(m.linkedin || '') ? '<dt>LinkedIn</dt><dd><a href="' + esc(m.linkedin) + '" target="_blank" rel="noopener">' + esc(m.linkedin.replace(/^https?:\/\/(www\.)?/, '')) + '</a></dd>' : '') +
      '<dt>Newsletter</dt><dd>' + (m.consentNewsletter ? yes : no) + '</dd>' +
      '<dt>' + T('Θέσεις εργασίας', 'Job openings') + '</dt><dd>' + (m.consentJobs ? yes : no) + '</dd>' +
      '</dl><button type="button" class="btn btn-outline" data-edit>' + T('Επεξεργασία στοιχείων', 'Edit details') + '</button></div>';
    return s;
  }

  /* «Ειδοποιήσεις με e-mail»: the kinds of news a member wants by e-mail
     (assets/js/alert-topics.js; sent by functions/alerts.js). For members
     whose application is pending or active, to their confirmed sign-in
     e-mail (firestore.rules pins it). */
  function alertsChecked(form) {
    return Array.prototype.filter.call(form.querySelectorAll('input[name=topic]'), function (b) { return b.checked; }).map(function (b) { return b.value; });
  }
  function alertsPanel() {
    if (!AL || !member || editing || draft || member.status === 'rejected') return '';
    var s = '<div class="panel" id="alerts"><h2 tabindex="-1">' + T('Ειδοποιήσεις με e-mail', 'E-mail alerts') + '</h2>' +
      '<p class="muted intro">' + T('Διαλέξτε τι θέλετε να μαθαίνετε με e-mail. Όταν δημοσιεύεται κάτι νέο από όσα επιλέξατε, σας στέλνουμε ένα σύντομο e-mail με τον σύνδεσμο. ' +
      'Τις σταματάτε όποτε θέλετε, από εδώ ή από τον σύνδεσμο που έχει κάθε e-mail.',
        'Choose what you would like to hear about by e-mail. When something new is published in what you chose, we send you a short e-mail with the link. ' +
        'You can stop them whenever you like, here or from the link in every e-mail.') + '</p>';
    if (!user.email) return s + '<div class="notice warn"><p>' + T('Για να λαμβάνετε ειδοποιήσεις, ο λογαριασμός σας χρειάζεται μια διεύθυνση e-mail. ' +
      'Συνδέστε το Google ή ορίστε e-mail και κωδικό στους <a href="#methods">τρόπους σύνδεσης</a>.',
        'To receive alerts, your account needs an e-mail address. ' +
        'Connect Google, or set an e-mail address and password, under <a href="#methods">sign-in methods</a>.') + '</p></div></div>';
    if (alerts === null) return s + '<p class="muted"><span class="spinner" aria-hidden="true"></span> ' + T('Φόρτωση των επιλογών σας…', 'Loading your choices…') + '</p></div>';
    if (alerts.failed) return s + '<p class="form-error">' + T('Δεν φορτώθηκαν οι επιλογές σας. Ανανεώστε τη σελίδα για να δοκιμάσετε ξανά.', 'Your choices could not be loaded. Refresh the page to try again.') + '</p></div>';
    var have = alertsDraft || AL.clean(alerts.topics);
    s += '<form data-alerts novalidate><fieldset style="border:0;padding:0;margin:0 0 12px"><legend class="sr-only">' + T('Τι θέλετε να λαμβάνετε με e-mail', 'What you would like to receive by e-mail') + '</legend>' +
      AL.TOPICS.map(function (t) {
        return '<label class="check" style="margin-bottom:12px"><input type="checkbox" name="topic" id="al-' + t.key + '" value="' + t.key + '"' + (have.indexOf(t.key) !== -1 ? ' checked' : '') + '>' +
          '<span><strong>' + esc(topicLabel(t)) + '</strong><br><span class="muted" style="font-size:.9rem">' + esc(topicHint(t)) + '</span></span></label>';
      }).join('') + '</fieldset>' +
      '<p class="muted" style="font-size:.9rem;margin:0 0 12px">' + T('Τα e-mail πηγαίνουν στο <strong>' + esc(user.email) + '</strong>, το e-mail σύνδεσής σας.',
        'The e-mails go to <strong>' + esc(user.email) + '</strong>, the address you sign in with.') +
      (alerts.email && alerts.email !== user.email && AL.clean(alerts.topics).length ? T(' Μέχρι να πατήσετε «Αποθήκευση», πηγαίνουν στο ' + esc(alerts.email) + '.', ' Until you press “Save”, they go to ' + esc(alerts.email) + '.') : '') + '</p>' +
      '<button type="submit" class="btn btn-dark btn-sm">' + T('Αποθήκευση', 'Save') + '</button>' +
      '<p class="' + (alertsMsg ? alertsMsg.cls : 'form-ok') + '" data-alerts-msg role="status" style="margin:10px 0 0">' + esc(alertsMsg ? alertsMsg.text : '') + '</p></form>';
    return s + '</div>';
  }
  function saveAlerts(form) {
    var topics = AL.clean(alertsChecked(form)), btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    alertsMsg = null;
    // merge: the stop-link key the server keeps on the document stays as it is
    A.freshToken(user).catch(function () {}).then(function () {
      return db.collection('alertPrefs').doc(user.uid).set({ topics: topics, email: user.email, updatedAt: FV.serverTimestamp() }, { merge: true });
    }).then(function () {
      alerts = Object.assign({}, alerts, { topics: topics, email: user.email });
      alertsDraft = null;
      var names = topics.map(function (k) { return topicLabel(AL.byKey(k)); }).join(', ');
      alertsMsg = { cls: 'form-ok', text: topics.length
        ? T('Αποθηκεύτηκε. Θα λαμβάνετε: ' + names + '.', 'Saved. You will receive: ' + names + '.')
        : T('Αποθηκεύτηκε. Δεν θα λαμβάνετε ειδοποιήσεις με e-mail.', 'Saved. You will not receive any e-mail alerts.') };
      refocus = 'form[data-alerts] [type=submit]';
      render();
      say(alertsMsg.text);
    }, function (e) {
      alertsMsg = { cls: 'form-error', text: A.friendly(e) };
      refocus = 'form[data-alerts] [type=submit]';
      render();
      say(alertsMsg.text);
    });
  }

  function directoryBox() {
    return '<fieldset style="margin-top:18px"><legend>' + T('Κατάλογος μελών', 'Members\' directory') + '</legend>' +
      '<label class="check"><input type="checkbox" data-dir' + (dirEntry ? ' checked' : '') + '><span>' +
      T('Να εμφανίζομαι στον κατάλογο της περιοχής μελών (ονοματεπώνυμο, έτος αποφοίτησης, κατεύθυνση, εργασία, πόλη, LinkedIn). Τον βλέπουν μόνο ενεργά μέλη.',
        'List me in the directory of the members\' area (full name, year of graduation, specialisation, work, city, LinkedIn). Only active members can see it.') + '</span></label>' +
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
      '<option value="">' + T('Επιλέξτε…', 'Choose…') + '</option>' + options.map(function (o) {
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
    var nameHint = frozen ? T('Για αλλαγή ονόματος <a href="' + A.home + 'contact/">επικοινωνήστε με τον Σύλλογο</a>.', 'To change your name, <a href="' + A.home + 'contact/">contact the Association</a>.') : '';
    var msg = formErr;
    var active = !!member && member.status === 'active';
    // every box starts unticked: consent must be an act of the applicant
    // (GDPR Recital 32: "pre-ticked boxes ... should not ... constitute
    // consent"; CJEU C-673/17, Planet49). A saved application shows what was
    // saved, so a missing answer is never turned into a yes.
    var tick = function (v) { return !!v; };
    var optional = T('Προαιρετικό', 'Optional');
    return '<div class="panel" id="apply"><h2 tabindex="-1">' + (member ? T('Επεξεργασία στοιχείων', 'Edit details') : T('Αίτηση μέλους', 'Membership application')) + '</h2>' +
      (member ? '' : '<p class="muted intro">' + T('Συμπληρώστε τα στοιχεία σας. Τα πεδία με <span class="req">*</span> είναι υποχρεωτικά. Θα τα ελέγξουμε και θα ενεργοποιήσουμε την ιδιότητα μέλους μόλις λάβουμε τη συνδρομή των ' + esc(fee()) + ' (δεν ισχύει για μέλη ΔΕΠ).',
        'Fill in your details. Fields marked <span class="req">*</span> are required. We will check them and activate your membership as soon as we receive the ' + esc(fee()) + ' membership fee (faculty members do not pay it).') + '</p>') +
      '<form class="form" novalidate data-apply>' +
      '<div class="row">' + field('firstName', T('Όνομα', 'First name'), first, { required: true, auto: 'given-name', max: 80, readonly: frozen, hint: nameHint }) +
      field('lastName', T('Επώνυμο', 'Last name'), last, { required: true, auto: 'family-name', max: 80, readonly: frozen }) + '</div>' +
      '<div class="row">' + field('email', T('E-mail επικοινωνίας', 'Contact e-mail'), m.email || user.email || '', { required: true, auto: 'email', max: 200, inputmode: 'email' }) +
      field('phone', T('Κινητό τηλέφωνο', 'Mobile phone'), m.phone, { type: 'tel', auto: 'tel', max: 40, inputmode: 'tel', hint: optional }) + '</div>' +
      '<div class="row">' + select('stage', T('Ιδιότητα', 'Role'), m.stage || '', [['graduate', STAGES.graduate], ['final-year', STAGES['final-year']], ['faculty', STAGES.faculty]], true) +
      select('direction', T('Κατεύθυνση', 'Specialisation'), m.direction || '', DIRECTIONS, false) + '</div>' +
      '<div class="row">' + field('entryYear', T('Έτος εισαγωγής', 'Year of entry'), m.entryYear, { inputmode: 'numeric', max: 4, placeholder: T('π.χ. 2008', 'e.g. 2008') }) +
      field('gradYear', T('Έτος αποφοίτησης', 'Year of graduation'), m.gradYear, { inputmode: 'numeric', max: 4, placeholder: T('π.χ. 2013', 'e.g. 2013'), hint: T('Κενό αν είστε τελειόφοιτος/η', 'Leave empty if you are a final-year student') }) + '</div>' +
      '<div class="row">' + field('position', T('Θέση εργασίας', 'Job title'), m.position, { auto: 'organization-title', max: 120 }) + field('employer', T('Εργοδότης / Ίδρυμα', 'Employer / Institution'), m.employer, { auto: 'organization', max: 120 }) + '</div>' +
      '<div class="row">' + select('industry', T('Κλάδος', 'Industry'), m.industry || '', PO.choices('industry', L.lang), false) +
      select('gender', T('Φύλο', 'Gender'), m.gender || '', PO.choices('gender', L.lang), false) + '</div>' +
      '<div class="row">' + field('city', T('Πόλη', 'City'), m.city, { max: 80, auto: 'address-level2' }) +
      select('country', T('Χώρα', 'Country'), m.country != null && m.country !== '' ? m.country : (draft ? '' : PO.splitPlace(m.city).country), PO.choices('country', L.lang), false) + '</div>' +
      '<p class="muted" style="font-size:.88rem;margin:-4px 0 0">' + T('Ο κλάδος, η χώρα και το φύλο είναι προαιρετικά. Τα στοιχεία σπουδών, εργασίας και τόπου μετρώνται μόνο <strong>ανώνυμα</strong>, ως σύνολα, στα <a href="' + A.home + 'analytics/#meli" target="_blank" rel="noopener">στατιστικά των μελών</a>· ομάδες κάτω από 3 ατόμων δεν εμφανίζονται.',
        'Industry, country and gender are optional. Your studies, work and place are counted only <strong>anonymously</strong>, as totals, in the <a href="' + A.home + 'analytics/#meli" target="_blank" rel="noopener">members\' statistics</a>; groups of fewer than 3 people are not shown.') + '</p>' +
      field('linkedin', T('Προφίλ LinkedIn', 'LinkedIn profile'), m.linkedin, { type: 'url', max: 200, placeholder: 'https://www.linkedin.com/in/…', hint: T('Ο πιο εύκολος τρόπος να επιβεβαιώσουμε ότι είστε απόφοιτος ΣΕΜΦΕ.', 'The easiest way for us to confirm that you are a SEMFE graduate.') }) +
      '<div class="field"><label for="f-note">' + T('Σημείωση προς το Δ.Σ.', 'Note to the Board') + '</label><textarea id="f-note" name="note" maxlength="1000" aria-describedby="f-note-hint" data-hint="f-note-hint">' + esc(m.note || '') + '</textarea><span class="hint" id="f-note-hint">' + optional + '</span></div>' +
      '<fieldset><legend>' + T('Επικοινωνία', 'Keeping in touch') + '</legend><div class="form" style="gap:10px">' +
      check('consentNewsletter', T('Θέλω να λαμβάνω το ενημερωτικό newsletter του Συλλόγου.', 'I would like to receive the Association\'s newsletter.'), tick(m.consentNewsletter)) +
      check('consentJobs', T('Θέλω να λαμβάνω ανακοινώσεις θέσεων εργασίας και πρακτικής άσκησης.', 'I would like to receive announcements of jobs and internships.'), tick(m.consentJobs)) +
      check('consentDirectory', active ? T('Θέλω να εμφανίζομαι στον κατάλογο μελών (τον βλέπουν μόνο ενεργά μέλη).', 'I would like to be listed in the members\' directory (only active members can see it).')
        : T('Όταν ενεργοποιηθεί η ιδιότητά μου, θέλω να εμφανίζομαι στον κατάλογο μελών (τον βλέπουν μόνο ενεργά μέλη).', 'When my membership becomes active, I would like to be listed in the members\' directory (only active members can see it).'), tick(m.consentDirectory)) +
      check('acceptedPrivacy', T('Έχω διαβάσει την <a href="' + A.home + 'privacy/" target="_blank" rel="noopener">πολιτική απορρήτου</a>, που εξηγεί πώς τηρούνται τα στοιχεία μου στο μητρώο μελών.',
        'I have read the <a href="' + A.home + 'privacy/" target="_blank" rel="noopener">privacy policy</a>, which explains how my details are kept in the register of members.'), tick(m.acceptedPrivacy), true) +
      '</div></fieldset>' +
      '<div class="form-error" role="alert" id="apply-msg" tabindex="-1" data-form-msg>' + esc(msg) + '</div>' +
      '<div class="section-foot" style="margin-top:0"><button type="submit" class="btn btn-primary"' + (saving ? ' disabled' : '') + '>' + (saving ? T('Αποθήκευση…', 'Saving…') : member ? T('Αποθήκευση', 'Save') : T('Υποβολή αίτησης', 'Submit application')) + '</button>' +
      (member ? '<button type="button" class="btn btn-outline" data-cancel>' + T('Ακύρωση', 'Cancel') + '</button>' : '') + '</div>' +
      '</form></div>';
  }

  /* the ways this account can sign in: every method the site offers, whether
     it is connected, and what can be added */
  function available() {
    return A.enabledProviders().concat(user && user.email ? ['password'] : []);
  }
  function methodName(k) { return k === 'password' ? T('e-mail και κωδικό', 'e-mail and password') : (A.providerInfo(k) || {}).name || k; }
  function methodsPanel() {
    var rows = '', blocked = linkNeedsVerifiedEmail(), missing = false;
    A.enabledProviders().concat(['password']).forEach(function (k) {
      var info = k === 'password' ? { name: T('E-mail και κωδικός', 'E-mail and password') } : A.providerInfo(k);
      var on = linked.indexOf(k) !== -1;
      if (!on && (k !== 'password' || user.email)) missing = true;
      var dis = blocked ? ' disabled aria-describedby="link-needs-email"' : '';
      var action = on
        ? (k === 'password' ? '<button type="button" class="btn btn-outline btn-sm" data-reset>' + T('Αλλαγή κωδικού', 'Change password') + '</button>' : '<span class="badge ok">' + T('Συνδεδεμένο', 'Connected') + '</span>')
        : (k === 'password' ? (user.email ? '<button type="button" class="btn btn-outline btn-sm" data-setpw aria-expanded="' + pwOpen + '"' + dis + '>' + T('Ορισμός κωδικού', 'Set a password') + '</button>' : '<span class="badge muted">' + T('Ανενεργό', 'Not available') + '</span>')
          : '<button type="button" class="btn btn-outline btn-sm" data-link="' + k + '"' + dis + '>' + T('Σύνδεση', 'Connect') + '</button>');
      rows += '<div class="row"><span>' + A.icon(k) + esc(info.name) + '</span>' + action + '</div>';
    });
    var liNote = blocked && missing
      ? '<p class="muted" id="link-needs-email" style="font-size:.88rem;margin:10px 0 0">' + T('Για να συνδέσετε κι άλλον τρόπο σύνδεσης χρειάζεται επιβεβαιωμένο e-mail (' + esc(user.email) + '). ',
          'To connect another sign-in method you need a confirmed e-mail address (' + esc(user.email) + '). ') +
        '<button type="button" class="link-btn" data-send-verify>' + T('Στείλτε μου e-mail επιβεβαίωσης', 'Send me a confirmation e-mail') + '</button> · <button type="button" class="link-btn" data-verified-li>' + T('Το επιβεβαίωσα', 'I have confirmed it') + '</button></p>'
      : '';
    var pw = pwOpen && linked.indexOf('password') === -1 && user.email && !blocked
      ? '<form class="form sub-form" data-pw-form novalidate><p class="muted" style="margin:0 0 10px">' + T('Θα μπαίνετε και με <strong>' + esc(user.email) + '</strong> και αυτόν τον κωδικό.', 'You will also be able to sign in with <strong>' + esc(user.email) + '</strong> and this password.') + '</p>' +
        '<div class="field"><label for="pw-new">' + T('Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)', 'New password (at least 8 characters)') + '</label><input id="pw-new" name="pw-new" type="password" autocomplete="new-password" minlength="8" required></div>' +
        '<div class="field"><label for="pw-new2">' + T('Ξανά ο ίδιος κωδικός', 'The same password again') + '</label><input id="pw-new2" name="pw-new2" type="password" autocomplete="new-password" required></div>' +
        '<div class="form-error" data-pw-msg role="alert"></div>' +
        '<div class="section-foot" style="margin:0"><button type="submit" class="btn btn-dark btn-sm">' + T('Αποθήκευση κωδικού', 'Save password') + '</button><button type="button" class="btn btn-outline btn-sm" data-pw-cancel>' + T('Ακύρωση', 'Cancel') + '</button></div></form>'
      : '';
    var clash = conflict
      ? '<div class="notice warn" style="margin:14px 0 0" data-clash><strong>' + esc(conflict.title) + '</strong><p>' + esc(conflict.text) + '</p>' +
        '<p class="section-foot" style="margin:8px 0 0"><button type="button" class="btn btn-dark btn-sm" data-merge-conflict>' + T('Ένωση των δύο λογαριασμών', 'Merge the two accounts') + '</button></p></div>'
      : '';
    return '<div class="panel" id="methods"><h2 tabindex="-1">' + T('Τρόποι σύνδεσης', 'Sign-in methods') + '</h2><p class="muted intro">' + T('Συνδέστε περισσότερους τρόπους στον ίδιο λογαριασμό, για να μπαίνετε με όποιον σας βολεύει.', 'Connect more methods to the same account, so you can sign in with whichever suits you.') + '</p>' +
      '<div class="linked">' + rows + '</div>' + pw + liNote + clash + '<div class="form-error" data-methods-msg role="status"></div>' +
      mergeSection() +
      '<p style="margin:14px 0 0"><button type="button" class="btn btn-outline btn-sm" data-signout>' + T('Αποσύνδεση', 'Sign out') + '</button></p></div>';
  }
  /* "Do you have a second account here?": sign in to it as well, and it is
     merged into this one (the server moves its application and ways in). */
  function mergeSection() {
    if (!mergeOpen) return '<p style="margin:12px 0 0"><button type="button" class="link-btn" data-merge-open aria-expanded="false">' + T('Έχετε και δεύτερο λογαριασμό εδώ; Ενώστε τους σε έναν', 'Do you have a second account here? Merge them into one') + '</button></p>';
    var btns = A.enabledProviders().map(function (k) {
      return '<button type="button" class="btn btn-outline btn-sm prov-sm" data-merge-with="' + k + '">' + A.icon(k) + T('Με ', 'With ') + esc(A.providerInfo(k).name) + '</button>';
    }).join('');
    return '<div class="merge-box" id="merge"><h3 tabindex="-1">' + T('Ένωση με άλλον λογαριασμό σας', 'Merge with another account of yours') + '</h3>' +
      '<p class="muted">' + T('Αν φτιάξατε κατά λάθος και δεύτερο λογαριασμό (π.χ. μία φορά με Google και μία με LinkedIn), συνδεθείτε εδώ και σε εκείνον. ' +
      'Η αίτηση μέλους, οι συνδρομές και οι τρόποι σύνδεσής του μεταφέρονται σε αυτόν τον λογαριασμό' + (user.email ? ' (' + esc(user.email) + ')' : '') + ' και ο άλλος διαγράφεται.',
        'If you created a second account by mistake (for example once with Google and once with LinkedIn), sign in to that one here as well. ' +
        'Its membership application, fees and sign-in methods move to this account' + (user.email ? ' (' + esc(user.email) + ')' : '') + ' and the other one is deleted.') + '</p>' +
      '<p class="muted" style="margin:0 0 8px"><strong>' + T('Συνδεθείτε στον άλλο λογαριασμό:', 'Sign in to the other account:') + '</strong></p>' +
      '<div class="section-foot" style="margin:0 0 12px">' + btns + '</div>' +
      '<form class="form sub-form" data-merge-pw novalidate><p class="muted" style="margin:0 0 8px">' + T('…ή με το e-mail και τον κωδικό του:', '…or with its e-mail address and password:') + '</p>' +
      '<div class="field"><label for="merge-email">' + T('E-mail του άλλου λογαριασμού', 'E-mail of the other account') + '</label><input id="merge-email" name="merge-email" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false"></div>' +
      '<div class="field"><label for="merge-pass">' + T('Κωδικός του άλλου λογαριασμού', 'Password of the other account') + '</label><input id="merge-pass" name="merge-pass" type="password" autocomplete="off"></div>' +
      '<div class="section-foot" style="margin:0"><button type="submit" class="btn btn-dark btn-sm">' + T('Σύνδεση και ένωση', 'Sign in and merge') + '</button><button type="button" class="btn btn-outline btn-sm" data-merge-cancel>' + T('Ακύρωση', 'Cancel') + '</button></div></form>' +
      '<div class="form-error" data-merge-msg role="status"></div></div>';
  }
  /* one method only: say so at the top, name the others, and offer them */
  var PROMPT_KEY = 'semfe:no-method-prompt:';
  function addMethodPrompt() {
    if (!user || linkNeedsVerifiedEmail() || linked.length !== 1) return '';
    try { if (localStorage.getItem(PROMPT_KEY + user.uid)) return ''; } catch (e) {}
    var missing = available().filter(function (k) { return linked.indexOf(k) === -1; });
    if (!missing.length) return '';
    var list = L.orList(missing.map(methodName));
    return '<div class="notice info add-method" style="margin-top:18px"><strong>' + T('Προσθέστε κι άλλον τρόπο σύνδεσης', 'Add another sign-in method') + '</strong>' +
      '<p>' + T('Μπαίνετε μόνο με ' + esc(methodName(linked[0])) + '. Συνδέστε και ' + esc(list) + ', ώστε να μπαίνετε με όποιον σας βολεύει και να μη χάσετε την πρόσβαση αν ξεχάσετε έναν.',
        'You sign in only with ' + esc(methodName(linked[0])) + '. Connect ' + esc(list) + ' as well, so you can sign in with whichever suits you and do not lose access if you forget one.') + '</p>' +
      '<p class="section-foot" style="margin:10px 0 0">' + missing.map(function (k) {
        return '<button type="button" class="btn btn-dark btn-sm" data-prompt="' + k + '">' + (k === 'password' ? T('Ορισμός κωδικού', 'Set a password') : T('Σύνδεση ', 'Connect ') + esc(methodName(k))) + '</button>';
      }).join('') + '<button type="button" class="btn btn-outline btn-sm" data-prompt-hide>' + T('Όχι τώρα', 'Not now') + '</button></p></div>';
  }

  function dangerPanel() {
    // decided by what reauth() can use: a popup provider, else the password
    // (a LinkedIn connected through the Cloud Function is only a claim, not a way to re-prove)
    var pd = A.providers(user);
    var pwOnly = pd.indexOf('password') !== -1 && pd.every(function (k) { return k === 'password'; });
    return '<div class="panel" id="delete"><h2 tabindex="-1">' + T('Διαγραφή λογαριασμού', 'Delete account') + '</h2>' +
      '<p class="muted intro">' + T('Διαγράφει οριστικά τον λογαριασμό σας, την αίτηση μέλους και την καταχώρισή σας στον κατάλογο.', 'Permanently deletes your account, your membership application and your entry in the directory.') + '</p>' +
      '<div data-del-box hidden class="form" style="margin-bottom:12px">' +
      '<div class="field"><label for="del-confirm">' + T('Γράψτε <strong>ΔΙΑΓΡΑΦΗ</strong> για επιβεβαίωση', 'Type <strong>DELETE</strong> to confirm') + '</label><input id="del-confirm" autocomplete="off" autocapitalize="characters"></div>' +
      (pwOnly ? '<div class="field"><label for="del-pass">' + T('Ο κωδικός σας', 'Your password') + '</label><input id="del-pass" type="password" autocomplete="current-password"></div>' : '') +
      '<div class="form-error" data-del-msg role="alert"></div>' +
      '<button type="button" class="btn btn-danger" data-del-go>' + T('Οριστική διαγραφή', 'Delete permanently') + '</button></div>' +
      '<button type="button" class="btn btn-danger btn-sm" data-del-open>' + T('Διαγραφή λογαριασμού', 'Delete account') + '</button></div>';
  }

  /* reload the user and refresh the ID token, so the rules (and the LinkedIn
     function) see email_verified; msgEl gets the outcome */
  function checkVerified(msgEl, focusAfter) {
    user.reload().then(function () { return user.getIdToken(true); }).then(function () {
      user = firebase.auth().currentUser;
      if (user.emailVerified) { formErr = ''; refocus = focusAfter; render(); A.flash(T('Το e-mail σας επιβεβαιώθηκε.', 'Your e-mail address is confirmed.')); }
      else if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = T('Δεν έχει επιβεβαιωθεί ακόμα. Πατήστε τον σύνδεσμο στο e-mail και δοκιμάστε ξανά.', 'It is not confirmed yet. Press the link in the e-mail and try again.'); }
    }, function (err) { if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = A.friendly(err); } });
  }
  function sendVerify(msgEl) {
    user.sendEmailVerification({ url: location.href.split('#')[0] }).then(function () {
      if (msgEl) { msgEl.className = 'form-ok'; msgEl.textContent = T('Σας στείλαμε e-mail επιβεβαίωσης στο ' + user.email + '.', 'We sent a confirmation e-mail to ' + user.email + '.'); }
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
    on('form[data-alerts]', 'submit', function (e) { e.preventDefault(); saveAlerts(e.target); });
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || !pw) { msg.className = 'form-error'; msg.textContent = T('Γράψτε το e-mail και τον κωδικό του ΑΛΛΟΥ λογαριασμού σας.', 'Type the e-mail address and password of your OTHER account.'); return; }
      runMerge({ email: em, password: pw }, f.querySelector('[type=submit]'), msg);
    });
    on('[data-reset]', 'click', function () {
      var msg = q('[data-methods-msg]');
      firebase.auth().sendPasswordResetEmail(user.email).then(function () {
        msg.className = 'form-ok'; msg.textContent = T('Σας στείλαμε e-mail με σύνδεσμο για νέο κωδικό.', 'We sent you an e-mail with a link to set a new password.');
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
    if (!d.firstName) return bad('firstName', T('Γράψτε το όνομά σας.', 'Please type your first name.'));
    if (!d.lastName) return bad('lastName', T('Γράψτε το επώνυμό σας.', 'Please type your last name.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return bad('email', T('Γράψτε μια έγκυρη διεύθυνση e-mail.', 'Please type a valid e-mail address.'));
    if (!d.stage) return bad('stage', T('Επιλέξτε την ιδιότητά σας.', 'Please choose your role.'));
    var yearOk = function (x) { return x === null || (x >= 1950 && x <= YEAR + 1); };
    if (!yearOk(d.entryYear)) return bad('entryYear', T('Το έτος εισαγωγής δεν φαίνεται σωστό.', 'The year of entry does not look right.'));
    if (!yearOk(d.gradYear)) return bad('gradYear', T('Το έτος αποφοίτησης δεν φαίνεται σωστό.', 'The year of graduation does not look right.'));
    if (d.entryYear && d.gradYear && d.gradYear < d.entryYear) return bad('gradYear', T('Το έτος αποφοίτησης είναι πριν από το έτος εισαγωγής.', 'The year of graduation is before the year of entry.'));
    if (d.linkedin) {
      if (!/^https?:\/\//i.test(d.linkedin)) d.linkedin = 'https://' + d.linkedin;
      if (!/^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(d.linkedin.replace(/^http:/i, 'https:'))) return bad('linkedin', T('Γράψτε τη διεύθυνση του προφίλ σας στο LinkedIn (linkedin.com/in/…).', 'Please type the address of your LinkedIn profile (linkedin.com/in/…).'));
      d.linkedin = d.linkedin.replace(/^http:/i, 'https:');
    }
    if (!d.acceptedPrivacy) return bad('acceptedPrivacy', T('Για να υποβάλετε αίτηση, επιβεβαιώστε ότι διαβάσατε την πολιτική απορρήτου.', 'To submit an application, please confirm that you have read the privacy policy.'));
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
      A.flash(wasNew ? T('Η αίτησή σας υποβλήθηκε. Ευχαριστούμε!', 'Your application has been submitted. Thank you!') : T('Τα στοιχεία σας αποθηκεύτηκαν.', 'Your details have been saved.'));
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
      dirMsg = { cls: 'form-ok', text: want ? T('Εμφανίζεστε στον κατάλογο μελών.', 'You are listed in the members\' directory.') : T('Αφαιρεθήκατε από τον κατάλογο μελών.', 'You have been removed from the members\' directory.') };
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
        A.flash(T('Το ' + A.providerInfo(k).name + ' συνδέθηκε με τον λογαριασμό σας.', A.providerInfo(k).name + ' is now connected to your account.'));
      });
    }, function (err) {
      if (b) { b.disabled = false; try { b.focus(); } catch (e) {} }     // disabling it had dropped keyboard focus
      if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request' || err.code === 'auth/user-cancelled')) return;
      if (err && TAKEN.indexOf(err.code) !== -1) {
        var name = A.providerInfo(k).name;
        A.prepareMerge();                        // the merge button below will open a popup: be ready for it
        conflict = { provider: k, credential: err.credential || null,
          title: T('Αυτό το ' + name + ' ανοίγει ήδη άλλον λογαριασμό εδώ', 'This ' + name + ' account already signs in to another account here'),
          text: T('Μάλλον τον φτιάξατε κι εσείς, σε άλλη επίσκεψη. Μπορείτε να ενώσετε τους δύο λογαριασμούς σε αυτόν: η αίτηση μέλους και οι τρόποι σύνδεσης του άλλου μεταφέρονται εδώ, και ο άλλος διαγράφεται.',
            'You probably created it yourself on another visit. You can merge the two accounts into this one: the other account\'s membership application and sign-in methods move here, and the other account is deleted.') };
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
    if (a.length < 8) { msg.textContent = T('Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.', 'The password needs at least 8 characters.'); f.elements['pw-new'].focus(); return; }
    if (a !== b) { msg.textContent = T('Οι δύο κωδικοί δεν είναι ίδιοι.', 'The two passwords are not the same.'); f.elements['pw-new2'].focus(); return; }
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
        A.flash(T('Ορίστηκε κωδικός. Μπορείτε πλέον να μπαίνετε και με το ' + user.email + ' και αυτόν τον κωδικό.', 'Your password is set. You can now also sign in with ' + user.email + ' and this password.'));
      });
    }, function (err) {
      btn.disabled = false;
      if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) { msg.textContent = T('Ακυρώθηκε.', 'Cancelled.'); return; }
      if (err && TAKEN.indexOf(err.code) !== -1) {
        pwOpen = false; pwBox = null;
        conflict = { provider: 'password', title: T('Υπάρχει ήδη άλλος λογαριασμός με το ' + user.email, 'There is already another account with ' + user.email),
          text: T('Μάλλον τον φτιάξατε κι εσείς με e-mail και κωδικό. Μπορείτε να ενώσετε τους δύο λογαριασμούς: πατήστε το κουμπί και γράψτε τον κωδικό ΕΚΕΙΝΟΥ του λογαριασμού.',
            'You probably created it yourself with an e-mail address and password. You can merge the two accounts: press the button and type the password of THAT account.') };
        refocus = '[data-merge-conflict]'; render(); return;
      }
      msg.textContent = A.friendly(err);
    });
  }
  /* sign in to the other account (auth.js keeps this page's session as it is),
     then the server merges it into this one */
  function runMerge(how, btn, msg) {
    if (btn) btn.disabled = true;
    if (msg) { msg.className = 'form-ok'; msg.textContent = T('Ένωση λογαριασμών…', 'Merging the accounts…'); }
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
      if (err && err.code === 'semfe/merge-cancelled') { if (msg) { msg.className = 'form-ok'; msg.textContent = T('Η ένωση ακυρώθηκε: δεν άλλαξε τίποτα.', 'The merge was cancelled: nothing has changed.'); } return; }
      if (msg) { msg.className = 'form-error'; msg.textContent = A.friendly(err); }
    });
  }

  function deleteAccount() {
    var q = function (s) { return app.querySelector(s); };
    var msg = q('[data-del-msg]'), btn = q('[data-del-go]');
    // «διαγραφή», «Διαγραφή» and «ΔΙΑΓΡΑΦΗ» all count (accents are dropped before comparing)
    var typed = q('#del-confirm').value.trim();
    if (typed.normalize) typed = typed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // (on the English page "delete", in any case, counts too)
    var word = typed.toUpperCase();
    if (word !== 'ΔΙΑΓΡΑΦΗ' && !(L.en && word === 'DELETE')) { msg.textContent = T('Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.', 'Type DELETE to confirm.'); return; }
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
      return db.collection('alertPrefs').doc(user.uid).delete().catch(function () {});
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
      if (A.forgetNotes) A.forgetNotes();
      html('<div class="notice ok" tabindex="-1" id="deleted-msg"><strong>' + T('Ο λογαριασμός σας διαγράφηκε.', 'Your account has been deleted.') + '</strong><p>' +
        T('Διαγράψαμε τον λογαριασμό σύνδεσης, την αίτηση μέλους, την καταχώρισή σας στον κατάλογο και τις ειδοποιήσεις με e-mail.',
          'We deleted your sign-in account, your membership application, your entry in the directory and your e-mail alerts.') + '</p></div>');
      var d = document.getElementById('deleted-msg'); if (d) d.focus();
    }).catch(function (e) {
      deleted = false;
      btn.disabled = false;
      if (e && e.code === 'semfe/delete-half') {
        // the application and the directory card are gone, the sign-in is not
        msg.textContent = T('Η αίτηση μέλους και η καταχώριση στον κατάλογο διαγράφηκαν, αλλά ο λογαριασμός σύνδεσης όχι ακόμα (' +
          A.friendly(e.cause) + '). Πατήστε ξανά «Διαγραφή» για να ολοκληρωθεί.',
          'Your membership application and directory entry were deleted, but your sign-in account not yet (' +
          A.friendly(e.cause) + '). Press “Delete permanently” again to finish.');
        return;
      }
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request' || e.code === 'auth/user-cancelled')) { msg.textContent = T('Η διαγραφή ακυρώθηκε.', 'The deletion was cancelled.'); return; }
      msg.textContent = A.friendly(e);
    });
  }
})();
