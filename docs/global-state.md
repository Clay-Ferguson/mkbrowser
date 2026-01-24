# Global State Management

This document describes the global state management architecture used in MkBrowser.

## Overview

MkBrowser uses React's `useSyncExternalStore` hook for global state management. This is a modern, pure-React approach that provides:

- **Selector-based subscriptions** - Components only re-render when their specific slice of state changes
- **No Provider wrapping** - Cleaner component tree without context provider nesting
- **Fine-grained reactivity** - Better performance than Context API for frequently changing state

## Architecture

### File Structure

```
src/store/
├── index.ts      # Public exports
├── store.ts      # Store implementation, actions, and hooks
└── types.ts      # TypeScript interfaces and helper functions
```

## Types

### ItemData

Represents a file or folder item that has been encountered during browsing. Items are stored in a `Map` keyed by their full file path (similar to Java's `HashMap`).

```typescript
interface ItemData {
  path: string;           // Full path to the file/folder (unique key)
  name: string;           // File name without path
  isDirectory: boolean;   // Whether this is a directory
  modifiedTime: number;   // Last modified timestamp (ms since epoch)
  isSelected: boolean;    // Selection state for checkboxes (default: false)
  isExpanded: boolean;    // Whether the file's content is expanded (visible)
  content?: string;       // Cached content for markdown files
  contentCachedAt?: number; // Timestamp when content was cached
  editing?: boolean;      // Whether file is currently being edited
}
```

### AppState

The root state object containing all global state.

```typescript
interface AppState {
  items: Map<string, ItemData>;  // All encountered files/folders
}
```

## Actions

Actions are functions that modify the store state. They create new state objects to ensure React detects changes.

### upsertItem

Add or update a single item in the store.

```typescript
upsertItem(path: string, name: string, isDirectory: boolean, modifiedTime: number): void
```

If the item already exists and its `modifiedTime` hasn't changed, cached content is preserved. If the file has been modified since content was cached, the cache is invalidated.

### upsertItems

Batch upsert multiple items at once. More efficient for directory loads.

```typescript
upsertItems(items: Array<{
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedTime: number;
}>): void
```

### setItemContent

Set the cached content for a markdown file. Automatically sets `contentCachedAt` to the item's current `modifiedTime`.

```typescript
setItemContent(path: string, content: string): void
```

### toggleItemSelected

Toggle the `isSelected` state of an item.

```typescript
toggleItemSelected(path: string): void
```

### setItemSelected

Explicitly set the `isSelected` state of an item.

```typescript
setItemSelected(path: string, isSelected: boolean): void
```

### setItemEditing

Set the `editing` state of an item. Used by the in-place markdown editing feature. See [editing-flow.md](./editing-flow.md) for details.

```typescript
setItemEditing(path: string, editing: boolean): void
```

### getItem

Get an item by path (direct access, not a hook).

```typescript
getItem(path: string): ItemData | undefined
```

### isCacheValid

Check if cached content is valid for an item. Returns `true` if the item has content and it was cached at or after the file's modification time.

```typescript
isCacheValid(path: string): boolean
```

## Hooks

Hooks subscribe React components to store state using `useSyncExternalStore`.

### useAppState

Subscribe to the entire app state.

```typescript
const state = useAppState();
// state.items is the Map of all items
```

### useItems

Subscribe to just the items Map.

```typescript
const items = useItems();
// items.get(path) returns ItemData or undefined
```

### useItem

Subscribe to a specific item by path.

```typescript
const item = useItem('/path/to/file.md');
// Returns ItemData | undefined
```

## Content Caching

The store implements smart caching for markdown file content to avoid redundant file reads.

### How It Works

1. **Directory Load**: When a directory is loaded, `App.tsx` calls `upsertItems()` with all entries including their `modifiedTime` from the file system.

2. **Cache Check**: When `MarkdownEntry` renders, it calls `isCacheValid(path)` to check if cached content exists and is still valid.

3. **Cache Hit**: If `contentCachedAt >= modifiedTime`, the cached content is used immediately without reading from disk.

4. **Cache Miss**: If no cache exists or the file has been modified since caching:
   - The component reads the file via `window.electronAPI.readFile()`
   - Content is stored via `setItemContent(path, content)`
   - `contentCachedAt` is set to the current `modifiedTime`

5. **Cache Invalidation**: If an item is upserted with a newer `modifiedTime` than its `contentCachedAt`, the cache is automatically invalidated (content and contentCachedAt are cleared).

### Benefits

- Files are only read once per modification
- Navigating back to previously viewed directories uses cached content
- External file modifications are detected via `modifiedTime` comparison

## Usage Examples

### Populating the Store

```typescript
import { upsertItems } from './store';

// After loading directory entries from the file system
const files = await window.electronAPI.readDirectory(currentPath);

upsertItems(
  files.map((file) => ({
    path: file.path,
    name: file.name,
    isDirectory: file.isDirectory,
    modifiedTime: file.modifiedTime,
  }))
);
```

### Reading Cached Content

```typescript
import { useItem, setItemContent, isCacheValid } from './store';

function MarkdownEntry({ entry }: { entry: FileEntry }) {
  const item = useItem(entry.path);

  useEffect(() => {
    const loadContent = async () => {
      if (isCacheValid(entry.path)) {
        return; // Use cached content
      }

      const content = await window.electronAPI.readFile(entry.path);
      setItemContent(entry.path, content);
    };

    loadContent();
  }, [entry.path, entry.modifiedTime]);

  return <Markdown>{item?.content || ''}</Markdown>;
}
```

### Selection State (Future Use)

```typescript
import { useItem, toggleItemSelected } from './store';

function SelectableItem({ path }: { path: string }) {
  const item = useItem(path);

  return (
    <input
      type="checkbox"
      checked={item?.isSelected ?? false}
      onChange={() => toggleItemSelected(path)}
    />
  );
}
```

## Files Modified for Global State

### Created

| File | Purpose |
|------|---------|
| `src/store/types.ts` | TypeScript interfaces (`ItemData`, `AppState`) and `createItemData()` helper |
| `src/store/store.ts` | Store implementation with actions and hooks |
| `src/store/index.ts` | Public exports |

### Modified

| File | Changes |
|------|---------|
| `src/global.d.ts` | Added `modifiedTime: number` to `FileEntry` interface; added `writeFile` to `ElectronAPI` |
| `src/main.ts` | Added `stat.mtimeMs` retrieval for each file/folder; removed inline markdown reading; added `write-file` IPC handler |
| `src/preload.ts` | Added `writeFile` to exposed API |
| `src/App.tsx` | Added `upsertItems()` call after directory load |
| `src/components/MarkdownEntry.tsx` | Integrated with store for content caching; added in-place editing UI |

## Design Decisions

### Why useSyncExternalStore?

- **Pure React**: No external dependencies required
- **Performance**: Components subscribe to specific slices, avoiding unnecessary re-renders
- **Simplicity**: No Provider components needed in the tree
- **Flexibility**: Easy to add new state slices without refactoring

### Why Map Instead of Object?

Using `Map<string, ItemData>` instead of a plain object provides:

- Guaranteed key ordering (insertion order)
- Better performance for frequent additions/deletions
- Built-in `size` property
- Cleaner iteration with `for...of`
- No prototype pollution concerns

### Why Cache at Component Level?

Content loading happens in `MarkdownEntry` rather than during directory load because:

- Only markdown files need content loaded
- Deferred loading improves initial render time
- Component can show loading state while fetching
- Cache validation happens at render time with fresh `modifiedTime`
