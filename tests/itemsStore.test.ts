import { describe, it, expect, beforeEach } from 'vitest';
import { useAS } from '../src/store/core';
import {
  clearCache,
  deleteItems,
  getCutItems,
  getItem,
  isCacheValid,
  renameItem,
  setItemContent,
  setItemSelected,
  syncDirectoryItems,
  upsertItems,
} from '../src/store/items';

const DIR = '/notes';
const NOTE = '/notes/note.md';

/** A listing entry as the directory loader supplies it. */
function entry(path: string, overrides: Partial<{ isDirectory: boolean; modifiedTime: number; createdTime: number; size: number }> = {}) {
  return {
    path,
    name: path.substring(path.lastIndexOf('/') + 1),
    isDirectory: false,
    modifiedTime: 1000,
    createdTime: 1000,
    ...overrides,
  };
}

/** Put a note in the store, cut it, and cache some content for it. */
function seedCutNote(createdTime = 1000): void {
  syncDirectoryItems(DIR, [entry(NOTE, { createdTime })]);
  setItemContent(NOTE, 'original body', 1000);
  setItemSelected(NOTE, true);
  useAS.getState().cutSelectedItems();
}

describe('items store — stale entry reconciliation', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('mergeItem: a different file at the same path', () => {
    it('drops isCut when createdTime shows the file was replaced', () => {
      seedCutNote(1000);
      expect(getCutItems().map(i => i.path)).toEqual([NOTE]);

      // Same path, different birth time: the original was deleted and something
      // else was created in its place (git checkout, sync client, terminal).
      syncDirectoryItems(DIR, [entry(NOTE, { modifiedTime: 5000, createdTime: 5000 })]);

      expect(getCutItems()).toEqual([]);
      expect(getItem(NOTE)?.isCut).toBe(false);
    });

    it('drops isSelected and cached content when the file was replaced', () => {
      syncDirectoryItems(DIR, [entry(NOTE)]);
      setItemContent(NOTE, 'original body', 1000);
      setItemSelected(NOTE, true);

      syncDirectoryItems(DIR, [entry(NOTE, { modifiedTime: 5000, createdTime: 5000 })]);

      const item = getItem(NOTE);
      expect(item?.isSelected).toBe(false);
      expect(item?.content).toBeUndefined();
      expect(item?.createdTime).toBe(5000);
    });

    it('treats a file/folder flip at the same path as a replacement', () => {
      seedCutNote();

      syncDirectoryItems(DIR, [entry(NOTE, { isDirectory: true })]);

      expect(getItem(NOTE)?.isCut).toBe(false);
      expect(getItem(NOTE)?.isDirectory).toBe(true);
    });

    it('keeps flags and cached content across an ordinary edit (same createdTime)', () => {
      seedCutNote(1000);

      // Touched, not replaced: mtime moves, birth time does not.
      syncDirectoryItems(DIR, [entry(NOTE, { modifiedTime: 5000, createdTime: 1000 })]);

      const item = getItem(NOTE);
      expect(item?.isCut).toBe(true);
      expect(item?.modifiedTime).toBe(5000);
      // Content cached before the change is still invalidated.
      expect(item?.content).toBeUndefined();
    });

    it('keeps flags when the caller supplies no createdTime at all', () => {
      seedCutNote(1000);

      upsertItems([{ path: NOTE, name: 'note.md', isDirectory: false, modifiedTime: 9000 }]);

      expect(getItem(NOTE)?.isCut).toBe(true);
    });
  });

  describe('syncDirectoryItems: pruning vanished entries', () => {
    it('removes cached entries the listing no longer contains', () => {
      seedCutNote();
      syncDirectoryItems(DIR, [entry('/notes/other.md')]);

      expect(getItem(NOTE)).toBeUndefined();
      expect(getCutItems()).toEqual([]);
      expect(getItem('/notes/other.md')).toBeDefined();
    });

    it('takes the cached subtree of a vanished folder with it', () => {
      syncDirectoryItems(DIR, [entry('/notes/sub', { isDirectory: true })]);
      syncDirectoryItems('/notes/sub', [entry('/notes/sub/deep.md')]);
      setItemSelected('/notes/sub/deep.md', true);

      // /notes/sub is gone from the listing of /notes.
      syncDirectoryItems(DIR, []);

      expect(getItem('/notes/sub')).toBeUndefined();
      expect(getItem('/notes/sub/deep.md')).toBeUndefined();
    });

    it('leaves entries from other folders alone', () => {
      syncDirectoryItems('/other', [entry('/other/keep.md')]);
      setItemSelected('/other/keep.md', true);

      syncDirectoryItems(DIR, [entry(NOTE)]);

      expect(getItem('/other/keep.md')?.isSelected).toBe(true);
    });

    it('does not prune non-child items passed alongside the listing (attachments)', () => {
      // App passes each markdown file's attachments in the same batch; they live
      // under a subfolder, so they are not direct children of the loaded dir.
      const attachment = entry('/notes/attachments/pic.png');
      syncDirectoryItems(DIR, [entry(NOTE), attachment]);

      expect(getItem('/notes/attachments/pic.png')).toBeDefined();

      // A second load of the same listing must not sweep the attachment away.
      syncDirectoryItems(DIR, [entry(NOTE), attachment]);
      expect(getItem('/notes/attachments/pic.png')).toBeDefined();
    });

    it('prunes children even when the listing is empty', () => {
      seedCutNote();

      syncDirectoryItems(DIR, []);

      expect(getItem(NOTE)).toBeUndefined();
    });

    it('upsertItems stays purely additive (ThreadView spans many folders)', () => {
      seedCutNote();

      upsertItems([entry('/notes/other.md')]);

      expect(getItem(NOTE)?.isCut).toBe(true);
      expect(getItem('/notes/other.md')).toBeDefined();
    });
  });

  describe('content cache invalidation timestamps', () => {
    it('keeps the cache when mtime and size are unchanged', () => {
      syncDirectoryItems(DIR, [entry(NOTE, { size: 10 })]);
      setItemContent(NOTE, '0123456789', 1000, 10);

      syncDirectoryItems(DIR, [entry(NOTE, { size: 10 })]);

      expect(getItem(NOTE)?.content).toBe('0123456789');
      expect(isCacheValid(NOTE)).toBe(true);
    });

    it('invalidates an equal-mtime external overwrite when the size differs', () => {
      // Coarse-mtime filesystems (1–2s granularity) can report the same mtime
      // for an external edit; the size comparison still catches it.
      syncDirectoryItems(DIR, [entry(NOTE, { size: 10 })]);
      setItemContent(NOTE, '0123456789', 1000, 10);

      syncDirectoryItems(DIR, [entry(NOTE, { size: 12 })]);

      expect(getItem(NOTE)?.content).toBeUndefined();
      expect(isCacheValid(NOTE)).toBe(false);
    });

    it('invalidates when the mtime moves backward (restore from backup)', () => {
      syncDirectoryItems(DIR, [entry(NOTE, { modifiedTime: 5000 })]);
      setItemContent(NOTE, 'body', 5000);

      syncDirectoryItems(DIR, [entry(NOTE, { modifiedTime: 1000 })]);

      expect(getItem(NOTE)?.content).toBeUndefined();
    });

    it('invalidates a cache stamp that ran ahead of the real disk mtime', () => {
      // A stamp ahead of the disk mtime (e.g. a wall-clock guess) used to pass
      // the old `>` / `>=` checks forever, hiding every later external edit.
      syncDirectoryItems(DIR, [entry(NOTE)]);
      setItemContent(NOTE, 'body', 2000);

      syncDirectoryItems(DIR, [entry(NOTE, { modifiedTime: 1000 })]);

      expect(getItem(NOTE)?.content).toBeUndefined();
    });

    it('does not validate stale content committed after a refresh recorded a newer mtime', () => {
      syncDirectoryItems(DIR, [entry(NOTE)]);
      // A refresh lands with mtime 2000 while a read of the older content is
      // still in flight...
      syncDirectoryItems(DIR, [entry(NOTE, { modifiedTime: 2000 })]);
      // ...then the in-flight read commits, stamped with the mtime it read at.
      setItemContent(NOTE, 'stale body', 1000);

      // The newer metadata survives and the stale content is not cache-valid.
      expect(getItem(NOTE)?.modifiedTime).toBe(2000);
      expect(isCacheValid(NOTE)).toBe(false);
    });
  });
});

describe('renameItem / deleteItems — path-holding slices stay in sync', () => {
  /** A calendar event originating from `filePath`. */
  function event(id: string, filePath?: string) {
    return { id, title: id, start: new Date(0), end: new Date(0), filePath };
  }

  beforeEach(() => {
    clearCache();
    useAS.setState({
      settings: { ...useAS.getState().settings, bookmarks: [] },
      calendarEvents: null,
      selectedLinkItems: [],
    });
  });

  describe('renameItem: bookmarks', () => {
    it('remaps a bookmark to the renamed path itself and reports the change', () => {
      useAS.setState({
        settings: { ...useAS.getState().settings, bookmarks: [{ path: NOTE, name: 'note' }] },
      });

      expect(renameItem(NOTE, '/notes/renamed.md', 'renamed.md')).toBe(true);

      expect(useAS.getState().settings.bookmarks).toEqual([{ path: '/notes/renamed.md', name: 'note' }]);
    });

    it('remaps bookmarks to descendants of a renamed folder', () => {
      useAS.setState({
        settings: {
          ...useAS.getState().settings,
          bookmarks: [
            { path: '/notes/deep/a.md', name: 'a' },
            { path: '/notes-archive/b.md', name: 'sibling with the old name as a prefix' },
            { path: '/other/c.md', name: 'unrelated' },
          ],
        },
      });

      expect(renameItem(DIR, '/journal', 'journal')).toBe(true);

      expect(useAS.getState().settings.bookmarks).toEqual([
        { path: '/journal/deep/a.md', name: 'a' },
        { path: '/notes-archive/b.md', name: 'sibling with the old name as a prefix' },
        { path: '/other/c.md', name: 'unrelated' },
      ]);
    });

    it('returns false and leaves settings untouched when no bookmark matches', () => {
      const before = useAS.getState().settings;

      expect(renameItem(NOTE, '/notes/renamed.md', 'renamed.md')).toBe(false);

      expect(useAS.getState().settings).toBe(before);
    });
  });

  describe('renameItem: calendar events', () => {
    it('remaps events whose files live under a renamed folder', () => {
      useAS.setState({
        calendarEvents: [event('in', '/notes/cal/meet.md'), event('out', '/other/x.md'), event('none')],
      });

      renameItem(DIR, '/journal', 'journal');

      expect(useAS.getState().calendarEvents?.map(e => e.filePath)).toEqual([
        '/journal/cal/meet.md',
        '/other/x.md',
        undefined,
      ]);
    });
  });

  describe('renameItem: copied link paths', () => {
    it('remaps "Copy Link" paths under a renamed folder', () => {
      useAS.setState({ selectedLinkItems: [NOTE, '/other/x.md'] });

      renameItem(DIR, '/journal', 'journal');

      expect(useAS.getState().selectedLinkItems).toEqual(['/journal/note.md', '/other/x.md']);
    });
  });

  describe('renameItem: items map', () => {
    it('still re-keys the entry and its cached descendants, preserving state', () => {
      syncDirectoryItems(DIR, [entry(NOTE)]);
      setItemContent(NOTE, 'body', 1000);
      setItemSelected(NOTE, true);

      renameItem(DIR, '/journal', 'journal');

      expect(getItem(NOTE)).toBeUndefined();
      const moved = getItem('/journal/note.md');
      expect(moved?.content).toBe('body');
      expect(moved?.isSelected).toBe(true);
    });

    it('remaps the other slices even when the renamed path is not cached', () => {
      useAS.setState({ selectedLinkItems: ['/uncached/a.md'] });

      renameItem('/uncached', '/moved', 'moved');

      expect(useAS.getState().selectedLinkItems).toEqual(['/moved/a.md']);
    });
  });

  describe('deleteItems: copied link paths', () => {
    it('drops "Copy Link" paths at or under a deleted path, keeping the rest', () => {
      useAS.setState({ selectedLinkItems: [NOTE, '/notes/deep/a.md', '/other/x.md'] });

      deleteItems([DIR]);

      expect(useAS.getState().selectedLinkItems).toEqual(['/other/x.md']);
    });
  });
});
