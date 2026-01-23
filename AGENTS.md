# MkBrowser - AI Coding Agent Instructions

## Project Overview

MkBrowser is an Electron desktop app that functions as a hybrid file explorer and inline Markdown browser. It displays a single folder's contents at a time, rendering `.md` files **directly inline** within the file list—not in a separate preview pane.

**Tech Stack:** Electron 40 + Vite + TypeScript + React 19 + Tailwind CSS 4 (with Typography plugin)

## Architecture & Key Patterns

### Three-Process Electron Model (Critical!)

This app follows standard Electron architecture with strict process separation:

1. **Main Process** ([src/main.ts](../src/main.ts)): Node.js environment handling file system operations, window management, and IPC handlers
2. **Preload Script** ([src/preload.ts](../src/preload.ts)): Security bridge exposing `window.electronAPI` to renderer via `contextBridge`
3. **Renderer Process** ([src/App.tsx](../src/App.tsx)): React UI running in browser context with NO direct Node.js access

**⚠️ Never attempt file operations directly in renderer code.** All `fs` operations MUST go through IPC handlers in [main.ts](../src/main.ts) and be exposed via [preload.ts](../src/preload.ts).

### Core Data Flow Pattern

```
User clicks folder → App.tsx calls window.electronAPI.readDirectory(path) 
→ Preload forwards to ipcRenderer.invoke('read-directory') 
→ Main process IPC handler reads fs and returns FileEntry[] 
→ React renders entries with inline markdown content
```

The `FileEntry` interface (in [src/global.d.ts](../src/global.d.ts)) includes a `content?: string` field that is **pre-populated** in the main process for `.md` files—no lazy loading.

### Configuration Management

- Config stored at `~/.config/mk-browser/config.yaml` (Linux standard location)
- Uses `js-yaml` library to parse/serialize
- Current schema: `{ browseFolder: string }`
- Config dir created automatically via `ensureConfigDir()` in [main.ts](../src/main.ts)

## Developer Workflow

### Running the App

```bash
# Development mode (REQUIRED on Linux to disable sandbox)
yarn start:linux

# Standard Electron Forge commands (Windows/Mac)
yarn start
```

The `ELECTRON_DISABLE_SANDBOX=1` flag in `start:linux` is **essential** on Linux. Without it, the app may crash with sandbox errors.

### Building & Packaging

```bash
# Create distributable packages (.deb for Ubuntu)
./build.sh   # Wrapper for 'yarn make'

# Install the built .deb package
./install.sh
```

Build output goes to `./out/make/deb/x64/`. The [forge.config.ts](../forge.config.ts) is configured to **only build .deb packages** (not rpm/zip/squirrel).

### DevTools

DevTools automatically open in development mode (see [main.ts](../src/main.ts#L71-L73)):

```typescript
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  mainWindow.webContents.openDevTools();
}
```

## Styling & UI Conventions

### Tailwind CSS 4 + Typography

This project uses **Tailwind v4** (new CSS-first config in [src/index.css](../src/index.css)):

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

No `tailwind.config.js` file exists—everything is defined via `@theme` directives in index.css.

**For Markdown rendering:** Always wrap `<Markdown>` components with:

```tsx
<article className="prose prose-invert prose-sm max-w-none">
  <Markdown>{content}</Markdown>
</article>
```

- `prose-invert`: Dark mode optimized (entire app uses slate-900/slate-800 palette)
- `prose-sm`: Slightly smaller text for inline display
- `max-w-none`: Override default max-width to fill card container

### Component Visual Patterns

Refer to [App.tsx](../src/App.tsx#L203-L228) for the established patterns:

- **Folders**: Amber-500 folder icon, hover effect (`hover:bg-slate-750`), clickable rows
- **Markdown files**: Blue-400 file icon + card container with border, rendered content below filename
- **Regular files**: Slate-500 generic file icon, static row (no interaction)
- **Empty state**: Centered icon + message ("This folder is empty")

## Project-Specific Gotchas

### Hidden Files Are Filtered

The `read-directory` IPC handler skips files/folders starting with `.` ([main.ts](../src/main.ts#L114)):

```typescript
if (entry.name.startsWith('.')) continue;
```

This is intentional to reduce clutter. If you need to show hidden files, add a config option to toggle this behavior.

### Sorting Logic

Entries are sorted **directories first, then files**, alphabetically within each group ([main.ts](../src/main.ts#L139-L143)):

```typescript
fileEntries.sort((a, b) => {
  if (a.isDirectory && !b.isDirectory) return -1;
  if (!a.isDirectory && b.isDirectory) return 1;
  return a.name.localeCompare(b.name);
});
```

### No Tree View / Multi-Level Navigation

Unlike traditional file explorers, this app shows **one level at a time**. Navigation works via:

- Clicking folder rows to "drill down" (`navigateTo`)
- Back button to go up one level (`navigateUp`)
- Breadcrumb displays relative path from root

See [PROJECT_BRIEFING.md](../PROJECT_BRIEFING.md) for the original design rationale.

## Type Definitions & Global State

All shared types are in [src/global.d.ts](../src/global.d.ts):
- `AppConfig`: Config file schema
- `FileEntry`: File/folder metadata structure
- `ElectronAPI`: Full API surface exposed to renderer

The `window.electronAPI` global is available in all renderer code after preload injection.

## Vite Configuration Split

Electron Forge uses **three separate Vite configs**:
- [vite.main.config.ts](../vite.main.config.ts): Main process build
- [vite.preload.config.ts](../vite.preload.config.ts): Preload script build
- [vite.renderer.config.mts](../vite.renderer.config.mts): Renderer React app (includes React + Tailwind plugins)

Only modify the renderer config for UI library changes.

## Adding New IPC Handlers

Follow this pattern (example from [main.ts](../src/main.ts#L90-L98)):

1. Add handler in `setupIpcHandlers()`:
   ```typescript
   ipcMain.handle('my-channel', async (_event, arg: string): Promise<ReturnType> => {
     // Your logic here
   });
   ```

2. Expose in [preload.ts](../src/preload.ts):
   ```typescript
   myMethod: (arg: string) => ipcRenderer.invoke('my-channel', arg),
   ```

3. Update `ElectronAPI` interface in [global.d.ts](../src/global.d.ts)

4. Call from renderer:
   ```typescript
   const result = await window.electronAPI.myMethod(arg);
   ```

## React Global State Management

see file: `<project>/docs/global-state.md`
