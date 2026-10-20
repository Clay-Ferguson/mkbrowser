import { describe, it, expect, beforeEach } from 'vitest';
import { useAS } from '../src/store/core';
import { deleteItems, renameItem, setHighlightItem, setItemEditing, startEditing, syncDirectoryItems } from '../src/store/items';
import { revealInTree } from '../src/store/indexTree';
import { canGoBack, canGoForward, goBack, goForward, MAX_HISTORY, recordHistoryVisit } from '../src/store/history';

const A = '/notes/a.md';
const B = '/notes/b.md';
const C = '/notes/sub/c.md';

function history() {
  const { navHistory, navHistoryIndex } = useAS.getState();
  return { navHistory, navHistoryIndex };
}

describe('navigation history', () => {
  beforeEach(() => {
    useAS.setState({
      items: new Map(),
      navHistory: [],
      navHistoryIndex: -1,
      navHistoryDetached: false,
      highlightItem: null,
      currentPath: '/notes',
      browseFileName: null,
      currentView: 'settings',
    });
  });

  it('records each highlighted file and skips repeats of the current entry', () => {
    setHighlightItem(A);
    setHighlightItem(A);
    setHighlightItem(B);
    expect(history()).toEqual({ navHistory: [A, B], navHistoryIndex: 1 });
  });

  it('records a revisit of the current entry after highlight moved without history', () => {
    setHighlightItem(A);
    setHighlightItem('/notes', { history: false });
    setHighlightItem(A);
    expect(history()).toEqual({ navHistory: [A], navHistoryIndex: 0 });
    expect(useAS.getState().highlightItem).toBe(A);
  });

  it('does not record when history: false', () => {
    setHighlightItem(A, { history: false });
    expect(history()).toEqual({ navHistory: [], navHistoryIndex: -1 });
    expect(useAS.getState().highlightItem).toBe(A);
  });

  it('skips known directories', () => {
    syncDirectoryItems('/notes', [{ path: '/notes/sub', name: 'sub', isDirectory: true, modifiedTime: 1, createdTime: 1 }]);
    setHighlightItem('/notes/sub');
    expect(history().navHistory).toEqual([]);
  });

  it('records a visit without highlighting it', () => {
    recordHistoryVisit(A);
    recordHistoryVisit(A);
    expect(history()).toEqual({ navHistory: [A], navHistoryIndex: 0 });
    expect(useAS.getState().highlightItem).toBeNull();
  });

  it('records a followed link as its source file then its target, so Back returns to the source', () => {
    setHighlightItem(C);
    // A link in B (never highlighted) to A: the source is recorded, then opening A records it.
    recordHistoryVisit(B);
    setHighlightItem(A);
    expect(history()).toEqual({ navHistory: [C, B, A], navHistoryIndex: 2 });
    goBack();
    expect(useAS.getState().highlightItem).toBe(B);
  });

  it('does not duplicate a link source that is already the current entry', () => {
    setHighlightItem(B);
    recordHistoryVisit(B);
    setHighlightItem(A);
    expect(history()).toEqual({ navHistory: [B, A], navHistoryIndex: 1 });
  });

  it('records revealInTree', () => {
    revealInTree(A);
    expect(history().navHistory).toEqual([A]);
  });

  it('records files opened for editing', () => {
    syncDirectoryItems('/notes', [
      { path: A, name: 'a.md', isDirectory: false, modifiedTime: 1, createdTime: 1 },
      { path: B, name: 'b.md', isDirectory: false, modifiedTime: 1, createdTime: 1 },
    ]);
    startEditing(A);
    setItemEditing(A, false);
    setItemEditing(B, true);
    expect(history()).toEqual({ navHistory: [A, B], navHistoryIndex: 1 });
    expect(canGoBack(useAS.getState())).toBe(true);
  });

  it('goBack/goForward open the file in single-file mode without adding entries', () => {
    setHighlightItem(A);
    setHighlightItem(C);
    expect(canGoBack(useAS.getState())).toBe(true);
    expect(canGoForward(useAS.getState())).toBe(false);

    goBack();
    let s = useAS.getState();
    expect(history()).toEqual({ navHistory: [A, C], navHistoryIndex: 0 });
    expect(s.highlightItem).toBe(A);
    expect(s.currentPath).toBe('/notes');
    expect(s.browseFileName).toBe('a.md');
    expect(s.currentView).toBe('browser');
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(true);

    goBack(); // no-op at the start
    expect(history().navHistoryIndex).toBe(0);

    goForward();
    s = useAS.getState();
    expect(history()).toEqual({ navHistory: [A, C], navHistoryIndex: 1 });
    expect(s.currentPath).toBe('/notes/sub');
    expect(s.browseFileName).toBe('c.md');
  });

  it('a new visit after going back discards the forward entries', () => {
    setHighlightItem(A);
    setHighlightItem(B);
    goBack();
    setHighlightItem(C);
    expect(history()).toEqual({ navHistory: [A, C], navHistoryIndex: 1 });
  });

  it('caps the history length, dropping the oldest entries', () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) setHighlightItem(`/notes/f${i}.md`);
    const { navHistory, navHistoryIndex } = history();
    expect(navHistory).toHaveLength(MAX_HISTORY);
    expect(navHistory[0]).toBe('/notes/f5.md');
    expect(navHistoryIndex).toBe(MAX_HISTORY - 1);
  });

  it('follows renames of a file or an ancestor folder', () => {
    setHighlightItem(A);
    setHighlightItem(C);
    renameItem('/notes/sub', '/notes/moved', 'moved');
    expect(history().navHistory).toEqual([A, '/notes/moved/c.md']);
  });

  it('prunes deleted entries, collapses neighbors, and keeps a valid position', () => {
    setHighlightItem(A);
    setHighlightItem(C);
    setHighlightItem(A);
    setHighlightItem(B);
    goBack(); // current: A (index 2)
    deleteItems(['/notes/sub']);
    expect(history()).toEqual({ navHistory: [A, B], navHistoryIndex: 0 });

    deleteItems([A]); // the current entry: the position now sits before B
    expect(history()).toEqual({ navHistory: [B], navHistoryIndex: -1 });
    expect(canGoBack(useAS.getState())).toBe(false);
    expect(canGoForward(useAS.getState())).toBe(true);

    deleteItems([B]);
    expect(history()).toEqual({ navHistory: [], navHistoryIndex: -1 });
  });
});
