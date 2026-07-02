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

## Tech Stack

- **Runtime**: Electron 40, React 19, TypeScript
- **Build**: Electron Forge + Vite (configs: `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.mts`)
- **Styling**: Tailwind CSS 4 (CSS-first config in `src/index.css`, Typography plugin for Markdown)
- **Markdown**: react-markdown + remark-gfm + remark-math + rehype-katex + mermaid
- **Editor**: CodeMirror 6 (`src/components/CodeMirrorEditor.tsx`)
- **Testing**: Vitest (node environment), tests in `tests/`, fixtures in `tests/fixtures/`

## Building and Package Management

We use **Yarn Classic (Yarn 1.x)** to manage packages — the `yarn.lock` is in the `# yarn lockfile v1` format. Use Yarn commands (`yarn add`, `yarn install`, etc.) rather than direct npm commands, and do **not** upgrade to Yarn Berry (Yarn 2+): it uses an incompatible lockfile format and config layout, and a partial migration once left stray `.yarnrc.yml` / `.yarn/` artifacts in this repo (since removed).

## End-to-End (Playwright) Tests

The Playwright e2e tests (`tests/e2e/`) launch the **packaged** Electron build from `.vite/build/` — they do **not** run against source directly.

⚠️ **The tests do not force a recompile.** `tests/e2e/global-setup.ts` only builds when the bundle is *missing*; it does not detect stale output. So after editing any app source (`src/`, the `vite.*.config` files, `index.html`, etc.), you must rebuild before running the e2e tests or they will silently run against the **old** code:

```
yarn package    # rebuilds .vite/build/ + .vite/renderer/
```

Forgetting this produces baffling failures where a fix (or a test selector that depends on a renderer change) appears not to work even though the source is correct. Test-only changes under `tests/` do **not** need a rebuild.

Never run m Playwright tests yourself. If you need me to run a Playwright test to check something, stop what you're doing, and ask me to run it for you. You're free to run any other unit tests however, just not the Playright ones.

## Git Commits

Never commit changes to the 'git' repository yourself, unless you're asked to.



