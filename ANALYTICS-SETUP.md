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

From the repository folder, on your computer (the folder must pull from the
organisation: `git remote -v` shows `semfealumni/semfealumni.github.io` for
`origin`, ANNOUNCE-SETUP.md, step 2):

    git pull
    cd functions
    npm install
    cd ..
    firebase deploy --only firestore:rules --project semfe-alumni
    firebase deploy --only functions --project semfe-alumni

**Count the functions in the output: there should be ten.**

    linkedinSignIn, accounts, cleanupDeletedUser,
    feedbackCreated, feedbackUpdated,
    recordVisit, memberStats,       <- the two new ones
    alertsMailer, alertsUnsubscribe, publishAnnouncement

(The last three belong to ALERTS-SETUP.md and ANNOUNCE-SETUP.md; the same deploy
brings all ten.)

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

* GitHub > the `semfealumni/semfealumni.github.io` repository > **Actions** >
  **analytics** > **Run workflow** > **Run workflow**.

It uses the `FIREBASE_SERVICE_ACCOUNT` secret of this repository, the one the
feedback needs too (FEEDBACK-SETUP.md, step 3; MOVE-TO-ORG.md, Part B puts it in
the repository). In the run's log, the line
`members: N registered, M active -> publicStats/members` says it worked.
Refresh https://semfealumni.gr/analytics/#meli.

A question appears only when at least **5** people have answered it, and a
group of fewer than **3** people is merged into «Λοιπά», so with only a few
registrations most questions say "not enough answers yet". That is on
purpose: it is what keeps the statistics anonymous.

## 3. Google Analytics 4 (10 minutes)

This adds **countries, cities and the sites that send visitors**, counts
visitors whose browser blocks the site's own counter, and brings in **the old
site's visits from the first day it was measured**. It runs **without
cookies** (`assets/js/visit.js`): nothing is stored on the visitor's device,
so no cookie banner is needed. Do not turn cookies on without adding one.

### 3a. The property (done)

We use the property the old site already reported to:

    Account      Semfe Alumni (47632222)
    Property     SEMFE Alumni - GA4, Property ID 361541833
    Stream       SEMFE Alumni - GA4, http://www.semfealumni.gr
    Measurement  G-8SSJKNQNR1   (in assets/js/config.js, ANALYTICS.ga4)

The old site lived at the same address with the same page addresses, so its
history and ours line up page for page. The page reads the property from its
first day: «Από την αρχή» goes back as far as this property does. (Google
deleted the older "Universal Analytics" data in 2024, so nothing before this
property can be brought back.)

The other property in the account, "semfe-alumni" (556889763), is not used.
You can leave it alone.

Two settings to check in this property, once:

1. **Admin** > **Property details** > **Reporting time zone**: **Greece**.
   The page counts days in Greek time.
2. **Admin** > **Data collection and modification** > **Data collection**:
   **Google signals** OFF.

### 3b. Let the daily workflow read it

The workflow reads the figures back through Google's **Data API**. It uses the
Firebase key that is already in GitHub (`FIREBASE_SERVICE_ACCOUNT`, from
FEEDBACK-SETUP.md), and the property number is already in the workflow. So
there is **no new key and nothing to add in GitHub**. Two things, both in
Google's websites:

1. **Turn on the API.** Open
   https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=semfe-alumni
   and press **Enable**.
2. **Let the Firebase key view the property.**
   * Its e-mail: Firebase console > the gear > **Project settings** >
     **Service accounts**. It looks like
     `firebase-adminsdk-xxxxx@semfe-alumni.iam.gserviceaccount.com`. Copy it.
   * Google Analytics > **Admin** > **Property access management** (under
     Property) > **+** > **Add users**. Paste the e-mail, untick "Notify new
     users by email", Role: **Viewer**, **Add**.
3. **Test.** GitHub > **Actions** > **analytics** > **Run workflow**, tick
   **"Only report what each source gives"**. The log should say
   `ga4: N day(s), from <the first day>`. Then run it once more without the
   tick, to update the page.

Until it answers, the run only shows a yellow **warning** naming Google's
reason ("has not been used in project … or it is disabled" means step 1;
"does not have sufficient permissions" means step 2) and still publishes the
rest. Once Google Analytics has answered once, a later refusal stops the
update instead, so a bad day never blanks the countries on the page.

**A separate key instead (optional).** If you would rather not let the
Firebase key read Analytics: Google Cloud > **IAM & Admin** > **Service
accounts** > **Create service account** (`ga4-reader`, no role) > **Keys** >
**Add key** > **JSON**; give its e-mail **Viewer** as in step 2; and add the
whole `.json` file as the GitHub secret `GA4_SERVICE_ACCOUNT` of the
`semfealumni/semfealumni.github.io` repository (Settings > Secrets and
variables > Actions). When that secret exists it is used instead.
Never send the file to anyone. A different property would go in the GitHub
variable `GA4_PROPERTY_ID` (digits only).

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
* **Long periods are averaged.** «12 μήνες» is drawn by week and «Από την
  αρχή» by month, as the average visits per day in each, so a month that has
  only just started never looks like a fall. «Τα νούμερα» under the chart
  lists the totals.
* **A gap is not zero.** A month or more with nothing measured (the old
  site's Google Analytics stopped on 8 February 2024; the new site's
  counters started on 1 October 2026) is shown as a break in the line, with
  a sentence naming the dates, and a period that falls wholly inside it
  says "no measurements" instead of "0 visits".
* **Two counters, one line.** Up to the day the site's own counter started,
  the visits per day are Google Analytics' (the old site's, then ours); from
  that day on, the counter's. The card says where it changes.

## If something looks wrong

* **Actions > analytics > Run workflow** with **"Only report what each source
  gives"** prints what each source answers, and writes nothing.
* A source that is set up but does not answer leaves the page as it was (a
  half-written file would be a blank dashboard); the run turns red and says
  why.
* Offline checks: `node tools/build-analytics.mjs --selftest` and
  `cd functions && npm test`.
