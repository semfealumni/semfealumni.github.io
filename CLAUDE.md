# SEMFE Alumni website: repository conventions

The website of the Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ, served by GitHub Pages
from `main` at **https://semfealumni.gr/** (custom domain, verified in the GitHub
organisation `semfealumni`; the repository is `semfealumni/semfealumni.github.io`,
moved there from `konstantinosStouras/semfealumni`, which was deleted on
5 October 2026 once its whole history was here (its last commit is `30c9fd3`):
`MOVE-TO-ORG.md`). It was a
preview at www.stouras.com/semfealumni/ until 1 October 2026. The association's
earlier MkDocs site is kept in `_past-website-versions/` (underscore: never
published, and its workflow stays switched off; do not move anything out of there
into `.github/workflows/`). Greek-language, plain HTML/CSS/JS, no framework.
Member sign-in uses Firebase; see `README.md` and `FIREBASE-SETUP.md`.

## Where the code lives and how a change goes live

* The code is in **`semfealumni/semfealumni.github.io`**, in the GitHub
  organisation SEMFE Alumni, branch `main`. **Pushing to `main` IS the
  publishing step**: the `publish` workflow (`.github/workflows/publish.yml`)
  runs on EVERY push to `main`, builds, commits the built pages and publishes
  the site itself, live 20 to 40 seconds after the push (owner, 2026-10-05:
  "make it appear almost instantly"). That needs **Settings > Pages > Source:
  GitHub Actions**; the job reads the source from the API on every run, and
  while it is still "Deploy from a branch" it publishes nothing and GitHub's own
  "pages build and deployment" publishes `main` a minute or two later, as before.
  What is published is exactly what GitHub's Jekyll published: no `_` or `.`
  names, nothing on `_config.yml`'s `exclude:` list (`tools/site-files.mjs`,
  which `tools/smoke.mjs` serves by too: ONE rule). **A workflow that pushes with
  `GITHUB_TOKEN` starts no other workflow**, so one that commits site files must
  then run `gh workflow run publish.yml` (analytics.yml does; check.mjs pins it),
  or its change is not published. Do not add a `paths:` filter to publish.yml's
  push trigger (check.mjs refuses it): with the source on "GitHub Actions"
  nothing else publishes.
* **Bots push to `main` too, so always `git pull --rebase` before you push**
  (and again when a push is rejected). The workflow `publish` commits
  `Build the pages from _src/`; the Cloud Function `publishAnnouncement` commits
  the announcements sent from the website editor, called `Announcement: <slug>`,
  which `publish` then builds (or takes back with a revert commit when one does
  not build); the workflow `analytics` commits `data/analytics.json`
  (`data: refresh the Στατιστικά figures`).
* **Firebase is never deployed by CI** (`checks.yml` only reads). Functions and
  rules go out by hand from a clone, with the project named:
  `firebase deploy --only functions,firestore:rules --project semfe-alumni`
  (run `npm install` in `functions/` first; see "Deploying Firebase" below).
* **A Claude Code session can push here only when the Claude GitHub App is
  installed on the organisation and given this repository:**
  https://github.com/apps/claude/installations/select_target
  (`MOVE-TO-ORG.md`, Part D). If a push is refused, check that first.
* **The `_src` Markdown dialect in five lines** (the whole format is in
  `_src/README.md`, the reader is `tools/markdown.mjs`):
  1. Raw HTML is allowed (a designed page is HTML around Markdown; a blank line
     after a tag makes the text Markdown again).
  2. Plain CommonMark: tables and `~~strikethrough~~` are switched OFF (`a | b`
     stays plain text), there is no auto-linking and no typographic quotes, and
     a line that starts `2025. ` is a numbered list, so write `2025\. `.
  3. Attribute lists go right after a link, image, paragraph, heading, list or
     quote: `{ .btn newtab }`, `{ width=300 }`; event handlers (`on…`) and
     `srcdoc` are refused.
  4. `{{placeholders}}` pass through untouched, so `[text]({{root}}contact/)`
     works wherever the site is hosted.
  5. A number in the YAML (front matter and the component blocks) must be quoted
     (`slug: "2026"`, `value: "3.000"`), or YAML reads it as a number and the
     build refuses it.

  Text written in the website editor is made HTML-free by
  `assets/js/announce-text.js` (`<`, `&`, `{`, `}` become plain characters), so
  an announcement written there cannot carry HTML, attributes or placeholders.
  A file written by hand in `_src/` may carry HTML.

## Pages are generated

* Edit `_src/pages/*.md` and `_src/posts/*.md` (YAML front matter + Markdown,
  with short YAML blocks for the repeated lists; the format is in
  `_src/README.md`), then run `node tools/build.mjs` and commit the regenerated
  HTML WITH the source. `node tools/check.mjs` fails when the two differ (CI
  runs it on every push). The Markdown and YAML readers are vendored in
  `tools/vendor/` (no `npm install`; check.mjs pins their checksums), the dialect
  is `tools/markdown.mjs`, the YAML blocks `tools/components.mjs`, and
  `node tools/md-selftest.mjs` tests them. Never edit the generated HTML.
* Header, footer, menu and page heads come from `tools/build.mjs`.
* **Announcements can be written on the website** (admins only, `blog/`:
  `assets/js/announce.js`). The Cloud Function `publishAnnouncement`
  (`functions/announcements.js`) commits `_src/posts/<date>-<slug>.md` + its
  pictures in ONE commit titled `Announcement: <slug>`, and
  `.github/workflows/publish.yml` builds the pages (checks.yml skips that first
  commit, which has no built pages yet). The rules for what may be written are
  `assets/js/announce-text.js`, copied byte for byte to `functions/` (check.mjs
  pins it); it makes `<`, `&`, `{`, `}` plain characters, which is what keeps an
  announcement from carrying HTML, attributes or `{{placeholders}}`: keep that
  true. `assets/js/md/` is generated by `tools/build.mjs` from `tools/markdown.mjs`
  (the editor's preview). Setup and the token: `ANNOUNCE-SETUP.md`. Browser
  tests: scenarios P1-P18 of `node tools/auth-flow.mjs --only=P`; function tests:
  `functions/test-announcements.js`.
* **A published announcement can be edited in the same editor** (owner,
  2026-10-05): «Επεξεργασία» on the success panel, and on every post page for an
  admin (`[data-admin-only]`, shown by auth.js; it opens `blog/?edit=<file>`).
  The function's `load` reads the file back with `parsePost` (announce-text.js)
  and offers it only when `buildPost` rebuilds it byte for byte, so a post written
  by hand is never rewritten by the editor (it gets a link to its file on GitHub
  instead); `update` keeps the date, the address (`keepSlug`) and the published
  pictures (`name`), numbers new ones after every picture of that post in the
  repository (`nextImage`), refuses a version changed since it was opened
  (`post-changed`), and commits nothing when nothing changed. The success panel
  shows the address as a link at once.
* **A published announcement can be deleted** (owner, 2026-10-05): «Διαγραφή»
  beside «Επεξεργασία» on every post page (it opens `blog/?delete=<file>`, which
  ASKS, naming it, before anything is sent), in the edit form, and on the success
  panel. The function's `delete` takes the version the admin was shown (`sha`,
  from `load`, which answers it and the title for a hand-written post too),
  refuses one changed since (`post-changed`), and removes the file and its OWN
  pictures (`<date>-<slug>-N.*` only) in one commit `Announcement: delete <slug>`
  (a tree of `sha: null` entries); the build drops the page (`DROP`). The card
  leaves the list on the page at once. A revert of that commit brings it back
  (ANNOUNCE-SETUP.md).
* **The editor knows when a change is online, it does not guess.** Every post
  page carries `<meta name="semfe-source" content="<Git blob id of its .md>">`
  (build.mjs `blobId`); the function returns the same id (`blob`) for what it
  committed, and the success panel fetches the page (`cache: 'no-store'`) every
  few seconds until it matches, or until a deleted page answers 404, then
  re-fetches the page, `blog/` and the home page with `cache: 'reload'` so the
  browser's own cache (GitHub Pages sends `max-age=600`) cannot show the old
  copy behind the link. Keep the two `blobId`s computing the same thing (the
  function test pins it).
* **The logo's name is never cut short.** "ΣΥΛΛΟΓΟΣ ΔΙΠΛΩΜΑΤΟΥΧΩΝ" above
  "ΣΕΜΦΕ ΕΜΠ" is part of the logo: when the header slims on scroll
  (`html.hdr-small`) it may only get smaller, never hidden, at any screen
  width (owner, 2026-10-01; smoke.mjs checks it at 1440, 1101, 390 and 320px).
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
* **Text fills its box and is justified** (owner, 2026-10-05: "any text on the
  website should extend all the way to the right and justified"). Running text
  (`p`, `li`, `dd`, `blockquote`, `.notice`…) is aligned on both sides with
  `hyphens: auto` at every width, by three weightless (`:where`) rules under the
  `p` rule in `site.css`; titles, rows of buttons, button-cards and the centred
  «Γίνετε μέλος» band keep their own alignment. No reading-width cap
  (`max-width` in `em`/`ch`/px) on a block of text: it reaches the right edge
  of its column. A new centred block needs its own `text-align: center`.
* **Node:** the GitHub workflows run on Node 24 (`actions/checkout@v5`,
  `actions/setup-node@v5`). The Cloud Functions stay on Node 22
  (`functions/package.json` engines + `runtime` in `firebase.json`): Firebase
  does not offer Node 24 yet. Move them together when it does.
* Search engines are allowed (`INDEXABLE = true` in `tools/build.mjs`): this is
  the official site. Never delete `CNAME`, and never remove the
  `_github-pages-challenge-semfealumni` TXT record at papaki: either
  one takes the site off its address. Every DNS record is listed in
  `DOMAIN.md`; keep it in step with papaki.
* **The address.** Never hard-code it: everything reads `siteUrl` in
  `assets/js/config.js` (`https://semfealumni.gr/`), and the test suites serve
  the site at the path that setting names. The build writes `CNAME` and
  `robots.txt` because `siteUrl` is the root of a domain (under a sub-path it
  would remove them: a `CNAME` there would move the site). `MIGRATION.md` is the
  record of the first move (from www.stouras.com/semfealumni/, 1 October 2026)
  and `MOVE-TO-ORG.md` of the move into the organisation;
  `node tools/migrate.mjs --verify` still checks the live address (that the site
  works, not which repository serves it). Old addresses of the association's
  earlier MkDocs site are kept alive by `LEGACY` in `tools/build.mjs` (the
  blog's year and category pages) and the script in `_src/pages/404.md` (its
  PDFs, logos and pictures).
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
1. Read it in the PRIVATE log repository `semfealumni/semfealumni-feedback-log`
   (`feedback/INDEX.md`, then `feedback/<TICKET>/feedback.md` and its
   screenshots; how it became independent of the old account:
   `MOVE-TO-ORG.md`, Part D). If it is not in the session, ask to add it.
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
  Analytics 4 (Data API). **The property is "SEMFE Alumni - GA4",
  361541833, stream `G-8SSJKNQNR1` (www.semfealumni.gr): the one the OLD site
  already reported to** (owner, 2026-10-01), so the builder reads its WHOLE
  history (`GA_START` 2015-08-14, the Data API's earliest day) and the old
  site's visits continue into ours; the old site had the same address and
  the same page addresses. The workflow names the property
  (`vars.GA4_PROPERTY_ID || '361541833'`, pinned against config.js by
  check.mjs) and reads it with `GA4_SERVICE_ACCOUNT` if set, else the
  `FIREBASE_SERVICE_ACCOUNT` key itself, once that key's e-mail has
  "Viewer" on the property. A day the site counted goes to the site, every
  other to GA4; hours, universities and companies are the site's only;
  countries, cities and referring sites GA4's only. An unreachable source
  that IS set up leaves the committed file as it is (exit 1); a missing
  secret just leaves that source out; and Google Analytics, until it has
  answered ONCE (`sources.ga4` in the committed file), only warns, so a
  half-finished setup never stops the rest. The page draws more than 120
  days by week and more than two years by month, as the average visits per
  day (a part month at either end then never looks like a fall), and says
  where the line changes from Google Analytics to the site's counter
  (`sources.site.first`). **30+ days with nothing measured is a GAP, not
  zeros** (`measurementGaps`, `file.gaps`): the old site's tag stopped on
  2024-02-08 and the new counters started 2026-10-01, so a period never
  starts or ends inside a gap (a period wholly inside one is left out, and
  the page says so), and the line breaks across it with a sentence naming
  the dates. GA4 without cookies cannot join the pages of one
  visit, so its "sessions" for days after 1 Oct 2026 are close to page
  views: the site's counter, which wins those days, is what counts visits.
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

## E-mail alerts and the RSS / Atom feeds

Owner's guide: `ALERTS-SETUP.md`. A member with an application (pending or
active) chooses kinds of news on account/ > «Ειδοποιήσεις με e-mail»
(`#alerts`, also in the account menu):

* **The kinds are ONE list, `assets/js/alert-topics.js`** (UMD; byte-identical
  copy in `functions/`), pinned by check.mjs against `alertTopics()` and the
  `alertPrefs` hasOnly() lists in `firestore.rules`. `announcements` and
  `events` are the posts' `category` (Ανακοινώσεις / Εκδηλώσεις: check.mjs
  fails when a post's category is covered by no alert); `site` is a «Τι νέο»
  entry once an admin APPROVES it (`functions/news.js`, a copy of
  `assets/js/news.js`, pinned too).
* **`alertPrefs/{uid}`** = `{topics, email, updatedAt}` written by the member,
  the address pinned by the rules to the confirmed sign-in e-mail (no one can
  sign someone else up), plus `k`, the stop-link key, written ONLY by the
  function (the member's write is a merge and may never change it). Deleted
  with the account (account.js + `cleanupUser`), carried over by a merge
  (union of kinds, `accounts.js` step 3a).
* **`alertsMailer`** (scheduled, every 2 h, `functions/alerts.js`) reads only
  what is PUBLIC: the live site's `feed.json` and `changelog.json` +
  `newsOverrides`. Firestore `alertState/ledger` (server only) holds every
  item key ever seen: the FIRST run only seeds it (no back-catalogue mail),
  later runs CLAIM new keys in a transaction before sending, so nothing is
  mailed twice; a failed read or e-mail off claims nothing. One e-mail per
  member per run; only pending/active applications.
* **`alertsUnsubscribe`**: GET shows a page with a button (mail scanners open
  links), POST (the button, or a mail program's one-click via
  `List-Unsubscribe-Post`) empties the member's topics if `k` matches.
* **Feeds**: `tools/build.mjs` writes `feed.xml` (Atom), `rss.xml` (RSS 2.0)
  and `feed.json` (JSON Feed 1.1, what the mailer reads) from the posts, with
  absolute links, and every page's `<head>` names the first two. The
  announcements page links them (`.follow`); a click on RSS or Atom opens a
  short panel under the buttons (`site.js`: the address with a copy button,
  Feedly, Inoreader, the file) instead of the bare file, and both feeds name
  `assets/css/feed.css`, so a browser that opens one shows a readable list.
  Plain CSS, not XSLT: browsers are removing XSLT. Both feeds stay (owner,
  2026-10-05: "I want both").
* Tests: `functions/test-alerts.js`, the merge/cleanup tests, auth-flow
  T1-T2, rules-test (alertPrefs, alertState), smoke section 6 (feeds).

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
    cd functions && npm test                  the Cloud Functions (LinkedIn, accounts, feedback e-mails, statistics, e-mail alerts), against fakes
    node tools/feedback-sync.mjs --selftest   the feedback resolution files and the ticket log
    cd tools/rules-test && npm install && npm test   firestore.rules on the real emulator (needs Java)

Any change to the account, members, admin or feedback pages gets a scenario in
`tools/auth-flow.mjs`; any layout change must keep `tools/smoke.mjs` green.
