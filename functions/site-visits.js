/* SEMFE Alumni: the pure half of recordVisit (functions/index.js), the
   site's own record of how it is used.

   Each page view sends one small message (assets/js/visit.js):
     { p: the page's path, s: 1 on the first page of a visit, r: the site
       the visitor came from, on that first page only }
   and the function adds it to ONE document per day, siteVisits/YYYY-MM-DD:
     pv      page views
     seen    visits (the first page of each)
     pages   { path: page views }, only for pages the site really has
     hours   { '00'..'23': visits }, Greek time
     dev     { mobile | tablet | desktop: visits }
     ch      { direct | search | social | email | other: visits }
     unis    { university: visits }, cos { company: visits },
     academic (unnamed academic networks), placed (visits placed at all)
   Counters only: no address, no identifier, no cookie, nothing per person.
   This file decides what a message means; it never touches the network,
   so the offline tests (test-analytics.js) can drive every rule. */
'use strict';

/* Crawlers and test browsers are not visitors. visit.js does not ping from
   them; this is the same rule again on the server, which cannot trust it. */
const BOT_UA = /bot\b|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pagespeed|chrome-lighthouse|ptst|gtmetrix|python-requests|curl\/|wget|phantomjs|selenium|puppeteer|playwright/i;

function isBot(ua) { return !ua || BOT_UA.test(String(ua)); }

function deviceOf(ua) {
  const u = String(ua || '');
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(u)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|BlackBerry|Opera Mini|IEMobile/i.test(u)) return 'mobile';
  return 'desktop';
}

const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.[a-z.]+|yandex\.[a-z.]+|ecosia\.org|baidu\.com|qwant\.com|startpage\.com|search\.brave\.com|brave\.com)$/;
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|twitter\.com|x\.com|t\.co|youtube\.com|reddit\.com|whatsapp\.com|telegram\.org|t\.me|viber\.com|messenger\.com|threads\.net|bsky\.app|tiktok\.com|pinterest\.[a-z.]+)$/;
const EMAIL = /(^|\.)(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|mail\.ru|webmail\.[a-z0-9.-]+|mail\.[a-z0-9.-]+)$/;

/** How a visit arrived, from the host of the page that linked to it. */
function channelOf(refHost, ownHosts) {
  const h = String(refHost || '').toLowerCase().replace(/^www\./, '');
  if (!h || (ownHosts || []).some(o => o.replace(/^www\./, '') === h)) return 'direct';
  if (EMAIL.test(h)) return 'email';
  if (SEARCH.test(h)) return 'search';
  if (SOCIAL.test(h)) return 'social';
  return 'other';
}

/** The day (YYYY-MM-DD) and hour ('00'..'23') in Greece: the site's readers
    are mostly there, and "people read it at 9" should mean 9 in Athens. */
const ATHENS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
});
function athens(date) {
  const parts = {};
  for (const p of ATHENS.formatToParts(date)) parts[p.type] = p.value;
  return { day: parts.year + '-' + parts.month + '-' + parts.day, hour: parts.hour === '24' ? '00' : parts.hour };
}

/** A page's path as the counters know it: "/blog/" for "/blog/index.html",
    "/blog/?cat=x" or "/blog". Anything the site does not have (a typo, a
    probe, the 404 page) is 'other', so nobody can add keys to the record by
    inventing addresses. */
function normPath(p, known) {
  let v = String(p || '').split('#')[0].split('?')[0].slice(0, 300);
  try { v = decodeURI(v); } catch (e) { /* keep it as sent */ }
  if (!v || v.charAt(0) !== '/') v = '/' + v;
  v = v.replace(/\/{2,}/g, '/').replace(/\/index\.html$/, '/');
  if (!/\/$/.test(v) && !/\.[a-z0-9]+$/i.test(v)) v += '/';
  return known && known.indexOf(v) !== -1 ? v : 'other';
}

/** The message the page sent, bounded and checked: never trust its shape. */
function parseMessage(raw) {
  let m = null;
  try { m = JSON.parse(String(raw || '').slice(0, 2000)); } catch (e) { return null; }
  if (!m || typeof m !== 'object') return null;
  const ref = typeof m.r === 'string' ? m.r.toLowerCase().slice(0, 120) : '';
  return {
    path: typeof m.p === 'string' ? m.p : '/',
    first: m.s === 1 || m.s === true,
    ref: /^[a-z0-9.-]+$/.test(ref) ? ref : ''
  };
}

/**
 * The update for one page view: what to add to today's document.
 * `inc` is FieldValue.increment(1) in the function and a marker in the
 * tests. `place` is netorg.place()'s answer, looked up only for the first
 * page of a visit (one look-up per visit, not per page).
 * NESTED MAPS, never dotted field paths: a company name may contain a full
 * stop, and set({merge:true}) takes a nested key literally.
 */
function visitPatch(msg, ctx, inc) {
  const when = athens(ctx.now || new Date());
  const patch = { day: when.day, t: (ctx.now || new Date()).getTime(), pv: inc,
    pages: { [normPath(msg.path, ctx.known)]: inc } };
  if (msg.first) {
    patch.seen = inc;
    patch.hours = { [when.hour]: inc };
    patch.dev = { [deviceOf(ctx.ua)]: inc };
    patch.ch = { [channelOf(msg.ref, ctx.ownHosts)]: inc };
    const p = ctx.place;
    if (p && p.kind === 'university' && p.name) { patch.unis = { [p.name]: inc }; patch.placed = inc; }
    else if (p && p.kind === 'company' && p.name) { patch.cos = { [p.name]: inc }; patch.placed = inc; }
    else if (p && p.kind === 'academic') { patch.academic = inc; patch.placed = inc; }
    if (ctx.v6) patch.v6 = inc;
  }
  return { day: when.day, patch };
}

module.exports = { BOT_UA, isBot, deviceOf, channelOf, athens, normPath, parseMessage, visitPatch };
