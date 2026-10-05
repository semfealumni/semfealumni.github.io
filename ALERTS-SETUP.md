# E-mail alerts and the RSS / Atom feeds: setup guide

## What members see

**Account page > «Ειδοποιήσεις με e-mail»** (also in the account menu). A member
with an application (pending or active) ticks the kinds of news they want:

| Kind | What is mailed | Where it comes from |
|---|---|---|
| Ανακοινώσεις του Συλλόγου | a new announcement | a post in `_src/posts/` with `category: Ανακοινώσεις` |
| Εκδηλώσεις και συναντήσεις | a new event or meet-up | a post with `category: Εκδηλώσεις` |
| Νέα του ιστότοπου | a site change | a «Τι νέο» entry, once an admin **approves** it |

The e-mails go to the member's confirmed sign-in e-mail. One e-mail per member
per run lists everything new of the kinds they chose. Each e-mail has a link
that stops all alerts with one button, and the mail programs that support it
show their own "unsubscribe" button too.

**So the category you give a post decides who is told about it.** A meet-up
or event: `Εκδηλώσεις`. Everything else from the board: `Ανακοινώσεις`.

The list of kinds is `assets/js/alert-topics.js`. A new kind is one more line
there and one more key in `alertTopics()` in `firestore.rules`
(`node tools/check.mjs` fails until both agree).

**Feeds** for feed readers, rebuilt with the site by `node tools/build.mjs`:

    https://semfealumni.gr/rss.xml     RSS 2.0
    https://semfealumni.gr/feed.xml    Atom
    https://semfealumni.gr/feed.json   JSON Feed (also what the e-mails read)

Every page names the first two in its `<head>`, so pasting
`https://semfealumni.gr/` into a feed reader finds them. The links are also at
the bottom of the «Ανακοινώσεις» page.

## Switching it on (10 minutes, once)

The e-mails use the mail settings the feedback e-mails already use
(`SMTP_USER`, `SMTP_PASS`, FEEDBACK-SETUP.md). Nothing new to set.

From the repository folder, on your computer:

    git pull
    cd functions
    npm install
    cd ..
    firebase deploy --only firestore:rules --project semfe-alumni
    firebase deploy --only functions --project semfe-alumni

**Count the functions in the output: there should be ten**, the two new ones
being `alertsMailer` and `alertsUnsubscribe` (the tenth, `publishAnnouncement`, is
the editor on the «Ανακοινώσεις» page: ANNOUNCE-SETUP.md; the deploy asks for its
GitHub token, and you can answer `none` until you set that up).

* `alertsMailer` runs by itself every 2 hours. It is the site's first
  *scheduled* function, so the first deploy switches on Google's **Cloud
  Scheduler** for the project. If the deploy stops with a message about Cloud
  Scheduler or an API being enabled, wait two minutes and run the same
  command again.
* Its **first run only records what is already published**: nobody gets the
  old announcements. Every later run mails only what is new.

**Check it.** Firebase console > Functions > `alertsMailer` > Logs. The first
run says `alerts: first run: N published item(s) recorded, nothing mailed`;
later runs say `nothing new` or how many e-mails went out. To run it at once
instead of waiting: Google Cloud console > **Cloud Scheduler** > the job
`firebase-schedule-alertsMailer-europe-west1` > **Force run**.

**Try it.** Tick «Νέα του ιστότοπου» on your own account page, then approve
an entry on «Τι νέο» that is waiting (for example «Ειδοποιήσεις με e-mail»).
Within two hours, or after a Force run, the e-mail arrives.

## Good to know

* **Nothing is mailed twice.** Firestore `alertState/ledger` remembers every
  announcement and «Τι νέο» entry ever seen. Editing a post, rewording an
  entry, or removing and restoring one does not send it again.
* **An announcement is mailed when it is live**, not when it is written: the
  function reads the site's own `feed.json`.
* **The admin page** shows how many members chose each kind, under the tiles.
* **Deleting an account** deletes its choice. **Merging two accounts** keeps
  every kind either of them chose.
* E-mail switched off (`SMTP_USER` set to `none`): nothing is marked as sent,
  so the news goes out once e-mail is on again.
