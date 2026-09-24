import type { HighlightedSearchResult, SearchDefinition, SearchResultItem } from '../shared/types';
import { getState } from './core';
import type { StoreGet, StoreSet } from './core';

// ============================================================================
// Search - results, query, and the persistent result highlight
// ============================================================================

/** The outcome of one search run: the (capped) results and the total match count. */
export interface SearchOutcomeData {
  results: SearchResultItem[];
  totalMatches: number;
}

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface SearchSlice {
  setHighlightedSearchResult: (result: HighlightedSearchResult | null) => void;
  setSearchOutcome: (folder: string, definition: SearchDefinition, outcome: SearchOutcomeData) => void;
  removeSearchResult: (path: string) => void;
  clearSearchResults: () => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createSearchSlice(set: StoreSet, get: StoreGet): SearchSlice {
  return {
    /** Set the highlighted search result (for persistent highlighting). */
    setHighlightedSearchResult: (result) => set({ highlightedSearchResult: result }),

    /**
     * Publish a completed search: its results and total, plus the folder and
     * definition that produced them (the definition is what lets the Search
     * Results refresh re-run the identical search). One atomic write, so the
     * results are never visible alongside another search's parameters.
     */
    setSearchOutcome: (folder, definition, outcome) =>
      set({
        searchResults: outcome.results,
        searchTotalMatches: outcome.totalMatches,
        searchQuery: definition.searchText,
        searchFolder: folder,
        searchName: definition.name,
        searchSortBy: definition.sortBy,
        searchSortDirection: definition.sortDirection,
        lastSearchDefinition: definition,
      }),

    /** Drop one result (its file was deleted), keeping the total in step. */
    removeSearchResult: (path) => {
      const state = get();
      const searchResults = state.searchResults.filter(r => r.path !== path);
      if (searchResults.length === state.searchResults.length) return;
      set({ searchResults, searchTotalMatches: Math.max(0, state.searchTotalMatches - 1) });
    },

    /** Clear search results. */
    clearSearchResults: () =>
      set({
        searchResults: [],
        searchTotalMatches: 0,
        searchQuery: '',
        searchFolder: '',
        searchName: '',
        searchSortBy: 'modified-time',
        searchSortDirection: 'desc',
        lastSearchDefinition: null,
      }),
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setHighlightedSearchResult(result: HighlightedSearchResult | null): void {
  getState().setHighlightedSearchResult(result);
}

export function setSearchOutcome(folder: string, definition: SearchDefinition, outcome: SearchOutcomeData): void {
  getState().setSearchOutcome(folder, definition, outcome);
}

export function removeSearchResult(path: string): void {
  getState().removeSearchResult(path);
}

export function clearSearchResults(): void {
  getState().clearSearchResults();
}
