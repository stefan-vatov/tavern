# Tavern

Tavern is a local-first app window backed by an Obsidian vault. Its project boards,
task search, cross-project focus queue, and daily log live together in one Tavern
interface. Task content stays in ordinary Markdown notes.

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

## Fast task editing

Click a task's text to edit it. The same shortcuts work in projects, queues,
search results, and the daily log, including the task capture fields:

- **Ctrl+Enter** creates a sibling underneath and focuses it.
- **Shift+Enter** creates a nested subitem and focuses it.
- **Enter** leaves the text and focus unchanged.
- **Escape** cancels the editing session.

Leaving the editor saves your work. Blank rows disappear when they lose focus;
if a cleared parent has subitems, they move up one level. New blank drafts stay
in the interface until they have text, so abandoned entries leave no empty task
lines in the note. Right-click a task in Captain's Log, a project, or a queue
to **Delete item** while keeping its children, or choose **Delete tree** to
remove the whole group. The tree option appears when the task has subitems,
even if a filter hides them. For linked tasks, both actions also delete the
corresponding source and copies. Delete item preserves and promotes children;
Delete tree removes the whole linked group.
A failed save keeps the draft editable. If Tavern closes before a save fails,
a recovery dialog keeps the unsaved task text available to copy as Markdown.

## Daily Log

The split view keeps the selected queue or project beside **Captain's Log**.
Opening Tavern loads today's log using your local date, even if you last viewed
another day. Use the date controls to browse other days or return to **Today**.
If the selected day's note is missing, Tavern shows **No note** and **Create daily
log**; it never substitutes an older note or creates one automatically.

Daily notes live at `02_Daily_Log/Daily_Log/YYYY/MM/YYYY-MM-DD.md` by default.
Change the base folder in Tavern settings. Under **Daily log template**, click
**Choose** to select a Markdown template from your vault, and enable the
Templater plugin. **Create daily log** uses Templater to render that file into
the selected day's note. Creation waits for Templater; missing configuration or
template errors are shown without falling back to a basic note. Existing notes
keep their content and do not require Templater to read or edit.

The new file already has its `YYYY-MM-DD` title when Templater runs, so a
conditional `Untitled` rename branch will not run. Template functions keep their
normal meanings: `tp.file.title` is the selected date, while `tp.date.now()` is
the actual current date. Templates should leave the result at the configured
daily-note path; if a script moves it, Tavern reports the resulting path rather
than creating another note or undoing the script's changes.

After the template finishes, creating a new log moves unfinished work from the
previous calendar day's log into its `Plan` section. A whole task tree moves if
any task in it is incomplete, including completed items within that tree. Fully
completed trees stay in the previous note. When any tree carries forward, Tavern
removes the new template’s exact `- [ ] Task` placeholder; otherwise it keeps it. Task text, nested details, block IDs,
and links to projects and other copies stay intact; the moved tasks leave the
previous log. If that exact previous day has no note, Tavern does not search
older notes. Opening or creating an already existing log does not carry work again.

If carry-forward fails after the template is created, Tavern shows the error and
attempts to restore the transfer's note and link changes. The new template note
remains; Tavern does not automatically retry transfers into existing notes.

You can search, edit, check, add, reorder, and nest tasks in the log. Dragging within the log works like the project side: drop near a row's top
or bottom edge to reorder, or over its middle to the right to make a subitem.
Moving a parent carries its whole group. Tasks written directly in a daily note
can be checked and unchecked without belonging to a project or queue. Checking a task keeps the log and unfinished
entries in place while the queues update.

Drag a task's handle from the global or focus queue into the daily log to copy
it, including its nested tasks. Drag a parent to copy its whole group; nested
queue tasks cannot be dragged into the log separately. The source stays in its project. Tavern adds
standard Obsidian block IDs, such as `^tavern-a1b2`, to the linked task lines and
saves their relationships in plugin settings. Checking or unchecking either
copy updates the corresponding task in the other note, including changes made
in Obsidian's Markdown editor.

All task operations made in Tavern apply to the source and every linked copy:
text edits, deletion, moves, nesting, and reordering. A task tree is a linked
unit too: adding a subitem or nested group in any copy adds linked counterparts
throughout the tree. If a move destination or section is missing from another
linked note, Tavern creates its counterpart there. Tasks outside those linked
units keep their own content.

Completing a linked task moves its project source to `Done` and removes it from
the open queues. Unchecking reopens it in its current project section; it does
not restore a previous focus-queue selection. Keep the block IDs when editing
linked tasks. If a note or ID is missing or duplicated, Tavern reports the
problem instead of matching a task by its text.

## Development

### Background UI testing — default

Automated UI tests must not interrupt your normal work. On Linux, run the real
Obsidian app with its Ozone headless display backend and control it through CDP,
using a disposable vault and a separate profile. Opening Tavern, interacting
with it, and reloading the plugin then happen off your desktop, without visible
test windows or focus changes. Visible testing requires an explicit request;
headless startup failure must never silently fall back to your desktop.

Build test copies separately so a vault linked to this checkout does not
hot-reload while tests are being prepared:

```bash
export TAVERN_TEST_ROOT="$(mktemp -d /tmp/tavern-ui.XXXXXX)"
TAVERN_BUILD_OUTFILE="$TAVERN_TEST_ROOT/build/main.js" pnpm run build
```

That command leaves the live `main.js` untouched. Follow
[How to test Tavern locally in Obsidian](docs/local-testing.md) for fixture
setup, the headless launch command, real pointer/keyboard checks, reload and
window-reuse checks, and cleanup. Reuse the isolated test session while iterating.
Headless tests still exercise the actual rendered UI and Markdown writes;
native window-manager focus, placement, and desktop scaling need an explicitly
requested visible session.

### Interactive workbench — explicitly chosen

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

The release job checks the checkout, then generates `CHANGELOG.md` and updates
`package.json`, `manifest.json`, and `versions.json`. It formats the generated
changelog and runs `pnpm run check:ci` again on the prepared release, including a
fresh build. Before committing or publishing, `pnpm run release:verify` checks
that the version metadata agrees and that all three BRAT assets exist, are
nonempty, and include a JavaScript bundle that parses. A failure stops publication.
The release commit and GitHub release are created only after those checks pass.

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
