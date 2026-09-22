---
status: normative
scope:
  - app window
  - navigation
validation:
  - test/main.test.ts
  - test/project-mode.test.ts
  - test/view.test.ts
related:
  - ../standards.md
  - ./project-workflow.md
  - ../decisions/2026-09-22-one-tavern-app.md
---

# Tavern app window

Tavern is one Obsidian-backed app window per vault. Its views belong inside that
app; adding a view does not create another application or launch window. This is
the human's explicit product direction in the related decision.

On desktop, Tavern's entry points open or reveal a reusable Obsidian popout. They
serialize concurrent opens and recognize the app window independently of its
current view or title. If its Tavern tab has become a Markdown note, or the
Tavern tab closes while another tab remains, opening Tavern restores it in that
same window. Window ownership survives plugin reload while the window remains
open. Unrelated Obsidian windows are not reuse candidates. A new app window is
created when the previous one has actually closed.

A restored Tavern tab moves to a popout; the recognized app window takes
precedence over other Tavern tabs. Duplicate Tavern leaves are closed
only after the retained view has been revealed. Opening without a project keeps
the current navigation state. Opening a specific project selects it within the
app shell. Legacy note-only state restores its project with the sidebar available.

Mobile uses a reusable tab because Obsidian popouts are a desktop facility.
Tavern remains attached to the same Obsidian process and vault; it is not an
independent executable. Obsidian must remain running.

The ribbon, Open command, task-search command, and `obsidian://tavern` URI target
the same app. A URI may select its vault using Obsidian's `vault` parameter.
Opening an ordinary project note retains Obsidian's Markdown editor. Marking the
active note as a project selects it inside Tavern. No app window is created at
startup unless the workspace already contains a Tavern view.

An opening failure produces a notice and permits a later retry. Deferred views
must finish revealing before task search is invoked. Resizing listens to the
view's own document, with drag listeners removed on mouseup, rerender, window
migration, or close. Plugin unload cancels pending opens and detaches Tavern views.

Project and task persistence remains owned by the persistence page; window and
navigation state does not replace the independent Markdown content.

## Local desktop validation

Validation of this contract exercises the real loaded plugin in Obsidian. It
checks repeated opening, project navigation, view replacement by a Markdown
note, and plugin reload while another tab remains in the app window. The
reuse checks compare the actual window identity before and after; counting
Tavern views alone cannot establish that an old app window was reused.

An actually closed app window permits one replacement window. The Obsidian host
and unrelated note windows are distinct from the Tavern app. Closing a leftover
window by hand does not validate reuse. Test reports distinguish observed UI
interactions and saved Markdown changes from unit-test or API-only evidence.

The operational setup and cleanup recipe lives in the
[local-testing guide](../../docs/local-testing.md).
