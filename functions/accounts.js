/* SEMFE Alumni: registered accounts, and merging two accounts of one person.
 *
 * Why on the server: a browser can only ever act as ONE account, and the
 * rules (rightly) never let a member write the admin fields of an application
 * (status, dues). Moving an approved application, a LinkedIn link or a Google
 * sign-in from one account to another, and deleting the one left over, needs
 * the Admin SDK. Everything here is pure logic with injected dependencies
 * (auth, db, now), so test.js runs it offline; index.js wires the real ones.
 *
 * One merge, three ways in:
 *   - an admin, from the admin page: any two accounts ("list", "merge");
 *   - the person, from their account page: the account they are signed in to
 *     is kept, and they prove the other one by signing in to it as well
 *     ("mergeSelf", with that account's fresh ID token);
 *   - the person, through LinkedIn (linkedin.js, mode "merge"): LinkedIn
 *     proves the LinkedIn account, which is enough to sign in to the account
 *     it belongs to.
 *
 * Safety rules, whichever way in:
 *   - the account kept must have a CONFIRMED e-mail, or none (mergeSelf):
 *     otherwise someone could register an address that is not theirs, merge
 *     their own Google or LinkedIn into it, and keep that way in after the
 *     real owner claims the address;
 *   - an address moves to KEEP only if it was confirmed on DROP;
 *   - an account with a confirmed admin address is never the one removed;
 *   - only one merge at a time may touch an account (mergeLocks/{uid}).
 *
 * What a merge does (KEEP stays, DROP goes), in this order, so that a failure
 * part-way never loses anything that only DROP held:
 *   1. the application: DROP's is copied over when KEEP has none; with two,
 *      KEEP's is completed from DROP's (empty fields only), the dues years are
 *      joined, and the further-along status wins (active > pending > rejected),
 *      bringing that application's vetted name with it;
 *   2. the directory card follows the merged application;
 *   3. LinkedIn links (linkedinLinks/) that pointed to DROP now point to KEEP,
 *      and so do the messages DROP sent from the Σχόλια page (feedback/);
 *   4. DROP's Google / Facebook / LinkedIn-OIDC sign-ins move to KEEP, unless
 *      KEEP already has one of that kind (Firebase allows one per kind);
 *      DROP's e-mail + password cannot move (a password belongs to an address),
 *      and KEEP can add its own from the account page. If one fails to attach
 *      to KEEP, it goes back to DROP and DROP is NOT deleted (report.partial):
 *      nobody is left without their way in, and the merge can be run again;
 *   5. DROP's application and card are deleted, then DROP itself;
 *   6. KEEP takes DROP's e-mail address when it has none and DROP's was confirmed;
 *   7. a note in accountMerges/ (server only: read it in the Firebase console) says who merged what, and when. */
'use strict';

const { HttpError, LINKS } = require('./linkedin');

// KEEP IN SYNC with ADMIN_EMAILS in assets/js/config.js and isAdmin() in
// firestore.rules (test-accounts.js pins this list to config.js;
// tools/check.mjs pins config.js to the rules).
const ADMIN_EMAILS = ['kstouras@gmail.com', 'gradsemfe@gmail.com'];

const KEY = { 'google.com': 'google', 'facebook.com': 'facebook', 'oidc.linkedin': 'linkedin', password: 'password' };
const FEDERATED = ['google.com', 'facebook.com', 'oidc.linkedin'];
// KEEP IN SYNC with profileKeys() / adminKeys() in firestore.rules: the merged
// application must stay a document its owner may go on editing
const PROFILE_KEYS = ['firstName', 'lastName', 'email', 'phone', 'stage', 'entryYear', 'gradYear',
  'direction', 'employer', 'position', 'city', 'linkedin',
  'consentNewsletter', 'consentJobs', 'consentDirectory', 'note',
  'acceptedPrivacy', 'provider', 'createdAt', 'updatedAt'];
const ADMIN_KEYS = ['status', 'duesYears', 'adminNote', 'reviewedAt', 'reviewedBy'];
const FILL = ['email', 'phone', 'stage', 'entryYear', 'gradYear', 'direction', 'employer', 'position', 'city', 'linkedin', 'note'];
const RANK = { rejected: 1, pending: 2, active: 3 };
const FRESH_SECONDS = 15 * 60;          // the proof for mergeSelf: a sign-in in the last 15 minutes
const LOCKS = 'mergeLocks';             // one merge at a time per account (server only, like accountMerges)
const LOCK_STALE_MS = 10 * 60 * 1000;   // a lock left behind by a crash is taken over after 10 minutes

function isAdminToken(t) {
  return !!t && t.email_verified === true && ADMIN_EMAILS.indexOf(String(t.email || '').toLowerCase()) !== -1;
}
function ms(t) {
  if (!t) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  const n = typeof t === 'number' ? t : Date.parse(t);
  return isFinite(n) ? n : null;
}
function empty(v) { return v === undefined || v === null || v === ''; }
function isAdminUser(u) {
  return !!u && u.emailVerified === true && ADMIN_EMAILS.indexOf(String(u.email || '').toLowerCase()) !== -1;
}
/* the account behind a uid, or a 404 (a uid Firebase rejects outright counts as not found) */
function getAccount(auth, uid) {
  return auth.getUser(uid).catch(e => {
    if (e && (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-uid' || e.code === 'auth/argument-error')) throw new HttpError(404, 'no-such-account');
    throw e;
  });
}
/* Take the lock for one account; 409 when another merge holds it. */
async function lockAccount(db, uid, clock) {
  const ref = db.collection(LOCKS).doc(uid);
  try { await ref.create({ at: clock() }); return ref; }
  catch (e) {
    const exists = e && (e.code === 6 || e.code === 'already-exists' || /already exists/i.test(String(e.message || '')));
    if (!exists) throw e;
    const s = await ref.get();
    const at = s.exists ? (s.data() || {}).at : null;
    if (typeof at === 'number' && clock() - at > LOCK_STALE_MS) { await ref.set({ at: clock() }); return ref; }
    throw new HttpError(409, 'merge-busy');
  }
}
function methodsOf(u) {
  const l = [];
  (u.providerData || []).forEach(p => { const k = KEY[p.providerId]; if (k && l.indexOf(k) === -1) l.push(k); });
  if (u.customClaims && u.customClaims.li === true && l.indexOf('linkedin') === -1) l.push('linkedin');
  return l;
}

/* Every sign-in account, with its application (if any), for the admin page. */
async function listAccounts({ auth, db }) {
  const users = [];
  let pageToken;
  do {
    const r = await auth.listUsers(1000, pageToken);
    users.push(...r.users);
    pageToken = r.pageToken;
  } while (pageToken);
  const apps = new Map();
  (await db.collection('members').get()).forEach(d => apps.set(d.id, d.data() || {}));
  return users.map(u => {
    const m = apps.get(u.uid), md = u.metadata || {};
    return {
      uid: u.uid, email: u.email || '', emailVerified: !!u.emailVerified, name: u.displayName || '', photo: u.photoURL || '',
      methods: methodsOf(u), disabled: !!u.disabled,
      created: ms(md.creationTime), lastSeen: Math.max(ms(md.lastSignInTime) || 0, ms(md.lastRefreshTime) || 0) || null,
      application: m ? {
        status: m.status || 'pending', firstName: m.firstName || '', lastName: m.lastName || '', email: m.email || '',
        gradYear: m.gradYear == null ? null : m.gradYear, duesYears: Array.isArray(m.duesYears) ? m.duesYears : [], createdAt: ms(m.createdAt)
      } : null
    };
  });
}

/* The application after a merge (null: nothing to write). Pure. */
function mergeApplications(k, d) {
  if (!d) return null;                                   // DROP never applied: KEEP's stays as it is
  const pick = src => { const o = {}; PROFILE_KEYS.concat(ADMIN_KEYS).forEach(f => { if (src[f] !== undefined) o[f] = src[f]; }); return o; };
  if (!k) return pick(d);                                // KEEP never applied: DROP's moves over whole
  const out = pick(k);
  FILL.forEach(f => { if (empty(out[f]) && !empty(d[f])) out[f] = d[f]; });
  const ks = RANK[k.status || 'pending'] || 2, ds = RANK[d.status || 'pending'] || 2;
  if (ds > ks) {                                         // the further-along application decides, with its vetted name
    out.status = d.status;
    ['firstName', 'lastName', 'reviewedAt', 'reviewedBy'].forEach(f => { if (!empty(d[f])) out[f] = d[f]; });
  }
  const years = [].concat(k.duesYears || [], d.duesYears || []).filter(y => Number.isInteger(y));
  if (years.length) out.duesYears = Array.from(new Set(years)).sort((a, b) => a - b);
  const notes = [k.adminNote, d.adminNote].filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  if (notes.length) out.adminNote = Array.from(new Set(notes)).join(' · ').slice(0, 500);
  const kc = ms(k.createdAt), dc = ms(d.createdAt);
  if (dc != null && (kc == null || dc < kc)) out.createdAt = d.createdAt;
  return out;
}

async function mergeAccounts({ auth, db, now, clock, keepUid, dropUid, by }) {
  if (!keepUid || !dropUid || typeof keepUid !== 'string' || typeof dropUid !== 'string') throw new HttpError(400, 'bad-request');
  if (keepUid === dropUid) throw new HttpError(400, 'same-account');
  clock = clock || Date.now;
  const keep = await getAccount(auth, keepUid);
  const drop = await getAccount(auth, dropUid);
  if (isAdminUser(drop)) throw new HttpError(400, 'cannot-remove-admin');
  // both accounts, always in the same order, so two merges crossing each other cannot both start
  const held = [];
  try {
    for (const uid of [keepUid, dropUid].sort()) held.push(await lockAccount(db, uid, clock));
    return await mergeLocked({ auth, db, now, keep, drop, keepUid, dropUid, by });
  } finally {
    await Promise.all(held.map(r => r.delete().catch(() => {})));
  }
}

async function mergeLocked({ auth, db, now, keep, drop, keepUid, dropUid, by }) {
  const report = { kept: keepUid, removed: dropUid, application: 'none', moved: [], notMoved: [], linkedin: false, email: null, partial: false };

  // 1-2. the application and the directory card
  const members = db.collection('members'), dir = db.collection('directory');
  const [ka, da, kd, dd] = await Promise.all([members.doc(keepUid).get(), members.doc(dropUid).get(), dir.doc(keepUid).get(), dir.doc(dropUid).get()]);
  const merged = mergeApplications(ka.exists ? ka.data() : null, da.exists ? da.data() : null);
  if (merged) {
    merged.updatedAt = now();
    await members.doc(keepUid).set(merged);
    report.application = ka.exists ? 'merged' : 'moved';
    if (merged.status === 'active' && merged.consentDirectory === true && (kd.exists || dd.exists)) {
      await dir.doc(keepUid).set({
        name: String(merged.firstName || '') + ' ' + String(merged.lastName || ''),
        gradYear: merged.gradYear == null ? null : merged.gradYear,
        direction: merged.direction || '', employer: merged.employer || '', position: merged.position || '',
        city: merged.city || '', linkedin: merged.linkedin || '', updatedAt: now()
      });
    }
  } else if (ka.exists) report.application = 'kept';

  // 3. LinkedIn links
  const links = await db.collection(LINKS).where('uid', '==', dropUid).get();
  const linkRefs = [];
  links.forEach(d => linkRefs.push(d.ref));
  await Promise.all(linkRefs.map(r => r.set({ uid: keepUid, updatedAt: now() }, { merge: true })));
  if (linkRefs.length) {                              // a LinkedIn that signs in to DROP now signs in to KEEP
    report.linkedin = true;
    const claims = Object.assign({}, keep.customClaims || {});
    if (claims.li !== true) { claims.li = true; await auth.setCustomUserClaims(keepUid, claims); }
    if (methodsOf(keep).indexOf('linkedin') === -1) report.moved.push('linkedin');
  }

  // 3b. messages sent from the Σχόλια page follow the person (deleting DROP
  //     would otherwise delete them, see cleanupUser in linkedin.js)
  const fbs = await db.collection('feedback').where('uid', '==', dropUid).get();
  const fbRefs = [];
  fbs.forEach(d => fbRefs.push(d.ref));
  await Promise.all(fbRefs.map(r => r.set({ uid: keepUid }, { merge: true })));
  report.feedback = fbRefs.length;

  // 4. sign-in methods: which of DROP's can move
  const keepHas = (keep.providerData || []).map(p => p.providerId);
  const toMove = [];
  (drop.providerData || []).forEach(p => {
    if (FEDERATED.indexOf(p.providerId) !== -1) {
      if (keepHas.indexOf(p.providerId) !== -1) report.notMoved.push({ method: KEY[p.providerId], why: 'kept-has-one', email: p.email || '' });
      else toMove.push(p);
    } else if (p.providerId === 'password') {
      report.notMoved.push({ method: 'password', why: 'password', email: p.email || drop.email || '' });
    }
  });

  // 5. DROP's sign-ins (unlinked first: one sign-in can belong to one account),
  //    then, only when every one of them found its new home, DROP itself
  const linkOf = p => {
    const link = { providerId: p.providerId, uid: p.uid };
    if (p.email) link.email = p.email;
    if (p.displayName) link.displayName = p.displayName;
    if (p.photoURL) link.photoURL = p.photoURL;
    return link;
  };
  if (toMove.length) await auth.updateUser(dropUid, { providersToUnlink: toMove.map(p => p.providerId) });
  const failed = [];
  for (const p of toMove) {
    try { await auth.updateUser(keepUid, { providerToLink: linkOf(p) }); report.moved.push(KEY[p.providerId]); }
    catch (e) { failed.push(p); }
  }
  if (failed.length) {
    // give DROP back what could not move, and keep DROP: nobody loses a way in
    for (const p of failed) {
      let back = true;
      try { await auth.updateUser(dropUid, { providerToLink: linkOf(p) }); } catch (e) { back = false; }
      report.notMoved.push({ method: KEY[p.providerId], why: back ? 'link-failed' : 'link-failed-lost', email: p.email || '' });
    }
    report.partial = true;
    report.removed = null;
  } else {
    await Promise.all([members.doc(dropUid).delete(), dir.doc(dropUid).delete()]);
    await auth.deleteUser(dropUid);
  }

  // 6. an account with no e-mail takes DROP's (free now that DROP is gone),
  //    but only a CONFIRMED one: an unconfirmed address proves nothing
  const patch = {};
  if (!report.partial && !keep.email && drop.email && drop.emailVerified === true) { patch.email = drop.email; patch.emailVerified = true; report.email = drop.email; }
  if (!keep.displayName && drop.displayName) patch.displayName = drop.displayName;
  if (!keep.photoURL && drop.photoURL) patch.photoURL = drop.photoURL;
  if (Object.keys(patch).length) {
    try { await auth.updateUser(keepUid, patch); } catch (e) { if (patch.email) report.email = null; }
  }

  // 7. the record
  await db.collection('accountMerges').add({
    keep: keepUid, drop: dropUid, by: by || '', at: now(), partial: report.partial,
    keepEmail: keep.email || '', dropEmail: drop.email || '', keepName: keep.displayName || '', dropName: drop.displayName || '',
    application: report.application, moved: report.moved, notMoved: report.notMoved.map(x => x.method + ':' + x.why)
  });
  return report;
}

/* The HTTP handler. `cfg`: { allowedOrigins[] }. Every call carries the
   caller's Firebase ID token (Authorization: Bearer …). */
async function handle(req, res, deps, cfg) {
  const origin = req.get ? req.get('origin') : (req.headers && req.headers.origin);
  const originOk = !!origin && cfg.allowedOrigins.indexOf(origin) !== -1;
  if (originOk) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(originOk ? 204 : 403).send('');
  }
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed');
    if (!originOk) throw new HttpError(403, 'origin-not-allowed');
    const authz = (req.get ? req.get('authorization') : (req.headers && req.headers.authorization)) || '';
    if (!/^Bearer\s+\S+/.test(authz)) throw new HttpError(401, 'not-signed-in');
    let me;
    // checkRevoked: a disabled or signed-out-everywhere account's token is refused
    try { me = await deps.auth.verifyIdToken(authz.replace(/^Bearer\s+/, ''), true); }
    catch (e) { throw new HttpError(401, 'bad-id-token'); }
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch (e) { throw new HttpError(400, 'bad-request'); }
    if (!body || typeof body !== 'object') throw new HttpError(400, 'bad-request');
    const action = body.action;
    const merge = (keepUid, dropUid, by) => mergeAccounts({ auth: deps.auth, db: deps.db, now: deps.now, clock: deps.clock, keepUid, dropUid, by });

    if (action === 'mergeSelf') {
      // the person proves the other account with a fresh sign-in to it
      if (typeof body.otherIdToken !== 'string' || !body.otherIdToken) throw new HttpError(400, 'bad-request');
      let other;
      try { other = await deps.auth.verifyIdToken(body.otherIdToken, true); }
      catch (e) { throw new HttpError(401, 'bad-other-token'); }
      if (other.uid === me.uid) throw new HttpError(400, 'same-account');
      const nowS = Math.floor(deps.clock() / 1000);
      if (!(other.auth_time > nowS - FRESH_SECONDS)) throw new HttpError(401, 'other-sign-in-too-old');
      // the account kept must own its address (see the safety rules at the top)
      if (me.email && me.email_verified !== true) throw new HttpError(403, 'email-not-verified');
      const report = await merge(me.uid, other.uid, 'self');
      return res.status(200).json({ ok: true, report });
    }

    if (!isAdminToken(me)) throw new HttpError(403, 'not-admin');
    if (action === 'list') return res.status(200).json({ ok: true, accounts: await listAccounts(deps) });
    if (action === 'merge') {
      if (typeof body.keep !== 'string' || typeof body.drop !== 'string') throw new HttpError(400, 'bad-request');
      if (body.drop === me.uid) throw new HttpError(400, 'cannot-remove-yourself');
      const report = await merge(body.keep, body.drop, me.email);
      return res.status(200).json({ ok: true, report });
    }
    if (action === 'delete') {
      if (typeof body.uid !== 'string' || !body.uid) throw new HttpError(400, 'bad-request');
      if (body.uid === me.uid) throw new HttpError(400, 'cannot-remove-yourself');
      const u = await getAccount(deps.auth, body.uid);
      if (isAdminUser(u)) throw new HttpError(400, 'cannot-remove-admin');     // an admin is removed from ADMIN_EMAILS first, never from here
      await deps.auth.deleteUser(body.uid).catch(e => { if (e && e.code === 'auth/user-not-found') throw new HttpError(404, 'no-such-account'); throw e; });
      // the cleanupDeletedUser trigger removes the application, card and LinkedIn link
      return res.status(200).json({ ok: true });
    }
    throw new HttpError(400, 'bad-request');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (!(e instanceof HttpError) && deps.log) deps.log(e);
    return res.status(status).json({ error: e instanceof HttpError ? e.code : 'internal' });
  }
}

module.exports = { handle, listAccounts, mergeAccounts, mergeApplications, methodsOf, isAdminToken, isAdminUser, ADMIN_EMAILS, PROFILE_KEYS, ADMIN_KEYS, LOCKS };
