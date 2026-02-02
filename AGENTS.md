

# MkBrowser AI Coding Instructions

## Architecture Overview

MkBrowser is an Electron desktop app for browsing folders with inline Markdown rendering. It follows a strict **three-process architecture**:

| Process | File | Responsibility |
|---------|------|----------------|
| Main | `src/main.ts` | File system, IPC handlers, native menus |
| Preload | `src/preload.ts` | Exposes `window.electronAPI` to renderer |
| Renderer | `src/App.tsx` | React UI only, no direct fs access |

**Critical Rule**: Renderer code must NEVER import Node.js modules. All file operations go through `window.electronAPI.*` calls.

## Adding New IPC Handlers

When adding file system functionality, update these files in sync:
1. `src/main.ts` - Add `ipcMain.handle('handler-name', ...)` 
2. `src/preload.ts` - Add method in `contextBridge.exposeInMainWorld`
3. `src/global.d.ts` - Add type signature to `ElectronAPI` interface

Example pattern in main.ts:
```typescript
ipcMain.handle('my-operation', async (_event, arg: string): Promise<Result> => {
  // Node.js file operations here
});
```

## State Management

State lives in `src/store/` using React's `useSyncExternalStore` (no Redux):
- `store.ts` - State mutations and subscriptions
- `types.ts` - TypeScript interfaces (`ItemData`, `AppState`, etc.)
- `index.ts` - Public exports (actions and hooks)

Items stored in `Map<path, ItemData>` for O(1) lookups. Always create new objects for state updates to trigger re-renders.

Key item fields: `isSelected`, `isExpanded`, `editing`, `content`, `contentCachedAt`

## Component Organization

```
src/components/
  entries/       # File list item renderers (MarkdownEntry, FolderEntry, etc.)
  dialogs/       # Modal dialogs (SearchDialog, CreateFileDialog, etc.)
  views/         # Full-page views (SettingsView, SearchResultsView)
```

Entry components render individual items in the file list. They receive `ItemData` and handle expand/collapse, edit mode, and selection.

## Styling

Uses **Tailwind CSS 4** with CSS-first configuration in `src/index.css`. The Typography plugin styles rendered Markdown content.

Content width is controlled by settings: `narrow`, `medium`, `wide`, `full` (see `getContentWidthClasses` in App.tsx).

## Development Commands

```bash
npm install              # Install dependencies
npm run start:linux      # Run on Linux (requires sandbox disabled)
npm start                # Run on Windows/Mac
npm run lint             # ESLint check
npm run make             # Build distributable
```

## Key Patterns

- **Menu actions** trigger IPC events that the renderer listens to (e.g., `onCutRequested`, `onPasteRequested`)
- **Content caching**: Markdown content cached in `ItemData.content` with `contentCachedAt` timestamp for invalidation
- **Multiple concurrent edits**: Each file tracks its own `editing` state independently
- **Search definitions**: Saved searches stored in settings with `literal`, `wildcard`, or `advanced` modes

## File Naming Convention

Demo data uses ordinal prefixes like `00010_`, `00020_` for manual ordering. The "Renumber Files" feature adjusts these prefixes.
