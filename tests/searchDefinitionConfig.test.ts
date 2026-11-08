/**
 * Tests for the saved-search config helpers in src/renderer/searchUtil.ts
 * (renameSearchDefinitionInConfig): the store updates at once, the config is
 * persisted, and a failed persist rolls the store back. Also checks that
 * saveSearchDefinitionToConfig refuses a built-in (`internal`) search.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SearchDefinition } from '../src/shared/shared';

const updateConfig = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('../src/renderer/api', () => ({
  api: { updateConfig: (...args: unknown[]) => updateConfig(...args) },
  ipcErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const { renameSearchDefinitionInConfig, saveSearchDefinitionToConfig } = await import('../src/renderer/searchUtil');
const { recentFilesSearchDefinition } = await import('../src/shared/searchHelpers');
const { useAS } = await import('../src/store/core');

const def = (name: string): SearchDefinition => ({
  name,
  searchText: `${name} query`,
  searchContents: true,
  searchNames: false,
  matchType: 'literal',
  sortBy: 'modified-time',
  sortDirection: 'desc',
});

const names = () => useAS.getState().settings.searchDefinitions.map((d) => d.name);

beforeEach(() => {
  updateConfig.mockReset();
  const settings = useAS.getState().settings;
  useAS.setState({ settings: { ...settings, searchDefinitions: [def('a'), def('b'), def('c')] } });
});

describe('renameSearchDefinitionInConfig', () => {
  it('renames in place, keeping the options and list position, and persists', async () => {
    updateConfig.mockResolvedValue(undefined);
    await renameSearchDefinitionInConfig('b', 'bee');
    expect(names()).toEqual(['a', 'bee', 'c']);
    expect(useAS.getState().settings.searchDefinitions[1].searchText).toBe('b query');
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it('rolls the store back and rethrows when the persist fails', async () => {
    updateConfig.mockRejectedValue(new Error('disk full'));
    await expect(renameSearchDefinitionInConfig('b', 'bee')).rejects.toThrow();
    expect(names()).toEqual(['a', 'b', 'c']);
  });
});

describe('saveSearchDefinitionToConfig', () => {
  it('saves a user definition', async () => {
    updateConfig.mockResolvedValue(undefined);
    await saveSearchDefinitionToConfig(def('d'));
    expect(names()).toEqual(['a', 'b', 'c', 'd']);
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it('refuses a built-in (internal) definition without touching the store or config', async () => {
    await expect(saveSearchDefinitionToConfig(recentFilesSearchDefinition())).rejects.toThrow(/Built-in/);
    expect(names()).toEqual(['a', 'b', 'c']);
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
