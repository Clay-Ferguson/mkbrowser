/**
 * Tests for executeSearch (src/renderer/searchUtil.ts): overlapping searches
 * can finish in any order, and only the most recently started one may publish.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SearchDefinition, SearchOutcome } from '../src/shared/shared';

const searchFolder = vi.fn<(...args: unknown[]) => Promise<SearchOutcome>>();
vi.mock('../src/renderer/api', () => ({
  api: { searchFolder: (...args: unknown[]) => searchFolder(...args) },
  ipcErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const { executeSearch } = await import('../src/renderer/searchUtil');
const { useAS } = await import('../src/store/core');
const { clearSearchResults } = await import('../src/store/search');

/** A promise plus the functions that settle it, so a test controls finish order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const def = (searchText: string): SearchDefinition => ({
  name: '',
  searchText,
  target: 'content',
  matchType: 'literal',
  sortBy: 'modified-time',
  sortDirection: 'desc',
});

const outcome = (path: string): SearchOutcome => ({
  results: [{ path, relativePath: path.slice(1), matchCount: 1 }],
  totalMatches: 1,
});

describe('executeSearch', () => {
  beforeEach(() => {
    searchFolder.mockReset();
    clearSearchResults();
  });

  it('publishes a lone search and reports that it did', async () => {
    searchFolder.mockResolvedValueOnce(outcome('/a.md'));
    await expect(executeSearch('/root', def('a'))).resolves.toBe(true);
    expect(useAS.getState().searchQuery).toBe('a');
    expect(useAS.getState().searchResults.map(r => r.path)).toEqual(['/a.md']);
  });

  it('sends the whole definition to the main process', async () => {
    searchFolder.mockResolvedValueOnce(outcome('/a.md'));
    const definition = { ...def('a'), matchType: 'wildcard' as const, mostRecent: true };
    await executeSearch('/root', definition);
    expect(searchFolder).toHaveBeenCalledWith('/root', definition);
  });

  it('an older search that finishes last does not overwrite a newer one', async () => {
    const slow = deferred<SearchOutcome>();
    const fast = deferred<SearchOutcome>();
    searchFolder.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = executeSearch('/root', def('old'));
    const second = executeSearch('/root', def('new'));

    fast.resolve(outcome('/new.md'));
    const secondPublished = await second;
    slow.resolve(outcome('/old.md'));
    const firstPublished = await first;

    const s = useAS.getState();
    expect(s.searchQuery).toBe('new');
    expect(s.lastSearchDefinition?.searchText).toBe('new');
    expect(s.searchResults.map(r => r.path)).toEqual(['/new.md']);
    expect(secondPublished).toBe(true);
    expect(firstPublished).toBe(false);
  });

  it('an older search that finishes first is still dropped once a newer one started', async () => {
    const older = deferred<SearchOutcome>();
    const newer = deferred<SearchOutcome>();
    searchFolder.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const first = executeSearch('/root', def('old'));
    const second = executeSearch('/root', def('new'));

    older.resolve(outcome('/old.md'));
    await expect(first).resolves.toBe(false);
    expect(useAS.getState().searchQuery).toBe('');

    newer.resolve(outcome('/new.md'));
    await expect(second).resolves.toBe(true);
    expect(useAS.getState().searchQuery).toBe('new');
  });

  it("drops a stale search's error instead of throwing it", async () => {
    const failing = deferred<SearchOutcome>();
    searchFolder.mockReturnValueOnce(failing.promise).mockResolvedValueOnce(outcome('/new.md'));

    const first = executeSearch('/root', def('old'));
    await expect(executeSearch('/root', def('new'))).resolves.toBe(true);
    failing.reject(new Error('boom'));
    await expect(first).resolves.toBe(false);
    expect(useAS.getState().searchQuery).toBe('new');
  });

  it('does not publish a search the main process cancelled', async () => {
    searchFolder.mockResolvedValueOnce({ results: [], totalMatches: 0, cancelled: true });
    await expect(executeSearch('/root', def('cancelled'))).resolves.toBe(false);
    expect(useAS.getState().searchQuery).toBe('');
    expect(useAS.getState().lastSearchDefinition).toBeNull();
  });

  it('throws the error of the latest search', async () => {
    searchFolder.mockRejectedValueOnce(new Error('Invalid advanced search query: x'));
    await expect(executeSearch('/root', def('bad'))).rejects.toThrow('Invalid advanced search query: x');
  });
});
