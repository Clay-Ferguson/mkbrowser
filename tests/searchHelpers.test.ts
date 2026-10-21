/**
 * Tests for the pure search helpers (compareSearchResults, newSearchDefinition,
 * initialSearchDefinition, isSearchDefinitionDirty, validateSearchDefinitionName in
 * src/shared/searchHelpers.ts) and the search store slice (src/store/search.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { compareSearchResults, newSearchDefinition, initialSearchDefinition, isSearchDefinitionDirty, validateSearchDefinitionName } from '../src/shared/searchHelpers';
import { useAS } from '../src/store/core';
import { setSearchOutcome, removeSearchResult, clearSearchResults } from '../src/store/search';
import type { SearchDefinition } from '../src/shared/shared';

const r = (relativePath: string, modifiedTime?: number, createdTime?: number) =>
  ({ relativePath, modifiedTime, createdTime });

const order = (items: ReturnType<typeof r>[], ...args: Parameters<typeof compareSearchResults>) =>
  [...items].sort(compareSearchResults(...args)).map(i => i.relativePath);

describe('compareSearchResults', () => {
  it('sorts by modification time in both directions', () => {
    const items = [r('b.md', 200), r('a.md', 100), r('c.md', 300)];
    expect(order(items, 'modified-time', 'desc')).toEqual(['c.md', 'b.md', 'a.md']);
    expect(order(items, 'modified-time', 'asc')).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('sorts by creation time', () => {
    const items = [r('a.md', 0, 300), r('b.md', 0, 100)];
    expect(order(items, 'created-time', 'asc')).toEqual(['b.md', 'a.md']);
  });

  it('treats a missing timestamp as oldest', () => {
    const items = [r('none.md'), r('new.md', 5)];
    expect(order(items, 'modified-time', 'desc')).toEqual(['new.md', 'none.md']);
  });

  it('sorts by base name, ignoring case and folders', () => {
    const items = [r('z/apple.md'), r('a/Cherry.md'), r('m/banana.md')];
    expect(order(items, 'file-name', 'asc')).toEqual(['z/apple.md', 'm/banana.md', 'a/Cherry.md']);
    expect(order(items, 'file-name', 'desc')).toEqual(['a/Cherry.md', 'm/banana.md', 'z/apple.md']);
  });

  it('handles Windows separators in file-name order', () => {
    const items = [r('z\\b.md'), r('a\\c.md'), r('q\\a.md')];
    expect(order(items, 'file-name', 'asc')).toEqual(['q\\a.md', 'z\\b.md', 'a\\c.md']);
  });

  it('breaks ties by relative path, in either direction, so the order is deterministic', () => {
    const items = [r('b/x.md', 1), r('a/x.md', 1)];
    expect(order(items, 'modified-time', 'desc')).toEqual(['a/x.md', 'b/x.md']);
    expect(order(items, 'modified-time', 'asc')).toEqual(['a/x.md', 'b/x.md']);
    expect(order(items, 'file-name', 'asc')).toEqual(['a/x.md', 'b/x.md']);
  });
});

describe('search store slice', () => {
  const definition: SearchDefinition = {
    name: 'saved',
    searchText: 'needle',
    searchContents: true,
    searchNames: false,
    matchType: 'literal',
    sortBy: 'file-name',
    sortDirection: 'asc',
  };
  const result = (p: string) => ({ path: p, relativePath: p.slice(1), matchCount: 1 });

  beforeEach(() => {
    clearSearchResults();
  });

  it('setSearchOutcome publishes results, total, and the parameters together', () => {
    setSearchOutcome('/root', definition, { results: [result('/a.md')], totalMatches: 7 });
    const s = useAS.getState();
    expect(s.searchResults).toHaveLength(1);
    expect(s.searchTotalMatches).toBe(7);
    expect(s.searchQuery).toBe('needle');
    expect(s.searchFolder).toBe('/root');
    expect(s.searchName).toBe('saved');
    expect(s.searchSortBy).toBe('file-name');
    expect(s.searchSortDirection).toBe('asc');
    expect(s.lastSearchDefinition).toBe(definition);
  });

  it('removeSearchResult drops the result and decrements the total', () => {
    setSearchOutcome('/root', definition, { results: [result('/a.md'), result('/b.md')], totalMatches: 900 });
    removeSearchResult('/a.md');
    const s = useAS.getState();
    expect(s.searchResults.map(x => x.path)).toEqual(['/b.md']);
    expect(s.searchTotalMatches).toBe(899);
    expect(s.lastSearchDefinition).toBe(definition);
  });

  it('removeSearchResult ignores a path that is not in the results', () => {
    setSearchOutcome('/root', definition, { results: [result('/a.md')], totalMatches: 1 });
    removeSearchResult('/missing.md');
    expect(useAS.getState().searchTotalMatches).toBe(1);
  });

  it('clearSearchResults resets the total', () => {
    setSearchOutcome('/root', definition, { results: [result('/a.md')], totalMatches: 3 });
    clearSearchResults();
    expect(useAS.getState().searchTotalMatches).toBe(0);
    expect(useAS.getState().lastSearchDefinition).toBeNull();
  });
});

describe('initialSearchDefinition', () => {
  const saved = (searchText: string): SearchDefinition => ({
    name: 'saved',
    searchText,
    searchContents: false,
    searchNames: true,
    matchType: 'wildcard',
    sortBy: 'file-name',
    sortDirection: 'asc',
    mostRecent: true,
  });

  it('prefills a new search with the highlight text and the default options', () => {
    expect(initialSearchDefinition(undefined, 'highlighted')).toEqual(newSearchDefinition('highlighted'));
    expect(initialSearchDefinition(undefined, null).searchText).toBe('');
  });

  it("keeps a saved search's empty query instead of the highlight", () => {
    // Regression: `searchQuery || highlight` treated '' as missing, so editing a
    // saved Recent Files search showed (and on save, stored) the last highlight.
    expect(initialSearchDefinition(saved(''), 'highlighted').searchText).toBe('');
  });

  it("uses a saved search's own options, filling in the missing flags", () => {
    expect(initialSearchDefinition(saved('*.md'), 'highlighted')).toEqual({
      ...saved('*.md'),
      searchImageExif: false,
    });
  });
});

describe('isSearchDefinitionDirty', () => {
  const saved: SearchDefinition = { ...newSearchDefinition('foo'), name: 'saved' };
  // Older saved definitions may predate the optional flags.
  const { searchImageExif: _e, mostRecent: _m, ...legacy } = saved;

  it('is clean for a definition just loaded from the saved one', () => {
    expect(isSearchDefinitionDirty(initialSearchDefinition(legacy, null), legacy)).toBe(false);
  });

  it('treats missing optional flags as false', () => {
    expect(isSearchDefinitionDirty({ ...saved, mostRecent: false }, legacy)).toBe(false);
    expect(isSearchDefinitionDirty({ ...saved, mostRecent: true }, legacy)).toBe(true);
  });

  it('ignores surrounding whitespace in the query, since saves trim it', () => {
    expect(isSearchDefinitionDirty({ ...saved, searchText: '  foo\n' }, saved)).toBe(false);
  });

  it('ignores the name and detects any option change', () => {
    expect(isSearchDefinitionDirty({ ...saved, name: 'other' }, saved)).toBe(false);
    expect(isSearchDefinitionDirty({ ...saved, searchText: 'bar' }, saved)).toBe(true);
    expect(isSearchDefinitionDirty({ ...saved, matchType: 'advanced' }, saved)).toBe(true);
    expect(isSearchDefinitionDirty({ ...saved, sortDirection: 'asc' }, saved)).toBe(true);
  });
});

describe('validateSearchDefinitionName', () => {
  const names = ['Recent Edits', 'Todo'];

  it('requires a non-blank name', () => {
    expect(validateSearchDefinitionName('   ', names)).toMatch(/required/);
  });

  it('rejects a name that clashes, ignoring case and surrounding spaces', () => {
    expect(validateSearchDefinitionName(' recent edits ', names)).toMatch(/already exists/);
  });

  it('accepts a new name', () => {
    expect(validateSearchDefinitionName('Calendar', names)).toBeNull();
  });

  it('lets a definition be renamed to a different case of its own name', () => {
    expect(validateSearchDefinitionName('TODO', names, 'Todo')).toBeNull();
    expect(validateSearchDefinitionName('todo', names, 'Recent Edits')).toMatch(/already exists/);
  });
});
