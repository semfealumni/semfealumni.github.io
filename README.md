# SEMFE Alumni website

The website of the **Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ** (alumni association
of the School of Applied Mathematical and Physical Sciences, NTUA), redesigned
from the association's MkDocs site
([semfealumni/semfealumni.github.io](https://github.com/semfealumni/semfealumni.github.io))
with a modern look and **member sign-in** (Google, LinkedIn or e-mail)
through Firebase. (The code also supports Facebook; it is left out for now.)

Live at **https://semfealumni.gr/** (moved there on 1 October 2026 from the
preview at https://www.stouras.com/semfealumni/).

Plain HTML, CSS and a little JavaScript. GitHub Pages serves the files exactly
as they are here; there is nothing to install to publish it.

## What is here

    index.html, */index.html   the pages (GENERATED from _src/, do not edit by hand)
    _src/pages/*.html          the text of each page
    _src/posts/*.html          the announcements (Ανακοινώσεις)
    assets/css/site.css        the one stylesheet (colours at the top)
    assets/js/config.js        the settings: Firebase config, sign-in buttons, admin e-mails
    assets/js/site.js          menu, motion (gliding links, counting numbers, fade-ins), photo viewer, copy buttons, announcement filter
    assets/js/auth.js          sign-in and registration (Firebase Authentication)
    assets/js/account.js       "Ο λογαριασμός μου": membership application, sign-in methods, delete account
    assets/js/members.js       "Περιοχή μελών": members-only directory
    assets/js/feedback.js      "Σχόλια και προβλήματα": a member's message + screenshots, ticket number, their own tickets
    assets/js/admin-feedback.js  the admin page's inbox of those messages: answer and close, reopen, delete
    assets/js/admin.js         "Διαχείριση": approve applications, record dues, every account, merge duplicates, export CSV
    assets/js/news.js, news-page.js  "Τι νέο": the list of site changes; admins approve, reword or remove each entry
    changelog.json             the suggested "Τι νέο" entries (public only once an admin approves them)
    assets/js/analytics-page.js  "Στατιστικά": visits (data/analytics.json) and the members' anonymous statistics
    assets/js/visit.js         on every public page: Google Analytics (cookieless) and the site's own visit counter
    assets/js/profile-options.js  the profile's fixed answers (gender, industry, country); copied to functions/
    data/analytics.json        the visit figures, rebuilt daily by tools/build-analytics.mjs (GitHub Action "analytics")
    assets/img, assets/docs    photos, logos and the PDFs
    firestore.rules            the database security rules (the real gatekeeper)
    firebase.json, .firebaserc, check-project.mjs   for deploying the rules from the command line
    FIREBASE-SETUP.md          step by step: Firebase, Google, LinkedIn, e-mail
    FEEDBACK-SETUP.md          step by step: the feedback e-mails and the private ticket log
    ANALYTICS-SETUP.md         step by step: the Στατιστικά page (counter, members, Google Analytics)
    _feedback-resolutions/     one file per ticket closed from the repository (see its README)
    functions/                 Cloud Functions: LinkedIn sign-in, accounts list/merge, feedback e-mails,
                               the visit counter (recordVisit) and the members' statistics (memberStats)
    tools/                     build, checks and tests (not published)
    CLAUDE.md, .github/        repository conventions; the CI checks run on every push

## Editing a page

1. Edit the page's file in `_src/pages/` (for example `_src/pages/governance.html`).
2. Run `node tools/build.mjs` to regenerate the served pages.
3. Run `node tools/check.mjs` (links, share card, admin list, everything in sync).
4. Commit and push. GitHub Pages republishes in a minute or two.

Each source file starts with a small `<!--META {...} META-->` block (title,
description, address). Inside the text, `{{root}}` stands for the way back
to the site root, so links keep working wherever the site is hosted.

## Adding an announcement

Copy one of the files in `_src/posts/`, rename it `YYYY-MM-DD-slug.html`, and
change the META block:

```html
<!--META
{
  "title": "Πρόσκληση για Κοπή Πίτας στις 27 Φεβρουαρίου 2026",
  "date": "2026-02-11",
  "slug": "2026-kopi-pitas",
  "category": "Ανακοινώσεις",
  "image": "2026-kopi-pitas.jpg",
  "description": "Μία πρόταση που εμφανίζεται στην κάρτα της ανακοίνωσης."
}
META-->
<p>Το κείμενο της ανακοίνωσης…</p>
```

`category` is `Ανακοινώσεις` or `Εκδηλώσεις`. `image` is optional: put the
picture in `assets/img/posts/`. Then `node tools/build.mjs`. The home page
shows the three newest automatically, and the address follows the old site's
scheme (`blog/2026/02/11/2026-kopi-pitas/`).

## Sign-in and member accounts

Sign-in stays **off** until you paste your Firebase web config into
`assets/js/config.js`; until then the "Σύνδεση" button explains that
registration opens soon and the support page keeps the old Google Form. Every
step is in **[FIREBASE-SETUP.md](FIREBASE-SETUP.md)**.

What members get once it is on:

* **Register or sign in** with Google, LinkedIn, or e-mail and password
  (e-mail accounts confirm their address first).
* **Membership application** on "Ο λογαριασμός μου", replacing the Google Form,
  with the application's status (pending, active, not approved) and the dues on record.
* **Members area** with a directory of active members who chose to be listed.
* **Several sign-in methods on one account**: the account page asks members
  to add the ways in they do not have yet, and a member with two accounts
  (say one from Google, one from LinkedIn) can merge them into one.
* **Self-service deletion** of the account and all its data.
* **Σχόλια και προβλήματα**: members report a problem or an idea, with
  screenshots, and get a ticket number by e-mail; the answer is e-mailed to
  them when the ticket is closed (from the admin page, or from a file in
  `_feedback-resolutions/`). Every ticket is copied to a private GitHub
  repository. Setup: `FEEDBACK-SETUP.md`.

The board manages applications at `/admin/` (only the addresses in
`ADMIN_EMAILS` in `config.js` **and** in `isAdmin()` in `firestore.rules`).
The same page lists every account that has signed in, marks likely duplicates
and merges two accounts of one person; that part runs in the `accounts` Cloud
Function (`functions/accounts.js`, FIREBASE-SETUP.md Part E).

## The «Στατιστικά» page

`/analytics/` shows how the site is used and, anonymously, who has
registered. Setup, step by step: **`ANALYTICS-SETUP.md`**.

* **Visits** (`data/analytics.json`, rebuilt every morning by the
  `analytics` GitHub Action): the site's own counter (the `recordVisit` Cloud
  Function: page views, visits, hours, devices, and the university or company
  a visitor's network is registered to) plus Google Analytics 4 without
  cookies (countries, cities, referring sites; property "SEMFE Alumni - GA4",
  the old site's, read from its first day). The visitor's address is
  never stored; home and mobile connections are attributed to nobody.
* **Members** (Firestore `publicStats/members`, recounted by the `memberStats`
  Cloud Function on every registration or edit): totals per question only;
  groups under 3 people are merged into «Λοιπά», questions with fewer than 5
  answers are not shown, years are counted in five-year periods.

## Search engines

This is the official site, so search engines are allowed (`INDEXABLE = true`
in `tools/build.mjs`; the build writes `robots.txt` and the sitemap). Set it
back to `false` and build to hide every page again.

## Moving to semfealumni.gr

Everything is ready for a one-session move: see **`MIGRATION.md`**. In short,
the address lives in one setting (`siteUrl` in `assets/js/config.js`), and
`node tools/migrate.mjs` plans the move (`--plan`), rehearses it on a copy
(`--rehearse`), checks the outside services (`--prep-check`), does it
(`--apply`) and verifies the live result (`--verify`). The old site's
addresses keep working through small forwarding pages.

## Tests

    node tools/check.mjs                  offline checks (fast; run before every commit)
    node tools/smoke.mjs                  every page at 10 screen sizes, menu, motion, dialog, gallery (Playwright)
    node tools/auth-flow.mjs              the sign-in, account, members, admin and feedback flows against a fake Firebase
    node tools/feedback-sync.mjs --selftest   the feedback resolution files and the ticket log (offline)
    node tools/build-analytics.mjs --selftest the Στατιστικά builder and the shape of data/analytics.json (offline)
    cd tools/rules-test && npm install && npm test   the Firestore rules against the real emulator (needs Java)
    cd functions && npm test                         the Cloud Functions: LinkedIn sign-in, accounts list and merge, feedback e-mails, the visit counter and the members' statistics (offline, with fakes)

## Hosting

The site lives in its own repository, `konstantinosStouras/semfealumni`.
GitHub Pages publishes it from the `main` branch, root folder (Settings, Pages,
Source: "Deploy from a branch", `main`, `/ (root)`), with the custom domain
`semfealumni.gr` (the `CNAME` file, written by the build). The domain is
VERIFIED in the owner's GitHub account (a TXT record
`_github-pages-challenge-konstantinosstouras` at papaki, the registrar, which
must stay), so no other account can claim it. DNS at papaki: four A and four
AAAA records to GitHub Pages, `www` a CNAME to `konstantinosstouras.github.io`.
A missing address shows this site's own `404.html`. Every DNS record, the
verification code and what to do if one goes missing: **`DOMAIN.md`**.

Do **not** add a `.nojekyll` file: Jekyll is what keeps `_src/` off the web,
and `_config.yml` keeps `tools/`, `functions/` and the Firebase files off it too.

Every push runs `.github/workflows/checks.yml` (the offline checks and the
Cloud Functions' tests); it only reads the files, it never deploys.
