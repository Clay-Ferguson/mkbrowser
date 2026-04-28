import { useState, useEffect, useCallback } from 'react';
import { FolderIcon } from '@heroicons/react/24/outline';
import type { FileEntry } from './global';
import ErrorDialog from './components/dialogs/ErrorDialog';
import SearchResultsView from './components/views/SearchResultsView';
import SettingsView from './components/views/SettingsView';
import FolderAnalysisView from './components/views/FolderAnalysisView';
import AISettingsView from './components/views/AISettingsView';
import ThreadView from './components/views/ThreadView';
import BrowseView from './components/views/BrowseView';
import IndexTree from './components/views/IndexTree';
import AppTabButtons from './components/AppTabButtons';
import {
  upsertItems,
  clearAllSelections,
  setSearchResults,
  getSettings,
  setCurrentView,
  setCurrentPath,
  navigateToBrowserPath,
  setRootPath,
  useRootPath,
  useItems,
  useCurrentView,
  useCurrentPath,
  useSettings,
  getIndexTreeRoot,
  setIndexTreeRoot,
  getEditingItem,
  setItemEditing,
} from './store';
import type { TreeNode } from './store';
import { loadConfig } from './config';

async function refreshExpandedNodes(node: TreeNode): Promise<TreeNode> {
  if (!node.isDirectory || !node.isExpanded) return node;
  try {
    const entries = await window.electronAPI.readDirectory(node.path);
    const oldByPath = new Map((node.children ?? []).map(c => [c.path, c]));
    const newChildren: TreeNode[] = [...entries]
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      })
      .map(e => oldByPath.get(e.path) ?? {
        path: e.path,
        name: e.name,
        isDirectory: e.isDirectory,
        isExpanded: false,
        isLoading: false,
        children: null,
      });
    const refreshedChildren = await Promise.all(newChildren.map(refreshExpandedNodes));
    return { ...node, children: refreshedChildren, isLoading: false };
  } catch {
    return node;
  }
}

function App() {
  const rootPath = useRootPath();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [lastExportFolder, setLastExportFolder] = useState<string>('');
  const items = useItems();
  const currentView = useCurrentView();
  const currentPath = useCurrentPath();
  const settings = useSettings();

  // Apply font size globally via data attribute on html element
  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', settings.fontSize);
  }, [settings.fontSize]);

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
      window.electronAPI.setWindowTitle(`MkBrowser: ${rootPath}`);
    } else {
      window.electronAPI.setWindowTitle('MkBrowser');
    }
  }, [rootPath]);

  // Load initial configuration
  useEffect(() => {
    const initConfig = async () => {
      const result = await loadConfig();
      setLastExportFolder(result.lastExportFolder);
      setAiEnabled(result.aiEnabled);
      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else if (result.rootPath) {
        setRootPath(result.rootPath);
      } else {
        setLoading(false);
      }
    };
    initConfig();
  }, []);

  // Load directory contents
  const loadDirectory = useCallback(async (showLoading = true) => {
    if (!currentPath) return;

    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const files = await window.electronAPI.readDirectory(currentPath);
      setEntries(files);

      // Update global store with all items from this directory
      upsertItems(
        files.map((file) => ({
          path: file.path,
          name: file.name,
          isDirectory: file.isDirectory,
          modifiedTime: file.modifiedTime,
          createdTime: file.createdTime,
          aiHint: file.aiHint,
        }))
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to read directory';
      if (errorMessage.includes('does not exist')) {
        setError('This folder no longer exists');
      } else {
        setError('Failed to read directory');
      }
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  // Load directory when path changes
  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  // Remove entries that were deleted from the store (e.g. via SearchResultsView)
  useEffect(() => {
    setEntries(prev => {
      const filtered = prev.filter(entry => items.has(entry.path));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [items]);

  // Clear selection whenever navigating to a different folder
  useEffect(() => {
    if (currentPath) {
      clearAllSelections();
    }
  }, [currentPath]);

  // Persist current subfolder to config whenever navigation changes
  useEffect(() => {
    if (!currentPath || !rootPath) return;
    const saveCurSubFolder = async () => {
      try {
        const config = await window.electronAPI.getConfig();
        const curSubFolder = currentPath === rootPath ? undefined : currentPath;
        if (config.curSubFolder !== curSubFolder) {
          await window.electronAPI.saveConfig({ ...config, curSubFolder });
        }
      } catch {
        // Non-critical — config will be updated on next navigation
      }
    };
    saveCurSubFolder();
  }, [currentPath, rootPath]);

  const refreshDirectory = useCallback(() => {
    loadDirectory(false);
    const root = getIndexTreeRoot();
    if (root) {
      refreshExpandedNodes(root).then(newRoot => setIndexTreeRoot(newRoot));
    }
  }, [loadDirectory]);

  const handleSelectFolder = useCallback(async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      const config = await window.electronAPI.getConfig();
      await window.electronAPI.saveConfig({ ...config, browseFolder: folder, curSubFolder: undefined });
      setRootPath(folder);
      setCurrentPath(folder);
    }
  }, []);

  const handleQuit = useCallback(() => {
    void window.electronAPI.quit();
  }, []);

  const handleNavigateToSearchResult = useCallback((folderPath: string, resultPath: string) => {
    navigateToBrowserPath(folderPath, resultPath);
  }, []);

  const handleSearchHashtag = useCallback(async (hashtag: string, ctrlKey: boolean) => {
    if (!currentPath) return;

    if (ctrlKey) {
      const advancedQuery = `$("${hashtag}")`;
      const results = await window.electronAPI.searchFolder(currentPath, advancedQuery, 'advanced', 'content', 'file-lines');
      setSearchResults(results, advancedQuery, currentPath, 'modified-time', 'desc');
    } else {
      const results = await window.electronAPI.searchFolder(currentPath, hashtag, 'literal', 'content', 'entire-file');
      setSearchResults(results, hashtag, currentPath, 'modified-time', 'desc');
    }
    setCurrentView('search-results');
  }, [currentPath]);

  const handleSaveSettings = useCallback(async () => {
    try {
      const currentSettings = getSettings();
      const config = await window.electronAPI.getConfig();
      await window.electronAPI.saveConfig({
        ...config,
        settings: currentSettings,
      });
    } catch {
      setError('Failed to save settings');
    }
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
            onClick={handleSelectFolder}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
            data-testid="select-folder-button"
          >
            Select Folder
          </button>
        </div>

        {error && (
          <ErrorDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </div>
    );
  }

  if (currentView === 'search-results') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons entries={entries} onSelectFolder={handleSelectFolder} onQuit={handleQuit} />
        <SearchResultsView onNavigateToResult={handleNavigateToSearchResult} />
        {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
      </div>
    );
  }

  if (currentView === 'settings') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons entries={entries} onSelectFolder={handleSelectFolder} onQuit={handleQuit} />
        <SettingsView onSaveSettings={handleSaveSettings} />
        {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
      </div>
    );
  }

  if (currentView === 'ai-settings') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons entries={entries} onSelectFolder={handleSelectFolder} onQuit={handleQuit} />
        <AISettingsView />
        {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
      </div>
    );
  }

  if (currentView === 'folder-analysis') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons entries={entries} onSelectFolder={handleSelectFolder} onQuit={handleQuit} />
        <FolderAnalysisView onSearchHashtag={handleSearchHashtag} />
        {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
      </div>
    );
  }

  if (currentView === 'thread') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons entries={entries} onSelectFolder={handleSelectFolder} onQuit={handleQuit} />
        <ThreadView onSaveSettings={handleSaveSettings} />
        {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
      <AppTabButtons entries={entries} onSelectFolder={handleSelectFolder} onQuit={handleQuit} />
      <div className="flex-1 flex flex-row min-h-0">
        {settings.indexTreeWidth !== 'hidden' && <IndexTree />}
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
      {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
}

export default App;
