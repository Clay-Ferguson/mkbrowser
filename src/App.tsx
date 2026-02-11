import { useState, useEffect, useCallback, useRef } from 'react';
import { MagnifyingGlassIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon, ArrowPathIcon, ArrowUpIcon, FolderIcon } from '@heroicons/react/24/outline';
import { FolderPlusIcon, DocumentPlusIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from './global';
import FolderEntry from './components/entries/FolderEntry';
import MarkdownEntry from './components/entries/MarkdownEntry';
import FileEntryComponent from './components/entries/FileEntry';
import ImageEntry from './components/entries/ImageEntry';
import TextEntry from './components/entries/TextEntry'; 


import CreateFileDialog from './components/dialogs/CreateFileDialog';
import CreateFolderDialog from './components/dialogs/CreateFolderDialog';
import ErrorDialog from './components/dialogs/ErrorDialog';
import MessageDialog from './components/dialogs/MessageDialog';
import ConfirmDialog from './components/dialogs/ConfirmDialog';
import SearchDialog, { type SearchOptions, type SearchDialogInitialValues } from './components/dialogs/SearchDialog';
import ReplaceDialog from './components/dialogs/ReplaceDialog';
import ExportDialog from './components/dialogs/ExportDialog';
import SearchResultsView from './components/views/SearchResultsView';
import SettingsView from './components/views/SettingsView';
import FolderAnalysisView from './components/views/FolderAnalysisView';
import AppTabButtons from './components/AppTabButtons';
import PathBreadcrumb from './components/PathBreadcrumb';
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
  clearPendingEditFile,
  setHighlightItem,
  setSearchResults,
  setSettings,
  getSettings,
  setBrowserScrollPosition,
  getBrowserScrollPosition,
  toggleBookmark,
  setFolderAnalysis,
  useItems,
  useCurrentView,
  useCurrentPath,
  usePendingScrollToFile,
  usePendingEditFile,
  usePendingEditLineNumber,
  useSettings,
  useExpansionCounts,
  type SearchDefinition,
} from './store';
import { scrollItemIntoView } from './utils/entryDom';
import { pasteCutItems, deleteSelectedItems, moveFileToFolder, performSplitFile, performJoinFiles } from './edit';
import { pasteFromClipboard } from './utils/clipboard';
import { isImageFile, isTextFile, sortEntries } from './utils/fileUtils';
import { loadConfig } from './config';
import { getContentWidthClasses } from './utils/styles';

function App() {
  const [rootPath, setRootPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState<boolean>(false);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showSearchDialog, setShowSearchDialog] = useState<boolean>(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState<boolean>(false);
  const [replaceResultMessage, setReplaceResultMessage] = useState<string | null>(null);
  const [searchDialogInitialValues, setSearchDialogInitialValues] = useState<SearchDialogInitialValues | undefined>(undefined);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);
  const [createFileDefaultName, setCreateFileDefaultName] = useState<string>('');
  const [createFolderDefaultName, setCreateFolderDefaultName] = useState<string>('');
  const items = useItems();
  const currentView = useCurrentView();
  const currentPath = useCurrentPath();
  const pendingScrollToFile = usePendingScrollToFile();
  const pendingEditFile = usePendingEditFile();
  const pendingEditLineNumber = usePendingEditLineNumber();
  const settings = useSettings();
  const expansionCounts = useExpansionCounts();

  // Determine visibility of expand/collapse buttons
  const showExpandAll = expansionCounts.totalCount > 0 && expansionCounts.expandedCount < expansionCounts.totalCount;
  const showCollapseAll = expansionCounts.totalCount > 0 && expansionCounts.collapsedCount < expansionCounts.totalCount;

  // Determine if any items are selected or cut (for Cut/Paste buttons)
  const hasSelectedItems = Array.from(items.values()).some((item) => item.isSelected);
  const hasCutItems = Array.from(items.values()).some((item) => item.isCut);
  const selectedItems = Array.from(items.values()).filter((item) => item.isSelected);
  const selectedFileCount = selectedItems.filter((item) => !item.isDirectory).length;
  const hasSelectedFolders = selectedItems.some((item) => item.isDirectory);

  // Notify main process of selection state changes for menu enablement (Split/Join)
  useEffect(() => {
    window.electronAPI.updateSelectionState(selectedFileCount, hasSelectedFolders);
  }, [selectedFileCount, hasSelectedFolders]);

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
    const initConfig = async () => {
      const result = await loadConfig();
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

  // Listen for Undo Cut menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onUndoCutRequested(() => {
      clearAllCutItems();
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

  // Track previous path to detect folder navigation
  const previousPathRef = useRef<string | null>(null);
  
  // Ref to the main scrollable container for scroll position tracking
  const mainContainerRef = useRef<HTMLElement | null>(null);
  
  // Debounce timer for scroll position saving
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle pending scroll after directory loads, or restore scroll position on folder navigation
  useEffect(() => {
    if (!loading) {
      const isNewFolder = previousPathRef.current !== null && previousPathRef.current !== currentPath;
      
      // Save scroll position for the previous folder before switching
      if (isNewFolder && previousPathRef.current && mainContainerRef.current) {
        setBrowserScrollPosition(previousPathRef.current, mainContainerRef.current.scrollTop);
      }
      
      previousPathRef.current = currentPath;

      // Short timeout just for DOM to settle after React render
      setTimeout(() => {
        if (pendingScrollToFile) {
          // Scroll to specific file (e.g., from search results)
          scrollItemIntoView(pendingScrollToFile);
          clearPendingScrollToFile();
        } else if (isNewFolder) {
          // Restore saved scroll position for this folder, or scroll to top
          const savedPosition = getBrowserScrollPosition(currentPath);
          const mainContainer = mainContainerRef.current;
          if (mainContainer) {
            mainContainer.scrollTo({ top: savedPosition, behavior: 'instant' });
          }
        }

        // Handle pending edit (e.g., from search results edit button)
        if (pendingEditFile) {
          // Capture the line number before clearing (it will be stored in ItemData)
          const lineNumber = pendingEditLineNumber ?? undefined;
          // Start editing the file after a slight delay for the scroll to complete
          setTimeout(() => {
            setItemExpanded(pendingEditFile, true);
            setItemEditing(pendingEditFile, true, lineNumber);
            clearPendingEditFile();
          }, 100);
        }
      }, 100);
    }
  }, [loading, pendingScrollToFile, pendingEditFile, currentPath]);

  // Handle scroll events on the main container (debounced save)
  const handleMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    // Clear any pending save timer
    if (scrollSaveTimerRef.current) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    // Debounce: save scroll position after 150ms of no scrolling
    scrollSaveTimerRef.current = setTimeout(() => {
      if (currentPath) {
        setBrowserScrollPosition(currentPath, e.currentTarget.scrollTop);
      }
    }, 150);
  }, [currentPath]);
  
  // Cleanup scroll save timer on unmount
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
      }
    };
  }, []);

  // Refresh directory without showing loading indicator (used after rename)
  const refreshDirectory = useCallback(() => {
    loadDirectory(false);
  }, [loadDirectory]);

  // Handle delete from entry components - removes the deleted item and refreshes listing
  const handleEntryDelete = useCallback(() => {
    loadDirectory(false);
  }, [loadDirectory]);

  const doPasteCutItems = useCallback(async () => {
    if (!currentPath) return;

    const cutItems = Array.from(items.values()).filter((item) => item.isCut);
    if (cutItems.length === 0) return;

    setError(null);

    const result = await pasteCutItems(
      cutItems,
      currentPath,
      window.electronAPI.pathExists,
      window.electronAPI.renameFile
    );

    if (!result.success) {
      setError(result.error || 'Failed to paste items');
      return;
    }

    // If pasting a single item, scroll to it in the new location
    if (result.pastedItemName) {
      setPendingScrollToFile(result.pastedItemName);
    }

    // Remove old paths for moved items and clear cut state
    const movedPaths = cutItems.map(item => item.path);
    deleteItems(movedPaths);
    clearAllCutItems();
    refreshDirectory();
  }, [currentPath, items, refreshDirectory]);

  // Paste cut items into a specific folder (used by FolderEntry paste buttons)
  const doPasteIntoFolder = useCallback(async (folderPath: string) => {
    const cutItems = Array.from(items.values()).filter((item) => item.isCut);
    if (cutItems.length === 0) return;

    setError(null);

    const result = await pasteCutItems(
      cutItems,
      folderPath,
      window.electronAPI.pathExists,
      window.electronAPI.renameFile
    );

    if (!result.success) {
      setError(result.error || 'Failed to paste items');
      return;
    }

    // Remove old paths for moved items and clear cut state
    const movedPaths = cutItems.map(item => item.path);
    deleteItems(movedPaths);
    clearAllCutItems();
    refreshDirectory();
  }, [items, refreshDirectory]);

  // Listen for Paste menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onPasteRequested(() => {
      void doPasteCutItems();
    });

    return () => {
      unsubscribe();
    };
  }, [doPasteCutItems]);

  // Get selected items for delete operation
  const getSelectedItems = useCallback(() => {
    return Array.from(items.values()).filter((item) => item.isSelected);
  }, [items]);

  // Perform the actual delete of selected items
  const performDelete = useCallback(async () => {
    const selectedItems = getSelectedItems();
    if (selectedItems.length === 0) return;

    setShowDeleteConfirm(false);

    const result = await deleteSelectedItems(selectedItems, window.electronAPI.deleteFile);

    if (!result.success && result.failedItem) {
      setError(`Failed to delete ${result.failedItem}`);
    }

    // Remove successfully deleted items from the store
    if (result.deletedPaths.length > 0) {
      deleteItems(result.deletedPaths);
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

  // Handle "Move to Folder" action - creates a folder with the file's name and moves the file into it
  const handleMoveToFolder = useCallback(async () => {
    if (!currentPath) return;

    const selectedItems = getSelectedItems();

    // Check that exactly one item is selected
    if (selectedItems.length === 0) {
      setError('Please select a file to move to a folder.');
      return;
    }
    if (selectedItems.length > 1) {
      setError('Please select only one file for "Move to Folder".');
      return;
    }

    const selectedItem = selectedItems[0];

    // Check that the selected item is a file, not a folder
    if (selectedItem.isDirectory) {
      setError('Cannot use "Move to Folder" on a folder. Please select a file.');
      return;
    }

    const result = await moveFileToFolder(
      selectedItem.path,
      selectedItem.name,
      currentPath,
      window.electronAPI.pathExists,
      window.electronAPI.createFolder,
      window.electronAPI.renameFile
    );

    if (!result.success) {
      setError(result.error || 'Failed to move file to folder.');
      return;
    }

    // Clear selection and remove the old item from the store
    clearAllSelections();
    deleteItems([selectedItem.path]);

    // Refresh the directory to show the new folder
    refreshDirectory();
  }, [currentPath, getSelectedItems, refreshDirectory]);

  // Listen for Move to Folder menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onMoveToFolderRequested(() => {
      void handleMoveToFolder();
    });

    return () => {
      unsubscribe();
    };
  }, [handleMoveToFolder]);

  // Handle "Split" action - splits a text/markdown file into multiple files using double-blank-line delimiter
  const handleSplitFile = useCallback(async () => {
    if (!currentPath) return;

    const result = await performSplitFile(
      getSelectedItems(),
      window.electronAPI.readFile,
      window.electronAPI.writeFile,
      window.electronAPI.createFile,
      window.electronAPI.renameFile
    );

    if (!result.success) {
      setError(result.error || 'Failed to split file.');
      return;
    }

    // Clear selection and refresh the directory to show new files
    clearAllSelections();
    refreshDirectory();
  }, [currentPath, getSelectedItems, refreshDirectory]);

  // Listen for Split File menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSplitFileRequested(() => {
      void handleSplitFile();
    });

    return () => {
      unsubscribe();
    };
  }, [handleSplitFile]);

  // Handle "Join" action - joins multiple text/markdown files into a single file
  const handleJoinFiles = useCallback(async () => {
    if (!currentPath) return;

    const result = await performJoinFiles(
      getSelectedItems(),
      window.electronAPI.readFile,
      window.electronAPI.writeFile,
      window.electronAPI.deleteFile,
      window.electronAPI.getFileSize
    );

    if (!result.success) {
      setError(result.error || 'Failed to join files.');
      return;
    }

    // Clear selection and refresh the directory
    clearAllSelections();
    refreshDirectory();
  }, [currentPath, getSelectedItems, refreshDirectory]);

  // Listen for Join Files menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onJoinFilesRequested(() => {
      void handleJoinFiles();
    });

    return () => {
      unsubscribe();
    };
  }, [handleJoinFiles]);

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
      setCurrentView('browser');
      setShowExportDialog(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for Replace in Files menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onReplaceInFilesRequested(() => {
      setShowReplaceDialog(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for Folder Analysis menu action
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFolderAnalysisRequested(() => {
      if (!currentPath) return;
      
      // Start the analysis and switch to the view
      void (async () => {
        try {
          const result = await window.electronAPI.analyzeFolderHashtags(currentPath);
          setFolderAnalysis({
            hashtags: result.hashtags,
            folderPath: currentPath,
            totalFiles: result.totalFiles,
          });
          setCurrentView('folder-analysis');
        } catch (err) {
          setError('Failed to analyze folder: ' + (err instanceof Error ? err.message : String(err)));
        }
      })();
    });

    return () => {
      unsubscribe();
    };
  }, [currentPath]);

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
      setSearchResults(results, definition.searchText, currentPath, definition.sortBy || 'modified-time', definition.sortDirection || 'desc');
      setCurrentView('search-results');
    });

    return () => {
      unsubscribe();
    };
  }, [currentPath]);

  // Listen for edit search definition from menu (Ctrl+click) - open SearchDialog with definition pre-filled
  useEffect(() => {
    const unsubscribe = window.electronAPI.onEditSearchDefinition((definition) => {
      setCurrentView('browser');
      // Populate the SearchDialog with the definition's values
      setSearchDialogInitialValues({
        searchQuery: definition.searchText,
        searchName: definition.name,
        searchType: definition.searchMode,
        searchMode: definition.searchTarget,
        searchBlock: definition.searchBlock,
        sortBy: definition.sortBy,
        sortDirection: definition.sortDirection,
      });
      setShowSearchDialog(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for bookmark selection from menu - navigate to the bookmarked item
  useEffect(() => {
    const unsubscribe = window.electronAPI.onOpenBookmark(async (fullPath: string) => {
      // Check if the path exists
      const exists = await window.electronAPI.pathExists(fullPath);
      if (!exists) {
        // Remove the bookmark since it no longer exists
        const currentSettings = getSettings();
        const updatedBookmarks = (currentSettings.bookmarks || []).filter(b => b !== fullPath);
        const updatedSettings = { ...currentSettings, bookmarks: updatedBookmarks };
        setSettings(updatedSettings);
        
        // Persist the updated settings
        try {
          const config = await window.electronAPI.getConfig();
          await window.electronAPI.saveConfig({
            ...config,
            settings: updatedSettings,
          });
        } catch (err) {
          console.error('Failed to save settings after removing bookmark:', err);
        }
        
        const fileName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
        setError(`Bookmark "${fileName}" no longer exists and has been removed.`);
        return;
      }

      // Determine if it's a file or folder by checking if it has a file extension
      // or by trying to read it as a directory
      const fileName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
      
      // Try to read the path as a directory to determine if it's a folder
      try {
        await window.electronAPI.readDirectory(fullPath);
        // It's a folder - navigate directly to it
        setCurrentPath(fullPath);
        setCurrentView('browser');
      } catch {
        // It's a file - navigate to parent folder and highlight the file
        setCurrentPath(parentPath);
        setCurrentView('browser');
        setHighlightItem(fileName);
        setPendingScrollToFile(fileName);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

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
    const result = await window.electronAPI.createFile(filePath, '');
    if (result.success) {
      setShowCreateDialog(false);
      setCreateFileDefaultName('');
      setHighlightItem(fileName);
      setPendingScrollToFile(fileName);
      refreshDirectory();
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
      setError(result.error || 'Failed to create file');
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
    const result = await window.electronAPI.createFolder(folderPath);
    if (result.success) {
      setShowCreateFolderDialog(false);
      setCreateFolderDefaultName('');
      setHighlightItem(folderName);
      setPendingScrollToFile(folderName);
      refreshDirectory();
    } else {
      setShowCreateFolderDialog(false);
      setCreateFolderDefaultName('');
      setError(result.error || 'Failed to create folder');
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
          sortBy: options.sortBy,
          sortDirection: options.sortDirection,
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
    setSearchResults(results, options.query, currentPath, options.sortBy, options.sortDirection);
    setCurrentView('search-results');
  }, [currentPath]);

  const handleCancelSearch = useCallback(() => {
    setShowSearchDialog(false);
    setSearchDialogInitialValues(undefined);
  }, []);

  // Replace in files handlers
  const handleReplace = useCallback(async (searchText: string, replaceText: string) => {
    if (!currentPath) return;
    
    setShowReplaceDialog(false);
    
    try {
      const results = await window.electronAPI.searchAndReplace(currentPath, searchText, replaceText);
      
      // Calculate summary
      const successfulFiles = results.filter(r => r.success);
      const totalReplacements = successfulFiles.reduce((sum, r) => sum + r.replacementCount, 0);
      const failedFiles = results.filter(r => !r.success);
      
      let message = '';
      if (totalReplacements > 0) {
        message = `Replaced ${totalReplacements} occurrence${totalReplacements === 1 ? '' : 's'} in ${successfulFiles.length} file${successfulFiles.length === 1 ? '' : 's'}.`;
      } else {
        message = 'No matches found.';
      }
      
      if (failedFiles.length > 0) {
        message += `\n\n${failedFiles.length} file${failedFiles.length === 1 ? '' : 's'} could not be processed.`;
      }
      
      setReplaceResultMessage(message);
      
      // Refresh the directory to show updated content
      if (totalReplacements > 0) {
        void refreshDirectory();
      }
    } catch (err) {
      setReplaceResultMessage(`Replace failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentPath, refreshDirectory]);

  const handleCancelReplace = useCallback(() => {
    setShowReplaceDialog(false);
  }, []);

  // Save a search definition without executing the search
  const handleSaveSearchDefinition = useCallback(async (options: SearchOptions) => {
    if (!options.searchName) return;
    
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
        sortBy: options.sortBy,
        sortDirection: options.sortDirection,
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

  // Toggle bookmark for current folder
  const handleToggleCurrentFolderBookmark = useCallback(() => {
    if (!currentPath) return;
    toggleBookmark(currentPath);
    void handleSaveSettings();
  }, [currentPath, handleSaveSettings]);

  // Paste from clipboard handler
  const handlePasteFromClipboard = useCallback(async () => {
    if (!currentPath) return;

    const result = await pasteFromClipboard(
      currentPath,
      window.electronAPI.writeFileBinary,
      window.electronAPI.writeFile
    );

    if (result.success && result.fileName) {
      const filePath = `${currentPath}/${result.fileName}`;
      setPendingScrollToFile(result.fileName);
      refreshDirectory();
      // Set expanded after refresh
      setTimeout(() => {
        setItemExpanded(filePath, true);
      }, 200);
    } else if (result.error) {
      setError(result.error);
    }
  }, [currentPath, refreshDirectory]);

  // Navigate to a subdirectory
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  // Navigate up one level
  const navigateUp = useCallback(() => {
    if (currentPath === rootPath) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/'));
    if (parent.length >= rootPath.length) {
      // Get the name of the folder we're leaving (to highlight and scroll to it)
      const currentFolderName = currentPath.substring(currentPath.lastIndexOf('/') + 1);
      setCurrentPath(parent);
      setHighlightItem(currentFolderName);
      setPendingScrollToFile(currentFolderName);
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
          <ErrorDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </div>
    );
  }

  // Handle searching for a hashtag from the folder analysis view
  const handleSearchHashtag = useCallback(async (hashtag: string, ctrlKey: boolean) => {
    if (!currentPath) return;
    
    if (ctrlKey) {
      // Advanced search: $("#hashtag") on file lines
      const advancedQuery = `$("${hashtag}")`;
      const results = await window.electronAPI.searchFolder(currentPath, advancedQuery, 'advanced', 'content', 'file-lines');
      setSearchResults(results, advancedQuery, currentPath, 'modified-time', 'desc');
    } else {
      // Simple literal search
      const results = await window.electronAPI.searchFolder(currentPath, hashtag, 'literal', 'content', 'entire-file');
      setSearchResults(results, hashtag, currentPath, 'modified-time', 'desc');
    }
    setCurrentView('search-results');
  }, [currentPath]);

  // Show search results view when in search-results mode
  if (currentView === 'search-results') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons />
        <SearchResultsView onNavigateToResult={handleNavigateToSearchResult} />
        {error && (
          <ErrorDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </div>
    );
  }

  // Show settings view when in settings mode
  if (currentView === 'settings') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons />
        <SettingsView onSaveSettings={handleSaveSettings} />
        {error && (
          <ErrorDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </div>
    );
  }

  // Show folder analysis view
  if (currentView === 'folder-analysis') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
        <AppTabButtons />
        <FolderAnalysisView onSearchHashtag={handleSearchHashtag} />
        {error && (
          <ErrorDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
      {/* Tab navigation */}
      <AppTabButtons />

      {/* Combined header: breadcrumbs left, actions right, wraps responsively */}
      <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">
        <div data-id="browser-header-breadcrumbs" className="flex items-center gap-3 min-w-0">
          <PathBreadcrumb
            rootPath={rootPath}
            currentPath={currentPath}
            onNavigate={navigateTo}
            isBookmarked={(settings.bookmarks || []).includes(currentPath)}
            onToggleBookmark={handleToggleCurrentFolderBookmark}
          />
        </div>

        <div data-id="browser-header-actions" className="flex-1 flex items-center justify-end gap-1">
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

              {/* Delete button - shown when items are selected and no items are cut */}
              {hasSelectedItems && !hasCutItems && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                  title="Delete selected items"
                >
                  Del
                </button>
              )}

              {/* Paste button - shown when items are cut */}
              {hasCutItems && (
                <button
                  onClick={() => void doPasteCutItems()}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  title="Paste cut items"
                >
                  Paste
                </button>
              )}

              {/* Create file button */}
              <button
                onClick={handleOpenCreateDialog}
                className="p-2 text-blue-400 hover:text-blue-300 hover:bg-slate-700 rounded-lg transition-colors"
                title="Create file"
              >
                <DocumentPlusIcon className="w-5 h-5" />
              </button>

              {/* Create folder button */}
              <button
                onClick={handleOpenCreateFolderDialog}
                className="p-2 text-amber-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Create folder"
              >
                <FolderPlusIcon className="w-5 h-5" />
              </button>

              {/* Paste from clipboard button */}
              <button
                onClick={handlePasteFromClipboard}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Paste from clipboard"
              >
                <ClipboardIcon className="w-5 h-5" />
              </button>

              {/* Search button */}
              <button
                onClick={handleOpenSearchDialog}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="Search in folder"
              >
                <MagnifyingGlassIcon className="w-5 h-5" />
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

              {/* Up level button */}
              <button
                onClick={navigateUp}
                disabled={currentPath === rootPath}
                className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                title="Go up one level"
              >
                <ArrowUpIcon className="w-5 h-5" />
              </button>
        </div>
      </header>

      {/* Main content */}
      <main 
        data-id="browser-main-content"
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        className="flex-1 min-h-0 overflow-y-auto pb-4 pt-1"
      >
        <div className={`${getContentWidthClasses(settings.contentWidth)}`}>
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
                    <FolderEntry entry={entry} onNavigate={navigateTo} onRename={refreshDirectory} onDelete={handleEntryDelete} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} onSaveSettings={handleSaveSettings} onPasteIntoFolder={doPasteIntoFolder} />
                  ) : entry.isMarkdown ? (
                    <MarkdownEntry entry={entry} onRename={refreshDirectory} onDelete={handleEntryDelete} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} onSaveSettings={handleSaveSettings} />
                  ) : isImageFile(entry.name) ? (
                    <ImageEntry entry={entry} allImages={allImages} onRename={refreshDirectory} onDelete={handleEntryDelete} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} onSaveSettings={handleSaveSettings} />
                  ) : isTextFile(entry.name) ? (
                    <TextEntry entry={entry} onRename={refreshDirectory} onDelete={handleEntryDelete} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} onSaveSettings={handleSaveSettings} />
                  ) : (
                    <FileEntryComponent entry={entry} onRename={refreshDirectory} onDelete={handleEntryDelete} onInsertFileBelow={handleOpenCreateFileBelow} onInsertFolderBelow={handleOpenCreateFolderBelow} onSaveSettings={handleSaveSettings} />
                  )}
                </div>
              ));
            })()}
          </div>
        )}
        </div>
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
          onSave={handleSaveSearchDefinition}
          onCancel={handleCancelSearch}
          onDeleteSearchDefinition={handleDeleteSearchDefinition}
          initialValues={searchDialogInitialValues}
          searchDefinitions={settings.searchDefinitions}
        />
      )}

      {showReplaceDialog && (
        <ReplaceDialog
          onReplace={handleReplace}
          onCancel={handleCancelReplace}
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

      {replaceResultMessage && (
        <MessageDialog
          title="Replace Results"
          message={replaceResultMessage}
          onClose={() => setReplaceResultMessage(null)}
        />
      )}

      {error && (
        <ErrorDialog
          message={error}
          onClose={() => setError(null)}
        />
      )}
    </div>
  );
}

export default App;
