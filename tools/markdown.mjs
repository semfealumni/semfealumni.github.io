/* The Markdown of this site's pages and announcements (_src/), in one place.
 *
 * A source file is YAML front matter + Markdown:
 *
 *     ---
 *     title: Πρόσκληση σε γενική συνέλευση
 *     date: 2025-03-02
 *     ---
 *     Αγαπητά μέλη, …
 *
 * tools/build.mjs reads them through splitFrontMatter() and renderMarkdown().
 * The dialect is CommonMark (markdown-it, vendored in tools/vendor/) with HTML
 * allowed (raw HTML is how the layout blocks of a designed page are written,
 * and a blank line ends an HTML block, so Markdown goes on working inside a
 * <div> exactly as MkDocs' md_in_html does), plus three small additions:
 *
 *   {{placeholders}}  survive untouched: a link's address is NOT percent-encoded
 *                     (so [text]({{root}}contact/) works), and a line holding
 *                     only {{posts}}, {{latest}} or {{social}} is a block of its
 *                     own, never wrapped in <p>.
 *   attribute lists   { .class #id key=value key="a value" flag } written
 *                     right after a link or image, as MkDocs' attr_list does:
 *                         [text](url){ .btn .btn-dark }
 *                         ![alt](photo.jpg){ width=300 loading=lazy }
 *                     on the last line of a paragraph (or, in a list item, of
 *                     its text) it belongs to the paragraph:
 *                         Με εκτίμηση,
 *                         { .sign }
 *                     and at the end of a heading line to the heading:
 *                         ## Title { #anchor }
 *                   on a line of its own after a list or a quote, to that list or quote:
 *                         - first
 *                         - second
 *
 *                         { .checklist }
 *                   and newtab is short for target=_blank rel=noopener:
 *                         [text](https://example.org){ .btn newtab }
 *   (nothing else.)   No tables of contents, no typographic quotes, no
 *                     auto-linking of bare addresses: the text is shown as written.
 *
 * Front matter is YAML 1.2 "core" schema (a date such as 2025-03-02 stays text).
 * dumpFrontMatter() writes it the way the files are laid out; the one-off
 * conversion and tools/md-selftest.mjs rely on parse(dump(x)) == x. */
import MarkdownIt from './vendor/markdown-it.esm.min.mjs';
import { load, CORE_SCHEMA } from './vendor/js-yaml.esm.min.mjs';
import { COMPONENTS } from './components.mjs';

/* ---- attribute lists ------------------------------------------------------ */
const ATTR_TOKEN = /[ \t]*(?:\.([\p{L}_][\p{L}\p{N}_-]*)|#([\p{L}_][\p{L}\p{N}_:-]*)|([A-Za-z_:][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`{}]+)))?)/uy;
/* a word with no "=" is an attribute only when it is one of these: "{ see below }" is text, not three attributes */
const FLAGS = ['newtab', 'hidden', 'download', 'open'];

/** "{ .a #b k=v flag }" (the text between the braces) as [[name, value]], or null if it is not one. */
export function parseAttrs(text) {
  const s = String(text).trim();
  if (!s || s[0] === '{') return null;
  const out = [];
  ATTR_TOKEN.lastIndex = 0;
  let at = 0;
  while (at < s.length) {
    ATTR_TOKEN.lastIndex = at;
    const m = ATTR_TOKEN.exec(s);
    if (!m) return null;
    if (m[1] !== undefined) out.push(['class', m[1]]);
    else if (m[2] !== undefined) out.push(['id', m[2]]);
    else {
      const value = m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : m[6] !== undefined ? m[6] : null;
      if (value === null && FLAGS.indexOf(m[3]) < 0) return null;                    // a bare word that is not a known flag
      if (value !== null && m[3] === 'newtab') return null;                          // newtab takes no value
      out.push([m[3], value === null ? '' : value]);
    }
    at = ATTR_TOKEN.lastIndex;
    if (at < s.length && !/\s/.test(s[at])) return null;
  }
  return out.length ? out : null;
}
function applyAttrs(token, attrs) {
  for (const [k, v] of attrs) {
    if (/^on/i.test(k) || /^srcdoc$/i.test(k)) throw new Error(`the attribute "${k}" is not allowed (event handlers and srcdoc cannot be written in a page)`);
    if (k === 'class') token.attrJoin('class', v);
    else if (k === 'newtab' && v === '') { token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener'); }
    else token.attrSet(k, v);
  }
}

function attrsPlugin(md) {
  // right after a link or an image: [text](url){ .btn }
  md.inline.ruler.before('text', 'attrs_after_link', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x7B || state.pending !== '') return false;
    const last = state.tokens[state.tokens.length - 1];
    if (!last || (last.type !== 'link_close' && last.type !== 'image')) return false;
    const end = state.src.indexOf('}', state.pos);
    if (end < 0) return false;
    const attrs = parseAttrs(state.src.slice(state.pos + 1, end));
    if (!attrs) return false;
    if (!silent) {
      let target = last;
      if (last.type === 'link_close') {
        let i = state.tokens.length - 1;
        while (i >= 0 && state.tokens[i].type !== 'link_open') i--;
        if (i < 0) return false;
        target = state.tokens[i];
      }
      applyAttrs(target, attrs);
    }
    state.pos = end + 1;
    return true;
  });

  // on the last line of a paragraph / list-item text, or at the end of a heading
  md.core.ruler.before('inline', 'attrs_block', state => {
    const toks = state.tokens;
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i], open = toks[i - 1];
      if (t.type !== 'inline') continue;
      // a paragraph of nothing but { .class } after a list or a quote belongs to that list or quote
      if (open.type === 'paragraph_open' && i >= 2) {
        const prev = toks[i - 2], alone = /^\{([^{}\n]+)\}$/.exec(t.content.trim());
        const attrs = alone && parseAttrs(alone[1]);
        if (attrs && prev.nesting === -1 && /^(bullet_list|ordered_list|blockquote)_close$/.test(prev.type)) {
          let j = i - 3;
          while (j >= 0 && !(toks[j].level === prev.level && toks[j].nesting === 1)) j--;
          if (j >= 0) { applyAttrs(toks[j], attrs); toks.splice(i - 1, 3); i -= 2; continue; }
        }
      }
      let re;
      if (open.type === 'heading_open') re = /[ \t]+\{([^{}\n]+)\}[ \t]*$/;
      else if (open.type === 'paragraph_open') re = /\n[ \t]*\{([^{}\n]+)\}[ \t]*$/;
      else continue;
      const m = re.exec(t.content);
      if (!m) continue;
      const attrs = parseAttrs(m[1]);
      if (!attrs) continue;
      let target = open;
      if (open.hidden) {                         // a tight list's text has no <p>: the attributes go on its <li>
        let j = i - 1;
        while (j >= 0 && toks[j].type !== 'list_item_open') j--;
        if (j < 0) continue;
        target = toks[j];
      }
      applyAttrs(target, attrs);
      t.content = t.content.slice(0, m.index);
    }
  });
}

/* ---- an image alone in its paragraph is not wrapped in <p> ----------------- */
function imageParagraphPlugin(md) {
  md.core.ruler.after('inline', 'image_paragraph', state => {
    const t = state.tokens;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i].type !== 'paragraph_open' || t[i + 1].type !== 'inline' || t[i + 2].type !== 'paragraph_close') continue;
      const kids = t[i + 1].children;
      if (kids.length === 1 && kids[0].type === 'image') t[i].hidden = t[i + 2].hidden = true;
    }
  });
}

/* ---- {{posts}} / {{latest}} / {{social}} alone on a line ------------------- */
const BLOCK_PLACEHOLDER = /^\{\{(posts|latest|social)\}\}[ \t]*$/;
function placeholderBlockPlugin(md) {
  md.block.ruler.before('paragraph', 'placeholder_block', function placeholderBlock(state, startLine, endLine, silent) {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const pos = state.bMarks[startLine] + state.tShift[startLine], max = state.eMarks[startLine];
    const m = BLOCK_PLACEHOLDER.exec(state.src.slice(pos, max));
    if (!m) return false;
    if (silent) return true;
    const t = state.push('html_block', '', 0);
    t.content = '{{' + m[1] + '}}\n';
    t.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });          // alone on a line it ends the paragraph above it, like a heading does
}

/* ---- the renderer ---------------------------------------------------------- */
const md = new MarkdownIt({ html: true, linkify: false, typographer: false, breaks: false, xhtmlOut: false });
md.disable(['table', 'strikethrough']);   // CommonMark only: "a | b" and "~~x~~" are plain text
md.normalizeLink = s => s;            // {{root}}x/ must stay as written (markdown-it would percent-encode the braces)
md.use(attrsPlugin).use(placeholderBlockPlugin).use(imageParagraphPlugin);

/* ```{people} … ``` and the other components of tools/components.mjs: the YAML inside becomes HTML */
const COMPONENT_FENCE = /^\{([A-Za-z][\w-]*)((?:[ \t]+[A-Za-z_][\w-]*)*)[ \t]*\}$/;
const plainFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const tok = tokens[idx], info = tok.info.trim(), m = COMPONENT_FENCE.exec(info);
  const file = (env && env.file) || 'the page';
  if (!m) {
    // a fence that opens with "{" is meant as a component: a typo is an error, never a code block shown to visitors
    if (/^\{/.test(info)) throw new Error(`${file}: "${'```' + info}" is not a component block (write it as ${'```'}{name} or ${'```'}{name word}, the name right after the brace)`);
    return plainFence(tokens, idx, options, env, self);
  }
  const component = Object.hasOwn(COMPONENTS, m[1]) ? COMPONENTS[m[1]] : null;
  if (!component) throw new Error(`${file}: there is no component {${m[1]}} (known: ${Object.keys(COMPONENTS).join(', ')})`);
  let list;
  try { list = load(tok.content, { schema: CORE_SCHEMA }); }
  catch (e) { throw new Error(`${file}: the {${m[1]}} block is not valid YAML (${String(e.message).split('\n')[0]}${e.mark ? `, line ${e.mark.line + 1} of the block` : ''})`); }
  return component.render(list, { file, lang: (env && env.lang) || 'el', name: m[1], extra: m[2].split(/[ \t]+/).filter(Boolean), inline: s => md.renderInline(String(s)) });
};

/** Markdown (a body, not including front matter) as HTML. file only names the page in an error message;
    lang 'en' (an English page, _src/en/) gives the components' own words in English. */
export function renderMarkdown(src, file, lang) {
  try { return md.render(String(src), { file, lang: lang || 'el' }); }
  catch (e) { if (file && !String(e.message).startsWith(file)) e.message = `${file}: ${e.message}`; throw e; }
}

/** The page layouts a front matter `layout:` can name: the HTML that goes around the rendered body. */
export const LAYOUTS = ['text'];
export function wrapLayout(html, layout, file) {
  if (layout === undefined || layout === null || layout === '') return html;
  if (layout === 'text') return `<section class="tight">\n  <div class="wrap">\n    <div class="prose wide">\n${html}    </div>\n  </div>\n</section>\n`;
  throw new Error(`${file}: unknown layout "${layout}" (known: ${LAYOUTS.join(', ')})`);
}

/* ---- front matter ---------------------------------------------------------- */
/** A file's text as { data, body }; throws a sentence naming the file when the front matter is missing or is not YAML. */
export function splitFrontMatter(raw, file) {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!m) {
    if (/^﻿?---[ \t]*\r?\n/.test(raw)) throw new Error(`${file}: the front matter is not closed: add a line "---" after the YAML`);
    throw new Error(`${file}: must start with a front matter block: a line "---", the YAML, a line "---"`);
  }
  let data;
  try { data = load(m[1], { schema: CORE_SCHEMA }); }
  catch (e) { throw new Error(`${file}: the front matter is not valid YAML (${String(e.message).split('\n')[0].replace(/\s*\(\d+:\d+\)$/, '')}${e.mark ? `, at line ${e.mark.line + 2} of the file` : ''})`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file}: the front matter must be a list of "key: value" lines`);
  return { data, body: raw.slice(m[0].length).replace(/^\r?\n/, '') };
}

/* ---- what the front matter may say ------------------------------------------ */
const TEXT = v => typeof v === 'string';
const PAGE_KEYS = { path: TEXT, nav: TEXT, subnav: TEXT, title: TEXT, description: TEXT, layout: TEXT, bodyClass: TEXT, file: TEXT,
  hero: v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => ['eyebrow', 'title', 'lede'].includes(k)) && Object.values(v).every(TEXT),
  crumbs: v => Array.isArray(v) && v.every(c => Array.isArray(c) && c.length === 2 && TEXT(c[0]) && (c[1] === null || TEXT(c[1]))),
  scripts: v => Array.isArray(v) && v.every(s => TEXT(s) && /^[\w.-]+\.js$/.test(s)),
  noindex: v => typeof v === 'boolean', noTrack: v => typeof v === 'boolean', firestore: v => typeof v === 'boolean', absRoot: v => typeof v === 'boolean' };
const POST_KEYS = { title: TEXT, date: v => TEXT(v) && /^\d{4}-\d{2}-\d{2}$/.test(v), slug: v => TEXT(v) && /^[a-z0-9_-]+$/.test(v), category: TEXT, image: TEXT, description: TEXT };
const SHAPE = { hero: 'eyebrow, title and lede (text)', crumbs: 'a list of [text, address] pairs (null for the last one)', scripts: 'a list of file names of assets/js', date: 'a date written YYYY-MM-DD', slug: 'lowercase letters, digits, - and _ (write it in quotes if it could read as a number)' };
/** The front matter of a page ('page') or an announcement ('post'): only keys the build uses, each of the kind it expects. Throws a sentence naming the file. */
export function validateFrontMatter(data, kind, file) {
  const keys = kind === 'post' ? POST_KEYS : PAGE_KEYS, need = kind === 'post' ? ['title', 'date', 'slug', 'description'] : ['path', 'title', 'description'];
  for (const [k, v] of Object.entries(data)) {
    if (!Object.hasOwn(keys, k)) throw new Error(`${file}: the front matter has "${k}", which is not used (it knows: ${Object.keys(keys).join(', ')})`);
    if (!keys[k](v)) throw new Error(`${file}: "${k}" must be ${SHAPE[k] || (/^(noindex|noTrack|firestore|absRoot)$/.test(k) ? 'true or false (not yes or no)' : 'text (write it in quotes if it is a number or a date)')}`);
  }
  for (const k of need) if (!(k in data) || (k !== 'path' && data[k] === '')) throw new Error(`${file}: the front matter needs "${k}"`);
  return data;
}

const BAD_START = /^[-?:,\[\]{}#&*!|>'"%@`]/;
const reads = (text, ok) => { try { return ok(load(text, { schema: CORE_SCHEMA })); } catch (e) { return false; } };
/* a string may be written bare only if YAML reads it back as that same string */
const plainOk = s => s !== '' && !/^\s|\s$|\n|\t/.test(s) && !BAD_START.test(s) && reads('k: ' + s, v => v && v.k === s);
const flowOk = s => s !== '' && !/^\s|\s$|\n|\t|[,\[\]{}]/.test(s) && !BAD_START.test(s) && reads('[' + s + ']', v => Array.isArray(v) && v.length === 1 && v[0] === s);

function scalar(v, flow) {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (flow ? flowOk(s) : plainOk(s)) return s;
  return JSON.stringify(s);
}
function wrapWords(s, width) {
  const lines = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
const foldable = s => s.length > 100 && !/^\s|\s$|\n|\t|  /.test(s);
const simpleFlow = a => Array.isArray(a) && a.length > 0 && a.every(x => x === null || typeof x !== 'object') && a.map(x => scalar(x, true)).join(', ').length <= 96;

function emit(value, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(value)) {
    const key = /^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (Object.keys(v).length === 0) lines.push(`${pad}${key}: {}`);
      else { lines.push(`${pad}${key}:`); lines.push(...emit(v, indent + 2)); }
    } else if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${pad}${key}: []`);
      else if (simpleFlow(v)) lines.push(`${pad}${key}: [${v.map(x => scalar(x, true)).join(', ')}]`);
      else {
        lines.push(`${pad}${key}:`);
        for (const item of v) {
          if (Array.isArray(item)) lines.push(`${pad}  - [${item.map(x => scalar(x, true)).join(', ')}]`);
          else if (item !== null && typeof item === 'object') {
            const sub = emit(item, indent + 4);
            lines.push(`${pad}  - ${sub[0].trimStart()}`, ...sub.slice(1));
          } else lines.push(`${pad}  - ${scalar(item, false)}`);
        }
      }
    } else if (typeof v === 'string' && foldable(v)) {
      lines.push(`${pad}${key}: >-`);
      for (const l of wrapWords(v, 88)) lines.push(`${pad}  ${l}`);
    } else lines.push(`${pad}${key}: ${scalar(v, false)}`);
  }
  return lines;
}

/** A list of flat entries as the YAML of a component block ("- key: value" lines); throws if it would not read back the same. */
export function dumpYamlList(items) {
  const text = items.map(item => {
    const lines = emit(item, 2);
    lines[0] = '- ' + lines[0].slice(2);
    return lines.join('\n');
  }).join('\n');
  const back = load(text, { schema: CORE_SCHEMA });
  if (JSON.stringify(back) !== JSON.stringify(items)) throw new Error('dumpYamlList: the YAML does not read back as the same data:\n' + text);
  return text;
}

/** An object as the YAML of a front matter block (without the --- lines). */
export function dumpFrontMatter(data) {
  const text = emit(data, 0).join('\n');
  const back = load(text, { schema: CORE_SCHEMA });
  if (JSON.stringify(back) !== JSON.stringify(data)) throw new Error('dumpFrontMatter: the YAML does not read back as the same data:\n' + text);
  return text;
}
