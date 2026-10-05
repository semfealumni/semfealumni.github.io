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
* **«Δημοσίευση»**: it asks "Να δημοσιευτεί τώρα;", then sends it, and shows
  the new page's address as a link.
* **«Επεξεργασία»**: right after sending, and under every announcement on its own
  page (for an admin), to correct it later in the same box (below).
* **«Διαγραφή»**: beside «Επεξεργασία», to remove an announcement (below). It
  always asks first.

The text is kept on the admin's own computer while it is being written, so a
closed tab does not lose it.

## What happens when «Δημοσίευση» is pressed

    the browser ──► Cloud Function publishAnnouncement ──► GitHub (one commit)
                                                              │
                          _src/posts/2026-10-05-kopi-pitas.md │ + the pictures in
                                                              │   assets/img/posts/
                                                              ▼
                          workflow "publish": node tools/build.mjs ──► the page, the
                          home page cards, the feeds, the sitemap ──► the site, from
                          the same workflow (step 5 below)

1. The function checks that the caller is a **verified admin address** (the same
   list as everywhere else, `ADMIN_EMAILS`), cleans the text (no HTML, no
   `{{placeholders}}`), checks every picture by its first bytes and its size, and
   writes the announcement as an ordinary `_src/posts/YYYY-MM-DD-slug.md`
   (see `_src/README.md`) in **one commit** with its pictures.
2. The workflow `.github/workflows/publish.yml` builds the pages from it,
   commits them, and **publishes the site itself**: the announcement is online
   usually **20 to 40 seconds** after the button (this needs Pages' source set to
   "GitHub Actions", step 5; before that GitHub publishes it on its own, about
   two minutes later). The editor shows the address as a link at once, then asks
   the real page every few seconds and says **«✓ … είναι online»** the moment it
   is the version just saved; it offers «Επεξεργασία» and «Διαγραφή».
3. The e-mail alerts pick it up from `feed.json` within two hours like any
   other announcement.

**To correct an announcement afterwards**, press «Επεξεργασία»: on the panel
right after «Δημοσίευση», or under the announcement on its own page (an admin
sees the button there; it opens `blog/?edit=<its file>`). It opens in the same
editor, with its text, kind, card picture and pictures; «Αποθήκευση αλλαγών»
sends it back as ONE commit titled `Announcement: <slug>` like a new one, so the
same checks and the same take-back apply. What an edit keeps and what it does not:

* the **address** stays the same, whatever the new title;
* the published **pictures** keep their files; a new one is added after them, and
  one taken out of the text stays in `assets/img/posts/` (delete it there if you
  want it gone);
* **nobody is e-mailed again**: the alerts already know the address;
* if somebody else changed the announcement after you opened it, nothing is
  saved and the editor says so (open it again and redo the change).

Only announcements written in the editor open there. One written by hand on
GitHub (the older ones) would lose its layout, so the editor says so and links
to its file on github.com instead. The function checks this by building the file
again from what it read: anything that does not come back identical is not
offered. **Editing needs the functions deployed after 5 October 2026**
(`firebase deploy --only functions --project semfe-alumni`); until then the
editor says exactly that.

**To delete an announcement**, press «Διαγραφή»: under the announcement on its
own page (an admin sees it beside «Επεξεργασία»; it opens `blog/?delete=<its
file>`), in the edit form, or on the panel right after sending. Nothing is
deleted until you answer the question that names it. Then its file and its own
pictures (`assets/img/posts/<date>-<slug>-N.*`) go in ONE commit titled
`Announcement: delete <slug>`, and the build removes its page, its card and its
lines in the feeds. Its card leaves the list on the page at once, and the panel
says the moment the page answers "not found". Any announcement can be deleted,
the older ones written by hand too. Two things it cannot undo: **e-mails already
sent** stay sent, and a reader who saved the page keeps it. If somebody changed
the announcement after you opened it, nothing is deleted and the editor says so.
**Deleting needs the functions deployed after this change**
(`firebase deploy --only functions --project semfe-alumni`); until then the
editor says exactly that.

**To bring a deleted announcement back**, revert that commit. In GitHub Desktop:
**History**, right-click `Announcement: delete <slug>` > **Revert changes in
commit** > **Push origin**. Or in a terminal, in the repository folder:

    git pull
    git log --oneline --grep "Announcement: delete"
    git revert <the commit's number>
    git push

The page, its card and its pictures come back at the same address within a
minute. It is an ordinary file in the repository, so deleting its file in
`_src/posts/` on github.com works too (delete its pictures in
`assets/img/posts/` as well).

**If the build stops** (it should not: the text is made safe, and the checks run on
the built site) the workflow **takes the announcement back**: a second commit
`Revert "Announcement: …"` removes it, so that one bad announcement can never hold
back the next ones. Nobody is e-mailed about it. The editor then shows
«Δεν εμφανίστηκε ακόμα»; look at **Actions > publish** to see why.

## Where an announcement appears, and who is e-mailed

The editor commits into the repository named by `PUBLISH_REPO`, which is
`semfealumni/semfealumni.github.io`, and since 5 October 2026 https://semfealumni.gr/
is served from that repository. So an announcement is on the site within a
minute of the button, and **it is real**: the members who chose that kind of alert
are e-mailed about it within two hours. A **test announcement** therefore reaches
people too: make one only if you accept that. Delete it at once if it was a test
(«Διαγραφή» under it, see above); an e-mail already sent cannot be recalled.

If an announcement is sent, the **publish** run is green and the page still does
not appear, check **Settings > Pages** of the repository: the source must be
**GitHub Actions** (step 5; or, the older way, "Deploy from a branch", `main`,
folder `/ (root)`), and the custom domain `semfealumni.gr` (MOVE-TO-ORG.md, Part C).

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
the old repository (`konstantinosStouras/semfealumni`, deleted on 5 October
2026, so a pull from it fails), point it at the organisation:

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

Open https://semfealumni.gr/blog/ signed in as an admin, press **«Νέα
ανακοίνωση»**. With no notice about the setup you are ready: write a title and a
line, tick **Ανακοινώσεις**, **Δημοσίευση**, **Ναι**. Within a minute the editor
says «✓ Η ανακοίνωση είναι online» and links to it. **Delete the test
announcement** right away («Διαγραφή» on its page), because members who chose
the alert get an e-mail about it at the next run of the alerts (every two hours).

### 5. Publishing in seconds: Pages' source (one setting, once)

Until this is set, GitHub publishes the site by itself after every push, with a
build of its own that queues twice: about two minutes. The `publish` workflow can
publish the site straight away instead, in the same run that builds it:

1. The repository > **Settings** > **Pages**.
2. **Build and deployment** > **Source**: choose **GitHub Actions**.
3. GitHub may suggest a ready-made workflow ("Static HTML", "Jekyll"):
   **ignore it**, do not add one. The repository's own `publish` workflow is the
   one that publishes.
4. Nothing else changes: the custom domain `semfealumni.gr` and **Enforce HTTPS**
   stay as they are.

Check: push anything, or press «Δημοσίευση»: **Actions** > **publish** > the run
has a green step **Publish the site**, and the run's page shows the site's
address. Before the switch the same run says, in a note, that GitHub publishes
the branch itself; it reads the setting on every run, so nothing in the
repository has to change when you switch. **To go back**: Source **Deploy from a
branch**, branch `main`, folder `/ (root)`, **Save**.

What it publishes is exactly what GitHub's own build published: every file of
the repository except names starting with `_` or `.` and the files listed under
`exclude:` in `_config.yml` (`tools/site-files.mjs`; `node tools/site-files.mjs
--list` prints them). The `analytics` workflow starts the `publish` workflow after
it commits new figures, so the «Στατιστικά» page is published too.

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
| it was sent, but never appears, and the **publish** run in **Actions** is green | the site is not served from this repository, or the run's **Publish the site** step was skipped because **Settings > Pages** is not "GitHub Actions" and GitHub's own run failed | step 5; MOVE-TO-ORG.md, Part C |
| «Η διαγραφή χρειάζεται την ενημερωμένη υπηρεσία δημοσίευσης» | the functions were deployed before «Διαγραφή» existed | `firebase deploy --only functions --project semfe-alumni` |
| «… άλλαξε από άλλον στο μεταξύ, και δεν διαγράφηκε» | somebody edited it after you opened it | open it again and decide again |
| it was sent, but never appears | the build failed: open **Actions** > **publish** in the repository and read the red step | fix the file in `_src/posts/`, the workflow rebuilds |

An announcement that was sent is a commit titled `Announcement: <slug>` on `main`
(an edit too); a deleted one is `Announcement: delete <slug>`.

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
