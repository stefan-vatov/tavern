---
status: normative
scope:
  - task search
  - search lifecycle
validation:
  - test/task-search-index.test.ts
  - test/task-search-service.test.ts
  - test/view.test.ts
  - scripts/benchmark-task-search.mjs
related:
  - ./project-workflow.md
  - ./app-window.md
  - ./persistence.md
---

# Task search

## Matching and ownership

Global task search operates on open project tasks. Preserve Tavern's existing
matching and ranking: trim/lowercase text, replace non-ASCII-alphanumeric runs
with spaces, collapse whitespace; score direct substrings before word-initial
acronym substrings. Combine task text, section and project title/path scores;
rank by score, then original task text with stable source order for ties.
A nonempty query that normalizes to empty retains the existing all-open-task
behavior. Do not substitute another launcher's fuzzy policy or silently weaken
matching to meet a benchmark. Project-only matches do not invent task results.

The existing global overlay displays at most fifty ranked task rows. A dedicated
worker owns prepared search fields, ranking and bounded result caching for each
source revision. It returns bounded task identities and the total match count;
task content, DOM construction, note writes, credentials, host APIs and network
access remain outside the worker. Project/daily filters retain their existing
local behavior. No Foldkit, bookmark, URL-launching or highlight model is added.

Each view owns a scoped worker service. Prewarm after source loading, share
initialization/preparation across overlapping requests, and avoid transferring
an unchanged source revision repeatedly. View-owned library preparation reuses
unchanged parsed sources using exact current path/Markdown values; removed,
unreadable or excluded sources cannot survive through that cache. This cache
does not alter current-content mutation or persistence failure contracts.

## Input, results and lifetime

Keep the search input stable while typing, deleting, composing or receiving
results. Echo its query immediately; do not await search or refocus/recreate the
input for each reply. Covered board content is independent of query changes and
is not rebuilt while the overlay owns input. Refresh the library and search
revision when notes change, then render the current board when search closes.

Only the current session, generation, source revision and query may publish.
Retain the prior window while pending and make stale rows inert, including when
a source revision changes. Reuse a result layout only when its complete visible
identity/order, source revision, selection state and count agree. Pending opacity
may ease shallowly; never delay a result, force a loading frame, blank the list,
move rows or duplicate result trees for a crossfade. Reduced motion uses a
shallower fade. Keyboard input, cancellation and scrolling remain immediate.

Escape from the search input clears the session immediately; late success or
failure cannot reopen it. Inline task editors retain their own editing/Escape
contract. Dismissing search while an inline save is pending waits for that save;
a failed save leaves the draft visible for retry before result-region disposal.
Reopening starts with an empty query. Interrupt superseded response waits without
cancelling shared preparation. Interruption of a wait does not claim to cancel
computation already posted to a worker. Preserve the existing row controls and
editing contract; this change does not invent Enter activation or full-result
arrow navigation.

Validate messages with Schema and correlate transport requests and worker epochs
as well as UI revisions/generations. Worker failures fail pending waits and are
visible with explicit Retry; do not fall back to synchronous collection search.
Retry creates a fresh worker and prepares the current source. On view close,
dispose listeners, terminate the worker and settle pending waits. Dispose replaced
result-region listeners and editors rather than retaining them until view unload.

## Validation

Separate cold preparation, worker processing, round-trip time, result DOM work,
input echo and frame intervals. Evaluate the under-10ms processing target with
10,000 indexed tasks separately from initial preparation and end-to-end latency.
Use production builds and diverse direct/acronym/no-match/Unicode/long-text cases,
compare ordered results against the reference matcher, and report cache hits
separately. Native typing and repeated Backspace must be separately scheduled,
including a large viewport; synchronous synthetic bursts alone are insufficient.

Exercise stale replies, source refresh, Escape/reopen, failures/Retry and disposal.
Browser traces and frame callbacks establish different evidence from compositor
presentation. A fast matcher benchmark alone does not establish responsiveness.
Headless setup, window reuse, isolation and cleanup follow the app-window contract.
