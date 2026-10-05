/* SEMFE Alumni Cloud Functions:
 *   linkedinSignIn      LinkedIn sign-in (HTTPS, linkedin.js)
 *   accounts            the admin page's list of registered accounts, and
 *                       merging two accounts of one person (HTTPS, accounts.js)
 *   cleanupDeletedUser  when a sign-in account is deleted, removes its
 *                       application, directory card, e-mail alert choice,
 *                       LinkedIn link and the messages it sent from the
 *                       Σχόλια page
 *   feedbackCreated     a new message on the Σχόλια page: a copy to the
 *                       admins, a confirmation with the ticket number to the
 *                       sender (feedback.js)
 *   feedbackUpdated     a ticket closed with an answer: the answer to the
 *                       sender (feedback.js)
 *   recordVisit         the site's own visit counter for the «Στατιστικά» page:
 *                       one small message per page view (assets/js/visit.js),
 *                       counted per day in siteVisits/; on the first page of a
 *                       visit it also names the university or company the
 *                       visitor's network belongs to (netorg.js). The address
 *                       is never stored or logged (site-visits.js)
 *   memberStats         recounts the anonymous statistics of the members
 *                       (publicStats/members) whenever an application changes
 *                       (member-stats.js)
 *   alertsMailer        every 2 hours: e-mails each member who chose an alert
 *                       on account/ what has been published since (new
 *                       announcements and events from the site's feed.json,
 *                       «Τι νέο» entries an admin approved). The first run
 *                       only records what is already published (alerts.js)
 *   alertsUnsubscribe   the "stop the alerts" link in those e-mails (alerts.js)
 *   publishAnnouncement an admin's new announcement from the editor on blog/:
 *                       written as a Markdown file + pictures in the site's
 *                       GitHub repository, in one commit; a workflow then
 *                       builds the page (announcements.js, ANNOUNCE-SETUP.md)
 *
 * Settings (asked for by the Firebase CLI on the first deploy, stored in
 * functions/.env.<project-id>; the secret goes to Google Secret Manager):
 *   LINKEDIN_CLIENT_ID      the LinkedIn app's Client ID (public)
 *   LINKEDIN_CLIENT_SECRET  the LinkedIn app's Primary Client Secret (SECRET):
 *                           firebase functions:secrets:set LINKEDIN_CLIENT_SECRET
 *   ALLOWED_ORIGINS         comma-separated site origins allowed to call it
 *   LINKEDIN_REDIRECT_URIS  comma-separated callback pages registered at LinkedIn
 *   SITE_URL                the site's address, for the links in e-mails
 *   FEEDBACK_TO             comma-separated addresses that receive new feedback
 *   SMTP_HOST, SMTP_PORT    the mail server (default: Gmail, smtp.gmail.com:465)
 *   PUBLISH_REPO, PUBLISH_BRANCH   the GitHub repository (owner/name) and branch the
 *                           announcements are committed to
 *   GITHUB_PUBLISH_TOKEN    (SECRET) a fine-grained GitHub token with "Contents:
 *                           read and write" on that one repository, or "none" to
 *                           leave publishing off: ANNOUNCE-SETUP.md
 *   SMTP_USER, SMTP_PASS    (SECRETS) the sending account and its app password:
 *                           firebase functions:secrets:set SMTP_USER / SMTP_PASS
 *                           (FEEDBACK-SETUP.md)
 *
 * Deploy (always name the project):
 *   cd functions && npm install && cd ..
 *   firebase deploy --only functions --project <your-project-id> */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { defineString, defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const functionsV1 = require('firebase-functions/v1');
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { handle, cleanupUser, splitList } = require('./linkedin');
const accounts = require('./accounts');
const feedback = require('./feedback');
const alerts = require('./alerts');
const announcements = require('./announcements');

initializeApp();

const LINKEDIN_CLIENT_ID = defineString('LINKEDIN_CLIENT_ID', { description: 'LinkedIn app Client ID (Auth tab)' });
const LINKEDIN_CLIENT_SECRET = defineSecret('LINKEDIN_CLIENT_SECRET');
const ALLOWED_ORIGINS = defineString('ALLOWED_ORIGINS', {
  default: 'https://www.stouras.com,https://stouras.com',
  description: 'Comma-separated origins of the site that may call this function'
});
const LINKEDIN_REDIRECT_URIS = defineString('LINKEDIN_REDIRECT_URIS', {
  default: 'https://www.stouras.com/semfealumni/auth/linkedin/',
  description: 'Comma-separated LinkedIn callback pages (must match the LinkedIn app Auth tab exactly)'
});

const SITE_URL = defineString('SITE_URL', {
  default: 'https://semfealumni.gr/',
  description: "The site's address, ending in /, for the links in e-mails"
});
const FEEDBACK_TO = defineString('FEEDBACK_TO', {
  default: 'kstouras@gmail.com',
  description: 'Comma-separated addresses that receive each new message from the Σχόλια page'
});
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com', description: 'Mail server for the feedback e-mails' });
const SMTP_PORT = defineString('SMTP_PORT', { default: '465', description: 'Mail server port (465 = SSL)' });
const PUBLISH_REPO = defineString('PUBLISH_REPO', {
  default: 'semfealumni/semfealumni.github.io',
  description: 'The GitHub repository (owner/name) the announcements written on blog/ are committed to'
});
const PUBLISH_BRANCH = defineString('PUBLISH_BRANCH', { default: 'main', description: 'The branch the site is published from' });
const GITHUB_PUBLISH_TOKEN = defineSecret('GITHUB_PUBLISH_TOKEN');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');

exports.linkedinSignIn = onRequest(
  { region: 'europe-west1', secrets: [LINKEDIN_CLIENT_SECRET], invoker: 'public', maxInstances: 5, timeoutSeconds: 30, memory: '256MiB' },
  (req, res) => handle(req, res, {
    fetch: globalThis.fetch,
    auth: getAuth(),
    db: getFirestore(),
    now: () => FieldValue.serverTimestamp(),
    log: e => logger.error('linkedinSignIn failed', e),
    merge: (keep, drop) => accounts.mergeAccounts({ auth: getAuth(), db: getFirestore(), now: () => FieldValue.serverTimestamp(), keepUid: keep, dropUid: drop, by: 'linkedin' })
  }, {
    clientId: LINKEDIN_CLIENT_ID.value(),
    clientSecret: LINKEDIN_CLIENT_SECRET.value(),
    allowedOrigins: splitList(ALLOWED_ORIGINS.value()),
    redirectUris: splitList(LINKEDIN_REDIRECT_URIS.value())
  })
);

exports.accounts = onRequest(
  { region: 'europe-west1', invoker: 'public', maxInstances: 3, timeoutSeconds: 120, memory: '256MiB' },
  (req, res) => accounts.handle(req, res, {
    auth: getAuth(),
    db: getFirestore(),
    now: () => FieldValue.serverTimestamp(),
    clock: () => Date.now(),
    log: e => logger.error('accounts failed', e)
  }, { allowedOrigins: splitList(ALLOWED_ORIGINS.value()) })
);

/* The editor on blog/ (assets/js/announce.js): an admin's announcement becomes a file in the repository (announcements.js). */
exports.publishAnnouncement = onRequest(
  { region: 'europe-west1', secrets: [GITHUB_PUBLISH_TOKEN], invoker: 'public', maxInstances: 2, timeoutSeconds: 90, memory: '512MiB' },
  (req, res) => announcements.handle(req, res, {
    auth: getAuth(),
    fetch: globalThis.fetch,
    clock: () => Date.now(),
    log: e => logger.error('publishAnnouncement failed', e)
  }, {
    allowedOrigins: splitList(ALLOWED_ORIGINS.value()),
    token: GITHUB_PUBLISH_TOKEN.value(),
    repo: PUBLISH_REPO.value(),
    branch: PUBLISH_BRANCH.value(),
    siteUrl: SITE_URL.value()
  })
);

/* Firebase Auth has no 2nd-generation "user deleted" trigger, so this one is 1st generation. */
exports.cleanupDeletedUser = functionsV1.region('europe-west1').auth.user().onDelete(user =>
  cleanupUser({ db: getFirestore(), uid: user.uid }).then(n => logger.info('cleaned up ' + n + ' document(s) of deleted user'))
);

/* ---- the Σχόλια page's e-mails (feedback.js) ---------------------------- */
let transport = null;
function mailer() {
  if (!transport) {
    const nodemailer = require('nodemailer');
    const port = parseInt(SMTP_PORT.value(), 10) || 465;
    transport = nodemailer.createTransport({ host: SMTP_HOST.value(), port, secure: port === 465, auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() } });
  }
  return transport;
}
function feedbackCfg() {
  const site = SITE_URL.value().replace(/\/?$/, '/');
  const to = splitList(FEEDBACK_TO.value());
  return { site, to, from: '"Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ" <' + SMTP_USER.value() + '>', replyTo: to[0] || undefined };
}
function feedbackDeps(ref) {
  return {
    now: () => FieldValue.serverTimestamp(),
    // "claim" a field in a transaction, so a retried or duplicated event never
    // mails twice: a sentinel (mailedAt) only when the field is still empty,
    // a string (the answer's hash) only when it differs from what is there
    claim: (field, value, stillTrue) => getFirestore().runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const cur = snap.get(field);
      if (typeof value === 'string' ? cur === value : cur != null) return false;
      if (stillTrue && !stillTrue(snap.data())) return false;
      tx.update(ref, { [field]: value });
      return true;
    }),
    update: patch => ref.update(patch),
    shots: async () => {
      const qs = await ref.collection('shots').get();
      return qs.docs.sort((a, b) => +a.id - +b.id).map(d => d.get('url')).filter(u => typeof u === 'string');
    },
    // e-mail can be left off: SMTP_USER set to "none" (no @) records that on
    // the ticket instead of trying to log in with a placeholder
    send: msg => /@/.test(SMTP_USER.value()) ? mailer().sendMail(msg)
      : Promise.reject(Object.assign(new Error('e-mail is not set up yet (SMTP_USER, FEEDBACK-SETUP.md step 2)'), { code: 'MAIL_OFF' }))
  };
}
const FB_OPTS = { document: 'feedback/{ticket}', region: 'europe-west1', secrets: [SMTP_USER, SMTP_PASS], retry: false, maxInstances: 3, timeoutSeconds: 60, memory: '256MiB' };

exports.feedbackCreated = onDocumentCreated(FB_OPTS, async event => {
  if (!event.data) return;
  const r = await feedback.onCreated(event.params.ticket, event.data.data(), feedbackDeps(event.data.ref), feedbackCfg());
  logger.info('feedback ' + event.params.ticket + ': ' + r);
});
exports.feedbackUpdated = onDocumentUpdated(FB_OPTS, async event => {
  if (!event.data) return;
  const r = await feedback.onUpdated(event.params.ticket, event.data.before.data(), event.data.after.data(), feedbackDeps(event.data.after.ref), feedbackCfg());
  if (r !== 'skip' && r !== 'already') logger.info('feedback ' + event.params.ticket + ' answer: ' + r);
});

/* ---- the «Στατιστικά» page ---------------------------------------------- */
const netorg = require('./netorg');
const siteVisits = require('./site-visits');
const stats = require('./member-stats');
/* every page the site has (written by tools/build.mjs): a path that is not
   here is counted as 'other', so nobody can add keys by inventing addresses */
const SITE_PATHS = require('./site-paths.json').paths;
const VISIT_ORIGINS = ['https://semfealumni.gr', 'https://www.semfealumni.gr'];
const OWN_HOSTS = ['semfealumni.gr', 'www.semfealumni.gr'];

function within(promise, ms) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
}
async function reverseDns(ip) {
  try {
    const names = await within(require('node:dns').promises.reverse(ip), 2000);
    return (names && names[0]) || '';
  } catch (e) { return ''; }
}
/* the network's registration, over RDAP; ARIN's server redirects to the
   registry of any region (RIPE for Greece and Europe) */
async function registration(ip) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch('https://rdap.arin.net/registry/ip/' + ip, {
      headers: { accept: 'application/rdap+json', 'user-agent': 'semfealumni-functions' },
      redirect: 'follow', signal: ctl.signal
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 500000 ? null : JSON.parse(text);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

exports.recordVisit = onRequest(
  /* a hard ceiling on what a flood can cost: a lost message is one uncounted
     page view, never a bill */
  { region: 'europe-west1', invoker: 'public', maxInstances: 5, timeoutSeconds: 10, memory: '256MiB' },
  async (req, res) => {
    res.set('cache-control', 'no-store');
    // ALWAYS 204: the answer tells the browser nothing (not even whether its
    // network was recognised), and the page never waits for it
    const done = () => { res.status(204).send(''); };
    if (req.method !== 'POST') return done();
    let origin = String(req.headers.origin || '');
    if (!origin) { try { origin = new URL(String(req.headers.referer || '')).origin; } catch (e) { origin = ''; } }
    if (VISIT_ORIGINS.indexOf(origin) === -1) return done();
    // a visitor who asks not to be tracked is not counted (visit.js does not
    // even send; this is the same rule where the browser cannot be trusted)
    if (req.headers['sec-gpc'] === '1' || req.headers.dnt === '1') return done();
    const ua = String(req.headers['user-agent'] || '');
    if (siteVisits.isBot(ua)) return done();
    const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof req.body === 'string' ? req.body : '';
    const msg = siteVisits.parseMessage(raw);
    if (!msg) return done();

    let place = null, v6 = false;
    if (msg.first) {
      const ip = netorg.clientIp(req.headers['x-forwarded-for']);
      if (ip) {
        v6 = ip.indexOf(':') !== -1;
        const [host, rdap] = await Promise.all([reverseDns(ip), registration(ip)]);
        place = netorg.place(host, rdap);
      }
      /* from here on the address is not referenced again: it is not written
         and not logged; only the organisation's name (if any) goes on */
    }
    const { day, patch } = siteVisits.visitPatch(msg,
      { now: new Date(), ua, known: SITE_PATHS, ownHosts: OWN_HOSTS, place, v6 }, FieldValue.increment(1));
    try {
      await getFirestore().collection('siteVisits').doc(day).set(patch, { merge: true });
    } catch (e) {
      logger.warn('visit not recorded', { error: e.message });
    }
    return done();
  }
);

/* The members' anonymous statistics, recounted when an application changes.
   One instance, one event at a time, so two recounts never race to write. */
async function publishMemberStats(db) {
  const snap = await db.collection('members').get();
  const out = stats.memberStats(snap.docs.map(d => d.data()), new Date());
  await db.collection('publicStats').doc('members').set({ json: JSON.stringify(out), t: FieldValue.serverTimestamp() });
  return out;
}
exports.memberStats = onDocumentWritten(
  { document: 'members/{uid}', region: 'europe-west1', retry: false, maxInstances: 1, concurrency: 1, timeoutSeconds: 60, memory: '256MiB' },
  async event => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!stats.matters(before, after)) return;
    const out = await publishMemberStats(getFirestore());
    logger.info('member statistics: ' + out.registered + ' registered, ' + out.active + ' active');
  }
);

/* ---- the e-mail alerts (alerts.js) ---------------------------------------
   Every 2 hours: what has been published since the last run, to the members
   who chose that kind of news. One instance, so two runs never overlap (the
   ledger's transaction would stop a double send anyway). */
function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try { return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || ''; } catch (e) { return ''; }
}
function unsubBase() { return 'https://europe-west1-' + projectId() + '.cloudfunctions.net/alertsUnsubscribe'; }
async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return res.json();
}
exports.alertsMailer = onSchedule(
  { schedule: 'every 2 hours', timeZone: 'Europe/Athens', region: 'europe-west1', secrets: [SMTP_USER, SMTP_PASS],
    retryCount: 0, maxInstances: 1, timeoutSeconds: 540, memory: '256MiB' },
  async () => {
    const db = getFirestore();
    const prefsCol = db.collection(alerts.PREFS), ledgerRef = db.collection(alerts.LEDGER[0]).doc(alerts.LEDGER[1]);
    const result = await alerts.run({
      fetchJson,
      decisions: async () => {
        const out = {};
        (await db.collection('newsOverrides').get()).forEach(d => { out[d.id] = d.data(); });
        return out;
      },
      ledger: async () => { const snap = await ledgerRef.get(); return snap.exists ? (snap.get('keys') || []) : null; },
      seed: keys => ledgerRef.set({ keys, t: FieldValue.serverTimestamp() }),
      claim: keys => db.runTransaction(async tx => {
        const snap = await tx.get(ledgerRef);
        const have = new Set(snap.exists ? (snap.get('keys') || []) : []);
        const added = keys.filter(k => !have.has(k));
        if (added.length) tx.set(ledgerRef, { keys: Array.from(have).concat(added), t: FieldValue.serverTimestamp() });
        return added;
      }),
      prefs: async () => (await prefsCol.get()).docs.map(d => Object.assign({ uid: d.id }, d.data())),
      statuses: async uids => {
        const out = {};
        for (let i = 0; i < uids.length; i += 100) {
          const snaps = await db.getAll(...uids.slice(i, i + 100).map(u => db.collection('members').doc(u)));
          snaps.forEach(s => { if (s.exists) out[s.id] = s.get('status'); });
        }
        return out;
      },
      setKey: (uid, k) => prefsCol.doc(uid).update({ k }),
      send: msg => mailer().sendMail(msg),
      mailOn: /@/.test(SMTP_USER.value()),
      log: t => logger.warn(t)
    }, {
      site: SITE_URL.value().replace(/\/?$/, '/'),
      from: '"' + 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ' + '" <' + SMTP_USER.value() + '>',
      unsubBase: unsubBase()
    });
    logger.info('alerts: ' + result);
  }
);

exports.alertsUnsubscribe = onRequest(
  { region: 'europe-west1', invoker: 'public', maxInstances: 3, timeoutSeconds: 15, memory: '256MiB' },
  async (req, res) => {
    const prefsCol = getFirestore().collection(alerts.PREFS);
    try {
      const r = await alerts.unsubscribe({ method: req.method, query: req.query }, {
        get: async uid => { const s = await prefsCol.doc(uid).get(); return s.exists ? s.data() : null; },
        stop: uid => prefsCol.doc(uid).update({ topics: [], updatedAt: FieldValue.serverTimestamp() })
      }, { site: SITE_URL.value().replace(/\/?$/, '/') });
      res.status(r.status).set('content-type', 'text/html; charset=utf-8').set('cache-control', 'no-store').send(r.html);
    } catch (e) {
      logger.error('unsubscribe failed', e);
      res.status(500).set('content-type', 'text/plain; charset=utf-8').send('Κάτι πήγε στραβά. Δοκιμάστε ξανά σε λίγο.');
    }
  }
);
