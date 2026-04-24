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




