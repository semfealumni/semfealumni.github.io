# The text of the site

Every page and every announcement is **one `.md` file**: a few lines of YAML
at the top (the "front matter"), then the text in Markdown.

    _src/pages/*.md    the pages: governance.md becomes semfealumni.gr/governance/
    _src/posts/*.md    the announcements, named YYYY-MM-DD-slug.md

This folder is never published (a folder that starts with `_` is not served).
The site is built from it by `node tools/build.mjs`, which writes the HTML that
GitHub Pages serves. After editing, run:

    node tools/build.mjs      # writes the pages
    node tools/check.mjs      # links, share card, everything in sync
    node tools/md-selftest.mjs

and commit the `.md` file **together with** the regenerated HTML. Never edit the
generated `index.html` files by hand: the next build erases the change.

## An announcement

```markdown
---
title: Πρόσκληση σε γενική συνέλευση
date: 2025-03-02
slug: 2025-taktiki-gs
category: Ανακοινώσεις
description: Μία πρόταση που εμφανίζεται στην κάρτα της ανακοίνωσης.
---

Αγαπητά Μέλη του Συλλόγου,

Η **Γενική Συνέλευση** θα γίνει το Σάββατο. Θέματα:

- Οικονομικός απολογισμός
- Αρχαιρεσίες

Με εκτίμηση,<br>
Το Δ.Σ.
{ .sign }
```

| Key | |
|---|---|
| `title`, `date` (YYYY-MM-DD), `slug`, `description` | required; the file is named `<date>-<slug>.md` |
| `category` | `Ανακοινώσεις` (default) or `Εκδηλώσεις`; it also decides which e-mail alerts are sent |
| `image` | optional picture in `assets/img/posts/` |

## A page

```markdown
---
path: governance/
nav: governance
subnav: club
title: Διοίκηση
description: Το Διοικητικό Συμβούλιο και η Εξελεγκτική Επιτροπή.
hero:
  eyebrow: Ο Σύλλογος
  title: Διοίκηση
  lede: Το Διοικητικό Συμβούλιο για την περίοδο 2025–2027.
crumbs:
  - [Διοίκηση, null]
---
```

| Key | |
|---|---|
| `path` | the address (`governance/`; empty for the home page) |
| `title`, `description` | the browser title and the sentence under a link preview |
| `hero` | `eyebrow`, `title`, `lede` of the page's banner |
| `crumbs` | the trail under the banner: `[text, address]`, the last one with `null` |
| `nav`, `subnav` | which menu entry is lit, and which sub-menu is shown |
| `layout` | `text`: wraps the page in the plain reading column (privacy, terms) |
| `scripts` | scripts of `assets/js/` to load on this page |
| `noindex`, `noTrack`, `firestore`, `bodyClass`, `file`, `absRoot` | special pages only (404, the account pages) |

A text that has a colon, a `#` or starts with a quote needs quotes
(`title: "Ανακοίνωση: κοπή πίτας"`); a long one can be folded over lines with
`description: >-` and an indented block.

## The text: Markdown

Plain CommonMark: `## heading`, `**bold**`, `*italic*`, `[text](address)`,
`![alt](picture.jpg)`, `- list`, `1. numbered list`, `> quote`. A few additions:

| Write | Get |
|---|---|
| `[text]({{root}}contact/)` | a link that works wherever the site is hosted (`{{root}}` is the way back to the site root) |
| `[text](https://…){ .btn .btn-dark newtab }` | CSS classes on a link; `newtab` opens it in a new tab (`target="_blank" rel="noopener"`) |
| `![alt](a.jpg){ width=300 loading=lazy }` | attributes on a picture |
| `Με εκτίμηση,` + a line `{ .sign }` | a class on the paragraph above (the last line of a paragraph) |
| `## Title { #anchor }` | an id on a heading |
| a line `{ .checklist }` after a list or a quote | a class on that list or quote |
| `{{icon:arrow}}` | an icon from the build's list, inline |
| `{{signin}}`, `{{signin-social}}` | the sign-in methods the site offers, as a sentence ("Google, LinkedIn ή e-mail") |
| `{{latest}}`, `{{posts}}`, `{{social}}` alone on a line | the newest announcements, all of them, the social links |
| `{{post:slug}}` as a link address | the address of an announcement |

A line break inside a paragraph is written `<br>` at the end of the line.

Text for a sign-in method that may not be offered goes between
`<!--if:google-->` … `<!--/if:google-->` (`google`, `linkedin`, `facebook` or
`social` for "any of them"). With the two markers each on a line of their own,
a switched-off block takes its lines with it, so a list stays a tidy list.

### Layout: HTML around Markdown

A designed page (sections, columns, cards) keeps its HTML skeleton, and the
text goes inside it as Markdown: **leave a blank line after an HTML tag and the
text after it is Markdown again**.

```markdown
<section class="alt">
<div class="wrap">
<div class="section-head">
<span class="eyebrow">Αρχαιρεσίες</span>

## Αποτελέσματα Αρχαιρεσιών

Οι αρχαιρεσίες γίνονται **κάθε δύο χρόνια**.

</div>
</div>
</section>
```

Without the blank line the text between two HTML tags is passed through as it
is, which is how the small pieces of markup that have no Markdown form (forms,
buttons that need JavaScript, `<dl>` tables) are written.

## Lists of things: YAML blocks

A list that repeats (people, documents, photos, dates) is a fenced block whose
first line names the component. Each entry is checked: a missing or misspelled
key stops the build with a sentence naming the page and the entry.

````markdown
```{people}
- id: karalis
  name: Κάραλης Δημήτρης
  role: Πρόεδρος
  linkedin: https://www.linkedin.com/in/dimitris-karalis-80319558
- id: papathanasiou
  name: Παπαθανασίου Αθανάσιος-Φοίβος
  role: Αναπληρωματικό Μέλος
  photo: papathanasiou_nasos.jpg
```
````

| Block | Entries | |
|---|---|---|
| `{people}` | `id`, `name`, `role`; `photo` (default `<id>.jpg` in `assets/img/profiles/`), `linkedin` | the photo cards of the Διοίκηση page |
| `{people-mini}` | `id`, `name`, `role`; `photo` | the small round photos on the home page, each linking to `governance/#id` |
| `{docs}` | `title`, `file` (inside `assets/docs/`); `meta` (a line under the title), `type` (default `PDF`) | documents with Άνοιγμα and Λήψη buttons |
| `{gallery}` | `img` (inside `assets/img/history/`), `caption`; `class` (`wide` or `poster`), `cap: true` (also print the caption) | the Φωτοθήκη; the thumbnail is the same file name in `thumbs/` |
| `{accordion skopos}` | `q`, `a`; `open: true` on the question shown first | numbered questions that open one at a time; the word is the group |
| `{milestones}` | `when`, `title`, `text` | the timeline |
| `{hero-stats}` | `value`, `label`; `count: true` runs the number up from zero | the four numbers under the home page's headline |
| `{stats one}` | `value`, `label` | big figures with a caption; the extra word `one` stacks them |

`a`, `text` and a stats `label` may use `**bold**` and `[links](address)`; every
other field is plain text. A new kind of block is one entry in
`tools/components.mjs` and one example in `tools/md-selftest.mjs`.

## How it is built

`tools/build.mjs` reads the front matter (YAML), resolves the sign-in
conditions, turns the Markdown into HTML (`tools/markdown.mjs`, with the
YAML blocks of `tools/components.mjs`), puts it in the page's header and footer,
and fills the `{{…}}` placeholders. The two libraries it uses, markdown-it and
js-yaml, are committed in `tools/vendor/`, so there is nothing to install.
