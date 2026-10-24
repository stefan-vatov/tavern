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
---

# Task editing

Project, queue, search-result, and daily-log task editors share the same keyboard
behavior, including task capture fields. Ctrl+Enter creates a new sibling below
the current task's group and focuses its text. Shift+Enter creates a new nested
subitem beneath the current task and focuses its text. Plain Enter changes
nothing. Composition input must not accidentally create tasks. Escape cancels
the editing session.

Leaving an editing session saves its nonempty text and new task tree. Moving
focus between its rows keeps the session open. New blank drafts remain UI state;
abandoning them must not leave blank task lines in Markdown. Background note
refreshes must preserve the active editor, its text, and keyboard focus.

An empty row is removed when it loses focus. Its existing subitems survive and
move up one level, retaining their relative nesting and order. This cleanup
removes only that row; the ordinary Delete task action retains its existing
whole-tree deletion behavior. Clearing a linked row removes that endpoint's
relationship without deleting text in other notes; surviving child links remain
intact. Task text edits do not propagate to linked copies.

Edits preserve checkbox state, existing block IDs on surviving tasks, surrounding
note content, and note line endings. Own edits preserve queue references to
surviving tasks, including tasks shifted by new or removed lines. Missing or
ambiguous targets and failed writes are visible failures. A failed edit keeps
the draft available for correction rather than silently discarding its text.
If the view closes while a save fails, show the unsaved draft as copyable
Markdown in a recovery dialog.

Task edits save their reference changes before writing the note. A reference
settings failure must leave the note untouched, so the same edit remains
retryable. If the note write fails, restore the prior references. A failure of
that restoration is itself a visible storage failure; this does not establish
an atomic transaction with external editors.
