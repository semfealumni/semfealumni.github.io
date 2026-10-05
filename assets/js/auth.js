/* SEMFE Alumni: sign-in and registration (Firebase Authentication).
 *
 * Providers it can offer: Google, Facebook, LinkedIn (OpenID Connect) and
 * e-mail + password; AUTH_PROVIDERS in config.js picks which (Facebook is
 * left out for now). Loads the Firebase "compat" SDK from gstatic only when
 * config.js holds a real Firebase config; until then the header's
 * "Σύνδεση" button opens the same dialog with the buttons switched off and a
 * note that registration opens soon, so the page never breaks.
 *
 * Why popups, not redirects: the site (semfealumni.gr) and Firebase's auth
 * handler (<project>.firebaseapp.com) are different domains, and Safari,
 * Firefox and Chrome now partition third-party storage, which breaks
 * signInWithRedirect for exactly this setup. signInWithPopup works in all of
 * them, provided it is called straight from the click (no await before it),
 * which is why the SDK is loaded as soon as the page is idle.
 *
 * Accounts that share an e-mail: with Firebase's default "one account per
 * e-mail address", signing in with a second provider for an address that
 * already has an account fails with auth/account-exists-with-different-
 * credential. We keep that credential, ask the person to sign in the way
 * they did the first time, and then link it, so they end up with ONE
 * account that opens with either provider.
 *
 * A new e-mail + password account must CONFIRM its address before it can use
 * the site (owner, 2026-10-05, as on operationsacademia.org). Registering sends
 * Firebase's verification e-mail; until its link is pressed the account is
 * PENDING: Firebase keeps the session (so «Στείλτε μου ξανά το e-mail» and
 * «Το επιβεβαίωσα» work), but the site treats it as signed out. user() is null,
 * every onChange listener hears null, no header hint is written, the header
 * shows «Επιβεβαίωση e-mail», and the dialog shows the «Επιβεβαιώστε το e-mail
 * σας» card instead of the sign-in form. Google and LinkedIn vouch for the
 * address, so only an account whose ONLY way in is the password is held:
 * needsVerification() below, the same test as emailConfirmed() in
 * firestore.rules, which refuses such an account's application anyway.
 *
 * Public API (window.SemfeAuth), used by account.js / members.js / admin.js:
 *   configured            true when config.js has a real Firebase config
 *   onChange(fn)          fn(user|null) now (once known) and on every change
 *                         (null also for a PENDING account, see above)
 *   pending()             {email} while a pending account is signed in, else null
 *   open(mode, trigger?)  open the dialog: 'signin' | 'register'; focus returns to trigger
 *   signOut()
 *   db()                  Promise<firestore> (loads Firestore on first use)
 *   isAdmin(user)         true for a verified address in ADMIN_EMAILS
 *   providers(user)       ['google','facebook','linkedin','password'] linked
 *   link(key)             Promise: link another provider to this account
 *   reauth(user)          Promise: re-prove identity (before deleting)
 *   callFunction(name, body)  Promise<json>: one of the site's Cloud Functions, as the signed-in person
 *   friendly(err, lang?)  message for a Firebase error, in the page's language, or in
 *                         lang ('el' | 'en'): the Greek-only LinkedIn return page
 *                         answers in the language the sign-in began in (so do
 *                         mergeSummary(report, lang?), methodsText(extra, except, lang?)
 *                         and safeReturn(url, lang?))
 *   root                  relative path back to the site root: for FILES, and for a
 *                         page with no English copy (auth/linkedin/)
 *   home                  the root for PAGES: root on a Greek page, root + 'en/' on an
 *                         English one (SEMFE_I18N.home); every link to a page uses it
 *
 * Every message is written in both languages side by side, T(greek, english)
 * (assets/js/i18n.js, which loads before this file). linkedinStart() saves the
 * page's language with its state (sessionStorage 'semfe:li', key lang), so
 * auth/linkedin/ can answer in it and send the member back to pages in it.
 */
(function () {
  'use strict';
  var L = window.SEMFE_I18N, T = L.t;
  var C = window.SEMFE || {};
  var U = window.SEMFE_UTIL || {};
  var FB = C.FIREBASE || {};
  var VERSION = C.FIREBASE_SDK || '12.19.0';
  var configured = !!(U.firebaseConfigured && U.firebaseConfigured());
  var HINT_KEY = 'semfe:auth-hint';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* the relative way back to the site root, read from the stylesheet link */
  var root = (function () {
    var l = $('link[href$="assets/css/site.css"]');
    return l ? l.getAttribute('href').replace(/assets\/css\/site\.css$/, '') : './';
  })();
  /* the page's language (SEMFE_I18N), or the other one when a caller names it:
     auth/linkedin/ exists only in Greek and speaks the language the sign-in
     began in. The same t(), orList() and home as SEMFE_I18N. */
  function speak(lang) {
    if ((lang !== 'el' && lang !== 'en') || lang === L.lang) return L;
    var en = lang === 'en';
    return { lang: lang, en: en, home: root + (en ? 'en/' : ''),
      t: function (el, eng) { return en ? eng : el; },
      orList: function (names) {
        return names.length < 2 ? (names[0] || '') : names.slice(0, -1).join(', ') + (en ? ' or ' : ' ή ') + names[names.length - 1];
      } };
  }
  /* an English sentence starts with a capital ("This sign-in method was…") */
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---- provider buttons -------------------------------------------------- */
  var ICONS = {
    google: '<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>',
    password: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>'
  };
  var LI = C.LINKEDIN || {};
  var LINKEDIN_ID = LI.providerId || 'oidc.linkedin';
  var LI_FUNCTION = LI.mode !== 'oidc';
  var liReady = !LI_FUNCTION || !!(LI.clientId && LI.functionUrl && String(LI.clientId + LI.functionUrl).indexOf('PASTE_') === -1);
  var LI_STATE = 'semfe:li';
  var PROVIDERS = {
    google: { name: 'Google', id: 'google.com', cls: 'google', make: function () {
      var p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; } },
    facebook: { name: 'Facebook', id: 'facebook.com', cls: 'facebook', make: function () {
      var p = new firebase.auth.FacebookAuthProvider(); p.addScope('email'); return p; } },
    linkedin: { name: 'LinkedIn', id: LINKEDIN_ID, cls: 'linkedin', make: function () {
      var p = new firebase.auth.OAuthProvider(LINKEDIN_ID); p.addScope('openid'); p.addScope('profile'); p.addScope('email'); return p; } }
  };
  // a provider is offered only when it is listed AND (for LinkedIn) its settings are filled in
  // (while Firebase itself is not configured every listed button shows, switched off, as a preview)
  var enabled = (C.AUTH_PROVIDERS || []).filter(function (k) { return PROVIDERS[k] && (k !== 'linkedin' || liReady || !configured); });
  /* "Google ή LinkedIn" (with extra: "Google, LinkedIn ή e-mail"; except
     leaves one button out): the buttons above, for every sentence that names
     them, in the page's language ("Google, LinkedIn or e-mail" on an English
     page) or in lang. Never type the list by hand (tools/check.mjs fails on
     one); tools/build.mjs writes the same list into the static pages. */
  function methodsText(extra, except, lang) {
    var n = enabled.filter(function (k) { return k !== except; }).map(function (k) { return PROVIDERS[k].name; });
    if (extra) n.push(extra);
    return speak(lang).orList(n);
  }
  function keyForProviderId(id) {
    if (id === 'password') return 'password';
    for (var k in PROVIDERS) if (PROVIDERS[k].id === id) return k;
    return null;
  }

  /* ---- state ------------------------------------------------------------- */
  var auth = null, fs = null, sdkReady = false, authKnown = false, current = null;
  var listeners = [], pendingLink = null, dialog = null, lastFocus = null, lastFocusSel = '', mode = 'signin';
  var signingOut = false, sdkFailed = false;
  var SIGNOUT_KEY = 'semfe:signout';          // "Αποσύνδεση" pressed; auth.signOut() not confirmed yet
  /* the pending account (see the top of this file): its Firebase user, and a
     note in this browser so the next page paints «Επιβεβαίωση e-mail» at once */
  var pendingUser = null, PENDING_KEY = 'semfe:auth-pending', autoOpened = false;
  var FAIL_MSG = T('Δεν ήταν δυνατή η φόρτωση της υπηρεσίας σύνδεσης. Ελέγξτε τη σύνδεσή σας στο διαδίκτυο και ανανεώστε τη σελίδα.',
    'The sign-in service could not be loaded. Check your internet connection and reload the page.');

  /* ---- loading the SDK --------------------------------------------------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  var base = 'https://www.gstatic.com/firebasejs/' + VERSION + '/';
  var sdkPromise = null;
  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = (window.firebase && window.firebase.auth ? Promise.resolve() :
      loadScript(base + 'firebase-app-compat.js').then(function () { return loadScript(base + 'firebase-auth-compat.js'); }))
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(FB);
        auth = firebase.auth();
        auth.languageCode = L.lang;        // Firebase's e-mails and Google's consent screen in the page's language
        sdkReady = true;
        setBusy(false);
        auth.onAuthStateChanged(function (u) {
          // "Αποσύνδεση" pressed before the SDK had loaded: do not bring the
          // restored session back on screen, auth.signOut() is on its way
          if (u && signingOut) return;
          // a registration fires this BEFORE the name is saved and the
          // verification e-mail sent: the page hears about the new account
          // once both are done (settle(), from emailSubmit)
          if (u && registering) { authKnown = true; return; }
          settle(u);
        });
      });
    sdkPromise.catch(function () {
      sdkFailed = true;
      authKnown = true; paintHeader();
      showStatus(FAIL_MSG, 'err');
      listeners.forEach(function (fn) { try { fn(null); } catch (e) {} });
    });
    return sdkPromise;
  }
  var registering = false;
  /* an account whose only way in is e-mail + password, and whose address is
     not confirmed yet. KEEP IN STEP with emailConfirmed() in firestore.rules
     (Google, Facebook and LinkedIn vouch for the address) and with
     linkNeedsVerifiedEmail() in account.js (which covers the other providers). */
  function needsVerification(u) {
    if (!u || u.emailVerified || !u.email) return false;
    var pd = u.providerData || [];
    return pd.length > 0 && pd.every(function (p) { return p.providerId === 'password'; });
  }
  function settle(u) {
    if (u && needsVerification(u)) return enterPending(u);
    pendingUser = null; clearPending(); watchVerify(false);
    current = u; authKnown = true;
    if (u) freshToken(u).catch(function () {});
    // signed in some other way (another tab, a LinkedIn return): the dialog has nothing left to do
    if (u && dialog && !dialog.hidden && !pendingLink) close();
    // signed out elsewhere while the verification card was open: it becomes the sign-in form
    if (!u && dialog && !dialog.hidden && mode === 'verify') setMode('signin');
    if (u) saveHint(u); else clearHint();
    paintHeader();
    listeners.forEach(function (fn) { try { fn(u); } catch (e) { if (window.console) console.error(e); } });
  }
  /* The SDK refreshes the USER record when a page loads (so emailVerified can
     turn true) but keeps the cached ID TOKEN, which may still say
     email_verified:false for up to an hour: the rules and the Cloud Functions
     read the token, and would refuse a member who has just confirmed their
     address. Fetch a new token in that case (and only then). */
  function freshToken(u) {
    u = u || current;
    if (!u || !u.getIdTokenResult) return Promise.resolve(null);
    return u.getIdTokenResult().then(function (r) {
      if (u.emailVerified && !(r && r.claims && r.claims.email_verified === true)) return u.getIdToken(true);
      return r && r.token;
    });
  }

  /* ---- an account that has not confirmed its e-mail yet ---------------- */
  // what the card says: 'sent' (just now, from here), 'failed' (the e-mail at
  // registration did not go), null (sent when the account was made, some time ago)
  var verifyState = null, verifyErr = null, lastSend = 0, checking = false, watchTimer = null, resendTimer = null;
  var RESEND_GAP = 60e3, WATCH_EVERY = 10e3, WATCH_FOR = 15 * 60e3;
  function pendingHint() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { return null; } }
  function savePending(u) { try { localStorage.setItem(PENDING_KEY, JSON.stringify({ e: u.email || '', u: u.uid })); } catch (e) {} }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }
  function pendingEmail() { return pendingUser ? pendingUser.email || '' : ((pendingHint() || {}).e || ''); }
  function verifySettings() { return { url: absolute(L.home + 'account/') }; }
  function enterPending(u) {
    var first = !pendingUser;
    pendingUser = u; current = null; authKnown = true;
    clearHint(); savePending(u);
    paintHeader();
    listeners.forEach(function (fn) { try { fn(null); } catch (e) { if (window.console) console.error(e); } });
    if (dialog && !dialog.hidden) {
      // signing in or registering right now: the dialog becomes the card. The
      // typed password goes at once (a shared computer); a waiting link stays
      // for afterSignIn().
      var pw = $('#auth-pass', dialog); if (pw) pw.value = '';
      if (mode !== 'verify') { setMode('verify'); focusVerify(); } else paintVerify();
    } else if (first && !autoOpened && document.body.getAttribute('data-firestore') === '1') {
      // a page that needs an account (account, members, admin, feedback): say why at once
      autoOpened = true;
      open('verify');
    }
  }
  function focusVerify() {
    var l = dialog && $('[data-verify-lede]', dialog);
    if (l) setTimeout(function () { try { l.focus(); } catch (e) {} }, 30);
  }
  function verifyMsg(msg, kind) {
    var el = dialog && $('[data-verify-status]', dialog);
    if (!el) return;
    el.textContent = msg || '';
    el.className = kind === 'ok' ? 'form-ok' : kind === 'err' ? 'form-error' : 'muted';
  }
  /* the button presses need the pending user; the SDK may still be loading
     (the header was painted from the note in this browser) */
  function withPending(fn) {
    if (pendingUser) return fn(pendingUser);
    if (!authKnown || !sdkReady) { verifyMsg(sdkFailed ? FAIL_MSG : T('Μια στιγμή, φορτώνει η υπηρεσία σύνδεσης…', 'One moment, the sign-in service is loading…')); loadSdk(); return; }
    setMode('signin');                         // nobody is signed in after all
  }
  /* reload the account: once the link has been pressed, a fresh token (the
     rules read email_verified from it) and the hold is lifted. silent: the
     periodic check, which says nothing until the answer is yes. */
  function checkVerified(silent) {
    if (!pendingUser || checking) return;
    var u = pendingUser;
    checking = true;
    if (!silent) verifyMsg(T('Έλεγχος…', 'Checking…'));
    u.reload().then(function () {
      var fresh = (auth && auth.currentUser) || u;
      if (fresh.uid !== u.uid) { checking = false; return; }
      if (!fresh.emailVerified) {
        checking = false;
        if (!silent) verifyMsg(T('Δεν έχει επιβεβαιωθεί ακόμα. Πατήστε τον σύνδεσμο στο e-mail και μετά ξανά «Το επιβεβαίωσα».',
          'Not confirmed yet. Press the link in the e-mail, then press “I have confirmed it” again.'), 'err');
        return;
      }
      return fresh.getIdToken(true).then(function () { checking = false; lift(fresh); });
    }).catch(function (e) {
      checking = false;
      if (!silent) verifyMsg(friendly(e), 'err');
    });
  }
  function lift(u) {
    verifyState = null; verifyErr = null;
    settle(u);                                 // the hint, the header, the listeners; closes the dialog
    resetDialog();
    var msg = T('Το e-mail σας επιβεβαιώθηκε. Είστε πλέον συνδεδεμένος/η.', 'Your e-mail address has been confirmed. You are now signed in.');
    // from a public page, on to the membership application (where a new account goes)
    if (document.body.getAttribute('data-firestore') !== '1') {
      try { sessionStorage.setItem('semfe:flash', msg); } catch (e) {}
      location.href = L.home + 'account/#apply';
    } else flash(msg);
  }
  function resendVerify() {
    withPending(function (u) {
      if (Date.now() - lastSend < RESEND_GAP) return;
      var btn = $('[data-verify-resend]', dialog);
      if (btn) btn.disabled = true;
      verifyMsg(T('Αποστολή…', 'Sending…'));
      u.sendEmailVerification(verifySettings()).then(function () {
        verifyState = 'sent'; verifyErr = null; lastSend = Date.now();
        paintVerify();
        verifyMsg(T('Σας στείλαμε νέο e-mail επιβεβαίωσης στο ' + (u.email || '') + '.',
          'We have sent a new confirmation e-mail to ' + (u.email || '') + '.'), 'ok');
      }, function (e) {
        paintVerify();
        verifyMsg(friendly(e), 'err');
      });
    });
  }
  /* while the card is open (and the tab is in front), look every few seconds:
     the link is often pressed on another device, and the card should notice */
  function watchVerify(on) {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    if (!on) return;
    var until = Date.now() + WATCH_FOR;
    watchTimer = setInterval(function () {
      if (Date.now() > until) return watchVerify(false);
      if (document.visibilityState !== 'hidden') checkVerified(true);
    }, WATCH_EVERY);
  }
  function verifyCardOpen() { return !!(pendingUser && dialog && !dialog.hidden && mode === 'verify'); }
  // back from the mail program or another tab: look at once
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && verifyCardOpen()) checkVerified(true); });
  window.addEventListener('focus', function () { if (verifyCardOpen()) checkVerified(true); });
  function paintVerify() {
    if (!dialog) return;
    var e = '<strong>' + esc(pendingEmail()) + '</strong>';
    var why = verifyErr ? ' (' + esc(friendly(verifyErr)) + ')' : '';
    $('[data-verify-lede]', dialog).innerHTML = verifyState === 'sent'
      ? T('Σας στείλαμε e-mail στο ' + e + '. Πατήστε τον σύνδεσμο που περιέχει για να επιβεβαιώσετε τη διεύθυνσή σας. Μόνο τότε ολοκληρώνεται η σύνδεση.',
        'We have sent an e-mail to ' + e + '. Press the link in it to confirm your address. Only then is signing in complete.')
      : verifyState === 'failed'
      ? T('Ο λογαριασμός σας δημιουργήθηκε, αλλά το e-mail επιβεβαίωσης δεν στάλθηκε στο ' + e + why + '. Πατήστε «Στείλτε μου ξανά το e-mail».',
        'Your account was created, but the confirmation e-mail could not be sent to ' + e + why + '. Press “Send me the e-mail again”.')
      : T('Ο λογαριασμός με το ' + e + ' δεν έχει επιβεβαιωθεί ακόμα. Για να συνδεθείτε, πατήστε τον σύνδεσμο στο e-mail επιβεβαίωσης που σας στείλαμε όταν τον δημιουργήσατε, ή ζητήστε νέο.',
        'The account with ' + e + ' has not been confirmed yet. To sign in, press the link in the confirmation e-mail we sent you when you created it, or ask for a new one.');
    var btn = $('[data-verify-resend]', dialog), wait = RESEND_GAP - (Date.now() - lastSend);
    if (resendTimer) { clearTimeout(resendTimer); resendTimer = null; }
    btn.disabled = wait > 0;
    // a second e-mail within a minute is refused anyway (auth/too-many-requests)
    if (wait > 0) resendTimer = setTimeout(function () { resendTimer = null; if (dialog) $('[data-verify-resend]', dialog).disabled = false; }, wait);
  }
  /* "Αποσύνδεση": out of the pending account, and the dialog becomes the
     sign-in form (to register again with the right address, for example) */
  function verifyOut() {
    signOut({ stay: true }).then(function () {
      if (!dialog || dialog.hidden) return;
      setMode('signin');
      setTimeout(function () { try { $('#auth-email', dialog).focus(); } catch (e) {} }, 30);
    }, function (e) { verifyMsg(friendly(e), 'err'); });
  }
  var fsPromise = null;
  function db() {
    if (!configured) return Promise.reject(new Error('not-configured'));
    if (fsPromise) return fsPromise;
    fsPromise = loadSdk().then(function () {
      return window.firebase.firestore ? null : loadScript(base + 'firebase-firestore-compat.js');
    }).then(function () { fs = fs || firebase.firestore(); return fs; });
    return fsPromise;
  }

  /* ---- the site's Cloud Functions ----------------------------------------
     callFunction('accounts', body) is the admin page's list of registered
     accounts and the merging of two accounts of one person (functions/accounts.js);
     callFunction('publishAnnouncement', body) is the editor on blog/
     (functions/announcements.js). Both take the caller's ID token and answer
     JSON. Until a function is deployed the call fails as
     semfe/<name>-unreachable, and the pages say so instead of breaking. */
  var FN_BASE = 'https://' + (C.FUNCTIONS_REGION || 'europe-west1') + '-' + FB.projectId + '.cloudfunctions.net/';
  function callFunction(name, body, idToken) {
    if (!configured) return Promise.reject({ code: 'auth/operation-not-allowed' });
    return loadSdk().then(function () {
      if (idToken) return idToken;
      if (!auth.currentUser) throw { code: 'semfe/relogin' };
      return freshToken(auth.currentUser).then(function () { return auth.currentUser.getIdToken(); });
    }).then(function (tok) {
      return fetch(FN_BASE + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j || {} }; }, function () { return { ok: false, status: r.status, j: {} }; });
        }, function () { throw { code: 'semfe/' + name + '-unreachable' }; });   // not deployed yet (no CORS answer), or offline
    }).then(function (x) {
      if (!x.ok) throw { code: 'semfe/' + (x.j.error || (x.status === 404 ? name + '-unreachable' : 'internal')) };
      return x.j;
    });
  }
  function callAccounts(body, idToken) { return callFunction('accounts', body, idToken); }
  /* Sign in to ANOTHER account without touching this page's session: a second
     Firebase app that keeps nothing (Persistence.NONE), used only to prove the
     person owns that account too. Then the server merges it into this one. */
  var otherApp = null;
  function otherAuth() {
    return loadSdk().then(function () {
      if (!otherApp) otherApp = firebase.initializeApp(FB, 'semfe-merge');
      var a = otherApp.auth();
      a.languageCode = L.lang;
      return a.setPersistence(firebase.auth.Auth.Persistence.NONE).then(function () { return a; });
    });
  }
  /* how: { credential } (from a link that hit "already in use"), { provider: 'google' },
     or { email, password }. Resolves with the server's report. */
  function mergeWith(how) {
    var a = null;
    return otherAuth().then(function (oa) {
      a = oa;
      if (how.credential) return a.signInWithCredential(how.credential);
      if (how.provider && PROVIDERS[how.provider]) return a.signInWithPopup(PROVIDERS[how.provider].make());
      return a.signInWithEmailAndPassword(String(how.email || '').trim(), how.password || '');
    }).then(function (cred) {
      var other = cred && cred.user ? cred.user : a.currentUser;
      if (!other) throw { code: 'semfe/relogin' };
      if (current && other.uid === current.uid) throw { code: 'semfe/same-account' };
      // the chooser may have signed in to an account the person did not mean:
      // say which one will be merged away, and let them stop
      var name = other.email || other.displayName || '';
      if (!window.confirm(T('Ο λογαριασμός ' + (name || 'τον άλλο λογαριασμό') + ' θα ενωθεί σε αυτόν και μετά θα διαγραφεί: η αίτηση μέλους και οι τρόποι σύνδεσής του έρχονται εδώ.\n\nΣυνέχεια;',
        (name ? 'The account ' + name : 'The other account') + ' will be merged into this one and then deleted: its membership application and its sign-in methods move here.\n\nContinue?'))) throw { code: 'semfe/merge-cancelled' };
      return other.getIdToken(true).then(function (tok) { return callAccounts({ action: 'mergeSelf', otherIdToken: tok }); });
    }).then(function (j) {
      return (a ? a.signOut() : Promise.resolve()).catch(function () {}).then(function () {
        // this account now holds more: a fresh user record (new sign-in methods) and token (the li claim)
        return auth.currentUser ? auth.currentUser.reload().then(function () { return auth.currentUser.getIdToken(true); }) : null;
      }).then(function () { return j.report || {}; });
    }, function (e) {
      if (a) a.signOut().catch(function () {});
      throw e;
    });
  }
  /* one sentence on what a merge did (the server's report) */
  function mergeSummary(r, lang) {
    var T = speak(lang).t;
    r = r || {};
    if (r.partial) {
      var back = (r.notMoved || []).filter(function (x) { return /^link-failed/.test(x.why); })
        .map(function (x) { return PROVIDERS[x.method] ? PROVIDERS[x.method].name : x.method; });
      return T('Η ένωση έγινε μόνο εν μέρει: ' + (back.join(' και ') || 'ένας τρόπος σύνδεσης') +
        ' δεν μπόρεσε να μεταφερθεί, οπότε ο άλλος λογαριασμός κρατήθηκε για να μη χαθεί. Δοκιμάστε ξανά σε λίγο ή γράψτε μας.',
        'The merge was only partly done: ' + (back.join(' and ') || 'one sign-in method') +
        ' could not be moved, so the other account was kept and nothing is lost. Please try again shortly or write to us.');
    }
    var s = T('Οι δύο λογαριασμοί ενώθηκαν σε αυτόν.', 'The two accounts have been merged into this one.');
    if (r.application === 'moved') s += T(' Η αίτηση μέλους του άλλου λογαριασμού μεταφέρθηκε εδώ.', ' The other account\'s membership application has been moved here.');
    else if (r.application === 'merged') s += T(' Οι δύο αιτήσεις μέλους έγιναν μία.', ' The two membership applications have become one.');
    var moved = (r.moved || []).map(function (k) { return PROVIDERS[k] ? PROVIDERS[k].name : k; });
    if (moved.length) s += T(' Μπαίνετε πλέον εδώ και με ' + moved.join(' και ') + '.', ' You can now also sign in here with ' + moved.join(' and ') + '.');
    if ((r.notMoved || []).some(function (x) { return x.method === 'password'; }))
      s += T(' Ο κωδικός του άλλου λογαριασμού δεν μεταφέρεται· αν θέλετε, ορίστε κωδικό εδώ, στους «Τρόπους σύνδεσης».',
        ' The other account\'s password does not move over; if you wish, set a password here, under Sign-in methods.');
    return s;
  }

  /* ---- what the account menu shows beside its links -----------------------
     Counts the pages learn anyway (the admin page: applications waiting; the
     account page: the application's status and how many ways in), kept per
     account in this browser, so the menu costs no reads of its own. */
  var MENU_KEY = 'semfe:menu:';
  function menuInfo(uid) { try { return JSON.parse(localStorage.getItem(MENU_KEY + uid) || '{}') || {}; } catch (e) { return {}; } }
  function noteMenu(patch) {
    var u = current;
    if (!u || !patch) return;
    var o = menuInfo(u.uid), changed = false;
    for (var k in patch) if (o[k] !== patch[k]) { o[k] = patch[k]; changed = true; }
    if (!changed) return;
    try { localStorage.setItem(MENU_KEY + u.uid, JSON.stringify(o)); } catch (e) {}
    var open = !!($('#acct-menu') && !$('#acct-menu').hidden);
    if (!open) paintHeader();                             // never redraw a menu someone is using
  }

  /* ---- header ------------------------------------------------------------ */
  function hint() { try { return JSON.parse(localStorage.getItem(HINT_KEY) || 'null'); } catch (e) { return null; } }
  function saveHint(u) { try { localStorage.setItem(HINT_KEY, JSON.stringify({ n: displayName(u), p: u.photoURL || '', e: u.email || '' })); } catch (e) {} }
  function clearHint() { try { localStorage.removeItem(HINT_KEY); } catch (e) {} }
  function displayName(u) {
    if (!u) return '';
    return u.displayName || (u.email ? u.email.split('@')[0] : T('Λογαριασμός', 'Account'));
  }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function avatarHtml(name, photo, cls) {
    // only a plain https URL: a quote, bracket or backslash could break out of the CSS url()
    var safe = /^https:\/\/[^\s"'()\\<>]+$/.test(photo || '') ? photo : '';
    return '<span class="avatar' + (cls ? ' ' + cls : '') + '"' +
      (safe ? ' style="background-image:url(&quot;' + esc(safe) + '&quot;)"' : '') + ' aria-hidden="true">' + (safe ? '' : esc(initials(name))) + '</span>';
  }
  function paintHeader() {
    var slot = $('#acct-slot');
    if (!slot) return;
    // the button being replaced may hold the keyboard focus: give it to its successor
    var had = slot.contains(document.activeElement) && !($('#acct-menu', slot) && !$('#acct-menu', slot).hidden);
    paintSlot(slot);
    if (had) { var f = $('.acct-chip, [data-signin], [data-verify-open]', slot); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
  }
  function paintSlot(slot) {
    var u = current, h = !authKnown && configured ? hint() : null;
    // a pending account (or this browser's note of one, before the SDK has answered)
    if (!u && (pendingUser || (!h && !authKnown && configured && pendingHint()))) {
      slot.innerHTML = '<button type="button" class="btn btn-primary btn-sm acct-signin acct-verify" data-verify-open title="' +
        T('Επιβεβαιώστε το e-mail σας για να ολοκληρωθεί η σύνδεση', 'Confirm your e-mail to finish signing in') + '">' +
        svg('mail') + '<span class="tx">' + T('Επιβεβαίωση e-mail', 'Confirm e-mail') + '</span></button>';
      $('[data-verify-open]', slot).addEventListener('click', function (e) { open('verify', e.currentTarget); });
      return;
    }
    if (!u && !h) {
      slot.innerHTML = '<a class="btn btn-primary btn-sm acct-signin" href="' + L.home + 'account/" data-signin>' + T('Σύνδεση', 'Sign in') + '</a>';
      $('[data-signin]', slot).addEventListener('click', function (e) { e.preventDefault(); open('signin', e.currentTarget); });
      return;
    }
    var name = u ? displayName(u) : h.n, photo = u ? (u.photoURL || '') : h.p, email = u ? (u.email || '') : h.e;
    var admin = u && isAdmin(u), info = u ? menuInfo(u.uid) : {};
    var count = function (n, cls) { return n ? '<span class="count' + (cls ? ' ' + cls : '') + '">' + esc(n) + '</span>' : ''; };
    var APP = { pending: [T('Σε αναμονή', 'Pending'), 'warn'], active: [T('Ενεργή', 'Active'), 'ok'], rejected: [T('Δεν εγκρίθηκε', 'Not approved'), 'err'] }, app = APP[info.app];
    var home = L.home;
    slot.innerHTML = '<div class="acct-menu-wrap">' +
      '<button type="button" class="acct-chip" aria-expanded="false" aria-controls="acct-menu">' +
      avatarHtml(name, photo) + '<span class="nm">' + esc(name) + '</span>' +
      '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="acct-menu" id="acct-menu" hidden>' +
      '<div class="who"><small>' + T('Συνδεδεμένος/η ως', 'Signed in as') + '</small><strong>' + esc(name) + '</strong>' + (email ? '<span>' + esc(email) + '</span>' : '') + '</div>' +
      (admin ? '<a href="' + home + 'admin/">' + svg('shield') + '<span>' + T('Διαχείριση', 'Administration') + '</span>' + count(info.pending, 'warn') + '</a>' : '') +
      '<a href="' + home + 'account/" class="strong">' + svg('user') + '<span>' + T('Ο λογαριασμός μου', 'My account') + '</span></a>' +
      '<a href="' + home + 'account/#apply">' + svg('doc') + '<span>' + T('Η αίτηση μέλους μου', 'My membership application') + '</span>' + (app ? count(app[0], app[1]) : '') + '</a>' +
      '<a href="' + home + 'account/#alerts">' + svg('mail') + '<span>' + T('Ειδοποιήσεις με e-mail', 'E-mail alerts') + '</span></a>' +
      '<a href="' + home + 'members/">' + svg('users') + '<span>' + T('Περιοχή μελών', "Members' area") + '</span></a>' +
      '<a href="' + home + 'account/#methods">' + svg('key') + '<span>' + T('Τρόποι σύνδεσης', 'Sign-in methods') + '</span>' + (info.methods === 1 ? count(T('Προσθήκη', 'Add'), 'warn') : '') + '</a>' +
      '<a href="' + home + 'feedback/">' + svg('chat') + '<span>' + T('Σχόλια και προβλήματα', 'Feedback and problems') + '</span></a>' +
      (admin ? '<a href="' + home + 'admin/#feedback">' + svg('chat') + '<span>' + T('Σχόλια μελών', "Members' feedback") + '</span>' + count(info.fbOpen, 'warn') + '</a>' : '') +
      (admin ? '<a href="' + home + 'whats-new/">' + svg('news') + '<span>' + T('Τι νέο: έγκριση', "What's new: approval") + '</span>' + count(info.newsPending, 'warn') + '</a>' : '') +
      '<hr>' +
      '<button type="button" data-signout class="out">' + svg('out') + '<span>' + T('Αποσύνδεση', 'Sign out') + '</span></button>' +
      '</div></div>';
    var chip = $('.acct-chip', slot);
    chip.addEventListener('click', function (e) { e.stopPropagation(); setMenu($('#acct-menu').hidden); });
    // Tab out of the open menu closes it (only when focus really moved elsewhere)
    $('.acct-menu-wrap', slot).addEventListener('focusout', function (e) {
      if (e.relatedTarget && !U.closest(e.relatedTarget, '.acct-menu-wrap')) setMenu(false);
    });
    $('[data-signout]', slot).addEventListener('click', function () { setMenu(false); signOut(); });
    // a link to this same page (account/#methods from account/) does not
    // navigate away, so close the menu on any link
    $$('#acct-menu a', slot).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  }
  /* the menu is redrawn on every sign-in change, so these page-wide
     listeners are registered once and look the menu up when they fire */
  function setMenu(openIt) {
    var menu = $('#acct-menu'), chip = $('.acct-chip');
    if (!menu || !chip) return;
    menu.hidden = !openIt;
    chip.setAttribute('aria-expanded', openIt ? 'true' : 'false');
  }
  document.addEventListener('click', function (e) {
    var menu = $('#acct-menu');
    if (menu && !menu.hidden && !U.closest(e.target, '.acct-menu-wrap')) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    var menu = $('#acct-menu');
    if ((e.key === 'Escape' || e.key === 'Esc') && menu && !menu.hidden) { setMenu(false); $('.acct-chip').focus(); }
  });
  function svg(k) {
    var p = { user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      users: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15 20a5 5 0 0 1 6-4.6"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
      doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
      key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
      chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
      news: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
      mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>' }[k];
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* ---- the dialog -------------------------------------------------------- */
  var INAPP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|LinkedInApp|MicroMessenger|Line\/|Snapchat|Pinterest|TikTok|musical_ly|Twitter/i.test(navigator.userAgent || '');
  function buildDialog() {
    var wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.hidden = true;
    var formA = '<a href="' + esc(C.legacyApplyFormUrl || '#') + '" target="_blank" rel="noopener">';
    var privacyA = '<a href="' + L.home + 'privacy/">', termsA = '<a href="' + L.home + 'terms/">';
    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">' +
      '<button type="button" class="modal-x" data-close aria-label="' + T('Κλείσιμο', 'Close') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="modal-head"><h2 id="auth-title">' + T('Σύνδεση', 'Sign in') + '</h2><p id="auth-sub">' + T('Για τα μέλη και τους φίλους του Συλλόγου Διπλωματούχων ΣΕΜΦΕ ΕΜΠ.', 'For the members and friends of the SEMFE Alumni Association.') + '</p></div>' +
      '<div class="modal-body">' +
      '<div class="auth-main" data-auth-main>' +
      '<div class="tabs2" role="group" aria-label="' + T('Σύνδεση ή εγγραφή', 'Sign in or register') + '">' +
      '<button type="button" id="tab-signin" aria-pressed="true" data-mode="signin">' + T('Σύνδεση', 'Sign in') + '</button>' +
      '<button type="button" id="tab-register" aria-pressed="false" data-mode="register">' + T('Εγγραφή', 'Register') + '</button></div>' +
      (configured ? '' : '<div class="notice warn" data-offline>' +
        T('<strong>Η σύνδεση μελών ανοίγει σύντομα</strong><p>Μέχρι τότε, μπορείτε να κάνετε αίτηση μέλους μέσω της ' + formA + 'ηλεκτρονικής φόρμας</a>.</p>',
          '<strong>Member sign-in opens soon</strong><p>Until then, you can apply for membership through the ' + formA + 'online form</a>.</p>') + '</div>') +
      (INAPP ? '<div class="notice warn" data-inapp>' +
        T('<strong>Ανοίξτε τη σελίδα στον browser σας</strong><p>Φαίνεται ότι η σελίδα άνοιξε μέσα σε εφαρμογή (π.χ. Facebook, Instagram ή LinkedIn), όπου η σύνδεση με Google δεν επιτρέπεται. Από το μενού της εφαρμογής (⋯) επιλέξτε «Άνοιγμα σε browser» (Safari ή Chrome).</p>',
          '<strong>Open the page in your browser</strong><p>It looks like the page opened inside an app (e.g. Facebook, Instagram or LinkedIn), where signing in with Google is not allowed. From the app\'s menu (⋯) choose “Open in browser” (Safari or Chrome).</p>') +
        '<p><button type="button" class="copy-btn" data-copy-url>' + T('Αντιγραφή συνδέσμου', 'Copy link') + '</button></p></div>' : '') +
      '<div class="notice" data-link-notice hidden></div>' +
      '<div class="providers">' + enabled.map(function (k) {
        var p = PROVIDERS[k];
        return '<button type="button" class="prov ' + p.cls + '" data-provider="' + k + '"' + (configured ? '' : ' disabled') + '>' + ICONS[k] + '<span>' + T('Συνέχεια με ' + p.name, 'Continue with ' + p.name) + '</span></button>';
      }).join('') + '</div>' +
      (enabled.length ? '<div class="or">' + T('ή με e-mail', 'or with e-mail') + '</div>' : '') +
      '<form class="form" novalidate data-email-form>' +
      '<div class="row" data-reg-only hidden>' +
      '<div class="field"><label for="auth-first">' + T('Όνομα', 'First name') + '</label><input id="auth-first" name="first" autocomplete="given-name" maxlength="80"></div>' +
      '<div class="field"><label for="auth-last">' + T('Επώνυμο', 'Last name') + '</label><input id="auth-last" name="last" autocomplete="family-name" maxlength="80"></div></div>' +
      '<div class="field"><label for="auth-email">E-mail</label><input id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="200"></div>' +
      '<div class="field"><label for="auth-pass">' + T('Κωδικός', 'Password') + '</label><div class="pw-wrap"><input id="auth-pass" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128"><button type="button" class="pw-toggle" data-pw aria-pressed="false">' + T('Εμφάνιση', 'Show') + '</button></div>' +
      '<span class="hint" id="auth-pass-hint" data-reg-only hidden>' + T('Τουλάχιστον 8 χαρακτήρες.', 'At least 8 characters.') + '</span></div>' +
      '<div class="form-error" role="alert" id="auth-status" data-status></div>' +
      '<button type="submit" class="btn btn-dark btn-block" data-submit' + (configured ? '' : ' disabled') + '>' + T('Σύνδεση', 'Sign in') + '</button>' +
      '<div style="text-align:center" data-signin-only><button type="button" class="link-btn" data-forgot>' + T('Ξεχάσατε τον κωδικό;', 'Forgot your password?') + '</button></div>' +
      '</form>' +
      '<p class="small" style="margin:0">' + T('Συνεχίζοντας, αποδέχεστε τους ' + termsA + 'Όρους χρήσης</a> και επιβεβαιώνετε ότι διαβάσατε την ' + privacyA + 'Πολιτική απορρήτου</a> του Συλλόγου. Από τον πάροχο που επιλέγετε λαμβάνουμε μόνο το όνομα, το e-mail, τη φωτογραφία σας και ένα αναγνωριστικό του λογαριασμού σας εκεί.',
        'By continuing, you accept the Association\'s ' + termsA + 'Terms of use</a> and confirm that you have read its ' + privacyA + 'Privacy policy</a>. From the provider you choose we receive only your name, e-mail address, photo and an identifier of your account there.') + '</p>' +
      '</div>' +
      // the card of a pending account (an e-mail + password account whose address is not confirmed yet)
      '<div class="verify-box" data-verify hidden>' +
      '<span class="verify-ic" aria-hidden="true">' + svg('mail') + '</span>' +
      '<p data-verify-lede tabindex="-1"></p>' +
      '<p class="muted" style="margin:0">' + T('Δεν το βλέπετε; Κοιτάξτε και στα ανεπιθύμητα (spam) ή στις «Προωθήσεις». Μόλις πατήσετε τον σύνδεσμο, πατήστε εδώ «Το επιβεβαίωσα».',
        'Can\'t see it? Look in your spam folder or under “Promotions” too. Once you have pressed the link, press “I have confirmed it” here.') + '</p>' +
      '<p class="muted" role="status" data-verify-status style="margin:0"></p>' +
      '<button type="button" class="btn btn-dark btn-block" data-verify-check>' + T('Το επιβεβαίωσα', 'I have confirmed it') + '</button>' +
      '<button type="button" class="btn btn-outline btn-block" data-verify-resend>' + T('Στείλτε μου ξανά το e-mail', 'Send me the e-mail again') + '</button>' +
      '<p class="small" style="margin:0;text-align:center"><button type="button" class="link-btn" data-verify-out>' + T('Αποσύνδεση (π.χ. για εγγραφή με άλλο e-mail)', 'Sign out (e.g. to register with another e-mail)') + '</button></p>' +
      '<p class="small" style="margin:0">' + T('Αν το e-mail δεν έρχεται, γράψτε μας στο ', 'If the e-mail does not arrive, write to us at ') + '<a href="mailto:' + esc(C.contactEmail || 'gradsemfe@gmail.com') + '">' + esc(C.contactEmail || 'gradsemfe@gmail.com') + '</a>.</p>' +
      '</div>' +
      '</div></div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    $('[data-close]', wrap).addEventListener('click', close);
    // on the document, not the dialog: a click on plain text inside it moves
    // focus to <body>, and Escape must still close it
    document.addEventListener('keydown', function (e) {
      if (!dialog || dialog.hidden) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); }
      else if (e.key === 'Tab' && U.trapTab) U.trapTab(e, $('.modal', dialog));
    });
    $$('[data-mode]', wrap).forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    $$('[data-provider]', wrap).forEach(function (b) {
      b.addEventListener('click', function () { providerSignIn(b.getAttribute('data-provider'), b); });
    });
    $('[data-email-form]', wrap).addEventListener('submit', function (e) { e.preventDefault(); emailSubmit(); });
    $('[data-forgot]', wrap).addEventListener('click', forgot);
    $('[data-verify-check]', wrap).addEventListener('click', function () { withPending(function () { checkVerified(false); }); });
    $('[data-verify-resend]', wrap).addEventListener('click', resendVerify);
    $('[data-verify-out]', wrap).addEventListener('click', verifyOut);
    $('[data-pw]', wrap).addEventListener('click', function () {
      var inp = $('#auth-pass'), show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      this.textContent = show ? T('Απόκρυψη', 'Hide') : T('Εμφάνιση', 'Show');
      this.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
    var cu = $('[data-copy-url]', wrap);
    if (cu) cu.addEventListener('click', function () {
      U.copyText(location.href, function (ok) { cu.textContent = ok ? T('Αντιγράφηκε ✓', 'Copied ✓') : location.href; });
    });
    return wrap;
  }
  function setMode(m) {
    mode = m === 'register' ? 'register' : m === 'verify' ? 'verify' : 'signin';
    var reg = mode === 'register', ver = mode === 'verify';
    $('[data-auth-main]', dialog).hidden = ver;
    $('[data-verify]', dialog).hidden = !ver;
    watchVerify(ver && !!pendingUser);
    if (ver) {
      $('#auth-title').textContent = T('Επιβεβαιώστε το e-mail σας', 'Confirm your e-mail');
      $('#auth-sub').textContent = T('Ένα τελευταίο βήμα: η σύνδεση ολοκληρώνεται μόλις επιβεβαιώσετε τη διεύθυνση e-mail σας.',
        'One last step: signing in is complete as soon as you confirm your e-mail address.');
      verifyMsg('');
      paintVerify();
      return;
    }
    $('#auth-title').textContent = reg ? T('Νέος λογαριασμός', 'New account') : T('Σύνδεση', 'Sign in');
    $('#auth-sub').textContent = reg
      ? T('Δημιουργήστε λογαριασμό για να κάνετε αίτηση μέλους και να μπείτε στην περιοχή μελών.', "Create an account to apply for membership and to enter the members' area.")
      : T('Για τα μέλη και τους φίλους του Συλλόγου Διπλωματούχων ΣΕΜΦΕ ΕΜΠ.', 'For the members and friends of the SEMFE Alumni Association.');
    $('#tab-signin').setAttribute('aria-pressed', reg ? 'false' : 'true');
    $('#tab-register').setAttribute('aria-pressed', reg ? 'true' : 'false');
    describe($('#auth-pass'), reg ? 'auth-pass-hint' : '');
    $$('[data-reg-only]', dialog).forEach(function (el) { el.hidden = !reg; });
    $$('[data-signin-only]', dialog).forEach(function (el) { el.hidden = reg; });
    $('#auth-pass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    $('[data-submit]', dialog).textContent = reg ? T('Δημιουργία λογαριασμού', 'Create account') : T('Σύνδεση', 'Sign in');
    $$('[data-provider] span', dialog).forEach(function (s, i) { var nm = PROVIDERS[enabled[i]].name; s.textContent = T('Συνέχεια με ' + nm, 'Continue with ' + nm); });
    if (sdkFailed) showStatus(FAIL_MSG, 'err'); else showStatus('');
  }
  function open(m, trigger) {
    if (current) { location.href = L.home + 'account/'; return; }
    // a pending account: whatever was asked for, the card (it has «Αποσύνδεση»)
    if (pendingUser || (!authKnown && configured && pendingHint())) m = 'verify';
    if (configured) loadSdk();
    if (!dialog) dialog = buildDialog();
    var ae = document.activeElement;             // Safari does not focus a clicked button: prefer the trigger
    lastFocus = trigger || (ae && ae !== document.body ? ae : $('[data-signin]'));
    // the header and the account page redraw their buttons when sign-in state
    // arrives, which can detach the trigger: keep a way to find its successor
    lastFocusSel = !lastFocus || !lastFocus.getAttribute ? '' : lastFocus.id ? '#' + lastFocus.id
      : lastFocus.hasAttribute('data-open') ? '[data-open="' + lastFocus.getAttribute('data-open') + '"]'
      : lastFocus.hasAttribute('data-signin') ? '#acct-slot [data-signin]'
      : lastFocus.hasAttribute('data-verify-open') ? '#acct-slot [data-verify-open]' : '';
    if (!pendingLink) $('[data-link-notice]', dialog).hidden = true;
    setMode(m || 'signin');
    dialog.hidden = false;
    if (U.lockScroll) U.lockScroll(); else document.body.classList.add('modal-open');
    if (mode === 'verify') { watchVerify(!!pendingUser); focusVerify(); return; }
    var first = $(configured ? '.prov, #auth-email' : '[data-offline] a', dialog) || $('[data-close]', dialog);
    setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
  }
  function close() {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    watchVerify(false);
    if (U.unlockScroll) U.unlockScroll(); else document.body.classList.remove('modal-open');
    var to = lastFocus && document.body.contains(lastFocus) ? lastFocus
      : (lastFocusSel && $(lastFocusSel)) || $('#acct-slot [data-signin], #acct-slot [data-verify-open], #acct-slot .acct-chip');
    if (to && to.focus) try { to.focus(); } catch (e) {}
  }
  function showStatus(msg, kind) {
    if (!dialog) return;
    var el = $('[data-status]', dialog);
    el.textContent = msg || '';
    el.className = kind === 'ok' ? 'form-ok' : 'form-error';
  }
  function setBusy(busy) {
    if (!dialog) return;
    $$('[data-provider], [data-submit]', dialog).forEach(function (b) { b.disabled = busy || !configured; });
  }

  /* ---- sign-in actions --------------------------------------------------- */
  function providerSignIn(key, btn) {
    var p = PROVIDERS[key];
    if (!p || !configured) return;
    if (key === 'linkedin' && LI_FUNCTION) { linkedinStart('signin', pendingLink ? pendingLink.name : ''); return; }
    if (!sdkReady) { showStatus(sdkFailed ? FAIL_MSG : T('Μια στιγμή, φορτώνει η υπηρεσία σύνδεσης…', 'One moment, the sign-in service is loading…')); loadSdk(); return; }
    showStatus('');
    var label = btn && $('span', btn), old = label ? label.textContent : '';
    if (btn) { btn.disabled = true; if (label) label.textContent = T('Άνοιγμα ' + p.name + '…', 'Opening ' + p.name + '…'); }
    var restore = function () { if (btn) { btn.disabled = false; if (label) label.textContent = old; } };
    // called synchronously from the click, so the browser lets the popup open
    auth.signInWithPopup(p.make()).then(function (res) { restore(); return afterSignIn(res); })
      .catch(function (e) { restore(); handleError(e, key); });
  }
  function emailSubmit() {
    if (!configured) return;
    if (!sdkReady) { showStatus(sdkFailed ? FAIL_MSG : T('Μια στιγμή, φορτώνει η υπηρεσία σύνδεσης…', 'One moment, the sign-in service is loading…')); loadSdk(); return; }
    var email = $('#auth-email').value.trim(), pass = $('#auth-pass').value;
    var reg = mode === 'register';
    var first = reg ? $('#auth-first').value.trim() : '', last = reg ? $('#auth-last').value.trim() : '';
    $$('[aria-invalid]', dialog).forEach(function (el) { el.removeAttribute('aria-invalid'); describe(el, el.id === 'auth-pass' && mode === 'register' ? 'auth-pass-hint' : ''); });
    var bad = function (id, msg) {
      var el = $(id); el.setAttribute('aria-invalid', 'true');
      describe(el, (el.id === 'auth-pass' && mode === 'register' ? 'auth-pass-hint ' : '') + 'auth-status');
      el.focus(); showStatus(msg);
    };
    if (reg && !first) return bad('#auth-first', T('Γράψτε το όνομά σας.', 'Please enter your first name.'));
    if (reg && !last) return bad('#auth-last', T('Γράψτε το επώνυμό σας.', 'Please enter your last name.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('#auth-email', T('Γράψτε μια έγκυρη διεύθυνση e-mail.', 'Please enter a valid e-mail address.'));
    if (!pass) return bad('#auth-pass', T('Γράψτε τον κωδικό σας.', 'Please enter your password.'));
    if (reg && pass.length < 8) return bad('#auth-pass', T('Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.', 'The password needs at least 8 characters.'));
    var submit = $('[data-submit]', dialog);
    submit.disabled = true;
    if (reg) registering = true;
    var job = reg
      ? auth.createUserWithEmailAndPassword(email, pass).then(function (res) {
          return res.user.updateProfile({ displayName: (first + ' ' + last).trim() })
            .catch(function (e) {                // the account exists: say so, and go on without the name
              flash(T('Ο λογαριασμός δημιουργήθηκε, αλλά το όνομα δεν αποθηκεύτηκε (' + friendly(e) + '). Συμπληρώστε το στην αίτηση μέλους.',
                'Your account was created, but the name was not saved (' + friendly(e) + '). Please fill it in on the membership application.'));
            })
            // the e-mail that confirms the address: until its link is pressed the
            // account is pending (settle() shows the card instead of signing in)
            .then(function () {
              return res.user.sendEmailVerification(verifySettings()).then(function () {
                verifyState = 'sent'; verifyErr = null; lastSend = Date.now();
              }, function (e) { verifyState = 'failed'; verifyErr = e; lastSend = 0; });
            })
            .then(function () { registering = false; settle(auth.currentUser || res.user); return res; });
        }, function (e) { registering = false; throw e; })
      : auth.signInWithEmailAndPassword(email, pass);
    job.then(function (res) { submit.disabled = false; return afterSignIn(res, reg); })
      .catch(function (e) { submit.disabled = false; handleError(e, 'password'); });
  }
  function forgot() {
    if (!configured) return;
    if (!sdkReady) { loadSdk(); return; }
    var email = $('#auth-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $('#auth-email').setAttribute('aria-invalid', 'true'); $('#auth-email').focus();
      showStatus(T('Γράψτε πρώτα το e-mail σας παραπάνω και πατήστε ξανά «Ξεχάσατε τον κωδικό;».', 'First enter your e-mail address above, then press “Forgot your password?” again.'));
      return;
    }
    auth.sendPasswordResetEmail(email, { url: absolute(L.home + 'account/') }).then(function () {
      showStatus(T('Αν υπάρχει λογαριασμός με αυτό το e-mail, σας στείλαμε σύνδεσμο για νέο κωδικό. Ελέγξτε και τα ανεπιθύμητα (spam).',
        'If there is an account with this e-mail address, we have sent you a link to set a new password. Please check your spam folder too.'), 'ok');
    }).catch(function (e) { showStatus(friendly(e)); });
  }
  function afterSignIn(res, registered) {
    var u = res && res.user;
    var isNew = registered || !!(res && res.additionalUserInfo && res.additionalUserInfo.isNewUser);
    var chain = Promise.resolve();
    if (u && pendingLink) {
      var pl = pendingLink;
      pendingLink = null;
      chain = u.linkWithCredential(pl.credential).then(function () {
        flash(T('Το ' + pl.name + ' συνδέθηκε με τον λογαριασμό σας. Από εδώ και πέρα μπαίνετε με όποιον από τους δύο τρόπους θέλετε.',
          cap(pl.name) + ' is now connected to your account. From now on you can sign in either way.'));
      }).catch(function (e) {
        if (window.console) console.warn('link failed', e);
        flash(T('Συνδεθήκατε. Το ' + pl.name + ' δεν συνδέθηκε με τον λογαριασμό σας (' + friendly(e) + ').',
          'You are signed in. ' + cap(pl.name) + ' was not connected to your account (' + friendly(e) + ').'));
      });
    }
    return chain.then(function () {
      // an e-mail + password account that has not confirmed its address: the
      // dialog stays open as the card (settle() has already switched it)
      var cu = (auth && auth.currentUser) || u;
      if (cu && needsVerification(cu)) { enterPending(cu); return; }
      if (cu && pendingUser) settle(cu);      // a link just made the account one that needs no confirmation
      close();
      resetDialog();
      var onAccount = /\/account\/?$/.test(location.pathname);
      if (isNew && !onAccount) location.href = L.home + 'account/#apply';
    });
  }
  function handleError(e, key) {
    var code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return;
    if (code === 'auth/account-exists-with-different-credential' && e.credential) {
      var who = key && PROVIDERS[key] ? PROVIDERS[key].name : T('αυτός ο τρόπος σύνδεσης', 'this sign-in method');
      var email = e.email || (e.customData && e.customData.email) || '';
      pendingLink = { credential: e.credential, name: who, email: email };
      var box = $('[data-link-notice]', dialog);
      box.className = 'notice warn';
      box.innerHTML = T('<strong>Έχετε ήδη λογαριασμό' + (email ? ' με το ' + esc(email) : '') + '</strong>' +
        '<p>Συνδεθείτε με τον τρόπο που χρησιμοποιήσατε την πρώτη φορά (' + esc(methodsText('e-mail και κωδικό', key)) + '). Αμέσως μετά θα συνδέσουμε και το ' + esc(who) + ' στον ίδιο λογαριασμό.</p>',
        '<strong>You already have an account' + (email ? ' with ' + esc(email) : '') + '</strong>' +
        '<p>Sign in the way you did the first time (' + esc(methodsText('e-mail and password', key)) + '). Right after that, we will connect ' + esc(who) + ' to the same account too.</p>');
      box.hidden = false;
      if (email) $('#auth-email').value = email;
      setMode('signin');
      box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
      return;
    }
    showStatus(friendly(e));
  }
  /* after signing in or out, the dialog forgets what was typed: on a shared
     computer the next person must not find the last password in it */
  function resetDialog() {
    if (!dialog) return;
    var f = $('[data-email-form]', dialog); if (f && f.reset) f.reset();
    var pw = $('#auth-pass', dialog), t = $('[data-pw]', dialog);
    if (pw) pw.type = 'password';
    if (t) { t.textContent = T('Εμφάνιση', 'Show'); t.setAttribute('aria-pressed', 'false'); }
    $$('[aria-invalid]', dialog).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    pendingLink = null;
    var ln = $('[data-link-notice]', dialog); if (ln) ln.hidden = true;
    showStatus('');
  }
  /* opts.stay: do not reload a member page afterwards (the verification
     card's «Αποσύνδεση», which turns the dialog into the sign-in form) */
  function signOut(opts) {
    clearHint(); clearPending();
    pendingUser = null; watchVerify(false); verifyState = null; verifyErr = null;
    resetDialog();
    if (!configured) { current = null; paintHeader(); return Promise.resolve(); }
    // the SDK may still be downloading (the header was drawn from the saved
    // hint): wait for it and sign out for real, or the session comes back. The
    // intent is written down first, so leaving the page at once cannot undo it:
    // the next page finishes the sign-out before it accepts a restored session.
    signingOut = true;
    try { localStorage.setItem(SIGNOUT_KEY, '1'); } catch (e) {}
    if (!authKnown) paintHeader();
    return loadSdk().then(function () { return auth.signOut(); }).then(function () {
      signingOut = false;
      try { localStorage.removeItem(SIGNOUT_KEY); } catch (e) {}
      clearHint();
      // a fresh page without the #hash: account/#apply would otherwise open the registration dialog
      if (!(opts && opts.stay) && /\/(account|members|admin)\/?$/.test(location.pathname)) location.replace(location.pathname + location.search);
    }, function (e) { signingOut = false; throw e; });
  }

  /* ---- account management (used by account.js) ------------------------- */
  function providers(u) {
    return (u && u.providerData || []).map(function (p) { return keyForProviderId(p.providerId); }).filter(Boolean);
  }
  /* as providers(), plus LinkedIn when it was connected through the Cloud
     Function (those accounts carry the custom claim li instead of a providerData entry) */
  function providersAsync(u) {
    var list = providers(u);
    if (!u || list.indexOf('linkedin') !== -1 || !u.getIdTokenResult) return Promise.resolve(list);
    return u.getIdTokenResult().then(function (r) {
      if (r && r.claims && r.claims.li === true) list.push('linkedin');
      return list;
    }, function () { return list; });
  }
  function link(key) {
    var p = PROVIDERS[key];
    if (!p || !current) return Promise.reject(new Error('no-user'));
    if (key === 'linkedin' && LI_FUNCTION) {                  // the page navigates away, or says why it cannot
      return linkedinStart('link') ? new Promise(function () {}) : Promise.reject({ code: 'semfe/storage-blocked' });
    }
    return current.linkWithPopup(p.make());
  }
  function reauth(u) {
    u = u || current;
    var ids = (u.providerData || []).map(function (p) { return p.providerId; });
    for (var k in PROVIDERS) if (ids.indexOf(PROVIDERS[k].id) !== -1) return u.reauthenticateWithPopup(PROVIDERS[k].make());
    if (ids.indexOf('password') !== -1) return Promise.reject({ code: 'semfe/needs-password' });
    return Promise.reject({ code: 'semfe/relogin' });       // e.g. LinkedIn through the Cloud Function
  }

  /* ---- LinkedIn through the Cloud Function -------------------------------- */
  // Leave the page for LinkedIn. A full-page visit (not a popup) avoids popup
  // blockers and the opener being cut off by LinkedIn's security headers; the
  // member comes back to auth/linkedin/, which calls linkedinComplete().
  // The state carries the page's language (or lang: auth/linkedin/ starting a
  // merge keeps the language the sign-in began in), so that page answers in it.
  function linkedinStart(mode, waiting, lang) {
    if (!liReady) return false;
    var state = randomState();
    try {
      sessionStorage.setItem(LI_STATE, JSON.stringify({ state: state, mode: mode === 'link' || mode === 'merge' ? mode : 'signin', returnTo: returnAddress(),
        waiting: String(waiting || '').slice(0, 40), lang: speak(lang).lang, t: Date.now() }));
    } catch (e) { showStatus(friendly({ code: 'semfe/storage-blocked' })); return false; }
    location.assign('https://www.linkedin.com/oauth/v2/authorization?response_type=code' +
      '&client_id=' + encodeURIComponent(LI.clientId) +
      '&redirect_uri=' + encodeURIComponent(linkedinRedirectUri()) +
      '&state=' + encodeURIComponent(state) +
      '&scope=' + encodeURIComponent('openid profile email'));
    return true;
  }
  /* this page without its #hash and without ?signin / ?register, which would open the dialog again */
  function returnAddress() {
    try {
      var u = new URL(location.href);
      u.hash = '';
      u.searchParams.delete('signin'); u.searchParams.delete('register');
      return u.href;
    } catch (e) { return location.href.split('#')[0]; }
  }
  function linkedinRedirectUri() { return absolute(root + 'auth/linkedin/'); }
  function linkedinTakeState() {
    var v = null;
    try { v = JSON.parse(sessionStorage.getItem(LI_STATE) || 'null'); sessionStorage.removeItem(LI_STATE); } catch (e) {}
    return v && typeof v.state === 'string' ? v : null;
  }
  function linkedinComplete(code, mode) {
    if (!configured || !liReady) return Promise.reject({ code: 'auth/operation-not-allowed' });
    var withUser = mode === 'link' || mode === 'merge';   // merge: connect LinkedIn, merging the account it already opens
    return loadSdk().then(function () {
      return withUser ? firstUser() : null;
    }).then(function (u) {
      if (withUser && !u) throw { code: 'semfe/relogin' };
      // a fresh token: the server checks email_verified, and a member who has
      // just confirmed their address still holds a token that says false
      var tok = u ? u.reload().then(function () { return u.getIdToken(true); }) : Promise.resolve(null);
      return tok.then(function (idToken) {
        var headers = { 'Content-Type': 'application/json' };
        if (idToken) headers.Authorization = 'Bearer ' + idToken;
        var body = { code: code, redirectUri: linkedinRedirectUri() };
        if (mode === 'merge') body.merge = true;
        return fetch(LI.functionUrl, { method: 'POST', headers: headers, body: JSON.stringify(body) });
      });
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j || {} }; }, function () { return { ok: false, j: {} }; });
    }, function (e) {
      throw (e && e.code) ? e : { code: 'auth/network-request-failed' };
    }).then(function (x) {
      if (!x.ok || !x.j.token) throw { code: 'semfe/' + (x.j.error || 'linkedin-failed') };
      return auth.signInWithCustomToken(x.j.token).then(function () {
        // refresh so the new "li" claim is in the token the rules and the account page read
        return auth.currentUser ? auth.currentUser.getIdToken(true) : null;
      }).then(function () { return { isNew: !!x.j.isNew, linked: !!x.j.linked, merged: x.j.merged || null }; });
    });
  }
  function firstUser() {
    return new Promise(function (resolve) {
      var off = auth.onAuthStateChanged(function (u) { off(); resolve(u); });
    });
  }
  function randomState() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  /* only ever send the member back to a page of this site (else to its home
     page, in the page's language or in lang) */
  function safeReturn(url, lang) {
    var site = absolute(root);
    try { var u = new URL(url, location.href); if (u.origin === location.origin && u.href.indexOf(site) === 0 && !/\/auth\/linkedin\//.test(u.pathname)) return u.href; } catch (e) {}
    return absolute(speak(lang).home);
  }
  function reauthPassword(pass) {
    var cred = firebase.auth.EmailAuthProvider.credential(current.email, pass);
    return current.reauthenticateWithCredential(cred);
  }
  function isAdmin(u) {
    if (!u || !u.email || !u.emailVerified) return false;
    var e = u.email.toLowerCase();
    return (C.ADMIN_EMAILS || []).some(function (a) { return String(a).toLowerCase() === e; });
  }

  /* ---- messages ---------------------------------------------------------- */
  function friendly(e, lang) {
    var T = speak(lang).t;
    var c = (e && e.code) || '';
    var social = methodsText('', '', lang);
    var M = {
      'auth/invalid-email': T('Η διεύθυνση e-mail δεν φαίνεται σωστή.',
        'The e-mail address does not look right.'),
      'auth/missing-password': T('Γράψτε τον κωδικό σας.',
        'Please enter your password.'),
      'auth/weak-password': T('Ο κωδικός είναι πολύ αδύναμος. Χρησιμοποιήστε τουλάχιστον 8 χαρακτήρες.',
        'The password is too weak. Use at least 8 characters.'),
      'auth/password-does-not-meet-requirements': T('Ο κωδικός δεν πληροί τις απαιτήσεις ασφαλείας. Δοκιμάστε μακρύτερο κωδικό με γράμματα και αριθμούς.',
        'The password does not meet the security requirements. Try a longer password with letters and numbers.'),
      'auth/email-already-in-use': T('Υπάρχει ήδη λογαριασμός με αυτό το e-mail. Πατήστε «Σύνδεση»' + (social ? ' (ίσως τον δημιουργήσατε με ' + social + ')' : '') + ' ή ζητήστε νέο κωδικό.',
        'There is already an account with this e-mail. Press “Sign in”' + (social ? ' (you may have created it with ' + social + ')' : '') + ' or ask for a new password.'),
      'auth/invalid-credential': T('Λάθος e-mail ή κωδικός.' + (social ? ' Αν δημιουργήσατε τον λογαριασμό σας με ' + social + ', συνδεθείτε με το αντίστοιχο κουμπί.' : ''),
        'Wrong e-mail or password.' + (social ? ' If you created your account with ' + social + ', sign in with the matching button.' : '')),
      'auth/wrong-password': T('Λάθος e-mail ή κωδικός.',
        'Wrong e-mail or password.'),
      'auth/user-not-found': T('Λάθος e-mail ή κωδικός.',
        'Wrong e-mail or password.'),
      'auth/invalid-login-credentials': T('Λάθος e-mail ή κωδικός.',
        'Wrong e-mail or password.'),
      'auth/user-disabled': T('Ο λογαριασμός αυτός έχει απενεργοποιηθεί. Επικοινωνήστε μαζί μας.',
        'This account has been disabled. Please contact us.'),
      'auth/too-many-requests': T('Πολλές προσπάθειες σε λίγο χρόνο. Δοκιμάστε ξανά σε λίγα λεπτά.',
        'Too many attempts in a short time. Please try again in a few minutes.'),
      'auth/network-request-failed': T('Πρόβλημα σύνδεσης στο διαδίκτυο. Δοκιμάστε ξανά.',
        'There is a problem with your internet connection. Please try again.'),
      'auth/popup-blocked': T('Ο browser μπλόκαρε το παράθυρο σύνδεσης. Επιτρέψτε τα αναδυόμενα παράθυρα για αυτή τη σελίδα και πατήστε ξανά το κουμπί.',
        'Your browser blocked the sign-in window. Allow pop-up windows for this page and press the button again.'),
      'auth/operation-not-allowed': T('Αυτός ο τρόπος σύνδεσης δεν έχει ενεργοποιηθεί ακόμα. Δοκιμάστε άλλον.',
        'This sign-in method has not been switched on yet. Please try another.'),
      'auth/unauthorized-domain': T('Η σύνδεση δεν έχει εγκριθεί ακόμα για αυτή τη διεύθυνση του ιστότοπου.',
        'Sign-in has not been approved yet for this website address.'),
      'auth/operation-not-supported-in-this-environment': T('Ο browser σας δεν υποστηρίζει αυτό τον τρόπο σύνδεσης. Ανοίξτε τη σελίδα σε Safari, Chrome, Firefox ή Edge.',
        'Your browser does not support this sign-in method. Open the page in Safari, Chrome, Firefox or Edge.'),
      'auth/web-storage-unsupported': T('Ο browser σας έχει απενεργοποιημένη την αποθήκευση δεδομένων (cookies). Ενεργοποιήστε την ή δοκιμάστε άλλον browser.',
        'Your browser has data storage (cookies) switched off. Switch it on or try another browser.'),
      'auth/internal-error': T('Κάτι πήγε στραβά στην υπηρεσία σύνδεσης. Δοκιμάστε ξανά ή επιλέξτε άλλον τρόπο σύνδεσης.',
        'Something went wrong with the sign-in service. Please try again or choose another sign-in method.'),
      'auth/requires-recent-login': T('Για λόγους ασφαλείας, χρειάζεται να συνδεθείτε ξανά πριν από αυτή την ενέργεια.',
        'For security reasons, you need to sign in again before doing this.'),
      'auth/credential-already-in-use': T('Αυτός ο λογαριασμός χρησιμοποιείται ήδη από άλλον λογαριασμό του ιστότοπου.',
        'This account is already in use by another account on this website.'),
      'auth/provider-already-linked': T('Αυτός ο τρόπος σύνδεσης είναι ήδη συνδεδεμένος.',
        'This sign-in method is already connected.'),
      'auth/account-exists-with-different-credential': T('Υπάρχει ήδη λογαριασμός με αυτό το e-mail. Συνδεθείτε με τον τρόπο που χρησιμοποιήσατε την πρώτη φορά.',
        'There is already an account with this e-mail. Sign in the way you did the first time.'),
      'auth/expired-action-code': T('Ο σύνδεσμος έληξε. Ζητήστε νέο.',
        'The link has expired. Please ask for a new one.'),
      'auth/invalid-action-code': T('Ο σύνδεσμος δεν ισχύει πια. Ζητήστε νέο.',
        'The link is no longer valid. Please ask for a new one.'),
      'semfe/relogin': T('Για λόγους ασφαλείας, αποσυνδεθείτε, συνδεθείτε ξανά και επαναλάβετε μέσα σε λίγα λεπτά.',
        'For security reasons, sign out, sign in again and repeat this within a few minutes.'),
      'semfe/needs-password': T('Γράψτε τον κωδικό σας για επιβεβαίωση.',
        'Enter your password to confirm.'),
      'semfe/account-exists-unverified': T('Υπάρχει ήδη λογαριασμός με το e-mail του LinkedIn σας, που όμως δεν έχει επιβεβαιωθεί. Συνδεθείτε με τον τρόπο που χρησιμοποιήσατε την πρώτη φορά (' + methodsText('e-mail και κωδικό', 'linkedin', lang) + '), πατήστε τον σύνδεσμο στο e-mail επιβεβαίωσης που θα σας ζητηθεί, και μετά συνδέστε το LinkedIn από τη σελίδα «Ο λογαριασμός μου».',
        'There is already an account with the e-mail address of your LinkedIn account, but it has not been confirmed. Sign in the way you did the first time (' + methodsText('e-mail and password', 'linkedin', lang) + '), press the link in the confirmation e-mail when you are asked to, and then connect LinkedIn from the My account page.'),
      'semfe/link-needs-verified-email': T('Για να συνδέσετε το LinkedIn, χρειάζεται πρώτα να επιβεβαιώσετε το e-mail του λογαριασμού σας (δείτε «Τρόποι σύνδεσης» στη σελίδα «Ο λογαριασμός μου»).',
        'To connect LinkedIn, you first need to confirm the e-mail address of your account (see Sign-in methods on the My account page).'),
      'semfe/credential-already-in-use': T('Αυτός ο λογαριασμός LinkedIn είναι ήδη συνδεδεμένος με άλλον λογαριασμό του ιστότοπου.',
        'This LinkedIn account is already connected to another account on this website.'),
      'semfe/linkedin-code-rejected': T('Το LinkedIn δεν δέχτηκε τη σύνδεση (ίσως έληξε). Δοκιμάστε ξανά.',
        'LinkedIn did not accept the sign-in (it may have expired). Please try again.'),
      'semfe/linkedin-profile-unavailable': T('Το LinkedIn δεν έδωσε τα στοιχεία του προφίλ σας. Δοκιμάστε ξανά σε λίγο.',
        'LinkedIn did not provide your profile details. Please try again shortly.'),
      'semfe/redirect-not-allowed': T('Η σύνδεση με LinkedIn δεν έχει ρυθμιστεί σωστά (διεύθυνση επιστροφής).',
        'Sign-in with LinkedIn has not been set up correctly (return address).'),
      'semfe/origin-not-allowed': T('Η σύνδεση με LinkedIn δεν έχει εγκριθεί για αυτή τη διεύθυνση του ιστότοπου.',
        'Sign-in with LinkedIn has not been approved for this website address.'),
      'semfe/not-configured': T('Η σύνδεση με LinkedIn δεν έχει ολοκληρωθεί από τους διαχειριστές.',
        'The administrators have not finished setting up sign-in with LinkedIn.'),
      'semfe/bad-id-token': T('Η σύνδεσή σας έληξε. Συνδεθείτε ξανά και επαναλάβετε.',
        'Your session has expired. Please sign in again and repeat.'),
      'semfe/internal': T('Κάτι πήγε στραβά στην υπηρεσία σύνδεσης. Δοκιμάστε ξανά αργότερα.',
        'Something went wrong with the sign-in service. Please try again later.'),
      'semfe/linkedin-failed': T('Η σύνδεση με LinkedIn δεν ολοκληρώθηκε. Δοκιμάστε ξανά.',
        'Sign-in with LinkedIn was not completed. Please try again.'),
      'semfe/accounts-unreachable': T('Η υπηρεσία λογαριασμών δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα ή γράψτε μας.',
        'The accounts service is not available right now. Please try again later or write to us.'),
      'semfe/same-account': T('Συνδεθήκατε στον ίδιο λογαριασμό. Για ένωση, συνδεθείτε στον ΑΛΛΟ λογαριασμό σας.',
        'You signed in to the same account. To merge, sign in to your OTHER account.'),
      'semfe/other-sign-in-too-old': T('Η σύνδεση στον άλλο λογαριασμό έληξε. Δοκιμάστε ξανά.',
        'The sign-in to the other account has expired. Please try again.'),
      'semfe/bad-other-token': T('Η σύνδεση στον άλλο λογαριασμό δεν επιβεβαιώθηκε. Δοκιμάστε ξανά.',
        'The sign-in to the other account could not be confirmed. Please try again.'),
      'semfe/not-signed-in': T('Η σύνδεσή σας έληξε. Συνδεθείτε ξανά και επαναλάβετε.',
        'Your session has expired. Please sign in again and repeat.'),
      'semfe/not-admin': T('Η ενέργεια αυτή είναι μόνο για τους διαχειριστές.',
        'Only the administrators can do this.'),
      'semfe/cannot-remove-yourself': T('Δεν μπορείτε να διαγράψετε ή να ενώσετε τον λογαριασμό με τον οποίο είστε συνδεδεμένος/η.',
        'You cannot delete or merge the account you are signed in with.'),
      'semfe/no-such-account': T('Ο λογαριασμός δεν υπάρχει πια (ίσως διαγράφηκε ή ενώθηκε ήδη).',
        'The account no longer exists (it may have been deleted or merged already).'),
      'semfe/bad-request': T('Κάτι πήγε στραβά με το αίτημα. Ανανεώστε τη σελίδα και δοκιμάστε ξανά.',
        'Something went wrong with the request. Please reload the page and try again.'),
      'semfe/email-not-verified': T('Επιβεβαιώστε πρώτα το e-mail αυτού του λογαριασμού (με τον σύνδεσμο που σας στείλαμε) και δοκιμάστε ξανά.',
        'First confirm the e-mail address of this account (with the link we sent you) and try again.'),
      'semfe/cannot-remove-admin': T('Ο λογαριασμός ενός διαχειριστή δεν διαγράφεται ούτε ενώνεται σε άλλον. Κρατήστε αυτόν και ενώστε τον άλλο σε αυτόν.',
        'An administrator\'s account cannot be deleted or merged into another. Keep this one and merge the other into it.'),
      'semfe/merge-busy': T('Γίνεται ήδη μια ένωση με αυτούς τους λογαριασμούς. Περιμένετε λίγο και δοκιμάστε ξανά.',
        'A merge of these accounts is already in progress. Please wait a little and try again.'),
      'semfe/storage-blocked': T('Ο browser σας δεν επιτρέπει την αποθήκευση δεδομένων (cookies), που χρειάζεται η σύνδεση με LinkedIn. Επιτρέψτε τα για αυτόν τον ιστότοπο και δοκιμάστε ξανά.',
        'Your browser does not allow data storage (cookies), which sign-in with LinkedIn needs. Allow it for this website and try again.'),
      'auth/user-mismatch': T('Συνδεθήκατε με άλλον λογαριασμό από αυτόν που έχετε ανοιχτό εδώ. Διαλέξτε τον ίδιο λογαριασμό και δοκιμάστε ξανά.',
        'You signed in with a different account from the one open here. Choose the same account and try again.'),
      'auth/provider-already-linked': T('Αυτός ο τρόπος σύνδεσης είναι ήδη συνδεδεμένος με τον λογαριασμό σας.',
        'This sign-in method is already connected to your account.'),
      'permission-denied': T('Δεν έχετε δικαίωμα για αυτή την ενέργεια (ή οι κανόνες ασφαλείας της βάσης δεν έχουν δημοσιευτεί ακόμα).',
        'You do not have permission for this action (or the database\'s security rules have not been published yet).'),
      'unavailable': T('Η βάση δεδομένων δεν είναι διαθέσιμη αυτή τη στιγμή. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.',
        'The database is not available right now. Check your connection and try again.')
    };
    return M[c] || T('Κάτι πήγε στραβά. Δοκιμάστε ξανά.', 'Something went wrong. Please try again.') + (c ? ' (' + c + ')' : '');
  }
  function flash(msg) {
    var el = document.createElement('div');
    el.className = 'notice ok';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:400;max-width:calc(100% - 32px);width:520px;box-shadow:var(--shadow-lg)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 7000);
  }
  function describe(el, ids) { if (!el) return; if (ids) el.setAttribute('aria-describedby', ids); else el.removeAttribute('aria-describedby'); }
  function absolute(rel) { var a = document.createElement('a'); a.href = rel; return a.href; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- public API -------------------------------------------------------- */
  function onChange(fn, opts) {
    listeners.push(fn);
    // a page that asks about the account needs the library. A PASSIVE listener
    // (whats-new/: a visitor's list is the same either way) only hears of a
    // sign-in that happens anyway: a browser that signed in before, the dialog
    if (configured && !sdkPromise && !authKnown && !(opts && opts.passive)) loadSdk();
    if (authKnown) { try { fn(current); } catch (e) {} }
    else if (!configured) { try { fn(null); } catch (e) {} }
  }
  window.SemfeAuth = {
    configured: configured, root: root, home: L.home, onChange: onChange, open: open, close: close, signOut: function () { return signOut(); },
    pending: function () { return pendingUser ? { email: pendingUser.email || '' } : null; },
    needsVerification: needsVerification,
    db: db, isAdmin: isAdmin, providers: providers, providersAsync: providersAsync, link: link, reauth: reauth, reauthPassword: reauthPassword,
    linkedinTakeState: linkedinTakeState, linkedinComplete: linkedinComplete, safeReturn: safeReturn,
    linkedinViaFunction: function () { return LI_FUNCTION; },
    friendly: friendly, flash: flash, esc: esc, avatarHtml: avatarHtml, displayName: displayName,
    enabledProviders: function () { return enabled.slice(); }, providerInfo: function (k) { return PROVIDERS[k]; }, methodsText: methodsText,
    callAccounts: callAccounts, callFunction: callFunction, mergeWith: mergeWith, mergeSummary: mergeSummary, linkedinStart: linkedinStart,
    noteMenu: noteMenu, menuInfo: menuInfo, freshToken: freshToken,
    // set the second sign-in window up BEFORE the click: a popup opened after
    // several awaited steps can be blocked (Safari keeps a click "fresh" briefly)
    prepareMerge: function () { if (configured) otherAuth().catch(function () {}); },
    icon: function (k) { return ICONS[k] || ''; },
    user: function () { return current; }
  };
  /* what a static page shows to an admin only ([data-admin-only], hidden until
     then): the «Επεξεργασία» of an announcement's page. Passive: a visitor who
     never signed in does not load the sign-in library for it. It decides what
     is SHOWN; what an admin may do is decided by the Cloud Function. */
  (function () {
    var only = document.querySelectorAll('[data-admin-only]');
    if (!only.length) return;
    onChange(function (u) {
      var yes = !!(u && isAdmin(u));
      for (var i = 0; i < only.length; i++) only[i].hidden = !yes;
    }, { passive: true });
  })();

  /* ---- start -------------------------------------------------------------- */
  paintHeader();
  try {                                        // a message left by the page we came from
    var fl = sessionStorage.getItem('semfe:flash');
    if (fl) { sessionStorage.removeItem('semfe:flash'); flash(fl); }
  } catch (e) {}
  var outPending = false;
  try { outPending = localStorage.getItem(SIGNOUT_KEY) === '1'; } catch (e) {}
  if (configured && outPending) {
    // "Αποσύνδεση" was pressed on the previous page before it could finish
    signingOut = true; clearHint(); clearPending();
    loadSdk().then(function () { return auth.signOut(); }).then(function () {
      signingOut = false;
      try { localStorage.removeItem(SIGNOUT_KEY); } catch (e) {}
    }, function () { signingOut = false; });
  }
  if (configured) {
    // Load the sign-in library (from Google's gstatic.com; it keeps its
    // session in the browser's storage) only when it can be needed: on the
    // member pages, for someone who has signed in on this browser before, or
    // once the visitor opens the sign-in dialog. A visitor who only reads the
    // public pages never downloads it and gets nothing stored.
    if (document.body.getAttribute('data-firestore') === '1' || !!hint() || !!pendingHint()) loadSdk();
  } else {
    authKnown = true;
  }
  // a link such as account/#signin or ?signin opens the dialog
  // (only once we know nobody is signed in: a member following such a link stays where they are)
  if (/(^|[?&#])(signin|register)\b/.test(location.search + location.hash) && !/\/account\/?$/.test(location.pathname)) {
    var asked = /register/.test(location.search + location.hash) ? 'register' : 'signin', handled = false;
    if (!hint() && !pendingHint()) { handled = true; open(asked); }     // no saved session here: open at once (a late sign-in closes it)
    // (only if the visitor has not opened the dialog themselves meanwhile, even if they closed it again)
    onChange(function (u) { if (handled) return; handled = true; if (!u && !dialog) open(asked); });
  }
})();
