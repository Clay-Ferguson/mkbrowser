import { useShallow } from 'zustand/react/shallow';
import type { AppState, Bookmark, ItemData } from '../shared/types';
import { createItemData } from '../shared/types';
import { getTagsFromYaml } from '../shared/tagUtil';
import { splitFrontMatter, getPropsFromYaml } from '../shared/frontMatterUtil';
import { getParentPath, isPathInside, remapMovedPath } from '../renderer/pathUtil';
import { getState, useAS } from './core';
import type { StoreSet, StoreGet } from './core';

// ============================================================================
// Items - actions and hooks for the items Map
// ============================================================================

interface IncomingItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedTime: number;
  createdTime?: number;
  /** File size in bytes from the same stat as modifiedTime, when the caller has it */
  size?: number;
  aiHint?: string;
}

/**
 * True when the incoming item is a *different* file than the one already cached
 * at that path — i.e. the original was deleted and something else was created in
 * its place behind our back (git checkout, sync client, terminal). A changed
 * createdTime (birth time, which a plain edit never touches) or a file/folder
 * flip both mean identity changed, not just content.
 *
 * `createdTime` is only trusted when the caller actually supplies one; the
 * modifiedTime fallback is not an identity signal.
 */
function isReplacedFile(existing: ItemData, item: IncomingItem): boolean {
  if (existing.isDirectory !== item.isDirectory) return true;
  return item.createdTime !== undefined && item.createdTime !== existing.createdTime;
}

/**
 * Merge an incoming item with its existing store entry (if any), returning the
 * item to store. Shared merge rules for both upsertItem and upsertItems:
 * - Existing item: refresh metadata, invalidate cached content if the file has
 *   changed since it was cached, and replace aiHint only when one is supplied.
 * - Existing item that is really a *different* file at the same path: start over
 *   from a fresh entry, so no volatile flag survives the swap. A carried-over
 *   `isCut` would make the next paste move a file nobody cut, and a carried-over
 *   `isSelected` would make the next delete remove a file nobody selected.
 * - No existing item: create a fresh entry.
 */
function mergeItem(existing: ItemData | undefined, item: IncomingItem): ItemData {
  const createdTime = item.createdTime ?? item.modifiedTime;

  if (!existing || isReplacedFile(existing, item)) {
    return createItemData(item.path, item.name, item.isDirectory, item.modifiedTime, createdTime, item.aiHint);
  }

  const updatedItem: ItemData = {
    ...existing,
    name: item.name,
    isDirectory: item.isDirectory,
    modifiedTime: item.modifiedTime,
    createdTime,
    aiHint: item.aiHint ?? existing.aiHint,
  };

  // Invalidate cached content when the file on disk no longer matches the
  // state the content was read at: a *different* mtime (newer, or older after
  // a restore-from-backup — hence `!==`, not `>`), or a different size even
  // with an equal mtime (coarse-mtime filesystems can hide a same-timestamp
  // external edit; the size comparison catches most of those).
  if (existing.contentCachedAt !== undefined && (
    item.modifiedTime !== existing.contentCachedAt ||
    (item.size !== undefined && existing.contentCachedSize !== undefined && item.size !== existing.contentCachedSize)
  )) {
    updatedItem.content = undefined;
    updatedItem.contentCachedAt = undefined;
    updatedItem.contentCachedSize = undefined;
  }

  return updatedItem;
}

/**
 * Return a copy of `items` with every selection cleared, or null when nothing
 * is selected (so callers can skip the state write). Pure — shared by
 * clearAllSelections and the navigation actions in view.ts, which fold the
 * selection reset into the same atomic update as the path change.
 */
export function withSelectionsCleared(items: Map<string, ItemData>): Map<string, ItemData> | null {
  if (items.size === 0) return null;

  const newItems = new Map(items);
  let hasChanges = false;

  for (const [path, item] of newItems) {
    if (item.isSelected) {
      newItems.set(path, { ...item, isSelected: false });
      hasChanges = true;
    }
  }

  return hasChanges ? newItems : null;
}

/** Strip any trailing separators so prefix math lands on a segment boundary. */
function stripTrailingSep(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface ItemsSlice {
  upsertItems: (items: IncomingItem[]) => void;
  syncDirectoryItems: (dirPath: string, items: IncomingItem[]) => void;
  setItemContent: (path: string, content: string, modifiedTime: number, size?: number) => void;
  toggleItemSelected: (path: string) => void;
  toggleItemExpanded: (path: string) => void;
  setItemExpanded: (path: string, isExpanded: boolean) => void;
  setItemSelected: (path: string, isSelected: boolean) => void;
  clearAllSelections: () => void;
  selectItemsByPaths: (paths: string[]) => void;
  expandAllItems: () => void;
  collapseAllItems: () => void;
  cutSelectedItems: () => void;
  clearAllCutItems: () => void;
  renameItem: (oldPath: string, newPath: string, newName: string) => boolean;
  deleteItems: (paths: string[]) => void;
  clearCache: () => void;
  setItemEditing: (path: string, editing: boolean, goToLine?: number) => void;
  setItemReviewing: (path: string, reviewing: boolean, rewrittenContent?: string) => void;
  setItemEditContent: (path: string, editContent: string) => void;
  clearItemGoToLine: (path: string) => void;
  setItemRenaming: (path: string, renaming: boolean) => void;
  setHighlightItem: (path: string | null) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createItemsSlice(set: StoreSet, get: StoreGet): ItemsSlice {
  return {
    /**
     * Batch upsert multiple items at once. Purely additive: entries already in
     * the store are merged, never removed. Use it when the incoming items are
     * *not* a complete listing of one folder (ThreadView gathers entries from a
     * whole subtree, useEditMode refreshes a single file); for a directory load,
     * use syncDirectoryItems so vanished files get pruned.
     */
    upsertItems: (items) => {
      // Create new Map to ensure React detects the change
      const newItems = new Map(get().items);

      for (const item of items) {
        newItems.set(item.path, mergeItem(newItems.get(item.path), item));
      }

      set({ items: newItems });
    },

    /**
     * Apply a complete directory listing: upsert everything in it, then drop the
     * cached entries for direct children of `dirPath` that the listing no longer
     * contains (deleted or moved outside the app, or from another view).
     *
     * Without this the items Map only ever grows, and a ghost entry keeps its
     * volatile flags forever — a paste would try to move a file that no longer
     * exists, and delete-selected would act on paths the user can't even see.
     * A pruned folder takes its cached subtree with it, since none of those
     * descendants exist any more either.
     *
     * `items` may legitimately contain non-children (App passes each markdown
     * file's attachments alongside it); those are upserted but never considered
     * for pruning, which only ever looks at direct children of `dirPath`.
     */
    syncDirectoryItems: (dirPath, items) => {
      const newItems = new Map(get().items);
      let hasChanges = items.length > 0;

      for (const item of items) {
        newItems.set(item.path, mergeItem(newItems.get(item.path), item));
      }

      const listed = new Set(items.map(item => item.path));
      const parent = stripTrailingSep(dirPath);

      // Two passes: collect the vanished children first, then delete each one
      // together with anything cached beneath it.
      const vanished: string[] = [];
      for (const path of newItems.keys()) {
        if (!listed.has(path) && getParentPath(path) === parent) {
          vanished.push(path);
        }
      }

      for (const path of newItems.keys()) {
        if (vanished.some(root => isPathInside(root, path))) {
          newItems.delete(path);
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

      set({ items: newItems });
    },

    /**
     * Set the cached content for a markdown file. `modifiedTime` must be the
     * file's on-disk mtime captured atomically with the content (fstat with the
     * read, or the post-write stat on save) — never a wall-clock guess.
     *
     * The item's modifiedTime only moves forward: if a directory refresh has
     * already recorded a newer mtime than the content being committed (the read
     * started before an external change landed), the newer mtime is kept, so
     * contentCachedAt < modifiedTime and the stale content is immediately
     * cache-invalid instead of being poisoned as valid-at-the-newer-mtime.
     */
    setItemContent: (path, content, modifiedTime, size) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const fmParts = splitFrontMatter(content);
      const tags = fmParts ? getTagsFromYaml(fmParts.yamlStr).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) : [];
      const props = fmParts ? getPropsFromYaml(fmParts.yamlStr) : {};

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        content,
        modifiedTime: Math.max(existing.modifiedTime, modifiedTime),
        contentCachedAt: modifiedTime,
        contentCachedSize: size,
        tags,
        props,
      });

      set({ items: newItems });
    },

    /** Toggle the selected state of an item. */
    toggleItemSelected: (path) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        isSelected: !existing.isSelected,
      });

      set({ items: newItems });
    },

    /** Toggle the expanded state of an item. */
    toggleItemExpanded: (path) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        isExpanded: !existing.isExpanded,
      });

      set({ items: newItems });
    },

    /** Set the expanded state of an item explicitly. */
    setItemExpanded: (path, isExpanded) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        isExpanded,
      });

      set({ items: newItems });
    },

    /** Set the selected state of an item explicitly. */
    setItemSelected: (path, isSelected) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        isSelected,
      });

      set({ items: newItems });
    },

    /** Clear selection state for all items. */
    clearAllSelections: () => {
      const newItems = withSelectionsCleared(get().items);
      if (!newItems) return;

      set({ items: newItems });
    },

    /**
     * Select all items whose paths are in the provided array
     * (used for Select All in the current folder view).
     */
    selectItemsByPaths: (paths) => {
      const state = get();
      if (state.items.size === 0 || paths.length === 0) return;

      const pathSet = new Set(paths);
      const newItems = new Map(state.items);
      let hasChanges = false;

      for (const [path, item] of newItems) {
        if (pathSet.has(path) && !item.isSelected) {
          newItems.set(path, { ...item, isSelected: true });
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

      set({ items: newItems });
    },

    /** Expand all items (set isExpanded to true for all). */
    expandAllItems: () => {
      const state = get();
      if (state.items.size === 0) return;

      const newItems = new Map(state.items);
      let hasChanges = false;

      for (const [path, item] of newItems) {
        if (!item.isExpanded) {
          newItems.set(path, { ...item, isExpanded: true });
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

      set({ items: newItems });
    },

    /** Collapse all items (set isExpanded to false for all). */
    collapseAllItems: () => {
      const state = get();
      if (state.items.size === 0) return;

      const newItems = new Map(state.items);
      let hasChanges = false;

      for (const [path, item] of newItems) {
        if (item.isExpanded) {
          newItems.set(path, { ...item, isExpanded: false });
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

      set({ items: newItems });
    },

    /** Mark all selected items as cut and clear their selection. */
    cutSelectedItems: () => {
      const state = get();
      if (state.items.size === 0) return;

      const newItems = new Map(state.items);
      let hasChanges = false;

      for (const [path, item] of newItems) {
        if (item.isSelected) {
          newItems.set(path, { ...item, isSelected: false, isCut: true });
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

      set({ items: newItems });
    },

    /** Clear cut state for all items. */
    clearAllCutItems: () => {
      const state = get();
      if (state.items.size === 0) return;

      const newItems = new Map(state.items);
      let hasChanges = false;

      for (const [path, item] of newItems) {
        if (item.isCut) {
          newItems.set(path, { ...item, isCut: false });
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

      set({ items: newItems });
    },

    /**
     * Central "path moved" handler for a rename: moves the item's entry from
     * oldPath to newPath, preserving all state (isSelected, isCut, isExpanded,
     * content, etc.) to prevent phantom entries when a selected item is
     * renamed — and, atomically in the same update, remaps every other slice
     * that holds file paths. Leaving any of those stale dangles bookmarks,
     * points calendar events at files that no longer exist, and lets "Paste
     * Link" write dead links into document content:
     * - bookmarks (settings slice), including bookmarks to descendants of a
     *   renamed folder
     * - calendar events keyed by `filePath` (calendar slice)
     * - "Copy Link" paths awaiting "Paste Link" (view slice)
     *
     * The items Map is global and long-lived — it holds entries from every
     * folder visited this session — so renaming a folder must also re-key every
     * cached descendant. Otherwise those entries keep pointing at a path that no
     * longer exists while their state (editing, editContent, isCut, ...) stays
     * live, and a later save would write to the dead path.
     *
     * Returns true when a bookmark path changed, so the caller knows the
     * settings must be persisted to disk.
     */
    renameItem: (oldPath, newPath, newName) => {
      const state = get();
      const oldRoot = stripTrailingSep(oldPath);
      const newRoot = stripTrailingSep(newPath);
      const patch: Partial<AppState> = {};

      // Rebuilt in iteration order (rather than copy-then-mutate) so the renamed
      // entry keeps its position among its siblings. The renamed path itself may
      // not be cached (e.g. a rename from the index tree of a folder never
      // browsed) while descendants of it are — so the scan always runs and the
      // map is only patched when an entry actually moved.
      const newItems = new Map<string, ItemData>();
      let itemsChanged = false;

      for (const [path, item] of state.items) {
        if (path === oldPath) {
          newItems.set(newPath, { ...item, path: newPath, name: newName, renaming: false });
          itemsChanged = true;
          continue;
        }

        const movedPath = remapMovedPath(path, oldRoot, newRoot);
        if (movedPath) {
          newItems.set(movedPath, { ...item, path: movedPath });
          itemsChanged = true;
        } else {
          newItems.set(path, item);
        }
      }

      if (itemsChanged) {
        patch.items = newItems;
      }

      let bookmarksChanged = false;
      const remapped = state.settings.bookmarks.map(b => {
        const moved = remapMovedPath(b.path, oldRoot, newRoot);
        if (moved === null) return { bookmark: b, moved: false };
        bookmarksChanged = true;
        return { bookmark: { ...b, path: moved }, moved: true };
      });
      if (bookmarksChanged) {
        // A rename can land on a path that already carries a bookmark — nothing
        // clears bookmarks when a file is deleted, so a stale one can be sitting
        // on newPath. Collapse any collision to a single entry (the remapped one
        // wins) since bookmarks are looked up by path: duplicates make
        // removeBookmark drop both and updateBookmarkName only reach the first.
        const byPath = new Map<string, Bookmark>();
        for (const { bookmark, moved } of remapped) {
          if (moved || !byPath.has(bookmark.path)) byPath.set(bookmark.path, bookmark);
        }
        patch.settings = { ...state.settings, bookmarks: [...byPath.values()] };
      }

      if (state.calendarEvents) {
        let eventsChanged = false;
        const calendarEvents = state.calendarEvents.map(e => {
          const moved = e.filePath ? remapMovedPath(e.filePath, oldRoot, newRoot) : null;
          if (moved === null) return e;
          eventsChanged = true;
          return { ...e, filePath: moved };
        });
        if (eventsChanged) {
          patch.calendarEvents = calendarEvents;
        }
      }

      let linksChanged = false;
      const selectedLinkItems = state.selectedLinkItems.map(p => {
        const moved = remapMovedPath(p, oldRoot, newRoot);
        if (moved === null) return p;
        linksChanged = true;
        return moved;
      });
      if (linksChanged) {
        patch.selectedLinkItems = selectedLinkItems;
      }

      if (Object.keys(patch).length > 0) {
        set(patch);
      }

      return bookmarksChanged;
    },

    /**
     * Delete items from the store by their paths, along with every cached
     * descendant of each path (a deleted folder takes its whole subtree with it,
     * so leaving descendants behind would strand their editing/isCut state).
     *
     * Also drops any "Copy Link" paths pointing at (or under) a deleted path,
     * atomically in the same update — a later "Paste Link" would otherwise
     * write dead links into document content.
     */
    deleteItems: (paths) => {
      if (paths.length === 0) return;

      const roots = paths.map(stripTrailingSep).filter(Boolean);
      if (roots.length === 0) return;

      const state = get();
      const patch: Partial<AppState> = {};

      const newItems = new Map(state.items);
      let hasChanges = false;

      for (const path of newItems.keys()) {
        if (roots.some(root => isPathInside(root, path))) {
          newItems.delete(path);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        patch.items = newItems;
      }

      const remainingLinks = state.selectedLinkItems.filter(
        p => !roots.some(root => isPathInside(root, p)),
      );
      if (remainingLinks.length !== state.selectedLinkItems.length) {
        patch.selectedLinkItems = remainingLinks;
      }

      if (Object.keys(patch).length === 0) return;

      set(patch);
    },

    /**
     * Clear all cached items from the store.
     * Called after operations that modify the filesystem (delete, paste)
     * to ensure stale items don't remain in memory.
     */
    clearCache: () => set({ items: new Map<string, ItemData>() }),

    /**
     * Set the editing state of an item.
     * @param path - The full path of the item
     * @param editing - Whether the item is being edited
     * @param goToLine - Optional 1-based line number to scroll to when editing starts
     */
    setItemEditing: (path, editing, goToLine) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        editing,
        goToLine: editing ? goToLine : undefined,
        // Clear editContent and reviewing state when exiting edit mode
        ...(editing ? {} : { editContent: undefined, reviewing: undefined, rewrittenContent: undefined }),
      });

      set({
        items: newItems,
        ...(editing ? { highlightItem: path } : {}),
      });
    },

    /** Set the reviewing (diff review) state for a file. */
    setItemReviewing: (path, reviewing, rewrittenContent) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        reviewing,
        rewrittenContent: reviewing ? rewrittenContent : undefined,
      });

      set({ items: newItems });
    },

    /** Set the current edit content for a file (used during editing). */
    setItemEditContent: (path, editContent) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;
      if (existing.editContent === editContent) return;

      const newItems = new Map(state.items);
      newItems.set(path, { ...existing, editContent });
      set({ items: newItems });
    },

    /** Clear the goToLine property for an item (call after scrolling to the line). */
    clearItemGoToLine: (path) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing || existing.goToLine === undefined) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        goToLine: undefined,
      });

      set({ items: newItems });
    },

    /** Set the renaming state of an item. */
    setItemRenaming: (path, renaming) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        renaming,
      });

      set({
        items: newItems,
        ...(renaming ? { highlightItem: path } : {}),
      });
    },

    /** Set the currently highlighted item (by full path). */
    setHighlightItem: (path) => {
      if (get().highlightItem === path) return;
      set({ highlightItem: path });
    },
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

/**
 * Add or update an item in the store.
 * If the item already exists and its modifiedTime hasn't changed,
 * preserves the existing cached content.
 */
export function upsertItem(
  path: string,
  name: string,
  isDirectory: boolean,
  modifiedTime: number,
  createdTime: number = modifiedTime
): void {
  upsertItems([{ path, name, isDirectory, modifiedTime, createdTime }]);
}

export function upsertItems(items: IncomingItem[]): void {
  getState().upsertItems(items);
}

/**
 * Upsert a complete directory listing and prune the entries for children of
 * `dirPath` that are no longer there. Only for callers holding a full listing.
 */
export function syncDirectoryItems(dirPath: string, items: IncomingItem[]): void {
  getState().syncDirectoryItems(dirPath, items);
}

export function setItemContent(path: string, content: string, modifiedTime: number, size?: number): void {
  getState().setItemContent(path, content, modifiedTime, size);
}

export function toggleItemSelected(path: string): void {
  getState().toggleItemSelected(path);
}

export function toggleItemExpanded(path: string): void {
  getState().toggleItemExpanded(path);
}

export function setItemExpanded(path: string, isExpanded: boolean): void {
  getState().setItemExpanded(path, isExpanded);
}

export function setItemSelected(path: string, isSelected: boolean): void {
  getState().setItemSelected(path, isSelected);
}

export function clearAllSelections(): void {
  getState().clearAllSelections();
}

export function selectItemsByPaths(paths: string[]): void {
  getState().selectItemsByPaths(paths);
}

export function expandAllItems(): void {
  getState().expandAllItems();
}

export function collapseAllItems(): void {
  getState().collapseAllItems();
}

export function cutSelectedItems(): void {
  getState().cutSelectedItems();
}

export function clearAllCutItems(): void {
  getState().clearAllCutItems();
}

export function renameItem(oldPath: string, newPath: string, newName: string): boolean {
  return getState().renameItem(oldPath, newPath, newName);
}

export function deleteItems(paths: string[]): void {
  getState().deleteItems(paths);
}

export function clearCache(): void {
  getState().clearCache();
}

export function setItemEditing(path: string, editing: boolean, goToLine?: number): void {
  getState().setItemEditing(path, editing, goToLine);
}

export function setItemReviewing(path: string, reviewing: boolean, rewrittenContent?: string): void {
  getState().setItemReviewing(path, reviewing, rewrittenContent);
}

export function setItemEditContent(path: string, editContent: string): void {
  getState().setItemEditContent(path, editContent);
}

export function clearItemGoToLine(path: string): void {
  getState().clearItemGoToLine(path);
}

export function setItemRenaming(path: string, renaming: boolean): void {
  getState().setItemRenaming(path, renaming);
}

export function setHighlightItem(path: string | null): void {
  getState().setHighlightItem(path);
}

// ============================================================================
// Non-reactive readers (direct access, not hooks)
// ============================================================================

/**
 * Get an item by path (direct access, not a hook)
 */
export function getItem(path: string): ItemData | undefined {
  return getState().items.get(path);
}

/**
 * Get the item currently in edit mode, if any (direct access, not a hook)
 */
export function getEditingItem(): { path: string; item: ItemData } | null {
  for (const [path, item] of getState().items) {
    if (item.editing) return { path, item };
  }
  return null;
}

/**
 * Get all currently cut items (direct access, not a hook)
 */
export function getCutItems(): ItemData[] {
  return Array.from(getState().items.values()).filter(item => item.isCut);
}

/**
 * Check if cached content is valid for an item
 */
export function isCacheValid(path: string): boolean {
  const item = getState().items.get(path);
  // Check content for undefined (never loaded) rather than falsiness, so an
  // empty file ('') still counts as cached once read — otherwise empty markdown
  // files would be re-read on every content-loader pass.
  if (!item || item.content === undefined || !item.contentCachedAt) {
    return false;
  }
  // Valid only when the content was captured at exactly the latest known mtime.
  // `>=` would let a cache stamped ahead of the real disk mtime (clock skew,
  // coarse filesystem timestamps) validate content an external edit has since
  // replaced — and a save over that stale content destroys the external edit.
  return item.contentCachedAt === item.modifiedTime;
}

/**
 * Get the current edit content for a file synchronously (not a hook).
 * Useful for reading the latest value in event handlers without render lag.
 *
 * Returns `undefined` when the item is missing or has no edit content (e.g.
 * edit mode was exited, or the entry was re-keyed/removed). Callers must not
 * treat that as an empty document — writing `''` to disk would truncate the
 * file.
 */
export function getItemEditContent(path: string): string | undefined {
  return getState().items.get(path)?.editContent;
}

// ============================================================================
// Hooks & selector helpers
// ============================================================================

/**
 * Expansion counts for items in a given directory
 */
export interface ExpansionCounts {
  expandedCount: number;
  collapsedCount: number;
  totalCount: number;
}

/**
 * Compute expansion counts for items in a specific directory path.
 * Only counts items that are direct children of the given path, are not cut,
 * and are not directories (since folders aren't expandable).
 */
function computeExpansionCounts(items: Map<string, ItemData>, directoryPath: string): ExpansionCounts {
  let expandedCount = 0;
  let collapsedCount = 0;

  for (const [itemPath, item] of items) {
    // Skip cut items (they're not visible)
    if (item.isCut) continue;

    // Skip directories (they aren't expandable)
    if (item.isDirectory) continue;

    // Check if this item is a direct child of the directory
    const parentPath = getParentPath(itemPath);
    if (parentPath !== directoryPath) continue;

    if (item.isExpanded) {
      expandedCount++;
    } else {
      collapsedCount++;
    }
  }

  return {
    expandedCount,
    collapsedCount,
    totalCount: expandedCount + collapsedCount,
  };
}

/**
 * Hook to subscribe to expansion counts for the current path.
 *
 * The selector returns a freshly-computed object, so it is wrapped in
 * `useShallow`: the result is compared key-by-key against the previous one,
 * and the component only re-renders when a count actually changes.
 */
export function useExpansionCounts(): ExpansionCounts {
  return useAS(useShallow(s => computeExpansionCounts(s.items, s.currentPath)));
}

/**
 * Check whether any items are currently cut. Pure helper for direct selectors:
 * `useAS(s => hasAnyCutItems(s.items))` — the result is a primitive, so
 * no `useShallow` is needed.
 */
export function hasAnyCutItems(items: Map<string, ItemData>): boolean {
  for (const item of items.values()) {
    if (item.isCut) return true;
  }
  return false;
}
