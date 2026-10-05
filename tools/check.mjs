#!/usr/bin/env node
/* Offline checks. Run before every commit:  node tools/check.mjs
   Fails (exit 1) on a real defect:
     - a page on disk differs from what _src/ builds (run node tools/build.mjs)
     - a file in _src/pages or _src/posts that is not a .md page, or a vendored
       Markdown/YAML library whose checksum no longer matches tools/vendor/README.md
     - a link or image on any page points at a file that does not exist
     - the share card: not exactly one og:image, declared size != real JPEG size,
       over 300 KB, og:* written with name= or twitter:* with property=
     - the viewport tag blocks zoom
     - an <img> without alt
     - ADMIN_EMAILS in config.js differs from isAdmin() in firestore.rules
     - the default ALLOWED_ORIGINS / LINKEDIN_REDIRECT_URIS in functions/index.js
       leave out the site's own address (siteUrl in config.js)
     - an inline {{...}} placeholder or <!--if:--> block left unfilled in a built page
     - a list of sign-in methods typed by hand instead of generated
   and REPORTS (without failing) that Firebase is still unconfigured. */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const fail = m => { bad++; console.log('FAIL  ' + m); };
const ok = m => console.log('ok    ' + m);
const note = m => console.log('note  ' + m);
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const C = new Function('window', read('assets/js/config.js') + '; return window.SEMFE;')({});

/* 1. generated pages are up to date */
try { execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--check'], { stdio: 'pipe' }); ok('built pages match _src/'); }
catch (e) {
  const said = String(e.stderr || '').split('\n').filter(l => /^(Error|TypeError|RangeError)/.test(l) || /^\S+\.md: /.test(l)).slice(0, 3).join('\n');
  fail(said ? 'the build stops on _src/ (node tools/build.mjs):\n      ' + said.replace(/\n/g, '\n      ') : 'built pages differ from _src/ — run: node tools/build.mjs\n' + String(e.stdout || ''));
}

/* 1b. _src/ holds Markdown pages only, and the two libraries that read them are the ones committed */
{
  const stray = ['pages', 'posts'].flatMap(d => readdirSync(path.join(ROOT, '_src', d)).filter(f => !f.endsWith('.md')).map(f => `_src/${d}/${f}`));   // build.mjs reads the same: *.md, lowercase
  if (stray.length) fail(`_src/pages and _src/posts take .md files only (YAML front matter + Markdown, see _src/README.md); found: ${stray.join(', ')}`);
  else ok('_src/ holds only .md pages');
  const table = read('tools/vendor/README.md');
  let wrong = 0;
  for (const name of ['markdown-it.esm.min.mjs', 'js-yaml.esm.min.mjs']) {
    const want = (table.match(new RegExp('^\\s+([0-9a-f]{64})\\s+' + name.replace(/\./g, '\\.') + '$', 'm')) || [])[1];
    const have = createHash('sha256').update(readFileSync(path.join(ROOT, 'tools/vendor', name))).digest('hex');
    if (!want) { wrong++; fail(`tools/vendor/README.md lists no SHA-256 for ${name}`); }
    else if (want !== have) { wrong++; fail(`tools/vendor/${name} was changed (SHA-256 ${have.slice(0, 12)}…, the README says ${want.slice(0, 12)}…); update both together, see the README`); }
  }
  if (!wrong) ok('vendored Markdown and YAML libraries match their checksums');
}

/* collect the served HTML pages (skip _src, tools, node_modules, dot dirs) */
const pages = [];
(function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.') || f.name.startsWith('_') || f.name === 'tools' || f.name === 'node_modules') continue;
    const full = path.join(dir, f.name);
    if (f.isDirectory()) walk(full);
    else if (f.name.endsWith('.html')) pages.push(path.relative(ROOT, full));
  }
})(ROOT);
ok(`${pages.length} served pages`);

/* 2. every relative link and asset exists */
const SITE_PATH = new URL(C.siteUrl).pathname;            // "/" at the root of semfealumni.gr
let links = 0, forwards = 0;
for (const p of pages) {
  const html = read(p);
  const loose = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');         // braces in a script or a style are code
  if (/\{\{[^{}]{0,60}\}\}|<!--\s*\/?if:/i.test(loose)) fail(`${p}: unfilled placeholder ${loose.match(/\{\{[^{}]{0,60}\}\}|<!--\s*\/?if:[^>]*-->/i)[0]}`);
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    let u = m[1].replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/.test(u)) continue;
    u = u.split('#')[0].split('?')[0];
    if (!u) continue;
    let target;
    if (u.startsWith('/')) {
      if (!u.startsWith(SITE_PATH)) { fail(`${p}: absolute link outside the site: ${u}`); continue; }
      target = path.join(ROOT, u.slice(SITE_PATH.length));
    } else target = path.join(ROOT, path.dirname(p), u);
    if (u.endsWith('/') || (existsSync(target) && statSync(target).isDirectory())) target = path.join(target, 'index.html');
    links++;
    if (!existsSync(target)) fail(`${p}: broken link ${m[1]}`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) fail(`${p}: <img> without alt: ${m[0].slice(0, 80)}`);
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html)) fail(`${p}: viewport tag must be exactly width=device-width, initial-scale=1`);
  // a forwarding page for an address of the earlier site (LEGACY in build.mjs):
  // no share card of its own, but it must stay out of search results, name its
  // target as canonical, and the target must exist (checked with the links above)
  const refresh = html.match(/<meta http-equiv="refresh" content="0; url=([^"]+)">/);
  if (refresh) {
    forwards++;
    if (!/<meta name="robots" content="noindex">/.test(html)) fail(`${p}: a forwarding page must be noindex`);
    if (!/<link rel="canonical" href="https:\/\/[^"]+">/.test(html)) fail(`${p}: a forwarding page must name its target as canonical`);
    if (!html.includes('href="' + refresh[1] + '"')) fail(`${p}: the forwarding page's link must match its refresh target`);
    continue;
  }
  const og = [...html.matchAll(/<meta property="og:image" content="([^"]+)"/g)];
  if (og.length !== 1) fail(`${p}: expected exactly one og:image, found ${og.length}`);
  if (/<meta name="og:/.test(html)) fail(`${p}: og:* written with name=`);
  if (/<meta property="twitter:/.test(html)) fail(`${p}: twitter:* written with property=`);
  if (!/<title>[^<]{3,}<\/title>/.test(html)) fail(`${p}: missing <title>`);
  if (!/<meta name="description" content="[^"]{20,}">/.test(html)) fail(`${p}: missing or short description`);
}
ok(`${links} internal links and images resolve`);
ok(`${forwards} forwarding page(s) for the earlier site's addresses, each noindex with a canonical target`);

/* 3. the share pictures match what the pages declare */
function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const mk = b[i + 1], len = b.readUInt16BE(i + 2);
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
{
  const home = read('index.html');
  const w = +(home.match(/og:image:width" content="(\d+)"/) || [])[1], h = +(home.match(/og:image:height" content="(\d+)"/) || [])[1];
  for (const [file, ew, eh] of [['og-image.jpg', w, h], ['share-square.jpg', 800, 800]]) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) { fail(`${file} missing (node tools/make-share-images.mjs)`); continue; }
    const d = jpegSize(readFileSync(p)), kb = statSync(p).size / 1024;
    if (!d || d.w !== ew || d.h !== eh) fail(`${file} is ${d ? d.w + 'x' + d.h : 'not a JPEG'}, pages declare ${ew}x${eh}`);
    else if (kb > 300) fail(`${file} is ${kb.toFixed(0)} KB; WhatsApp drops thumbnails over 300 KB`);
    else ok(`${file} ${d.w}x${d.h} ${kb.toFixed(0)} KB`);
  }
  const t = readFileSync(path.join(ROOT, 'apple-touch-icon.png'));
  if (t.readUInt32BE(16) !== 180 || t.readUInt32BE(20) !== 180) fail('apple-touch-icon.png must be 180x180'); else ok('apple-touch-icon.png 180x180');
}

/* 3b. «Τι νέο»: the changelog is well formed, and the keys a decision may
   carry are the same in assets/js/news.js and firestore.rules */
{
  const N = require(path.join(ROOT, 'assets/js/news.js'));
  const log = JSON.parse(read('changelog.json')), ids = new Set();
  let last = '9999';
  for (const e of log.updates || []) {
    const p = N.problem(e);
    if (p) fail(`changelog.json ${e && e.id}: ${p}`);
    else if (ids.has(e.id)) fail(`changelog.json: the id ${e.id} is used twice`);
    else if (e.date > last) fail(`changelog.json: ${e.id} is out of order (newest first)`);
    if (e && e.id) ids.add(e.id);
    if (e && e.date) last = e.date;
  }
  const rules = read('firestore.rules');
  const m = rules.match(/match \/newsOverrides\/\{id\}[\s\S]*?hasOnly\(\[([^\]]*)\]\)/);
  const fromRules = m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort() : [];
  if (JSON.stringify(fromRules) !== JSON.stringify([...N.DOC_KEYS].sort())) fail(`news decision keys differ: news.js ${N.DOC_KEYS} vs firestore.rules ${fromRules}`);
  else ok(`«Τι νέο»: ${ids.size} entries in changelog.json, decision keys match the rules`);
}

/* 3b2. e-mail alerts: the kinds of alert and the fields a member writes are
   the same in assets/js/alert-topics.js and firestore.rules; the Cloud
   Function's copies of alert-topics.js and news.js are the same files; the
   feed the alerts read exists and lists the announcements */
{
  const T = require(path.join(ROOT, 'assets/js/alert-topics.js'));
  const rules = read('firestore.rules');
  const m = rules.match(/function alertTopics\(\)[\s\S]*?\[([^\]]*)\]/);
  const keys = m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
  if (JSON.stringify(keys) !== JSON.stringify(T.KEYS)) fail(`alertTopics() in firestore.rules (${keys}) differs from KEYS in alert-topics.js (${T.KEYS})`);
  const blk = (rules.match(/match \/alertPrefs\/\{uid\}[\s\S]*?\n    \}/) || [''])[0];
  const lists = [...blk.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map(x => [...x[1].matchAll(/'([^']+)'/g)].map(y => y[1]).sort().join(','));
  if (lists[0] !== [...T.DOC_KEYS].sort().join(',')) fail(`alertPrefs create keys in firestore.rules (${lists[0]}) differ from DOC_KEYS in alert-topics.js`);
  if (lists[1] !== [...T.DOC_KEYS, ...T.SERVER_KEYS].sort().join(',')) fail(`alertPrefs update keys in firestore.rules (${lists[1]}) differ from DOC_KEYS + SERVER_KEYS in alert-topics.js`);
  for (const f of ['alert-topics.js', 'news.js'])
    if (read('assets/js/' + f) !== read('functions/' + f)) fail(`functions/${f} must be a copy of assets/js/${f} (cp assets/js/${f} functions/)`);
  const cats = new Set(T.TOPICS.filter(x => x.source === 'posts').map(x => x.category));
  const feed = JSON.parse(read('feed.json'));
  const odd = feed.items.filter(i => !cats.has((i.tags || [])[0]));
  if (odd.length) fail(`feed.json: ${odd.length} announcement(s) in a category no e-mail alert covers (${[...new Set(odd.map(i => i.tags[0]))]}): add it to alert-topics.js or use Ανακοινώσεις / Εκδηλώσεις`);
  ok(`e-mail alerts: ${T.KEYS.join(', ')} match the rules; feed.json lists ${feed.items.length} announcement(s)`);
}

/* 3b3. the editor on blog/: what an admin previews is what the Cloud Function
   publishes (one copy of the rules in both), the categories it offers are the
   ones an e-mail alert covers, and the publishing workflow builds from _src */
{
  const A = require(path.join(ROOT, 'assets/js/announce-text.js'));
  const T = require(path.join(ROOT, 'assets/js/alert-topics.js'));
  if (read('assets/js/announce-text.js') !== read('functions/announce-text.js')) fail('functions/announce-text.js must be a copy of assets/js/announce-text.js (cp assets/js/announce-text.js functions/)');
  const cats = [...new Set(T.TOPICS.filter(x => x.source === 'posts').map(x => x.category))].sort();
  if (JSON.stringify([...A.CATEGORIES].sort()) !== JSON.stringify(cats)) fail(`the editor offers ${A.CATEGORIES} but the e-mail alerts cover ${cats}: announce-text.js and alert-topics.js must name the same categories`);
  const wf = read('.github/workflows/publish.yml');
  if (!/_src\/\*\*/.test(wf) || !/node tools\/build\.mjs/.test(wf) || !/assets\/img\/posts\/\*\*/.test(wf)) fail('.github/workflows/publish.yml must run node tools/build.mjs when _src/** or assets/img/posts/** change');
  ok(`announcement editor: rules shared with the Cloud Function, categories ${cats.join(' + ')}, publish workflow in place`);
}

/* 3c. «Στατιστικά»: the profile answers are the same everywhere, the two
   copies of the lists are one file, and the visit counter is on every page
   except the admin and sign-in pages */
{
  const P = require(path.join(ROOT, 'assets/js/profile-options.js'));
  const rules = read('firestore.rules');
  const list = name => { const m = rules.match(new RegExp('function ' + name + '\\(\\)[\\s\\S]*?\\[([^\\]]*)\\]')); return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []; };
  if (JSON.stringify(list('genders')) !== JSON.stringify(P.GENDER_KEYS)) fail(`genders() in firestore.rules (${list('genders')}) differs from GENDERS in profile-options.js (${P.GENDER_KEYS})`);
  if (JSON.stringify(list('industries')) !== JSON.stringify(P.INDUSTRY_KEYS)) fail(`industries() in firestore.rules differs from INDUSTRIES in profile-options.js`);
  if (read('assets/js/profile-options.js') !== read('functions/profile-options.js')) fail('functions/profile-options.js must be a copy of assets/js/profile-options.js (cp assets/js/profile-options.js functions/)');
  if (P.COUNTRIES.some(c => !/^[A-Z]{2}$/.test(c[0]))) fail('profile-options.js: every country needs a two-letter code');
  let tracked = 0;
  for (const p of pages) {
    const html = read(p);
    if (/<meta http-equiv="refresh"/.test(html)) continue;
    const has = /assets\/js\/visit\.js"/.test(html);
    const quiet = /^(admin|auth)\//.test(p);
    if (quiet && has) fail(`${p}: the admin and sign-in pages must not load visit.js`);
    else if (!quiet && !has) fail(`${p}: visit.js missing (every public page counts its visits)`);
    else if (has) tracked++;
  }
  const A = C.ANALYTICS || {};
  if (!(A.hosts || []).includes(new URL(C.siteUrl).hostname)) fail(`ANALYTICS.hosts in config.js must include ${new URL(C.siteUrl).hostname}, or nothing is counted`);
  if (!/^https:\/\/[a-z0-9.-]+\/recordVisit$/.test(A.visitUrl || '')) fail('ANALYTICS.visitUrl in config.js must be the recordVisit function\'s https address');
  const vis = read('functions/index.js').match(/const VISIT_ORIGINS = \[([^\]]*)\]/);
  const origins = vis ? [...vis[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
  for (const h of A.hosts || []) if (!origins.includes('https://' + h)) fail(`VISIT_ORIGINS in functions/index.js must include https://${h} (ANALYTICS.hosts in config.js)`);
  ok(`«Στατιστικά»: profile answers match the rules, visit.js on ${tracked} public pages`);
  if (!/^G-[A-Z0-9]{4,}$/.test(A.ga4 || '')) note('Google Analytics is not set up yet: ANALYTICS.ga4 in assets/js/config.js still says PASTE_ (ANALYTICS-SETUP.md).');
  // the daily workflow must read the property the tag reports to
  const wf = read('.github/workflows/analytics.yml');
  const prop = (wf.match(/GA4_PROPERTY_ID: \$\{\{ vars\.GA4_PROPERTY_ID \|\| '(\d+)' \}\}/) || [])[1];
  if (!prop) fail('.github/workflows/analytics.yml: GA4_PROPERTY_ID must fall back to the property number (vars.GA4_PROPERTY_ID || \'<digits>\')');
  else if (/^G-/.test(A.ga4 || '') && !read('assets/js/config.js').includes('(' + prop + ')')) fail(`config.js: the comment beside ANALYTICS.ga4 must name the property the workflow reads (${prop})`);
}

/* 4. the admin list: the page and the rules must agree */
{
  const rules = read('firestore.rules');
  const m = rules.match(/function isAdmin\(\)[\s\S]*?in \[([^\]]*)\]/);
  const fromRules = m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1].toLowerCase()).sort() : [];
  const fromCfg = (C.ADMIN_EMAILS || []).map(x => x.toLowerCase()).sort();
  if (JSON.stringify(fromRules) !== JSON.stringify(fromCfg)) fail(`ADMIN_EMAILS (${fromCfg.join(', ')}) differs from isAdmin() in firestore.rules (${fromRules.join(', ')})`);
  else ok(`admin list in sync: ${fromCfg.join(', ')}`);
  /* every deployable section runs the wrong-project guard first, and the
     functions runtime agrees with functions/package.json engines.node (a
     "runtime" field overrides engines outright, so a mismatch deploys the
     wrong Node version while printing "Deploy complete!") */
  const fj = JSON.parse(read('firebase.json'));
  for (const sec of ['firestore', 'functions']) {
    if (!fj[sec]) continue;
    if (!(fj[sec].predeploy || []).includes('node check-project.mjs')) fail(`firebase.json ${sec} must run check-project.mjs as predeploy`);
  }
  if (fj.functions) {
    const eng = String((JSON.parse(read(path.join(fj.functions.source, 'package.json'))).engines || {}).node || '');
    if (fj.functions.runtime && fj.functions.runtime !== 'nodejs' + eng) fail(`firebase.json runtime ${fj.functions.runtime} differs from functions/package.json engines.node ${eng}`);
  }
  ok('firebase.json: guard on every section, runtime matches engines');
}

/* 4b. a Cloud Function deployed without a functions/.env.<project> file (a new
   folder, a new maintainer) takes the defaults written in functions/index.js.
   They must name the site's own address, or sign-in, the admin page and the
   editor refuse the site's origin and LinkedIn sends the member to a dead page. */
{
  const src = read('functions/index.js');
  const dflt = name => { const m = src.match(new RegExp("defineString\\('" + name + "',\\s*\\{\\s*default:\\s*'([^']*)'")); return m ? m[1].split(',').map(x => x.trim()).filter(Boolean) : null; };
  const site = new URL(C.siteUrl), siteBase = C.siteUrl.replace(/\/?$/, '/');
  const wantOrigins = [...new Set([site.origin, 'https://www.' + site.hostname.replace(/^www\./, '')])];
  const wantRedirect = siteBase + 'auth/linkedin/';
  const origins = dflt('ALLOWED_ORIGINS'), redirects = dflt('LINKEDIN_REDIRECT_URIS');
  let wrong = 0;
  if (!origins) { wrong++; fail('functions/index.js: no default found for ALLOWED_ORIGINS'); }
  else for (const o of wantOrigins) if (!origins.includes(o)) { wrong++; fail(`the default ALLOWED_ORIGINS in functions/index.js (${origins.join(',')}) must include ${o} (siteUrl in config.js and its www form)`); }
  if (!redirects) { wrong++; fail('functions/index.js: no default found for LINKEDIN_REDIRECT_URIS'); }
  else if (!redirects.includes(wantRedirect)) { wrong++; fail(`the default LINKEDIN_REDIRECT_URIS in functions/index.js (${redirects.join(',')}) must include ${wantRedirect} (siteUrl in config.js + auth/linkedin/)`); }
  if (!wrong) ok(`Cloud Function defaults name the site: ${wantOrigins.join(' and ')}, callback ${wantRedirect}`);
}

/* 5. no page or script types the list of sign-in methods by hand. The pages
   get it from {{signin}} / {{signin-social}} (tools/build.mjs) and the scripts
   from SemfeAuth.methodsText(), both built from AUTH_PROVIDERS, so neither can
   name a way in the sign-in window does not offer (Facebook was named on four
   pages long after it was left out). Comments are not text a visitor reads. */
{
  const HAND_LIST = /(Google|Facebook)(, | ή (με )?)(Facebook|LinkedIn|e-mail)|(Google|Facebook|LinkedIn) ή (με )?(<strong>)?e-mail/;
  const srcs = readdirSync(path.join(ROOT, '_src/pages')).filter(f => f.endsWith('.md')).map(f => '_src/pages/' + f)
    .concat(readdirSync(path.join(ROOT, 'assets/js')).filter(f => f.endsWith('.js') && f !== 'config.js').map(f => 'assets/js/' + f));
  let typed = 0;
  for (const f of srcs) {
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const m = text.match(HAND_LIST);
    if (m) { typed++; fail(`${f}: a list of sign-in methods typed by hand ("${m[0]}"); use {{signin}} / {{signin-social}} in pages, SemfeAuth.methodsText() in scripts`); }
  }
  if (!typed) ok(`sign-in methods named only through the generated list (${srcs.length} files)`);
}

/* 6. what is still to do (not failures) */
const f = C.FIREBASE || {};
if (Object.values(f).some(v => String(v).includes('PASTE_'))) note('Firebase is not configured yet: sign-in stays off until assets/js/config.js has the real web config (FIREBASE-SETUP.md).');
if (read('.firebaserc').includes('PASTE_')) note('.firebaserc still says PASTE_PROJECT_ID (needed only for deploying the rules from the CLI).');

console.log(bad ? `\n${bad} problem(s)` : '\ncheck passed');
process.exit(bad ? 1 : 0);
