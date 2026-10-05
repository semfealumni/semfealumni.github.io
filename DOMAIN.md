# The domain semfealumni.gr: where it lives and what keeps it working

The site is served by GitHub Pages from this repository
(`semfealumni/semfealumni.github.io`) at **https://semfealumni.gr/** (since
1 October 2026; in this organisation's repository since the move in `MOVE-TO-ORG.md`). Three things keep it there:

1. the **`CNAME`** file in this repository (written by `tools/build.mjs`);
2. the **DNS records** at papaki, the registrar (below);
3. the domain being **verified** in the GitHub organisation `semfealumni`,
   through the TXT record below. GitHub re-checks it from time to time: if the
   record is deleted, the domain stops being verified and another GitHub
   account could claim it.

## Where to change things

* **papaki** (https://www.papaki.com, the association's account): Πίνακας
  ελέγχου > semfealumni.gr > **Διαμόρφωση DNS** > **Επεξεργασία ζώνης DNS**.
  Leave «Διαχείριση nameservers» alone (it must stay `dns1.papaki.gr`,
  `dns2.papaki.gr`), and do not use «Ανακατεύθυνση» (it would send the domain
  to papaki's own servers instead of GitHub).
* **GitHub, the verification:** the organisation's page > Settings > **Pages** >
  Verified domains > semfealumni.gr.
* **GitHub, the site:** this repository > Settings > **Pages** > Custom domain
  `semfealumni.gr`, «Enforce HTTPS» ticked.

## The DNS records (all at papaki)

| Name | Type | Value | Why |
|---|---|---|---|
| `semfealumni.gr` | NS | `dns1.papaki.gr`, `dns2.papaki.gr` | papaki answers for the domain (do not change) |
| `semfealumni.gr` | A | `185.199.108.153` | GitHub Pages |
| `semfealumni.gr` | A | `185.199.109.153` | GitHub Pages |
| `semfealumni.gr` | A | `185.199.110.153` | GitHub Pages |
| `semfealumni.gr` | A | `185.199.111.153` | GitHub Pages |
| `semfealumni.gr` | AAAA | `2606:50c0:8000::153` | GitHub Pages (IPv6) |
| `semfealumni.gr` | AAAA | `2606:50c0:8001::153` | GitHub Pages (IPv6) |
| `semfealumni.gr` | AAAA | `2606:50c0:8002::153` | GitHub Pages (IPv6) |
| `semfealumni.gr` | AAAA | `2606:50c0:8003::153` | GitHub Pages (IPv6) |
| `www.semfealumni.gr` | CNAME | `semfealumni.github.io` | www forwards to semfealumni.gr |
| `_github-pages-challenge-semfealumni.semfealumni.gr` | TXT | `7d5f8d17905547418d153d0d83fb96` (the code GitHub shows under the organisation's Settings > Pages > Verified domains; added at papaki on 5 October 2026) | **keeps the domain verified: never delete** |
| `_github-pages-challenge-konstantinosstouras.semfealumni.gr` | TXT | `a6cf7a889ca6a1f58955428cd298d1` | the earlier verification, in the account `konstantinosStouras`: delete it a week after the cutover (`MOVE-TO-ORG.md`, Part C, A week later) |

TTL: 1 hour (3600) for all. papaki shows the TXT value in quotes; that is how
DNS writes text, the quotes are not part of the code.

**The TXT code is not a secret.** Anyone can read it from the public DNS, so
keeping it in this public repository is safe. It only proves to GitHub that
whoever controls the domain's DNS also controls the GitHub account.

## If something goes wrong

* **The TXT record was deleted or changed:** add it again exactly as above. If
  GitHub has meanwhile dropped the verification, GitHub > Settings > Pages >
  semfealumni.gr shows the record it expects (or remove the domain there, add
  it again and use the new code), then press **Verify**.
* **The site shows a GitHub 404 page:** check that the `CNAME` file is still in
  this repository and that Settings > Pages shows `semfealumni.gr`.
* **The domain is moving to another registrar:** copy every record above into
  the new one BEFORE switching the nameservers, the TXT record included.

## Check it from anywhere

    nslookup -type=TXT _github-pages-challenge-semfealumni.semfealumni.gr
    nslookup -type=A semfealumni.gr

or in a browser:
https://dns.google/resolve?name=_github-pages-challenge-semfealumni.semfealumni.gr&type=TXT

`node tools/migrate.mjs --verify https://semfealumni.gr/` checks the pages,
HTTPS and the www forwarding.
