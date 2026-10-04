import { describe, it, expect, beforeEach } from 'vitest';
import { useAS } from '../src/store/core';
import { deleteItems, renameItem, setHighlightItem, syncDirectoryItems } from '../src/store/items';
import { revealInTree } from '../src/store/indexTree';
import { canGoBack, canGoForward, goBack, goForward, MAX_HISTORY } from '../src/store/history';

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

  it('records revealInTree', () => {
    revealInTree(A);
    expect(history().navHistory).toEqual([A]);
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

    deleteItems([A]);
    expect(history()).toEqual({ navHistory: [B], navHistoryIndex: 0 });

    deleteItems([B]);
    expect(history()).toEqual({ navHistory: [], navHistoryIndex: -1 });
  });
});
