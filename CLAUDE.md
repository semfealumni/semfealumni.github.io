# SEMFE Alumni website: repository conventions

The website of the Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ, served by GitHub Pages
from `main` at **https://www.stouras.com/semfealumni/** (a project site under
the owner's custom domain). Greek-language, plain HTML/CSS/JS, no framework.
Member sign-in uses Firebase; see `README.md` and `FIREBASE-SETUP.md`.

## Pages are generated

* Edit `_src/pages/*.html` and `_src/posts/*.html`, then run
  `node tools/build.mjs` and commit the regenerated HTML WITH the source.
  `node tools/check.mjs` fails when the two differ (CI runs it on every push).
* Header, footer, menu and page heads come from `tools/build.mjs`.
* Every page is `noindex` (`INDEXABLE = false` in `tools/build.mjs`) while
  semfealumni.gr is the official site. Flip it only when asked.
* Do **not** add a `.nojekyll` file: Jekyll keeps `_src/` off the web and
  `_config.yml` excludes the maintenance files.

## Sign-in and data

* Sign-in is OFF while `assets/js/config.js` holds `PASTE_` placeholders; the
  site then shows "opens soon" and never loads the Firebase SDK.
* `firestore.rules` is the gatekeeper (members/{uid}, directory/{uid},
  linkedinLinks/{sub}). `ADMIN_EMAILS` in config.js must equal the list in
  `isAdmin()`; check.mjs fails when they differ.
* LinkedIn sign-in goes through the Cloud Function in `functions/`
  (`LINKEDIN.mode: 'function'` in config.js).

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
    cd functions && npm test                  the LinkedIn Cloud Function, against fakes
    cd tools/rules-test && npm install && npm test   firestore.rules on the real emulator (needs Java)

Any change to the account, members or admin pages gets a scenario in
`tools/auth-flow.mjs`; any layout change must keep `tools/smoke.mjs` green.
