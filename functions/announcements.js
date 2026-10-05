/* publishAnnouncement: an admin writes an announcement in the editor on blog/
 * and this function turns it into files in the site's GitHub repository:
 *
 *   _src/posts/YYYY-MM-DD-slug.md        the text (YAML front matter + Markdown)
 *   assets/img/posts/YYYY-MM-DD-slug-N.jpg  its pictures
 *
 * in ONE commit on the main branch (Git Data API: blobs, tree, commit, then a
 * fast-forward of the branch, so nobody ever sees half an announcement). The
 * workflow .github/workflows/publish.yml then runs `node tools/build.mjs`,
 * which writes the page, the home page's cards, the feeds and the sitemap, and
 * GitHub Pages publishes them: usually a few minutes after the button. The
 * e-mail alerts (alertsMailer) pick the announcement up from feed.json like
 * any other. Nothing here writes to Firestore.
 *
 * Who may: a verified address in ADMIN_EMAILS (accounts.js), checked from the
 * caller's Firebase ID token on every call. The text is made safe before it is
 * written (announce-text.js: no HTML, no attribute lists, no {{placeholders}}),
 * pictures are accepted by their first bytes, never their names, and every size
 * is capped. The GitHub token is a Secret Manager secret
 * (GITHUB_PUBLISH_TOKEN, a fine-grained token with "Contents: read and write"
 * on this one repository: ANNOUNCE-SETUP.md); set it to "none" to leave
 * publishing off, and the editor says so before anyone writes a word.
 *
 * Requests (POST, JSON, Authorization: Bearer <ID token>):
 *   { action: 'status' }   -> { ok, ready }          is publishing set up?
 *   { action: 'publish', title, category, description?, body, cover?,
 *     figures: [{ data: <base64>, size?: 'full'|'medium'|'small' }] }
 *                          -> { ok, url, path, file, slug, date, commit }
 * Errors are { error: <code> } with a status: not-signed-in 401, not-admin 403,
 * not-set-up 503, a code of announce-text.js 400, github-token 503, github-busy 409. */
'use strict';

const { HttpError } = require('./linkedin');
const accounts = require('./accounts');
const T = require('./announce-text');

const API = 'https://api.github.com';
const POSTS_DIR = '_src/posts';

/* a GitHub API call; resolves { status, ok, json } and never throws on a refusal */
function github(deps, cfg) {
  return async function api(method, path, body) {
    const res = await deps.fetch(API + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'semfe-alumni-announcements',
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000)                       // a GitHub that does not answer must not hold the request for the whole function timeout
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* an empty answer */ }
    return { status: res.status, ok: res.ok, json };
  };
}
/* what a refused GitHub call means for the admin */
function refusal(r, what) {
  if (r.status === 429 || (r.status === 403 && /rate limit|abuse|secondary/i.test((r.json && r.json.message) || ''))) return new HttpError(503, 'github-busy');   // a limit, not the token
  if (r.status === 401 || r.status === 403) return new HttpError(503, 'github-token');      // expired, revoked, or not allowed on this repository
  if (r.status === 404) return new HttpError(503, 'github-repo');                          // the repository or branch is not the one the token reaches
  const e = new HttpError(502, 'github-error');
  e.detail = what + ' ' + r.status + ' ' + ((r.json && r.json.message) || '');
  return e;
}

/** Decode and check the pictures: [{ ext, size, bytes }] in the order given. */
function readFigures(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new HttpError(400, 'bad-request');
  if (list.length > T.LIMITS.figures) throw new HttpError(400, 'too-many-figures');
  let total = 0;
  return list.map(f => {
    if (!f || typeof f.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data)) throw new HttpError(400, 'figure-bad');
    const bytes = Buffer.from(f.data, 'base64');
    if (bytes.length > T.LIMITS.figureBytes) throw new HttpError(400, 'figure-too-big');
    total += bytes.length;
    if (total > T.LIMITS.totalBytes) throw new HttpError(400, 'figures-too-big');
    const ext = T.sniff(bytes);
    if (!ext) throw new HttpError(400, 'figure-bad');
    return { ext, size: f.size, bytes };
  });
}

/** Commit one announcement; resolves { post, commit }. `api` is github(); `now` gives the time in ms. */
async function commitPost(api, cfg, input, figures, by, now) {
  const base = '/repos/' + cfg.repo;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await api('GET', base + '/git/ref/heads/' + encodeURIComponent(cfg.branch));
    if (!ref.ok) throw refusal(ref, 'ref');
    const head = ref.json && ref.json.object && ref.json.object.sha;
    const parent = await api('GET', base + '/git/commits/' + head);
    if (!parent.ok) throw refusal(parent, 'commit');
    const listing = await api('GET', base + '/contents/' + POSTS_DIR + '?ref=' + head);
    if (!listing.ok || !Array.isArray(listing.json)) throw refusal(listing, 'listing');
    // the slugs of the announcements already there: the build needs every slug to be its own
    const taken = listing.json.map(x => String(x.name || '')).filter(n => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(n)).map(n => n.slice(11, -3));

    const post = T.buildPost(Object.assign({}, input, { taken, figures: figures.map(f => ({ ext: f.ext, size: f.size })) }));
    const tree = [{ path: post.path, mode: '100644', type: 'blob', content: post.text }];
    for (const img of post.images) {
      const blob = await api('POST', base + '/git/blobs', { content: figures[img.n - 1].bytes.toString('base64'), encoding: 'base64' });
      if (!blob.ok) throw refusal(blob, 'blob');
      tree.push({ path: img.path, mode: '100644', type: 'blob', sha: blob.json.sha });
    }
    const t = await api('POST', base + '/git/trees', { base_tree: parent.json.tree.sha, tree });
    if (!t.ok) throw refusal(t, 'tree');
    const message = 'Announcement: ' + post.slug + '\n\n' + input.title.replace(/\s+/g, ' ').trim() + '\n\nPublished from the website by ' + by + '.';
    const c = await api('POST', base + '/git/commits', { message, tree: t.json.sha, parents: [head] });
    if (!c.ok) throw refusal(c, 'new commit');
    const upd = await api('PATCH', base + '/git/refs/heads/' + encodeURIComponent(cfg.branch), { sha: c.json.sha, force: false });
    if (upd.ok) return { post, commit: c.json.sha };
    if (upd.status !== 422 && upd.status !== 409) throw refusal(upd, 'update');
    // somebody pushed in between (a workflow, a person): start again from the new tip
  }
  throw new HttpError(409, 'github-busy');
}

/* The HTTP handler. deps: { auth, fetch, clock, log }; cfg: { allowedOrigins[], token, repo, branch, siteUrl }. */
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
    try { me = await deps.auth.verifyIdToken(authz.replace(/^Bearer\s+/, ''), true); }
    catch (e) { throw new HttpError(401, 'bad-id-token'); }
    if (!accounts.isAdminToken(me)) throw new HttpError(403, 'not-admin');
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch (e) { throw new HttpError(400, 'bad-request'); }
    if (!body || typeof body !== 'object') throw new HttpError(400, 'bad-request');

    const ready = !!cfg.token && cfg.token !== 'none' && /^[\w-]+\/[\w.-]+$/.test(cfg.repo || '');
    if (body.action === 'status') return res.status(200).json({ ok: true, ready });
    if (body.action !== 'publish') throw new HttpError(400, 'bad-request');
    if (!ready) throw new HttpError(503, 'not-set-up');
    for (const k of ['title', 'category', 'body']) if (typeof body[k] !== 'string') throw new HttpError(400, 'bad-request');
    if (body.description !== undefined && typeof body.description !== 'string') throw new HttpError(400, 'bad-request');
    const cover = body.cover === undefined || body.cover === null || body.cover === 0 ? 0 : body.cover;
    if (cover && !Number.isInteger(cover)) throw new HttpError(400, 'bad-request');

    const figures = readFigures(body.figures);
    const input = { title: body.title, category: body.category, description: body.description || '', body: body.body, cover, date: T.athensDate(deps.clock()) };
    // a cheap check before GitHub is asked anything: this throws the same codes the real build will
    T.buildPost(Object.assign({}, input, { taken: [], figures: figures.map(f => ({ ext: f.ext, size: f.size })) }));

    const { post, commit } = await commitPost(github(deps, cfg), cfg, input, figures, me.email, deps.clock);
    return res.status(200).json({ ok: true, url: String(cfg.siteUrl).replace(/\/?$/, '/') + T.pathOf(post.date, post.slug), path: post.path, file: post.file, slug: post.slug, date: post.date, commit });
  } catch (e) {
    const mine = e instanceof HttpError || !!(e && e.announce);          // an HttpError of this file, or a rule of announce-text.js
    const status = e instanceof HttpError ? e.status : (e && e.announce ? 400 : 500);
    const code = mine ? e.code : 'internal';
    if (status >= 500 && deps.log) deps.log(e);
    return res.status(status).json({ error: code });
  }
}

module.exports = { handle, commitPost, readFigures, github, refusal };
