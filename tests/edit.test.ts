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

  it('rejects moving a folder into itself', async () => {
    const items = [makeItem('/notes/projects', 'projects', true)];
    let renameCalled = false;
    const renameFile = async (_old: string, _new: string) => {
      renameCalled = true;
      return true;
    };
    const result = await pasteCutItems(items, '/notes/projects', async () => false, renameFile);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/itself or one of its subfolders/i);
    expect(result.movedPaths).toEqual([]);
    // The guard must fire before any rename is attempted.
    expect(renameCalled).toBe(false);
  });

  it('rejects moving a folder into a direct child', async () => {
    const items = [makeItem('/notes/projects', 'projects', true)];
    const result = await pasteCutItems(items, '/notes/projects/sub', async () => false, async () => true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/itself or one of its subfolders/i);
    expect(result.movedPaths).toEqual([]);
  });

  it('rejects moving a folder into a deep descendant', async () => {
    const items = [makeItem('/notes/projects', 'projects', true)];
    const result = await pasteCutItems(items, '/notes/projects/a/b/c', async () => false, async () => true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/itself or one of its subfolders/i);
    expect(result.movedPaths).toEqual([]);
  });

  it('allows moving a folder into a sibling whose path shares a prefix (no startsWith false positive)', async () => {
    // '/notes/projects-archive' starts with '/notes/projects' textually but is a
    // sibling, not a descendant, so the move must be allowed.
    const items = [makeItem('/notes/projects', 'projects', true)];
    const result = await pasteCutItems(items, '/notes/projects-archive', async () => false, async () => true);
    expect(result.success).toBe(true);
    expect(result.movedPaths).toEqual(['/notes/projects']);
  });

  it('does not apply the descendant guard to non-directory items', async () => {
    // A file named the same way must not be blocked by the folder guard.
    const items = [makeItem('/notes/projects.md', 'projects.md', false)];
    const result = await pasteCutItems(items, '/notes/projects.md/whatever', async () => false, async () => true);
    expect(result.success).toBe(true);
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

  it('reports the cross-folder reason (not same-folder) when item[0] is in the destination but a later item is not', async () => {
    // Regression: the cross-folder invariant must be established before the
    // same-folder check leans on cutItems[0]. Here the first item already lives
    // in the destination, so the old ordering would have wrongly reported
    // "already in this folder" instead of the truthful cross-folder reason.
    const items = [
      makeItem('/dest/a.md', 'a.md'),
      makeItem('/other/b.md', 'b.md'),
    ];
    const result = await pasteCutItems(items, '/dest', async () => false, async () => true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/same folder/i);
    expect(result.error).not.toMatch(/already in this folder/i);
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

  it('is best-effort: attempts every item even when the first one fails', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.md', 'b.md'),
      makeItem('/docs/c.md', 'c.md'),
    ];
    const attempted: string[] = [];
    // The first item fails; b.md and c.md still succeed (no short-circuit).
    const renameFile = async (oldPath: string, _new: string) => {
      attempted.push(oldPath);
      return oldPath !== '/docs/a.md';
    };
    const result = await pasteCutItems(items, '/dest', async () => false, renameFile);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed to move a\.md/i);
    // Every item is attempted; ordering is not guaranteed under concurrency.
    expect(new Set(attempted)).toEqual(new Set(['/docs/a.md', '/docs/b.md', '/docs/c.md']));
    // The two that succeeded are reported as moved, in selection order.
    expect(result.movedPaths).toEqual(['/docs/b.md', '/docs/c.md']);
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

  it('handles a large batch with bounded concurrency, aggregating failures', async () => {
    const total = 200;
    const items = Array.from({ length: total }, (_, i) => makeItem(`/docs/f${i}.md`, `f${i}.md`));
    // Every 7th item fails; one of those throws to exercise the catch path.
    const shouldFail = (i: number) => i % 7 === 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const renameFile = async (oldPath: string, _new: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      const i = Number(oldPath.match(/f(\d+)\.md$/)![1]);
      if (i === 7) throw new Error('EBUSY');
      return !shouldFail(i);
    };
    const result = await pasteCutItems(items, '/dest', async () => false, renameFile);

    const expectedMoved = items.filter((_, i) => !shouldFail(i)).map((it) => it.path);
    const failedCount = items.filter((_, i) => shouldFail(i)).length;
    expect(result.success).toBe(false);
    expect(result.movedPaths).toEqual(expectedMoved); // successes, in selection order
    expect(result.error).toMatch(new RegExp(`failed to move ${failedCount} items`, 'i'));
    // Concurrency stayed bounded and never collapsed to fully serial.
    expect(maxInFlight).toBeLessThanOrEqual(16);
    expect(maxInFlight).toBeGreaterThan(1);
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
    // fail on b.md (path-based, not call-order-based, since deletes run concurrently)
    const deleteFile = async (p: string) => p !== '/docs/b.md';
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

  it('handles a large batch with bounded concurrency, aggregating failures', async () => {
    const total = 200;
    const items = Array.from({ length: total }, (_, i) => makeItem(`/docs/f${i}.md`, `f${i}.md`));
    // Every 5th item fails; one of those throws to exercise the catch path.
    const shouldFail = (i: number) => i % 5 === 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const deleteFile = async (p: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      const i = Number(p.match(/f(\d+)\.md$/)![1]);
      if (i === 5) throw new Error('locked');
      return !shouldFail(i);
    };
    const result = await deleteSelectedItems(items, deleteFile);

    const expectedDeleted = items.filter((_, i) => !shouldFail(i)).map((it) => it.path);
    const expectedFailed = items.filter((_, i) => shouldFail(i)).map((it) => it.name);
    expect(result.success).toBe(false);
    expect(result.deletedPaths).toEqual(expectedDeleted); // in selection order
    expect(result.failedItems).toEqual(expectedFailed);
    // Concurrency stayed bounded and never collapsed to fully serial.
    expect(maxInFlight).toBeLessThanOrEqual(16);
    expect(maxInFlight).toBeGreaterThan(1);
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

  it('returns error when selected file is not a text/markdown type', async () => {
    const items = [makeItem('/docs/image.png', 'image.png')];
    const result = await performSplitFile(items, noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/text|markdown/i);
  });

  // Ops that read back content containing a split point, so a file that passes
  // the type validation actually reaches and completes the split operation.
  const splittableOps = {
    ...noopOps,
    readFile: async (_p: string) => 'alpha\n\n\nbeta',
  };

  it('accepts an uppercase-extension markdown file (case-insensitive)', async () => {
    const items = [makeItem('/docs/notes.MD', 'notes.MD')];
    const result = await performSplitFile(items, splittableOps);
    // Passes validation and reaches the split op, which succeeds.
    expect(result.success).toBe(true);
  });

  it('accepts a code file the app treats as text (e.g. .ts), staying consistent with the rest of the app', async () => {
    const items = [makeItem('/docs/script.ts', 'script.ts')];
    const result = await performSplitFile(items, splittableOps);
    expect(result.success).toBe(true);
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

  it('returns error when a selected file is not a text/markdown type', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.csv', 'b.csv'),
    ];
    const result = await performJoinFiles(items, noopOps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not supported/i);
  });

  it('accepts mixed-case and code-file extensions the app treats as text', async () => {
    // .MD (uppercase markdown), .txt, and .ts (a code type fileTypes.ts counts
    // as text) must all pass validation and reach the join op, which succeeds.
    const items = [
      makeItem('/docs/a.MD', 'a.MD'),
      makeItem('/docs/b.txt', 'b.txt'),
      makeItem('/docs/c.ts', 'c.ts'),
    ];
    const result = await performJoinFiles(items, noopOps);
    expect(result.success).toBe(true);
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
