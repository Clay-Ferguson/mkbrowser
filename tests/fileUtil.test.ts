import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readDirectory, isFolderEmpty, deleteEmptyFolder } from '../src/main/fileUtil';
import { ATTACH_SUFFIX, INDEX_FILENAME } from '../src/shared/specialFiles';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fileUtil-test-')));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readDirectory attach folder pre-loading', () => {
  it('pre-loads the contents of a real .attach folder', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.md'), '# foo', 'utf8');
    fs.mkdirSync(path.join(tmpDir, `foo.md${ATTACH_SUFFIX}`));
    fs.writeFileSync(path.join(tmpDir, `foo.md${ATTACH_SUFFIX}`, 'pic.png'), 'x', 'utf8');

    const entries = await readDirectory(tmpDir, false);
    const attach = entries.find((e) => e.name === `foo.md${ATTACH_SUFFIX}`);
    expect(attach?.attachments?.map((a) => a.name)).toEqual(['pic.png']);
  });

  it('does not recurse into symlinked .attach folders', async () => {
    // Two links resolving to their own parent. Recursing through them fans out
    // exponentially until the kernel's symlink-resolution limit (~40 levels)
    // stops it, which hangs the main process rather than returning a listing.
    fs.symlinkSync(tmpDir, path.join(tmpDir, `a.md${ATTACH_SUFFIX}`));
    fs.symlinkSync(tmpDir, path.join(tmpDir, `b.md${ATTACH_SUFFIX}`));

    const entries = await readDirectory(tmpDir, false);

    // The links still list as directories; only the pre-load is skipped.
    expect(entries.map((e) => e.name)).toEqual([`a.md${ATTACH_SUFFIX}`, `b.md${ATTACH_SUFFIX}`]);
    for (const entry of entries) {
      expect(entry.isDirectory).toBe(true);
      expect(entry.attachments).toBeUndefined();
    }
  }, 10000);
});

describe('readDirectory I/O fan-out', () => {
  it('bounds the number of concurrently processed entries (EMFILE protection)', async () => {
    // A large directory: every entry spawns its own async task (stat, and for
    // some entries fd-holding readFile/readdir calls). If those tasks all run
    // at once, the fd-holding ones can exhaust the process's file-descriptor
    // limit (EMFILE) — and because every per-entry failure in readDirectory is
    // swallowed, the damage is silent: missing aiHints, missing attachments,
    // and fabricated Date.now() timestamps from the stat-failure fallback.
    //
    // EMFILE itself is ulimit-dependent, so instead of provoking it we measure
    // the peak number of per-entry tasks in flight simultaneously, via a
    // stat spy that holds each call open for a tick so overlap is observable.
    const fileCount = 200;
    for (let i = 0; i < fileCount; i++) {
      fs.writeFileSync(path.join(tmpDir, `f${i}.md`), '', 'utf8');
    }

    const realStat = fs.promises.stat.bind(fs.promises);
    let inFlight = 0;
    let peak = 0;
    const spy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (...args) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => { setTimeout(r, 1); }); // hold the slot so overlap is measurable
        return await realStat(...(args as Parameters<typeof realStat>));
      } finally {
        inFlight--;
      }
    });
    try {
      const entries = await readDirectory(tmpDir, false);
      expect(entries).toHaveLength(fileCount);
    } finally {
      spy.mockRestore();
    }

    // 32 is the codebase-wide bound for fs fan-outs (see RECONCILE_FILE_CONCURRENCY
    // in indexUtil.ts). Unbounded Promise.all would peak at ~fileCount here.
    expect(peak).toBeLessThanOrEqual(32);
  }, 15000);
});

describe('isFolderEmpty', () => {
  it('is true for a folder with no entries', async () => {
    expect(await isFolderEmpty(tmpDir)).toBe(true);
  });

  it('counts hidden files, which readDirectory leaves out of the listing', async () => {
    fs.writeFileSync(path.join(tmpDir, '.secret'), '', 'utf8');
    expect(await readDirectory(tmpDir, false)).toEqual([]);
    expect(await isFolderEmpty(tmpDir)).toBe(false);
  });

  it('treats a folder holding only .INDEX.yaml as empty', async () => {
    fs.writeFileSync(path.join(tmpDir, INDEX_FILENAME), 'files: []', 'utf8');
    expect(await isFolderEmpty(tmpDir)).toBe(true);
  });

  it('is false when .INDEX.yaml sits beside any other entry', async () => {
    fs.writeFileSync(path.join(tmpDir, INDEX_FILENAME), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.secret'), '', 'utf8');
    expect(await isFolderEmpty(tmpDir)).toBe(false);
  });

  it('is false when .INDEX.yaml is a directory rather than a file', async () => {
    fs.mkdirSync(path.join(tmpDir, INDEX_FILENAME));
    expect(await isFolderEmpty(tmpDir)).toBe(false);
  });

  it('counts an empty subfolder as content', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    expect(await isFolderEmpty(tmpDir)).toBe(false);
  });

  it('rejects for a missing folder', async () => {
    await expect(isFolderEmpty(path.join(tmpDir, 'nope'))).rejects.toThrow();
  });
});

describe('deleteEmptyFolder', () => {
  it('removes an empty folder', async () => {
    const target = path.join(tmpDir, 'empty');
    fs.mkdirSync(target);
    await deleteEmptyFolder(target);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('removes a folder holding only .INDEX.yaml', async () => {
    const target = path.join(tmpDir, 'doc');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, INDEX_FILENAME), 'files: []', 'utf8');
    await deleteEmptyFolder(target);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses a folder with .INDEX.yaml plus another file, leaving both intact', async () => {
    const target = path.join(tmpDir, 'doc');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, INDEX_FILENAME), 'files: []', 'utf8');
    fs.writeFileSync(path.join(target, 'note.md'), 'keep me', 'utf8');
    await expect(deleteEmptyFolder(target)).rejects.toThrow('Folder is not empty');
    expect(fs.readdirSync(target).sort()).toEqual([INDEX_FILENAME, 'note.md']);
  });

  it('refuses a folder holding only a hidden file, and leaves it intact', async () => {
    const target = path.join(tmpDir, 'hidden');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, '.secret'), 'keep me', 'utf8');
    await expect(deleteEmptyFolder(target)).rejects.toThrow('Folder is not empty');
    expect(fs.readFileSync(path.join(target, '.secret'), 'utf8')).toBe('keep me');
  });

  it('still fails at the OS level if the emptiness check is bypassed', async () => {
    // The second guard on its own: rmdir never removes a folder with content.
    const target = path.join(tmpDir, 'full');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'note.md'), 'keep me', 'utf8');
    await expect(fs.promises.rmdir(target)).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    expect(fs.existsSync(path.join(target, 'note.md'))).toBe(true);
  });
});
