---
status: reference
---

# Tavern Canon

- [Standards](standards.md) — read for any repository change, especially project discovery, plugin lifecycle, platform support, privacy, or settings.
- [Releases](architecture/releases.md) — read when changing release generation, validation, version metadata, or published assets.
- [Project workflow](architecture/project-workflow.md) — read when changing project sections, task completion, nested tasks, search, or the focus queue.
- [Task editing](architecture/task-editing.md) — read when changing task text editors, keyboard capture, context-menu deletion, empty-row cleanup, or draft continuity.
- [Task keyboard editing decision](decisions/2026-10-24-task-keyboard-editing.md) — read for the historical human choices of task creation shortcuts and promoting children when an empty parent is removed.
- [App window](architecture/app-window.md) — read when changing app launch, window reuse, restored views, internal navigation, or local desktop validation.
- [One Tavern app decision](decisions/2026-09-22-one-tavern-app.md) — read for the human decision to keep Tavern and its views in one app window.
- [Persistence](architecture/persistence.md) — read when changing note writes, saved queue state, task identity, or handling vault failures.
- [Daily log](architecture/daily-log.md) — read when changing split-view daily notes, daily task copies, linked task identity, or completion synchronization.
- [Daily carry-forward decision](decisions/2026-10-25-daily-carry-forward.md) — read for the human requirement to move previous-day incomplete work on creation and retain whole mixed task trees.
- [Daily template decision](decisions/2026-10-25-daily-log-template.md) — read for the human choices of a Tavern template-file setting and stopping on Templater failure.
- [Linked task operations decision](decisions/2026-10-25-linked-task-operations.md) — read for the human requirement that all Tavern item operations and tree additions synchronize, creating missing destinations.
- [Linked daily tasks decision](decisions/2026-10-24-linked-daily-tasks.md) — read for the historical human choices of standard Obsidian block IDs and bidirectional checking and unchecking.

Architecture pages describe established behavior with executable evidence. They
do not supply missing policy or decision rationale.
