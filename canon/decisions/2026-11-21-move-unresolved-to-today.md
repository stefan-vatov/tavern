---
status: reference
scope:
  - daily carry-forward
related:
  - ../architecture/daily-log.md
---

# Move unresolved tasks to today — human decision

The user asked for a button in the top bar of any day that is not today to move
unresolved tasks to today at will, like the carry-forward done on creating a
day. When today has no note, it must create today through the existing creation
path and then move the tasks. Trees are moved smartly: finished trees stay
behind, and trees with unresolved work move whole, finished and unfinished, for
context. The button shows only on days that have incomplete tasks. The current
contract lives on the daily-log architecture page.
