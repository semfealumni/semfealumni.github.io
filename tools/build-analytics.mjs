#!/usr/bin/env node
/* Builds data/analytics.json, the figures of the «Στατιστικά» page
 * (analytics/), and refreshes the members' anonymous statistics.
 *
 *   node tools/build-analytics.mjs             build and write
 *   node tools/build-analytics.mjs --dry-run   build, write nothing, print a summary
 *   node tools/build-analytics.mjs --scan      say what each source would give
 *   node tools/build-analytics.mjs --selftest  offline checks, no credentials
 *
 * Run daily by .github/workflows/analytics.yml. Setup: ANALYTICS-SETUP.md.
 *
 * TWO SOURCES FOR THE VISITS, each switched on by its own secret:
 *   site  the site's own counter: Firestore siteVisits/{day}, written by the
 *         recordVisit Cloud Function. Needs FIREBASE_SERVICE_ACCOUNT (the
 *         same key the feedback workflow uses).
 *   ga4   Google Analytics 4, read through its Data API. Needs
 *         GA4_PROPERTY_ID (the property's number; the workflow names
 *         361541833, "SEMFE Alumni - GA4", the property the old site already
 *         reported to) and a service-account key given "Viewer" on that
 *         property: GA4_SERVICE_ACCOUNT if set, else the FIREBASE_SERVICE_ACCOUNT
 *         key itself, so one key can serve both. It reads the property's
 *         WHOLE history: the old site lived at the same address with the
 *         same page addresses, so its visits continue straight into ours.
 * Who answers for what is settled by what each one HAS:
 *   visits and page views per day   site, else GA4 (a day goes to one, never both)
 *   pages, devices, how they arrive site, else GA4
 *   hour of the day                 site only (Greek time, exact)
 *   countries, cities, referring sites   GA4 only
 *   universities and companies      site only (GA4 cannot see networks)
 *
 * AN UNREACHABLE SOURCE CHANGES NOTHING. A source whose secret is missing is
 * simply left out; a source that is set up but fails to answer stops the
 * build before anything is written, so the committed file stands. A half
 * file is a blank dashboard. One exception: Google Analytics, until it has
 * answered ONCE (the committed file names it in `sources`), is still being
 * set up, so a refusal is a warning and the rest is published; leaving it
 * out then loses nothing the page already shows.
 *
 * The members' statistics (publicStats/members) are recounted here too,
 * with the same function the memberStats Cloud Function uses
 * (functions/member-stats.js): the first count, and a repair if a change was
 * ever missed. Independent of the visits: either can fail alone. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createSign } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/analytics.json');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run'), SCAN = args.includes('--scan'), SELFTEST = args.includes('--selftest');
const req = createRequire(path.join(ROOT, 'functions', 'package.json'));

export const WINDOWS = { 30: 30, 90: 90, 365: 365, all: null };
const HOSTS = ['semfealumni.gr', 'www.semfealumni.gr'];
const GA_START = '2015-08-14';               // the earliest day the Data API serves: the property's whole history
const TOP = { pages: 20, cities: 20, countries: 25, sources: 15, unis: 40, companies: 40 };

/* ---------------------------------------------------------------- dates */
const ATHENS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' });
export function athensDay(d) { return ATHENS.format(d); }
export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function between(day, from, to) { return day >= from && day <= to; }

/* --------------------------------------------------------- the site's own */
function addMap(into, map) { for (const [k, v] of Object.entries(map || {})) if (typeof v === 'number' && v > 0) into[k] = (into[k] || 0) + v; }
function topItems(map, max, keyName) {
  return Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max).map(([k, v]) => ({ [keyName || 'k']: k, n: v }));
}

/** The site's counters over one window: { seen, pv, pages, hours, dev, ch, unis, cos, academic }. */
export function siteWindow(docs, from, to) {
  const w = { seen: 0, pv: 0, pages: {}, hours: new Array(24).fill(0), dev: {}, ch: {}, unis: {}, cos: {}, academic: 0, placed: 0 };
  for (const [day, d] of Object.entries(docs)) {
    if (!between(day, from, to)) continue;
    w.seen += d.seen || 0;
    w.pv += d.pv || 0;
    w.academic += d.academic || 0;
    w.placed += d.placed || 0;
    addMap(w.pages, d.pages);
    addMap(w.dev, d.dev);
    addMap(w.ch, d.ch);
    addMap(w.unis, d.unis);
    addMap(w.cos, d.cos);
    for (const [h, v] of Object.entries(d.hours || {})) { const i = +h; if (i >= 0 && i < 24 && typeof v === 'number') w.hours[i] += v; }
  }
  return w;
}

/* ------------------------------------------------------- Google Analytics */
const CHANNELS = { 'Direct': 'direct', 'Organic Search': 'search', 'Paid Search': 'search', 'Organic Social': 'social',
  'Paid Social': 'social', 'Email': 'email', 'Referral': 'other' };
export function channelKey(g) { return CHANNELS[g] || 'other'; }

/** A Data API report as rows of { dims: [...], mets: [...] }. */
export function reportRows(rep) {
  return ((rep && rep.rows) || []).map(r => ({
    dims: (r.dimensionValues || []).map(v => String(v.value == null ? '' : v.value)),
    mets: (r.metricValues || []).map(v => Number(v.value) || 0)
  }));
}
function unset(v) { return !v || v === '(not set)' || v === '(other)'; }

/** One window's GA4 reports turned into the page's blocks. */
export function gaWindow(reps, normPage) {
  const out = {};
  const countries = {}, cities = {}, sources = {}, channels = {}, devices = {}, pages = {};
  for (const r of reportRows(reps.countries)) if (!unset(r.dims[0])) countries[r.dims[0]] = (countries[r.dims[0]] || 0) + r.mets[0];
  for (const r of reportRows(reps.cities)) if (!unset(r.dims[0])) { const k = r.dims[0] + '|' + (unset(r.dims[1]) ? '' : r.dims[1]); cities[k] = (cities[k] || 0) + r.mets[0]; }
  for (const r of reportRows(reps.sources)) if (!unset(r.dims[0]) && r.dims[0] !== '(direct)') sources[r.dims[0]] = (sources[r.dims[0]] || 0) + r.mets[0];
  for (const r of reportRows(reps.channels)) { const k = channelKey(r.dims[0]); channels[k] = (channels[k] || 0) + r.mets[0]; }
  for (const r of reportRows(reps.devices)) if (/^(desktop|mobile|tablet)$/.test(r.dims[0])) devices[r.dims[0]] = (devices[r.dims[0]] || 0) + r.mets[0];
  for (const r of reportRows(reps.pages)) { const p = normPage(r.dims[0]); if (p) pages[p] = (pages[p] || 0) + r.mets[0]; }
  if (reps.countries) out.countries = topItems(countries, TOP.countries);
  if (reps.cities) out.cities = topItems(cities, TOP.cities).map(x => { const [name, k] = x.k.split('|'); return { name, k, n: x.n }; });
  if (reps.sources) out.sources = topItems(sources, TOP.sources, 'name');
  if (reps.channels) out.channels = topItems(channels, 10);
  if (reps.devices) out.devices = topItems(devices, 5);
  if (reps.pages) out.pages = pages;
  return out;
}

/* -------------------------------------------------------------- merging */
/** Visits and page views per day: a day the site counted goes to the site,
    every other day to GA4. */
export function mergeDays(siteDocs, gaDays) {
  const days = {};
  for (const [d, row] of Object.entries(gaDays || {})) days[d] = [row[0] || 0, row[1] || 0];
  for (const [d, doc] of Object.entries(siteDocs || {})) if ((doc.seen || 0) + (doc.pv || 0) > 0) days[d] = [doc.seen || 0, doc.pv || 0];
  return Object.fromEntries(Object.entries(days).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/**
 * The whole file.
 *   site   { docs } or null (not set up)
 *   ga     { days, windows: { key: blocks } } or null
 *   titles path -> page title (functions/site-paths.json)
 *   today  'YYYY-MM-DD' in Greece; the last day counted is the day before
 */
export function buildFile({ site, ga, titles, today, generated }) {
  const to = addDays(today, -1);
  const days = mergeDays(site && site.docs, ga && ga.days);
  const first = Object.keys(days)[0] || '';
  const file = { v: 1, about: 'The figures of the Στατιστικά page (analytics/), rebuilt daily by tools/build-analytics.mjs.',
    generated, sources: {}, days, windows: {} };
  if (site) {
    file.sources.site = { days: Object.keys(site.docs).length };
    // the first day the site's own counter counted: the page says where the line changes source
    const counted = Object.keys(site.docs).filter(d => (site.docs[d].seen || 0) + (site.docs[d].pv || 0) > 0).sort();
    if (counted.length) file.sources.site.first = counted[0];
  }
  if (ga) file.sources.ga4 = { days: Object.keys(ga.days || {}).length };
  if (!first || first > to) return file;                       // nothing measured yet

  for (const [key, len] of Object.entries(WINDOWS)) {
    // a period never starts before the first day anything was measured
    const start = len ? addDays(to, -(len - 1)) : first;
    const from = start < first ? first : start;
    if (from > to) continue;
    const w = { from, to, visits: 0, pageviews: 0 };
    for (const [d, row] of Object.entries(days)) if (between(d, from, to)) { w.visits += row[0]; w.pageviews += row[1]; }
    const s = site ? siteWindow(site.docs, from, to) : null;
    const g = ga && ga.windows && ga.windows[key] ? ga.windows[key] : null;
    const title = p => titles[p] || p;
    const pageItems = map => topItems(map, TOP.pages, 'path').map(x => ({ path: x.path, title: title(x.path), n: x.n }));
    // pages: the site when it counted any, else GA4
    if (s && s.pv > 0) { const pg = Object.assign({}, s.pages); delete pg.other; w.pages = { src: 'site', items: pageItems(pg) }; }
    else if (g && g.pages) w.pages = { src: 'ga4', items: pageItems(g.pages) };
    if (s && s.seen > 0) {
      w.hours = { src: 'site', items: s.hours };
      w.devices = { src: 'site', items: topItems(s.dev, 5) };
      w.channels = { src: 'site', items: topItems(s.ch, 10) };
      const unis = topItems(s.unis, TOP.unis, 'name');
      const cos = topItems(s.cos, 10000, 'name');
      const shown = cos.filter(c => c.n >= 2).slice(0, TOP.companies);
      w.unis = { src: 'site', items: unis };
      w.companies = { src: 'site', items: shown, hidden: cos.length - shown.length };
      w.placed = { seen: s.seen, unis: Object.values(s.unis).reduce((a, b) => a + b, 0) + s.academic, academic: s.academic,
        companies: Object.values(s.cos).reduce((a, b) => a + b, 0) };
    } else if (g) {
      if (g.devices) w.devices = { src: 'ga4', items: g.devices };
      if (g.channels) w.channels = { src: 'ga4', items: g.channels };
    }
    if (g && g.countries) w.countries = { src: 'ga4', items: g.countries };
    if (g && g.cities) w.cities = { src: 'ga4', items: g.cities };
    if (g && g.sources) w.sources = { src: 'ga4', items: g.sources };
    file.windows[key] = w;
  }
  return file;
}

/** A path as the site's page list knows it, or '' (GA4 reports any path
    it was sent, including ones the site does not have). */
export function pageNormaliser(known) {
  return p => {
    let v = String(p || '').split('?')[0].split('#')[0];
    if (!v.startsWith('/')) v = '/' + v;
    v = v.replace(/\/{2,}/g, '/').replace(/\/index\.html$/, '/');
    if (!/\/$/.test(v) && !/\.[a-z0-9]+$/i.test(v)) v += '/';
    return known.includes(v) ? v : '';
  };
}

/* ----------------------------------------------------------- the sources */
function key(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { throw new Error(name + ' is not valid JSON'); }
}
function projectId() {
  try { return JSON.parse(readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default; } catch (e) { return ''; }
}

async function firestore() {
  const sa = key('FIREBASE_SERVICE_ACCOUNT');
  if (!sa) return null;
  const want = projectId();
  if (want && sa.project_id && sa.project_id !== want) throw new Error(`FIREBASE_SERVICE_ACCOUNT is for ${sa.project_id}, but .firebaserc names ${want}`);
  const { initializeApp, cert, getApps } = req('firebase-admin/app');
  const { getFirestore, FieldValue } = req('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: cert(sa), projectId: want || sa.project_id });
  return { db: getFirestore(), FieldValue };
}

async function readSite(fs) {
  const qs = await fs.db.collection('siteVisits').get();
  const docs = {};
  qs.forEach(d => { if (/^\d{4}-\d{2}-\d{2}$/.test(d.id)) docs[d.id] = d.data(); });
  return { docs };
}

async function gaToken(sa) {
  const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + sig
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('GA4 sign-in refused (' + res.status + '): ' + (j.error_description || j.error || ''));
  return j.access_token;
}

/** Which secret reads Google Analytics: its own key, else the Firebase one. */
export function gaKeyName(env) {
  if (env.GA4_SERVICE_ACCOUNT) return 'GA4_SERVICE_ACCOUNT';
  if (env.FIREBASE_SERVICE_ACCOUNT) return 'FIREBASE_SERVICE_ACCOUNT';
  return '';
}
/** A Google Analytics failure stops the build only once it has answered
    before; until then it is still being set up (see the header). */
export function gaFailureStops(prev) { return !!(prev && prev.sources && prev.sources.ga4); }

async function readGa(known) {
  const keyName = gaKeyName(process.env);
  const sa = keyName ? key(keyName) : null;
  const property = String(process.env.GA4_PROPERTY_ID || '').trim();
  if (!sa || !property || /PASTE/.test(property)) return null;
  console.log(`ga4: property ${property}, read with ${keyName} (${sa.client_email || 'no client_email'})`);
  if (!/^\d+$/.test(property)) throw new Error('GA4_PROPERTY_ID must be the property NUMBER (Admin > Property details), not the G-… Measurement ID');
  const token = await gaToken(sa);
  const hostFilter = { filter: { fieldName: 'hostName', inListFilter: { values: HOSTS } } };
  async function report(body) {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ dimensionFilter: hostFilter, keepEmptyRows: false }, body))
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('GA4 report refused (' + res.status + '): ' + ((j.error && j.error.message) || ''));
    return j;
  }
  const yesterday = addDays(athensDay(new Date()), -1);
  const daily = await report({ dateRanges: [{ startDate: GA_START, endDate: yesterday }], dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }], limit: 10000 });
  const days = {};
  for (const r of reportRows(daily)) {
    const d = r.dims[0];
    if (/^\d{8}$/.test(d)) days[d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6)] = [r.mets[0], r.mets[1]];
  }
  const first = Object.keys(days).sort()[0];
  const windows = {};
  if (first) {
    for (const [k, len] of Object.entries(WINDOWS)) {
      const range = [{ startDate: len ? addDays(yesterday, -(len - 1)) : first, endDate: yesterday }];
      const one = (dims, metric, limit) => report({ dateRanges: range, dimensions: dims.map(name => ({ name })), metrics: [{ name: metric }],
        orderBys: [{ metric: { metricName: metric }, desc: true }], limit });
      const reps = {
        countries: await one(['countryId'], 'sessions', 50),
        cities: await one(['city', 'countryId'], 'sessions', 50),
        sources: await one(['sessionSource'], 'sessions', 30),
        channels: await one(['sessionDefaultChannelGroup'], 'sessions', 20),
        devices: await one(['deviceCategory'], 'sessions', 10),
        pages: await one(['pagePath'], 'screenPageViews', 100)
      };
      windows[k] = gaWindow(reps, pageNormaliser(known));
    }
  }
  return { days, windows };
}

async function publishMembers(fs) {
  const stats = req('./member-stats.js');
  const qs = await fs.db.collection('members').get();
  const out = stats.memberStats(qs.docs.map(d => d.data()), new Date());
  if (!DRY && !SCAN) await fs.db.collection('publicStats').doc('members').set({ json: JSON.stringify(out), t: fs.FieldValue.serverTimestamp() });
  return out;
}

/* ------------------------------------------------------------------ main */
async function main() {
  const paths = JSON.parse(readFileSync(path.join(ROOT, 'functions/site-paths.json'), 'utf8'));
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  let fs = null, site = null, ga = null, failed = false;
  try { fs = await firestore(); } catch (e) { console.log('::error::' + e.message); failed = true; }
  if (!fs && !failed) console.log('::notice::FIREBASE_SERVICE_ACCOUNT is not set: the site\'s own counter and the members\' statistics are skipped (ANALYTICS-SETUP.md).');
  if (fs) {
    try { site = await readSite(fs); console.log(`site: ${Object.keys(site.docs).length} day(s) in siteVisits` + (Object.keys(site.docs).length ? '' : ' (empty until the recordVisit function is deployed)')); }
    catch (e) { console.log('::error::reading siteVisits failed: ' + e.message); failed = true; }
  }
  try {
    ga = await readGa(paths.paths);
    if (ga) console.log(`ga4: ${Object.keys(ga.days).length} day(s)` + (Object.keys(ga.days).length ? `, from ${Object.keys(ga.days).sort()[0]}` : ''));
    else console.log('::notice::GA4_PROPERTY_ID or a key is not set: Google Analytics is skipped (ANALYTICS-SETUP.md).');
  } catch (e) {
    ga = null;
    if (gaFailureStops(prev)) { console.log('::error::' + e.message); failed = true; }
    else console.log('::warning::Google Analytics did not answer, so it is left out and the rest is published: ' + e.message +
      ' (ANALYTICS-SETUP.md, step 3: turn on the Google Analytics Data API, and give the key\'s e-mail "Viewer" on the property).');
  }

  // the members' statistics: independent of the visits
  let membersFailed = false;
  if (fs) {
    try {
      const m = await publishMembers(fs);
      console.log(`members: ${m.registered} registered, ${m.active} active` + (DRY || SCAN ? ' (not written)' : ' -> publicStats/members'));
    } catch (e) { console.log('::error::member statistics failed: ' + e.message); membersFailed = true; }
  }
  if (SCAN) return failed || membersFailed ? 1 : 0;
  if (!site && !ga && !failed) { console.log('no source is set up yet: data/analytics.json is left as it is.'); return membersFailed ? 1 : 0; }
  if (failed) { console.log('::warning::a source that is set up did not answer: data/analytics.json is left as it is.'); return 1; }

  const today = athensDay(new Date());
  const file = buildFile({ site, ga, titles: paths.titles, today, generated: today });
  // the date says when the figures last CHANGED, so an unchanged day writes nothing
  const same = prev && JSON.stringify(Object.assign({}, prev, { generated: null })) === JSON.stringify(Object.assign({}, file, { generated: null }));
  if (same) file.generated = prev.generated;
  const text = JSON.stringify(file) + '\n';
  const w = file.windows['30'];
  console.log(`analytics.json: ${Object.keys(file.days).length} day(s), last 30 days ${w ? w.visits + ' visits, ' + w.pageviews + ' page views' : 'nothing yet'}`);
  if (DRY) { console.log('dry run: nothing written'); return membersFailed ? 1 : 0; }
  if (prev && same) { console.log('no change'); return membersFailed ? 1 : 0; }
  writeFileSync(OUT, text);
  console.log('written: data/analytics.json');
  return membersFailed ? 1 : 0;
}

/* -------------------------------------------------------------- selftest */
async function selftest() {
  const assert = (await import('node:assert')).default;
  let ok = 0;
  const t = (name, fn) => { fn(); ok++; console.log('ok    ' + name); };
  const titles = { '/': 'Αρχική', '/blog/': 'Ανακοινώσεις', '/support/': 'Εγγραφές & Δωρεές' };
  const known = Object.keys(titles);
  const site = { docs: {
    '2026-10-01': { seen: 10, pv: 25, pages: { '/': 15, '/blog/': 8, other: 2 }, hours: { '09': 6, '21': 4 }, dev: { mobile: 6, desktop: 4 },
      ch: { search: 5, direct: 5 }, unis: { 'Εθνικό Μετσόβιο Πολυτεχνείο': 3 }, cos: { 'Siemens AG': 2, 'Tiny Firm': 1 }, academic: 1, placed: 7 },
    '2026-10-02': { seen: 4, pv: 6, pages: { '/support/': 6 }, hours: { '10': 4 }, dev: { desktop: 4 }, ch: { social: 4 }, unis: {}, cos: { 'Siemens AG': 1 }, placed: 1 }
  } };
  const ga = { days: { '2026-09-29': [3, 5], '2026-09-30': [7, 9], '2026-10-01': [12, 30] }, windows: {
    30: gaWindow({
      countries: { rows: [{ dimensionValues: [{ value: 'GR' }], metricValues: [{ value: '20' }] }, { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '2' }] }] },
      cities: { rows: [{ dimensionValues: [{ value: 'Athens' }, { value: 'GR' }], metricValues: [{ value: '15' }] }] },
      sources: { rows: [{ dimensionValues: [{ value: '(direct)' }], metricValues: [{ value: '9' }] }, { dimensionValues: [{ value: 'google' }], metricValues: [{ value: '6' }] }] },
      channels: { rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '6' }] }, { dimensionValues: [{ value: 'Referral' }], metricValues: [{ value: '2' }] }] },
      devices: { rows: [{ dimensionValues: [{ value: 'mobile' }], metricValues: [{ value: '11' }] }] },
      pages: { rows: [{ dimensionValues: [{ value: '/blog/index.html?x=1' }], metricValues: [{ value: '5' }] }, { dimensionValues: [{ value: '/nope/' }], metricValues: [{ value: '1' }] }] }
    }, pageNormaliser(known))
  } };

  t('a day the site counted goes to the site, every other day to GA4', () => {
    assert.deepStrictEqual(mergeDays(site.docs, ga.days), { '2026-09-29': [3, 5], '2026-09-30': [7, 9], '2026-10-01': [10, 25], '2026-10-02': [4, 6] });
  });
  t('GA4 reports are read defensively and mapped onto the page\'s keys', () => {
    const g = ga.windows[30];
    assert.deepStrictEqual(g.countries, [{ k: 'GR', n: 20 }]);
    assert.deepStrictEqual(g.cities, [{ name: 'Athens', k: 'GR', n: 15 }]);
    assert.deepStrictEqual(g.sources, [{ name: 'google', n: 6 }], '(direct) is not a site');
    assert.deepStrictEqual(g.channels, [{ k: 'search', n: 6 }, { k: 'other', n: 2 }]);
    assert.deepStrictEqual(g.pages, { '/blog/': 5 }, 'only pages the site has');
    assert.deepStrictEqual(reportRows(null), []);
    assert.deepStrictEqual(gaWindow({}, () => ''), {});
  });
  t('the file: windows end yesterday, the site answers what it has, GA4 the rest', () => {
    const f = buildFile({ site, ga, titles, today: '2026-10-03', generated: '2026-10-03' });
    const w = f.windows['30'];
    assert.strictEqual(w.to, '2026-10-02');
    assert.strictEqual(w.from, '2026-09-29', 'the period starts on the first day measured, not 30 days back');
    assert.strictEqual(w.visits, 3 + 7 + 10 + 4);
    assert.strictEqual(w.pageviews, 5 + 9 + 25 + 6);
    assert.deepStrictEqual(w.pages, { src: 'site', items: [{ path: '/', title: 'Αρχική', n: 15 }, { path: '/blog/', title: 'Ανακοινώσεις', n: 8 }, { path: '/support/', title: 'Εγγραφές & Δωρεές', n: 6 }] });
    assert.strictEqual(w.hours.items[9], 6);
    assert.strictEqual(w.hours.items[10], 4);
    assert.strictEqual(w.devices.src, 'site');
    assert.deepStrictEqual(w.unis.items, [{ name: 'Εθνικό Μετσόβιο Πολυτεχνείο', n: 3 }]);
    assert.deepStrictEqual(w.companies, { src: 'site', items: [{ name: 'Siemens AG', n: 3 }], hidden: 1 }, 'a company with one visit is not named');
    assert.deepStrictEqual(w.placed, { seen: 14, unis: 4, academic: 1, companies: 4 });
    assert.strictEqual(w.countries.src, 'ga4');
    assert.strictEqual(f.windows.all.from, '2026-09-29');
    assert.ok(!JSON.stringify(f).includes('Tiny Firm'));
  });
  t('with GA4 alone the visits still have pages, devices and channels', () => {
    const f = buildFile({ site: null, ga, titles, today: '2026-10-03', generated: 'x' });
    const w = f.windows['30'];
    assert.strictEqual(w.pages.src, 'ga4');
    assert.strictEqual(w.devices.src, 'ga4');
    assert.ok(!w.hours && !w.unis && !w.companies, 'what only the site can say is left out');
  });
  t('nothing measured yet: no windows, and the page says so', () => {
    const f = buildFile({ site: { docs: {} }, ga: null, titles, today: '2026-10-03', generated: 'x' });
    assert.deepStrictEqual(f.windows, {});
    assert.deepStrictEqual(f.sources, { site: { days: 0 } });
  });
  t('Google Analytics reads with its own key, else the Firebase one', () => {
    assert.strictEqual(gaKeyName({ GA4_SERVICE_ACCOUNT: '{}', FIREBASE_SERVICE_ACCOUNT: '{}' }), 'GA4_SERVICE_ACCOUNT');
    assert.strictEqual(gaKeyName({ FIREBASE_SERVICE_ACCOUNT: '{}' }), 'FIREBASE_SERVICE_ACCOUNT');
    assert.strictEqual(gaKeyName({}), '');
  });
  t('a Google Analytics refusal stops the build only once it has answered before', () => {
    assert.strictEqual(gaFailureStops(null), false, 'no file yet');
    assert.strictEqual(gaFailureStops({ sources: { site: { days: 3 } } }), false, 'still being set up');
    assert.strictEqual(gaFailureStops({ sources: { ga4: { days: 900 } } }), true, 'it answered before: keep the committed file');
  });
  t('the file says where the site\'s own counter takes over', () => {
    const f = buildFile({ site, ga, titles, today: '2026-10-03', generated: 'x' });
    assert.deepStrictEqual(f.sources.site, { days: 2, first: '2026-10-01' });
    assert.ok(!('first' in buildFile({ site: { docs: {} }, ga, titles, today: '2026-10-03', generated: 'x' }).sources.site));
  });
  t('dates are Greek time', () => {
    assert.strictEqual(athensDay(new Date('2026-10-01T22:30:00Z')), '2026-10-02');
    assert.strictEqual(addDays('2026-03-01', -1), '2026-02-28');
  });
  t('the committed file has the shape the page reads', () => {
    const f = JSON.parse(readFileSync(OUT, 'utf8'));
    assert.strictEqual(f.v, 1);
    assert.ok(f.days && typeof f.days === 'object' && f.windows && typeof f.windows === 'object');
    for (const [k, w] of Object.entries(f.windows)) {
      assert.ok(k in WINDOWS, 'window ' + k);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(w.from) && /^\d{4}-\d{2}-\d{2}$/.test(w.to));
    }
    assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(JSON.stringify(f)), 'no network address in the served file');
  });
  console.log(`\n${ok} passed`);
  return 0;
}

// run only when called as a program: tools/auth-flow.mjs imports buildFile
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = SELFTEST ? selftest : main;
  run().then(code => process.exit(code), e => { console.log('::error::' + (e && e.stack || e)); process.exit(1); });
}
