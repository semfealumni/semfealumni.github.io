/* SEMFE Alumni: the ANONYMOUS statistics of the registered members, shown on
   the «Στατιστικά» page.

   Counted from every membership application (members/{uid}) that was not
   rejected, and published as ONE document, publicStats/members, that anyone
   may read. Two things keep it current:
     - the memberStats Cloud Function recounts on every change to an
       application (functions/index.js), so the page is up to date within
       seconds of a registration;
     - the daily analytics workflow recounts as well (tools/build-analytics.mjs),
       which fills it the first time and repairs it if a change was missed.
   Both call memberStats() below, so they cannot count differently.

   WHAT KEEPS IT ANONYMOUS
     - only totals per category, never a row per person, never a name or an
       e-mail, and never two answers of one person side by side (no "women
       in finance in London": each question is counted on its own);
     - a category with fewer than K (3) people is not shown by name: it is
       merged into "Λοιπά", which says how many people it holds but not
       which answers they gave;
     - a question fewer than MIN_ANSWERS (5) people have answered is not
       shown at all;
     - years are counted in five-year periods, not one by one;
     - an employer appears only when at least K members name it.
   "Δεν επιθυμώ να απαντήσω" is respected as not answering. */
'use strict';
const P = require('./profile-options.js');

const K = 3;
const MIN_ANSWERS = 5;
const OTHER = '_other';

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();
  const s = typeof v.seconds === 'number' ? v.seconds : typeof v._seconds === 'number' ? v._seconds : null;
  if (s != null) return new Date(s * 1000);
  if (typeof v === 'number' || typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d; }
  return null;
}
function yearOf(v) { return Number.isInteger(v) && v >= 1950 && v <= 2100 ? v : null; }
function period(y) { const a = Math.floor(y / 5) * 5; return a + '–' + (a + 4); }

/**
 * One question's answers, counted and made safe to publish.
 *   values  one answer per person ('' or null for "no answer")
 *   opts.order  'count' (most first) or 'key' (sorted, for years)
 *   opts.label  key -> how the page names it (default: the key itself)
 */
function tally(values, opts) {
  opts = opts || {};
  const n = new Map(), names = new Map();
  let answered = 0;
  for (const raw of values) {
    const v = raw && typeof raw === 'object' ? raw : { key: raw, name: raw };
    if (v.key == null || v.key === '') continue;
    answered++;
    n.set(v.key, (n.get(v.key) || 0) + 1);
    // the most common spelling names a free-text group
    const by = names.get(v.key) || new Map();
    by.set(v.name, (by.get(v.name) || 0) + 1);
    names.set(v.key, by);
  }
  if (answered < MIN_ANSWERS) return { answered, items: null };
  let items = [], other = 0;
  for (const [key, count] of n) {
    if (count < K) { other += count; continue; }
    let name = key;
    if (opts.label) name = opts.label(key);
    else {
      let best = '', most = -1;
      for (const [spelling, c] of names.get(key)) if (c > most || (c === most && String(spelling) < best)) { best = spelling; most = c; }
      name = best;
    }
    items.push({ k: String(key), name: String(name), n: count });
  }
  if (opts.order === 'key') items.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  else items.sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
  if (opts.top && items.length > opts.top) {
    for (const x of items.slice(opts.top)) other += x.n;
    items = items.slice(0, opts.top);
  }
  if (other) items.push({ k: OTHER, name: '', n: other });
  return { answered, items };
}

/**
 * The published statistics, from the applications' data (plain objects as
 * Firestore returns them). `now` stamps the document.
 */
function memberStats(docs, now) {
  const people = (docs || []).filter(d => d && d.status !== 'rejected');
  const study = d => {
    const a = yearOf(d.entryYear), b = yearOf(d.gradYear);
    if (a == null || b == null || b < a || b - a > 20) return '';
    const yrs = b - a;
    return yrs <= 5 ? '05' : yrs >= 10 ? '10' : String(yrs).padStart(2, '0');
  };
  const place = d => P.splitPlace(d.city || '');
  const country = d => {
    const c = String(d.country || '');
    if (/^[A-Z]{2}$/.test(c)) return c;
    return place(d).country;
  };
  const city = d => {
    const c = place(d).city;
    return c ? { key: P.fold(c), name: c } : '';
  };
  const employer = d => {
    const e = String(d.employer || '').trim();
    const k = e ? P.orgKey(e) : '';
    return k ? { key: k, name: P.tidy(e) } : '';
  };
  const growth = new Map();
  for (const d of people) {
    const c = toDate(d.createdAt);
    if (!c) continue;
    const m = c.toISOString().slice(0, 7);
    growth.set(m, (growth.get(m) || 0) + 1);
  }
  return {
    v: 1,
    t: (now || new Date()).toISOString(),
    k: K,
    minAnswers: MIN_ANSWERS,
    registered: people.length,
    active: people.filter(d => d.status === 'active').length,
    dims: {
      stage: tally(people.map(d => d.stage || ''), { label: k => k }),
      direction: tally(people.map(d => d.direction || '')),
      gender: tally(people.map(d => (d.gender === 'na' ? '' : d.gender || '')), { label: k => k }),
      industry: tally(people.map(d => d.industry || ''), { label: k => k }),
      country: tally(people.map(country), { label: k => k }),
      city: tally(people.map(city), { top: 15 }),
      entry: tally(people.map(d => (yearOf(d.entryYear) ? period(d.entryYear) : '')), { order: 'key', label: k => k }),
      grad: tally(people.map(d => (yearOf(d.gradYear) ? period(d.gradYear) : '')), { order: 'key', label: k => k }),
      study: tally(people.map(study), { order: 'key', label: k => k }),
      employer: tally(people.map(employer), { top: 15 })
    },
    growth: [...growth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  };
}

/** The fields a change must touch for the statistics to move: the trigger
    skips every other write (a "last seen" stamp, a directory toggle). */
const STAT_FIELDS = ['status', 'stage', 'direction', 'entryYear', 'gradYear', 'gender', 'industry', 'country', 'city', 'employer', 'createdAt'];
function matters(before, after) {
  if (!before || !after) return true;            // created or deleted
  return STAT_FIELDS.some(f => JSON.stringify(before[f] == null ? null : before[f]) !== JSON.stringify(after[f] == null ? null : after[f]));
}

module.exports = { K, MIN_ANSWERS, OTHER, tally, memberStats, matters, STAT_FIELDS };
