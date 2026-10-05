#!/usr/bin/env node
/* SEMFE Alumni: moving the site to its own address (semfealumni.gr).
 *
 * Built for the first move, from the preview at https://www.stouras.com/semfealumni/
 * to semfealumni.gr (done on 1 October 2026; MIGRATION.md is the record). Every
 * page link is relative and every tool reads the address from ONE setting,
 * `siteUrl` in assets/js/config.js, so a move is: prepare the outside services
 * ahead of time, then switch that one setting and point the domain. This tool
 * does the repository's part and checks the rest. Moving the repository into
 * the GitHub organisation, and the domain with it, is a different job:
 * MOVE-TO-ORG.md (its Part C is the order of the GitHub and DNS steps).
 *
 *   node tools/migrate.mjs --plan      [url]   what would change, and every outside step (writes nothing)
 *   node tools/migrate.mjs --rehearse  [url]   a copy of the site switched to the new address, built,
 *                                              and tested there (check + smoke; --full adds the sign-in
 *                                              flows); the repository is untouched
 *   node tools/migrate.mjs --prep-check [url]  asks the live Cloud Functions whether they already accept
 *                                              the new address (network; run after the "before" steps)
 *   node tools/migrate.mjs --apply     [url]   the switch itself: siteUrl, search engines allowed
 *                                              (--keep-noindex to wait), rebuild (writes CNAME and
 *                                              robots.txt), redraw the share pictures; then commit
 *   node tools/migrate.mjs --verify    [url]   after the DNS change: the new address, HTTPS, the pages,
 *                                              the old addresses forwarding (network)
 *
 * [url] defaults to https://semfealumni.gr/ */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'assets/js/config.js', BUILD = 'tools/build.mjs';
const args = process.argv.slice(2);
const mode = (args.find(a => /^--(plan|rehearse|prep-check|apply|verify)$/.test(a)) || '--plan').slice(2);
const target = normUrl(args.find(a => /^https?:\/\//.test(a)) || 'https://semfealumni.gr/');
const read = (f, root) => readFileSync(path.join(root || ROOT, f), 'utf8');
const C = new Function('window', read(CONFIG) + '; return window.SEMFE;')({});
const current = normUrl(C.siteUrl);
const T = new URL(target), O = new URL(current);
const PROJECT = JSON.parse(read('.firebaserc')).projects.default;
const FN = (name) => 'https://europe-west1-' + PROJECT + '.cloudfunctions.net/' + name;

function normUrl(u) { const x = new URL(u); if (x.protocol !== 'https:') throw new Error('the address must be https: ' + u); x.hash = ''; x.search = ''; return x.href.replace(/\/?$/, '/'); }
function originsOf(u) {
  const h = new URL(u).hostname, bare = h.replace(/^www\./, '');
  return ['https://' + bare, 'https://www.' + bare].filter((v, i, a) => a.indexOf(v) === i);
}
function hostsOf(u) { return originsOf(u).map(o => new URL(o).hostname); }

/* ---- the repository's side ----------------------------------------------- */
function indexable() { return T.pathname === '/' && !args.includes('--keep-noindex'); }
function switchRepo(root, url, index) {
  const cfgPath = path.join(root, CONFIG);
  const cfg = readFileSync(cfgPath, 'utf8');
  const re = /(siteUrl:\s*')[^']*(')/;
  if (!re.test(cfg)) throw new Error(CONFIG + ': no siteUrl line to change');
  writeFileSync(cfgPath, cfg.replace(re, '$1' + url + '$2'));
  // search engines: allowed at the new address (it is the official site from
  // then on), kept away with --keep-noindex, and always kept away from a preview
  const bPath = path.join(root, BUILD), b = readFileSync(bPath, 'utf8');
  if (!/const INDEXABLE = (true|false);/.test(b)) throw new Error(BUILD + ': no INDEXABLE line');
  writeFileSync(bPath, b.replace(/const INDEXABLE = (true|false);/, 'const INDEXABLE = ' + !!index + ';'));
  run(process.execPath, [path.join(root, 'tools/build.mjs')], root);
}
function run(cmd, argv, cwd, quiet) {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', env: process.env });
  if (r.status !== 0) { if (quiet) process.stdout.write((r.stdout || '') + (r.stderr || '')); throw new Error(argv.slice(0, 2).join(' ') + ' failed (exit ' + r.status + ')'); }
  return r.stdout || '';
}

/* ---- everything outside the repository, with the exact values ---------- */
function steps() {
  const newOrigins = originsOf(target), oldOrigins = originsOf(current);
  const origins = [...new Set([...oldOrigins, ...newOrigins])].join(',');
  const redirects = [...new Set([current + 'auth/linkedin/', target + 'auth/linkedin/'])].join(',');
  const apex = T.hostname.replace(/^www\./, '');
  // "keep the old one" only makes sense while the address changes: when the
  // site already uses the target there is no old address to keep
  const moving = current !== target;
  const oldHosts = hostsOf(current).filter(h => !hostsOf(target).includes(h));
  return {
    before: [
      'Firebase console > Authentication > Settings > Authorized domains: add ' + hostsOf(target).join(' and ') + (oldHosts.length ? ' (keep ' + oldHosts.join(', ') + ' until the move is done).' : '.'),
      'LinkedIn developer app > Auth > Authorized redirect URLs: ADD ' + target + 'auth/linkedin/' + (moving ? ' (keep the old one for now).' : '.'),
      'functions/.env.' + PROJECT + ' on the computer that deploys: set these two lines' + (moving ? ' (both addresses, so sign-in works on each during the move)' : '') + ', then `firebase deploy --only functions --project ' + PROJECT + '`:\n' +
        '        ALLOWED_ORIGINS=' + origins + '\n' +
        '        LINKEDIN_REDIRECT_URIS=' + redirects,
      'Check: `node tools/migrate.mjs --prep-check ' + target + '` answers "accepted" for both functions.',
      'Rehearse: `node tools/migrate.mjs --rehearse ' + target + '` passes.',
      'The domain on GitHub: the code lives in the organisation semfealumni (semfealumni/semfealumni.github.io), so the domain is verified in that organisation and used by that repository. ' +
        'GitHub lets one repository use a domain at a time, so the order of the GitHub and DNS steps matters: MOVE-TO-ORG.md, Part C.'
    ],
    day: [
      '`node tools/migrate.mjs --apply ' + target + '`, look at the share pictures, commit and push (the build writes CNAME = ' + T.hostname + ').',
      'The old repository: Settings > Pages > Custom domain: Remove. (When the domain moves into the organisation, this step and the next have their own order: MOVE-TO-ORG.md, Part C, On the day. Follow that.)',
      'This repository: Settings > Pages > Custom domain: ' + T.hostname + ' > Save (GitHub finds the CNAME file too).',
      'DNS at the .gr registrar (only if the domain does not already point at GitHub Pages; semfealumni.gr already does, so usually nothing changes):\n' +
        '        ' + apex + '  A     185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153\n' +
        '        ' + apex + '  AAAA  2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153\n' +
        '        www.' + apex + '  CNAME  semfealumni.github.io.   (the GitHub organisation that owns this repository: MOVE-TO-ORG.md, Part C)',
      'When GitHub shows the certificate is ready (minutes to an hour): tick Enforce HTTPS.',
      'functions/.env.' + PROJECT + ': SITE_URL=' + target + ' (the links in the feedback e-mails), then `firebase deploy --only functions --project ' + PROJECT + '`.',
      '`node tools/migrate.mjs --verify ' + target + '`.'
    ],
    after: [
      'After a few weeks: remove the old address from Authorized domains, the LinkedIn redirect URL and ALLOWED_ORIGINS / LINKEDIN_REDIRECT_URIS (deploy the functions again).',
      'Google Search Console: add ' + target + ' and submit ' + target + 'sitemap.xml.',
      'Optional: the LinkedIn app\'s privacy policy link, and the Google sign-in consent screen\'s home page / privacy links, to the new address.'
    ]
  };
}
function printSteps() {
  const s = steps();
  const list = (title, l) => { console.log('\n' + title); l.forEach((x, i) => console.log('  ' + (i + 1) + '. ' + x)); };
  list('BEFORE the move (any time, nothing visible changes):', s.before);
  list('ON THE DAY:', s.day);
  list('AFTER:', s.after);
}

/* ---- network checks ------------------------------------------------------ */
async function get(url, opts) {
  try {
    const r = await fetch(url, Object.assign({ redirect: 'manual', signal: AbortSignal.timeout(20000) }, opts || {}));
    return { status: r.status, location: r.headers.get('location') || '', headers: r.headers, text: opts && opts.method === 'OPTIONS' ? '' : await r.text() };
  } catch (e) { return { status: 0, error: String(e && e.cause && e.cause.code || e.message || e) }; }
}
let bad = 0;
const ok = m => console.log('ok    ' + m), fail = m => { bad++; console.log('FAIL  ' + m); }, note = m => console.log('note  ' + m);

async function prepCheck() {
  for (const origin of originsOf(target)) {
    for (const name of ['linkedinSignIn', 'accounts']) {
      const r = await get(FN(name), { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
      const allow = r.headers && r.headers.get('access-control-allow-origin');
      if (r.status === 204 && allow === origin) ok(name + ' accepts ' + origin);
      else if (r.status === 0) fail(name + ': no answer (' + r.error + ')');
      else if (r.status === 404) fail(name + ': not deployed (404)');
      else fail(name + ' does not accept ' + origin + ' yet (HTTP ' + r.status + '): set ALLOWED_ORIGINS and deploy the functions');
    }
  }
  // the LinkedIn redirect: the function refuses an address it does not know before calling LinkedIn
  const r = await get(FN('linkedinSignIn'), { method: 'POST', headers: { Origin: originsOf(target)[0], 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'migrate-check', redirectUri: target + 'auth/linkedin/' }) });
  let err = ''; try { err = JSON.parse(r.text || '{}').error || ''; } catch (e) {}
  if (err === 'redirect-not-allowed') fail('linkedinSignIn does not know ' + target + 'auth/linkedin/ yet: set LINKEDIN_REDIRECT_URIS and deploy the functions');
  else if (r.status) ok('linkedinSignIn knows the redirect ' + target + 'auth/linkedin/ (answer to a made-up code: ' + (err || r.status) + ')');
  note('Firebase Authorized domains and the LinkedIn app\'s own redirect list cannot be read from here: check them in their consoles.');
}

async function verify() {
  const pages = ['', 'organa/', 'governance/', 'how_we_started/', 'blog/', 'support/', 'contact/', 'account/', 'feedback/', 'privacy/'];
  for (const p of pages) {
    const r = await get(target + p);
    if (r.status === 200 && /<html lang="el">/.test(r.text)) ok(target + p + ' 200');
    else fail(target + p + ' -> ' + (r.status || r.error) + (r.location ? ' ' + r.location : ''));
  }
  const home = await get(target);
  if (home.status === 200) {
    const canon = (home.text.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    if (canon === target) ok('the pages name ' + target + ' as their address'); else fail('canonical is ' + canon + ', not ' + target + ' (was --apply pushed?)');
    if (/<meta name="robots" content="noindex">/.test(home.text)) note('the home page is still noindex (search engines kept away)');
  }
  const cname = await get(target + 'CNAME');
  if (cname.status === 200 && cname.text.trim() === T.hostname) ok('CNAME = ' + T.hostname); else fail('CNAME is not served as ' + T.hostname);
  const robots = await get(target + 'robots.txt');
  if (robots.status === 200 && robots.text.includes('Sitemap: ' + target + 'sitemap.xml')) ok('robots.txt names the sitemap'); else fail('robots.txt missing or wrong');
  const http = await get(target.replace('https:', 'http:'));
  if (http.status >= 300 && http.status < 400 && /^https:/.test(http.location)) ok('http:// forwards to https:// (Enforce HTTPS is on)'); else fail('http:// does not forward to https:// yet: tick Enforce HTTPS when the certificate is ready');
  const other = originsOf(target).find(o => o + '/' !== target);
  if (other) {
    const r = await get(other + '/');
    if (r.status >= 300 && r.status < 400 && r.location.replace(/\/?$/, '/').startsWith(target)) ok(other + ' forwards to ' + target);
    else fail(other + ' -> ' + (r.status || r.error) + ' (add its DNS record: see MIGRATION.md)');
  }
  // the earlier site's addresses keep working
  for (const [from, want] of [['blog/category/ανακοινώσεις/', 'blog/?cat='], ['blog/archive/2025/', 'blog/']]) {
    const r = await get(target + encodeURI(from));
    if (r.status === 200 && r.text.includes('http-equiv="refresh"') && r.text.includes(want.split('?')[0])) ok('the old ' + from + ' forwards to ' + want);
    else fail('the old ' + from + ' -> ' + (r.status || r.error));
  }
  const pdf = await get(target + 'assets/docs/foundation/katastatiko.pdf', { method: 'HEAD' });
  if (pdf.status === 200) ok('the statute PDF is at its new address'); else fail('assets/docs/foundation/katastatiko.pdf -> ' + pdf.status);
  note('the old PDF address ' + target + 'assets/documents/foundation/katastatiko.pdf reaches the not-found page, whose script forwards it (a browser follows it; this check cannot run scripts)');
  // the preview address
  if (O.href !== T.href) {
    const r = await get(current);
    if (r.status >= 300 && r.status < 400 && r.location.startsWith(target)) ok('the old preview ' + current + ' forwards to ' + target);
    else note('the old preview ' + current + ' -> ' + (r.status || r.error) + (r.location ? ' ' + r.location : '') + ' (GitHub forwards it once the custom domain is set; if not, it can simply go away)');
  }
  await prepCheck();
}

/* ---- modes --------------------------------------------------------------- */
console.log('site address now: ' + current + '\nnew address:      ' + target);
if (mode === 'plan') {
  if (current === target) console.log('\nThe site already uses ' + target + '.');
  console.log('\nIn the repository (--apply does these):');
  console.log('  - ' + CONFIG + ': siteUrl = \'' + target + '\'');
  console.log('  - ' + BUILD + ': INDEXABLE = ' + indexable() + (indexable() ? ' (search engines allowed; --keep-noindex to wait)' : ' (search engines kept away)'));
  console.log('  - the build writes CNAME (' + T.hostname + ') and robots.txt, and every page\'s canonical / og:url / sitemap moves to ' + target);
  console.log('  - the share pictures are redrawn with the new address on them');
  printSteps();
} else if (mode === 'rehearse') {
  const tmp = mkdtempSync(path.join(tmpdir(), 'semfe-rehearse-'));
  try {
    console.log('\ncopying the site to ' + tmp);
    cpSync(ROOT, tmp, { recursive: true, filter: src => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src.slice(ROOT.length)) });
    switchRepo(tmp, target, indexable());
    const home = read('index.html', tmp);
    const canon = (home.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    if (canon !== target) throw new Error('the rebuilt home page names ' + canon + ', not ' + target);
    if (!existsSync(path.join(tmp, 'CNAME')) || read('CNAME', tmp).trim() !== T.hostname) throw new Error('the build did not write CNAME');
    console.log('ok    rebuilt for ' + target + ' (canonical, CNAME, robots.txt)');
    run(process.execPath, [path.join(tmp, 'tools/check.mjs')], tmp);
    run(process.execPath, [path.join(tmp, 'tools/smoke.mjs')], tmp);
    if (args.includes('--full')) run(process.execPath, [path.join(tmp, 'tools/auth-flow.mjs')], tmp);
    console.log('\nREHEARSAL PASSED: the site works at ' + target + ' (the repository was not changed).');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
} else if (mode === 'apply') {
  if (current === target) { console.log('\nAlready at ' + target + '; rebuilding only.'); }
  switchRepo(ROOT, target, indexable());
  console.log('\nRedrawing the share pictures (they print the address)…');
  try { run(process.execPath, [path.join(ROOT, 'tools/make-share-images.mjs')], ROOT); }
  catch (e) { console.log('note  could not redraw the pictures here (' + e.message + '); run node tools/make-share-images.mjs where Playwright works'); }
  run(process.execPath, [path.join(ROOT, 'tools/check.mjs')], ROOT, true);
  console.log('\nThe repository now uses ' + target + '. Look at og-image.jpg and share-square.jpg, then commit and push.\n' +
    'Also update the address in README.md and CLAUDE.md (they describe where the site lives).');
  printSteps();
} else if (mode === 'prep-check') {
  await prepCheck();
  console.log(bad ? '\n' + bad + ' problem(s)' : '\nready');
  process.exit(bad ? 1 : 0);
} else if (mode === 'verify') {
  await verify();
  console.log(bad ? '\n' + bad + ' problem(s)' : '\nthe move is complete');
  process.exit(bad ? 1 : 0);
}
