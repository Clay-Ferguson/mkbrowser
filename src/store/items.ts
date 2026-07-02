import { useShallow } from 'zustand/react/shallow';
import type { ItemData } from '../shared/types';
import { createItemData } from '../shared/types';
import { getTagsFromYaml } from '../shared/tagUtil';
import { splitFrontMatter, getPropsFromYaml } from '../shared/frontMatterUtil';
import { getParentPath } from '../renderer/pathUtil';
import { getState, useAppStore } from './core';
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
  aiHint?: string;
}

/**
 * Merge an incoming item with its existing store entry (if any), returning the
 * item to store. Shared merge rules for both upsertItem and upsertItems:
 * - Existing item: refresh metadata, invalidate cached content if the file has
 *   changed since it was cached, and replace aiHint only when one is supplied.
 * - No existing item: create a fresh entry.
 */
function mergeItem(existing: ItemData | undefined, item: IncomingItem): ItemData {
  const createdTime = item.createdTime ?? item.modifiedTime;

  if (!existing) {
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

  // If the file has been modified since we cached content, invalidate cache
  if (existing.contentCachedAt && item.modifiedTime > existing.contentCachedAt) {
    updatedItem.content = undefined;
    updatedItem.contentCachedAt = undefined;
  }

  return updatedItem;
}

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface ItemsSlice {
  upsertItems: (items: IncomingItem[]) => void;
  setItemContent: (path: string, content: string, modifiedTime?: number) => void;
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
  renameItem: (oldPath: string, newPath: string, newName: string) => void;
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
    /** Batch upsert multiple items at once (more efficient for directory loads). */
    upsertItems: (items) => {
      // Create new Map to ensure React detects the change
      const newItems = new Map(get().items);

      for (const item of items) {
        newItems.set(item.path, mergeItem(newItems.get(item.path), item));
      }

      set({ items: newItems });
    },

    /** Set the cached content for a markdown file. */
    setItemContent: (path, content, modifiedTime) => {
      const state = get();
      const existing = state.items.get(path);
      if (!existing) return;

      const now = modifiedTime ?? existing.modifiedTime;
      const fmParts = splitFrontMatter(content);
      const tags = fmParts ? getTagsFromYaml(fmParts.yamlStr).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) : [];
      const props = fmParts ? getPropsFromYaml(fmParts.yamlStr) : {};

      const newItems = new Map(state.items);
      newItems.set(path, {
        ...existing,
        content,
        modifiedTime: now,
        contentCachedAt: now,
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
      const state = get();
      if (state.items.size === 0) return;

      const newItems = new Map(state.items);
      let hasChanges = false;

      for (const [path, item] of newItems) {
        if (item.isSelected) {
          newItems.set(path, { ...item, isSelected: false });
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

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
     * Rename an item in the store: move its entry from oldPath to newPath,
     * preserving all state (isSelected, isCut, isExpanded, content, etc.).
     * This prevents phantom entries when a selected item is renamed.
     */
    renameItem: (oldPath, newPath, newName) => {
      const state = get();
      const existing = state.items.get(oldPath);
      if (!existing) return;

      const newItems = new Map(state.items);
      newItems.delete(oldPath);
      newItems.set(newPath, {
        ...existing,
        path: newPath,
        name: newName,
        renaming: false,
      });

      set({ items: newItems });
    },

    /** Delete multiple items from the store by their paths. */
    deleteItems: (paths) => {
      if (paths.length === 0) return;

      const newItems = new Map(get().items);
      let hasChanges = false;

      for (const path of paths) {
        if (newItems.has(path)) {
          newItems.delete(path);
          hasChanges = true;
        }
      }

      if (!hasChanges) return;

      set({ items: newItems });
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

export function setItemContent(path: string, content: string, modifiedTime?: number): void {
  getState().setItemContent(path, content, modifiedTime);
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

export function renameItem(oldPath: string, newPath: string, newName: string): void {
  getState().renameItem(oldPath, newPath, newName);
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
  // Cache is valid if the file hasn't been modified since we cached it
  return item.contentCachedAt >= item.modifiedTime;
}

/**
 * Get the current edit content for a file synchronously (not a hook).
 * Useful for reading the latest value in event handlers without render lag.
 */
export function getItemEditContent(path: string): string {
  return getState().items.get(path)?.editContent ?? '';
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
  return useAppStore(useShallow(s => computeExpansionCounts(s.items, s.currentPath)));
}

/**
 * Check whether any items are currently cut. Pure helper for direct selectors:
 * `useAppStore(s => hasAnyCutItems(s.items))` — the result is a primitive, so
 * no `useShallow` is needed.
 */
export function hasAnyCutItems(items: Map<string, ItemData>): boolean {
  for (const item of items.values()) {
    if (item.isCut) return true;
  }
  return false;
}
