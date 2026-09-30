# SEMFE Alumni website

The website of the **Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ** (alumni association
of the School of Applied Mathematical and Physical Sciences, NTUA), redesigned
from the association's MkDocs site
([semfealumni/semfealumni.github.io](https://github.com/semfealumni/semfealumni.github.io))
with a modern look and **member sign-in** (Google, LinkedIn or e-mail)
through Firebase. (The code also supports Facebook; it is left out for now.)

Live at **https://www.stouras.com/semfealumni/**.

Plain HTML, CSS and a little JavaScript. GitHub Pages serves the files exactly
as they are here; there is nothing to install to publish it.

## What is here

    index.html, */index.html   the pages (GENERATED from _src/, do not edit by hand)
    _src/pages/*.html          the text of each page
    _src/posts/*.html          the announcements (Ανακοινώσεις)
    assets/css/site.css        the one stylesheet (colours at the top)
    assets/js/config.js        the settings: Firebase config, sign-in buttons, admin e-mails
    assets/js/site.js          menu, photo viewer, copy buttons, announcement filter
    assets/js/auth.js          sign-in and registration (Firebase Authentication)
    assets/js/account.js       "Ο λογαριασμός μου": membership application, sign-in methods, delete account
    assets/js/members.js       "Περιοχή μελών": members-only directory
    assets/js/feedback.js      "Σχόλια και προβλήματα": a member's message + screenshots, ticket number, their own tickets
    assets/js/admin-feedback.js  the admin page's inbox of those messages: answer and close, reopen, delete
    assets/js/admin.js         "Διαχείριση": approve applications, record dues, every account, merge duplicates, export CSV
    assets/img, assets/docs    photos, logos and the PDFs
    firestore.rules            the database security rules (the real gatekeeper)
    firebase.json, .firebaserc, check-project.mjs   for deploying the rules from the command line
    FIREBASE-SETUP.md          step by step: Firebase, Google, LinkedIn, e-mail
    FEEDBACK-SETUP.md          step by step: the feedback e-mails and the private ticket log
    _feedback-resolutions/     one file per ticket closed from the repository (see its README)
    functions/                 Cloud Functions: LinkedIn sign-in, accounts list/merge, feedback e-mails
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

## Search engines

While this copy runs beside the association's own semfealumni.gr, every page
carries `noindex` so the two copies do not compete in search results. When this
becomes the official site, set `INDEXABLE = true` in `tools/build.mjs` and run
the build.

## Moving to semfealumni.gr later

All links are relative, so the files work at any address. Change `siteUrl` in
`assets/js/config.js`, add a `CNAME` file with the domain, run
`node tools/build.mjs` and `node tools/make-share-images.mjs`, point the DNS at
GitHub Pages, and add the new domain to Firebase's authorized domains and to
the LinkedIn app's redirect URL (FIREBASE-SETUP.md, Part D).

## Tests

    node tools/check.mjs                  offline checks (fast; run before every commit)
    node tools/smoke.mjs                  every page at 10 screen sizes, menu, dialog, gallery (Playwright)
    node tools/auth-flow.mjs              the sign-in, account, members, admin and feedback flows against a fake Firebase
    node tools/feedback-sync.mjs --selftest   the feedback resolution files and the ticket log (offline)
    cd tools/rules-test && npm install && npm test   the Firestore rules against the real emulator (needs Java)
    cd functions && npm test                         the Cloud Functions: LinkedIn sign-in, accounts list and merge, feedback e-mails (offline, with fakes)

## Hosting

The site lives in its own repository, `konstantinosStouras/semfealumni`.
GitHub Pages publishes it from the `main` branch, root folder (Settings, Pages,
Source: "Deploy from a branch", `main`, `/ (root)`). Because the owner's user
site carries the custom domain `www.stouras.com`, this project site is served
under it automatically at `https://www.stouras.com/semfealumni/`. A missing
address under it shows this site's own `404.html`.

Do **not** add a `.nojekyll` file: Jekyll is what keeps `_src/` off the web,
and `_config.yml` keeps `tools/`, `functions/` and the Firebase files off it too.

Every push runs `.github/workflows/checks.yml` (the offline checks and the
Cloud Functions' tests); it only reads the files, it never deploys.
