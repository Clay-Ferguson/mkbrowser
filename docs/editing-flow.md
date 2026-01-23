# Markdown Editing Feature

This document describes the in-place markdown editing feature in MkBrowser.

## Overview

MkBrowser allows users to edit markdown files directly in the browser without leaving the application. Key characteristics:

- **In-place editing** - The rendered markdown is replaced with a textarea for editing
- **Multiple file editing** - Users can have multiple files open for editing simultaneously
- **Navigation while editing** - Users can browse to different folders while files are being edited
- **Per-file editing state** - Each file tracks its own editing state independently

## Architecture

### State Management

The editing feature integrates with the existing global state store. The `ItemData` interface was extended with an `editing` property:

```typescript
interface ItemData {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedTime: number;
  isSelected: boolean;
  content?: string;
  contentCachedAt?: number;
  editing?: boolean;        // NEW: Whether file is currently being edited
}
```

The `editing` flag is stored per-item, enabling multiple files to be edited concurrently. When a user navigates away and returns, any files marked as `editing: true` will still show the editor.

### Store Actions

A new action was added to toggle editing state:

```typescript
setItemEditing(path: string, editing: boolean): void
```

This updates the `editing` property on the specified item and triggers a store update, causing subscribed components to re-render.

### Electron IPC

A new IPC channel was added to write file content:

**Main Process** (`src/main.ts`):
```typescript
ipcMain.handle('write-file', async (_event, filePath: string, content: string): Promise<boolean> => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Error writing file:', error);
    return false;
  }
});
```

**Preload** (`src/preload.ts`):
```typescript
writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content)
```

**Type Definition** (`src/global.d.ts`):
```typescript
interface ElectronAPI {
  // ... existing methods
  writeFile: (filePath: string, content: string) => Promise<boolean>;
}
```

## Component Flow

### MarkdownEntry Component

The `MarkdownEntry` component handles both display and editing modes:

```
┌─────────────────────────────────────────────────────────┐
│  Header Bar                                             │
│  ┌──────┐ ┌──────────────────────────┐ ┌─────────────┐ │
│  │ Icon │ │ filename.md              │ │ Edit Button │ │
│  └──────┘ └──────────────────────────┘ └─────────────┘ │
├─────────────────────────────────────────────────────────┤
│  Content Area                                           │
│                                                         │
│  (Rendered Markdown)                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘

        ↓ Click Edit Button ↓

┌─────────────────────────────────────────────────────────┐
│  Header Bar                                             │
│  ┌──────┐ ┌──────────────────────┐ ┌────────┐ ┌──────┐ │
│  │ Icon │ │ filename.md          │ │ Cancel │ │ Save │ │
│  └──────┘ └──────────────────────┘ └────────┘ └──────┘ │
├─────────────────────────────────────────────────────────┤
│  Content Area                                           │
│  ┌─────────────────────────────────────────────────────┐│
│  │ (Textarea with raw markdown)                        ││
│  │                                                     ││
│  │                                                     ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### State Flow

```
User clicks Edit
       │
       ▼
handleEditClick()
       │
       ├─► setEditContent(content)     // Copy current content to local state
       │
       └─► setItemEditing(path, true)  // Mark file as editing in store
              │
              ▼
       Component re-renders with isEditing=true
              │
              ▼
       Textarea shown instead of Markdown
```

```
User clicks Save
       │
       ▼
handleSave()
       │
       ├─► setSaving(true)             // Show "Saving..." state
       │
       ├─► writeFile(path, content)    // Write to disk via Electron
       │         │
       │         ▼
       │   (File saved to disk)
       │
       ├─► setItemContent(path, content)  // Update store cache
       │
       ├─► setItemEditing(path, false)    // Exit editing mode
       │
       └─► setSaving(false)
              │
              ▼
       Component re-renders with isEditing=false
              │
              ▼
       Rendered Markdown shown with new content
```

```
User clicks Cancel
       │
       ▼
handleCancel()
       │
       ├─► setEditContent('')          // Clear local edit state
       │
       └─► setItemEditing(path, false) // Exit editing mode
              │
              ▼
       Component re-renders with isEditing=false
              │
              ▼
       Rendered Markdown shown (original content unchanged)
```

### Local vs Global State

The component uses both local React state and global store state:

| State | Storage | Purpose |
|-------|---------|---------|
| `editContent` | Local (`useState`) | Current textarea content while editing |
| `saving` | Local (`useState`) | Loading state during save operation |
| `loading` | Local (`useState`) | Loading state during initial content fetch |
| `item.editing` | Global (store) | Whether file is in edit mode |
| `item.content` | Global (store) | Cached markdown content |

Local state is used for ephemeral UI state that doesn't need to persist across navigation. Global state is used for data that should persist as users browse.

## Files Modified

### Store Layer

| File | Changes |
|------|---------|
| `src/store/types.ts` | Added `editing?: boolean` to `ItemData` interface |
| `src/store/store.ts` | Added `setItemEditing()` action |
| `src/store/index.ts` | Exported `setItemEditing` |

### Electron Layer

| File | Changes |
|------|---------|
| `src/main.ts` | Added `write-file` IPC handler |
| `src/preload.ts` | Added `writeFile` to exposed API |
| `src/global.d.ts` | Added `writeFile` type to `ElectronAPI` |

### Component Layer

| File | Changes |
|------|---------|
| `src/components/MarkdownEntry.tsx` | Added edit UI, save/cancel handlers, textarea |

### Build Configuration

| File | Changes |
|------|---------|
| `vite.renderer.config.mts` | Added `server.watch.ignored` for data folders |

## Development Notes

### Vite HMR and Data Folders

When editing markdown files that are inside the project directory (e.g., `demo-data/`), Vite's file watcher will detect the change and trigger a hot module reload, resetting the application state.

To prevent this, data folders must be excluded from Vite's watch:

```typescript
// vite.renderer.config.mts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: ['**/demo-data/**'],
    },
  },
});
```

Add additional patterns to the `ignored` array for other data directories.

### Why Local State for Edit Content?

The `editContent` is stored in local component state rather than the global store because:

1. **Isolation** - Editing changes shouldn't affect other components until saved
2. **Simplicity** - No need to track "dirty" state in the store
3. **Cancel behavior** - Discarding changes is simple (just clear local state)
4. **Performance** - Typing in the textarea doesn't trigger global re-renders

### Why Global State for Editing Flag?

The `editing` boolean is stored in the global store because:

1. **Persistence across navigation** - Users can browse away and return to find their editor still open
2. **Multiple editors** - Each file independently tracks its editing state
3. **Future features** - Could show indicators of which files have unsaved changes

## Usage Example

```typescript
import { useItem, setItemContent, setItemEditing } from '../store';

function MarkdownEntry({ entry }: { entry: FileEntry }) {
  const item = useItem(entry.path);
  const [editContent, setEditContent] = useState('');

  const isEditing = item?.editing ?? false;
  const content = item?.content ?? '';

  const handleEdit = () => {
    setEditContent(content);
    setItemEditing(entry.path, true);
  };

  const handleSave = async () => {
    const success = await window.electronAPI.writeFile(entry.path, editContent);
    if (success) {
      setItemContent(entry.path, editContent);
      setItemEditing(entry.path, false);
    }
  };

  const handleCancel = () => {
    setEditContent('');
    setItemEditing(entry.path, false);
  };

  if (isEditing) {
    return (
      <div>
        <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} />
        <button onClick={handleCancel}>Cancel</button>
        <button onClick={handleSave}>Save</button>
      </div>
    );
  }

  return <Markdown>{content}</Markdown>;
}
```

## Future Considerations

### Unsaved Changes Warning

Currently, if a user navigates away while editing, their changes are lost (the `editContent` local state is unmounted). Potential improvements:

- Store `editContent` in global state to preserve across navigation
- Add a "dirty" flag to warn users before navigating away
- Auto-save drafts to localStorage

### Keyboard Shortcuts

Consider adding:
- `Ctrl+S` / `Cmd+S` to save
- `Escape` to cancel
- `Ctrl+E` / `Cmd+E` to toggle edit mode

### Syntax Highlighting

The textarea could be enhanced with:
- Line numbers
- Markdown syntax highlighting
- Live preview panel
