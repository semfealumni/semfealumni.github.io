/* The repeated blocks of a page, written as a short YAML list instead of HTML.
 *
 * In a page's Markdown a fenced block whose first line names a component:
 *
 *     ```{people}
 *     - id: karalis
 *       name: Κάραλης Δημήτρης
 *       role: Πρόεδρος
 *       linkedin: https://www.linkedin.com/in/dimitris-karalis-80319558
 *     ```
 *
 * becomes the HTML the site's stylesheet is written for (assets/css). Extra
 * words after the name are extra CSS classes on the outer element:
 * ```{stats one}```. Every entry is checked, so a typo (a missing "name",
 * a key the component does not know) stops the build with a sentence naming the
 * page and the entry, never an empty card on the live site.
 *
 * Text in a field is plain text, except the fields marked "inline Markdown"
 * below, where [links](url), **bold** and *italics* work as in the rest of the
 * page. {{root}}, {{icon:name}} and the other placeholders work everywhere.
 *
 * COMPONENTS is also what tools/md-selftest.mjs and tools/build.mjs read, so
 * adding one is: one entry here, one example in the selftest, and a line in the
 * table of README.md. */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
const cls = (base, extra) => [base, ...extra].join(' ');

/** the entries of a block, each checked against what the component knows */
function entries(list, spec, ctx) {
  const where = n => `${ctx.file}: the {${ctx.name}} block, entry ${n}`;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${ctx.file}: the {${ctx.name}} block must be a list of entries ("- key: value" lines)`);
  return list.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${where(i + 1)} must be a set of "key: value" lines`);
    for (const k of Object.keys(item)) if (!spec.required.includes(k) && !spec.optional.includes(k)) throw new Error(`${where(i + 1)} has "${k}", which this component does not use (it knows: ${[...spec.required, ...spec.optional].join(', ')})`);
    for (const k of spec.required) if (item[k] === undefined || item[k] === null || item[k] === '') throw new Error(`${where(i + 1)} has no "${k}"`);
    const out = {};
    for (const k of Object.keys(item)) {
      const v = item[k];
      if (spec.flags && spec.flags.includes(k)) { if (typeof v !== 'boolean') throw new Error(`${where(i + 1)}: "${k}" must be true or false`); out[k] = v; }
      else if (typeof v === 'number') out[k] = String(v);            // value: 2013 is as good as value: "2013"
      else if (typeof v !== 'string') throw new Error(`${where(i + 1)}: "${k}" must be text`);
      else out[k] = v;
    }
    return out;
  });
}

const PROFILES = '{{root}}assets/img/profiles/';

export const COMPONENTS = {
  /* Governance: the photo cards. photo defaults to <id>.jpg in assets/img/profiles/. */
  people: {
    spec: { required: ['id', 'name', 'role'], optional: ['photo', 'linkedin'] },
    render(list, ctx) {
      const rows = entries(list, this.spec, ctx).map(p => `  <article class="person" id="${escAttr(p.id)}">
    <img src="${PROFILES}${escAttr(p.photo || p.id + '.jpg')}" alt="${escAttr(p.name)}" width="116" height="116" loading="lazy">
    <div class="role">${esc(p.role)}</div>
    <h3>${esc(p.name)}</h3>${p.linkedin ? `
    <a class="btn btn-outline btn-sm li linkedin-btn" href="${escAttr(p.linkedin)}" target="_blank" rel="noopener" aria-label="${escAttr(p.name)} στο LinkedIn">{{icon:linkedin}}LinkedIn</a>` : ''}
  </article>`);
      return `<div class="${cls('people', ctx.extra)}">\n${rows.join('\n')}\n</div>\n`;
    },
  },

  /* Home page: the row of small round photos linking to governance/#id. */
  'people-mini': {
    spec: { required: ['id', 'name', 'role'], optional: ['photo'] },
    render(list, ctx) {
      const rows = entries(list, this.spec, ctx).map(p => `  <a href="{{root}}governance/#${escAttr(p.id)}" title="${escAttr(p.name + ', ' + p.role)}"><img src="${PROFILES}${escAttr(p.photo || p.id + '.jpg')}" alt="${escAttr(p.name)}" width="60" height="60" loading="lazy"></a>`);
      return `<div class="${cls('people-mini', ctx.extra)}" role="group" aria-label="Μέλη του Διοικητικού Συμβουλίου">\n${rows.join('\n')}\n</div>\n`;
    },
  },

  /* Documents: a title, an optional line under it, and the file (Άνοιγμα + Λήψη). */
  docs: {
    spec: { required: ['title', 'file'], optional: ['meta', 'type'] },
    render(list, ctx) {
      const rows = entries(list, this.spec, ctx).map(d => {
        const href = escAttr('{{root}}assets/docs/' + d.file);
        return `  <div class="doc"><span class="ic" aria-hidden="true">${esc(d.type || 'PDF')}</span><div><h3>${esc(d.title)}</h3>${d.meta ? `<span class="muted">${esc(d.meta)}</span>` : ''}</div><div class="acts"><a class="btn btn-outline btn-sm" href="${href}" target="_blank" rel="noopener">{{icon:external}}Άνοιγμα</a><a class="btn btn-dark btn-sm" href="${href}" download>{{icon:download}}Λήψη</a></div></div>`;
      });
      return `<div class="${cls('docs', ctx.extra)}">\n${rows.join('\n')}\n</div>\n`;
    },
  },

  /* Photo gallery (opens in the lightbox). img is relative to assets/img/history/,
     the thumbnail is the same file name in its thumbs/ folder, the caption is also the alt text.
     class: wide | poster. cap: true also prints the caption under the photo. */
  gallery: {
    spec: { required: ['img', 'caption'], optional: ['class', 'cap'], flags: ['cap'] },
    render(list, ctx) {
      const rows = entries(list, this.spec, ctx).map(g => {
        const slash = g.img.lastIndexOf('/');
        const thumb = slash < 0 ? 'thumbs/' + g.img : g.img.slice(0, slash + 1) + 'thumbs/' + g.img.slice(slash + 1);
        return `  <a${g.class ? ` class="${escAttr(g.class)}"` : ''} href="{{root}}assets/img/history/${escAttr(g.img)}" data-caption="${escAttr(g.caption)}"><img src="{{root}}assets/img/history/${escAttr(thumb)}" alt="${escAttr(g.caption)}" loading="lazy" decoding="async">${g.cap ? `<span class="cap">${esc(g.caption)}</span>` : ''}</a>`;
      });
      return `<div class="${cls('gallery', ctx.extra)}" data-gallery>\n${rows.join('\n')}\n</div>\n`;
    },
  },

  /* Numbered questions that open one at a time. q is plain text, a is inline Markdown; open: true on the one shown at first.
     The word after the name is the group: ```{accordion skopos}```, so one question of a group is open at a time. */
  accordion: {
    spec: { required: ['q', 'a'], optional: ['open'], flags: ['open'] },
    render(list, ctx) {
      const [group = 'accordion', ...more] = ctx.extra;
      const rows = entries(list, this.spec, ctx).map((x, i) => `  <li><details name="${escAttr(group)}"${x.open ? ' open' : ''}><summary><span class="qa-n">${i + 1}</span><span class="qa-q">${esc(x.q)}</span><span class="qa-i" aria-hidden="true"></span></summary><p>${ctx.inline(x.a)}</p></details></li>`);
      return `<ol class="${cls('qa', more)}">\n${rows.join('\n')}\n</ol>\n`;
    },
  },

  /* A timeline. text is inline Markdown. */
  milestones: {
    spec: { required: ['when', 'title', 'text'], optional: [] },
    render(list, ctx) {
      const rows = entries(list, this.spec, ctx).map(m => `  <li><span class="when">${esc(m.when)}</span><strong>${esc(m.title)}</strong><span class="d">${ctx.inline(m.text)}</span></li>`);
      return `<ol class="${cls('milestones', ctx.extra)}">\n${rows.join('\n')}\n</ol>\n`;
    },
  },

  /* The four numbers under the home page's headline. count: true animates the figure when it scrolls into view. */
  'hero-stats': {
    spec: { required: ['value', 'label'], optional: ['count'], flags: ['count'] },
    render(list, ctx) {
      const rows = entries(list, this.spec, ctx).map(s => `  <div class="hero-stat"><div class="value"${s.count ? ' data-count' : ''}>${esc(s.value)}</div><div class="label">${esc(s.label)}</div></div>`);
      return `<div class="${cls('hero-stats', ctx.extra)}" role="group" aria-label="Ο Σύλλογος με αριθμούς">\n${rows.join('\n')}\n</div>\n`;
    },
  },

  /* Big figures with a caption (class "one" stacks them in a single column). label is inline Markdown. */
  stats: {
    spec: { required: ['value', 'label'], optional: [] },
    render(list, ctx) {
      const rows = entries(list, this.spec, ctx).map(s => `  <div class="stat"><div class="value">${esc(s.value)}</div><div class="label">${ctx.inline(s.label)}</div></div>`);
      return `<div class="${cls('stats', ctx.extra)}">\n${rows.join('\n')}\n</div>\n`;
    },
  },
};
