/**
 * Tests for the saved-search config helpers in src/renderer/searchUtil.ts
 * (renameSearchDefinitionInConfig): the store updates at once, the config is
 * persisted, and a failed persist rolls the store back.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SearchDefinition } from '../src/shared/shared';

const updateConfig = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('../src/renderer/api', () => ({
  api: { updateConfig: (...args: unknown[]) => updateConfig(...args) },
  ipcErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const { renameSearchDefinitionInConfig } = await import('../src/renderer/searchUtil');
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
