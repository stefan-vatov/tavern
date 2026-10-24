---
status: normative
scope:
  - daily log
  - linked tasks
validation:
  - test/daily-note.test.ts
  - test/daily-log-store.test.ts
  - test/daily-log-service.test.ts
  - test/project-note.test.ts
  - test/view.test.ts
related:
  - ./persistence.md
  - ./project-workflow.md
  - ../decisions/2026-10-24-linked-daily-tasks.md
---

# Daily log

## Daily-note selection and ownership

Tavern presents a daily log beside the selected queue or project. Opening the
view selects the current local day, regardless of the last day viewed. Date
navigation selects that day's note; it does not assign dates to tasks or
schedule work.

The daily-log folder is configurable. Within it, notes use
`YYYY/MM/YYYY-MM-DD.md`. A missing selected note produces a **No note** state
and a **Create daily log** action. Tavern must not fall back to an older note
or create a note merely by reading or selecting a day. Read failures are
errors, not evidence that a note is absent.

Explicit creation supplies a plain Markdown note with the day's heading and
`General`, `Plan`, and `Notes` headings, creating parent folders as needed.
Creation must not overwrite an existing note. Daily-task changes preserve
surrounding note content and operate on the current Markdown. Blank task
creation and blank task-text edits are rejected. Task reordering and nesting
carry the task's nested tree.

## Copies and stable references

Dragging a task from the global or focus queue into the daily log copies its
task tree. A queue-to-log drag starts from a top-level task; a nested queue
task cannot be copied separately. A parent carries its entire nested group.
The project source remains in place. Each copied task has its own
standard Obsidian block ID, and each source task receives an ID if it does not
already have one. A plugin-owned registry relates source and copy endpoints
by note path and block ID. Copying an already linked task retains its source
identity and adds a distinct copy endpoint.

The block ID, rather than task text or line position, identifies a linked task.
Editing or reordering a task while retaining its ID preserves that identity.
Task text is independently editable in each note; only checkbox state is
synchronized. Markdown remains usable without Tavern.

## Checkbox synchronization and failures

Standalone daily tasks remain editable and checkable without a project or queue
entry. Their checkbox changes write only to the daily note. Only registered task
links invoke cross-note synchronization.

Checkbox updates must not blank or flash the log or replace it with a loading
state while notes and project queues refresh. Preserve the selected day, filter,
scroll position, and unfinished task entry during checkbox updates.

Checking or unchecking a linked source or copy propagates the same state to
its source and all registered copies. This applies to Tavern actions and
checkbox edits in Obsidian's Markdown editor. Each nested task has its own
link; checking a parent does not implicitly check its children.

Completing the project source uses the existing project workflow: it moves
to `Done` and leaves the open global and focus queues. Unchecking changes the
project checkbox in place, making the task available as open work again. It
does not restore a previous section or focus-queue selection.

A missing note, missing block ID, or ambiguous ID is a visible synchronization
failure. Tavern must not guess an endpoint from matching text. Note rename
events update stored endpoint paths. Linked writes use current note content,
but synchronization across multiple notes is not an atomic transaction;
a failed write can leave a partially applied operation. No conflict-resolution,
retry, or recovery policy for concurrent external edits or Obsidian Sync is
established by this feature. The persistence page retains those policy gaps.
