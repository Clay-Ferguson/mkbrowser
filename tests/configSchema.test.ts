import { describe, it, expect } from 'vitest';
import { parseConfigYaml, defaultSettings, cloneDefaultSettings, coerceNonNegativeNumber } from '../src/configSchema';

// ---------------------------------------------------------------------------
// coerceNonNegativeNumber — shared coercion used by schema preprocess + configMgr
// ---------------------------------------------------------------------------

describe('coerceNonNegativeNumber', () => {
  it('passes through a finite non-negative number unchanged', () => {
    expect(coerceNonNegativeNumber(0)).toBe(0);
    expect(coerceNonNegativeNumber(3.5)).toBe(3.5);
    expect(coerceNonNegativeNumber(1000)).toBe(1000);
  });

  it('parses a numeric string to a number', () => {
    expect(coerceNonNegativeNumber('3.50')).toBe(3.5);
    expect(coerceNonNegativeNumber('0')).toBe(0);
    expect(coerceNonNegativeNumber('  10  ')).toBe(10);
  });

  it('returns undefined for negative numbers', () => {
    expect(coerceNonNegativeNumber(-1)).toBeUndefined();
    expect(coerceNonNegativeNumber('-5')).toBeUndefined();
  });

  it('returns undefined for non-finite numbers', () => {
    expect(coerceNonNegativeNumber(Infinity)).toBeUndefined();
    expect(coerceNonNegativeNumber(NaN)).toBeUndefined();
  });

  it('returns undefined for non-numeric strings', () => {
    expect(coerceNonNegativeNumber('bad')).toBeUndefined();
    expect(coerceNonNegativeNumber('')).toBeUndefined();
    expect(coerceNonNegativeNumber('  ')).toBeUndefined();
  });

  it('returns undefined for null, undefined, object, and boolean', () => {
    expect(coerceNonNegativeNumber(null)).toBeUndefined();
    expect(coerceNonNegativeNumber(undefined)).toBeUndefined();
    expect(coerceNonNegativeNumber({})).toBeUndefined();
    expect(coerceNonNegativeNumber(true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseConfigYaml — the untrusted-config equivalent of parseIndexYaml.
// These exercise the per-field tolerance rules documented in configSchema.ts.
// ---------------------------------------------------------------------------

describe('parseConfigYaml — top-level shape', () => {
  it('returns null for non-object top-level values', () => {
    // A bare scalar, a list, or null can't be a config object.
    expect(parseConfigYaml('nope')).toBeNull();
    expect(parseConfigYaml(42)).toBeNull();
    expect(parseConfigYaml(['a', 'b'])).toBeNull();
    expect(parseConfigYaml(null)).toBeNull();
    expect(parseConfigYaml(undefined)).toBeNull();
  });

  it('accepts an empty object and supplies a default browseFolder', () => {
    const cfg = parseConfigYaml({});
    expect(cfg).not.toBeNull();
    expect(cfg?.browseFolder).toBe('');
  });

  it('round-trips a fully valid config unchanged', () => {
    const valid = {
      browseFolder: '/home/me/notes',
      curSubFolder: '/home/me/notes/sub',
      aiEnabled: true,
      aiModel: 'Claude Haiku',
      recentFolders: ['/a', '/b'],
      imageSize: 'large',
      settings: {
        fontSize: 'large',
        sortOrder: 'modified-chron',
        foldersOnTop: false,
        showToc: true,
        ignoredPaths: 'node_modules',
        searchDefinitions: [],
        contentWidth: 'wide',
        bookmarks: [{ path: '/a', name: 'A' }],
        ocrToolsFolder: '',
        calendarItemsFolder: '',
      },
    };
    const cfg = parseConfigYaml(valid);
    expect(cfg).toMatchObject(valid);
  });

  it('preserves unknown / forward-compat keys (loose object)', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', someFutureKey: 123 });
    expect((cfg as Record<string, unknown> | null)?.someFutureKey).toBe(123);
  });
});

describe('parseConfigYaml — settings tolerance', () => {
  it('reverts a malformed enum field to its default', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { fontSize: 5, sortOrder: 'bogus' } });
    expect(cfg?.settings?.fontSize).toBe(defaultSettings.fontSize);
    expect(cfg?.settings?.sortOrder).toBe(defaultSettings.sortOrder);
  });

  it('reverts a non-array searchDefinitions to an empty list', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { searchDefinitions: 'oops' } });
    expect(cfg?.settings?.searchDefinitions).toEqual([]);
  });

  it('drops a corrupt searchDefinition element but keeps the good ones', () => {
    const good = {
      name: 'recent',
      searchText: 'foo',
      searchTarget: 'content',
      searchMode: 'literal',
      sortBy: 'modified-time',
      sortDirection: 'desc',
    };
    const cfg = parseConfigYaml({
      browseFolder: '/x',
      settings: { searchDefinitions: [good, { name: 'broken' /* missing fields */ }, { not: 'a def' }] },
    });
    expect(cfg?.settings?.searchDefinitions).toEqual([good]);
  });

  it('keeps a searchDefinition with a legacy/obsolete sortBy, coercing it to a default', () => {
    // Regression: a saved search with an obsolete `sortBy: line-time` (no longer
    // a valid SearchSortBy) must NOT be dropped — the bad enum field degrades to
    // its default instead of failing the whole element.
    const legacy = {
      name: 'TODOs - Today',
      searchText: "prop('tags')?.includes('todo')",
      searchTarget: 'content',
      searchMode: 'advanced',
      sortBy: 'line-time',
      sortDirection: 'desc',
      searchImageExif: false,
      mostRecent: false,
    };
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { searchDefinitions: [legacy] } });
    const defs = cfg?.settings?.searchDefinitions;
    expect(defs).toHaveLength(1);
    expect(defs?.[0]).toMatchObject({ name: 'TODOs - Today', sortBy: 'modified-time' });
  });

  it('preserves unknown keys inside settings', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { futureSetting: true } });
    expect((cfg?.settings as Record<string, unknown> | undefined)?.futureSetting).toBe(true);
  });

  it('preserves unknown forward-compat keys on a searchDefinition (loose element schema)', () => {
    const def = {
      name: 'X',
      searchText: 'foo',
      searchTarget: 'content',
      searchMode: 'literal',
      sortBy: 'modified-time',
      sortDirection: 'desc',
      futureField: 'keep-me',
    };
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { searchDefinitions: [def] } });
    expect((cfg?.settings?.searchDefinitions?.[0] as Record<string, unknown>).futureField).toBe('keep-me');
  });

  it('preserves unknown forward-compat keys on a bookmark (loose element schema)', () => {
    const cfg = parseConfigYaml({
      browseFolder: '/x',
      settings: { bookmarks: [{ path: '/p', name: 'B', futureField: 'keep-me' }] },
    });
    expect((cfg?.settings?.bookmarks?.[0] as Record<string, unknown>).futureField).toBe('keep-me');
  });
});

describe('parseConfigYaml — aiModels tolerance', () => {
  it('keeps a model with an unsupported provider, coercing it to a default', () => {
    // Regression: an unsupported `provider` must NOT drop the whole model (its
    // name/model id/pricing) — same data-loss class as the legacy `sortBy` bug.
    // The bad enum degrades to AI_PROVIDERS[0] instead.
    const valid = { name: 'M', provider: 'OPENAI', model: 'gpt-x', inputPer1M: 1, outputPer1M: 2, vision: true, readonly: false };
    const cfg = parseConfigYaml({
      browseFolder: '/x',
      aiModels: [valid, { name: 'Bad', provider: 'NOPE', model: 'y', inputPer1M: 1, outputPer1M: 2, vision: false, readonly: false }],
    });
    expect(cfg?.aiModels).toHaveLength(2);
    expect(cfg?.aiModels?.[0]).toEqual(valid);
    expect(cfg?.aiModels?.[1]).toMatchObject({ name: 'Bad', model: 'y', provider: 'ANTHROPIC' });
  });

  it('still drops a model that is missing required string fields', () => {
    const valid = { name: 'M', provider: 'OPENAI', model: 'gpt-x', inputPer1M: 1, outputPer1M: 2, vision: true, readonly: false };
    const cfg = parseConfigYaml({
      browseFolder: '/x',
      aiModels: [valid, { provider: 'OPENAI' /* no name/model */ }, { not: 'a model' }],
    });
    expect(cfg?.aiModels).toEqual([valid]);
  });

  it('preserves unknown forward-compat keys on a model (loose element schema)', () => {
    const cfg = parseConfigYaml({
      browseFolder: '/x',
      aiModels: [{ name: 'M', provider: 'OPENAI', model: 'm', inputPer1M: 1, outputPer1M: 2, vision: false, readonly: false, futureField: 'keep-me' }],
    });
    expect((cfg?.aiModels?.[0] as Record<string, unknown>).futureField).toBe('keep-me');
  });

  it('coerces numeric-string prices and defaults bad prices to 0', () => {
    const cfg = parseConfigYaml({
      browseFolder: '/x',
      aiModels: [{ name: 'M', provider: 'OPENAI', model: 'm', inputPer1M: '3.50', outputPer1M: 'bad', vision: false, readonly: false }],
    });
    expect(cfg?.aiModels?.[0].inputPer1M).toBe(3.5);
    expect(cfg?.aiModels?.[0].outputPer1M).toBe(0);
  });

  it('falls back to an empty list when aiModels is not an array', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', aiModels: {} });
    expect(cfg?.aiModels).toEqual([]);
  });
});

describe('cloneDefaultSettings — immutability', () => {
  it('returns a new object each call', () => {
    const a = cloneDefaultSettings();
    const b = cloneDefaultSettings();
    expect(a).not.toBe(b);
  });

  it('returns distinct searchDefinitions and bookmarks arrays each call', () => {
    const a = cloneDefaultSettings();
    const b = cloneDefaultSettings();
    expect(a.searchDefinitions).not.toBe(b.searchDefinitions);
    expect(a.bookmarks).not.toBe(b.bookmarks);
  });

  it('mutating cloned arrays does not corrupt defaultSettings', () => {
    const clone = cloneDefaultSettings();
    (clone.bookmarks as Array<{ path: string; name: string }>).push({ path: '/x', name: 'X' });
    (clone.searchDefinitions as Array<unknown>).push({ name: 'test' });
    expect(defaultSettings.bookmarks).toHaveLength(0);
    expect(defaultSettings.searchDefinitions).toHaveLength(0);
  });

  it('two failing array parses produce independent empty arrays', () => {
    const cfg1 = parseConfigYaml({ browseFolder: '/a', settings: { bookmarks: 'not-an-array' } });
    const cfg2 = parseConfigYaml({ browseFolder: '/b', settings: { bookmarks: 'not-an-array' } });
    expect(cfg1?.settings?.bookmarks).not.toBe(cfg2?.settings?.bookmarks);
  });
});

describe('parseConfigYaml — top-level field tolerance', () => {
  it('drops non-string elements from recentFolders', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', recentFolders: ['/a', 42, '/b', null] });
    expect(cfg?.recentFolders).toEqual(['/a', '/b']);
  });

  it('drops a malformed optional scalar rather than failing the whole config', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', aiEnabled: 'yes', calendarViewType: 'nope' });
    expect(cfg).not.toBeNull();
    expect(cfg?.aiEnabled).toBeUndefined();
    expect(cfg?.calendarViewType).toBeUndefined();
  });
});

describe('parseConfigYaml — showPropsInEditor default', () => {
  it('falls back to the canonical default when showPropsInEditor is absent', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: {} });
    expect(cfg?.settings?.showPropsInEditor).toBe(defaultSettings.showPropsInEditor);
  });

  it('preserves an explicit false value for showPropsInEditor', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { showPropsInEditor: false } });
    expect(cfg?.settings?.showPropsInEditor).toBe(false);
  });

  it('falls back to default when showPropsInEditor is a non-boolean', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { showPropsInEditor: 'yes' } });
    expect(cfg?.settings?.showPropsInEditor).toBe(defaultSettings.showPropsInEditor);
  });
});
