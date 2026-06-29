/**
 * Unit tests for src/utils/fileSplitJoin/splitUtil.ts — transactional splitFile.
 *
 * Exercises the happy path, the delimiter/empty-part semantics, and the
 * fail-safe rollback behavior, all against an in-memory mock filesystem.
 */

import { describe, it, expect } from 'vitest';
import { splitFile } from '../src/renderer/splitUtil';

/**
 * Build an in-memory mock filesystem and the injectable file ops splitFile
 * expects. `opts` lets individual tests inject failures at specific steps.
 */
function makeFs(
  initial: Record<string, string>,
  opts: {
    createFailOn?: string;        // path whose createFile returns { success: false }
    writeFail?: boolean;          // writeFile returns { ok: false }
    renameFail?: boolean;         // renameFile returns false (every call)
    renameFailOnCall?: number;    // renameFile returns false only on the Nth call (1-based)
    deleteFailOn?: string;        // path whose deleteFile returns false
    readThrow?: boolean;          // readFile throws
    existsThrowOn?: string;       // path whose pathExists throws
    existsOverride?: (path: string) => boolean | undefined; // override pathExists
  } = {}
) {
  const fs = new Map<string, string>(Object.entries(initial));
  const calls = { read: 0, write: 0, create: 0, rename: 0, exists: 0, delete: 0 };

  const readFile = async (path: string) => {
    calls.read++;
    if (opts.readThrow) throw new Error(`read failed: ${path}`);
    const content = fs.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  };

  const writeFile = async (path: string, content: string) => {
    calls.write++;
    if (opts.writeFail) return { ok: false, content: '' };
    fs.set(path, content);
    return { ok: true, content };
  };

  const createFile = async (path: string, content: string) => {
    calls.create++;
    if (opts.createFailOn === path) return { success: false, error: `create failed: ${path}` };
    fs.set(path, content);
    return { success: true };
  };

  const renameFile = async (oldPath: string, newPath: string) => {
    calls.rename++;
    if (opts.renameFail) return false;
    if (opts.renameFailOnCall === calls.rename) return false;
    const content = fs.get(oldPath) ?? '';
    fs.set(newPath, content);
    fs.delete(oldPath);
    return true;
  };

  const pathExists = async (path: string) => {
    calls.exists++;
    if (opts.existsThrowOn === path) throw new Error(`exists failed: ${path}`);
    const override = opts.existsOverride?.(path);
    if (override !== undefined) return override;
    return fs.has(path);
  };

  const deleteFile = async (path: string) => {
    calls.delete++;
    if (opts.deleteFailOn === path) return false;
    fs.delete(path);
    return true;
  };

  return { fs, calls, readFile, writeFile, createFile, renameFile, pathExists, deleteFile };
}

function run(filePath: string, m: ReturnType<typeof makeFs>) {
  return splitFile(filePath, m);
}

describe('splitFile — happy path', () => {
  it('splits into -00/-01/-02 with correct content and removes the original', async () => {
    const m = makeFs({ '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(true);
    expect(result.fileCount).toBe(3);
    expect(result.filePaths).toEqual([
      '/docs/note-00.md',
      '/docs/note-01.md',
      '/docs/note-02.md',
    ]);
    expect(m.fs.get('/docs/note-00.md')).toBe('AAA');
    expect(m.fs.get('/docs/note-01.md')).toBe('BBB');
    expect(m.fs.get('/docs/note-02.md')).toBe('CCC');
    expect(m.fs.has('/docs/note.md')).toBe(false);
  });

  it('handles files with no extension', async () => {
    const m = makeFs({ '/docs/README': 'AAA\n\n\nBBB' });
    const result = await run('/docs/README', m);

    expect(result.success).toBe(true);
    expect(result.filePaths).toEqual(['/docs/README-00', '/docs/README-01']);
  });

  it('splits on the last dot for multi-dot filenames (archive.tar.gz)', async () => {
    const m = makeFs({ '/docs/archive.tar.gz': 'AAA\n\n\nBBB' });
    const result = await run('/docs/archive.tar.gz', m);

    expect(result.success).toBe(true);
    expect(result.filePaths).toEqual([
      '/docs/archive.tar-00.gz',
      '/docs/archive.tar-01.gz',
    ]);
    expect(m.fs.get('/docs/archive.tar-00.gz')).toBe('AAA');
    expect(m.fs.get('/docs/archive.tar-01.gz')).toBe('BBB');
  });

  it('zero-pads part numbers to two digits and keeps order for 10+ parts', async () => {
    const content = Array.from({ length: 11 }, (_, i) => `P${i}`).join('\n\n\n');
    const m = makeFs({ '/docs/note.md': content });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(true);
    expect(result.fileCount).toBe(11);
    // Two-digit padding: index 9 -> "-09", index 10 -> "-10" (not "-010").
    expect(result.filePaths?.[9]).toBe('/docs/note-09.md');
    expect(result.filePaths?.[10]).toBe('/docs/note-10.md');
    expect(m.fs.get('/docs/note-09.md')).toBe('P9');
    expect(m.fs.get('/docs/note-10.md')).toBe('P10');
  });
});

describe('splitFile — input/IO errors before mutation', () => {
  it('returns an error (no mutation) when reading the file throws', async () => {
    const m = makeFs({ '/docs/note.md': 'AAA\n\n\nBBB' }, { readThrow: true });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/read failed/i);
    expect(m.calls.create + m.calls.rename + m.calls.write + m.calls.delete).toBe(0);
  });

  it('returns an error (no mutation) when the collision check throws', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB' },
      { existsThrowOn: '/docs/note-00.md' }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/existing files|exists failed/i);
    expect(m.calls.create + m.calls.rename + m.calls.write + m.calls.delete).toBe(0);
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB');
  });
});

describe('splitFile — delimiter and empty-part semantics', () => {
  it('collapses runs of 4+ newlines into a single split point with no stray newline', async () => {
    const m = makeFs({ '/docs/note.md': 'AAA\n\n\n\n\nBBB' });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(true);
    expect(m.fs.get('/docs/note-00.md')).toBe('AAA');
    expect(m.fs.get('/docs/note-01.md')).toBe('BBB');
  });

  it('drops empty leading/trailing parts instead of creating empty files', async () => {
    const m = makeFs({ '/docs/note.md': '\n\n\nAAA\n\n\nBBB\n\n\n' });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(true);
    expect(result.fileCount).toBe(2);
    expect(result.filePaths).toEqual(['/docs/note-00.md', '/docs/note-01.md']);
    expect(m.fs.get('/docs/note-00.md')).toBe('AAA');
    expect(m.fs.get('/docs/note-01.md')).toBe('BBB');
    expect(m.fs.has('/docs/note-02.md')).toBe(false);
  });

  it('returns an error and does not mutate when there are no real split points', async () => {
    const m = makeFs({ '/docs/note.md': 'just one part\n\n\n   \n\n\n' });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/split points/i);
    expect(m.calls.create + m.calls.rename + m.calls.write + m.calls.delete).toBe(0);
    expect(m.fs.get('/docs/note.md')).toBe('just one part\n\n\n   \n\n\n');
  });
});

describe('splitFile — collision detection', () => {
  it('fails early with zero side effects when a target path already exists', async () => {
    const m = makeFs({
      '/docs/note.md': 'AAA\n\n\nBBB',
      '/docs/note-01.md': 'pre-existing',
    });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
    // No mutating op should have run.
    expect(m.calls.create + m.calls.rename + m.calls.write + m.calls.delete).toBe(0);
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB');
    expect(m.fs.get('/docs/note-01.md')).toBe('pre-existing');
    expect(m.fs.has('/docs/note-00.md')).toBe(false);
  });
});

describe('splitFile — rollback on failure', () => {
  it('write-fails-after-rename: restores the original filename + content and deletes created parts', async () => {
    const m = makeFs({ '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' }, { writeFail: true });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rolled back/i);
    // Original restored exactly.
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB\n\n\nCCC');
    // All created/renamed targets cleaned up.
    expect(m.fs.has('/docs/note-00.md')).toBe(false);
    expect(m.fs.has('/docs/note-01.md')).toBe(false);
    expect(m.fs.has('/docs/note-02.md')).toBe(false);
  });

  it('create-fails-mid-loop: deletes already-created parts and leaves the original untouched', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' },
      { createFailOn: '/docs/note-02.md' }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rolled back/i);
    // Original never renamed.
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB\n\n\nCCC');
    expect(m.calls.rename).toBe(0);
    // The one part created before the failure was deleted.
    expect(m.fs.has('/docs/note-01.md')).toBe(false);
    expect(m.fs.has('/docs/note-00.md')).toBe(false);
  });

  it('rename-fails-at-main-step: deletes created parts and leaves the original in place', async () => {
    const m = makeFs({ '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' }, { renameFail: true });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rename.*-00|rolled back/i);
    // Original was never renamed away, so it remains untouched.
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB\n\n\nCCC');
    // The parts created before the rename were rolled back.
    expect(m.fs.has('/docs/note-01.md')).toBe(false);
    expect(m.fs.has('/docs/note-02.md')).toBe(false);
  });

  it('reports incomplete rollback when an undo step itself fails', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB' },
      { writeFail: true, renameFail: false, deleteFailOn: '/docs/note-01.md' }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rollback incomplete/i);
  });

  it('reports incomplete rollback when restoring the original filename fails', async () => {
    // Forward rename (call #1) succeeds so the original is renamed to -00; the
    // write then fails, and the rollback's restore rename (call #2) fails.
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB' },
      { writeFail: true, renameFailOnCall: 2 }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rollback incomplete/i);
    // Restore failed, so the renamed -00 file is still what holds the content.
    expect(m.fs.has('/docs/note.md')).toBe(false);
    expect(m.fs.has('/docs/note-00.md')).toBe(true);
  });
});
