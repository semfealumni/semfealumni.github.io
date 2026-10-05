# Moving the website into the GitHub organisation SEMFE Alumni

The site's code lives in **`semfealumni/semfealumni.github.io`** in the GitHub
organisation **SEMFE Alumni**, so that it does not depend on any one person's
account. It was built in `konstantinosStouras/semfealumni` and moved here with
its whole history. The association's earlier website, which used this
repository before, is kept in `_past-website-versions/mkdocs-material-site/`.

> **State (5 October 2026):** the code is here (Part A is done), but
> **https://semfealumni.gr/ is still served by `konstantinosStouras/semfealumni`**
> until Part C is finished. Delete this note, and the same note in `DOMAIN.md`,
> `README.md` and `CLAUDE.md`, in Part C, On the day, step 8.

**Nothing changes for visitors or members:** the address is still
https://semfealumni.gr/, the sign-in, the database, the functions and the e-mails
are the same Firebase project. What changes is where the files live and which
GitHub account vouches for the domain.

## What moves and what stays

| | Before | After |
|---|---|---|
| The code | `konstantinosStouras/semfealumni` | `semfealumni/semfealumni.github.io` (done) |
| GitHub Pages | published from that repository | published from `main`, root folder, of the organisation's repository |
| The domain is verified in | the account `konstantinosStouras` | the organisation `semfealumni` |
| `www.semfealumni.gr` is a CNAME to | `konstantinosstouras.github.io` | `semfealumni.github.io` |
| `semfealumni.gr` (A and AAAA records) | GitHub Pages | **unchanged** |
| Firebase project, functions, rules, domain list | `semfe-alumni` | **unchanged** |
| GitHub Actions secrets and variables | in the old repository | **to be created again** in the new one (Part B) |
| The private feedback log | `konstantinosStouras/semfealumni-feedback-log` | `semfealumni/semfealumni-feedback-log` (Part D) |

## Part A: the code (done)

Done on 5 October 2026: `main` of the organisation's repository holds the old
site's files moved into `_past-website-versions/mkdocs-material-site/` (with its
workflow switched off), the new site merged in with
`git merge --allow-unrelated-histories` (so both histories are kept), and the
settings and documents that named the old repository changed. Its first push
started the workflows `checks`, `publish` and `feedback` there. All three ended
green and committed nothing, because without their secrets they only read, build
and print a notice.

**Pushing to `main` does not change the live site.** The site is still published
from the old place until Part C, On the day, step 4.

## Part B: settings of the new repository (before the day)

On https://github.com/semfealumni/semfealumni.github.io :

1. **Settings > Actions > General > Workflow permissions**: **Read and write
   permissions**, Save. (The workflows `analytics` and `publish` ask for the
   write permission themselves, so this is a safety net: if an organisation
   policy keeps it read-only, publishing still works.)
2. **Settings > Secrets and variables > Actions**:

   | Name | Kind | What |
   |---|---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | secret | the JSON key of a Firebase service account (Firebase console > Project settings > Service accounts > Generate new private key); used by `feedback` and `analytics` |
   | `FEEDBACK_LOG_TOKEN` | secret | the token that writes the private feedback log: make it now, as in Part D, "The private feedback log", steps 1 to 3 (FEEDBACK-SETUP.md, step 3) |
   | `FEEDBACK_LOG_REPO` | variable | `semfealumni/semfealumni-feedback-log` |
   | `GA4_SERVICE_ACCOUNT` | secret, optional | a separate Google Analytics key (ANALYTICS-SETUP.md) |
   | `GA4_PROPERTY_ID` | variable, optional | `361541833` when not set |

   Secrets cannot be read back from the old repository, so paste them again from
   where you keep them, or make new ones as the guides say.

   **Do this before the day, not after.** Without `FIREBASE_SERVICE_ACCOUNT` the
   workflows `feedback` and `analytics` finish green while doing nothing, so after
   the switch the «Στατιστικά» figures would freeze and feedback tickets would stop
   being closed and copied, with nothing red anywhere. Once the secrets are in, run
   both once by hand (**Actions** > **analytics** > **Run workflow**, then
   **feedback**) and check that the steps "Install firebase-admin" and "Check out
   the private log" are no longer skipped.

   Until the old repository's automation is switched off (Part C, On the day, step 5) both
   repositories run `feedback` and `analytics` with the same key. That is safe,
   with one exception: **do not edit an existing file in
   `_feedback-resolutions/` in either repository meanwhile** (the two copies
   would keep overwriting each other and the sender would be e-mailed again each
   time). New files are fine.

## Part C: the switch

**Why the order matters.** A domain can be used by one repository at a time. The
domain is verified in your personal account today. GitHub refuses to verify it for
the organisation while your account still holds it, and **the moment the
organisation's Verify succeeds, GitHub takes the domain away from the old
repository**. So the short outage starts at that press, not later. From then until
the new repository has the domain and its certificate, `semfealumni.gr` may show a
GitHub "404 / site not found" page or a certificate warning: minutes if you go
straight on, up to an hour for the certificate (GitHub says up to 24 hours).
The sign-in keeps working on pages that are already loaded, because it does not
depend on GitHub.

### Before the day (nothing visible changes)

1. **Check that nobody pushed to the old repository** since the move was
   prepared: https://github.com/konstantinosStouras/semfealumni/commits/main
   must show `30c9fd3` at the top, or only commits called "data: refresh the
   Στατιστικά figures" after it. Anything else must be copied over first.
2. **Ask the organisation for the proof.** https://github.com/organizations/semfealumni/settings/pages >
   **Add a domain** > `semfealumni.gr`. GitHub shows a TXT record: a name like
   `_github-pages-challenge-semfealumni.semfealumni.gr` and a code. Do **not**
   press Verify yet. (If GitHub refuses to add the domain because your personal account has it
   verified, do "On the day" step 2 first: deleting your own verification does not
   take the site down, only the organisation's Verify does. Then come back to
   this step.)
3. **papaki** (https://www.papaki.com): the domain's **Διαμόρφωση DNS >
   Επεξεργασία ζώνης DNS**: add that TXT record (type TXT, the name GitHub showed,
   the code, TTL 3600). Do **not** delete the old
   `_github-pages-challenge-konstantinosstouras` record. Then check from outside:
   https://dns.google/resolve?name=_github-pages-challenge-semfealumni.semfealumni.gr&type=TXT
   must show the code. It can take 30 minutes; GitHub says up to 24 hours. A
   resolver that asked before the record existed may keep answering "no record" for
   up to 30 minutes.
4. **papaki**: change the record `www.semfealumni.gr` CNAME from
   `konstantinosstouras.github.io` to **`semfealumni.github.io`**. Visitors notice
   nothing: both are GitHub Pages servers, which tell sites apart by the address
   typed, not by the CNAME. The four A and four AAAA records of `semfealumni.gr`
   itself stay exactly as they are. (The old repository's Pages page may now warn
   about `www`; ignore it.)
5. **Part B**, including the two test runs.
6. **Check what the new site would announce.** The e-mail alerts read the live
   `feed.json` and mail every announcement they have not seen before to the
   members who chose that kind, within two hours. After the switch the live
   feed is the new repository's, so anything only the new one holds is mailed as
   news. Compare https://semfealumni.gr/feed.json (today) with `feed.json` in the
   new repository: the lists of `items` must be the same. (Both test announcements made on 5 October 2026 were deleted again; if a
   test announcement shows up as the difference, delete its `.md` file in
   `_src/posts/` and any picture it brought in `assets/img/posts/` in the new
   repository first; ANNOUNCE-SETUP.md, "Order".) Do not make new announcements before the switch.

### On the day (about 45 minutes; a quiet hour)

1. Open the dns.google link of "Before the day" step 3 once more: it must still
   show the code. Check the old repository's `main` once more, and the two feeds
   ("Before the day" step 6).
2. **Let go of the domain in your personal account.** https://github.com/settings/pages >
   **Verified domains** > `semfealumni.gr` > **Delete**. (The DNS record at papaki
   stays: never delete it yet.)
3. **Verify it for the organisation.** https://github.com/organizations/semfealumni/settings/pages >
   `semfealumni.gr` > **Verify**. **The old site loses the domain here.** Go
   straight on to step 4.
4. **Give it to the new repository.** https://github.com/semfealumni/semfealumni.github.io >
   **Settings > Pages** > **Build and deployment**: Source **Deploy from a
   branch**, Branch **`main`**, folder **`/ (root)`**, Save. Then **Custom
   domain**: `semfealumni.gr`, Save. (The repository's `CNAME` file already says
   so.) GitHub starts a "DNS check" and a "pages build and deployment" run.
   If GitHub answers that the domain is already taken, do the first half of
   step 5 now (empty the custom domain of the old repository, Save), then try
   again.
   Note: until now the organisation's own address `semfealumni.github.io` showed
   the old MkDocs site from the `gh-pages` branch. Once the source is `main` and
   the custom domain is set, GitHub forwards that address to
   `https://semfealumni.gr/` with the same paths.
5. **Switch the old repository's automation off.**
   https://github.com/konstantinosStouras/semfealumni > **Settings > Pages**:
   if it still shows the custom domain, empty the box and **Save**. Then
   **Settings > Actions > General** > **Disable actions**, Save. (Its `feedback`
   and `analytics` workflows would otherwise keep running beside the new ones.)
6. Wait for **"DNS check successful"** on the new repository's Pages settings
   (minutes), then tick **Enforce HTTPS**. GitHub first has to issue the
   certificate for the new owner: usually minutes, up to an hour, GitHub says up
   to 24 hours. If the box is still grey after about 30 minutes, press **Remove**
   next to the custom domain, type `semfealumni.gr` again and **Save**: that
   restarts the certificate request. Change nothing else.
7. **Check it**:
   * https://semfealumni.gr/ and https://www.semfealumni.gr/ (the second goes to the first);
   * **it is really the new repository that serves it:** the **Actions** tab of
     the new repository shows a green "pages build and deployment" run for `main`
     made after step 4, and `curl -sI https://semfealumni.github.io/` answers
     `301` with `location: https://semfealumni.gr/` (before the switch it
     answers `200` with the old MkDocs site);
   * sign in with Google, open «Ανακοινώσεις» (the editor button for an admin),
     «Στατιστικά» and one old address such as https://semfealumni.gr/blog/2025/03/02/2025-taktiki-gs/;
   * `node tools/migrate.mjs --verify https://semfealumni.gr/` from a clone. It
     checks that the site works, not which repository serves it: it also passes
     before the switch.
8. **Write it down.** Put the TXT code from the organisation's page into
   `DOMAIN.md` (the row for `_github-pages-challenge-semfealumni`), delete the
   "State" notes in this file, `DOMAIN.md`, `README.md` and `CLAUDE.md`, commit and
   push. (Claude can do this: give it the code.)

### A week later, when all is well

* **papaki**: delete the old TXT record `_github-pages-challenge-konstantinosstouras`.
* **The old repository `konstantinosStouras/semfealumni`**: archiving does **not**
  stop a Pages site, so first **Settings > Pages**, the three dots next to the
  live address, **Unpublish site**. Delete its Actions secrets
  `FIREBASE_SERVICE_ACCOUNT`, `FEEDBACK_LOG_TOKEN` and any `GA4_*` (an archived
  repository keeps them). Then **archive** it (not delete). After that
  `konstantinosStouras.github.io/semfealumni/` stops answering; nothing public
  pointed there.
* **Keep the branch `gh-pages` of the new repository.** It holds the finished
  pages of the old site (`_past-website-versions/README.md` says so) and is not
  part of `main`'s history. If you ever want it gone, keep a copy first:
  `git tag past-mkdocs-site origin/gh-pages && git push origin past-mkdocs-site`.
  Its `CNAME` file names `semfealumni.gr`: never make it a Pages source again.

### If something goes wrong: give the domain back

Before the week is over, in this order. Start at the first step that applies:
if the Verify press (On the day, step 3) failed, the old site still serves and
the new repository has nothing yet. Check the TXT record and press Verify again,
or, to give up, do only step 3 (it puts back the personal verification that
step 2 of the day deleted).

1. New repository: **Settings > Pages > Custom domain > Remove**.
2. Organisation: **Settings > Pages > Verified domains > `semfealumni.gr` >
   Delete**. (Its DNS record at papaki stays: never delete it.)
3. Your personal account: https://github.com/settings/pages > **Add a domain** >
   `semfealumni.gr`, then **Verify** (the record
   `_github-pages-challenge-konstantinosstouras` is still at papaki).
4. Old repository: **Settings > Actions > General** > allow actions again;
   **Settings > Pages > Custom domain** `semfealumni.gr`, Save.
5. papaki: the `www` CNAME back to `konstantinosstouras.github.io`.
6. Wait for "DNS check successful", tick **Enforce HTTPS** (its certificate has
   to be issued again: up to an hour of warnings).

## Part D: after the move

* **Announcements from the website**: the editor commits into `PUBLISH_REPO`
  (default `semfealumni/semfealumni.github.io`, `functions/index.js`), so an
  announcement written **before Part C is finished** is built in the new repository,
  does not appear on the site, and appears (and is e-mailed to the members who
  chose that kind) the moment the switch is done. The token must be one for the
  organisation's repository: ANNOUNCE-SETUP.md, step 1 with the **semfealumni**
  organisation as the resource owner, then
  `firebase deploy --only functions --project semfe-alumni`. The folder you deploy
  from must pull from the organisation: `git remote -v` shows
  `semfealumni/semfealumni.github.io` (otherwise
  `git remote set-url origin https://github.com/semfealumni/semfealumni.github.io`).
* **Who may write to the repository**: **Settings > Collaborators and teams**.
  Give the people who maintain the site **Write**; keep two or more **owners** of
  the organisation, so that no single person is needed.
* **Claude Code** (the assistant that maintains the site) works in the
  organisation's repository once the Claude GitHub App is installed on the
  organisation and given the repository:
  https://github.com/apps/claude/installations/select_target
* **The private feedback log** holds members' e-mails and screenshots, so it is
  private. It now lives in the organisation as
  **`semfealumni/semfealumni-feedback-log`**. Making it independent of the old
  account, in this order (steps 1 to 4 belong to Part B, so do them **before
  the day**; only step 5 waits, until after "A week later"):
  1. The organisation's copy was created as a **fork** of the personal one.
     **Deleting a private repository also deletes its private forks**, so cut it
     loose first: its **Settings > General > Danger Zone > Leave fork network**.
     The log itself is rebuilt from the database on every run (one snapshot
     commit, replaced each time), so nothing is lost either way.
  2. Make a fine-grained token (ANNOUNCE-SETUP.md step 1, with a different
     name such as `SEMFE feedback log`): resource owner **semfealumni**, only
     the repository `semfealumni-feedback-log`, **Contents: Read and write**.
  3. In `semfealumni.github.io` (Part B): the secret `FEEDBACK_LOG_TOKEN` and the
     variable `FEEDBACK_LOG_REPO` = `semfealumni/semfealumni-feedback-log`.
  4. Run the workflow `feedback` by hand (this is the `feedback` test run of
     Part B); the org log shows a new "Feedback tickets (a snapshot…)" commit.
  5. Only then delete the personal repository
     `konstantinosStouras/semfealumni-feedback-log`, after checking that the
     organisation's copy no longer says "forked from" under its name.
* **Old links**: see "A week later": archiving alone does not unpublish a Pages
  site.
