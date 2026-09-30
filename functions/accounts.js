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
 * What a merge does (KEEP stays, DROP goes), in this order, so that a failure
 * part-way never loses anything that only DROP held:
 *   1. the application: DROP's is copied over when KEEP has none; with two,
 *      KEEP's is completed from DROP's (empty fields only), the dues years are
 *      joined, and the further-along status wins (active > pending > rejected),
 *      bringing that application's vetted name with it;
 *   2. the directory card follows the merged application;
 *   3. LinkedIn links (linkedinLinks/) that pointed to DROP now point to KEEP;
 *   4. DROP's Google / Facebook / LinkedIn-OIDC sign-ins move to KEEP, unless
 *      KEEP already has one of that kind (Firebase allows one per kind);
 *      DROP's e-mail + password cannot move (a password belongs to an address),
 *      and KEEP can add its own from the account page;
 *   5. DROP's application and card are deleted, then DROP itself;
 *   6. KEEP takes DROP's e-mail address when it has none;
 *   7. a note in accountMerges/ (server only: read it in the Firebase console) says who merged what, and when. */
'use strict';

const { HttpError, LINKS } = require('./linkedin');

// KEEP IN SYNC with ADMIN_EMAILS in assets/js/config.js and isAdmin() in
// firestore.rules (tools/check.mjs fails when the three differ).
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

async function mergeAccounts({ auth, db, now, keepUid, dropUid, by }) {
  if (!keepUid || !dropUid) throw new HttpError(400, 'bad-request');
  if (keepUid === dropUid) throw new HttpError(400, 'same-account');
  const keep = await auth.getUser(keepUid).catch(e => { if (e && e.code === 'auth/user-not-found') throw new HttpError(404, 'no-such-account'); throw e; });
  const drop = await auth.getUser(dropUid).catch(e => { if (e && e.code === 'auth/user-not-found') throw new HttpError(404, 'no-such-account'); throw e; });
  const report = { kept: keepUid, removed: dropUid, application: 'none', moved: [], notMoved: [], linkedin: false, email: null };

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
  if (linkRefs.length || (drop.customClaims && drop.customClaims.li === true)) {
    report.linkedin = true;
    const claims = Object.assign({}, keep.customClaims || {});
    if (claims.li !== true) { claims.li = true; await auth.setCustomUserClaims(keepUid, claims); }
    if (methodsOf(keep).indexOf('linkedin') === -1) report.moved.push('linkedin');
  }

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

  // 5. DROP's documents, its sign-ins (unlinked first: one sign-in can belong to one account), then DROP itself
  await Promise.all([members.doc(dropUid).delete(), dir.doc(dropUid).delete()]);
  if (toMove.length) await auth.updateUser(dropUid, { providersToUnlink: toMove.map(p => p.providerId) });
  for (const p of toMove) {
    const link = { providerId: p.providerId, uid: p.uid };
    if (p.email) link.email = p.email;
    if (p.displayName) link.displayName = p.displayName;
    if (p.photoURL) link.photoURL = p.photoURL;
    try { await auth.updateUser(keepUid, { providerToLink: link }); report.moved.push(KEY[p.providerId]); }
    catch (e) { report.notMoved.push({ method: KEY[p.providerId], why: 'link-failed', email: p.email || '' }); }
  }
  await auth.deleteUser(dropUid);

  // 6. an account with no e-mail takes DROP's (free now that DROP is gone)
  const patch = {};
  if (!keep.email && drop.email) { patch.email = drop.email; patch.emailVerified = !!drop.emailVerified; report.email = drop.email; }
  if (!keep.displayName && drop.displayName) patch.displayName = drop.displayName;
  if (!keep.photoURL && drop.photoURL) patch.photoURL = drop.photoURL;
  if (Object.keys(patch).length) {
    try { await auth.updateUser(keepUid, patch); } catch (e) { if (patch.email) report.email = null; }
  }

  // 7. the record
  await db.collection('accountMerges').add({
    keep: keepUid, drop: dropUid, by: by || '', at: now(),
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
    try { me = await deps.auth.verifyIdToken(authz.replace(/^Bearer\s+/, '')); }
    catch (e) { throw new HttpError(401, 'bad-id-token'); }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action;

    if (action === 'mergeSelf') {
      // the person proves the other account with a fresh sign-in to it
      if (typeof body.otherIdToken !== 'string' || !body.otherIdToken) throw new HttpError(400, 'bad-request');
      let other;
      try { other = await deps.auth.verifyIdToken(body.otherIdToken); }
      catch (e) { throw new HttpError(401, 'bad-other-token'); }
      if (other.uid === me.uid) throw new HttpError(400, 'same-account');
      const nowS = Math.floor(deps.clock() / 1000);
      if (!(other.auth_time > nowS - FRESH_SECONDS)) throw new HttpError(401, 'other-sign-in-too-old');
      const report = await mergeAccounts({ auth: deps.auth, db: deps.db, now: deps.now, keepUid: me.uid, dropUid: other.uid, by: 'self' });
      return res.status(200).json({ ok: true, report });
    }

    if (!isAdminToken(me)) throw new HttpError(403, 'not-admin');
    if (action === 'list') return res.status(200).json({ ok: true, accounts: await listAccounts(deps) });
    if (action === 'merge') {
      if (typeof body.keep !== 'string' || typeof body.drop !== 'string') throw new HttpError(400, 'bad-request');
      if (body.drop === me.uid) throw new HttpError(400, 'cannot-remove-yourself');
      const report = await mergeAccounts({ auth: deps.auth, db: deps.db, now: deps.now, keepUid: body.keep, dropUid: body.drop, by: me.email });
      return res.status(200).json({ ok: true, report });
    }
    if (action === 'delete') {
      if (typeof body.uid !== 'string' || !body.uid) throw new HttpError(400, 'bad-request');
      if (body.uid === me.uid) throw new HttpError(400, 'cannot-remove-yourself');
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

module.exports = { handle, listAccounts, mergeAccounts, mergeApplications, methodsOf, isAdminToken, ADMIN_EMAILS, PROFILE_KEYS, ADMIN_KEYS };
