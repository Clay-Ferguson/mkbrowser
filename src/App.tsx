import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { FolderIcon } from '@heroicons/react/24/outline';
import { api } from './renderer/api';
import AlertDialog from './components/dialogs/AlertDialog';
import SearchResultsView from './components/views/SearchResultsView';
import SettingsView from './components/views/SettingsView';
import FolderAnalysisView from './components/views/FolderAnalysisView';
import FolderGraphView from './components/views/FolderGraphView';
import CalendarView from './components/views/CalendarView';
import AISettingsView from './components/views/AISettingsView';
import ThreadView from './components/views/ThreadView';
import BrowseView from './components/views/BrowseView';
import ErrorBoundary from './components/ErrorBoundary';
import BrowseFile from './components/views/BrowseFile';
import IndexTreeView from './components/views/IndexTreeView';
import AppTabButtons from './components/AppTabButtons';
import {
  setCurrentView,
  navigateToBrowserPath,
  setRootPath,
  openRootFolder,
  useAS,
  setEntriesLoading,
  getEditingItem,
  isEditUnmodified,
  setItemEditing,
  updateCalendarEvent,
  deleteCalendarEventsUnderPath,
  setCalendarWatcherWarning,
  // Aliased at the import (rather than bound inside App) so it stays a module-scope
  // reference: a local `const setError = setAppError` would read as component state
  // to react-hooks/exhaustive-deps and be demanded in every effect's dep array.
  setAppError as setError,
} from './store';
import type { AppView, SearchDefinition } from './shared/types';
import { newSearchDefinition } from './shared/searchHelpers';
import type { CalendarEventResult, AppConfig } from './shared/shared';
import { toCalendarEvents } from './shared/calendarUtil';
import { loadConfig } from './renderer/config';
import { executeSearch } from './renderer/searchUtil';
import { isPathInside } from './renderer/pathUtil';
import { applyGlobalHighlight, getGlobalHighlightText } from './renderer/globalHighlight';
import { loadDirectoryContents } from './renderer/directoryLoader';
import { buildEntryHeaderId } from './renderer/entryDom';
import { BUTTON_CLASS_LG_BLUE } from './renderer/styles';

/**
 * Formats an unknown thrown value for display. Also keeps ternaries out of
 * App's catch blocks — the React Compiler bails out on value blocks
 * (conditional/logical expressions) inside a try/catch statement.
 */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * True when an Escape keypress belongs to an open overlay — a native <dialog>
 * (Dialog.tsx) or a popover PopupMenu — rather than to the editor. Checks both
 * where the key landed and whether any overlay is open, since focus is not
 * always inside the overlay (e.g. a menu opened while the editor keeps focus).
 */
function isEscapeForOverlay(e: KeyboardEvent): boolean {
  if (e.target instanceof Element && e.target.closest('dialog,[popover]')) return true;
  return document.querySelector('dialog[open],[popover]:popover-open') !== null;
}

/** True when the entry for `path` is currently rendered (its header is in the DOM). */
function isEntryRendered(path: string): boolean {
  return document.getElementById(buildEntryHeaderId(path)) !== null;
}

function App() {
  const rootPath = useAS(s => s.rootPath);
  const entries = useAS(s => s.currentEntries);
  const loading = useAS(s => s.entriesLoading);
  // The error message lives in the store (not local state) so shared file-operation
  // and drag-and-drop code can report a failure without an error callback
  // threaded down to it; App remains the only place that renders it.
  const error = useAS(s => s.appError);
  const [lastExportFolder, setLastExportFolder] = useState<string>('');
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  // Views are mounted on first visit and then kept in the DOM (visibility
  // toggled via CSS), so each view's scroll position is preserved natively.
  // This set tracks which views have been activated at least once.
  const [visitedViews, setVisitedViews] = useState<Set<AppView>>(() => new Set<AppView>(['browser']));
  const currentView = useAS(s => s.currentView);
  const currentPath = useAS(s => s.currentPath);
  const browseFileName = useAS(s => s.browseFileName);
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
      updateCalendarEvent(filePath, toCalendarEvents(results));
    });
  }, []);

  useEffect(() => {
    // Returns the useEffect cleanup: the unsubscribe fn from onCalendarFileDeleted, which removes the 'calendar-file-deleted' IPC listener on unmount.
    return api.onCalendarFileDeleted((deletedPath: string, isFolder: boolean) => {
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
      // Already consumed (CodeMirror's own Escape keymap, autocomplete, search panel), or
      // meant for an open dialog/menu: that Esc dismisses the overlay, not the editor.
      if (e.defaultPrevented || isEscapeForOverlay(e)) return;
      // Only an editor that is on screen: the items Map is global, and an editing item
      // can belong to a folder the user has navigated away from.
      const editing = getEditingItem(isEntryRendered);
      if (editing && isEditUnmodified(editing.item)) {
        setItemEditing(editing.path, false);
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
      setRecentFolders(result.recentFolders);
      if (result.error) {
        setError(result.error);
        setEntriesLoading(false);
      } else if (result.rootPath) {
        setRootPath(result.rootPath);
      } else {
        setEntriesLoading(false);
      }
    };
    initConfig().catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
      setEntriesLoading(false);
    });
    // Returns the useEffect cleanup: marks this run stale so its async writes no-op.
    return () => {
      cancelled = true;
    };
  }, []);

  // Load directory when path changes, or when an out-of-band refresh is requested
  useEffect(() => {
    void loadDirectoryContents(currentPath, true);
  }, [currentPath, directoryRefreshNonce]);

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

  const handleSelectFolder = () => {
    void (async () => {
      try {
        const folder = await api.selectFolder();
        if (folder) {
          await api.updateConfig({ browseFolder: folder, curSubFolder: undefined });
          openRootFolder(folder);
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
          navigateToBrowserPath(folder);
        } else {
          await api.updateConfig({ browseFolder: folder, curSubFolder: undefined });
          openRootFolder(folder);
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
    // A plain click is a literal search: case-insensitive, substring (so #foo
    // also finds #foobar), and it matches file names too. Ctrl+click runs the
    // advanced tag() search instead — whole tag, case-sensitive, contents only —
    // which finds exactly the occurrences the Analysis tab counted. The tag is
    // JSON-encoded so any character in it is a valid JS string literal.
    const definition: SearchDefinition = {
      ...newSearchDefinition(ctrlKey ? `tag(${JSON.stringify(hashtag)})` : hashtag),
      matchType: ctrlKey ? 'advanced' : 'literal',
    };
    void (async () => {
      try {
        if (await executeSearch(currentPath, definition)) setCurrentView('search-results');
      } catch (err) {
        setError('Search failed: ' + errorMessage(err));
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
            className={BUTTON_CLASS_LG_BLUE}
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
      <AppTabButtons onSelectFolder={handleSelectFolder} onQuit={handleQuit} recentFolders={recentFolders} onOpenRecentFolder={handleOpenRecentFolder} />

      <div className="flex-1 flex flex-col min-h-0">
        {folderGraph && (
          <div {...viewProps('folder-graph')}>
            <ErrorBoundary>
              <FolderGraphView />
            </ErrorBoundary>
          </div>
        )}

        {visitedViews.has('search-results') && (
          <div {...viewProps('search-results')}>
            <ErrorBoundary>
              <SearchResultsView onNavigateToResult={handleNavigateToSearchResult} />
            </ErrorBoundary>
          </div>
        )}

        {visitedViews.has('settings') && (
          <div {...viewProps('settings')}>
            <ErrorBoundary>
              <SettingsView />
            </ErrorBoundary>
          </div>
        )}

        {visitedViews.has('ai-settings') && (
          <div {...viewProps('ai-settings')}>
            <ErrorBoundary>
              <AISettingsView />
            </ErrorBoundary>
          </div>
        )}

        {visitedViews.has('calendar') && (
          <div {...viewProps('calendar')}>
            <ErrorBoundary>
              <CalendarView />
            </ErrorBoundary>
          </div>
        )}

        {visitedViews.has('folder-analysis') && (
          <div {...viewProps('folder-analysis')}>
            <ErrorBoundary>
              <FolderAnalysisView onSearchHashtag={handleSearchHashtag} />
            </ErrorBoundary>
          </div>
        )}

        {visitedViews.has('thread') && (
          <div {...viewProps('thread')}>
            <ErrorBoundary>
              <ThreadView />
            </ErrorBoundary>
          </div>
        )}

        {visitedViews.has('browser') && (
          <div {...viewProps('browser')}>
            <ErrorBoundary>
              <div className="flex-1 flex flex-row min-h-0">
                {settings.indexTreeWidth !== 'hidden' && <IndexTreeView />}
                {/* Single-file browsing swaps BrowseView out rather than hiding
                    it: mounting both would give the browsed file two live entry
                    instances — two CodeMirror editors racing to register as the
                    active one, and duplicate DOM ids. The folder listing's scroll
                    position survives the unmount because it is persisted per
                    folder in the store and restored when BrowseView remounts. */}
                <div className="flex-1 flex flex-col min-h-0 min-w-0">
                  {browseFileName ? (
                    <BrowseFile
                    />
                  ) : (
                    <BrowseView
                      lastExportFolder={lastExportFolder}
                      onSetLastExportFolder={setLastExportFolder}
                    />
                  )}
                </div>
              </div>
            </ErrorBoundary>
          </div>
        )}
      </div>

      {error && <AlertDialog scrollable title="Error" message={error} onClose={() => setError(null)} />}
    </>
  );
}

export default App;
