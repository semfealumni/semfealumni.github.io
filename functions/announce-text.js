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
   assets/img/posts/. The text is Markdown, with four things made harmless
   first (escapeBody): "<" (so no HTML; and "<!" is broken so no <!--if:…-->
   condition of the page builder can be written), "&" (so no entity can spell a
   character that means something), "{" and "}" (they become the full-width
   ｛ ｝, so no attribute list and no {{placeholder}} can be written, even by
   putting markup between two braces, which Markdown strips from an image's
   alt text), and code blocks (shown as text). A link must start with https://,
   http://, mailto:, tel: or # (a relative address would be wrong at the
   announcement's depth). A line break inside a paragraph is a backslash at the
   end of the line; the editor's tips say so.

   An announcement written here can be EDITED later (parsePost): its file is read
   back into the editor's form (the plain characters shown plainly again, each
   picture line back to ![](figure-N)) only when building it again gives the very
   same file, so nothing written by hand on GitHub is ever rewritten by the
   editor. An edit keeps the date and the address (keepSlug), the pictures
   already there keep their files (figure.name), and new ones are numbered after
   every picture of the announcement already in the repository (nextImage).
   Written in ES5 for every browser the site supports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SemfeAnnounce = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    title: 150,
    description: 200,
    descriptionMin: 20,        // the search-engine description of every page: tools/check.mjs wants this many
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
  /** s without control characters, the two line separators, U+FFFE and U+FFFF (they make an XML feed invalid) and half of a surrogate pair */
  function cleanChars(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\ufffe\uffff]/g, '');
    var out = '', i, c, d;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; } }
      else if (!(c >= 0xDC00 && c <= 0xDFFF)) out += s.charAt(i);
    }
    return out;
  }
  /** "{" and "}" as the full-width ｛ ｝: the page builder and the attribute lists only know the ASCII ones */
  function plainBraces(s) { return s.replace(/\{/g, '\uff5b').replace(/\}/g, '\uff5d'); }
  function oneLine(s, max) {
    var cap = max === undefined ? 1e6 : max;
    s = String(s == null ? '' : s).slice(0, cap * 4 + 100);                         // before any pattern runs: a huge input costs nothing
    s = cleanChars(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/<[^>]*>/g, ' ').replace(/[<>]/g, '');
    return cleanChars(plainBraces(s).replace(/\s+/g, ' ').trim().slice(0, cap));
  }
  /** the body with "<", "&" made plain characters (a backslash before each, unless it already has one), "<!" broken, "{" "}" full-width, and no code blocks */
  function escapeBody(text) {
    var s = cleanChars(String(text == null ? '' : text).replace(/\r\n?/g, '\n'));
    s = plainBraces(s);
    s = s.replace(/(\\*)([<&])/g, function (m, bs, ch) { return bs.length % 2 ? m : bs + '\\' + ch; });
    s = s.replace(/(\\<)!/g, '$1\\!');                                              // no "<!" anywhere: <!--if:KEY--> is a condition of the page builder
    // a line that opens a code block (``` or ~~~) shows its marks instead: an announcement has no code blocks
    s = s.replace(/^( {0,3})([`~]{3,})/gm, function (m, sp, marks) { return sp + marks.replace(/[`~]/g, '\\$&'); });
    return s.replace(/^\n+/, '').replace(/\s+$/, '');
  }
  /** escapeBody undone, for the editor: what the admin typed, shown as typed. escapeBody(unescapeBody(s)) === s for any s escapeBody wrote. */
  function unescapeBody(text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/^( {0,3})((?:\\[`~]){3,})/gm, function (m, sp, marks) { return sp + marks.replace(/\\/g, ''); });
    s = s.replace(/(\\<)\\!/g, '$1!');
    return s.replace(/(\\+)([<&])/g, function (m, bs, ch) { return (bs.length % 2 ? bs.slice(1) : bs) + ch; });
  }
  /** "{{" would be filled in by the page builder ({{root}}, {{icon:…}}, {{latest}}…): it is refused, in plain words, in any text */
  function hasPlaceholder(s) { return /\{\{/.test(String(s)); }
  /** every link must be absolute (https://, http://, mailto:, tel:), an anchor (#…) or one of the picture lines: a relative one would be wrong at the announcement's depth */
  function checkLinks(text) {
    var m, re = /\]\(\s*([^)\s]*)/g, ref = /^ {0,3}\[[^\]\n]+\]:[ \t]*(\S+)/gm, ok = /^(https?:\/\/|mailto:|tel:|#|figure-\d+$)/i;
    while ((m = re.exec(text))) if (m[1] && !ok.test(m[1])) throw AnnounceError('link-bad', m[1].slice(0, 60));
    while ((m = ref.exec(text))) if (!ok.test(m[1])) throw AnnounceError('link-bad', m[1].slice(0, 60));
  }
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
      input: { title, category, description?, body, date (YYYY-MM-DD), taken?: [slugs], cover?: 1-based number of the figure shown on the card,
               figures: [{ ext ('jpg'|'png'|'webp'|'gif'), size?: 'full'|'medium'|'small', name?: the file of a picture already published }],
               keepSlug?: the address of the announcement being edited, nextImage?: the number its first NEW picture gets (default 1) }
               (in the body: ![describe it](figure-1))
      returns { slug, date, file, path, text, description, images: [{ n, ext, name, path, existing }] }; throws an AnnounceError with a code. */
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
    if (hasPlaceholder(input.title) || hasPlaceholder(input.description) || hasPlaceholder(raw)) throw AnnounceError('braces');
    checkLinks(raw);
    var figures = input.figures || [];
    if (figures.length > LIMITS.figures) throw AnnounceError('too-many-figures');

    var slug;
    if (input.keepSlug !== undefined) {                                            // an edit: the address does not move
      if (!/^[a-z0-9_-]+$/.test(String(input.keepSlug))) throw AnnounceError('slug-bad');
      slug = String(input.keepSlug);
    } else slug = uniqueSlug(slugify(title), input.taken || []);
    // each picture's file: a published one keeps its own, a new one gets the next free number
    var next = input.nextImage ? +input.nextImage : 1, names = [], i0;
    if (!(next >= 1 && next < 1000)) throw AnnounceError('figure-bad');
    var mine = new RegExp('^' + input.date + '-' + slug + '-\\d+\\.(jpg|png|webp|gif)$');
    for (i0 = 0; i0 < figures.length; i0++) {
      var fx = figures[i0] || {};
      if (fx.name !== undefined) {
        if (!mine.test(String(fx.name))) throw AnnounceError('figure-bad');
        if (String(fx.name).split('.').pop() !== fx.ext) throw AnnounceError('figure-bad');
        names.push(String(fx.name));
      } else names.push(input.date + '-' + slug + '-' + (next++) + '.' + fx.ext);
    }
    var body = escapeBody(raw);
    if (/[{}]/.test(body + title + description) || /<!/.test(body)) throw AnnounceError('braces');       // what escapeBody and oneLine were to guarantee
    var used = {}, images = [];
    var cover = input.cover ? +input.cover : 0;
    if (cover && !(cover >= 1 && cover <= figures.length)) throw AnnounceError('cover-bad');
    // ![describe it](figure-2) -> the picture's real address, and a way to size it
    body = body.replace(/!\[([^\]\n]*)\]\(\s*figure-(\d+)(?:\s+"[^"\n]*")?\s*\)/g, function (m, alt, num) {
      var n = +num, f = figures[n - 1];
      if (!f) throw AnnounceError('figure-missing', 'figure-' + n);
      if (alt.length > LIMITS.alt) throw AnnounceError('alt-too-long');
      used[n] = true;
      var size = Object.prototype.hasOwnProperty.call(SIZES, f.size) ? f.size : 'full';
      return '![' + alt.replace(/\s+/g, ' ').replace(/\\+$/, '').trim() + '](' + imageRef(n, f) + '){ loading=lazy' + SIZES[size].attr + ' }';
    });
    if (/\(\s*figure-/.test(body)) throw AnnounceError('figure-bad', 'a picture line that is not ![describe it](figure-N)');
    function nameOf(n) { return names[n - 1]; }
    function imageRef(n, f) {
      if (['jpg', 'png', 'webp', 'gif'].indexOf(f.ext) < 0) throw AnnounceError('figure-bad');
      return '{{root}}assets/img/posts/' + nameOf(n);
    }
    if (cover) used[cover] = true;
    figures.forEach(function (f, i) {
      var n = i + 1;
      if (!used[n]) return;
      imageRef(n, f);
      images.push({ n: n, ext: f.ext, name: nameOf(n), path: 'assets/img/posts/' + nameOf(n), existing: f.name !== undefined });
    });
    if (!description) description = oneLine(describe(plainBraces(cleanChars(raw)), title), LIMITS.description);
    // every page's description must say something: the title goes first, then the association's name
    if (description.length < LIMITS.descriptionMin && description.toLowerCase().indexOf(title.toLowerCase()) !== 0) description = oneLine(title + '. ' + description, LIMITS.description);
    if (description.length < LIMITS.descriptionMin) description = oneLine(description + ' · Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ', LIMITS.description);

    var lines = ['---', 'title: ' + yamlText(title), 'date: ' + input.date, 'slug: ' + JSON.stringify(slug), 'category: ' + input.category];
    if (cover) lines.push('image: ' + nameOf(cover));
    lines.push('description: ' + yamlText(description), '---', '', body, '');
    var file = input.date + '-' + slug + '.md';
    return { slug: slug, date: input.date, file: file, path: '_src/posts/' + file, text: lines.join('\n'), description: description, images: images };
  }
  /** An announcement's file read back into the editor's form, for an edit:
      { title, category, description ('' when it is the one made from the text), body (with ![](figure-N) lines),
        date, slug, cover, figures: [{ name, ext, size, alt }] }.
      Throws AnnounceError('not-editable') for a file the editor did not write, or one changed by hand since:
      only a file that building it again reproduces exactly is ever offered for editing. */
  var SIZE_OF = {};
  (function () { for (var k in SIZES) if (Object.prototype.hasOwnProperty.call(SIZES, k)) SIZE_OF[SIZES[k].attr] = k; })();
  function parsePost(text) {
    var s = String(text == null ? '' : text);
    var m = /^---\ntitle: (".*")\ndate: (\d{4}-\d{2}-\d{2})\nslug: ("[a-z0-9_-]+")\ncategory: ([^\n]+)\n(?:image: ([^\n]+)\n)?description: (".*")\n---\n\n([\s\S]*)\n$/.exec(s);
    if (!m) throw AnnounceError('not-editable');
    var title, slug, description;
    try { title = JSON.parse(m[1]); slug = JSON.parse(m[3]); description = JSON.parse(m[6]); } catch (e) { throw AnnounceError('not-editable'); }
    if (typeof title !== 'string' || typeof slug !== 'string' || typeof description !== 'string') throw AnnounceError('not-editable');
    var date = m[2], category = m[4], image = m[5] || '', figs = [], at = {};
    var line = /!\[([^\]\n]*)\]\(\{\{root\}\}assets\/img\/posts\/([A-Za-z0-9_.-]+)\)\{ loading=lazy( style="[^"\n]*")? \}/g;
    var body = m[7].replace(line, function (all, alt, name, style) {
      var size = SIZE_OF[style || ''];
      if (!size) throw AnnounceError('not-editable');
      if (!at[name]) { figs.push({ name: name, ext: name.split('.').pop(), size: size, alt: unescapeBody(alt) }); at[name] = figs.length; }
      return '![](figure-' + at[name] + ')';
    });
    if (/[{}]/.test(body)) throw AnnounceError('not-editable');                    // an attribute list or a placeholder written by hand
    body = unescapeBody(body);
    var cover = 0;
    if (image) {
      if (!at[image]) { figs.push({ name: image, ext: image.split('.').pop(), size: 'full', alt: '' }); at[image] = figs.length; }
      cover = at[image];
    }
    var out = { title: title, category: category, description: description, body: body, date: date, slug: slug, cover: cover, figures: figs };
    // the proof: built again, exactly as the editor will send it, it is the same file
    var again;
    try { again = buildPost(editInput(out)); } catch (e) { throw AnnounceError('not-editable'); }
    if (again.text !== s) throw AnnounceError('not-editable');
    // a description that was made from the text is left empty, so it follows the text when that changes
    try { if (buildPost(editInput(out, '')).description === description) out.description = ''; } catch (e) { /* keep it */ }
    return out;
  }
  /** what the editor sends for an edit of a parsed post (pictures' descriptions put back on their lines) */
  function editInput(p, description) {
    var body = String(p.body).replace(/!\[[^\]\n]*\]\(figure-(\d+)\)/g, function (m, k) {
      var f = p.figures[+k - 1], alt = f ? String(f.alt || '').replace(/[\[\]\\\n]/g, ' ').replace(/\s+/g, ' ').trim() : '';
      return '![' + alt + '](figure-' + k + ')';
    });
    return { title: p.title, category: p.category, description: description === undefined ? p.description : description, body: body, date: p.date,
      keepSlug: p.slug, cover: p.cover || 0, figures: p.figures.map(function (f) { return { name: f.name, ext: f.ext, size: f.size }; }) };
  }
  /* a text as a YAML double-quoted scalar: JSON's quoting is YAML's, bar the two line separators JSON leaves alone */
  function yamlText(s) { return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

  /** the address of an announcement on the site, relative to the site root */
  function pathOf(date, slug) { var d = date.split('-'); return 'blog/' + d[0] + '/' + d[1] + '/' + d[2] + '/' + slug + '/'; }

  return {
    LIMITS: LIMITS, CATEGORIES: CATEGORIES, SIZES: SIZES, AnnounceError: AnnounceError,
    slugify: slugify, uniqueSlug: uniqueSlug, athensDate: athensDate, oneLine: oneLine, escapeBody: escapeBody,
    hasPlaceholder: hasPlaceholder, checkLinks: checkLinks, cleanChars: cleanChars, plainBraces: plainBraces, describe: describe, sniff: sniff, buildPost: buildPost, pathOf: pathOf,
    unescapeBody: unescapeBody, parsePost: parsePost, editInput: editInput
  };
}));
