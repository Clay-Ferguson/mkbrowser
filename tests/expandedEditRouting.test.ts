import { describe, it, expect, beforeEach } from 'vitest';
import { useAS } from '../src/store/core';
import { clearCache, setItemEditing, syncDirectoryItems, upsertItems } from '../src/store/items';
import { setBrowseFile, setCurrentPath, setCurrentView, toggleExpandedEditor } from '../src/store/view';

/**
 * Expanded-editor routing: with the user's `expandedEditor` preference on, an
 * edit started in the folder listing takes over the whole pane by entering
 * single-file mode (BrowseFile) rather than by re-styling BrowseView around the
 * entry. These tests pin the rules in `src/store/expandedEdit.ts` — which edits
 * route, which stay inline, and what returns to the listing.
 *
 * The bug that motivated the design: the old layout flag came from a scan of the
 * global, long-lived items map, so it stayed true after navigating away from the
 * file being edited and wrecked the destination folder's listing. The
 * cross-folder cases below are the regression guards for that.
 */

const FOLDER = '/notes';
const NOTE = '/notes/note.md';
const OTHER = '/notes/other.md';
const ATTACHMENT = '/notes/note.md_attach/clip.md';
const ELSEWHERE = '/archive/old.md';

function entry(path: string) {
  return {
    path,
    name: path.substring(path.lastIndexOf('/') + 1),
    isDirectory: false,
    modifiedTime: 1000,
    createdTime: 1000,
  };
}

/** Put the folder's files (plus an attachment and a file in another folder) in the store. */
function seed(): void {
  syncDirectoryItems(FOLDER, [entry(NOTE), entry(OTHER)]);
  upsertItems([entry(ATTACHMENT), entry(ELSEWHERE)]);
}

/** Browse `FOLDER` in the listing, with the expanded-editor preference on or off. */
function browseFolder(expandedEditor: boolean): void {
  setCurrentPath(FOLDER);
  setCurrentView('browser');
  useAS.setState({ settings: { ...useAS.getState().settings, expandedEditor } });
}

const browseState = () => {
  const { browseFileName, browseFileMode } = useAS.getState();
  return { browseFileName, browseFileMode };
};

describe('expanded-editor routing', () => {
  beforeEach(() => {
    clearCache();
    useAS.setState({ browseFileName: null, browseFileMode: 'browse', pendingScrollToFile: null });
    seed();
  });

  describe('entering', () => {
    it('leaves the edit inline when the preference is off', () => {
      browseFolder(false);
      setItemEditing(NOTE, true);
      expect(browseState()).toEqual({ browseFileName: null, browseFileMode: 'browse' });
    });

    it('hands the pane to a file in the current folder when the preference is on', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);
      expect(browseState()).toEqual({ browseFileName: 'note.md', browseFileMode: 'expanded-edit' });
      // The edit itself still happened.
      expect(useAS.getState().items.get(NOTE)?.editing).toBe(true);
    });

    it('leaves attachments inline — they are not part of the folder listing', () => {
      browseFolder(true);
      setItemEditing(ATTACHMENT, true);
      expect(browseState()).toEqual({ browseFileName: null, browseFileMode: 'browse' });
    });

    it('leaves a file from another folder inline', () => {
      browseFolder(true);
      setItemEditing(ELSEWHERE, true);
      expect(browseState()).toEqual({ browseFileName: null, browseFileMode: 'browse' });
    });

    it('leaves ThreadView editing alone', () => {
      browseFolder(true);
      setCurrentView('thread');
      setItemEditing(NOTE, true);
      expect(browseState()).toEqual({ browseFileName: null, browseFileMode: 'browse' });
    });

    it('keeps mode "browse" when editing a file reached by single-file browsing', () => {
      browseFolder(true);
      setBrowseFile(FOLDER, 'note.md');
      setItemEditing(NOTE, true);
      // That caller owns the pane on its own terms and hides the toggle; the
      // edit must not silently convert it into an expanded-edit session.
      expect(browseState()).toEqual({ browseFileName: 'note.md', browseFileMode: 'browse' });
    });
  });

  describe('leaving', () => {
    it('returns to the listing when the edit ends (cancel / save-and-close)', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);
      setItemEditing(NOTE, false);
      expect(useAS.getState().browseFileName).toBeNull();
    });

    it('queues a scroll to the edited file, so the listing lands on it', () => {
      // The listing dropped back into is the one the user left, which may be
      // scrolled anywhere; BrowseView consumes this to bring the file it
      // highlights back into view.
      browseFolder(true);
      setItemEditing(NOTE, true);
      setItemEditing(NOTE, false);
      expect(useAS.getState().pendingScrollToFile).toBe(NOTE);
      expect(useAS.getState().highlightItem).toBe(NOTE);
    });

    it('queues no scroll when the edit stayed inline in the listing', () => {
      browseFolder(false);
      setItemEditing(NOTE, true);
      setItemEditing(NOTE, false);
      expect(useAS.getState().pendingScrollToFile).toBeNull();
    });

    it('queues no scroll when an unrelated edit ends', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);
      setItemEditing(ELSEWHERE, false);
      expect(useAS.getState().pendingScrollToFile).toBeNull();
    });

    it('stays in single-file mode when a "browse" edit ends', () => {
      browseFolder(true);
      setBrowseFile(FOLDER, 'note.md');
      setItemEditing(NOTE, true);
      setItemEditing(NOTE, false);
      expect(browseState()).toEqual({ browseFileName: 'note.md', browseFileMode: 'browse' });
    });

    it('does not evict the file on screen when an unrelated edit ends', () => {
      // The global Escape handler closes the first editing item it finds, which
      // may be a leftover from another folder.
      browseFolder(true);
      setItemEditing(NOTE, true);
      setItemEditing(ELSEWHERE, false);
      expect(browseState()).toEqual({ browseFileName: 'note.md', browseFileMode: 'expanded-edit' });
    });

    it('does not evict the file on screen when a same-named file elsewhere ends', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);
      upsertItems([entry('/archive/note.md')]);
      setItemEditing('/archive/note.md', false);
      expect(browseState()).toEqual({ browseFileName: 'note.md', browseFileMode: 'expanded-edit' });
    });

    it('exits via a breadcrumb click, i.e. setCurrentPath', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);
      setCurrentPath(FOLDER);
      expect(useAS.getState().browseFileName).toBeNull();
    });
  });

  describe('the expand/collapse toggle', () => {
    it('takes over the pane when switched on mid-edit', () => {
      browseFolder(false);
      setItemEditing(NOTE, true);
      expect(useAS.getState().browseFileName).toBeNull();

      toggleExpandedEditor(NOTE);

      expect(useAS.getState().settings.expandedEditor).toBe(true);
      expect(browseState()).toEqual({ browseFileName: 'note.md', browseFileMode: 'expanded-edit' });
    });

    it('drops back to the listing when switched off, leaving the edit open', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);

      toggleExpandedEditor(NOTE);

      expect(useAS.getState().settings.expandedEditor).toBe(false);
      expect(useAS.getState().browseFileName).toBeNull();
      // The editor stays open — it just moves back into the folder listing.
      expect(useAS.getState().items.get(NOTE)?.editing).toBe(true);
    });

    it('only flips the preference when there is nothing to route (ThreadView)', () => {
      browseFolder(false);
      setCurrentView('thread');
      setItemEditing(NOTE, true);

      toggleExpandedEditor(NOTE);

      expect(useAS.getState().settings.expandedEditor).toBe(true);
      expect(useAS.getState().browseFileName).toBeNull();
    });
  });

  describe('the original bug: cross-folder staleness', () => {
    it('navigating away mid-edit leaves no single-file state behind', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);
      expect(useAS.getState().browseFileName).toBe('note.md');

      // Click a breadcrumb / navigate to another folder while still editing.
      setCurrentPath('/archive');

      // The file is still flagged as editing in the global items map — that is
      // exactly the state that used to keep the listing maximized — but the
      // destination folder shows a plain listing.
      expect(useAS.getState().items.get(NOTE)?.editing).toBe(true);
      expect(useAS.getState().browseFileName).toBeNull();
    });

    it('a stale editing item elsewhere does not maximize the folder you arrive at', () => {
      browseFolder(true);
      setItemEditing(NOTE, true);
      setCurrentPath('/archive');

      // Editing something in the new folder routes on its own merits.
      upsertItems([entry('/archive/old.md')]);
      setItemEditing('/archive/old.md', true);
      expect(browseState()).toEqual({ browseFileName: 'old.md', browseFileMode: 'expanded-edit' });
    });
  });
});
