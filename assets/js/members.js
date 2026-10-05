/* SEMFE Alumni: the members-only page. Shows the signed-in person's
 * membership and, for ACTIVE members (and admins), the directory of members
 * who chose to be listed. firestore.rules refuses the directory to anyone
 * else, whatever this page does. */
(function () {
  'use strict';
  var A = window.SemfeAuth, C = window.SEMFE || {};
  var L = window.SEMFE_I18N, T = L.t;
  var app = document.getElementById('members-app');
  if (!A || !app) return;
  var esc = A.esc, YEAR = new Date().getFullYear(), rows = [];
  /* the stored field of study (account.js offers these three) as an English
     page names it; anything else is shown as stored */
  var DIRECTION_EN = { 'Εφαρμοσμένα Μαθηματικά': 'Applied Mathematics', 'Εφαρμοσμένη Φυσική': 'Applied Physics', 'Άλλη / δεν ισχύει': 'Other / not applicable' };
  var GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;
  function direction(d) { return L.en && DIRECTION_EN[d] ? DIRECTION_EN[d] : d; }
  /* text typed by a member is shown as typed; on the English page, Greek text is marked as Greek */
  function langOf(s) { return L.en && GREEK.test(String(s || '')) ? ' lang="el"' : ''; }
  /* the stored place line ("Λονδίνο, Ηνωμένο Βασίλειο") in the page's language, where its parts are known */
  function place(s) { var P = window.SEMFE_PROFILE; return P && P.placeText ? P.placeText(s, L.lang) : s; }

  function html(s) { app.innerHTML = s; }
  function locked(title, body, actions) {
    html('<div class="panel"><span class="lock-ic">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>' +
      '<h2 style="margin-top:14px">' + title + '</h2>' + body + (actions ? '<div class="section-foot" style="margin-top:8px">' + actions + '</div>' : '') + '</div>');
    app.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function (e) { A.open(b.getAttribute('data-open'), e.currentTarget); }); });
  }

  A.onChange(function (u) {
    if (!A.configured) {
      return locked(T('Η περιοχή μελών ανοίγει σύντομα', 'The members\' area opens soon'),
        T('<p>Μόλις ενεργοποιηθεί η σύνδεση μελών, τα ενεργά μέλη του Συλλόγου θα βλέπουν εδώ την ιδιότητά τους και τον κατάλογο μελών.</p>',
          '<p>As soon as member sign-in is switched on, the Association\'s active members will see their membership and the members\' directory here.</p>'),
        '<a class="btn btn-dark" href="' + A.home + 'support/#eggrafi">' + T('Πώς γίνομαι μέλος', 'How to become a member') + '</a>');
    }
    if (!u) {
      return locked(T('Μόνο για μέλη', 'Members only'),
        T('<p>Συνδεθείτε για να δείτε την περιοχή μελών. Αν δεν έχετε λογαριασμό, δημιουργήστε έναν και κάντε αίτηση μέλους.</p>',
          '<p>Sign in to see the members\' area. If you do not have an account, create one and apply for membership.</p>'),
        '<button type="button" class="btn btn-primary" data-open="signin">' + T('Σύνδεση', 'Sign in') + '</button><button type="button" class="btn btn-outline" data-open="register">' + T('Νέος λογαριασμός', 'New account') + '</button>');
    }
    html('<div class="loading"><span class="spinner" aria-hidden="true"></span>' + T('Φόρτωση…', 'Loading…') + '</div>');
    var db;
    A.db().then(function (d) { db = d; return db.collection('members').doc(u.uid).get(); }).then(function (snap) {
      var m = snap.exists ? snap.data() : null, admin = A.isAdmin(u);
      if (!admin && !m) {
        return locked(T('Δεν έχετε κάνει ακόμα αίτηση μέλους', 'You have not applied for membership yet'),
          T('<p>Η περιοχή μελών είναι για τα ενεργά μέλη του Συλλόγου. Συμπληρώστε την αίτηση μέλους από τον λογαριασμό σας.</p>',
            '<p>The members\' area is for the Association\'s active members. Fill in the membership application from your account.</p>'),
          '<a class="btn btn-primary" href="' + A.home + 'account/#apply">' + T('Αίτηση μέλους', 'Membership application') + '</a>');
      }
      if (!admin && m.status !== 'active') {
        var faculty = m.stage === 'faculty', fee = esc(C.annualFee || 10);
        return locked(m.status === 'rejected' ? T('Η αίτησή σας δεν εγκρίθηκε', 'Your application was not approved') : T('Η αίτησή σας εκκρεμεί', 'Your application is pending'),
          m.status === 'rejected'
            ? T('<p>Για οποιαδήποτε απορία <a href="' + A.home + 'contact/">επικοινωνήστε μαζί μας</a>.</p>',
              '<p>If you have any questions, <a href="' + A.home + 'contact/">contact us</a>.</p>')
            : faculty
              ? T('<p>Η περιοχή μελών ανοίγει μόλις επιβεβαιώσουμε την ιδιότητά σας ως μέλους ΔΕΠ ΣΕΜΦΕ. Δεν χρειάζεται συνδρομή.</p>',
                '<p>The members\' area opens as soon as we confirm that you are a SEMFE faculty member. No membership fee is needed.</p>')
              : T('<p>Η περιοχή μελών ανοίγει μόλις ενεργοποιηθεί η ιδιότητά σας: αφού ελέγξουμε τα στοιχεία σας και λάβουμε τη συνδρομή των ' + fee + '€.</p>',
                '<p>The members\' area opens as soon as your membership is activated: once we have checked your details and received the €' + fee + ' membership fee.</p>'),
          '<a class="btn btn-dark" href="' + A.home + 'account/">' + T('Ο λογαριασμός μου', 'My account') + '</a>' +
          (faculty || m.status === 'rejected' ? '' : '<a class="btn btn-outline" href="' + A.home + 'support/#katathesi">' + T('Τρόποι πληρωμής', 'Ways to pay') + '</a>'));
      }
      // asked to be listed when applying and now active: list them once (account.js does the same)
      // (the place line is STORED and read on both languages' pages: written in Greek, lang left out)
      var listSelf = m && m.status === 'active' && m.consentDirectory
        ? db.collection('directory').doc(u.uid).get().then(function (ds) {
            if (ds.exists) return;
            return db.collection('directory').doc(u.uid).set({
              name: m.firstName + ' ' + m.lastName, gradYear: m.gradYear || null,
              direction: m.direction || '', employer: m.employer || '', position: m.position || '',
              city: window.SEMFE_PROFILE ? window.SEMFE_PROFILE.placeLine(m.city, m.country) : (m.city || ''),
              linkedin: m.linkedin || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }).catch(function () {})
        : Promise.resolve();
      return listSelf.then(function () { return db.collection('directory').get(); }).then(function (qs) {
        rows = [];
        qs.forEach(function (d) { var x = d.data(); x.id = d.id; rows.push(x); });
        rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), L.lang); });
        renderArea(u, m, admin);
      });
    }).catch(function (e) {
      html('<div class="notice err"><strong>' + T('Δεν ήταν δυνατή η φόρτωση', 'This could not be loaded') + '</strong><p>' + esc(A.friendly(e)) + '</p></div>');
    });
  });

  function renderArea(u, m, admin) {
    var paid = m ? (m.duesYears || []).slice().sort() : [];
    var listed = rows.some(function (r) { return r.id === u.uid; });
    var who = m ? m.firstName + ' ' + m.lastName : A.displayName(u);
    var s = '<div class="acct-grid"><div class="panel"><span class="eyebrow">' + T('Καλώς ήρθατε', 'Welcome') + '</span><h2' + langOf(who) + '>' + esc(who) + '</h2>' +
      (m && m.status === 'active' && m.stage === 'faculty'
        ? '<p><span class="badge ok">' + T('Πρόσβαση μέλους', 'Member access') + '</span></p><p class="muted">' + T('Μέλος ΔΕΠ ΣΕΜΦΕ.', 'SEMFE faculty member.') + '</p>'
        : m && m.status === 'active'
        ? '<p><span class="badge ok">' + T('Ενεργό μέλος', 'Active member') + '</span></p><p class="muted">' +
          (paid.length ? T('Συνδρομές: ', 'Membership fees paid: ') + esc(paid.join(', ')) + '.' : T('Δεν έχει καταγραφεί ακόμα συνδρομή.', 'No membership fee has been recorded yet.')) +
          (paid.indexOf(YEAR) === -1
            ? ' <a href="' + A.home + 'support/#katathesi">' + T('Συνδρομή ' + YEAR, YEAR + ' membership fee') + '</a>.'
            : T(' Η συνδρομή ' + YEAR + ' είναι τακτοποιημένη ✓', ' Your ' + YEAR + ' fee is paid ✓')) + '</p>'
        : '<p><span class="badge muted">' + T('Διαχειριστής', 'Administrator') + '</span></p>') +
      '</div><div class="panel"><h2 style="font-size:1.1rem">' + T('Για τα μέλη', 'For members') + '</h2><ul class="checklist">' +
      '<li>' + T('Οι ανακοινώσεις θέσεων εργασίας και πρακτικής άσκησης στέλνονται με e-mail σε όσους το επέλεξαν στην αίτησή τους.',
        'Job and internship announcements are sent by e-mail to those who chose this in their application.') + '</li>' +
      '<li>' + T('Οι προσκλήσεις στις Γενικές Συνελεύσεις ανακοινώνονται δέκα ημέρες πριν από τη σύγκλησή τους.',
        'Invitations to General Assemblies are announced ten days before the Assembly meets.') + '</li>' +
      '<li>' + T('<a href="' + A.root + 'assets/docs/foundation/katastatiko.pdf" target="_blank" rel="noopener">Το Καταστατικό</a> και οι <a href="' + A.home + 'archive/">οικονομικοί απολογισμοί</a>.',
        '<a href="' + A.root + 'assets/docs/foundation/katastatiko.pdf" target="_blank" rel="noopener">The Statute</a> (PDF, in Greek) and the <a href="' + A.home + 'archive/">financial reports</a>.') + '</li></ul>' +
      (m ? '<p style="margin:12px 0 0"><a href="' + A.home + 'account/">' + (listed ? T('Αλλαγή της καταχώρισής μου', 'Change my listing') : T('Εμφάνιση στον κατάλογο', 'Appear in the directory')) + '</a></p>' : '') + '</div></div>';
    s += '<div style="margin-top:28px"><div class="section-head" style="margin-bottom:18px"><span class="eyebrow">' + T('Κατάλογος μελών', 'Members\' directory') + '</span><h2>' + T('Το δίκτυο των αποφοίτων', 'The alumni network') + '</h2>' +
      '<p>' + T(rows.length + ' μέλη έχουν επιλέξει να εμφανίζονται εδώ. Ο κατάλογος είναι ορατός μόνο σε ενεργά μέλη.',
        (rows.length === 1 ? '1 member has' : rows.length + ' members have') + ' chosen to appear here. The directory is visible only to active members.') + '</p></div>' +
      '<div class="dir-tools"><div class="field"><label for="dir-q" class="sr-only">' + T('Αναζήτηση', 'Search') + '</label><input id="dir-q" type="search" placeholder="' + T('Όνομα, εργοδότης, πόλη, έτος…', 'Name, employer, city, year…') + '" autocomplete="off"></div></div>' +
      '<div class="dir" id="dir-list"></div><p class="muted" id="dir-empty" hidden>' + T('Δεν βρέθηκαν μέλη.', 'No members found.') + '</p></div>';
    html(s);
    var input = document.getElementById('dir-q');
    var draw = function () {
      var q = fold(input.value);
      var list = rows.filter(function (r) {
        return !q || fold([r.name, r.employer, r.position, r.city, r.direction, r.gradYear].concat(L.en ? [direction(r.direction), place(r.city)] : []).join(' ')).indexOf(q) !== -1;
      });
      document.getElementById('dir-list').innerHTML = list.map(card).join('');
      document.getElementById('dir-empty').hidden = list.length > 0;
    };
    input.addEventListener('input', draw);
    draw();
  }
  function card(r) {
    var li = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(r.linkedin || '') ? r.linkedin : '';
    var meta = [r.gradYear ? T('Απόφοιτος ' + r.gradYear, 'Graduated in ' + r.gradYear) : '', direction(r.direction)].filter(Boolean).join('\u00a0· ');
    var job = [r.position, r.employer].filter(Boolean).join(', ');
    return '<div class="card"><h3' + langOf(r.name) + '>' + esc(r.name) + '</h3>' +
      '<p class="muted"' + langOf(meta) + ' style="margin:0 0 6px">' + esc(meta) + '</p>' +
      (r.position || r.employer ? '<p' + langOf(job) + ' style="margin:0">' + esc(job) + '</p>' : '') +
      (r.city ? '<p class="muted"' + langOf(place(r.city)) + ' style="margin:4px 0 0">' + esc(place(r.city)) + '</p>' : '') +
      (li ? '<p style="margin:10px 0 0"><a class="linkedin-btn" href="' + esc(li) + '" target="_blank" rel="noopener">LinkedIn</a></p>' : '') + '</div>';
  }
  /* case- and accent-insensitive search, so "καραλης" finds "Κάραλης" */
  function fold(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/ς/g, 'σ');
  }
})();
