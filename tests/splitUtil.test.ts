/**
 * Unit tests for src/utils/editor/splitUtil.ts — transactional splitFile.
 *
 * Exercises the happy path, the delimiter/empty-part semantics, and the
 * fail-safe rollback behavior, all against an in-memory mock filesystem.
 */

import { describe, it, expect } from 'vitest';
import { splitFile } from '../src/utils/editor/splitUtil';

/**
 * Build an in-memory mock filesystem and the injectable file ops splitFile
 * expects. `opts` lets individual tests inject failures at specific steps.
 */
function makeFs(
  initial: Record<string, string>,
  opts: {
    createFailOn?: string;        // path whose createFile returns { success: false }
    writeFail?: boolean;          // writeFile returns { ok: false }
    renameFail?: boolean;         // renameFile returns false
    deleteFailOn?: string;        // path whose deleteFile returns false
    existsOverride?: (path: string) => boolean | undefined; // override pathExists
  } = {}
) {
  const fs = new Map<string, string>(Object.entries(initial));
  const calls = { read: 0, write: 0, create: 0, rename: 0, exists: 0, delete: 0 };

  const readFile = async (path: string) => {
    calls.read++;
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
    const content = fs.get(oldPath) ?? '';
    fs.set(newPath, content);
    fs.delete(oldPath);
    return true;
  };

  const pathExists = async (path: string) => {
    calls.exists++;
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

  it('reports incomplete rollback when an undo step itself fails', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB' },
      { writeFail: true, renameFail: false, deleteFailOn: '/docs/note-01.md' }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rollback incomplete/i);
  });
});
