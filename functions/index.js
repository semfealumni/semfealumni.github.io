/* SEMFE Alumni Cloud Functions:
 *   linkedinSignIn      LinkedIn sign-in (HTTPS, linkedin.js)
 *   accounts            the admin page's list of registered accounts, and
 *                       merging two accounts of one person (HTTPS, accounts.js)
 *   cleanupDeletedUser  when a sign-in account is deleted, removes its
 *                       application, directory card, LinkedIn link and the
 *                       messages it sent from the Σχόλια page
 *   feedbackCreated     a new message on the Σχόλια page: a copy to the
 *                       admins, a confirmation with the ticket number to the
 *                       sender (feedback.js)
 *   feedbackUpdated     a ticket closed with an answer: the answer to the
 *                       sender (feedback.js)
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
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { handle, cleanupUser, splitList } = require('./linkedin');
const accounts = require('./accounts');
const feedback = require('./feedback');

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
  default: 'https://www.stouras.com/semfealumni/',
  description: "The site's address, ending in /, for the links in e-mails"
});
const FEEDBACK_TO = defineString('FEEDBACK_TO', {
  default: 'kstouras@gmail.com',
  description: 'Comma-separated addresses that receive each new message from the Σχόλια page'
});
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com', description: 'Mail server for the feedback e-mails' });
const SMTP_PORT = defineString('SMTP_PORT', { default: '465', description: 'Mail server port (465 = SSL)' });
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
