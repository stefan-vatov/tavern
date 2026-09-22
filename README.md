# Tavern

Tavern is a local-first app window backed by an Obsidian vault. Its project boards,
task search, and cross-project focus queue live together in one Tavern interface.
Task content stays in ordinary Markdown notes.

## Open Tavern

Click the dice ribbon icon or run **Tavern: Open** from Obsidian's command palette.
On desktop this opens a separate Tavern window; opening it again brings the same
window forward and preserves the current Tavern view. If that window is showing
a Markdown note instead, Open returns it to Tavern in the same window, including
after a plugin reload. Switch between the global queue and individual projects
in its sidebar. On mobile, Tavern opens in a tab.

Tavern runs inside Obsidian and shares its vault and plugin runtime. Obsidian must
remain running. Opening a project note in Obsidian keeps the Markdown editor;
**Tavern: Mark current note as project** marks that note and selects it in Tavern.
The **Tavern: Open task search** command opens search in the same app window.

External launchers can open the same window with a vault-specific URI:

```text
obsidian://tavern?vault=Your%20Vault%20Name
```

Replace the vault name with its URL-encoded name. Tavern must be installed and
enabled in that vault. Existing Tavern tabs are moved into the app window when
opened or restored, and legacy project-only views keep their selected project.

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

For isolated desktop UI testing, follow [How to test Tavern locally in Obsidian](docs/local-testing.md).

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
