import { useState, useEffect, useCallback } from 'react';
import { DocumentPlusIcon, FolderPlusIcon, MagnifyingGlassIcon, ClipboardDocumentIcon, ChevronDownIcon, ChevronUpIcon, ArrowPathIcon, FolderIcon, HomeIcon } from '@heroicons/react/24/outline';
import type { FileEntry } from './global';
import FolderEntry from './components/entries/FolderEntry';
import MarkdownEntry from './components/entries/MarkdownEntry';
import FileEntryComponent from './components/entries/FileEntry';
import ImageEntry from './components/entries/ImageEntry';
import TextEntry from './components/entries/TextEntry';

// Common image file extensions
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']);

function isImageFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return IMAGE_EXTENSIONS.has(ext);
}

function isTextFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.txt');
}
import CreateFileDialog from './components/dialogs/CreateFileDialog';
import CreateFolderDialog from './components/dialogs/CreateFolderDialog';
import AlertDialog from './components/dialogs/AlertDialog';
import ConfirmDialog from './components/dialogs/ConfirmDialog';
import SearchDialog, { type SearchOptions, type SearchDialogInitialValues } from './components/dialogs/SearchDialog';
import ExportDialog from './components/dialogs/ExportDialog';
import SearchResultsView from './components/views/SearchResultsView';
import SettingsView from './components/views/SettingsView';
import {
  clearAllSelections,
  selectItemsByPaths,
  expandAllItems,
  collapseAllItems,
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
  setHighlightItem,
  setSearchResults,
  setSettings,
  getSettings,
  useItems,
  useCurrentView,
  useCurrentPath,
  usePendingScrollToFile,
  useSettings,
  useExpansionCounts,
  type ItemData,
  type SortOrder,
  type SearchDefinition,
} from './store';
import { scrollItemIntoView } from './utils/entryDom';

/**
 * Apply sort comparison based on the selected sort order.
 */
function compareByOrder(a: FileEntry, b: FileEntry, sortOrder: SortOrder): number {
  switch (sortOrder) {
    case 'alphabetical':
      return a.name.localeCompare(b.name);
    case 'created-chron':
      // Older files first (ascending)
      return a.createdTime - b.createdTime;
    case 'created-reverse':
      // Newer files first (descending)
      return b.createdTime - a.createdTime;
    case 'modified-chron':
      // Older modifications first (ascending)
      return a.modifiedTime - b.modifiedTime;
    case 'modified-reverse':
      // More recently modified first (descending)
      return b.modifiedTime - a.modifiedTime;
    default:
      return a.name.localeCompare(b.name);
  }
}

/**
 * Sort entries based on the selected sort order and foldersOnTop preference.
 * When foldersOnTop is true, directories are sorted first, then files.
 * When false, all items are sorted together.
 */
function sortEntries(entries: FileEntry[], sortOrder: SortOrder, foldersOnTop: boolean): FileEntry[] {
  if (foldersOnTop) {
    // Separate folders and files
    const folders = entries.filter(e => e.isDirectory);
    const files = entries.filter(e => !e.isDirectory);

    // Sort each list independently
    folders.sort((a, b) => compareByOrder(a, b, sortOrder));
    files.sort((a, b) => compareByOrder(a, b, sortOrder));

    // Merge: folders first, then files
    return [...folders, ...files];
  } else {
    // Sort all items together
    return [...entries].sort((a, b) => compareByOrder(a, b, sortOrder));
  }
}

type PathBreadcrumbProps = {
  rootPath: string;
  currentPath: string;
  onNavigate: (path: string) => void;
};

function PathBreadcrumb({ rootPath, currentPath, onNavigate }: PathBreadcrumbProps) {
  const normalizedRoot = rootPath.replace(/\/+$/, '');
  const normalizedCurrent = currentPath.replace(/\/+$/, '');
  const relativePath = normalizedCurrent.startsWith(normalizedRoot)
    ? normalizedCurrent.slice(normalizedRoot.length)
    : normalizedCurrent;

  const parts = relativePath
    .split('/')
    .filter(Boolean);

  const buildPathForIndex = (index: number) => {
    if (index < 0) return normalizedRoot;
    const segmentPath = parts.slice(0, index + 1).join('/');
    return `${normalizedRoot}/${segmentPath}`;
  };

  return (
    <div className="flex items-center gap-1 text-sm min-w-0" title={currentPath}>
      <button
        type="button"
        onClick={() => onNavigate(normalizedRoot)}
        className="p-1 text-slate-400 hover:text-blue-400 rounded cursor-pointer"
        aria-label="Go to root folder"
        title={normalizedRoot}
      >
        <HomeIcon className="w-4 h-4" />
      </button>

      {parts.length === 0 && (
        <span className="text-slate-200 font-medium">/</span>
      )}

      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        return (
          <div key={`${part}-${index}`} className="flex items-center min-w-0">
            <span className="text-slate-500 mx-1">/</span>
            {isLast ? (
              <span
                className="text-slate-400 truncate"
                title={buildPathForIndex(index)}
              >
                {part}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(buildPathForIndex(index))}
                className="text-slate-200 hover:text-blue-400 cursor-pointer no-underline truncate"
                title={buildPathForIndex(index)}
              >
                {part}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const [rootPath, setRootPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState<boolean>(false);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showSearchDialog, setShowSearchDialog] = useState<boolean>(false);
  const [searchDialogInitialValues, setSearchDialogInitialValues] = useState<SearchDialogInitialValues | undefined>(undefined);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);
  const [createFileDefaultName, setCreateFileDefaultName] = useState<string>('');
  const [createFolderDefaultName, setCreateFolderDefaultName] = useState<string>('');
  const items = useItems();
  const currentView = useCurrentView();
  const currentPath = useCurrentPath();
  const pendingScrollToFile = usePendingScrollToFile();
  const settings = useSettings();
  const expansionCounts = useExpansionCounts();

  // Determine visibility of expand/collapse buttons
  const showExpandAll = expansionCounts.totalCount > 0 && expansionCounts.expandedCount < expansionCounts.totalCount;
  const showCollapseAll = expansionCounts.totalCount > 0 && expansionCounts.collapsedCount < expansionCounts.totalCount;

  // Determine if any items are selected or cut (for Cut/Paste buttons)
  const hasSelectedItems = Array.from(items.values()).some((item) => item.isSelected);
  const hasCutItems = Array.from(items.values()).some((item) => item.isCut);

  // Apply font size globally via data attribute on html element
  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', settings.fontSize);
  }, [settings.fontSize]);

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
    const loadConfig = async () => {
      try {
        const config = await window.electronAPI.getConfig();
        // Load settings from config into store (only once at startup)
        if (config.settings) {
          setSettings(config.settings);
        }
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
          createdTime: file.createdTime,
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

  // Listen for Select All menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSelectAllRequested(() => {
      // Select all items in the current folder view
      const currentFolderPaths = entries.map((entry) => entry.path);
      selectItemsByPaths(currentFolderPaths);
    });

    return () => {
      unsubscribe();
    };
  }, [entries]);

  // Listen for Unselect All menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onUnselectAllRequested(() => {
      // Unselect all items across all cached data (broader scope for safety)
      clearAllSelections();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Handle renumbering files in the current directory
  const handleRenumberFiles = useCallback(async () => {
    if (!currentPath) return;
    
    setError(null);
    const result = await window.electronAPI.renumberFiles(currentPath);
    
    if (!result.success) {
      setError(result.error || 'Failed to renumber files');
      return;
    }
    
    // Update settings to alphabetical sort order so the numbering is visible
    setSettings({ ...settings, sortOrder: 'alphabetical' });
    
    // Save the updated settings to config
    try {
      const config = await window.electronAPI.getConfig();
      await window.electronAPI.saveConfig({
        ...config,
        settings: { ...settings, sortOrder: 'alphabetical' },
      });
    } catch {
      // Non-critical - settings will still be applied in memory
    }
    
    // Refresh the directory to show the renamed files
    refreshDirectory();
  }, [currentPath, settings, refreshDirectory]);

  // Listen for Re-Number Files menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onRenumberRequested(() => {
      void handleRenumberFiles();
    });

    return () => {
      unsubscribe();
    };
  }, [handleRenumberFiles]);

  // Listen for Export menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onExportRequested(() => {
      setShowExportDialog(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for search definition selection from menu - execute search immediately
  useEffect(() => {
    const unsubscribe = window.electronAPI.onOpenSearchDefinition(async (definition) => {
      if (!currentPath) return;
      
      // Decode {{nl}} tokens back to spaces for actual search execution
      const searchQuery = definition.searchText.replace(/\{\{nl\}\}/g, ' ');
      
      const results = await window.electronAPI.searchFolder(
        currentPath,
        searchQuery,
        definition.searchMode,
        definition.searchTarget,
        definition.searchBlock
      );
      setSearchResults(results, definition.searchText, currentPath);
      setCurrentView('search-results');
    });

    return () => {
      unsubscribe();
    };
  }, [currentPath]);

  // Generate default export filename from current folder name
  const generateExportFileName = useCallback(() => {
    if (!currentPath) return 'export.md';
    const folderName = currentPath.substring(currentPath.lastIndexOf('/') + 1);
    return `${folderName}-export.md`;
  }, [currentPath]);

  // Handle export
  const handleExport = useCallback(async (outputFolder: string, fileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean, exportToPdf: boolean) => {
    if (!currentPath) return;
    
    setShowExportDialog(false);
    setError(null);

    // First, export to markdown
    const result = await window.electronAPI.exportFolderContents(currentPath, outputFolder, fileName, includeSubfolders, includeFilenames, includeDividers);
    
    if (!result.success) {
      setError(result.error || 'Failed to export folder contents');
      return;
    }

    if (exportToPdf && result.outputPath) {
      // Convert to PDF - the markdown file path becomes input, generate PDF path
      const pdfPath = result.outputPath.replace(/\.md$/i, '.pdf');
      const pdfResult = await window.electronAPI.exportToPdf(result.outputPath, pdfPath);
      
      if (!pdfResult.success) {
        setError(pdfResult.error || 'Failed to launch PDF export');
        return;
      }
      // PDF generation happens in external terminal, no file to open here
      // The terminal will show the user the result
    } else {
      // Open the exported markdown file with the system default viewer
      if (result.outputPath) {
        await window.electronAPI.openExternal(result.outputPath);
      }
    }
  }, [currentPath]);

  const handleCancelExport = useCallback(() => {
    setShowExportDialog(false);
  }, []);

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
    setCreateFileDefaultName('');
    setShowCreateDialog(true);
  }, []);

  const handleOpenCreateFileBelow = useCallback((defaultName: string) => {
    setCreateFileDefaultName(defaultName);
    setShowCreateDialog(true);
  }, []);

  const handleCreateFile = useCallback(async (fileName: string) => {
    if (!currentPath) return;
    const filePath = `${currentPath}/${fileName}`;
    const success = await window.electronAPI.writeFile(filePath, '');
    if (success) {
      setShowCreateDialog(false);
      setCreateFileDefaultName('');
      setHighlightItem(fileName);
      setPendingScrollToFile(fileName);
      refreshDirectory();
      // Set editing mode after scroll completes for editable file types
      const isMarkdown = fileName.toLowerCase().endsWith('.md');
      const isText = fileName.toLowerCase().endsWith('.txt');
      if (isMarkdown || isText) {
        setTimeout(() => {
          setItemExpanded(filePath, true);
          setItemEditing(filePath, true);
        }, 200);
      }
    } else {
      setShowCreateDialog(false);
      setCreateFileDefaultName('');
      setError('Failed to create file');
    }
  }, [currentPath, refreshDirectory]);

  const handleCancelCreate = useCallback(() => {
    setShowCreateDialog(false);
    setCreateFileDefaultName('');
  }, []);

  const handleOpenCreateFolderDialog = useCallback(() => {
    setCreateFolderDefaultName('');
    setShowCreateFolderDialog(true);
  }, []);

  const handleOpenCreateFolderBelow = useCallback((defaultName: string) => {
    setCreateFolderDefaultName(defaultName);
    setShowCreateFolderDialog(true);
  }, []);

  const handleCreateFolder = useCallback(async (folderName: string) => {
    if (!currentPath) return;
    const folderPath = `${currentPath}/${folderName}`;
    const success = await window.electronAPI.createFolder(folderPath);
    if (success) {
      setShowCreateFolderDialog(false);
      setCreateFolderDefaultName('');
      setHighlightItem(folderName);
      setPendingScrollToFile(folderName);
      refreshDirectory();
    } else {
      setShowCreateFolderDialog(false);
      setCreateFolderDefaultName('');
      setError('Failed to create folder');
    }
  }, [currentPath, refreshDirectory]);

  const handleCancelCreateFolder = useCallback(() => {
    setShowCreateFolderDialog(false);
    setCreateFolderDefaultName('');
  }, []);

  // Search handlers
  const handleOpenSearchDialog = useCallback(() => {
    setSearchDialogInitialValues(undefined);
    setShowSearchDialog(true);
  }, []);

  const handleNavigateToSearchResult = useCallback((folderPath: string, fileName: string) => {
    navigateToBrowserPath(folderPath, fileName);
  }, []);

  const handleSearch = useCallback(async (options: SearchOptions) => {
    if (!currentPath) return;
    
    // Save search definition if searchName is provided
    if (options.searchName) {
      try {
        const currentSettings = getSettings();
        const config = await window.electronAPI.getConfig();
        
        // Create new search definition
        const newSearchDefinition: SearchDefinition = {
          name: options.searchName,
          searchText: options.query,
          searchTarget: options.searchMode,
          searchMode: options.searchType,
          searchBlock: options.searchBlock,
        };
        
        // Remove any existing search definition with the same name
        const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
          (def) => def.name !== options.searchName
        );
        
        // Add the new search definition
        updatedSearchDefinitions.push(newSearchDefinition);
        
        // Save updated settings
        await window.electronAPI.saveConfig({
          ...config,
          settings: {
            ...currentSettings,
            searchDefinitions: updatedSearchDefinitions,
          },
        });
        
        // Update local settings state
        setSettings({
          ...currentSettings,
          searchDefinitions: updatedSearchDefinitions,
        });
      } catch (err) {
        console.error('Failed to save search definition:', err);
      }
    }
    
    setShowSearchDialog(false);
    
    // Decode {{nl}} tokens back to spaces for actual search execution
    const searchQuery = options.query.replace(/\{\{nl\}\}/g, ' ');
    
    const results = await window.electronAPI.searchFolder(currentPath, searchQuery, options.searchType, options.searchMode, options.searchBlock);
    setSearchResults(results, options.query, currentPath);
    setCurrentView('search-results');
  }, [currentPath]);

  const handleCancelSearch = useCallback(() => {
    setShowSearchDialog(false);
    setSearchDialogInitialValues(undefined);
  }, []);

  // Delete a saved search definition by name
  const handleDeleteSearchDefinition = useCallback(async (name: string) => {
    try {
      const currentSettings = getSettings();
      const config = await window.electronAPI.getConfig();
      
      // Filter out the search definition with the matching name
      const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
        (def) => def.name !== name
      );
      
      // Save updated settings
      await window.electronAPI.saveConfig({
        ...config,
        settings: {
          ...currentSettings,
          searchDefinitions: updatedSearchDefinitions,
        },
      });
      
      // Update local settings state
      setSettings({
        ...currentSettings,
        searchDefinitions: updatedSearchDefinitions,
      });
    } catch (err) {
      console.error('Failed to delete search definition:', err);
    }
  }, []);

  // Save settings to config file
  const handleSaveSettings = useCallback(async () => {
    try {
      const currentSettings = getSettings();
      const config = await window.electronAPI.getConfig();
      await window.electronAPI.saveConfig({
        ...config,
        settings: currentSettings,
      });
    } catch (err) {
      setError('Failed to save settings');
    }
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

  // Show settings view when in settings mode
  if (currentView === 'settings') {
    return (
      <>
        <SettingsView onSaveSettings={handleSaveSettings} />
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
            {/* Breadcrumb / path display */}
            <div className="flex-1 min-w-0">
              <PathBreadcrumb
                rootPath={rootPath}
                currentPath={currentPath}
                onNavigate={navigateTo}
              />
            </div>

            {/* Header action buttons */}
            <div className="flex items-center gap-1">
              {/* Cut button - shown when items are selected and no items are cut */}
              {hasSelectedItems && !hasCutItems && (
                <button
                  onClick={cutSelectedItems}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  title="Cut selected items"
                >
                  Cut
                </button>
              )}

              {/* Paste button - shown when items are cut */}
              {hasCutItems && (
                <button
                  onClick={() => void pasteCutItems()}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  title="Paste cut items"
                >
                  Paste
                </button>
              )}

              {/* Create file button */}
              <button
                onClick={handleOpenCreateDialog}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Create file"
              >
                <DocumentPlusIcon className="w-5 h-5" />
              </button>

              {/* Create folder button */}
              <button
                onClick={handleOpenCreateFolderDialog}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Create folder"
              >
                <FolderPlusIcon className="w-5 h-5" />
              </button>

              {/* Search button */}
              <button
                onClick={handleOpenSearchDialog}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Search in folder"
              >
                <MagnifyingGlassIcon className="w-5 h-5" />
              </button>

              {/* Paste from clipboard button */}
              <button
                onClick={handlePasteFromClipboard}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Paste from clipboard"
              >
                <ClipboardDocumentIcon className="w-5 h-5" />
              </button>

              {/* Expand all button */}
              {showExpandAll && (
                <button
                  onClick={expandAllItems}
                  className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                  title="Expand all"
                >
                  <ChevronDownIcon className="w-5 h-5" />
                </button>
              )}

              {/* Collapse all button */}
              {showCollapseAll && (
                <button
                  onClick={collapseAllItems}
                  className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                  title="Collapse all"
                >
                  <ChevronUpIcon className="w-5 h-5" />
                </button>
              )}

              {/* Refresh button */}
              <button
                onClick={refreshDirectory}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Refresh"
              >
                <ArrowPathIcon className="w-5 h-5" />
              </button>
            </div>
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
            <FolderIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">This folder is empty</p>
          </div>
        )}

        {!loading && entries.filter((entry) => !items.get(entry.path)?.isCut).length > 0 && (
          <div className="space-y-2">
            {(() => {
              const visibleEntries = entries.filter((entry) => !items.get(entry.path)?.isCut);
              const sortedEntries = sortEntries(visibleEntries, settings.sortOrder, settings.foldersOnTop);
              const allImages = sortedEntries.filter((entry) => !entry.isDirectory && isImageFile(entry.name));
              return sortedEntries.map((entry) => (
                <div key={entry.path}>
                  {entry.isDirectory ? (
                    <FolderEntry entry={entry} onNavigate={navigateTo} onRename={refreshDirectory} onDelete={refreshDirectory} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} />
                  ) : entry.isMarkdown ? (
                    <MarkdownEntry entry={entry} onRename={refreshDirectory} onDelete={refreshDirectory} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} />
                  ) : isImageFile(entry.name) ? (
                    <ImageEntry entry={entry} allImages={allImages} onRename={refreshDirectory} onDelete={refreshDirectory} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} />
                  ) : isTextFile(entry.name) ? (
                    <TextEntry entry={entry} onRename={refreshDirectory} onDelete={refreshDirectory} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} />
                  ) : (
                    <FileEntryComponent entry={entry} onRename={refreshDirectory} onDelete={refreshDirectory} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} />
                  )}
                </div>
              ));
            })()}
          </div>
        )}
      </main>

      {showCreateDialog && (
        <CreateFileDialog
          defaultName={createFileDefaultName}
          onCreate={handleCreateFile}
          onCancel={handleCancelCreate}
        />
      )}

      {showCreateFolderDialog && (
        <CreateFolderDialog
          defaultName={createFolderDefaultName}
          onCreate={handleCreateFolder}
          onCancel={handleCancelCreateFolder}
        />
      )}

      {showSearchDialog && (
        <SearchDialog
          onSearch={handleSearch}
          onCancel={handleCancelSearch}
          onDeleteSearchDefinition={handleDeleteSearchDefinition}
          initialValues={searchDialogInitialValues}
          searchDefinitions={settings.searchDefinitions}
        />
      )}

      {showExportDialog && currentPath && (
        <ExportDialog
          defaultFolder={currentPath}
          defaultFileName={generateExportFileName()}
          onExport={handleExport}
          onCancel={handleCancelExport}
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
