/**
 * writeFileAtomic tests — verifies that writes go through a temp file + rename
 * (so a crash can never leave a truncated file), that no temp files are left
 * behind on success, and that temp files are cleaned up on failure. Each test
 * runs against a fresh temp folder since these mutate files on disk.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileAtomic } from '../src/main/atomicWrite';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atomic-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

/** All entries currently in the temp dir (used to assert no temp files linger). */
async function listDir(): Promise<string[]> {
  return (await fs.promises.readdir(tmpDir)).sort();
}

describe('writeFileAtomic', () => {
  it('writes new content and leaves no temp file behind', async () => {
    const target = path.join(tmpDir, 'note.md');
    await writeFileAtomic(target, 'hello');

    expect(await fs.promises.readFile(target, 'utf8')).toBe('hello');
    // Only the target should remain — no leftover temp/.tmp files.
    expect(await listDir()).toEqual(['note.md']);
  });

  it('overwrites an existing file in place', async () => {
    const target = path.join(tmpDir, 'note.md');
    await fs.promises.writeFile(target, 'old content', 'utf8');

    await writeFileAtomic(target, 'new content');

    expect(await fs.promises.readFile(target, 'utf8')).toBe('new content');
    expect(await listDir()).toEqual(['note.md']);
  });

  it('does not truncate the original when the rename fails, and cleans up the temp file', async () => {
    // Make the target path a directory so rename(tempFile -> target) fails:
    // this exercises the failure path after the temp file has been written.
    const target = path.join(tmpDir, 'busy');
    await fs.promises.mkdir(target);
    await fs.promises.writeFile(path.join(target, 'child.txt'), 'keep me', 'utf8');

    await expect(writeFileAtomic(target, 'replacement')).rejects.toThrow();

    // The original directory (the "old" content) is untouched...
    expect(await fs.promises.readFile(path.join(target, 'child.txt'), 'utf8')).toBe('keep me');
    // ...and the failed write left no stray temp file in the directory.
    expect(await listDir()).toEqual(['busy']);
  });

  it('places the temp file in the same directory with a hidden, .tmp-suffixed name', async () => {
    // Spy on the rename so we can inspect the temp path the function chose
    // before it is renamed away on success.
    const target = path.join(tmpDir, 'doc.txt');
    const realRename = fs.promises.rename;
    let observedTmp: string | undefined;
    (fs.promises as { rename: typeof fs.promises.rename }).rename = async (from, to) => {
      observedTmp = String(from);
      return realRename(from, to);
    };
    try {
      await writeFileAtomic(target, 'data');
    } finally {
      (fs.promises as { rename: typeof fs.promises.rename }).rename = realRename;
    }

    expect(observedTmp).toBeDefined();
    const tmpPath = observedTmp as string;
    const tmpName = path.basename(tmpPath);
    // Same directory as the target (atomic rename requires same filesystem)...
    expect(path.dirname(tmpPath)).toBe(tmpDir);
    // ...hidden (leading dot, so a concurrent crawl skips it)...
    expect(tmpName.startsWith('.')).toBe(true);
    // ...and clearly a temp file.
    expect(tmpName.endsWith('.tmp')).toBe(true);
  });

  it('preserves the target file permission bits across a rewrite', async () => {
    // rename() replaces the target inode, so without copying the old mode onto
    // the temp file a restricted file would silently widen to the default 0644.
    const target = path.join(tmpDir, 'private.md');
    await fs.promises.writeFile(target, 'secret', 'utf8');
    await fs.promises.chmod(target, 0o600);

    await writeFileAtomic(target, 'new secret');

    expect(await fs.promises.readFile(target, 'utf8')).toBe('new secret');
    expect((await fs.promises.stat(target)).mode & 0o777).toBe(0o600);
    expect(await listDir()).toEqual(['private.md']);
  });

  it('fsyncs the temp file before renaming it into place', async () => {
    // Durability guarantee: the bytes must hit disk (handle.sync) BEFORE the
    // rename, otherwise a power loss could make the rename durable while the
    // data it points at was never written. Record the call order to prove it.
    const target = path.join(tmpDir, 'durable.txt');
    const order: string[] = [];

    const realOpen = fs.promises.open;
    const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      const realSync = handle.sync.bind(handle);
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        order.push('sync');
        return realSync();
      });
      return handle;
    });

    const realRename = fs.promises.rename;
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: Parameters<typeof realRename>) => {
      order.push('rename');
      return realRename(...args);
    });

    try {
      await writeFileAtomic(target, 'durable data');
    } finally {
      openSpy.mockRestore();
      renameSpy.mockRestore();
    }

    expect(await fs.promises.readFile(target, 'utf8')).toBe('durable data');
    // fsync happened, and it happened before the rename.
    expect(order).toEqual(['sync', 'rename']);
  });

  describe('symlinks', () => {
    it('writes through a symlink, preserving the link and updating the real target', async () => {
      // The temp-file+rename path would replace the link with a regular file and
      // fork the document from its real target. Instead we write through the link.
      const real = path.join(tmpDir, 'real.md');
      const link = path.join(tmpDir, 'link.md');
      await fs.promises.writeFile(real, 'old', 'utf8');
      await fs.promises.symlink(real, link);

      await writeFileAtomic(link, 'new');

      // The link is still a link (not clobbered into a regular file)...
      expect((await fs.promises.lstat(link)).isSymbolicLink()).toBe(true);
      // ...pointing at the same real target...
      expect(await fs.promises.readlink(link)).toBe(real);
      // ...whose bytes were updated (so the two never fork).
      expect(await fs.promises.readFile(real, 'utf8')).toBe('new');
      expect(await fs.promises.readFile(link, 'utf8')).toBe('new');
    });

    it('preserves the real target inode, mode and ownership when writing through a symlink', async () => {
      // Writing through the link keeps the existing inode (a plain rewrite), so
      // restrictive permissions survive without any explicit mode-copy.
      const real = path.join(tmpDir, 'real.md');
      const link = path.join(tmpDir, 'link.md');
      await fs.promises.writeFile(real, 'old', 'utf8');
      await fs.promises.chmod(real, 0o600);
      const inoBefore = (await fs.promises.stat(real)).ino;

      await writeFileAtomic(link, 'new');

      const statAfter = await fs.promises.stat(real);
      expect(statAfter.ino).toBe(inoBefore);
      expect(statAfter.mode & 0o777).toBe(0o600);
    });

    it('does not create a temp file or call rename when writing through a symlink', async () => {
      // Proves the write-through path was taken rather than the atomic path: no
      // rename, and no stray temp file left in the directory.
      const real = path.join(tmpDir, 'real.md');
      const link = path.join(tmpDir, 'link.md');
      await fs.promises.writeFile(real, 'old', 'utf8');
      await fs.promises.symlink(real, link);

      const renameSpy = vi.spyOn(fs.promises, 'rename');
      try {
        await writeFileAtomic(link, 'new');
      } finally {
        renameSpy.mockRestore();
      }

      expect(renameSpy).not.toHaveBeenCalled();
      // Only the real file and the link remain — no leftover .tmp file.
      expect(await listDir()).toEqual(['link.md', 'real.md']);
    });
  });
});
