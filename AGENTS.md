# Tavern Agent Notes

## Project Shape

- Obsidian plugin ID: `tavern`.
- Source lives in `src/`.
- Entry point: `src/main.ts`.
- Build output: `main.js` at the plugin root.
- Local test vault: `../test-vault`.
- Vault plugin path: `../test-vault/.obsidian/plugins/tavern`, symlinked to this repo.

## Commands

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run check
```

Use `pnpm run dev` while Obsidian has `../test-vault` open. Reload Obsidian after changes to `manifest.json`; normal TypeScript changes rebuild to `main.js`.

## Development Rules

- Keep `manifest.json` `id` aligned with the plugin folder name: `tavern`.
- Project notes are identified by `tavern: project` frontmatter.
- Project folders default to `04_Projects` and are configured in Tavern settings.
- Keep startup work light in `onload`; defer heavier work until commands or views need it.
- Use Obsidian lifecycle helpers such as `registerEvent`, `registerDomEvent`, and `registerInterval` for cleanup.
- Avoid Node or Electron APIs unless the plugin becomes desktop-only and `manifest.json` is updated.
- Do not add network calls or telemetry without explicit product need and user-facing disclosure.
- Keep settings defaults in `src/settings-defaults.ts` and persist with `loadData` / `saveData`.
