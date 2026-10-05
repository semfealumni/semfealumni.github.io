#!/usr/bin/env node
/* Offline test of how _src/ pages are read:  node tools/md-selftest.mjs
   The Markdown dialect (tools/markdown.mjs), the YAML component blocks
   (tools/components.mjs), the sign-in conditions (tools/conditions.mjs), the
   front matter, and every real file of _src/ checked against all of them.
   No network, no install. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, wrapLayout, splitFrontMatter, dumpFrontMatter, dumpYamlList, parseAttrs, LAYOUTS } from './markdown.mjs';
import { COMPONENTS } from './components.mjs';
import { applyConditions } from './conditions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0, bad = 0;
const t = (name, cond, detail) => { n++; if (!cond) { bad++; console.log('FAIL  ' + name + (detail ? '\n' + detail : '')); } };
const eq = (name, got, want) => t(name, got === want, `  want: ${JSON.stringify(want)}\n  got:  ${JSON.stringify(got)}`);
const throws = (name, fn, re) => { let msg = null; try { fn(); } catch (e) { msg = e.message; } t(name, msg !== null && re.test(msg), `  expected an error matching ${re}, got: ${msg}`); };
const md = s => renderMarkdown(s, 'test.md');

/* ---- the dialect ----------------------------------------------------------- */
eq('plain paragraph', md('Γειά σου **κόσμε**'), '<p>Γειά σου <strong>κόσμε</strong></p>\n');
eq('a {{root}} link is not percent-encoded', md('[x]({{root}}contact/)'), '<p><a href="{{root}}contact/">x</a></p>\n');
eq('{{post:slug}} survives in a link', md('[x]({{post:a-b_c}})'), '<p><a href="{{post:a-b_c}}">x</a></p>\n');
eq('{{icon:x}} inside a link text', md('[{{icon:arrow}}Go]({{root}}a/)'), '<p><a href="{{root}}a/">{{icon:arrow}}Go</a></p>\n');
eq('{{latest}} alone is a block, not a paragraph', md('{{latest}}'), '{{latest}}\n');
eq('{{posts}} and {{social}} too', md('a\n\n{{posts}}\n\n{{social}}\n'), '<p>a</p>\n{{posts}}\n{{social}}\n');
eq('{{signin}} in a sentence stays text', md('με {{signin}} και'), '<p>με {{signin}} και</p>\n');
eq('no typographic quotes, no auto-links', md("'a' \"b\" -- http://x.y"), '<p>\'a\' &quot;b&quot; -- http://x.y</p>\n');
eq('raw HTML around Markdown (md_in_html style)', md('<div class="a">\n\n## T\n\ntext\n\n</div>\n'), '<div class="a">\n<h2>T</h2>\n<p>text</p>\n</div>\n');
eq('an image alone is not wrapped in <p>', md('![a](x.jpg){ width=10 }\n\ntext\n'), '<img src="x.jpg" alt="a" width="10">\n<p>text</p>\n');
eq('an image in a sentence keeps its <p>', md('a ![b](x.jpg) c'), '<p>a <img src="x.jpg" alt="b"> c</p>\n');
eq('a line break written <br>', md('a<br>\nb'), '<p>a<br>\nb</p>\n');

/* ---- attribute lists ------------------------------------------------------- */
eq('parseAttrs: class, id, key, quoted, flag', JSON.stringify(parseAttrs('.a #b k=v q="x y" f')), '[["class","a"],["id","b"],["k","v"],["q","x y"],["f",""]]');
t('parseAttrs: not an attribute list', parseAttrs('a b c d') !== null ? parseAttrs('{x}') === null : true);
t('parseAttrs: empty', parseAttrs('  ') === null);
eq('link attributes', md('[x](u){ .btn .btn-dark }'), '<p><a href="u" class="btn btn-dark">x</a></p>\n');
eq('newtab is target=_blank rel=noopener', md('[x](https://a.b){ .btn newtab }'), '<p><a href="https://a.b" class="btn" target="_blank" rel="noopener">x</a></p>\n');
eq('paragraph attributes on its last line', md('Με εκτίμηση,\n{ .sign }'), '<p class="sign">Με εκτίμηση,</p>\n');
eq('heading attributes', md('## T { #a style="font-size:1rem" }'), '<h2 id="a" style="font-size:1rem">T</h2>\n');
eq('list attributes on a line after the list', md('- a\n- b\n\n{ .checklist }\n'), '<ul class="checklist">\n<li>a</li>\n<li>b</li>\n</ul>\n');
eq('quote attributes on a line after the quote', md('> q\n\n{ .big }\n'), '<blockquote class="big">\n<p>q</p>\n</blockquote>\n');
eq('an attribute line after a plain paragraph is left as text', md('a\n\n{ .x }\n'), '<p>a</p>\n<p>{ .x }</p>\n');
eq('two lists apart stay two lists', md('- a\n\n{ .one }\n\n* b\n\n{ .two }\n'), '<ul class="one">\n<li>a</li>\n</ul>\n<ul class="two">\n<li>b</li>\n</ul>\n');

/* ---- components ------------------------------------------------------------ */
const fence = (info, yaml) => md('```' + info + '\n' + yaml + '\n```\n');
eq('people', fence('{people}', '- id: karalis\n  name: Κάραλης Δημήτρης\n  role: Πρόεδρος\n  linkedin: https://www.linkedin.com/in/x'),
  `<div class="people">
  <article class="person" id="karalis">
    <img src="{{root}}assets/img/profiles/karalis.jpg" alt="Κάραλης Δημήτρης" width="116" height="116" loading="lazy">
    <div class="role">Πρόεδρος</div>
    <h3>Κάραλης Δημήτρης</h3>
    <a class="btn btn-outline btn-sm li linkedin-btn" href="https://www.linkedin.com/in/x" target="_blank" rel="noopener" aria-label="Κάραλης Δημήτρης στο LinkedIn">{{icon:linkedin}}LinkedIn</a>
  </article>
</div>
`);
t('people: another photo, no LinkedIn', /profiles\/p_2\.jpg/.test(fence('{people}', '- id: a\n  name: A\n  role: R\n  photo: p_2.jpg')) && !/linkedin-btn/.test(fence('{people}', '- id: a\n  name: A\n  role: R')));
eq('people-mini', fence('{people-mini}', '- id: karalis\n  name: Κάραλης Δημήτρης\n  role: Πρόεδρος'),
  `<div class="people-mini" role="group" aria-label="Μέλη του Διοικητικού Συμβουλίου">
  <a href="{{root}}governance/#karalis" title="Κάραλης Δημήτρης, Πρόεδρος"><img src="{{root}}assets/img/profiles/karalis.jpg" alt="Κάραλης Δημήτρης" width="60" height="60" loading="lazy"></a>
</div>
`);
eq('docs', fence('{docs}', '- title: Καταστατικό\n  meta: Οι κανόνες\n  file: foundation/k.pdf\n- title: Β\n  file: x/b.pdf'),
  `<div class="docs">
  <div class="doc"><span class="ic" aria-hidden="true">PDF</span><div><h3>Καταστατικό</h3><span class="muted">Οι κανόνες</span></div><div class="acts"><a class="btn btn-outline btn-sm" href="{{root}}assets/docs/foundation/k.pdf" target="_blank" rel="noopener">{{icon:external}}Άνοιγμα</a><a class="btn btn-dark btn-sm" href="{{root}}assets/docs/foundation/k.pdf" download>{{icon:download}}Λήψη</a></div></div>
  <div class="doc"><span class="ic" aria-hidden="true">PDF</span><div><h3>Β</h3></div><div class="acts"><a class="btn btn-outline btn-sm" href="{{root}}assets/docs/x/b.pdf" target="_blank" rel="noopener">{{icon:external}}Άνοιγμα</a><a class="btn btn-dark btn-sm" href="{{root}}assets/docs/x/b.pdf" download>{{icon:download}}Λήψη</a></div></div>
</div>
`);
eq('gallery', fence('{gallery}', '- img: a.jpg\n  caption: Μία "φωτογραφία" & άλλα\n  class: wide\n  cap: true\n- img: sub/b.jpg\n  caption: Δύο'),
  `<div class="gallery" data-gallery>
  <a class="wide" href="{{root}}assets/img/history/a.jpg" data-caption="Μία &quot;φωτογραφία&quot; &amp; άλλα"><img src="{{root}}assets/img/history/thumbs/a.jpg" alt="Μία &quot;φωτογραφία&quot; &amp; άλλα" loading="lazy" decoding="async"><span class="cap">Μία "φωτογραφία" &amp; άλλα</span></a>
  <a href="{{root}}assets/img/history/sub/b.jpg" data-caption="Δύο"><img src="{{root}}assets/img/history/sub/thumbs/b.jpg" alt="Δύο" loading="lazy" decoding="async"></a>
</div>
`);
eq('accordion: group, numbering, open, inline Markdown', fence('{accordion g}', '- q: Α\n  a: Το **ένα** [link](u)\n  open: true\n- q: Β\n  a: Το δύο'),
  `<ol class="qa">
  <li><details name="g" open><summary><span class="qa-n">1</span><span class="qa-q">Α</span><span class="qa-i" aria-hidden="true"></span></summary><p>Το <strong>ένα</strong> <a href="u">link</a></p></details></li>
  <li><details name="g"><summary><span class="qa-n">2</span><span class="qa-q">Β</span><span class="qa-i" aria-hidden="true"></span></summary><p>Το δύο</p></details></li>
</ol>
`);
eq('milestones', fence('{milestones}', '- when: 2014\n  title: Τ\n  text: Κείμενο'),
  '<ol class="milestones">\n  <li><span class="when">2014</span><strong>Τ</strong><span class="d">Κείμενο</span></li>\n</ol>\n');
eq('hero-stats (a number is text; count: true)', fence('{hero-stats}', '- value: 2013\n  label: Α\n- value: 3.000+\n  label: Β\n  count: true'),
  '<div class="hero-stats" role="group" aria-label="Ο Σύλλογος με αριθμούς">\n  <div class="hero-stat"><div class="value">2013</div><div class="label">Α</div></div>\n  <div class="hero-stat"><div class="value" data-count>3.000+</div><div class="label">Β</div></div>\n</div>\n');
eq('stats with an extra class', fence('{stats one}', '- value: 5 + 5\n  label: Μέλη'),
  '<div class="stats one">\n  <div class="stat"><div class="value">5 + 5</div><div class="label">Μέλη</div></div>\n</div>\n');
eq('a plain fence is still code', md('```js\nlet a = 1;\n```\n'), '<pre><code class="language-js">let a = 1;\n</code></pre>\n');
throws('an unknown component', () => md('```{people2}\n- a: b\n```'), /no component \{people2\}.*known: people/);
throws('a missing field names the entry', () => fence('{people}', '- id: a\n  name: A'), /test\.md: the \{people\} block, entry 1 has no "role"/);
throws('an unknown key', () => fence('{people}', '- id: a\n  name: A\n  role: R\n  nick: x'), /entry 1 has "nick".*it knows: id, name, role, photo, linkedin/);
throws('a flag must be true or false', () => fence('{accordion}', '- q: a\n  a: b\n  open: yes please'), /"open" must be true or false/);
throws('not a list', () => fence('{docs}', 'title: x'), /must be a list of entries/);
throws('bad YAML names the file', () => fence('{docs}', '- title: [x'), /test\.md: the \{docs\} block is not valid YAML/);
t('every component is covered above', Object.keys(COMPONENTS).every(k => ['people', 'people-mini', 'docs', 'gallery', 'accordion', 'milestones', 'hero-stats', 'stats'].includes(k)) && Object.keys(COMPONENTS).length === 8);

/* ---- sign-in conditions ---------------------------------------------------- */
const test = k => { if (!['a', 'b'].includes(k)) throw new Error('unknown ' + k); return k === 'a'; };
eq('inline condition kept', applyConditions('x <!--if:a-->y<!--/if:a--> z', 'f', test), 'x y z');
eq('inline condition dropped', applyConditions('x <!--if:b-->y<!--/if:b--> z', 'f', test), 'x  z');
eq('line conditions: kept block leaves its lines only', applyConditions('- 1\n<!--if:a-->\n- 2\n<!--/if:a-->\n- 3\n', 'f', test), '- 1\n- 2\n- 3\n');
eq('line conditions: a dropped block takes its lines', applyConditions('- 1\n<!--if:b-->\n- 2\n<!--/if:b-->\n- 3\n', 'f', test), '- 1\n- 3\n');
eq('nested', applyConditions('<!--if:a-->\nA\n<!--if:b-->\nB\n<!--/if:b-->\n<!--/if:a-->\n', 'f', test), 'A\n');
throws('an unknown key', () => applyConditions('<!--if:zz-->x<!--/if:zz-->', 'f', test), /unknown zz/);
throws('an opening marker with no partner', () => applyConditions('<!--if:a-->x', 'f', test), /no partner/);
throws('a closing marker with no partner', () => applyConditions('x<!--/if:a-->', 'f', test), /no partner/);

/* ---- front matter ---------------------------------------------------------- */
const fm = splitFrontMatter('---\ntitle: "A: b"\ndate: 2025-03-02\nn: 5\nflag: true\nlist: [x, y]\ncrumbs:\n  - [Διοίκηση, null]\n---\n\nbody\n', 'f.md');
eq('front matter: text, date stays text', fm.data.title + '|' + fm.data.date + '|' + typeof fm.data.date, 'A: b|2025-03-02|string');
eq('front matter: number, boolean, lists, null', JSON.stringify([fm.data.n, fm.data.flag, fm.data.list, fm.data.crumbs]), '[5,true,["x","y"],[["Διοίκηση",null]]]');
eq('front matter: the body follows the blank line', fm.body, 'body\n');
throws('no front matter', () => splitFrontMatter('# x\n', 'f.md'), /f\.md: must start with a front matter block/);
throws('bad YAML in front matter', () => splitFrontMatter('---\na: [\n---\nx', 'f.md'), /f\.md: the front matter is not valid YAML/);
throws('front matter that is a list', () => splitFrontMatter('---\n- a\n---\nx', 'f.md'), /must be a list of "key: value" lines/);
{
  const awkward = { a: 'plain', b: 'has: colon', c: '#hash', d: ' lead', e: '2025-03-02', f: 'true', g: '12', h: '- dash', i: '"quoted"', j: "it's", k: 'ΣΕΜΦΕ ΕΜΠ',
    l: 'x'.repeat(40) + ' ' + 'word '.repeat(30).trim(), m: ['a', 'b, c', 'd: e'], n: { p: 1, q: [1, 2], r: { s: null } }, o: [], p: {}, q: [['Α', null], ['Β', 'c/']], r: '', s: 'line\nbreak' };
  const text = dumpFrontMatter(awkward);
  eq('dumpFrontMatter reads back as the same data', JSON.stringify(splitFrontMatter('---\n' + text + '\n---\n', 'x').data), JSON.stringify(awkward));
  const list = [{ a: 'x: y', b: 'plain' }, { a: 'z', b: 'long ' + 'word '.repeat(30).trim() }];
  eq('dumpYamlList reads back as the same data', JSON.stringify(splitFrontMatter('---\nl:\n' + dumpYamlList(list).split('\n').map(l => '  ' + l).join('\n') + '\n---\n', 'x').data.l), JSON.stringify(list));
}
throws('an unknown layout', () => wrapLayout('<p>x</p>', 'wide', 'f.md'), /f\.md: unknown layout "wide" \(known: text\)/);
t('layout: text wraps the page text', wrapLayout('<p>x</p>\n', 'text', 'f').includes('<div class="prose wide">\n<p>x</p>\n'));
t('no layout leaves the body alone', wrapLayout('<p>x</p>', undefined, 'f') === '<p>x</p>' && LAYOUTS.includes('text'));

/* ---- every real file of _src/ ---------------------------------------------- */
const REQUIRED = { pages: ['path', 'title', 'description'], posts: ['title', 'date', 'slug', 'description'] };
for (const dir of ['pages', 'posts']) {
  const files = readdirSync(path.join(ROOT, '_src', dir));
  t(`_src/${dir}: ${files.length} files, all .md`, files.length > 0 && files.every(f => f.endsWith('.md')));
  for (const f of files) {
    const file = `${dir}/${f}`;
    let page = null;
    try { page = splitFrontMatter(readFileSync(path.join(ROOT, '_src', file), 'utf8'), file); } catch (e) { t(file + ': front matter', false, '  ' + e.message); continue; }
    for (const k of REQUIRED[dir]) t(`${file}: front matter has "${k}"`, typeof page.data[k] === 'string' || (k === 'path' && page.data[k] === ''));
    if (dir === 'posts') t(`${file}: the file name starts with the date and ends with the slug`, f === `${page.data.date}-${page.data.slug}.md`, `  ${f} vs ${page.data.date}-${page.data.slug}.md`);
    try { renderMarkdown(page.body.replace(/<!--\/?if:[a-z]+-->/g, ''), file); t(`${file}: the body renders`, true); } catch (e) { t(`${file}: the body renders`, false, '  ' + e.message); }
  }
}

console.log(bad ? `\n${bad} of ${n} checks failed` : `ok    ${n} checks`);
process.exit(bad ? 1 : 0);
