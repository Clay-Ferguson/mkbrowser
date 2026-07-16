import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { FolderIcon } from '@heroicons/react/24/outline';
import { api } from './renderer/api';
import type { FileEntry } from './global';
import AlertDialog from './components/dialogs/AlertDialog';
import SearchResultsView from './components/views/SearchResultsView';
import SettingsView from './components/views/SettingsView';
import FolderAnalysisView from './components/views/FolderAnalysisView';
import FolderGraphView from './components/views/FolderGraphView';
import CalendarView from './components/views/CalendarView';
import AISettingsView from './components/views/AISettingsView';
import ThreadView from './components/views/ThreadView';
import BrowseView from './components/views/BrowseView';
import IndexTreeView from './components/views/IndexTreeView';
import AppTabButtons from './components/AppTabButtons';
import {
  syncDirectoryItems,
  setSearchResults,
  getSettings,
  setCurrentView,
  setCurrentPath,
  navigateToBrowserPath,
  setRootPath,
  useAS,
  getIndexTreeRoot,
  setIndexTreeRoot,
  getEditingItem,
  setItemEditing,
  updateCalendarEvent,
  deleteCalendarEventsUnderPath,
  setCalendarWatcherWarning,
} from './store';
import type { CalendarEvent, AppView } from './shared/types';
import type { CalendarEventResult, AppConfig } from './shared/shared';
import type { FileNode } from './store';
import { loadConfig } from './renderer/config';
import { isPathInside } from './renderer/pathUtil';
import { applyGlobalHighlight, getGlobalHighlightText } from './renderer/globalHighlight';
import { logger } from './shared/logUtil';

async function refreshExpandedNodes(node: FileNode): Promise<FileNode> {
  if (!node.isDirectory || !node.isExpanded) return node;
  try {
    const entries = await api.readDirectory(node.path);
    const oldByPath = new Map((node.children ?? []).map(c => [(c as FileNode).path, c as FileNode]));
    const hasIndexOrder = entries.some(e => e.indexOrder !== undefined);
    const sortedEntries = hasIndexOrder
      ? entries
      : [...entries].sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
    const newChildren: FileNode[] = sortedEntries.map(e => {
      const existing = oldByPath.get(e.path);
      if (existing) {
        if (e.indexOrder !== undefined) return { ...existing, indexOrder: e.indexOrder };
        if ('indexOrder' in existing) { const { indexOrder: _io, ...rest } = existing; return rest as FileNode; }
        return existing;
      }
      return {
        path: e.path,
        name: e.name,
        isDirectory: e.isDirectory,
        isExpanded: false,
        isLoading: false,
        children: null,
        ...(e.indexOrder !== undefined ? { indexOrder: e.indexOrder } : {}),
      };
    });
    const refreshedChildren = await Promise.all(newChildren.map(refreshExpandedNodes));
    return { ...node, children: refreshedChildren, isLoading: false };
  } catch {
    return node;
  }
}

/**
 * Formats an unknown thrown value for display. Also keeps ternaries out of
 * App's catch blocks — the React Compiler bails out on value blocks
 * (conditional/logical expressions) inside a try/catch statement.
 */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Monotonic token identifying the most recent loadDirectoryContents call.
 * Two loads of the *same* path can overlap (a directoryRefreshNonce bump or
 * refreshDirectory racing an in-flight load), and the path-based staleness
 * check alone can't order them — without this, the older read resolving last
 * would overwrite the newer listing.
 */
let latestLoadToken = 0;

/**
 * Reads the given directory via IPC and pushes the results into App state and
 * the item store. Module-level (not in the component) so its try/catch/finally
 * doesn't make the React Compiler bail out on App.
 */
async function loadDirectoryContents(
  currentPath: string,
  showLoading: boolean,
  setEntries: (entries: FileEntry[]) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  if (!currentPath) return;
  const token = ++latestLoadToken;

  if (showLoading) {
    setLoading(true);
  }
  setError(null);
  // A slow read can resolve after the user has navigated elsewhere, or after a
  // newer load of the same path has started, so every state write below
  // (including the loading flip) is gated on this run still being the latest
  // request for the current path. The path check is still needed alongside the
  // token: the store's currentPath can change before the effect fires the next
  // load (and bumps the token).
  const isStale = () =>
    token !== latestLoadToken || useAS.getState().currentPath !== currentPath;
  try {
    const files = await api.readDirectory(currentPath);
    if (isStale()) return;
    setEntries(files);

    // Update global store with all items from this directory (including attachment sub-items)
    const allItems = files.flatMap((file) => {
      const base = [{
        path: file.path,
        name: file.name,
        isDirectory: file.isDirectory,
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime,
        size: file.size,
        aiHint: file.aiHint,
      }];
      if (file.attachments) {
        const attachItems = file.attachments.map((a) => ({
          path: a.path,
          name: a.name,
          isDirectory: a.isDirectory,
          modifiedTime: a.modifiedTime,
          createdTime: a.createdTime,
          size: a.size,
          aiHint: a.aiHint,
        }));
        return [...base, ...attachItems];
      }
      return base;
    });
    // A full listing of currentPath, so this also prunes the cached entries of
    // files that vanished from it (deleted or moved outside the app). Leaving
    // them behind would let a later paste/delete act on a stale isCut/isSelected
    // flag — see syncDirectoryItems.
    syncDirectoryItems(currentPath, allItems);
  } catch (err) {
    if (isStale()) return;
    const errorMessage = err instanceof Error ? err.message : 'Failed to read directory';
    if (errorMessage.includes('does not exist')) {
      setError('This folder no longer exists');
    } else {
      setError('Failed to read directory');
    }
    setEntries([]);
  } finally {
    if (!isStale()) {
      setLoading(false);
    }
  }
}

function App() {
  const rootPath = useAS(s => s.rootPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [lastExportFolder, setLastExportFolder] = useState<string>('');
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  // Views are mounted on first visit and then kept in the DOM (visibility
  // toggled via CSS), so each view's scroll position is preserved natively.
  // This set tracks which views have been activated at least once.
  const [visitedViews, setVisitedViews] = useState<Set<AppView>>(() => new Set<AppView>(['browser']));
  const items = useAS(s => s.items);
  const currentView = useAS(s => s.currentView);
  const currentPath = useAS(s => s.currentPath);
  const directoryRefreshNonce = useAS(s => s.directoryRefreshNonce);
  const folderGraph = useAS(s => s.folderGraph);
  const settings = useAS(s => s.settings);

  // Mark the active view as visited so it stays mounted from now on. Adjusting
  // state during render (rather than in an effect) avoids a cascading re-render
  // and keeps the newly visited view mounted in the same render pass.
  if (!visitedViews.has(currentView)) {
    const next = new Set(visitedViews);
    next.add(currentView);
    setVisitedViews(next);
  }

  // Listen for calendar file changes from the main process (chokidar) — lives here so
  // it's always active regardless of which view is currently displayed.
  useEffect(() => {
    // Returns the useEffect cleanup: the unsubscribe fn from onCalendarFileChanged, which removes the 'calendar-file-changed' IPC listener on unmount.
    return api.onCalendarFileChanged((results: CalendarEventResult[], filePath: string) => {
      // console.log('[App] onCalendarFileChanged fired', { filePath, count: results.length });
      const updated: CalendarEvent[] = results.map(r => ({
        id: r.id, title: r.title, start: new Date(r.start), end: new Date(r.end), filePath: r.filePath, snippet: r.snippet,
      }));
      updateCalendarEvent(filePath, updated);
    });
  }, []);

  useEffect(() => {
    // Returns the useEffect cleanup: the unsubscribe fn from onCalendarFileDeleted, which removes the 'calendar-file-deleted' IPC listener on unmount.
    return api.onCalendarFileDeleted((deletedPath: string, isFolder: boolean) => {
      // console.log('[App] onCalendarFileDeleted fired', { deletedPath, isFolder });
      if (isFolder) {
        deleteCalendarEventsUnderPath(deletedPath);
      } else {
        updateCalendarEvent(deletedPath, []);
      }
    });
  }, []);

  // Surface a one-time file-watcher warning (e.g. inotify exhaustion) so the user
  // knows calendar live-updates degraded. Shown as a dismissible banner in CalendarView.
  useEffect(() => {
    // Returns the useEffect cleanup: the unsubscribe fn that removes the 'calendar-watcher-error' IPC listener on unmount.
    return api.onCalendarWatcherError((message: string) => {
      setCalendarWatcherWarning(message);
    });
  }, []);

  // Apply font size globally via data attribute on html element
  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', settings.fontSize);
  }, [settings.fontSize]);

  // Apply global text highlight after each navigation/load cycle. `entries` is a
  // dep so a silent refresh (refreshDirectory → loadDirectoryContents with
  // showLoading:false) reapplies the highlight after it swaps the rendered DOM —
  // `loading` never toggles on that path, so it alone would miss those refreshes.
  useEffect(() => {
    const id = requestAnimationFrame(() => applyGlobalHighlight(getGlobalHighlightText()));
    // Returns the useEffect cleanup (an unsubscribe-style teardown): cancels the pending animation frame on unmount / before re-run.
    return () => cancelAnimationFrame(id);
  }, [currentPath, currentView, loading, entries]);

  // Close an unmodified editor when ESC is pressed anywhere in the app
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const editing = getEditingItem();
      if (!editing) return;
      const { path, item } = editing;
      if ((item.editContent ?? '') === (item.content ?? '')) {
        setItemEditing(path, false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    // Returns the useEffect cleanup (an unsubscribe): removes the document 'keydown' listener on unmount.
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update window title when rootPath changes
  useEffect(() => {
    if (rootPath) {
      void api.setWindowTitle(`MkBrowser: ${rootPath}`);
    } else {
      void api.setWindowTitle('MkBrowser');
    }
  }, [rootPath]);

  // Load initial configuration
  useEffect(() => {
    // Guard against a superseded run's writes winning (StrictMode/dev double-invoke,
    // or an unmount before loadConfig resolves): the cleanup flips this and every
    // post-await state write bails.
    let cancelled = false;
    const initConfig = async () => {
      const result = await loadConfig();
      if (cancelled) return;
      setLastExportFolder(result.lastExportFolder);
      setAiEnabled(result.aiEnabled);
      setRecentFolders(result.recentFolders);
      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else if (result.rootPath) {
        setRootPath(result.rootPath);
      } else {
        setLoading(false);
      }
    };
    initConfig().catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
      setLoading(false);
    });
    // Returns the useEffect cleanup: marks this run stale so its async writes no-op.
    return () => {
      cancelled = true;
    };
  }, []);

  // Load directory when path changes, or when an out-of-band refresh is requested
  useEffect(() => {
    void loadDirectoryContents(currentPath, true, setEntries, setLoading, setError);
  }, [currentPath, directoryRefreshNonce]);

  // Remove entries that were deleted from the store (e.g. via SearchResultsView).
  // Pruning during render (rather than in an effect) avoids a cascading re-render;
  // the length guard keeps this from looping when nothing was removed.
  const prunedEntries = entries.filter(entry => items.has(entry.path));
  if (prunedEntries.length !== entries.length) {
    setEntries(prunedEntries);
  }

  // Keep the most-recently-visited folder at the head of the recents list.
  // Adjusting this during render (rather than in an effect) avoids a cascading
  // re-render; the head check keeps it from looping once it's already current.
  if (currentPath && recentFolders[0] !== currentPath) {
    setRecentFolders([currentPath, ...recentFolders.filter(f => f !== currentPath)].slice(0, 10));
  }

  // Persist current subfolder AND recent folders whenever navigation changes.
  // Each is its own config key, sent via updateConfig so the main process
  // merges them in without touching anything else — no whole-config rewrite,
  // no clobbering of other settings written concurrently.
  useEffect(() => {
    if (!currentPath) return;
    const updates: Partial<AppConfig> = { recentFolders };
    // Current subfolder (only meaningful once we have a root to compare against)
    if (rootPath) {
      updates.curSubFolder = currentPath === rootPath ? undefined : currentPath;
    }
    api.updateConfig(updates).catch(() => {
      // Non-critical — config will be updated on next navigation
    });
  }, [currentPath, rootPath, recentFolders]);

  const refreshDirectory = () => {
    void loadDirectoryContents(currentPath, false, setEntries, setLoading, setError);
    const root = getIndexTreeRoot();
    if (root) {
      refreshExpandedNodes(root)
        .then(newRoot => setIndexTreeRoot(newRoot))
        .catch((err: unknown) => logger.error('Failed to refresh index tree:', err));
    }
  };

  const handleSelectFolder = () => {
    void (async () => {
      try {
        const folder = await api.selectFolder();
        if (folder) {
          await api.updateConfig({ browseFolder: folder, curSubFolder: undefined });
          setRootPath(folder);
          setCurrentPath(folder);
        }
      } catch (err) {
        setError('Failed to open folder: ' + errorMessage(err));
      }
    })();
  };

  const handleOpenRecentFolder = (folder: string) => {
    // Evaluated before the try block: the React Compiler bails out on logical
    // expressions inside a try/catch statement.
    const insideCurrentRoot = !!rootPath && isPathInside(rootPath, folder);
    void (async () => {
      try {
        if (insideCurrentRoot) {
          setCurrentPath(folder);
          setCurrentView('browser');
        } else {
          await api.updateConfig({ browseFolder: folder, curSubFolder: undefined });
          setRootPath(folder);
          setCurrentPath(folder);
          setCurrentView('browser');
        }
      } catch (err) {
        setError('Failed to open folder: ' + errorMessage(err));
      }
    })();
  };

  const handleQuit = () => {
    void api.quit();
  };

  const handleNavigateToSearchResult = (folderPath: string, resultPath: string) => {
    navigateToBrowserPath(folderPath, resultPath);
  };

  const handleSearchHashtag = (hashtag: string, ctrlKey: boolean) => {
    if (!currentPath) return;
    void (async () => {
      try {
        if (ctrlKey) {
          const advancedQuery = `$("${hashtag}")`;
          const results = await api.searchFolder(currentPath, advancedQuery, 'advanced', 'content');
          setSearchResults(results, advancedQuery, currentPath, 'modified-time', 'desc', '');
        } else {
          const results = await api.searchFolder(currentPath, hashtag, 'literal', 'content');
          setSearchResults(results, hashtag, currentPath, 'modified-time', 'desc', '');
        }
        setCurrentView('search-results');
      } catch (err) {
        setError('Search failed: ' + errorMessage(err));
      }
    })();
  };

  const handleSaveSettings = () => {
    void (async () => {
      try {
        await api.updateConfig({ settings: getSettings() });
      } catch {
        setError('Failed to save settings');
      }
    })();
  };

  // Folder selection prompt (first run or no folder configured)
  if (!currentPath && !loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-slate-800 rounded-lg shadow-lg p-8 max-w-md w-full text-center border border-slate-700">
          <div className="mb-6">
            <FolderIcon className="w-16 h-16 mx-auto text-slate-500" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-100 mb-2">Welcome to MkBrowser</h1>
          <p className="text-slate-400 mb-6">
            Select a folder to start browsing your Markdown files.
          </p>
          <button
            type="button"
            onClick={handleSelectFolder}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
            data-testid="select-folder-button"
          >
            Select Folder
          </button>
        </div>

        {error && (
          <AlertDialog
            scrollable
            title="Error"
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </div>
    );
  }

  // Every view is mounted on first visit and then kept in the DOM, with its
  // visibility toggled via CSS (`display`). This preserves each view's own
  // scroll container (and other DOM state, like FolderGraphView's d3/zoom
  // state) across tab switches without any scroll-position save/restore logic.
  // The single shared header (AppTabButtons) and error dialog live outside the
  // per-view wrappers.
  const viewStyle = (view: AppView): CSSProperties => ({
    display: currentView === view ? 'flex' : 'none',
  });

  // Because every visited view stays mounted in the DOM (only toggled via
  // `display`), a bare getByTestId() can match the same element in several
  // tabs at once. Each view wrapper carries a stable `view-<id>` test id plus a
  // `data-active-view` marker on whichever tab is currently shown, so tests can
  // scope lookups to a specific (or the active) tab instead of guessing with
  // .last()/visibility filters. See the `activeView` test helper.
  const viewProps = (view: AppView) => ({
    className: 'flex-1 flex flex-col min-h-0 bg-slate-900',
    style: viewStyle(view),
    'data-testid': `view-${view}`,
    ...(currentView === view ? { 'data-active-view': 'true' } : {}),
  });

  return (
    <>
      <AppTabButtons entries={entries} onSelectFolder={handleSelectFolder} onQuit={handleQuit} recentFolders={recentFolders} onOpenRecentFolder={handleOpenRecentFolder} />

      <div className="flex-1 flex flex-col min-h-0">
        {folderGraph && (
          <div {...viewProps('folder-graph')}>
            <FolderGraphView />
          </div>
        )}

        {visitedViews.has('search-results') && (
          <div {...viewProps('search-results')}>
            <SearchResultsView onNavigateToResult={handleNavigateToSearchResult} />
          </div>
        )}

        {visitedViews.has('settings') && (
          <div {...viewProps('settings')}>
            <SettingsView onSaveSettings={handleSaveSettings} />
          </div>
        )}

        {visitedViews.has('ai-settings') && (
          <div {...viewProps('ai-settings')}>
            <AISettingsView />
          </div>
        )}

        {visitedViews.has('calendar') && (
          <div {...viewProps('calendar')}>
            <CalendarView />
          </div>
        )}

        {visitedViews.has('folder-analysis') && (
          <div {...viewProps('folder-analysis')}>
            <FolderAnalysisView onSearchHashtag={handleSearchHashtag} />
          </div>
        )}

        {visitedViews.has('thread') && (
          <div {...viewProps('thread')}>
            <ThreadView onSaveSettings={handleSaveSettings} />
          </div>
        )}

        {visitedViews.has('browser') && (
          <div {...viewProps('browser')}>
            <div className="flex-1 flex flex-row min-h-0">
              {settings.indexTreeWidth !== 'hidden' && <IndexTreeView onRefreshDirectory={refreshDirectory} />}
              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                <BrowseView
                  entries={entries}
                  loading={loading}
                  aiEnabled={aiEnabled}
                  lastExportFolder={lastExportFolder}
                  onSetLastExportFolder={setLastExportFolder}
                  onRefreshDirectory={refreshDirectory}
                  onSetError={setError}
                  onSaveSettings={handleSaveSettings}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <AlertDialog scrollable title="Error" message={error} onClose={() => setError(null)} />}
    </>
  );
}

export default App;
