---
name: verify
description: Build, launch, and drive MkBrowser (packaged Electron app) to verify a change end-to-end with screenshot evidence.
---

# Verifying MkBrowser changes at runtime

## Build (required after ANY src/ or vite config change)

```bash
npm run package        # rebuilds .vite/build/ + .vite/renderer/ (~1 min)
```

The Playwright harness launches `.vite/build/main.js` and does NOT detect
stale bundles — skipping this step silently runs the OLD code.

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
  (`demoClick`, `insertText`, `takeScreenshot`, `cleanupTestDataFiles`,
  `resetSettings`).
- Name created markdown files `my-*.md` — `cleanupTestDataFiles()` removes
  those automatically at the start of each run.
- Run one spec: `npx playwright test tests/e2e/<name>.spec.ts` (~20 s;
  opens a visible window on the local display).

## Useful test ids

`browser-main-content`, `create-file-button`, `create-file-dialog-input`,
`create-file-dialog-create-button`, `entry-save-button`, `refresh-button`.
The inline editor is `.cm-editor`; `insertText(mainWindow, text, true)`
types into the focused editor.

## Gotchas

- The test can touch `mkbrowser-test/` directly with `fs` (same machine) —
  handy for simulating external edits; pin mtimes with `fs.utimesSync` when
  the scenario needs an unchanged mtime.
- Assert rendered markdown via `mainContent.getByText(...)`, scoped to
  `browser-main-content` to avoid matching the file tree.
