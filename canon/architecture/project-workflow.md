---
status: reference
scope:
  - 'project notes'
  - 'focus queue'
validation:
  - test/project-note.test.ts
  - test/project-library.test.ts
  - test/view.test.ts
related:
  - ../standards.md
  - ./persistence.md
---

# Project workflow

Tavern's documented product in the repository README is a local-first
Obsidian project board with task search and a cross-project focus queue. Project
recognition and configured folder rules belong to the standards.

## Project notes and task trees

Project notes accept arbitrary second-level Markdown headings as sections;
the familiar workflow names are examples, not a fixed set of states. A note
without sections is valid, and parsing it does not invent sections.

Completing a task checks it and moves it to `Done`, creating that section if
needed. Moving or reordering a parent carries its nested task tree and preserves
relative nesting; deleting a parent removes its nested children. Completing a
parent moves the tree but does not automatically check every child.

Task operations preserve surrounding frontmatter and preamble. Blank task
creation and blank text edits are rejected, as are operations on missing tasks.
Dropping a task onto itself leaves it unchanged. Positioned moves between
different project notes are rejected.

## Focus queue and search

The focus queue selects tasks from project notes across the configured folders.
Removing a selection from the queue does not complete or delete its source task.
Editing or completing a queued task acts on its source project note.

Selecting a parent includes its nested task tree. The queue persists selected
task references and restores their nesting on reopen; reordering a selected
parent carries its tree as a block. References that no longer resolve are
ignored. Persistence limitations belong to the persistence page.

Global task search returns task rows across projects, with controls for opening
the source project, completing tasks, and changing queue selection. A project
with no matching tasks does not become a task result merely because its title
matches.
