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
}));

vi.mock('../src/services/api', () => ({
  api: {
    getConfig: vi.fn(),
    pathExists: vi.fn(),
  },
}));

import { loadConfig } from '../src/config';
import { setCurrentPath } from '../src/store';
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
