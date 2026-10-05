/* SEMFE Alumni: the language of the page, for every script.
 *
 * The site is written in Greek, and every page also has an English copy under
 * en/ (tools/build.mjs builds it from _src/en/). <html lang> says which of the
 * two this page is; the flags in the header switch between them. Loaded on
 * every page, deferred, before site.js and the other scripts.
 *
 * A script writes each message in both languages, side by side, so the two can
 * never drift apart:
 *     var L = window.SEMFE_I18N, T = L.t;
 *     T('Σύνδεση', 'Sign in')
 * links to a page of the site through L.home (the site root on a Greek page,
 * its en/ folder on an English one):   L.home + 'account/#alerts'
 * and to a file, or to a page that has no English copy, through L.root:
 *     L.root + 'assets/docs/foundation/katastatiko.pdf'
 * Dates, numbers and sorting follow L.locale.
 *
 * Announcements are never translated: an English page shows them exactly as
 * their authors wrote them (marked lang="el").
 *
 * Written in plain ES5 so it runs in every browser the site supports. */
(function () {
  'use strict';
  var en = /^en\b/i.test(document.documentElement.getAttribute('lang') || '');
  var link = document.querySelector('link[href$="assets/css/site.css"]');
  var root = link ? link.getAttribute('href').replace(/assets\/css\/site\.css$/, '') : './';
  window.SEMFE_I18N = {
    lang: en ? 'en' : 'el',
    en: en,
    /* the message in this page's language */
    t: function (el, eng) { return en ? eng : el; },
    locale: en ? 'en-GB' : 'el-GR',
    root: root,
    home: root + (en ? 'en/' : ''),
    /* "a, b or c" / "a, b ή c" */
    orList: function (names) {
      names = names || [];
      if (names.length < 2) return names[0] || '';
      return names.slice(0, -1).join(', ') + (en ? ' or ' : ' ή ') + names[names.length - 1];
    },
    /* the site's name in this page's language */
    siteName: en ? 'SEMFE Alumni Association' : ((window.SEMFE || {}).siteName || 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ')
  };
})();
