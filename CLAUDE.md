# SEMFE Alumni website: repository conventions

The website of the Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ, served by GitHub Pages
from `main` at **https://semfealumni.gr/** (custom domain, verified in the
owner's GitHub account; it was a preview at www.stouras.com/semfealumni/ until
1 October 2026). Greek-language, plain HTML/CSS/JS, no framework.
Member sign-in uses Firebase; see `README.md` and `FIREBASE-SETUP.md`.

## Pages are generated

* Edit `_src/pages/*.html` and `_src/posts/*.html`, then run
  `node tools/build.mjs` and commit the regenerated HTML WITH the source.
  `node tools/check.mjs` fails when the two differ (CI runs it on every push).
* Header, footer, menu and page heads come from `tools/build.mjs`.
* **The top menu is kept short on purpose** (owner, like operationsacademia.org):
  the logo is the way home (no «Αρχική» link), the pages ABOUT the association
  and the site sit in one «Ο Σύλλογος ▾» drop-down (`NAV_GROUPS`, three
  groups: Ο Σύλλογος, Η ιστορία μας, Ο ιστότοπος = Τι νέο + Στατιστικά), and only
  Ανακοινώσεις, Εγγραφές & Δωρεές and Επικοινωνία stay in the row (`NAV`).
  A new page about the association goes into a group, not into the row. On a
  phone the menu button lists the groups under their headings.
* **Motion** (owner, like www.stouras.com and operationsacademia.org), all in
  `assets/js/site.js`, none of it under `prefers-reduced-motion`:
  a link to a place on the SAME page glides there on the cosine "swing" curve
  www.stouras.com scrolls with (`glideTo`, re-measured every frame, stopped by
  the reader's wheel, touch or key); a round back-to-top button appears past
  1.2 screens; a number marked `data-count` (in the hero only 3.000+, the owner's choice:
  the years and the fee stay fixed) counts up from
  zero when it comes into view, a screen reader getting the final figure; and
  blocks further down a page rise into view (`RISE` selector list). Nothing is
  hidden without JavaScript or on paper: a block is held back only by the
  script and only while it is still below the screen, never on the member
  pages (`data-firestore`), and `settleMotion` in `tools/smoke.mjs` scrolls a
  page through before anything is measured. A new kind of block that should
  rise goes into `RISE`; a new number into the markup with `data-count`.
* **Node:** the GitHub workflows run on Node 24 (`actions/checkout@v5`,
  `actions/setup-node@v5`). The Cloud Functions stay on Node 22
  (`functions/package.json` engines + `runtime` in `firebase.json`): Firebase
  does not offer Node 24 yet. Move them together when it does.
* Search engines are allowed (`INDEXABLE = true` in `tools/build.mjs`): this is
  the official site. Never delete `CNAME`, and never remove the
  `_github-pages-challenge-konstantinosstouras` TXT record at papaki: either
  one takes the site off its address. Every DNS record is listed in
  `DOMAIN.md`; keep it in step with papaki.
* **The move to semfealumni.gr** is prepared: `MIGRATION.md` and
  `tools/migrate.mjs` (`--plan`, `--rehearse`, `--prep-check`, `--apply`,
  `--verify`). Never hard-code the address: everything reads `siteUrl`, and
  the test suites serve the site at its path (`/semfealumni/` now, `/` after
  the move). The build writes `CNAME` and `robots.txt` ONLY when `siteUrl` is
  the root of a domain; a `CNAME` here while the site is a preview would move
  it. Old addresses of the association's earlier site are kept alive by
  `LEGACY` in `tools/build.mjs` and the script in `_src/pages/404.html`.
* Do **not** add a `.nojekyll` file: Jekyll keeps `_src/` off the web and
  `_config.yml` excludes the maintenance files.

## Sign-in and data

* Sign-in is OFF while `assets/js/config.js` holds `PASTE_` placeholders; the
  site then shows "opens soon" and never loads the Firebase SDK.
* `firestore.rules` is the gatekeeper (members/{uid}, directory/{uid},
  feedback/{ticket}, and the server-only linkedinLinks/, accountMerges/,
  mergeLocks/). `ADMIN_EMAILS` in config.js must equal the list in
  `isAdmin()`; check.mjs fails when they differ.
* LinkedIn sign-in goes through the Cloud Function in `functions/`
  (`LINKEDIN.mode: 'function'` in config.js).
* The admin page's list of every account, and merging two accounts of one
  person, run in the `accounts` Cloud Function (`functions/accounts.js`). Its
  safety rules (confirmed e-mail on the kept account, an admin is never the
  one removed, a sign-in that cannot move stays put) are pinned by
  `functions/test-accounts.js`: keep them.

## Feedback tickets (the «Σχόλια και προβλήματα» page)

Members send messages from `/feedback/`; each gets a ticket number
`SEMFE-YYMMDD-XXXX` (the id of `feedback/{ticket}` in Firestore). Setup and
the whole flow: `FEEDBACK-SETUP.md`.

**Acting on a ticket** ("look at feedback SEMFE-260930-AB23"):
1. Read it in the PRIVATE log repository `konstantinosStouras/semfealumni-feedback-log`
   (`feedback/INDEX.md`, then `feedback/<TICKET>/feedback.md` and its
   screenshots). If it is not in the session, ask to add it.
2. Fix the site as usual (source, build, tests).
3. In the SAME change, add `_feedback-resolutions/<TICKET>.md` (format in the
   README there): a short, friendly Greek answer saying what was done, plus an
   optional https link to the page. When it reaches `main`, the `feedback`
   workflow closes the ticket and the sender is e-mailed the text.
4. This repository is PUBLIC: never write the sender's name or e-mail in a
   resolution file (`node tools/feedback-sync.mjs --scan` refuses one that
   carries an address).

## «Τι νέο» (whats-new/): add an entry with every visible change

Like operationsacademia.org, the site keeps a dated list of what changed, and
**nothing on it is public until an admin approves it**:

* `changelog.json` (repository root, served) says WHAT changed, newest first:
  `{ id, date, title, summary, url? }`. **Whenever you ship a change people
  would notice, add an entry at the top in the same change**: Greek, short,
  plain words, `id` = `YYYY-MM-DD-<a-few-latin-words>` (never reuse one),
  `url` optional (a page of the site such as `support/` or `#skopos`, or
  https). It is only a SUGGESTION.
* Firestore `newsOverrides/{id}` holds the admins' DECISION: `status`
  approved | pending | removed, plus an optional rewording (`title`,
  `summary`; empty = the changelog's own text). No document = waiting.
  Admins decide on the page itself (Δημοσίευση, Δημοσίευση όλων,
  Επεξεργασία, Αφαίρεση, and Επαναφορά in the closed «Αφαιρεμένα» box); the
  account menu shows them «Τι νέο: έγκριση» with the count waiting.
* `assets/js/news.js` is the ONE definition of who sees what (page and tests
  load it). Visitors read the decisions with one plain request to Firestore's
  REST address (no Firebase library, no cookies); a failed read shows nothing,
  never everything. `node tools/check.mjs` checks every changelog entry and
  that `DOC_KEYS` equals the rule's `hasOnly()` list.
* Tests: `tools/rules-test` (newsOverrides), `tools/auth-flow.mjs` W1-W4,
  `tools/smoke.mjs` (the page with sign-in off).

## «Στατιστικά» (analytics/): visits and the members, anonymously

Setup for the owner: `ANALYTICS-SETUP.md`. Two parts, two sources each:

* **Visits** = `data/analytics.json`, rebuilt daily by
  `.github/workflows/analytics.yml` (`tools/build-analytics.mjs`; modes
  `--scan`, `--dry-run`, `--selftest`). Sources: the site's OWN counter
  (Firestore `siteVisits/{day}`, written only by the `recordVisit` Cloud
  Function from `assets/js/visit.js`'s one message per page view) and Google
  Analytics 4 (Data API; secret `GA4_SERVICE_ACCOUNT`, variable
  `GA4_PROPERTY_ID`). A day the site counted goes to the site, every other
  to GA4; hours, universities and companies are the site's only; countries,
  cities and referring sites GA4's only. An unreachable source that IS set
  up leaves the committed file as it is (exit 1); a missing secret just
  leaves that source out.
* **Members** = Firestore `publicStats/members` (public read, server write),
  recounted by the `memberStats` Cloud Function on every write to
  `members/{uid}` that touches a counted field, and by the daily workflow.
  One function counts both: `functions/member-stats.js`.
* **Privacy is the design, keep it:** `visit.js` stores nothing but a
  sessionStorage flag, runs only on `ANALYTICS.hosts`, never under GPC/DNT,
  never for crawlers, never on `noTrack` pages (admin, LinkedIn callback);
  GA4 is cookieless (`client_storage: 'none'`) and gets the path without its
  query. `recordVisit` never stores or logs the address: `functions/netorg.js`
  turns it into a university or company name or nothing (internet providers,
  clouds, VPNs and security proxies are never named; a company only from its
  OWN registration, never from reverse DNS) and the page names a company only
  with 2+ visits. Member statistics: totals per question only, groups under
  K=3 merged into «Λοιπά», questions under 5 answers hidden, years in
  five-year periods, "prefer not to say" not counted. The privacy page says
  all of this; change both together.
* **Profile answers** gender / industry / country are OPTIONAL (also in the
  rules, so a page loaded before them still saves). Their lists live in
  `assets/js/profile-options.js` (keys stored, labels shown), copied byte for
  byte to `functions/profile-options.js`; `genders()` / `industries()` in
  `firestore.rules` must match. `tools/check.mjs` fails on any drift.
* `functions/site-paths.json` (the pages the counter accepts; others count
  as `other`) is WRITTEN by `tools/build.mjs`: rebuild after adding a page.
* Tests: `cd functions && npm test` (test-analytics.js),
  `node tools/build-analytics.mjs --selftest`, `tools/auth-flow.mjs` S1-S2
  and F2, `tools/rules-test` (optional answers, publicStats, siteVisits).

## Deploying Firebase: always name the project

    firebase deploy --only firestore:rules --project <project-id>

`check-project.mjs` runs as a predeploy hook on every deployable section of
`firebase.json` and refuses a deploy into any project other than the one in
`.firebaserc`. `tools/rules-test/` is emulator-only (`demo-semfe`) and its own
guard refuses every deploy. Keep `firebase.json`'s functions `runtime` equal to
`functions/package.json` `engines.node` (check.mjs pins it).

## Tests

    node tools/check.mjs                      offline checks (fast)
    node tools/smoke.mjs                      every page, 10 screen sizes, no web font, larger text (Playwright)
    node tools/auth-flow.mjs                  sign-in, account, members, admin flows against a fake Firebase
    cd functions && npm test                  the Cloud Functions (LinkedIn, accounts, feedback e-mails), against fakes
    node tools/feedback-sync.mjs --selftest   the feedback resolution files and the ticket log
    cd tools/rules-test && npm install && npm test   firestore.rules on the real emulator (needs Java)

Any change to the account, members, admin or feedback pages gets a scenario in
`tools/auth-flow.mjs`; any layout change must keep `tools/smoke.mjs` green.
