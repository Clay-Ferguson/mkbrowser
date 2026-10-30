# Verifying MkBrowser changes at runtime

Note: AI Agents should not automatically run any playwright tests without 
first asking the human developer.

## Build (required after ANY src/ or vite config change)

```bash
npm run package        # rebuilds .vite/build/ + .vite/renderer/ (~1 min)
```

The Playwright harness launches `.vite/build/main.js` and does NOT detect
stale bundles (`tests/e2e/global-setup.ts` only builds when the bundle is
missing) — skipping this step silently runs the OLD code.

## Drive it: write a scratch Playwright spec

The e2e harness (`tests/e2e/`) is the evidence-capture protocol: it launches
the packaged app under an isolated seeded user-data dir against the
`mkbrowser-test/` data folder (repo root), and `takeScreenshot()` produces
replayable evidence in `screenshots/<spec-name>/`.

- Model a new spec on `tests/e2e/private-rename.spec.ts` (functional style)
  or `create-file-demo.spec.ts` (demo style with narration). Be sure to have
  `private-` filename prefix on new tests.
- Import fixtures from `./fixtures/electronApp` (`test`, `expect`,
  `mainWindow`, `testDataPath`) and helpers from `./helpers/mediaUtils`
  (`demoClick`, `demoRefresh`, `insertText`, `takeScreenshot`,
  `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings`).
- Name created markdown files `my-*.md` and created folders `my-*` —
  `cleanupTestDataFiles()` removes those (folders with all their contents)
  at the start of each run.
- `resetSettings(mainWindow)` turns the `expandedEditor` preference ON, so
  editing a file from the folder listing opens the maximized editor in
  single-file mode. Pass `{ expandedEditor: false }` to verify inline
  editing, and `{ aiEnabled: true }` for AI features (AI is off by default).
- Full conventions: `playwright.md` in this folder.
- Run one spec: `npx playwright test tests/e2e/<name>.spec.ts` (~20 s;
  opens a visible window on the local display).

## Useful test ids

`browser-main-content`, `create-file-button`, `create-file-dialog-input`,
`create-file-dialog-create-button`, `entry-save-button`, `entry-cancel-button`,
`entry-action-bar` (hover-revealed; its `entry-menu-button` opens the per-entry
menu — use `openEntryMenu()`). To refresh, call
`demoRefresh(mainWindow)` (it clicks the current-folder breadcrumb).
The inline editor is `.cm-editor`; `insertText(mainWindow, text, true)`
types into the focused editor.

## Gotchas

- The test can touch `mkbrowser-test/` directly with `fs` (same machine) —
  handy for simulating external edits; pin mtimes with `fs.utimesSync` when
  the scenario needs an unchanged mtime.
- Assert rendered markdown via `mainContent.getByText(...)`, scoped to
  `browser-main-content` to avoid matching the file tree.
- Views are hidden with `display:none`, never unmounted, so a page-wide
  lookup can match a hidden tab — scope to `activeView(mainWindow)` after
  switching views.
