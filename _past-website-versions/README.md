# Past versions of the website

This folder keeps the earlier versions of the association's website, so nothing
that was ever published is lost. It starts with an underscore on purpose: GitHub
Pages (Jekyll) does not publish folders whose name begins with `_`, so nothing
in here is on the web, and nothing in here runs.

| Folder | What it is | Live from | Until |
|---|---|---|---|
| `mkdocs-material-site/` | the association's website written in Markdown with MkDocs Material (`docs/`, `mkdocs.yml`), exactly as this repository held it before the new site arrived | February 2024 (first commit 3 February 2024) | 1 October 2026 |

The history of these files is also in this repository's git log (the commits
before the new site was merged in). The finished pages of that site, as the old
workflow last built them, are in the branch `gh-pages` of this repository. It is
one commit and is **not** part of `main`'s history, so it is kept (see
`MOVE-TO-ORG.md`, Part C, A week later). The pages can also be rebuilt from these
files:

    cd _past-website-versions/mkdocs-material-site
    uv run mkdocs build            # writes the finished pages to public/ in that folder

Do not commit `public/` (the repository's `.gitignore` leaves it out).

The **original photos** (`mkdocs-material-site/docs/assets/pictures/`) exist only
here and in git history: the new site publishes re-encoded copies of them (in
`assets/img/`). So do not slim or delete the `docs/assets/` folder here without
checking.

## Looking at the old site again

    cd _past-website-versions/mkdocs-material-site
    uv run mkdocs serve            # then open http://localhost:8000/

(see its `README.md`; `uv` is installed from https://docs.astral.sh/uv/).

## Why its workflow is not in `.github/workflows/`

The old site was published by a GitHub workflow (`deploy-pages`) that rebuilt it
on every push to `main` and force-pushed the result to the `gh-pages` branch. Left
in `.github/workflows/` it would still do that, with every commit of the new site
as its trigger. It is kept as
`mkdocs-material-site/_workflows/deploy-pages.yml`, switched off.

## Adding another version

When the site is redesigned again, copy the old version of the pages and
anything that is not in git history by itself into a new folder here (for
example `_past-website-versions/site-2026-10/`) and add a row to the table.
