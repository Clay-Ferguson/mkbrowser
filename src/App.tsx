import { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from './global';
import FolderEntry from './components/FolderEntry';
import MarkdownEntry from './components/MarkdownEntry';
import FileEntryComponent from './components/FileEntry';
import CreateFileDialog from './components/CreateFileDialog';
import { clearAllSelections, upsertItems, setItemEditing, setItemExpanded } from './store';
import { scrollItemIntoView } from './utils/entryDom';

function App() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [rootPath, setRootPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState<boolean>(false);

  // Load initial configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await window.electronAPI.getConfig();
        if (config.browseFolder) {
          const exists = await window.electronAPI.pathExists(config.browseFolder);
          if (exists) {
            setRootPath(config.browseFolder);
            setCurrentPath(config.browseFolder);
          } else {
            setLoading(false);
          }
        } else {
          setLoading(false);
        }
      } catch (err) {
        setError('Failed to load configuration');
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  // Listen for folder changes from the application menu
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFolderSelected((folderPath) => {
      setRootPath(folderPath);
      setCurrentPath(folderPath);
      setError(null);
    });

    return () => {
      unsubscribe();
    };
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
        }))
      );
    } catch (err) {
      setError('Failed to read directory');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  // Load directory when path changes
  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  // Clear selection whenever navigating to a different folder
  useEffect(() => {
    if (currentPath) {
      clearAllSelections();
    }
  }, [currentPath]);

  // Refresh directory without showing loading indicator (used after rename)
  const refreshDirectory = useCallback(() => {
    loadDirectory(false);
  }, [loadDirectory]);

  // Handle folder selection
  const handleSelectFolder = useCallback(async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      await window.electronAPI.saveConfig({ browseFolder: folder });
      setRootPath(folder);
      setCurrentPath(folder);
    }
  }, []);

  const handleOpenCreateDialog = useCallback(() => {
    setShowCreateDialog(true);
  }, []);

  const handleCreateFile = useCallback(async (fileName: string) => {
    if (!currentPath) return;
    const filePath = `${currentPath}/${fileName}`;
    const success = await window.electronAPI.writeFile(filePath, '');
    if (success) {
      setShowCreateDialog(false);
      refreshDirectory();
      setTimeout(() => {
        scrollItemIntoView(fileName);
        const isMarkdown = fileName.toLowerCase().endsWith('.md');
        if (isMarkdown) {
          setItemExpanded(filePath, true);
          setItemEditing(filePath, true);
        }
      }, 1500);
    } else {
      setShowCreateDialog(false);
      setError('Failed to create file');
    }
  }, [currentPath, refreshDirectory]);

  const handleCancelCreate = useCallback(() => {
    setShowCreateDialog(false);
  }, []);

  // Navigate to a subdirectory
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  // Navigate up one level
  const navigateUp = useCallback(() => {
    if (currentPath === rootPath) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/'));
    if (parent.length >= rootPath.length) {
      setCurrentPath(parent);
    }
  }, [currentPath, rootPath]);

  // Get relative path for breadcrumb display
  const getRelativePath = () => {
    if (!rootPath || !currentPath) return '';
    if (currentPath === rootPath) return '/';
    return currentPath.substring(rootPath.length) || '/';
  };

  // Folder selection prompt (first run or no folder configured)
  if (!currentPath && !loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-slate-800 rounded-lg shadow-lg p-8 max-w-md w-full text-center border border-slate-700">
          <div className="mb-6">
            <svg className="w-16 h-16 mx-auto text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-slate-100 mb-2">Welcome to MkBrowser</h1>
          <p className="text-slate-400 mb-6">
            Select a folder to start browsing your Markdown files.
          </p>
          <button
            onClick={handleSelectFolder}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Select Folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header with navigation */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Back button */}
            <button
              onClick={navigateUp}
              disabled={currentPath === rootPath}
              className={`p-2 rounded-lg transition-colors ${
                currentPath === rootPath
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:bg-slate-700'
              }`}
              title="Go up"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Breadcrumb / path display */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 truncate" title={rootPath}>
                  {rootPath.split('/').pop()}
                </span>
                <span className="text-slate-200 font-medium truncate">
                  {getRelativePath()}
                </span>
              </div>
            </div>

            {/* Create file button */}
            <button
              onClick={handleOpenCreateDialog}
              className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
              title="Create file"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400">Loading...</div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="text-center py-12">
            <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-slate-400">This folder is empty</p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.path}>
                {entry.isDirectory ? (
                  <FolderEntry entry={entry} onNavigate={navigateTo} onRename={refreshDirectory} onDelete={refreshDirectory} />
                ) : entry.isMarkdown ? (
                  <MarkdownEntry entry={entry} onRename={refreshDirectory} onDelete={refreshDirectory} />
                ) : (
                  <FileEntryComponent entry={entry} onRename={refreshDirectory} onDelete={refreshDirectory} />
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {showCreateDialog && (
        <CreateFileDialog
          onCreate={handleCreateFile}
          onCancel={handleCancelCreate}
        />
      )}
    </div>
  );
}

export default App;
