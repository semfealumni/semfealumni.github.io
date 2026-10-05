/* SEMFE Alumni: the page LinkedIn sends the member back to
 * (auth/linkedin/?code=…&state=…). It checks the state it saved before
 * leaving (so no other site can push a code at us), hands the code to the
 * linkedinSignIn Cloud Function through SemfeAuth.linkedinComplete, and
 * returns the member to where they started. The code is removed from the
 * address bar at once so it does not stay in the history.
 *
 * This page exists only in Greek (its address is registered with LinkedIn),
 * but a sign-in may have started on an English page: auth.js saves that
 * page's language with the state (lang), and this page then speaks it, in
 * its messages and in its heading, and sends the member back to pages in it
 * (A.root + 'en/' for English). */
(function () {
  'use strict';
  var A = window.SemfeAuth;
  var box = document.getElementById('li-app');
  if (!A || !box) return;
  var q = {};
  // a malformed address (a broken %-sequence) must not leave the page on its spinner
  var dec = function (v) { try { return decodeURIComponent(v); } catch (e) { return null; } };
  var broken = false;
  location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('='), k = dec(i < 0 ? kv : kv.slice(0, i)), v = i < 0 ? '' : dec(kv.slice(i + 1).replace(/\+/g, ' '));
    if (k === null || v === null) { broken = true; return; }
    q[k] = v;
  });
  if (broken) q = { error: 'invalid_request' };
  try { if (history.replaceState) history.replaceState(null, '', location.pathname); } catch (e) {}

  var saved = A.linkedinTakeState();       // {state, mode, returnTo, waiting, lang, t} or null (single use)
  // the language the sign-in began in (else this page's own, Greek)
  var LANG = saved && (saved.lang === 'en' || saved.lang === 'el') ? saved.lang : ((window.SEMFE_I18N || {}).lang || 'el');
  var EN = LANG === 'en';
  var T = function (el, en) { return EN ? en : el; };
  var HOME = A.root + (EN ? 'en/' : '');   // pages in that language
  if (EN) {
    // the page's own Greek words, while it works (the heading and the spinner's line)
    var main = document.getElementById('main') || box;
    main.setAttribute('lang', 'en');
    var eyebrow = document.querySelector('.page-hero .eyebrow'), h1 = document.querySelector('.page-hero h1');
    if (eyebrow) eyebrow.textContent = 'Account';
    if (h1) h1.textContent = 'Sign in with LinkedIn';
    var loading = box.querySelector('.loading');
    if (loading) loading.innerHTML = '<span class="spinner" aria-hidden="true"></span>Completing your sign-in with LinkedIn…';
    document.title = 'Sign in with LinkedIn · Association of SEMFE NTUA Graduates';
  }

  function show(title, text, kind) {
    box.innerHTML = '<div class="notice ' + (kind || 'err') + '"><strong>' + A.esc(title) + '</strong><p>' + A.esc(text) + '</p></div>' +
      '<div class="section-foot" style="margin-top:8px"><a class="btn btn-dark" href="' + HOME + 'account/">' + T('Ο λογαριασμός μου', 'My account') + '</a>' +
      '<a class="btn btn-outline" href="' + HOME + '">' + T('Αρχική', 'Home') + '</a></div>';
  }
  if (q.error) {
    var cancelled = /cancel/.test(q.error);
    // LinkedIn's own wording only when the state proves LinkedIn sent it: anyone
    // can build a link to this page with whatever text they like in the address
    var genuine = saved && q.state && saved.state === q.state;
    return show(cancelled ? T('Η σύνδεση ακυρώθηκε', 'Sign-in cancelled') : T('Το LinkedIn δεν ολοκλήρωσε τη σύνδεση', 'LinkedIn did not complete the sign-in'),
      cancelled ? T('Δεν συνδεθήκατε. Μπορείτε να δοκιμάσετε ξανά ή να επιλέξετε άλλον τρόπο σύνδεσης.', 'You are not signed in. You can try again or choose another sign-in method.')
        : genuine && q.error_description ? q.error_description.slice(0, 300)
        : T('Δεν συνδεθήκατε. Δοκιμάστε ξανά ή επιλέξτε άλλον τρόπο σύνδεσης.', 'You are not signed in. Please try again or choose another sign-in method.'), cancelled ? 'warn' : 'err');
  }
  if (!q.code || !saved || !q.state || saved.state !== q.state || Date.now() - saved.t > 20 * 60 * 1000) {
    return show(T('Ο σύνδεσμος σύνδεσης δεν ισχύει', 'The sign-in link is not valid'),
      T('Ίσως έληξε ή ανοίχτηκε σε άλλη καρτέλα. Πατήστε ξανά «Συνέχεια με LinkedIn».', 'It may have expired or been opened in another tab. Press “Continue with LinkedIn” again.'));
  }
  var fromAccount = saved.mode === 'link' || saved.mode === 'merge';
  A.linkedinComplete(q.code, saved.mode).then(function (r) {
    // a sign-in method that was waiting to be linked (the dialog asked them to sign in the
    // first way, which was LinkedIn): it cannot survive the trip, so show where to finish it
    var waiting = !fromAccount && saved.waiting && !(r && r.isNew) ? saved.waiting : '';
    var dest = fromAccount ? HOME + 'account/#methods' : waiting ? HOME + 'account/' : (r && r.isNew ? HOME + 'account/#apply' : A.safeReturn(saved.returnTo, LANG));
    var note = r && r.merged ? A.mergeSummary(r.merged, LANG)
      : fromAccount ? T('Το LinkedIn συνδέθηκε με τον λογαριασμό σας.', 'LinkedIn is now connected to your account.')
      : waiting ? T('Συνδεθήκατε με LinkedIn. Για να συνδέσετε και το ' + waiting + ', πατήστε «Σύνδεση» δίπλα του, στους «Τρόπους σύνδεσης».',
        'You are signed in with LinkedIn. To connect ' + waiting + ' too, press “Connect” next to it, under Sign-in methods.') : '';
    if (note) { try { sessionStorage.setItem('semfe:flash', note); } catch (e) {} }
    location.replace(dest);
  }, function (e) {
    // connecting LinkedIn, which already opens ANOTHER account here: offer to merge the two
    if (e && e.code === 'semfe/credential-already-in-use' && saved.mode === 'link') {
      box.innerHTML = '<div class="notice warn">' +
        T('<strong>Αυτό το LinkedIn ανοίγει ήδη άλλον λογαριασμό εδώ</strong>' +
        '<p>Μάλλον τον φτιάξατε κι εσείς, σε άλλη επίσκεψη. Μπορείτε να ενώσετε τους δύο λογαριασμούς σε αυτόν με τον οποίο είστε συνδεδεμένος/η: ' +
        'η αίτηση μέλους και οι τρόποι σύνδεσης του άλλου μεταφέρονται εδώ, και ο άλλος διαγράφεται. Θα σας ζητηθεί ξανά το LinkedIn.</p>',
        '<strong>This LinkedIn already opens another account here</strong>' +
        '<p>You probably created it yourself, on another visit. You can merge the two accounts into the one you are signed in with: ' +
        'the other account\'s membership application and sign-in methods move here, and the other account is deleted. You will be asked for LinkedIn again.</p>') + '</div>' +
        '<div class="section-foot" style="margin-top:8px"><button type="button" class="btn btn-dark" data-li-merge>' + T('Ένωση των δύο λογαριασμών', 'Merge the two accounts') + '</button>' +
        '<a class="btn btn-outline" href="' + HOME + 'account/#methods">' + T('Όχι, πίσω στον λογαριασμό μου', 'No, back to my account') + '</a></div>';
      box.querySelector('[data-li-merge]').addEventListener('click', function () { A.linkedinStart('merge', '', LANG); });
      return;
    }
    show(T('Η σύνδεση με LinkedIn δεν ολοκληρώθηκε', 'Sign-in with LinkedIn was not completed'), A.friendly(e, LANG));
  });
})();
