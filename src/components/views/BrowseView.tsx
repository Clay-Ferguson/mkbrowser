import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  MagnifyingGlassIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon,
  ArrowPathIcon, FolderIcon, WrenchIcon, Squares2X2Icon, BarsArrowDownIcon,
  FolderPlusIcon, DocumentPlusIcon,
} from '@heroicons/react/24/outline';
import IndexInsertBar from '../IndexInsertBar';
import type { FileEntry } from '../../global';
import FolderEntry from '../entries/FolderEntry';
import MarkdownEntry from '../entries/MarkdownEntry';
import FileEntryComponent from '../entries/FileEntry';
import ImageEntry from '../entries/ImageEntry';
import TextEntry from '../entries/TextEntry';
import ToolsPopupMenu from '../menus/ToolsPopupMenu';
import EditPopupMenu from '../menus/EditPopupMenu';
import SearchPopupMenu from '../menus/SearchPopupMenu';
import SortPopupMenu from '../menus/SortPopupMenu';
import CreateFileDialog from '../dialogs/CreateFileDialog';
import CreateFolderDialog from '../dialogs/CreateFolderDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import SearchDialog, { type SearchOptions, type SearchDialogInitialValues } from '../dialogs/SearchDialog';
import ReplaceDialog from '../dialogs/ReplaceDialog';
import ExportDialog from '../dialogs/ExportDialog';
import MessageDialog from '../dialogs/MessageDialog';
import PathBreadcrumb from '../PathBreadcrumb';
import {
  clearAllSelections,
  selectItemsByPaths,
  expandAllItems,
  collapseAllItems,
  clearAllCutItems,
  cutSelectedItems,
  setItemEditing,
  setItemExpanded,
  setCurrentView,
  setCurrentPath,
  navigateToBrowserPath,
  clearPendingScrollToFile,
  clearPendingEditFile,
  setPendingEditFile,
  setSearchResults,
  setSortOrder,
  setBrowserScrollPosition,
  getBrowserScrollPosition,
  setFolderAnalysis,
  setHasIndexFile,
  useRootPath,
  useItems,
  useCurrentView,
  useCurrentPath,
  usePendingScrollToFile,
  usePendingEditFile,
  usePendingEditLineNumber,
  usePendingEditView,
  usePendingScrollToHeadingSlug,
  clearPendingScrollToHeadingSlug,
  useSettings,
  useExpansionCounts,
  useHasIndexFile,
  setIndexYaml,
  useIndexYaml,
  useExpandedEditor,
  type SearchDefinition,
} from '../../store';
import { scrollItemIntoView, scrollElementIntoView } from '../../utils/entryDom';
import { isImageFile, isTextFile, sortEntries } from '../../utils/fileUtils';
import { getContentWidthClasses } from '../../utils/styles';
import { hasHumanMd } from '../../ai/aiPatterns';
import { saveSearchDefinitionToConfig, deleteSearchDefinitionFromConfig, buildReplaceResultMessage } from '../../utils/searchUtils';
import { pasteIntoFolder, deleteSelected, moveSelectedToFolder, splitSelectedFile, joinSelectedFiles, createFileOp, createFolderOp, pasteFromClipboardOp } from '../../utils/fileOpsUtils';


interface BrowseViewProps {
  entries: FileEntry[];
  loading: boolean;
  aiEnabled: boolean;
  lastExportFolder: string;
  onSetLastExportFolder: (folder: string) => void;
  onRefreshDirectory: () => void;
  onSetError: (error: string | null) => void;
  onSaveSettings: () => void;
}

function BrowseView({ entries, loading, aiEnabled, lastExportFolder, onSetLastExportFolder, onRefreshDirectory, onSetError, onSaveSettings }: BrowseViewProps) {
  const rootPath = useRootPath();
  const [showCreateDialog, setShowCreateDialog] = useState<boolean>(false);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showSearchDialog, setShowSearchDialog] = useState<boolean>(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState<boolean>(false);
  const [replaceResultMessage, setReplaceResultMessage] = useState<string | null>(null);
  const [searchDialogInitialValues, setSearchDialogInitialValues] = useState<SearchDialogInitialValues | undefined>(undefined);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);
  const [showToolsMenu, setShowToolsMenu] = useState<boolean>(false);
  const [showEditMenu, setShowEditMenu] = useState<boolean>(false);
  const [showSearchMenu, setShowSearchMenu] = useState<boolean>(false);
  const [showSortMenu, setShowSortMenu] = useState<boolean>(false);
  const [createFileDefaultName, setCreateFileDefaultName] = useState<string>('');
  const [createFolderDefaultName, setCreateFolderDefaultName] = useState<string>('');
  const [insertAtIndex, setInsertAtIndex] = useState<number | null>(null);

  const hasIndexFile = useHasIndexFile();
  const indexYaml = useIndexYaml();
  const editMode = indexYaml?.options?.edit_mode ?? false;
  const expandedEditor = useExpandedEditor();

  const items = useItems();
  const currentView = useCurrentView();
  const currentPath = useCurrentPath();

  // Detect whether the current folder uses index ordering, and load the yaml into the store
  useEffect(() => {
    const hasIndex = entries.some((e) => e.indexOrder !== undefined);
    setHasIndexFile(hasIndex);
    if (hasIndex && currentPath) {
      void window.electronAPI.readIndexYaml(currentPath).then((yaml) => {
        setIndexYaml(yaml);
      });
    } else {
      setIndexYaml(null);
    }
  }, [entries, currentPath]);

  // Reconcile on folder navigation only (not on every file-operation refresh)
  useEffect(() => {
    if (!currentPath) return;
    void window.electronAPI.reconcileIndexedFiles(currentPath, false);
  }, [currentPath]);
  const pendingScrollToFile = usePendingScrollToFile();
  const pendingScrollToHeadingSlug = usePendingScrollToHeadingSlug();
  const pendingEditFile = usePendingEditFile();
  const pendingEditLineNumber = usePendingEditLineNumber();
  const pendingEditView = usePendingEditView();
  const settings = useSettings();
  const expansionCounts = useExpansionCounts();

  const showExpandAll = expansionCounts.totalCount > 0 && expansionCounts.expandedCount < expansionCounts.totalCount;
  const showCollapseAll = expansionCounts.totalCount > 0 && expansionCounts.collapsedCount < expansionCounts.totalCount;

  const sortedEntries = useMemo(() => {
    const visibleEntries = entries.filter((entry) => !items.get(entry.path)?.isCut);
    const entriesWithCurrentTimes = visibleEntries.map((entry) => {
      const item = items.get(entry.path);
      if (item && (item.modifiedTime !== entry.modifiedTime || item.createdTime !== entry.createdTime)) {
        return { ...entry, modifiedTime: item.modifiedTime, createdTime: item.createdTime };
      }
      return entry;
    });
    if (hasIndexFile) {
      return [...entriesWithCurrentTimes].sort((a, b) => {
        const aOrder = a.indexOrder ?? Infinity;
        const bOrder = b.indexOrder ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      });
    }
    return sortEntries(entriesWithCurrentTimes, settings.sortOrder, settings.foldersOnTop);
  }, [entries, items, hasIndexFile, settings.sortOrder, settings.foldersOnTop]);

  const visibleEntries = useMemo(() => {
    if (!expandedEditor) return sortedEntries;
    const editing = sortedEntries.filter((entry) => !entry.isDirectory && items.get(entry.path)?.editing);
    return editing.length > 0 ? editing : sortedEntries;
  }, [expandedEditor, sortedEntries, items]);

  const allImages = useMemo(
    () => sortedEntries.filter((entry) => !entry.isDirectory && isImageFile(entry.name)),
    [sortedEntries]
  );

  const hasSelectedItems = Array.from(items.values()).some((item) => item.isSelected);
  const hasCutItems = Array.from(items.values()).some((item) => item.isCut);
  const selectedItems = Array.from(items.values()).filter((item) => item.isSelected);
  const selectedFileCount = selectedItems.filter((item) => !item.isDirectory).length;
  const hasSelectedFolders = selectedItems.some((item) => item.isDirectory);

  const previousPathRef = useRef<string | null>(null);
  const mainContainerRef = useRef<HTMLElement | null>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  // Handle pending scroll after directory loads, or restore scroll position on folder navigation
  useEffect(() => {
    if (!loading) {
      // Skip browser scroll handling when not in browser view — ThreadView
      // manages its own scrolling and we don't want to interfere.
      if (currentView !== 'browser') {
        previousPathRef.current = currentPath;
        return;
      }

      const isNewFolder = previousPathRef.current !== null && previousPathRef.current !== currentPath;

      // Save scroll position for the previous folder before switching
      if (isNewFolder && previousPathRef.current && mainContainerRef.current) {
        setBrowserScrollPosition(previousPathRef.current, mainContainerRef.current.scrollTop);
      }

      previousPathRef.current = currentPath;

      // Short timeout just for DOM to settle after React render
      setTimeout(() => {
        // logger.log('[BrowseView] scroll effect fired — pendingScrollToFile:', pendingScrollToFile, 'pendingScrollToHeadingSlug:', pendingScrollToHeadingSlug);
        if (pendingScrollToFile) {
          // Scroll to specific file (e.g., from search results or index tree heading)
          scrollItemIntoView(pendingScrollToFile, false);
          clearPendingScrollToFile();
          if (pendingScrollToHeadingSlug) {
            const slug = pendingScrollToHeadingSlug;
            // logger.log('[BrowseView] scheduling heading scroll for slug:', slug);
            // Wait for markdown content to finish rendering before scrolling to heading
            setTimeout(() => {
              // const el = document.getElementById(slug);
              // logger.log('[BrowseView] heading scroll firing — slug:', slug, 'element found:', !!el, el);
              scrollElementIntoView(slug, true);
              clearPendingScrollToHeadingSlug();
            }, 750);
          }
        } else if (isNewFolder) {
          // Restore saved scroll position for this folder, or scroll to top
          const savedPosition = getBrowserScrollPosition(currentPath);
          const mainContainer = mainContainerRef.current;
          if (mainContainer) {
            mainContainer.scrollTo({ top: savedPosition, behavior: 'instant' });
          }
        }

        // Handle pending edit (e.g., from search results edit button)
        if (pendingEditFile && pendingEditView === 'browser') {
          const lineNumber = pendingEditLineNumber ?? undefined;
          setTimeout(() => {
            setItemExpanded(pendingEditFile, true);
            setItemEditing(pendingEditFile, true, lineNumber);
            clearPendingEditFile();
          }, 100);
        }
      }, 100);
    }
  }, [loading, pendingScrollToFile, pendingScrollToHeadingSlug, pendingEditFile, pendingEditView, currentPath, currentView]);

  const generateExportFileName = (currentPath: string | null): string => {
    if (!currentPath) return 'export.md';
    const folderName = currentPath.substring(currentPath.lastIndexOf('/') + 1);
    return `${folderName}-export.md`;
  };


  // When expanded editor activates and a file starts editing, scroll to top so
  // the enlarged editor view always begins at the top of the container.
  const anyItemEditing = useMemo(
    () => Array.from(items.values()).some((item) => item.editing),
    [items]
  );
  useEffect(() => {
    if (expandedEditor && anyItemEditing) {
      mainContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [expandedEditor, anyItemEditing]);

  // Handle scroll events on the main container (debounced save)
  const handleMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollSaveTimerRef.current) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = setTimeout(() => {
      if (currentPath) {
        setBrowserScrollPosition(currentPath, scrollTop);
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

  const handleRefresh = useCallback(async () => {
    if (currentPath && hasIndexFile) {
      await window.electronAPI.reconcileIndexedFiles(currentPath, false);
    }
    onRefreshDirectory();
  }, [currentPath, hasIndexFile, onRefreshDirectory]);

  const handleEntryRename = useCallback(async () => {
    if (currentPath && hasIndexFile) {
      await window.electronAPI.reconcileIndexedFiles(currentPath, false);
    }
    onRefreshDirectory();
  }, [currentPath, hasIndexFile, onRefreshDirectory]);

  const handleEntryDelete = useCallback(async () => {
    if (currentPath && hasIndexFile) {
      await window.electronAPI.reconcileIndexedFiles(currentPath, false);
    }
    onRefreshDirectory();
  }, [currentPath, hasIndexFile, onRefreshDirectory]);

  const handleMoveEntry = useCallback(async (name: string, direction: 'up' | 'down') => {
    if (!currentPath) return;
    await window.electronAPI.moveInIndexYaml(currentPath, name, direction);
    onRefreshDirectory();
  }, [currentPath, onRefreshDirectory]);

  const handleMoveEntryToEdge = useCallback(async (name: string, edge: 'top' | 'bottom') => {
    if (!currentPath) return;
    await window.electronAPI.moveToEdgeInIndexYaml(currentPath, name, edge);
    onRefreshDirectory();
  }, [currentPath, onRefreshDirectory]);

  const doPasteIntoFolder = useCallback(async (folderPath: string) => {
    await pasteIntoFolder(folderPath, items, onSetError, onRefreshDirectory);
  }, [items, onRefreshDirectory, onSetError]);

  const getSelectedItems = () => Array.from(items.values()).filter((item) => item.isSelected);

  const performDelete = useCallback(async () => {
    await deleteSelected(getSelectedItems(), currentPath, hasIndexFile, onSetError, onRefreshDirectory, () => setShowDeleteConfirm(false));
  }, [currentPath, hasIndexFile, items, onRefreshDirectory, onSetError]);

  const handleMoveToFolder = useCallback(async () => {
    if (!currentPath) return;
    await moveSelectedToFolder(currentPath, getSelectedItems(), onSetError, onRefreshDirectory);
  }, [currentPath, items, onRefreshDirectory, onSetError]);

  const handleSplitFile = useCallback(async () => {
    if (!currentPath) return;
    await splitSelectedFile(currentPath, getSelectedItems(), onSetError, onRefreshDirectory);
  }, [currentPath, items, onRefreshDirectory, onSetError]);

  const handleJoinFiles = useCallback(async () => {
    if (!currentPath) return;
    await joinSelectedFiles(currentPath, getSelectedItems(), onSetError, onRefreshDirectory);
  }, [currentPath, items, onRefreshDirectory, onSetError]);

  const handleExport = useCallback(async (outputFolder: string, fileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean, exportToPdf: boolean) => {
    if (!currentPath) return;

    setShowExportDialog(false);
    onSetError(null);

    onSetLastExportFolder(outputFolder);
    const config = await window.electronAPI.getConfig();
    await window.electronAPI.saveConfig({ ...config, lastExportFolder: outputFolder });

    const result = await window.electronAPI.exportFolderContents(currentPath, outputFolder, fileName, includeSubfolders, includeFilenames, includeDividers);

    if (!result.success) {
      onSetError(result.error || 'Failed to export folder contents');
      return;
    }

    if (exportToPdf && result.outputPath) {
      const pdfPath = result.outputPath.replace(/\.md$/i, '.pdf');
      const pdfResult = await window.electronAPI.exportToPdf(result.outputPath, pdfPath, currentPath);

      if (!pdfResult.success) {
        onSetError(pdfResult.error || 'Failed to launch PDF export');
        return;
      }
    } else {
      if (result.outputPath) {
        await window.electronAPI.openExternal(result.outputPath);
      }
    }
  }, [currentPath, onSetError, onSetLastExportFolder]);

  const handleCancelExport = useCallback(() => {
    setShowExportDialog(false);
  }, []);

  const handleOpenCreateDialog = useCallback(() => {
    setInsertAtIndex(null);
    setCreateFileDefaultName('');
    setShowCreateDialog(true);
  }, []);

  const handleInsertFileAt = useCallback((insertIndex: number) => {
    setInsertAtIndex(insertIndex);
    setCreateFileDefaultName('');
    setShowCreateDialog(true);
  }, []);

  const handleCreateFile = useCallback(async (fileName: string) => {
    await createFileOp(fileName, currentPath, insertAtIndex, sortedEntries, onRefreshDirectory, onSetError, () => {
      setShowCreateDialog(false);
      setCreateFileDefaultName('');
      setInsertAtIndex(null);
    });
  }, [currentPath, onRefreshDirectory, onSetError, insertAtIndex, sortedEntries]);

  const handleCancelCreate = useCallback(() => {
    setShowCreateDialog(false);
    setCreateFileDefaultName('');
    setInsertAtIndex(null);
  }, []);

  const handleOpenCreateFolderDialog = useCallback(() => {
    setInsertAtIndex(null);
    setCreateFolderDefaultName('');
    setShowCreateFolderDialog(true);
  }, []);

  const handleInsertFolderAt = useCallback((insertIndex: number) => {
    setInsertAtIndex(insertIndex);
    setCreateFolderDefaultName('');
    setShowCreateFolderDialog(true);
  }, []);

  const handleCreateFolder = useCallback(async (folderName: string) => {
    await createFolderOp(folderName, currentPath, insertAtIndex, sortedEntries, onRefreshDirectory, onSetError, () => {
      setShowCreateFolderDialog(false);
      setCreateFolderDefaultName('');
      setInsertAtIndex(null);
    });
  }, [currentPath, onRefreshDirectory, onSetError, insertAtIndex, sortedEntries]);

  const handleCancelCreateFolder = useCallback(() => {
    setShowCreateFolderDialog(false);
    setCreateFolderDefaultName('');
    setInsertAtIndex(null);
  }, []);

  const handleOpenSearchDialog = useCallback(() => {
    setSearchDialogInitialValues(undefined);
    setShowSearchDialog(true);
  }, []);

  const handleSearch = useCallback(async (options: SearchOptions) => {
    if (!currentPath) return;

    if (options.searchName) {
      const definition: SearchDefinition = {
        name: options.searchName,
        searchText: options.query,
        searchTarget: options.searchMode,
        searchMode: options.searchType,
        sortBy: options.sortBy,
        sortDirection: options.sortDirection,
        searchImageExif: options.searchImageExif,
        mostRecent: options.mostRecent,
      };
      await saveSearchDefinitionToConfig(definition);
    }

    setShowSearchDialog(false);

    // Decode {{nl}} tokens back to spaces for actual search execution
    const searchQuery = options.query.replace(/\{\{nl\}\}/g, ' ');

    const results = await window.electronAPI.searchFolder(currentPath, searchQuery, options.searchType, options.searchMode, options.searchImageExif, options.mostRecent);
    setSearchResults(results, options.query, currentPath, options.sortBy, options.sortDirection);
    setCurrentView('search-results');
  }, [currentPath]);

  const handleCancelSearch = useCallback(() => {
    setShowSearchDialog(false);
    setSearchDialogInitialValues(undefined);
  }, []);

  const handleReplace = useCallback(async (searchText: string, replaceText: string) => {
    if (!currentPath) return;

    setShowReplaceDialog(false);

    try {
      const results = await window.electronAPI.searchAndReplace(currentPath, searchText, replaceText);
      setReplaceResultMessage(buildReplaceResultMessage(results));
      const totalReplacements = results.filter((r) => r.success).reduce((sum, r) => sum + r.replacementCount, 0);
      if (totalReplacements > 0) {
        void onRefreshDirectory();
      }
    } catch (err) {
      setReplaceResultMessage(`Replace failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentPath, onRefreshDirectory]);

  const handleCancelReplace = useCallback(() => {
    setShowReplaceDialog(false);
  }, []);

  const handleSaveSearchDefinition = useCallback(async (options: SearchOptions) => {
    if (!options.searchName) return;
    const definition: SearchDefinition = {
      name: options.searchName,
      searchText: options.query,
      searchTarget: options.searchMode,
      searchMode: options.searchType,
      sortBy: options.sortBy,
      sortDirection: options.sortDirection,
      mostRecent: options.mostRecent,
    };
    await saveSearchDefinitionToConfig(definition);
  }, []);

  const handleDeleteSearchDefinition = useCallback(async (name: string) => {
    await deleteSearchDefinitionFromConfig(name);
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    await pasteFromClipboardOp(currentPath, onRefreshDirectory, onSetError);
  }, [currentPath, onRefreshDirectory, onSetError]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  const runOcr = () => {
    if (!currentPath) return;
    const ocrFolder = settings.ocrToolsFolder;
    if (!ocrFolder) {
      onSetError('OCR tools folder is not configured. Set it in Settings → OCR.');
      return;
    }
    const escapedOcrFolder = ocrFolder.replace(/'/g, "'\\''");

    const selectedImages = Array.from(items.values()).filter(
      (item) => item.isSelected && !item.isDirectory && isImageFile(item.name)
    );
    const hasAnySelection = Array.from(items.values()).some((item) => item.isSelected);

    let command: string;
    if (hasAnySelection) {
      if (selectedImages.length === 0) {
        onSetError('No image files in the current selection. Select one or more image files to run OCR.');
        return;
      }
      const ocrCalls = selectedImages.map((img, i) => {
        const escapedImg = img.path.replace(/'/g, "'\\''");
        return `echo "--- OCR [${i + 1}/${selectedImages.length}]: ${img.name} ---" && ./ocr.sh '${escapedImg}'`;
      });
      command = `cd '${escapedOcrFolder}' && ${ocrCalls.join(' && ')}`;
    } else {
      const escapedPath = currentPath.replace(/'/g, "'\\''");
      command = `cd '${escapedOcrFolder}' && ./ocr.sh '${escapedPath}'`;
    }

    void (async () => {
      const result = await window.electronAPI.runInExternalTerminal(command);
      if (!result.success) {
        onSetError('Failed to launch OCR terminal: ' + (result.error ?? 'Unknown error'));
      }
    })();
  };

  const newAiChat = () => {
    if (!currentPath) return;
    if (hasHumanMd(entries)) {
      onSetError('This folder already contains an AI conversation. Please navigate to a different folder to start a new chat.');
      return;
    }
    void (async () => {
      try {
        const result = await window.electronAPI.replyToAi(currentPath, false);
        if ('error' in result) {
          onSetError('Failed to create AI chat: ' + result.error);
        } else {
          const view = 'thread';
          navigateToBrowserPath(result.folderPath, `${result.folderPath}/HUMAN.md`, view);
          setPendingEditFile(result.filePath, undefined, view);
        }
      } catch (err) {
        onSetError('Failed to create AI chat: ' + (err instanceof Error ? err.message : String(err)));
      }
    })();
  };

  return (
    <>
      {/* Combined header: breadcrumbs left, actions right, wraps responsively */}

      <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">

        <div data-testid="browser-header-breadcrumbs" className="flex items-center gap-3 min-w-0">
          <PathBreadcrumb
            rootPath={rootPath}
            currentPath={currentPath}
            onNavigate={navigateTo}
          />
        </div>

        <div data-testid="browser-header-actions" className="flex-1 flex items-center justify-end gap-1">
          {/* Cut button - shown when items are selected and no items are cut */}
          {hasSelectedItems && !hasCutItems && (
            <button
              onClick={cutSelectedItems}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
              title="Cut selected items"
              data-testid="cut-button"
            >
              Cut
            </button>
          )}

          {/* Delete button - shown when items are selected and no items are cut */}
          {hasSelectedItems && !hasCutItems && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
              title="Delete selected items"
              data-testid="delete-button"
            >
              Del
            </button>
          )}

          {/* Create file/folder buttons — hidden in index-ordered mode (inline insert bars replace them) */}
          {!hasIndexFile && (
            <>
              <button
                onClick={handleOpenCreateDialog}
                className="p-2 text-blue-400 hover:text-blue-300 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                title="Create file"
                data-testid="create-file-button"
              >
                <DocumentPlusIcon className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
              </button>
              <button
                onClick={handleOpenCreateFolderDialog}
                className="p-2 text-amber-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                title="Create folder"
                data-testid="create-folder-button"
              >
                <FolderPlusIcon className="w-5 h-5 text-amber-500 group-hover:text-amber-400" />
              </button>
            </>
          )}

          {/* Edit menu button */}
          <button
            ref={editButtonRef}
            onClick={() => setShowEditMenu(prev => !prev)}
            className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Edit"
            data-testid="edit-menu-button"
          >
            <Squares2X2Icon className="w-5 h-5" />
          </button>

          {/* Tools menu button */}
          <button
            ref={toolsButtonRef}
            onClick={() => setShowToolsMenu(prev => !prev)}
            className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Tools"
            data-testid="tools-menu-button"
          >
            <WrenchIcon className="w-5 h-5" />
          </button>

          {/* Sort order menu button */}
          {!hasIndexFile && (<button
            ref={sortButtonRef}
            onClick={() => setShowSortMenu(prev => !prev)}
            className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Sort order"
            data-testid="sort-menu-button"
          >
            <BarsArrowDownIcon className="w-5 h-5" />
          </button>)}

          {/* Paste from clipboard button */}
          <button
            onClick={handlePasteFromClipboard}
            className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Paste from clipboard"
            data-testid="paste-clipboard-button"
          >
            <ClipboardIcon className="w-5 h-5" />
          </button>

          {/* Search button */}
          <button
            ref={searchButtonRef}
            onClick={() => setShowSearchMenu(prev => !prev)}
            className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Search"
            data-testid="search-menu-button"
          >
            <MagnifyingGlassIcon className="w-5 h-5" />
          </button>

          {/* Expand all button */}
          {showExpandAll && (
            <button
              onClick={expandAllItems}
              className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="Expand all"
              data-testid="expand-all-button"
            >
              <ChevronDownIcon className="w-5 h-5" />
            </button>
          )}

          {/* Collapse all button */}
          {showCollapseAll && (
            <button
              onClick={collapseAllItems}
              className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="Collapse all"
              data-testid="collapse-all-button"
            >
              <ChevronUpIcon className="w-5 h-5" />
            </button>
          )}

          {/* Refresh button */}
          <button
            onClick={() => void handleRefresh()}
            className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Refresh"
            data-testid="refresh-button"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>

          {/* Edit checkbox floats at top right of scrollable area, inside main */}
          {hasIndexFile && (
            <label data-testid="doc-mode-edit-checkbox" className="flex items-center gap-1 cursor-pointer ml-4">
              <input
                type="checkbox"
                className="w-5 h-5"
                style={{ accentColor: '#38bdf8' }}
                checked={indexYaml?.options?.edit_mode ?? false}
                onChange={(e) => {
                  const newEditMode = e.target.checked;
                  const updated = { ...(indexYaml ?? {}), options: { ...(indexYaml?.options ?? {}), edit_mode: newEditMode } };
                  setIndexYaml(updated);
                  void window.electronAPI.writeIndexOptions(currentPath, { edit_mode: newEditMode });
                }}
              />
              <span className="text-slate-200 text-sm">Edit</span>
            </label>
          )}

        </div>
      </header>

      {/* Main content */}
      <main
        data-testid="browser-main-content"
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        className="flex-1 min-h-0 overflow-y-auto pb-4 pt-1 relative"
      >
        <div className={`${getContentWidthClasses(settings.contentWidth)}`}>
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-slate-400">Loading...</div>
            </div>
          )}

          {!loading && sortedEntries.length === 0 && (
            <div className="text-center py-12">
              <FolderIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
              <p className="text-slate-400">This folder is empty</p>
            </div>
          )}

          {/* Note: The 'div+div' stuff below is: Adjacent sibling divs overlap by 1px so neighboring borders collapse into a single line */}
          {!loading && sortedEntries.length > 0 && (
            hasIndexFile ? (
              <div>
                {editMode && !expandedEditor && <IndexInsertBar onInsertFile={() => handleInsertFileAt(0)} onInsertFolder={() => handleInsertFolderAt(0)} />}
                {visibleEntries.map((entry, idx) => {
                  const moveUp = idx > 0 ? () => void handleMoveEntry(entry.name, 'up') : undefined;
                  const moveDown = idx < sortedEntries.length - 1 ? () => void handleMoveEntry(entry.name, 'down') : undefined;
                  const moveToTop = idx > 0 ? () => void handleMoveEntryToEdge(entry.name, 'top') : undefined;
                  const moveToBottom = idx < sortedEntries.length - 1 ? () => void handleMoveEntryToEdge(entry.name, 'bottom') : undefined;
                  return (
                    <div key={entry.path}>
                      {entry.isDirectory ? (
                        <FolderEntry entry={entry} onNavigate={navigateTo} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onPasteIntoFolder={doPasteIntoFolder} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                      ) : entry.isMarkdown ? (
                        <MarkdownEntry entry={entry} view="browser" onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                      ) : isImageFile(entry.name) ? (
                        <ImageEntry entry={entry} allImages={allImages} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                      ) : isTextFile(entry.name) ? (
                        <TextEntry entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                      ) : (
                        <FileEntryComponent entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                      )}
                      {editMode && !expandedEditor && <IndexInsertBar onInsertFile={() => handleInsertFileAt(idx + 1)} onInsertFolder={() => handleInsertFolderAt(idx + 1)} />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="[&>div+div]:-mt-px">
                {visibleEntries.map((entry) => (
                  <div key={entry.path}>
                    {entry.isDirectory ? (
                      <FolderEntry entry={entry} onNavigate={navigateTo} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onPasteIntoFolder={doPasteIntoFolder} />
                    ) : entry.isMarkdown ? (
                      <MarkdownEntry entry={entry} view="browser" onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} />
                    ) : isImageFile(entry.name) ? (
                      <ImageEntry entry={entry} allImages={allImages} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} />
                    ) : isTextFile(entry.name) ? (
                      <TextEntry entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} />
                    ) : (
                      <FileEntryComponent entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} />
                    )}
                  </div>
                ))}
              </div>
            )
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
          defaultFolder={lastExportFolder}
          defaultFileName={generateExportFileName(currentPath)}
          onExport={handleExport}
          onCancel={handleCancelExport}
        />
      )}

      {showSortMenu && !hasIndexFile && (
        <SortPopupMenu
          anchorRef={sortButtonRef}
          onClose={() => setShowSortMenu(false)}
          currentSortOrder={settings.sortOrder}
          onSelectSortOrder={(order) => {
            setSortOrder(order);
            void onSaveSettings();
          }}
          onEnableCustomOrdering={currentPath ? async () => {
            await window.electronAPI.reconcileIndexedFiles(currentPath, true);
            onRefreshDirectory();
          } : undefined}
        />
      )}

      {showSearchMenu && (
        <SearchPopupMenu
          anchorRef={searchButtonRef}
          onClose={() => setShowSearchMenu(false)}
          searchDefinitions={settings.searchDefinitions || []}
          onNewSearch={handleOpenSearchDialog}
          onRunSearch={(definition) => {
            if (!currentPath) return;
            void (async () => {
              const searchQuery = definition.searchText.replace(/\{\{nl\}\}/g, ' ');
              const results = await window.electronAPI.searchFolder(
                currentPath,
                searchQuery,
                definition.searchMode,
                definition.searchTarget,
                definition.searchImageExif
              );
              setSearchResults(results, definition.searchText, currentPath, definition.sortBy || 'modified-time', definition.sortDirection || 'desc');
              setCurrentView('search-results');
            })();
          }}
          onEditSearch={(definition) => {
            setCurrentView('browser');
            setSearchDialogInitialValues({
              searchQuery: definition.searchText,
              searchName: definition.name,
              searchType: definition.searchMode,
              searchMode: definition.searchTarget,
              sortBy: definition.sortBy,
              sortDirection: definition.sortDirection,
              searchImageExif: definition.searchImageExif,
            });
            setShowSearchDialog(true);
          }}
        />
      )}

      {showEditMenu && (
        <EditPopupMenu
          anchorRef={editButtonRef}
          onClose={() => setShowEditMenu(false)}
          onUndoCut={() => clearAllCutItems()}
          onSelectAll={() => {
            const currentFolderPaths = entries.map((entry) => entry.path);
            selectItemsByPaths(currentFolderPaths);
          }}
          onUnselectAll={() => clearAllSelections()}
          onMoveToFolder={() => void handleMoveToFolder()}
          onSplit={() => void handleSplitFile()}
          onJoin={() => void handleJoinFiles()}
          onReplaceInFiles={() => setShowReplaceDialog(true)}
          undoCutDisabled={!hasCutItems}
          unselectAllDisabled={selectedFileCount === 0 && !hasSelectedFolders}
          moveToFolderDisabled={selectedFileCount !== 1 || hasSelectedFolders}
          splitDisabled={selectedFileCount !== 1 || hasSelectedFolders}
          joinDisabled={selectedFileCount < 2 || hasSelectedFolders}
        />
      )}

      {showToolsMenu && (
        <ToolsPopupMenu
          anchorRef={toolsButtonRef}
          onClose={() => setShowToolsMenu(false)}
          aiEnabled={aiEnabled}
          onFolderAnalysis={() => {
            if (!currentPath) return;
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
                onSetError('Failed to analyze folder: ' + (err instanceof Error ? err.message : String(err)));
              }
            })();
          }}

          onExport={() => setShowExportDialog(true)}
          onRunOcr={runOcr}
          onNewAiChat={newAiChat}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Move ${getSelectedItems().length} selected item(s) to trash?`}
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
    </>
  );
}

export default BrowseView;
