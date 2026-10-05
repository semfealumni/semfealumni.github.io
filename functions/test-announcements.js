/* Offline tests for announce-text.js (the rules for an announcement written
   in the browser) and announcements.js (publishAnnouncement: the admin's
   announcement becomes files in the GitHub repository). No network, no
   Firebase: GitHub is a small fake of the Git Data API. Run: npm test */
'use strict';
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const T = require('./announce-text');
const ann = require('./announcements');
const accounts = require('./accounts');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e)); }
}
const TOOLS = path.join(__dirname, '..', 'tools');

/* ---- announce-text.js ----------------------------------------------------- */
(async () => {
  await t('slugify: Greek to a clean address', async () => {
    assert.strictEqual(T.slugify('Πρόσκληση σε Κοπή Πίτας 2026!'), 'prosklisi-se-kopi-pitas-2026');
    assert.strictEqual(T.slugify('Συνάντηση αποφοίτων ΣΕΜΦΕ'), 'synadisi-apofoiton-semfe');
    assert.strictEqual(T.slugify('Μπάλα και Ντομάτα'), 'bala-kai-domata');
    assert.strictEqual(T.slugify('Hello, World'), 'hello-world');
    assert.strictEqual(T.slugify('!!!'), 'anakoinosi');
    assert.strictEqual(T.slugify(''), 'anakoinosi');
    assert.ok(T.slugify('λέξη '.repeat(40)).length <= 60);
    assert.ok(/^[a-z0-9-]+$/.test(T.slugify('Ωραία 😀 μέρα ΑΘΗΝΑ — 1/2')));
  });
  await t('uniqueSlug: -2, -3…', async () => {
    assert.strictEqual(T.uniqueSlug('a', []), 'a');
    assert.strictEqual(T.uniqueSlug('a', ['a']), 'a-2');
    assert.strictEqual(T.uniqueSlug('a', ['a', 'a-2', 'a-3']), 'a-4');
  });
  await t('athensDate: the date in Greece, not in UTC', async () => {
    assert.strictEqual(T.athensDate(Date.UTC(2026, 9, 5, 21, 30)), '2026-10-06');   // 00:30 on the 6th in Athens (UTC+3)
    assert.strictEqual(T.athensDate(Date.UTC(2026, 0, 5, 21, 30)), '2026-01-05');   // 23:30 on the 5th (UTC+2)
  });
  await t('escapeBody: < & { } become plain characters, once', async () => {
    assert.strictEqual(T.escapeBody('a <b>x</b> & {c} }'), 'a \\<b>x\\</b> \\& \\{c\\} \\}');
    assert.strictEqual(T.escapeBody('already \\< \\& \\{ \\}'), 'already \\< \\& \\{ \\}');
    assert.strictEqual(T.escapeBody('two \\\\<'), 'two \\\\\\<');                    // an escaped backslash does not escape the "<"
    assert.strictEqual(T.escapeBody('\r\nline\r\n\r\n'), 'line');
    assert.strictEqual(T.escapeBody('a\u0000b c'), 'abc');
    assert.strictEqual(T.escapeBody(null), '');
    assert.strictEqual(T.escapeBody('```js\ncode\n```\n~~~\nx\n   ```'), '\\`\\`\\`js\ncode\n\\`\\`\\`\n\\~\\~\\~\nx\n   \\`\\`\\`');
    assert.strictEqual(T.escapeBody('a `code` here'), 'a `code` here');
  });
  await t('hasPlaceholder: any "{{", written or built from escapes', async () => {
    assert.ok(T.hasPlaceholder('{{root}}') && T.hasPlaceholder('x {{ y') && T.hasPlaceholder('\\{\\{root\\}\\}'));
    assert.ok(!T.hasPlaceholder('{a} {b}') && !T.hasPlaceholder('plain'));
  });
  await t('describe: the card sentence from the first paragraph, as plain text', async () => {
    assert.strictEqual(T.describe('## Τίτλος\n\nΗ **Γενική** [Συνέλευση](https://a.b) θα γίνει.\n\nΔεύτερη.', 'T'), 'Τίτλος');   // a heading line loses its marker, it stays the first text
    assert.strictEqual(T.describe('Η **Γενική** [Συνέλευση](https://a.b) ![x](figure-1) θα γίνει.\n\nΔεύτερη.', 'T'), 'Η Γενική Συνέλευση θα γίνει.');
    assert.strictEqual(T.describe('![x](figure-1)', 'Ο τίτλος'), 'Ο τίτλος');
    const long = T.describe('λέξη '.repeat(100), 'T');
    assert.ok(long.length <= 190 && long.endsWith('…'));
  });
  await t('sniff: a picture is what its first bytes say', async () => {
    assert.strictEqual(T.sniff(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0])), 'jpg');
    assert.strictEqual(T.sniff(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0])), 'png');
    assert.strictEqual(T.sniff(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1')), 'webp');
    assert.strictEqual(T.sniff(Buffer.from('GIF89a\u0001\u0000')), 'gif');
    assert.strictEqual(T.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), '');
    assert.strictEqual(T.sniff(Buffer.from('')), '');
  });

  const post = (o) => T.buildPost(Object.assign({ title: 'Κοπή πίτας', category: 'Εκδηλώσεις', body: 'Ένα **κείμενο**.', date: '2026-10-05' }, o));
  await t('buildPost: the file, front matter and address', async () => {
    const p = post({});
    assert.strictEqual(p.file, '2026-10-05-kopi-pitas.md');
    assert.strictEqual(p.path, '_src/posts/2026-10-05-kopi-pitas.md');
    assert.strictEqual(p.text, '---\ntitle: "Κοπή πίτας"\ndate: 2026-10-05\nslug: kopi-pitas\ncategory: Εκδηλώσεις\ndescription: "Ένα κείμενο."\n---\n\nΈνα **κείμενο**.\n');
    assert.strictEqual(T.pathOf(p.date, p.slug), 'blog/2026/10/05/kopi-pitas/');
    assert.deepStrictEqual(p.images, []);
  });
  await t('buildPost: a slug already taken gets -2', async () => {
    assert.strictEqual(post({ taken: ['kopi-pitas'] }).slug, 'kopi-pitas-2');
  });
  await t('buildPost: pictures get their files, size and cover', async () => {
    const p = post({
      body: 'Πριν\n\n![Η αφίσα \\& άλλα](figure-2)\n\n![Δεύτερη](figure-1)\n',
      cover: 2, figures: [{ ext: 'jpg', size: 'small' }, { ext: 'png', size: 'medium' }, { ext: 'jpg' }]
    });
    assert.ok(p.text.includes('image: 2026-10-05-kopi-pitas-2.png\n'));
    assert.ok(p.text.includes('![Η αφίσα \\& άλλα]({{root}}assets/img/posts/2026-10-05-kopi-pitas-2.png){ loading=lazy style="max-width:600px;width:100%" }'));
    assert.ok(p.text.includes('![Δεύτερη]({{root}}assets/img/posts/2026-10-05-kopi-pitas-1.jpg){ loading=lazy style="max-width:360px;width:100%" }'));
    assert.deepStrictEqual(p.images.map(i => i.path), ['assets/img/posts/2026-10-05-kopi-pitas-1.jpg', 'assets/img/posts/2026-10-05-kopi-pitas-2.png']);   // figure 3 is not in the text: left out
  });
  await t('buildPost: the cover is kept even when the text does not show it', async () => {
    const p = post({ cover: 1, figures: [{ ext: 'jpg' }] });
    assert.strictEqual(p.images.length, 1);
    assert.ok(p.text.includes('image: 2026-10-05-kopi-pitas-1.jpg'));
  });
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'no error'; };
  await t('buildPost: every refusal has a code', async () => {
    assert.strictEqual(code(() => post({ title: '  ' })), 'title-missing');
    assert.strictEqual(code(() => post({ title: 'x'.repeat(151) })), 'title-too-long');
    assert.strictEqual(code(() => post({ category: 'Άλλο' })), 'category-bad');
    assert.strictEqual(code(() => post({ description: 'x'.repeat(201) })), 'description-too-long');
    assert.strictEqual(code(() => post({ body: ' \n ' })), 'body-missing');
    assert.strictEqual(code(() => post({ body: 'x'.repeat(20001) })), 'body-too-long');
    assert.strictEqual(code(() => post({ date: '5/10/2026' })), 'date-bad');
    assert.strictEqual(code(() => post({ body: 'Γράψτε {{root}}' })), 'braces');
    assert.strictEqual(code(() => post({ body: 'Γράψτε \\{\\{icon:x\\}\\}' })), 'braces');
    assert.strictEqual(code(() => post({ body: 'a { \\{ b' })), 'no error');
    assert.strictEqual(code(() => post({ title: 'Τίτλος {{signin}}' })), 'braces');
    assert.strictEqual(code(() => post({ description: '{{latest}}' })), 'braces');
    assert.strictEqual(code(() => post({ body: '![x](figure-3)', figures: [{ ext: 'jpg' }] })), 'figure-missing');
    assert.strictEqual(code(() => post({ cover: 2, figures: [{ ext: 'jpg' }] })), 'cover-bad');
    assert.strictEqual(code(() => post({ figures: Array(9).fill({ ext: 'jpg' }) })), 'too-many-figures');
    assert.strictEqual(code(() => post({ body: '![x](figure-1)', figures: [{ ext: 'svg' }] })), 'figure-bad');
    assert.strictEqual(code(() => post({ body: '![' + 'x'.repeat(201) + '](figure-1)', figures: [{ ext: 'jpg' }] })), 'alt-too-long');
  });
  await t('buildPost: a title or description cannot carry markup into the front matter', async () => {
    const p = post({ title: 'A <!--if:google--> B', description: 'x <b> y' });
    const front = p.text.split('---')[1];
    assert.ok(!/[<>]/.test(front), front);
    assert.ok(front.includes('title: "A B"') && front.includes('description: "x y"'), front);
  });

  /* the real pipeline: the file must read back through the SITE's own reader and render without markup */
  const md = await import(pathToFileURL(path.join(TOOLS, 'markdown.mjs')).href);
  const TAGS = new Set(['p', 'br', 'strong', 'em', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'code']);
  const ATTRS = new Set(['href', 'src', 'alt', 'title', 'loading', 'style', 'start']);
  const HOSTILE = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '[x](https://a.b){ onclick=alert(1) }',
    '&#60;script&#62;alert(1)&#60;/script&#62;', '&lt;b&gt;', '&#123;&#123;root&#125;&#125;', '{ .btn onclick=x }', '```{people}\n- id: a\n```',
    '<!--if:google-->x<!--/if:google-->', '<iframe src="https://evil"></iframe>', '![x](data:text/html;base64,PHNjcmlwdD4=)', '<https://evil.example>',
    'text\n{ onmouseover=alert(1) }', '# t { onclick=x }', '- a\n\n{ .checklist onclick=x }', '[a]: javascript:alert(1)\n\n[a]', '\\<script>', '{\\{root}}', '&lcub;&lcub;root&rcub;&rcub;'
  ];
  await t('the hostile texts become plain text: no tag, no handler, no placeholder, and they read back', async () => {
    for (const h of HOSTILE) {
      let p;
      try { p = post({ body: h + '\n\nund noch Text' }); } catch (e) { assert.ok(e.code === 'braces', h + ' -> ' + e.code); continue; }   // refused for "{{" is fine
      const fm = md.splitFrontMatter(p.text, p.file);
      assert.strictEqual(fm.data.title, 'Κοπή πίτας');
      const html = md.renderMarkdown(fm.body, p.file);
      // every real tag (a "<" in the text is &lt;) is one an announcement may have, with only the attributes it may have
      for (const m of html.matchAll(/<\/?([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi)) {
        assert.ok(TAGS.has(m[1].toLowerCase()), 'a <' + m[1] + '> tag in: ' + h + '\n' + html);
        for (const a of m[2].matchAll(/\s+([a-z-]+)/gi)) assert.ok(ATTRS.has(a[1].toLowerCase()), 'the attribute ' + a[1] + ' in: ' + h + '\n' + html);
      }
      assert.strictEqual((html.match(/</g) || []).length, (html.match(/<\/?[a-z0-9]+(?:\s[^<>]*)?>/gi) || []).length, 'a "<" that is not a tag was left raw in: ' + h + '\n' + html);
      assert.ok(!/href="\s*(javascript|vbscript|data):/i.test(html), h + '\n' + html);
      assert.ok(!/\{\{/.test(html), 'a placeholder survived in: ' + h + '\n' + html);
    }
  });
  await t('a real announcement reads back and renders as the editor meant', async () => {
    const p = post({
      title: 'Πρόσκληση σε Γενική Συνέλευση: "Αρχαιρεσίες" #2026',
      description: '',
      body: '## Θέματα\n\n- Απολογισμός\n- Αρχαιρεσίες\n\n> Παράθεμα\n\nΜε εκτίμηση,\\\nΤο Δ.Σ.\n\n![Αφίσα \\& κείμενο](figure-1)\n',
      cover: 1, figures: [{ ext: 'jpg', size: 'medium' }]
    });
    const fm = md.splitFrontMatter(p.text, p.file);
    assert.deepStrictEqual(Object.keys(fm.data), ['title', 'date', 'slug', 'category', 'image', 'description']);
    assert.strictEqual(fm.data.title, 'Πρόσκληση σε Γενική Συνέλευση: "Αρχαιρεσίες" #2026');
    assert.strictEqual(fm.data.date, '2026-10-05');
    assert.strictEqual(fm.data.image, '2026-10-05-prosklisi-se-geniki-syneleysi-archairesies-2026-1.jpg');
    const html = md.renderMarkdown(fm.body, p.file);
    assert.ok(html.includes('<h2>Θέματα</h2>') && html.includes('<li>Απολογισμός</li>') && html.includes('<blockquote>'));
    assert.ok(html.includes('Με εκτίμηση,<br>\nΤο Δ.Σ.'), html);
    assert.ok(html.includes('<img src="{{root}}assets/img/posts/2026-10-05-prosklisi-se-geniki-syneleysi-archairesies-2026-1.jpg" alt="Αφίσα &amp; κείμενο" loading="lazy" style="max-width:600px;width:100%">'), html);
  });
  await t('the file name and slug follow the build\'s own rules for _src/posts', async () => {
    const p = post({ title: 'Ωραία μέρα!' });
    assert.ok(/^\d{4}-\d{2}-\d{2}-[a-z0-9_-]+\.md$/.test(p.file));
    assert.strictEqual(p.file, p.date + '-' + p.slug + '.md');
  });

  /* ---- announcements.js, against a fake GitHub ------------------------------ */
  const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 7)]).toString('base64');
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(100, 1)]).toString('base64');
  const TOKEN = 'ghp_SECRET_TOKEN_VALUE';

  function fakeGithub(opts) {
    opts = opts || {};
    const g = {
      calls: [], commits: { c0: { tree: 't0', parents: [] } }, trees: { t0: { '_src/posts/2025-03-02-2025-taktiki-gs.md': 'x', '_src/posts/README.txt': 'y' } },
      blobs: {}, head: 'c0', n: 0, refusals: opts.refusals || [], conflicts: opts.conflicts || 0, status: opts.status || {}
    };
    const reply = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
    g.fetch = async (url, init) => {
      const u = new URL(url), method = init.method, body = init.body ? JSON.parse(init.body) : undefined;
      g.calls.push({ method, path: u.pathname + u.search, auth: init.headers.Authorization, body });
      assert.strictEqual(u.origin, 'https://api.github.com');
      assert.strictEqual(init.headers.Authorization, 'Bearer ' + TOKEN);
      const forced = g.status[method + ' ' + u.pathname.replace('/repos/o/r', '')];
      if (forced) return reply(forced, { message: 'forced ' + forced });
      const m = u.pathname.match(/^\/repos\/o\/r(\/.*)$/);
      if (!m) return reply(404, { message: 'repo' });
      const p = m[1];
      if (method === 'GET' && p === '/git/ref/heads/main') return reply(200, { object: { sha: g.head } });
      if (method === 'GET' && /^\/git\/commits\//.test(p)) { const c = g.commits[p.split('/').pop()]; return c ? reply(200, { sha: p.split('/').pop(), tree: { sha: c.tree } }) : reply(404, {}); }
      if (method === 'GET' && p === '/contents/_src/posts') {
        const tree = g.trees[g.commits[u.searchParams.get('ref')].tree];
        return reply(200, Object.keys(tree).filter(k => k.startsWith('_src/posts/')).map(k => ({ name: k.slice(11), path: k, type: 'file' })));
      }
      if (method === 'POST' && p === '/git/blobs') { const sha = 'b' + (++g.n); g.blobs[sha] = Buffer.from(body.content, body.encoding); assert.strictEqual(body.encoding, 'base64'); return reply(201, { sha }); }
      if (method === 'POST' && p === '/git/trees') {
        const base = g.trees[Object.keys(g.trees).find(k => k === body.base_tree)];
        assert.ok(base, 'base_tree must be the parent commit\'s tree');
        const files = Object.assign({}, base);
        for (const e of body.tree) { assert.strictEqual(e.mode, '100644'); files[e.path] = e.content !== undefined ? e.content : g.blobs[e.sha]; }
        const sha = 't' + (++g.n); g.trees[sha] = files; return reply(201, { sha });
      }
      if (method === 'POST' && p === '/git/commits') { const sha = 'c' + (++g.n); g.commits[sha] = { tree: body.tree, parents: body.parents, message: body.message }; return reply(201, { sha }); }
      if (method === 'PATCH' && p === '/git/refs/heads/main') {
        assert.strictEqual(body.force, false);
        if (g.conflicts > 0) { g.conflicts--; g.head = 'c-other' + g.n; g.commits[g.head] = { tree: g.commits[g.commits[body.sha].parents[0]].tree, parents: [] }; return reply(422, { message: 'Update is not a fast forward' }); }
        if (g.commits[body.sha].parents[0] !== g.head) return reply(422, { message: 'Update is not a fast forward' });
        g.head = body.sha; return reply(200, {});
      }
      return reply(404, { message: 'no route ' + method + ' ' + p });
    };
    return g;
  }
  const ADMIN = { uid: 'a1', email: 'kstouras@gmail.com', email_verified: true };
  const TOKENS = { admin: ADMIN, other: { uid: 'u2', email: 'someone@example.com', email_verified: true }, unverified: { uid: 'a2', email: 'gradsemfe@gmail.com', email_verified: false } };
  const auth = { async verifyIdToken(tok) { if (TOKENS[tok]) return TOKENS[tok]; throw new Error('bad'); } };
  async function call(body, o) {
    o = o || {};
    const gh = o.github || fakeGithub();
    const logged = [];
    const res = { code: 0, headers: {}, json: null, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(x) { this.json = x; return this; } };
    res.json = null; const send = res.send.bind(res);
    res.json = function (x) { this.body = x; return this; };
    const req = { method: o.method || 'POST', headers: { origin: o.origin === undefined ? 'https://semfealumni.gr' : o.origin, authorization: o.token === null ? '' : 'Bearer ' + (o.token || 'admin') }, body };
    req.get = k => req.headers[k.toLowerCase()];
    await ann.handle(req, res, { auth, fetch: gh.fetch, clock: () => Date.UTC(2026, 9, 5, 9, 0), log: e => logged.push(e) },
      Object.assign({ allowedOrigins: ['https://semfealumni.gr'], token: TOKEN, repo: 'o/r', branch: 'main', siteUrl: 'https://semfealumni.gr/' }, o.cfg));
    return { code: res.code, body: res.body, headers: res.headers, gh, logged };
  }
  const OK = { action: 'publish', title: 'Κοπή πίτας 2026', category: 'Εκδηλώσεις', body: 'Το κείμενο.\n\n![Η αφίσα](figure-1)', cover: 1, figures: [{ data: JPG, size: 'medium' }] };

  await t('access: no token, a bad token, not an admin, an unverified admin address, a foreign origin, a GET', async () => {
    assert.strictEqual((await call(OK, { token: null })).code, 401);
    assert.strictEqual((await call(OK, { token: 'nope' })).body.error, 'bad-id-token');
    assert.strictEqual((await call(OK, { token: 'other' })).body.error, 'not-admin');
    assert.strictEqual((await call(OK, { token: 'unverified' })).body.error, 'not-admin');
    assert.strictEqual((await call(OK, { origin: 'https://evil.example' })).body.error, 'origin-not-allowed');
    assert.strictEqual((await call(OK, { method: 'GET' })).code, 405);
    const r = await call(OK, { token: 'other' });
    assert.strictEqual(r.gh.calls.length, 0, 'GitHub is never asked for a non-admin');
  });
  await t('the preflight is answered for the site only', async () => {
    const yes = await call({}, { method: 'OPTIONS' }), no = await call({}, { method: 'OPTIONS', origin: 'https://evil.example' });
    assert.strictEqual(yes.code, 204); assert.strictEqual(yes.headers['Access-Control-Allow-Origin'], 'https://semfealumni.gr');
    assert.strictEqual(no.code, 403); assert.strictEqual(no.headers['Access-Control-Allow-Origin'], undefined);
  });
  await t('status: ready only with a token and a repository', async () => {
    assert.deepStrictEqual((await call({ action: 'status' })).body, { ok: true, ready: true });
    assert.strictEqual((await call({ action: 'status' }, { cfg: { token: 'none' } })).body.ready, false);
    assert.strictEqual((await call({ action: 'status' }, { cfg: { token: '' } })).body.ready, false);
    assert.strictEqual((await call({ action: 'status' }, { cfg: { repo: 'not a repo' } })).body.ready, false);
    assert.strictEqual((await call({ action: 'status' }, { token: 'other' })).code, 403);
  });
  await t('publish while not set up says so and asks GitHub nothing', async () => {
    const r = await call(OK, { cfg: { token: 'none' } });
    assert.strictEqual(r.code, 503); assert.strictEqual(r.body.error, 'not-set-up'); assert.strictEqual(r.gh.calls.length, 0);
  });
  await t('publish: one commit with the text and the picture, on top of the branch', async () => {
    const r = await call(OK);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(Object.assign({}, r.body, { commit: 'x' }), { ok: true, url: 'https://semfealumni.gr/blog/2026/10/05/kopi-pitas-2026/', path: '_src/posts/2026-10-05-kopi-pitas-2026.md', file: '2026-10-05-kopi-pitas-2026.md', slug: 'kopi-pitas-2026', date: '2026-10-05', commit: 'x' });
    const g = r.gh;
    assert.strictEqual(g.head, r.body.commit);
    const c = g.commits[g.head];
    assert.deepStrictEqual(c.parents, ['c0']);
    assert.ok(c.message.includes('kstouras@gmail.com') && c.message.startsWith('Announcement: kopi-pitas-2026'));
    const files = g.trees[c.tree];
    assert.ok(files['_src/posts/2025-03-02-2025-taktiki-gs.md'], 'the older announcement is kept');
    assert.ok(/^---\ntitle: "Κοπή πίτας 2026"\ndate: 2026-10-05\nslug: kopi-pitas-2026\ncategory: Εκδηλώσεις\nimage: 2026-10-05-kopi-pitas-2026-1.jpg\n/.test(files['_src/posts/2026-10-05-kopi-pitas-2026.md']));
    assert.ok(Buffer.isBuffer(files['assets/img/posts/2026-10-05-kopi-pitas-2026-1.jpg']) && files['assets/img/posts/2026-10-05-kopi-pitas-2026-1.jpg'].toString('base64') === JPG);
    assert.strictEqual(Object.keys(files).length, 4);
  });
  await t('publish: the token never appears in an answer', async () => {
    for (const r of [await call(OK), await call(OK, { github: fakeGithub({ status: { 'GET /git/ref/heads/main': 401 } }) }), await call(Object.assign({}, OK, { title: '' }))])
      assert.ok(!JSON.stringify(r.body).includes(TOKEN) && !JSON.stringify(r.headers).includes(TOKEN));
  });
  await t('publish: an existing slug gets -2 (the build needs every slug to be its own)', async () => {
    const g = fakeGithub(); g.trees.t0['_src/posts/2026-02-11-kopi-pitas-2026.md'] = 'old';
    const r = await call(OK, { github: g });
    assert.strictEqual(r.body.slug, 'kopi-pitas-2026-2');
    assert.strictEqual(r.body.url, 'https://semfealumni.gr/blog/2026/10/05/kopi-pitas-2026-2/');
  });
  await t('publish: somebody pushed in between: starts again from the new tip, once', async () => {
    const g = fakeGithub({ conflicts: 1 });
    const r = await call(OK, { github: g });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(g.calls.filter(c => c.method === 'PATCH').length, 2);
    assert.ok(g.commits[g.head].parents[0].startsWith('c-other'));
  });
  await t('publish: gives up after four busy tries with github-busy', async () => {
    const r = await call(OK, { github: fakeGithub({ conflicts: 9 }) });
    assert.strictEqual(r.code, 409); assert.strictEqual(r.body.error, 'github-busy');
  });
  await t('publish: GitHub refusing the token, the repository, or failing', async () => {
    const mk = (key, status) => fakeGithub({ status: { [key]: status } });
    let r = await call(OK, { github: mk('GET /git/ref/heads/main', 401) }); assert.deepStrictEqual([r.code, r.body.error], [503, 'github-token']);
    r = await call(OK, { github: mk('GET /git/ref/heads/main', 403) }); assert.deepStrictEqual([r.code, r.body.error], [503, 'github-token']);
    r = await call(OK, { github: mk('GET /git/ref/heads/main', 404) }); assert.deepStrictEqual([r.code, r.body.error], [503, 'github-repo']);
    r = await call(OK, { github: mk('POST /git/trees', 500) }); assert.deepStrictEqual([r.code, r.body.error], [502, 'github-error']);
    assert.ok(r.logged.length === 1 && /tree 500/.test(r.logged[0].detail), 'the cause is logged for the owner');
    r = await call(OK, { github: mk('POST /git/blobs', 422) }); assert.strictEqual(r.body.error, 'github-error');
    assert.strictEqual(r.gh.head, 'c0', 'nothing was published');
  });
  await t('publish: a refused announcement writes nothing (every code, before GitHub is asked)', async () => {
    const bad = (patch, want) => call(Object.assign({}, OK, patch)).then(r => { assert.deepStrictEqual([r.code, r.body.error], [400, want], JSON.stringify(patch).slice(0, 80)); assert.strictEqual(r.gh.calls.length, 0, want + ': GitHub was asked'); });
    await bad({ title: '' }, 'title-missing');
    await bad({ title: 'x'.repeat(200) }, 'title-too-long');
    await bad({ category: 'Άλλο' }, 'category-bad');
    await bad({ body: '   ' }, 'body-missing');
    await bad({ body: 'a {{root}}' }, 'braces');
    await bad({ cover: 5 }, 'cover-bad');
    await bad({ figures: [{ data: 'not base64!' }] }, 'figure-bad');
    await bad({ figures: [{ data: Buffer.from('<svg onload=alert(1)>').toString('base64') }] }, 'figure-bad');
    await bad({ figures: [{ data: JPG }, { data: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(T.LIMITS.figureBytes)]).toString('base64') }] }, 'figure-too-big');
    await bad({ figures: Array(9).fill({ data: JPG }) }, 'too-many-figures');
    await bad({ title: 7 }, 'bad-request');
    await bad({ figures: 'x' }, 'bad-request');
    await bad({ cover: 1.5 }, 'bad-request');
    await bad({ body: '![x](figure-4)' }, 'figure-missing');
  });
  await t('publish: together the pictures may not pass the total', async () => {
    const big = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(1100000)]).toString('base64');
    const r = await call(Object.assign({}, OK, { figures: Array(6).fill({ data: big }), body: 'x' }));
    assert.deepStrictEqual([r.code, r.body.error], [400, 'figures-too-big']);
  });
  await t('publish: an unused picture is not committed, the cover is; a PNG keeps its kind', async () => {
    const r = await call(Object.assign({}, OK, { body: 'Μόνο κείμενο', cover: 2, figures: [{ data: JPG }, { data: PNG }] }));
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const files = r.gh.trees[r.gh.commits[r.gh.head].tree];
    assert.deepStrictEqual(Object.keys(files).filter(k => k.startsWith('assets/')), ['assets/img/posts/2026-10-05-kopi-pitas-2026-2.png']);
  });
  await t('the date is today in Greece', async () => {
    const r = await call(Object.assign({}, OK, { figures: [], cover: 0, body: 'x' }));
    assert.strictEqual(r.body.date, '2026-10-05');
  });
  await t('an internal failure answers "internal" and is logged, never its message', async () => {
    const g = fakeGithub(); g.fetch = async () => { throw new Error('connect ECONNRESET ' + TOKEN); };
    const r = await call(OK, { github: g });
    assert.deepStrictEqual([r.code, r.body.error], [500, 'internal']);
    assert.strictEqual(r.logged.length, 1);
  });
  await t('ADMIN_EMAILS is the one accounts.js keeps (nothing else decides who may publish)', async () => {
    assert.ok(accounts.ADMIN_EMAILS.includes('kstouras@gmail.com'));
    assert.ok(!/ADMIN_EMAILS\s*=/.test(require('node:fs').readFileSync(path.join(__dirname, 'announcements.js'), 'utf8')));
  });

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
