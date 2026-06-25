import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/store', () => ({
  setSettings: vi.fn(),
  setCurrentPath: vi.fn(),
  setCalendarViewType: vi.fn(),
  setImageSize: vi.fn(),
  setAiConfig: vi.fn(),
  defaultAiConfig: {
    aiEnabled: false,
    aiRewriteMode: false,
    aiRewritePrompt: '',
    aiRewritePrompts: [],
    tagsPanelVisible: false,
    fullDocContext: false,
    aiModels: [],
    aiModel: '',
    llamacppBaseUrl: 'http://localhost:8080/v1',
    llamacppFolder: '',
    agenticMode: false,
    agenticAllowedFolders: '',
  },
  defaultSettings: {
    fontSize: 'medium',
    sortOrder: 'alphabetical',
    foldersOnTop: true,
    showToc: true,
    ignoredPaths: '',
    searchDefinitions: [],
    contentWidth: 'medium',
    bookmarks: [],
    ocrToolsFolder: '',
    calendarItemsFolder: '',
    indexTreeWidth: 'narrow',
    showPropsInEditor: true,
  },
}));

vi.mock('../src/services/api', () => ({
  api: {
    getConfig: vi.fn(),
    pathExists: vi.fn(),
  },
}));

import { loadConfig } from '../src/config';
import { setCurrentPath, setSettings, defaultSettings } from '../src/store';
import { api } from '../src/services/api';

describe('loadConfig — subfolder path validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not restore a curSubFolder that shares a name prefix but is not nested inside browseFolder', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      browseFolder: '/home/user/docs',
      curSubFolder: '/home/user/docs-backup/secret',
    } as never);
    vi.mocked(api.pathExists).mockResolvedValue(true);

    const result = await loadConfig();

    expect(result.rootPath).toBe('/home/user/docs');
    // Should fall back to browseFolder, not the bogus prefix-matching curSubFolder
    expect(setCurrentPath).toHaveBeenCalledWith('/home/user/docs');
    // pathExists called only once: for browseFolder; curSubFolder must be skipped
    expect(api.pathExists).toHaveBeenCalledTimes(1);
    expect(api.pathExists).toHaveBeenCalledWith('/home/user/docs');
  });

  it('restores a curSubFolder that is genuinely nested inside browseFolder', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      browseFolder: '/home/user/docs',
      curSubFolder: '/home/user/docs/2024/notes',
    } as never);
    vi.mocked(api.pathExists).mockResolvedValue(true);

    await loadConfig();

    expect(setCurrentPath).toHaveBeenCalledWith('/home/user/docs/2024/notes');
    expect(api.pathExists).toHaveBeenCalledTimes(2);
  });

  it('falls back to browseFolder when curSubFolder does not exist on disk', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      browseFolder: '/home/user/docs',
      curSubFolder: '/home/user/docs/deleted-sub',
    } as never);
    // browseFolder exists, curSubFolder does not
    vi.mocked(api.pathExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await loadConfig();

    expect(setCurrentPath).toHaveBeenCalledWith('/home/user/docs');
  });

  it('treats curSubFolder equal to browseFolder as valid (same path)', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      browseFolder: '/home/user/docs',
      curSubFolder: '/home/user/docs',
    } as never);
    vi.mocked(api.pathExists).mockResolvedValue(true);

    await loadConfig();

    expect(setCurrentPath).toHaveBeenCalledWith('/home/user/docs');
    expect(api.pathExists).toHaveBeenCalledTimes(2);
  });
});

describe('loadConfig — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the underlying error and returns the fallback result when api.getConfig throws', async () => {
    const cause = new Error('IPC channel closed');
    vi.mocked(api.getConfig).mockRejectedValue(cause);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await loadConfig();

    expect(spy).toHaveBeenCalledWith('[config] loadConfig failed', cause);
    expect(result).toEqual({
      rootPath: null,
      loaded: false,
      error: 'Failed to load configuration',
      lastExportFolder: '',
      aiEnabled: false,
      recentFolders: [],
    });

    spy.mockRestore();
  });
});

describe('loadConfig — common result fields are consistent across branches', () => {
  const commonConfig = {
    lastExportFolder: '/exports',
    aiEnabled: true,
    recentFolders: ['/a', '/b'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns common fields when browseFolder is absent', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({ ...commonConfig } as never);

    const result = await loadConfig();

    expect(result.loaded).toBe(true);
    expect(result.error).toBeNull();
    expect(result.rootPath).toBeNull();
    expect(result.lastExportFolder).toBe('/exports');
    expect(result.aiEnabled).toBe(true);
    expect(result.recentFolders).toEqual(['/a', '/b']);
  });

  it('returns common fields when browseFolder does not exist on disk', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      ...commonConfig,
      browseFolder: '/missing',
    } as never);
    vi.mocked(api.pathExists).mockResolvedValue(false);

    const result = await loadConfig();

    expect(result.rootPath).toBeNull();
    expect(result.lastExportFolder).toBe('/exports');
    expect(result.aiEnabled).toBe(true);
    expect(result.recentFolders).toEqual(['/a', '/b']);
  });

  it('returns common fields when browseFolder is valid', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      ...commonConfig,
      browseFolder: '/home/user/docs',
    } as never);
    vi.mocked(api.pathExists).mockResolvedValue(true);

    const result = await loadConfig();

    expect(result.rootPath).toBe('/home/user/docs');
    expect(result.lastExportFolder).toBe('/exports');
    expect(result.aiEnabled).toBe(true);
    expect(result.recentFolders).toEqual(['/a', '/b']);
  });
});

describe('loadConfig — settings seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.pathExists).mockResolvedValue(false);
  });

  it('seeds settings from store defaultSettings when config has no settings', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({ browseFolder: '/x' } as never);

    await loadConfig();

    expect(setSettings).not.toHaveBeenCalled();
  });

  it('seeds settings spreading store defaults first so store-only fields like indexTreeWidth are always present', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      browseFolder: '/x',
      settings: { fontSize: 'large', showPropsInEditor: true },
    } as never);

    await loadConfig();

    expect(vi.mocked(setSettings)).toHaveBeenCalledWith({
      ...defaultSettings,
      fontSize: 'large',
      showPropsInEditor: true,
    });
  });

  it('lets config settings override the store default for showPropsInEditor', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      browseFolder: '/x',
      settings: { showPropsInEditor: false },
    } as never);

    await loadConfig();

    const called = vi.mocked(setSettings).mock.calls[0][0];
    expect(called.showPropsInEditor).toBe(false);
  });

  it('provides indexTreeWidth from store defaults even though it is not persisted in the config', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      browseFolder: '/x',
      settings: { fontSize: 'small' },
    } as never);

    await loadConfig();

    const called = vi.mocked(setSettings).mock.calls[0][0];
    expect(called.indexTreeWidth).toBe(defaultSettings.indexTreeWidth);
  });
});
