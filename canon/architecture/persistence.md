---
status: reference
scope:
  - 'vault persistence'
  - settings
validation:
  - test/project-actions.test.ts
  - test/project-vault.test.ts
  - test/main.test.ts
  - test/project-library.test.ts
related:
  - ../standards.md
  - ./project-workflow.md
---

# Persistence

## Data ownership and writes

Project Markdown in the Obsidian vault holds task text, completion state,
sections, and nesting. The board and focus queue present tasks from those notes;
queue selection is saved in plugin settings. Settings storage and defaults
follow the existing standards.

A task action locates its project file, reads its current Markdown, applies the
requested transformation, then writes the result through the vault. A missing
task or project, a failed read, an invalid transformation, or a failed write
is an action failure; reading or transformation failure does not lead to a write.
This sequence is not evidence of an atomic transaction with external editors.

Library loading handles individual read and parse failures by logging and
skipping the affected note. This differs from task mutation, which propagates
failure. The successful-load tests do not establish a complete recovery policy
for unreadable or malformed vault content.

## Task references and missing policy

Queue entries refer to tasks in a project note. Their identity is sensitive to
the project path, section position, task position, and text; current behavior
does not establish durable identity across arbitrary external edits.

Human input is still needed before specifying:

- Whether queue selections must survive externally edited task text, reordered
  notes, renamed project files, or changes to the task-ID format, and what
  migration or recovery behavior should apply.
- How simultaneous Tavern actions, external edits, or Obsidian Sync updates
  should resolve conflicting note writes, including any retry or recovery policy.

No decision rationale for these policies is recorded; the existing implementation
does not resolve those product questions.
