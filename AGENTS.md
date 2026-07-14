# MkBrowser Application - Notes for AI Agents

## Architecture (Electron Three-Process Model)

MkBrowser is an Electron desktop app for folder browsing with inline Markdown rendering. It enforces a strict IPC boundary:

| Process | File | Responsibility |
|---------|------|----------------|
| Main | `src/main.ts` | File system, IPC handlers, native menus |
| Preload | `src/preload.ts` | Exposes `window.electronAPI` to renderer |
| Renderer | `src/App.tsx` | React UI — **no Node.js imports allowed** |

**Data flow**: Renderer → `api.*` (`src/services/api.ts`) → `window.electronAPI.*` → `ipcRenderer.invoke` → Main process → Node.js fs → result returned to renderer.

## The API Layer (IPC Boundary)

Renderer code (components, hooks, utils) must reach the preload bridge through **`src/services/api.ts`**, not `window.electronAPI` directly:
- `import { api } from '../services/api'` — typed `api` is a Proxy that forwards lazily to the live `window.electronAPI`. Call `api.readFile(...)`, etc. (method names match the `ElectronAPI` interface).
- `getApi()` returns `window.electronAPI | undefined` for the rare case the bridge may be absent (e.g. unit tests under Node, the `pathUtil.ts` `'/'` fallback).
- Only `src/preload.ts` (defines the bridge) and `src/services/api.ts` (the one accessor) should name `window.electronAPI`.

This isolates the IPC surface in one module, decoupling components from the preload global and making them unit-testable by mocking the module (`vi.mock('../services/api')`) instead of a browser global.

## Adding IPC Handlers (Three-File Sync)

Every new file system operation requires changes in three files kept in sync:
1. `src/main.ts` — `ipcMain.handle('handler-name', ...)` implementation
2. `src/preload.ts` — method in `contextBridge.exposeInMainWorld`
3. `src/types/shared.ts` — type signature in the `ElectronAPI` interface

Then call it from the renderer via `api.*` (see above). `src/global.d.ts` only declares the `window.electronAPI` global and re-exports shared types — it is not edited per-handler.

## State Management (Zustand, single store)

State lives in a **single Zustand store** (`src/store/`), composed via the slices pattern (full docs: `docs/technical_notes/DEVELOPER_GUIDE.md`):
- `core.ts` — creates `useAS` from `initialState` + every slice's `createXxxSlice(set, get)`; exports `getState()` for non-reactive reads
- slice files (`items.ts`, `search.ts`, `settings.ts`, `view.ts`, `calendar.ts`, `indexTree.ts`, `aiConfig.ts`, `image.ts`) — actions defined inside the store, plus thin wrapper functions and pure getters (`scroll.ts` is a deliberate non-reactive module-level Map)
- `index.ts` — the barrel and single public import surface (re-exports `useAS`, all slices + types)
- Store type interfaces (`ItemData`, `AppState`, `AppSettings`, etc.) live in `src/shared/types.ts`

Components read with direct selectors — `useAS(s => s.currentPath)` — wrapping derived object/array selectors in `useShallow`; there are no per-field wrapper hooks. Items are stored in `Map<path, ItemData>` for O(1) lookups. Always create **new objects** when mutating state to trigger React re-renders. Do **not** create additional Zustand stores — multi-field patches must stay atomic in the one store. Import `useAS` and actions from `../../store` (the `index.ts` barrel).

## Component Patterns

```
src/components/
  entries/         # File list item renderers per type: MarkdownEntry, FolderEntry,
                   #   TextEntry, ImageEntry, GenericEntry (+ MarkdownView, FullscreenImageViewer)
    common/        # Shared building blocks (EntryShell, EntryActionBar, RenameInput,
                   #   SelectionCheckbox) and hooks (useEntry, useEntryCore, useRename,
                   #   useDelete, useContentLoader, useEditMode, useAiRewrite, …)
  dialogs/         # Modal dialogs (ConfirmDialog pattern — see .claude/skills/dialogs/SKILL.md)
  views/           # Full-page views: BrowseView, SettingsView, AISettingsView,
                   #   SearchResultsView, FolderAnalysisView, FolderGraphView, etc.
```

Entry components compose shared hooks from `entries/common/` and render `EntryActionBar`, `RenameInput`, `SelectionCheckbox` for consistent UX. New entry types should follow this composition pattern.

## Menu → IPC → Renderer Event Pattern

Native menu actions (cut, paste, delete, etc.) flow as:
1. `src/main.ts` — menu click sends event via `mainWindow.webContents.send('event-name')`
2. `src/preload.ts` — exposes `onEventRequested(callback)` listener
3. `src/App.tsx` — registers listener, calls store actions

## React Compiler — no `useCallback` / `useMemo`

The renderer uses the **React Compiler** (`babel-plugin-react-compiler` in `vite.renderer.config.mts`) for automatic memoization. All `useCallback`/`useMemo` calls were removed from `src/` — **never add them back**, and never add an `eslint-disable` for any `react-hooks/*` rule (a suppression makes the compiler silently skip the whole component, and it's the one bailout cause lint can't catch).

The compiler **bails out** (silently skips a component/hook, leaving it fully de-memoized) on constructs it doesn't support — `try/finally`, conditionals/`?.` inside try/catch, ref writes during render, mutating module globals, `this` expressions. The fix is always to restructure: promise `.catch().finally()` chains, or **module-level helper functions** (the compiler doesn't compile plain functions, so anything goes there).

Three guards enforce this: the `react-hooks/todo` + `react-hooks/syntax` ESLint rules (errors in `eslint.config.mjs`); **`compiler-coverage.mjs`** at the repo root — the source of truth, since it runs the exact compiler version the build uses; and **`bundle-fingerprint.mjs`**, which runs *after* packaging (in `build.sh` and `playwright-test.sh`) and fails the build if the built renderer bundle contains less React Compiler output (`memo_cache_sentinel` occurrences) than the number of functions `compiler-coverage.mjs` compiled — the only check that can catch the compiler being silently configured out of the Vite pipeline (e.g. a broken `vite.renderer.config.mts` wiring). `node compiler-coverage.mjs` scans all of `src/` and exits 1 on any bailout (`pre-package.sh` runs it as a build gate — shared by `build.sh` and `playwright-test.sh`); `node compiler-coverage.mjs <file>` gives a verbose per-function report. After touching components/hooks, confirm the file still reports all `OK`. Full details, fix patterns, and the exhaustive-deps escape patterns: `docs/technical_notes/DEVELOPER_GUIDE.md` § React Compiler.

## Tech Stack

- **Runtime**: Electron 43, React 19, TypeScript
- **Build**: Electron Forge + Vite 8 / Rolldown (configs: `vite.main.config.mts`, `vite.preload.config.mts`, `vite.renderer.config.mts`)
- **Styling**: Tailwind CSS 4 (CSS-first config in `src/index.css`, Typography plugin for Markdown)
- **Markdown**: react-markdown + remark-gfm + remark-math + rehype-katex + mermaid
- **Editor**: CodeMirror 6 (`src/components/CodeMirrorEditor.tsx`)
- **Testing**: Vitest (node environment), tests in `tests/`, fixtures in `tests/fixtures/`

## Building and Package Management

We use **npm** to manage packages — `package-lock.json` is the lockfile and is committed. Do **not** use Yarn (this repo migrated off Yarn Classic in July 2026): a stray `yarn install` would recreate `yarn.lock` and ignore the npm lockfile. `.gitignore` ignores all Yarn artifacts (`yarn.lock`, `.yarn/`, `.yarnrc.yml`) so they can't sneak back in.

### `dependencies` vs `devDependencies` — this distinction decides what ships

The renderer and preload bundles inline everything they import, so their packages are **build-time inputs**: they belong in `devDependencies`. The main process is the opposite — `vite.main.config.mts` externalizes **all** of `node_modules` from `main.js` (Rolldown's ESM→CJS interop silently broke `fdir` and `rrule` when they *were* bundled; letting Node's own loader resolve them makes that whole class of bug impossible), so it loads its packages from `node_modules` **at runtime**, and they must physically ship inside the asar.

`@electron/packager` copies `node_modules` and prunes `devDependencies` (`prune` defaults to `true`), so:

> **`dependencies` = exactly what the main process loads at runtime. Everything else is a `devDependency`.**

That's the whole mechanism — `package.json` is the single source of truth for what ships, and there is no separate list to maintain. Two things follow:

- **Adding a package the main process imports?** It must be in `dependencies` (`npm install <pkg>` does this by default — correct). Leave it in `devDependencies` and it is pruned out: dev works, `npm run package` succeeds, and the packaged app throws `Cannot find module` when that code path first runs.
- **Peer dependencies count too.** Pruning does not follow peer deps — packager's pruner (flora-colossus) walks only `dependencies`/`optionalDependencies`, never `peerDependencies`. `langchain` is in `dependencies` for exactly this reason: nothing of ours imports it, but `deepagents` peers on it. npm *installs* peers automatically, so dev always works — but an undeclared peer is still pruned from the packaged app, which is exactly the invisible-until-runtime failure mode described above.

`forge.config.ts` must therefore define its own `packagerConfig.ignore` (keeping `.vite`, `package.json`, `node_modules`), because the Forge Vite plugin otherwise sets `ignore: (file) => !file.startsWith('/.vite')` — it assumes 100% bundling and would drop `node_modules` entirely. The plugin only installs that default when the config does not define one, so ours takes over cleanly.

`exiftool-vendored` is the one special case: its ~22 MB vendored perl distribution (`exiftool-vendored.pl`, an optional prod dep) is deleted in an `afterPrune` hook. Perl cannot read files inside the asar, so `src/main/exifUtil.ts` runs the **system** `exiftool` from the PATH — a documented user prerequisite; without it only EXIF saving fails. Note `ignore` cannot exclude it: packager's copy filter routes any path that *is* a module to the pruner and never consults `ignore`.

**Verifying a packaging change:** package it and launch it (`npm run package && out/mk-browser-linux-x64/mk-browser`). A missing runtime dep is invisible to lint, unit tests, and `npm run package` — only the packaged app shows it.

## End-to-End (Playwright) Tests

The Playwright e2e tests (`tests/e2e/`) launch the **packaged** Electron build from `.vite/build/` — they do **not** run against source directly.

⚠️ **The tests do not force a recompile.** `tests/e2e/global-setup.ts` only builds when the bundle is *missing*; it does not detect stale output. So after editing any app source (`src/`, the `vite.*.config` files, `index.html`, etc.), you must rebuild before running the e2e tests or they will silently run against the **old** code:

```
npm run package    # rebuilds .vite/build/ + .vite/renderer/
```

Forgetting this produces baffling failures where a fix (or a test selector that depends on a renderer change) appears not to work even though the source is correct. Test-only changes under `tests/` do **not** need a rebuild.

Never run m Playwright tests yourself. If you need me to run a Playwright test to check something, stop what you're doing, and ask me to run it for you. You're free to run any other unit tests however, just not the Playright ones.

## Grepping (UTF-8)

Some source files (e.g. `FolderGraphView.tsx`) contain valid UTF-8 punctuation (`—`, `→`, `…`, `•`, `·`). In a single-byte locale (`LC_ALL=C`/POSIX) `grep` mislabels these files "binary" and silently skips them. Always search with `grep -a` (a.k.a. `--text`) so matches in those files aren't dropped.

## Git Commits

Never commit changes to the 'git' repository yourself, unless you're asked to.

## TypeScript Language Version

Note: We're not yet on the latest vesion of TypeScript, and the file named `TypeScript7-Conversion-Blocker.md` describes why we aren't

## Adding new NPM Packages

*NEVER* add a new package/dependency without first asking the human to authorize it.



