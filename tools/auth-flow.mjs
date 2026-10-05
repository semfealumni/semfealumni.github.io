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
     D. e-mail registration: validation, create + name + verification e-mail;
        an unconfirmed e-mail account is HELD at the «Επιβεβαιώστε το e-mail σας»
        card (not signed in) until its link is pressed, on every page
     E. e-mail sign-in: wrong password, forgotten password
     F. account page: signed out, application (create / validate / refused write /
        edit), unverified e-mail, directory listing, linking, deletion
     G. members page: signed out / no application / pending / rejected / active,
        accent-insensitive directory search
     H. admin page: access, approve, dues, reject, CSV export
     I. LinkedIn through the Cloud Function (mode 'function') and its callback
     J. stored XSS: hostile names on the admin, members and account pages
     Y. the English copy (en/): every page script in English, links that stay
        in English, a new user landing on en/account/

   Usage: node tools/auth-flow.mjs [--only=A,F] [--headed]
   Needs Playwright (Chromium) and python3. No network: every third-party
   request is answered locally. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, symlinkSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
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
  optionalKeys: strList(grab(/function optionalKeys\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'optionalKeys()')[1]),
  genders: strList(grab(/function genders\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'genders()')[1]),
  industries: strList(grab(/function industries\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'industries()')[1]),
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
  // the optional answers (counted anonymously on the Στατιστικά page)
  if ('gender' in d && !(d.gender === '' || R.genders.includes(d.gender))) p.push(`gender ${js(d.gender)} not in ${js(R.genders)}`);
  if ('industry' in d && !(d.industry === '' || R.industries.includes(d.industry))) p.push(`industry ${js(d.industry)} not in the list`);
  if ('country' in d && !(typeof d.country === 'string' && /^([A-Z]{2})?$/.test(d.country))) p.push(`country ${js(d.country)} must be '' or a two-letter code`);
  return p;
}
function createProblems(d) {
  const keys = Object.keys(d), allowed = [...R.profileKeys, ...R.optionalKeys, 'status'];
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
  const extra = Object.keys(merged).filter(k => ![...R.profileKeys, ...R.optionalKeys, ...R.adminKeys].includes(k));
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
  // a browser that signed in before also holds auth.js's note of it (saveHint), which the
  // public pages use to decide whether to load the sign-in library at all
  if (opts.hint) await ctx.addInitScript(h => { try { if (!localStorage.getItem('semfe:auth-hint')) localStorage.setItem('semfe:auth-hint', JSON.stringify(h)); } catch (e) {} }, opts.hint);
  // …or, for an account that has not confirmed its e-mail, the note that it is pending
  if (opts.pending) await ctx.addInitScript(h => { try { if (!sessionStorage.getItem('__pendSeeded')) { sessionStorage.setItem('__pendSeeded', '1'); localStorage.setItem('semfe:auth-pending', JSON.stringify(h)); } } catch (e) {} }, opts.pending);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(process.env.STACKS ? String(e.stack).split('\n').slice(0, 4).join(' | ') : e.message));
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
await scenario('B', 'the «Διαχείριση» menu item appears only for a VERIFIED admin e-mail', { cfg: 'oidc', hint: { n: 'Διαχειριστής', p: '', e: ADMIN },
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
  t(await hasText(page.locator('#auth-title'), 'Επιβεβαιώστε το e-mail σας'), 'the unverified account is held at the «Επιβεβαιώστε το e-mail σας» card');
  t(await visible(page.locator('#acct-slot [data-verify-open]')) && await page.locator('#acct-slot .acct-chip').count() === 0,
    '… it is NOT signed in: «Επιβεβαίωση e-mail» in the header, no name chip, so no «Διαχείριση» item');
  t(await page.evaluate(() => window.SemfeAuth.user() === null), '… and SemfeAuth.user() is null');
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
  await submit();
  t(await hasText(page.locator('#auth-title'), 'Επιβεβαιώστε το e-mail σας'), 'the dialog becomes the «Επιβεβαιώστε το e-mail σας» card');
  const all = await calls(page);
  const cr = all.filter(x => x.api === 'auth.createUserWithEmailAndPassword').pop();
  const up = all.filter(x => x.api === 'user.updateProfile').pop();
  const ve = all.filter(x => x.api === 'user.sendEmailVerification').pop();
  t(cr && cr.args[0] === 'giorgos@example.com' && cr.args[1] === 'correct-horse-9', 'createUserWithEmailAndPassword(e-mail, password)');
  t(up && up.args[0].displayName === 'Γιώργος Νικολάου', 'updateProfile({displayName: "First Last"})' + list([js(up && up.args[0])]));
  t(ve && ve.args[0] && ve.args[0].url === ORIGIN + SUB + 'account/', 'sendEmailVerification() with a continue URL back to /semfealumni/account/' + list([js(ve && ve.args[0])]));
  t(cr && up && ve && cr.i < up.i && up.i < ve.i, '… in that order: create, name, verification e-mail');
  const card = page.locator('.modal [data-verify]');
  t(await hasText(card, 'Σας στείλαμε e-mail στο giorgos@example.com'), 'the card says the e-mail went to giorgos@example.com' + list([await text(page.locator('.modal [data-verify-lede]'))]));
  t(await page.$eval('.modal [data-auth-main]', e => e.hidden), '… in place of the sign-in form');
  t((await page.inputValue('#auth-pass')) === '', '… and the typed password is gone from the hidden form');
  t(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-verify-lede')), '… with the keyboard on its message');
  t(await page.$eval('.modal [data-verify-resend]', b => b.disabled), '«Στείλτε μου ξανά το e-mail» waits a minute after the e-mail just sent');
  t(new URL(page.url()).pathname === SUB, 'the new account stays on the page (no account/#apply yet)');
  t(await visible(page.locator('#acct-slot [data-verify-open]')) && await page.locator('#acct-slot .acct-chip').count() === 0, 'the header says «Επιβεβαίωση e-mail», not the name: the account is not signed in');
  t(await page.evaluate(() => window.SemfeAuth.user() === null && !localStorage.getItem('semfe:auth-hint') &&
    (JSON.parse(localStorage.getItem('semfe:auth-pending') || '{}').e === 'giorgos@example.com')),
    'SemfeAuth.user() is null, no signed-in hint is kept, and the pending note names the address');
  t(await page.evaluate(() => window.SemfeAuth.pending() && window.SemfeAuth.pending().email === 'giorgos@example.com'), 'SemfeAuth.pending() names the address');
  // «Το επιβεβαίωσα» before the link has been pressed
  await page.click('.modal [data-verify-check]');
  t(await hasText(page.locator('.modal [data-verify-status]'), 'Δεν έχει επιβεβαιωθεί ακόμα'), '«Το επιβεβαίωσα» too early: «Δεν έχει επιβεβαιωθεί ακόμα…»');
  t(await visible(card), '… and the card stays');
  // the link in the e-mail is pressed
  const uid = Object.values((await fbState(page)).accounts).find(a => a.email === 'giorgos@example.com').uid;
  await server(page, 'verify', uid, true);
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 8000 }).catch(() => {}), page.click('.modal [data-verify-check]')]);
  const after = await calls(page);
  const rl = after.filter(x => x.api === 'user.reload').pop(), tk = after.filter(x => x.api === 'user.getIdToken' && x.args[0] === true);
  t(rl && tk.length && tk.some(x => x.i > rl.i), 'once confirmed: reload() THEN getIdToken(true), a fresh token for the rules');
  const u = new URL(page.url());
  t(u.pathname === SUB + 'account/' && u.hash === '#apply', '… and the new account lands on account/#apply');
  t(await visible(page.locator('#account-app form[data-apply]')) && !(await page.$eval('#account-app form[data-apply] [type=submit]', b => b.disabled)), 'the application form is there, its submit button enabled');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Γιώργος Νικολάου'), 'the header chip shows the new name');
  t(/Το e-mail σας επιβεβαιώθηκε/.test(await flashText(page)), 'a toast says the e-mail is confirmed' + list([await flashText(page)]));
  t(await page.evaluate(() => !localStorage.getItem('semfe:auth-pending') && !!localStorage.getItem('semfe:auth-hint')), 'the pending note is gone and the signed-in hint is kept');
});

const NIKOS = acct('u-pw', { email: 'nikos@example.com', name: 'Νίκος Κάραλης', verified: false, providers: ['password'], password: 'pass-word-123' });
await scenario('D2', 'an unconfirmed e-mail account signing in later is held, may ask again, and may sign out from the card', { cfg: 'oidc',
  seed: { accounts: { 'u-pw': NIKOS } } }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page);
  await page.fill('#auth-email', 'nikos@example.com');
  await page.fill('#auth-pass', 'pass-word-123');
  await page.click('.modal [data-submit]');
  t(await hasText(page.locator('#auth-title'), 'Επιβεβαιώστε το e-mail σας'), 'signing in with the right password opens the card, not the account');
  t(await hasText(page.locator('.modal [data-verify-lede]'), 'Ο λογαριασμός με το nikos@example.com δεν έχει επιβεβαιωθεί ακόμα'), '… saying the account is not confirmed yet' + list([await text(page.locator('.modal [data-verify-lede]'))]));
  t(!(await page.$eval('.modal [data-verify-resend]', b => b.disabled)), '«Στείλτε μου ξανά το e-mail» is available (nothing was sent from here)');
  t((await calls(page, 'user.sendEmailVerification')).length === 0, 'signing in sends nothing by itself');
  t(await page.locator('#acct-slot .acct-chip').count() === 0, 'no name chip: not signed in');
  await page.click('.modal [data-verify-resend]');
  const sv = await waitCalls(page, 'user.sendEmailVerification', 1);
  t(sv.length === 1 && sv[0].args[0] && sv[0].args[0].url === ORIGIN + SUB + 'account/', '«Στείλτε μου ξανά το e-mail» sends it, with a continue URL back to account/' + list(sv.map(x => js(x.args[0]))));
  t(await hasText(page.locator('.modal [data-verify-status]'), 'Σας στείλαμε νέο e-mail επιβεβαίωσης στο nikos@example.com'), '… and says so');
  t(await page.$eval('.modal [data-verify-resend]', b => b.disabled), '… and waits a minute before another');
  // closing the card leaves the account pending
  await page.click('.modal [data-close]');
  t(await hidden(page.locator('.modal-backdrop')), 'the card closes');
  t(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-verify-open')), '… and the keyboard goes to «Επιβεβαίωση e-mail» in the header');
  await page.click('#acct-slot [data-verify-open]');
  t(await hasText(page.locator('#auth-title'), 'Επιβεβαιώστε το e-mail σας'), '«Επιβεβαίωση e-mail» in the header opens the card again');
  await page.keyboard.press('Escape');
  // a link that asks for the sign-in dialog gives the card too
  await page.goto(URL_('?signin'));
  t(await hasText(page.locator('#auth-title'), 'Επιβεβαιώστε το e-mail σας'), '?signin, while pending, opens the card');
  await page.keyboard.press('Escape');
  // a page that needs an account: held there too, and nothing of the account is read
  await page.goto(URL_('members/'));
  t(await hasText(page.locator('#auth-title'), 'Επιβεβαιώστε το e-mail σας'), 'the members page opens the card on its own');
  t(!(await calls(page)).some(c => /^fs\./.test(c.api) && js(c.args).indexOf('u-pw') !== -1), '… and reads nothing of the account from Firestore');
  await page.keyboard.press('Escape');
  await page.goto(URL_('account/'));
  t(await hasText(page.locator('#verify-pending'), 'Ο λογαριασμός με το nikos@example.com ενεργοποιείται μόλις πατήσετε τον σύνδεσμο'), 'the account page shows «Επιβεβαιώστε το e-mail σας», not the application');
  t(await page.locator('#account-app form[data-apply]').count() === 0, '… and no application form');
  t(await visible(page.locator('.modal [data-verify]')), '… with the card open over it');
  // «Αποσύνδεση» from the card: out, and the dialog becomes the sign-in form
  await page.click('.modal [data-verify-out]');
  t(await hasText(page.locator('#auth-title'), 'Σύνδεση'), '«Αποσύνδεση» in the card turns it into the sign-in form');
  t((await calls(page, 'auth.signOut')).length === 1, '… after auth.signOut()');
  t(await visible(page.locator('#acct-slot [data-signin]')), '… the header says «Σύνδεση» again');
  t(await page.evaluate(() => !localStorage.getItem('semfe:auth-pending')), '… and the pending note is gone');
  t(new URL(page.url()).pathname === SUB + 'account/' && await dialogOpen(page), '… without reloading the page, so the form stays open');
});

await scenario('D3', 'the next page paints «Επιβεβαίωση e-mail» before the SDK, and a link pressed on another device is noticed', { cfg: 'oidc', sdkDelayMs: 1200,
  pending: { e: 'nikos@example.com', u: 'u-pw' }, seed: signedInSeed(NIKOS) }, async (page) => {
  await page.goto(URL_(''), { waitUntil: 'domcontentloaded' });
  const early = await page.evaluate(() => ({ verify: !!document.querySelector('#acct-slot [data-verify-open]'), signin: !!document.querySelector('#acct-slot [data-signin]'), sdk: !!window.firebase }));
  t(early.verify && !early.signin && !early.sdk, 'before the SDK has loaded, the header already says «Επιβεβαίωση e-mail» (from the note in this browser)' + list([js(early)]));
  await sdkReady(page);
  await sleep(100);
  t(!(await dialogOpen(page)), 'a public page does not open the card on its own');
  t(await visible(page.locator('#acct-slot [data-verify-open]')), '… the header still says «Επιβεβαίωση e-mail» once the SDK has answered');
  await page.click('#acct-slot [data-verify-open]');
  t(await hasText(page.locator('.modal [data-verify-lede]'), 'δεν έχει επιβεβαιωθεί ακόμα'), 'the card opens');
  // the person presses the link on their phone, then comes back to this window
  await server(page, 'verify', 'u-pw', true);
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 8000 }).catch(() => {}), page.evaluate(() => window.dispatchEvent(new Event('focus')))]);
  t(new URL(page.url()).pathname === SUB + 'account/', 'coming back to the window, the card notices the confirmation and goes on to account/#apply');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Νίκος Κάραλης'), '… signed in, with the name chip');
  t(await visible(page.locator('#account-app form[data-apply]')), '… at the membership application');
});

await scenario('D4', 'a pending account confirmed elsewhere is simply signed in on its next page', { cfg: 'oidc',
  pending: { e: 'nikos@example.com', u: 'u-pw' }, seed: signedInSeed(Object.assign({}, NIKOS, { emailVerified: true })) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Νίκος Κάραλης'), 'the name chip, not «Επιβεβαίωση e-mail»');
  t(await visible(page.locator('#account-app form[data-apply]')), 'the application form');
  t(!(await dialogOpen(page)), 'no card');
  t(await page.evaluate(() => !localStorage.getItem('semfe:auth-pending')), 'the pending note is cleared');
});

await scenario('D5', 'registration: the verification e-mail did not go out', { cfg: 'oidc' }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page, 'register');
  await page.fill('#auth-first', 'Άννα'); await page.fill('#auth-last', 'Ζαφειρίου');
  await page.fill('#auth-email', 'anna@example.com'); await page.fill('#auth-pass', 'correct-horse-9');
  await queue(page, 'sendEmailVerification', { reject: { code: 'auth/too-many-requests' } });
  await page.click('.modal [data-submit]');
  t(await hasText(page.locator('.modal [data-verify-lede]'), 'το e-mail επιβεβαίωσης δεν στάλθηκε στο anna@example.com'), 'the card says the e-mail did not go' + list([await text(page.locator('.modal [data-verify-lede]'))]));
  t(await hasText(page.locator('.modal [data-verify-lede]'), 'Πολλές προσπάθειες'), '… and why, in Greek');
  t(!(await page.$eval('.modal [data-verify-resend]', b => b.disabled)), '«Στείλτε μου ξανά το e-mail» can be pressed at once');
  await page.click('.modal [data-verify-resend]');
  t(await hasText(page.locator('.modal [data-verify-lede]'), 'Σας στείλαμε e-mail στο anna@example.com'), 'pressed: the e-mail goes and the card says so');
});

await scenario('D6', 'a phone: «Επιβεβαίωση e-mail» is an envelope that never squeezes the logo', { cfg: 'oidc', viewport: { width: 320, height: 640 },
  pending: { e: 'nikos@example.com', u: 'u-pw' }, seed: signedInSeed(NIKOS) }, async (page) => {
  await page.goto(URL_(''));
  await sdkReady(page);
  const g = await page.evaluate(() => {
    const b = document.querySelector('#acct-slot [data-verify-open]'), r = b.getBoundingClientRect();
    const brand = document.querySelector('.brand-text').getBoundingClientRect(), tx = b.querySelector('.tx').getBoundingClientRect();
    return { w: r.width, h: r.height, brandRight: brand.right, left: r.left, txW: tx.width, name: b.textContent.trim(), scroll: document.documentElement.scrollWidth };
  });
  t(g.w >= 44 && g.h >= 44, 'the button is at least 44×44' + list([js(g)]));
  t(g.txW <= 1 && g.name === 'Επιβεβαίωση e-mail', '… shows only the envelope, and is still called «Επιβεβαίωση e-mail»');
  t(g.brandRight <= g.left + 0.5 && g.scroll <= 320, '… beside the logo, with nothing scrolling sideways');
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
  const boxes = () => page.evaluate(() => ['consentNewsletter', 'consentJobs', 'consentDirectory', 'acceptedPrivacy'].map(k => k + '=' + document.getElementById('f-' + k).checked));
  const fresh = await boxes();
  t(fresh.every(x => x.endsWith('=false')), 'a first application starts with the four boxes UNticked (consent is never pre-ticked)' + list(fresh));
  const submit = () => page.click('#account-app form[data-apply] [type=submit]');
  const good = { firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, phone: '6900000000', stage: 'graduate', direction: 'Εφαρμοσμένα Μαθηματικά',
    entryYear: '2008', gradYear: '2013', position: 'Data Scientist', employer: 'ACME', city: 'Αθήνα', linkedin: 'linkedin.com/in/maria-p', note: 'Γεια σας' };
  async function fill(v) {
    for (const [k, val] of Object.entries(v)) {
      if (k === 'stage' || k === 'direction' || k === 'gender' || k === 'industry' || k === 'country') await page.selectOption('#f-' + k, val);
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
  await bad({}, false, 'Για να υποβάλετε αίτηση, επιβεβαιώστε ότι διαβάσατε την πολιτική απορρήτου.', 'privacy not acknowledged');
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

  // the real submission, with the three optional answers
  await fill(Object.assign({}, good, { gender: 'female', industry: 'data', country: 'GR' }));
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
  const want = [...R.profileKeys, ...R.optionalKeys, 'status'];
  t(js(Object.keys(d).sort()) === js(want.sort()), 'set() carries EXACTLY the keys the create rule allows (profileKeys + the optional answers + status)' +
    list([...Object.keys(d).filter(k => !want.includes(k)).map(k => '+' + k), ...want.filter(k => !(k in d)).map(k => '-' + k)]));
  t(d.gender === 'female' && d.industry === 'data' && d.country === 'GR', 'gender, industry and country are stored as keys (female, data, GR)' + list([d.gender, d.industry, d.country]));
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
  const saved = await boxes();
  t(saved.join() === 'consentNewsletter=true,consentJobs=false,consentDirectory=true,acceptedPrivacy=true', '… and the saved ticks, the unticked one included' + list(saved));
  t((await page.inputValue('#f-industry')) === 'data' && (await page.inputValue('#f-gender')) === 'female' && (await page.inputValue('#f-country')) === 'GR', '… the optional answers included');
  t(await page.locator('#account-app form[data-apply] a[href$="analytics/#meli"]').count() === 1, 'the form says the answers are counted only anonymously, with a link to the statistics');
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

await scenario('F3', 'account page: an e-mail + password account that has not confirmed its address is held, then let in', { cfg: 'oidc',
  seed: signedInSeed(NIKOS) }, async (page) => {
  await page.goto(URL_('account/'));
  const app = page.locator('#account-app');
  t(await hasText(app, 'Επιβεβαιώστε το e-mail σας'), 'the account page asks to confirm the e-mail');
  t(await page.locator('#account-app form[data-apply]').count() === 0, '… and shows no application form');
  t(await visible(page.locator('.modal [data-verify]')), 'the card opens on its own');
  t(!(await calls(page)).some(c => /^fs\./.test(c.api) && js(c.args).indexOf('u-pw') !== -1), 'nothing of the account is read from Firestore');
  await page.click('.modal [data-verify-check]');
  t(await hasText(page.locator('.modal [data-verify-status]'), 'Δεν έχει επιβεβαιωθεί ακόμα'), '«Το επιβεβαίωσα», still unconfirmed: «Δεν έχει επιβεβαιωθεί ακόμα…»');
  await server(page, 'verify', 'u-pw', true);       // the person clicks the link in the e-mail
  await page.click('.modal [data-verify-check]');
  t(await hidden(page.locator('.modal-backdrop')), 'once confirmed, the card closes');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app form[data-apply] [type=submit]'); return !!b && !b.disabled; }), '… and the application form is there, ready to send');
  t(new URL(page.url()).pathname === SUB + 'account/', '… on the same page');
  t(/Το e-mail σας επιβεβαιώθηκε/.test(await flashText(page)), '… with a toast saying so');
  const all = await calls(page);
  const rl = all.filter(x => x.api === 'user.reload').pop(), tk = all.filter(x => x.api === 'user.getIdToken' && x.args[0] === true);
  t(rl && tk.some(x => x.i > rl.i), 'reload() THEN getIdToken(true), so the rules see the confirmed address');
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
  t(await hasText(page.locator('#auth-title'), 'Επιβεβαιώστε το e-mail σας'), 'the admin address, unconfirmed: held at the «Επιβεβαιώστε το e-mail σας» card');
  t(await hasText(page.locator('#admin-app'), 'Μόνο για διαχειριστές'), '… and the page stays as for a visitor who is not signed in');
  t((await calls(page, 'fs.list')).length === 0, '… and the members list is never requested');
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

// (K2, «an unconfirmed account keeps its typing when it confirms», went with the
// verification hold: such an account no longer sees the application form, D2 and F3)

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

/* ======================= R. regressions from the whole-site review ======================= */
await scenario('R1', 'signing out wipes the sign-in dialog (a shared computer keeps no password)', { cfg: 'oidc',
  seed: { accounts: { 'u-e': acct('u-e', { email: 'eleni@example.com', name: 'Ελένη', providers: ['password'], password: 'right-password-1' }) } } }, async (page) => {
  await page.goto(URL_('blog/'));
  await openDialog(page, 'signin');
  await page.fill('#auth-email', 'eleni@example.com');
  await page.fill('#auth-pass', 'right-password-1');
  await page.click('.modal [data-pw]');
  await page.click('.modal [data-submit]');
  t(await visible(page.locator('#acct-slot .acct-chip')), 'signed in');
  await page.click('#acct-slot .acct-chip');
  await page.click('#acct-menu [data-signout]');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'signed out (on a page that does not reload)');
  await page.click('#acct-slot [data-signin]');
  await visible(page.locator('.modal-backdrop'));
  const f = await page.evaluate(() => ({ email: document.getElementById('auth-email').value, pass: document.getElementById('auth-pass').value, type: document.getElementById('auth-pass').type,
    toggle: document.querySelector('.modal [data-pw]').textContent }));
  t(f.email === '' && f.pass === '' && f.type === 'password' && f.toggle === 'Εμφάνιση', 'the dialog opens empty, the password hidden again' + list([js(f)]));
});

await scenario('R2', 'registering: the page hears of the new account only once its name is saved', { cfg: 'oidc' }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-open="register"]');
  await sdkReady(page);
  await queue(page, 'updateProfile', { delayMs: 600 });
  await page.fill('#auth-first', 'Νίκος'); await page.fill('#auth-last', 'Δημητρίου');
  await page.fill('#auth-email', 'nikos.d@example.com'); await page.fill('#auth-pass', 'a-good-password-1');
  await page.click('.modal [data-submit]');
  await sleep(250);
  t(await dialogOpen(page) && await page.$eval('.modal [data-verify]', e => e.hidden), 'while the name is being saved, the dialog stays open and the card is not shown yet (nothing half-done on screen)');
  t(await visible(page.locator('.modal [data-verify]')), 'then the «Επιβεβαιώστε το e-mail σας» card');
  t((await calls(page, 'user.updateProfile')).length === 1 && (await calls(page, 'user.sendEmailVerification')).length === 1, '… once the name is saved and the e-mail sent');
  t(await hasText(page.locator('#verify-pending'), 'nikos.d@example.com'), 'the account page behind it waits for the confirmation');
  const uid = Object.values((await fbState(page)).accounts).find(a => a.email === 'nikos.d@example.com').uid;
  await server(page, 'verify', uid, true);
  await page.click('.modal [data-verify-check]');
  t(await waitFor(page, () => document.getElementById('f-firstName') && document.getElementById('f-firstName').value === 'Νίκος', null, 6000), 'confirmed: the application form starts with the first name');
  t((await page.inputValue('#f-lastName')) === 'Δημητρίου', '… and the last name');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Νίκος Δημητρίου'), 'the header shows the full name, not the e-mail');
});

await scenario('R3', 'the account menu closes after a link to the same page', { cfg: 'oidc',
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name })) }, async (page) => {
  await page.goto(URL_('account/'));
  await visible(page.locator('#account-app #methods'));
  await page.click('#acct-slot .acct-chip');
  await page.click('#acct-menu a[href$="account/#methods"]');
  t(await page.evaluate(() => document.getElementById('acct-menu').hidden), 'the menu is closed after «Τρόποι σύνδεσης»');
});

await scenario('R4', 'the LinkedIn return page with a broken address says so (no endless spinner)', { cfg: 'function' }, async (page) => {
  await page.goto(URL_('auth/linkedin/?code=abc%E0%A4&state=x'));
  t(await hasText(page.locator('#li-app'), 'LinkedIn'), 'a message about the LinkedIn sign-in is shown');
  t(!(await page.locator('#li-app .spinner').count()), '… and no spinner');
});

await scenario('R5', 'account page: a double click on «Υποβολή αίτησης» sends it once', { cfg: 'oidc',
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name })) }, async (page) => {
  await page.goto(URL_('account/'));
  await visible(page.locator('#account-app form[data-apply]'));
  await page.selectOption('#f-stage', 'graduate');
  await page.check('#f-acceptedPrivacy');
  await queue(page, 'fs.set', { delayMs: 500 });
  await page.click('#account-app form[data-apply] [type=submit]');
  await page.click('#account-app form[data-apply] [type=submit]').catch(() => {});
  await sleep(900);
  const w = (await calls(page, 'fs.set')).filter(c => c.args[0] === 'members/' + MARIA.uid).length + (await calls(page, 'fs.update')).filter(c => c.args[0] === 'members/' + MARIA.uid).length;
  t(w === 1, 'one write, not two (' + w + ')');
});

await scenario('R6', 'merging: the person is asked, with the other account named, and can say no', { cfg: 'oidc',
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name, providers: ['google.com'] }), {
    accounts: { [MARIA.uid]: acct(MARIA.uid, { email: MARIA.email, name: MARIA.name, providers: ['google.com'] }),
      'u-pw2': acct('u-pw2', { email: 'maria.old@example.com', name: 'Μαρία', providers: ['password'], password: 'old-pass-123' }) } }) }, async (page, env) => {
  env.dialogPolicy = 'dismiss';
  await page.goto(URL_('account/'));
  await visible(page.locator('#account-app #methods'));
  await page.click('#account-app [data-merge-open]');
  await page.fill('#merge-email', 'maria.old@example.com');
  await page.fill('#merge-pass', 'old-pass-123');
  await page.click('#account-app [data-merge-pw] [type=submit]');
  t(await waitFor(page, () => /ακυρώθηκε/.test((document.querySelector('#account-app [data-merge-msg]') || {}).textContent || '')), '«Η ένωση ακυρώθηκε: δεν άλλαξε τίποτα.»');
  t(env.dialogs.some(d => d.type === 'confirm' && /maria\.old@example\.com/.test(d.message)), 'the question names the account that would be merged away');
  t(!env.fnRequests || !env.fnRequests.some(r => /accounts/.test(r.url || '')), 'nothing was sent to the server');
});

await scenario('R7', 'a visitor who only reads the public pages never downloads the sign-in library', { cfg: 'oidc' }, async (page, env) => {
  await page.goto(URL_(''));
  await page.goto(URL_('organa/'));
  await sleep(1500);
  t(env.sdkUrls.length === 0, 'no request to gstatic.com on the public pages' + list(env.sdkUrls));
  t(await page.evaluate(() => !window.firebase), '… and nothing of Firebase in the page');
  await page.click('#acct-slot [data-signin]');
  t(await visible(page.locator('.modal-backdrop')), '«Σύνδεση» opens the dialog');
  t(await sdkReady(page) && env.sdkUrls.length > 0, '… and only then the library is loaded');
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

// (an e-mail + password account with an unconfirmed address is held before it gets here, D2;
// a Facebook sign-in whose address Facebook did not confirm is not, and is the case here)
await scenario('Q4', 'Σχόλια page: an unconfirmed e-mail is told the answer shows only here; a taken ticket number is drawn again', { cfg: 'oidc',
  seed: signedInSeed(acct('u-fbu', { email: 'nikos@example.com', name: 'Νίκος', verified: false, providers: ['facebook.com'] })) }, async (page) => {
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

/* ---- «Τι νέο» (whats-new/): changelog.json are Claude's suggestions; the
   admins' decisions live in newsOverrides/; nothing is public unapproved ---- */
const NEWS_LOG = JSON.parse(read('changelog.json')).updates;
const NEWS_IDS = NEWS_LOG.map(e => e.id);
// Firestore's REST answer for the public read, as visitors' browsers get it
const restDocs = docs => ({ documents: Object.entries(docs).map(([id, d]) => ({
  name: `projects/${TEST_FIREBASE.projectId}/databases/(default)/documents/newsOverrides/${id}`,
  fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { stringValue: v }])) })) });
const newsTitles = page => page.$$eval('#news-app .news-item h3', els => els.map(e => e.textContent.trim()));

await scenario('W1', '«Τι νέο», signed out: only what an admin approved, in their wording; no sign-in library loaded', { cfg: 'oidc' }, async (page, env) => {
  const rest = [];
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/v1/projects/')) return false;
    rest.push(url);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(restDocs({
      [NEWS_IDS[0]]: { status: 'approved' },
      [NEWS_IDS[1]]: { status: 'approved', title: 'Η διατύπωση του διαχειριστή' },
      [NEWS_IDS[2]]: { status: 'removed' },
      [NEWS_IDS[3]]: { status: 'pending' } })) });
    return true;
  };
  await page.goto(URL_('whats-new/'));
  t(await waitFor(page, () => document.querySelectorAll('#news-app .news-item').length > 0), 'the list is drawn');
  const titles = await newsTitles(page);
  t(js(titles) === js([NEWS_LOG[0].title, 'Η διατύπωση του διαχειριστή']), 'only the two approved entries, newest first, the second in the admin\'s words' + list(titles));
  t(rest.length === 1 && rest[0].includes('/documents/newsOverrides') && rest[0].includes('key='), 'the decisions come from ONE plain request to Firestore\'s REST address');
  t(env.sdkUrls.length === 0, '… and the sign-in library is not loaded for a visitor');
  t(await page.locator('#news-app [data-act]').count() === 0 && await page.locator('#news-app .news-review, #news-app .news-removed').count() === 0, 'no admin controls, nothing waiting, nothing removed');
  t((await page.locator('#news-app time').first().getAttribute('datetime')) === NEWS_LOG[0].date, 'each entry carries its date');
  t(await page.locator('.nav-more-panel a[href$="whats-new/"]').count() === 1 && await page.locator('.site-footer a[href$="whats-new/"]').count() === 1, 'reachable from the menu («Ο ιστότοπος») and the footer');
});

await scenario('W2', '«Τι νέο», signed out, the decisions cannot be read: nothing is shown (never everything)', { cfg: 'oidc' }, async (page, env) => {
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/')) return false;
    await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":{"code":403,"status":"PERMISSION_DENIED"}}' });
    return true;
  };
  await page.goto(URL_('whats-new/'));
  t(await hasText(page.locator('#news-app'), 'Δεν υπάρχουν ακόμα νέα'), 'it says there is nothing yet');
  t(await page.locator('#news-app .news-item').count() === 0, '… and shows no entry: an unreadable decision means "waiting"');
});

await scenario('W3', '«Τι νέο», an admin: publish, reword, remove, restore, publish all', { cfg: 'oidc', hint: { n: 'Διαχειριστής', p: '', e: ADMIN },
  seed: signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής', verified: true, providers: ['google.com'] }),
    { docs: { ['newsOverrides/' + NEWS_IDS[0]]: { status: 'approved', t: ts(Date.now() - DAY), by: ADMIN } } }) }, async (page) => {
  await page.goto(URL_('whats-new/'));
  t(await visible(page.locator('#news-app .news-review')), 'the admin sees «Περιμένουν έγκριση» above the list');
  const pending = NEWS_LOG.length - 1;
  t(await hasText(page.locator('#news-review-h'), String(pending)) && await page.locator('.news-review .news-item').count() === pending, `${pending} suggestions wait, each with its own buttons`);
  t(js(await page.$$eval('#news-app > .news-list .news-item h3', els => els.map(e => e.textContent.trim()))) === js([NEWS_LOG[0].title]), 'the published list holds the one approved entry');
  const second = NEWS_IDS[1];
  await page.click(`.news-review [data-act="approve"][data-id="${second}"]`);
  const b1 = await waitCalls(page, 'fs.batch', 1);
  const op = ((b1[0] || { args: [[]] }).args[0] || [])[0] || {};
  t(op.op === 'set' && op.path === 'newsOverrides/' + second && op.data.status === 'approved' && op.data.by === ADMIN && op.data.t && op.data.t.__fv === 'serverTimestamp',
    '«Δημοσίευση» writes newsOverrides/<id>: approved, by the admin, at the server\'s time');
  t(js(Object.keys(op.data).sort()) === js(['by', 'status', 't']), '… only keys the rules allow' + list([js(Object.keys(op.data))]));
  t(await hasText(page.locator('#news-app .news-note'), 'Δημοσιεύτηκε') && await page.locator('#news-app > .news-list .news-item').count() === 2, 'it moves to the published list, and the page says so');
  await page.click(`#news-app > .news-list [data-act="edit"][data-id="${second}"]`);
  t(await visible(page.locator(`form[data-id="${second}"] input[name=title]`)), '«Επεξεργασία» opens a small form in place');
  await page.fill(`form[data-id="${second}"] input[name=title]`, 'Νέα διατύπωση <b>τίτλου</b>');
  await page.click(`form[data-id="${second}"] button[type=submit]`);
  const b2 = await waitCalls(page, 'fs.batch', 2);
  const op2 = ((b2[1] || { args: [[]] }).args[0] || [])[0] || {};
  t(op2.data && op2.data.status === 'approved' && op2.data.title === 'Νέα διατύπωση <b>τίτλου</b>' && op2.data.summary === '', 'the new title is saved; the untouched text stays the changelog\'s (stored empty)');
  t(await hasText(page.locator('#news-app > .news-list'), 'Νέα διατύπωση <b>τίτλου</b>') && await hasText(page.locator('#news-app > .news-list'), 'Με τη δική σας διατύπωση'), 'the list shows it, marked as reworded, as text (not markup)');
  await page.click(`#news-app > .news-list [data-act="remove"][data-id="${second}"]`);
  await waitCalls(page, 'fs.batch', 3);
  t(await visible(page.locator('#news-app .news-removed')) && await hasText(page.locator('#news-app .news-removed > summary'), 'Αφαιρεμένα (1)'), '«Αφαίρεση»: it leaves the list for a closed «Αφαιρεμένα (1)» box');
  await page.click('#news-app .news-removed > summary');
  await page.click(`#news-app .news-removed [data-act="restore"][data-id="${second}"]`);
  await waitCalls(page, 'fs.batch', 4);
  // the page redraws once the write has answered: wait for that, not just for the call
  t(await waitFor(page, () => !document.querySelector('#news-app .news-removed') && document.querySelectorAll('#news-app > .news-list .news-item').length === 2), '«Επαναφορά» puts it back on the list');
  const left = pending - 1;
  await page.click('#news-app [data-act="approve-all"]');
  const b5 = await waitCalls(page, 'fs.batch', 5);
  const ops5 = (b5[4] || { args: [[]] }).args[0] || [];
  t(ops5.length === left && ops5.every(o => o.data.status === 'approved'), `«Δημοσίευση όλων» publishes the other ${left} in ONE batch`);
  t(await hasText(page.locator('#news-app .news-review'), 'Τίποτα δεν περιμένει έγκριση') && await page.locator('#news-app > .news-list .news-item').count() === NEWS_LOG.length, 'nothing waits any more; every entry is published');
  await page.click('#acct-slot .acct-chip');
  t(await page.locator('#acct-menu a[href$="whats-new/"]').count() === 1, 'the account menu has «Τι νέο: έγκριση» for an admin');
  t(!(await xssFired(page)), 'nothing typed runs as markup');
});

await scenario('W4', '«Τι νέο», a member who is not an admin: the public list only', { cfg: 'oidc', hint: { n: MARIA.name, p: '', e: MARIA.email },
  seed: signedInSeed(acct(MARIA.uid, { email: MARIA.email, name: MARIA.name }), { docs: { ['newsOverrides/' + NEWS_IDS[2]]: { status: 'approved', t: ts(Date.now() - DAY), by: ADMIN } } }) }, async (page, env) => {
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/')) return false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(restDocs({ [NEWS_IDS[2]]: { status: 'approved' } })) });
    return true;
  };
  await page.goto(URL_('whats-new/'));
  t(await waitFor(page, () => document.querySelectorAll('#news-app .news-item').length === 1), 'one approved entry is shown');
  await sdkReady(page);
  await sleep(300);
  t(await page.locator('#news-app [data-act]').count() === 0 && await page.locator('#news-app .news-review').count() === 0, 'no admin controls for a member');
  t(!(await calls(page, 'fs.list')).some(c => c.args[0] === 'newsOverrides'), '… and the page does not read the decisions through their sign-in');
  await page.click('#acct-slot .acct-chip');
  t(await page.locator('#acct-menu a[href$="whats-new/"]').count() === 0, 'their account menu has no «Τι νέο: έγκριση»');
});

/* ---- «Στατιστικά» (analytics/): data/analytics.json (the visits, built by
   tools/build-analytics.mjs) and the members' anonymous statistics, read with
   one plain request to Firestore's REST address ---- */
const { buildFile } = await import(path.join(ROOT, 'tools/build-analytics.mjs'));
const MSTATS = createRequire(path.join(ROOT, 'functions', 'package.json'))('./member-stats.js');
const AN_TODAY = '2026-10-10';
const anDocs = {};
for (let i = 1; i <= 9; i++) {
  const d = '2026-10-0' + i;
  anDocs[d] = { seen: 5 + i, pv: 12 + i, pages: { '/': 8, '/blog/': 3 + i, other: 1 }, hours: { '09': 3, '21': 2 + i }, dev: { mobile: 3, desktop: 2 + i },
    ch: { search: 3, direct: 2 + i }, unis: { 'Εθνικό Μετσόβιο Πολυτεχνείο': 1 }, cos: i === 1 ? { 'Tiny Firm': 1, '<img src=x onerror="window.__xss=1">': 2 } : { 'Siemens AG': 1 }, placed: 2 };
}
const AN_FILE = buildFile({ site: { docs: anDocs }, titles: JSON.parse(read('functions/site-paths.json')).titles, today: AN_TODAY, generated: AN_TODAY,
  ga: { days: {}, windows: { 30: { countries: [{ k: 'GR', n: 40 }, { k: 'CY', n: 3 }], cities: [{ name: 'Athens', k: 'GR', n: 30 }, { name: 'London', k: 'GB', n: 2 }], sources: [{ name: 'google', n: 9 }] } } } });
const people = [];
for (let i = 0; i < 6; i++) people.push({ status: 'active', stage: 'graduate', gender: 'female', industry: 'software', entryYear: 2005, gradYear: 2011, city: 'Αθήνα', country: 'GR', employer: 'ACME', createdAt: new Date('2026-09-20') });
for (let i = 0; i < 4; i++) people.push({ status: 'pending', stage: 'graduate', gender: 'male', industry: 'finance', entryYear: 2012, gradYear: 2017, city: 'London, UK', employer: 'Solo ' + i, firstName: 'Γιώργος' + i, email: 'g' + i + '@x.gr', createdAt: new Date('2026-10-02') });
people.push({ status: 'active', stage: 'faculty', gender: 'other', industry: 'academia', city: 'Ζυρίχη', country: 'CH', createdAt: new Date('2026-10-03') });
const AN_MEMBERS = MSTATS.memberStats(people, new Date('2026-10-10T08:00:00Z'));
const anRoute = async (page, file) => page.route(u => u.href.endsWith('/data/analytics.json'), route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(file) }));

await scenario('T1', 'account page: e-mail alerts, chosen by kind, for the sign-in e-mail', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, status: 'pending' }) } }) }, async (page) => {
  await page.goto(URL_('account/#alerts'));
  const panel = page.locator('#account-app #alerts');
  t(await waitFor(page, () => !!document.querySelector('#account-app #alerts form[data-alerts]')), 'a member (application pending) sees «Ειδοποιήσεις με e-mail»');
  t(await waitFor(page, () => document.activeElement && document.activeElement.closest && !!document.activeElement.closest('#alerts')), 'arriving at account/#alerts lands on the card');
  const boxes = await page.$$eval('#alerts input[name=topic]', bs => bs.map(b => [b.value, b.checked]));
  t(js(boxes) === js([['announcements', false], ['events', false], ['site', false]]), 'three kinds, none chosen yet' + list([js(boxes)]));
  t(await hasText(panel, 'Ανακοινώσεις του Συλλόγου') && await hasText(panel, 'Εκδηλώσεις και συναντήσεις') && await hasText(panel, 'Νέα του ιστότοπου'), '… named as on the list in alert-topics.js');
  t(await hasText(panel, 'Τα e-mail πηγαίνουν στο ' + MARIA.email), 'it says the e-mails go to the sign-in address');
  await page.check('#al-announcements'); await page.check('#al-events');
  await page.click('#alerts [type=submit]');
  const w = (await waitCalls(page, 'fs.set', 1)).find(x => x.args[0] === 'alertPrefs/' + MARIA.uid);
  t(!!w, 'saving writes alertPrefs/{uid}');
  t(w && js(Object.keys(w.args[1]).sort()) === js(['email', 'topics', 'updatedAt']) && js(w.args[1].topics) === js(['announcements', 'events']) && w.args[1].email === MARIA.email,
    '… only topics, the sign-in e-mail and the time, as the rules allow' + list([js(w && w.args[1])]));
  t(w && w.args[2] && w.args[2].merge === true, '… merged, so the stop-link key the server keeps is never dropped');
  t(await hasText(panel, 'Αποθηκεύτηκε. Θα λαμβάνετε: Ανακοινώσεις του Συλλόγου, Εκδηλώσεις και συναντήσεις.'), 'the page confirms what will come');
  await page.reload();
  t(await waitFor(page, () => { const a = document.getElementById('al-announcements'), e = document.getElementById('al-events'), s = document.getElementById('al-site'); return a && a.checked && e && e.checked && s && !s.checked; }), 'after a reload the stored choice is ticked');
  await page.uncheck('#al-announcements'); await page.uncheck('#al-events');
  await page.click('#alerts [type=submit]');
  t(await waitFor(page, () => { const d = JSON.parse(localStorage.getItem('__fbfake')).docs['alertPrefs/u-maria']; return d && d.topics.length === 0; }), 'unticking everything and saving stops them');
  t(await hasText(panel, 'Δεν θα λαμβάνετε ειδοποιήσεις με e-mail.'), '… and says so');
  await page.click('.acct-chip');
  t(await page.locator('#acct-menu a[href$="account/#alerts"]').count() === 1, 'the account menu links to «Ειδοποιήσεις με e-mail»');
});

await scenario('T2', 'account page: the stop-link key is kept; no alerts card without an application or after a rejection', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ status: 'active' }),
    ['alertPrefs/' + MARIA.uid]: { topics: ['site'], email: MARIA.email, updatedAt: ts(Date.now() - DAY), k: 'K'.repeat(32) } } }) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await waitFor(page, () => { const s = document.getElementById('al-site'); return s && s.checked; }), 'the stored choice is shown');
  await page.check('#al-events');
  await page.click('#alerts [type=submit]');
  t(await waitFor(page, () => { const d = JSON.parse(localStorage.getItem('__fbfake')).docs['alertPrefs/u-maria']; return d && d.topics.join() === 'events,site'; }), 'a new choice is saved');
  t((await docOf(page, 'alertPrefs/' + MARIA.uid)).k === 'K'.repeat(32), '… and the server\'s stop-link key is still there');
  // a rejected application: no card
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('__fbfake')); s.docs['members/u-maria'].status = 'rejected'; localStorage.setItem('__fbfake', JSON.stringify(s)); });
  await page.reload();
  t(await waitFor(page, () => /δεν εγκρίθηκε/.test(document.getElementById('account-app').textContent)) && await page.locator('#account-app #alerts').count() === 0, 'a rejected application: no alerts card');
  // no application: the application form, no card
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('__fbfake')); delete s.docs['members/u-maria']; localStorage.setItem('__fbfake', JSON.stringify(s)); });
  await page.reload();
  t(await waitFor(page, () => !!document.querySelector('#account-app form[data-apply]')) && await page.locator('#account-app #alerts').count() === 0, 'no application yet: the form, and no alerts card');
});

await scenario('S1', '«Στατιστικά»: the visits by period, universities and companies, and the members\' anonymous statistics', { cfg: 'oidc' }, async (page, env) => {
  const rest = [];
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/v1/projects/')) return false;
    rest.push(url);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify(AN_MEMBERS) } } }) });
    return true;
  };
  await anRoute(page, AN_FILE);
  await page.goto(URL_('analytics/'));
  const app = page.locator('#analytics-app');
  t(await waitFor(page, () => document.querySelectorAll('#analytics-app .an-kpi').length >= 8), 'the visit figures and the members\' figures are both drawn');
  const w = AN_FILE.windows['30'];
  t(await hasText(app, w.visits.toLocaleString('el-GR')) && await hasText(app, 'Επισκέψεις'), `the last 30 days: ${w.visits} visits`);
  t(await page.locator('#analytics-app [data-range]').count() === 4 && (await page.getAttribute('#analytics-app [data-range="30"]', 'aria-pressed')) === 'true', 'four periods, «30 ημέρες» chosen');
  t(await page.locator('#analytics-app .an-chart svg').count() >= 3, 'the daily line and the column charts are drawn');
  t(await hasText(app, 'Εθνικό Μετσόβιο Πολυτεχνείο') && await hasText(app, 'Siemens AG'), 'universities and companies are listed');
  t(!(await hasText(app, 'Tiny Firm')) && await hasText(app, 'με μία επίσκεψη δεν κατονομάζονται'), 'a company with one visit is not named, and the page says how many were left out');
  t(await hasText(app, 'Ελλάδα') && await hasText(app, 'Κύπρος') && await hasText(app, 'Αθήνα') && await hasText(app, 'Λονδίνο (Ηνωμένο Βασίλειο)'), 'countries and cities from Google Analytics, in Greek');
  t(await hasText(app, 'Πηγή: Google Analytics') && await hasText(app, 'Πηγή: ο μετρητής του ιστότοπου'), 'each figure names its source');
  t(!(await xssFired(page)), 'an organisation name that is an <img onerror> is shown as text');
  // the pointer and the keyboard
  const line = page.locator('#analytics-app .an-line-svg');
  await line.scrollIntoViewIfNeeded();
  await sleep(700);                               // the page glides; a scroll hides the tooltip
  const box = await line.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  t(await waitFor(page, () => { const t = document.querySelector('.an-tip'); return t && !t.hidden && /επισκέψεις/.test(t.textContent); }), 'hovering the daily line shows that day\'s visits');
  await line.focus();
  await page.keyboard.press('Home');
  t(await waitFor(page, () => /1 Οκτωβρίου 2026/.test(document.querySelector('.an-tip').textContent)), '… and the arrow keys walk the days (Home = the first)');
  await page.mouse.move(0, 0);
  const cols = page.locator('#analytics-app .an-cols-svg').first();
  await cols.focus();
  await page.keyboard.press('End');
  t(await waitFor(page, () => { const t = document.querySelector('.an-tip'); return t && !t.hidden && /23:00/.test(t.textContent); }), 'a column chart is one keyboard stop; the arrow keys walk its columns (End = 23:00)');
  await page.keyboard.press('Tab');
  // another period
  await page.click('#analytics-app [data-range="all"]');
  t((await page.getAttribute('#analytics-app [data-range="all"]', 'aria-pressed')) === 'true' && await hasText(page.locator('#analytics-app .an-period').first(), '1 Οκτωβρίου 2026'), '«Από την αρχή» redraws everything from the first day');
  t(!(await hasText(app, 'Κύπρος')), '… and a figure the period has no source for is not drawn');
  // the members
  const meli = page.locator('#meli');
  t(await hasText(meli, 'Εγγεγραμμένοι') && await hasText(meli, '11'), 'the members: 11 registered');
  t(await hasText(meli, 'Γυναίκες') && await hasText(meli, 'Άνδρες') && await hasText(meli, 'Λοιπά (ομάδες κάτω από 3 ατόμων)'), 'gender, with the groups under 3 merged into «Λοιπά»');
  t(await hasText(meli, 'Πληροφορική & Λογισμικό') && await hasText(meli, 'ACME'), 'industry, and an employer with 3+ members');
  t(await page.evaluate(() => document.getElementById('meli').textContent.includes('2005–2009')) && await hasText(meli, '2005–09'), 'entry years in five-year periods («2005–09» under the column, «2005–2009» in its table)');
  t(!(await hasText(meli, 'Solo')) && !(await hasText(meli, 'Γιώργος')) && !(await hasText(meli, '@x.gr')), 'no name, e-mail or single person\'s employer appears');
  t(rest.length === 1 && rest[0].includes('/documents/publicStats/members') && rest[0].includes('key='), 'the members\' figures come from ONE plain request to Firestore');
  t(env.sdkUrls.length === 0, '… and the sign-in library is not loaded for a visitor');
  t(await page.locator('.nav-more-panel a[href$="analytics/"]').count() === 1 && await page.locator('.site-footer a[href$="analytics/"]').count() === 1, 'reachable from the menu («Ο ιστότοπος») and the footer');
});

await scenario('S2', '«Στατιστικά» before anything is measured: it says so, never an empty chart', { cfg: 'oidc' }, async (page, env) => {
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/')) return false;
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404,"status":"NOT_FOUND"}}' });
    return true;
  };
  await anRoute(page, buildFile({ site: { docs: {} }, ga: null, titles: JSON.parse(read('functions/site-paths.json')).titles, today: AN_TODAY, generated: AN_TODAY }));
  await page.goto(URL_('analytics/'));
  const app = page.locator('#analytics-app');
  t(await waitFor(page, () => /μόλις ξεκίνησαν/.test(document.getElementById('analytics-app').textContent) && /θα εμφανιστούν σύντομα/.test(document.getElementById('analytics-app').textContent)),
    'an empty file and a missing members document each give a sentence');
  t(await page.locator('#analytics-app .an-chart, #analytics-app .an-card').count() === 0, '… and no chart or card is drawn');
});

await scenario('S3', '«Στατιστικά» over years: the old site\'s Google Analytics history, by month and by week', { cfg: 'oidc' }, async (page, env) => {
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/')) return false;
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404,"status":"NOT_FOUND"}}' });
    return true;
  };
  // Google Analytics from 10 March 2024 (the old site, same address) to 30 September 2026, the site's own counter after
  const gaDays = {};
  for (let d = new Date('2024-03-10T12:00:00Z'), i = 0; d <= new Date('2026-09-30T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1), i++) gaDays[d.toISOString().slice(0, 10)] = [5 + (i % 7), 12];
  const file = buildFile({ site: { docs: anDocs }, titles: JSON.parse(read('functions/site-paths.json')).titles, today: AN_TODAY, generated: AN_TODAY,
    ga: { days: gaDays, windows: { all: { countries: [{ k: 'GR', n: 900 }] }, 365: { countries: [{ k: 'GR', n: 300 }] }, 30: { countries: [{ k: 'GR', n: 40 }] } } } });
  await anRoute(page, file);
  await page.goto(URL_('analytics/'));
  const app = page.locator('#analytics-app');
  t(await waitFor(page, () => document.querySelectorAll('#analytics-app .an-line-svg').length === 1), 'the line is drawn');
  t(await hasText(app, 'Έως 30 Σεπτεμβρίου 2026 από το Google Analytics, από 1 Οκτωβρίου 2026 από τον μετρητή του ιστότοπου'), 'a period that spans both counters says where the line changes source');
  t(await hasText(app, 'Τα νούμερα ανά ημέρα') && !(await hasText(app, 'Ο μέσος όρος κάθε')), '30 days stay day by day');
  await page.click('#analytics-app [data-range="365"]');
  t(await waitFor(page, () => /Ο μέσος όρος κάθε εβδομάδας/.test(document.getElementById('analytics-app').textContent)) && await hasText(app, 'Τα νούμερα ανά εβδομάδα'), '12 months are drawn by week, as visits per day');
  await page.click('#analytics-app [data-range="all"]');
  t(await waitFor(page, () => /Ο μέσος όρος κάθε μήνα/.test(document.getElementById('analytics-app').textContent)) && await hasText(app, 'Τα νούμερα ανά μήνα'), '«Από την αρχή» (two and a half years) is drawn by month');
  t(await hasText(page.locator('#analytics-app .an-period').first(), '10 Μαρτίου 2024'), '… from the first day Google Analytics measured');
  const pts = await page.evaluate(() => (document.querySelector('#analytics-app .an-line').getAttribute('d').match(/[ML]/g) || []).length);
  t(pts === 32, `one point per month, March 2024 to October 2026 (${pts})`);
  const line = page.locator('#analytics-app .an-line-svg');
  await line.scrollIntoViewIfNeeded();
  await sleep(700);
  await line.focus();
  await page.keyboard.press('Home');
  t(await waitFor(page, () => { const x = document.querySelector('.an-tip').textContent; return /Μάρτιος 2024 \(10–31 Μαρτίου 2024\)/.test(x) && /την ημέρα \(μέσος όρος\)/.test(x); }), 'a part month says which days it covers, and the value is visits per day');
  await page.keyboard.press('ArrowRight');
  t(await waitFor(page, () => { const x = document.querySelector('.an-tip').textContent; return /Απρίλιος 2024/.test(x) && !/Απρίλιος 2024 \(/.test(x) && /συνολικά/.test(x); }), 'a whole month is named alone, with its totals');
  await page.keyboard.press('End');
  t(await waitFor(page, () => /Οκτώβριος 2026 \(1–9 Οκτωβρίου 2026\)/.test(document.querySelector('.an-tip').textContent)), 'the last, part month ends yesterday');
});

await scenario('S4', '«Στατιστικά» with a stretch nothing measured: a break and a sentence, never "0 visits"', { cfg: 'oidc' }, async (page, env) => {
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/')) return false;
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404,"status":"NOT_FOUND"}}' });
    return true;
  };
  // the old site's tag: 1 April 2023 to 8 February 2024; the new site's counter from 1 October 2026
  const gaDays = {};
  for (let d = new Date('2023-04-01T12:00:00Z'); d <= new Date('2024-02-08T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) gaDays[d.toISOString().slice(0, 10)] = [4, 9];
  const titles = JSON.parse(read('functions/site-paths.json')).titles;
  const ga = { days: gaDays, windows: { all: { countries: [{ k: 'GR', n: 900 }] } } };
  // the morning the new counter has its first day
  await anRoute(page, buildFile({ site: { docs: {} }, ga, titles, today: '2026-10-01', generated: '2026-10-01' }));
  await page.goto(URL_('analytics/'));
  const app = page.locator('#analytics-app');
  t(await waitFor(page, () => /Δεν υπάρχουν μετρήσεις για αυτή την περίοδο\. Δείτε «Από την αρχή»/.test(document.getElementById('analytics-app').textContent)),
    'the last 30 days were not measured: it says so and points to «Από την αρχή», no "0 visits"');
  t(!(await hasText(app, '0 επισκέψεις')) && await page.locator('#analytics-app .an-kpi').count() === 0, '… and draws no figures for it');
  // ten days on (the newer route wins): both counters, the gap between them
  await anRoute(page, buildFile({ site: { docs: anDocs }, ga, titles, today: AN_TODAY, generated: AN_TODAY }));
  await page.reload();
  t(await waitFor(page, () => document.querySelectorAll('#analytics-app .an-line-svg').length === 1), 'the last 30 days: drawn from the first day the new counter measured');
  t(await hasText(page.locator('#analytics-app .an-period').first(), '1 Οκτωβρίου 2026'), '… and the period starts there, not inside the gap');
  await page.click('#analytics-app [data-range="all"]');
  t(await waitFor(page, () => /Από 9 Φεβρουαρίου 2024 έως 30 Σεπτεμβρίου 2026 δεν υπάρχουν μετρήσεις/.test(document.getElementById('analytics-app').textContent)), '«Από την αρχή» names the unmeasured stretch');
  const moves = await page.evaluate(() => (document.querySelector('#analytics-app .an-line').getAttribute('d').match(/M/g) || []).length);
  t(moves === 2, `the line is two pieces with a break between them (${moves})`);
  t(await page.evaluate(() => /χωρίς μετρήσεις/.test(document.querySelector('#analytics-app .an-wide .an-numbers').textContent)), 'the table says «χωρίς μετρήσεις» for the months in the gap');
  const line = page.locator('#analytics-app .an-line-svg');
  await line.scrollIntoViewIfNeeded();
  await sleep(700);
  await line.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');      // April 2023 + 12 = April 2024, inside the gap
  t(await waitFor(page, () => /Χωρίς μετρήσεις/.test(document.querySelector('.an-tip').textContent) && /Απρίλιος 2024/.test(document.querySelector('.an-tip').textContent)), 'a month in the gap reads «Χωρίς μετρήσεις», not 0');
});

/* ================================================================================== */
/* The announcement editor on blog/ (admins only)                                     */
/* ================================================================================== */
const FN_PUB = 'https://europe-west1-demo-semfe.cloudfunctions.net/publishAnnouncement';
function publishServer(env, handler) {
  env.pubCalls = [];
  const prev = env.onExternal;
  env.onExternal = async (route, url) => {
    if (url !== FN_PUB) return prev ? prev(route, url) : false;
    const req = route.request();
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST' };
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return true; }
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
    env.pubCalls.push({ body, auth: req.headers().authorization || '' });
    const out = await handler(body, env.pubCalls.length);
    if (out === 'abort') { await route.abort(); return true; }
    await route.fulfill({ status: out.status || 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(out.json || {}) });
    return true;
  };
}
const ADMIN_ACCT = () => acct('u-admin', { email: ADMIN, name: 'Διαχειριστής', verified: true, providers: ['google.com'] });
const ADMIN_OPTS = (extra) => Object.assign({ cfg: 'oidc', hint: { n: 'Διαχειριστής', p: '', e: ADMIN }, seed: signedInSeed(ADMIN_ACCT()) }, extra || {});
const pngOf = (page, w, h) => page.evaluate(([W, H]) => {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(W / 4, H / 4, W / 2, H / 2);
  return c.toDataURL('image/png').split(',')[1];
}, [w, h]).then(b => Buffer.from(b, 'base64'));
const bodyOf = page => page.$eval('[data-body]', t => t.value);
const select = (page, a, b) => page.evaluate(([x, y]) => { const t = document.querySelector('[data-body]'); t.focus(); t.setSelectionRange(x, y); }, [a, b]);
const selected = page => page.$eval('[data-body]', t => t.value.slice(t.selectionStart, t.selectionEnd));
const openEditor = async page => { await page.click('[data-announce-open]'); return visible(page.locator('[data-announce-box] .ed')); };

await scenario('P1', 'blog/: the editor is for a verified admin only, and a visitor never loads the sign-in library', { cfg: 'oidc' }, async (page, env) => {
  await page.goto(URL_('blog/'));
  await sleep(600);
  t(await page.locator('[data-announce]').isHidden(), 'a visitor sees no editor');
  t(env.sdkUrls.length === 0, 'the blog page does not load the sign-in library for a visitor who never signed in' + list(env.sdkUrls));
  t(await page.locator('.post-card').count() >= 1, '… and the announcements are listed as before');
});
await scenario('P2', 'blog/: a member (not an admin) and an UNVERIFIED admin address see no editor', { cfg: 'oidc', hint: { n: MARIA.name, p: '', e: MARIA.email }, seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('blog/'));
  t(await visible(page.locator('#acct-slot .acct-chip'), 8000), 'the member is signed in');
  await sleep(400);
  t(await page.locator('[data-announce]').isHidden() && !(await page.locator('[data-announce-open]').isVisible()), 'a member sees no «Νέα ανακοίνωση»');
});
// (as an e-mail + password account the same address would not even sign in, B; Facebook does not confirm it)
await scenario('P3', 'blog/: an admin address that was never confirmed sees no editor', { cfg: 'oidc', hint: { n: 'Ψεύτικος', p: '', e: ADMIN },
  seed: signedInSeed(acct('u-fake', { email: ADMIN, name: 'Ψεύτικος', verified: false, providers: ['facebook.com'] })) }, async (page) => {
  await page.goto(URL_('blog/'));
  t(await visible(page.locator('#acct-slot .acct-chip'), 8000), 'signed in');
  await sleep(400);
  t(await page.locator('[data-announce]').isHidden(), 'no editor for an unverified address');
});

await scenario('P4', 'blog/: the editor opens, checks the service, formats text with the toolbar and keeps a draft', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async b => b.action === 'status' ? { json: { ok: true, ready: true } } : { status: 400, json: { error: 'bad-request' } });
  await page.goto(URL_('blog/'));
  t(await visible(page.locator('[data-announce-open]'), 8000), 'a verified admin sees «Νέα ανακοίνωση»');
  t((await page.$eval('[data-announce-open]', b => b.getAttribute('aria-expanded'))) === 'false', '… collapsed at first');
  t(await openEditor(page), 'pressing it opens the editor');
  t(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'ed-title', '… with the title field focused');
  t(await waitFor(page, () => !document.querySelector('[data-send]').disabled), 'the service answers «ready»: Δημοσίευση is enabled');
  t(env.pubCalls.length === 1 && env.pubCalls[0].body.action === 'status' && /^Bearer fake-id-token\.u-admin\./.test(env.pubCalls[0].auth), 'the status call carried the admin\'s ID token');
  const cats = await page.$$eval('input[name="ed-cat"]', is => is.map(i => i.value));
  t(js(cats) === js(['Ανακοινώσεις', 'Εκδηλώσεις']), 'the two kinds of announcement are offered' + list(cats));
  const tools = await page.$$eval('[data-tool]', bs => bs.map(b => b.getAttribute('data-tool') + ':' + (b.getAttribute('aria-label') || '')));
  t(tools.length === 11 && tools.every(x => /:.+/.test(x)), 'every toolbar button has a name' + list(tools, 12));
  const tiny = await page.$$eval('[data-tool]', bs => bs.filter(b => b.getBoundingClientRect().height < 38).length);
  t(tiny === 0, 'every toolbar button is at least 38px tall');

  await page.fill('#ed-title', 'Πρόσκληση σε Γενική Συνέλευση');
  await page.fill('#ed-body', 'Γεια σου κόσμε');
  await select(page, 5, 8);
  await page.click('[data-tool="bold"]');
  t(await bodyOf(page) === 'Γεια **σου** κόσμε' && await selected(page) === 'σου', 'Έντονο wraps the selection and keeps it selected');
  await page.click('[data-tool="bold"]');
  t(await bodyOf(page) === 'Γεια σου κόσμε', '… and pressing it again takes the marks off');
  await select(page, 9, 14);
  await page.click('[data-tool="italic"]');
  t(await bodyOf(page) === 'Γεια σου *κόσμε*', 'Πλάγιο: *…*');
  await select(page, 10, 15);
  await page.click('[data-tool="link"]');
  t(await bodyOf(page) === 'Γεια σου *[κόσμε](https://)*' && await selected(page) === 'https://', 'Σύνδεσμος: [κείμενο](https://…) with the address selected for typing');
  await page.fill('#ed-body', 'α\nβ');
  await select(page, 0, 3);
  await page.click('[data-tool="ul"]');
  t(await bodyOf(page) === '- α\n- β', 'Λίστα: a bullet on each selected line');
  await page.click('[data-tool="ul"]');
  t(await bodyOf(page) === 'α\nβ', '… and again takes them off');
  await select(page, 0, 3);
  await page.click('[data-tool="ol"]');
  t(await bodyOf(page) === '1. α\n2. β', 'Αριθμημένη λίστα: 1. 2.');
  await page.fill('#ed-body', 'τίτλος');
  await select(page, 2, 2);
  await page.click('[data-tool="heading"]');
  t(await bodyOf(page) === '## τίτλος', 'Επικεφαλίδα: ## on the line');
  await page.click('[data-tool="heading"]');
  t(await bodyOf(page) === 'τίτλος', '… toggled off');
  await page.fill('#ed-body', 'λόγια');
  await select(page, 0, 5);
  await page.click('[data-tool="quote"]');
  t(await bodyOf(page) === '> λόγια', 'Παράθεμα: > on the line');
  await page.fill('#ed-body', 'α');
  await select(page, 1, 1);
  await page.click('[data-tool="rule"]');
  t(await bodyOf(page) === 'α\n\n---\n\n', 'Διαχωριστική γραμμή on a line of its own');
  await page.fill('#ed-body', 'Γεια');
  await select(page, 0, 4);
  await page.keyboard.press('Control+b');
  t(await bodyOf(page) === '**Γεια**', 'Ctrl+B works from the keyboard');
  await page.click('[data-tool="undo"]');
  t(await bodyOf(page) === 'Γεια', 'Αναίρεση undoes it');
  await page.click('[data-tool="redo"]');
  t(await bodyOf(page) === '**Γεια**', 'Επανάληψη redoes it');
  t(await hasText(page.locator('[data-count]'), '8 / 20000'), 'the counter shows the length against the limit');

  const tips = page.locator('[data-tipsbox]');
  t(await tips.isHidden(), 'the formatting tips are hidden at first');
  await page.click('[data-tips]');
  t(await visible(tips) && /\*\*έντονο\*\*/.test(await text(tips)) && /τελειώστε τη γραμμή με το σύμβολο \\/.test(await text(tips)), '«Συμβουλές μορφοποίησης» shows the cheat sheet, with the line-break rule');

  // the draft stays on this device
  await page.fill('#ed-body', 'Κείμενο που δεν πρέπει να χαθεί');
  await page.click('[data-announce-box] input[name="ed-cat"][value="Εκδηλώσεις"]');
  await sleep(500);
  await page.reload();
  await openEditor(page);
  t(await page.$eval('#ed-title', i => i.value) === 'Πρόσκληση σε Γενική Συνέλευση' && await bodyOf(page) === 'Κείμενο που δεν πρέπει να χαθεί', 'after a reload the title and the text are back');
  t(await page.$eval('input[name="ed-cat"][value="Εκδηλώσεις"]', i => i.checked), '… and the chosen kind');
  await page.click('[data-cancel]');
  t(await page.locator('[data-announce-box]').isHidden(), '«Ακύρωση» closes the editor');
  await openEditor(page);
  t(await bodyOf(page) === 'Κείμενο που δεν πρέπει να χαθεί', '… and the draft is still there when it is opened again');
});

await scenario('P5', 'blog/: the preview is the site\'s own rendering, and hostile text stays text', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async b => ({ json: { ok: true, ready: true } }));
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await page.fill('#ed-title', 'Προεπισκόπηση <b>τίτλος</b>');
  await page.fill('#ed-body', '## Θέματα\n\nΜια **έντονη** λέξη και ένα [σύνδεσμος](https://example.org).\n\n- ένα\n- δύο\n\n<script>window.__xss=1</script> <img src=x onerror=window.__xss=2> & {ένα}\n\n> παράθεμα');
  await page.click('#ed-tab-preview');
  const pv = page.locator('[data-preview]');
  t(await waitFor(page, () => !!document.querySelector('[data-preview] .ed-article'), null, 10000), 'the preview is drawn (the page builder\'s Markdown reader loaded in the browser)');
  t(await page.locator('[data-preview] h2').count() === 2 && await hasText(pv.locator('h2').nth(1), 'Θέματα'), '## Θέματα is a heading');
  t(await pv.locator('strong').count() === 1 && await pv.locator('li').count() === 2 && await pv.locator('blockquote').count() === 1, 'bold, a list and a quote are drawn');
  t(await pv.locator('a[href="https://example.org"]').count() === 1, 'the link is a link');
  t(await hasText(pv.locator('.ed-title'), 'Προεπισκόπηση τίτλος'), 'the title has no markup');
  t(await hasText(pv, '<script>window.__xss=1</script>') && await hasText(pv, '<img src=x onerror=window.__xss=2>'), 'a pasted tag is shown as text, never run');
  t(!(await xssFired(page)) && await pv.locator('script, img[onerror]').count() === 0, '… and nothing ran');
  t(await hasText(pv, '｛ένα｝') && await hasText(pv, '&'), 'braces become the full-width ｛ ｝ (no attribute or placeholder can be written), & is plain text');
  t(await hasText(pv.locator('.ed-address'), 'blog/'), 'it shows the address the announcement will have');
  await page.click('#ed-tab-write');
  await page.fill('#ed-body', 'Γράψτε {{root}} εδώ');
  await page.click('#ed-tab-preview');
  t(await hasText(pv, 'Μη γράφετε διπλές αγκύλες'), 'a "{{" is refused in the preview, in plain words');
});

await scenario('P6', 'blog/: pictures are shrunk, listed, sized, renumbered and shown in the preview', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async b => ({ json: { ok: true, ready: true } }));
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await page.fill('#ed-title', 'Εικόνες');
  await page.fill('#ed-body', 'Πριν');
  await select(page, 4, 4);
  const wide = await pngOf(page, 2400, 1200), tall = await pngOf(page, 600, 900);
  await page.setInputFiles('[data-file]', { name: 'afisa.png', mimeType: 'image/png', buffer: wide });
  t(await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 1), 'a picture is added and shows as a card');
  t(await bodyOf(page) === 'Πριν\n\n![](figure-1)\n\n', 'its line ![](figure-1) is put in the text at the cursor');
  const info = await page.$eval('.ed-fig', f => ({ name: f.querySelector('.ed-fig-name').textContent, size: f.querySelector('[data-size]').value, cover: f.querySelector('[data-cover]').checked, w: f.querySelector('img').src.length }));
  t(/Εικόνα 1/.test(info.name) && /afisa\.png/.test(info.name) && /KB/.test(info.name), 'the card names it and says how big it is now' + list([info.name]));
  t(info.size === 'full' && info.cover, 'a landscape picture is full width, and the first one is the card picture');
  const kb = await page.evaluate(() => { const m = document.querySelector('.ed-fig .ed-fig-name').textContent.match(/(\d+) KB/); return +m[1]; });
  t(kb > 0 && kb <= 520, `a 2400×1200 picture is shrunk to ${kb} KB`);
  await page.setInputFiles('[data-file]', { name: 'portrait.png', mimeType: 'image/png', buffer: tall });
  t(await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 2), 'a second picture');
  t(await page.$eval('[data-size="1"]', s => s.value) === 'medium', 'a portrait picture defaults to the medium width');
  t((await bodyOf(page)).includes('![](figure-2)'), '… with ![](figure-2) in the text');
  await page.fill('#ed-alt-1', 'Η αφίσα [της] εκδήλωσης');
  await page.selectOption('[data-size="0"]', 'small');
  await page.click('[data-cover="2"]');
  t(await page.$eval('[data-cover="2"]', r => r.checked) && !(await page.$eval('[data-cover="1"]', r => r.checked)), 'the card picture can be moved to the second');
  await page.setInputFiles('[data-file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  t(await hasText(page.locator('[data-note]'), 'αρχείο εικόνας'), 'a file that is not a picture is refused in plain words');
  t(await page.locator('.ed-fig').count() === 2, '… and not added');
  // the preview shows the real picture where its line is
  await page.click('#ed-tab-preview');
  const shown = await waitFor(page, () => document.querySelectorAll('[data-preview] img').length === 2, null, 10000);
  t(shown, 'the preview shows both pictures' + (shown ? '' : list([await page.$eval('[data-preview]', e => e.innerHTML.slice(0, 600)), await bodyOf(page)])));
  const imgs = await page.$$eval('[data-preview] img', is => is.map(i => ({ src: i.src.slice(0, 22), alt: i.alt, style: i.getAttribute('style') || '' })));
  t(imgs.every(i => i.src === 'data:image/jpeg;base64') && imgs[0].alt === 'Η αφίσα της εκδήλωσης' && /max-width:360px/.test(imgs[0].style) && /max-width:600px/.test(imgs[1].style), 'each with its description and width' + list(imgs.map(i => i.alt + ' ' + i.style)));
  // removing the first renumbers the second, and the card picture follows
  await page.click('#ed-tab-write');
  await page.click('[data-del="0"]');
  t(await page.locator('.ed-fig').count() === 1 && (await bodyOf(page)).includes('![](figure-1)') && !(await bodyOf(page)).includes('figure-2'), 'removing picture 1 renumbers picture 2 to 1, in the text too');
  t(await page.$eval('[data-cover="1"]', r => r.checked), '… and the card picture is still the same one');
  t(await hasText(page.locator('.ed-fig .ed-fig-name'), 'Εικόνα 1') && await hasText(page.locator('.ed-fig .ed-fig-name'), 'portrait.png'), '… the portrait');
  await page.fill('#ed-body', 'Χωρίς εικόνα στο κείμενο');
  await page.click('[data-announce-box] [data-tool="undo"]');
  await page.fill('#ed-body', 'Χωρίς εικόνα στο κείμενο');
  await page.click('[data-cover="0"]');
  t(await hasText(page.locator('.ed-fig-acts'), 'δεν θα δημοσιευτεί'), 'a picture that is neither in the text nor the card picture says it will not be published');
  // «Καμία εικόνα στην κάρτα» is a choice: a picture added later does not undo it
  await page.setInputFiles('[data-file]', { name: 'second.png', mimeType: 'image/png', buffer: await pngOf(page, 500, 300) });
  t(await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 2), 'another picture is added');
  t(await page.$eval('[data-cover="0"]', r => r.checked) && !(await page.$eval('[data-cover="2"]', r => r.checked)), '… and the card still has no picture: the admin\'s choice is kept');
  // the preview follows what is changed while it is open
  await page.fill('#ed-body', 'Κείμενο\n\n![](figure-1)\n\n![](figure-2)');
  await page.click('#ed-tab-preview');
  t(await waitFor(page, () => document.querySelectorAll('[data-preview] img').length === 2, null, 10000), 'the preview shows both pictures');
  await page.selectOption('[data-size="1"]', 'small');
  t(await waitFor(page, () => /max-width:360px/.test(document.querySelectorAll('[data-preview] img')[1].getAttribute('style') || ''), null, 4000), 'changing a picture\'s width refreshes the open preview');
  await page.fill('#ed-title', 'Νέος τίτλος');
  t(await waitFor(page, () => /Νέος τίτλος/.test(document.querySelector('[data-preview] .ed-title').textContent), null, 4000), '… and so does the title');
  await page.click('[data-del="1"]');
  t(await waitFor(page, () => document.querySelectorAll('[data-preview] img').length === 1, null, 4000), '… and removing a picture');
  t(await page.evaluate(() => !!document.activeElement && document.activeElement.hasAttribute('data-file')), 'after removing a picture the focus is on «επιλέξτε αρχεία», not lost');
});

await scenario('P11', 'blog/: a restored draft has no dangling picture lines, and a picture lands at the end of the text', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async b => ({ json: { ok: true, ready: true } }));
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await page.fill('#ed-title', 'Πρόχειρο');
  await page.fill('#ed-body', 'Πριν\n\n![Κάτι](figure-1)\n\nΜετά');
  await sleep(500);
  await page.reload();
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  t(await bodyOf(page) === 'Πριν\n\nΜετά', 'the lines of pictures (which are not kept) are taken out of a restored draft: «' + (await bodyOf(page)).replace(/\n/g, '⏎') + '»');
  t(await hasText(page.locator('[data-note]'), 'δεν αποθηκεύονται'), '… and it says so');
  // not focused: a picture still goes to the END
  await page.setInputFiles('[data-file]', { name: 'a.png', mimeType: 'image/png', buffer: await pngOf(page, 400, 300) });
  await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 1);
  t((await bodyOf(page)).startsWith('Πριν\n\nΜετά') && (await bodyOf(page)).includes('![](figure-1)'), 'a picture added to a restored draft is put after the text, not at the top: «' + (await bodyOf(page)).replace(/\n/g, '⏎') + '»');
});

await scenario('P12', 'blog/: another admin signs in while the box is open: THEIR draft, not the last one\'s', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async b => ({ json: { ok: true, ready: true, url: ORIGIN + SUB + 'blog/' } }));
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await page.fill('#ed-title', 'Του πρώτου διαχειριστή');
  await page.fill('#ed-body', 'Κείμενο του πρώτου');
  await sleep(500);
  const second = (C.ADMIN_EMAILS || [])[1];
  t(!!second, 'the site lists a second admin address');
  await server(page, 'setAccount', 'u-admin2', acct('u-admin2', { email: second, name: 'Δεύτερος', verified: true, providers: ['google.com'] }));
  await page.evaluate(() => window.__fb.server.switchTo('u-admin2'));
  t(await waitFor(page, () => document.querySelector('#ed-title') && document.querySelector('#ed-title').value === ''), 'the title field shows the second admin\'s (empty) draft');
  t(await bodyOf(page) === '', '… and so does the text: nothing of the first admin\'s is left to be sent under another name');
  await page.fill('#ed-title', 'Του δεύτερου'); await page.fill('#ed-body', 'Κείμενο του δεύτερου');
  await page.click('[data-send]');
  t(await visible(page.locator('[data-yes]')), 'publishing works for the second admin (the confirmation appears)');
  await page.click('[data-yes]');
  await waitFor(page, () => /Η ανακοίνωση στάλθηκε/.test(document.querySelector('[data-announce-box]').textContent));
  const pub = env.pubCalls.filter(c => c.body.action === 'publish');
  t(pub.length === 1 && pub[0].body.title === 'Του δεύτερου' && /\.u-admin2\./.test(pub[0].auth), 'the request carries the second admin\'s text and token');
  t(!!(await page.evaluate(() => localStorage.getItem('semfe:announce-draft:u-admin'))) === true, 'the first admin\'s draft is still kept under their own id');
});

await scenario('P13', 'blog/: keyboard and focus: tabs, card picture, removal, confirmation, and the box cannot be hidden while sending', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async (b, n) => { if (b.action === 'status') return { json: { ok: true, ready: true } }; await sleep(1200); return { json: { ok: true, url: ORIGIN + SUB + 'blog/' } }; });
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await waitFor(page, () => !document.querySelector('[data-send]').disabled);
  // tabs
  t(await page.$eval('#ed-tab-write', b => b.tabIndex) === 0 && await page.$eval('#ed-tab-preview', b => b.tabIndex) === -1, 'only the selected tab is in the Tab order');
  await page.focus('#ed-tab-write');
  await page.keyboard.press('ArrowRight');
  t(await page.evaluate(() => document.activeElement.id) === 'ed-tab-preview' && await page.$eval('#ed-tab-preview', b => b.getAttribute('aria-selected')) === 'true' && await page.locator('#ed-pane-preview').isVisible(), 'ArrowRight moves to «Προεπισκόπηση», selects it and shows it');
  await page.keyboard.press('ArrowLeft');
  t(await page.evaluate(() => document.activeElement.id) === 'ed-tab-write' && await page.locator('#ed-pane-write').isVisible(), 'ArrowLeft goes back');
  await page.keyboard.press('End'); await page.keyboard.press('Home');
  t(await page.evaluate(() => document.activeElement.id) === 'ed-tab-write', 'Home and End work');
  // card picture radios keep their focus
  await page.fill('#ed-title', 'Εστίαση'); await page.fill('#ed-body', 'Κείμενο');
  await page.setInputFiles('[data-file]', { name: 'a.png', mimeType: 'image/png', buffer: await pngOf(page, 400, 300) });
  await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 1);
  await page.setInputFiles('[data-file]', { name: 'b.png', mimeType: 'image/png', buffer: await pngOf(page, 400, 300) });
  await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 2);
  await page.focus('[data-cover="1"]');
  await page.keyboard.press('ArrowDown');
  t(await page.evaluate(() => document.activeElement.getAttribute('data-cover')) !== null && await page.evaluate(() => document.querySelector('[data-cover]:checked') && document.querySelector('[data-cover]:checked').getAttribute('data-cover')) === '2', 'ArrowDown on the card-picture buttons selects the next one…');
  t(await page.evaluate(() => document.activeElement.hasAttribute('data-cover')), '… and the focus stays on that group of buttons');
  // confirmation
  await page.click('[data-send]');
  t(await page.evaluate(() => document.activeElement.hasAttribute('data-yes')), 'the confirmation puts the focus on «Ναι, δημοσίευση»');
  await page.click('[data-no]');
  t(await waitFor(page, () => document.activeElement.hasAttribute('data-send')), '«Όχι, πίσω» puts it back on «Δημοσίευση»');
  // while sending, pressing «Νέα ανακοίνωση» must not hide the box
  await page.click('[data-send]'); await page.click('[data-yes]');
  await page.click('[data-announce-open]');
  t(await page.locator('[data-announce-box]').isVisible(), 'pressing «Νέα ανακοίνωση» while it is being sent does not hide the box');
  t(await waitFor(page, () => /Η ανακοίνωση στάλθηκε/.test(document.querySelector('[data-announce-box]').textContent), null, 8000) && await page.locator('[data-announce-box] .ed').isVisible(), 'the answer is visible when it arrives');
  t(await page.evaluate(() => document.activeElement.id) === 'ed-h', '… and the focus is on its heading, for a screen reader');
});



await scenario('P7', 'blog/: publishing: confirmation, the request, the success panel; and what each failure says', ADMIN_OPTS(), async (page, env) => {
  let mode = 'ok';
  publishServer(env, async (b, n) => {
    if (b.action === 'status') return { json: { ok: true, ready: true } };
    if (mode === 'ok') return { json: { ok: true, url: ORIGIN + SUB + 'blog/', path: '_src/posts/x.md', file: 'x.md', slug: 'x', date: '2026-10-05', commit: 'abc' } };
    if (mode === 'abort') return 'abort';
    return { status: 503, json: { error: mode } };
  });
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await waitFor(page, () => !document.querySelector('[data-send]').disabled);
  // empty
  await page.click('[data-send]');
  t(await hasText(page.locator('[data-note]'), 'Γράψτε τον τίτλο'), 'publishing nothing: «Γράψτε τον τίτλο.»');
  await page.fill('#ed-title', 'Κοπή πίτας 2026');
  await page.click('[data-send]');
  t(await hasText(page.locator('[data-note]'), 'Γράψτε το κείμενο'), '… then «Γράψτε το κείμενο της ανακοίνωσης.»');
  t(!env.pubCalls.some(c => c.body.action === 'publish'), '… and nothing is sent');
  await page.fill('#ed-body', 'Η κοπή της πίτας θα γίνει την Παρασκευή.');
  await select(page, 40, 40);
  await page.setInputFiles('[data-file]', { name: 'a.png', mimeType: 'image/png', buffer: await pngOf(page, 800, 500) });
  await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 1);
  await page.fill('#ed-alt-1', 'Η πίτα');
  await page.click('[data-announce-box] input[name="ed-cat"][value="Εκδηλώσεις"]');
  await page.click('[data-send]');
  t(await visible(page.locator('[data-yes]')) && await hasText(page.locator('[data-actions]'), 'Να δημοσιευτεί τώρα;') && await hasText(page.locator('[data-actions]'), 'Εκδηλώσεις'), 'Δημοσίευση asks first, naming the kind (it e-mails members)');
  t(!env.pubCalls.some(c => c.body.action === 'publish'), '… nothing is sent yet');
  await page.click('[data-no]');
  t(await visible(page.locator('[data-send]')), '«Όχι, πίσω» goes back to the form');
  await page.click('[data-send]');
  await page.click('[data-yes]');
  t(await waitFor(page, () => /Η ανακοίνωση στάλθηκε/.test(document.querySelector('[data-announce-box]').textContent)), 'after «Ναι» the success panel appears');
  const pub = env.pubCalls.filter(c => c.body.action === 'publish');
  t(pub.length === 1, 'exactly one publish request was sent');
  const b = pub[0].body;
  t(/^Bearer fake-id-token\.u-admin\./.test(pub[0].auth), '… carrying the ID token');
  t(b.title === 'Κοπή πίτας 2026' && b.category === 'Εκδηλώσεις' && b.cover === 1 && b.description === '', '… with the title, kind and card picture');
  t(b.body.trimEnd() === 'Η κοπή της πίτας θα γίνει την Παρασκευή.\n\n![Η πίτα](figure-1)', 'the picture\'s description became the alt text of its line' + list([b.body]));
  t(b.figures.length === 1 && b.figures[0].size === 'full' && /^\/9j\//.test(b.figures[0].data), 'the picture is sent as base64 JPEG' + list([JSON.stringify(b.figures[0]).slice(0, 60)]));
  t(await waitFor(page, () => !!document.querySelector('[data-wait] a[href]'), null, 9000), 'the panel waits for the page to exist and then links to it');
  t(!(await page.evaluate(() => localStorage.getItem('semfe:announce-draft:u-admin'))), 'the draft is cleared on this device');
  await page.click('[data-new]');
  t(await visible(page.locator('#ed-title')) && await page.$eval('#ed-title', i => i.value) === '' && await bodyOf(page) === '' && await page.locator('.ed-fig').count() === 0, '«Νέα ανακοίνωση» starts from an empty form');
  // failures
  await page.fill('#ed-title', 'Δεύτερη');
  await page.fill('#ed-body', 'Κείμενο');
  const fail = async (m, want) => {
    mode = m;
    await page.click('[data-send]'); await page.click('[data-yes]');
    const ok = await hasText(page.locator('[data-note]'), want, 5000);
    t(ok, `${m}: «${want}»` + (ok ? '' : list([await text(page.locator('[data-note]'))])));
    t(await page.$eval('#ed-body', x => x.value) === 'Κείμενο' && await visible(page.locator('[data-send]')), '… the text is still there and can be sent again');
  };
  await fail('not-set-up', 'δεν έχει ρυθμιστεί');
  await fail('github-token', 'Το κλειδί του GitHub έχει λήξει');
  await fail('github-repo', 'Το αποθετήριο ή ο κλάδος');
  await fail('not-admin', 'Μόνο οι διαχειριστές');
  await fail('github-error', 'κείμενό σας δεν χάθηκε');
  await fail('abort', 'Η υπηρεσία δημοσίευσης δεν απαντά');
  mode = 'ok';
  await page.click('[data-send]'); await page.click('[data-yes]');
  t(await waitFor(page, () => /Η ανακοίνωση στάλθηκε/.test(document.querySelector('[data-announce-box]').textContent)), 'and when the service is back, the same text goes through');
});

await scenario('P14', 'blog/: the success panel links at once and offers «Επεξεργασία»; an edit opens the published announcement and saves it back', ADMIN_OPTS(), async (page, env) => {
  const FILE = '2026-10-01-kopi-pitas-2026.md', URL1 = ORIGIN + SUB + 'blog/2026/10/01/kopi-pitas-2026/';
  const POST = { title: 'Κοπή πίτας 2026', category: 'Εκδηλώσεις', description: '', body: 'Η πίτα κόβεται την Παρασκευή & το Σάββατο.\n\n![](figure-1)', date: '2026-10-01', slug: 'kopi-pitas-2026', cover: 1,
    figures: [{ name: '2026-10-01-kopi-pitas-2026-1.jpg', ext: 'jpg', size: 'medium', alt: 'Η αφίσα' }] };
  let load = 'ok';
  publishServer(env, async b => {
    if (b.action === 'status') return { json: { ok: true, ready: true } };
    if (b.action === 'publish') return { json: { ok: true, url: URL1, file: FILE, path: '_src/posts/' + FILE, slug: 'kopi-pitas-2026', date: '2026-10-01', commit: 'c1' } };
    if (b.action === 'load') {
      if (load === 'old') return { status: 400, json: { error: 'bad-request' } };
      if (load === 'hand') return { json: { ok: true, editable: false, file: b.file, url: URL1, github: 'https://github.com/o/r/edit/main/_src/posts/' + b.file } };
      return { json: { ok: true, editable: true, file: FILE, sha: 'sha-1', url: URL1, raw: ORIGIN + SUB, post: POST } };
    }
    if (b.action === 'update') return { json: { ok: true, edited: true, url: URL1, file: FILE, path: '_src/posts/' + FILE, slug: 'kopi-pitas-2026', date: '2026-10-01', commit: 'c2' } };
    return { status: 400, json: { error: 'bad-request' } };
  });
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await waitFor(page, () => !document.querySelector('[data-send]').disabled);
  await page.fill('#ed-title', 'Κοπή πίτας 2026');
  await page.fill('#ed-body', 'Κείμενο που θα μείνει ως πρόχειρο;');
  await page.fill('#ed-body', 'Η πίτα κόβεται την Παρασκευή.');
  await page.click('[data-send]'); await page.click('[data-yes]');
  t(await waitFor(page, () => /Η ανακοίνωση στάλθηκε/.test(document.querySelector('[data-announce-box]').textContent)), 'sent');
  t(await page.$eval('[data-done-link]', a => a.href) === URL1 && await hasText(page.locator('[data-announce-box] .ed-link'), URL1), 'the address is a link at once, before the page exists');
  t(await page.locator('[data-announce-box] a.btn', { hasText: 'Δείτε την ανακοίνωση' }).count() === 1, '… with «Δείτε την ανακοίνωση»');
  t(await visible(page.locator('[data-edit-file="' + FILE + '"]')), '… and «Επεξεργασία»');

  // a draft of a NEW announcement is waiting on this device: an edit must leave it alone
  await page.evaluate(() => localStorage.setItem('semfe:announce-draft:u-admin', JSON.stringify({ title: 'Το πρόχειρό μου', category: 'Ανακοινώσεις', description: '', body: 'Μισογραμμένο.' })));
  await page.click('[data-edit-file="' + FILE + '"]');
  t(await waitFor(page, () => document.querySelector('#ed-title') && document.querySelector('#ed-title').value === 'Κοπή πίτας 2026'), '«Επεξεργασία» opens the published announcement in the editor');
  const loadReq = env.pubCalls.filter(c => c.body.action === 'load');
  t(loadReq.length === 1 && loadReq[0].body.file === FILE && /^Bearer /.test(loadReq[0].auth), '… asking the function for its file, with the ID token');
  t(await hasText(page.locator('#ed-h'), 'Επεξεργασία ανακοίνωσης') && await hasText(page.locator('.ed-editing'), 'blog/2026/10/01/kopi-pitas-2026/'), '… titled as an edit, naming the address it keeps');
  t(await bodyOf(page) === POST.body, '… the text as written (the & shown plainly)' + list([await bodyOf(page)]));
  t(await page.locator('.ed-fig').count() === 1 && await page.$eval('#ed-alt-1', i => i.value) === 'Η αφίσα' && await page.$eval('#ed-size-1', x => x.value) === 'medium' && await hasText(page.locator('.ed-fig'), 'ήδη δημοσιευμένη'), '… its picture listed, with its description and width');
  t(await page.$eval('input[name="ed-cat"]:checked', i => i.value) === 'Εκδηλώσεις' && await hasText(page.locator('[data-send]'), 'Αποθήκευση αλλαγών'), '… its kind, and «Αποθήκευση αλλαγών»');
  await page.fill('#ed-title', 'Κοπή πίτας 2026: νέα ώρα');
  await select(page, 0, 0);
  await page.setInputFiles('[data-file]', { name: 'b.png', mimeType: 'image/png', buffer: await pngOf(page, 600, 400) });
  await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 2);
  await page.click('[data-send]');
  t(await hasText(page.locator('[data-actions]'), 'Να αποθηκευτούν οι αλλαγές;') && await hasText(page.locator('[data-actions]'), 'Δεν στέλνεται ξανά e-mail'), 'it asks first, and says no e-mail goes out again');
  await page.click('[data-yes]');
  t(await waitFor(page, () => /Οι αλλαγές αποθηκεύτηκαν/.test(document.querySelector('[data-announce-box]').textContent)), 'after «Ναι» the panel says the changes are saved');
  const up = env.pubCalls.filter(c => c.body.action === 'update');
  t(up.length === 1, 'exactly one update request');
  const u = up[0].body;
  t(u.file === FILE && u.sha === 'sha-1' && u.title === 'Κοπή πίτας 2026: νέα ώρα' && u.category === 'Εκδηλώσεις' && u.cover === 1, '… naming the file and the version it changes' + list([JSON.stringify(Object.assign({}, u, { figures: u.figures.length, body: u.body.length }))]));
  t(u.figures.length === 2 && u.figures[0].existing === '2026-10-01-kopi-pitas-2026-1.jpg' && u.figures[0].data === undefined && /^\/9j\//.test(u.figures[1].data || ''), '… the published picture by its name, only the new one as data');
  t(/!\[Η αφίσα\]\(figure-1\)/.test(u.body) && /\]\(figure-2\)/.test(u.body), '… the text with both pictures' + list([u.body]));
  t(await page.$eval('[data-done-link]', a => a.href) === URL1 && await page.locator('[data-wait]').count() === 0, 'the same address, as a link (no waiting: the page exists already)');
  t(JSON.parse(await page.evaluate(() => localStorage.getItem('semfe:announce-draft:u-admin'))).title === 'Το πρόχειρό μου', 'the draft of the new announcement is still on this device');
  await page.click('[data-new]');
  t(await page.$eval('#ed-title', i => i.value) === 'Το πρόχειρό μου' && await hasText(page.locator('#ed-h'), 'Νέα ανακοίνωση'), '«Νέα ανακοίνωση» after an edit finds that draft');
  // one written by hand on GitHub, and a function not updated yet
  load = 'hand';
  await page.click('[data-cancel]');
  await page.goto(URL_('blog/?edit=2025-03-02-2025-taktiki-gs.md'));
  t(await waitFor(page, () => /γράφτηκε απευθείας στο GitHub/.test((document.querySelector('[data-announce-box]') || {}).textContent || ''), null, 9000), 'blog/?edit= of one written by hand: it does not open in the editor, and says why');
  t(await page.$eval('[data-announce-box] a[href^="https://github.com/"]', a => a.href) === 'https://github.com/o/r/edit/main/_src/posts/2025-03-02-2025-taktiki-gs.md', '… with a link to change it on GitHub');
  load = 'old';
  await page.goto(URL_('blog/?edit=' + FILE));
  t(await waitFor(page, () => /firebase deploy --only functions/.test((document.querySelector('[data-announce-box]') || {}).textContent || ''), null, 9000), 'a function not updated yet: the editor says what to run');
  load = 'ok';
  await page.goto(URL_('blog/?edit=' + FILE));
  t(await waitFor(page, () => document.querySelector('#ed-title') && document.querySelector('#ed-title').value === 'Κοπή πίτας 2026', null, 9000), 'blog/?edit=FILE opens it in the editor');
  t(!/[?&]edit=/.test(page.url()), '… and the address no longer asks for it (a reload does not reopen it)');
});

await scenario('P15', 'an announcement\'s page: «Επεξεργασία» for an admin only, leading to the editor', ADMIN_OPTS(), async (page) => {
  const posts = readdirSync(path.join(ROOT, '_src/posts')).filter(f => f.endsWith('.md')).sort();
  const file = posts[posts.length - 1], m = file.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
  await page.goto(URL_(`blog/${m[1]}/${m[2]}/${m[3]}/${m[4]}/`));
  t(await visible(page.locator('.post-admin a').first(), 8000), 'an admin sees «Επεξεργασία» under the announcement');
  t((await page.getAttribute('.post-admin a >> nth=0', 'href')).endsWith('blog/?edit=' + file), '… leading to blog/?edit=' + file);
  const del = page.locator('.post-admin a.btn-danger');
  t(await del.count() === 1 && await hasText(del, 'Διαγραφή') && (await del.getAttribute('href')).endsWith('blog/?delete=' + file), '… and «Διαγραφή» beside it, leading to blog/?delete=' + file + ' (which asks first)');
  t(/^[0-9a-f]{40}$/.test(await page.getAttribute('meta[name="semfe-source"]', 'content') || ''), 'the page carries the Git blob id of its source (how the editor sees the new version is online)');
});
await scenario('P16', 'an announcement\'s page: a visitor sees no «Επεξεργασία», and loads no sign-in library', { cfg: 'oidc' }, async (page, env) => {
  const posts = readdirSync(path.join(ROOT, '_src/posts')).filter(f => f.endsWith('.md')).sort();
  const m = posts[posts.length - 1].match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
  await page.goto(URL_(`blog/${m[1]}/${m[2]}/${m[3]}/${m[4]}/`));
  await sleep(600);
  t(await page.locator('.post-admin').isHidden(), 'no «Επεξεργασία» for a visitor');
  t(env.sdkUrls.length === 0, '… and the page did not load the sign-in library for it' + list(env.sdkUrls));
});

await scenario('P17', 'blog/?delete=FILE: it asks first, deletes on «Ναι», the card leaves the list at once, and the panel says when the page is gone', ADMIN_OPTS(), async (page, env) => {
  const posts = readdirSync(path.join(ROOT, '_src/posts')).filter(f => f.endsWith('.md')).sort();
  const FILE = posts[posts.length - 1], m = FILE.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
  const REL = `blog/${m[1]}/${m[2]}/${m[3]}/${m[4]}/`, PAGE = ORIGIN + SUB + REL;
  let mode = 'ok';
  publishServer(env, async b => {
    if (b.action === 'status') return { json: { ok: true, ready: true } };
    if (b.action === 'load') {
      if (mode === 'old') return { json: { ok: true, editable: false, file: b.file, url: PAGE, github: 'https://github.com/o/r/edit/main/_src/posts/' + b.file } };   // an older function: no version
      return { json: { ok: true, editable: false, file: b.file, sha: 'sha-9', title: 'Η ανακοίνωση «δοκιμή»', url: PAGE, github: 'https://github.com/x' } };
    }
    if (b.action === 'delete') {
      if (mode === 'changed') return { status: 409, json: { error: 'post-changed' } };
      return { json: { ok: true, deleted: true, url: PAGE, file: b.file, removed: ['_src/posts/' + b.file], commit: 'c9', blob: null } };
    }
    return { status: 400, json: { error: 'bad-request' } };
  });
  await page.goto(URL_('blog/?delete=' + FILE));
  t(await waitFor(page, () => !!document.querySelector('[data-del-yes]'), null, 9000), 'blog/?delete=FILE opens a question, not a deletion');
  t(await hasText(page.locator('#ed-h'), 'Διαγραφή ανακοίνωσης') && await hasText(page.locator('[data-announce-box] .notice.warn'), 'Η ανακοίνωση «δοκιμή»'), '… naming the announcement by its title');
  t(await hasText(page.locator('[data-announce-box] .notice.warn'), 'δεν ανακαλούνται') && await hasText(page.locator('[data-announce-box] .notice.warn'), 'ιστορικό του GitHub'), '… saying e-mails already sent stay sent, and how it comes back');
  t(env.pubCalls.filter(c => c.body.action === 'delete').length === 0, '… and nothing is deleted yet');
  t(!/[?&]delete=/.test(page.url()), '… the address no longer asks for it (a reload cannot delete)');
  await page.click('[data-announce-box] [data-close]');
  t(await page.locator('[data-announce-box]').isHidden() && env.pubCalls.filter(c => c.body.action === 'delete').length === 0, '«Όχι, ακύρωση» closes it, nothing deleted');

  // the function says it changed meanwhile
  mode = 'changed';
  await page.goto(URL_('blog/?delete=' + FILE));
  await waitFor(page, () => !!document.querySelector('[data-del-yes]'), null, 9000);
  await page.click('[data-del-yes]');
  t(await waitFor(page, () => /άλλαξε από άλλον στο μεταξύ, και δεν διαγράφηκε/.test(document.querySelector('[data-announce-box]').textContent)), 'changed by someone else meanwhile: it says so, and nothing was deleted');
  t(await page.locator('a.post-card[href$="' + REL + '"]').count() === 1, '… its card is still listed');

  // yes
  mode = 'ok';
  const earlier = env.pubCalls.filter(c => c.body.action === 'delete').length;   // the refused one above
  let checks = 0;
  await page.route(u => u.href.startsWith(PAGE + '?check='), r => { checks++; return checks < 2 ? r.fulfill({ status: 200, contentType: 'text/html', body: '<p>still there</p>' }) : r.fulfill({ status: 404, contentType: 'text/html', body: 'not found' }); });
  await page.goto(URL_('blog/?delete=' + FILE));
  await waitFor(page, () => !!document.querySelector('[data-del-yes]'), null, 9000);
  t(await page.locator('a.post-card[href$="' + REL + '"]').count() === 1, 'before: its card is in the list');
  await page.click('[data-del-yes]');
  t(await waitFor(page, () => /διαγράφηκε/.test(document.querySelector('[data-announce-box]').textContent)), 'after «Ναι, διαγραφή» the panel says it is deleted');
  const d = env.pubCalls.filter(c => c.body.action === 'delete').slice(earlier);
  t(earlier === 1 && d.length === 1 && d[0].body.file === FILE && d[0].body.sha === 'sha-9' && /^Bearer /.test(d[0].auth), 'one delete request, naming the file and the version that was shown, with the ID token');
  t(await page.locator('a.post-card[href$="' + REL + '"]').count() === 0, 'its card left the list on this page at once');
  t(await waitFor(page, () => /Η σελίδα αφαιρέθηκε από τον ιστότοπο/.test(document.querySelector('[data-announce-box]').textContent), null, 15000), '… and the panel says the moment the page answers «not found»');
  await page.unroute(u => u.href.startsWith(PAGE + '?check='));

  // an older function cannot say which version it is
  mode = 'old';
  await page.goto(URL_('blog/?delete=' + FILE));
  t(await waitFor(page, () => /firebase deploy --only functions/.test((document.querySelector('[data-announce-box]') || {}).textContent || ''), null, 9000), 'a function not updated yet: it says what to run, and offers no «Ναι»');
  t(await page.locator('[data-del-yes]').count() === 0, '… nothing to press');
});
await scenario('P18', 'the edit form has «Διαγραφή» too; and after a save the panel watches the real page until it is the new version', ADMIN_OPTS(), async (page, env) => {
  const FILE = '2026-10-01-kopi-pitas-2026.md', URL1 = ORIGIN + SUB + 'blog/2026/10/01/kopi-pitas-2026/', BLOB = 'a'.repeat(40);
  const POST = { title: 'Κοπή πίτας 2026', category: 'Εκδηλώσεις', description: '', body: 'Η πίτα.', date: '2026-10-01', slug: 'kopi-pitas-2026', cover: 0, figures: [] };
  publishServer(env, async b => {
    if (b.action === 'status') return { json: { ok: true, ready: true } };
    if (b.action === 'load') return { json: { ok: true, editable: true, file: FILE, sha: 'sha-1', url: URL1, raw: ORIGIN + SUB, post: POST, title: POST.title } };
    if (b.action === 'update') return { json: { ok: true, edited: true, url: URL1, file: FILE, path: '_src/posts/' + FILE, slug: 'kopi-pitas-2026', date: '2026-10-01', commit: 'c2', blob: BLOB } };
    if (b.action === 'delete') return { json: { ok: true, deleted: true, url: URL1, file: FILE, removed: ['_src/posts/' + FILE], commit: 'c3', blob: null } };
    return { status: 400, json: { error: 'bad-request' } };
  });
  let served = 0;
  await page.route(u => u.href.startsWith(URL1), r => {
    served++;
    const fresh = served >= 3;          // the old version twice, then the new one
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta name="semfe-source" content="' + (fresh ? BLOB : 'b'.repeat(40)) + '"><p>x</p>' });
  });
  await page.goto(URL_('blog/?edit=' + FILE));
  await waitFor(page, () => document.querySelector('#ed-title') && document.querySelector('#ed-title').value === 'Κοπή πίτας 2026', null, 9000);
  t(await visible(page.locator('[data-delete-ask]')) && await hasText(page.locator('[data-delete-ask]'), 'Διαγραφή'), 'the edit form offers «Διαγραφή»');
  await page.fill('#ed-title', 'Κοπή πίτας 2026: νέα ώρα');
  await page.click('[data-delete-ask]');
  t(await hasText(page.locator('[data-actions]'), 'Να διαγραφεί αυτή η ανακοίνωση;'), '… which asks first');
  await page.click('[data-no]');
  t(await page.$eval('#ed-title', i => i.value) === 'Κοπή πίτας 2026: νέα ώρα' && env.pubCalls.filter(c => c.body.action === 'delete').length === 0, '«Όχι, πίσω» returns to the form as it was, nothing deleted');
  await page.click('[data-send]'); await page.click('[data-yes]');
  t(await waitFor(page, () => /Οι αλλαγές αποθηκεύτηκαν/.test(document.querySelector('[data-announce-box]').textContent)), 'saved');
  t(await hasText(page.locator('[data-announce-box] .notice.ok'), 'λίγα δευτερόλεπτα'), 'the panel promises seconds, not minutes');
  t(await page.locator('[data-wait]').count() === 1, '… and watches the page');
  t(await waitFor(page, () => /Οι αλλαγές είναι online/.test(document.querySelector('[data-announce-box]').textContent), null, 20000), '… until the page carries the version just saved');
  t(served >= 3, 'the old version did not count as done (' + served + ' requests)');
  t(await page.locator('[data-announce-box] [data-delete-file="' + FILE + '"]').count() === 1, 'the success panel offers «Διαγραφή» too');
  await page.click('[data-announce-box] [data-delete-file="' + FILE + '"]');
  t(await waitFor(page, () => !!document.querySelector('[data-del-yes]'), null, 9000), '… which opens the question');
  await page.click('[data-del-yes]');
  t(await waitFor(page, () => /διαγράφηκε/.test(document.querySelector('[data-announce-box]').textContent)), 'deleted');
  t(env.pubCalls.filter(c => c.body.action === 'delete').length === 1 && env.pubCalls.find(c => c.body.action === 'delete').body.sha === 'sha-1', 'one delete request with the version it showed');
});

await scenario('P8', 'blog/: while publishing is not set up the editor still opens, and says so before anyone writes', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async b => ({ json: { ok: true, ready: false } }));
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  t(await hasText(page.locator('.ed .notice.warn'), 'δεν έχει ρυθμιστεί ακόμα') && await hasText(page.locator('.ed .notice.warn'), 'ANNOUNCE-SETUP.md'), 'a notice says publishing is not set up, and where the steps are');
  t(await page.$eval('[data-send]', b => b.disabled), '… Δημοσίευση is disabled');
  await page.fill('#ed-title', 'Δοκιμή'); await page.fill('#ed-body', 'κείμενο');
  await page.click('#ed-tab-preview');
  t(await waitFor(page, () => !!document.querySelector('[data-preview] .ed-article'), null, 10000), '… but the preview works');
});
await scenario('P9', 'blog/: the function is not deployed at all (no answer)', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async () => 'abort');
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  t(await hasText(page.locator('.ed .notice.warn'), 'δεν απαντά'), 'the notice says the service does not answer');
  t(await page.$eval('[data-send]', b => b.disabled), '… Δημοσίευση is disabled');
});
await scenario('P10', 'blog/: on a phone the editor fits the screen', ADMIN_OPTS({ viewport: { width: 360, height: 800 } }), async (page, env) => {
  publishServer(env, async () => ({ json: { ok: true, ready: true } }));
  await page.goto(URL_('blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await page.fill('#ed-body', 'Κείμενο');
  await page.setInputFiles('[data-file]', { name: 'a.png', mimeType: 'image/png', buffer: await pngOf(page, 800, 500) });
  await waitFor(page, () => document.querySelectorAll('.ed-fig').length === 1);
  await page.click('[data-tips]');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    over: Array.from(document.querySelectorAll('[data-announce-box] *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'absolute').length,
    small: Array.from(document.querySelectorAll('[data-announce-box] button, [data-announce-box] select, [data-announce-box] input[type=text]')).filter(e => e.getBoundingClientRect().height < 38 && e.getBoundingClientRect().height > 0).length }));
  t(m.sw <= m.cw, `no sideways scroll at 360px (${m.sw} vs ${m.cw})`);
  t(m.over === 0, 'nothing sticks out past the right edge');
  t(m.small === 0, 'every button, field and menu is at least 38px tall');
});

/* ================================================================================== */
/* Y. The English copy (en/). Every page script speaks English there and links the
   English pages; nothing Greek is left on screen except what people typed (the
   seeds below use Latin letters, so any Greek is the site's own) and what is
   marked lang="el" (the announcements, the Greek flag). */
const GREEK_RE = /[Ͱ-Ͽἀ-῿]/;
const greekLeft = (page, sel) => page.evaluate(([sel, src]) => {
  const G = new RegExp(src), out = [], root = document.querySelector(sel);
  if (!root) return ['(nothing matches ' + sel + ')'];
  const skip = el => !el || !!el.closest('[lang="el"], script, style, noscript, template');
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) if (G.test(n.nodeValue) && !skip(n.parentElement)) out.push(n.nodeValue.replace(/\s+/g, ' ').trim().slice(0, 70));
  for (const el of root.querySelectorAll('[aria-label], [title], [placeholder], [alt], input[type=submit], input[type=button]'))
    for (const a of ['aria-label', 'title', 'placeholder', 'alt', 'value']) { const v = el.getAttribute(a); if (v && G.test(v) && !skip(el)) out.push('@' + a + ': ' + v.slice(0, 60)); }
  if (G.test(document.title)) out.push('<title>: ' + document.title);
  return out;
}, [sel || 'body', GREEK_RE.source]);
// links to a page of the site that leave the English copy (the flags, files and the LinkedIn return page aside)
const greekLinks = page => page.evaluate(() => [...document.querySelectorAll('a[href]')].filter(a => !a.hasAttribute('data-lang') && a.origin === location.origin &&
  !/\/en\//.test(a.pathname) && !/\.(xml|json|pdf|png|jpe?g|webp|js|css|csv)$/i.test(a.pathname) && !/\/auth\/linkedin\//.test(a.pathname)).map(a => a.getAttribute('href')));
const EN_ACCT = (o) => acct('u-en', Object.assign({ email: 'maria@example.com', name: 'Maria Papadopoulou', providers: ['google.com'] }, o || {}));
const enMember = o => member(Object.assign({ firstName: 'Maria', lastName: 'Papadopoulou', email: 'maria@example.com', city: 'London', direction: 'Εφαρμοσμένη Φυσική' }, o));

await scenario('Y1', 'en/: the header, the sign-in dialog and the account menu speak English; a new user lands on en/account/#apply', { cfg: 'oidc' }, async (page, env) => {
  await page.goto(URL_('en/'));
  t((await text(page.locator('#acct-slot [data-signin]'))) === 'Sign in', 'the header button says «Sign in»');
  t(await openDialog(page), 'it opens the sign-in dialog');
  t((await calls(page, 'auth.languageCode=')).some(c => c.args[0] === 'en'), 'auth.languageCode is en: Firebase\'s own e-mails follow the page');
  t((await text(page.locator('#auth-title'))) === 'Sign in', 'the dialog title is «Sign in»');
  let g = await greekLeft(page, '.modal');
  t(g.length === 0, 'nothing Greek in the dialog' + list(g, 8));
  await page.click('#tab-register');
  g = await greekLeft(page, '.modal');
  t(g.length === 0, '… nor in its «New account» side' + list(g, 8));
  t(await page.$eval('.modal a[href*="privacy/"]', a => /\/en\/privacy\/$/.test(a.pathname)), 'its privacy link opens the English page');
  await page.fill('#auth-email', 'nope');
  await page.click('.modal [data-submit]');
  await sleep(150);
  g = await greekLeft(page, '.modal');
  t(g.length === 0, 'a validation message, in English' + list(g, 4) + list([await status(page) || '']));
  await page.click('#tab-signin');
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { uid: 'u-en', email: 'maria@example.com', displayName: 'Maria Papadopoulou', emailVerified: true } });
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'en/account/', { timeout: 8000 }).catch(() => {}), page.click('.modal [data-provider="google"]')]);
  const u = new URL(page.url());
  t(u.pathname === SUB + 'en/account/' && u.hash === '#apply', 'a new user lands on the ENGLISH account page, #apply' + list([page.url()]));
  t(await visible(page.locator('#account-app form[data-apply]')), 'the application form is shown');
  g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek on the application form' + list(g, 8));
  await page.click('#acct-slot .acct-chip');
  g = await greekLeft(page, '#acct-menu');
  t(g.length === 0, 'nothing Greek in the account menu' + list(g, 8));
  const gl = await greekLinks(page);
  t(gl.length === 0, 'every link on the page stays in English' + list(gl, 8));
});

await scenario('Y2', 'en/account/: an active member: labels, fee, alerts, sign-in methods, in English; stored values stay as they are', { cfg: 'oidc',
  seed: signedInSeed(EN_ACCT(), { docs: { 'members/u-en': enMember({ status: 'active', duesYears: [YEAR - 1], gradYear: 2013, employer: 'ACME', position: 'Data Scientist',
    country: 'GB', industry: 'software', gender: 'female', reviewedBy: ADMIN, reviewedAt: ts(Date.now() - DAY) }) } }) }, async (page) => {
  await page.goto(URL_('en/account/'));
  t(await hasText(page.locator('#account-app .profile-head'), 'Active member'), 'the badge says «Active member»');
  const kv = await text(page.locator('#account-app #apply'));
  t(/Applied Physics/.test(kv) && /United Kingdom/.test(kv) && /Woman/.test(kv) && /IT & software/.test(kv), 'the answers are shown in English (study track, country, gender, industry)' + list([kv.slice(0, 160)]));
  t(/€10/.test(kv), 'the fee reads «€10»');
  t(await visible(page.locator('#account-app [data-alerts], #account-app #alerts').first()) && await hasText(page.locator('#account-app'), 'Announcements of the Association'), 'the e-mail alerts card, its kinds in English');
  let g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek on the page' + list(g, 8));
  await page.click('#account-app [data-edit]');
  await sleep(150);
  g = await greekLeft(page, '#main');
  t(g.length === 0, '… nor in the edit form' + list(g, 8));
  const opt = await page.$eval('#f-direction', s => ({ v: s.value, label: s.options[s.selectedIndex].textContent }));
  t(opt.v === 'Εφαρμοσμένη Φυσική' && opt.label === 'Applied Physics', 'the study track keeps its stored value, shown in English' + list([js(opt)]));
  const gl = await greekLinks(page);
  t(gl.length === 0, 'every link stays in English' + list(gl, 8));
});

await scenario('Y3', 'en/members/: the members\' area and the directory in English', { cfg: 'oidc',
  seed: signedInSeed(EN_ACCT(), { docs: {
    'members/u-en': enMember({ status: 'active', duesYears: [YEAR] }),
    'directory/u-en': dirEntry({ name: 'Maria Papadopoulou', gradYear: 2013, direction: 'Εφαρμοσμένη Φυσική', employer: 'ACME', city: 'London, Ηνωμένο Βασίλειο' }),
    'directory/x2': dirEntry({ name: 'John Smith', gradYear: 2001, direction: 'Εφαρμοσμένα Μαθηματικά', employer: 'Example Ltd', city: 'Athens' }) } }) }, async (page) => {
  await page.goto(URL_('en/members/'));
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 2), 'the directory lists the two members');
  // the place line is STORED in Greek (written by account.js); a reader of the English page reads it in English
  const g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek on the page, the stored study track and country shown in English' + list(g, 8));
  await page.fill('#dir-q', 'physics');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1), 'searching «physics» finds the member whose study track is Applied Physics');
  const gl = await greekLinks(page);
  t(gl.length === 0, 'every link stays in English' + list(gl, 8));
});

const EN_ADMIN_SEED = signedInSeed(acct('u-admin', { email: ADMIN, name: 'Admin' }), { docs: {
  'members/p1': member({ firstName: 'Nikos', lastName: 'Karalis', email: 'nikos@example.com', city: 'Athens', status: 'pending', createdAt: ts(Date.now() - 2 * DAY), consentNewsletter: true }),
  'members/a1': member({ firstName: 'Anna', lastName: 'Zafeiriou', email: 'anna@example.com', city: 'Patras', country: 'GR', industry: 'finance', status: 'active', duesYears: [YEAR - 1], createdAt: ts(Date.now() - 30 * DAY) }),
  'feedback/SEMFE-260930-AB23': { ticket: 'SEMFE-260930-AB23', uid: 'u-x', email: 'x@example.com', name: 'Some One', kind: 'bug', message: 'The page breaks', page: '', status: 'open', createdAt: ts(Date.now() - DAY) }
} });
await scenario('Y4', 'en/admin/: the admin page in English', { cfg: 'oidc', seed: EN_ADMIN_SEED }, async (page) => {
  await page.goto(URL_('en/admin/'));
  t(await waitFor(page, () => document.querySelectorAll('#admin-app .tile').length >= 4, null, 8000), 'the summary tiles are drawn');
  await sleep(600);
  const g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek on the admin page' + list(g, 10));
  const gl = await greekLinks(page);
  t(gl.length === 0, 'every link stays in English' + list(gl, 8));
});

await scenario('Y5', 'en/feedback/ and en/whats-new/ in English (a «Τι νέο» entry in its English words)', { cfg: 'oidc', seed: signedInSeed(EN_ACCT(), { docs: { 'members/u-en': enMember({ status: 'active' }) } }) }, async (page, env) => {
  await page.goto(URL_('en/feedback/'));
  t(await visible(page.locator('#feedback-app form, #feedback-app textarea').first(), 8000), 'the feedback form is shown');
  let g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek on the feedback page' + list(g, 8));
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/')) return false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(restDocs({ [NEWS_IDS[0]]: { status: 'approved' }, [NEWS_IDS[1]]: { status: 'approved' } })) });
    return true;
  };
  await page.goto(URL_('en/whats-new/'));
  t(await waitFor(page, () => document.querySelectorAll('#news-app .news-item').length === 2), 'the two approved entries are shown');
  const titles = await newsTitles(page);
  t(js(titles) === js([NEWS_LOG[0].en.title, NEWS_LOG[1].en.title]), 'in their English words (changelog.json, en)' + list(titles));
  g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek on the page' + list(g, 8));
});

await scenario('Y6', 'en/analytics/: the statistics in English, page and place names included', { cfg: 'oidc' }, async (page, env) => {
  env.onExternal = async (route, url) => {
    if (!url.startsWith('https://firestore.googleapis.com/v1/projects/')) return false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify(AN_MEMBERS) } } }) });
    return true;
  };
  const sp = JSON.parse(read('functions/site-paths.json'));
  await anRoute(page, buildFile({ site: { docs: anDocs }, titles: sp.titles, titlesEn: sp.titlesEn, today: AN_TODAY, generated: AN_TODAY,
    ga: { days: {}, windows: { 30: { countries: [{ k: 'GR', n: 40 }, { k: 'CY', n: 3 }], cities: [{ name: 'Athens', k: 'GR', n: 30 }, { name: 'London', k: 'GB', n: 2 }], sources: [{ name: 'google', n: 9 }] } } } }));
  await page.goto(URL_('en/analytics/'));
  t(await waitFor(page, () => document.querySelectorAll('#analytics-app .an-kpi').length >= 8), 'the visit figures and the members\' figures are drawn');
  await sleep(300);
  const app = page.locator('#analytics-app');
  t(await hasText(app, 'National Technical University of Athens') && await hasText(app, 'Greece') && await hasText(app, 'Home'), 'a Greek university, the countries and the page names in English');
  const g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek on the page' + list(g, 10));
});

await scenario('Y7', 'en/blog/: the editor in English for an admin; what is published stays Greek', ADMIN_OPTS(), async (page, env) => {
  publishServer(env, async b => ({ json: { ok: true, ready: true } }));
  await page.goto(URL_('en/blog/'));
  await visible(page.locator('[data-announce-open]'), 8000);
  await openEditor(page);
  await page.click('[data-tips]').catch(() => {});
  const g = await greekLeft(page, '#main');
  t(g.length === 0, 'nothing Greek in the editor (the announcements listed below are marked lang="el")' + list(g, 10));
  const cats = await page.$$eval('[data-announce-box] select option, [data-announce-box] input[type=radio]', es => es.map(e => e.value));
  t(cats.includes('Ανακοινώσεις') && cats.includes('Εκδηλώσεις'), 'the categories keep their stored (Greek) values' + list(cats));
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) { console.log('\nFailures:\n  ' + failed.join('\n  ')); }
process.exit(fails ? 1 : 0);
