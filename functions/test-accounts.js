/* Offline tests for accounts.js (the registered-accounts list and merging
   two accounts), and for LinkedIn's merge mode in linkedin.js.
   No network, no Firebase. Run: npm test */
'use strict';
const assert = require('node:assert');
const accounts = require('./accounts');
const linkedin = require('./linkedin');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e)); }
}

/* ---- fakes: Firebase Auth (Admin SDK) and Firestore, just what accounts.js uses ---- */
function ts(ms) { return { toMillis: () => ms, _ts: ms }; }
function fakeAuth(users, tokens) {
  const byUid = new Map(users.map(u => [u.uid, Object.assign({ customClaims: {}, providerData: [], metadata: {} }, u)]));
  const notFound = () => { const e = new Error('nf'); e.code = 'auth/user-not-found'; return e; };
  return {
    byUid, calls: [],
    async getUser(uid) { this.calls.push(['getUser', uid]); if (!byUid.has(uid)) throw notFound(); return JSON.parse(JSON.stringify(byUid.get(uid))); },
    async listUsers(n, page) {
      this.calls.push(['listUsers', n, page]);
      const all = [...byUid.values()];
      const start = page ? +page : 0;
      return { users: all.slice(start, start + 2), pageToken: start + 2 < all.length ? String(start + 2) : undefined };   // pages of 2, so paging is exercised
    },
    async updateUser(uid, p) {
      this.calls.push(['updateUser', uid, p]);
      const u = byUid.get(uid);
      if (!u) throw notFound();
      if (p.providersToUnlink) u.providerData = u.providerData.filter(x => p.providersToUnlink.indexOf(x.providerId) === -1);
      if (p.providerToLink) {
        for (const o of byUid.values()) if (o.providerData.some(x => x.providerId === p.providerToLink.providerId && x.uid === p.providerToLink.uid)) {
          const e = new Error('in use'); e.code = 'auth/credential-already-in-use'; throw e;
        }
        u.providerData.push(Object.assign({}, p.providerToLink));
      }
      ['email', 'emailVerified', 'displayName', 'photoURL'].forEach(k => { if (k in p) u[k] = p[k]; });
    },
    async setCustomUserClaims(uid, c) { this.calls.push(['claims', uid, c]); byUid.get(uid).customClaims = c; },
    async deleteUser(uid) { this.calls.push(['deleteUser', uid]); if (!byUid.has(uid)) throw notFound(); byUid.delete(uid); },
    async verifyIdToken(tok) {
      if (tokens && tokens[tok]) return tokens[tok];
      throw new Error('bad token');
    }
  };
}
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed || {}));      // 'members/u1' -> data
  let n = 0;
  const ref = key => ({
    key,
    async get() { return { exists: docs.has(key), id: key.split('/')[1], data: () => docs.get(key) }; },
    async set(v, o) { docs.set(key, Object.assign({}, o && o.merge ? docs.get(key) : {}, v)); },
    async create(v) { if (docs.has(key)) { const e = new Error('6 ALREADY_EXISTS: Document already exists'); e.code = 6; throw e; } docs.set(key, v); },
    async delete() { docs.delete(key); }
  });
  return {
    docs,
    collection(name) {
      const list = () => [...docs.entries()].filter(([k]) => k.startsWith(name + '/'));
      return {
        doc: id => ref(name + '/' + id),
        async get() { const hits = list().map(([k, d]) => ({ id: k.split('/')[1], data: () => d, ref: ref(k) })); return { forEach: fn => hits.forEach(fn) }; },
        where(f, op, v) {
          assert.strictEqual(op, '==');
          return { async get() { const hits = list().filter(([, d]) => d[f] === v).map(([k, d]) => ({ id: k.split('/')[1], data: () => d, ref: ref(k) })); return { forEach: fn => hits.forEach(fn) }; } };
        },
        async add(v) { const id = 'm' + (++n); docs.set(name + '/' + id, v); return ref(name + '/' + id); }
      };
    }
  };
}
const NOW = 'NOW';
function req(body, headers, method) {
  const h = Object.assign({ origin: 'https://www.stouras.com' }, headers || {});
  return { method: method || 'POST', body, get: k => h[k.toLowerCase()], headers: h };
}
function res() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}
const CFG = { allowedOrigins: ['https://www.stouras.com'] };
const CLOCK = 1790000000000;
const TOKENS = {
  admin: { uid: 'adm', email: 'kstouras@gmail.com', email_verified: true },
  adminUnverified: { uid: 'adm', email: 'kstouras@gmail.com', email_verified: false },
  member: { uid: 'g1', email: 'maria@gmail.com', email_verified: true },
  memberUnverified: { uid: 'p9', email: 'kstouras@gmail.com', email_verified: false },
  otherAdmin: { uid: 'adm2', email: 'gradsemfe@gmail.com', email_verified: true, auth_time: CLOCK / 1000 - 60 },
  otherFresh: { uid: 'li1', auth_time: CLOCK / 1000 - 60 },
  otherStale: { uid: 'li1', auth_time: CLOCK / 1000 - 3600 },
  selfAgain: { uid: 'g1', auth_time: CLOCK / 1000 - 10 }
};
async function call(body, opts) {
  opts = opts || {};
  const auth = opts.auth || fakeAuth(opts.users || [], TOKENS), db = opts.db || fakeDb(opts.docs), r = res();
  const headers = Object.assign({}, opts.token ? { authorization: 'Bearer ' + opts.token } : {}, opts.headers || {});
  await accounts.handle(req(body, headers, opts.method), r, { auth, db, now: () => NOW, clock: () => CLOCK, log: () => {} }, CFG);
  return { r, auth, db };
}

/* ---- people ---- */
const G = (uid, email) => ({ providerId: 'google.com', uid: 'gsub-' + uid, email });
const PW = email => ({ providerId: 'password', uid: email, email });
const APP = (o) => Object.assign({
  firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@gmail.com', phone: '', stage: 'graduate', entryYear: 2005, gradYear: 2010,
  direction: '', employer: '', position: '', city: '', linkedin: '', consentNewsletter: true, consentJobs: false, consentDirectory: true,
  note: '', acceptedPrivacy: true, provider: 'google.com', createdAt: ts(2000), updatedAt: ts(2000), status: 'pending'
}, o || {});

(async () => {
  /* ---- the pure merge of two applications ---- */
  await t('merge of applications: DROP only -> moved over whole, unknown keys left behind', async () => {
    const d = APP({ status: 'active', duesYears: [2025], stray: 'x' });
    const m = accounts.mergeApplications(null, d);
    assert.strictEqual(m.status, 'active'); assert.deepStrictEqual(m.duesYears, [2025]);
    assert.ok(!('stray' in m), 'only the keys the rules allow');
  });
  await t('merge of applications: KEEP only -> nothing to write', async () => {
    assert.strictEqual(accounts.mergeApplications(APP(), null), null);
  });
  await t('merge of applications: empty fields filled, filled ones kept, dues joined, notes joined, earliest date', async () => {
    const k = APP({ employer: 'ΕΜΠ', city: '', duesYears: [2024, 2026], adminNote: 'a', createdAt: ts(5000) });
    const d = APP({ employer: 'Other', city: 'Αθήνα', phone: '690', duesYears: [2025, 2026], adminNote: 'b', createdAt: ts(3000) });
    const m = accounts.mergeApplications(k, d);
    assert.strictEqual(m.employer, 'ΕΜΠ'); assert.strictEqual(m.city, 'Αθήνα'); assert.strictEqual(m.phone, '690');
    assert.deepStrictEqual(m.duesYears, [2024, 2025, 2026]); assert.strictEqual(m.adminNote, 'a · b');
    assert.strictEqual(m.createdAt.toMillis(), 3000);
  });
  await t('merge of applications: the further-along status wins, with its vetted name', async () => {
    const k = APP({ firstName: 'Mary', lastName: 'Pap', status: 'pending' });
    const d = APP({ status: 'active', reviewedBy: 'kstouras@gmail.com', reviewedAt: ts(9) });
    const m = accounts.mergeApplications(k, d);
    assert.strictEqual(m.status, 'active'); assert.strictEqual(m.firstName, 'Μαρία'); assert.strictEqual(m.reviewedBy, 'kstouras@gmail.com');
    const back = accounts.mergeApplications(APP({ status: 'active', firstName: 'Mary' }), APP({ status: 'rejected' }));
    assert.strictEqual(back.status, 'active'); assert.strictEqual(back.firstName, 'Mary');
  });

  /* ---- mergeAccounts ---- */
  await t('Google account + LinkedIn account (active member): everything lands on the Google one', async () => {
    const auth = fakeAuth([
      { uid: 'g1', email: 'maria@gmail.com', emailVerified: true, displayName: 'Maria', providerData: [G('g1', 'maria@gmail.com')] },
      { uid: 'li1', email: 'maria@work.gr', emailVerified: true, displayName: 'Μαρία Π.', customClaims: { li: true } }
    ]);
    const db = fakeDb({ 'members/li1': APP({ status: 'active', duesYears: [2026], email: 'maria@work.gr' }), 'directory/li1': { name: 'Μαρία Παπαδοπούλου' }, 'linkedinLinks/sub9': { uid: 'li1' },
      'feedback/SEMFE-260930-AB23': { uid: 'li1', ticket: 'SEMFE-260930-AB23', message: 'hi' } });
    const r = await accounts.mergeAccounts({ auth, db, now: () => NOW, keepUid: 'g1', dropUid: 'li1', by: 'kstouras@gmail.com' });
    assert.strictEqual(r.application, 'moved');
    assert.strictEqual(db.docs.get('members/g1').status, 'active');
    assert.deepStrictEqual(db.docs.get('members/g1').duesYears, [2026]);
    assert.strictEqual(db.docs.get('members/g1').updatedAt, NOW);
    assert.strictEqual(db.docs.get('directory/g1').name, 'Μαρία Παπαδοπούλου', 'the card follows the application');
    assert.ok(!db.docs.has('members/li1') && !db.docs.has('directory/li1'), "DROP's documents are gone");
    assert.strictEqual(db.docs.get('linkedinLinks/sub9').uid, 'g1', 'LinkedIn now signs in to the kept account');
    assert.strictEqual(auth.byUid.get('g1').customClaims.li, true);
    assert.ok(!auth.byUid.has('li1'), 'DROP deleted');
    assert.deepStrictEqual(r.moved, ['linkedin']);
    assert.strictEqual(db.docs.get('feedback/SEMFE-260930-AB23').uid, 'g1', 'the messages sent from the Σχόλια page follow the person');
    assert.strictEqual(db.docs.get('feedback/SEMFE-260930-AB23').message, 'hi'); assert.strictEqual(r.feedback, 1);
    const log = [...db.docs.entries()].find(([k]) => k.startsWith('accountMerges/'))[1];
    assert.strictEqual(log.keep, 'g1'); assert.strictEqual(log.drop, 'li1'); assert.strictEqual(log.by, 'kstouras@gmail.com');
  });
  await t('DROP deleted only AFTER its documents and links moved (order)', async () => {
    const auth = fakeAuth([{ uid: 'k', providerData: [PW('k@x.gr')], email: 'k@x.gr' }, { uid: 'd', providerData: [G('d', 'd@gmail.com')], email: 'd@gmail.com' }]);
    const db = fakeDb({ 'members/d': APP(), 'linkedinLinks/s': { uid: 'd' } });
    let seenAtDelete = null;
    const del = auth.deleteUser.bind(auth);
    auth.deleteUser = async uid => { seenAtDelete = { app: db.docs.has('members/k'), link: db.docs.get('linkedinLinks/s').uid }; return del(uid); };
    await accounts.mergeAccounts({ auth, db, now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.deepStrictEqual(seenAtDelete, { app: true, link: 'k' });
  });
  await t("DROP's Google moves to a password-only KEEP: unlinked from DROP first, then linked to KEEP", async () => {
    const auth = fakeAuth([{ uid: 'k', email: 'k@x.gr', providerData: [PW('k@x.gr')] }, { uid: 'd', email: 'd@gmail.com', providerData: [G('d', 'd@gmail.com')] }]);
    const r = await accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'd' });
    const i = auth.calls.findIndex(c => c[0] === 'updateUser' && c[1] === 'd' && c[2].providersToUnlink);
    const j = auth.calls.findIndex(c => c[0] === 'updateUser' && c[1] === 'k' && c[2].providerToLink);
    assert.ok(i !== -1 && j > i, 'unlink, then link');
    assert.deepStrictEqual(auth.calls[j][2].providerToLink, { providerId: 'google.com', uid: 'gsub-d', email: 'd@gmail.com' });
    assert.deepStrictEqual(accounts.methodsOf(auth.byUid.get('k')).sort(), ['google', 'password']);
    assert.deepStrictEqual(r.moved, ['google']);
  });
  await t('what cannot move is reported: a second Google, and a password', async () => {
    const auth = fakeAuth([{ uid: 'k', email: 'a@gmail.com', providerData: [G('k', 'a@gmail.com')] },
      { uid: 'd', email: 'b@gmail.com', providerData: [G('d', 'b@gmail.com'), PW('b@gmail.com')] }]);
    const r = await accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.deepStrictEqual(r.notMoved.map(x => x.method + ':' + x.why).sort(), ['google:kept-has-one', 'password:password']);
    assert.ok(!auth.byUid.has('d'));
  });
  await t('KEEP with no e-mail takes DROP\'s address (after DROP is gone)', async () => {
    const auth = fakeAuth([{ uid: 'k', customClaims: { li: true } }, { uid: 'd', email: 'd@gmail.com', emailVerified: true, providerData: [G('d', 'd@gmail.com')] }]);
    const r = await accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.strictEqual(auth.byUid.get('k').email, 'd@gmail.com'); assert.strictEqual(auth.byUid.get('k').emailVerified, true);
    assert.strictEqual(r.email, 'd@gmail.com');
  });
  await t('two applications: KEEP completed from DROP, one application left', async () => {
    const auth = fakeAuth([{ uid: 'k', email: 'k@gmail.com', providerData: [G('k', 'k@gmail.com')] }, { uid: 'd', customClaims: { li: true } }]);
    const db = fakeDb({ 'members/k': APP({ city: '' }), 'members/d': APP({ city: 'Πάτρα', status: 'active' }) });
    const r = await accounts.mergeAccounts({ auth, db, now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.strictEqual(r.application, 'merged');
    assert.strictEqual(db.docs.get('members/k').city, 'Πάτρα'); assert.strictEqual(db.docs.get('members/k').status, 'active');
    assert.ok(!db.docs.has('members/d'));
  });
  await t('same account, or an account that does not exist, is refused before anything changes', async () => {
    const auth = fakeAuth([{ uid: 'k' }]);
    await assert.rejects(accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'k' }), e => e.code === 'same-account');
    await assert.rejects(accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'zz' }), e => e.code === 'no-such-account');
    assert.ok(auth.byUid.has('k'));
  });

  /* ---- the safety rules (from the security review) ---- */
  await t('an address moves to KEEP only if DROP had CONFIRMED it', async () => {
    const auth = fakeAuth([{ uid: 'k', customClaims: { li: true } }, { uid: 'd', email: 'someone@gmail.com', emailVerified: false, providerData: [PW('someone@gmail.com')] }]);
    const r = await accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.ok(!auth.byUid.get('k').email, 'no unconfirmed address handed over'); assert.strictEqual(r.email, null);
  });
  await t('an account with a confirmed admin address is never the one removed (merge and delete)', async () => {
    const auth = fakeAuth([{ uid: 'k' }, { uid: 'adm2', email: 'GradSemfe@gmail.com', emailVerified: true }]);
    await assert.rejects(accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'adm2' }), e => e.code === 'cannot-remove-admin');
    assert.ok(auth.byUid.has('adm2'));
    const users = [{ uid: 'adm', email: 'kstouras@gmail.com', emailVerified: true }, { uid: 'adm2', email: 'gradsemfe@gmail.com', emailVerified: true }, { uid: 'g1', email: 'maria@gmail.com', emailVerified: true }];
    let x = await call({ action: 'merge', keep: 'g1', drop: 'adm2' }, { token: 'admin', users });
    assert.strictEqual(x.r.body.error, 'cannot-remove-admin'); assert.ok(x.auth.byUid.has('adm2'));
    x = await call({ action: 'delete', uid: 'adm2' }, { token: 'admin', users });
    assert.strictEqual(x.r.body.error, 'cannot-remove-admin'); assert.ok(x.auth.byUid.has('adm2'));
    x = await call({ action: 'mergeSelf', otherIdToken: 'otherAdmin' }, { token: 'member', users });
    assert.strictEqual(x.r.body.error, 'cannot-remove-admin'); assert.ok(x.auth.byUid.has('adm2'));
    // an UNconfirmed account using an admin address is not an admin: it may go
    const y = await call({ action: 'delete', uid: 'p9' }, { token: 'admin', users: [users[0], { uid: 'p9', email: 'gradsemfe@gmail.com', emailVerified: false }] });
    assert.strictEqual(y.r.statusCode, 200);
  });
  await t('mergeSelf: the account kept must have a confirmed e-mail (or none)', async () => {
    const users = [{ uid: 'p9', email: 'kstouras@gmail.com', emailVerified: false, providerData: [PW('kstouras@gmail.com')] }, { uid: 'li1', customClaims: { li: true } }];
    const x = await call({ action: 'mergeSelf', otherIdToken: 'otherFresh' }, { token: 'memberUnverified', users, docs: { 'linkedinLinks/s1': { uid: 'li1' } } });
    assert.strictEqual(x.r.statusCode, 403); assert.strictEqual(x.r.body.error, 'email-not-verified');
    assert.ok(x.auth.byUid.has('li1')); assert.strictEqual(x.db.docs.get('linkedinLinks/s1').uid, 'li1', 'the LinkedIn was not pointed at the unconfirmed account');
  });
  await t('a sign-in that fails to attach to KEEP goes back to DROP, and DROP is kept', async () => {
    const auth = fakeAuth([{ uid: 'k', email: 'k@x.gr', emailVerified: true, providerData: [PW('k@x.gr')] }, { uid: 'd', email: 'd@gmail.com', emailVerified: true, providerData: [G('d', 'd@gmail.com')] }]);
    const up = auth.updateUser.bind(auth);
    auth.updateUser = async (uid, p) => { if (uid === 'k' && p.providerToLink) { const e = new Error('boom'); e.code = 'auth/internal-error'; throw e; } return up(uid, p); };
    const db = fakeDb({ 'members/d': APP() });
    const r = await accounts.mergeAccounts({ auth, db, now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.strictEqual(r.partial, true); assert.strictEqual(r.removed, null);
    assert.ok(auth.byUid.has('d'), 'DROP kept'); assert.deepStrictEqual(accounts.methodsOf(auth.byUid.get('d')), ['google'], 'its Google is back');
    assert.ok(db.docs.has('members/d'), "DROP's application kept too");
    assert.deepStrictEqual(r.notMoved.map(x => x.method + ':' + x.why), ['google:link-failed']);
    assert.strictEqual(auth.byUid.get('k').email, 'k@x.gr');
  });
  await t('one merge at a time: a held lock -> merge-busy; a stale one is taken over; locks are released', async () => {
    const users = () => fakeAuth([{ uid: 'k', email: 'k@x.gr', emailVerified: true }, { uid: 'd' }]);
    let db = fakeDb({ 'mergeLocks/d': { at: Date.now() - 1000 } });
    let auth = users();
    await assert.rejects(accounts.mergeAccounts({ auth, db, now: () => NOW, keepUid: 'k', dropUid: 'd' }), e => e.code === 'merge-busy' && e.status === 409);
    assert.ok(auth.byUid.has('d')); assert.ok(!db.docs.has('mergeLocks/k'), 'the lock taken before giving up is released');
    db = fakeDb({ 'mergeLocks/d': { at: Date.now() - 11 * 60 * 1000 } });
    auth = users();
    await accounts.mergeAccounts({ auth, db, now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.ok(!auth.byUid.has('d'), 'a stale lock does not block for ever');
    assert.ok(![...db.docs.keys()].some(k => k.startsWith('mergeLocks/')), 'no locks left behind');
  });
  await t('LinkedIn is only claimed for KEEP when a LinkedIn link actually moved', async () => {
    const auth = fakeAuth([{ uid: 'k', email: 'k@x.gr', emailVerified: true }, { uid: 'd', customClaims: { li: true } }]);
    const r = await accounts.mergeAccounts({ auth, db: fakeDb(), now: () => NOW, keepUid: 'k', dropUid: 'd' });
    assert.strictEqual(r.linkedin, false); assert.ok(!(auth.byUid.get('k').customClaims || {}).li);
  });
  await t('a malformed body or uid is a 400/404, not a 500', async () => {
    let x = await call('{not json', { token: 'admin', users: [{ uid: 'adm' }] });
    assert.strictEqual(x.r.statusCode, 400); assert.strictEqual(x.r.body.error, 'bad-request');
    const auth = fakeAuth([{ uid: 'adm', email: 'kstouras@gmail.com', emailVerified: true }], TOKENS);
    auth.getUser = async () => { const e = new Error('bad uid'); e.code = 'auth/invalid-uid'; throw e; };
    x = await call({ action: 'merge', keep: 'adm', drop: 'x'.repeat(200) }, { token: 'admin', auth });
    assert.strictEqual(x.r.statusCode, 404); assert.strictEqual(x.r.body.error, 'no-such-account');
  });
  await t('tokens are checked for revocation (disabled or signed-out accounts)', async () => {
    const auth = fakeAuth([{ uid: 'adm' }], TOKENS);
    const seen = [];
    const v = auth.verifyIdToken.bind(auth);
    auth.verifyIdToken = async (tok, check) => { seen.push(check); return v(tok); };
    await call({ action: 'list' }, { token: 'admin', auth });
    assert.deepStrictEqual(seen, [true]);
  });

  /* ---- the HTTP handler ---- */
  await t('preflight: the site yes, another origin no', async () => {
    assert.strictEqual((await call(null, { method: 'OPTIONS' })).r.statusCode, 204);
    assert.strictEqual((await call(null, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } })).r.statusCode, 403);
  });
  await t('no ID token -> 401; a member is not an admin -> 403', async () => {
    assert.strictEqual((await call({ action: 'list' })).r.statusCode, 401);
    const x = await call({ action: 'list' }, { token: 'member' });
    assert.strictEqual(x.r.statusCode, 403); assert.strictEqual(x.r.body.error, 'not-admin');
  });
  await t('an admin address that is not verified is not an admin', async () => {
    assert.strictEqual((await call({ action: 'list' }, { token: 'adminUnverified' })).r.statusCode, 403);
  });
  await t('list: every account (all pages), its sign-in methods and its application', async () => {
    const users = [
      { uid: 'adm', email: 'kstouras@gmail.com', emailVerified: true, displayName: 'Admin', providerData: [G('adm', 'kstouras@gmail.com')], metadata: { creationTime: 'Mon, 01 Sep 2026 10:00:00 GMT', lastSignInTime: 'Tue, 30 Sep 2026 10:00:00 GMT' } },
      { uid: 'li1', displayName: 'Λίνα', customClaims: { li: true } },
      { uid: 'p1', email: 'p@x.gr', providerData: [PW('p@x.gr')] }
    ];
    const x = await call({ action: 'list' }, { token: 'admin', users, docs: { 'members/li1': APP({ status: 'active', firstName: 'Λίνα' }) } });
    assert.strictEqual(x.r.statusCode, 200);
    const a = x.r.body.accounts;
    assert.strictEqual(a.length, 3, 'all three, across pages');
    assert.deepStrictEqual(a.map(u => u.methods), [['google'], ['linkedin'], ['password']]);
    assert.strictEqual(a[1].application.status, 'active'); assert.strictEqual(a[1].application.firstName, 'Λίνα');
    assert.strictEqual(a[0].application, null);
    assert.strictEqual(a[0].created, Date.parse('Mon, 01 Sep 2026 10:00:00 GMT'));
  });
  await t('admin merge works; an admin cannot remove their own account', async () => {
    const users = [{ uid: 'adm', email: 'kstouras@gmail.com', emailVerified: true }, { uid: 'a' }, { uid: 'b' }];
    const x = await call({ action: 'merge', keep: 'a', drop: 'b' }, { token: 'admin', users });
    assert.strictEqual(x.r.statusCode, 200); assert.ok(!x.auth.byUid.has('b'));
    const y = await call({ action: 'merge', keep: 'a', drop: 'adm' }, { token: 'admin', users: [{ uid: 'adm' }, { uid: 'a' }] });
    assert.strictEqual(y.r.statusCode, 400); assert.strictEqual(y.r.body.error, 'cannot-remove-yourself');
  });
  await t('admin delete removes the sign-in; not their own', async () => {
    const x = await call({ action: 'delete', uid: 'p1' }, { token: 'admin', users: [{ uid: 'adm' }, { uid: 'p1' }] });
    assert.strictEqual(x.r.statusCode, 200); assert.ok(!x.auth.byUid.has('p1'));
    assert.strictEqual((await call({ action: 'delete', uid: 'adm' }, { token: 'admin', users: [{ uid: 'adm' }] })).r.statusCode, 400);
  });
  await t('mergeSelf: the other account, freshly signed in to, is merged into mine', async () => {
    const users = [{ uid: 'g1', email: 'maria@gmail.com', providerData: [G('g1', 'maria@gmail.com')] }, { uid: 'li1', customClaims: { li: true } }];
    const x = await call({ action: 'mergeSelf', otherIdToken: 'otherFresh' }, { token: 'member', users, docs: { 'members/li1': APP() } });
    assert.strictEqual(x.r.statusCode, 200); assert.strictEqual(x.r.body.report.kept, 'g1');
    assert.ok(!x.auth.byUid.has('li1')); assert.ok(x.db.docs.has('members/g1'));
    const log = [...x.db.docs.entries()].find(([k]) => k.startsWith('accountMerges/'))[1];
    assert.strictEqual(log.by, 'self');
  });
  await t('mergeSelf refuses: an old sign-in, the same account, a bad token', async () => {
    const users = [{ uid: 'g1' }, { uid: 'li1' }];
    let x = await call({ action: 'mergeSelf', otherIdToken: 'otherStale' }, { token: 'member', users });
    assert.strictEqual(x.r.body.error, 'other-sign-in-too-old'); assert.ok(x.auth.byUid.has('li1'));
    x = await call({ action: 'mergeSelf', otherIdToken: 'selfAgain' }, { token: 'member', users });
    assert.strictEqual(x.r.body.error, 'same-account');
    x = await call({ action: 'mergeSelf', otherIdToken: 'nonsense' }, { token: 'member', users });
    assert.strictEqual(x.r.body.error, 'bad-other-token');
  });
  await t('a member cannot use the admin actions', async () => {
    for (const body of [{ action: 'merge', keep: 'g1', drop: 'x' }, { action: 'delete', uid: 'x' }]) {
      const x = await call(body, { token: 'member', users: [{ uid: 'g1' }, { uid: 'x' }] });
      assert.strictEqual(x.r.statusCode, 403); assert.ok(x.auth.byUid.has('x'));
    }
  });
  await t('the admin list in accounts.js is the one in config.js and firestore.rules', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'assets/js/config.js'), 'utf8');
    const C = new Function('window', cfg + '; return window.SEMFE;')({});
    assert.deepStrictEqual(accounts.ADMIN_EMAILS.slice().sort(), C.ADMIN_EMAILS.map(x => x.toLowerCase()).sort());
    const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    const keys = n => [...rules.match(new RegExp('function ' + n + '\\(\\)\\s*\\{[\\s\\S]*?\\[([\\s\\S]*?)\\]'))[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.deepStrictEqual(accounts.PROFILE_KEYS, keys('profileKeys'), 'PROFILE_KEYS = profileKeys() in the rules');
    assert.deepStrictEqual(accounts.ADMIN_KEYS, keys('adminKeys'), 'ADMIN_KEYS = adminKeys() in the rules');
  });

  /* ---- LinkedIn: connecting a LinkedIn account that belongs to another account ---- */
  function liRun(body, merge) {
    const auth = fakeAuth([{ uid: 'me', email: 'me@x.gr', emailVerified: true }, { uid: 'other', customClaims: { li: true } }],
      { 'good-id-token': { uid: 'me', email: 'me@x.gr', email_verified: true } });
    auth.createCustomToken = async uid => 'TOKEN:' + uid;
    const links = new Map([['li-1', { uid: 'other' }]]);
    const db = { collection: () => ({ doc: id => ({ async get() { return { exists: links.has(id), data: () => links.get(id) }; }, async set(v) { links.set(id, Object.assign({}, links.get(id), v)); } }) }) };
    const fetch = async url => url.includes('accessToken') ? { ok: true, json: async () => ({ access_token: 'AT' }) } : { ok: true, json: async () => ({ sub: 'li-1', name: 'Me', email: 'me@x.gr', email_verified: true }) };
    const calls = [];
    const deps = { fetch, auth, db, now: () => NOW, merge: merge ? async (k, d) => { calls.push([k, d]); return { kept: k, removed: d }; } : undefined };
    const r = res();
    const cfg = { clientId: 'C', clientSecret: 'S', allowedOrigins: ['https://www.stouras.com'], redirectUris: ['https://www.stouras.com/semfealumni/auth/linkedin/'] };
    return linkedin.handle(req(Object.assign({ code: 'X', redirectUri: cfg.redirectUris[0] }, body), { authorization: 'Bearer good-id-token' }), r, deps, cfg)
      .then(() => ({ r, calls, links }));
  }
  await t('LinkedIn link mode, the LinkedIn belongs to another account, no merge asked -> 409, nothing merged', async () => {
    const x = await liRun({}, true);
    assert.strictEqual(x.r.statusCode, 409); assert.strictEqual(x.r.body.error, 'credential-already-in-use');
    assert.strictEqual(x.calls.length, 0); assert.strictEqual(x.links.get('li-1').uid, 'other');
  });
  await t('LinkedIn merge mode: that account is merged into mine, and LinkedIn signs in to mine', async () => {
    const x = await liRun({ merge: true }, true);
    assert.strictEqual(x.r.statusCode, 200);
    assert.deepStrictEqual(x.calls, [['me', 'other']]);
    assert.strictEqual(x.r.body.token, 'TOKEN:me'); assert.deepStrictEqual(x.r.body.merged, { kept: 'me', removed: 'other' });
    assert.strictEqual(x.links.get('li-1').uid, 'me');
  });
  await t('merge mode without a signed-in account (a plain sign-in) never merges', async () => {
    const auth = fakeAuth([{ uid: 'other', customClaims: { li: true } }]);
    auth.createCustomToken = async uid => 'TOKEN:' + uid;
    const links = new Map([['li-1', { uid: 'other' }]]);
    const db = { collection: () => ({ doc: id => ({ async get() { return { exists: links.has(id), data: () => links.get(id) }; }, async set(v) { links.set(id, Object.assign({}, links.get(id), v)); } }) }) };
    const fetch = async url => url.includes('accessToken') ? { ok: true, json: async () => ({ access_token: 'AT' }) } : { ok: true, json: async () => ({ sub: 'li-1', name: 'Me' }) };
    let merged = false;
    const r = res();
    const cfg = { clientId: 'C', clientSecret: 'S', allowedOrigins: ['https://www.stouras.com'], redirectUris: ['https://www.stouras.com/semfealumni/auth/linkedin/'] };
    await linkedin.handle(req({ code: 'X', redirectUri: cfg.redirectUris[0], merge: true }), r, { fetch, auth, db, now: () => NOW, merge: async () => { merged = true; } }, cfg);
    assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.token, 'TOKEN:other'); assert.strictEqual(merged, false);
  });

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
