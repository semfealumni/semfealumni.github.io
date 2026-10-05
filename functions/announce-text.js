/* SEMFE Alumni: the rules for an announcement written in the browser, in ONE
   place. The editor on blog/ (assets/js/announce.js) uses it to preview and
   to warn, and the Cloud Function that publishes (functions/announcements.js)
   uses it to decide what is allowed and to write the file, so what an admin
   sees in the preview is what the function commits.
   functions/announce-text.js is a byte-for-byte COPY of this file, because a
   Cloud Function deploy ships only the functions/ folder. Edit this one and
   copy it over: tools/check.mjs fails when the two differ.

   What gets written is an ordinary _src/posts/YYYY-MM-DD-slug.md (YAML front
   matter + Markdown, see _src/README.md) and the pictures in
   assets/img/posts/. The text is Markdown, with three things made harmless
   first (escapeBody): "<" (so no HTML), "&" (so no entity can spell a
   character that means something) and "{" "}" (so no attribute list and no
   {{placeholder}} of the page builder can be written). A line break inside a
   paragraph is a backslash at the end of the line; the editor's tips say so.
   Written in ES5 for every browser the site supports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SemfeAnnounce = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    title: 150,
    description: 200,
    body: 20000,
    alt: 200,
    figures: 8,
    figureBytes: 1200000,      // one picture, as sent (the editor shrinks them to about 500 KB first)
    totalBytes: 6000000        // all the pictures of one announcement
  };
  // KEEP IN SYNC with the categories in alert-topics.js: the category also decides who is e-mailed (tools/check.mjs)
  var CATEGORIES = ['Ανακοινώσεις', 'Εκδηλώσεις'];
  // how wide a picture is shown in the text; "full" is the width of the text column
  var SIZES = {
    full: { label: 'Πλήρες πλάτος', attr: '' },
    medium: { label: 'Μεσαίο', attr: ' style="max-width:600px;width:100%"' },
    small: { label: 'Μικρό', attr: ' style="max-width:360px;width:100%"' }
  };

  function AnnounceError(code, detail) {
    var e = new Error(code + (detail ? ': ' + detail : ''));
    e.code = code; e.detail = detail || ''; e.announce = true;
    return e;
  }

  /* ---- the address -------------------------------------------------------- */
  var GREEK = { 'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm',
    'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o' };
  /** "Κοπή πίτας 2026" -> "kopi-pitas-2026": the last part of the announcement's address */
  function slugify(title) {
    var s = String(title == null ? '' : title).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/ου/g, 'ou').replace(/αι/g, 'ai').replace(/ει/g, 'ei').replace(/οι/g, 'oi')
      .replace(/μπ/g, 'b').replace(/ντ/g, 'd').replace(/γκ/g, 'g').replace(/γγ/g, 'ng');
    s = s.replace(/[α-ως]/g, function (c) { return GREEK[c] || ''; });
    s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > 60) { var cut = s.slice(0, 60); s = (cut.lastIndexOf('-') > 20 ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/, ''); }
    return s || 'anakoinosi';
  }
  /** a slug not in `taken` (the slugs of the announcements already there): kopi-pitas, kopi-pitas-2, kopi-pitas-3… */
  function uniqueSlug(slug, taken) {
    var set = {}, i;
    for (i = 0; i < taken.length; i++) set[taken[i]] = true;
    if (!set[slug]) return slug;
    for (i = 2; i < 1000; i++) if (!set[slug + '-' + i]) return slug + '-' + i;
    throw AnnounceError('slug-taken');
  }
  /** today's date in Greece, YYYY-MM-DD (the date an announcement is filed under) */
  function athensDate(ms) {
    var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    var g = {}; p.forEach(function (x) { g[x.type] = x.value; });
    return g.year + '-' + g.month + '-' + g.day;
  }

  /* ---- the text ------------------------------------------------------------ */
  function oneLine(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/<[^>]*>/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max === undefined ? 1e6 : max);
  }
  /** the body with "<", "&", "{" and "}" made plain characters (a backslash before each, unless it already has one), and no code blocks */
  function escapeBody(text) {
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '');
    s = s.replace(/(\\*)([<&{}])/g, function (m, bs, ch) { return bs.length % 2 ? m : bs + '\\' + ch; });
    // a line that opens a code block (``` or ~~~) shows its marks instead: an announcement has no code blocks
    s = s.replace(/^( {0,3})([`~]{3,})/gm, function (m, sp, marks) { return sp + marks.replace(/[`~]/g, '\\$&'); });
    return s.replace(/^\n+/, '').replace(/\s+$/, '');
  }
  /** "{{" would be filled in by the page builder ({{root}}, {{icon:…}}, {{latest}}…): it is refused in any text */
  function hasPlaceholder(s) { return /\{\{|\\\{\\\{/.test(String(s)); }
  /** the card's sentence when none is written: the first sentence-ish piece of the first paragraph, as plain text */
  function describe(body, title) {
    var paras = String(body).replace(/\r\n?/g, '\n').split(/\n\s*\n/), i, t = '';
    for (i = 0; i < paras.length; i++) {
      t = paras[i].replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
        .replace(/[*_`\\]/g, '').replace(/\s+/g, ' ').trim();
      if (t) break;
    }
    if (!t) return oneLine(title, LIMITS.description);
    if (t.length > 180) { t = t.slice(0, 180); t = t.slice(0, Math.max(t.lastIndexOf(' '), 100)).replace(/[\s,;:.]+$/, '') + '…'; }
    return t;
  }

  /* ---- a picture's kind, from its first bytes (never from its name) --------- */
  function sniff(bytes) {
    var b = bytes;
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
    return '';
  }

  /** Everything about one announcement, as the files to write.
      input: { title, category, description?, body, date (YYYY-MM-DD), slug?, taken?: [slugs], cover?: 1-based number of the figure shown on the card,
               figures: [{ ext ('jpg'|'png'|'webp'|'gif'), size?: 'full'|'medium'|'small' }] }   (in the body: ![describe it](figure-1))
      returns { slug, date, file, path, text, description, images: [{ n, ext, name, path }] }; throws an AnnounceError with a code. */
  function buildPost(input) {
    var title = oneLine(input.title, LIMITS.title + 1);
    if (!title) throw AnnounceError('title-missing');
    if (title.length > LIMITS.title) throw AnnounceError('title-too-long');
    if (CATEGORIES.indexOf(input.category) < 0) throw AnnounceError('category-bad');
    var description = oneLine(input.description, LIMITS.description + 1);
    if (description.length > LIMITS.description) throw AnnounceError('description-too-long');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw AnnounceError('date-bad');
    var raw = String(input.body == null ? '' : input.body);
    if (!raw.trim()) throw AnnounceError('body-missing');
    if (raw.length > LIMITS.body) throw AnnounceError('body-too-long');
    if (hasPlaceholder(title) || hasPlaceholder(description) || hasPlaceholder(raw)) throw AnnounceError('braces');
    var figures = input.figures || [];
    if (figures.length > LIMITS.figures) throw AnnounceError('too-many-figures');

    var slug = uniqueSlug(slugify(title), input.taken || []);
    var body = escapeBody(raw);
    if (hasPlaceholder(body)) throw AnnounceError('braces');
    var used = {}, images = [];
    var cover = input.cover ? +input.cover : 0;
    if (cover && !(cover >= 1 && cover <= figures.length)) throw AnnounceError('cover-bad');
    // ![describe it](figure-2) -> the picture's real address, and a way to size it
    body = body.replace(/!\[([^\]\n]*)\]\(figure-(\d+)\)/g, function (m, alt, num) {
      var n = +num, f = figures[n - 1];
      if (!f) throw AnnounceError('figure-missing', 'figure-' + n);
      if (alt.length > LIMITS.alt) throw AnnounceError('alt-too-long');
      used[n] = true;
      var size = SIZES[f.size] ? f.size : 'full';
      return '![' + alt.replace(/\s+/g, ' ').trim() + '](' + imageRef(n, f) + '){ loading=lazy' + SIZES[size].attr + ' }';
    });
    function nameOf(n, f) { return input.date + '-' + slug + '-' + n + '.' + f.ext; }
    function imageRef(n, f) {
      if (['jpg', 'png', 'webp', 'gif'].indexOf(f.ext) < 0) throw AnnounceError('figure-bad');
      return '{{root}}assets/img/posts/' + nameOf(n, f);
    }
    if (cover) used[cover] = true;
    figures.forEach(function (f, i) {
      var n = i + 1;
      if (!used[n]) return;
      imageRef(n, f);
      images.push({ n: n, ext: f.ext, name: nameOf(n, f), path: 'assets/img/posts/' + nameOf(n, f) });
    });
    if (!description) description = oneLine(describe(raw, title), LIMITS.description);

    var lines = ['---', 'title: ' + yamlText(title), 'date: ' + input.date, 'slug: ' + JSON.stringify(slug), 'category: ' + input.category];
    if (cover) lines.push('image: ' + nameOf(cover, figures[cover - 1]));
    lines.push('description: ' + yamlText(description), '---', '', body, '');
    var file = input.date + '-' + slug + '.md';
    return { slug: slug, date: input.date, file: file, path: '_src/posts/' + file, text: lines.join('\n'), description: description, images: images };
  }
  /* a text as a YAML double-quoted scalar: JSON's quoting is YAML's, bar the two line separators JSON leaves alone */
  function yamlText(s) { return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

  /** the address of an announcement on the site, relative to the site root */
  function pathOf(date, slug) { var d = date.split('-'); return 'blog/' + d[0] + '/' + d[1] + '/' + d[2] + '/' + slug + '/'; }

  return {
    LIMITS: LIMITS, CATEGORIES: CATEGORIES, SIZES: SIZES, AnnounceError: AnnounceError,
    slugify: slugify, uniqueSlug: uniqueSlug, athensDate: athensDate, oneLine: oneLine, escapeBody: escapeBody,
    hasPlaceholder: hasPlaceholder, describe: describe, sniff: sniff, buildPost: buildPost, pathOf: pathOf
  };
}));
