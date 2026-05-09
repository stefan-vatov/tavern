# Tavern

Tavern is a local-first Obsidian project management plugin. Project notes marked
with Tavern frontmatter are rendered in a custom project board where tasks can be
moved between sections, completed into `Done`, searched across projects, and
collected into a focused cross-project queue.

## Project Notes

Tavern treats a markdown note as a project when its frontmatter contains:

```yaml
---
tavern: project
---
```

The parser supports arbitrary `##` sections. Sections such as `Backlog`,
`In Progress`, `On Hold`, `Done`, and `Notes & Decisions` work as normal
sections, with `Done` receiving completed tasks automatically.

By default the project board scans `04_Projects`. Change the scanned folders in
Tavern settings with a comma-separated list.

## Development

From this directory:

```bash
pnpm install
pnpm run dev
```

The workbench vault lives at `../test-vault`. The plugin is symlinked into:

```text
../test-vault/.obsidian/plugins/tavern
```

Open `../test-vault` in Obsidian and enable Tavern under **Settings -> Community plugins**.

The test vault also has the developer-only
[Hot Reload](https://github.com/pjeby/hot-reload) plugin installed and enabled.
Keep `pnpm run dev` running while Obsidian is open; when `main.js` or
`styles.css` changes, Hot Reload reloads Tavern automatically. If Obsidian still
shows stale UI, run **Reload app without saving** once from the command palette.

## Scripts

- `pnpm run dev`: watch-builds `src/main.ts` to `main.js`.
- `pnpm run build`: type-checks and builds production output.
- `pnpm run test:ci`: runs Vitest with 85% global coverage thresholds.
- `pnpm run lint:ci`: runs type-aware Oxlint and formatting checks.
- `pnpm run knip:ci`: checks for unused files, dependencies, and exports.
- `pnpm run test:mutation`: runs the 85% Stryker mutation gate.
- `pnpm run check`: runs build, coverage, linting, Knip, and mutation gates.

## Installation

### BRAT

Tavern can be installed with
[BRAT](https://github.com/TfTHacker/obsidian42-brat) while it is outside the
official Obsidian community plugin directory.

1. Install and enable BRAT in Obsidian.
2. Run **BRAT: Add a beta plugin for testing** from the command palette.
3. Add this repository:

```text
https://github.com/stefan-vatov/tavern
```

BRAT installs the latest GitHub release and keeps it updated when new Tavern
releases are published.

### Manual

Download the latest release assets and put them in:

```text
<vault>/.obsidian/plugins/tavern/
```

The required files are:

- `manifest.json`
- `main.js`
- `styles.css`

Then reload Obsidian and enable Tavern under **Settings -> Community plugins**.

## Releases

Releases are automated with semantic-release on pushes to `main`.
Conventional commits decide the next version:

- `fix: ...` publishes a patch release.
- `feat: ...` publishes a minor release.
- A breaking change publishes a major release.

The release job runs `pnpm run check`, bumps `package.json`, `manifest.json`,
and `versions.json`, builds `main.js`, writes `CHANGELOG.md`, creates a GitHub
release, and attaches the BRAT/Obsidian assets individually.

Run this locally from a clone whose release branch already exists on GitHub to
see what semantic-release would do without publishing:

```bash
pnpm run release:dry-run
```

## Release Artifacts

Obsidian releases need these files attached individually:

- `manifest.json`
- `main.js`
- `styles.css`

Version bumps should keep `package.json`, `manifest.json`, and `versions.json` aligned.
