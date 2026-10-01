/* Offline tests of the e-mail alerts (alerts.js, alert-topics.js). No network,
   no Firestore: the run is driven through fake deps. Run: node test-alerts.js */
'use strict';
const assert = require('assert');
const A = require('./alerts');
const T = require('./alert-topics');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n      ')); }
}

const SITE = 'https://semfealumni.gr/';
const post = (slug, cat, date, title) => ({ id: SITE + 'blog/' + slug + '/', url: SITE + 'blog/' + slug + '/', title: title || 'Τίτλος ' + slug,
  summary: 'Περίληψη ' + slug, content_html: '<p>x</p>', date_published: date + 'T12:00:00Z', tags: [cat] });
const FEED = items => ({ version: 'https://jsonfeed.org/version/1.1', items });
const CHANGELOG = { updates: [
  { id: '2026-10-02-alerts', date: '2026-10-02', title: 'Ειδοποιήσεις με e-mail', summary: 'Νέο.', url: 'account/#alerts' },
  { id: '2026-10-01-statistika', date: '2026-10-01', title: 'Στατιστικά', summary: 'Σελίδα.' },
  { id: '2026-09-30-pending', date: '2026-09-30', title: 'Δεν εγκρίθηκε ακόμη' }
] };

/* a fake world for run(): every call is recorded */
function world(o) {
  const w = Object.assign({ feed: FEED([]), changelog: { updates: [] }, decisions: {}, keys: null, prefs: [], status: {}, mailOn: true, failFor: [] }, o || {});
  w.sent = []; w.setKeys = []; w.claims = []; w.logs = [];
  w.deps = {
    fetchJson: async url => {
      if (w.down && url.endsWith(w.down)) throw new Error(url + ' answered 503');
      if (url === SITE + 'feed.json') return w.feed;
      if (url === SITE + 'changelog.json') return w.changelog;
      throw new Error('unexpected fetch ' + url);
    },
    decisions: async () => w.decisions,
    ledger: async () => w.keys ? w.keys.slice() : null,
    seed: async keys => { w.keys = keys.slice(); },
    claim: async keys => { w.claims.push(keys); const add = keys.filter(k => w.keys.indexOf(k) === -1); w.keys = w.keys.concat(add); return w.stolen ? [] : add; },
    prefs: async () => w.prefs.map(p => Object.assign({}, p)),
    statuses: async uids => { const out = {}; uids.forEach(u => { if (w.status[u]) out[u] = w.status[u]; }); return out; },
    setKey: async (uid, k) => { w.setKeys.push([uid, k]); w.prefs.forEach(p => { if (p.uid === uid) p.k = k; }); },
    send: async m => { if (w.failFor.indexOf(m.to) !== -1) throw new Error('smtp said no'); w.sent.push(m); },
    mailOn: w.mailOn,
    log: x => w.logs.push(x)
  };
  return w;
}
const CFG = { site: SITE, from: '"Σύλλογος" <alerts@x.gr>', unsubBase: 'https://europe-west1-p.cloudfunctions.net/alertsUnsubscribe' };

(async () => {
  await t('the alert kinds: three, each with a label; announcements and events come from the post categories', async () => {
    assert.deepStrictEqual(T.KEYS, ['announcements', 'events', 'site']);
    assert.strictEqual(T.topicOfCategory('Ανακοινώσεις'), 'announcements');
    assert.strictEqual(T.topicOfCategory('Εκδηλώσεις'), 'events');
    assert.strictEqual(T.topicOfCategory('Άλλο'), '');
    assert.deepStrictEqual(T.clean(['site', 'nope', 'events', 'site']), ['events', 'site'], 'known keys, once each, in order');
    assert.deepStrictEqual(T.clean('site'), []);
    T.TOPICS.forEach(x => assert.ok(x.label && x.hint, x.key));
  });

  await t('feed.json: each announcement goes to its alert; other sites and unknown categories are dropped', async () => {
    const items = A.itemsFromFeed(FEED([post('a', 'Ανακοινώσεις', '2026-10-02'), post('b', 'Εκδηλώσεις', '2026-10-03'), post('c', 'Κάτι άλλο', '2026-10-03'),
      Object.assign(post('d', 'Ανακοινώσεις', '2026-10-03'), { url: 'https://evil.example/x' })]), SITE);
    assert.deepStrictEqual(items.map(i => [i.key, i.topic, i.date]), [['post:blog/a/', 'announcements', '2026-10-02'], ['post:blog/b/', 'events', '2026-10-03']]);
    assert.deepStrictEqual(A.itemsFromFeed(null, SITE), []);
    // the function's SITE_URL says www, the feed does not: same items, same keys
    const www = A.itemsFromFeed(Object.assign(FEED([post('a', 'Ανακοινώσεις', '2026-10-02')]), { home_page_url: SITE + 'blog/' }), 'https://www.semfealumni.gr/');
    assert.deepStrictEqual(www.map(i => i.key), ['post:blog/a/']);
  });

  await t('«Τι νέο»: only what an admin approved, with an admin\'s wording, linked to the site', async () => {
    const items = A.itemsFromNews(CHANGELOG, { '2026-10-02-alerts': { status: 'approved', title: 'Νέο: ειδοποιήσεις' }, '2026-10-01-statistika': { status: 'approved' },
      '2026-09-30-pending': { status: 'pending' } }, SITE);
    assert.deepStrictEqual(items.map(i => [i.key, i.topic, i.title, i.url]), [
      ['news:2026-10-02-alerts', 'site', 'Νέο: ειδοποιήσεις', SITE + 'account/#alerts'],
      ['news:2026-10-01-statistika', 'site', 'Στατιστικά', SITE + 'whats-new/']]);
    assert.deepStrictEqual(A.itemsFromNews(CHANGELOG, {}, SITE), [], 'no decision = not public = not mailed');
  });

  await t('the e-mail: grouped by alert, escaped, with the member\'s own stop link in the text, the HTML and the headers', async () => {
    const items = [
      { key: 'news:x', topic: 'site', title: 'Νέα σελίδα', summary: 'Κάτι <b>νέο</b>', url: SITE + 'whats-new/', date: '2026-10-02' },
      { key: 'post:a', topic: 'announcements', title: '<script>alert(1)</script>Γενική Συνέλευση', summary: 'Στις 5 Νοεμβρίου', url: SITE + 'blog/a/', date: '2026-10-03' }];
    const unsub = A.unsubLink(CFG.unsubBase, 'uid1', 'K'.repeat(32));
    const m = A.render(items, { site: SITE, unsubUrl: unsub });
    assert.strictEqual(m.subject, '2 νέα από τον Σύλλογο Διπλωματούχων ΣΕΜΦΕ');
    assert.ok(m.html.indexOf('Ανακοινώσεις του Συλλόγου') < m.html.indexOf('Νέα του ιστότοπου'), 'in the order of the alerts');
    assert.ok(!/<script>|<b>νέο/.test(m.html) && m.html.includes('&lt;script&gt;'), 'titles and summaries are text, never HTML');
    assert.ok(m.html.includes(unsub.replace(/&/g, '&amp;')) && m.text.includes(unsub), 'the stop link');
    assert.ok(m.html.includes(SITE + 'account/#alerts') && m.text.includes(SITE + 'account/#alerts'), 'the link to change the choice');
    assert.deepStrictEqual(m.headers, { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    assert.ok(m.text.includes('3 Οκτωβρίου 2026'));
    assert.strictEqual(A.render([items[1]], { site: SITE, unsubUrl: unsub }).subject, items[1].title, 'one item: its title is the subject');
  });

  await t('a long list is cut at ' + A.MAX_LIST + ', with a link to the rest', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ key: 'post:' + i, topic: 'announcements', title: 'Θέμα ' + i, summary: '', url: SITE + 'blog/' + i + '/', date: '2026-10-01' }));
    const m = A.render(many, { site: SITE, unsubUrl: 'u' });
    assert.ok(m.html.includes('Θέμα 19') && !m.html.includes('Θέμα 20') && m.html.includes('και ακόμη 5'));
  });

  await t('the FIRST run only records what is already published: nobody gets the back-catalogue', async () => {
    const w = world({ feed: FEED([post('old', 'Ανακοινώσεις', '2026-02-11')]), changelog: CHANGELOG, decisions: { '2026-10-01-statistika': { status: 'approved' } },
      prefs: [{ uid: 'u1', topics: ['announcements', 'site'], email: 'a@x.gr' }], status: { u1: 'active' } });
    const r = await A.run(w.deps, CFG);
    assert.ok(/first run: 2 published/.test(r), r);
    assert.deepStrictEqual(w.keys, ['post:blog/old/', 'news:2026-10-01-statistika']);
    assert.strictEqual(w.sent.length, 0);
  });

  await t('later: a new announcement and a newly approved «Τι νέο» entry go to whoever chose them, once', async () => {
    const w = world({
      keys: ['post:blog/old/', 'news:2026-10-01-statistika'],
      feed: FEED([post('gs', 'Ανακοινώσεις', '2026-10-05', 'Τακτική Γενική Συνέλευση'), post('old', 'Ανακοινώσεις', '2026-02-11')]),
      changelog: CHANGELOG, decisions: { '2026-10-01-statistika': { status: 'approved' }, '2026-10-02-alerts': { status: 'approved' } },
      prefs: [
        { uid: 'both', topics: ['announcements', 'site'], email: 'both@x.gr' },
        { uid: 'events', topics: ['events'], email: 'ev@x.gr' },                     // chose nothing that is new
        { uid: 'site', topics: ['site'], email: 'site@x.gr', k: 'S'.repeat(32) },   // already has a stop key
        { uid: 'pending', topics: ['announcements'], email: 'p@x.gr' },
        { uid: 'rejected', topics: ['announcements'], email: 'r@x.gr' },
        { uid: 'noapp', topics: ['announcements'], email: 'n@x.gr' },
        { uid: 'noemail', topics: ['announcements'], email: '' }
      ],
      status: { both: 'active', events: 'active', site: 'active', pending: 'pending', rejected: 'rejected' }
    });
    const r = await A.run(w.deps, CFG);
    assert.deepStrictEqual(w.claims, [['post:blog/gs/', 'news:2026-10-02-alerts']], 'claimed before sending');
    assert.deepStrictEqual(w.sent.map(m => m.to).sort(), ['both@x.gr', 'p@x.gr', 'site@x.gr']);
    const both = w.sent.find(m => m.to === 'both@x.gr');
    assert.ok(both.html.includes('Τακτική Γενική Συνέλευση') && both.html.includes('Ειδοποιήσεις με e-mail'), 'one e-mail with both items');
    assert.strictEqual(w.sent.find(m => m.to === 'site@x.gr').subject, 'Ειδοποιήσεις με e-mail');
    assert.ok(!w.sent.find(m => m.to === 'site@x.gr').html.includes('Γενική Συνέλευση'), 'only the kinds they chose');
    assert.deepStrictEqual(w.setKeys.map(x => x[0]).sort(), ['both', 'pending'], 'a stop key is made once, for those who had none');
    w.setKeys.forEach(([, k]) => assert.ok(A.KEY_RE.test(k)));
    assert.ok(w.sent.find(m => m.to === 'site@x.gr').text.includes('u=site&k=' + 'S'.repeat(32)), 'an existing key is reused');
    assert.ok(/2 new item\(s\).*3 e-mail\(s\) sent.*2 skipped/.test(r), r);
    // the next run: nothing new, nothing sent
    const again = await A.run(Object.assign(w.deps, { ledger: async () => w.keys.slice() }), CFG);
    assert.ok(/nothing new/.test(again), again);
    assert.strictEqual(w.sent.length, 3);
  });

  await t('a removed and restored «Τι νέο» entry, or an announcement edited later, is not mailed again', async () => {
    const w = world({ keys: ['news:2026-10-01-statistika', 'post:blog/a/'], changelog: CHANGELOG, decisions: { '2026-10-01-statistika': { status: 'approved', title: 'Νέος τίτλος' } },
      feed: FEED([post('a', 'Ανακοινώσεις', '2026-10-01', 'Διορθωμένος τίτλος')]), prefs: [{ uid: 'u', topics: T.KEYS, email: 'u@x.gr' }], status: { u: 'active' } });
    assert.ok(/nothing new/.test(await A.run(w.deps, CFG)));
    assert.strictEqual(w.sent.length, 0);
  });

  await t('e-mail switched off: nothing claimed, so the news waits for it', async () => {
    const w = world({ keys: [], feed: FEED([post('a', 'Ανακοινώσεις', '2026-10-01')]), prefs: [{ uid: 'u', topics: ['announcements'], email: 'u@x.gr' }], status: { u: 'active' }, mailOn: false });
    const r = await A.run(w.deps, CFG);
    assert.ok(/waiting/.test(r), r);
    assert.deepStrictEqual(w.claims, []); assert.strictEqual(w.sent.length, 0);
  });

  await t('a source that does not answer: nothing claimed, nothing sent (retried next run)', async () => {
    const w = world({ keys: [], feed: FEED([post('a', 'Ανακοινώσεις', '2026-10-01')]), down: 'changelog.json', prefs: [{ uid: 'u', topics: ['announcements'], email: 'u@x.gr' }], status: { u: 'active' } });
    await assert.rejects(A.run(w.deps, CFG), /503/);
    assert.deepStrictEqual(w.claims, []);
    const w2 = world({ keys: [], feed: { nope: 1 } });
    await assert.rejects(A.run(w2.deps, CFG), /no items/);
  });

  await t('another run claimed the items first: this one sends nothing', async () => {
    const w = world({ keys: [], feed: FEED([post('a', 'Ανακοινώσεις', '2026-10-01')]), prefs: [{ uid: 'u', topics: ['announcements'], email: 'u@x.gr' }], status: { u: 'active' }, stolen: true });
    assert.ok(/another run/.test(await A.run(w.deps, CFG)));
    assert.strictEqual(w.sent.length, 0);
  });

  await t('one address the mail server refuses does not stop the others', async () => {
    const w = world({ keys: [], feed: FEED([post('a', 'Εκδηλώσεις', '2026-10-01')]), failFor: ['bad@x.gr'],
      prefs: [{ uid: 'a', topics: ['events'], email: 'bad@x.gr' }, { uid: 'b', topics: ['events'], email: 'good@x.gr' }], status: { a: 'active', b: 'active' } });
    const r = await A.run(w.deps, CFG);
    assert.deepStrictEqual(w.sent.map(m => m.to), ['good@x.gr']);
    assert.ok(/1 e-mail\(s\) sent, 1 failed/.test(r), r);
    assert.ok(w.logs.some(l => /alert to a failed/.test(l)) && !w.logs.some(l => /bad@x\.gr/.test(l)), 'the log names the account, not the address');
  });

  // ---- the stop link ----
  const K = 'k'.repeat(32);
  function store(doc) {
    const s = { doc, stopped: 0 };
    s.deps = { get: async uid => (uid === 'u1' ? s.doc : null), stop: async uid => { s.stopped++; s.doc = Object.assign({}, s.doc, { topics: [] }); } };
    return s;
  }
  await t('opening the stop link (GET) asks first and changes nothing: mail systems open links by themselves', async () => {
    const s = store({ topics: ['site'], k: K });
    const r = await A.unsubscribe({ method: 'GET', query: { u: 'u1', k: K } }, s.deps, { site: SITE });
    assert.strictEqual(r.status, 200);
    assert.ok(/<form method="post"/.test(r.html) && r.html.includes('Διακοπή των ειδοποιήσεων'));
    assert.strictEqual(s.stopped, 0);
  });
  await t('pressing the button (POST, also a mail program\'s one-click) stops every alert', async () => {
    const s = store({ topics: ['site', 'events'], k: K });
    const r = await A.unsubscribe({ method: 'POST', query: { u: 'u1', k: K } }, s.deps, { site: SITE });
    assert.strictEqual(r.status, 200); assert.ok(r.html.includes('Οι ειδοποιήσεις σταμάτησαν'));
    assert.strictEqual(s.stopped, 1); assert.deepStrictEqual(s.doc.topics, []);
  });
  await t('a wrong, missing or malformed key changes nothing', async () => {
    const s = store({ topics: ['site'], k: K });
    for (const q of [{ u: 'u1', k: 'x'.repeat(32) }, { u: 'nobody', k: K }, { u: 'u1' }, { u: 'u1/../x', k: K }, { u: 'u1', k: '<script>' }]) {
      const r = await A.unsubscribe({ method: 'POST', query: q }, s.deps, { site: SITE });
      assert.strictEqual(r.status, 400, JSON.stringify(q));
    }
    const s2 = store({ topics: ['site'] });                       // never mailed: no key yet
    assert.strictEqual((await A.unsubscribe({ method: 'POST', query: { u: 'u1', k: K } }, s2.deps, { site: SITE })).status, 400);
    assert.strictEqual((await A.unsubscribe({ method: 'PUT', query: { u: 'u1', k: K } }, s.deps, { site: SITE })).status, 405);
    assert.strictEqual(s.stopped + s2.stopped, 0);
  });

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
