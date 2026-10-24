---
status: normative
scope:
  - releases
validation:
  - release.config.mjs
  - test/release.test.ts
  - .github/workflows/release.yml
---

# Releases

Release automation formats the changelog after generating it. Generated changelog
and version metadata must satisfy the repository's formatting and validation rules
before the release commit or publication. Checks of the earlier checkout do not
establish that the generated release is valid.

The prepared release must pass the CI checks, including a fresh build, before
committing generated files or publishing. The expected release version must match
both package and plugin versions, and its compatibility entry must match the
plugin's minimum Obsidian version.

All three BRAT assets (`main.js`, `manifest.json`, and `styles.css`) must exist and
be nonempty. The JavaScript bundle must parse. A failed check stops publication;
a release is considered delivered only after its published version and downloadable
assets have been verified.
