# Vendored libraries

The page builder (`tools/build.mjs`) reads `_src/` files written as YAML front
matter + Markdown. It needs a Markdown renderer and a YAML parser, and the
repository deliberately has **no `npm install` step for the site build** (the
output is committed, and a fresh clone must be able to run
`node tools/build.mjs` at once). So the two libraries are committed here, as
the single-file ES-module bundles their authors publish for browsers, copied
unchanged from the npm packages:

| File | Library | Version | Licence | npm tarball integrity (sha512) |
|---|---|---|---|---|
| `markdown-it.esm.min.mjs` | [markdown-it](https://github.com/markdown-it/markdown-it) (CommonMark) | 15.0.2 | MIT, `markdown-it.LICENSE` | `q4IGxMv56jCqT4OCRCADBoDP3LO4MhmTXjFbphHPXs4g3j9Xg5RDnxqN8IF/3vIWEU+VCnUq+7JUg/cfy2E6Qw==` |
| `js-yaml.esm.min.mjs` | [js-yaml](https://github.com/nodeca/js-yaml) (YAML 1.2) | 5.4.2 | MIT, `js-yaml.LICENSE` | `m+aqu+LwO1O6sIopafj8HUVl5aawITwZQe/yHpMCKjaWBaA/d07B/QdMb3529REftiU+RMMHL3Vlsw3hON7vWg==` |

SHA-256 of the files as committed (`sha256sum tools/vendor/*.mjs`):

    85feb50fd6ce1b7c49acb02b0337eb622ecc4fc2ed4ae0dcbb8c084556d463b6  markdown-it.esm.min.mjs
    154ea2da9e53404fb206f19cb9ce6c3a9880295fa34b96e40855be7cbc02f082  js-yaml.esm.min.mjs

The files are `dist/browser/markdown-it.esm.min.mjs` and
`dist/browser/js-yaml.esm.min.mjs` of the tarballs. Each ends with a
`//# sourceMappingURL=` comment for a map file that is not committed; Node
ignores it.

`tools/check.mjs` fails when either file's checksum no longer matches the
table above, so a vendored file cannot change by accident.

## Updating

    cd "$(mktemp -d)"
    npm pack markdown-it@<version> js-yaml@<version>
    tar xzf markdown-it-<version>.tgz && cp package/dist/browser/markdown-it.esm.min.mjs <repo>/tools/vendor/
    # ...same for js-yaml, then update the versions, integrity and SHA-256 above
    node tools/build.mjs --check     # the generated pages must not change
    node tools/md-selftest.mjs       # the Markdown dialect still behaves

Nothing else in the repository imports these files: `tools/markdown.mjs` is the
only user.
