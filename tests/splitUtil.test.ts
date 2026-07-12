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
    deleteFailOn?: string[];      // paths whose deleteFile returns false
    readThrow?: boolean;          // readFile throws
    existsThrowOn?: string;       // path whose pathExists throws
    existsOverride?: (path: string) => boolean | undefined; // override pathExists
  } = {}
) {
  const fs = new Map<string, string>(Object.entries(initial));
  const calls = { read: 0, create: 0, exists: 0, delete: 0 };

  const readFile = async (path: string) => {
    calls.read++;
    if (opts.readThrow) throw new Error(`read failed: ${path}`);
    const content = fs.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  };

  const createFile = async (path: string, content: string) => {
    calls.create++;
    if (opts.createFailOn === path) return { success: false, error: `create failed: ${path}` };
    fs.set(path, content);
    return { success: true };
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
    if (opts.deleteFailOn?.includes(path)) return false;
    fs.delete(path);
    return true;
  };

  return { fs, calls, readFile, createFile, pathExists, deleteFile };
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
    expect(m.calls.create + m.calls.delete).toBe(0);
  });

  it('returns an error (no mutation) when the collision check throws', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB' },
      { existsThrowOn: '/docs/note-00.md' }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/existing files|exists failed/i);
    expect(m.calls.create + m.calls.delete).toBe(0);
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
    expect(m.calls.create + m.calls.delete).toBe(0);
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
    expect(m.calls.create + m.calls.delete).toBe(0);
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB');
    expect(m.fs.get('/docs/note-01.md')).toBe('pre-existing');
    expect(m.fs.has('/docs/note-00.md')).toBe(false);
  });
});

describe('splitFile — rollback on failure', () => {
  it('creates every part as a new file and only deletes the original once they all exist', async () => {
    const m = makeFs({ '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' });
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(true);
    // One create per part (including -00), and exactly one delete: the original.
    expect(m.calls.create).toBe(3);
    expect(m.calls.delete).toBe(1);
  });

  it('create-fails-on-the-first-part: leaves the original fully intact', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' },
      { createFailOn: '/docs/note-00.md' }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rolled back/i);
    // The original is never written through, so its bytes are still all there.
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB\n\n\nCCC');
    expect(m.fs.has('/docs/note-00.md')).toBe(false);
  });

  it('create-fails-mid-loop: deletes already-created parts and leaves the original untouched', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' },
      { createFailOn: '/docs/note-02.md' }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rolled back/i);
    // Original still holds every byte of the source content.
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB\n\n\nCCC');
    // The parts created before the failure were deleted.
    expect(m.fs.has('/docs/note-00.md')).toBe(false);
    expect(m.fs.has('/docs/note-01.md')).toBe(false);
  });

  it('delete-of-original-fails: rolls the parts back, leaving the original as the only copy', async () => {
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB\n\n\nCCC' },
      { deleteFailOn: ['/docs/note.md'] }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rolled back/i);
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB\n\n\nCCC');
    expect(m.fs.has('/docs/note-00.md')).toBe(false);
    expect(m.fs.has('/docs/note-01.md')).toBe(false);
    expect(m.fs.has('/docs/note-02.md')).toBe(false);
  });

  it('reports incomplete rollback when an undo step itself fails', async () => {
    // The final delete of the original fails, and the rollback then fails to
    // remove one of the created parts.
    const m = makeFs(
      { '/docs/note.md': 'AAA\n\n\nBBB' },
      { deleteFailOn: ['/docs/note.md', '/docs/note-01.md'] }
    );
    const result = await run('/docs/note.md', m);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rollback incomplete/i);
    // Even so, the original — the only copy of the full content — survives.
    expect(m.fs.get('/docs/note.md')).toBe('AAA\n\n\nBBB');
    expect(m.fs.has('/docs/note-01.md')).toBe(true);
  });
});
