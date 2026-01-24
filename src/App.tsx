import { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from './global';
import FolderEntry from './components/FolderEntry';
import MarkdownEntry from './components/MarkdownEntry';
import FileEntryComponent from './components/FileEntry';
import ImageEntry from './components/ImageEntry';

// Common image file extensions
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']);

function isImageFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return IMAGE_EXTENSIONS.has(ext);
}
import CreateFileDialog from './components/CreateFileDialog';
import CreateFolderDialog from './components/CreateFolderDialog';
import AlertDialog from './components/AlertDialog';
import ConfirmDialog from './components/ConfirmDialog';
import SearchDialog from './components/SearchDialog';
import SearchResultsView from './components/SearchResultsView';
import {
  clearAllSelections,
  clearAllCutItems,
  cutSelectedItems,
  deleteItems,
  upsertItems,
  setItemEditing,
  setItemExpanded,
  setCurrentView,
  setCurrentPath,
  navigateToBrowserPath,
  clearPendingScrollToFile,
  setPendingScrollToFile,
  setSearchResults,
  useItems,
  useCurrentView,
  useCurrentPath,
  usePendingScrollToFile,
  type ItemData,
} from './store';
import { scrollItemIntoView } from './utils/entryDom';

function App() {
  const [rootPath, setRootPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState<boolean>(false);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showSearchDialog, setShowSearchDialog] = useState<boolean>(false);
  const items = useItems();
  const currentView = useCurrentView();
  const currentPath = useCurrentPath();
  const pendingScrollToFile = usePendingScrollToFile();

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

  // Listen for Cut menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onCutRequested(() => {
      cutSelectedItems();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for View menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onViewChanged((view) => {
      setCurrentView(view);
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

  // Handle pending scroll after directory loads
  useEffect(() => {
    if (!loading && pendingScrollToFile) {
      // Short timeout just for DOM to settle after React render
      setTimeout(() => {
        scrollItemIntoView(pendingScrollToFile);
        clearPendingScrollToFile();
      }, 100);
    }
  }, [loading, pendingScrollToFile]);

  // Refresh directory without showing loading indicator (used after rename)
  const refreshDirectory = useCallback(() => {
    loadDirectory(false);
  }, [loadDirectory]);

  const findPasteDuplicates = useCallback(async (cutItems: ItemData[]) => {
    if (!currentPath) return [] as string[];

    const duplicateNames = await Promise.all(
      cutItems.map(async (item) => {
        const destinationPath = `${currentPath}/${item.name}`;
        const exists = await window.electronAPI.pathExists(destinationPath);
        return exists ? item.name : null;
      })
    );

    return duplicateNames.filter((name): name is string => Boolean(name));
  }, [currentPath]);

  const findCutItemsFromDifferentFolders = useCallback((cutItems: ItemData[]) => {
    if (cutItems.length === 0) return [] as string[];

    const getParentPath = (path: string) => path.substring(0, path.lastIndexOf('/'));
    const baseFolder = getParentPath(cutItems[0].path);

    return cutItems
      .filter((item) => getParentPath(item.path) !== baseFolder)
      .map((item) => item.name);
  }, []);

  const pasteCutItems = useCallback(async () => {
    if (!currentPath) return;

    const cutItems = Array.from(items.values()).filter((item) => item.isCut);
    if (cutItems.length === 0) return;

    setError(null);

    const getParentPath = (path: string) => path.substring(0, path.lastIndexOf('/'));
    const sourceFolder = getParentPath(cutItems[0].path);
    if (sourceFolder === currentPath) {
      setError('Cannot paste. Cut items are already in this folder.');
      return;
    }

    const crossFolderItems = findCutItemsFromDifferentFolders(cutItems);
    if (crossFolderItems.length > 0) {
      setError(`Cannot paste. Cut items must come from the same folder: ${crossFolderItems.join(', ')}`);
      return;
    }

    const duplicates = await findPasteDuplicates(cutItems);
    if (duplicates.length > 0) {
      setError(`Cannot paste. These items already exist: ${duplicates.join(', ')}`);
      return;
    }

    for (const item of cutItems) {
      const destinationPath = `${currentPath}/${item.name}`;
      const success = await window.electronAPI.renameFile(item.path, destinationPath);
      if (!success) {
        setError(`Failed to move ${item.name}`);
        return;
      }
    }

    clearAllCutItems();
    refreshDirectory();
  }, [currentPath, items, refreshDirectory, findPasteDuplicates, findCutItemsFromDifferentFolders]);

  // Listen for Paste menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onPasteRequested(() => {
      void pasteCutItems();
    });

    return () => {
      unsubscribe();
    };
  }, [pasteCutItems]);

  // Get selected items for delete operation
  const getSelectedItems = useCallback(() => {
    return Array.from(items.values()).filter((item) => item.isSelected);
  }, [items]);

  // Perform the actual delete of selected items
  const performDelete = useCallback(async () => {
    const selectedItems = getSelectedItems();
    if (selectedItems.length === 0) return;

    setShowDeleteConfirm(false);

    // Delete each selected item from the filesystem
    const pathsToDelete: string[] = [];
    for (const item of selectedItems) {
      const success = await window.electronAPI.deleteFile(item.path);
      if (success) {
        pathsToDelete.push(item.path);
      } else {
        setError(`Failed to delete ${item.name}`);
      }
    }

    // Remove successfully deleted items from the store
    if (pathsToDelete.length > 0) {
      deleteItems(pathsToDelete);
      refreshDirectory();
    }
  }, [getSelectedItems, refreshDirectory]);

  // Listen for Delete menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onDeleteRequested(() => {
      const selectedItems = getSelectedItems();
      if (selectedItems.length > 0) {
        setShowDeleteConfirm(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [getSelectedItems]);

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
      setPendingScrollToFile(fileName);
      refreshDirectory();
      // Set editing mode after scroll completes
      const isMarkdown = fileName.toLowerCase().endsWith('.md');
      if (isMarkdown) {
        setTimeout(() => {
          setItemExpanded(filePath, true);
          setItemEditing(filePath, true);
        }, 200);
      }
    } else {
      setShowCreateDialog(false);
      setError('Failed to create file');
    }
  }, [currentPath, refreshDirectory]);

  const handleCancelCreate = useCallback(() => {
    setShowCreateDialog(false);
  }, []);

  const handleOpenCreateFolderDialog = useCallback(() => {
    setShowCreateFolderDialog(true);
  }, []);

  const handleCreateFolder = useCallback(async (folderName: string) => {
    if (!currentPath) return;
    const folderPath = `${currentPath}/${folderName}`;
    const success = await window.electronAPI.createFolder(folderPath);
    if (success) {
      setShowCreateFolderDialog(false);
      setPendingScrollToFile(folderName);
      refreshDirectory();
    } else {
      setShowCreateFolderDialog(false);
      setError('Failed to create folder');
    }
  }, [currentPath, refreshDirectory]);

  const handleCancelCreateFolder = useCallback(() => {
    setShowCreateFolderDialog(false);
  }, []);

  // Search handlers
  const handleOpenSearchDialog = useCallback(() => {
    setShowSearchDialog(true);
  }, []);

  const handleNavigateToSearchResult = useCallback((folderPath: string, fileName: string) => {
    navigateToBrowserPath(folderPath, fileName);
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (!currentPath) return;
    setShowSearchDialog(false);
    
    const results = await window.electronAPI.searchFolder(currentPath, query);
    setSearchResults(results, query, currentPath);
    setCurrentView('search-results');
  }, [currentPath]);

  const handleCancelSearch = useCallback(() => {
    setShowSearchDialog(false);
  }, []);

  // Generate timestamp-based filename
  const generateTimestampFilename = useCallback((extension: string) => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `${timestamp}${extension}`;
  }, []);

  // Paste from clipboard handler
  const handlePasteFromClipboard = useCallback(async () => {
    if (!currentPath) return;

    try {
      // Try to read clipboard items (modern Clipboard API)
      const clipboardItems = await navigator.clipboard.read();
      
      for (const item of clipboardItems) {
        // Check for image types first
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          
          // Determine extension from MIME type (clipboard images are typically PNG)
          let ext = '.png';
          if (imageType === 'image/jpeg') ext = '.jpg';
          else if (imageType === 'image/gif') ext = '.gif';
          else if (imageType === 'image/webp') ext = '.webp';
          
          const fileName = generateTimestampFilename(ext);
          const filePath = `${currentPath}/${fileName}`;
          
          const success = await window.electronAPI.writeFileBinary(filePath, base64);
          if (success) {
            setPendingScrollToFile(fileName);
            refreshDirectory();
            // Set expanded after refresh
            setTimeout(() => {
              setItemExpanded(filePath, true);
            }, 200);
          } else {
            setError('Failed to paste image from clipboard');
          }
          return;
        }
        
        // Check for text
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          
          const fileName = generateTimestampFilename('.md');
          const filePath = `${currentPath}/${fileName}`;
          
          const success = await window.electronAPI.writeFile(filePath, text);
          if (success) {
            setPendingScrollToFile(fileName);
            refreshDirectory();
            // Set expanded after refresh
            setTimeout(() => {
              setItemExpanded(filePath, true);
            }, 200);
          } else {
            setError('Failed to paste text from clipboard');
          }
          return;
        }
      }
      
      setError('Clipboard is empty or contains unsupported content');
    } catch (err) {
      // Fallback to older clipboard API for text
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const fileName = generateTimestampFilename('.md');
          const filePath = `${currentPath}/${fileName}`;
          
          const success = await window.electronAPI.writeFile(filePath, text);
          if (success) {
            setPendingScrollToFile(fileName);
            refreshDirectory();
            setTimeout(() => {
              setItemExpanded(filePath, true);
            }, 200);
          } else {
            setError('Failed to paste text from clipboard');
          }
        } else {
          setError('Clipboard is empty');
        }
      } catch {
        setError('Unable to read clipboard. Please ensure clipboard access is allowed.');
      }
    }
  }, [currentPath, generateTimestampFilename, refreshDirectory]);

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

        {error && (
          <AlertDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </div>
    );
  }

  // Show search results view when in search-results mode
  if (currentView === 'search-results') {
    return (
      <>
        <SearchResultsView onNavigateToResult={handleNavigateToSearchResult} />
        {error && (
          <AlertDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </>
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

            {/* Create folder button */}
            <button
              onClick={handleOpenCreateFolderDialog}
              className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
              title="Create folder"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </button>

            {/* Search button */}
            <button
              onClick={handleOpenSearchDialog}
              className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
              title="Search in folder"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>

            {/* Paste from clipboard button */}
            <button
              onClick={handlePasteFromClipboard}
              className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
              title="Paste from clipboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
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

        {!loading && entries.filter((entry) => !items.get(entry.path)?.isCut).length === 0 && (
          <div className="text-center py-12">
            <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-slate-400">This folder is empty</p>
          </div>
        )}

        {!loading && entries.filter((entry) => !items.get(entry.path)?.isCut).length > 0 && (
          <div className="space-y-2">
            {(() => {
              const visibleEntries = entries.filter((entry) => !items.get(entry.path)?.isCut);
              const allImages = visibleEntries.filter((entry) => !entry.isDirectory && isImageFile(entry.name));
              return visibleEntries.map((entry) => (
                <div key={entry.path}>
                  {entry.isDirectory ? (
                    <FolderEntry entry={entry} onNavigate={navigateTo} onRename={refreshDirectory} onDelete={refreshDirectory} />
                  ) : entry.isMarkdown ? (
                    <MarkdownEntry entry={entry} onRename={refreshDirectory} onDelete={refreshDirectory} />
                  ) : isImageFile(entry.name) ? (
                    <ImageEntry entry={entry} allImages={allImages} onRename={refreshDirectory} onDelete={refreshDirectory} />
                  ) : (
                    <FileEntryComponent entry={entry} onRename={refreshDirectory} onDelete={refreshDirectory} />
                  )}
                </div>
              ));
            })()}
          </div>
        )}
      </main>

      {showCreateDialog && (
        <CreateFileDialog
          onCreate={handleCreateFile}
          onCancel={handleCancelCreate}
        />
      )}

      {showCreateFolderDialog && (
        <CreateFolderDialog
          onCreate={handleCreateFolder}
          onCancel={handleCancelCreateFolder}
        />
      )}

      {showSearchDialog && (
        <SearchDialog
          onSearch={handleSearch}
          onCancel={handleCancelSearch}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete ${getSelectedItems().length} selected item(s)? This cannot be undone.`}
          onConfirm={() => void performDelete()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {error && (
        <AlertDialog
          message={error}
          onClose={() => setError(null)}
        />
      )}
    </div>
  );
}

export default App;
