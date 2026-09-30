# The «Σχόλια και προβλήματα» page: setup guide

The page `/feedback/` lets a signed-in member send a message with up to 5
screenshots. Each message gets a ticket number (`SEMFE-260930-AB23`).

    member sends a message            -> Firestore feedback/<ticket>
      -> the admins get an e-mail copy, screenshots attached      (Cloud Function)
      -> the member gets a confirmation with the ticket number    (Cloud Function)
    every 30 minutes                  -> every ticket is copied to a PRIVATE
                                         GitHub repository                (GitHub Action)
    an admin closes the ticket        -> the member gets the answer by e-mail
      (admin page «Κλείσιμο με απάντηση», or a file in _feedback-resolutions/)

The page itself works as soon as the new rules are published (step 1): tickets
are stored and the admin page shows them. Each further step adds one piece.

## 1. Publish the rules (2 minutes)

From the repository folder:

    firebase deploy --only firestore:rules --project semfe-alumni

or paste `firestore.rules` into Firebase console > Firestore > Rules > Publish.

Test: sign in, open «Σχόλια και προβλήματα» from the account menu, send a
message. The ticket number appears; the admin page shows the message under
«Σχόλια μελών».

## 2. The e-mails (10 minutes)

The Cloud Function sends mail through a Gmail account, with an **app
password** (a separate 16-letter password just for this; your normal password
is never used or stored).

1. Pick the account that sends the mail, for example `gradsemfe@gmail.com`.
   It needs **2-Step Verification** switched on
   (https://myaccount.google.com/security).
2. Open https://myaccount.google.com/apppasswords (signed in as that account),
   name it `SEMFE site`, **Create**, and copy the 16 letters.
3. In a terminal, in the repository folder:

       firebase functions:secrets:set SMTP_USER --project semfe-alumni

   type the sending address (e.g. `gradsemfe@gmail.com`), Enter. Then:

       firebase functions:secrets:set SMTP_PASS --project semfe-alumni

   paste the 16 letters (no spaces), Enter. Both are stored in Google Secret
   Manager, never in the repository.
4. Deploy the functions:

       cd functions
       npm install
       cd ..
       firebase deploy --only functions --project semfe-alumni

   It asks for four new settings; press Enter to keep each default:
   * `SITE_URL`: `https://www.stouras.com/semfealumni/` (the links in e-mails)
   * `FEEDBACK_TO`: `kstouras@gmail.com` (who gets each new message; several
     addresses separated by commas are fine)
   * `SMTP_HOST`: `smtp.gmail.com`, `SMTP_PORT`: `465`

   The first deploy of these two functions may stop with a message about
   "Eventarc" or "permissions for the Pub/Sub service agent": Google is still
   switching things on for the project. Wait 5 minutes and run the same
   command again.

   (If you want to deploy the other functions before setting up e-mail, run
   `firebase deploy --only functions:linkedinSignIn,functions:accounts,functions:cleanupDeletedUser --project semfe-alumni`.
   The full deploy needs the two secrets to exist.)

Test: send a message. Within a minute the admins get a copy (Reply-To is the
sender) and the sender a confirmation. On the admin page, «Κλείσιμο με
απάντηση» with a short text: the sender gets that text by e-mail. If a mail
fails, the admin page shows why on the ticket (for example a wrong app
password: `EAUTH`).

Only the sender's own sign-in address is ever written to, and only when it is
confirmed: the rules pin both, so the page cannot be used to e-mail anyone
else.

## 3. The private log repository (10 minutes)

This copies every ticket (text, sender, screenshots, answer) into a private
GitHub repository, so they can be read, and acted on, from GitHub, including
by Claude.

1. **Create the repository**: https://github.com/new, owner
   `konstantinosStouras`, name `semfealumni-feedback-log`, **Private**, tick
   "Add a README file", **Create repository**.
2. **A token that may write to it**: https://github.com/settings/personal-access-tokens/new
   * Token name: `semfealumni feedback log`; Expiration: 1 year (put a reminder
     in your calendar to renew it).
   * Repository access: **Only select repositories** > `semfealumni-feedback-log`.
   * Permissions > Repository permissions > **Contents: Read and write**.
   * **Generate token**, copy it.
3. **A key that may read Firestore**: Firebase console > ⚙ Project settings >
   **Service accounts** > **Generate new private key** > Generate key. A JSON
   file downloads. Open it in a text editor and copy all of it.
4. In the `semfealumni` repository on GitHub: **Settings > Secrets and
   variables > Actions**:
   * **New repository secret** `FIREBASE_SERVICE_ACCOUNT`: paste the whole JSON.
   * **New repository secret** `FEEDBACK_LOG_TOKEN`: paste the token.
   * Tab **Variables** > **New repository variable** `FEEDBACK_LOG_REPO`:
     `konstantinosStouras/semfealumni-feedback-log`.
   Then delete the downloaded JSON file from your computer.
5. **Actions** tab > **feedback** > **Run workflow**. After a minute the log
   repository has `feedback/INDEX.md` and one folder per ticket.

Keep the log repository PRIVATE: it holds names, e-mail addresses and
screenshots. Secret scanning and push protection (Settings > Code security) are
worth switching on for both repositories.

## 4. Closing a ticket from the repository

Add `_feedback-resolutions/<TICKET>.md` (format in the README of that folder)
and merge it to `main`. The workflow closes the ticket within minutes and the
sender gets the text by e-mail. Never write the sender's name or e-mail in that
folder: the repository is public.

**The usual way to act on feedback with Claude:** "look at feedback
SEMFE-260930-AB23". Claude reads it in the log repository (add it to the
session with `add repo konstantinosStouras/semfealumni-feedback-log`), fixes
the site, and adds the resolution file in the same change; the sender's e-mail
goes out when it is merged.

## What is stored

    feedback/{ticket}    the message: sender's account id, name, sign-in e-mail
                         (and whether it is confirmed), kind, text, the page it
                         was about, up to 5 screenshots, the browser, status,
                         the answer. Readable by the sender and the admins.
                         Deleted when the sender deletes their account.

Offline checks: `cd functions && npm test` (the e-mails),
`node tools/feedback-sync.mjs --selftest` (the resolution files and the log),
`cd tools/rules-test && npm test` (who may read and write).
