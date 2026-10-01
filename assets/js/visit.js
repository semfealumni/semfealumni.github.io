/* SEMFE Alumni: the two visit counters behind the «Στατιστικά» page.
 * Loaded on every page except the admin page and the LinkedIn sign-in page
 * (tools/build.mjs, "noTrack"), so the admins' own work and one-time sign-in
 * codes never reach the figures.
 *
 * 1. Google Analytics 4, COOKIELESS: client_storage 'none' keeps nothing on
 *    the visitor's device (no cookie, no local storage), Google signals and ad
 *    personalisation are off, and the address sent is the page's path only,
 *    never its query (a query can carry a one-time code). Storing nothing on
 *    the device is what makes a consent banner unnecessary; turning cookies
 *    on would need one. It loads only once SEMFE.ANALYTICS.ga4 holds a real
 *    Measurement ID (config.js).
 *
 * 2. The site's own counter (the recordVisit Cloud Function): one tiny
 *    message per page view, { page path, first page of the visit?, the site
 *    the visitor came from }. No cookie, no identifier: "first page of the
 *    visit" is remembered in sessionStorage, which the browser forgets when
 *    the tab closes. The function also looks up, on the first page, which
 *    university or company the visitor's network belongs to, and keeps only
 *    that name (functions/netorg.js).
 *
 * Neither runs anywhere but the live site (a copy on a laptop and the test
 * browsers count nothing), for a visitor who asks not to be tracked (Global
 * Privacy Control or Do Not Track), or for a crawler. A failure is silent:
 * this is a statistic, and nobody should wait on it. */
(function () {
  'use strict';
  var A = (window.SEMFE || {}).ANALYTICS || {};
  var hosts = A.hosts || [];
  if (hosts.indexOf(location.hostname) === -1) return;
  var nav = navigator || {};
  if (nav.globalPrivacyControl === true || nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.msDoNotTrack === '1') return;
  if (nav.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed/i.test(nav.userAgent || '')) return;

  /* 1. Google Analytics 4 */
  var id = String(A.ga4 || '');
  if (/^G-[A-Z0-9]{4,}$/.test(id)) {
    window.dataLayer = window.dataLayer || [];
    var gtag = function () { window.dataLayer.push(arguments); };
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', id, {
      page_location: location.origin + location.pathname,
      client_storage: 'none',
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
  }

  /* 2. the site's own counter */
  var url = String(A.visitUrl || '');
  if (!/^https:\/\//.test(url)) return;
  var first = 0;
  try {
    if (!sessionStorage.getItem('semfeVisit')) { sessionStorage.setItem('semfeVisit', '1'); first = 1; }
  } catch (e) {
    return;     // storage refused: better uncounted than every page counted as a new visit
  }
  var ref = '';
  if (first && document.referrer) {
    try { ref = new URL(document.referrer).hostname; } catch (e) { ref = ''; }
    if (hosts.indexOf(ref) !== -1) ref = '';
  }
  var body = JSON.stringify({ p: location.pathname, s: first, r: ref });
  /* a plain-text message: the browser sends it without asking the server
     first, survives the visitor leaving the page, and expects no answer */
  try { if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return; } catch (e) { /* fall through */ }
  try {
    fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'omit', keepalive: true, body: body })
      .catch(function () { /* not deployed, offline, blocked: all fine */ });
  } catch (e) { /* no fetch: not counted */ }
}());
