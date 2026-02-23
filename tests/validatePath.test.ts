/**
 * Unit tests for the validatePath function from src/ai/tools.ts.
 *
 * We mock the configMgr module so tests don't depend on any config file
 * on disk.  We also mock node:fs/promises so we control what realpath returns
 * without touching the real filesystem.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

// Mock configMgr.getConfig to return controlled agenticAllowedFolders
const mockGetConfig = vi.fn();

vi.mock('../src/configMgr', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

// Mock node:fs/promises so we can control realpath behaviour
const mockRealpath = vi.fn();

vi.mock('node:fs/promises', () => ({
  default: { realpath: (...args: unknown[]) => mockRealpath(...args) },
  realpath: (...args: unknown[]) => mockRealpath(...args),
}));

// Now import the function under test (after mocks are hoisted)
import { validatePath } from '../src/ai/tools';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Configure the mock to return the given allowed folders (newline-separated). */
function setAllowedFolders(...folders: string[]): void {
  mockGetConfig.mockReturnValue({
    agenticAllowedFolders: folders.join('\n'),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validatePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, realpath resolves to the input (no symlinks).
    mockRealpath.mockImplementation(async (p: string) => p);
  });

  // -----------------------------------------------------------------------
  // No allowed folders configured
  // -----------------------------------------------------------------------

  describe('when no allowed folders are configured', () => {
    it('throws an access-denied error', async () => {
      mockGetConfig.mockReturnValue({ agenticAllowedFolders: '' });
      await expect(validatePath('/home/user/file.txt')).rejects.toThrow(
        /no allowed folders configured/i
      );
    });

    it('throws when agenticAllowedFolders is undefined', async () => {
      mockGetConfig.mockReturnValue({});
      await expect(validatePath('/home/user/file.txt')).rejects.toThrow(
        /no allowed folders configured/i
      );
    });
  });

  // -----------------------------------------------------------------------
  // Standard (non-wildcard) paths
  // -----------------------------------------------------------------------

  describe('standard paths (no wildcards)', () => {
    it('accepts a path directly inside an allowed folder', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs/file.txt');
      expect(result).toBe('/home/user/docs/file.txt');
    });

    it('accepts a path in a nested subdirectory of an allowed folder', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs/sub/deep/file.md');
      expect(result).toBe('/home/user/docs/sub/deep/file.md');
    });

    it('accepts the allowed folder itself', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs');
      expect(result).toBe('/home/user/docs');
    });

    it('rejects a path outside all allowed folders', async () => {
      setAllowedFolders('/home/user/docs');
      await expect(validatePath('/etc/passwd')).rejects.toThrow(/access denied/i);
    });

    it('rejects a sibling folder of the allowed folder', async () => {
      setAllowedFolders('/home/user/docs');
      await expect(validatePath('/home/user/pictures/photo.jpg')).rejects.toThrow(
        /access denied/i
      );
    });

    it('rejects a path that is a prefix-but-not-subfolder (e.g. /home/user/docs2)', async () => {
      setAllowedFolders('/home/user/docs');
      await expect(validatePath('/home/user/docs2/file.txt')).rejects.toThrow(
        /access denied/i
      );
    });

    it('works with multiple allowed folders', async () => {
      setAllowedFolders('/home/user/docs', '/home/user/projects');
      const result = await validatePath('/home/user/projects/app/main.ts');
      expect(result).toBe('/home/user/projects/app/main.ts');
    });

    it('follows symlinks via realpath', async () => {
      setAllowedFolders('/home/user/docs');
      // Simulate a symlink that resolves to somewhere inside allowed
      mockRealpath.mockResolvedValueOnce('/home/user/docs/real-target.txt');
      const result = await validatePath('/home/user/docs/link.txt');
      expect(result).toBe('/home/user/docs/real-target.txt');
    });

    it('rejects a symlink that resolves outside allowed folders', async () => {
      setAllowedFolders('/home/user/docs');
      mockRealpath.mockResolvedValueOnce('/etc/shadow');
      await expect(validatePath('/home/user/docs/sneaky-link')).rejects.toThrow(
        /access denied/i
      );
    });

    it('falls back to resolved path when realpath fails (e.g. file does not exist)', async () => {
      setAllowedFolders('/home/user/docs');
      mockRealpath.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await validatePath('/home/user/docs/new-file.txt');
      expect(result).toBe('/home/user/docs/new-file.txt');
    });
  });

  // -----------------------------------------------------------------------
  // Wildcard paths
  // -----------------------------------------------------------------------

  describe('wildcard paths', () => {
    it('accepts a wildcard in the filename under an allowed folder', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs/*.md');
      expect(result).toBe('/home/user/docs/*.md');
    });

    it('accepts a wildcard with a prefix pattern', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs/report-*.txt');
      expect(result).toBe('/home/user/docs/report-*.txt');
    });

    it('accepts a wildcard in a subdirectory of an allowed folder', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs/sub/dir/*.log');
      expect(result).toBe('/home/user/docs/sub/dir/*.log');
    });

    it('accepts a bare * (all files) in the filename', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs/*');
      expect(result).toBe('/home/user/docs/*');
    });

    it('accepts multiple wildcards in the filename portion', async () => {
      setAllowedFolders('/home/user/docs');
      const result = await validatePath('/home/user/docs/*test*.md');
      expect(result).toBe('/home/user/docs/*test*.md');
    });

    it('rejects a wildcard in a directory component', async () => {
      setAllowedFolders('/home/user/docs');
      await expect(validatePath('/home/user/docs/*/file.txt')).rejects.toThrow(
        /wildcards are only allowed in the filename/i
      );
    });

    it('rejects a wildcard in a middle directory component', async () => {
      setAllowedFolders('/home/user/docs');
      await expect(validatePath('/home/user/*/sub/file.txt')).rejects.toThrow(
        /wildcards are only allowed in the filename/i
      );
    });

    it('rejects a wildcard path outside allowed folders', async () => {
      setAllowedFolders('/home/user/docs');
      await expect(validatePath('/etc/*.conf')).rejects.toThrow(/access denied/i);
    });

    it('rejects a relative wildcard path with no slash', async () => {
      setAllowedFolders('/home/user/docs');
      await expect(validatePath('*.txt')).rejects.toThrow(
        /cannot determine directory/i
      );
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles allowed folder with trailing slash', async () => {
      setAllowedFolders('/home/user/docs/');
      const result = await validatePath('/home/user/docs/file.txt');
      expect(result).toBe('/home/user/docs/file.txt');
    });

    it('handles blank lines and whitespace in allowed folders config', async () => {
      mockGetConfig.mockReturnValue({
        agenticAllowedFolders: '  /home/user/docs  \n\n  /home/user/projects  \n',
      });
      const result = await validatePath('/home/user/projects/app.ts');
      expect(result).toBe('/home/user/projects/app.ts');
    });
  });
});
