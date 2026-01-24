# MkBrowser - AI Coding Instructions

## Project Overview

MkBrowser is an Electron desktop app (Electron 40 + Vite + TypeScript + React 19 + Tailwind CSS 4) that functions as a file explorer with **inline Markdown rendering**—not a separate preview pane. It displays one folder level at a time.

## Critical Architecture: Three-Process Electron Model

**⚠️ Never perform file operations directly in renderer code.**

| Process | File | Environment | Purpose |
|---------|------|-------------|---------|
| Main | [src/main.ts](../src/main.ts) | Node.js | File system ops, IPC handlers, window management |
| Preload | [src/preload.ts](../src/preload.ts) | Bridge | Exposes `window.electronAPI` via `contextBridge` |
| Renderer | [src/App.tsx](../src/App.tsx) | Browser | React UI, NO direct Node.js access |

**Data Flow Pattern:**
```
Renderer → window.electronAPI.method() → ipcRenderer.invoke('channel') 
→ Main process handler → fs operations → returns data to renderer
```

## Adding New IPC Handlers

1. Add handler in [src/main.ts](../src/main.ts) `setupIpcHandlers()`:
   ```typescript
   ipcMain.handle('my-channel', async (_event, arg: string): Promise<ReturnType> => { ... });
   ```
2. Expose in [src/preload.ts](../src/preload.ts)
3. Update `ElectronAPI` interface in [src/global.d.ts](../src/global.d.ts)

## State Management: useSyncExternalStore

Uses React's `useSyncExternalStore` (no Redux/Context). See [src/store/](../src/store/).

- **Types**: [src/store/types.ts](../src/store/types.ts) - `ItemData`, `AppState`
- **Actions & hooks**: [src/store/store.ts](../src/store/store.ts) - `upsertItem`, `setItemExpanded`, `useItems`, `useItem`
- Items stored in `Map<path, ItemData>` for O(1) lookup

## Developer Workflow

```bash
# Development (Linux REQUIRES this to avoid sandbox errors)
yarn start:linux

# Standard (Windows/Mac)
yarn start

# Build .deb package
./build.sh && ./install.sh
```

## Tailwind CSS 4 Patterns

Uses CSS-first config in [src/index.css](../src/index.css) (no `tailwind.config.js`).

**Markdown rendering** - always use:
```tsx
<article className="prose prose-invert prose-sm max-w-none">
  <Markdown>{content}</Markdown>
</article>
```

**Color palette**: Dark theme with slate-900/slate-800. Folders: amber-500. Markdown: blue-400.

## Key Implementation Details

- **Hidden files filtered**: Files starting with `.` are skipped in `read-directory` handler
- **Sorting**: Directories first, then alphabetical within each group
- **Config location**: `~/.config/mk-browser/config.yaml` (uses `js-yaml`)
- **Content caching**: `ItemData.content` + `contentCachedAt` to avoid re-reading unchanged files

## Component Patterns

- [src/components/FolderEntry.tsx](../src/components/FolderEntry.tsx) - Clickable folder rows
- [src/components/MarkdownEntry.tsx](../src/components/MarkdownEntry.tsx) - Expandable cards with inline content + editing
- [src/components/FileEntry.tsx](../src/components/FileEntry.tsx) - Static non-markdown files

---- 

## React Global State Management

see file: `<project>/docs/global-state.md`

## Mutiple-Select

We have a checkbox displaying in the header for each file or folder this application displays, to allow user to select one or more, for the purpose of cut-and-paste feature as well as for file/folder delete functions. The `Edit` Menu on the Main application menu is where the multiple-select functions are run from. 

An item will appear with it's checkbox checked if the 'ItemData' property named 'isSelected' is set to true.

