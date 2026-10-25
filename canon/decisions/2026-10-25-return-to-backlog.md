---
status: reference
scope:
  - daily log
  - linked tasks
related:
  - ../architecture/daily-log.md
  - ./2026-10-25-linked-task-operations.md
---

# Return daily work to Backlog — human decision

The user requested a **To Backlog** action in the daily task context menu to put
work back into the project displayed in the opposite pane. It must be disabled
when that pane does not show a project. Choosing any item within a tree acts on
the whole tree.

If the project already contains the tasks, remove their daily representation.
Otherwise copy the missing work into the project's Backlog and then remove it
from the daily log. The user explicitly chose to merge missing descendants
beneath existing project parents while keeping existing project tasks in their
current sections.

The active contract lives in the related daily-log page.
