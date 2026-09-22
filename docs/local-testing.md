# How to test Tavern locally in Obsidian

Use a disposable vault and a separate Obsidian profile to test the current plugin
build in the real desktop app. Reuse that test session while iterating. This is
the workflow for requests such as “local testing”, “test the plugin in Obsidian”,
or “computer use testing”. The [app-window contract](../canon/architecture/app-window.md)
defines the behavior to verify.

## Prerequisites

- A desktop session with Obsidian installed. The launch command below matches the
  Arch/Omarchy package layout; inspect the installed launcher before using it on
  a different machine.
- This repository, its installed dependencies, and the pnpm version declared in
  `package.json`. Run commands from the repository root.
- Python 3, curl, and Node with built-in `fetch` and `WebSocket` for the debugging
  fallback. `node -p '[process.version, typeof fetch, typeof WebSocket].join(" ")'`
  must show two `function` values. Activate the installed Node/pnpm runtime if
  the shell resolves the wrong version; do not replace working dependencies to
  compensate for an incorrect runtime.
- Native computer-use controls, or the local Chrome DevTools Protocol (CDP)
  connection described below. CDP controls Obsidian's actual Electron renderer.

Use native computer use when available. If it is disabled or unavailable, state
that limitation and use CDP. Report which path was used. Invoking a plugin method
checks behavior; pointer/keyboard input checks the rendered interaction. A unit
test or a successful plugin load alone is not evidence that the UI works.

## 1. Reuse a test session or create an isolated fixture

First look for the session recorded by the current task: its temporary directory,
profile path, process ID, and debugging port. Confirm the process and vault before
reusing them. Do not launch another test instance on every iteration.

For a fresh session, build and create the fixture:

```bash
pnpm run build
export TAVERN_TEST_ROOT="$(mktemp -d /tmp/tavern-ui.XXXXXX)"
python3 - <<'PY'
import json, os, secrets, shutil, time
from pathlib import Path

root = Path(os.environ['TAVERN_TEST_ROOT'])
vault = root / 'Tavern Test'
profile = root / 'profile'
plugin = vault / '.obsidian/plugins/tavern'
plugin.mkdir(parents=True)
profile.mkdir()
(vault / '04_Projects').mkdir()
(vault / '04_Projects/Launch.md').write_text(
    '---\ntavern: project\n---\n# Launch\n\n## Next\n\n'
    '- [ ] Test the Tavern window\n- [ ] Write a short note\n\n## Done\n')
(vault / '04_Projects/Studio.md').write_text(
    '---\ntavern: project\n---\n# Studio\n\n## Next\n\n'
    '- [ ] Arrange the desk\n')
(vault / '.obsidian/community-plugins.json').write_text('["tavern"]')
(vault / '.obsidian/app.json').write_text('{"safeMode":false}')
for name in ['main.js', 'manifest.json', 'styles.css']:
    shutil.copy2(Path.cwd() / name, plugin / name)
(profile / 'obsidian.json').write_text(json.dumps({'vaults': {
    secrets.token_hex(8): {
        'path': str(vault), 'ts': int(time.time() * 1000), 'open': True
    }
}}))
print(vault)
PY
```

Expected result: a new `/tmp/tavern-ui.…/Tavern Test` vault with two projects and
three unchecked tasks. Only synthetic Markdown and this build are copied into
it. Its Obsidian profile is separate from the user's normal profile. The profile
JSON bootstrap is an integration with Obsidian's current desktop implementation;
if its format changes, open this fixture through Obsidian's vault chooser.

The existing `../test-vault` workbench remains an alternative for an explicitly
chosen development session; its symlink and Hot Reload setup are described in
[the README](../README.md#development). Do not assume it is disposable.

## 2. Launch the test profile once

Inspect the installed launcher, choose an unused local port, and launch the
isolated profile. The free-port probe does not reserve the port; check the
startup log and endpoint before connecting.

```bash
command -v obsidian
cat /usr/bin/obsidian
command -v electron43
test -f /usr/lib/obsidian/app.asar
export TAVERN_CDP_PORT="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"
nohup electron43 /usr/lib/obsidian/app.asar \
  --user-data-dir="$TAVERN_TEST_ROOT/profile" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$TAVERN_CDP_PORT" \
  --disable-gpu --no-first-run > "$TAVERN_TEST_ROOT/obsidian.log" 2>&1 &
export TAVERN_OBSIDIAN_PID=$!
python3 - <<'PY'
import json, os
from pathlib import Path
keys = ['TAVERN_TEST_ROOT', 'TAVERN_CDP_PORT', 'TAVERN_OBSIDIAN_PID']
root = Path(os.environ['TAVERN_TEST_ROOT'])
(root / 'session.json').write_text(json.dumps({k: os.environ[k] for k in keys}, indent=2))
print(root / 'session.json')
PY
```

Expected result: the `Tavern Test` vault opens and the log reports a DevTools
WebSocket on the selected port. Record `session.json`'s path in the task's working
record. Inspect the session and restore its variables when changing shells.
Leave the user's existing Obsidian process and vaults running.

Once startup finishes, list the targets:

```bash
curl --fail --silent "http://127.0.0.1:$TAVERN_CDP_PORT/json/list"
```

Expect a page at `app://obsidian.md/index.html`. Popouts appear as separate page
targets, often with an `about:blank` URL. Rediscover their IDs after a window
closes or the plugin reloads. Do not copy a target ID from an earlier session.

## 3. Connect and load the current build

Native computer use can enable Tavern in **Settings → Community plugins** and
run **Tavern: Open**. For CDP, create this small client in the test directory:

```bash
cat > "$TAVERN_TEST_ROOT/cdp.mjs" <<'JS'
import { readFile, writeFile } from 'node:fs/promises';

const port = Number(process.env.TAVERN_CDP_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Set TAVERN_CDP_PORT');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const [method, argument, outputPath] = process.argv.slice(2);
if (method === 'list') {
  console.log(JSON.stringify(targets, null, 2));
} else {
  const target = process.env.TAVERN_CDP_TARGET
    ? targets.find(page => page.id === process.env.TAVERN_CDP_TARGET)
    : targets.find(page => page.type === 'page' && page.url.endsWith('/index.html'));
  if (!target) throw Error('Target is gone; list targets again');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const timeout = setTimeout(() => { socket.close(); process.exit(1); }, 15000);
  try {
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    const params = method === 'Runtime.evaluate'
      ? { expression: await readFile(argument, 'utf8'), awaitPromise: true, returnByValue: true }
      : JSON.parse(argument || '{}');
    const message = await new Promise((resolve, reject) => {
      socket.onerror = reject;
      socket.onmessage = event => {
        const response = JSON.parse(event.data);
        if (response.id === 1) resolve(response);
      };
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    if (message.error || message.result.exceptionDetails) {
      throw Error(JSON.stringify(message.error || message.result.exceptionDetails));
    }
    if (method === 'Page.captureScreenshot') {
      await writeFile(outputPath, Buffer.from(message.result.data, 'base64'));
      console.log(outputPath);
    } else {
      console.log(JSON.stringify(message.result, null, 2));
    }
  } finally {
    clearTimeout(timeout);
    socket.close();
  }
}
JS
node "$TAVERN_TEST_ROOT/cdp.mjs" list
```

Check the connected vault before any mutation. Default evaluation targets the
main renderer, where Obsidian's `app` is available:

```bash
cat > "$TAVERN_TEST_ROOT/inspect.js" <<'JS'
({ vault: app.vault.getName(), path: app.vault.adapter.getBasePath(),
   plugins: Object.keys(app.plugins.plugins) })
JS
unset TAVERN_CDP_TARGET
node "$TAVERN_TEST_ROOT/cdp.mjs" Runtime.evaluate "$TAVERN_TEST_ROOT/inspect.js"
```

The returned path must equal `$TAVERN_TEST_ROOT/Tavern Test`. The filesystem
adapter and plugin-manager calls here are desktop test-harness integrations, not
APIs to import into the shipped plugin. If they change, use the app UI.

Enable Tavern if necessary, then open it:

```bash
cat > "$TAVERN_TEST_ROOT/open.js" <<'JS'
(async () => {
  if (app.vault.getName() !== 'Tavern Test') throw Error('Unexpected vault');
  await app.plugins.setEnable(true);
  await app.plugins.enablePluginAndSave('tavern');
  await app.plugins.plugins.tavern.activateView();
  return app.workspace.getLeavesOfType('tavern-view').map(leaf => ({
    title: leaf.view.getDisplayText(),
    popout: leaf.getContainer() !== app.workspace.rootSplit,
    text: leaf.view.contentEl.innerText
  }));
})()
JS
node "$TAVERN_TEST_ROOT/cdp.mjs" Runtime.evaluate "$TAVERN_TEST_ROOT/open.js"
```

With a fresh fixture, expect one Tavern popout containing Launch, Studio, and
three open tasks.
The test profile also has an Obsidian host window; count Tavern app windows
separately from that host.

For another build in the same session, run `pnpm run build`, copy the same three
artifacts into the fixture plugin directory, and disable/enable Tavern through
the UI or `app.plugins.disablePlugin('tavern')` followed by
`app.plugins.enablePlugin('tavern')`. Open Tavern again. Do not restart Obsidian
or make a new profile just to load another build. A build alone does not update
the copied plugin.

## 4. Exercise the actual interface

Rediscover the popout page and set `TAVERN_CDP_TARGET` to its returned ID for
DOM inspection, input, and screenshots. Keep that variable unset when using
`app` in the main renderer. Observe current labels and element geometry before
sending input; do not reuse coordinates from another window size.

For CDP interactions, use `Runtime.evaluate` to obtain an element's
`getBoundingClientRect()`, then send `Input.dispatchMouseEvent` with
`mousePressed`/`mouseReleased`, the observed `x`/`y`, `button: "left"`, and
`clickCount: 1`. Use `Input.insertText` for typing and `Input.dispatchKeyEvent`
for keys. For example, with the search field focused in the selected popout:

```bash
node "$TAVERN_TEST_ROOT/cdp.mjs" Input.insertText '{"text":"Arrange"}'
node "$TAVERN_TEST_ROOT/cdp.mjs" Input.dispatchKeyEvent \
  '{"type":"keyDown","key":"Escape","code":"Escape","windowsVirtualKeyCode":27}'
node "$TAVERN_TEST_ROOT/cdp.mjs" Page.captureScreenshot '{}' \
  "$TAVERN_TEST_ROOT/tavern.png"
```

Inspect the screenshot. Run the interactions relevant to the change; for the
app shell, use this checklist:

- Open Tavern repeatedly and concurrently: one app window remains.
- Navigate Launch → global queue → Studio without opening another app window.
- Queue a task and return to the global queue: the selection is present.
- Search for `Arrange`: Studio's task appears; unrelated tasks do not. Escape
  dismisses the search overlay in the popout.
- Drag the sidebar divider: the sidebar follows the pointer in that window.
- Complete `Test the Tavern window`: read `04_Projects/Launch.md` and verify the
  checked task appears under `## Done`. Do not rely only on the rendered checkbox.
- Close Tavern and open it again: a single replacement app window opens.

Wait for the expected DOM or file state, with a bounded timeout. API calls used
to prepare a regression scenario do not replace pointer/keyboard coverage.

## 5. Reproduce the “Launch window” regression

A leaf count alone missed this bug. Preserve the actual window identity in one
main-renderer evaluation while replacing its view and reloading the plugin:

```bash
cat > "$TAVERN_TEST_ROOT/reuse-window.js" <<'JS'
(async () => {
  if (app.vault.getName() !== 'Tavern Test') throw Error('Unexpected vault');
  const leaf = await app.plugins.plugins.tavern.activateView();
  const originalWindow = leaf.getContainer();
  const note = app.vault.getAbstractFileByPath('04_Projects/Launch.md');
  if (!note) throw Error('Missing fixture');
  await leaf.openFile(note);
  const reopened = await app.plugins.plugins.tavern.activateView();
  if (reopened.getContainer() !== originalWindow) throw Error('View replacement created another window');
  app.workspace.setActiveLeaf(reopened);
  const sibling = app.workspace.getLeaf('tab');
  await sibling.openFile(note);
  if (sibling.getContainer() !== originalWindow) throw Error('Wrong test window');
  await app.plugins.disablePlugin('tavern');
  await app.plugins.enablePlugin('tavern');
  const restored = await app.plugins.plugins.tavern.activateView();
  if (restored.getContainer() !== originalWindow) throw Error('Reload created another window');
  const windows = new Set();
  app.workspace.iterateAllLeaves(candidate => {
    if (candidate.getContainer() !== app.workspace.rootSplit) windows.add(candidate.getContainer());
  });
  if (windows.size !== 1 || app.workspace.getLeavesOfType('tavern-view').length !== 1) {
    throw Error('Unexpected extra test windows or Tavern views');
  }
  return { reusedOriginalWindow: true, popouts: windows.size };
})()
JS
unset TAVERN_CDP_TARGET
node "$TAVERN_TEST_ROOT/cdp.mjs" Runtime.evaluate "$TAVERN_TEST_ROOT/reuse-window.js"
```

Expected result: `reusedOriginalWindow: true` and `popouts: 1`. Take each identity
comparison before detaching that leaf; a detached leaf no longer identifies its
former window. For a UI-only run, identify the same OS window before and after.

## 6. Finish without leaving window sprawl

Inspect the test process's windows. On this Linux desktop, `hyprctl clients -j`
can identify them by PID and vault title. Inspect only the known test process.
Close any note popout accidentally left by testing. Confirm one Tavern window
remains if leaving a session available for the user, and report the retained
vault/profile path. A manually closed leftover is cleanup, not a passing reuse
test; step 5 must still pass.

If the test session is no longer needed, close its fixture vault through Obsidian
and verify that the recorded test process exited before removing its temporary
directory. Never use a broad `pkill obsidian`, restart the user's normal profile,
or remove the shared `../test-vault` as cleanup. Preserve requested screenshots
and results before deleting temporary files.

## Troubleshooting

| Symptom                                       | Action                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Native computer use reports disabled surfaces | State the limitation and use the local CDP fallback. Do not claim the native tool ran.                                                          |
| No debugging endpoint                         | Inspect `obsidian.log`, the recorded process/profile, and port availability. Do not attach to an unrelated endpoint.                            |
| Tavern is absent from the plugin list         | Confirm the copied `manifest.json` ID and folder are `tavern`, then enable community plugins in the fixture profile.                            |
| The UI still shows an earlier build           | Rebuild, copy all three artifacts, then disable/enable the plugin in this same profile.                                                         |
| CDP returned `exceptionDetails`               | Treat the evaluation as failed even if the protocol request itself succeeded.                                                                   |
| A Launch note window lingers                  | Run the window-identity regression. Fix reuse before cleaning up the leftover; do not explain it away as a second instance.                     |
| Coverage suddenly includes duplicate tests    | Do not run Vitest alongside Stryker: Vitest can discover Stryker's temporary sandbox. Wait for mutation testing to finish, then rerun coverage. |

## Verify it works

Report the tested build, fixture path, interaction tool, exercised flows, observed
window count/identity, Markdown result, and any remaining limitation. Link the
screenshot or evidence files when useful. Confirm test leftovers are closed or
explicitly retained, and keep the user's normal vaults untouched.

Run the repository's appropriate automated checks as well. `pnpm run check`
executes build, coverage, lint/format, unused-code checks, and mutation testing in
sequence. Actual desktop testing and these checks supply different evidence;
report each accurately.
