import { useSyncExternalStore } from 'react';
import type { AppState, ItemData } from './types';
import { createItemData } from './types';

/**
 * Initial state
 */
const initialState: AppState = {
  items: new Map(),
};

/**
 * Current state (mutable reference)
 */
let state: AppState = initialState;

/**
 * Set of listener functions to notify on state changes
 */
const listeners = new Set<() => void>();

/**
 * Notify all listeners that state has changed
 */
function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Subscribe to state changes
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Get current snapshot of the entire state
 */
function getSnapshot(): AppState {
  return state;
}

/**
 * Get snapshot of just the items Map
 */
function getItemsSnapshot(): Map<string, ItemData> {
  return state.items;
}

// ============================================================================
// Actions - functions that modify the store
// ============================================================================

/**
 * Add or update an item in the store.
 * If the item already exists and its modifiedTime hasn't changed,
 * preserves the existing cached content.
 */
export function upsertItem(
  path: string,
  name: string,
  isDirectory: boolean,
  modifiedTime: number
): void {
  const existing = state.items.get(path);

  // Create new Map to ensure React detects the change
  const newItems = new Map(state.items);

  if (existing) {
    // Item exists - update it, preserving content if modifiedTime unchanged
    const updatedItem: ItemData = {
      ...existing,
      name,
      isDirectory,
      modifiedTime,
    };

    // If the file has been modified since we cached content, invalidate cache
    if (existing.contentCachedAt && modifiedTime > existing.contentCachedAt) {
      updatedItem.content = undefined;
      updatedItem.contentCachedAt = undefined;
    }

    newItems.set(path, updatedItem);
  } else {
    // New item
    newItems.set(path, createItemData(path, name, isDirectory, modifiedTime));
  }

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Batch upsert multiple items at once (more efficient for directory loads)
 */
export function upsertItems(
  items: Array<{ path: string; name: string; isDirectory: boolean; modifiedTime: number }>
): void {
  const newItems = new Map(state.items);

  for (const item of items) {
    const existing = newItems.get(item.path);

    if (existing) {
      const updatedItem: ItemData = {
        ...existing,
        name: item.name,
        isDirectory: item.isDirectory,
        modifiedTime: item.modifiedTime,
      };

      if (existing.contentCachedAt && item.modifiedTime > existing.contentCachedAt) {
        updatedItem.content = undefined;
        updatedItem.contentCachedAt = undefined;
      }

      newItems.set(item.path, updatedItem);
    } else {
      newItems.set(item.path, createItemData(item.path, item.name, item.isDirectory, item.modifiedTime));
    }
  }

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the cached content for a markdown file
 */
export function setItemContent(path: string, content: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    content,
    contentCachedAt: existing.modifiedTime,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Toggle the selected state of an item
 */
export function toggleItemSelected(path: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isSelected: !existing.isSelected,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Toggle the expanded state of an item
 */
export function toggleItemExpanded(path: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isExpanded: !existing.isExpanded,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the expanded state of an item explicitly
 */
export function setItemExpanded(path: string, isExpanded: boolean): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isExpanded,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the selected state of an item explicitly
 */
export function setItemSelected(path: string, isSelected: boolean): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isSelected,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Clear selection state for all items
 */
export function clearAllSelections(): void {
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

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Get an item by path (direct access, not a hook)
 */
export function getItem(path: string): ItemData | undefined {
  return state.items.get(path);
}

/**
 * Check if cached content is valid for an item
 */
export function isCacheValid(path: string): boolean {
  const item = state.items.get(path);
  if (!item || !item.content || !item.contentCachedAt) {
    return false;
  }
  // Cache is valid if the file hasn't been modified since we cached it
  return item.contentCachedAt >= item.modifiedTime;
}

/**
 * Set the editing state of an item
 */
export function setItemEditing(path: string, editing: boolean): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    editing,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the renaming state of an item
 */
export function setItemRenaming(path: string, renaming: boolean): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    renaming,
  });

  state = { ...state, items: newItems };
  emitChange();
}

// ============================================================================
// Hooks - React hooks for subscribing to state
// ============================================================================

/**
 * Hook to subscribe to the entire app state
 */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Hook to subscribe to the items Map
 */
export function useItems(): Map<string, ItemData> {
  return useSyncExternalStore(subscribe, getItemsSnapshot);
}

/**
 * Hook to get a specific item by path.
 * Returns undefined if the item doesn't exist.
 */
export function useItem(path: string): ItemData | undefined {
  const items = useSyncExternalStore(subscribe, getItemsSnapshot);
  return items.get(path);
}
