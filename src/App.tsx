import { useState, useEffect, useCallback } from 'react';
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
  upsertItems,
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
} from './store';
import type { CalendarEvent, AppView } from './shared/types';
import type { CalendarEventResult, AppConfig } from './shared/shared';
import type { FileNode } from './store';
import { loadConfig } from './renderer/config';
import { isPathInside } from './renderer/pathUtil';
import { applyGlobalHighlight, globalHighlightText } from './renderer/globalHighlight';
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
    return api.onCalendarFileChanged((results: CalendarEventResult[], filePath: string) => {
      // console.log('[App] onCalendarFileChanged fired', { filePath, count: results.length });
      const updated: CalendarEvent[] = results.map(r => ({
        id: r.id, title: r.title, start: new Date(r.start), end: new Date(r.end), filePath: r.filePath, snippet: r.snippet,
      }));
      updateCalendarEvent(filePath, updated);
    });
  }, []);

  useEffect(() => {
    return api.onCalendarFileDeleted((deletedPath: string, isFolder: boolean) => {
      // console.log('[App] onCalendarFileDeleted fired', { deletedPath, isFolder });
      if (isFolder) {
        deleteCalendarEventsUnderPath(deletedPath);
      } else {
        updateCalendarEvent(deletedPath, []);
      }
    });
  }, []);

  // Apply font size globally via data attribute on html element
  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', settings.fontSize);
  }, [settings.fontSize]);

  // Apply global text highlight after each navigation/load cycle
  useEffect(() => {
    const id = requestAnimationFrame(() => applyGlobalHighlight(globalHighlightText));
    return () => cancelAnimationFrame(id);
  }, [currentPath, currentView, loading]);

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
    const initConfig = async () => {
      const result = await loadConfig();
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
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
      setLoading(false);
    });
  }, []);

  // Load directory contents
  const loadDirectory = useCallback(async (showLoading = true) => {
    if (!currentPath) return;

    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    // A slow read can resolve after the user has navigated elsewhere, so every
    // state write below (including the loading flip) is gated on the loaded
    // path still being current — otherwise this run's results are stale and
    // belong to a folder we've already left.
    const isStale = () => useAS.getState().currentPath !== currentPath;
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
          aiHint: file.aiHint,
        }];
        if (file.attachments) {
          const attachItems = file.attachments.map((a) => ({
            path: a.path,
            name: a.name,
            isDirectory: a.isDirectory,
            modifiedTime: a.modifiedTime,
            createdTime: a.createdTime,
            aiHint: a.aiHint,
          }));
          return [...base, ...attachItems];
        }
        return base;
      });
      upsertItems(allItems);
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
  }, [currentPath]);

  // Load directory when path changes, or when an out-of-band refresh is requested
  //
  // This is React's documented pattern for running async work in an effect: 
  // the async call is moved inside an inline async function (await as its first 
  // statement) rather than being invoked directly in the effect body.
  useEffect(() => {
    void (async () => {
      await loadDirectory();
    })();
  }, [loadDirectory, directoryRefreshNonce]);

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

  const refreshDirectory = useCallback(() => {
    void loadDirectory(false);
    const root = getIndexTreeRoot();
    if (root) {
      refreshExpandedNodes(root)
        .then(newRoot => setIndexTreeRoot(newRoot))
        .catch((err: unknown) => logger.error('Failed to refresh index tree:', err));
    }
  }, [loadDirectory]);

  const handleSelectFolder = useCallback(() => {
    void (async () => {
      try {
        const folder = await api.selectFolder();
        if (folder) {
          await api.updateConfig({ browseFolder: folder, curSubFolder: undefined });
          setRootPath(folder);
          setCurrentPath(folder);
        }
      } catch (err) {
        setError('Failed to open folder: ' + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, []);

  const handleOpenRecentFolder = useCallback((folder: string) => {
    void (async () => {
      try {
        if (rootPath && isPathInside(rootPath, folder)) {
          setCurrentPath(folder);
          setCurrentView('browser');
        } else {
          await api.updateConfig({ browseFolder: folder, curSubFolder: undefined });
          setRootPath(folder);
          setCurrentPath(folder);
          setCurrentView('browser');
        }
      } catch (err) {
        setError('Failed to open folder: ' + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, [rootPath]);

  const handleQuit = useCallback(() => {
    void api.quit();
  }, []);

  const handleNavigateToSearchResult = useCallback((folderPath: string, resultPath: string) => {
    navigateToBrowserPath(folderPath, resultPath);
  }, []);

  const handleSearchHashtag = useCallback((hashtag: string, ctrlKey: boolean) => {
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
        setError('Search failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, [currentPath]);

  const handleSaveSettings = useCallback(() => {
    void (async () => {
      try {
        await api.updateConfig({ settings: getSettings() });
      } catch {
        setError('Failed to save settings');
      }
    })();
  }, []);

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
