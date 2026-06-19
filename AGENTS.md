# MkBrowser Application - Notes for AI Agents

## Architecture (Electron Three-Process Model)

MkBrowser is an Electron desktop app for folder browsing with inline Markdown rendering. It enforces a strict IPC boundary:

| Process | File | Responsibility |
|---------|------|----------------|
| Main | `src/main.ts` | File system, IPC handlers, native menus |
| Preload | `src/preload.ts` | Exposes `window.electronAPI` to renderer |
| Renderer | `src/App.tsx` | React UI — **no Node.js imports allowed** |

**Data flow**: Renderer → `window.electronAPI.*` → `ipcRenderer.invoke` → Main process → Node.js fs → result returned to renderer.

## Adding IPC Handlers (Three-File Sync)

Every new file system operation requires changes in three files kept in sync:
1. `src/main.ts` — `ipcMain.handle('handler-name', ...)` implementation
2. `src/preload.ts` — method in `contextBridge.exposeInMainWorld`
3. `src/global.d.ts` — type signature in `ElectronAPI` interface

## State Management (No Redux)

State uses a custom store (`src/store/`) built on `useSyncExternalStore`:
- `types.ts` — interfaces (`ItemData`, `AppState`, `AppSettings`, etc.)
- `store.ts` — mutations, subscriptions, hooks (`useItem`, `useItems`, `useCurrentView`, etc.)
- `index.ts` — public API re-exports (actions like `setItemEditing`, hooks like `useSettings`)

Items are stored in `Map<path, ItemData>` for O(1) lookups. Always create **new objects** when mutating state to trigger React re-renders. Import actions and hooks from `../../store` (the `index.ts` barrel).

## Component Patterns

```
src/components/
  entries/         # File list item renderers per type
    common/        # Shared hooks: useEntryCore, useRename, useDelete, useContentLoader, useEditMode
    MarkdownEntry.tsx, FolderEntry.tsx, TextEntry.tsx, ImageEntry.tsx, FileEntry.tsx
  dialogs/         # Modal dialogs (ConfirmDialog pattern — see .claude/skills/dialogs/SKILL.md)
  views/           # Full-page views: SettingsView, SearchResultsView, FolderAnalysisView
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

## Git Commits

Never commit changes to the 'git' repository yourself. Always let the human developer do the commits.



