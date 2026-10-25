---
status: normative
scope:
  - daily log
  - linked tasks
validation:
  - test/daily-note.test.ts
  - test/daily-note-creator.test.ts
  - test/settings.test.ts
  - test/main.test.ts
  - test/daily-log-store.test.ts
  - test/daily-log-service.test.ts
  - test/project-note.test.ts
  - test/view.test.ts
related:
  - ../decisions/2026-10-25-daily-log-template.md
  - ./persistence.md
  - ./project-workflow.md
  - ../decisions/2026-10-24-linked-daily-tasks.md
  - ../decisions/2026-10-25-linked-task-operations.md
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

Explicit creation requires an enabled Templater plugin and a vault Markdown
template selected in Tavern settings. Tavern invokes Templater's creation API
and awaits its result, creating required parent folders. It must not recreate
Templater's interpreter or fall back to a basic note. Missing configuration,
unavailable creation API, failed rendering, and missing output are visible
errors, visible in Tavern even when background vault events refresh the log.
Existing notes must not be overwritten and remain usable without
Templater. Tavern requests creation without opening or revealing the note.

The target has the selected day's `YYYY-MM-DD` title before the template runs;
Templater date functions retain their ordinary current-date semantics. A
conditional rename for `Untitled` titles therefore does not execute. If a
template moves the result away from the expected daily-note path, report the
actual and expected paths; do not silently create a second note or reverse
arbitrary script effects. Tavern does not promise to roll back template scripts
or await independent asynchronous callbacks they schedule.

Daily-task changes preserve surrounding note content and operate on the current
Markdown. Blank task
creation is rejected. Keyboard entry and cleared-row cleanup follow the
[shared task-editing contract](task-editing.md). Task reordering and nesting
carry the task's nested tree.

Daily tasks use the same drag-handle gestures as project tasks: the upper and
lower row edges place a task before or after the target; the middle area to the
right nests it beneath the target. The nesting drop zone follows the target's
visible indentation. A child drop must produce a child even when the note mixes
tabs and spaces, preserving the existing children's indentation and the moved
tree's relative nesting. Before/after drops adopt the target's sibling level.
A task cannot be moved inside its own descendants.
Linked trees cannot be copied beneath themselves or their descendant
counterparts; a separate sibling copy remains valid.

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
Tavern treats linked endpoints as representations of the same task. Markdown
remains usable without Tavern.

## Linked units and Tavern operations

Every task operation performed in Tavern affects the source and every linked
copy. This includes text edits, checking and unchecking, item/tree deletion,
adding subitems or nested groups, moving, nesting, and reordering. A standalone
task is one unit; a parent and its task tree are also a unit. Additions inside a
linked tree acquire distinct endpoint block IDs and links, and appear in every
counterpart tree. Operations may start from any endpoint, including a daily copy.

Delete item removes the corresponding row everywhere and promotes surviving
children. Delete tree removes the selected group and its linked counterparts.
Removing references is part of deletion; it must not leave links pointing at
deleted task lines. Tasks outside the affected units and surrounding note
content remain intact.

A structural move resolves destinations by linked identity, not matching text.
If a destination task, required ancestor, or section is absent in another linked
note, Tavern creates the matching destination there and links task counterparts.
Moving or reordering a parent carries its complete tree.

Capturing a standalone task without a linked anchor does not invent peers in
other notes. Queue selection and focus-queue ordering remain plugin-owned view
state; removing a queue selection is distinct from deleting the task.

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

Registered endpoints must be validated before a linked Tavern operation writes
notes. A missing note, missing block ID, or ambiguous ID is a visible
synchronization failure. Tavern must not guess an endpoint from matching text. Note rename
events update stored endpoint paths. Linked writes use current note content. Tavern prepares its note and reference
changes together; failed settings saves must precede any note changes, and a
failed note write triggers attempts to restore affected notes and references.
Rollback failures remain visible. Synchronization across multiple notes is not
an atomic transaction; failed writes or rollback can leave partial changes. No conflict-resolution,
retry, or recovery policy for concurrent external edits or Obsidian Sync is
established by this feature. The persistence page retains those policy gaps.
The all-operation rule applies to Tavern actions; arbitrary external Markdown
text or structure changes are not automatically replayed. Existing synchronization
of external checkbox edits remains required.
