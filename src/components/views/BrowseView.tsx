import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  MagnifyingGlassIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon,
  ArrowPathIcon, FolderIcon, WrenchIcon, Squares2X2Icon, BarsArrowDownIcon,
  FolderPlusIcon, DocumentPlusIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import IndexInsertBar from '../IndexInsertBar';
import type { FileEntry } from '../../global';
import FolderEntry from '../entries/FolderEntry';
import MarkdownEntry from '../entries/MarkdownEntry';
import GenericEntry from '../entries/GenericEntry';
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
import type { ExportOptions } from '../dialogs/ExportDialog';
import AlertDialog from '../dialogs/AlertDialog';
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
  showTab,
  setCalendarFolder,
  setActiveCalendarFolder,
  setCalendarEvents,
  setCalendarLoading,
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
  setFolderGraph,
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
  setSelectedLinkItems,
  useExpandedEditor,
  useImageSizeTransitioning,
  type SearchDefinition,
} from '../../store';
import { scrollItemIntoView, scrollElementIntoView } from '../../utils/entryDom';
import { isImageFile, isTextFile, sortEntries } from '../../utils/fileTypes';
import { getContentWidthClasses } from '../../utils/styles';
import { generateTimestampFileName } from '../../utils/timeUtil';
import { hasHumanMd } from '../../ai/aiPatterns';
import { saveSearchDefinitionToConfig, deleteSearchDefinitionFromConfig, buildReplaceResultMessage } from '../../utils/searchUtil';
import { pasteIntoFolder, deleteSelected, splitSelectedFile, joinSelectedFiles, createFileOp, createFolderOp, pasteFromClipboardOp, runOcr } from '../../utils/fileOpsUtil';
import { getFileName } from '../../utils/pathUtil';
import { ATTACH_SUFFIX } from '../../utils/specialFiles';

interface AttachFolderContentsProps {
  entries: FileEntry[];
  level: number;
  onNavigate: (path: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onSaveSettings: () => void;
  onPasteIntoFolder?: (folderPath: string) => void;
}

function AttachFolderContents({ entries, level, onNavigate, onRename, onDelete, onSaveSettings, onPasteIntoFolder }: AttachFolderContentsProps) {
  const items = useItems();
  const visibleEntries = entries.filter((entry) => !items.get(entry.path)?.isCut);
  if (visibleEntries.length === 0) return null;
  const allImages = visibleEntries.filter(e => !e.isDirectory && isImageFile(e.name));

  return (
    <div style={{ paddingLeft: `${level * 32}px` }}>
      {visibleEntries.map(entry => (
        <div key={entry.path}>
          {entry.isDirectory ? (
            <>
              <FolderEntry entry={entry} onNavigate={onNavigate} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} onPasteIntoFolder={onPasteIntoFolder} isAttachFolder={entry.name.endsWith(ATTACH_SUFFIX)} />
              {entry.name.endsWith(ATTACH_SUFFIX) && entry.attachments && (
                <AttachFolderContents
                  entries={entry.attachments}
                  level={level + 1}
                  onNavigate={onNavigate}
                  onRename={onRename}
                  onDelete={onDelete}
                  onSaveSettings={onSaveSettings}
                  onPasteIntoFolder={onPasteIntoFolder}
                />
              )}
            </>
          ) : entry.isMarkdown ? (
            <MarkdownEntry entry={entry} view="browser" onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : isImageFile(entry.name) ? (
            <ImageEntry entry={entry} allImages={allImages} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : isTextFile(entry.name) ? (
            <TextEntry entry={entry} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : (
            <GenericEntry entry={entry} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          )}
        </div>
      ))}
    </div>
  );
}

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
  const [showCutOrphanAttachConfirm, setShowCutOrphanAttachConfirm] = useState<boolean>(false);

  const hasIndexFile = useHasIndexFile();
  const expandedEditor = useExpandedEditor();
  const imageSizeTransitioning = useImageSizeTransitioning();

  const items = useItems();
  const currentView = useCurrentView();
  const currentPath = useCurrentPath();

  // Detect whether the current folder uses index ordering, and load the yaml into the store
  useEffect(() => {
    const hasIndex = entries.some((e) => e.indexOrder !== undefined);
    setHasIndexFile(hasIndex);
    if (hasIndex && currentPath) {
      void api.readIndexYaml(currentPath).then((yaml) => {
        setIndexYaml(yaml);
      });
    } else {
      setIndexYaml(null);
    }
  }, [entries, currentPath]);

  // Reconcile on folder navigation only (not on every file-operation refresh)
  useEffect(() => {
    if (!currentPath) return;
    void api.reconcileIndexedFiles(currentPath, false);
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
  const preEditScrollPositionRef = useRef<number | null>(null);
  const wasExpandedEditingRef = useRef<boolean>(false);
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

      // Detect folder navigation within the browser tab. BrowseView stays
      // mounted across tab switches (visibility is toggled via CSS), so its
      // scroll position is preserved natively when switching tabs — we only
      // need to save/restore per folder when navigating between folders.
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
          // Scroll to specific file (e.g., from search results or index tree heading).
          // The target element only exists once the destination folder's entries
          // have rendered. When navigating to a *different* folder this effect
          // fires once prematurely (before the load starts), so only consume the
          // pending request once the element is actually found and scrolled —
          // otherwise the real attempt (after the load) never runs.
          const scrolled = scrollItemIntoView(pendingScrollToFile, false);
          if (scrolled) {
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
          }
        } else if (isNewFolder) {
          // Restore the saved scroll position for the folder we navigated to.
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: pendingEditLineNumber is always set in tandem with pendingEditFile (already a dep), so the effect already re-fires when it meaningfully changes
  }, [loading, pendingScrollToFile, pendingScrollToHeadingSlug, pendingEditFile, pendingEditView, currentPath, currentView]);

  const generateExportFileName = (currentPath: string | null): string => {
    if (!currentPath) return 'export.md';
    const folderName = getFileName(currentPath);
    return `${folderName}-export.md`;
  };


  // When expanded editor activates and a file starts editing, save scroll position
  // and scroll to top. When expanded editing ends, restore the saved position.
  const anyItemEditing = useMemo(
    () => Array.from(items.values()).some((item) => item.editing),
    [items]
  );

  // NOTE: when we're editing in expanded mode that will mean our scroll bar will be completely irrelevant 
  // when we re-render the page after the editing is completed, and so the logic related to 'preEditScrollPositionRef'
  // below is to be able to restore the scroll position back to the correct location after an expanded mode edit.
  useEffect(() => {
    const isExpandedEditing = expandedEditor && anyItemEditing;
    if (isExpandedEditing && !wasExpandedEditingRef.current) {
      // Read from the store rather than live scrollTop: by the time this effect runs,
      // visibleEntries has already changed (DOM content shrank) and the browser has
      // clamped scrollTop to 0, losing the real position. The store holds the last
      // debounced-saved value, which is accurate to within 150ms — long before the
      // user clicked "Expand editor".
      preEditScrollPositionRef.current = currentPath ? getBrowserScrollPosition(currentPath) : 0;
      mainContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    } else if (!isExpandedEditing && wasExpandedEditingRef.current) {
      if (preEditScrollPositionRef.current !== null) {
        const savedPos = preEditScrollPositionRef.current;
        preEditScrollPositionRef.current = null;
        if (currentPath) setBrowserScrollPosition(currentPath, savedPos);
        setTimeout(() => {
          mainContainerRef.current?.scrollTo({ top: savedPos, behavior: 'instant' });
        }, 50);
      }
    }
    wasExpandedEditingRef.current = isExpandedEditing;
  }, [expandedEditor, anyItemEditing, currentPath]);

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

  // Clear any pending debounced save on unmount (full app teardown / closing
  // the folder). BrowseView no longer unmounts on tab switches, so there is no
  // view-switch scroll position to flush here.
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
      }
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    if (currentPath && hasIndexFile) {
      await api.reconcileIndexedFiles(currentPath, false);
    }
    onRefreshDirectory();
  }, [currentPath, hasIndexFile, onRefreshDirectory]);

  const handleEntryRename = useCallback(async () => {
    if (currentPath && hasIndexFile) {
      await api.reconcileIndexedFiles(currentPath, false);
    }
    onRefreshDirectory();
  }, [currentPath, hasIndexFile, onRefreshDirectory]);

  const handleEntryDelete = useCallback(async () => {
    if (currentPath && hasIndexFile) {
      await api.reconcileIndexedFiles(currentPath, false);
    }
    onRefreshDirectory();
  }, [currentPath, hasIndexFile, onRefreshDirectory]);

  const handleMoveEntry = useCallback(async (name: string, direction: 'up' | 'down') => {
    if (!currentPath) return;
    await api.moveInIndexYaml(currentPath, name, direction);
    onRefreshDirectory();
  }, [currentPath, onRefreshDirectory]);

  const handleMoveEntryToEdge = useCallback(async (name: string, edge: 'top' | 'bottom') => {
    if (!currentPath) return;
    await api.moveToEdgeInIndexYaml(currentPath, name, edge);
    onRefreshDirectory();
  }, [currentPath, onRefreshDirectory]);

  const doPasteIntoFolder = useCallback(async (folderPath: string) => {
    await pasteIntoFolder(folderPath, items, onSetError, onRefreshDirectory);
  }, [items, onRefreshDirectory, onSetError]);

  const ensureAttachFolder = useCallback(async (filePath: string): Promise<string | null> => {
    const attachFolderPath = `${filePath}${ATTACH_SUFFIX}`;
    const exists = await api.pathExists(attachFolderPath);
    if (!exists) {
      const result = await api.createFolder(attachFolderPath);
      if (!result.success) {
        onSetError(result.error || 'Failed to create attachment folder');
        return null;
      }
      if (hasIndexFile && currentPath) {
        const fileName = getFileName(filePath);
        const attachFolderName = `${fileName}${ATTACH_SUFFIX}`;
        await api.insertIntoIndexYaml(currentPath, attachFolderName, fileName);
      }
    }
    return attachFolderPath;
  }, [onSetError, hasIndexFile, currentPath]);

  const doPasteAsAttachment = useCallback(async (filePath: string) => {
    const attachFolderPath = await ensureAttachFolder(filePath);
    if (!attachFolderPath) return;
    await pasteIntoFolder(attachFolderPath, items, onSetError, onRefreshDirectory);
  }, [ensureAttachFolder, items, onRefreshDirectory, onSetError]);

  const doPasteClipboardAsAttachment = useCallback(async (filePath: string) => {
    const attachFolderPath = await ensureAttachFolder(filePath);
    if (!attachFolderPath) return;
    await pasteFromClipboardOp(attachFolderPath, onRefreshDirectory, onSetError);
  }, [ensureAttachFolder, onRefreshDirectory, onSetError]);

  const getSelectedItems = () => Array.from(items.values()).filter((item) => item.isSelected);

  const performDelete = useCallback(async () => {
    await deleteSelected(getSelectedItems(), currentPath, hasIndexFile, onSetError, onRefreshDirectory, () => setShowDeleteConfirm(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- false positive: getSelectedItems only reads items, which is already a dep. Listing the unmemoized helper would defeat this callback's memoization.
  }, [currentPath, hasIndexFile, items, onRefreshDirectory, onSetError]);

  const handleSplitFile = useCallback(async () => {
    if (!currentPath) return;
    await splitSelectedFile(currentPath, getSelectedItems(), onSetError, onRefreshDirectory);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- false positive: getSelectedItems only reads items, which is already a dep. Listing the unmemoized helper would defeat this callback's memoization.
  }, [currentPath, items, onRefreshDirectory, onSetError]);

  const handleJoinFiles = useCallback(async () => {
    if (!currentPath) return;
    await joinSelectedFiles(currentPath, getSelectedItems(), onSetError, onRefreshDirectory);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- false positive: getSelectedItems only reads items, which is already a dep. Listing the unmemoized helper would defeat this callback's memoization.
  }, [currentPath, items, onRefreshDirectory, onSetError]);

  const handleCutClick = useCallback(() => {
    const hasOrphanedAttachment = visibleEntries.some((entry) => {
      if (entry.isDirectory || !items.get(entry.path)?.isSelected) return false;
      const attachEntry = visibleEntries.find((e) => e.name === `${entry.name}${ATTACH_SUFFIX}`);
      return attachEntry !== undefined && !items.get(attachEntry.path)?.isSelected;
    });
    if (hasOrphanedAttachment) {
      setShowCutOrphanAttachConfirm(true);
    } else {
      cutSelectedItems();
    }
  }, [visibleEntries, items]);

  const handleExport = useCallback(async ({ outputFolder, fileName, includeSubfolders, includeFilenames, includeDividers, exportToPdf }: ExportOptions) => {
    if (!currentPath) return;

    setShowExportDialog(false);
    onSetError(null);

    onSetLastExportFolder(outputFolder);
    await api.updateConfig({ lastExportFolder: outputFolder });

    const result = await api.exportFolderContents(currentPath, outputFolder, fileName, includeSubfolders, includeFilenames, includeDividers);

    if (!result.success) {
      onSetError(result.error || 'Failed to export folder contents');
      return;
    }

    if (exportToPdf && result.outputPath) {
      const pdfPath = result.outputPath.replace(/\.md$/i, '.pdf');
      const pdfResult = await api.exportToPdf(result.outputPath, pdfPath, currentPath);

      if (!pdfResult.success) {
        onSetError(pdfResult.error || 'Failed to launch PDF export');
        return;
      }
    } else {
      if (result.outputPath) {
        await api.openExternal(result.outputPath);
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

  // No longer used — kept for reference in case we return to prompting users for a file name during document mode editing
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleInsertFileAt_legacy = useCallback((insertIndex: number) => {
    setInsertAtIndex(insertIndex);
    setCreateFileDefaultName('');
    setShowCreateDialog(true);
  }, []);

  const handleInsertFileAt = useCallback(async (insertIndex: number) => {
    const fileName = generateTimestampFileName();
    await createFileOp(fileName, currentPath, insertIndex, sortedEntries, onRefreshDirectory, onSetError, () => {
      setShowCreateDialog(false);
      setCreateFileDefaultName('');
      setInsertAtIndex(null);
    });
  }, [currentPath, onRefreshDirectory, onSetError, sortedEntries]);

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

    const results = await api.searchFolder(currentPath, searchQuery, options.searchType, options.searchMode, options.searchImageExif, options.mostRecent);
    setSearchResults(results, options.query, currentPath, options.sortBy, options.sortDirection, options.searchName || '');
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
      const results = await api.searchAndReplace(currentPath, searchText, replaceText);
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
      searchImageExif: options.searchImageExif,
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

  const handleRunOcr = useCallback(() => {
    if (!currentPath) return;
    void runOcr(currentPath, settings.ocrToolsFolder, items, onSetError);
  }, [currentPath, settings.ocrToolsFolder, items, onSetError]);

  const handleCopyLink = useCallback(() => {
    const paths = Array.from(items.values())
      .filter((item) => item.isSelected)
      .map((item) => item.path);
    setSelectedLinkItems(paths);
    clearAllSelections();
  }, [items]);

  const handleSelectSortOrder = useCallback((order: Parameters<typeof setSortOrder>[0]) => {
    setSortOrder(order);
    void onSaveSettings();
  }, [onSaveSettings]);

  const handleEnableCustomOrdering = useCallback(async () => {
    if (!currentPath) return;
    await api.reconcileIndexedFiles(currentPath, true);
    onRefreshDirectory();
  }, [currentPath, onRefreshDirectory]);

  const handleRunSearch = useCallback((definition: SearchDefinition) => {
    if (!currentPath) return;
    void (async () => {
      const searchQuery = definition.searchText.replace(/\{\{nl\}\}/g, ' ');
      const results = await api.searchFolder(
        currentPath,
        searchQuery,
        definition.searchMode,
        definition.searchTarget,
        definition.searchImageExif
      );
      setSearchResults(results, definition.searchText, currentPath, definition.sortBy || 'modified-time', definition.sortDirection || 'desc', definition.name);
      setCurrentView('search-results');
    })();
  }, [currentPath]);

  const handleEditSearch = useCallback((definition: SearchDefinition) => {
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
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentFolderPaths = entries.map((entry) => entry.path);
    selectItemsByPaths(currentFolderPaths);
  }, [entries]);

  const handleFolderAnalysis = useCallback(() => {
    if (!currentPath) return;
    void (async () => {
      try {
        const result = await api.analyzeFolderHashtags(currentPath);
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
  }, [currentPath, onSetError]);

  const handleFolderGraph = useCallback(() => {
    if (!currentPath) return;
    void (async () => {
      try {
        const result = await api.scanFolderTree(currentPath);
        setFolderGraph({
          folderPath: result.folderPath,
          nodes: result.nodes.map(n => ({ ...n })),
          links: result.links.map(l => ({ ...l })),
          truncated: result.truncated,
          foldersOnly: result.foldersOnly,
        });
        setCurrentView('folder-graph');
      } catch (err) {
        onSetError('Failed to scan folder graph: ' + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, [currentPath, onSetError]);

  const handleShowCalendar = useCallback(() => {
    if (!currentPath) return;
    showTab('calendar');
    setCurrentView('calendar');
    setCalendarFolder(currentPath);
    setActiveCalendarFolder(currentPath);
    setCalendarLoading(true);
    void (async () => {
      try {
        const results = await api.loadCalendarEvents(currentPath);
        setCalendarEvents(results.map(r => ({
          id: r.id,
          title: r.title,
          start: new Date(r.start),
          end: new Date(r.end),
          filePath: r.filePath,
          snippet: r.snippet,
        })));
      } catch (err) {
        onSetError('Failed to load calendar: ' + (err instanceof Error ? err.message : String(err)));
        setCalendarEvents([]);
      }
    })();
  }, [currentPath, onSetError]);

  const newAiChat = () => {
    if (!currentPath) return;
    if (hasHumanMd(entries)) {
      onSetError('This folder already contains an AI conversation. Please navigate to a different folder to start a new chat.');
      return;
    }
    void (async () => {
      try {
        const result = await api.replyToAi(currentPath, false);
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
    <div
      className="flex-1 flex flex-col min-h-0"
      style={{
        opacity: imageSizeTransitioning ? 0 : 1,
        // While hidden, no transition (instant). On reveal, fade 0 -> 1 over 1s.
        transition: imageSizeTransitioning ? 'none' : 'opacity 1000ms ease-out',
      }}
    >
      {/* Combined header: breadcrumbs left, actions right, wraps responsively */}

      <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">

        <div data-testid="browser-header-breadcrumbs" className="flex items-center gap-3 min-w-0">
          <PathBreadcrumb
            rootPath={rootPath}
            currentPath={currentPath}
            onNavigate={navigateTo}
            onRefreshDirectory={onRefreshDirectory}
          />
        </div>

        <div data-testid="browser-header-actions" className="flex-1 flex items-center justify-end gap-2">
          {/* Cut button - shown when items are selected and no items are cut */}
          {hasSelectedItems && !hasCutItems && (
            <button
              type="button"
              onClick={handleCutClick}
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
              type="button"
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
                type="button"
                onClick={handleOpenCreateDialog}
                className="p-1 text-blue-400 hover:text-blue-300 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                title="Create file"
                data-testid="create-file-button"
              >
                <DocumentPlusIcon className="w-6 h-6 text-blue-400" />
              </button>
              <button
                type="button"
                onClick={handleOpenCreateFolderDialog}
                className="p-1 text-amber-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                title="Create folder"
                data-testid="create-folder-button"
              >
                <FolderPlusIcon className="w-6 h-6 text-amber-500" />
              </button>
            </>
          )}

          {/* Edit menu button */}
          <button
            type="button"
            ref={editButtonRef}
            onClick={() => setShowEditMenu(prev => !prev)}
            className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Edit"
            data-testid="edit-menu-button"
          >
            <Squares2X2Icon className="w-6 h-6" />
          </button>

          {/* Tools menu button */}
          <button
            type="button"
            ref={toolsButtonRef}
            onClick={() => setShowToolsMenu(prev => !prev)}
            className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Tools"
            data-testid="tools-menu-button"
          >
            <WrenchIcon className="w-6 h-6" />
          </button>

          {/* Calendar button */}
          <button
            type="button"
            onClick={handleShowCalendar}
            className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Show Calendar"
            data-testid="calendar-button"
          >
            <CalendarDaysIcon className="w-6 h-6" />
          </button>

          {/* Sort order menu button */}
          {!hasIndexFile && (<button
            type="button"
            ref={sortButtonRef}
            onClick={() => setShowSortMenu(prev => !prev)}
            className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Sort order"
            data-testid="sort-menu-button"
          >
            <BarsArrowDownIcon className="w-6 h-6" />
          </button>)}

          {/* Paste from clipboard button */}
          <button
            type="button"
            onClick={handlePasteFromClipboard}
            className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Paste from clipboard"
            data-testid="paste-clipboard-button"
          >
            <ClipboardIcon className="w-6 h-6" />
          </button>

          {/* Search button */}
          <button
            type="button"
            ref={searchButtonRef}
            onClick={() => setShowSearchMenu(prev => !prev)}
            className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Search"
            data-testid="search-menu-button"
          >
            <MagnifyingGlassIcon className="w-6 h-6" />
          </button>

          {/* Expand all button */}
          {showExpandAll && (
            <button
              type="button"
              onClick={expandAllItems}
              className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="Expand all"
              data-testid="expand-all-button"
            >
              <ChevronDownIcon className="w-6 h-6" />
            </button>
          )}

          {/* Collapse all button */}
          {showCollapseAll && (
            <button
              type="button"
              onClick={collapseAllItems}
              className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="Collapse all"
              data-testid="collapse-all-button"
            >
              <ChevronUpIcon className="w-6 h-6" />
            </button>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Refresh"
            data-testid="refresh-button"
          >
            <ArrowPathIcon className="w-6 h-6" />
          </button>

        </div>
      </header>

      {/* Main content */}
      <main
        data-testid="browser-main-content"
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        className="flex-1 min-h-0 overflow-y-auto pb-4 pt-1 pr-3 pl-3 relative"
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

          {/* Note: The 'div+div' stuff below is: Adjacent sibling divs overlap by 1px so neighboring borders collapse into a single line.
              A single unified branch is used (rather than a `hasIndexFile ? A : B` ternary) so the outer element stays a stable
              <div> when hasIndexFile flips on load — that lets React reconcile the keyed children instead of unmounting/remounting
              the whole entry list (the remount storm was tripping React's max-update-depth). Index-only bits (move handlers,
              IndexInsertBars, attach-folder gating) are computed conditionally inside the map. */}
          {!loading && sortedEntries.length > 0 && (
            <div className={hasIndexFile ? 'pr-12' : '[&>div+div]:-mt-px'}>
              {hasIndexFile && !(expandedEditor && anyItemEditing) && !visibleEntries[0]?.name.endsWith(ATTACH_SUFFIX) && (
                <IndexInsertBar onInsertFile={() => handleInsertFileAt(0)} onInsertFolder={() => handleInsertFolderAt(0)} />
              )}
              {visibleEntries.map((entry, idx) => {
                const moveUp = hasIndexFile && idx > 0 ? () => void handleMoveEntry(entry.name, 'up') : undefined;
                const moveDown = hasIndexFile && idx < sortedEntries.length - 1 ? () => void handleMoveEntry(entry.name, 'down') : undefined;
                const moveToTop = hasIndexFile && idx > 0 ? () => void handleMoveEntryToEdge(entry.name, 'top') : undefined;
                const moveToBottom = hasIndexFile && idx < sortedEntries.length - 1 ? () => void handleMoveEntryToEdge(entry.name, 'bottom') : undefined;
                const prevEntry = visibleEntries[idx - 1];
                const isAttach = entry.name.endsWith(ATTACH_SUFFIX);
                const indentFolder = isAttach && prevEntry?.name === entry.name.slice(0, -ATTACH_SUFFIX.length);
                const parentExpanded = !indentFolder || (!!prevEntry && (items.get(prevEntry.path)?.isExpanded ?? false));
                // Folders are shown whenever their parent is expanded (attach folders included).
                const showFolder = parentExpanded;
                return (
                  <div key={entry.path}>
                    {entry.isDirectory ? (
                      <>
                        {showFolder && (
                          <FolderEntry entry={entry} onNavigate={navigateTo} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onPasteIntoFolder={doPasteIntoFolder} onRefreshDirectory={onRefreshDirectory} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} isAttachFolder={isAttach} indentFolder={indentFolder} />
                        )}
                        {isAttach && entry.attachments && parentExpanded && (
                          <AttachFolderContents
                            entries={entry.attachments}
                            level={1}
                            onNavigate={navigateTo}
                            onRename={handleEntryRename}
                            onDelete={handleEntryDelete}
                            onSaveSettings={onSaveSettings}
                            onPasteIntoFolder={doPasteIntoFolder}
                          />
                        )}
                      </>
                    ) : entry.isMarkdown ? (
                      <MarkdownEntry entry={entry} view="browser" onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} onPasteAsAttachment={doPasteAsAttachment} onPasteClipboardAsAttachment={doPasteClipboardAsAttachment} documentMode={hasIndexFile} />
                    ) : isImageFile(entry.name) ? (
                      <ImageEntry entry={entry} allImages={allImages} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                    ) : isTextFile(entry.name) ? (
                      <TextEntry entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                    ) : (
                      <GenericEntry entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                    )}
                    {hasIndexFile && !(expandedEditor && anyItemEditing) && !visibleEntries[idx + 1]?.name.endsWith(ATTACH_SUFFIX) && (
                      <IndexInsertBar onInsertFile={() => handleInsertFileAt(idx + 1)} onInsertFolder={() => handleInsertFolderAt(idx + 1)} />
                    )}
                  </div>
                );
              })}
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
          onSelectSortOrder={handleSelectSortOrder}
          onEnableCustomOrdering={currentPath ? handleEnableCustomOrdering : undefined}
        />
      )}

      {showSearchMenu && (
        <SearchPopupMenu
          anchorRef={searchButtonRef}
          onClose={() => setShowSearchMenu(false)}
          searchDefinitions={settings.searchDefinitions || []}
          onNewSearch={handleOpenSearchDialog}
          onRunSearch={handleRunSearch}
          onEditSearch={handleEditSearch}
        />
      )}

      {showEditMenu && (
        <EditPopupMenu
          anchorRef={editButtonRef}
          onClose={() => setShowEditMenu(false)}
          onUndoCut={() => clearAllCutItems()}
          onSelectAll={handleSelectAll}
          onUnselectAll={() => clearAllSelections()}
          onSplit={() => void handleSplitFile()}
          onJoin={() => void handleJoinFiles()}
          onReplaceInFiles={() => setShowReplaceDialog(true)}
          onCopyLink={handleCopyLink}
          undoCutDisabled={!hasCutItems}
          unselectAllDisabled={selectedFileCount === 0 && !hasSelectedFolders}
          splitDisabled={selectedFileCount !== 1 || hasSelectedFolders}
          joinDisabled={selectedFileCount < 2 || hasSelectedFolders}
          copyLinkDisabled={!hasSelectedItems}
        />
      )}

      {showToolsMenu && (
        <ToolsPopupMenu
          anchorRef={toolsButtonRef}
          onClose={() => setShowToolsMenu(false)}
          aiEnabled={aiEnabled}
          onFolderAnalysis={handleFolderAnalysis}
          onFolderGraph={handleFolderGraph}
          onExport={() => setShowExportDialog(true)}
          onRunOcr={handleRunOcr}
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

      {showCutOrphanAttachConfirm && (
        <ConfirmDialog
          message="One or more selected files have an attachments folder that is not selected. Cut only the file(s) without their attachments?"
          onConfirm={() => { setShowCutOrphanAttachConfirm(false); cutSelectedItems(); }}
          onCancel={() => setShowCutOrphanAttachConfirm(false)}
        />
      )}

      {replaceResultMessage && (
        <AlertDialog
          preserveWhitespace
          title="Replace Results"
          message={replaceResultMessage}
          onClose={() => setReplaceResultMessage(null)}
        />
      )}
    </div>
  );
}

export default BrowseView;
