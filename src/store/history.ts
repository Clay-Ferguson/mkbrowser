import type { AppState } from '../shared/types';
import { getState } from './core';
import type { StoreGet, StoreSet } from './core';
import { getFileName, getParentPath, isPathInside, remapMovedPath } from '../renderer/pathUtil';

// ============================================================================
// History - browser-style Back/Forward through the files viewed this session
// ============================================================================
//
// Entries are recorded where `highlightItem` is set (`setHighlightItem`,
// `revealInTree`), folded into that same `set()` patch via `withHistoryPush`,
// so every highlighting call site feeds the history without knowing about it.
// Lives only in the store: nothing is persisted, so a restart starts empty.

/** Oldest entries are dropped once the history grows past this. */
export const MAX_HISTORY = 200;

type HistoryState = Pick<AppState, 'navHistory' | 'navHistoryIndex' | 'items'>;
type HistoryPatch = Pick<AppState, 'navHistory' | 'navHistoryIndex'>;

/**
 * The patch that records `path` as the newest history entry, or null when
 * nothing changes. Browser semantics: re-visiting the current entry is a no-op,
 * and a new visit after going Back discards the forward entries. Known
 * directories are skipped — Back/Forward reopens files in single-file mode.
 */
export function withHistoryPush(state: HistoryState, path: string | null): HistoryPatch | null {
  if (!path) return null;
  if (state.items.get(path)?.isDirectory) return null;
  if (state.navHistory[state.navHistoryIndex] === path) return null;
  const navHistory = [...state.navHistory.slice(0, state.navHistoryIndex + 1), path].slice(-MAX_HISTORY);
  return { navHistory, navHistoryIndex: navHistory.length - 1 };
}

/**
 * The patch that moves history entries along with a rename/move of `oldRoot`
 * to `newRoot` (the item itself or anything under it), or null when no entry
 * is affected.
 */
export function withHistoryRemapped(state: HistoryState, oldRoot: string, newRoot: string): HistoryPatch | null {
  let changed = false;
  const navHistory = state.navHistory.map(p => {
    const moved = remapMovedPath(p, oldRoot, newRoot);
    if (moved === null) return p;
    changed = true;
    return moved;
  });
  return changed ? { navHistory, navHistoryIndex: state.navHistoryIndex } : null;
}

/**
 * The patch that drops history entries at or under any of the deleted `roots`,
 * or null when no entry is affected. Neighbors left adjacent by a removal are
 * collapsed when equal, and the current position falls back to the nearest
 * surviving entry at or before it (or the first entry, if none precede it).
 */
export function withHistoryPruned(state: HistoryState, roots: string[]): HistoryPatch | null {
  const isDeleted = (p: string) => roots.some(root => isPathInside(root, p));
  if (!state.navHistory.some(isDeleted)) return null;

  const navHistory: string[] = [];
  let navHistoryIndex = -1;
  state.navHistory.forEach((p, i) => {
    if (!isDeleted(p) && navHistory[navHistory.length - 1] !== p) {
      navHistory.push(p);
    }
    if (i === state.navHistoryIndex) {
      navHistoryIndex = navHistory.length - 1;
    }
  });
  if (navHistoryIndex === -1 && navHistory.length > 0) navHistoryIndex = 0;
  return { navHistory, navHistoryIndex };
}

/** Whether there is an entry before the current one. */
export function canGoBack(s: Pick<AppState, 'navHistoryIndex'>): boolean {
  return s.navHistoryIndex > 0;
}

/** Whether there is an entry after the current one. */
export function canGoForward(s: Pick<AppState, 'navHistory' | 'navHistoryIndex'>): boolean {
  return s.navHistoryIndex < s.navHistory.length - 1;
}

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface HistorySlice {
  goBack: () => void;
  goForward: () => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createHistorySlice(set: StoreSet, get: StoreGet): HistorySlice {
  /**
   * Move to the entry at `index` and open it on its own in BrowseView, as an
   * index-tree click does. `highlightItem` is written directly rather than via
   * `setHighlightItem`, so the move itself is not recorded as a new visit.
   */
  const goTo = (index: number) => {
    const target = get().navHistory[index];
    if (target === undefined) return;
    set({ navHistoryIndex: index, highlightItem: target });
    get().setBrowseFile(getParentPath(target), getFileName(target));
  };

  return {
    goBack: () => {
      if (canGoBack(get())) goTo(get().navHistoryIndex - 1);
    },
    goForward: () => {
      if (canGoForward(get())) goTo(get().navHistoryIndex + 1);
    },
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function goBack(): void {
  getState().goBack();
}

export function goForward(): void {
  getState().goForward();
}
