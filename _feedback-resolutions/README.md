# Closing a feedback ticket from the repository

Every message sent from the site's «Σχόλια και προβλήματα» page gets a ticket
number, like `SEMFE-260930-AB23`. To close one and tell the sender what was
done, add a file here named after the ticket:

    _feedback-resolutions/SEMFE-260930-AB23.md

with this content:

    ---
    ticket: SEMFE-260930-AB23
    url: https://semfealumni.gr/account/
    ---
    Διορθώσαμε το κουμπί «Αποστολή» στο κινητό. Δοκιμάστε ξανά και πείτε μας
    αν δουλεύει.

* `ticket:` must match the file name.
* `url:` is optional: a page where the sender can see the fix (an https address
  on this site, `semfealumni.gr`; `node tools/feedback-sync.mjs --scan` checks it).
* The text below the `---` is e-mailed to the sender **as written**, in Greek,
  plain text. Keep it short and friendly: what was wrong, what changed.

After the change reaches `main`, `.github/workflows/feedback.yml` closes the
ticket within minutes, and the feedback Cloud Function e-mails the sender (when
their address is confirmed; otherwise they see the answer on the page).

Rules:

* **This repository is public. Never write the sender's name or e-mail
  here.** The tool refuses any file that carries an e-mail address; the
  sender is looked up by ticket number.
* Files stay here as the record of what was fixed. An unchanged file is never
  applied twice. **Editing** a file closes the ticket again with the new text
  and e-mails it again, so fix typos before merging.
* An admin can also close a ticket from the admin page («Κλείσιμο με
  απάντηση»); if they reopen one that a file closed, it stays open until the
  file is edited.

Check the files offline with `node tools/feedback-sync.mjs --scan`.
