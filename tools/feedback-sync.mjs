#!/usr/bin/env node
/* SEMFE Alumni: the Σχόλια tickets, outside Firebase.
 *
 * Run every half hour (and on every push that touches _feedback-resolutions/)
 * by .github/workflows/feedback.yml. Two jobs:
 *
 *  1. CLOSE tickets from the repository. Each file
 *       _feedback-resolutions/<TICKET>.md
 *     (see the README there) closes that ticket with its text as the answer,
 *     and the feedback Cloud Function (functions/feedback.js) e-mails that
 *     answer to the sender. Files stay where they are: an unchanged file is
 *     never applied twice (resolutionRepoHash on the ticket), and EDITING one
 *     applies it, and mails it, again. The files are in a PUBLIC repository,
 *     so they must never name the sender: this tool refuses a file that
 *     carries an e-mail address, and the sender's details are looked up in
 *     Firestore by ticket.
 *
 *  2. MIRROR every ticket into a checked-out PRIVATE repository (--log DIR):
 *       feedback/INDEX.md, feedback/index.json      every ticket, newest first
 *       feedback/<TICKET>/feedback.md                the message, who, when, status, answer
 *       feedback/<TICKET>/feedback.json              the same as data
 *       feedback/<TICKET>/screenshot-N.jpg           the screenshots
 *     so the tickets can be read (and acted on) from GitHub. Output is
 *     deterministic, so an unchanged inbox commits nothing. A ticket deleted
 *     from the admin page is deleted from the mirror too.
 *
 * Modes:
 *   node tools/feedback-sync.mjs --selftest     offline tests
 *   node tools/feedback-sync.mjs --scan         check the resolution files (offline)
 *   node tools/feedback-sync.mjs --close                close tickets from the files
 *   node tools/feedback-sync.mjs --mirror --log DIR     copy every ticket into DIR
 *   (neither: both; add --dry-run to only say what would happen)
 *       needs FIREBASE_SERVICE_ACCOUNT (the JSON key) in the environment, and
 *       functions/node_modules (cd functions && npm ci) for firebase-admin.
 * The screenshots are read from beside each ticket (feedback/<ticket>/shots/). */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES_DIR = path.join(ROOT, '_feedback-resolutions');
const TICKET = /^SEMFE-\d{6}-[A-Z0-9]{4}$/;
// a link in an answer must point at the site (today's address or the future one)
const LINK_HOSTS = ['www.stouras.com', 'stouras.com', 'semfealumni.gr', 'www.semfealumni.gr'];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const KIND = { problem: 'Πρόβλημα', idea: 'Πρόταση', other: 'Άλλο' };

/* ---- the resolution files ---------------------------------------------- */
export function parseResolution(text, file) {
  const base = path.basename(file || '', '.md');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text || ''));
  if (!m) return { error: 'no front matter (--- ticket: … ---) at the top' };
  const meta = {};
  m[1].split(/\r?\n/).forEach(l => { const k = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(l); if (k) meta[k[1].toLowerCase()] = k[2]; });
  const ticket = meta.ticket || '', url = meta.url || '', body = m[2].replace(/\s+$/, '').replace(/^\s*\n/, '');
  if (!TICKET.test(ticket)) return { error: 'ticket: "' + ticket + '" is not a ticket number (SEMFE-YYMMDD-XXXX)' };
  if (base && base !== ticket) return { error: 'the file is named ' + base + '.md but says ticket: ' + ticket };
  if (url) {
    let u = null; try { u = new URL(url); } catch (e) {}
    if (!u || u.protocol !== 'https:' || LINK_HOSTS.indexOf(u.hostname) === -1) return { error: 'url: must be an https address on ' + LINK_HOSTS.join(' / ') };
  }
  if (!body.trim()) return { error: 'the answer (below the ---) is empty' };
  if (body.length > 5000) return { error: 'the answer is longer than 5000 characters' };
  if (EMAIL.test(body) || EMAIL.test(url)) return { error: 'the file carries an e-mail address: this repository is public, never name the sender' };
  return { ticket, url, body, hash: createHash('sha256').update(ticket + '\n' + url + '\n' + body).digest('hex').slice(0, 16) };
}
export function readResolutions(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /\.md$/i.test(f) && f.toLowerCase() !== 'readme.md').sort()
    .map(f => Object.assign({ file: f }, parseResolution(readFileSync(path.join(dir, f), 'utf8'), f)));
}

/* ---- the mirror ---------------------------------------------------------- */
function iso(t) {
  if (!t) return '';
  const d = t.toDate ? t.toDate() : (t instanceof Date ? t : (typeof t === 'number' || typeof t === 'string') ? new Date(t) : null);
  return d && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : '';
}
function oneLine(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function mdCell(s) { return oneLine(s, 80).replace(/\|/g, '\\|'); }
function shotsOf(d) {
  return (Array.isArray(d.screenshots) ? d.screenshots : []).map(u => /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ''))).filter(Boolean).map(m => m[1]);
}
/* the ticket as data, as it goes into feedback.json: screenshots replaced by their file names, times as ISO */
export function ticketData(d) {
  const o = {};
  Object.keys(d).sort().forEach(k => {
    if (k !== 'screenshots') { const v = d[k]; o[k] = v && (v.toDate || v instanceof Date) ? iso(v) : v; }
  });
  // always present, even for a ticket written without any (by hand, say)
  o.screenshots = shotsOf(d).map((_, i) => 'screenshot-' + (i + 1) + '.jpg');
  return o;
}
export function ticketMarkdown(d) {
  const x = ticketData(d), closed = x.status === 'closed';
  const lines = [
    '# ' + x.ticket + ' · ' + (closed ? 'Ολοκληρώθηκε' : 'Ανοιχτό'), '',
    '| | |', '|---|---|',
    '| Από | ' + mdCell(x.name || '(χωρίς όνομα)') + ' |',
    '| E-mail | ' + (x.email ? mdCell(x.email) + (x.emailVerified ? '' : ' (μη επιβεβαιωμένο)') : '(κανένα)') + ' |',
    '| Είδος | ' + (KIND[x.kind] || mdCell(x.kind)) + ' |',
    '| Στάλθηκε | ' + (x.createdAt || '') + ' |',
    x.page ? '| Σελίδα | ' + mdCell(x.page) + ' |' : null,
    '| Browser | ' + mdCell(x.ua) + ' |',
    '| Λογαριασμός (uid) | `' + mdCell(x.uid) + '` |',
    '', '## Μήνυμα', '', String(x.message || '').split(/\r?\n/).map(l => '> ' + l).join('\n'), ''
  ].filter(l => l !== null);
  if (x.screenshots.length) lines.push('## Στιγμιότυπα', '', ...x.screenshots.map((f, i) => '![Στιγμιότυπο ' + (i + 1) + '](' + f + ')'), '');
  if (closed || x.resolution) {
    lines.push('## Απάντηση', '', 'Κλείστηκε ' + (x.resolvedAt || '') + (x.resolvedBy ? ' από ' + (x.resolvedBy === 'repo' ? 'αρχείο στο _feedback-resolutions/' : x.resolvedBy) : '') + '.', '',
      String(x.resolution || '(χωρίς κείμενο)'), '');
    if (x.resolutionUrl) lines.push('Σύνδεσμος: ' + x.resolutionUrl, '');
  }
  const mail = [];
  if (x.mailedAt) mail.push('ειδοποίηση διαχειριστών ' + x.mailedAt);
  if (x.ackAt) mail.push('επιβεβαίωση στον αποστολέα ' + x.ackAt);
  if (x.resolutionSentAt) mail.push('απάντηση στον αποστολέα ' + x.resolutionSentAt);
  if (x.mailError) mail.push('ΣΦΑΛΜΑ: ' + x.mailError);
  if (mail.length) lines.push('## E-mail', '', ...mail.map(m => '- ' + m), '');
  return lines.join('\n');
}
export function indexOf(docs) {
  const rows = docs.map(ticketData).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.ticket).localeCompare(a.ticket));
  const open = rows.filter(r => r.status !== 'closed').length;
  const md = ['# Σχόλια μελών', '', rows.length + ' μηνύματα, ' + open + ' ανοιχτά. Νεότερα πρώτα.', '',
    'Για να κλείσετε ένα: αρχείο `_feedback-resolutions/<TICKET>.md` στο αποθετήριο του ιστότοπου (δείτε το README εκεί), ή «Κλείσιμο με απάντηση» στη σελίδα Διαχείριση.', '',
    '| Αριθμός | Ημερομηνία | Κατάσταση | Είδος | Από | Μήνυμα |', '|---|---|---|---|---|---|',
    ...rows.map(r => '| [' + r.ticket + '](' + r.ticket + '/feedback.md) | ' + String(r.createdAt || '').slice(0, 10) + ' | ' + (r.status === 'closed' ? 'Ολοκληρώθηκε' + (r.resolutionSentAt ? ' ✉' : '') : 'Ανοιχτό') +
      ' | ' + (KIND[r.kind] || '') + ' | ' + mdCell(r.name || '') + ' | ' + mdCell(r.message) + ' |'), ''].join('\n');
  const json = rows.map(r => ({ ticket: r.ticket, createdAt: r.createdAt, status: r.status, kind: r.kind, name: r.name, email: r.email,
    message: oneLine(r.message, 200), resolution: r.resolution ? oneLine(r.resolution, 200) : '', screenshots: r.screenshots.length }));
  return { md, json: JSON.stringify(json, null, 2) + '\n' };
}
/* write the mirror; returns what changed */
export function writeMirror(logDir, docs) {
  const base = path.join(logDir, 'feedback');
  mkdirSync(base, { recursive: true });
  const keep = new Set(), changed = [];
  const put = (f, content) => {
    const old = existsSync(f) ? readFileSync(f) : null;
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    if (!old || !old.equals(buf)) { writeFileSync(f, buf); changed.push(path.relative(logDir, f)); }
  };
  docs.filter(d => TICKET.test(d.ticket || '')).forEach(d => {
    keep.add(d.ticket);
    const dir = path.join(base, d.ticket);
    mkdirSync(dir, { recursive: true });
    put(path.join(dir, 'feedback.md'), ticketMarkdown(d));
    put(path.join(dir, 'feedback.json'), JSON.stringify(ticketData(d), null, 2) + '\n');
    shotsOf(d).forEach((b64, i) => put(path.join(dir, 'screenshot-' + (i + 1) + '.jpg'), Buffer.from(b64, 'base64')));
  });
  readdirSync(base).forEach(f => {
    const p = path.join(base, f);
    if (TICKET.test(f) && statSync(p).isDirectory() && !keep.has(f)) { rmSync(p, { recursive: true, force: true }); changed.push('feedback/' + f + ' (deleted)'); }
  });
  const ix = indexOf(docs.filter(d => TICKET.test(d.ticket || '')));
  put(path.join(base, 'INDEX.md'), ix.md);
  put(path.join(base, 'index.json'), ix.json);
  return changed;
}

/* ---- the offline tests ------------------------------------------------- */
async function selftest() {
  const assert = (await import('node:assert')).default;
  const os = await import('node:os');
  let n = 0, bad = 0;
  const t = (name, fn) => { try { fn(); n++; console.log('ok    ' + name); } catch (e) { bad++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e)); } };
  const FILE = '---\nticket: SEMFE-260930-AB23\nurl: https://www.stouras.com/semfealumni/account/\n---\nΤο κουμπί διορθώθηκε.\n';
  t('a resolution file: ticket, link and the answer', () => {
    const r = parseResolution(FILE, 'SEMFE-260930-AB23.md');
    assert.strictEqual(r.error, undefined); assert.strictEqual(r.ticket, 'SEMFE-260930-AB23');
    assert.strictEqual(r.url, 'https://www.stouras.com/semfealumni/account/'); assert.strictEqual(r.body, 'Το κουμπί διορθώθηκε.');
    assert.strictEqual(r.hash.length, 16);
  });
  t('refused: an e-mail address (the repository is public), a foreign link, a wrong name, no answer', () => {
    assert.ok(/e-mail address/.test(parseResolution(FILE.replace('διορθώθηκε.', 'διορθώθηκε, maria@gmail.com.'), 'SEMFE-260930-AB23.md').error));
    assert.ok(/https address/.test(parseResolution(FILE.replace('https://www.stouras.com', 'https://evil.example'), 'SEMFE-260930-AB23.md').error));
    assert.ok(/https address/.test(parseResolution(FILE.replace('https://', 'http://'), 'SEMFE-260930-AB23.md').error));
    assert.ok(/named/.test(parseResolution(FILE, 'SEMFE-260930-ZZZZ.md').error));
    assert.ok(/empty/.test(parseResolution('---\nticket: SEMFE-260930-AB23\n---\n\n', 'SEMFE-260930-AB23.md').error));
    assert.ok(/not a ticket/.test(parseResolution('---\nticket: 12\n---\nx', '').error));
    assert.ok(/front matter/.test(parseResolution('just text', '').error));
  });
  t('the link is optional; the new address semfealumni.gr is accepted', () => {
    assert.strictEqual(parseResolution('---\nticket: SEMFE-260930-AB23\n---\nOK', 'SEMFE-260930-AB23.md').url, '');
    assert.strictEqual(parseResolution(FILE.replace('https://www.stouras.com/semfealumni/', 'https://semfealumni.gr/'), 'SEMFE-260930-AB23.md').error, undefined);
  });
  t('editing a file changes its hash (so it is applied, and mailed, again)', () => {
    assert.notStrictEqual(parseResolution(FILE, '').hash, parseResolution(FILE.replace('διορθώθηκε', 'διορθώθηκε τελικά'), '').hash);
  });
  t('every file in _feedback-resolutions/ is valid', () => {
    const l = readResolutions(RES_DIR);
    l.forEach(r => assert.ok(!r.error, r.file + ': ' + r.error));
  });
  const TS = { toDate: () => new Date('2026-09-30T10:11:12.345Z') };
  const DOC = { ticket: 'SEMFE-260930-AB23', uid: 'u1', email: 'm@gmail.com', emailVerified: true, name: 'Μαρία | Π.', kind: 'problem',
    message: 'Γραμμή 1\nΓραμμή 2', page: 'https://www.stouras.com/semfealumni/', ua: 'UA', status: 'open', createdAt: TS,
    screenshots: ['data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 1]).toString('base64'), 'not-an-image'], mailedAt: TS };
  t('a ticket as markdown: who, when, the message quoted, its screenshots', () => {
    const md = ticketMarkdown(DOC);
    assert.ok(md.startsWith('# SEMFE-260930-AB23 · Ανοιχτό'));
    assert.ok(md.includes('Μαρία \\| Π.'), 'a | in a table cell is escaped');
    assert.ok(md.includes('> Γραμμή 1\n> Γραμμή 2'));
    assert.ok(md.includes('![Στιγμιότυπο 1](screenshot-1.jpg)') && !md.includes('screenshot-2'));
    assert.ok(md.includes('2026-09-30T10:11:12Z'));
    assert.ok(!md.includes('base64'));
  });
  t('a ticket with no screenshots field at all (written by hand) does not stop the mirror', () => {
    const d = Object.assign({}, DOC); delete d.screenshots;
    assert.deepStrictEqual(ticketData(d).screenshots, []);
    assert.ok(ticketMarkdown(d).includes('# SEMFE-260930-AB23') && indexOf([d]).md.includes('1 μηνύματα'));
  });
  t('the mirror: files per ticket, an index, nothing rewritten when nothing changed, deleted tickets removed', () => {
    const dir = path.join(os.tmpdir(), 'semfe-fb-' + process.pid);
    rmSync(dir, { recursive: true, force: true });
    const closed = Object.assign({}, DOC, { ticket: 'SEMFE-260929-CD45', status: 'closed', resolution: 'OK', resolvedBy: 'repo', resolvedAt: TS, resolutionSentAt: TS, screenshots: [] });
    let ch = writeMirror(dir, [DOC, closed, { ticket: '../../etc', message: 'x' }]);
    assert.ok(ch.includes('feedback/SEMFE-260930-AB23/feedback.md') && ch.includes('feedback/SEMFE-260930-AB23/screenshot-1.jpg') && ch.includes('feedback/INDEX.md'));
    assert.ok(!existsSync(path.join(dir, 'etc')), 'a document id that is not a ticket never becomes a path');
    const ix = readFileSync(path.join(dir, 'feedback/INDEX.md'), 'utf8');
    assert.ok(ix.includes('2 μηνύματα, 1 ανοιχτά'));
    assert.ok(ix.indexOf('SEMFE-260930-AB23') < ix.indexOf('SEMFE-260929-CD45'), 'newest first');
    assert.ok(ix.includes('Ολοκληρώθηκε ✉'));
    assert.deepStrictEqual([...readFileSync(path.join(dir, 'feedback/SEMFE-260930-AB23/screenshot-1.jpg'))], [0xff, 0xd8, 0xff, 1]);
    assert.deepStrictEqual(writeMirror(dir, [DOC, closed]), [], 'unchanged: nothing written (so nothing to commit)');
    ch = writeMirror(dir, [DOC]);
    assert.ok(ch.includes('feedback/SEMFE-260929-CD45 (deleted)') && !existsSync(path.join(dir, 'feedback/SEMFE-260929-CD45')));
    rmSync(dir, { recursive: true, force: true });
  });
  console.log(bad ? `\n${bad} failed, ${n} passed` : `\nall ${n} passed`);
  process.exit(bad ? 1 : 0);
}

/* ---- the real run ------------------------------------------------------ */
async function run(args) {
  const dry = args.includes('--dry-run');
  const li = args.indexOf('--log'), logDir = li !== -1 ? path.resolve(args[li + 1] || '') : null;
  const files = readResolutions(RES_DIR);
  const bad = files.filter(f => f.error);
  bad.forEach(f => console.log('::error file=_feedback-resolutions/' + f.file + '::' + f.error));
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('::notice::FIREBASE_SERVICE_ACCOUNT is not set: nothing synced (FEEDBACK-SETUP.md explains how to add it).');
    return bad.length ? 1 : 0;
  }
  let key;
  try { key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { console.log('::error::FIREBASE_SERVICE_ACCOUNT is not valid JSON'); return 1; }
  // the same guard as every deploy: only the project this folder belongs to
  const want = JSON.parse(readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
  if (key.project_id !== want) { console.log('::error::the service account belongs to "' + key.project_id + '", this site to "' + want + '"'); return 1; }
  const req = createRequire(path.join(ROOT, 'functions', 'package.json'));
  const { initializeApp, cert } = req('firebase-admin/app');
  const { getFirestore, FieldValue } = req('firebase-admin/firestore');
  initializeApp({ credential: cert(key), projectId: want });
  const db = getFirestore(), col = db.collection('feedback');

  const both = !args.includes('--close') && !args.includes('--mirror');
  let applied = 0;
  for (const r of (both || args.includes('--close')) ? files.filter(f => !f.error) : []) {
    const ref = col.doc(r.ticket), snap = await ref.get();
    if (!snap.exists) { console.log('::warning file=_feedback-resolutions/' + r.file + '::no ticket ' + r.ticket + ' in Firestore (deleted, or a typo?)'); continue; }
    if (snap.get('resolutionRepoHash') === r.hash) continue;
    console.log((dry ? 'would close ' : 'closing ') + r.ticket);
    if (!dry) {
      await ref.update({ status: 'closed', resolution: r.body, resolutionUrl: r.url, resolutionRepoHash: r.hash, resolvedAt: FieldValue.serverTimestamp(), resolvedBy: 'repo' });
      applied++;
    }
  }
  if (both || args.includes('--close')) console.log(applied + ' ticket(s) closed from _feedback-resolutions/');

  if (logDir && (both || args.includes('--mirror'))) {
    const qs = await col.get(), docs = [];
    for (const d of qs.docs) {
      const x = d.data(); x.ticket = d.id; x.screenshots = [];
      if (x.shots) {
        const ss = await col.doc(d.id).collection('shots').get();
        x.screenshots = ss.docs.slice().sort((a, b) => +a.id - +b.id).map(s => s.get('url')).filter(u => typeof u === 'string');
      }
      docs.push(x);
    }
    if (dry) console.log('would mirror ' + docs.length + ' ticket(s) into ' + logDir);
    else { const ch = writeMirror(logDir, docs); console.log('mirrored ' + docs.length + ' ticket(s), ' + ch.length + ' file(s) changed'); }
  }
  return bad.length ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) await selftest();
else if (args.includes('--scan')) {
  const l = readResolutions(RES_DIR);
  l.forEach(r => console.log((r.error ? 'FAIL  ' : 'ok    ') + r.file + (r.error ? ': ' + r.error : ' -> ' + r.ticket + (r.url ? ' (' + r.url + ')' : ''))));
  console.log(l.length + ' file(s)');
  process.exit(l.some(r => r.error) ? 1 : 0);
} else process.exit(await run(args));
