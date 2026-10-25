---
status: normative
scope:
  - task transfers
  - daily log
  - linked tasks
validation:
  - test/daily-log-service.test.ts
  - test/view.test.ts
related:
  - ./daily-log.md
  - ./persistence.md
  - ./task-editing.md
  - ../decisions/2026-10-25-return-to-backlog.md
  - ../decisions/2026-10-25-send-to-captains-log.md
---

# Task transfer menus

## Send project work to Captain's Log

Project task menus, including global, focus, and search views, offer
**To Captain's Log**. The destination is the day currently displayed in the
log. Disable the action when its note is absent; require explicit **Create daily
log** first. This action never creates a note or invokes Templater. Read failures
remain visible errors, not evidence of absence. Bind the day when the menu opens
and visibly reject a stale action if the selected day changes before execution.

Choosing any member resolves the whole top-level tree from current project
Markdown, including filtered or checked descendants and supporting content.
Keep the project tree in place and preserve queue references. Existing linked
identities establish daily counterparts; matching text never does. Repeating the
action reuses those counterparts and merges missing descendants beneath matching
parents. If several parent representations exist, fill each missing branch.
Existing visible placements stay intact. A wholly absent root goes into visible
`Plan`, creating that section if necessary.

Move an existing linked counterpart hidden under `Notes` into visible `Plan`, or
under its matching visible parent, instead of making a duplicate. Preserve its
subtree and supporting Markdown; do not move unrelated Notes ancestors. A Plan
heading nested within hidden Notes is not a visible destination.

New source identities and distinct daily endpoint block IDs participate in the
existing linked-unit contract. Preserve text, checked states, relative nesting,
ordering, line endings, and surrounding content. Missing or ambiguous registered
endpoints and ambiguous merge destinations fail visibly before writes. Prepare
note and reference changes through the linked-write contract in the daily-log
page: settings and queue-reference saves precede note writes; failed writes
attempt rollback and report failures. A failure must not silently lose source
work. The existing limits on rollback and concurrent external edits still apply.
This menu's reuse behavior does not change drag-copy behavior: a drag may create
another distinct linked copy.

## Return from daily log to a project

Daily task menus offer **To Backlog**, disabled unless the opposite pane shows
a selected project. Choosing any member of a daily task tree returns its whole
top-level tree, including checked descendants and supporting Markdown. Resolve
the tree from the current note, including tasks hidden by filters.

Registered counterparts already in the displayed project keep their current
sections and placement; do not duplicate them or force them into Backlog. If
only part of the tree exists there, merge missing tasks under their existing
project parents. When the same linked parent has multiple representations in
the project, missing descendants reach each representation; their existence
alone is not ambiguity. A wholly absent root and its missing tree go into `Backlog`,
creating that section when necessary. Existing identities, rather than matching
text, establish whether a task is already represented. Missing or ambiguous
registered endpoints and ambiguous merge destinations are visible failures.

Remove the returned tree only from the selected daily note. This is a transfer
of representations, not Delete item or Delete tree: project tasks and other
copies remain. Retarget or detach the daily endpoints while preserving surviving
relationships; promote a surviving endpoint when the daily note held the source.
New additions to linked trees retain the linked-unit synchronization contract.
Transferred tasks retain text, checkbox states, nesting, and supporting content;
existing project content stays intact. Preserve note line endings, unrelated
content, and queue references to surviving project tasks.

The destination project is bound when the menu opens. If the opposite pane or
selected day changes before execution, reject the stale action visibly rather
than choosing another destination. Prepare the transfer using the linked-write
contract in the daily-log page; write destination changes before removing daily
work. Failed settings or queue-reference saves must precede note writes, and failed writes
attempt to restore notes and references. Failures remain visible and must not
silently discard the daily tree; rollback failures retain the limits in the
daily-log page.
