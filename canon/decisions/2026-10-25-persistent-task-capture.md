---
status: reference
scope:
  - task editing
  - daily log
related:
  - ../architecture/task-editing.md
  - ../architecture/daily-log.md
  - ./2026-10-24-task-keyboard-editing.md
---

# Persistent task capture — human decision

The user distinguished the permanent bottom add-task prompts from inline task
rows: the prompts must remain available when empty, while empty inline drafts
must disappear on blur. The supplied reason was to keep an obvious place to
enter the next item while keeping the list tidy.

For the permanent prompts, the user requested Enter, Shift+Enter, and Ctrl+Enter
to create an item immediately and leave an input for the next one. The earlier
inline keyboard choices remain unchanged.

The user also requested hiding Notes from Captain's Log and clear spacing
between the task list and capture input. Current guarantees live in the related
architecture pages.
