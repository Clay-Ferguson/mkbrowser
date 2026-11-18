/**
 * Tests for the pure search helpers (compareSearchResults, newSearchDefinition,
 * initialSearchDefinition, isSearchDefinitionDirty, validateSearchDefinitionName in
 * src/shared/searchHelpers.ts) and the search store slice (src/store/search.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { compareSearchResults, formatOrderValue, parseTagFilter, matchesTagFilter, matchesTypeFilter, newSearchDefinition, recentFilesSearchDefinition, initialSearchDefinition, isSearchDefinitionDirty, validateSearchDefinitionName } from '../src/shared/searchHelpers';
import { useAS } from '../src/store/core';
import { setSearchOutcome, removeSearchResult, clearSearchResults } from '../src/store/search';
import type { SearchDefinition, SortKey } from '../src/shared/shared';

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

describe('compareSearchResults — custom', () => {
  const k = (relativePath: string, sortKey?: SortKey) => ({ relativePath, sortKey });
  const orderCustom = (items: ReturnType<typeof k>[], direction: 'asc' | 'desc') =>
    [...items].sort(compareSearchResults('custom', direction)).map(i => i.relativePath);

  it('sorts numbers in both directions', () => {
    const items = [k('b', 2), k('a', 1), k('c', 3)];
    expect(orderCustom(items, 'asc')).toEqual(['a', 'b', 'c']);
    expect(orderCustom(items, 'desc')).toEqual(['c', 'b', 'a']);
  });

  it('puts missing values last in both directions', () => {
    const items = [k('none'), k('nul', null), k('one', 1), k('two', 2)];
    expect(orderCustom(items, 'asc')).toEqual(['one', 'two', 'none', 'nul']);
    expect(orderCustom(items, 'desc')).toEqual(['two', 'one', 'none', 'nul']);
  });

  it('compares strings ignoring case, with numeric runs by value', () => {
    const items = [k('x', 'item 10'), k('y', 'Item 2'), k('z', 'apple')];
    expect(orderCustom(items, 'asc')).toEqual(['z', 'y', 'x']);
  });

  it('puts numbers before strings', () => {
    expect(orderCustom([k('s', 'a'), k('n', 99)], 'asc')).toEqual(['n', 's']);
  });

  it('compares arrays element by element, nulls (and missing elements) last at each position', () => {
    const items = [
      k('p2-late', [2, 200]),
      k('p1-nodue', [1, null]),
      k('p1-early', [1, 100]),
      k('p1-late', [1, 200]),
      k('p1-short', [1]),
    ];
    expect(orderCustom(items, 'asc')).toEqual(['p1-early', 'p1-late', 'p1-nodue', 'p1-short', 'p2-late']);
    expect(orderCustom(items, 'desc')).toEqual(['p2-late', 'p1-late', 'p1-early', 'p1-nodue', 'p1-short']);
  });

  it('breaks ties by relative path', () => {
    expect(orderCustom([k('b', 1), k('a', 1)], 'desc')).toEqual(['a', 'b']);
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
      tags: '',
      type: '',
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

  it('compares the sort expression trimmed, with a missing one equal to empty', () => {
    expect(isSearchDefinitionDirty({ ...saved, sortExpression: '' }, saved)).toBe(false);
    expect(isSearchDefinitionDirty({ ...saved, sortExpression: 'ts(p.due)' }, saved)).toBe(true);
    const custom = { ...saved, sortBy: 'custom' as const, sortExpression: 'ts(p.due)' };
    expect(isSearchDefinitionDirty({ ...custom, sortExpression: ' ts(p.due)\n' }, custom)).toBe(false);
  });
});

describe('isSearchDefinitionDirty — tags', () => {
  const saved: SearchDefinition = { ...newSearchDefinition('foo'), name: 'saved' };
  const { tags: _t, ...legacy } = saved;

  it('treats missing tags as empty and compares them trimmed', () => {
    expect(isSearchDefinitionDirty({ ...saved, tags: '' }, legacy)).toBe(false);
    expect(isSearchDefinitionDirty({ ...saved, tags: 'p1' }, legacy)).toBe(true);
    expect(isSearchDefinitionDirty({ ...saved, tags: ' p1 ' }, { ...saved, tags: 'p1' })).toBe(false);
    expect(isSearchDefinitionDirty({ ...saved, tags: 'p1, p2' }, { ...saved, tags: 'p1' })).toBe(true);
  });
});

describe('isSearchDefinitionDirty — type', () => {
  const saved: SearchDefinition = { ...newSearchDefinition('foo'), name: 'saved' };
  const { type: _t, ...legacy } = saved;

  it('treats a missing type as empty and compares it trimmed', () => {
    expect(isSearchDefinitionDirty({ ...saved, type: '' }, legacy)).toBe(false);
    expect(isSearchDefinitionDirty({ ...saved, type: 'todo' }, legacy)).toBe(true);
    expect(isSearchDefinitionDirty({ ...saved, type: ' todo ' }, { ...saved, type: 'todo' })).toBe(false);
  });
});

describe('matchesTypeFilter', () => {
  it('matches the root type property ignoring case and surrounding whitespace', () => {
    expect(matchesTypeFilter({ type: 'todo' }, 'todo')).toBe(true);
    expect(matchesTypeFilter({ type: ' ToDo ' }, ' TODO')).toBe(true);
    expect(matchesTypeFilter({ type: 'todos' }, 'todo')).toBe(false);
    expect(matchesTypeFilter({ type: 'person' }, 'todo')).toBe(false);
  });

  it('never matches a missing, non-string or nested type', () => {
    expect(matchesTypeFilter(null, 'todo')).toBe(false);
    expect(matchesTypeFilter({}, 'todo')).toBe(false);
    expect(matchesTypeFilter({ type: ['todo'] }, 'todo')).toBe(false);
    expect(matchesTypeFilter({ meta: { type: 'todo' } }, 'todo')).toBe(false);
    expect(matchesTypeFilter(Object.create({ type: 'todo' }) as Record<string, unknown>, 'todo')).toBe(false);
  });

  it('an empty type matches every file', () => {
    expect(matchesTypeFilter(null, '  ')).toBe(true);
  });
});

describe('parseTagFilter', () => {
  it('splits on commas, trims, lowercases and drops a leading #', () => {
    expect(parseTagFilter(' purchased,  #P1 ,##Important')).toEqual({ include: ['purchased', 'p1', 'important'], exclude: [] });
  });

  it('treats a ! prefix as a tag that must be absent', () => {
    expect(parseTagFilter('purchased, !returned, ! #Done')).toEqual({ include: ['purchased'], exclude: ['returned', 'done'] });
  });

  it('returns null when no tag is left', () => {
    expect(parseTagFilter(undefined)).toBeNull();
    expect(parseTagFilter('')).toBeNull();
    expect(parseTagFilter(' , ,# , !')).toBeNull();
  });
});

describe('matchesTagFilter', () => {
  const filter = parseTagFilter('purchased, p1, !returned')!;

  it('needs every included tag and none of the excluded ones', () => {
    expect(matchesTagFilter(['p1', 'purchased', 'other'], filter)).toBe(true);
    expect(matchesTagFilter(['purchased'], filter)).toBe(false);
    expect(matchesTagFilter(['purchased', 'p1', 'returned'], filter)).toBe(false);
    expect(matchesTagFilter([], filter)).toBe(false);
  });

  it('ignores case and a leading # on the file\'s tags, but matches whole names', () => {
    expect(matchesTagFilter(['Purchased', '#P1'], filter)).toBe(true);
    expect(matchesTagFilter(['purchased', 'p10'], filter)).toBe(false);
  });

  it('with only exclusions, matches untagged files', () => {
    expect(matchesTagFilter([], parseTagFilter('!done')!)).toBe(true);
    expect(matchesTagFilter(['done'], parseTagFilter('!done')!)).toBe(false);
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

describe('recentFilesSearchDefinition', () => {
  it('is an internal, empty-query, names-only Recent Files search, newest first', () => {
    // Names-only so the listing covers every file type, not just the .md/.txt
    // content candidates; excludeFolders keeps folders out of it.
    // See: (USER_GUIDE.md#recent-files)
    expect(recentFilesSearchDefinition()).toMatchObject({
      name: 'Recent Files',
      searchText: '',
      searchContents: false,
      searchNames: true,
      mostRecent: true,
      excludeFolders: true,
      sortBy: 'modified-time',
      sortDirection: 'desc',
      internal: true,
    });
  });

  it('returns a fresh object each call', () => {
    expect(recentFilesSearchDefinition()).not.toBe(recentFilesSearchDefinition());
  });
});

describe('formatOrderValue', () => {
  const t = new Date(2026, 0, 15, 9, 30).getTime();
  const t2 = new Date(2026, 5, 1, 16, 5).getTime();
  const res = { relativePath: 'notes/2026/todo.md', modifiedTime: t, createdTime: t2 };

  it('shows the base name for a file-name sort', () => {
    expect(formatOrderValue(res, 'file-name')).toBe('todo.md');
    expect(formatOrderValue({ relativePath: 'a\\b\\c.txt' }, 'file-name')).toBe('c.txt');
    expect(formatOrderValue({ relativePath: 'top.md' }, 'file-name')).toBe('top.md');
  });

  it('shows the sorted-by timestamp for time sorts', () => {
    expect(formatOrderValue(res, 'modified-time')).toBe('2026-01-15 09:30 AM');
    expect(formatOrderValue(res, 'created-time')).toBe('2026-06-01 04:05 PM');
  });

  it('shows the custom sort label', () => {
    expect(formatOrderValue({ ...res, sortLabel: '1 · 2026-03-01' }, 'custom')).toBe('1 · 2026-03-01');
  });

  it('is never blank: a missing value shows as an em dash', () => {
    expect(formatOrderValue({ relativePath: 'x.md' }, 'modified-time')).toBe('—');
    expect(formatOrderValue({ relativePath: 'x.md', createdTime: 0 }, 'created-time')).toBe('—');
    expect(formatOrderValue({ relativePath: 'x.md' }, 'custom')).toBe('—');
    expect(formatOrderValue({ relativePath: 'x.md', sortLabel: '' }, 'custom')).toBe('—');
  });
});
