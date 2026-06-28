import { useSyncExternalStore } from 'react';
import type { ItemData } from '../shared/types';
import { createItemData } from '../shared/types';
import { getTagsFromYaml } from '../shared/tagUtil';
import { splitFrontMatter, getPropsFromYaml } from '../shared/frontMatterUtil';
import { getParentPath } from '../renderer/pathUtil';
import { getState, setState, subscribe, useStoreValue } from './core';

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

/**
 * Batch upsert multiple items at once (more efficient for directory loads)
 */
export function upsertItems(items: IncomingItem[]): void {
  // Create new Map to ensure React detects the change
  const newItems = new Map(getState().items);

  for (const item of items) {
    newItems.set(item.path, mergeItem(newItems.get(item.path), item));
  }

  setState({ items: newItems });
}

/**
 * Set the cached content for a markdown file
 */
export function setItemContent(path: string, content: string, modifiedTime?: number): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Toggle the selected state of an item
 */
export function toggleItemSelected(path: string): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isSelected: !existing.isSelected,
  });

  setState({ items: newItems });
}

/**
 * Toggle the expanded state of an item
 */
export function toggleItemExpanded(path: string): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isExpanded: !existing.isExpanded,
  });

  setState({ items: newItems });
}

/**
 * Set the expanded state of an item explicitly
 */
export function setItemExpanded(path: string, isExpanded: boolean): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isExpanded,
  });

  setState({ items: newItems });
}

/**
 * Set the selected state of an item explicitly
 */
export function setItemSelected(path: string, isSelected: boolean): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isSelected,
  });

  setState({ items: newItems });
}

/**
 * Clear selection state for all items
 */
export function clearAllSelections(): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Select all items whose paths are in the provided array
 * (used for Select All in the current folder view)
 */
export function selectItemsByPaths(paths: string[]): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Expand all items (set isExpanded to true for all)
 */
export function expandAllItems(): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Collapse all items (set isExpanded to false for all)
 */
export function collapseAllItems(): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Expansion counts for items in a given directory
 */
export interface ExpansionCounts {
  expandedCount: number;
  collapsedCount: number;
  totalCount: number;
}

/**
 * Get expansion counts for items in a specific directory path.
 * Only counts items that are direct children of the given path, are not cut,
 * and are not directories (since folders aren't expandable).
 */
export function getExpansionCounts(directoryPath: string): ExpansionCounts {
  let expandedCount = 0;
  let collapsedCount = 0;

  for (const [itemPath, item] of getState().items) {
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
 * Memoized expansion counts. The full O(n) scan is keyed on the inputs it
 * depends on: the `items` Map (replaced on every mutation) and `currentPath`.
 * Because `useSyncExternalStore` calls the snapshot on every render and every
 * change, this ensures the scan only runs when those inputs actually change
 * while still returning a stable reference otherwise.
 */
let cachedExpansionCounts: ExpansionCounts = { expandedCount: 0, collapsedCount: 0, totalCount: 0 };
let cachedExpansionCountsItems: Map<string, ItemData> | null = null;
let cachedExpansionCountsPath: string | null = null;

function getExpansionCountsSnapshot(): ExpansionCounts {
  const { items, currentPath } = getState();

  if (items !== cachedExpansionCountsItems || currentPath !== cachedExpansionCountsPath) {
    cachedExpansionCounts = getExpansionCounts(currentPath);
    cachedExpansionCountsItems = items;
    cachedExpansionCountsPath = currentPath;
  }

  return cachedExpansionCounts;
}

/**
 * Hook to subscribe to expansion counts for the current path
 */
export function useExpansionCounts(): ExpansionCounts {
  return useSyncExternalStore(subscribe, getExpansionCountsSnapshot);
}

/**
 * Mark all selected items as cut and clear their selection
 */
export function cutSelectedItems(): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Clear cut state for all items
 */
export function clearAllCutItems(): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Rename an item in the store: move its entry from oldPath to newPath,
 * preserving all state (isSelected, isCut, isExpanded, content, etc.).
 * This prevents phantom entries when a selected item is renamed.
 */
export function renameItem(oldPath: string, newPath: string, newName: string): void {
  const state = getState();
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

  setState({ items: newItems });
}

/**
 * Delete multiple items from the store by their paths
 */
export function deleteItems(paths: string[]): void {
  if (paths.length === 0) return;

  const newItems = new Map(getState().items);
  let hasChanges = false;

  for (const path of paths) {
    if (newItems.has(path)) {
      newItems.delete(path);
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  setState({ items: newItems });
}

/**
 * Clear all cached items from the store.
 * Called after operations that modify the filesystem (delete, paste)
 * to ensure stale items don't remain in memory.
 */
export function clearCache(): void {
  setState({ items: new Map<string, ItemData>() });
}

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
 * Set the editing state of an item
 * @param path - The full path of the item
 * @param editing - Whether the item is being edited
 * @param goToLine - Optional 1-based line number to scroll to when editing starts
 */
export function setItemEditing(path: string, editing: boolean, goToLine?: number): void {
  const state = getState();
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

  setState({
    items: newItems,
    ...(editing ? { highlightItem: path } : {}),
  });
}

/**
 * Set the reviewing (diff review) state for a file.
 */
export function setItemReviewing(path: string, reviewing: boolean, rewrittenContent?: string): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    reviewing,
    rewrittenContent: reviewing ? rewrittenContent : undefined,
  });

  setState({ items: newItems });
}

/**
 * Set the current edit content for a file (used during editing).
 */
export function setItemEditContent(path: string, editContent: string): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing) return;
  if (existing.editContent === editContent) return;

  const newItems = new Map(state.items);
  newItems.set(path, { ...existing, editContent });
  setState({ items: newItems });
}

/**
 * Get the current edit content for a file synchronously (not a hook).
 * Useful for reading the latest value in event handlers without render lag.
 */
export function getItemEditContent(path: string): string {
  return getState().items.get(path)?.editContent ?? '';
}

/**
 * Clear the goToLine property for an item (call after scrolling to the line)
 */
export function clearItemGoToLine(path: string): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing || existing.goToLine === undefined) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    goToLine: undefined,
  });

  setState({ items: newItems });
}

/**
 * Set the renaming state of an item
 */
export function setItemRenaming(path: string, renaming: boolean): void {
  const state = getState();
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    renaming,
  });

  setState({
    items: newItems,
    ...(renaming ? { highlightItem: path } : {}),
  });
}

/**
 * Set the currently highlighted item (by full path)
 */
export function setHighlightItem(path: string | null): void {
  if (getState().highlightItem === path) return;
  setState({ highlightItem: path });
}

/**
 * Hook to subscribe to the items Map
 */
export function useItems(): Map<string, ItemData> {
  return useStoreValue(s => s.items);
}

/**
 * Hook to get a specific item by path.
 * Returns undefined if the item doesn't exist.
 *
 * Selects the item itself (not the whole Map) as the snapshot so the component
 * only re-renders when *this* item's reference changes. The store preserves
 * referential identity for unchanged items, so `useSyncExternalStore`'s built-in
 * `Object.is` comparison bails out of re-renders triggered by other items.
 */
export function useItem(path: string): ItemData | undefined {
  return useSyncExternalStore(subscribe, () => getState().items.get(path));
}

/**
 * Hook to subscribe to highlighted item name
 */
export function useHighlightItem(): string | null {
  return useStoreValue(s => s.highlightItem);
}

/**
 * Hook to check whether any items are currently cut
 */
export function useHasCutItems(): boolean {
  const items = useStoreValue(s => s.items);
  for (const item of items.values()) {
    if (item.isCut) return true;
  }
  return false;
}

/**
 * Hook to get the path of the currently-editing markdown file, or null if none.
 */
export function useEditingMarkdownPath(): string | null {
  const items = useStoreValue(s => s.items);
  for (const [path, item] of items.entries()) {
    if (item.editing && path.endsWith('.md')) return path;
  }
  return null;
}
