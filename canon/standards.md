---
status: normative
scope:
  - tavern
validation:
  - .ai/harder-to-fool/check_sync.py
---

# Tavern standards

The human-supplied Development Rules in the repository-root `AGENTS.md` are
incorporated here by reference, without changing their requirements. That
section remains the owner of the rules for plugin identity, project recognition
and configured folders, lightweight startup, lifecycle cleanup, the Node/Electron
boundary, network calls and telemetry, and settings defaults and persistence.

No additional coding standard, dependency restriction, performance limit, or
platform guarantee is inferred from the current implementation. A new standard
needs an explicit human requirement.

The repository-root `AGENTS.md` also owns the adopted Harder to Fool protocol
and its repository-specific decision-record locations. Build and release CI
require its drift check to pass against the vendored Code and the inlined
agent block.
