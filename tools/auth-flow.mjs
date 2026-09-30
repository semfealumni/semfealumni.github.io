#!/usr/bin/env node
/* SEMFE Alumni: sign-in, account, members and admin flows in CONFIGURED mode.

   tools/smoke.mjs covers the site with sign-in switched OFF (config.js still
   holding PASTE_ values). This test switches it ON without a real Firebase
   project: it serves a copy of assets/js/config.js with a test config appended
   (apiKey 'test-key', projectId 'demo-semfe') and answers the three gstatic
   compat-SDK URLs with tools/firebase-fake.js, an in-memory fake of exactly the
   SDK surface the site calls, which logs every call (window.__fb.calls) and lets
   a scenario script the next outcome (e.g. a popup that fails with
   auth/account-exists-with-different-credential). The site's own auth.js,
   account.js, members.js and admin.js run unchanged.

   Every Firestore write the pages make is also checked against a JavaScript
   mirror of firestore.rules, whose key lists, stage/status lists, admin e-mails
   and length limits are READ from the rules file, so the test notices when the
   page and the rules drift apart (the real rules are exercised against the
   emulator elsewhere; here the question is "does the page send what they accept").

     A. header + dialog; Google / Facebook / LinkedIn(OIDC) providers; new user
        -> account/#apply; name chip + menu; sign out
     B. the admin menu item: verified admin e-mail only
     C. "account exists with a different credential" -> sign in the first way ->
        the second provider is linked
     D. e-mail registration: validation, create + name + verification e-mail
     E. e-mail sign-in: wrong password, forgotten password
     F. account page: signed out, application (create / validate / refused write /
        edit), unverified e-mail, directory listing, linking, deletion
     G. members page: signed out / no application / pending / rejected / active,
        accent-insensitive directory search
     H. admin page: access, approve, dues, reject, CSV export
     I. LinkedIn through the Cloud Function (mode 'function') and its callback
     J. stored XSS: hostile names on the admin, members and account pages

   Usage: node tools/auth-flow.mjs [--only=A,F] [--headed]
   Needs Playwright (Chromium) and python3. No network: every third-party
   request is answered locally. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, symlinkSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(id); break; } catch {} }
if (!pw) { console.error('playwright is not installed: npm install playwright'); process.exit(1); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const ARGS = process.argv.slice(2);
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const HEADED = ARGS.includes('--headed');

/* ---- the site's settings and rules ------------------------------------------ */
const FAKE = read('tools/firebase-fake.js');
const CONFIG_SRC = read('assets/js/config.js');
const C = new Function('window', CONFIG_SRC + '; return window.SEMFE;')({});
const SUB = new URL(C.siteUrl).pathname.replace(/\/?$/, '/');   // '/semfealumni/' today, '/' at a domain's root
const SDK = C.FIREBASE_SDK || '12.19.0';
const ADMIN = String((C.ADMIN_EMAILS || [])[0] || '').toLowerCase();
const YEAR = new Date().getFullYear();
const TEST_FIREBASE = { apiKey: 'test-key', authDomain: 'demo-semfe.firebaseapp.com', projectId: 'demo-semfe',
  storageBucket: 'demo-semfe.firebasestorage.app', messagingSenderId: '1234567890', appId: '1:1234567890:web:0123456789abcdef' };
const FN_URL = 'https://europe-west1-demo-semfe.cloudfunctions.net/linkedinSignIn';
const LI_ID = (C.LINKEDIN && C.LINKEDIN.providerId) || 'oidc.linkedin';
function configFor(kind) {
  // 'off': sign-in not set up yet (the placeholders the site shipped with)
  if (kind === 'off') return CONFIG_SRC + "\nwindow.SEMFE.FIREBASE = { apiKey: 'PASTE_API_KEY', authDomain: 'PASTE', projectId: 'PASTE_PROJECT_ID', appId: 'PASTE' };\n";
  let li = null;
  if (kind === 'oidc') li = { mode: 'oidc', providerId: LI_ID, clientId: 'unused', functionUrl: 'unused' };
  if (kind === 'function') li = { mode: 'function', providerId: LI_ID, clientId: 'li-client-123', functionUrl: FN_URL };
  // 'shipped': the LINKEDIN block exactly as committed
  // every provider is exercised, whichever ones the live site has switched on so far
  return CONFIG_SRC + '\n/* auth-flow.mjs: sign-in switched on with a test project */\n' +
    'window.SEMFE.FIREBASE = ' + JSON.stringify(TEST_FIREBASE) + ';\n' +
    (kind === 'shipped' ? '' : "window.SEMFE.AUTH_PROVIDERS = ['google', 'facebook', 'linkedin'];\n") +
    (li ? 'window.SEMFE.LINKEDIN = ' + JSON.stringify(li) + ';\n' : '');
}

const RULES = read('firestore.rules');
const strList = s => [...String(s || '').matchAll(/'([^']*)'/g)].map(m => m[1]);
const grab = (re, what) => { const m = RULES.match(re); if (!m) throw new Error('firestore.rules: cannot find ' + what); return m; };
const dirBlock = grab(/match \/directory\/\{uid\}\s*\{[\s\S]*?\n    \}/, 'the directory block')[0];
const R = {
  profileKeys: strList(grab(/function profileKeys\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'profileKeys()')[1]),
  adminKeys: strList(grab(/function adminKeys\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'adminKeys()')[1]),
  fbKeys: strList(grab(/function fbKeys\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'fbKeys()')[1]),
  stages: strList(grab(/d\.stage in \[([^\]]*)\]/, 'the stage list')[1]),
  statuses: strList(grab(/data\.status in \[([^\]]*)\]/, 'the status list')[1]),
  admins: strList(grab(/\.lower\(\) in \[([^\]]*)\]/, 'isAdmin() e-mails')[1]),
  nameMax: +grab(/function name\(v\)[^}]*?v\.size\(\) <= (\d+)/, 'name()')[1],
  year: grab(/function year\(v\)[^}]*?v >= (\d+) && v <= (\d+)/, 'year()').slice(1, 3).map(Number),
  max: Object.fromEntries([...grab(/function validProfile\(d\)[\s\S]*?;\s*\n    \}/, 'validProfile()')[0].matchAll(/str\(d\.(\w+),\s*(\d+)\)/g)].map(m => [m[1], +m[2]])),
  dirKeys: strList(grab(/match \/directory\/\{uid\}[\s\S]*?keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/, 'directory keys')[1]),
  dirMax: Object.fromEntries([...dirBlock.matchAll(/str\(request\.resource\.data\.(\w+),\s*(\d+)\)/g)].map(m => [m[1], +m[2]])),
  dirNameMax: +(dirBlock.match(/data\.name\.size\(\) <= (\d+)/) || [0, 161])[1]
};

/* ---- a JavaScript mirror of the write rules, over the RECORDED payloads -------
   (serverTimestamp() is recorded as {__fv:'serverTimestamp'}, arrayUnion as
   {__fv:'arrayUnion', els:[…]}; stored Timestamps as {__ts: ms}) */
const isST = v => !!v && v.__fv === 'serverTimestamp';
const js = v => JSON.stringify(v);
function profileProblems(d) {
  const p = [];
  for (const k of ['firstName', 'lastName']) if (!(typeof d[k] === 'string' && d[k].length > 0 && d[k].length <= R.nameMax)) p.push(`${k} must be a 1..${R.nameMax} string (${js(d[k])})`);
  for (const [k, n] of Object.entries(R.max)) if (!(typeof d[k] === 'string' && d[k].length <= n)) p.push(`${k} must be a string <= ${n} (${js(d[k])})`);
  if (!R.stages.includes(d.stage)) p.push(`stage ${js(d.stage)} not in ${js(R.stages)}`);
  for (const k of ['entryYear', 'gradYear']) if (!(d[k] === null || (Number.isInteger(d[k]) && d[k] >= R.year[0] && d[k] <= R.year[1]))) p.push(`${k} must be null or an int ${R.year.join('..')} (${js(d[k])})`);
  for (const k of ['consentNewsletter', 'consentJobs', 'consentDirectory']) if (typeof d[k] !== 'boolean') p.push(`${k} must be a bool (${js(d[k])})`);
  if (d.acceptedPrivacy !== true) p.push('acceptedPrivacy must be true');
  return p;
}
function createProblems(d) {
  const keys = Object.keys(d), allowed = [...R.profileKeys, 'status'];
  const p = [];
  const extra = keys.filter(k => !allowed.includes(k)), missing = R.profileKeys.filter(k => !keys.includes(k));
  if (extra.length) p.push('keys the rules do not allow: ' + extra.join(', '));
  if (missing.length) p.push('keys the rules require but missing: ' + missing.join(', '));
  p.push(...profileProblems(d));
  if (d.status !== 'pending') p.push('status must be "pending"');
  if (!isST(d.createdAt)) p.push('createdAt must be serverTimestamp()');
  if (!isST(d.updatedAt)) p.push('updatedAt must be serverTimestamp()');
  return p;
}
const changed = (before, patch) => Object.keys(patch).filter(k => js(before[k]) !== js(patch[k]));
function ownerUpdateProblems(before, patch) {
  const merged = { ...before, ...patch }, p = [];
  const extra = Object.keys(merged).filter(k => ![...R.profileKeys, ...R.adminKeys].includes(k));
  if (extra.length) p.push('keys the rules do not allow: ' + extra.join(', '));
  p.push(...profileProblems(merged));
  const bad = changed(before, patch).filter(k => [...R.adminKeys, 'createdAt'].includes(k));
  if (bad.length) p.push('an owner may not change: ' + bad.join(', '));
  if (!isST(patch.updatedAt)) p.push('updatedAt must be serverTimestamp()');
  return p;
}
function adminUpdateProblems(before, patch, email) {
  const p = [];
  const bad = changed(before, patch).filter(k => !R.adminKeys.includes(k));
  if (bad.length) p.push('an admin may only change admin fields, not: ' + bad.join(', '));
  const status = 'status' in patch ? patch.status : before.status;
  if (!R.statuses.includes(status)) p.push(`status ${js(status)} not in ${js(R.statuses)}`);
  if ('duesYears' in patch && !(Array.isArray(patch.duesYears) || (patch.duesYears && /^array(Union|Remove)$/.test(patch.duesYears.__fv)))) p.push('duesYears must be a list');
  if (!isST(patch.reviewedAt)) p.push('reviewedAt must be serverTimestamp()');
  if (patch.reviewedBy !== email) p.push(`reviewedBy must equal the token e-mail ${email} (${js(patch.reviewedBy)})`);
  return p;
}
function dirProblems(d) {
  const p = [];
  const extra = Object.keys(d).filter(k => !R.dirKeys.includes(k));
  if (extra.length) p.push('keys the rules do not allow: ' + extra.join(', '));
  if (!(typeof d.name === 'string' && d.name.length > 0 && d.name.length <= R.dirNameMax)) p.push('name must be a 1..' + R.dirNameMax + ' string');
  if (!(d.gradYear === null || (Number.isInteger(d.gradYear) && d.gradYear >= R.year[0] && d.gradYear <= R.year[1]))) p.push('gradYear must be null or an int');
  for (const [k, n] of Object.entries(R.dirMax)) if (!(typeof d[k] === 'string' && d[k].length <= n)) p.push(`${k} must be a string <= ${n}`);
  if (!isST(d.updatedAt)) p.push('updatedAt must be serverTimestamp()');
  return p;
}

/* ---- the server: GitHub Pages under the site's path (SUB) ---------------------- */
const PY = String.raw`
import http.server, sys
root = sys.argv[1]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
class S(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def handle_error(self, request, client_address): pass
srv = S(('127.0.0.1', 0), H)
print(srv.server_address[1], flush=True)
srv.serve_forever()
`;
const TMP = mkdtempSync(path.join(os.tmpdir(), 'semfe-authflow-'));
const LINK = SUB === '/' ? null : path.join(TMP, SUB.replace(/^\/|\/$/g, ''));
if (LINK) symlinkSync(ROOT, LINK, 'dir');
const srv = spawn('python3', ['-c', PY, LINK ? TMP : ROOT], { stdio: ['ignore', 'pipe', 'inherit'] });
const cleanup = () => { try { srv.kill(); } catch {} try { if (LINK) unlinkSync(LINK); } catch {} try { rmdirSync(TMP); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
const PORT = await new Promise((resolve, reject) => {
  let buf = '';
  srv.stdout.on('data', d => { buf += d; const m = buf.match(/^(\d+)\s/); if (m) resolve(+m[1]); });
  srv.on('exit', c => reject(new Error('python3 server exited with ' + c)));
  setTimeout(() => reject(new Error('python3 server did not start')), 10000);
});
const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL_ = p => ORIGIN + SUB + p;

/* ---- reporting ------------------------------------------------------------------ */
let fails = 0, passes = 0;
const failed = [];
let current = '';
const t = (c, m) => { console.log((c ? 'ok    ' : 'FAIL  ') + m); if (c) passes++; else { fails++; failed.push(current + ': ' + m); } return !!c; };
const note = m => console.log('note  ' + m);
const list = (a, n = 5) => a.length ? ': ' + a.slice(0, n).map(String).join(' | ') + (a.length > n ? ` | … +${a.length - n} more` : '') : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- fixtures ------------------------------------------------------------------- */
const HOUR = 3600e3, DAY = 24 * HOUR;
const ts = ms => ({ __ts: ms });
function acct(uid, o) {
  return { uid, email: o.email, displayName: o.name == null ? null : o.name, photoURL: o.photo || null,
    emailVerified: o.verified == null ? true : o.verified, password: o.password,
    providers: (o.providers || ['google.com']).map(p => ({ providerId: p, uid: p + ':' + o.email, email: o.email })),
    created: Date.now() - 40 * DAY, lastSignIn: o.lastSignIn || Date.now() - 2 * HOUR, claims: o.claims || {} };
}
function member(o) {
  return Object.assign({ firstName: 'Όνομα', lastName: 'Επώνυμο', email: 'x@example.com', phone: '', stage: 'graduate', entryYear: 2005, gradYear: 2010,
    direction: 'Εφαρμοσμένη Φυσική', employer: '', position: '', city: 'Αθήνα', linkedin: '', note: '',
    consentNewsletter: true, consentJobs: false, consentDirectory: false, acceptedPrivacy: true, provider: 'google.com',
    status: 'pending', createdAt: ts(Date.now() - 10 * DAY), updatedAt: ts(Date.now() - 10 * DAY) }, o);
}
function dirEntry(o) {
  return Object.assign({ name: 'Όνομα Επώνυμο', gradYear: 2010, direction: '', employer: '', position: '', city: '', linkedin: '', updatedAt: ts(Date.now() - DAY) }, o);
}
const MARIA = { uid: 'u-maria', email: 'maria@example.com', name: 'Μαρία Παπαδοπούλου' };
const XSS = '<img src=x onerror=window.__xss=1>';

/* ---- one scenario = one fresh browser context ------------------------------------ */
const browser = await pw.chromium.launch({ headless: !HEADED });
async function scenario(id, title, opts, fn) {
  if (ONLY.length && !ONLY.includes(id[0])) return;
  current = id;
  console.log(`\n== ${id}. ${title}`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true, locale: 'el-GR',
    viewport: opts.viewport || { width: 1280, height: 900 } });
  const env = { sdkUrls: [], external: [], dialogs: [], dialogPolicy: 'accept', onExternal: null, fnRequests: [] };
  await ctx.route(u => !u.href.startsWith(ORIGIN + '/'), async route => {
    const url = route.request().url();
    if (/^https:\/\/www\.gstatic\.com\/firebasejs\//.test(url)) {
      env.sdkUrls.push(url);
      if (opts.sdkFail) return route.abort();
      if (opts.sdkDelayMs) await sleep(opts.sdkDelayMs);
      if (/\/firebase-(app|auth|firestore)-compat\.js$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: FAKE });
      return route.fulfill({ status: 404, body: '' });
    }
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (env.onExternal && await env.onExternal(route, url)) return;
    env.external.push(url);
    return route.fulfill({ status: 204, body: '' });
  });
  await ctx.route(u => u.href.startsWith(ORIGIN + SUB + 'assets/js/config.js'), route =>
    route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: configFor(opts.cfg || 'oidc') }));
  const seed = Object.assign({ accounts: {}, docs: {}, currentUid: null, queue: [], calls: [] }, opts.seed || {});
  await ctx.addInitScript(s => { try { if (!localStorage.getItem('__fbfake')) localStorage.setItem('__fbfake', JSON.stringify(s)); } catch (e) {} }, seed);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { env.dialogs.push({ type: d.type(), message: d.message() }); if (env.dialogPolicy === 'accept') await d.accept(); else await d.dismiss(); });
  try { await fn(page, env, ctx); }
  catch (e) { t(false, 'scenario threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
  t(errors.length === 0, 'no script errors on the page' + list(errors));
  await ctx.close();
}

/* ---- page helpers ------------------------------------------------------------------ */
const fbState = page => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('__fbfake') || '{}'); } catch (e) { return {}; } });
const calls = async (page, api) => { const c = (await fbState(page)).calls || []; return api ? c.filter(x => x.api === api) : c; };
const docOf = async (page, p) => { const d = (await fbState(page)).docs || {}; return d[p] === undefined ? null : d[p]; };
const server = (page, method, ...args) => page.evaluate(([m, a]) => window.__fb.server[m].apply(null, a), [method, args]);
const queue = (page, op, spec) => page.evaluate(([o, s]) => window.__fb.queue(o, s), [op, spec]);
async function waitFor(page, fn, arg, ms = 6000) { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } }
async function visible(loc, ms = 6000) { try { await loc.first().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } }
async function hidden(loc, ms = 6000) { try { await loc.first().waitFor({ state: 'hidden', timeout: ms }); return true; } catch { return false; } }
async function text(loc) { try { return (await loc.first().innerText({ timeout: 3000 })).replace(/\s+/g, ' ').trim(); } catch { return null; } }
async function hasText(loc, s, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) { const x = await text(loc); if (x != null && x.indexOf(s) !== -1) return true; if (Date.now() > end) return false; await sleep(60); }
}
const sdkReady = page => waitFor(page, () => !!(window.__fb && window.firebase && window.firebase.apps && window.firebase.apps.length && window.firebase.auth), null, 8000);
async function waitCalls(page, api, n = 1, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) { const c = await calls(page, api); if (c.length >= n) return c; if (Date.now() > end) return c; await sleep(50); }
}
async function openDialog(page, mode) {
  await page.click('#acct-slot [data-signin]');
  const ok = await visible(page.locator('.modal-backdrop'));
  if (mode === 'register') await page.click('#tab-register');
  await sdkReady(page);
  await sleep(30);
  return ok;
}
const status = page => text(page.locator('.modal [data-status]'));
const dialogOpen = page => page.evaluate(() => { const b = document.querySelector('.modal-backdrop'); return !!b && !b.hidden; });
const chipName = page => text(page.locator('#acct-slot .acct-chip .nm'));
const flashText = page => page.evaluate(() => Array.from(document.querySelectorAll('body > .notice.ok[role=status]')).map(e => e.textContent).join(' | '));
const xssFired = page => page.evaluate(() => window.__xss !== undefined);
const signedInSeed = (a, extra) => Object.assign({ accounts: { [a.uid]: a }, currentUid: a.uid }, extra || {});

/* ================================================================================== */
await scenario('A', 'header, dialog, providers, a new Google user, the menu, signing out', { cfg: 'oidc' }, async (page, env) => {
  await page.goto(URL_(''));
  t(await visible(page.locator('#acct-slot [data-signin]')), 'header shows the «Σύνδεση» button');
  t((await text(page.locator('#acct-slot [data-signin]'))) === 'Σύνδεση', 'its label is «Σύνδεση»');
  t(await openDialog(page), 'clicking it opens the sign-in dialog');
  t(env.sdkUrls.some(u => u === `https://www.gstatic.com/firebasejs/${SDK}/firebase-app-compat.js`) &&
    env.sdkUrls.some(u => u === `https://www.gstatic.com/firebasejs/${SDK}/firebase-auth-compat.js`),
    `the compat SDK ${SDK} (app + auth) is loaded from gstatic` + list(env.sdkUrls));
  t(!env.sdkUrls.some(u => /firestore/.test(u)), 'the home page does not load Firestore');
  const init = await calls(page, 'app.initializeApp');
  t(init.length === 1 && init[0].args[0].apiKey === 'test-key' && init[0].args[0].projectId === 'demo-semfe', 'initializeApp is called once, with the config from config.js');
  t((await calls(page, 'auth.languageCode=')).some(c => c.args[0] === 'el'), 'auth.languageCode is set to el');
  t((await text(page.locator('#auth-title'))) === 'Σύνδεση', 'the dialog title is «Σύνδεση»');
  t(!(await page.locator('.modal [data-offline]').count()), 'no "opens soon" notice when configured');
  const provs = await page.$$eval('.modal [data-provider]', bs => bs.map(b => ({ k: b.getAttribute('data-provider'), dis: b.disabled })));
  t(js(provs.map(p => p.k)) === js(['google', 'facebook', 'linkedin']), 'Google, Facebook and LinkedIn buttons, in config order' + list(provs.map(p => p.k)));
  t(provs.length && provs.every(p => !p.dis), 'every provider button is enabled');
  t(!(await page.$eval('.modal [data-submit]', b => b.disabled)), 'the e-mail submit button is enabled');

  // LinkedIn (OIDC mode) — and a popup the person closes shows nothing
  await queue(page, 'signInWithPopup', { provider: LI_ID, reject: { code: 'auth/popup-closed-by-user' } });
  await page.click('.modal [data-provider="linkedin"]');
  let c = await waitCalls(page, 'auth.signInWithPopup', 1);
  const li = c[0] && c[0].args[0];
  t(li && li.__provider === 'oidc.linkedin', 'LinkedIn uses the OIDC provider id "oidc.linkedin"' + list([js(li && li.__provider)]));
  t(li && ['openid', 'profile', 'email'].every(s => li.scopes.includes(s)), 'LinkedIn asks for the scopes openid, profile, email' + list([js(li && li.scopes)]));
  t(c[0] && c[0].userActivation === true, 'signInWithPopup is called inside the click (user activation still active)');
  await sleep(150);
  t((await status(page)) === '', 'auth/popup-closed-by-user shows no error');
  t(await page.$eval('.modal [data-link-notice]', e => e.hidden), '… and no notice');
  t(!(await page.$eval('.modal [data-provider="linkedin"]', b => b.disabled)) && (await text(page.locator('.modal [data-provider="linkedin"] span'))) === 'Συνέχεια με LinkedIn',
    '… and the LinkedIn button is enabled again with its label restored');

  // Facebook: the email scope
  await queue(page, 'signInWithPopup', { provider: 'facebook.com', reject: { code: 'auth/cancelled-popup-request' } });
  await page.click('.modal [data-provider="facebook"]');
  c = await waitCalls(page, 'auth.signInWithPopup', 2);
  const fb = c[1] && c[1].args[0];
  t(fb && fb.__provider === 'facebook.com' && fb.scopes.includes('email'), 'Facebook uses facebook.com with the scope "email"' + list([js(fb)]));
  await sleep(100);
  t((await status(page)) === '', 'auth/cancelled-popup-request shows no error either');

  // Google, a first-time user
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { uid: MARIA.uid, email: MARIA.email, displayName: MARIA.name, emailVerified: true } });
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 8000 }).catch(() => {}), page.click('.modal [data-provider="google"]')]);
  c = await calls(page, 'auth.signInWithPopup');
  const g = c[2] && c[2].args[0];
  t(g && g.__provider === 'google.com' && g.customParameters.prompt === 'select_account', 'Google uses google.com with prompt=select_account' + list([js(g)]));
  const u = new URL(page.url());
  t(u.pathname === SUB + 'account/' && u.hash === '#apply', 'a new user lands on account/#apply' + list([page.url()]));
  t(await visible(page.locator('#account-app form[data-apply]')), 'the account page shows the membership application');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), MARIA.name), 'the header chip shows the name «' + MARIA.name + '»');
  t((await page.inputValue('#f-firstName')) === 'Μαρία' && (await page.inputValue('#f-lastName')) === 'Παπαδοπούλου' && (await page.inputValue('#f-email')) === MARIA.email,
    'the form is prefilled with the first name, last name and e-mail from Google');

  // the account menu
  const menu = page.locator('#acct-menu');
  t(await menu.isHidden(), 'the account menu starts closed');
  await page.click('#acct-slot .acct-chip');
  t(await menu.isVisible(), 'clicking the chip opens the menu');
  t((await page.getAttribute('#acct-slot .acct-chip', 'aria-expanded')) === 'true', '… and sets aria-expanded=true');
  const items = await page.$$eval('#acct-menu a, #acct-menu button', es => es.map(e => e.textContent.trim()));
  t(items.includes('Ο λογαριασμός μου') && items.includes('Περιοχή μελών') && items.includes('Αποσύνδεση'), 'the menu lists account, members area and sign out' + list(items));
  t(!items.some(x => /Διαχείριση/.test(x)), 'no «Διαχείριση» item for a non-admin');
  t(await hasText(page.locator('#acct-menu .who'), MARIA.email), 'the menu says who is signed in (e-mail)');
  await page.mouse.click(5, 450);
  t(await menu.isHidden(), 'a click outside closes the menu');
  await page.click('#acct-slot .acct-chip');
  await page.keyboard.press('Escape');
  t(await menu.isHidden(), 'Escape closes the menu');
  t(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('acct-chip')), '… and returns focus to the chip');
  t(await page.evaluate(() => !!localStorage.getItem('semfe:auth-hint')), 'a header hint is kept for the next page');

  // signing out (on the account page the page reloads)
  await page.click('#acct-slot .acct-chip');
  await Promise.all([page.waitForEvent('load', { timeout: 8000 }).catch(() => {}), page.click('#acct-menu [data-signout]')]);
  t((await calls(page, 'auth.signOut')).length === 1, 'Αποσύνδεση calls auth.signOut()');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'after signing out the header shows «Σύνδεση» again');
  t(await hasText(page.locator('#account-app'), 'Συνδεθείτε ή δημιουργήστε λογαριασμό'), 'the account page shows its signed-out state');
  t(await page.evaluate(() => !localStorage.getItem('semfe:auth-hint')), 'the header hint is cleared');

  // links that open the dialog
  await page.goto(URL_('?signin'));
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Σύνδεση', '?signin opens the dialog in sign-in mode');
  await page.goto(URL_('#register'));
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', '#register opens it in register mode');
  await page.keyboard.press('Escape');
  t(await hidden(page.locator('.modal-backdrop')), 'Escape closes the dialog');
});

/* ================================================================================== */
await scenario('B', 'the «Διαχείριση» menu item appears only for a VERIFIED admin e-mail', { cfg: 'oidc',
  seed: signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής', verified: true, providers: ['google.com'] })) }, async (page) => {
  t(ADMIN && R.admins.map(x => x.toLowerCase()).includes(ADMIN), `ADMIN_EMAILS[0] (${ADMIN}) is also in isAdmin() of firestore.rules`);
  await page.goto(URL_(''));
  t(await visible(page.locator('#acct-slot .acct-chip'), 8000), 'a returning signed-in admin gets the name chip');
  await page.click('#acct-slot .acct-chip');
  const link = page.locator('#acct-menu a[href$="admin/"]');
  t(await link.count() === 1 && /Διαχείριση/.test(await text(link)), 'a verified admin e-mail sees «Διαχείριση μελών»');
  // sign out on a normal page: no reload, header back to Σύνδεση
  await page.click('#acct-menu [data-signout]');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'signing out on the home page puts «Σύνδεση» back');
  t(page.url() === URL_(''), '… without leaving the page');
  // the same address, NOT verified (an e-mail + password account that never confirmed)
  await server(page, 'setAccount', 'u-admin2', acct('u-admin2', { email: ADMIN.toUpperCase(), name: 'Ψεύτικος Διαχειριστής', verified: false, providers: ['password'], password: 'pass-word-123' }));
  await server(page, 'setAccount', 'u-admin', { email: 'old-' + ADMIN });   // free the address for the unverified one
  await openDialog(page);
  await page.fill('#auth-email', ADMIN.toUpperCase());
  await page.fill('#auth-pass', 'pass-word-123');
  await page.click('.modal [data-submit]');
  t(await visible(page.locator('#acct-slot .acct-chip')), 'the unverified account signs in');
  await page.click('#acct-slot .acct-chip');
  t(await page.locator('#acct-menu a[href$="admin/"]').count() === 0, 'the same admin address, unverified, gets NO «Διαχείριση» item');
});

/* ================================================================================== */
await scenario('C', 'same e-mail, second provider: sign in the first way, then the second is linked', { cfg: 'oidc',
  seed: { accounts: { [MARIA.uid]: acct(MARIA.uid, { email: MARIA.email, name: MARIA.name, providers: ['google.com'] }) } } }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page);
  const cred = { providerId: 'facebook.com', signInMethod: 'facebook.com', accessToken: 'fb-access-token-123' };
  await queue(page, 'signInWithPopup', { provider: 'facebook.com', reject: { code: 'auth/account-exists-with-different-credential', credential: cred, email: MARIA.email } });
  await page.click('.modal [data-provider="facebook"]');
  const notice = page.locator('.modal [data-link-notice]');
  t(await visible(notice), 'the «you already have an account» notice appears');
  t(await hasText(notice, 'Έχετε ήδη λογαριασμό με το ' + MARIA.email), '… naming the address');
  t(await hasText(notice, 'Facebook'), '… and the provider it will link afterwards');
  t(await hasText(notice, '(Google, LinkedIn ή e-mail και κωδικό)'), '… and offers the OTHER ways in, from the buttons (not the one just tried)' + list([await text(notice)]));
  t((await page.inputValue('#auth-email')) === MARIA.email, 'the e-mail field is prefilled with that address');
  t((await status(page)) === '', 'no error text besides the notice');
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { email: MARIA.email } });
  await page.click('.modal [data-provider="google"]');
  const lk = await waitCalls(page, 'user.linkWithCredential', 1);
  t(lk.length === 1 && js(lk[0].args[0]) === js(cred), 'after the Google sign-in, linkWithCredential() gets the SAVED Facebook credential' + list(lk.map(x => js(x.args[0]))));
  const all = await calls(page);
  const gi = all.findIndex(x => x.api === 'auth.signInWithPopup' && x.args[0].__provider === 'google.com');
  t(gi !== -1 && lk[0] && gi < lk[0].i, '… after, not before, signing in');
  t(await waitFor(page, () => /Το Facebook συνδέθηκε με τον λογαριασμό σας/.test(Array.from(document.querySelectorAll('body > .notice.ok[role=status]')).map(e => e.textContent).join(' '))),
    'a success toast says Facebook is now linked' + list([await flashText(page)]));
  t(!(await dialogOpen(page)), 'the dialog closes');
  t(new URL(page.url()).pathname === SUB, 'an existing user stays on the page');
  const a = (await fbState(page)).accounts[MARIA.uid];
  t(a && a.providers.map(p => p.providerId).sort().join() === 'facebook.com,google.com', 'the ONE account now opens with Google and Facebook');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), MARIA.name), 'the header chip shows the name');
});

/* ================================================================================== */
await scenario('D', 'e-mail registration: validation, account, name, verification e-mail', { cfg: 'oidc',
  seed: { accounts: { 'u-taken': acct('u-taken', { email: 'taken@example.com', providers: ['password'], password: 'whatever-123' }) } } }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page, 'register');
  t((await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', 'the «Εγγραφή» tab switches to «Νέος λογαριασμός»');
  t(await page.locator('#auth-first').isVisible() && await page.locator('#auth-last').isVisible(), 'first and last name fields appear');
  t((await text(page.locator('.modal [data-submit]'))) === 'Δημιουργία λογαριασμού', 'the button says «Δημιουργία λογαριασμού»');
  t(await page.locator('.modal [data-forgot]').isHidden(), '«Ξεχάσατε τον κωδικό;» is hidden while registering');
  t((await page.getAttribute('#auth-pass', 'autocomplete')) === 'new-password', 'the password field asks the browser for a NEW password');
  const submit = () => page.click('.modal [data-submit]');
  const inval = sel => page.getAttribute(sel, 'aria-invalid');
  await submit();
  t((await status(page)) === 'Γράψτε το όνομά σας.' && (await inval('#auth-first')) === 'true', 'empty first name: «Γράψτε το όνομά σας.»');
  await page.fill('#auth-first', 'Γιώργος');
  await submit();
  t((await status(page)) === 'Γράψτε το επώνυμό σας.' && (await inval('#auth-last')) === 'true', 'empty last name: «Γράψτε το επώνυμό σας.»');
  await page.fill('#auth-last', 'Νικολάου');
  await page.fill('#auth-email', 'not-an-email');
  await submit();
  t((await status(page)) === 'Γράψτε μια έγκυρη διεύθυνση e-mail.' && (await inval('#auth-email')) === 'true', 'invalid e-mail: «Γράψτε μια έγκυρη διεύθυνση e-mail.»');
  await page.fill('#auth-email', 'giorgos@example.com');
  await submit();
  t((await status(page)) === 'Γράψτε τον κωδικό σας.', 'no password: «Γράψτε τον κωδικό σας.»');
  await page.fill('#auth-pass', 'short1');
  await submit();
  t((await status(page)) === 'Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.' && (await inval('#auth-pass')) === 'true', 'a 6-character password: «… τουλάχιστον 8 χαρακτήρες.»');
  t((await calls(page, 'auth.createUserWithEmailAndPassword')).length === 0, 'nothing reaches Firebase while the form is invalid');
  await page.click('.modal [data-pw]');
  t((await page.getAttribute('#auth-pass', 'type')) === 'text' && (await page.getAttribute('.modal [data-pw]', 'aria-pressed')) === 'true', 'the «Εμφάνιση» button shows the password');
  await page.click('.modal [data-pw]');
  // an address that already has an account
  await page.fill('#auth-email', 'taken@example.com');
  await page.fill('#auth-pass', 'correct-horse-9');
  await submit();
  t(await hasText(page.locator('.modal [data-status]'), 'Υπάρχει ήδη λογαριασμός με αυτό το e-mail'), 'an address in use gives the Greek «already in use» message');
  // the real thing
  await page.fill('#auth-email', 'giorgos@example.com');
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 8000 }).catch(() => {}), submit()]);
  const all = await calls(page);
  const cr = all.filter(x => x.api === 'auth.createUserWithEmailAndPassword').pop();
  const up = all.filter(x => x.api === 'user.updateProfile').pop();
  const ve = all.filter(x => x.api === 'user.sendEmailVerification').pop();
  t(cr && cr.args[0] === 'giorgos@example.com' && cr.args[1] === 'correct-horse-9', 'createUserWithEmailAndPassword(e-mail, password)');
  t(up && up.args[0].displayName === 'Γιώργος Νικολάου', 'updateProfile({displayName: "First Last"})' + list([js(up && up.args[0])]));
  t(ve && ve.args[0] && ve.args[0].url === ORIGIN + SUB + 'account/', 'sendEmailVerification() with a continue URL back to /semfealumni/account/' + list([js(ve && ve.args[0])]));
  t(cr && up && ve && cr.i < up.i && up.i < ve.i, '… in that order: create, name, verification e-mail');
  const u = new URL(page.url());
  t(u.pathname === SUB + 'account/' && u.hash === '#apply', 'the new account lands on account/#apply');
  t(await hasText(page.locator('#account-app'), 'Επιβεβαιώστε το e-mail σας'), 'it is asked to confirm the e-mail');
  t(await visible(page.locator('#account-app form[data-apply]')) && await page.$eval('#account-app form[data-apply] [type=submit]', b => b.disabled), 'the application form is there but its submit button is disabled');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Γιώργος Νικολάου'), 'the header chip shows the new name');
});

/* ================================================================================== */
await scenario('E', 'e-mail sign-in: wrong password, forgotten password, success', { cfg: 'oidc',
  seed: { accounts: { 'u-eleni': acct('u-eleni', { email: 'eleni@example.com', name: 'Ελένη Σταύρου', providers: ['password'], password: 'right-password-1' }) } } }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page);
  await page.fill('#auth-email', 'eleni@example.com');
  await page.fill('#auth-pass', 'wrong-password');
  await page.click('.modal [data-submit]');
  t(await hasText(page.locator('.modal [data-status]'), 'Λάθος e-mail ή κωδικός. Αν δημιουργήσατε τον λογαριασμό σας με Google, Facebook ή LinkedIn'),
    'a wrong password gives the Greek auth/invalid-credential message' + list([await status(page)]));
  t(!(await page.$eval('.modal [data-submit]', b => b.disabled)), 'the button is enabled again for another try');
  await page.fill('#auth-email', '');
  await page.click('.modal [data-forgot]');
  t((await status(page)) === 'Γράψτε πρώτα το e-mail σας παραπάνω και πατήστε ξανά «Ξεχάσατε τον κωδικό;».', 'forgot password with no e-mail asks for the e-mail first');
  t((await page.getAttribute('#auth-email', 'aria-invalid')) === 'true', '… and marks the e-mail field');
  t((await calls(page, 'auth.sendPasswordResetEmail')).length === 0, '… without calling Firebase');
  await page.fill('#auth-email', 'eleni@example.com');
  await page.click('.modal [data-forgot]');
  const rs = await waitCalls(page, 'auth.sendPasswordResetEmail', 1);
  t(rs.length === 1 && rs[0].args[0] === 'eleni@example.com' && rs[0].args[1] && rs[0].args[1].url === ORIGIN + SUB + 'account/', 'with an e-mail it calls sendPasswordResetEmail(e-mail, {url: …/semfealumni/account/})' + list(rs.map(x => js(x.args))));
  t(await hasText(page.locator('.modal .form-ok[data-status]'), 'σας στείλαμε σύνδεσμο για νέο κωδικό'), '… and says a link was sent (green)');
  await page.fill('#auth-pass', 'right-password-1');
  await page.click('.modal [data-submit]');
  t(await hidden(page.locator('.modal-backdrop')), 'the right password signs in and closes the dialog');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Ελένη Σταύρου'), 'the header chip shows the name');
  t(new URL(page.url()).pathname === SUB, 'an existing account stays on the page');
});

/* ================================================================================== */
await scenario('F1', 'account page, signed out', { cfg: 'oidc' }, async (page) => {
  await page.goto(URL_('account/'));
  const app = page.locator('#account-app');
  t(await hasText(app, 'Συνδεθείτε ή δημιουργήστε λογαριασμό'), 'the signed-out panel');
  await page.click('#account-app [data-open="register"]');
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', '«Νέος λογαριασμός» opens the dialog in register mode');
  await page.click('.modal [data-close]');
  await page.click('#account-app [data-open="signin"]');
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Σύνδεση', '«Έχω ήδη λογαριασμό» opens it in sign-in mode');
  await page.goto(URL_(''));                        // a fresh load, not a same-page #hash change
  await page.goto(URL_('account/#apply'));
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', 'account/#apply, signed out, opens the register dialog');
});

const mariaAcct = (o) => acct(MARIA.uid, Object.assign({ email: MARIA.email, name: MARIA.name, providers: ['google.com'] }, o || {}));
await scenario('F2', 'account page: the application (validate, refused write, create, edit), linking a provider', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('account/'));
  const form = page.locator('#account-app form[data-apply]');
  t(await visible(form), 'signed in with no application: the form is shown');
  t(await hasText(page.locator('#account-app .profile-head'), 'Χωρίς αίτηση'), '… with the «Χωρίς αίτηση» badge');
  const msg = page.locator('#account-app [data-form-msg]');
  const submit = () => page.click('#account-app form[data-apply] [type=submit]');
  const good = { firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, phone: '6900000000', stage: 'graduate', direction: 'Εφαρμοσμένα Μαθηματικά',
    entryYear: '2008', gradYear: '2013', position: 'Data Scientist', employer: 'ACME', city: 'Αθήνα', linkedin: 'linkedin.com/in/maria-p', note: 'Γεια σας' };
  async function fill(v) {
    for (const [k, val] of Object.entries(v)) {
      if (k === 'stage' || k === 'direction') await page.selectOption('#f-' + k, val);
      else await page.fill('#f-' + k, val);
    }
  }
  const bad = async (patch, check, expect, label) => {
    await fill(Object.assign({}, good, patch));
    await page.setChecked('#f-acceptedPrivacy', check);
    await submit();
    const m = await text(msg);
    t(m === expect, label + ': «' + expect + '»' + (m === expect ? '' : list([m])));
  };
  await bad({ firstName: '' }, true, 'Γράψτε το όνομά σας.', 'missing first name');
  t((await page.getAttribute('#f-firstName', 'aria-invalid')) === 'true', '… and the field is marked');
  await bad({ lastName: '   ' }, true, 'Γράψτε το επώνυμό σας.', 'missing last name');
  await bad({ email: 'nope' }, true, 'Γράψτε μια έγκυρη διεύθυνση e-mail.', 'bad e-mail');
  await bad({ stage: '' }, true, 'Επιλέξτε την ιδιότητά σας.', 'no stage');
  await bad({ linkedin: 'https://example.com/in/maria' }, true, 'Γράψτε τη διεύθυνση του προφίλ σας στο LinkedIn (linkedin.com/in/…).', 'a LinkedIn URL that is not linkedin.com');
  await bad({ entryYear: '2015', gradYear: '2010' }, true, 'Το έτος αποφοίτησης είναι πριν από το έτος εισαγωγής.', 'graduation before entry');
  await bad({ entryYear: '1850' }, true, 'Το έτος εισαγωγής δεν φαίνεται σωστό.', 'an impossible entry year');
  await bad({}, false, 'Για να υποβάλετε αίτηση, χρειάζεται να συμφωνήσετε με την πολιτική απορρήτου.', 'privacy not accepted');
  t((await calls(page, 'fs.set')).length === 0, 'no write while the form is invalid');

  // the server refuses the write (e.g. rules not published): the person must be TOLD
  await queue(page, 'fs.set', { path: 'members/', reject: { code: 'permission-denied', message: 'Missing or insufficient permissions.' } });
  await fill(good);
  await page.setChecked('#f-consentNewsletter', true);
  await page.setChecked('#f-acceptedPrivacy', true);
  await submit();
  await waitCalls(page, 'fs.set', 1);
  await sleep(400);
  const refusedMsg = await text(msg);
  const still = (await page.locator('#f-employer').count()) ? await page.inputValue('#f-employer') : null;
  t(refusedMsg && refusedMsg.indexOf('Δεν έχετε δικαίωμα για αυτή την ενέργεια') !== -1,
    'a refused application shows the Greek permission-denied message' + list([js(refusedMsg)]));
  t(still === 'ACME', '… and keeps what the person typed' + list([js(still)]));
  t(!(await docOf(page, 'members/' + MARIA.uid)), 'nothing was stored');

  // the real submission
  await fill(good);
  await page.setChecked('#f-consentNewsletter', true);
  await page.setChecked('#f-consentJobs', false);
  await page.setChecked('#f-consentDirectory', true);
  await page.setChecked('#f-acceptedPrivacy', true);
  const nBefore = (await calls(page, 'fs.set')).length;
  await submit();
  const sets = await waitCalls(page, 'fs.set', nBefore + 1);
  const w = sets[nBefore];
  t(w && w.args[0] === 'members/' + MARIA.uid, 'the application is written with set() to members/{uid}' + list([w && w.args[0]]));
  const d = (w && w.args[1]) || {};
  t(js(Object.keys(d).sort()) === js([...R.profileKeys, 'status'].sort()), 'set() carries EXACTLY the keys the create rule requires (profileKeys + status)' +
    list([...Object.keys(d).filter(k => ![...R.profileKeys, 'status'].includes(k)).map(k => '+' + k), ...[...R.profileKeys, 'status'].filter(k => !(k in d)).map(k => '-' + k)]));
  const probs = createProblems(d);
  t(probs.length === 0, 'the payload passes the create rule (types, lengths, status, timestamps)' + list(probs));
  t(d.status === 'pending' && isST(d.createdAt) && isST(d.updatedAt), 'status "pending", createdAt/updatedAt = serverTimestamp()');
  t(d.entryYear === 2008 && d.gradYear === 2013, 'the years are integers');
  t(d.consentNewsletter === true && d.consentJobs === false && d.consentDirectory === true && d.acceptedPrivacy === true, 'the consents are booleans');
  t(d.linkedin === 'https://linkedin.com/in/maria-p', 'a bare linkedin.com/in/… is stored as https://' + list([d.linkedin]));
  t(d.provider === 'google.com', 'provider records how they signed in');
  t(await waitFor(page, () => /Η αίτησή σας υποβλήθηκε/.test(Array.from(document.querySelectorAll('body > .notice.ok[role=status]')).map(e => e.textContent).join(' '))),
    'a toast confirms the submission («Η αίτησή σας υποβλήθηκε. Ευχαριστούμε!»)' + list([js(await flashText(page))]));
  t(await hasText(page.locator('#account-app'), 'Λάβαμε την αίτησή σας.') && await hasText(page.locator('#account-app .profile-head'), 'Η αίτηση εκκρεμεί'), 'the page switches to «Λάβαμε την αίτησή σας.» / pending');
  const stored = await docOf(page, 'members/' + MARIA.uid);
  t(stored && stored.createdAt && stored.createdAt.__ts, 'the stored document gets its server timestamp');

  // editing: update(), never the admin fields
  await server(page, 'setDoc', 'members/' + MARIA.uid, Object.assign({}, stored, { status: 'pending', duesYears: [YEAR - 1], adminNote: 'σημείωση' }));
  await sleep(100);
  await page.click('#account-app [data-edit]');
  t(await visible(page.locator('#account-app form[data-apply]')) && (await text(page.locator('#account-app form[data-apply] [type=submit]'))) === 'Αποθήκευση', '«Επεξεργασία στοιχείων» opens the form with «Αποθήκευση»');
  t((await page.inputValue('#f-employer')) === 'ACME' && (await page.inputValue('#f-gradYear')) === '2013', 'the form holds the saved values');
  await page.fill('#f-city', 'Θεσσαλονίκη');
  await page.fill('#f-gradYear', '');
  const before = await docOf(page, 'members/' + MARIA.uid);
  await page.click('#account-app form[data-apply] [type=submit]');
  const ups = await waitCalls(page, 'fs.update', 1);
  const up = ups[0];
  const pd = (up && up.args[1]) || {};
  t(up && up.args[0] === 'members/' + MARIA.uid, 'saving an existing application uses update()');
  t((await calls(page, 'fs.set')).length === nBefore + 1, '… not set()');
  const forbidden = Object.keys(pd).filter(k => [...R.adminKeys, 'createdAt'].includes(k));
  t(forbidden.length === 0, 'update() never touches status / duesYears / adminNote / reviewedAt / reviewedBy / createdAt' + list(forbidden));
  const up2 = ownerUpdateProblems(before, pd);
  t(up2.length === 0, 'the update passes the owner-update rule' + list(up2));
  t(pd.gradYear === null && pd.city === 'Θεσσαλονίκη', 'an emptied year is stored as null');
  t(await hasText(page.locator('#account-app'), 'Θεσσαλονίκη') && !(await page.locator('#account-app form[data-apply]').count()), 'after saving, the page shows the details again (not the form)');
  const after = await docOf(page, 'members/' + MARIA.uid);
  t(after && after.status === 'pending' && js(after.duesYears) === js([YEAR - 1]) && after.adminNote === 'σημείωση', 'status, duesYears and adminNote are unchanged');
  await page.click('#account-app [data-edit]');
  await page.click('#account-app [data-cancel]');
  t(!(await page.locator('#account-app form[data-apply]').count()), '«Ακύρωση» closes the form');

  // sign-in methods: Google linked, Facebook can be added
  const methods = page.locator('#account-app .linked');
  t(await hasText(methods, 'Google') && (await page.locator('#account-app .linked .badge.ok').count()) === 1, '«Τρόποι σύνδεσης» shows Google as connected');
  await page.click('#account-app [data-link="facebook"]');
  const lp = await waitCalls(page, 'user.linkWithPopup', 1);
  t(lp[0] && lp[0].args[0].__provider === 'facebook.com' && lp[0].args[0].scopes.includes('email'), '«Σύνδεση» next to Facebook calls linkWithPopup(Facebook)');
  t(await waitFor(page, () => document.querySelectorAll('#account-app .linked .badge.ok').length === 2), '… and Facebook is then shown as connected' +
    list([(await page.$$eval('#account-app .linked .row', rs => rs.map(r => r.textContent.trim()))).join(' / '), 'toast: ' + (await flashText(page))]));
  await queue(page, 'linkWithPopup', { reject: { code: 'auth/credential-already-in-use' } });
  await page.click('#account-app [data-link="linkedin"]');
  t(await hasText(page.locator('#account-app [data-clash]'), 'ανοίγει ήδη άλλον λογαριασμό εδώ') && await visible(page.locator('#account-app [data-merge-conflict]')),
    'a LinkedIn already used elsewhere: the Greek notice, with an offer to merge the two accounts');
  // LinkedIn through Firebase (oidc): merging signs in to the other account in a popup, never leaves for LinkedIn
  const before2 = page.url();
  await page.click('#account-app [data-merge-conflict]');
  const mp = await waitCalls(page, 'semfe-merge.auth.signInWithPopup', 1);
  t(mp[0] && mp[0].args[0].__provider === 'oidc.linkedin' && page.url() === before2,
    '… «Ένωση» with LinkedIn through Firebase signs in to the other account in a popup (the page stays)');
});

await scenario('F3', 'account page: an e-mail + password account that has not confirmed its address', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw', { email: 'nikos@example.com', name: 'Νίκος Κάραλης', verified: false, providers: ['password'], password: 'pass-word-123' })) }, async (page) => {
  await page.goto(URL_('account/'));
  const app = page.locator('#account-app');
  t(await hasText(app, 'Επιβεβαιώστε το e-mail σας'), 'the verification notice is shown');
  t(await visible(page.locator('#account-app form[data-apply]')), 'the form is shown');
  t(await page.$eval('#account-app form[data-apply] [type=submit]', b => b.disabled), '… with a DISABLED submit button');
  t(await hasText(page.locator('#account-app [data-form-msg]'), 'Επιβεβαιώστε πρώτα το e-mail σας'), '… and a line saying why');
  await page.click('#account-app [data-resend]');
  const sv = await waitCalls(page, 'user.sendEmailVerification', 1);
  t(sv.length === 1, '«Αποστολή ξανά» sends the verification e-mail again');
  t(await hasText(page.locator('#account-app [data-verify-msg]'), 'Σας στείλαμε e-mail επιβεβαίωσης'), '… and says «Σας στείλαμε e-mail επιβεβαίωσης…»');
  await page.click('#account-app [data-verified]');
  const tok = await waitCalls(page, 'user.getIdToken', 1);
  const all = await calls(page);
  const rl = all.filter(x => x.api === 'user.reload');
  t(rl.length === 1 && tok.length >= 1 && rl[0].i < tok[tok.length - 1].i, '«Το επιβεβαίωσα» calls reload() THEN getIdToken()');
  t(tok.some(x => x.args[0] === true), '… getIdToken(true), forcing a fresh token for the rules');
  t(await hasText(page.locator('#account-app [data-verify-msg]'), 'Δεν έχει επιβεβαιωθεί ακόμα'), 'still unconfirmed: «Δεν έχει επιβεβαιωθεί ακόμα…»');
  await server(page, 'verify', 'u-pw', true);       // the person clicks the link in the e-mail
  await page.click('#account-app [data-verified]');
  t(await waitFor(page, () => !/Επιβεβαιώστε το e-mail σας/.test(document.getElementById('account-app').textContent)), 'once confirmed, the notice disappears');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app form[data-apply] [type=submit]'); return !!b && !b.disabled; }), '… and the submit button is enabled');
  t((await text(page.locator('#account-app [data-form-msg]'))) === '', '… and the "confirm first" line is gone');
});

await scenario('F4', 'account page: an active member and the members directory', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: {
    ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, status: 'active', duesYears: [YEAR], consentDirectory: false,
      gradYear: 2013, employer: 'ACME', position: 'Data Scientist', city: 'Αθήνα', linkedin: 'https://www.linkedin.com/in/maria-p', reviewedBy: ADMIN, reviewedAt: ts(Date.now() - DAY) })
  } }) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await hasText(page.locator('#account-app .profile-head'), 'Ενεργό μέλος'), 'an active member sees «Ενεργό μέλος»');
  t(await hasText(page.locator('#account-app'), 'Συνδρομές που έχουμε καταγράψει: ' + YEAR), '… and the recorded dues');
  const box = page.locator('#account-app [data-dir]');
  t(await visible(box), 'the directory checkbox is shown');
  t(!(await box.isChecked()), '… unticked (not listed)');
  const before = await docOf(page, 'members/' + MARIA.uid);
  await box.check();
  const ds = await waitCalls(page, 'fs.set', 1);
  const dw = ds.find(x => x.args[0] === 'directory/' + MARIA.uid);
  t(!!dw, 'ticking it writes directory/{uid}');
  const dp = dirProblems((dw && dw.args[1]) || {});
  t(dw && dp.length === 0, 'with only the keys (and types) the directory rule allows' + list(dp.length ? dp : Object.keys((dw && dw.args[1]) || {})));
  t(dw && dw.args[1].name === 'Μαρία Παπαδοπούλου' && dw.args[1].gradYear === 2013, '… name and year taken from the application');
  const mu = (await waitCalls(page, 'fs.update', 1)).find(x => x.args[0] === 'members/' + MARIA.uid);
  t(mu && js(Object.keys(mu.args[1]).sort()) === js(['consentDirectory', 'updatedAt']) && mu.args[1].consentDirectory === true, 'the choice is remembered on the application (consentDirectory, updatedAt)');
  const op = ownerUpdateProblems(before, (mu && mu.args[1]) || {});
  t(op.length === 0, '… an update the owner rule accepts' + list(op));
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-dir]'); return b && b.checked && !b.disabled; }), 'after the page redraws, the box is ticked');
  t(!!(await docOf(page, 'directory/' + MARIA.uid)), 'the directory entry exists');
  await sleep(300);
  t(await hasText(page.locator('#account-app [data-dir-msg]'), 'Εμφανίζεστε στον κατάλογο μελών.', 1500), 'the page confirms «Εμφανίζεστε στον κατάλογο μελών.»' +
    list([js(await text(page.locator('#account-app [data-dir-msg]')))]));
  // unticking removes it
  await page.locator('#account-app [data-dir]').uncheck();
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['directory/u-maria']), 'unticking deletes the directory entry');
  t((await calls(page, 'fs.delete')).some(x => x.args[0] === 'directory/' + MARIA.uid), '… with delete()');
  // editing the application of an active, listed member refreshes the listing too
  await page.locator('#account-app [data-dir]').check();
  await waitFor(page, () => !!JSON.parse(localStorage.getItem('__fbfake')).docs['directory/u-maria']);
  await sleep(200);
  const n0 = (await calls(page, 'fs.set')).length;
  await page.click('#account-app [data-edit]');
  await page.fill('#f-employer', 'Νέος Εργοδότης');
  await page.click('#account-app form[data-apply] [type=submit]');
  const up = (await waitCalls(page, 'fs.update', 4)).filter(x => x.args[0] === 'members/' + MARIA.uid && 'firstName' in x.args[1]).pop();
  t(up && !('status' in up.args[1]) && !('duesYears' in up.args[1]), 'an active member\'s edit never sends status or duesYears');
  t(await waitFor(page, n => JSON.parse(localStorage.getItem('__fbfake')).calls.filter(c => c.api === 'fs.set').length > n, n0), 'the directory card is rewritten after the edit');
  const last = (await calls(page, 'fs.set')).pop();
  t(last && last.args[0] === 'directory/' + MARIA.uid && last.args[1].employer === 'Νέος Εργοδότης' && dirProblems(last.args[1]).length === 0, '… with the new employer, within the directory rule');
  const st = await docOf(page, 'members/' + MARIA.uid);
  t(st.status === 'active' && js(st.duesYears) === js([YEAR]), 'status and dues are untouched');
});

await scenario('F5', 'account page: approved while asking to be listed -> listed once', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active', consentDirectory: true }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  const s = await waitCalls(page, 'fs.set', 1);
  t(s.length === 1 && s[0].args[0] === 'directory/' + MARIA.uid && dirProblems(s[0].args[1]).length === 0, 'the directory entry is written automatically, within the rule');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-dir]'); return b && b.checked; }), 'and the box shows ticked');
  await sleep(300);
  t((await calls(page, 'fs.set')).length === 1, 'only once');
});

await scenario('F6', 'account page: deleting the account (Google)', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct({ lastSignIn: Date.now() - 3 * HOUR }), { docs: {
    ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active' }), ['directory/' + MARIA.uid]: dirEntry({ name: 'Μαρία Παπαδοπούλου' })
  } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await visible(page.locator('#account-app [data-del-open]'));
  t(await page.locator('#account-app [data-del-box]').isHidden(), 'the deletion box starts closed');
  await page.click('#account-app [data-del-open]');
  t(await page.locator('#account-app [data-del-box]').isVisible(), '«Διαγραφή λογαριασμού» opens it');
  t(!(await page.locator('#del-pass').count()), 'a Google account is not asked for a password');
  await page.click('#account-app [data-del-go]');
  t((await text(page.locator('#account-app [data-del-msg]'))) === 'Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.', 'without typing ΔΙΑΓΡΑΦΗ: «Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.»');
  await page.fill('#del-confirm', 'ΔΙΑΓΡΑΦ');
  await page.click('#account-app [data-del-go]');
  t((await text(page.locator('#account-app [data-del-msg]'))) === 'Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.', 'a near miss is refused too');
  t((await calls(page)).every(x => !/reauth|user\.delete|fs\.delete/.test(x.api)), 'nothing is called before the word is typed');
  // the popup is closed: nothing is deleted
  await page.fill('#del-confirm', 'ΔΙΑΓΡΑΦΗ');
  await queue(page, 'reauthenticateWithPopup', { reject: { code: 'auth/popup-closed-by-user' } });
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app [data-del-msg]'), 'Η διαγραφή ακυρώθηκε.'), 'closing the re-authentication popup: «Η διαγραφή ακυρώθηκε.»');
  t(!!(await docOf(page, 'members/' + MARIA.uid)) && !!(await docOf(page, 'directory/' + MARIA.uid)) && !!(await fbState(page)).accounts[MARIA.uid], '… and nothing is deleted');
  t(!(await page.$eval('#account-app [data-del-go]', b => b.disabled)), '… and the button works again');
  // the real thing
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.'), 'the «account deleted» message is shown');
  await sleep(400);
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.') && !(await hasText(page.locator('#account-app'), 'Συνδεθείτε ή δημιουργήστε', 300)),
    '… and STAYS (not replaced by the signed-out screen when auth reports no user)');
  const all = await calls(page);
  const re = all.filter(x => x.api === 'user.reauthenticateWithPopup'), last = re[re.length - 1];
  const after = all.filter(x => last && x.i > last.i);
  const dDir = after.find(x => x.api === 'fs.delete' && x.args[0] === 'directory/' + MARIA.uid);
  const dMem = after.find(x => x.api === 'fs.delete' && x.args[0] === 'members/' + MARIA.uid);
  const dUser = after.find(x => x.api === 'user.delete');
  t(last && last.args[0].__provider === 'google.com', 're-authentication uses a Google popup (the account\'s own provider)');
  t(last && last.userActivation === true, '… opened inside the click');
  t(!!(last && dDir && dMem && dUser && last.i < dDir.i && dDir.i < dMem.i && dMem.i < dUser.i),
    'order: re-authenticate, delete directory, delete members, delete the sign-in account' + list([last, dDir, dMem, dUser].map(x => x ? x.api + '#' + x.i : '—')));
  t(!(await docOf(page, 'members/' + MARIA.uid)) && !(await docOf(page, 'directory/' + MARIA.uid)), 'the application and the directory entry are gone');
  t(!(await fbState(page)).accounts[MARIA.uid], 'the sign-in account is gone');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'the header shows «Σύνδεση»');
  t(await page.evaluate(() => !localStorage.getItem('semfe:auth-hint')), 'the header hint is removed');
});

await scenario('F7', 'account page: deleting an e-mail + password account', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw', { email: 'nikos@example.com', name: 'Νίκος Κάραλης', providers: ['password'], password: 'pass-word-123', lastSignIn: Date.now() - 3 * HOUR }),
    { docs: { 'members/u-pw': member({ firstName: 'Νίκος', lastName: 'Κάραλης' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-del-open]');
  t(await page.locator('#del-pass').isVisible(), 'a password-only account is asked for its password');
  await page.fill('#del-confirm', 'διαγραφη');
  await page.fill('#del-pass', 'wrong-one');
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app [data-del-msg]'), 'Λάθος e-mail ή κωδικός'), 'a wrong password: the Greek message (typing «διαγραφη» in lower case is accepted)');
  t(!!(await docOf(page, 'members/u-pw')) && !!(await fbState(page)).accounts['u-pw'], '… and nothing is deleted');
  await page.fill('#del-pass', 'pass-word-123');
  // this time the auth listeners hear of the sign-out only AFTER delete() has resolved (the other order from F6)
  await queue(page, 'delete', { lateNotifyMs: 250 });
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.'), 'the right password deletes the account');
  await sleep(600);
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.', 300) && !(await hasText(page.locator('#account-app'), 'Συνδεθείτε ή δημιουργήστε', 300)),
    'the «deleted» message survives a sign-out notice that arrives after delete() resolved');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'the header shows «Σύνδεση»');
  const rc = (await calls(page, 'user.reauthenticateWithCredential')).pop();
  t(rc && rc.args[0].providerId === 'password' && rc.args[0].email === 'nikos@example.com' && rc.args[0].password === 'pass-word-123', 'via reauthenticateWithCredential(EmailAuthProvider.credential(e-mail, password))');
  t(!(await docOf(page, 'members/u-pw')) && !(await fbState(page)).accounts['u-pw'], 'application and account are gone');
});

/* ================================================================================== */
const DIR_DOCS = {
  'directory/d1': dirEntry({ name: 'Νίκος Κάραλης', gradYear: 2001, employer: 'ΔΕΗ', city: 'Πάτρα', linkedin: 'https://www.linkedin.com/in/karalis' }),
  'directory/d2': dirEntry({ name: 'Ελένη Σταύρου', gradYear: 2015, employer: 'CERN', city: 'Γενεύη', direction: 'Εφαρμοσμένη Φυσική', linkedin: 'javascript:alert(1)' }),
  'directory/d3': dirEntry({ name: 'Άννα Ζαφειρίου', gradYear: 2020, position: 'Αναλύτρια', city: 'Αθήνα' })
};
await scenario('G1', 'members page: signed out', { cfg: 'oidc' }, async (page) => {
  await page.goto(URL_('members/'));
  t(await hasText(page.locator('#members-app'), 'Μόνο για μέλη'), '«Μόνο για μέλη»');
  await page.click('#members-app [data-open="signin"]');
  t(await visible(page.locator('.modal-backdrop')), 'its «Σύνδεση» opens the dialog');
  t((await calls(page, 'fs.list')).length === 0 && (await calls(page, 'fs.get')).length === 0, 'nothing is read from Firestore');
});
await scenario('G2', 'members page: signed in, no application', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('members/'));
  t(await hasText(page.locator('#members-app'), 'Δεν έχετε κάνει ακόμα αίτηση μέλους'), '«Δεν έχετε κάνει ακόμα αίτηση μέλους»');
  t((await page.getAttribute('#members-app a.btn-primary', 'href')) === '../account/#apply', 'with a link to account/#apply');
  t((await calls(page, 'fs.list')).length === 0, 'the directory is not requested');
});
await scenario('G3', 'members page: pending and rejected applications', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ status: 'pending' }) } }) }, async (page) => {
  await page.goto(URL_('members/'));
  t(await hasText(page.locator('#members-app'), 'Η αίτησή σας εκκρεμεί'), 'pending: «Η αίτησή σας εκκρεμεί»');
  t((await calls(page, 'fs.list')).length === 0, 'the directory is not requested (the rules would refuse it)');
  await server(page, 'setDoc', 'members/' + MARIA.uid, member({ status: 'rejected' }));
  await page.reload();
  t(await hasText(page.locator('#members-app'), 'Η αίτησή σας δεν εγκρίθηκε'), 'rejected: «Η αίτησή σας δεν εγκρίθηκε»');
});
await scenario('G4', 'members page: an active member, the directory and its search', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: Object.assign({ ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active', duesYears: [YEAR], consentDirectory: true, gradYear: 2013 }) }, DIR_DOCS) }) }, async (page) => {
  await page.goto(URL_('members/'));
  const cards = page.locator('#dir-list .card');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length > 0), 'directory cards are rendered');
  const own = (await calls(page, 'fs.set')).find(x => x.args[0] === 'directory/' + MARIA.uid);
  t(own && dirProblems(own.args[1]).length === 0, 'an active member who asked to be listed is listed (within the directory rule)');
  t(await cards.count() === 4, 'four cards: three members + herself' + list([await cards.count()]));
  t(await hasText(page.locator('#members-app'), 'Η συνδρομή ' + YEAR + ' είναι τακτοποιημένη'), 'this year\'s dues show as paid');
  const names = await page.$$eval('#dir-list .card h3', hs => hs.map(h => h.textContent));
  t(js(names) === js(names.slice().sort((a, b) => a.localeCompare(b, 'el'))), 'cards are in Greek alphabetical order' + list(names));
  await page.fill('#dir-q', 'καραλης');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1) && /Κάραλης/.test(await text(cards)), '«καραλης» finds «Κάραλης» (accents and case ignored)');
  await page.fill('#dir-q', 'ΣΤΑΥΡΟΥ');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1) && /Σταύρου/.test(await text(cards)), '«ΣΤΑΥΡΟΥ» finds «Σταύρου»');
  await page.fill('#dir-q', 'γενευη');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1), 'the city is searched too («γενευη» → Γενεύη)');
  await page.fill('#dir-q', '2001');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1), 'and the graduation year («2001»)');
  await page.fill('#dir-q', 'ζζζζ');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 0 && !document.getElementById('dir-empty').hidden), 'no match: «Δεν βρέθηκαν μέλη.»');
  await page.fill('#dir-q', '');
  const links = await page.$$eval('#dir-list a.linkedin-btn', as => as.map(a => a.getAttribute('href')));
  t(links.includes('https://www.linkedin.com/in/karalis') && !links.some(h => /^javascript:/i.test(h)), 'only real linkedin.com URLs become links (a javascript: URL does not)' + list(links));
});
await scenario('G5', 'members page: an admin who is not a member sees the directory', { cfg: 'oidc',
  seed: signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής' }), { docs: DIR_DOCS }) }, async (page) => {
  await page.goto(URL_('members/'));
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 3), 'the three directory cards');
  t(await hasText(page.locator('#members-app'), 'Διαχειριστής'), 'with the «Διαχειριστής» badge');
});

/* ================================================================================== */
await scenario('H1', 'admin page: signed out / not an admin / an unverified admin address', { cfg: 'oidc',
  seed: { accounts: { 'u-x': acct('u-x', { email: 'someone@gmail.com', name: 'Κάποιος' }), 'u-ua': acct('u-ua', { email: ADMIN, name: 'Όχι ακόμα', verified: false, providers: ['password'], password: 'pass-word-123' }) } } }, async (page) => {
  await page.goto(URL_('admin/'));
  t(await hasText(page.locator('#admin-app'), 'Μόνο για διαχειριστές'), 'signed out: «Μόνο για διαχειριστές»');
  await sdkReady(page);
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { uid: 'u-x', email: 'someone@gmail.com' } });
  await page.click('#admin-app [data-open]');
  await page.click('.modal [data-provider="google"]');
  t(await hasText(page.locator('#admin-app'), 'Δεν έχετε πρόσβαση σε αυτή τη σελίδα.'), 'a non-admin: «Δεν έχετε πρόσβαση σε αυτή τη σελίδα.»');
  t((await calls(page, 'fs.onSnapshot')).every(x => x.kind !== 'col') && (await calls(page, 'fs.list')).length === 0, '… and the members list is never requested');
  await page.click('#acct-slot .acct-chip');
  await Promise.all([page.waitForEvent('load').catch(() => {}), page.click('#acct-menu [data-signout]')]);
  await openDialog(page);
  await page.fill('#auth-email', ADMIN);
  await page.fill('#auth-pass', 'pass-word-123');
  await page.click('.modal [data-submit]');
  t(await hasText(page.locator('#admin-app'), 'το e-mail δεν έχει επιβεβαιωθεί'), 'the admin address, unconfirmed: no access, «(το e-mail δεν έχει επιβεβαιωθεί)»');
});

const ADMIN_SEED = signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής' }), { docs: {
  'members/p1': member({ firstName: 'Νίκος', lastName: 'Κάραλης', email: 'nikos@example.com', status: 'pending', createdAt: ts(Date.now() - 2 * DAY), consentNewsletter: true }),
  'members/p2': member({ firstName: XSS, lastName: 'Σταύρου', email: 'eleni@example.com', city: '=HYPERLINK("http://evil.example","x")', employer: '+cmd', note: '@SUM(1)', status: 'pending', createdAt: ts(Date.now() - DAY) }),
  'members/a1': member({ firstName: 'Άννα', lastName: 'Ζαφειρίου', email: 'anna@example.com', status: 'active', duesYears: [YEAR - 1], consentJobs: true, createdAt: ts(Date.now() - 30 * DAY) }),
  'directory/a1': dirEntry({ name: 'Άννα Ζαφειρίου' })
} });
await scenario('H2', 'admin page: tiles, approve, dues, reject, CSV, hostile values', { cfg: 'oidc', seed: ADMIN_SEED }, async (page, env) => {
  await page.goto(URL_('admin/'));
  t(await waitFor(page, () => document.querySelectorAll('#admin-app .tile').length === 4), 'four summary tiles');
  const tiles = async () => page.$$eval('#admin-app .tile', ts => Object.fromEntries(ts.map(x => [x.querySelector('.l').textContent, +x.querySelector('.v').textContent])));
  let tl = await tiles();
  t(tl['Αιτήσεις συνολικά'] === 3 && tl['Σε αναμονή'] === 2 && tl['Ενεργά μέλη'] === 1 && tl['Συνδρομή ' + YEAR] === 0, 'tiles: 3 applications, 2 pending, 1 active, 0 paid this year' + list([js(tl)]));
  const ids = () => page.$$eval('#admin-app tr[data-id]', rs => rs.map(r => r.getAttribute('data-id')));
  t(js(await ids()) === js(['p2', 'p1']), 'the «Σε αναμονή» filter lists the two pending applications, newest first' + list(await ids()));
  t(!(await xssFired(page)), 'a first name that is an <img onerror> does not run');
  t(await hasText(page.locator('#admin-app tr[data-id="p2"]'), XSS), '… it is shown as text');
  t(await page.locator('#admin-app tr[data-id="p2"] img').count() === 0, '… and no <img> element is created');
  // approve
  const before = await docOf(page, 'members/p1');
  await page.click('#admin-app tr[data-id="p1"] [data-act="approve"]');
  const ap = (await waitCalls(page, 'fs.update', 1))[0];
  t(ap && ap.args[0] === 'members/p1' && ap.args[1].status === 'active' && ap.args[1].reviewedBy === ADMIN && isST(ap.args[1].reviewedAt), 'Έγκριση: update({status: active, reviewedBy: <admin e-mail>, reviewedAt: serverTimestamp()})' + list([js(ap && ap.args[1])]));
  const ap2 = adminUpdateProblems(before, (ap && ap.args[1]) || {}, ADMIN);
  t(ap2.length === 0, '… which the admin-update rule accepts' + list(ap2));
  t(await waitFor(page, () => !document.querySelector('#admin-app tr[data-id="p1"]')), 'the approved application leaves the pending list');
  tl = await tiles();
  t(tl['Ενεργά μέλη'] === 2 && tl['Σε αναμονή'] === 1, 'the tiles follow (2 active, 1 pending)');
  // dues
  await page.click('#admin-app [data-filter="active"]');
  t((await page.getAttribute('#admin-app [data-filter="active"]', 'aria-pressed')) === 'true', 'the «Ενεργά» filter is pressed');
  t(js((await ids()).sort()) === js(['a1', 'p1']), '… and lists the two active members');
  const duesBtn = page.locator('#admin-app tr[data-id="p1"] [data-act="dues"]');
  t((await text(duesBtn)) === 'Πλήρωσε ' + YEAR && (await duesBtn.getAttribute('aria-pressed')) === 'false', 'the dues button reads «Πλήρωσε ' + YEAR + '», not pressed');
  const b2 = await docOf(page, 'members/p1');
  await duesBtn.click();
  let du = (await waitCalls(page, 'fs.update', 2))[1];
  t(du && du.args[1].duesYears && du.args[1].duesYears.__fv === 'arrayUnion' && js(du.args[1].duesYears.els) === js([YEAR]), 'Πλήρωσε: duesYears arrayUnion(' + YEAR + ')' + list([js(du && du.args[1])]));
  t(adminUpdateProblems(b2, du.args[1], ADMIN).length === 0, '… within the admin-update rule' + list(adminUpdateProblems(b2, du.args[1], ADMIN)));
  t(await waitFor(page, y => { const b = document.querySelector('#admin-app tr[data-id="p1"] [data-act="dues"]'); return b && b.getAttribute('aria-pressed') === 'true' && b.textContent === '✓ Πλήρωσε ' + y; }, YEAR), 'it then reads «✓ Πλήρωσε ' + YEAR + '», pressed');
  t(js((await docOf(page, 'members/p1')).duesYears) === js([YEAR]), 'the year is stored');
  t((await tiles())['Συνδρομή ' + YEAR] === 1, 'the «Συνδρομή» tile counts it');
  await page.click('#admin-app tr[data-id="p1"] [data-act="dues"]');
  du = (await waitCalls(page, 'fs.update', 3))[2];
  t(du && du.args[1].duesYears && du.args[1].duesYears.__fv === 'arrayRemove' && js(du.args[1].duesYears.els) === js([YEAR]), 'pressing it again: arrayRemove(' + YEAR + ')');
  t(await waitFor(page, () => (JSON.parse(localStorage.getItem('__fbfake')).docs['members/p1'].duesYears || []).length === 0), 'the year is removed');
  // reject: cancelled, then accepted
  env.dialogPolicy = 'dismiss';
  const nUp = (await calls(page, 'fs.update')).length;
  await page.click('#admin-app tr[data-id="a1"] [data-act="reject"]');
  await sleep(200);
  t(env.dialogs.length === 1 && /Απόρριψη της αίτησης του\/της Άννα Ζαφειρίου/.test(env.dialogs[0].message), 'Απόρριψη asks for confirmation, naming the person');
  t((await calls(page, 'fs.update')).length === nUp, 'a cancelled confirmation changes nothing');
  env.dialogPolicy = 'accept';
  const b3 = await docOf(page, 'members/a1');
  await page.click('#admin-app tr[data-id="a1"] [data-act="reject"]');
  const rj = (await waitCalls(page, 'fs.update', nUp + 1))[nUp];
  t(rj && rj.args[0] === 'members/a1' && rj.args[1].status === 'rejected' && rj.args[1].reviewedBy === ADMIN, 'accepted: update({status: rejected, reviewedBy})');
  t(rj && adminUpdateProblems(b3, rj.args[1], ADMIN).length === 0, '… within the admin-update rule');
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['directory/a1']), '… and the directory entry is deleted');
  t((await calls(page, 'fs.delete')).some(x => x.args[0] === 'directory/a1'), '… with delete(directory/{uid})');
  // CSV of everything
  await page.click('#admin-app [data-filter="all"]');
  t(await waitFor(page, () => document.querySelectorAll('#admin-app tr[data-id]').length === 3), '«Όλες» lists all three');
  t(await hasText(page.locator('#admin-app [data-csv]'), 'Εξαγωγή CSV (3)'), 'the CSV button counts the rows it will export');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#admin-app [data-csv]')]);
  const buf = readFileSync(await dl.path());
  const csv = buf.toString('utf8');
  t(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, 'the CSV starts with a UTF-8 BOM (Excel reads the Greek correctly)');
  t(/^semfe-members-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), 'file name semfe-members-YYYY-MM-DD.csv' + list([dl.suggestedFilename()]));
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  t(lines[0].startsWith('"Όνομα";"Επώνυμο";"E-mail";"Τηλέφωνο";"Κατάσταση"'), 'Greek column headers, separated by ";" (what Excel expects in Greek settings)' + list([lines[0].slice(0, 80)]));
  t(lines.length === 4, 'a header and three rows, CRLF line ends' + list([lines.length]));
  t(csv.includes('"\'=HYPERLINK(""http://evil.example"",""x"")"'), 'a value starting with "=" is neutralised with a leading apostrophe (and quotes doubled)');
  t(csv.includes('"\'+cmd"') && csv.includes('"\'@SUM(1)"'), '… and so are values starting with "+" and "@"');
  t(csv.includes('"ναι"') && csv.includes('"όχι"'), 'booleans export as ναι / όχι');
  // delete an application
  const nDel = (await calls(page, 'fs.delete')).length;
  await page.click('#admin-app tr[data-id="p2"] [data-act="delete"]');
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['members/p2']), 'Διαγραφή (confirmed) deletes the application');
  const dels = (await calls(page, 'fs.delete')).slice(nDel).map(x => x.args[0]);
  t(js(dels) === js(['directory/p2', 'members/p2']), '… its directory entry first, then the application' + list(dels));
  t(!(await xssFired(page)), 'no injected script ran on the admin page');
});

/* ================================================================================== */
await scenario('I1', 'LinkedIn with the shipped settings (Cloud Function, not filled in yet): button hidden', { cfg: 'shipped' }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page);
  const provs = await page.$$eval('.modal [data-provider]', bs => bs.map(b => b.getAttribute('data-provider')));
  const shippedMode = (C.LINKEDIN || {}).mode;
  const filled = !String((C.LINKEDIN || {}).clientId + (C.LINKEDIN || {}).functionUrl).includes('PASTE_');
  if (shippedMode === 'oidc' || filled) note('config.js already has LinkedIn configured (mode ' + shippedMode + '); the hidden-button check does not apply');
  else {
    const others = (C.AUTH_PROVIDERS || []).filter(k => k !== 'linkedin');
    t(!provs.includes('linkedin') && js(provs) === js(others), 'without clientId/functionUrl the LinkedIn button is hidden, the others listed in config.js shown' + list(provs));
  }
});
/* The owner's choice (30 Sep 2026): Google, LinkedIn and e-mail, no Facebook.
   Everything a visitor reads names exactly the buttons the dialog shows. */
const SHIPPED_LI_FILLED = (C.LINKEDIN || {}).mode === 'oidc' || !String((C.LINKEDIN || {}).clientId + (C.LINKEDIN || {}).functionUrl).includes('PASTE_');
const SHIPPED = (C.AUTH_PROVIDERS || []).filter(k => ['google', 'facebook', 'linkedin'].includes(k) && (k !== 'linkedin' || SHIPPED_LI_FILLED));
const NAME = { google: 'Google', facebook: 'Facebook', linkedin: 'LinkedIn' };
const orList = n => n.length < 2 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' ή ' + n[n.length - 1];
await scenario('L1', 'the shipped providers: no Facebook anywhere, every list of ways in matches the buttons', { cfg: 'shipped',
  seed: { accounts: { 'u-eleni': acct('u-eleni', { email: 'eleni@example.com', name: 'Ελένη Σταύρου', providers: ['password'], password: 'right-password-1' }) } } }, async (page) => {
  t(!(C.AUTH_PROVIDERS || []).includes('facebook'), 'config.js does not list Facebook' + list(C.AUTH_PROVIDERS || []));
  const social = orList(SHIPPED.map(k => NAME[k]));
  await page.goto(URL_(''));
  await openDialog(page);
  const provs = await page.$$eval('.modal [data-provider]', bs => bs.map(b => b.getAttribute('data-provider')));
  t(js(provs) === js(SHIPPED), 'the dialog shows exactly the shipped buttons' + list(provs));
  t(!/Facebook/.test(await text(page.locator('.modal'))), 'the dialog never says Facebook');
  await page.fill('#auth-email', 'eleni@example.com');
  await page.fill('#auth-pass', 'wrong-password');
  await page.click('.modal [data-submit]');
  const want = 'Λάθος e-mail ή κωδικός.' + (social ? ' Αν δημιουργήσατε τον λογαριασμό σας με ' + social + ', συνδεθείτε με το αντίστοιχο κουμπί.' : '');
  t(await waitFor(page, w => ((document.querySelector('.modal [data-status]') || {}).textContent || '').includes(w), want), 'a wrong password names only the shipped buttons' + list([await status(page)]));
  await page.goto(URL_('account/'));
  const acctText = await text(page.locator('#account-app'));
  t(!!acctText && acctText.includes('Συνδεθείτε με ' + orList(SHIPPED.map(k => NAME[k]).concat('e-mail και κωδικό')) + '.'), 'the account page names the same ways in' + list([acctText && acctText.slice(0, 260)]));
  // the static pages: the build keeps a one-letter word with the next one, hence the no-break space after ή
  const nb = s => s.replace(/ ή /g, ' ή ');
  const all = nb(orList(SHIPPED.map(k => NAME[k]).concat('e-mail')));
  for (const [p, phrase] of [['privacy/', 'συνδεθείτε με ' + all + ' και κωδικό'], ['terms/', 'λογαριασμό με ' + all + ' και κωδικό'],
    ['support/', 'λογαριασμό με ' + all + ' και'], ['data-deletion/', social ? 'Αν συνδεθήκατε με ' + nb(social) : 'Διαγραφή με e-mail']]) {
    await page.goto(URL_(p));
    const main = await page.$eval('main', m => m.textContent.replace(/[ \t\r\n]+/g, ' '));
    t(!/Facebook/.test(main), p + ': no Facebook in the page');
    t(main.includes(phrase), p + ': says «' + phrase + '»');
    const desc = await page.$eval('meta[name="description"]', m => m.content);
    t(!/Facebook/.test(desc), p + ': no Facebook in the description');
  }
});
await scenario('I2', 'LinkedIn through the Cloud Function: authorize, callback, sign in', { cfg: 'function' }, async (page, env) => {
  let authUrl = null;
  env.onExternal = async (route, url) => {
    if (url.startsWith('https://www.linkedin.com/oauth/v2/authorization')) {
      authUrl = new URL(url);
      const back = authUrl.searchParams.get('redirect_uri') + '?code=li-code-42&state=' + encodeURIComponent(authUrl.searchParams.get('state'));
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>LinkedIn</title><script>location.replace(' + JSON.stringify(back) + ')</script>' });
      return true;
    }
    if (url === FN_URL) {
      const req = route.request();
      const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST' };
      if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return true; }
      env.fnRequests.push({ method: req.method(), body: req.postData(), headers: req.headers() });
      await route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ token: 'custom-token-xyz', isNew: true }) });
      return true;
    }
    return false;
  };
  await page.goto(URL_(''));
  await openDialog(page);
  t(await page.locator('.modal [data-provider="linkedin"]').count() === 1, 'with clientId and functionUrl filled in, the LinkedIn button is shown');
  await page.evaluate(() => window.__fb.queue('signInWithCustomToken', { resolve: { uid: 'u-li', email: 'lina@example.com', displayName: 'Λίνα Ιωάννου', claims: { li: true } } }));
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 10000 }).catch(() => {}), page.click('.modal [data-provider="linkedin"]')]);
  t(!!authUrl, 'the button goes to LinkedIn\'s authorization page (a full-page visit, no popup)');
  if (authUrl) {
    const q = authUrl.searchParams;
    t(q.get('response_type') === 'code' && q.get('client_id') === 'li-client-123', 'response_type=code, client_id from config.js');
    t(q.get('redirect_uri') === ORIGIN + SUB + 'auth/linkedin/', 'redirect_uri is <site>/semfealumni/auth/linkedin/' + list([q.get('redirect_uri')]));
    t(q.get('scope') === 'openid profile email', 'scope "openid profile email"');
    t(/^[0-9a-f]{32}$/.test(q.get('state') || ''), 'a random 128-bit state');
  }
  const fr = env.fnRequests[0];
  let body = null; try { body = JSON.parse(fr && fr.body); } catch {}
  t(fr && fr.method === 'POST' && body && body.code === 'li-code-42' && body.redirectUri === ORIGIN + SUB + 'auth/linkedin/', 'the callback page POSTs {code, redirectUri} to the Cloud Function' + list([fr && fr.body]));
  t(fr && !fr.headers.authorization, '… with no Authorization header when signing in (not linking)');
  const ct = await calls(page, 'auth.signInWithCustomToken');
  t(ct.length === 1 && ct[0].args[0] === 'custom-token-xyz', 'the returned token goes to signInWithCustomToken()');
  const u = new URL(page.url());
  t(u.pathname === SUB + 'account/' && u.hash === '#apply', 'a new LinkedIn member lands on account/#apply' + list([page.url()]));
  t(await waitFor(page, () => [...document.querySelectorAll('#account-app .linked .row')].some(r => /LinkedIn/.test(r.textContent) && r.querySelector('.badge.ok'))),
    '«Τρόποι σύνδεσης» shows LinkedIn as connected (read from the token\'s li claim)');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Λίνα Ιωάννου'), 'the header chip shows the LinkedIn name');
});
await scenario('I3', 'LinkedIn callback: a forged / stale state, and a cancelled login', { cfg: 'function' }, async (page) => {
  await page.goto(URL_('auth/linkedin/?code=abc&state=not-ours'));
  t(await hasText(page.locator('#li-app'), 'Ο σύνδεσμος σύνδεσης δεν ισχύει'), 'a callback with no saved state is refused');
  t(!/code=/.test(page.url()), 'the code is removed from the address bar');
  const saveState = (st, age) => page.evaluate(([s, a]) => sessionStorage.setItem('semfe:li', JSON.stringify({ state: s, mode: 'signin', returnTo: location.origin + '/semfealumni/', t: Date.now() - a })), [st, age]);
  await saveState('a'.repeat(32), 0);
  await page.goto(URL_('auth/linkedin/?code=abc&state=' + 'b'.repeat(32)));
  t(await hasText(page.locator('#li-app'), 'Ο σύνδεσμος σύνδεσης δεν ισχύει'), 'a state that differs from the one this browser saved is refused');
  t(await page.evaluate(() => sessionStorage.getItem('semfe:li') === null), '… and the saved state is single-use (removed)');
  await saveState('c'.repeat(32), 25 * 60 * 1000);
  await page.goto(URL_('auth/linkedin/?code=abc&state=' + 'c'.repeat(32)));
  t(await hasText(page.locator('#li-app'), 'Ο σύνδεσμος σύνδεσης δεν ισχύει'), 'a matching state older than 20 minutes is refused');
  t((await calls(page, 'auth.signInWithCustomToken')).length === 0 && !(await page.evaluate(() => JSON.parse(localStorage.getItem('__fbfake') || '{}').calls || [])).some(c => c.api === 'auth.signInWithCustomToken'),
    'nothing is signed in');
  await page.goto(URL_('auth/linkedin/?error=user_cancelled_login&error_description=The+user+cancelled'));
  t(await hasText(page.locator('#li-app'), 'Η σύνδεση ακυρώθηκε'), 'a cancelled LinkedIn login: «Η σύνδεση ακυρώθηκε»');
});

/* ================================================================================== */
await scenario('J', 'stored XSS on the account and members pages, and in the header', { cfg: 'oidc',
  seed: signedInSeed(acct('u-evil', { email: 'evil@example.com', name: XSS }), { docs: {
    'members/u-evil': member({ firstName: XSS, lastName: '"><svg onload=window.__xss=2>', email: 'evil@example.com', status: 'active', city: '<b>x</b>', note: '</textarea><img src=x onerror=window.__xss=3>',
      linkedin: 'https://www.linkedin.com/in/x" onmouseover="window.__xss=4', consentDirectory: false, adminNote: '<img src=x onerror=window.__xss=5>' }),
    'directory/d9': dirEntry({ name: XSS + ' Κακός', employer: '<img src=x onerror=window.__xss=6>', city: '<script>window.__xss=7</script>' })
  } }) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await visible(page.locator('#account-app [data-edit]')), 'the account page renders');
  await sleep(300);
  t(!(await xssFired(page)), 'account page: no injected script ran');
  t(await hasText(page.locator('#account-app .kv'), XSS), '… the hostile name is shown as text');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), XSS), 'the header chip shows the hostile display name as text');
  t(await page.locator('#account-app img, #acct-slot img').count() === 0, 'no <img> was created');
  await page.click('#account-app [data-edit]');
  await sleep(200);
  t(!(await xssFired(page)), 'the edit form: no injected script ran');
  t((await page.inputValue('#f-firstName')) === XSS && (await page.inputValue('#f-note')) === '</textarea><img src=x onerror=window.__xss=3>', '… the values round-trip exactly into the inputs');
  await page.click('#acct-slot .acct-chip');
  t(!(await xssFired(page)), 'the open account menu: no injected script ran');
  await page.goto(URL_('members/'));
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length >= 1), 'the members page renders the directory');
  await page.hover('#dir-list .card').catch(() => {});
  await sleep(300);
  t(!(await xssFired(page)), 'members page: no injected script ran');
  t(await page.locator('#members-app img, #members-app script, #members-app svg[onload]').count() === 0, '… and no injected element exists');
});

/* ================================================================================== */
await scenario('K1', 'account page: what is typed survives a redraw (approval while editing) and the reviewed name stays frozen', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, status: 'pending', city: 'Αθήνα', employer: '' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-edit]');
  await page.fill('#f-lastName', 'Παπαδοπούλου-Νέα');
  await page.fill('#f-city', 'Βόλος');
  await page.fill('#f-employer', 'Νέος Εργοδότης');
  await page.focus('#f-employer');
  await page.evaluate(() => { const e = document.getElementById('f-employer'); e.setSelectionRange(e.value.length, e.value.length); });
  // the admin approves while the member is typing: the listener redraws the page
  const cur = await docOf(page, 'members/' + MARIA.uid);
  await server(page, 'setDoc', 'members/' + MARIA.uid, Object.assign({}, cur, { status: 'active', reviewedBy: ADMIN, reviewedAt: ts(Date.now()) }));
  t(await hasText(page.locator('#account-app .profile-head'), 'Ενεργό μέλος'), 'the approval arrives while the form is open');
  t((await page.inputValue('#f-city')) === 'Βόλος' && (await page.inputValue('#f-employer')) === 'Νέος Εργοδότης', 'what was typed is still in the form after the redraw');
  t(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'f-employer', '… and the cursor is still in the same field');
  await page.keyboard.type(' ΑΕ');
  t((await page.inputValue('#f-employer')) === 'Νέος Εργοδότης ΑΕ', '… at the same place: typing continues at the end («Νέος Εργοδότης ΑΕ»)' + list([await page.inputValue('#f-employer')]));
  t((await page.inputValue('#f-lastName')) === 'Παπαδοπούλου' && await page.$eval('#f-lastName', e => e.readOnly), 'the now-reviewed surname shows the stored one and is read-only');
  await page.click('#account-app form[data-apply] [type=submit]');
  const up = (await waitCalls(page, 'fs.update', 1)).filter(x => x.args[0] === 'members/' + MARIA.uid).pop();
  t(up && up.args[1].lastName === 'Παπαδοπούλου' && up.args[1].city === 'Βόλος', 'saving sends the stored surname (the rules freeze it) and the new city');
  t(await waitFor(page, () => !document.querySelector('#account-app form[data-apply]')), 'the form closes after a successful save');
});

await scenario('K2', 'account page: an unconfirmed e-mail account keeps its typing when it confirms', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw2', { email: 'eleni@example.com', name: 'Ελένη Σταύρου', verified: false, providers: ['password'], password: 'pass-word-123' })) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.fill('#f-employer', 'CERN');
  await page.fill('#f-city', 'Γενεύη');
  await page.selectOption('#f-stage', 'graduate');
  await server(page, 'verify', 'u-pw2', true);
  await page.click('#account-app [data-verified]');
  t(await waitFor(page, () => !/Επιβεβαιώστε το e-mail σας/.test(document.getElementById('account-app').textContent)), 'the address is confirmed');
  t((await page.inputValue('#f-employer')) === 'CERN' && (await page.inputValue('#f-city')) === 'Γενεύη' && (await page.inputValue('#f-stage')) === 'graduate',
    'the fields typed before confirming are still filled in');
});

await scenario('K3', 'account page: a mistyped year is refused, not saved', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.fill('#f-firstName', 'Μαρία'); await page.fill('#f-lastName', 'Παπαδοπούλου');
  await page.selectOption('#f-stage', 'graduate');
  await page.setChecked('#f-acceptedPrivacy', true);
  await page.focus('#f-gradYear');
  await page.keyboard.type('20l3');          // a letter l for a one
  await page.click('#account-app form[data-apply] [type=submit]');
  t(await hasText(page.locator('#account-app [data-form-msg]'), 'Το έτος αποφοίτησης δεν φαίνεται σωστό'), '«20l3» in the graduation year: «Το έτος αποφοίτησης δεν φαίνεται σωστό.»');
  t((await calls(page, 'fs.set')).length === 0, '… and nothing is written');
});

await scenario('K4', 'account page: an active, listed member who unticks the directory in the edit form is removed', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: {
    ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, status: 'active', consentDirectory: true }),
    ['directory/' + MARIA.uid]: dirEntry({ name: 'Μαρία Παπαδοπούλου' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-edit]');
  t(await hasText(page.locator('#account-app form[data-apply]'), 'Θέλω να εμφανίζομαι στον κατάλογο μελών'), 'for an active member the box reads «Θέλω να εμφανίζομαι…»');
  await page.setChecked('#f-consentDirectory', false);
  await page.click('#account-app form[data-apply] [type=submit]');
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['directory/u-maria']), 'the directory entry is deleted');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-dir]'); return b && !b.checked; }), '… and the directory box shows unticked');
});

await scenario('K5', 'account page: a password account with LinkedIn (Cloud Function) is asked for its password to delete', { cfg: 'function',
  seed: signedInSeed(acct('u-pl', { email: 'giorgos@example.com', name: 'Γιώργος Νικολάου', providers: ['password'], password: 'pass-word-123', claims: { li: true }, lastSignIn: Date.now() - 3 * HOUR })) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await waitFor(page, () => /Συνδεδεμένο/.test((document.querySelector('#methods') || {}).textContent || '')), 'LinkedIn shows as connected');
  await page.click('#account-app [data-del-open]');
  t(await page.locator('#del-pass').isVisible(), 'the delete box asks for the password (the only way it can re-prove who it is)');
});

await scenario('K6', 'account page: another sign-in method can be linked only once the e-mail is confirmed', { cfg: 'oidc',
  seed: signedInSeed(acct('u-fb', { email: 'kostas@example.com', name: 'Κώστας Ιωάννου', verified: false, providers: ['facebook.com'] })) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await waitFor(page, () => !!document.querySelector('#account-app [data-link="google"]')), 'the Google «Σύνδεση» button is shown');
  t(await page.$eval('#account-app [data-link="google"]', b => b.disabled), '… disabled while the e-mail is unconfirmed');
  t(await hasText(page.locator('#link-needs-email'), 'χρειάζεται επιβεβαιωμένο e-mail'), '… with a line saying why, and how to confirm');
  await page.click('#account-app [data-send-verify]');
  t((await waitCalls(page, 'user.sendEmailVerification', 1)).length === 1, '«Στείλτε μου e-mail επιβεβαίωσης» sends it');
  await server(page, 'verify', 'u-fb', true);
  await page.click('#account-app [data-verified-li]');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-link="google"]'); return b && !b.disabled; }), 'once confirmed, the button is enabled');
  t(await page.evaluate(() => document.activeElement && document.activeElement.closest && !!document.activeElement.closest('#methods')), '… and keyboard focus stays in «Τρόποι σύνδεσης»');
});

await scenario('K7', 'account page: after deleting, signing in again on the same page shows the new account', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct({ lastSignIn: Date.now() - 60e3 }), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-del-open]');
  await page.fill('#del-confirm', 'ΔΙΑΓΡΑΦΗ');
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.'), 'the account is deleted');
  await page.click('#acct-slot [data-signin]');
  await sdkReady(page);
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { uid: 'u-new', email: 'new@example.com', displayName: 'Νέος Χρήστης', isNewUser: true } });
  await page.click('.modal [data-provider="google"]');
  t(await waitFor(page, () => !!document.querySelector('#account-app form[data-apply]')), 'signing in again shows the new account and its application form');
  t(!(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.', 200)), '… not the old «deleted» message');
});

await scenario('K8', 'header: «Αποσύνδεση» pressed before the sign-in service has loaded really signs out', { cfg: 'oidc', sdkDelayMs: 1500,
  seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.addInitScript(() => { try { localStorage.setItem('semfe:auth-hint', JSON.stringify({ n: 'Μαρία Παπαδοπούλου', p: '', e: 'maria@example.com' })); } catch (e) {} });
  await page.goto(URL_('blog/'));
  t(await visible(page.locator('#acct-slot .acct-chip'), 1000), 'the header shows the member from the saved hint at once');
  await page.click('#acct-slot .acct-chip');
  await page.click('#acct-slot [data-signout]');
  t(await visible(page.locator('#acct-slot [data-signin]'), 1000), 'the header shows «Σύνδεση» straight away');
  await sleep(2500);
  t((await calls(page, 'auth.signOut')).length === 1, 'once the SDK arrives, auth.signOut() is called');
  t(await visible(page.locator('#acct-slot [data-signin]')) && !(await page.locator('#acct-slot .acct-chip').count()), 'and the session does not come back');
});

await scenario('K9', '?signin while already signed in does not open the dialog', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('blog/?signin'));
  t(await visible(page.locator('#acct-slot .acct-chip')), 'the member is signed in');
  await sleep(400);
  t(!(await dialogOpen(page)), 'no sign-in dialog opens over them');
});

await scenario('K10', 'LinkedIn callback: an error text in a hand-made link is not shown', { cfg: 'function' }, async (page) => {
  await page.goto(URL_('auth/linkedin/?error=server_error&error_description=Ο+λογαριασμός+σας+ανεστάλη,+τηλεφωνήστε+στο+210'));
  t(await hasText(page.locator('#li-app'), 'Το LinkedIn δεν ολοκλήρωσε τη σύνδεση'), 'the generic failure message is shown');
  t(!(await hasText(page.locator('#li-app'), 'ανεστάλη', 200)), '… and not the text from the address');
});

await scenario('K11', 'admin page: keyboard focus stays on the same control after a redraw', { cfg: 'oidc', seed: ADMIN_SEED }, async (page) => {
  await page.goto(URL_('admin/'));
  await page.click('[data-filter="all"]');
  const row = page.locator('#admin-app tr[data-id]').first();
  const id = await row.getAttribute('data-id');
  await row.locator('[data-act="dues"]').focus();
  await page.keyboard.press('Enter');
  t(await waitFor(page, i => { const a = document.activeElement; const tr = a && a.closest && a.closest('tr'); return !!tr && tr.getAttribute('data-id') === i && a.getAttribute('data-act') === 'dues'; }, id),
    'after recording dues, focus is on the same row\'s dues button');
});

await scenario('K12', 'admin page: typing in the search box with an input method (a word composed over several steps) works', { cfg: 'oidc', seed: ADMIN_SEED }, async (page) => {
  await page.goto(URL_('admin/'));
  await page.click('[data-filter="all"]');
  await page.focus('#adm-q');
  const cdp = await page.context().newCDPSession(page);
  for (const t of ['κ', 'κα', 'καρ']) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
  await cdp.send('Input.insertText', { text: 'καρ' });
  await sleep(200);
  t((await page.inputValue('#adm-q')) === 'καρ', 'the search box holds exactly «καρ»' + list([await page.inputValue('#adm-q')]));
  t(await page.evaluate(() => document.activeElement && document.activeElement.id === 'adm-q'), '… and keeps focus');
});

await scenario('K13', 'account page: #delete (from the data-deletion page) scrolls to the delete panel', { cfg: 'oidc', viewport: { width: 390, height: 844 },
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active' }) } }) }, async (page) => {
  await page.goto(URL_('account/#delete'));
  t(await waitFor(page, () => { const h = document.querySelector('#delete h2'); if (!h) return false; const r = h.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }), 'the delete panel is on screen');
  t(await page.evaluate(() => document.activeElement && document.activeElement.closest && !!document.activeElement.closest('#delete')), '… with keyboard focus on its heading');
});

await scenario('K14', '?signin with a saved session and a slow SDK: a dialog the visitor already opened is left alone', { cfg: 'oidc', sdkDelayMs: 1500 }, async (page) => {
  await page.addInitScript(() => { try { localStorage.setItem('semfe:auth-hint', JSON.stringify({ n: 'Παλιός Χρήστης', p: '', e: 'old@example.com' })); } catch (e) {} });
  await page.goto(URL_('blog/?signin'));
  await page.click('#acct-slot .acct-chip').catch(() => {});
  // the hint says someone may be signed in, so nothing opens yet; the visitor opens the dialog from the account page link instead
  await page.evaluate(() => window.SemfeAuth.open('register'));
  await page.fill('#auth-first', 'Νίκος'); await page.fill('#auth-last', 'Δημητρίου');
  await page.fill('#auth-email', 'nikos@example.com');
  await sleep(2600);                                  // the SDK arrives: nobody is signed in
  t((await page.getAttribute('#tab-register', 'aria-pressed')) === 'true', 'the dialog is still on «Εγγραφή»');
  t((await page.inputValue('#auth-email')) === 'nikos@example.com' && (await page.inputValue('#auth-first')) === 'Νίκος', '… with everything typed still there');
});

await scenario('K15', '?signin when the sign-in service cannot load: the dialog says so', { cfg: 'oidc', sdkFail: true }, async (page) => {
  await page.goto(URL_('blog/?signin'));
  t(await visible(page.locator('.modal-backdrop')), 'the dialog opens');
  t(await hasText(page.locator('.modal [data-status]'), 'Δεν ήταν δυνατή η φόρτωση'), '… and explains that the service could not load');
  await page.click('.modal [data-provider="google"]');
  t(await hasText(page.locator('.modal [data-status]'), 'Δεν ήταν δυνατή η φόρτωση'), 'pressing a button repeats that, not «φορτώνει…»');
});

await scenario('K16', 'header: «Αποσύνδεση» before the SDK loads, then leaving the page at once, still signs out', { cfg: 'oidc', sdkDelayMs: 1200,
  seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('k16')) { sessionStorage.setItem('k16', '1'); localStorage.setItem('semfe:auth-hint', JSON.stringify({ n: 'Μαρία Παπαδοπούλου', p: '', e: 'maria@example.com' })); } } catch (e) {} });
  await page.goto(URL_('blog/'));
  await page.click('#acct-slot .acct-chip');
  await page.click('#acct-slot [data-signout]');
  await page.goto(URL_('governance/'));              // away before the SDK arrived
  await sleep(2500);
  t((await calls(page, 'auth.signOut')).length >= 1, 'the next page finishes the sign-out (auth.signOut() is called)');
  t(await visible(page.locator('#acct-slot [data-signin]')) && !(await page.locator('#acct-slot .acct-chip').count()), 'and the member is not shown as signed in');
  t(await page.evaluate(() => localStorage.getItem('semfe:signout') === null), 'the pending sign-out note is cleared');
});

await scenario('K17', 'account page: the half-filled delete box keeps the password across a redraw', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw3', { email: 'giorgos@example.com', name: 'Γιώργος Νικολάου', providers: ['password'], password: 'pass-word-123', lastSignIn: Date.now() - 3 * HOUR }),
    { docs: { 'members/u-pw3': member({ firstName: 'Γιώργος', lastName: 'Νικολάου', status: 'active' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-del-open]');
  await page.fill('#del-confirm', 'ΔΙΑΓΡΑΦΗ');
  await page.fill('#del-pass', 'pass-word-123');
  const cur = await docOf(page, 'members/u-pw3');
  await server(page, 'setDoc', 'members/u-pw3', Object.assign({}, cur, { duesYears: [YEAR] }));   // the admin records dues meanwhile
  t(await hasText(page.locator('#account-app'), 'Συνδρομές που έχουμε καταγράψει: ' + YEAR), 'the page redraws');
  t((await page.inputValue('#del-confirm')) === 'ΔΙΑΓΡΑΦΗ' && (await page.inputValue('#del-pass')) === 'pass-word-123', 'the delete box is still open with both fields filled in');
});

await scenario('K18', '?signin with a saved session and a slow SDK: a dialog the visitor opened and closed stays closed', { cfg: 'oidc', sdkDelayMs: 1500 }, async (page) => {
  await page.addInitScript(() => { try { localStorage.setItem('semfe:auth-hint', JSON.stringify({ n: 'Παλιός Χρήστης', p: '', e: 'old@example.com' })); } catch (e) {} });
  await page.goto(URL_('blog/?signin'));
  await page.evaluate(() => window.SemfeAuth.open('signin'));
  await page.keyboard.press('Escape');
  await sleep(2600);
  t(!(await dialogOpen(page)), 'the dialog does not come back by itself');
});

/* ================================================================================== */
/* Sign-in methods, merging two accounts, the registered-users list, the menu        */
/* ================================================================================== */
const FN_ACC = 'https://europe-west1-demo-semfe.cloudfunctions.net/accounts';
function accountsServer(env, handler) {
  env.accCalls = [];
  const prev = env.onExternal;
  env.onExternal = async (route, url) => {
    if (url !== FN_ACC) return prev ? prev(route, url) : false;
    const req = route.request();
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST' };
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return true; }
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
    env.accCalls.push({ body, auth: req.headers().authorization || '' });
    const out = await handler(body, env.accCalls.length);
    if (out === 'abort') { await route.abort(); return true; }
    await route.fulfill({ status: out.status || 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(out.json || {}) });
    return true;
  };
}
const ELENI = acct('u-eleni', { email: 'eleni@example.com', name: 'Ελένη Σταύρου', providers: ['password'], password: 'secret-pass-1' });
const OTHER_G = acct('u-g2', { email: 'eleni.g@gmail.com', name: 'Eleni S', providers: ['google.com'] });
const OTHER_P = acct('u-p2', { email: 'eleni.old@example.com', name: 'Ελένη Σ.', providers: ['password'], password: 'old-pass-9' });
const REPORT = { kept: 'u-eleni', removed: 'u-g2', application: 'moved', moved: ['google'], notMoved: [{ method: 'password', why: 'password', email: 'x' }], linkedin: false };

await scenario('M1', 'account page: one way in -> asked to add the others; setting a password', { cfg: 'shipped', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('account/'));
  const prompt = page.locator('#account-app .add-method');
  const others = SHIPPED.filter(k => k !== 'google').map(k => NAME[k]).concat('e-mail και κωδικό');
  t(await visible(prompt), 'a Google-only account is asked to add another way in');
  t(await hasText(prompt, 'Μπαίνετε μόνο με Google') && await hasText(prompt, orList(others)), '… naming what it has and what it can add' + list([await text(prompt)]));
  const pb = await page.$$eval('#account-app [data-prompt]', bs => bs.map(b => b.getAttribute('data-prompt')));
  t(js(pb) === js(SHIPPED.filter(k => k !== 'google').concat('password')), '… with a button for each' + list(pb));
  // the account menu learns the count from this page
  await page.click('#acct-slot .acct-chip');
  const menu = await page.$$eval('#acct-menu a, #acct-menu button', xs => xs.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  t(['Ο λογαριασμός μου', 'Η αίτηση μέλους μου', 'Περιοχή μελών', 'Αποσύνδεση'].every(w => menu.some(m => m.indexOf(w) === 0)), 'the account menu lists the quick links' + list(menu, 8));
  t(menu.some(m => /^Τρόποι σύνδεσης\s*Προσθήκη$/.test(m)), '… «Τρόποι σύνδεσης» says «Προσθήκη» while there is one way in' + list(menu, 8));
  t(!menu.some(m => /Διαχείριση/.test(m)), '… and no «Διαχείριση» for a member');
  await page.keyboard.press('Escape');
  // set a password
  await page.click('#account-app [data-prompt="password"]');
  t(await visible(page.locator('#pw-new')) && await page.evaluate(() => document.activeElement.id) === 'pw-new', '«Ορισμός κωδικού» opens the password form, focused');
  await page.fill('#pw-new', 'short'); await page.fill('#pw-new2', 'short');
  await page.click('#account-app [data-pw-form] [type=submit]');
  t(await hasText(page.locator('[data-pw-msg]'), 'τουλάχιστον 8'), 'a short password is refused');
  await page.fill('#pw-new', 'long-enough-1'); await page.fill('#pw-new2', 'long-enough-2');
  await page.click('#account-app [data-pw-form] [type=submit]');
  t(await hasText(page.locator('[data-pw-msg]'), 'δεν είναι ίδιοι'), 'two different passwords are refused');
  t((await calls(page, 'user.linkWithCredential')).length === 0, '… without calling Firebase');
  await page.fill('#pw-new2', 'long-enough-1');
  await page.click('#account-app [data-pw-form] [type=submit]');
  const lk = await waitCalls(page, 'user.linkWithCredential', 1);
  t(lk.length === 1 && lk[0].args[0].providerId === 'password' && lk[0].args[0].email === MARIA.email && lk[0].args[0].password === 'long-enough-1',
    'it links an e-mail + password credential for the account\'s own address' + list(lk.map(x => js(x.args[0]))));
  t(await waitFor(page, () => !!document.querySelector('#account-app [data-reset]')), '… «Ορισμός κωδικού» becomes «Αλλαγή κωδικού»');
  t(await waitFor(page, () => /Ορίστηκε κωδικός/.test(document.body.textContent)), '… and a toast confirms it');
  t(await hidden(prompt), 'with two ways in, the prompt goes');
});

await scenario('M2', 'account page: «Όχι τώρα» hides the prompt, also after a reload', { cfg: 'shipped', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await visible(page.locator('#account-app .add-method')), 'the prompt is there');
  await page.click('#account-app [data-prompt-hide]');
  t(await hidden(page.locator('#account-app .add-method')), '«Όχι τώρα» hides it');
  await page.reload();
  await waitFor(page, () => !!document.querySelector('#methods'));
  t(await page.locator('#account-app .add-method').count() === 0, '… and it stays hidden after a reload');
});

await scenario('M3', 'account page: connecting a Google that opens ANOTHER account -> merge the two', { cfg: 'shipped',
  seed: Object.assign(signedInSeed(ELENI), { accounts: { 'u-eleni': ELENI, 'u-g2': OTHER_G } }) }, async (page, env) => {
  accountsServer(env, body => body.action === 'mergeSelf' ? { json: { ok: true, report: REPORT } } : { status: 400, json: { error: 'bad-request' } });
  await page.goto(URL_('account/'));
  const cred = { providerId: 'google.com', signInMethod: 'google.com', email: 'eleni.g@gmail.com', idToken: 'g-id' };
  await queue(page, 'linkWithPopup', { provider: 'google.com', reject: { code: 'auth/credential-already-in-use', credential: cred } });
  await page.click('#account-app [data-link="google"]');
  const clash = page.locator('#account-app [data-clash]');
  t(await visible(clash) && await hasText(clash, 'Αυτό το Google ανοίγει ήδη άλλον λογαριασμό εδώ'), 'instead of a flat refusal, it says the Google opens another account here');
  t(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-merge-conflict')), '… focus on «Ένωση των δύο λογαριασμών»');
  await page.click('#account-app [data-merge-conflict]');
  t(await waitFor(page, () => /Οι δύο λογαριασμοί ενώθηκαν/.test(document.body.textContent)), 'after «Ένωση», a toast says the two were merged');
  const sc = await calls(page, 'semfe-merge.auth.signInWithCredential');
  t(sc.length === 1 && sc[0].args[0].idToken === 'g-id', 'it signs in to the other account with the SAVED Google credential, on a second app' + list(sc.map(x => js(x.args[0]))));
  t(env.accCalls.length === 1 && env.accCalls[0].body.action === 'mergeSelf' && env.accCalls[0].body.otherIdToken === 'fake-other-token.u-g2' && /^Bearer fake-id-token\.u-eleni/.test(env.accCalls[0].auth),
    'the server gets mergeSelf with THIS account\'s token and the other account\'s' + list(env.accCalls.map(c => js(c))));
  t((await fbState(page)).currentUid === 'u-eleni', 'the page stays signed in as the kept account');
  t((await calls(page, 'semfe-merge.auth.setPersistence')).some(c => c.args[0] === 'none'), 'the second app keeps nothing (persistence NONE)');
  t((await calls(page, 'semfe-merge.auth.signOut')).length >= 1, '… and signs out of the other account afterwards');
  t(await waitFor(page, () => /η αίτηση μέλους του άλλου λογαριασμού μεταφέρθηκε εδώ/i.test(document.body.textContent) && /Ο κωδικός του άλλου λογαριασμού δεν μεταφέρεται/.test(document.body.textContent)),
    'the toast says what moved and what did not');
  t(await page.locator('#account-app [data-clash]').count() === 0, 'the conflict box is gone');
});

await scenario('M4', 'account page: «Έχετε και δεύτερο λογαριασμό;» with e-mail + password', { cfg: 'shipped',
  seed: Object.assign(signedInSeed(ELENI), { accounts: { 'u-eleni': ELENI, 'u-p2': OTHER_P } }) }, async (page, env) => {
  accountsServer(env, () => ({ json: { ok: true, report: Object.assign({}, REPORT, { removed: 'u-p2', application: 'merged', moved: [] }) } }));
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-merge-open]');
  t(await visible(page.locator('#merge')) && await page.evaluate(() => document.activeElement === document.querySelector('#merge h3')), 'the merge box opens, focus on its heading');
  const withBtns = await page.$$eval('#merge [data-merge-with]', bs => bs.map(b => b.getAttribute('data-merge-with')));
  t(js(withBtns) === js(SHIPPED), '… it offers the other account\'s ways in' + list(withBtns));
  await page.fill('#merge-email', 'eleni.old@example.com'); await page.fill('#merge-pass', 'wrong');
  await page.click('#merge [data-merge-pw] [type=submit]');
  t(await hasText(page.locator('[data-merge-msg]'), 'Λάθος e-mail ή κωδικός'), 'a wrong password for the other account is refused');
  t(env.accCalls.length === 0, '… and the server is not asked');
  await page.fill('#merge-email', 'eleni@example.com'); await page.fill('#merge-pass', 'secret-pass-1');
  await page.click('#merge [data-merge-pw] [type=submit]');
  t(await hasText(page.locator('[data-merge-msg]'), 'ίδιο λογαριασμό'), 'signing in to THIS account again is caught («ίδιο λογαριασμό»)');
  t(env.accCalls.length === 0, '… and the server is not asked');
  await page.fill('#merge-email', 'eleni.old@example.com'); await page.fill('#merge-pass', 'old-pass-9');
  await page.click('#merge [data-merge-pw] [type=submit]');
  t(await waitFor(page, () => /Οι δύο λογαριασμοί ενώθηκαν/.test(document.body.textContent) && /Οι δύο αιτήσεις μέλους έγιναν μία/.test(document.body.textContent)), 'the right one merges; the toast says the two applications became one');
  t(env.accCalls.length === 1 && env.accCalls[0].body.otherIdToken === 'fake-other-token.u-p2', 'mergeSelf with the other account\'s token');
  t(await page.locator('#merge').count() === 0, 'the merge box closes');
});

await scenario('M5', 'account page: the merge service not deployed yet -> a clear message, nothing breaks', { cfg: 'shipped',
  seed: Object.assign(signedInSeed(ELENI), { accounts: { 'u-eleni': ELENI, 'u-p2': OTHER_P } }) }, async (page, env) => {
  accountsServer(env, () => 'abort');
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-merge-open]');
  await page.fill('#merge-email', 'eleni.old@example.com'); await page.fill('#merge-pass', 'old-pass-9');
  await page.click('#merge [data-merge-pw] [type=submit]');
  t(await hasText(page.locator('[data-merge-msg]'), 'δεν είναι διαθέσιμη'), 'it says the service is not available right now');
  t((await fbState(page)).currentUid === 'u-eleni' && !!(await fbState(page)).accounts['u-p2'], 'nothing changed: same session, the other account untouched');
});

const USERS = [
  { uid: 'u-admin', email: ADMIN, emailVerified: true, name: 'Διαχειριστής', methods: ['google'], created: Date.now() - 90 * DAY, lastSeen: Date.now() - HOUR, application: null },
  { uid: 'u-a', email: 'anna@gmail.com', emailVerified: true, name: 'Anna Z', methods: ['google'], created: Date.now() - 60 * DAY, lastSeen: Date.now() - 5 * DAY,
    application: { status: 'active', firstName: 'Άννα', lastName: 'Ζαφειρίου', email: 'anna@example.com', gradYear: 2010, duesYears: [YEAR], createdAt: Date.now() - 50 * DAY } },
  { uid: 'u-b', email: 'anna.z@work.gr', emailVerified: true, name: 'Άννα Ζαφειρίου', methods: ['linkedin'], created: Date.now() - 3 * DAY, lastSeen: Date.now() - 2 * DAY, application: null },
  { uid: 'u-c', email: 'kostas@example.com', emailVerified: false, name: '', methods: ['password'], created: Date.now() - 1 * DAY, lastSeen: null, application: null }
];
await scenario('N1', 'admin page: every registered account, duplicates marked, merge two, delete one', { cfg: 'oidc', seed: ADMIN_SEED }, async (page, env) => {
  let people = USERS.slice();
  accountsServer(env, body => {
    if (body.action === 'list') return { json: { ok: true, accounts: people } };
    if (body.action === 'merge') { people = people.filter(u => u.uid !== body.drop); return { json: { ok: true, report: { application: 'kept', moved: ['linkedin'], notMoved: [] } } }; }
    if (body.action === 'delete') { people = people.filter(u => u.uid !== body.uid); return { json: { ok: true } }; }
    return { status: 400, json: { error: 'bad-request' } };
  });
  await page.goto(URL_('admin/'));
  const rows = () => page.$$eval('#users tr[data-uid]', rs => rs.map(r => r.getAttribute('data-uid')));
  t(await waitFor(page, () => document.querySelectorAll('#users tr[data-uid]').length === 4), 'all four accounts are listed, with or without an application');
  t(js(await rows()) === js(['u-c', 'u-b', 'u-a', 'u-admin']), '… newest first' + list(await rows()));
  t(env.accCalls[0].body.action === 'list' && /^Bearer fake-id-token\.u-admin/.test(env.accCalls[0].auth), 'the list comes from the accounts function, with the admin\'s token');
  const dups = await page.$$eval('#users tr[data-uid]', rs => rs.filter(r => /Πιθανό διπλό/.test(r.textContent)).map(r => r.getAttribute('data-uid')));
  t(js(dups.sort()) === js(['u-a', 'u-b']), 'the two «Άννα Ζαφειρίου» accounts are marked «Πιθανό διπλό» (the same name on the application and the sign-in)' + list(dups));
  t(await hasText(page.locator('#users [data-ucount]'), '4 από 4 λογαριασμούς · 3 χωρίς αίτηση · 2 πιθανά διπλά'), 'the count line' + list([await text(page.locator('#users [data-ucount]'))]));
  t(await page.locator('#users tr[data-uid="u-admin"] [data-udel]').count() === 0 && await hasText(page.locator('#users tr[data-uid="u-admin"]'), 'εσείς'), 'the admin\'s own row: «εσείς», no Delete');
  t(await hasText(page.locator('#users tr[data-uid="u-a"]'), 'στην αίτηση: anna@example.com'), 'an application e-mail that differs from the sign-in address is shown too');
  await page.click('#users [data-ufilter="noapp"]');
  t(js(await rows()) === js(['u-c', 'u-b', 'u-admin']), '«Χωρίς αίτηση» lists the accounts that never applied' + list(await rows()));
  await page.click('#users [data-ufilter="dup"]');
  t(js(await rows()) === js(['u-a', 'u-b']), '«Πιθανά διπλά» lists the pair, side by side' + list(await rows()));
  await page.click('#users [data-ufilter="all"]');
  await page.fill('#usr-q', 'zafeir');
  t((await rows()).length === 0, 'search by a Latin spelling finds nothing (names are matched as written)');
  await page.fill('#usr-q', 'ζαφειριου');
  t(js((await rows()).sort()) === js(['u-a', 'u-b']), 'search ignores accents and case' + list(await rows()));
  await page.fill('#usr-q', '');
  t(await page.$eval('#users [data-umerge]', b => b.disabled), '«Ένωση επιλεγμένων» is off until two are ticked');
  await page.check('#users [data-pick="u-c"]'); await page.check('#users [data-pick="u-a"]'); await page.check('#users [data-pick="u-b"]');
  const picked = await page.$$eval('#users [data-pick]:checked', cs => cs.map(c => c.getAttribute('data-pick')));
  t(js(picked.sort()) === js(['u-a', 'u-b']), 'a third tick drops the oldest one: two at a time' + list(picked));
  t(!(await page.$eval('#users [data-umerge]', b => b.disabled)) && await hasText(page.locator('#users [data-umerge]'), '(2)'), '… and «Ένωση επιλεγμένων (2)» is on');
  await page.click('#users [data-umerge]');
  t(await visible(page.locator('#umerge')), 'the merge box opens');
  t(await page.$eval('#umerge input[name="keep"]:checked', i => i.value) === 'u-a', '… keeping, by default, the account with the active application');
  t(await hasText(page.locator('#umerge'), 'αίτηση: Ενεργό μέλος, συνδρομές ' + YEAR) && await hasText(page.locator('#umerge'), 'χωρίς αίτηση'), '… each described (application, dues)');
  env.dialogs.length = 0;
  await page.click('#umerge [data-umerge-go]');
  t(env.dialogs.length === 1 && /μένει ο λογαριασμός «Άννα Ζαφειρίου» \(anna@gmail\.com\).*διαγράφεται ο «Άννα Ζαφειρίου» \(anna\.z@work\.gr\)/s.test(env.dialogs[0].message), 'a confirmation names which stays and which goes' + list(env.dialogs.map(d => d.message)));
  t(await waitFor(page, () => document.querySelectorAll('#users tr[data-uid]').length === 3), 'after the merge the list is read again: three accounts');
  const mc = env.accCalls.filter(c => c.body.action === 'merge');
  t(mc.length === 1 && mc[0].body.keep === 'u-a' && mc[0].body.drop === 'u-b', 'the server was asked to keep u-a and remove u-b' + list(mc.map(c => js(c.body))));
  t(await hasText(page.locator('#users [data-umsg]'), 'Ενώθηκαν') && await hasText(page.locator('#users [data-umsg]'), 'Νέοι τρόποι σύνδεσης: LinkedIn'), 'a note says what happened');
  env.dialogs.length = 0;
  await page.click('#users tr[data-uid="u-c"] [data-udel]');
  t(env.dialogs.length === 1 && /Οριστική διαγραφή του λογαριασμού «\(χωρίς όνομα\)» \(kostas@example\.com\)/.test(env.dialogs[0].message), 'Delete asks first, naming the account');
  t(await waitFor(page, () => document.querySelectorAll('#users tr[data-uid]').length === 2), '… and then removes it');
  t(env.accCalls.some(c => c.body.action === 'delete' && c.body.uid === 'u-c'), 'delete {uid: u-c} was sent');
  // the menu learns the pending count from this page
  await page.click('#acct-slot .acct-chip');
  const adm = await page.$$eval('#acct-menu a[href$="admin/"]', as => as.map(a => a.textContent.replace(/\s+/g, ' ').trim()));
  t(adm.length === 1 && /^Διαχείριση\s*2$/.test(adm[0]), 'the admin\'s menu: «Διαχείριση» with the 2 pending applications' + list(adm));
});

await scenario('N2', 'admin page: the accounts function not deployed yet -> instructions, the applications still work', { cfg: 'oidc', seed: ADMIN_SEED }, async (page, env) => {
  accountsServer(env, () => 'abort');
  await page.goto(URL_('admin/'));
  t(await waitFor(page, () => document.querySelectorAll('#admin-app tr[data-id]').length === 2), 'the applications load as before');
  t(await hasText(page.locator('#users'), 'Η λίστα χρηστών δεν είναι διαθέσιμη ακόμα') && await hasText(page.locator('#users'), 'firebase deploy --only functions --project semfe-alumni'), 'the users list says what to deploy');
  t(await page.$eval('#users [data-umerge]', b => b.disabled), 'merging is off');
});

await scenario('L2', 'LinkedIn: connecting one that opens another account -> offer, then merge', { cfg: 'function', seed: signedInSeed(mariaAcct()) }, async (page, env) => {
  let authUrls = [], fnBodies = [];
  env.onExternal = async (route, url) => {
    if (url.startsWith('https://www.linkedin.com/oauth/v2/authorization')) {
      const u = new URL(url); authUrls.push(u);
      const back = u.searchParams.get('redirect_uri') + '?code=li-code-' + authUrls.length + '&state=' + encodeURIComponent(u.searchParams.get('state'));
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>LinkedIn</title><script>location.replace(' + JSON.stringify(back) + ')</script>' });
      return true;
    }
    if (url === FN_URL) {
      const req = route.request();
      const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST' };
      if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return true; }
      const b = JSON.parse(req.postData() || '{}'); fnBodies.push({ b, auth: req.headers().authorization || '' });
      if (!b.merge) { await route.fulfill({ status: 409, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ error: 'credential-already-in-use' }) }); return true; }
      await route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors),
        body: JSON.stringify({ token: 'tok-merged', isNew: false, linked: true, merged: { application: 'moved', moved: ['linkedin'], notMoved: [] } }) });
      return true;
    }
    return false;
  };
  await page.goto(URL_('account/'));
  await queue(page, 'signInWithCustomToken', { resolve: { uid: MARIA.uid } });
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'auth/linkedin/', { timeout: 10000 }).catch(() => {}), page.click('#account-app [data-link="linkedin"]')]);
  const offer = page.locator('#li-app [data-li-merge]');
  t(await visible(offer), 'LinkedIn opens another account: the return page offers «Ένωση των δύο λογαριασμών»');
  t(fnBodies.length === 1 && !fnBodies[0].b.merge && /^Bearer /.test(fnBodies[0].auth), '… after a normal connect attempt (no merge asked)');
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 10000 }).catch(() => {}), offer.click()]);
  t(authUrls.length === 2, 'the offer goes back to LinkedIn once more');
  t(fnBodies.length === 2 && fnBodies[1].b.merge === true && /^Bearer /.test(fnBodies[1].auth), '… and the function is asked, with the account\'s token, to MERGE' + list(fnBodies.map(x => js(x.b))));
  t(new URL(page.url()).hash === '#methods', 'it lands on account/#methods');
  t(await waitFor(page, () => /Οι δύο λογαριασμοί ενώθηκαν/.test(document.body.textContent)), 'a toast says the two accounts were merged');
});

await scenario('N3', 'admin page: approving with the keyboard never lands on the next applicant\'s «Έγκριση»', { cfg: 'oidc', seed: ADMIN_SEED }, async (page) => {
  await page.goto(URL_('admin/'));
  t(await waitFor(page, () => document.querySelectorAll('#admin-app tr[data-id]').length === 2), 'two pending applications');
  const first = await page.$eval('#admin-app tr[data-id]', r => r.getAttribute('data-id'));
  await page.focus('#admin-app tr[data-id="' + first + '"] [data-act="approve"]');
  await page.keyboard.press('Enter');
  t(await waitFor(page, id => !document.querySelector('#admin-app tr[data-id="' + id + '"]'), first), 'the approved one leaves the «Σε αναμονή» list');
  const where = await page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('data-filter') !== null ? 'filter:' + a.getAttribute('data-filter') : a.getAttribute('data-act') || a.tagName) : null; });
  t(where === 'filter:pending', 'the focus goes to the list\'s filter, not to the next row (' + where + ')');
  const n = (await calls(page, 'fs.update')).length;
  await page.keyboard.press('Enter');
  await sleep(300);
  t((await calls(page, 'fs.update')).length === n, 'so a second Enter approves nobody else');
  t(await waitFor(page, () => document.querySelectorAll('#admin-app tr[data-id]').length === 1), '… the other application is still pending');
});

/* ======================= Q. the Σχόλια page and the admin inbox ======================= */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const JPG_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const TICKET_RE = /^SEMFE-\d{6}-[A-Z0-9]{4}$/;
const fbDocOf = (uid, o) => Object.assign({ ticket: 'SEMFE-260101-AAAA', uid, email: 'x@example.com', emailVerified: true, name: 'Όνομα', kind: 'problem',
  message: 'Κάτι δεν λειτουργεί.', page: '', shots: 0, ua: 'UA', status: 'open', createdAt: ts(Date.now() - DAY) }, o);

await scenario('Q1', 'Σχόλια page signed out: asks to sign in, points to Επικοινωνία', { cfg: 'oidc' }, async (page) => {
  await page.goto(URL_('feedback/'));
  const app = page.locator('#feedback-app');
  t(await hasText(app, 'Συνδεθείτε για να μας γράψετε'), 'a signed-out visitor is asked to sign in');
  t(await page.locator('#feedback-app a[href$="contact/"]').count() === 1, '… with a link to Επικοινωνία for people without an account');
  await page.click('#feedback-app [data-open-signin]');
  t(await visible(page.locator('.modal-backdrop')), '«Σύνδεση ή εγγραφή» opens the sign-in dialog');
});

await scenario('Q2', 'Σχόλια page: a member sends a message with a screenshot and gets a ticket number', { cfg: 'oidc',
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name })) }, async (page) => {
  await page.goto(URL_('feedback/?from=' + encodeURIComponent(SUB + 'account/')));
  t(await visible(page.locator('#fb-message')), 'the form is shown');
  t((await page.inputValue('#fb-page')) === ORIGIN + SUB + 'account/', 'the page it is about is filled in from ?from=');
  t(await hasText(page.locator('#feedback-app .fb-mail'), 'Θα σας απαντήσουμε στο ' + MARIA.email), 'it says the answer goes to the account e-mail');
  await page.click('#feedback-app [data-send]');
  t(await hasText(page.locator('#feedback-app [data-fb-msg]'), 'Γράψτε πρώτα το μήνυμά σας') && (await page.getAttribute('#fb-message', 'aria-invalid')) === 'true', 'an empty message is refused, with a reason');
  t((await calls(page, 'fs.batch')).length === 0 && (await calls(page, 'fs.set')).length === 0, '… and nothing is written');
  await page.check('#feedback-app input[name=kind][value=idea]');
  await page.fill('#fb-message', 'Θα ήταν χρήσιμο <b>ένα</b> ημερολόγιο εκδηλώσεων.\nΚαι στο κινητό.');
  await page.setInputFiles('#feedback-app [data-files]', [{ name: 'one.png', mimeType: 'image/png', buffer: PNG }, { name: 'two.png', mimeType: 'image/png', buffer: PNG }]);
  t(await waitFor(page, () => document.querySelectorAll('#feedback-app .fb-thumb').length === 2), 'two screenshots become two thumbnails');
  await page.click('#feedback-app [data-remove="1"]');
  t(await waitFor(page, () => document.querySelectorAll('#feedback-app .fb-thumb').length === 1), '… one can be removed');
  if (process.env.SHOTS) {
    await page.screenshot({ path: path.join(process.env.SHOTS, 'fb-form.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(200);
    await page.screenshot({ path: path.join(process.env.SHOTS, 'fb-form-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await page.click('#feedback-app a[data-view="0"]');
  t(await visible(page.locator('.lightbox')), 'a thumbnail opens in the photo viewer (a data: address cannot be opened in a tab)');
  await page.keyboard.press('Escape');
  t(await hidden(page.locator('.lightbox')), '… and Escape closes it');
  await page.click('#feedback-app [data-send]');
  const batches = await waitCalls(page, 'fs.batch', 1);
  const ops = (batches[0] || { args: [[]] }).args[0] || [];
  const w = ops[0] || {}, wpath = String(w.path || ''), d = w.data || {};
  const tk = wpath.split('/')[1] || '';
  t(w.op === 'set' && wpath.startsWith('feedback/') && TICKET_RE.test(tk), 'one batch: the ticket at feedback/<ticket> (' + wpath + ')');
  const shotOps = ops.slice(1);
  t(shotOps.length === 1 && shotOps[0].op === 'set' && shotOps[0].path === 'feedback/' + tk + '/shots/1' && js(Object.keys(shotOps[0].data)) === js(['url']),
    '… and its screenshot beside it, at feedback/<ticket>/shots/1 (not inside the ticket: trigger events carry at most 512 KB)');
  t(d.ticket === tk && d.uid === MARIA.uid && d.email === MARIA.email && d.emailVerified === true && d.kind === 'idea' && d.status === 'open', 'as the member, with their sign-in e-mail, the kind, status open');
  t(js(Object.keys(d).sort()) === js(R.fbKeys.slice().sort()), 'exactly the fields firestore.rules fbKeys() allows' + list([js(Object.keys(d).sort())]));
  t(d.createdAt && d.createdAt.__fv === 'serverTimestamp', 'createdAt is the server time (the rules demand request.time)');
  const shotUrl = (shotOps[0] && shotOps[0].data && shotOps[0].data.url) || '';
  t(d.shots === 1 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(shotUrl) && shotUrl.length <= 170 * 1024,
    'the ticket counts 1 screenshot, sent as a JPEG data URL under 170 KB');
  t(d.page === ORIGIN + SUB + 'account/' && d.message.startsWith('Θα ήταν χρήσιμο <b>ένα</b>'), 'the page and the message as typed');
  t((await calls(page, 'user.getIdTokenResult')).some(c => c.args[0] === true), 'the e-mail fields come from a fresh sign-in token (what the rules compare against)');
  t(await hasText(page.locator('#feedback-app .fb-thanks'), 'Ευχαριστούμε') && (await text(page.locator('#feedback-app .fb-ticket code'))) === tk, 'the thank-you panel shows the ticket number');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'fb-thanks.png'), fullPage: true });
  t(await hasText(page.locator('#feedback-app .fb-thanks'), 'Θα λάβετε επιβεβαίωση με αυτόν τον αριθμό στο ' + MARIA.email), '… and where the confirmation will go');
  t(await page.evaluate(() => document.activeElement && document.activeElement.id === 'fb-thanks-h'), '… and takes the focus');
  t(await hasText(page.locator('#feedback-app [data-mine]'), tk) && await hasText(page.locator('#feedback-app [data-mine]'), 'Σε εξέταση'), '«Τα μηνύματά μου» lists it, «Σε εξέταση»');
  t((await calls(page, 'fs.list')).some(c => c.args[0] === 'feedback' && js(c.args[1]) === js({ where: [['uid', MARIA.uid]] })), 'the list asks only for the member\'s own (where uid ==, as the rules require)');
  t(!(await xssFired(page)), 'nothing typed runs as markup');
  await page.click('#feedback-app [data-new]');
  t(await visible(page.locator('#fb-message')) && (await page.inputValue('#fb-message')) === '' && (await page.locator('#feedback-app .fb-thumb').count()) === 0, '«Νέο μήνυμα»: an empty form again');
});

/* a plain PNG of w x h (grey stripes), made here so no image file is needed */
function makePng(w, h) {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (y >> 4) % 2 ? 60 : 200; }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
await scenario('Q8', 'Σχόλια page: a tall "long screenshot" is cut into readable pieces; a paste anywhere on the page is taken', { cfg: 'oidc',
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name })) }, async (page) => {
  await page.goto(URL_('feedback/'));
  await visible(page.locator('#fb-message'));
  await page.setInputFiles('#feedback-app [data-files]', [{ name: 'long.png', mimeType: 'image/png', buffer: makePng(300, 1500) }]);
  t(await waitFor(page, () => document.querySelectorAll('#feedback-app .fb-thumb').length === 3), 'a 300x1500 screenshot becomes 3 pieces, each about twice as tall as wide');
  const alts = await page.$$eval('#feedback-app .fb-thumb img', ims => ims.map(i => i.alt));
  t(alts.length === 3 && /\(1\/3\)/.test(alts[0]) && /\(3\/3\)/.test(alts[2]), 'named «long.png (1/3)» … «(3/3)»' + list(alts));
  const dims = await page.$$eval('#feedback-app .fb-thumb img', ims => ims.map(i => [i.naturalWidth, i.naturalHeight]));
  t(dims.every(([w, h]) => w === 300 && h <= 600), 'each piece keeps the full width (300 px), not a thin strip' + list(dims.map(d => d.join('x'))));
  await page.setInputFiles('#feedback-app [data-files]', [{ name: 'long2.png', mimeType: 'image/png', buffer: makePng(300, 3000) }]);
  t(await waitFor(page, () => document.querySelectorAll('#feedback-app .fb-thumb').length === 5), 'a second tall one takes only the 2 places left (5 in all)');
  await page.click('#feedback-app [data-remove="4"]');
  await page.click('#feedback-app [data-remove="3"]');
  // clicking the drop zone leaves the focus on the page; a paste there still counts
  await page.click('#feedback-app [data-drop] > p', { position: { x: 5, y: 5 } });
  const png = makePng(40, 30).toString('base64');
  await page.evaluate(b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png);
  t(await waitFor(page, () => [...document.querySelectorAll('#feedback-app .fb-thumb img')].some(i => /pasted\.png/.test(i.alt))), 'an image pasted with the focus outside the form is added');
  // a file dropped next to the zone must not make the browser leave the page
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
    const e = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.querySelector('.site-footer').dispatchEvent(e);
    return e.defaultPrevented;
  });
  t(prevented, 'a file dropped outside the zone is caught (the typed message is not lost)');
});

await scenario('Q3', 'Σχόλια page: the member\'s messages, with the answers; nobody else\'s', { cfg: 'oidc',
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name }), { docs: {
    'feedback/SEMFE-260901-AAAA': fbDocOf(MARIA.uid, { ticket: 'SEMFE-260901-AAAA', createdAt: ts(Date.now() - 20 * DAY), status: 'closed', resolution: 'Διορθώθηκε. ' + XSS, resolutionUrl: 'https://www.stouras.com/semfealumni/', resolvedAt: ts(Date.now() - 19 * DAY) }),
    'feedback/SEMFE-260920-BBBB': fbDocOf(MARIA.uid, { ticket: 'SEMFE-260920-BBBB', createdAt: ts(Date.now() - 2 * DAY), message: 'Δεύτερο μήνυμα' }),
    'feedback/SEMFE-260921-CCCC': fbDocOf('someone-else', { ticket: 'SEMFE-260921-CCCC', message: 'ΞΕΝΟ' })
  } }) }, async (page) => {
  await page.goto(URL_('feedback/'));
  t(await waitFor(page, () => document.querySelectorAll('#feedback-app .fb-item').length === 2), 'two messages listed');
  const order = await page.$$eval('#feedback-app .fb-item code', cs => cs.map(c => c.textContent));
  t(js(order) === js(['SEMFE-260920-BBBB', 'SEMFE-260901-AAAA']), 'newest first' + list(order));
  t(!(await hasText(page.locator('#feedback-app [data-mine]'), 'ΞΕΝΟ', 300)), 'another member\'s message is not there');
  const done = page.locator('#feedback-app .fb-item').nth(1);
  t(await hasText(done, 'Ολοκληρώθηκε') && await hasText(done, 'Διορθώθηκε.') && await done.locator('a[href="https://www.stouras.com/semfealumni/"]').count() === 1, 'a closed one shows «Ολοκληρώθηκε», our answer and its link');
  t(!(await xssFired(page)), 'an answer containing markup does not run');
});

await scenario('Q4', 'Σχόλια page: an unconfirmed e-mail is told the answer shows only here; a taken ticket number is drawn again', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw', { email: 'nikos@example.com', name: 'Νίκος', verified: false, providers: ['password'], password: 'pass-word-123' })) }, async (page) => {
  await page.goto(URL_('feedback/'));
  t(await hasText(page.locator('#feedback-app .fb-mail'), 'δεν έχει επιβεβαιωθεί'), 'the page says the answer will show only here');
  await queue(page, 'fs.batch', { reject: { code: 'permission-denied' } });
  await page.fill('#fb-message', 'Ένα μήνυμα');
  await page.click('#feedback-app [data-send]');
  const bs = await waitCalls(page, 'fs.batch', 2);
  const first = bs[0] && bs[0].args[0][0], second = bs[1] && bs[1].args[0][0];
  t(bs.length === 2 && first && second && first.path !== second.path, 'a refused write (the number already taken) is retried once with a new number');
  t(second && second.data.emailVerified === false && second.data.email === 'nikos@example.com', 'emailVerified: false, as the token says');
  t(await hasText(page.locator('#feedback-app .fb-thanks'), 'Θα βλέπετε εδώ'), 'the thank-you panel does not promise an e-mail');
});

const FB_ADMIN_SEED = signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής' }), { docs: {
  'feedback/SEMFE-260929-OPEN': fbDocOf('u-maria', { ticket: 'SEMFE-260929-OPEN', name: 'Μαρία ' + XSS, email: 'maria@example.com', page: 'https://www.stouras.com/semfealumni/account/', shots: 2, message: 'Το κουμπί δεν λειτουργεί.\n' + XSS, createdAt: ts(Date.now() - HOUR) }),
  'feedback/SEMFE-260929-OPEN/shots/1': { url: JPG_URL },
  'feedback/SEMFE-260929-OPEN/shots/2': { url: JPG_URL },
  'feedback/SEMFE-260928-UNVR': fbDocOf('u-x', { ticket: 'SEMFE-260928-UNVR', email: 'x@example.com', emailVerified: false, createdAt: ts(Date.now() - 2 * HOUR) }),
  'feedback/SEMFE-260901-DONE': fbDocOf('u-y', { ticket: 'SEMFE-260901-DONE', status: 'closed', resolution: 'Έγινε.', resolvedBy: 'repo', resolvedAt: ts(Date.now() - 5 * DAY), resolutionSentAt: ts(Date.now() - 5 * DAY), createdAt: ts(Date.now() - 9 * DAY) })
} });
await scenario('Q5', 'admin page: the Σχόλια inbox, close with an answer, reopen, delete', { cfg: 'oidc', seed: FB_ADMIN_SEED }, async (page, env) => {
  await page.goto(URL_('admin/#feedback'));
  const box = page.locator('#admin-feedback');
  t(await waitFor(page, () => document.querySelectorAll('#admin-feedback .afb-card').length === 2), 'the inbox opens on the two open messages');
  t(await page.evaluate(() => !document.getElementById('feedback').hidden), 'its section is shown to an admin');
  const tabs = await page.$$eval('#admin-feedback [data-view-tab]', bs => bs.map(b => b.textContent));
  t(js(tabs) === js(['Ανοιχτά (2)', 'Ολοκληρωμένα (1)', 'Όλα (3)']), 'tabs with counts' + list(tabs));
  const c = page.locator('#admin-feedback [data-t="SEMFE-260929-OPEN"]');
  t(await hasText(c, 'maria@example.com') && await c.locator('a[href="https://www.stouras.com/semfealumni/account/"]').count() === 1, 'the card shows the sender and the page');
  t(await waitFor(page, () => document.querySelectorAll('#admin-feedback [data-t="SEMFE-260929-OPEN"] .fb-thumb').length === 2), 'its two screenshots, fetched from beside the ticket');
  t(!(await calls(page, 'fs.list')).some(x => x.args[0] === 'feedback/SEMFE-260928-UNVR/shots'), '… and nothing is fetched for a ticket without any');
  t(!(await xssFired(page)), 'a name or message with markup does not run');
  if (process.env.SHOTS) await page.locator('#feedback').screenshot({ path: path.join(process.env.SHOTS, 'fb-inbox.png') });
  await c.locator('.fb-thumb').first().click();
  t(await visible(page.locator('.lightbox')), 'a screenshot opens in the photo viewer');
  await page.keyboard.press('Escape');
  t(await hasText(page.locator('#admin-feedback [data-t="SEMFE-260928-UNVR"]'), 'μη επιβεβαιωμένο'), 'an unconfirmed address is marked');
  await c.locator('[data-act="close"]').click();
  t(await page.evaluate(() => document.activeElement && document.activeElement.id === 'afb-res-SEMFE-260929-OPEN'), '«Κλείσιμο με απάντηση» opens the answer box, focused');
  t(await hasText(c, 'Θα σταλεί e-mail στο maria@example.com'), '… saying the answer will be e-mailed');
  await c.locator('[data-act="send"]').click();
  t(await hasText(c.locator('[data-close-msg]'), 'Γράψτε τι κάναμε'), 'an empty answer is refused');
  await page.fill('#afb-res-SEMFE-260929-OPEN', 'Διορθώθηκε, ευχαριστούμε!');
  await page.fill('#afb-url-SEMFE-260929-OPEN', 'http://insecure.example/');
  await c.locator('[data-act="send"]').click();
  t(await hasText(c.locator('[data-close-msg]'), 'https://'), 'a link that is not https is refused');
  await page.fill('#afb-url-SEMFE-260929-OPEN', 'https://www.stouras.com/semfealumni/account/');
  await c.locator('[data-act="send"]').click();
  const ups = await waitCalls(page, 'fs.update', 1);
  const u = (ups[0] || { args: [] }).args;
  t(u[0] === 'feedback/SEMFE-260929-OPEN' && u[1] && u[1].status === 'closed' && u[1].resolution === 'Διορθώθηκε, ευχαριστούμε!' && u[1].resolutionUrl === 'https://www.stouras.com/semfealumni/account/' &&
    u[1].resolvedBy === ADMIN && u[1].resolvedAt && u[1].resolvedAt.__fv === 'serverTimestamp', 'closing writes status, the answer, the link, who and when');
  t(u[1] && Object.keys(u[1]).every(k => ['status', 'resolution', 'resolutionUrl', 'resolvedAt', 'resolvedBy'].includes(k)), '… and nothing else (the rules allow only those)');
  t(await waitFor(page, () => document.querySelectorAll('#admin-feedback .afb-card').length === 1), 'it leaves the «Ανοιχτά» list');
  await page.click('#admin-feedback [data-view-tab="closed"]');
  const done = page.locator('#admin-feedback [data-t="SEMFE-260929-OPEN"]');
  t(await hasText(done, 'Διορθώθηκε, ευχαριστούμε!'), 'it is under «Ολοκληρωμένα» with the answer');
  t(await hasText(page.locator('#admin-feedback [data-t="SEMFE-260901-DONE"]'), 'από το αποθετήριο') && await hasText(page.locator('#admin-feedback [data-t="SEMFE-260901-DONE"]'), 'στάλθηκε με e-mail'), 'a ticket closed from the repository says so, and that the answer was mailed');
  await done.locator('[data-act="reopen"]').click();
  const ups2 = await waitCalls(page, 'fs.update', 2);
  t(ups2[1] && js(ups2[1].args[1]) === js({ status: 'open' }), '«Άνοιγμα ξανά» writes only status: open');
  await page.click('#admin-feedback [data-view-tab="all"]');
  await page.locator('#admin-feedback [data-t="SEMFE-260928-UNVR"] [data-act="delete"]').click();
  t(env.dialogs.some(d => d.type === 'confirm' && /SEMFE-260928-UNVR/.test(d.message)), 'deleting asks first, naming the ticket');
  const delb = (await waitCalls(page, 'fs.batch', 1)).slice(-1)[0];
  const dops = delb ? delb.args[0] : [];
  t(dops.length === 6 && dops.every(o => o.op === 'delete') && dops[5].path === 'feedback/SEMFE-260928-UNVR' && dops[0].path === 'feedback/SEMFE-260928-UNVR/shots/1',
    '… then deletes it, with its screenshots, in one batch');
  await page.click('#acct-slot .acct-chip');
  t(await hasText(page.locator('#acct-menu a[href$="admin/#feedback"]'), 'Σχόλια μελών'), 'the account menu has «Σχόλια μελών» for an admin');
  t(await hasText(page.locator('#acct-menu a[href$="feedback/"]'), 'Σχόλια και προβλήματα'), '… and «Σχόλια και προβλήματα»');
});

await scenario('Q6', 'admin page for a member: no inbox; the menu has «Σχόλια και προβλήματα» only', { cfg: 'oidc',
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name }), { docs: { 'feedback/SEMFE-260929-OPEN': fbDocOf('u-other', { ticket: 'SEMFE-260929-OPEN' }) } }) }, async (page) => {
  await page.goto(URL_('admin/'));
  t(await hasText(page.locator('#admin-app'), 'Δεν έχετε πρόσβαση'), 'a member has no access');
  t(await page.evaluate(() => document.getElementById('feedback').hidden && !document.getElementById('admin-feedback').textContent.trim()), 'and the inbox stays hidden and empty');
  t(!(await calls(page, 'fs.onSnapshot')).some(c => c.args[0] === 'feedback'), '… nothing is even asked of feedback/');
  await page.click('#acct-slot .acct-chip');
  t(await page.locator('#acct-menu a[href$="feedback/"]').count() === 1 && await page.locator('#acct-menu a[href$="admin/#feedback"]').count() === 0, 'the menu: «Σχόλια και προβλήματα», no «Σχόλια μελών»');
});

await scenario('Q7', 'Σχόλια page when sign-in is not set up yet: points to Επικοινωνία', { cfg: 'off' }, async (page) => {
  await page.goto(URL_('feedback/'));
  t(await hasText(page.locator('#feedback-app'), 'ανοίγει σύντομα') && await page.locator('#feedback-app a[href$="contact/"]').count() === 1, '«ανοίγει σύντομα», with a link to Επικοινωνία');
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) { console.log('\nFailures:\n  ' + failed.join('\n  ')); }
process.exit(fails ? 1 : 0);
