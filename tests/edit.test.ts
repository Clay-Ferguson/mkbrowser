/**
 * Unit tests for src/utils/edit.ts — paste, delete, split/join validation logic.
 * All async dependencies are injected via callbacks so no filesystem is needed.
 */
import { describe, it, expect } from 'vitest';
import {
  findCutItemsFromDifferentFolders,
  findPasteDuplicates,
  pasteCutItems,
  deleteSelectedItems,
  performSplitFile,
  performJoinFiles,
} from '../src/utils/edit';
import { joinFiles } from '../src/utils/fileSplitJoin/joinUtil';
import type { ItemData } from '../src/types/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(path: string, name: string, isDirectory = false): ItemData {
  return { path, name, isDirectory } as ItemData;
}

// ---------------------------------------------------------------------------
// findCutItemsFromDifferentFolders
// ---------------------------------------------------------------------------

describe('findCutItemsFromDifferentFolders', () => {
  it('returns empty array when cutItems is empty', () => {
    expect(findCutItemsFromDifferentFolders([])).toEqual([]);
  });

  it('returns empty array when all items share the same folder', () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
      makeItem('/docs/c.md', 'c.md'),
    ];
    expect(findCutItemsFromDifferentFolders(items)).toEqual([]);
  });

  it('returns names of items from a different folder than the first item', () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
      makeItem('/other/c.md', 'c.md'),
    ];
    expect(findCutItemsFromDifferentFolders(items)).toEqual(['c.md']);
  });

  it('handles a single item (no cross-folder items possible)', () => {
    const items = [makeItem('/docs/a.md', 'a.md')];
    expect(findCutItemsFromDifferentFolders(items)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findPasteDuplicates
// ---------------------------------------------------------------------------

describe('findPasteDuplicates', () => {
  it('returns empty array when no destination files exist', async () => {
    const items = [makeItem('/src/a.md', 'a.md'), makeItem('/src/b.md', 'b.md')];
    const pathExists = async (_p: string) => false;
    const result = await findPasteDuplicates(items, '/dest', pathExists);
    expect(result.error).toBeUndefined();
    expect(result.duplicates).toEqual([]);
  });

  it('returns names of items that already exist in the destination', async () => {
    const items = [makeItem('/src/a.md', 'a.md'), makeItem('/src/b.md', 'b.md')];
    // Only /dest/a.md exists
    const pathExists = async (p: string) => p === '/dest/a.md';
    const result = await findPasteDuplicates(items, '/dest', pathExists);
    expect(result.duplicates).toEqual(['a.md']);
  });

  it('returns all names when every destination path exists', async () => {
    const items = [makeItem('/src/x.md', 'x.md'), makeItem('/src/y.md', 'y.md')];
    const pathExists = async (_p: string) => true;
    const result = await findPasteDuplicates(items, '/dest', pathExists);
    expect(result.duplicates).toEqual(['x.md', 'y.md']);
  });

  it('reports a hard error (and no duplicates) when pathExists rejects', async () => {
    const items = [makeItem('/src/a.md', 'a.md'), makeItem('/src/b.md', 'b.md')];
    // A rejecting existence check must NOT be swallowed as "does not exist",
    // since that would risk a later rename overwriting a real file.
    const pathExists = async (_p: string) => {
      throw new Error('EPERM');
    };
    const result = await findPasteDuplicates(items, '/dest', pathExists);
    expect(result.duplicates).toEqual([]);
    expect(result.error).toMatch(/check destination/i);
    expect(result.error).toMatch(/EPERM/);
  });
});

// ---------------------------------------------------------------------------
// pasteCutItems
// ---------------------------------------------------------------------------

describe('pasteCutItems', () => {
  it('returns success immediately when cutItems is empty', async () => {
    const result = await pasteCutItems([], '/dest', async () => false, async () => true);
    expect(result.success).toBe(true);
  });

  it('returns error when pasting to the same folder the items came from', async () => {
    const items = [makeItem('/docs/a.md', 'a.md')];
    const result = await pasteCutItems(items, '/docs', async () => false, async () => true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already in this folder/i);
  });

  it('returns error when cut items come from different folders', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/other/b.md', 'b.md'),
    ];
    const result = await pasteCutItems(items, '/dest', async () => false, async () => true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/same folder/i);
  });

  it('returns error when destination already has a file with the same name', async () => {
    const items = [makeItem('/docs/a.md', 'a.md')];
    const pathExists = async (_p: string) => true; // simulates existing file
    const result = await pasteCutItems(items, '/dest', pathExists, async () => true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exist/i);
  });

  it('moves items and returns success when all conditions pass', async () => {
    const items = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];
    const pathExists = async (_p: string) => false;
    const renameFile = async (_old: string, _new: string) => true;
    const result = await pasteCutItems(items, '/dest', pathExists, renameFile);
    expect(result.success).toBe(true);
    // movedPaths reports every item that was renamed, in order.
    expect(result.movedPaths).toEqual(['/docs/a.md', '/docs/b.md']);
  });

  it('returns the pasted item name when exactly one item is pasted', async () => {
    const items = [makeItem('/docs/a.md', 'a.md')];
    const result = await pasteCutItems(items, '/dest', async () => false, async () => true);
    expect(result.success).toBe(true);
    expect(result.pastedItemName).toBe('a.md');
  });

  it('returns pastedItemName undefined when multiple items are pasted', async () => {
    const items = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];
    const result = await pasteCutItems(items, '/dest', async () => false, async () => true);
    expect(result.success).toBe(true);
    expect(result.pastedItemName).toBeUndefined();
  });

  it('returns error when renameFile fails for an item', async () => {
    const items = [makeItem('/docs/a.md', 'a.md')];
    const renameFile = async (_old: string, _new: string) => false;
    const result = await pasteCutItems(items, '/dest', async () => false, renameFile);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed to move/i);
    // The single item never moved, so nothing is reported as moved.
    expect(result.movedPaths).toEqual([]);
  });

  it('reports already-moved items in movedPaths when a later move fails', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
      makeItem('/docs/c.md', 'c.md'),
    ];
    // First two renames succeed; the third (c.md) fails mid-loop.
    const renameFile = async (oldPath: string, _new: string) => oldPath !== '/docs/c.md';
    const result = await pasteCutItems(items, '/dest', async () => false, renameFile);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed to move c\.md/i);
    // a.md and b.md physically moved before the failure and must be reported so
    // the caller can keep the store/index in sync; c.md and beyond did not.
    expect(result.movedPaths).toEqual(['/docs/a.md', '/docs/b.md']);
  });

  it('stops at the first failure and does not move subsequent items', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
      makeItem('/docs/c.md', 'c.md'),
    ];
    const attempted: string[] = [];
    // The very first rename fails.
    const renameFile = async (oldPath: string, _new: string) => {
      attempted.push(oldPath);
      return false;
    };
    const result = await pasteCutItems(items, '/dest', async () => false, renameFile);
    expect(result.success).toBe(false);
    expect(result.movedPaths).toEqual([]);
    // Loop short-circuits after the first failed rename.
    expect(attempted).toEqual(['/docs/a.md']);
  });

  it('reports an empty movedPaths on success with no items', async () => {
    const result = await pasteCutItems([], '/dest', async () => false, async () => true);
    expect(result.success).toBe(true);
    expect(result.movedPaths).toEqual([]);
  });

  it('aborts with a structured error when pathExists rejects (no overwrite risk)', async () => {
    const items = [makeItem('/docs/a.md', 'a.md')];
    const pathExists = async (_p: string) => {
      throw new Error('EPERM');
    };
    let renameCalled = false;
    const renameFile = async (_old: string, _new: string) => {
      renameCalled = true;
      return true;
    };
    const result = await pasteCutItems(items, '/dest', pathExists, renameFile);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/check destination/i);
    expect(result.movedPaths).toEqual([]);
    // The duplicate check failed, so we must never have attempted a rename.
    expect(renameCalled).toBe(false);
  });

  it('returns a structured error when renameFile rejects, preserving already-moved paths', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
    ];
    // a.md moves; b.md's rename throws (e.g. EBUSY from the main process).
    const renameFile = async (oldPath: string, _new: string) => {
      if (oldPath === '/docs/b.md') throw new Error('EBUSY');
      return true;
    };
    const result = await pasteCutItems(items, '/dest', async () => false, renameFile);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed to move b\.md/i);
    expect(result.error).toMatch(/EBUSY/);
    // a.md physically moved before the rejection and must be reported.
    expect(result.movedPaths).toEqual(['/docs/a.md']);
  });
});

// ---------------------------------------------------------------------------
// deleteSelectedItems
// ---------------------------------------------------------------------------

describe('deleteSelectedItems', () => {
  it('returns success with empty deletedPaths when selectedItems is empty', async () => {
    const result = await deleteSelectedItems([], async () => true);
    expect(result.success).toBe(true);
    expect(result.deletedPaths).toEqual([]);
  });

  it('deletes all items and returns their paths', async () => {
    const items = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];
    const deleteFile = async (_p: string) => true;
    const result = await deleteSelectedItems(items, deleteFile);
    expect(result.success).toBe(true);
    expect(result.deletedPaths).toEqual(['/docs/a.md', '/docs/b.md']);
  });

  it('returns failure and failedItems when deleteFile returns false', async () => {
    const items = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];
    // fail on the second item
    let calls = 0;
    const deleteFile = async (_p: string) => {
      calls++;
      return calls < 2; // first call succeeds, second fails
    };
    const result = await deleteSelectedItems(items, deleteFile);
    expect(result.success).toBe(false);
    expect(result.failedItems).toEqual(['b.md']);
    // First item was still deleted
    expect(result.deletedPaths).toEqual(['/docs/a.md']);
  });

  it('attempts every item when a middle item fails (best-effort)', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
      makeItem('/docs/c.md', 'c.md'),
    ];
    // fail only on the middle item
    const deleteFile = async (p: string) => p !== '/docs/b.md';
    const result = await deleteSelectedItems(items, deleteFile);
    expect(result.success).toBe(false);
    expect(result.failedItems).toEqual(['b.md']);
    // a.md and c.md were both deleted even though b.md failed
    expect(result.deletedPaths).toEqual(['/docs/a.md', '/docs/c.md']);
  });

  it('reports all failures and treats a thrown deleteFile as a failure', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
      makeItem('/docs/c.md', 'c.md'),
    ];
    const deleteFile = async (p: string) => {
      if (p === '/docs/a.md') throw new Error('locked');
      if (p === '/docs/c.md') return false;
      return true;
    };
    const result = await deleteSelectedItems(items, deleteFile);
    expect(result.success).toBe(false);
    expect(result.failedItems).toEqual(['a.md', 'c.md']);
    expect(result.deletedPaths).toEqual(['/docs/b.md']);
  });
});

// ---------------------------------------------------------------------------
// performSplitFile — validation layer (no actual split logic exercised)
// ---------------------------------------------------------------------------

describe('performSplitFile (validation)', () => {
  const noopOps = {
    readFile: async (_p: string) => '',
    writeFile: async (_p: string, _c: string) => ({ ok: true, content: '' }),
    createFile: async (_p: string, _c: string) => ({ success: true }),
    renameFile: async (_o: string, _n: string) => true,
    pathExists: async (_p: string) => false,
    deleteFile: async (_p: string) => true,
  };

  it('returns error when no items are selected', async () => {
    const result = await performSplitFile([], noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/select a file/i);
  });

  it('returns error when more than one item is selected', async () => {
    const items = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];
    const result = await performSplitFile(items, noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/one file/i);
  });

  it('returns error when selected item is a directory', async () => {
    const items = [makeItem('/docs/folder', 'folder', true)];
    const result = await performSplitFile(items, noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/folder/i);
  });

  it('returns error when selected file is not .md or .txt', async () => {
    const items = [makeItem('/docs/image.png', 'image.png')];
    const result = await performSplitFile(items, noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/text|markdown/i);
  });
});

// ---------------------------------------------------------------------------
// performJoinFiles — validation layer
// ---------------------------------------------------------------------------

describe('performJoinFiles (validation)', () => {
  const noopOps = {
    readFile: async (_p: string) => '',
    writeFile: async (_p: string, _c: string) => ({ ok: true, content: '' }),
    deleteFile: async (_p: string) => true,
  };

  it('returns error when fewer than two items are selected', async () => {
    const result = await performJoinFiles([makeItem('/docs/a.md', 'a.md')], noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least two/i);
  });

  it('returns error when one of the selected items is a directory', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/folder', 'folder', true),
    ];
    const result = await performJoinFiles(items, noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/folder/i);
  });

  it('returns error when a selected file is not .md or .txt', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.csv', 'b.csv'),
    ];
    const result = await performJoinFiles(items, noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not supported/i);
  });
});

// ---------------------------------------------------------------------------
// joinFiles — write verification + destructive delete gating
// ---------------------------------------------------------------------------

describe('joinFiles (write verification)', () => {
  // A simple in-memory filesystem keyed by path. writeFile records the bytes
  // it "wrote" and returns them as `content`, mirroring the real IPC contract.
  function makeFs(initial: Record<string, string>) {
    const store: Record<string, string> = { ...initial };
    const deleted: string[] = [];
    return {
      store,
      deleted,
      readFile: async (p: string) => store[p] ?? '',
      writeFile: async (p: string, c: string) => {
        store[p] = c;
        return { ok: true, content: c };
      },
      deleteFile: async (p: string) => {
        delete store[p];
        deleted.push(p);
        return true;
      },
    };
  }

  it('joins files and deletes the non-lead sources after verification', async () => {
    const fs = makeFs({ '/docs/a.txt': 'alpha', '/docs/b.txt': 'beta' });
    const result = await joinFiles(['/docs/b.txt', '/docs/a.txt'], fs);
    expect(result.success).toBe(true);
    expect(result.resultPath).toBe('/docs/a.txt');
    expect(result.filesJoined).toBe(2);
    expect(fs.store['/docs/a.txt']).toBe('alpha\n\n\nbeta');
    expect(fs.deleted).toEqual(['/docs/b.txt']);
    expect(fs.store['/docs/b.txt']).toBeUndefined();
  });

  it('succeeds when the writer normalizes content, as long as the read-back matches what was written', async () => {
    // Simulates markdown transformation (e.g. front-matter id injection): the
    // bytes on disk differ from joinedContent, but match writeSuccess.content.
    const fs = makeFs({ '/docs/a.md': 'alpha', '/docs/b.md': 'beta' });
    const writeFile = async (p: string, c: string) => {
      const transformed = c + '\n<!-- injected -->';
      fs.store[p] = transformed;
      return { ok: true, content: transformed };
    };
    const result = await joinFiles(['/docs/a.md', '/docs/b.md'], { ...fs, writeFile });
    expect(result.success).toBe(true);
    expect(fs.deleted).toEqual(['/docs/b.md']);
  });

  it('does not delete sources when the write reports ok: false', async () => {
    const fs = makeFs({ '/docs/a.txt': 'alpha', '/docs/b.txt': 'beta' });
    const writeFile = async (_p: string, c: string) => ({ ok: false, content: c });
    const result = await joinFiles(['/docs/a.txt', '/docs/b.txt'], { ...fs, writeFile });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed to write/i);
    expect(fs.deleted).toEqual([]);
    expect(fs.store['/docs/b.txt']).toBe('beta');
  });

  it('does not delete sources when the read-back does not match the written content', async () => {
    const fs = makeFs({ '/docs/a.txt': 'alpha', '/docs/b.txt': 'beta' });
    // Writer claims to have written one thing, but the file on disk says another
    // (e.g. partial/corrupt write) — verification must fail and preserve files.
    const writeFile = async (p: string, c: string) => {
      fs.store[p] = c + ' CORRUPTED';
      return { ok: true, content: c };
    };
    const result = await joinFiles(['/docs/a.txt', '/docs/b.txt'], { ...fs, writeFile });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/verification failed/i);
    expect(result.error).toMatch(/NOT deleted/i);
    expect(fs.deleted).toEqual([]);
    expect(fs.store['/docs/b.txt']).toBe('beta');
  });
});
