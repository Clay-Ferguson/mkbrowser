import { describe, it, expect, beforeEach } from 'vitest';
import { useAS } from '../src/store/core';
import { setItemSelected, startEditing, syncDirectoryItems } from '../src/store/items';
import { openRootFolder, setCurrentPath, setCurrentView, setRootPath } from '../src/store/view';
import { showCalendarForFolder } from '../src/store/calendar';
import { revealInTree } from '../src/store/indexTree';

/**
 * Intent-level actions that replace sequences of single-field setters. Each must
 * land its whole transition in exactly one store notification, so no subscriber
 * ever observes a half-applied state (e.g. a new rootPath with a currentPath
 * still inside the old root).
 */

const OLD_ROOT = '/old';
const NOTE = '/old/note.md';

function entry(path: string) {
  return {
    path,
    name: path.substring(path.lastIndexOf('/') + 1),
    isDirectory: false,
    modifiedTime: 1000,
    createdTime: 1000,
  };
}

/** Count store notifications fired while `fn` runs. */
function countNotifications(fn: () => void): number {
  let count = 0;
  const unsubscribe = useAS.subscribe(() => { count++; });
  fn();
  unsubscribe();
  return count;
}

describe('atomic transitions', () => {
  beforeEach(() => {
    useAS.setState({ items: new Map() });
    setRootPath(OLD_ROOT);
    setCurrentPath(OLD_ROOT);
    setCurrentView('settings');
    useAS.setState({
      browseFileName: null,
      visibleTabs: new Set(),
      settings: { ...useAS.getState().settings, expandedEditor: false },
    });
    syncDirectoryItems(OLD_ROOT, [entry(NOTE)]);
  });

  it('openRootFolder sets root, path and view together and clears selections', () => {
    setItemSelected(NOTE, true);
    useAS.setState({ browseFileName: 'note.md' });

    expect(countNotifications(() => openRootFolder('/new'))).toBe(1);

    const s = useAS.getState();
    expect(s.rootPath).toBe('/new');
    expect(s.currentPath).toBe('/new');
    expect(s.currentView).toBe('browser');
    expect(s.browseFileName).toBeNull();
    expect(s.items.get(NOTE)?.isSelected).toBe(false);
  });

  it('showCalendarForFolder shows the tab, view, source and loading flag together', () => {
    expect(countNotifications(() => showCalendarForFolder(OLD_ROOT))).toBe(1);

    const s = useAS.getState();
    expect(s.visibleTabs.has('calendar')).toBe(true);
    expect(s.currentView).toBe('calendar');
    expect(s.calendarSource).toEqual({ kind: 'folder', folder: OLD_ROOT });
    expect(s.calendarLoading).toBe(true);
  });

  it('revealInTree highlights, switches to the browser and queues the reveal together', () => {
    expect(countNotifications(() => revealInTree(NOTE))).toBe(1);

    const s = useAS.getState();
    expect(s.highlightItem).toBe(NOTE);
    expect(s.currentView).toBe('browser');
    expect(s.pendingIndexTreeReveal).toBe(NOTE);
  });

  it('startEditing expands and enters edit mode in one entry update', () => {
    expect(countNotifications(() => startEditing(NOTE, 7))).toBe(1);

    const item = useAS.getState().items.get(NOTE);
    expect(item?.isExpanded).toBe(true);
    expect(item?.editing).toBe(true);
    expect(item?.goToLine).toBe(7);
    expect(useAS.getState().highlightItem).toBe(NOTE);
  });
});
