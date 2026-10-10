/**
 * Tests for loadDirectoryContents' handling of a current folder that no longer
 * exists (e.g. deleted from the index tree's context menu): it must navigate up
 * to the nearest surviving ancestor rather than showing an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { currentPath: '' };

vi.mock('../src/store', () => ({
  useAS: { getState: () => state },
  applyDirectoryListing: vi.fn(),
  setCurrentEntries: vi.fn(),
  setEntriesLoading: vi.fn(),
  setAppError: vi.fn(),
  setCurrentPath: vi.fn(),
  getIndexTreeRoot: vi.fn(() => null),
  setIndexTreeRoot: vi.fn(),
}));

vi.mock('../src/renderer/api', () => ({
  getApi: () => undefined,
  api: {
    readDirectory: vi.fn(),
    pathExists: vi.fn(),
  },
}));

import { loadDirectoryContents } from '../src/renderer/directoryLoader';
import { setAppError, setCurrentPath, setCurrentEntries, applyDirectoryListing } from '../src/store';
import { api } from '../src/renderer/api';

describe('loadDirectoryContents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs the listing when the folder exists', async () => {
    state.currentPath = '/docs';
    vi.mocked(api.readDirectory).mockResolvedValue([]);
    await loadDirectoryContents('/docs', true);
    expect(applyDirectoryListing).toHaveBeenCalledWith('/docs', []);
    expect(setCurrentPath).not.toHaveBeenCalled();
  });

  it('navigates to the parent when the current folder was deleted', async () => {
    state.currentPath = '/docs/gone';
    vi.mocked(api.readDirectory).mockRejectedValue(new Error('Cannot access directory: /docs/gone'));
    vi.mocked(api.pathExists).mockImplementation(async p => p === '/docs');
    await loadDirectoryContents('/docs/gone', true);
    expect(setCurrentPath).toHaveBeenCalledWith('/docs');
    expect(setCurrentEntries).not.toHaveBeenCalled();
    expect(setAppError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('skips over deleted ancestors to the nearest surviving one', async () => {
    state.currentPath = '/docs/a/b';
    vi.mocked(api.readDirectory).mockRejectedValue(new Error('Cannot access directory'));
    vi.mocked(api.pathExists).mockImplementation(async p => p === '/docs');
    await loadDirectoryContents('/docs/a/b', true);
    expect(setCurrentPath).toHaveBeenCalledWith('/docs');
  });

  it('shows an error when the folder exists but cannot be read', async () => {
    state.currentPath = '/docs/locked';
    vi.mocked(api.readDirectory).mockRejectedValue(new Error('EACCES'));
    vi.mocked(api.pathExists).mockResolvedValue(true);
    await loadDirectoryContents('/docs/locked', true);
    expect(setCurrentPath).not.toHaveBeenCalled();
    expect(setAppError).toHaveBeenCalledWith('Failed to read directory');
    expect(setCurrentEntries).toHaveBeenCalledWith([]);
  });

  it('does not navigate if the user moved elsewhere during the read', async () => {
    state.currentPath = '/docs/gone';
    vi.mocked(api.readDirectory).mockImplementation(async () => {
      state.currentPath = '/other';
      throw new Error('Cannot access directory');
    });
    vi.mocked(api.pathExists).mockImplementation(async p => p === '/docs');
    await loadDirectoryContents('/docs/gone', true);
    expect(setCurrentPath).not.toHaveBeenCalled();
  });
});
