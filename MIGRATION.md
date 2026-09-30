# Moving the site to semfealumni.gr

Today this site is a preview at **https://www.stouras.com/semfealumni/**, beside
the association's current site at **https://semfealumni.gr/** (served by
GitHub Pages from the association's own repository,
`semfealumni/semfealumni.github.io`). When the new site is ready, it takes over
semfealumni.gr. The move is built to take one short session.

Everything that depends on the address reads it from ONE setting, `siteUrl` in
`assets/js/config.js`: every page link is relative, and the build writes the
canonical / share tags, the sitemap, `CNAME` and `robots.txt` from it. The
tool `tools/migrate.mjs` does the repository's part and checks the outside
parts:

    node tools/migrate.mjs --plan          every change and every outside step, with exact values
    node tools/migrate.mjs --rehearse      the whole site switched in a temporary copy and tested there
    node tools/migrate.mjs --prep-check    do the Cloud Functions already accept the new address?
    node tools/migrate.mjs --apply         the switch itself (then commit and push)
    node tools/migrate.mjs --verify        after the switch: the live site, HTTPS, the old addresses

(All take the new address as an optional argument; the default is
`https://semfealumni.gr/`.)

## Where things stand (checked 30 Sept 2026)

* `semfealumni.gr` already points at GitHub Pages (the four `185.199.10x.153`
  addresses). **No DNS change is needed for it.**
* `www.semfealumni.gr` is a CNAME to `semfealumni.github.io` (the
  association's account). It changes to `konstantinosstouras.github.io` on the
  day, unless this repository is first moved into the association's
  organisation (then it stays as it is).
* The old site's pages all exist here under the same addresses. Its five extra
  addresses (the blog's year archives and its two category pages) have small
  forwarding pages here, and its PDFs and pictures (`assets/documents/…`,
  `assets/pictures/…`, `assets/logos/…`) are forwarded by the not-found page
  to where they live now. So links people have saved keep working.
* `node tools/migrate.mjs --rehearse` passes: the whole site, built for
  `https://semfealumni.gr/`, passes every check and every page test served
  from the root of a domain.

## Before the move (any time; nothing visible changes)

1. **Firebase console > Authentication > Settings > Authorized domains**: add
   `semfealumni.gr` and `www.semfealumni.gr`. Keep `stouras.com` and
   `www.stouras.com` for now.
2. **LinkedIn developer app > Auth > Authorized redirect URLs**: add
   `https://semfealumni.gr/auth/linkedin/` (keep the old one).
3. **`functions/.env.semfe-alumni`** (on the computer that deploys): change
   these two lines so sign-in works on both addresses during the move:

       ALLOWED_ORIGINS=https://stouras.com,https://www.stouras.com,https://semfealumni.gr,https://www.semfealumni.gr
       LINKEDIN_REDIRECT_URIS=https://www.stouras.com/semfealumni/auth/linkedin/,https://semfealumni.gr/auth/linkedin/

   then `firebase deploy --only functions --project semfe-alumni`.
4. `node tools/migrate.mjs --prep-check`: every line says "accepts".
5. **Who holds the domain on GitHub.** GitHub lets one repository use a
   custom domain at a time. On the day, the association's repository gives it
   up first (its Settings > Pages > Custom domain > Remove). If the
   `semfealumni` organisation has **verified** the domain (Organisation
   settings > Pages > Verified domains), only its own repositories may use it:
   then move this repository into the organisation first (this repository's
   Settings > General > Danger zone > Transfer). Its Actions secrets and
   variables are not guaranteed to move: re-check them after a transfer.
6. Decide whether the new site should be found by search engines from day one.
   `--apply` allows it (it is the official site from then on); add
   `--keep-noindex` to keep the pages hidden a little longer.

## On the day (about 30 minutes, most of it waiting for the certificate)

1. `node tools/migrate.mjs --apply`. It sets `siteUrl`, allows search engines,
   rebuilds (which writes `CNAME` = `semfealumni.gr` and `robots.txt`),
   redraws the share pictures and runs the checks. Look at `og-image.jpg` and
   `share-square.jpg`, update the address in `README.md` and `CLAUDE.md`,
   commit and push.
2. The association's repository: Settings > Pages > Custom domain > **Remove**.
3. This repository: Settings > Pages > Custom domain: `semfealumni.gr` >
   **Save** (the pushed `CNAME` file usually fills it in by itself).
4. DNS at the `.gr` registrar: `www.semfealumni.gr  CNAME  konstantinosstouras.github.io.`
   (skip after a transfer to the organisation).
5. When GitHub says the certificate is ready: tick **Enforce HTTPS**.
6. `functions/.env.semfe-alumni`: `SITE_URL=https://semfealumni.gr/` (the
   links in the feedback e-mails), then deploy the functions again.
7. `node tools/migrate.mjs --verify`: the pages, HTTPS, `www` forwarding, the
   old addresses, and the functions.

Members notice nothing but the address: their accounts, applications and
tickets live in Firebase, not at an address. They sign in again once on the
new address (browsers keep a sign-in per address).

**If something goes wrong:** in the association's repository, put the custom
domain back (its old site returns within minutes), and in this one run
`node tools/migrate.mjs --apply https://www.stouras.com/semfealumni/
--keep-noindex` and push (that removes `CNAME` again). The preview is back
where it was.

## After

* A few weeks later: remove the old address from Authorized domains, the
  LinkedIn redirect list and the two `.env` lines, and deploy the functions.
* Google Search Console: add `https://semfealumni.gr/` and submit
  `https://semfealumni.gr/sitemap.xml`.
* Optional: the LinkedIn app's privacy link and the Google sign-in consent
  screen's home page and privacy links, to the new address.
* The old preview address: GitHub normally forwards
  `www.stouras.com/semfealumni/…` to the project's own domain once it has one;
  `--verify` says whether it does. Nothing depends on it either way.
