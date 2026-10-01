# The «Στατιστικά» page: setup guide

The page `/analytics/` (menu «Ο Σύλλογος» > «Ο ιστότοπος» > «Στατιστικά», and
the footer) has two parts:

    Επισκεψιμότητα   how many visit, which pages, when, from which countries,
                     cities, universities and companies, how they find us,
                     on what device; four periods (30 days, 90 days,
                     12 months, everything)
                     -> data/analytics.json, rebuilt every morning by the
                        GitHub Action "analytics" (tools/build-analytics.mjs)
    Τα μέλη μας      anonymous statistics of the registered members: status,
                     direction, entry and graduation years, years of study,
                     gender, industry, employer, country, city, sign-ups
                     per month
                     -> Firestore publicStats/members, recounted by the
                        memberStats Cloud Function every time someone
                        registers or edits their details

The visits come from two counters, and each one adds figures on its own:

| Figure | Comes from |
|---|---|
| Visits and page views per day, most visited pages, devices, how people find us | the site's own counter, else Google Analytics |
| Hour of the day (Greek time) | the site's own counter |
| **Universities and companies** | the site's own counter (Google Analytics cannot see networks) |
| **Countries and cities**, the sites that send visitors | Google Analytics |

Nothing below is needed for the page to work: until a source is set up the
page says the measurements are about to start, and it never draws an empty
chart. Each step switches on one more part.

---

## 1. Deploy the rules and the two new Cloud Functions (10 minutes)

This switches on **the site's own counter** (universities, companies, pages,
hours) and **the members' statistics**.

From the repository folder, on your computer:

    git pull
    cd functions
    npm install
    cd ..
    firebase deploy --only firestore:rules --project semfe-alumni
    firebase deploy --only functions --project semfe-alumni

**Count the functions in the output: there should be seven.**

    linkedinSignIn, accounts, cleanupDeletedUser,
    feedbackCreated, feedbackUpdated,
    recordVisit, memberStats        <- the two new ones

* If the first deploy of `memberStats` fails with an **Eventarc** or
  **permission** message, wait 5 minutes and run the same functions deploy
  again. Google sets up the trigger's permissions in the background the
  first time, as it did for the feedback e-mails.
* If it stops at "Loading and analyzing source code" with
  `Timeout after 10000ms`, run `set FUNCTIONS_DISCOVERY_TIMEOUT=60` (Windows)
  and deploy again.
* The deploy prints the address of `recordVisit`. It usually ends in
  `.a.run.app`. Both that address and
  `https://europe-west1-semfe-alumni.cloudfunctions.net/recordVisit` (the one
  already in `assets/js/config.js`, `ANALYTICS.visitUrl`) reach the same
  function, so nothing needs changing.

**Check it works.** Open https://semfealumni.gr/ in a normal (not private)
window and click through two or three pages. Then, in the Firebase console >
Firestore Database, a collection `siteVisits` appears with today's date as a
document, holding counters (`pv`, `seen`, `pages`, …). The page shows these
figures from the next morning's update.

The privacy page already describes this counter. The visitor's address is
never stored or logged; only the name of a university or company is kept,
and only when the network belongs to one.

## 2. Show the members' statistics right away (2 minutes)

The `memberStats` function recounts at the next registration or profile
change. To fill the page now, run the daily workflow once by hand:

* GitHub > the `semfealumni` repository > **Actions** > **analytics** >
  **Run workflow** > **Run workflow**.

It uses the `FIREBASE_SERVICE_ACCOUNT` secret you already added for the
feedback (FEEDBACK-SETUP.md, step 3). In the run's log, the line
`members: N registered, M active -> publicStats/members` says it worked.
Refresh https://semfealumni.gr/analytics/#meli.

A question appears only when at least **5** people have answered it, and a
group of fewer than **3** people is merged into «Λοιπά», so with only a few
registrations most questions say "not enough answers yet". That is on
purpose: it is what keeps the statistics anonymous.

## 3. Google Analytics 4 (20 minutes)

This adds **countries, cities and the sites that send visitors**, and counts
visitors whose browser blocks the site's own counter. It runs **without
cookies** (`assets/js/visit.js`): nothing is stored on the visitor's device,
so no cookie banner is needed. Do not turn cookies on without adding one.

### 3a. Create the property

1. Go to https://analytics.google.com/ and sign in with the association's
   Google account (or yours; you can add others later).
2. **Admin** (gear, bottom left) > **Create** > **Property**.
3. Property name: `SEMFE Alumni website`. Time zone: **Greece**. Currency:
   **Euro**. Next, answer the two business questions any way you like, Create.
4. Platform: **Web**. Website URL: `https://semfealumni.gr`. Stream name:
   `semfealumni.gr`. Leave "Enhanced measurement" on. **Create stream**.
5. The stream page shows the **Measurement ID**, `G-XXXXXXXXXX`. It is not a
   secret. Either send it to me, or put it in `assets/js/config.js`
   (`ANALYTICS: { ga4: 'G-XXXXXXXXXX', … }`), run `node tools/build.mjs` and
   `node tools/check.mjs`, and push.
6. **Admin** > **Data collection and modification** > **Data collection**:
   leave **Google signals** OFF.

From the moment the ID is on the site, Google Analytics counts visits.

### 3b. Let the daily workflow read it

The workflow reads the figures back through Google's **Data API**, as a
"service account" (a robot user) that may only view the property.

1. **Turn on the API.** https://console.cloud.google.com/ > choose the project
   **semfe-alumni** at the top > **APIs & Services** > **Library** > search
   **Google Analytics Data API** > **Enable**.
2. **Create the robot.** **IAM & Admin** > **Service accounts** >
   **Create service account**. Name: `ga4-reader`. **Create and continue**.
   Give it **no role** (skip), **Done**.
3. **Its key.** Click `ga4-reader@semfe-alumni.iam.gserviceaccount.com` >
   **Keys** > **Add key** > **Create new key** > **JSON** > **Create**. A
   `.json` file downloads. Keep it private and do not send it to anyone.
4. **Give it view access to the property.** Back in Google Analytics:
   **Admin** > **Property access management** (under Property) > **+** >
   **Add users**. E-mail: `ga4-reader@semfe-alumni.iam.gserviceaccount.com`.
   Untick "Notify new users by email". Role: **Viewer**. **Add**.
5. **The property number.** **Admin** > **Property details**: copy the
   **Property ID** (digits only, e.g. `512345678`; NOT the `G-…` ID).
6. **Give both to GitHub.** The `semfealumni` repository > **Settings** >
   **Secrets and variables** > **Actions**:
   * **Secrets** tab > **New repository secret**. Name `GA4_SERVICE_ACCOUNT`,
     value: open the downloaded `.json` file in Notepad, select all, copy,
     paste. **Add secret**.
   * **Variables** tab > **New repository variable**. Name
     `GA4_PROPERTY_ID`, value: the digits from step 5. **Add variable**.
7. **Test.** **Actions** > **analytics** > **Run workflow**, and tick
   **"Only report what each source gives"**. The log should say
   `ga4: N day(s)`. Run it once more without the tick to update the page.

The workflow then runs by itself every morning (06:37 Greek time in summer).

## How to read the figures

* **Visits, not people.** Neither counter stores anything on the visitor's
  device, so neither can tell a returning visitor from a new one. A visit is
  one reading session (all the pages read in one browser tab).
* **Universities and companies are a sample.** A network is named only when
  it is registered to the organisation itself: a campus or an office
  network. Visits from home or a phone go through an internet provider and
  are not attributed to anyone. The page says how many visits it could
  place. A company appears only with **at least two** visits in the period.
* **Greek universities and research centres** are named in Greek (the list
  is `KNOWN` in `functions/netorg.js`); others by their registered name, or
  their web domain. An internet provider, a cloud or a security proxy
  wrongly shown as a company is fixed by adding its name to `PROVIDER_NAME`
  in that file.
* **The daily figures stop at yesterday**, which is complete.

## If something looks wrong

* **Actions > analytics > Run workflow** with **"Only report what each source
  gives"** prints what each source answers, and writes nothing.
* A source that is set up but does not answer leaves the page as it was (a
  half-written file would be a blank dashboard); the run turns red and says
  why.
* Offline checks: `node tools/build-analytics.mjs --selftest` and
  `cd functions && npm test`.
