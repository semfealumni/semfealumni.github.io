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
 *   { action: 'load', file: 'YYYY-MM-DD-slug.md' }
 *                          -> { ok, editable: true, file, sha, url, raw, post: parsePost() }
 *                             or { ok, editable: false, file, url, github }   (written by hand: edit it on GitHub)
 *   { action: 'update', file, sha (from load), title, category, description?, body, cover?,
 *     figures: [{ existing: <its file name>, size? } | { data: <base64>, size? }] }
 *                          -> { ok, edited: true, unchanged?, url, path, file, slug, date, commit }
 *     An edit keeps the date and the address; it is ONE commit titled
 *     "Announcement: <slug>" like a new one (publish.yml checks it the same way),
 *     and it e-mails nobody again (the alerts know the address already).
 * Errors are { error: <code> } with a status: not-signed-in 401, not-admin 403,
 * not-set-up 503, a code of announce-text.js 400, github-token 503, github-busy 409,
 * post-missing 404, post-changed 409 (edited elsewhere since it was opened). */
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

/** Decode and check the pictures: [{ ext, size, bytes }] in the order given; with
    `edit`, an entry may instead name a picture already published: { name, ext, size }. */
function readFigures(list, edit) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new HttpError(400, 'bad-request');
  if (list.length > T.LIMITS.figures) throw new HttpError(400, 'too-many-figures');
  let total = 0;
  return list.map(f => {
    if (edit && f && f.existing !== undefined) {
      if (typeof f.existing !== 'string' || !/^\d{4}-\d{2}-\d{2}-[a-z0-9_-]+-\d+\.(jpg|png|webp|gif)$/.test(f.existing)) throw new HttpError(400, 'figure-bad');
      return { name: f.existing, ext: f.existing.split('.').pop(), size: f.size };
    }
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

/** One commit on the branch, prepared against its tip; resolves { post, commit }.
    prepare(head) -> { post, message, figures } for build.mjs to write, or { post, unchanged: true }.
    Somebody pushing in between (a workflow, a person) starts it again from the new tip. */
async function commitWith(api, cfg, prepare) {
  const base = '/repos/' + cfg.repo;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await api('GET', base + '/git/ref/heads/' + encodeURIComponent(cfg.branch));
    if (!ref.ok) throw refusal(ref, 'ref');
    const head = ref.json && ref.json.object && ref.json.object.sha;
    const parent = await api('GET', base + '/git/commits/' + head);
    if (!parent.ok) throw refusal(parent, 'commit');
    const plan = await prepare(head);
    if (plan.unchanged) return { post: plan.post, commit: null };
    const post = plan.post;
    const tree = [{ path: post.path, mode: '100644', type: 'blob', content: post.text }];
    for (const img of post.images) {
      if (img.existing) continue;                                              // a picture already published keeps its file
      const blob = await api('POST', base + '/git/blobs', { content: plan.figures[img.n - 1].bytes.toString('base64'), encoding: 'base64' });
      if (!blob.ok) throw refusal(blob, 'blob');
      tree.push({ path: img.path, mode: '100644', type: 'blob', sha: blob.json.sha });
    }
    const t = await api('POST', base + '/git/trees', { base_tree: parent.json.tree.sha, tree });
    if (!t.ok) throw refusal(t, 'tree');
    const c = await api('POST', base + '/git/commits', { message: plan.message, tree: t.json.sha, parents: [head] });
    if (!c.ok) throw refusal(c, 'new commit');
    const upd = await api('PATCH', base + '/git/refs/heads/' + encodeURIComponent(cfg.branch), { sha: c.json.sha, force: false });
    if (upd.ok) return { post, commit: c.json.sha };
    if (upd.status !== 422 && upd.status !== 409) throw refusal(upd, 'update');
  }
  throw new HttpError(409, 'github-busy');
}
const titleLine = s => String(s).replace(/\s+/g, ' ').trim();

/** Commit one NEW announcement; resolves { post, commit }. `api` is github(). */
async function commitPost(api, cfg, input, figures, by) {
  const base = '/repos/' + cfg.repo;
  return commitWith(api, cfg, async head => {
    const listing = await api('GET', base + '/contents/' + POSTS_DIR + '?ref=' + head);
    if (!listing.ok || !Array.isArray(listing.json)) throw refusal(listing, 'listing');
    // the slugs of the announcements already there: the build needs every slug to be its own
    const taken = listing.json.map(x => String(x.name || '')).filter(n => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(n)).map(n => n.slice(11, -3));
    const post = T.buildPost(Object.assign({}, input, { taken, figures: figures.map(f => ({ ext: f.ext, size: f.size })) }));
    return { post, figures, message: 'Announcement: ' + post.slug + '\n\n' + titleLine(input.title) + '\n\nPublished from the website by ' + by + '.' };
  });
}

/* ---- editing an announcement already published ---------------------------- */
const FILE_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9_-]+)\.md$/;
/** the file of an announcement at `ref`: { text, sha }, or null when there is none */
async function readPostFile(api, cfg, file, ref) {
  const r = await api('GET', '/repos/' + cfg.repo + '/contents/' + POSTS_DIR + '/' + file + '?ref=' + encodeURIComponent(ref));
  if (r.status === 404) return null;
  if (!r.ok || !r.json || typeof r.json.content !== 'string') throw refusal(r, 'file');
  return { text: Buffer.from(r.json.content, 'base64').toString('utf8'), sha: r.json.sha };
}
/** the pictures of the announcement date-slug already in the repository at `ref`: their file names */
async function postImages(api, cfg, date, slug, ref) {
  const r = await api('GET', '/repos/' + cfg.repo + '/contents/assets/img/posts?ref=' + encodeURIComponent(ref));
  if (r.status === 404) return [];
  if (!r.ok || !Array.isArray(r.json)) throw refusal(r, 'pictures');
  const mine = new RegExp('^' + date + '-' + slug + '-(\\d+)\\.(jpg|png|webp|gif)$');
  return r.json.map(x => String(x.name || '')).filter(n => mine.test(n));
}
/** Commit an edit of `file`, which must still be the version `sha` the admin opened. */
async function commitEdit(api, cfg, file, sha, input, figures, by) {
  const [, date, slug] = FILE_RE.exec(file);
  return commitWith(api, cfg, async head => {
    const now = await readPostFile(api, cfg, file, head);
    if (!now) throw new HttpError(404, 'post-missing');
    if (now.sha !== sha) throw new HttpError(409, 'post-changed');
    const have = await postImages(api, cfg, date, slug, head);
    for (const f of figures) if (f.name && have.indexOf(f.name) === -1) throw new HttpError(400, 'figure-missing');
    // a new picture never takes the name of one already there, used or not
    const nextImage = have.reduce((m, n) => Math.max(m, +n.slice(date.length + slug.length + 2).split('.')[0]), 0) + 1;
    const post = T.buildPost(Object.assign({}, input, { date, keepSlug: slug, nextImage,
      figures: figures.map(f => f.name ? { name: f.name, ext: f.ext, size: f.size } : { ext: f.ext, size: f.size }) }));
    if (post.text === now.text && !post.images.some(i => !i.existing)) return { post, unchanged: true };
    return { post, figures, message: 'Announcement: ' + post.slug + '\n\n' + titleLine(input.title) + '\n\nEdited from the website by ' + by + '.' };
  });
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
    if (['publish', 'load', 'update'].indexOf(body.action) === -1) throw new HttpError(400, 'bad-request');
    if (!ready) throw new HttpError(503, 'not-set-up');
    const site = String(cfg.siteUrl).replace(/\/?$/, '/');
    const api = github(deps, cfg);

    if (body.action === 'load') {
      const m = typeof body.file === 'string' && FILE_RE.exec(body.file);
      if (!m) throw new HttpError(400, 'bad-request');
      const f = await readPostFile(api, cfg, body.file, cfg.branch);
      if (!f) throw new HttpError(404, 'post-missing');
      const url = site + T.pathOf(m[1], m[2]);
      let post;
      try { post = T.parsePost(f.text); } catch (e) {
        if (!(e && e.code === 'not-editable')) throw e;
        return res.status(200).json({ ok: true, editable: false, file: body.file, url,
          github: 'https://github.com/' + cfg.repo + '/edit/' + encodeURIComponent(cfg.branch) + '/' + POSTS_DIR + '/' + body.file });
      }
      return res.status(200).json({ ok: true, editable: true, file: body.file, sha: f.sha, url, post,
        raw: 'https://raw.githubusercontent.com/' + cfg.repo + '/' + encodeURIComponent(cfg.branch) + '/' });
    }
    for (const k of ['title', 'category', 'body']) if (typeof body[k] !== 'string') throw new HttpError(400, 'bad-request');
    if (body.description !== undefined && typeof body.description !== 'string') throw new HttpError(400, 'bad-request');
    const cover = body.cover === undefined || body.cover === null || body.cover === 0 ? 0 : body.cover;
    if (cover && !Number.isInteger(cover)) throw new HttpError(400, 'bad-request');

    if (body.action === 'update') {
      const m = typeof body.file === 'string' && FILE_RE.exec(body.file);
      if (!m || typeof body.sha !== 'string' || !body.sha) throw new HttpError(400, 'bad-request');
      const figures = readFigures(body.figures, true);
      const input = { title: body.title, category: body.category, description: body.description || '', body: body.body, cover };
      // the same cheap check first, with the address it keeps
      T.buildPost(Object.assign({}, input, { date: m[1], keepSlug: m[2], figures: figures.map(f => f.name ? { name: f.name, ext: f.ext, size: f.size } : { ext: f.ext, size: f.size }) }));
      const { post, commit } = await commitEdit(api, cfg, body.file, body.sha, input, figures, me.email);
      return res.status(200).json(Object.assign({ ok: true, edited: true, url: site + T.pathOf(post.date, post.slug), path: post.path, file: post.file, slug: post.slug, date: post.date, commit },
        commit ? {} : { unchanged: true }));
    }

    const figures = readFigures(body.figures);
    const input = { title: body.title, category: body.category, description: body.description || '', body: body.body, cover, date: T.athensDate(deps.clock()) };
    // a cheap check before GitHub is asked anything: this throws the same codes the real build will
    T.buildPost(Object.assign({}, input, { taken: [], figures: figures.map(f => ({ ext: f.ext, size: f.size })) }));

    const { post, commit } = await commitPost(api, cfg, input, figures, me.email);
    return res.status(200).json({ ok: true, url: site + T.pathOf(post.date, post.slug), path: post.path, file: post.file, slug: post.slug, date: post.date, commit });
  } catch (e) {
    const mine = e instanceof HttpError || !!(e && e.announce);          // an HttpError of this file, or a rule of announce-text.js
    const status = e instanceof HttpError ? e.status : (e && e.announce ? 400 : 500);
    const code = mine ? e.code : 'internal';
    if (status >= 500 && deps.log) deps.log(e);
    return res.status(status).json({ error: code });
  }
}

module.exports = { handle, commitPost, commitEdit, readFigures, github, refusal };
