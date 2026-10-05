#!/usr/bin/env node
/* Builds every page of the site from _src/ into plain HTML.
 *
 *   node tools/build.mjs          write the pages
 *   node tools/build.mjs --check  write nothing; exit 1 if any page on disk
 *                                 differs from what _src/ would produce
 *
 * No npm install: the Markdown and YAML readers it needs are committed in
 * tools/vendor/. The output is committed, so GitHub Pages serves plain files
 * and needs no build step of its own.
 *
 * _src/pages/*.md   one file per page: YAML front matter, then the page body
 * _src/posts/*.md   one file per announcement, same shape
 * _src/en/*.md      the English copy of a page: same file name and front matter
 *                   keys as its Greek twin, the text in English. Built under
 *                   en/ (en/governance/), with the header, menu and footer in
 *                   English. Every announcement also gets an English page
 *                   (en/blog/…) whose TEXT stays as its author wrote it, Greek.
 *                   The flags at the top of every page link the two copies.
 *
 * The front matter is YAML between two "---" lines at the very top:
 *   ---
 *   path: governance/
 *   title: Διοίκηση
 *   ---
 * and the body is Markdown (tools/markdown.mjs: the dialect, tools/components.mjs:
 * the ```{people} blocks and their kin). Raw HTML is allowed for the layout of a
 * designed page. Inside a body you may write:
 *   {{root}}        the relative way back to the site root ("../../")
 *   {{icon:NAME}}   an inline SVG icon from ICONS below
 *   {{latest}}      the three newest announcements as cards (home page)
 *   {{posts}}       every announcement as cards (the announcements page)
 *   {{signin}}, {{signin-social}}, <!--if:KEY-->…<!--/if:KEY-->
 *                   the sign-in methods the site offers (see below); these
 *                   work in the front matter too
 *
 * Every link the site writes is RELATIVE, so the same files work at the root of
 * semfealumni.gr, where the site is served, and under a sub-path of another host
 * (the earlier preview was www.stouras.com/semfealumni/).
 * Only the canonical / og:url tags use SITE_URL. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, wrapLayout, splitFrontMatter, validateFrontMatter } from './markdown.mjs';
import { applyConditions } from './conditions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/* ---- site-wide settings --------------------------------------------------- */
const cfgSrc = readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8');
const C = new Function('window', cfgSrc + '; return window.SEMFE;')({});
const SITE_URL = C.siteUrl.replace(/\/?$/, '/');
/* This is the official site (semfealumni.gr), so search engines may index it.
   A preview beside another copy of the site must be false (two copies of one
   site compete in search results). tools/migrate.mjs --apply writes this line:
   true at the root of a domain, false under a sub-path or with --keep-noindex. */
const INDEXABLE = true;
const YEAR_NOW = 2026;       // the footer's copyright range ends here in the built page; site.js moves it on to the current year
const OG_W = 1200, OG_H = 630;

/* ---- the sign-in methods a page names ------------------------------------- */
/* Pages never type the list by hand: {{signin}} ("Google, LinkedIn ή e-mail"),
   {{signin-social}} ("Google ή LinkedIn") and <!--if:KEY-->…<!--/if:KEY-->
   blocks (KEY = google, facebook, linkedin, or social for "any of them") are
   filled from AUTH_PROVIDERS by the same rule auth.js uses for the buttons:
   LinkedIn counts only once its LINKEDIN settings are filled in (while
   Firebase itself is not configured, every listed provider counts). So a page
   can never name a way in that the sign-in window does not offer. */
const PROVIDER_NAMES = { google: 'Google', facebook: 'Facebook', linkedin: 'LinkedIn' };
const FB = C.FIREBASE || {};
const FB_CONFIGURED = !!(FB.apiKey && FB.projectId && !String(FB.apiKey + FB.projectId).includes('PASTE_'));
const LI = C.LINKEDIN || {};
const LI_READY = LI.mode === 'oidc' || !!(LI.clientId && LI.functionUrl && !String(LI.clientId + LI.functionUrl).includes('PASTE_'));
const OFFERED = (C.AUTH_PROVIDERS || []).filter(k => PROVIDER_NAMES[k] && (k !== 'linkedin' || LI_READY || !FB_CONFIGURED));
const orList = (names, lang) => names.length < 2 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} ${lang === 'en' ? 'or' : 'ή'} ${names[names.length - 1]}`;
function signinText(s, file, lang) {
  return applyConditions(s, file, k => {
    if (k !== 'social' && !PROVIDER_NAMES[k]) throw new Error(`${file}: unknown condition <!--if:${k}-->`);
    return k === 'social' ? OFFERED.length > 0 : OFFERED.includes(k);
  })
    .replace(/\{\{signin\}\}/g, orList(OFFERED.map(k => PROVIDER_NAMES[k]).concat('e-mail'), lang))
    .replace(/\{\{signin-social\}\}/g, orList(OFFERED.map(k => PROVIDER_NAMES[k]), lang));
}
/* the same for every text in the front matter (a description may say {{signin}}) */
const signinDeep = (v, file, lang) => typeof v === 'string' ? signinText(v, file, lang) : Array.isArray(v) ? v.map(x => signinDeep(x, file, lang)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, signinDeep(x, file, lang)])) : v;

/* ---- icons (stroke icons drawn on a 24px grid; brand marks filled) --------- */
const ICONS = {
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.9 5.9 0 0 0-2.13 1.38A5.9 5.9 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13a5.9 5.9 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.9 5.9 0 0 0 2.13-1.38 5.9 5.9 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z"/></svg>',
  paypal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.08 21.6H3.26a.6.6 0 0 1-.59-.7L5.33 3.9A.9.9 0 0 1 6.22 3.1h6.64c2.66 0 4.54.6 5.5 1.85.9 1.16 1.07 2.58.65 4.45l-.02.1v.3c-.63 3.26-2.8 4.9-6.43 4.9h-1.9a.9.9 0 0 0-.9.77l-.87 5.53-.03.15a.9.9 0 0 1-.89.75zm13.1-13.92c-.03.16-.06.33-.1.5-1.02 5.26-4.52 7.07-9 7.07H8.8l-1.22 7.74h2.56a.79.79 0 0 0 .78-.67l.03-.17.62-3.92.04-.21a.79.79 0 0 1 .78-.67h.49c3.18 0 5.66-1.29 6.39-5.02.3-1.56.15-2.86-.66-3.78a3.1 3.1 0 0 0-.43-.37z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15 20a5 5 0 0 1 6-4.6"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/></svg>',
  rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
  vote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><path d="M5 7h14l2 5v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>',
  form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
};

/* ---- navigation ------------------------------------------------------------ */
/* Kept short, like operationsacademia.org: the logo is the way home, the pages
   ABOUT the association sit in one «Ο Σύλλογος» drop-down (two groups), and
   only the three pages people come for stay in the row. On a phone the menu
   button shows the same entries, the groups under their headings.
   Every label is [Greek, English]: tr() picks the page's language. */
const tr = (x, lang) => Array.isArray(x) ? x[lang === 'en' ? 1 : 0] : x;
const NAV_GROUPS = {
  key: 'club', label: ['Ο Σύλλογος', 'The Association'],
  groups: [
    { id: 'nav-g-club', label: ['Ο Σύλλογος', 'The Association'], items: [
      { key: 'home-orama', label: ['Όραμα & Σκοπός', 'Vision & Purpose'], href: '#orama' },
      { key: 'organa', label: ['Όργανα', 'Bodies'], href: 'organa/' },
      { key: 'governance', label: ['Διοίκηση', 'Governance'], href: 'governance/' }] },
    { id: 'nav-g-history', label: ['Η ιστορία μας', 'Our history'], items: [
      { key: 'how_we_started', label: ['Πώς ξεκινήσαμε', 'How we started'], href: 'how_we_started/' },
      { key: 'fotothiki', label: ['Φωτοθήκη', 'Photo gallery'], href: 'fotothiki/' },
      { key: 'archive', label: ['Αρχείο', 'Archive'], href: 'archive/' }] },
    { id: 'nav-g-site', label: ['Ο ιστότοπος', 'The website'], items: [
      { key: 'whats_new', label: ['Τι νέο', 'What\'s new'], href: 'whats-new/' },
      { key: 'analytics', label: ['Στατιστικά', 'Statistics'], href: 'analytics/' }] }
  ]
};
const NAV = [
  { key: 'blog', label: ['Ανακοινώσεις', 'Announcements'], href: 'blog/' },
  { key: 'support', label: ['Εγγραφές & Δωρεές', 'Membership & Donations'], href: 'support/' },
  { key: 'contact', label: ['Επικοινωνία', 'Contact'], href: 'contact/' }
];
/* The pill row under an inner page's title, linking the pages of one section. */
const SUBNAV = {
  club: [[['Όραμα & Σκοπός', 'Vision & Purpose'], '#orama', ''], [['Όργανα', 'Bodies'], '', 'organa/'], [['Διοίκηση', 'Governance'], '', 'governance/']],
  history: [[['Πώς ξεκινήσαμε', 'How we started'], '', 'how_we_started/'], [['Φωτοθήκη', 'Photo gallery'], '', 'fotothiki/'], [['Αρχείο', 'Archive'], '', 'archive/']],
  members: [[['Ο λογαριασμός μου', 'My account'], '', 'account/'], [['Περιοχή μελών', 'Members\' area'], '', 'members/'], [['Σχόλια', 'Feedback'], '', 'feedback/']]
};
const SOCIAL = [
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/company/semfealumni'],
  ['facebook', 'Facebook', 'https://www.facebook.com/semfealumni'],
  ['youtube', 'YouTube', 'https://www.youtube.com/@semfealumni'],
  ['instagram', 'Instagram', 'https://www.instagram.com/semfe_alumni_ntua']
];

/* ---- the site's own words, in both languages --------------------------------
   Everything the layout writes around a page's text. The English site name is
   also in assets/js/i18n.js (siteName), for the scripts. */
const SITE_NAME = { el: C.siteName, en: 'Association of SEMFE NTUA Graduates' };
const STR = {
  el: {
    skip: 'Μετάβαση στο περιεχόμενο', menuOpen: 'Άνοιγμα μενού', brandAria: 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ, αρχική σελίδα',
    brandTop: 'ΣΥΛΛΟΓΟΣ ΔΙΠΛΩΜΑΤΟΥΧΩΝ', brandBottom: 'ΣΕΜΦΕ ΕΜΠ', mainNav: 'Κύριο μενού', signin: 'Σύνδεση',
    crumbs: 'Διαδρομή', home: 'Αρχική', section: 'Ενότητα', readMore: 'Διαβάστε περισσότερα →',
    otherPosts: 'Άλλες ανακοινώσεις', prev: '← Προηγούμενη', next: 'Επόμενη →', edit: 'Επεξεργασία', del: 'Διαγραφή',
    announcements: 'Ανακοινώσεις', ogAlt: 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ',
    footerName: 'Σύλλογος Διπλωματούχων<br>ΣΕΜΦΕ&nbsp;ΕΜΠ',
    footerAbout: 'Ο επίσημος φορέας των αποφοίτων της Σχολής Εφαρμοσμένων Μαθηματικών και Φυσικών Επιστημών του ΕΜΠ, από το 2013.',
    fClub: 'Ο Σύλλογος', fHistory: 'Ιστορία', fMembers: 'Μέλη', statute: 'Καταστατικό (PDF)',
    myAccount: 'Ο λογαριασμός μου', membersArea: 'Περιοχή μελών', feedback: 'Σχόλια και προβλήματα', whatsNew: 'Τι νέο στον ιστότοπο',
    copyright: 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ', privacy: 'Πολιτική απορρήτου', terms: 'Όροι χρήσης', dataDeletion: 'Διαγραφή δεδομένων',
    langs: 'Γλώσσα', postLang: ''
  },
  en: {
    skip: 'Skip to content', menuOpen: 'Open menu', brandAria: 'Association of SEMFE NTUA Graduates, home page',
    brandTop: 'ASSOCIATION OF GRADUATES', brandBottom: 'SEMFE NTUA', mainNav: 'Main menu', signin: 'Sign in',
    crumbs: 'Breadcrumb', home: 'Home', section: 'Section', readMore: 'Read more →',
    otherPosts: 'Other announcements', prev: '← Previous', next: 'Next →', edit: 'Edit', del: 'Delete',
    announcements: 'Announcements', ogAlt: 'Association of SEMFE NTUA Graduates',
    footerName: 'Association of<br>SEMFE&nbsp;NTUA Graduates',
    footerAbout: 'The official body of the graduates of the School of Applied Mathematical and Physical Sciences of NTUA, since 2013.',
    fClub: 'The Association', fHistory: 'History', fMembers: 'Members', statute: 'Statute (PDF, in Greek)',
    myAccount: 'My account', membersArea: 'Members\' area', feedback: 'Feedback and problems', whatsNew: 'What\'s new on the website',
    copyright: 'Association of SEMFE NTUA Graduates', privacy: 'Privacy policy', terms: 'Terms of use', dataDeletion: 'Data deletion',
    langs: 'Language', postLang: 'Announcements are shown as the Association published them, in Greek.'
  }
};
/* an announcement's category is stored in Greek (it also decides which e-mail
   alerts go out); an English page shows its English name */
const CATEGORY_EN = { 'Ανακοινώσεις': 'Announcements', 'Εκδηλώσεις': 'Events' };
const catLabel = (c, lang) => lang === 'en' ? (CATEGORY_EN[c] || c) : c;

/* The two flags at the top of every page: a small SVG of each, drawn here so
   no picture file is needed and they look the same on every system (a flag
   emoji shows as two letters on Windows). */
const FLAGS = {
  el: '<svg viewBox="0 0 27 18" width="24" height="16" aria-hidden="true"><rect width="27" height="18" fill="#0d5eaf"/><path d="M0 3h27M0 7h27M0 11h27M0 15h27" stroke="#fff" stroke-width="2"/><rect width="10" height="10" fill="#0d5eaf"/><path d="M5 0v10M0 5h10" stroke="#fff" stroke-width="2"/></svg>',
  en: '<svg viewBox="0 0 60 30" width="32" height="16" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0L60 30M60 0L0 30" stroke="#c8102e" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></svg>'
};

/* ---- helpers --------------------------------------------------------------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* a date stays on one line: "27 Φεβρουαρίου" / "27 February" never breaks between day and month */
const keepDate = s => s.replace(new RegExp('(\\d{1,2}) (' + MONTHS.concat(MONTHS_EN).join('|') + ')', 'g'), '$1&nbsp;$2');   // MONTHS is below
const depthOf = p => (p.replace(/index\.html$/, '').match(/\//g) || []).length;
const rootFor = p => '../'.repeat(depthOf(p)) || './';
const MONTHS = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateText = (iso, lang) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${(lang === 'en' ? MONTHS_EN : MONTHS)[m - 1]} ${y}`; };

function readSrc(dir) {
  const full = path.join(ROOT, '_src', dir), lang = dir === 'en' ? 'en' : 'el';
  return readdirSync(full).filter(f => f.endsWith('.md')).sort().map(f => {
    const file = `${dir}/${f}`;
    const raw = readFileSync(path.join(full, f), 'utf8');
    const { data, body } = splitFrontMatter(raw, file);
    const meta = signinDeep(validateFrontMatter(data, dir === 'posts' ? 'post' : 'page', file), file, lang);
    const html = wrapLayout(renderMarkdown(signinText(body, file, lang), file, lang), meta.layout, file);
    return { file, name: f, lang, meta, body: html.trim(), raw };
  });
}
/* The Git blob id of a source file, the id GitHub gives it: an announcement's page
   carries it (<meta name="semfe-source">), so the editor on blog/ can tell the
   moment the version it just saved is the one online (functions/announcements.js
   blobId() computes the same from the text it commits). */
const blobId = text => { const b = Buffer.from(text, 'utf8'); return createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + b.length + '\0'), b])).digest('hex'); };

/* ---- announcements --------------------------------------------------------- */
const posts = readSrc('posts').map(p => {
  const { date, slug } = p.meta;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error(`${p.file}: date must be YYYY-MM-DD`);
  if (!/^[a-z0-9_-]+$/.test(slug || '')) throw new Error(`${p.file}: slug must be lowercase letters, digits, - or _`);
  const [y, m, d] = date.split('-');
  return { ...p, path: `blog/${y}/${m}/${d}/${slug}/` };
}).sort((a, b) => b.meta.date.localeCompare(a.meta.date) || a.meta.slug.localeCompare(b.meta.slug));
const postBySlug = Object.fromEntries(posts.map(p => [p.meta.slug, p]));

function postCard(p, root, i, lang) {
  const load = i < 3 ? 'eager' : 'lazy';          // the first row is on screen at once
  const img = p.meta.image
    ? `<div class="thumb"><img src="${root}assets/img/posts/${esc(p.meta.image)}" alt="" loading="${load}" decoding="async"></div>`
    : `<div class="thumb logo"><img src="${root}assets/img/logos/logo.png" alt="" loading="${load}" decoding="async"></div>`;
  // an excerpt that only repeats the title says nothing: leave it out
  const same = a => String(a || '').replace(/[.\s]+$/, '').trim().toLowerCase();
  // on an English page the title and the excerpt are the announcement's own words: Greek, and marked so
  const el = lang === 'en' ? ' lang="el"' : '';
  const excerpt = same(p.meta.description) === same(p.meta.title) ? '' : `<p${el}>${esc(p.meta.description)}</p>`;
  const cat = p.meta.category || 'Ανακοινώσεις';
  return `<a class="post-card" href="${root}${p.path}" data-cat="${esc(cat)}">${img}<div class="body">` +
    `<div class="meta"><span class="tag${cat === 'Εκδηλώσεις' ? ' events' : ''}">${esc(catLabel(cat, lang))}</span><time datetime="${p.meta.date}">${dateText(p.meta.date, lang)}</time></div>` +
    `<h3${el}>${keepDate(esc(p.meta.title))}</h3>${excerpt}<span class="more">${STR[lang || 'el'].readMore}</span></div></a>`;
}

/* ---- the layout ------------------------------------------------------------ */
/* the address of a page in each language (null: it has no copy in that language) */
const pathIn = (page, lang) => page.lang === lang ? page.path : page.twin ? page.twin.path : null;

/* The inline script at the top of every page. The "js" class first, then the
   flags: the language a visitor PICKS (a click on a flag, remembered in
   localStorage as semfe:lang) is kept: a Greek page that has an English copy
   forwards a visitor who chose English to it, before anything is drawn, so a
   link from an e-mail or a search result opens in their language. Only a
   click chooses; opening an English address does not. A Greek page without an
   English copy (the LinkedIn return page) never forwards. */
function headScript(page, root) {
  const en = page.lang !== 'en' && pathIn(page, 'en') != null && !page.meta.file ? root + pathIn(page, 'en') : '';
  return '<script>document.documentElement.className += \' js\';' +
    '(function(){var K=\'semfe:lang\';try{document.addEventListener(\'click\',function(e){var a=e.target&&e.target.closest&&e.target.closest(\'[data-lang]\');if(a)localStorage.setItem(K,a.getAttribute(\'data-lang\'));},true);' +
    (en ? 'if(localStorage.getItem(K)===\'en\')location.replace(\'' + en + '\'+location.search+location.hash);' : '') +
    '}catch(e){}})();</script>';
}

function head(page, root) {
  const lang = page.lang || 'el';
  // 404.html gets its own address: two pages sharing one og:url share one link preview
  const url = SITE_URL + (page.meta.file || page.path);
  const title = page.meta.path === '' && !page.meta.file ? SITE_NAME[lang] + ' · SEMFE Alumni' : `${page.meta.title} · ${SITE_NAME[lang]}`;
  const desc = page.meta.description;
  const noindex = !INDEXABLE || page.meta.noindex;
  // the same page in the other language (hreflang): search engines show each reader their own
  const elPath = pathIn(page, 'el'), enPath = pathIn(page, 'en');
  const alt = !page.meta.file && elPath != null && enPath != null
    ? `  <link rel="alternate" hreflang="el" href="${SITE_URL}${elPath}">\n  <link rel="alternate" hreflang="en" href="${SITE_URL}${enPath}">\n  <link rel="alternate" hreflang="x-default" href="${SITE_URL}${elPath}">\n`
    : '';
  const ann = esc(STR[lang].announcements + ' · ' + SITE_NAME[lang]);
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
${page.isPost ? `  <meta name="semfe-source" content="${blobId(page.raw)}">\n` : ''}  <link rel="canonical" href="${url}">
${alt}${noindex ? '  <meta name="robots" content="noindex">\n' : ''}  <meta property="og:type" content="${page.isPost ? 'article' : 'website'}">
  <meta property="og:site_name" content="SEMFE Alumni">
  <meta property="og:locale" content="${lang === 'en' ? 'en_GB' : 'el_GR'}">
${alt ? `  <meta property="og:locale:alternate" content="${lang === 'en' ? 'el_GR' : 'en_GB'}">\n` : ''}  <meta property="og:title" content="${esc(page.meta.title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE_URL}og-image.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="${OG_W}">
  <meta property="og:image:height" content="${OG_H}">
  <meta property="og:image:alt" content="${esc(STR[lang].ogAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(page.meta.title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${SITE_URL}og-image.jpg">
  <link rel="image_src" href="${SITE_URL}share-square.jpg">
  <meta itemprop="image" content="${SITE_URL}share-square.jpg">
  <link rel="alternate" type="application/atom+xml" title="${ann} (Atom)" href="${SITE_URL}feed.xml">
  <link rel="alternate" type="application/rss+xml" title="${ann} (RSS)" href="${SITE_URL}rss.xml">
  <link rel="icon" type="image/svg+xml" href="${root}favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="${root}favicon-32.png">
  <link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
  <meta name="theme-color" content="#0a2240">
  ${headScript(page, root)}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${root}assets/css/site.css">
  <script src="${root}assets/js/config.js"></script>
  <script src="${root}assets/js/i18n.js" defer></script>
  <script src="${root}assets/js/site.js" defer></script>
  <script src="${root}assets/js/auth.js" defer></script>
${page.meta.noTrack ? '' : `  <script src="${root}assets/js/visit.js" defer></script>\n`}${(page.meta.scripts || []).map(s => `  <script src="${root}assets/js/${s}" defer></script>\n`).join('')}</head>`;
}

/* The flags, in a slim bar above the header (the header row has no room for
   them on a phone: the logo's name is never cut short). Each flag links the
   same page in that language; where the page has no copy in it, that
   language's home page. data-lang is what the head script remembers. The
   current language is marked aria-current. Written after the English page's
   links are moved to en/ (localize), so these two are never rewritten. */
function langBar(page, root) {
  const lang = page.lang || 'el';
  const link = (l, name) => {
    const p = pathIn(page, l);
    const href = root + (p != null && !page.meta.file ? p : l === 'en' ? 'en/' : '');
    // the name is shown beside the flag where there is room, and is always the link's accessible name
    return `<a class="lang-flag" href="${href}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === lang ? ' aria-current="true"' : ''} title="${name}">${FLAGS[l]}<span class="lang-name">${name}</span></a>`;
  };
  return `<div class="lang-bar">
  <div class="wrap">
    <nav class="lang-switch" aria-label="${STR[lang].langs}">${link('el', 'Ελληνικά')}${link('en', 'English')}</nav>
  </div>
</div>`;
}

function header(page, root) {
  const lang = page.lang || 'el', S = STR[lang];
  const cur = page.meta.nav;
  // the page itself is marked inside the drop-down (by its address, so the
  // three «history» pages are told apart), the drop-down's button as "here"
  const here = href => href && href === page.meta.path;
  const inClub = NAV_GROUPS.groups.some(g => g.items.some(i => here(i.href)));
  const groups = NAV_GROUPS.groups.map(g => `<div class="nav-group" role="group" aria-labelledby="${g.id}">
            <span class="nav-group-h" id="${g.id}">${esc(tr(g.label, lang))}</span>
            ${g.items.map(i => `<a href="${root}${i.href}"${here(i.href) ? ' aria-current="page"' : ''}>${esc(tr(i.label, lang))}</a>`).join('\n            ')}
          </div>`).join('\n          ');
  const links = NAV.map(n => `<a href="${root}${n.href}"${n.key === cur ? ' aria-current="page"' : ''}>${esc(tr(n.label, lang))}</a>`).join('\n      ');
  return `<a class="skip" href="#main">${S.skip}</a>
<!--LANG-BAR-->
<header class="site-header">
  <div class="wrap">
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="${S.menuOpen}">
      <svg class="i-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><svg class="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <a class="brand" href="${root}" aria-label="${S.brandAria}">
      <img class="brand-mark" src="${root}assets/img/logos/semfe_alumni_logo.jpg" alt="" width="42" height="42">
      <span class="brand-text"><span class="top">${S.brandTop}</span><span class="bottom">${S.brandBottom}</span></span>
    </a>
    <div class="header-right">
      <nav class="nav" id="nav" aria-label="${S.mainNav}">
      <div class="nav-more">
        <button class="nav-more-btn${inClub ? ' is-here' : ''}" type="button" aria-expanded="false" aria-controls="nav-more">${esc(tr(NAV_GROUPS.label, lang))}<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="nav-more-panel" id="nav-more">
          ${groups}
        </div>
      </div>
      ${links}
      </nav>
      <div class="acct-slot" id="acct-slot">
        <a class="btn btn-primary btn-sm acct-signin" href="${root}account/" data-signin>${S.signin}</a>
      </div>
    </div>
  </div>
</header>`;
}

function pageHero(page, root) {
  const h = page.meta.hero;
  if (!h) return '';
  const lang = page.lang || 'el', S = STR[lang];
  const crumbs = (page.meta.crumbs || []).map(([label, href]) =>
    href == null ? `<span>${esc(label)}</span>` : `<a href="${root}${href}">${esc(label)}</a>`);
  const crumbHtml = crumbs.length
    ? `<nav class="crumbs" aria-label="${S.crumbs}"><a href="${root}">${S.home}</a>${crumbs.map(c => '<span aria-hidden="true">›</span>' + c).join('')}</nav>`
    : '';
  const sub = page.meta.subnav && SUBNAV[page.meta.subnav];
  const subHtml = sub ? `<nav class="filters subnav" aria-label="${S.section}" style="margin:22px 0 0">${sub.map(([label, hash, href]) => {
    const target = hash ? `${root}${hash}` : `${root}${href}`;
    const on = href && href === page.meta.path;
    return `<a class="btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}" href="${target}"${on ? ' aria-current="page"' : ''}>${esc(tr(label, lang))}</a>`;
  }).join('')}</nav>` : '';
  // an announcement's title is its author's words: Greek on the English page too, and marked so
  const el = page.isPost && lang === 'en' ? ' lang="el"' : '';
  const meta = page.isPost
    ? `<div class="meta"><span class="tag">${esc(catLabel(page.meta.category || 'Ανακοινώσεις', lang))}</span><time datetime="${page.meta.date}">${dateText(page.meta.date, lang)}</time><span class="byline">${esc(page.meta.author || SITE_NAME[lang])}</span></div>` +
      (S.postLang ? `<p class="post-lang">${S.postLang}</p>` : '')
    : '';
  return `<section class="page-hero${page.isPost ? ' post-head' : ''}">
  <div class="wrap">
    ${crumbHtml}
    ${h.eyebrow ? `<span class="eyebrow">${esc(h.eyebrow)}</span>` : ''}
    <h1${el}>${h.titleHtml || keepDate(esc(h.title || page.meta.title))}</h1>
    ${h.lede ? `<p class="lede">${esc(h.lede)}</p>` : ''}
    ${meta}
    ${subHtml}
  </div>
</section>`;
}

function footer(root, lang) {
  const S = STR[lang || 'el'];
  const social = SOCIAL.map(([k, label, href]) => `<a href="${href}" target="_blank" rel="noopener" aria-label="${label}">${ICONS[k]}</a>`).join('');
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <div class="footer-brand">
          <img src="${root}assets/img/logos/semfe_alumni_logo.jpg" alt="" width="46" height="46" loading="lazy">
          <p><strong style="color:#fff">${S.footerName}</strong><br>${S.footerAbout}</p>
        </div>
        <div class="footer-social">${social}</div>
      </div>
      <div>
        <h2>${S.fClub}</h2>
        <ul>
          <li><a href="${root}#orama">${esc(tr(NAV_GROUPS.groups[0].items[0].label, lang))}</a></li>
          <li><a href="${root}organa/">${esc(tr(NAV_GROUPS.groups[0].items[1].label, lang))}</a></li>
          <li><a href="${root}governance/">${esc(tr(NAV_GROUPS.groups[0].items[2].label, lang))}</a></li>
          <li><a href="${root}assets/docs/foundation/katastatiko.pdf">${S.statute}</a></li>
        </ul>
      </div>
      <div>
        <h2>${S.fHistory}</h2>
        <ul>
          <li><a href="${root}how_we_started/">${esc(tr(NAV_GROUPS.groups[1].items[0].label, lang))}</a></li>
          <li><a href="${root}fotothiki/">${esc(tr(NAV_GROUPS.groups[1].items[1].label, lang))}</a></li>
          <li><a href="${root}archive/">${esc(tr(NAV_GROUPS.groups[1].items[2].label, lang))}</a></li>
          <li><a href="${root}blog/">${esc(tr(NAV[0].label, lang))}</a></li>
        </ul>
      </div>
      <div>
        <h2>${S.fMembers}</h2>
        <ul>
          <li><a href="${root}support/">${esc(tr(NAV[1].label, lang))}</a></li>
          <li><a href="${root}account/">${S.myAccount}</a></li>
          <li><a href="${root}members/">${S.membersArea}</a></li>
          <li><a href="${root}feedback/">${S.feedback}</a></li>
          <li><a href="${root}whats-new/">${S.whatsNew}</a></li>
          <li><a href="${root}analytics/">${esc(tr(NAV_GROUPS.groups[2].items[1].label, lang))}</a></li>
          <li><a href="${root}contact/">${esc(tr(NAV[2].label, lang))}</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>Copyright &copy; 2013–<span data-year>${YEAR_NOW}</span> ${S.copyright}</span>
      <span class="legal"><a href="${root}privacy/">${S.privacy}</a><a href="${root}terms/">${S.terms}</a><a href="${root}data-deletion/">${S.dataDeletion}</a></span>
    </div>
  </div>
</footer>`;
}

function fill(body, root, page) {
  const lang = page.lang || 'el';
  return body
    .replace(/\{\{root\}\}/g, root)
    .replace(/\{\{icon:([a-z]+)\}\}/g, (m, k) => { if (!ICONS[k]) throw new Error(`${page.file}: unknown icon "${k}"`); return ICONS[k]; })
    .replace(/\{\{latest\}\}/g, () => `<div class="posts">${posts.slice(0, 3).map((p, i) => postCard(p, root, i, lang)).join('\n')}</div>`)
    .replace(/\{\{posts\}\}/g, () => `<div class="posts" id="post-list">${posts.map((p, i) => postCard(p, root, i, lang)).join('\n')}</div>`)
    .replace(/\{\{post:([a-z0-9_-]+)\}\}/g, (m, slug) => { const p = postBySlug[slug]; if (!p) throw new Error(`${page.file}: no post with slug ${slug}`); return root + p.path; })
    .replace(/\{\{social\}\}/g, () => `<div class="social">${SOCIAL.map(([k, label, href]) => `<a class="${k}" href="${href}" target="_blank" rel="noopener">${ICONS[k]}${label}</a>`).join('')}</div>`);
}

/* Greek typesetting on the text of the page body (never inside tags, scripts or
   styles): a day stays with its month ("27 Φεβρουαρίου") and a one-letter word
   (ο, η, ή, Ο, Η, Ή) stays with the word after it, so a line never ends on one. */
const ONE_LETTER = /(^|[\s(«"])([οηήΟΗΉ]) (?=[^\s])/g;
function typeset(html) {
  const at = html.indexOf('<body');
  if (at < 0) return html;
  const parts = html.slice(at).split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>)/);
  for (let i = 0; i < parts.length; i += 2)       // even entries are text between tags
    parts[i] = keepDate(parts[i]).replace(ONE_LETTER, '$1$2&nbsp;');
  // a one-letter word right before an inline tag («όπως η <a…», «(ο <strong>…»):
  // the rule above cannot see past the end of its text, so bind it here
  for (let i = 0; i + 1 < parts.length; i += 2)
    if (/^<(a|strong|em|b|i|span|abbr|time|q|cite)\b/i.test(parts[i + 1])) parts[i] = parts[i].replace(/(^|[\s(«"])([οηήΟΗΉ]) $/, '$1$2&nbsp;');
  return html.slice(0, at) + parts.join('');
}

/* An English page links to the English pages: every link to a page of the
   site that has an English copy (written in _src/en/ the same as in Greek:
   {{root}}contact/, {{root}}#orama, a post's address) gets en/ in front. Files
   (assets/…, the feeds) and pages without a copy keep their address. */
let EN_HAS = new Set();               // the Greek paths that have an English copy (filled in below)
function localize(html, root) {
  return html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/g, (m, a, href, b) => {
    if (!href.startsWith(root)) return m;
    const rest = href.slice(root.length);
    if (/^[a-z][a-z0-9+.-]*:/i.test(rest) || rest.startsWith('/') || rest.startsWith('en/')) return m;
    return EN_HAS.has(rest.split(/[?#]/)[0]) ? a + root + 'en/' + rest + b : m;
  });
}

function render(page) {
  const root = page.meta.absRoot ? new URL(SITE_URL).pathname : rootFor(page.path);
  let html = renderRaw(page);
  if (page.lang === 'en') html = localize(html, root);
  return typeset(html.replace('<!--LANG-BAR-->', langBar(page, root)));
}
function renderRaw(page) {
  /* 404.html is served for a missing address at ANY depth, so its links
     cannot be relative; they use the site's own path (the path of siteUrl:
     "/" at the root of semfealumni.gr). */
  const root = page.meta.absRoot ? new URL(SITE_URL).pathname : rootFor(page.path);
  let main;
  const lang = page.lang || 'el', S = STR[lang];
  if (page.isPost) {
    // the neighbours of the Greek announcement (an English page links them through localize())
    const i = posts.indexOf(page.lang === 'en' ? page.twin : page);
    const newer = posts[i - 1], older = posts[i + 1];
    const el = lang === 'en' ? ' lang="el"' : '';     // the titles are the announcements' own words
    const nav = `<nav class="post-nav" aria-label="${S.otherPosts}">${older ? `<a class="prev" href="${root}${older.path}"><small>${S.prev}</small><span${el}>${esc(older.meta.title)}</span></a>` : '<span></span>'}${newer ? `<a class="next" href="${root}${newer.path}"><small>${S.next}</small><span${el}>${esc(newer.meta.title)}</span></a>` : ''}</nav>`;
    // «Επεξεργασία» and «Διαγραφή», for an admin only (auth.js shows [data-admin-only]): both open the editor
    // on blog/, which loads this announcement and, for a delete, asks before anything is removed
    const name = encodeURIComponent(page.file.split('/').pop());
    const edit = `<p class="post-admin" data-admin-only hidden><a class="btn btn-outline btn-sm" href="${root}blog/?edit=${name}">${ICONS.form} ${S.edit}</a> ` +
      `<a class="btn btn-danger btn-sm" href="${root}blog/?delete=${name}">${ICONS.trash} ${S.del}</a></p>`;
    main = `<section class="tight"><div class="wrap"><article class="prose"${el}>\n${fill(page.body, root, page)}\n</article>\n${edit}\n${nav}</div></section>`;
  } else {
    main = fill(page.body, root, page);
  }
  const bodyAttrs = [page.meta.firestore ? 'data-firestore="1"' : '', page.meta.bodyClass ? `class="${page.meta.bodyClass}"` : ''].filter(Boolean).join(' ');
  return `${head(page, root)}
<body${bodyAttrs ? ' ' + bodyAttrs : ''}>
${header(page, root)}

<main id="main">
${pageHero(page, root)}
${main}
</main>

${footer(root, lang)}
</body>
</html>
`;
}

/* ---- build ----------------------------------------------------------------- */
const pages = readSrc('pages').map(p => ({ ...p, path: p.meta.path }));
for (const p of posts) {
  p.isPost = true;
  p.meta.nav = 'blog';
  p.meta.hero = { title: p.meta.title };
  p.meta.crumbs = [['Ανακοινώσεις', 'blog/']];
}

/* The English copy. _src/en/X.md translates _src/pages/X.md: the same file
   name, the same front matter keys that say how the page works (below); it
   is built at en/<path>. The pages below have no English copy on purpose:
   the 404 page (ONE file answers every missing address; it speaks both
   languages itself) and the LinkedIn return page (its address is registered
   with LinkedIn; its script speaks the language the sign-in started in).
   Every other page needs one: tools/check.mjs fails when it is missing. */
const GREEK_ONLY = ['404.md', 'linkedin-callback.md'];
const SAME_KEYS = ['path', 'nav', 'subnav', 'scripts', 'firestore', 'noindex', 'noTrack', 'layout', 'bodyClass', 'file', 'absRoot'];
const greekByName = Object.fromEntries(pages.map(p => [p.name, p]));
const pagesEn = existsSync(path.join(ROOT, '_src/en')) ? readSrc('en').map(e => {
  const g = greekByName[e.name];
  if (!g) throw new Error(`${e.file}: there is no _src/pages/${e.name} for it to be the English copy of`);
  if (GREEK_ONLY.includes(e.name)) throw new Error(`${e.file}: ${g.file} has no English copy on purpose (GREEK_ONLY in tools/build.mjs)`);
  for (const k of SAME_KEYS) if (JSON.stringify(e.meta[k]) !== JSON.stringify(g.meta[k]))
    throw new Error(`${e.file}: "${k}" must be the same as in ${g.file} (${JSON.stringify(g.meta[k])}): it says how the page works, not what it says`);
  const en = { ...e, path: 'en/' + g.meta.path, twin: g };
  g.twin = en;
  return en;
}) : [];
/* every announcement also has an English page: the site around it in English,
   its own text exactly as its author wrote it (marked lang="el") */
const postsEn = posts.map(p => {
  const en = { ...p, lang: 'en', path: 'en/' + p.path, twin: p, meta: { ...p.meta, crumbs: [['Announcements', 'blog/']] } };
  p.twin = en;
  return en;
});
EN_HAS = new Set([...pages, ...posts].filter(p => p.twin).map(p => p.path));
const all = [...pages, ...pagesEn, ...posts, ...postsEn];
const seen = new Set();
const out = [];
for (const page of all) {
  if (page.path == null) throw new Error(`${page.file}: the front matter needs "path"`);
  if (!page.meta.title || !page.meta.description) throw new Error(`${page.file}: the front matter needs "title" and "description"`);
  const file = page.meta.file || (page.path + 'index.html');
  if (seen.has(file)) throw new Error(`two sources write ${file}`);
  seen.add(file);
  out.push([file, render(page)]);
}

/* The association's earlier site (MkDocs, at semfealumni.gr until this one
   replaced it on 1 October 2026) had a few addresses this one does not: a page
   per year of announcements and one per category. Each gets a small page that
   forwards to the announcements (on the category's filter), so links and
   bookmarks keep working after the move. Files that moved (the PDFs, the logo,
   the photos) are forwarded by the script in _src/pages/404.md. */
const LEGACY = [];
for (const y of [...new Set(posts.map(p => String(p.meta.date).slice(0, 4)))].sort()) LEGACY.push(['blog/archive/' + y + '/', 'blog/']);
for (const c of [...new Set(posts.map(p => p.meta.category).filter(Boolean))].sort()) LEGACY.push(['blog/category/' + c.toLowerCase() + '/', 'blog/?cat=' + encodeURIComponent(c)]);
for (const [from, to] of LEGACY) {
  const file = from + 'index.html';
  if (seen.has(file)) throw new Error(`the forwarding page ${file} would replace a real page`);
  seen.add(file);
  const back = rootFor(from), target = back + to, abs = SITE_URL + to;
  out.push([file, `<!doctype html>
<html lang="el">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ανακοινώσεις · ${esc(C.siteName)}</title>
  <meta name="robots" content="noindex">
  <link rel="canonical" href="${esc(abs)}">
  <meta http-equiv="refresh" content="0; url=${esc(target)}">
</head>
<body>
  <p>Η σελίδα μεταφέρθηκε: <a href="${esc(target)}">Ανακοινώσεις</a>.</p>
</body>
</html>
`]);
}

/* At the root of its own domain (semfealumni.gr) GitHub Pages needs a CNAME
   file naming it, and robots.txt is read from there. Under a sub-path
   (the earlier preview, www.stouras.com/semfealumni/) neither may exist: a CNAME
   would move the site. The CNAME has NO trailing newline on purpose: it is the
   exact form GitHub writes itself whenever someone presses Save under Settings,
   Pages, Custom domain, so a rewrite by GitHub never turns the checks red. */
const ROOTED = new URL(SITE_URL).pathname === '/';
const HOST = new URL(SITE_URL).hostname;
const DROP = [];
if (ROOTED) {
  out.push(['CNAME', HOST]);
  out.push(['robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + 'sitemap.xml\n']);
} else {
  for (const f of ['CNAME', 'robots.txt']) if (existsSync(path.join(ROOT, f))) DROP.push(f);
}

/* An announcement whose source file was deleted: its page goes too (and the
   folders left empty). Without this, deleting _src/posts/x.md only removed it
   from the lists and feeds, and its address kept answering. */
{
  const have = new Set(out.map(([f]) => f));
  const dirs = (d, re) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && re.test(e.name)).map(e => e.name) : [];
  for (const top of ['blog', 'en/blog']) {         // the Greek page and its English one
    const blog = path.join(ROOT, top);
    for (const y of dirs(blog, /^\d{4}$/)) for (const m of dirs(path.join(blog, y), /^\d{2}$/)) for (const d of dirs(path.join(blog, y, m), /^\d{2}$/))
      for (const slug of dirs(path.join(blog, y, m, d), /^[a-z0-9_-]+$/)) {
        const rel = [top, y, m, d, slug, 'index.html'].join('/');
        if (existsSync(path.join(ROOT, rel)) && !have.has(rel)) DROP.push(rel);
      }
  }
}

/* The announcements as feeds, for feed readers (the earlier site had them):
     feed.xml   Atom 1.0
     rss.xml    RSS 2.0
     feed.json  JSON Feed 1.1; also what the e-mail alerts read (functions/
                alerts.js), so a new announcement is mailed exactly when it
                appears here
   Every page names the first two in its <head>, so pasting the site's address
   into a reader finds them. Links inside a post are made absolute. */
const FEED_MAX = 50;
const feedPosts = posts.slice(0, FEED_MAX).map(p => ({
  url: SITE_URL + p.path, title: p.meta.title, summary: p.meta.description || '', date: p.meta.date,
  category: p.meta.category || 'Ανακοινώσεις', image: p.meta.image ? SITE_URL + 'assets/img/posts/' + p.meta.image : '',
  html: fill(p.body, SITE_URL, p)
}));
const isoDay = d => d + 'T12:00:00Z';
const rfc822 = d => new Date(isoDay(d)).toUTCString().replace('GMT', '+0000');
const cdata = s => '<![CDATA[' + String(s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
const newest = feedPosts.length ? feedPosts[0].date : '2026-01-01';
/* both feeds name assets/css/feed.css, so a browser that opens one shows a
   readable list, not code (feed readers ignore the line) */
const FEED_CSS = '<?xml-stylesheet type="text/css" href="assets/css/feed.css"?>';
out.push(['feed.xml', `<?xml version="1.0" encoding="utf-8"?>
${FEED_CSS}
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="el">
  <title>Ανακοινώσεις · ${esc(C.siteName)}</title>
  <subtitle>Ανακοινώσεις, προσκλήσεις και εκδηλώσεις του Συλλόγου</subtitle>
  <id>${SITE_URL}blog/</id>
  <link rel="alternate" type="text/html" href="${SITE_URL}blog/"/>
  <link rel="self" type="application/atom+xml" href="${SITE_URL}feed.xml"/>
  <updated>${isoDay(newest)}</updated>
  <author><name>${esc(C.siteName)}</name></author>
  <icon>${SITE_URL}favicon-32.png</icon>
${feedPosts.map(p => `  <entry>
    <title>${esc(p.title)}</title>
    <id>${p.url}</id>
    <link rel="alternate" type="text/html" href="${p.url}"/>
    <published>${isoDay(p.date)}</published>
    <updated>${isoDay(p.date)}</updated>
    <category term="${esc(p.category)}"/>
    <summary>${esc(p.summary)}</summary>
    <content type="html">${esc(p.html)}</content>
  </entry>`).join('\n')}
</feed>
`]);
out.push(['rss.xml', `<?xml version="1.0" encoding="utf-8"?>
${FEED_CSS}
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ανακοινώσεις · ${esc(C.siteName)}</title>
    <link>${SITE_URL}blog/</link>
    <description>Ανακοινώσεις, προσκλήσεις και εκδηλώσεις του Συλλόγου</description>
    <language>el</language>
    <lastBuildDate>${rfc822(newest)}</lastBuildDate>
    <atom:link href="${SITE_URL}rss.xml" rel="self" type="application/rss+xml"/>
${feedPosts.map(p => `    <item>
      <title>${esc(p.title)}</title>
      <link>${p.url}</link>
      <guid isPermaLink="true">${p.url}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <category>${esc(p.category)}</category>
      <description>${cdata(p.html)}</description>
    </item>`).join('\n')}
  </channel>
</rss>
`]);
out.push(['feed.json', JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Ανακοινώσεις · ' + C.siteName,
  home_page_url: SITE_URL + 'blog/',
  feed_url: SITE_URL + 'feed.json',
  language: 'el',
  items: feedPosts.map(p => Object.assign({
    id: p.url, url: p.url, title: p.title, summary: p.summary, content_html: p.html,
    date_published: isoDay(p.date), tags: [p.category]
  }, p.image ? { image: p.image } : {}))
}, null, 1) + '\n']);

/* sitemap.xml: every indexable page (none while the whole site is noindex:
   a sitemap of noindex pages only earns "submitted URL marked noindex") */
out.push(['sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.filter(p => INDEXABLE && !p.meta.noindex && !p.meta.file).map(p => `  <url><loc>${SITE_URL}${p.path}</loc>${p.isPost ? `<lastmod>${p.meta.date}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`]);

/* functions/site-paths.json: every page the site has, with its title. The
   visit counter (recordVisit) counts a page view only under a path listed
   here, and the analytics builder names the pages from it. */
const BASE = new URL(SITE_URL).pathname;
const tracked = all.filter(p => !p.meta.file && !p.meta.noTrack);
/* a page's name in each language: an English page is "Governance · English"
   (the Greek list names it after its Greek twin, so the two read as a pair);
   an announcement keeps its own title in both */
const greekTitle = p => p.lang === 'en' ? greekTitle(p.twin) : p.meta.path === '' ? 'Αρχική' : p.meta.title;
const englishTitle = p => p.isPost ? p.meta.title : p.lang !== 'en' ? (p.twin ? englishTitle(p.twin) : p.meta.title) : p.meta.path === '' ? 'Home' : p.meta.title;
out.push(['functions/site-paths.json', JSON.stringify({
  about: 'Written by tools/build.mjs: the pages the visit counter (functions/index.js, recordVisit) knows. Do not edit.',
  paths: tracked.map(p => BASE + p.path),
  titles: Object.fromEntries(tracked.map(p => [BASE + p.path, greekTitle(p) + (p.lang === 'en' ? ' · English' : '')])),
  titlesEn: Object.fromEntries(tracked.map(p => [BASE + p.path, englishTitle(p) + (p.lang === 'en' ? ' · English' : '')]))
}, null, 1) + '\n']);

/* assets/js/md/: the Markdown reader of tools/ for the browser. The editor on
   blog/ (assets/js/announce.js) previews an announcement with it, loaded only
   when an admin presses "Προεπισκόπηση", so the preview is made by the very
   code that builds the page. The files are copies with their import names
   changed to .js (a .mjs file is not served as JavaScript everywhere), written
   here so they cannot drift from tools/ (node tools/check.mjs fails when they do). */
{
  const rd = f => readFileSync(path.join(ROOT, 'tools', f), 'utf8');
  const note = from => `/* GENERATED by tools/build.mjs from ${from}: do not edit it here. */\n`;
  const names = s => s.replace("'./vendor/markdown-it.esm.min.mjs'", "'./markdown-it.min.js'").replace("'./vendor/js-yaml.esm.min.mjs'", "'./js-yaml.min.js'").replace("'./components.mjs'", "'./components.js'");
  out.push(['assets/js/md/markdown.js', note('tools/markdown.mjs') + names(rd('markdown.mjs'))]);
  out.push(['assets/js/md/components.js', note('tools/components.mjs') + rd('components.mjs')]);
  for (const [from, to] of [['markdown-it.esm.min.mjs', 'markdown-it.min.js'], ['js-yaml.esm.min.mjs', 'js-yaml.min.js']])
    out.push(['assets/js/md/' + to, rd('vendor/' + from).replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '\n')]);
}

let changed = 0;
for (const [file, html] of out) {
  const full = path.join(ROOT, file);
  const before = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (before === html) continue;
  changed++;
  if (CHECK) { console.log(`out of date: ${file}`); continue; }
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, html);
}
for (const f of DROP) {
  changed++;
  if (CHECK) { console.log(`should not exist while the site is at ${SITE_URL}: ${f}`); continue; }
  unlinkSync(path.join(ROOT, f));
  for (let dir = path.dirname(path.join(ROOT, f)); [path.join(ROOT, 'blog'), path.join(ROOT, 'en', 'blog')].some(b => dir.startsWith(b + path.sep)); dir = path.dirname(dir)) { try { rmdirSync(dir); } catch (e) { break; } }   // the folders it leaves empty
}
if (CHECK) {
  if (changed) { console.log(`${changed} page(s) differ from _src/. Run: node tools/build.mjs`); process.exit(1); }
  console.log(`all ${out.length} generated files match _src/`);
} else {
  console.log(`built ${out.length} files (${changed} changed)`);
}
