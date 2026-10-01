/* SEMFE Alumni: the e-mail alerts (account/ > «Ειδοποιήσεις με e-mail»).

   A registered member ticks the kinds of news they want (alert-topics.js:
   the association's announcements, events and meet-ups, the site's own
   news). This file decides, every couple of hours, what has been PUBLISHED
   since the last run and e-mails each member the new items of the kinds
   they chose: one e-mail per member per run, never one per item.

   WHERE THE NEWS COMES FROM: only what any visitor can already see.
     announcements  the site's own feed.json (built by tools/build.mjs from
                    _src/posts/), read from the live site, so an announcement
                    is mailed when it is on the site, not when it is written
     «Τι νέο»       changelog.json from the live site + the admins' decisions
                    in Firestore newsOverrides, through assets/js/news.js
                    (copied here): an entry is mailed when an admin APPROVES
                    it, and never before

   NOTHING IS SENT TWICE, AND NOTHING OLD IS SENT AT ALL. Firestore
   alertState/ledger holds every item ever seen. The very first run only
   records what is already published (so switching this on mails nobody the
   back-catalogue); every later run mails what is not in the ledger, and
   CLAIMS those items in a transaction before sending, so two runs at once
   cannot both mail them. A run that cannot read a source mails nothing and
   claims nothing: the items go out on the next run. If e-mail is switched
   off (SMTP_USER without an @), nothing is claimed either.

   WHO GETS IT: alertPrefs/{uid} (firestore.rules: written by the member,
   the address pinned to their confirmed sign-in e-mail), and only while
   their application (members/{uid}) is pending or active.

   UNSUBSCRIBING: every e-mail carries a personal link (and the
   List-Unsubscribe headers mail programs show as a button) to the
   alertsUnsubscribe function. Its key `k` is a random string the function
   stores on the member's alertPrefs document the first time it mails them;
   the link switches every alert off. A GET only shows a page with a button
   (link checkers in mail systems open links by themselves; a GET must never
   unsubscribe anyone), a POST does it. */
'use strict';
const crypto = require('crypto');
const T = require('./alert-topics');
const N = require('./news');

const PREFS = 'alertPrefs';
const LEDGER = ['alertState', 'ledger'];
const ORG = 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ';
const MAX_LIST = 20;                         // items listed in one e-mail; the rest by a link
const UID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const KEY_RE = /^[A-Za-z0-9_-]{20,64}$/;
const SENDABLE = ['pending', 'active'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function str(v) { return typeof v === 'string' ? v : ''; }
function day(v) { const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v)); return m ? m[1] : ''; }
const MONTHS = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
function greekDate(d) { const p = d.split('-').map(Number); return p.length === 3 && p[1] ? p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0] : ''; }

/* ---- the news, as items { key, topic, title, summary, url, date } -------- */

/** The announcements in feed.json that belong to an alert. Only addresses
    on the feed's own site are taken (the feed is fetched, so it is checked);
    an item is known by its PATH, so www or not, or a later move of the site,
    never makes old announcements look new. */
function originOf(u) { try { const x = new URL(u); return x.protocol === 'https:' ? x.origin : ''; } catch (e) { return ''; } }
function itemsFromFeed(feed, site) {
  const out = [], base = originOf(feed && feed.home_page_url) || originOf(site);
  ((feed && Array.isArray(feed.items)) ? feed.items : []).forEach(it => {
    const url = str(it && it.url);
    if (!base || originOf(url) !== base || /[\s"'<>]/.test(url)) return;
    const topic = T.topicOfCategory(Array.isArray(it.tags) ? str(it.tags[0]) : '');
    if (!topic || !str(it.title).trim()) return;
    out.push({ key: 'post:' + new URL(url).pathname.replace(/^\//, ''), topic, title: str(it.title).trim(), summary: str(it.summary).trim(), url, date: day(it.date_published) });
  });
  return out;
}

/** The «Τι νέο» entries an admin has approved, as the site shows them. */
function itemsFromNews(changelog, decisions, site) {
  const topic = (T.TOPICS.find(t => t.source === 'news') || {}).key;
  if (!topic) return [];
  return N.split(changelog && changelog.updates, decisions || {}).approved.map(e => {
    const u = str(e.url);
    const url = /^https:\/\//.test(u) ? u : u ? site + u.replace(/^\//, '') : site + 'whats-new/';
    return { key: 'news:' + e.id, topic, title: e.title, summary: e.summary, url, date: e.date };
  });
}

/** The items a member wants, of those just published. */
function wanted(topics, items) {
  const want = T.clean(topics);
  return items.filter(i => want.indexOf(i.topic) !== -1);
}

/* ---- the e-mail ---------------------------------------------------------- */
function shell(title, body, cfg) {
  return '<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>' + esc(title) + '</title></head><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f1c2e">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px 16px">' +
    '<div style="background:#0a2240;color:#fff;border-radius:14px 14px 0 0;padding:16px 22px;font-weight:bold;letter-spacing:.04em">ΣΕΜΦΕ ΕΜΠ · Alumni</div>' +
    '<div style="background:#fff;border:1px solid #dbe3ec;border-top:0;border-radius:0 0 14px 14px;padding:22px;line-height:1.55;font-size:15px">' + body + '</div>' +
    '<p style="font-size:12px;color:#5b6b80;margin:14px 4px 0">' + esc(ORG) + ' · <a href="' + esc(cfg.site) + '" style="color:#12355b">' + esc(cfg.site.replace(/^https:\/\//, '').replace(/\/$/, '')) + '</a></p>' +
    '</div></body></html>';
}

/** One member's e-mail: their new items, grouped by alert in TOPICS order.
    cfg = { site, from, unsubUrl } (unsubUrl: this member's own link). */
function render(items, cfg) {
  const groups = T.TOPICS.map(t => ({ t, list: items.filter(i => i.topic === t.key) })).filter(g => g.list.length);
  const total = items.length;
  const subject = total === 1 ? items[0].title : total + ' νέα από τον Σύλλογο Διπλωματούχων ΣΕΜΦΕ';
  const prefs = cfg.site + 'account/#alerts';
  let shown = 0;
  const text = [], html = [];
  html.push('<p style="margin-top:0">' + (total === 1 ? 'Δημοσιεύθηκε κάτι νέο' : 'Δημοσιεύθηκαν ' + total + ' νέα') + ' από όσα έχετε επιλέξει να μαθαίνετε:</p>');
  groups.forEach(g => {
    html.push('<h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#5b6b80;margin:22px 0 8px">' + esc(g.t.label) + '</h2>');
    text.push('', g.t.label.toUpperCase());
    g.list.forEach(i => {
      if (shown >= MAX_LIST) return;
      shown++;
      html.push('<div style="margin:0 0 16px">' +
        '<a href="' + esc(i.url) + '" style="font-size:17px;font-weight:bold;color:#12355b;text-decoration:none">' + esc(i.title) + '</a>' +
        (i.date ? '<div style="font-size:13px;color:#5b6b80;margin-top:2px">' + esc(greekDate(i.date)) + '</div>' : '') +
        (i.summary && i.summary.replace(/[.\s]+$/, '') !== i.title.replace(/[.\s]+$/, '') ? '<div style="margin-top:4px">' + esc(i.summary) + '</div>' : '') +
        '</div>');
      text.push('', i.title, i.date ? greekDate(i.date) : '', i.summary && i.summary !== i.title ? i.summary : '', i.url);
    });
  });
  if (shown < total) {
    html.push('<p>…και ακόμη ' + (total - shown) + ': <a href="' + esc(cfg.site + 'blog/') + '" style="color:#12355b">όλες οι ανακοινώσεις</a>, <a href="' + esc(cfg.site + 'whats-new/') + '" style="color:#12355b">Τι νέο</a>.</p>');
    text.push('', '…και ακόμη ' + (total - shown) + ': ' + cfg.site + 'blog/');
  }
  html.push('<p style="font-size:13px;color:#5b6b80;border-top:1px solid #dbe3ec;padding-top:14px;margin:22px 0 0">' +
    'Λαμβάνετε αυτό το e-mail επειδή το επιλέξατε στον λογαριασμό σας. ' +
    '<a href="' + esc(prefs) + '" style="color:#12355b">Αλλαγή των επιλογών σας</a> · ' +
    '<a href="' + esc(cfg.unsubUrl) + '" style="color:#12355b">Διακοπή όλων των ειδοποιήσεων</a></p>');
  text.push('', '--', 'Λαμβάνετε αυτό το e-mail επειδή το επιλέξατε στον λογαριασμό σας.', 'Αλλαγή των επιλογών σας: ' + prefs, 'Διακοπή όλων των ειδοποιήσεων: ' + cfg.unsubUrl);
  return {
    subject,
    html: shell(subject, html.join(''), cfg),
    text: text.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim() + '\n',
    headers: { 'List-Unsubscribe': '<' + cfg.unsubUrl + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  };
}

function newKey() { return crypto.randomBytes(24).toString('base64url'); }
function unsubLink(base, uid, k) { return base + '?u=' + encodeURIComponent(uid) + '&k=' + encodeURIComponent(k); }

/* ---- the run --------------------------------------------------------------
   deps (functions/index.js gives the real ones; test-alerts.js fakes them):
     fetchJson(url)        the site's feed.json / changelog.json
     decisions()           {id: {status, title, summary}} from newsOverrides
     ledger()              the keys already seen, or null before the first run
     seed(keys)            the first run: record them, mail nothing
     claim(keys)           add the not-yet-seen ones in a transaction; returns those it added
     prefs()               [{uid, topics, email, k}]
     statuses(uids)        {uid: application status}
     setKey(uid, k)        store a member's unsubscribe key
     send(msg)             one e-mail; rejects with code MAIL_OFF when e-mail is off
     mailOn                false when SMTP_USER has no @
     log(text)
   cfg = { site, from, unsubBase } */
async function run(deps, cfg) {
  const site = cfg.site;
  // 1. what is published now (a failure throws: nothing claimed, retried next run)
  const [feed, changelog, decisions] = await Promise.all([
    deps.fetchJson(site + 'feed.json'), deps.fetchJson(site + 'changelog.json'), deps.decisions()
  ]);
  if (!feed || !Array.isArray(feed.items)) throw new Error('feed.json has no items list');
  const items = itemsFromFeed(feed, site).concat(itemsFromNews(changelog, decisions, site));
  const seen = await deps.ledger();
  // 2. the first run: what is already published is not news
  if (!seen) {
    await deps.seed(items.map(i => i.key));
    return 'first run: ' + items.length + ' published item(s) recorded, nothing mailed';
  }
  const known = new Set(seen);
  const fresh = items.filter(i => !known.has(i.key));
  if (!fresh.length) return 'nothing new (' + items.length + ' published)';
  if (!deps.mailOn) return fresh.length + ' new item(s) waiting: e-mail is not set up (SMTP_USER)';
  // 3. claim them before sending: two runs at once cannot both mail them
  const claimed = new Set(await deps.claim(fresh.map(i => i.key)));
  const mine = fresh.filter(i => claimed.has(i.key));
  if (!mine.length) return 'another run claimed the new items';
  // 4. who wants which
  const prefs = (await deps.prefs()).filter(p => p && UID_RE.test(p.uid || '') && /@/.test(p.email || '') && wanted(p.topics, mine).length);
  const status = prefs.length ? await deps.statuses(prefs.map(p => p.uid)) : {};
  let sent = 0, failed = 0, skipped = 0;
  for (const p of prefs) {
    if (SENDABLE.indexOf(status[p.uid]) === -1) { skipped++; continue; }
    try {
      let k = p.k;
      if (!KEY_RE.test(k || '')) { k = newKey(); await deps.setKey(p.uid, k); }
      const m = render(wanted(p.topics, mine), { site, unsubUrl: unsubLink(cfg.unsubBase, p.uid, k) });
      await deps.send({ from: cfg.from, to: p.email, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
      sent++;
    } catch (e) {
      failed++;
      deps.log('alert to ' + p.uid + ' failed: ' + (e && e.message || e));
    }
  }
  return mine.length + ' new item(s) [' + mine.map(i => i.key).join(', ') + ']: ' + sent + ' e-mail(s) sent' +
    (failed ? ', ' + failed + ' failed' : '') + (skipped ? ', ' + skipped + ' skipped (no pending or active application)' : '');
}

/* ---- the unsubscribe link ------------------------------------------------- */
function page(title, body, site) {
  return '<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + esc(title) + '</title></head>' +
    '<body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f1c2e">' +
    '<div style="max-width:560px;margin:0 auto;padding:40px 16px">' +
    '<div style="background:#0a2240;color:#fff;border-radius:14px 14px 0 0;padding:16px 22px;font-weight:bold;letter-spacing:.04em">ΣΕΜΦΕ ΕΜΠ · Alumni</div>' +
    '<div style="background:#fff;border:1px solid #dbe3ec;border-top:0;border-radius:0 0 14px 14px;padding:24px;line-height:1.55;font-size:16px">' +
    '<h1 style="font-size:22px;margin:0 0 12px">' + esc(title) + '</h1>' + body + '</div>' +
    '<p style="font-size:13px;margin:14px 4px"><a href="' + esc(site) + '" style="color:#12355b">' + esc(site.replace(/^https:\/\//, '').replace(/\/$/, '')) + '</a></p>' +
    '</div></body></html>';
}

/** The alertsUnsubscribe function. req: { method, query, body }; deps:
    get(uid) -> {k, topics} | null, stop(uid). Returns { status, html }. */
async function unsubscribe(req, deps, cfg) {
  const q = req.query || {};
  const uid = str(q.u), k = str(q.k);
  const prefs = cfg.site + 'account/#alerts';
  const bad = { status: 400, html: page('Ο σύνδεσμος δεν ισχύει', '<p>Ο σύνδεσμος διακοπής δεν είναι σωστός ή έχει λήξει. Μπορείτε να αλλάξετε τις ειδοποιήσεις σας από τον <a href="' + esc(prefs) + '" style="color:#12355b">λογαριασμό σας</a>.</p>', cfg.site) };
  if (!UID_RE.test(uid) || !KEY_RE.test(k)) return bad;
  if (req.method === 'GET' || req.method === 'HEAD') {
    // a link checker opening the link must change nothing: ask first
    return { status: 200, html: page('Διακοπή των ειδοποιήσεων',
      '<p>Πατήστε το κουμπί για να σταματήσετε όλες τις ειδοποιήσεις με e-mail του Συλλόγου.</p>' +
      '<form method="post" action="?u=' + encodeURIComponent(uid) + '&amp;k=' + encodeURIComponent(k) + '" style="margin:18px 0">' +
      '<button type="submit" style="font:inherit;font-weight:bold;background:#12355b;color:#fff;border:0;border-radius:999px;padding:12px 22px;cursor:pointer">Διακοπή των ειδοποιήσεων</button></form>' +
      '<p style="font-size:14px;color:#5b6b80">Ή διαλέξτε ποιες θέλετε να κρατήσετε από τον <a href="' + esc(prefs) + '" style="color:#12355b">λογαριασμό σας</a>.</p>', cfg.site) };
  }
  if (req.method !== 'POST') return { status: 405, html: page('Μη επιτρεπτό', '<p>—</p>', cfg.site) };
  const doc = await deps.get(uid);
  if (!doc || doc.k !== k) return bad;
  await deps.stop(uid);
  return { status: 200, html: page('Οι ειδοποιήσεις σταμάτησαν',
    '<p>Δεν θα λαμβάνετε πλέον ειδοποιήσεις με e-mail από τον Σύλλογο.</p>' +
    '<p style="font-size:14px;color:#5b6b80">Αλλάξατε γνώμη; Επιλέξτε ξανά από τον <a href="' + esc(prefs) + '" style="color:#12355b">λογαριασμό σας</a>.</p>', cfg.site) };
}

module.exports = { PREFS, LEDGER, MAX_LIST, KEY_RE, SENDABLE, itemsFromFeed, itemsFromNews, wanted, render, run, unsubscribe, unsubLink, newKey };
