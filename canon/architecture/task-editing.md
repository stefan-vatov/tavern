---
status: normative
scope:
  - task editing
validation:
  - test/task-edit.test.ts
  - test/task-text-editor.test.ts
  - test/view.test.ts
  - test/daily-log-service.test.ts
related:
  - ./project-workflow.md
  - ./daily-log.md
  - ./persistence.md
  - ../decisions/2026-10-24-task-keyboard-editing.md
  - ../decisions/2026-10-25-persistent-task-capture.md
---

# Task editing and deletion

Project, queue, search-result, and daily-log task editors share the same keyboard
behavior for inline editing. Ctrl+Enter creates a new sibling below
the current task's group and focuses its text. Shift+Enter creates a new nested
subitem beneath the current task and focuses its text. Plain Enter changes
nothing. Composition input must not accidentally create tasks. Escape cancels
the editing session.

Leaving an editing session saves its nonempty text and new task tree. Moving
focus between its rows keeps the session open. New blank drafts remain UI state;
abandoning them must not leave blank task lines in Markdown. Background note
refreshes must preserve the active editor, its text, and keyboard focus.

Permanent add-task fields in projects and Captain's Log remain available even
when empty or after losing focus. Enter, Shift+Enter, and Ctrl+Enter submit
nonempty text as one task, clear the field after success, and leave it ready
for another entry. The input retains focus when it still owns focus; a late
save must not take focus back from another control. Empty submissions create
no Markdown task. Composition input must not submit. Background refreshes show
saved tasks while preserving the next capture draft and its focus. Failed saves
retain the text for retry.

An empty inline task row is removed when it loses focus. Its existing subitems survive and
move up one level, retaining their relative nesting and order. This cleanup
removes only that row, matching Delete item. Propagation to linked items follows
the [linked-unit contract](daily-log.md); children that survive an item deletion
retain their links.

Edits preserve checkbox state, existing block IDs on surviving tasks, surrounding
note content, and note line endings. Own edits preserve queue references to
surviving tasks, including tasks shifted by new or removed lines. Pending actions
in either pane remain bound to the same tasks when a linked write shifts rows
in another note. Missing or ambiguous targets and failed writes are visible failures. A failed edit keeps
the draft available for correction rather than silently discarding its text.
If the view closes while a save fails, show the unsaved draft as copyable
Markdown in a recovery dialog.

Task edits save their reference changes before writing the note. A reference
settings failure must leave the note untouched, so the same edit remains
retryable. If the note write fails, restore the prior references. A failure of
that restoration is itself a visible storage failure; this does not establish
an atomic transaction with external editors.

## Right-click deletion

Captain's Log, project, available-task, focus-queue, and search-result rows offer
**Delete item** in their context menu. It removes the selected task line and
promotes its children one level, retaining their relative nesting and order.
A row with task descendants additionally offers **Delete tree**, which removes
the selected task and its complete nested group, including indented supporting
content. Descendants are determined from the underlying note, even when a
filter or queue selection hides them. Neither action removes adjacent siblings,
headings, or unrelated note content.

Deleting a queued item changes its source project note. The separate action to
remove an item from the focus queue continues to change queue selection only.
For linked tasks, deletion reaches the source and every copy under the
[linked-unit contract](daily-log.md). Surviving child relationships and queue
references remain valid. Settings and note-write failure behavior follows
the same reference-save and rollback contract as editing.

A menu opens only after active edits finish and a fresh note snapshot supplies
its task identity and tree eligibility. Deletion actions are serialized, following
its authoritative task-reference changes so a rename or inserted draft cannot
cause deletion of a different task. Missing or ambiguous targets are visible
failures rather than a reason to guess from task text.
