# MkBrowser - AI Coding Instructions

## Project Overview

MkBrowser is an Electron 40 desktop app (Vite + TypeScript + React 19 + Tailwind CSS 4) that functions as a file explorer with **inline Markdown rendering**. It displays one folder level at a time with expandable markdown cards—not a separate preview pane.

## Critical Architecture: Three-Process Electron Model

**⚠️ Never perform file operations directly in renderer code.**

| Process | File | Environment | Purpose |
|---------|------|-------------|---------|
| Main | `src/main.ts` | Node.js | File system ops, IPC handlers, window management |
| Preload | `src/preload.ts` | Bridge | Exposes `window.electronAPI` via `contextBridge` |
| Renderer | `src/App.tsx` | Browser | React UI, NO direct Node.js access |

**Data Flow:**
```
Renderer → window.electronAPI.method() → ipcRenderer.invoke('channel') 
→ Main process handler → fs operations → returns to renderer
```

### Adding New IPC Handlers (3-file change)

1. **Main** (`src/main.ts`): Add handler in `setupIpcHandlers()`:
   ```typescript
   ipcMain.handle('my-channel', async (_event, arg: string): Promise<ReturnType> => { ... });
   ```
2. **Preload** (`src/preload.ts`): Expose via `contextBridge.exposeInMainWorld`
3. **Types** (`src/global.d.ts`): Update `ElectronAPI` interface

## State Management: useSyncExternalStore

Uses React's `useSyncExternalStore`—no Redux/Context needed. See `src/store/`.

- **Types**: `src/store/types.ts` — `ItemData`, `AppState`
- **Actions & hooks**: `src/store/store.ts` — `upsertItem`, `setItemExpanded`, `useItems`, `useItem`
- Items stored in `Map<path, ItemData>` for O(1) lookup
- Components subscribe to specific slices via selector hooks (e.g., `useItem(path)`)

**Pattern**: Actions create new state objects to trigger React re-renders:
```typescript
const newItems = new Map(state.items);
newItems.set(path, updatedItem);
state = { ...state, items: newItems };
emitChange();
```

## Developer Workflow

```bash
# Development (Linux REQUIRES sandbox disabled)
yarn start:linux

# Standard (Windows/Mac)
yarn start

# Build .deb package
./build.sh && ./install.sh
```

## Tailwind CSS 4 Patterns

Uses CSS-first config in `src/index.css` (no `tailwind.config.js`).

**Markdown rendering** — always use:
```tsx
<article className="prose prose-invert prose-sm max-w-none">
  <Markdown>{content}</Markdown>
</article>
```

**Color palette**: Dark theme with `slate-900/slate-800`. Folders: `amber-500`. Markdown: `blue-400`.

## Key Implementation Details

- **Hidden files**: Filtered in `read-directory` handler (files starting with `.`)
- **Sorting**: Configurable via `AppSettings.sortOrder` and `foldersOnTop`
- **Config**: `~/.config/mk-browser/config.yaml` (uses `js-yaml`)
- **Content caching**: `ItemData.content` + `contentCachedAt` to avoid re-reads
- **Selection**: `ItemData.isSelected` drives checkbox state for multi-select operations

## Component Patterns

| Component | Purpose |
|-----------|---------|
| `src/components/entries/FolderEntry.tsx` | Clickable folder rows with navigation |
| `src/components/entries/MarkdownEntry.tsx` | Expandable cards with inline content + editing |
| `src/components/entries/FileEntry.tsx` | Static non-markdown files |
| `src/components/dialogs/*` | Modal dialogs (Alert, Confirm, Create, Search, Export) |
| `src/components/views/*` | Full-page views (SearchResults, Settings) |

## Menu-Driven Actions

Edit menu operations (`Cut`, `Paste`, `Delete`, `Select All`) are sent from main process to renderer via IPC events:
```typescript
// main.ts sends
mainWindow.webContents.send('cut-items');

// App.tsx listens
window.electronAPI.onCutRequested(() => { cutSelectedItems(); });
```

---- 

## React Global State Management

see file: `<project>/docs/global-state.md`

## Mutiple-Select

We have a checkbox displaying in the header for each file or folder this application displays, to allow user to select one or more, for the purpose of cut-and-paste feature as well as for file/folder delete functions. The `Edit` Menu on the Main application menu is where the multiple-select functions are run from. 

An item will appear with it's checkbox checked if the 'ItemData' property named 'isSelected' is set to true.

