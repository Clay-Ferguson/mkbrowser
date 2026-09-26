/**
 * Orchestration-layer tests for splitSelectedFile / joinSelectedFiles /
 * createAttachmentFileOp in fileOpsUtil.ts.
 *
 * The underlying algorithms (splitUtil.ts, joinUtil.ts) and the index
 * primitives (indexUtil.ts) are tested elsewhere; what lives here is the glue
 * that keeps .INDEX.yaml in sync with the disk after a split or join in a
 * Document Mode folder — the layer where the "join leaves a stale index" bug
 * lived: every building block worked, but nothing verified the ops actually
 * invoked the index-sync steps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ItemData } from '../src/shared/types';
import { TIMESTAMP_FILENAME_RE } from '../src/shared/timeUtil';

vi.mock('../src/store', () => ({
  deleteItems: vi.fn(),
  clearAllSelections: vi.fn(),
  clearAllCutItems: vi.fn(),
  setHighlightItem: vi.fn(),
  setPendingScrollToFile: vi.fn(),
  setPendingEditFile: vi.fn(),
  setPendingExpandFile: vi.fn(),
  setAppError: vi.fn(),
  getCurrentPath: vi.fn(() => '/docs'),
  getHasIndexFile: vi.fn(() => false),
}));

vi.mock('../src/renderer/directoryLoader', () => ({
  refreshDirectory: vi.fn(),
}));

vi.mock('../src/renderer/api', () => ({
  // pathUtil calls getApi() for the platform path separator; undefined makes it
  // fall back to '/', matching the POSIX-style paths used in these tests.
  getApi: () => undefined,
  api: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renameFile: vi.fn(),
    pathExists: vi.fn(),
    deleteFile: vi.fn(),
    readIndexYaml: vi.fn(),
    insertIntoIndexYaml: vi.fn(),
    reconcileIndexedFiles: vi.fn(),
  },
}));

import { splitSelectedFile, joinSelectedFiles, createAttachmentFileOp } from '../src/renderer/fileOpsUtil';
import { clearAllSelections, setPendingEditFile, setPendingScrollToFile, getCurrentPath, getHasIndexFile, setAppError } from '../src/store';
import { refreshDirectory } from '../src/renderer/directoryLoader';
import { api } from '../src/renderer/api';

function makeItem(path: string, name: string, isDirectory = false): ItemData {
  return { path, name, isDirectory } as ItemData;
}

/**
 * Backs the file-op api mocks with an in-memory filesystem so the real
 * splitFile/joinFiles logic runs end-to-end underneath the orchestration.
 * writeFile echoes back the bytes it stored, mirroring the IPC contract.
 */
function seedFs(initial: Record<string, string>) {
  const store: Record<string, string> = { ...initial };
  const deleted: string[] = [];
  vi.mocked(api.readFile).mockImplementation(async (p) => ({ ok: true as const, content: store[p] ?? '' }));
  vi.mocked(api.writeFile).mockImplementation(async (p, c) => {
    store[p] = c;
    return { ok: true, content: c, mtime: 1, size: c.length };
  });
  vi.mocked(api.createFile).mockImplementation(async (p, c) => {
    store[p] = c;
    return { success: true };
  });
  vi.mocked(api.renameFile).mockImplementation(async (oldPath, newPath) => {
    store[newPath] = store[oldPath]!;
    delete store[oldPath];
    return true;
  });
  vi.mocked(api.pathExists).mockImplementation(async (p) => p in store);
  vi.mocked(api.deleteFile).mockImplementation(async (p) => {
    delete store[p];
    deleted.push(p);
    return true;
  });
  return { store, deleted };
}

/** Benign defaults for the index APIs; individual tests override as needed. */
function seedIndexApiDefaults() {
  vi.mocked(api.readIndexYaml).mockResolvedValue(null);
  vi.mocked(api.insertIntoIndexYaml).mockResolvedValue({ success: true });
  vi.mocked(api.reconcileIndexedFiles).mockResolvedValue({ success: true });
}

beforeEach(() => {
  vi.resetAllMocks();
  seedIndexApiDefaults();
  // resetAllMocks clears the factory implementations of the store getters too.
  vi.mocked(getCurrentPath).mockReturnValue('/docs');
  vi.mocked(getHasIndexFile).mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// splitSelectedFile — Document Mode index splicing
// ---------------------------------------------------------------------------

describe('splitSelectedFile (Document Mode index sync)', () => {
  // 'alpha|beta|gamma' splits into notes-00.md, notes-01.md, notes-02.md.
  const splitContent = 'alpha\n\n\nbeta\n\n\ngamma';
  const selected = [makeItem('/docs/notes.md', 'notes.md')];

  it("splices the new parts into the index directly after the original's entry, then reconciles", async () => {
    const { store } = seedFs({ '/docs/notes.md': splitContent });
    // splitFile deletes the original rather than renaming it, so the index still
    // lists the original name when the splice runs; the closing reconcile is what
    // re-points that entry to the new -00 file (via its front-matter id).
    vi.mocked(api.readIndexYaml).mockResolvedValue({
      files: [{ name: 'intro.md', id: 'A' }, { name: 'notes.md', id: 'B' }, { name: 'outro.md', id: 'C' }],
    });

    await splitSelectedFile('/docs', selected, true);

    // The split itself landed on "disk".
    expect(store['/docs/notes.md']).toBeUndefined();
    expect(store['/docs/notes-00.md']).toBe('alpha');
    expect(store['/docs/notes-01.md']).toBe('beta');
    expect(store['/docs/notes-02.md']).toBe('gamma');
    // Each part chains off the previous one so document order is preserved.
    expect(vi.mocked(api.insertIntoIndexYaml).mock.calls).toEqual([
      ['/docs', 'notes-01.md', 'notes.md'],
      ['/docs', 'notes-02.md', 'notes-01.md'],
    ]);
    // The reconcile that re-points the original's entry to -00 must run after
    // the inserts, or it would drop the original's entry (its file is gone)
    // before the inserts could anchor on it.
    expect(api.reconcileIndexedFiles).toHaveBeenCalledWith('/docs', false);
    expect(vi.mocked(api.reconcileIndexedFiles).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(api.insertIntoIndexYaml).mock.invocationCallOrder[1]!
    );
    expect(setAppError).not.toHaveBeenCalled();
    expect(clearAllSelections).toHaveBeenCalled();
    expect(refreshDirectory).toHaveBeenCalled();
  });

  it("anchors after the original entry's attach folder when one directly follows it", async () => {
    seedFs({ '/docs/notes.md': splitContent });
    vi.mocked(api.readIndexYaml).mockResolvedValue({
      files: [{ name: 'notes.md', id: 'B' }, { name: 'notes.md.attach' }, { name: 'outro.md' }],
    });

    await splitSelectedFile('/docs', selected, true);

    // An attach folder must stay glued to its file, so the first part goes after it.
    expect(vi.mocked(api.insertIntoIndexYaml).mock.calls).toEqual([
      ['/docs', 'notes-01.md', 'notes.md.attach'],
      ['/docs', 'notes-02.md', 'notes-01.md'],
    ]);
  });

  it('skips the splice and just reconciles when the original has no index entry', async () => {
    seedFs({ '/docs/notes.md': splitContent });
    // e.g. the file was created but never reconciled into the index.
    vi.mocked(api.readIndexYaml).mockResolvedValue({ files: [{ name: 'other.md' }] });

    await splitSelectedFile('/docs', selected, true);

    expect(api.reconcileIndexedFiles).toHaveBeenCalledWith('/docs', false);
    expect(api.insertIntoIndexYaml).not.toHaveBeenCalled();
    expect(setAppError).not.toHaveBeenCalled();
    expect(refreshDirectory).toHaveBeenCalled();
  });

  it('does not touch the index when the folder is not in Document Mode', async () => {
    const { store } = seedFs({ '/docs/notes.md': splitContent });

    await splitSelectedFile('/docs', selected, false);

    expect(store['/docs/notes-01.md']).toBe('beta');
    // Crucially insertIntoIndexYaml is never called: it creates .INDEX.yaml when
    // absent, which would silently flip the folder into Document Mode.
    expect(api.readIndexYaml).not.toHaveBeenCalled();
    expect(api.insertIntoIndexYaml).not.toHaveBeenCalled();
    expect(api.reconcileIndexedFiles).not.toHaveBeenCalled();
  });

  it('surfaces an index-splice failure without suppressing the refresh', async () => {
    seedFs({ '/docs/notes.md': splitContent });
    vi.mocked(api.readIndexYaml).mockResolvedValue({ files: [{ name: 'notes.md', id: 'B' }] });
    vi.mocked(api.insertIntoIndexYaml).mockResolvedValue({ success: false, error: 'disk full' });

    await splitSelectedFile('/docs', selected, true);

    expect(setAppError).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    // The split itself succeeded, so the view must still refresh (the next
    // reconcile heals the index).
    expect(refreshDirectory).toHaveBeenCalled();
    expect(clearAllSelections).toHaveBeenCalled();
  });

  it('reports a failed split and performs no index work or refresh', async () => {
    seedFs({ '/docs/a.md': 'x', '/docs/b.md': 'y' });

    // Two selected items is a validation failure inside performSplitFile.
    await splitSelectedFile(
      '/docs',
      [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')],
      true
    );

    expect(setAppError).toHaveBeenCalledWith(expect.stringMatching(/one file/i));
    expect(refreshDirectory).not.toHaveBeenCalled();
    expect(api.readIndexYaml).not.toHaveBeenCalled();
    expect(api.insertIntoIndexYaml).not.toHaveBeenCalled();
    expect(api.reconcileIndexedFiles).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// joinSelectedFiles — Document Mode index sync
// ---------------------------------------------------------------------------

describe('joinSelectedFiles (Document Mode index sync)', () => {
  const selected = [makeItem('/docs/a.md', 'a.md'), makeItem('/docs/b.md', 'b.md')];

  it('reconciles the index after the sources are deleted on a successful join', async () => {
    const { store, deleted } = seedFs({ '/docs/a.md': 'alpha', '/docs/b.md': 'beta' });

    await joinSelectedFiles('/docs', selected, true);

    // The join itself landed on "disk".
    expect(store['/docs/a.md']).toBe('alpha\n\n\nbeta');
    expect(deleted).toEqual(['/docs/b.md']);
    expect(api.reconcileIndexedFiles).toHaveBeenCalledWith('/docs', false);
    // The reconcile must run after the deletes, or it would read the pre-join
    // disk state and leave the stale entries in place.
    expect(vi.mocked(api.reconcileIndexedFiles).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(api.deleteFile).mock.invocationCallOrder[0]!
    );
    expect(setAppError).not.toHaveBeenCalled();
    expect(clearAllSelections).toHaveBeenCalled();
    expect(refreshDirectory).toHaveBeenCalled();
  });

  it('skips the reconcile when the folder is not in Document Mode', async () => {
    seedFs({ '/docs/a.md': 'alpha', '/docs/b.md': 'beta' });

    await joinSelectedFiles('/docs', selected, false);

    expect(api.reconcileIndexedFiles).not.toHaveBeenCalled();
    expect(refreshDirectory).toHaveBeenCalled();
  });

  it('surfaces a reconcile rejection without suppressing the refresh', async () => {
    seedFs({ '/docs/a.md': 'alpha', '/docs/b.md': 'beta' });
    vi.mocked(api.reconcileIndexedFiles).mockRejectedValue(new Error('ipc down'));

    await joinSelectedFiles('/docs', selected, true);

    expect(setAppError).toHaveBeenCalledWith(expect.stringContaining('Failed to update index after join'));
    // The join itself succeeded, so the view must still refresh.
    expect(refreshDirectory).toHaveBeenCalled();
    expect(clearAllSelections).toHaveBeenCalled();
  });

  it('reports a failed join and does not reconcile or refresh', async () => {
    const { store } = seedFs({ '/docs/a.md': 'alpha', '/docs/b.md': 'beta' });
    // The write reports failure, so joinFiles aborts before deleting anything.
    vi.mocked(api.writeFile).mockResolvedValue({ ok: false, content: '', mtime: 0 });

    await joinSelectedFiles('/docs', selected, true);

    expect(setAppError).toHaveBeenCalledWith(expect.stringMatching(/failed to write/i));
    expect(store['/docs/b.md']).toBe('beta'); // sources preserved
    expect(api.reconcileIndexedFiles).not.toHaveBeenCalled();
    expect(refreshDirectory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createAttachmentFileOp — new-attachment-from-scratch flow
// ---------------------------------------------------------------------------

describe('createAttachmentFileOp', () => {
  it('creates the attach folder and an empty timestamped .md inside it, then queues the edit', async () => {
    const { store } = seedFs({ '/docs/notes.md': 'body' });
    vi.mocked(api.createFolder).mockImplementation(async (p) => {
      store[p] = '';
      return { success: true };
    });
    vi.mocked(getHasIndexFile).mockReturnValue(true);

    await createAttachmentFileOp('/docs/notes.md');

    expect(api.createFolder).toHaveBeenCalledWith('/docs/notes.md.attach');
    // Document Mode: the folder is registered right after the file it belongs to.
    expect(api.insertIntoIndexYaml).toHaveBeenCalledWith('/docs', 'notes.md.attach', 'notes.md');

    const created = Object.keys(store).filter((p) => p.startsWith('/docs/notes.md.attach/'));
    expect(created).toHaveLength(1);
    expect(created[0]!.slice('/docs/notes.md.attach/'.length)).toMatch(TIMESTAMP_FILENAME_RE);
    expect(store[created[0]!]).toBe('');

    expect(api.reconcileIndexedFiles).toHaveBeenCalledWith('/docs/notes.md.attach', false);
    expect(setPendingScrollToFile).toHaveBeenCalledWith(created[0]);
    expect(setPendingEditFile).toHaveBeenCalledWith(created[0]);
    expect(refreshDirectory).toHaveBeenCalled();
    expect(setAppError).not.toHaveBeenCalled();
  });

  it('reuses an existing attach folder', async () => {
    seedFs({ '/docs/notes.md': 'body', '/docs/notes.md.attach': '' });

    await createAttachmentFileOp('/docs/notes.md');

    expect(api.createFolder).not.toHaveBeenCalled();
    expect(setPendingEditFile).toHaveBeenCalled();
    expect(refreshDirectory).toHaveBeenCalled();
  });

  it('reports a failed file creation and queues no edit', async () => {
    seedFs({ '/docs/notes.md': 'body', '/docs/notes.md.attach': '' });
    vi.mocked(api.createFile).mockResolvedValue({ success: false, error: 'disk full' });

    await createAttachmentFileOp('/docs/notes.md');

    expect(setAppError).toHaveBeenCalledWith('disk full');
    expect(setPendingEditFile).not.toHaveBeenCalled();
    expect(refreshDirectory).not.toHaveBeenCalled();
  });
});
