import { describe, it, expect } from 'vitest';
import { parseConfigYaml, defaultSettings, cloneDefaultSettings } from '../src/configSchema';

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

  it('preserves unknown keys inside settings', () => {
    const cfg = parseConfigYaml({ browseFolder: '/x', settings: { futureSetting: true } });
    expect((cfg?.settings as Record<string, unknown> | undefined)?.futureSetting).toBe(true);
  });
});

describe('parseConfigYaml — aiModels tolerance', () => {
  it('drops a model with an invalid provider, keeps valid ones', () => {
    const valid = { name: 'M', provider: 'OPENAI', model: 'gpt-x', inputPer1M: 1, outputPer1M: 2, vision: true, readonly: false };
    const cfg = parseConfigYaml({
      browseFolder: '/x',
      aiModels: [valid, { name: 'Bad', provider: 'NOPE', model: 'y' }],
    });
    expect(cfg?.aiModels).toEqual([valid]);
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
