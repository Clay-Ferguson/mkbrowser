import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readDirectory, isFolderEmpty, deleteEmptyFolder, renameEntry, findSymlinks } from '../src/main/fileUtil';
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

describe('readDirectory symlink flag', () => {
  it('flags linked files and folders, and describes them by their targets', async () => {
    fs.mkdirSync(path.join(tmpDir, 'real-dir'));
    fs.writeFileSync(path.join(tmpDir, 'real.md'), '# real', 'utf8');
    fs.symlinkSync(path.join(tmpDir, 'real-dir'), path.join(tmpDir, 'link-dir'));
    fs.symlinkSync(path.join(tmpDir, 'real.md'), path.join(tmpDir, 'link.md'));

    const byName = new Map((await readDirectory(tmpDir, false)).map((e) => [e.name, e]));

    expect(byName.get('link-dir')).toMatchObject({ isSymlink: true, isDirectory: true });
    expect(byName.get('link.md')).toMatchObject({ isSymlink: true, isDirectory: false, isMarkdown: true });
    expect(byName.get('real-dir')).not.toHaveProperty('isSymlink');
    expect(byName.get('real.md')).not.toHaveProperty('isSymlink');
  });
});

describe('findSymlinks', () => {
  it('returns only the paths that are links themselves, in input order', async () => {
    // real/linked -> real: the breadcrumb for "real/linked/inner" checks a real
    // folder, a link, and a real folder reached through that link.
    const real = path.join(tmpDir, 'real');
    fs.mkdirSync(path.join(real, 'inner'), { recursive: true });
    fs.symlinkSync(real, path.join(real, 'linked'));
    const linked = path.join(real, 'linked');
    fs.symlinkSync(path.join(tmpDir, 'missing'), path.join(tmpDir, 'dangling'));

    const found = await findSymlinks([
      tmpDir,
      real,
      linked,
      path.join(linked, 'inner'),
      path.join(tmpDir, 'dangling'),
      path.join(tmpDir, 'does-not-exist'),
    ]);

    // A dangling link is still a link; a missing path is simply not one.
    expect(found).toEqual([linked, path.join(tmpDir, 'dangling')]);
  });
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

  it('keeps a file that appears after the emptiness check (rmdir is never recursive)', async () => {
    // The second guard: a file created between the check and the delete makes
    // rmdir fail (ENOTEMPTY) instead of being removed along with the folder.
    const target = path.join(tmpDir, 'racy');
    fs.mkdirSync(target);
    const realRmdir = fs.promises.rmdir.bind(fs.promises);
    const spy = vi.spyOn(fs.promises, 'rmdir').mockImplementation(async (...args) => {
      fs.writeFileSync(path.join(target, 'note.md'), 'keep me', 'utf8');
      return realRmdir(...(args as Parameters<typeof realRmdir>));
    });
    try {
      await expect(deleteEmptyFolder(target)).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(path.join(target, 'note.md'), 'utf8')).toBe('keep me');
  });

  it('keeps a file that appears while a lone .INDEX.yaml is being removed', async () => {
    const target = path.join(tmpDir, 'racy-doc');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, INDEX_FILENAME), 'files: []', 'utf8');
    const realUnlink = fs.promises.unlink.bind(fs.promises);
    const spy = vi.spyOn(fs.promises, 'unlink').mockImplementation(async (...args) => {
      fs.writeFileSync(path.join(target, 'note.md'), 'keep me', 'utf8');
      return realUnlink(...(args as Parameters<typeof realUnlink>));
    });
    try {
      await expect(deleteEmptyFolder(target)).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(path.join(target, 'note.md'), 'utf8')).toBe('keep me');
  });

  it('refuses a folder holding only a subfolder, leaving the subfolder and its files', async () => {
    const target = path.join(tmpDir, 'outer');
    fs.mkdirSync(path.join(target, 'inner'), { recursive: true });
    fs.writeFileSync(path.join(target, 'inner', 'deep.md'), 'keep me', 'utf8');
    await expect(deleteEmptyFolder(target)).rejects.toThrow('Folder is not empty');
    expect(fs.readFileSync(path.join(target, 'inner', 'deep.md'), 'utf8')).toBe('keep me');
  });
});

describe('renameEntry', () => {
  const p = (name: string) => path.join(tmpDir, name);
  const write = (name: string, content: string) => fs.writeFileSync(p(name), content, 'utf8');
  const read = (name: string) => fs.readFileSync(p(name), 'utf8');
  const writeIndex = (names: string[]) =>
    fs.writeFileSync(p(INDEX_FILENAME), `files:\n${names.map((n) => `  - name: ${n}\n`).join('')}`, 'utf8');
  const indexNames = () =>
    [...fs.readFileSync(p(INDEX_FILENAME), 'utf8').matchAll(/name: (.+)/g)].map((m) => m[1]);

  it('renames a file', async () => {
    write('a.md', 'A');
    expect(await renameEntry(p('a.md'), p('b.md'))).toBe(true);
    expect(fs.existsSync(p('a.md'))).toBe(false);
    expect(read('b.md')).toBe('A');
  });

  it('refuses to replace an existing file, leaving both untouched', async () => {
    write('a.md', 'A');
    write('b.md', 'B');
    expect(await renameEntry(p('a.md'), p('b.md'))).toBe(false);
    expect(read('a.md')).toBe('A');
    expect(read('b.md')).toBe('B');
  });

  it('refuses to replace an existing folder', async () => {
    fs.mkdirSync(p('src'));
    write('src/x.md', 'X');
    fs.mkdirSync(p('dst'));
    expect(await renameEntry(p('src'), p('dst'))).toBe(false);
    expect(read('src/x.md')).toBe('X');
    expect(fs.readdirSync(p('dst'))).toEqual([]);
  });

  it('refuses to replace a dangling symlink at the destination', async () => {
    // stat() reports a dangling link as absent; only lstat() sees it is there.
    write('a.md', 'A');
    fs.symlinkSync(p('missing-target.md'), p('b.md'));
    expect(await renameEntry(p('a.md'), p('b.md'))).toBe(false);
    expect(read('a.md')).toBe('A');
    expect(fs.lstatSync(p('b.md')).isSymbolicLink()).toBe(true);
  });

  it('refuses to rename onto a hard link of the same file (both names would survive)', async () => {
    write('a.md', 'A');
    fs.linkSync(p('a.md'), p('b.md'));
    expect(await renameEntry(p('a.md'), p('b.md'))).toBe(false);
    expect(read('a.md')).toBe('A');
  });

  it('moves into another folder without clobbering a same-named file there', async () => {
    write('a.md', 'source');
    fs.mkdirSync(p('dest'));
    write('dest/a.md', 'already here');
    expect(await renameEntry(p('a.md'), p('dest/a.md'))).toBe(false);
    expect(read('a.md')).toBe('source');
    expect(read('dest/a.md')).toBe('already here');
  });

  it('rejects (and changes nothing) when the source does not exist', async () => {
    await expect(renameEntry(p('nope.md'), p('b.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fs.existsSync(p('b.md'))).toBe(false);
  });

  it('carries the .attach folder and both index entries along on a same-folder rename', async () => {
    write('a.md', 'A');
    fs.mkdirSync(p(`a.md${ATTACH_SUFFIX}`));
    write(`a.md${ATTACH_SUFFIX}/pic.png`, 'png');
    writeIndex(['a.md', `a.md${ATTACH_SUFFIX}`]);

    expect(await renameEntry(p('a.md'), p('b.md'))).toBe(true);

    expect(read('b.md')).toBe('A');
    expect(read(`b.md${ATTACH_SUFFIX}/pic.png`)).toBe('png');
    expect(fs.existsSync(p(`a.md${ATTACH_SUFFIX}`))).toBe(false);
    expect(indexNames()).toEqual(['b.md', `b.md${ATTACH_SUFFIX}`]);
  });

  it('leaves the .attach folder in place when its new name is already taken', async () => {
    write('a.md', 'A');
    fs.mkdirSync(p(`a.md${ATTACH_SUFFIX}`));
    write(`a.md${ATTACH_SUFFIX}/mine.png`, 'mine');
    // An orphaned attach folder already sits at the new name — even an empty one
    // (which a bare rename would silently replace) must not be touched.
    fs.mkdirSync(p(`b.md${ATTACH_SUFFIX}`));
    write(`b.md${ATTACH_SUFFIX}/theirs.png`, 'theirs');

    expect(await renameEntry(p('a.md'), p('b.md'))).toBe(true);

    expect(read('b.md')).toBe('A');
    expect(read(`a.md${ATTACH_SUFFIX}/mine.png`)).toBe('mine');
    expect(read(`b.md${ATTACH_SUFFIX}/theirs.png`)).toBe('theirs');
  });

  it('does not rename the .attach folder when the entry moves to another folder', async () => {
    write('a.md', 'A');
    fs.mkdirSync(p(`a.md${ATTACH_SUFFIX}`));
    write(`a.md${ATTACH_SUFFIX}/pic.png`, 'png');
    fs.mkdirSync(p('dest'));

    expect(await renameEntry(p('a.md'), p('dest/a.md'))).toBe(true);

    expect(read('dest/a.md')).toBe('A');
    expect(read(`a.md${ATTACH_SUFFIX}/pic.png`)).toBe('png');
  });
});
