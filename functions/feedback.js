/* SEMFE Alumni: the e-mails around the «Σχόλια» page (feedback/{ticket}).
 *
 *   a new message      -> the admins get a copy (screenshots attached,
 *                         Reply-To the sender), and the sender a confirmation
 *                         with the ticket number;
 *   a ticket closed    -> the sender gets the answer (the admin page's text,
 *                         or a file in _feedback-resolutions/ applied by
 *                         tools/feedback-sync.mjs), with its link if any.
 *
 * The sender is written to ONLY at the address their sign-in token carried,
 * and only when that address was confirmed (firestore.rules pins both), so
 * this can never be used to mail someone else.
 *
 * Each e-mail is sent at most once: the document is "claimed" in a
 * transaction (mailedAt / resolutionSentHash) before sending, and an answer
 * only when the ticket, as it is NOW, still holds that answer (events can
 * arrive out of order). A failure is written to mailError for the admin page
 * to show, never retried in a loop. Editing the answer (a different text or
 * link) sends it again.
 *
 * The screenshots are not in the ticket but beside it, feedback/<ticket>/
 * shots/1..5 (deps.shots() reads them): a trigger event carries at most
 * 512 KB, and an update event carries the ticket twice.
 *
 * Pure logic with injected dependencies; index.js wires Firestore and SMTP,
 * test-feedback.js runs it offline. */
'use strict';
const crypto = require('node:crypto');

const TICKET = /^SEMFE-\d{6}-[A-Z0-9]{4}$/;
const KIND = { problem: 'Πρόβλημα', idea: 'Πρόταση', other: 'Άλλο' };
const ORG = 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function para(s) { return esc(s).replace(/\r?\n/g, '<br>'); }
function safeUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function httpUrl(u) { return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function oneLine(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function canMail(d) { return !!(d && d.email && d.emailVerified === true && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)); }
function resolutionHash(d) {
  return crypto.createHash('sha256').update(String(d.resolution || '') + '\n' + String(d.resolutionUrl || '')).digest('hex').slice(0, 16);
}
function attachmentsOf(d) {
  return (Array.isArray(d.screenshots) ? d.screenshots : []).map((u, i) => {   // d: { ticket, screenshots: [data URLs] }
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ''));
    return m ? { filename: d.ticket + '-' + (i + 1) + '.jpg', content: Buffer.from(m[1], 'base64'), contentType: 'image/jpeg' } : null;
  }).filter(Boolean);
}

/* one simple, e-mail-safe layout for all three messages */
function shell(title, body, cfg) {
  return '<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>' + esc(title) + '</title></head><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f1c2e">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px 16px">' +
    '<div style="background:#0a2240;color:#fff;border-radius:14px 14px 0 0;padding:16px 22px;font-weight:bold;letter-spacing:.04em">ΣΕΜΦΕ ΕΜΠ · Alumni</div>' +
    '<div style="background:#fff;border:1px solid #dbe3ec;border-top:0;border-radius:0 0 14px 14px;padding:22px;line-height:1.55;font-size:15px">' + body + '</div>' +
    '<p style="font-size:12px;color:#5b6b80;margin:14px 4px 0">' + esc(ORG) + ' · <a href="' + esc(cfg.site) + '" style="color:#12355b">' + esc(cfg.site.replace(/^https:\/\//, '').replace(/\/$/, '')) + '</a></p>' +
    '</div></body></html>';
}
function quote(text) {
  return '<div style="border-left:3px solid #dbe3ec;padding:4px 0 4px 12px;margin:10px 0;color:#26384f">' + para(text) + '</div>';
}

function renderAdmin(d, cfg, n) {
  n = n == null ? (d.shots || 0) : n;
  const page = httpUrl(d.page);
  const who = (d.name || '(χωρίς όνομα)') + (d.email ? ' <' + d.email + '>' + (d.emailVerified ? '' : ' (μη επιβεβαιωμένο)') : ' (χωρίς e-mail)');
  const admin = cfg.site + 'admin/#feedback';
  const text = [
    'Νέο μήνυμα από τη σελίδα Σχόλια: ' + d.ticket, '',
    'Από: ' + who, 'Είδος: ' + (KIND[d.kind] || d.kind || ''), page ? 'Σελίδα: ' + page : '', n ? 'Στιγμιότυπα: ' + n + ' (συνημμένα)' : '', '',
    String(d.message || ''), '',
    'Απάντηση και κλείσιμο: ' + admin, '(Απάντηση σε αυτό το e-mail πηγαίνει κατευθείαν στον αποστολέα.)'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  const html = shell(d.ticket, '<p style="margin-top:0"><strong>Νέο μήνυμα από τη σελίδα Σχόλια</strong></p>' +
    '<p style="font-size:20px;font-weight:bold;margin:6px 0 14px">' + esc(d.ticket) + '</p>' +
    '<p style="margin:0">Από: <strong>' + esc(d.name || '(χωρίς όνομα)') + '</strong>' + (d.email ? ' &lt;' + esc(d.email) + '&gt;' + (d.emailVerified ? '' : ' (μη επιβεβαιωμένο)') : ' (χωρίς e-mail)') + '<br>' +
    'Είδος: ' + esc(KIND[d.kind] || d.kind || '') + (page ? '<br>Σελίδα: <a href="' + esc(page) + '">' + esc(page) + '</a>' : '') +
    (n ? '<br>Στιγμιότυπα: ' + n + ' (συνημμένα)' : '') + '</p>' + quote(d.message) +
    '<p><a href="' + esc(admin) + '" style="display:inline-block;background:#12355b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold">Απάντηση και κλείσιμο</a></p>' +
    '<p style="font-size:13px;color:#5b6b80;margin-bottom:0">Απάντηση σε αυτό το e-mail πηγαίνει κατευθείαν στον αποστολέα.</p>', cfg);
  return { subject: '[' + d.ticket + '] ' + (KIND[d.kind] || 'Μήνυμα') + ': ' + oneLine(d.message, 70), text, html };
}

function renderAck(d, cfg) {
  const page = cfg.site + 'feedback/';
  const text = [
    'Γεια σας' + (d.name ? ' ' + d.name : '') + ',', '',
    'Λάβαμε το μήνυμά σας. Ο αριθμός του είναι ' + d.ticket + '.',
    'Όταν το εξετάσουμε, θα σας γράψουμε σε αυτό το e-mail τι κάναμε. Μπορείτε να δείτε την πορεία του και στη σελίδα ' + page, '',
    'Το μήνυμά σας:', String(d.message || ''), '',
    'Ευχαριστούμε,', ORG
  ].join('\n');
  const html = shell(d.ticket, '<p style="margin-top:0">Γεια σας' + (d.name ? ' ' + esc(d.name) : '') + ',</p>' +
    '<p>Λάβαμε το μήνυμά σας. Ο αριθμός του είναι:</p><p style="font-size:20px;font-weight:bold;margin:6px 0 14px">' + esc(d.ticket) + '</p>' +
    '<p>Όταν το εξετάσουμε, θα σας γράψουμε σε αυτό το e-mail τι κάναμε. Την πορεία του βλέπετε και στη σελίδα <a href="' + esc(page) + '">Σχόλια και προβλήματα</a>.</p>' +
    '<p style="margin-bottom:0">Το μήνυμά σας:</p>' + quote(d.message) + '<p style="margin-bottom:0">Ευχαριστούμε,<br>' + esc(ORG) + '</p>', cfg);
  return { subject: '[' + d.ticket + '] Λάβαμε το μήνυμά σας', text, html };
}

function renderResolution(d, cfg) {
  const link = safeUrl(d.resolutionUrl), page = cfg.site + 'feedback/';
  const text = [
    'Γεια σας' + (d.name ? ' ' + d.name : '') + ',', '',
    'Σας ευχαριστούμε για το μήνυμά σας ' + d.ticket + '. Να τι κάναμε:', '',
    String(d.resolution || ''), link ? '\nΔείτε το: ' + link : '', '',
    'Το αρχικό σας μήνυμα:', String(d.message || ''), '',
    'Αν κάτι δεν λύθηκε, απαντήστε σε αυτό το e-mail ή γράψτε μας ξανά στη σελίδα ' + page, '',
    ORG
  ].join('\n');
  const html = shell(d.ticket, '<p style="margin-top:0">Γεια σας' + (d.name ? ' ' + esc(d.name) : '') + ',</p>' +
    '<p>Σας ευχαριστούμε για το μήνυμά σας <strong>' + esc(d.ticket) + '</strong>. Να τι κάναμε:</p>' +
    '<div style="background:#e3f4ec;border-radius:10px;padding:12px 16px;margin:10px 0">' + para(d.resolution) + '</div>' +
    (link ? '<p><a href="' + esc(link) + '" style="display:inline-block;background:#12355b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold">Δείτε το</a></p>' : '') +
    '<p style="margin-bottom:0">Το αρχικό σας μήνυμα:</p>' + quote(d.message) +
    '<p>Αν κάτι δεν λύθηκε, απαντήστε σε αυτό το e-mail ή γράψτε μας ξανά στη σελίδα <a href="' + esc(page) + '">Σχόλια και προβλήματα</a>.</p>' +
    '<p style="margin-bottom:0">' + esc(ORG) + '</p>', cfg);
  return { subject: '[' + d.ticket + '] Απάντηση στο μήνυμά σας', text, html };
}

function errText(e) { return oneLine((e && (e.code || e.responseCode) ? (e.code || e.responseCode) + ': ' : '') + ((e && e.message) || e), 200); }

/* A new ticket. deps: { claim(field, value, stillTrue?) -> bool, update(patch),
   send(msg), now(), shots() -> [data URLs] }. cfg: { to: [...], from, site }.
   Returns what it did, for the log and the tests. */
async function onCreated(id, d, deps, cfg) {
  if (!TICKET.test(id || '') || !d || d.ticket !== id) return 'skip';
  if (d.mailedAt) return 'already';
  if (!(await deps.claim('mailedAt', deps.now()))) return 'already';
  const errors = [], patch = {};
  if (cfg.to.length) {
    let urls = [];
    if (d.shots) { try { urls = await deps.shots(); } catch (e) { errors.push('στιγμιότυπα: ' + errText(e)); } }
    const attachments = attachmentsOf({ ticket: d.ticket, screenshots: urls });
    // Reply-To the sender only when their address is confirmed: an admin's
    // reply (or an auto-reply) must not go to an address nobody proved
    try { await deps.send(Object.assign({ to: cfg.to.join(', '), from: cfg.from, replyTo: canMail(d) ? d.email : undefined, attachments }, renderAdmin(d, cfg, attachments.length))); }
    catch (e) { errors.push('προς διαχειριστές: ' + errText(e)); }
  }
  if (canMail(d)) {
    try { await deps.send(Object.assign({ to: d.email, from: cfg.from, replyTo: cfg.replyTo || undefined }, renderAck(d, cfg))); patch.ackAt = deps.now(); }
    catch (e) { errors.push('επιβεβαίωση: ' + errText(e)); }
  }
  if (errors.length) patch.mailError = errors.join('; ');
  if (Object.keys(patch).length) await deps.update(patch);
  return errors.length ? 'errors' : 'sent';
}

/* A ticket changed: when it is closed with an answer not sent yet, send it. */
async function onUpdated(id, before, d, deps, cfg) {
  if (!TICKET.test(id || '') || !d || d.status !== 'closed' || !String(d.resolution || '').trim()) return 'skip';
  const h = resolutionHash(d);
  if (d.resolutionSentHash === h) return 'already';
  if (!canMail(d)) return 'no-address';
  // claimed only if the ticket, as stored NOW, is still closed with this very
  // answer: an older event arriving late must not send a superseded answer
  if (!(await deps.claim('resolutionSentHash', h, cur => !!cur && cur.status === 'closed' && resolutionHash(cur) === h && canMail(cur)))) return 'already';
  try {
    await deps.send(Object.assign({ to: d.email, from: cfg.from, replyTo: cfg.replyTo || undefined }, renderResolution(d, cfg)));
    await deps.update({ resolutionSentAt: deps.now(), mailError: null });
    return 'sent';
  } catch (e) {
    await deps.update({ mailError: 'απάντηση: ' + errText(e) });
    return 'errors';
  }
}

module.exports = { onCreated, onUpdated, renderAdmin, renderAck, renderResolution, attachmentsOf, resolutionHash, canMail, TICKET };
