# Writing announcements on the website: setup guide

## What the admins get

On **https://semfealumni.gr/blog/** (the «Ανακοινώσεις» page), an admin who is
signed in sees a button **«Νέα ανακοίνωση»** above the list. Nobody else sees it.
It opens a box like a forum post:

* **Τίτλος**, and the **είδος**: Ανακοινώσεις or Εκδηλώσεις (this also decides
  which members get the e-mail alert, ALERTS-SETUP.md).
* **The text**, with a toolbar (bold, italic, link, quote, lists, heading,
  line, picture, undo, redo), a **«Συμβουλές μορφοποίησης»** cheat sheet and a
  **«Προεπισκόπηση»** tab that shows the page as it will look.
* **Pictures** (up to 8): drop them in, paste one, or choose files. They are made
  smaller automatically, each gets a description and a width, and one can be the
  picture on the announcement's card.
* **«Δημοσίευση»**: it asks "Να δημοσιευτεί τώρα;", then sends it.

The text is kept on the admin's own computer while it is being written, so a
closed tab does not lose it.

## What happens when «Δημοσίευση» is pressed

    the browser ──► Cloud Function publishAnnouncement ──► GitHub (one commit)
                                                              │
                          _src/posts/2026-10-05-kopi-pitas.md │ + the pictures in
                                                              │   assets/img/posts/
                                                              ▼
                          workflow "publish": node tools/build.mjs ──► the page, the
                          home page cards, the feeds, the sitemap ──► GitHub Pages

1. The function checks that the caller is a **verified admin address** (the same
   list as everywhere else, `ADMIN_EMAILS`), cleans the text (no HTML, no
   `{{placeholders}}`), checks every picture by its first bytes and its size, and
   writes the announcement as an ordinary `_src/posts/YYYY-MM-DD-slug.md`
   (see `_src/README.md`) in **one commit** with its pictures.
2. The workflow `.github/workflows/publish.yml` builds the pages from it and
   commits them. GitHub Pages publishes. It is on the site **2 to 4 minutes**
   after the button (once the site is served from the organisation's
   repository: see "Order: after the switch to the organisation, not before"
   below); the editor says so and shows a link when the page exists.
3. The e-mail alerts pick it up from `feed.json` within two hours like any
   other announcement.

It is an ordinary file in the repository: to **correct or remove** an
announcement afterwards, edit or delete its file in `_src/posts/` on github.com
(the workflow rebuilds the pages: a deleted file takes its page, and the page's
folders, with it; delete its pictures in `assets/img/posts/` too), or in a clone
and `node tools/build.mjs`.

**If the build stops** (it should not: the text is made safe, and the checks run on
the built site) the workflow **takes the announcement back**: a second commit
`Revert "Announcement: …"` removes it, so that one bad announcement can never hold
back the next ones. Nobody is e-mailed about it. The editor then shows
«Δεν εμφανίστηκε ακόμα»; look at **Actions > publish** to see why.

## Order: after the switch to the organisation, not before

The editor commits into the repository named by `PUBLISH_REPO`, which is
`semfealumni/semfealumni.github.io`. Until MOVE-TO-ORG.md, Part C, is finished,
https://semfealumni.gr/ is still served from the old repository
(`konstantinosStouras/semfealumni`). So an announcement sent before then is
built in the new repository and does **not** appear on the site (the editor ends
with «Δεν εμφανίστηκε ακόμα» after about 8 minutes). It would appear, and be
e-mailed to the members who chose that kind, the moment the switch is done.

So do step 4 (Try it) only after the switch. If a test announcement was made
before it, **delete it before the switch**: its `.md` file in `_src/posts/` and
its pictures in `assets/img/posts/` (how: the paragraph "It is an ordinary file
in the repository" above).

## Switching it on (15 minutes, once)

Until this is done the editor still opens, shows a notice that publishing is not
set up, and lets the admin write and preview.

### 1. A GitHub token that may write to this one repository

The function needs a key to commit on the association's behalf. It should be a
**fine-grained token** that can do one thing in one repository.

1. On GitHub, signed in as someone who may write to the site's repository:
   your photo, top right > **Settings** > **Developer settings** (bottom of the
   left menu) > **Personal access tokens** > **Fine-grained tokens** >
   **Generate new token**.
2. **Token name**: `SEMFE announcements`.
3. **Resource owner**: the **semfealumni** organisation (the site's repository
   belongs to it).
4. **Expiration**: the longest it allows (one year). An organisation may limit
   how long a token may live: a limit of 366 days has been met here. An owner of
   the organisation can change it under the organisation's **Settings** >
   **Personal access tokens** > **Settings**. If it cannot be lifted, keep the
   366 days. Either way put the date in your calendar: after it, publishing
   stops with the message «Το κλειδί του GitHub έχει λήξει» and you repeat this
   step.
5. **Repository access**: **Only select repositories**, and choose the site's
   repository, `semfealumni.github.io`.
6. **Permissions** > **Repository permissions** > **Contents**: **Read and write**.
   Nothing else (Metadata: Read-only is added by itself).
7. **Generate token** and copy it (it starts with `github_pat_`). It is shown
   once.
8. If the resource owner is an organisation that asks for approval of tokens, an
   owner approves it under the organisation's **Settings** > **Personal access
   tokens** > **Pending requests**.

A token belongs to the person who made it: if they leave the organisation or
lose write access, publishing stops until someone else makes a new one.

### 2. Give the function the token, and say which repository

On your computer, in the repository folder. Check two things first.

**Where the folder pulls from.** `git remote -v` must show
`https://github.com/semfealumni/semfealumni.github.io` for `origin`. If it shows
the old repository (`konstantinosStouras/semfealumni`), point it at the
organisation:

    git remote set-url origin https://github.com/semfealumni/semfealumni.github.io

A folder that still pulls from the old repository brings the old code, whose
default for `PUBLISH_REPO` is the old repository: announcements would be
committed there and never reach the site.

**The settings file.** `functions/.env.semfe-alumni` holds the answers the deploy
asks for. It is **not in git**, so `git pull` neither brings nor replaces it:
keep the one already on the computer you deploy from. Without it the deploy asks
every setting again, and then:

* `ALLOWED_ORIGINS` (the same setting as for the sign-in functions,
  FIREBASE-SETUP.md / MIGRATION.md) must contain
  `https://semfealumni.gr,https://www.semfealumni.gr`: otherwise the browser
  refuses the answer and the editor says the service «δεν απαντά» although it is
  running;
* `LINKEDIN_REDIRECT_URIS` must contain `https://semfealumni.gr/auth/linkedin/`
  (the address registered at LinkedIn, FIREBASE-SETUP.md, Part D);
* `FEEDBACK_TO` may hold several addresses, separated by commas.

Then:

    git pull
    cd functions
    npm install
    cd ..
    firebase deploy --only functions --project semfe-alumni

The deploy asks for **`GITHUB_PUBLISH_TOKEN`** only when that secret does not
exist yet: then paste the token (answer `none` to leave publishing off). To set
or replace it at any time, run

    firebase functions:secrets:set GITHUB_PUBLISH_TOKEN --project semfe-alumni

and then deploy again, so that the function picks up the new value. It is kept in
Google Secret Manager and never appears on the site or in the repository.

The repository and branch have defaults in `functions/index.js`
(`PUBLISH_REPO` = `semfealumni/semfealumni.github.io`, `PUBLISH_BRANCH` = `main`).
A deploy without the settings file asks for them too: press Enter to keep the
defaults. **If the site's repository is ever another one**, put it in
`functions/.env.semfe-alumni` before deploying:

    PUBLISH_REPO=owner/name
    PUBLISH_BRANCH=main

Check the output: the function list now has **`publishAnnouncement`** (ten
functions in all).

### 3. Allow the workflow to push

The `publish` workflow commits the built pages with GitHub's own token. In the
repository: **Settings** > **Actions** > **General** > **Workflow permissions** >
**Read and write permissions** > **Save**. (The `analytics` workflow needs the
same.) The two workflows `publish.yml` and `analytics.yml` ask for the write
permission themselves (`permissions: contents: write` at the top of each), so
this setting is a safety net: if an organisation policy keeps it read-only,
publishing still works. Nothing else is needed: there is no secret for it.

### 4. Try it

Do this only **after** the switch to the organisation is finished
(MOVE-TO-ORG.md, Part C; see "Order" above): before it, the commit appears in
the new repository but not on the site.

Open https://semfealumni.gr/blog/ signed in as an admin, press **«Νέα
ανακοίνωση»**. With no notice about the setup you are ready: write a title and a
line, tick **Ανακοινώσεις**, **Δημοσίευση**, **Ναι**. After a few minutes the page
exists and the editor links to it. **Delete the test announcement** afterwards
(its `.md` file in `_src/posts/` and its pictures), because members who chose
the alert will get an e-mail about it.

## If something goes wrong

The editor says in Greek what failed; the codes behind the messages:

| The editor says | Why | What to do |
|---|---|---|
| «Η δημοσίευση … δεν έχει ρυθμιστεί ακόμα» | the secret is `none` or empty | step 2 |
| «Η υπηρεσία δημοσίευσης δεν απαντά» | `publishAnnouncement` is not deployed, or no network | step 2; the function's logs in the Firebase console |
| «Το κλειδί του GitHub έχει λήξει ή δεν έχει δικαίωμα εγγραφής» | the token expired, was revoked, or is not for this repository or lacks **Contents: Read and write** | step 1 again, then `firebase functions:secrets:set GITHUB_PUBLISH_TOKEN --project semfe-alumni` and deploy |
| «Το αποθετήριο ή ο κλάδος … δεν βρέθηκε» | `PUBLISH_REPO` / `PUBLISH_BRANCH` is wrong, or the token does not reach that repository | step 2 |
| «Το GitHub είναι απασχολημένο» | someone pushed at the same moment four times in a row, or GitHub's rate limit | wait a minute and press again |
| «Οι σύνδεσμοι πρέπει να ξεκινούν με https://» | a link such as `[text](support/)`: a relative address would be wrong at the announcement's depth | write the whole address |
| «Μόνο οι διαχειριστές …» | the signed-in address is not a verified admin | sign in with an address of `ADMIN_EMAILS` |
| it was sent, but never appears, and the **publish** run in **Actions** is green | the site is not yet served from this repository: the switch is not finished | MOVE-TO-ORG.md, Part C ("Order" above) |
| it was sent, but never appears | the build failed: open **Actions** > **publish** in the repository and read the red step | fix the file in `_src/posts/`, the workflow rebuilds |

An announcement that was sent is a commit titled `Announcement: <slug>` on `main`.

**Visit statistics**: the page of a new announcement is counted as «other» on the
«Στατιστικά» page until the Cloud Functions are deployed again, because
`recordVisit` knows the site's pages from `functions/site-paths.json` as it was at
the last deploy. Deploy the functions now and then if the page-by-page figures
matter.

## Safety

* **Who may**: only a verified address in `ADMIN_EMAILS`, checked by the function
  from the sign-in token on every call. Hiding the button is only a courtesy.
* **What may be written**: Markdown only. `<` and `&` become plain characters
  (and `<!` is broken, so no `<!--if:…-->` condition of the page builder can be
  written), `{` and `}` become the full-width `｛ ｝` (Markdown strips markup from
  an image's alt text, so even `{*{post:x}*}` would otherwise join into a
  `{{placeholder}}`), and a code block is shown as text. So an announcement can
  carry no HTML, no script, no attribute and no placeholder or condition.
  Links must be absolute. The function and the tests run the text through the
  build's own steps, and the `publish` workflow builds and checks the site
  before keeping an announcement. Pictures are accepted by what they are (JPEG, PNG, WebP, GIF;
  never SVG), up to 8, 1.2 MB each and 6 MB together. The rules are
  `assets/js/announce-text.js`, which the function runs too (a copy in
  `functions/`, pinned by `node tools/check.mjs`), tested in
  `functions/test-announcements.js` with hostile texts.
* **The token**: a fine-grained token for one repository with only «Contents»,
  in Secret Manager, never sent to the browser or written in a message. The
  function never uses it for anything but the one commit.
* **Nothing is published by accident**: the editor asks for a confirmation that
  names the kind of announcement, because the members who chose it are e-mailed.
