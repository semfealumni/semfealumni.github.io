# Moving the website into the GitHub organisation SEMFE Alumni

The site is published from **`semfealumni/semfealumni.github.io`** in the GitHub
organisation **SEMFE Alumni**, so that it does not depend on any one person's
account. It was built in `konstantinosStouras/semfealumni` and moved here with
its whole history. The association's earlier website, which used this
repository before, is kept in `_past-website-versions/mkdocs-material-site/`.

**Nothing changes for visitors or members:** the address is still
https://semfealumni.gr/, the sign-in, the database, the functions and the e-mails
are the same Firebase project. What changes is where the files live and which
GitHub account vouches for the domain.

## What moves and what stays

| | Before | After |
|---|---|---|
| The code | `konstantinosStouras/semfealumni` | `semfealumni/semfealumni.github.io` |
| GitHub Pages | published from that repository | published from `main`, root folder, of the organisation's repository |
| The domain is verified in | the account `konstantinosStouras` | the organisation `semfealumni` |
| `www.semfealumni.gr` is a CNAME to | `konstantinosstouras.github.io` | `semfealumni.github.io` |
| `semfealumni.gr` (A and AAAA records) | GitHub Pages | **unchanged** |
| Firebase project, functions, rules, domain list | `semfe-alumni` | **unchanged** |
| GitHub Actions secrets and variables | in the old repository | **to be created again** in the new one (Part B) |
| The private feedback log | `konstantinosStouras/semfealumni-feedback-log` | stays, unless you move it (Part D) |

## Part A: the code

The branch that does the whole merge is prepared: the old site's files moved
into `_past-website-versions/mkdocs-material-site/` (with its workflow switched
off), then the new site merged in with `git merge --allow-unrelated-histories`,
so both histories are kept, then the settings and documents that name the old
repository changed. It is a plain fast-forward of the organisation's `main`;
nothing is rewritten.

If Claude pushes it (the Claude GitHub App is installed on the organisation), it
is already done. Otherwise, on your computer:

    git clone https://github.com/semfealumni/semfealumni.github.io
    cd semfealumni.github.io
    git remote add prepared https://github.com/konstantinosStouras/semfealumni
    git fetch prepared move-to-org
    git merge --ff-only prepared/move-to-org
    git push origin main

(`--ff-only` refuses if `main` moved after the branch was prepared: then ask for it
to be prepared again.) **Pushing to `main` does not change the live site yet**:
the site is still published from the old place until Part C, step 4.

## Part B: settings of the new repository (before touching DNS)

On https://github.com/semfealumni/semfealumni.github.io :

1. **Settings > Actions > General > Workflow permissions**: **Read and write
   permissions**, Save. (`analytics`, `feedback` and `publish` commit with
   GitHub's own token.)
2. **Settings > Secrets and variables > Actions**:

   | Name | Kind | What |
   |---|---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | secret | the JSON key of a Firebase service account (Firebase console > Project settings > Service accounts > Generate new private key); used by `feedback` and `analytics` |
   | `FEEDBACK_LOG_TOKEN` | secret | the token that writes the private feedback log (FEEDBACK-SETUP.md) |
   | `FEEDBACK_LOG_REPO` | variable | `konstantinosStouras/semfealumni-feedback-log` (or wherever the log lives) |
   | `GA4_SERVICE_ACCOUNT` | secret, optional | a separate Google Analytics key (ANALYTICS-SETUP.md) |
   | `GA4_PROPERTY_ID` | variable, optional | `361541833` when not set |

   Secrets cannot be read back from the old repository, so paste them again from
   where you keep them, or make new ones as the guides say. A secret that is
   missing only switches that workflow's feature off; none of them breaks the site.
3. **Actions**: if GitHub shows a button asking to enable workflows, press it.

## Part C: the cutover (about 45 minutes; do it at a quiet hour)

The order matters: **a domain can be used by one repository at a time**, so it is
taken from the old place first and given to the new one straight away. During
steps 3 to 5 `semfealumni.gr` may show a GitHub "404 / site not found" page: it
is only minutes if you do not stop in the middle. The sign-in keeps working on
the pages that are loaded, because it does not depend on GitHub.

1. **Prove the domain to the organisation.** On the organisation's page:
   **Settings > Pages** (under "Code, planning, and automation") > **Add a
   domain** > `semfealumni.gr`. GitHub shows a TXT record: a name like
   `_github-pages-challenge-semfealumni.semfealumni.gr` and a code. (If GitHub
   says the domain is already verified in another account, remove it there
   first: your account's **Settings > Pages > Verified domains**.)
2. **papaki** (https://www.papaki.com): the domain's **Διαμόρφωση DNS > Επεξεργασία
   ζώνης DNS**: add that TXT record (type TXT, the name GitHub showed, the code,
   TTL 3600). Do **not** delete the old `_github-pages-challenge-konstantinosstouras`
   record yet. Wait about ten minutes, then press **Verify** at GitHub.
3. **Take the domain off the old repository.**
   https://github.com/konstantinosStouras/semfealumni > **Settings > Pages** >
   **Custom domain**: empty the box and **Save**.
4. **Give it to the new one.** https://github.com/semfealumni/semfealumni.github.io >
   **Settings > Pages** > **Build and deployment**: Source **Deploy from a
   branch**, Branch **`main`**, folder **`/ (root)`**, Save. Then **Custom
   domain**: `semfealumni.gr`, Save. (The repository's `CNAME` file already says
   so.) GitHub starts a "DNS check".
5. **papaki**: change the record `www.semfealumni.gr` CNAME from
   `konstantinosstouras.github.io` to **`semfealumni.github.io`**. The four A and
   four AAAA records of `semfealumni.gr` itself stay exactly as they are.
6. Wait for **"DNS check successful"** on the Pages settings (minutes), then tick
   **Enforce HTTPS**. GitHub first has to issue the certificate for the new
   owner: this can take up to an hour, and until the box can be ticked a browser
   may warn about the certificate. Do not worry, and do not change anything.
7. **Check it**:
   * https://semfealumni.gr/ and https://www.semfealumni.gr/ (the second goes to the first);
   * sign in with Google, open «Ανακοινώσεις» (the editor button for an admin),
     «Στατιστικά» and one old address such as https://semfealumni.gr/blog/2025/03/02/2025-taktiki-gs/;
   * from a clone: `node tools/migrate.mjs --verify https://semfealumni.gr/`.
8. **A week later**, when all is well: delete the old TXT record
   `_github-pages-challenge-konstantinosstouras` at papaki, **archive** (not delete)
   `konstantinosStouras/semfealumni`, and delete the branch `gh-pages` of the new
   repository (the old site's built pages; they are in git history otherwise
   unused).

**If something goes wrong** before step 8: give the domain back. In the old
repository **Settings > Pages > Custom domain** `semfealumni.gr`, and in papaki the
`www` CNAME back to `konstantinosstouras.github.io`. Its verification record is
still in place, so it comes back as it was.

## Part D: after the move

* **Announcements from the website**: `PUBLISH_REPO` must name the new repository
  (its default in `functions/index.js` already does) and the token must be one
  for it: ANNOUNCE-SETUP.md, step 1 with the **semfealumni** organisation as the
  resource owner, then `firebase deploy --only functions --project semfe-alumni`.
* **Who may write to the repository**: **Settings > Collaborators and teams**.
  Give the people who maintain the site **Write**; keep two or more **owners** of
  the organisation, so that no single person is needed.
* **Claude Code** (the assistant that maintains the site) works in the
  organisation's repository once the Claude GitHub App is installed on the
  organisation: https://github.com/apps/claude/installations/select_target
* **The private feedback log** (`konstantinosStouras/semfealumni-feedback-log`)
  holds members' e-mails and screenshots. If you want it under the organisation
  too: create a private repository there, copy the folders, point `FEEDBACK_LOG_REPO`
  and `FEEDBACK_LOG_TOKEN` at it (FEEDBACK-SETUP.md), and delete the old one.
* **Old links**: `konstantinosStouras.github.io/semfealumni/` stops answering once
  the old repository is archived; nothing public pointed there.
