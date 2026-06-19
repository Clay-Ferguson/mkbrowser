/**
 * Unit tests for src/edit.ts — paste, delete, split/join validation logic.
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
} from '../src/edit';
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
    expect(result).toEqual([]);
  });

  it('returns names of items that already exist in the destination', async () => {
    const items = [makeItem('/src/a.md', 'a.md'), makeItem('/src/b.md', 'b.md')];
    // Only /dest/a.md exists
    const pathExists = async (p: string) => p === '/dest/a.md';
    const result = await findPasteDuplicates(items, '/dest', pathExists);
    expect(result).toEqual(['a.md']);
  });

  it('returns all names when every destination path exists', async () => {
    const items = [makeItem('/src/x.md', 'x.md'), makeItem('/src/y.md', 'y.md')];
    const pathExists = async (_p: string) => true;
    const result = await findPasteDuplicates(items, '/dest', pathExists);
    expect(result).toEqual(['x.md', 'y.md']);
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

  it('returns failure and failedItem when deleteFile returns false', async () => {
    const items = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];
    // fail on the second item
    let calls = 0;
    const deleteFile = async (_p: string) => {
      calls++;
      return calls < 2; // first call succeeds, second fails
    };
    const result = await deleteSelectedItems(items, deleteFile);
    expect(result.success).toBe(false);
    expect(result.failedItem).toBe('b.md');
    // First item was deleted before failure
    expect(result.deletedPaths).toEqual(['/docs/a.md']);
  });
});

// ---------------------------------------------------------------------------
// performSplitFile — validation layer (no actual split logic exercised)
// ---------------------------------------------------------------------------

describe('performSplitFile (validation)', () => {
  const noopRead = async (_p: string) => '';
  const noopWrite = async (_p: string, _c: string) => ({ ok: true, content: '' });
  const noopCreate = async (_p: string, _c: string) => ({ success: true });
  const noopRename = async (_o: string, _n: string) => true;
  const noopExists = async (_p: string) => false;
  const noopDelete = async (_p: string) => true;

  it('returns error when no items are selected', async () => {
    const result = await performSplitFile([], noopRead, noopWrite, noopCreate, noopRename, noopExists, noopDelete);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/select a file/i);
  });

  it('returns error when more than one item is selected', async () => {
    const items = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];
    const result = await performSplitFile(items, noopRead, noopWrite, noopCreate, noopRename, noopExists, noopDelete);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/one file/i);
  });

  it('returns error when selected item is a directory', async () => {
    const items = [makeItem('/docs/folder', 'folder', true)];
    const result = await performSplitFile(items, noopRead, noopWrite, noopCreate, noopRename, noopExists, noopDelete);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/folder/i);
  });

  it('returns error when selected file is not .md or .txt', async () => {
    const items = [makeItem('/docs/image.png', 'image.png')];
    const result = await performSplitFile(items, noopRead, noopWrite, noopCreate, noopRename, noopExists, noopDelete);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/text|markdown/i);
  });
});

// ---------------------------------------------------------------------------
// performJoinFiles — validation layer
// ---------------------------------------------------------------------------

describe('performJoinFiles (validation)', () => {
  const noopRead = async (_p: string) => '';
  const noopWrite = async (_p: string, _c: string) => ({ ok: true, content: '' });
  const noopDelete = async (_p: string) => true;
  const noopSize = async (_p: string) => 0;

  it('returns error when fewer than two items are selected', async () => {
    const result = await performJoinFiles(
      [makeItem('/docs/a.md', 'a.md')],
      noopRead, noopWrite, noopDelete, noopSize
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least two/i);
  });

  it('returns error when one of the selected items is a directory', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/folder', 'folder', true),
    ];
    const result = await performJoinFiles(items, noopRead, noopWrite, noopDelete, noopSize);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/folder/i);
  });

  it('returns error when a selected file is not .md or .txt', async () => {
    const items = [
      makeItem('/docs/a.md', 'a.md'),
      makeItem('/docs/b.csv', 'b.csv'),
    ];
    const result = await performJoinFiles(items, noopRead, noopWrite, noopDelete, noopSize);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not supported/i);
  });
});
