import { useState, useEffect, useRef } from 'react';
import {
  MagnifyingGlassIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon,
  ArrowPathIcon, FolderIcon, WrenchIcon, Squares2X2Icon, BarsArrowDownIcon,
  FolderPlusIcon, DocumentPlusIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../renderer/api';
import IndexInsertBar from '../IndexInsertBar';
import type { FileEntry } from '../../global';
import FolderEntry from '../entries/FolderEntry';
import MarkdownEntry from '../entries/MarkdownEntry';
import GenericEntry from '../entries/GenericEntry';
import ImageEntry from '../entries/ImageEntry';
import TextEntry from '../entries/TextEntry';
import PDFEntry from '../entries/PDFEntry';
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
  setCalendarSource,
  setCalendarEvents,
  setCalendarLoading,
  setCurrentPath,
  navigateToBrowserPath,
  clearPendingEditFile,
  setPendingEditFile,
  clearPendingExpandFile,
  setSearchResults,
  setSortOrder,
  setBrowserScrollPosition,
  getBrowserScrollPosition,
  setFolderAnalysis,
  setFolderGraph,
  setHasIndexFile,
  clearPendingScrollToHeadingSlug,
  useExpansionCounts,
  setIndexYaml,
  setSelectedLinkItems,
  useAS,
  type ItemData,
  type SearchDefinition,
} from '../../store';
import { scrollElementIntoView } from '../../renderer/entryDom';
import { usePendingItemScroll } from './usePendingItemScroll';
import { isImageFile, isTextFile, isPdfFile, sortEntries } from '../../shared/fileTypes';
import { getContentWidthClasses } from '../../renderer/styles';
import { generateTimestampFileName } from '../../shared/timeUtil';
import { hasHumanMd } from '../../shared/ai/aiPatterns';
import { saveSearchDefinitionToConfig, deleteSearchDefinitionFromConfig } from '../../renderer/searchUtil';
import { buildReplaceResultMessage } from '../../shared/searchHelpers';
import { pasteIntoFolder, ensureAttachFolder, deleteSelected, splitSelectedFile, joinSelectedFiles, createFileOp, createFolderOp, pasteFromClipboardOp, runOcr } from '../../renderer/fileOpsUtil';
import { getFileName, getParentPath, isSamePath } from '../../renderer/pathUtil';
import { toCalendarEvents } from '../../shared/calendarUtil';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';

/**
 * Fire-and-forget runner for BrowseView's async handlers (bound to button
 * clicks and entry onRename/onDelete props, all `() => void`): awaits `op` and
 * reports a failure through `onError`, prefixed, instead of leaking an
 * unhandled rejection. Module-level so the handlers need no try/catch bodies —
 * the React Compiler bails out on try/finally and on value blocks (`?.`, `||`,
 * ternaries) inside a try/catch statement.
 */
function runOp(op: () => Promise<void>, errorPrefix: string, onError: (msg: string | null) => void): void {
  op().catch((err: unknown) => onError(errorPrefix + (err instanceof Error ? err.message : String(err))));
}

interface AttachFolderContentsProps {
  entries: FileEntry[];
  level: number;
  onNavigate: (path: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onSaveSettings: () => void;
  onPasteIntoFolder?: (folderPath: string) => void;
}

/**
 * Recursively renders the contents of an attachment folder (a sibling folder
 * whose name ends with the ATTACH_SUFFIX convention). Entries are indented by
 * `level` so they visually nest under their parent markdown file. Directories
 * inside the attachment folder are rendered recursively; files are dispatched
 * to the appropriate entry component by type.
 */
function AttachFolderContents({ entries, level, onNavigate, onRename, onDelete, onSaveSettings, onPasteIntoFolder }: AttachFolderContentsProps) {
  const items = useAS(s => s.items);
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
          ) : isPdfFile(entry.name) ? (
            <PDFEntry entry={entry} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : (
            <GenericEntry entry={entry} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Every selection/cut flag BrowseView needs, in a single pass over the item
 * map. The map is rebuilt on each store write — including every keystroke in
 * edit mode — so separate `.some()`/`.filter()` scans would each walk the
 * whole folder again per render.
 *
 * Deliberately reports nothing about edit state: the map is global and holds
 * items from every folder visited this session, so a "something is editing"
 * flag derived here would stay true after navigating away from the file being
 * edited. Nothing in this view is edit-driven any more — a maximized editor
 * lives only in BrowseFile — so don't add one back.
 *
 * `selectedItems` keeps the map's insertion order, matching what the previous
 * `Array.from(items.values()).filter(...)` produced.
 */
function summarizeItems(items: Map<string, ItemData>) {
  const selectedItems: ItemData[] = [];
  let selectedFileCount = 0;
  let hasSelectedFolders = false;
  let hasCutItems = false;

  for (const item of items.values()) {
    if (item.isSelected) {
      selectedItems.push(item);
      if (item.isDirectory) hasSelectedFolders = true;
      else selectedFileCount++;
    }
    if (item.isCut) hasCutItems = true;
  }

  return {
    selectedItems,
    hasSelectedItems: selectedItems.length > 0,
    selectedFileCount,
    hasSelectedFolders,
    hasCutItems,
  };
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

/**
 * The primary file-browser view. Renders the current folder's entries as a
 * vertical list of typed entry components (markdown, image, text, folder, etc.)
 * and provides the full toolbar: search, sort, create, cut/paste, export, OCR,
 * AI chat, calendar, and folder graph/analysis. Scroll position is saved per
 * folder and restored on navigation. In index-ordered (document) mode the sort
 * menu is hidden and inline IndexInsertBars replace the create buttons.
 */
function BrowseView({ entries, loading, aiEnabled, lastExportFolder, onSetLastExportFolder, onRefreshDirectory, onSetError, onSaveSettings }: BrowseViewProps) {
  const rootPath = useAS(s => s.rootPath);
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

  const hasIndexFile = useAS(s => s.hasIndexFile);

  const items = useAS(s => s.items);
  const currentView = useAS(s => s.currentView);
  const currentPath = useAS(s => s.currentPath);

  // Detect whether the current folder uses index ordering, and load the yaml into the store
  useEffect(() => {
    // A slow readIndexYaml can resolve after navigation (or after a newer run
    // for the same folder), so its write is gated on this run still being the
    // latest — otherwise a stale folder's yaml overwrites the current one.
    // On navigation, currentPath changes a render before the new folder's
    // entries arrive, so this can run with the OLD folder's entries paired
    // with the NEW path — computing hasIndex from the wrong folder and
    // fetching/flushing indexYaml against it. Skip such desynced runs; the
    // effect re-runs once the matching entries land. An empty listing carries
    // no path evidence, but hasIndex is necessarily false then, same as before.
    const firstEntry = entries[0];
    if (firstEntry && !isSamePath(getParentPath(firstEntry.path), currentPath)) return;
    let ignore = false;
    const hasIndex = entries.some((e) => e.indexOrder !== undefined);
    setHasIndexFile(hasIndex);
    if (hasIndex && currentPath) {
      void api.readIndexYaml(currentPath).then((yaml) => {
        if (ignore) return;
        setIndexYaml(yaml);
      });
    } else {
      setIndexYaml(null);
    }
    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the ignore flag so the pending readIndexYaml() promise can't set state after unmount/re-run.
    return () => {
      ignore = true;
    };
  }, [entries, currentPath]);

  // Reconcile on folder navigation only (not on every file-operation refresh)
  useEffect(() => {
    if (!currentPath) return;
    void api.reconcileIndexedFiles(currentPath, false);
  }, [currentPath]);
  const pendingScrollToFile = useAS(s => s.pendingScrollToFile);
  const pendingScrollToHeadingSlug = useAS(s => s.pendingScrollToHeadingSlug);
  const pendingEditFile = useAS(s => s.pendingEditFile);
  const pendingEditView = useAS(s => s.pendingEditView);
  const pendingExpandFile = useAS(s => s.pendingExpandFile);
  const settings = useAS(s => s.settings);
  const expansionCounts = useExpansionCounts();

  const showExpandAll = expansionCounts.totalCount > 0 && expansionCounts.expandedCount < expansionCounts.totalCount;
  const showCollapseAll = expansionCounts.totalCount > 0 && expansionCounts.collapsedCount < expansionCounts.totalCount;

  const uncutEntries = entries.filter((entry) => !items.get(entry.path)?.isCut);
  const entriesWithCurrentTimes = uncutEntries.map((entry) => {
    const item = items.get(entry.path);
    if (item && (item.modifiedTime !== entry.modifiedTime || item.createdTime !== entry.createdTime)) {
      return { ...entry, modifiedTime: item.modifiedTime, createdTime: item.createdTime };
    }
    return entry;
  });
  const sortedEntries = hasIndexFile
    ? [...entriesWithCurrentTimes].sort((a, b) => {
        const aOrder = a.indexOrder ?? Infinity;
        const bOrder = b.indexOrder ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      })
    : sortEntries(entriesWithCurrentTimes, settings.sortOrder, settings.foldersOnTop);

  // This view renders a folder listing and nothing else. Expanded ("maximized")
  // editing used to live here too, as a class chain that turned this same
  // container into a nested flex column around the one entry being edited —
  // a dual-purpose <div> whose styling meant two different things. It is now
  // BrowseFile's job exclusively: starting an edit with the expandedEditor
  // preference on enters single-file mode (see store/expandedEdit.ts), which
  // swaps this component out entirely. Inline editing here is unchanged.

  const allImages = sortedEntries.filter((entry) => !entry.isDirectory && isImageFile(entry.name));

  const { selectedItems, hasSelectedItems, selectedFileCount, hasSelectedFolders, hasCutItems } =
    summarizeItems(items);

  const previousPathRef = useRef<string | null>(null);
  const mainContainerRef = useRef<HTMLElement | null>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  // Consumes pendingScrollToFile before the browser paints the commit that
  // renders the target entry, so the listing never appears at the wrong scroll
  // offset first. Everything else that has to wait for the DOM (the heading
  // scroll, the per-folder position restore, pending edit/expand) stays in the
  // passive effect below, where a frame of delay is invisible anyway.
  usePendingItemScroll();

  // Restore scroll position on folder navigation, and handle the remaining
  // pending requests once the directory has loaded
  useEffect(() => {
    if (loading) return;

    // Skip browser scroll handling when not in browser view — ThreadView
    // manages its own scrolling and we don't want to interfere.
    if (currentView !== 'browser') {
      // Keep the tracked folder in sync so returning to this tab isn't mistaken
      // for a folder navigation (which would save a scrollTop belonging to a
      // listing that is no longer rendered). Deliberately leaves a null ref
      // null: this component can mount while another tab is active, and that
      // mount still owes a scroll restore — see isFirstMount below.
      if (previousPathRef.current !== null) previousPathRef.current = currentPath;
      return;
    }

    // Detect folder navigation within the browser tab. BrowseView stays
    // mounted across tab switches (visibility is toggled via CSS), so its
    // scroll position is preserved natively when switching tabs — we only
    // need to save/restore per folder when navigating between folders.
    const isNewFolder = previousPathRef.current !== null && previousPathRef.current !== currentPath;

    // A fresh mount also has to restore, because this component really does get
    // unmounted and remounted: single-file mode (browsing one file, and
    // expanded editing) swaps it out for BrowseFile rather than hiding it. The
    // position was last written by the debounced scroll save, so it comes back
    // accurate to within 150ms. At app startup nothing is saved yet and the
    // restore is a harmless scrollTo(0).
    const isFirstMount = previousPathRef.current === null;

    // Save scroll position for the previous folder before switching
    if (isNewFolder && previousPathRef.current && mainContainerRef.current) {
      setBrowserScrollPosition(previousPathRef.current, mainContainerRef.current.scrollTop);
    }

    previousPathRef.current = currentPath;

    // All timers are cleared on re-run, so a superseded run's timer can't fire
    // with values the user has since navigated away from. Each pending flag is
    // cleared only by the timer that consumes it, so when a flag-clear re-runs
    // this effect and the cleanup cancels a sibling timer, that sibling's flag
    // is still set and the next run reschedules it — nothing is lost.
    let editTimer: ReturnType<typeof setTimeout> | undefined;

    // Short timeout just for DOM to settle after React render
    const settleTimer = setTimeout(() => {
      // Nothing here consumes pendingScrollToFile: that request is handled
      // pre-paint by usePendingItemScroll (a layout effect), which is what
      // keeps the listing from ever painting at the wrong offset. It is still
      // read here as a gate, because both branches below would fight a scroll
      // that has not landed yet — and consuming it re-runs this effect, so
      // neither branch is missed.
      if (!pendingScrollToFile) {
        if (pendingScrollToHeadingSlug) {
          // Set alongside pendingScrollToFile; reached once that file scroll has
          // succeeded and consumed its flag. Fire-and-forget: the scroller
          // itself polls for the heading to render (no fixed delay) and keeps it
          // centered while late-loading content reflows the page, self-cancelling
          // on user input / element removal / timeout — so it deliberately isn't
          // tied to this effect's cleanup, and the flag is consumed immediately.
          scrollElementIntoView(pendingScrollToHeadingSlug, true);
          clearPendingScrollToHeadingSlug();
        } else if (isNewFolder || isFirstMount) {
          // Restore the saved scroll position for the folder we navigated to (or
          // the one we were already in, when remounting).
          const savedPosition = getBrowserScrollPosition(currentPath);
          const mainContainer = mainContainerRef.current;
          if (mainContainer) {
            mainContainer.scrollTo({ top: savedPosition, behavior: 'instant' });
          }
        }
      }

      // Handle pending edit (e.g., from search results edit button, or a "New
      // File" from the index tree). The item only enters the store once the load
      // for its folder has finished, and this effect can fire before that when
      // the request came with a navigation to a *different* folder — so wait for
      // the item rather than consuming the request against a missing one (which
      // would silently drop the edit). Once the pending file's folder is no
      // longer the one being browsed it can never arrive, so drop it then.
      if (pendingEditFile && pendingEditView === 'browser') {
        const editFile = pendingEditFile;
        if (useAS.getState().items.has(editFile)) {
          editTimer = setTimeout(() => {
            setItemExpanded(editFile, true);
            setItemEditing(editFile, true);
            clearPendingEditFile();
          }, 100);
        } else if (!isSamePath(getParentPath(editFile), currentPath)) {
          clearPendingEditFile();
        }
      }

      // Handle pending expand (e.g., a file pasted from the clipboard). The item
      // only enters the store once the refresh that created it has loaded, so —
      // like the pending scroll above — consume the request only when it's there,
      // and let a later run of this effect handle it otherwise.
      if (pendingExpandFile && useAS.getState().items.has(pendingExpandFile)) {
        setItemExpanded(pendingExpandFile, true);
        clearPendingExpandFile();
      }
    }, 100);

    // Returns the useEffect cleanup (an unsubscribe-style teardown): clears the pending settle/edit timeouts on unmount / before re-run.
    return () => {
      clearTimeout(settleTimer);
      if (editTimer !== undefined) clearTimeout(editTimer);
    };
  }, [loading, pendingScrollToFile, pendingScrollToHeadingSlug, pendingEditFile, pendingEditView, pendingExpandFile, currentPath, currentView]);

  /** Derives a default export file name from the current folder name. */
  const generateExportFileName = (currentPath: string | null): string => {
    if (!currentPath) return 'export.md';
    const folderName = getFileName(currentPath);
    return `${folderName}-export.md`;
  };


  // No expanded-editing scroll bookkeeping lives here any more. Entering a
  // maximized edit used to shrink this listing to a single row in place, which
  // destroyed the scroll position and needed a save/restore pair to repair.
  // Now it swaps the whole component out for BrowseFile, and the position is
  // restored on remount by the effect above like any other navigation.

  // Handle scroll events on the main container (debounced save)
  const handleMainScroll = (e: React.UIEvent<HTMLElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollSaveTimerRef.current) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = setTimeout(() => {
      if (currentPath) {
        setBrowserScrollPosition(currentPath, scrollTop);
      }
    }, 150);
  };

  // Clear any pending debounced save on unmount (full app teardown / closing
  // the folder). BrowseView no longer unmounts on tab switches, so there is no
  // view-switch scroll position to flush here.
  useEffect(() => {
    // Returns the useEffect cleanup (an unsubscribe-style teardown): clears the pending debounced scroll-save timeout on unmount.
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
      }
    };
  }, []);

  // The reconcile-then-refresh handlers below are fire-and-forget (bound to a
  // button click and passed to entry onRename/onDelete props, all `() => void`),
  // so they use the sync-signature convention and report failures through
  // onSetError via runOp rather than leaking an unhandled rejection.
  const handleRefresh = () => {
    runOp(async () => {
      if (currentPath && hasIndexFile) {
        await api.reconcileIndexedFiles(currentPath, false);
      }
      onRefreshDirectory();
    }, 'Failed to refresh folder: ', onSetError);
  };

  // Rename/delete completion needs the identical reconcile-then-refresh; keep the
  // names for call-site readability.
  const handleEntryRename = handleRefresh;
  const handleEntryDelete = handleRefresh;

  const handleMoveEntry = (name: string, direction: 'up' | 'down') => {
    if (!currentPath) return;
    runOp(async () => {
      await api.moveInIndexYaml(currentPath, name, direction);
      onRefreshDirectory();
    }, 'Failed to move item: ', onSetError);
  };

  const handleMoveEntryToEdge = (name: string, edge: 'top' | 'bottom') => {
    if (!currentPath) return;
    runOp(async () => {
      await api.moveToEdgeInIndexYaml(currentPath, name, edge);
      onRefreshDirectory();
    }, 'Failed to move item: ', onSetError);
  };

  const doPasteIntoFolder = (folderPath: string) => {
    runOp(async () => {
      await pasteIntoFolder(folderPath, items, onSetError, onRefreshDirectory);
    }, 'Failed to paste into folder: ', onSetError);
  };

  const doPasteAsAttachment = (filePath: string) => {
    runOp(async () => {
      const attachFolderPath = await ensureAttachFolder(filePath);
      if (!attachFolderPath) return;
      await pasteIntoFolder(attachFolderPath, items, onSetError, onRefreshDirectory);
    }, 'Failed to paste as attachment: ', onSetError);
  };

  const doPasteClipboardAsAttachment = (filePath: string) => {
    runOp(async () => {
      const attachFolderPath = await ensureAttachFolder(filePath);
      if (!attachFolderPath) return;
      await pasteFromClipboardOp(attachFolderPath, onRefreshDirectory, onSetError);
    }, 'Failed to paste as attachment: ', onSetError);
  };

  const performDelete = () => {
    runOp(async () => {
      await deleteSelected(selectedItems, currentPath, hasIndexFile, onSetError, onRefreshDirectory, () => setShowDeleteConfirm(false));
    }, 'Failed to delete: ', onSetError);
  };

  const handleSplitFile = () => {
    if (!currentPath) return;
    runOp(async () => {
      await splitSelectedFile(currentPath, selectedItems, hasIndexFile, onSetError, onRefreshDirectory);
    }, 'Failed to split file: ', onSetError);
  };

  const handleJoinFiles = () => {
    if (!currentPath) return;
    runOp(async () => {
      await joinSelectedFiles(currentPath, selectedItems, hasIndexFile, onSetError, onRefreshDirectory);
    }, 'Failed to join files: ', onSetError);
  };

  /**
   * Marks selected items as cut. If any selected file has a sibling attachment
   * folder that was not also selected, prompts the user to confirm cutting the
   * file without its attachments before proceeding.
   */
  const handleCutClick = () => {
    const hasOrphanedAttachment = sortedEntries.some((entry) => {
      if (entry.isDirectory || !items.get(entry.path)?.isSelected) return false;
      const attachName = `${entry.name}${ATTACH_SUFFIX}`;
      const attachEntry = sortedEntries.find((e) => e.name === attachName);
      return attachEntry !== undefined && !items.get(attachEntry.path)?.isSelected;
    });
    if (hasOrphanedAttachment) {
      setShowCutOrphanAttachConfirm(true);
    } else {
      cutSelectedItems();
    }
  };

  const handleExport = ({ outputFolder, fileName, includeSubfolders, includeFilenames, includeDividers, exportToPdf }: ExportOptions) => {
    if (!currentPath) return;

    setShowExportDialog(false);
    onSetError(null);

    runOp(async () => {
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
    }, 'Failed to export folder contents: ', onSetError);
  };

  const handleCancelExport = () => {
    setShowExportDialog(false);
  };

  const handleOpenCreateDialog = () => {
    setInsertAtIndex(null);
    setCreateFileDefaultName('');
    setShowCreateDialog(true);
  };

  // No longer used — kept for reference in case we return to prompting users for a file name during document mode editing
  const _handleInsertFileAt_legacy = (insertIndex: number) => {
    setInsertAtIndex(insertIndex);
    setCreateFileDefaultName('');
    setShowCreateDialog(true);
  };

  const handleInsertFileAt = (insertIndex: number) => {
    const fileName = generateTimestampFileName();
    runOp(async () => {
      await createFileOp(fileName, currentPath, insertIndex, sortedEntries, onRefreshDirectory, onSetError, () => {
        setShowCreateDialog(false);
        setCreateFileDefaultName('');
        setInsertAtIndex(null);
      });
    }, 'Failed to create file: ', onSetError);
  };

  const handleCreateFile = (fileName: string) => {
    runOp(async () => {
      await createFileOp(fileName, currentPath, insertAtIndex, sortedEntries, onRefreshDirectory, onSetError, () => {
        setShowCreateDialog(false);
        setCreateFileDefaultName('');
        setInsertAtIndex(null);
      });
    }, 'Failed to create file: ', onSetError);
  };

  const handleCancelCreate = () => {
    setShowCreateDialog(false);
    setCreateFileDefaultName('');
    setInsertAtIndex(null);
  };

  const handleOpenCreateFolderDialog = () => {
    setInsertAtIndex(null);
    setCreateFolderDefaultName('');
    setShowCreateFolderDialog(true);
  };

  const handleInsertFolderAt = (insertIndex: number) => {
    setInsertAtIndex(insertIndex);
    setCreateFolderDefaultName('');
    setShowCreateFolderDialog(true);
  };

  const handleCreateFolder = (folderName: string) => {
    runOp(async () => {
      await createFolderOp(folderName, currentPath, insertAtIndex, sortedEntries, onRefreshDirectory, onSetError, () => {
        setShowCreateFolderDialog(false);
        setCreateFolderDefaultName('');
        setInsertAtIndex(null);
      });
    }, 'Failed to create folder: ', onSetError);
  };

  const handleCancelCreateFolder = () => {
    setShowCreateFolderDialog(false);
    setCreateFolderDefaultName('');
    setInsertAtIndex(null);
  };

  const handleOpenSearchDialog = () => {
    setSearchDialogInitialValues(undefined);
    setShowSearchDialog(true);
  };

  const handleSearch = (options: SearchOptions) => {
    if (!currentPath) return;

    setShowSearchDialog(false);

    runOp(async () => {
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
          calendarItemsOnly: options.calendarItemsOnly,
        };
        await saveSearchDefinitionToConfig(definition);
      }

      // Decode {{nl}} tokens back to spaces for actual search execution
      const searchQuery = options.query.replace(/\{\{nl\}\}/g, ' ');

      const results = await api.searchFolder(currentPath, searchQuery, options.searchType, options.searchMode, options.searchImageExif, options.mostRecent, options.calendarItemsOnly);
      setSearchResults(results, options.query, currentPath, options.sortBy, options.sortDirection, options.searchName || '');
      setCurrentView('search-results');
    }, 'Search failed: ', onSetError);
  };

  const handleCancelSearch = () => {
    setShowSearchDialog(false);
    setSearchDialogInitialValues(undefined);
  };

  const handleReplace = (searchText: string, replaceText: string) => {
    if (!currentPath) return;

    setShowReplaceDialog(false);

    runOp(async () => {
      const results = await api.searchAndReplace(currentPath, searchText, replaceText);
      setReplaceResultMessage(buildReplaceResultMessage(results));
      const totalReplacements = results.filter((r) => r.success).reduce((sum, r) => sum + r.replacementCount, 0);
      if (totalReplacements > 0) {
        onRefreshDirectory();
      }
    }, 'Replace failed: ', setReplaceResultMessage);
  };

  const handleCancelReplace = () => {
    setShowReplaceDialog(false);
  };

  const handleSaveSearchDefinition = (options: SearchOptions) => {
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
      calendarItemsOnly: options.calendarItemsOnly,
    };
    runOp(async () => {
      await saveSearchDefinitionToConfig(definition);
    }, 'Failed to save search: ', onSetError);
  };

  const handleDeleteSearchDefinition = (name: string) => {
    runOp(async () => {
      await deleteSearchDefinitionFromConfig(name);
    }, 'Failed to delete search: ', onSetError);
  };

  const handlePasteFromClipboard = () => {
    runOp(async () => {
      await pasteFromClipboardOp(currentPath, onRefreshDirectory, onSetError);
    }, 'Failed to paste from clipboard: ', onSetError);
  };

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const handleRunOcr = () => {
    if (!currentPath) return;
    void runOcr(currentPath, settings.ocrToolsFolder, items, onSetError);
  };

  const handleCopyLink = () => {
    const paths = selectedItems.map((item) => item.path);
    setSelectedLinkItems(paths);
    clearAllSelections();
  };

  const handleSelectSortOrder = (order: Parameters<typeof setSortOrder>[0]) => {
    setSortOrder(order);
    void onSaveSettings();
  };

  const handleEnableCustomOrdering = () => {
    if (!currentPath) return;
    runOp(async () => {
      const result = await api.reconcileIndexedFiles(currentPath, true);
      if (!result.success) {
        onSetError(result.error || 'Failed to enable custom ordering');
        return;
      }
      onRefreshDirectory();
    }, 'Failed to enable custom ordering: ', onSetError);
  };

  const handleRunSearch = (definition: SearchDefinition) => {
    if (!currentPath) return;
    void (async () => {
      const searchQuery = definition.searchText.replace(/\{\{nl\}\}/g, ' ');
      const results = await api.searchFolder(
        currentPath,
        searchQuery,
        definition.searchMode,
        definition.searchTarget,
        definition.searchImageExif,
        definition.mostRecent,
        definition.calendarItemsOnly
      );
      setSearchResults(results, definition.searchText, currentPath, definition.sortBy, definition.sortDirection, definition.name);
      setCurrentView('search-results');
    })();
  };

  const handleEditSearch = (definition: SearchDefinition) => {
    setCurrentView('browser');
    setSearchDialogInitialValues({
      searchQuery: definition.searchText,
      searchName: definition.name,
      searchType: definition.searchMode,
      searchMode: definition.searchTarget,
      sortBy: definition.sortBy,
      sortDirection: definition.sortDirection,
      searchImageExif: definition.searchImageExif,
      mostRecent: definition.mostRecent,
      calendarItemsOnly: definition.calendarItemsOnly,
    });
    setShowSearchDialog(true);
  };

  const handleSelectAll = () => {
    const currentFolderPaths = entries.map((entry) => entry.path);
    selectItemsByPaths(currentFolderPaths);
  };

  const handleFolderAnalysis = () => {
    if (!currentPath) return;
    runOp(async () => {
      const result = await api.analyzeFolderHashtags(currentPath);
      setFolderAnalysis({
        hashtags: result.hashtags,
        folderPath: currentPath,
        totalFiles: result.totalFiles,
      });
      setCurrentView('folder-analysis');
    }, 'Failed to analyze folder: ', onSetError);
  };

  const handleFolderGraph = () => {
    if (!currentPath) return;
    runOp(async () => {
      const result = await api.scanFolderTree(currentPath);
      setFolderGraph({
        folderPath: result.folderPath,
        nodes: result.nodes.map(n => ({ ...n })),
        links: result.links.map(l => ({ ...l })),
        truncated: result.truncated,
        foldersOnly: result.foldersOnly,
      });
      setCurrentView('folder-graph');
    }, 'Failed to scan folder graph: ', onSetError);
  };

  const handleShowCalendar = () => {
    if (!currentPath) return;
    showTab('calendar');
    setCurrentView('calendar');
    setCalendarSource({ kind: 'folder', folder: currentPath });
    setCalendarLoading(true);
    runOp(async () => {
      const results = await api.loadCalendarEvents(currentPath);
      setCalendarEvents(toCalendarEvents(results));
    }, 'Failed to load calendar: ', (msg) => {
      onSetError(msg);
      setCalendarEvents([]);
    });
  };

  /**
   * Starts a new AI conversation in the current folder by creating a HUMAN.md
   * turn file via the `replyToAi` IPC call, then navigates to the thread view
   * and opens the new file for editing. Prevents creating a second conversation
   * when one already exists in the folder.
   */
  const newAiChat = () => {
    if (!currentPath) return;
    if (hasHumanMd(entries)) {
      onSetError('This folder already contains an AI conversation. Please navigate to a different folder to start a new chat.');
      return;
    }
    runOp(async () => {
      const result = await api.replyToAi(currentPath, false);
      if ('error' in result) {
        onSetError('Failed to create AI chat: ' + result.error);
      } else {
        const view = 'thread';
        navigateToBrowserPath(result.folderPath, `${result.folderPath}/HUMAN.md`, view);
        setPendingEditFile(result.filePath, view);
        // The new HUMAN.md is created directly in the current folder, so
        // currentPath doesn't change and BrowseView's load effect won't
        // re-fire on its own. Refresh explicitly so the file appears when
        // the user switches back to the browse view.
        onRefreshDirectory();
      }
    }, 'Failed to create AI chat: ', onSetError);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
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

          {/* Undo Cut button - shown whenever items are cut */}
          {hasCutItems && (
            <button
              type="button"
              onClick={() => clearAllCutItems()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
              title="Undo cut (cancel pending move)"
              data-testid="undo-cut-button"
            >
              Undo Cut
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
            onClick={handleRefresh}
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
        className="flex-1 min-h-0 pb-4 pt-1 pr-3 pl-3 relative overflow-y-auto"
      >
        <div className={getContentWidthClasses(settings.contentWidth)}>
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
              {hasIndexFile && !sortedEntries[0]?.name.endsWith(ATTACH_SUFFIX) && (
                <IndexInsertBar onInsertFile={() => handleInsertFileAt(0)} onInsertFolder={() => handleInsertFolderAt(0)} />
              )}
              {sortedEntries.map((entry, idx) => {
                const moveUp = hasIndexFile && idx > 0 ? () => handleMoveEntry(entry.name, 'up') : undefined;
                const moveDown = hasIndexFile && idx < sortedEntries.length - 1 ? () => handleMoveEntry(entry.name, 'down') : undefined;
                const moveToTop = hasIndexFile && idx > 0 ? () => handleMoveEntryToEdge(entry.name, 'top') : undefined;
                const moveToBottom = hasIndexFile && idx < sortedEntries.length - 1 ? () => handleMoveEntryToEdge(entry.name, 'bottom') : undefined;
                const prevEntry = sortedEntries[idx - 1];
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
                    ) : isPdfFile(entry.name) ? (
                      <PDFEntry entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                    ) : (
                      <GenericEntry entry={entry} onRename={handleEntryRename} onDelete={handleEntryDelete} onSaveSettings={onSaveSettings} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} />
                    )}
                    {hasIndexFile && !sortedEntries[idx + 1]?.name.endsWith(ATTACH_SUFFIX) && (
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
        />
      )}

      {showSearchMenu && (
        <SearchPopupMenu
          anchorRef={searchButtonRef}
          onClose={() => setShowSearchMenu(false)}
          searchDefinitions={settings.searchDefinitions}
          onNewSearch={handleOpenSearchDialog}
          onRunSearch={handleRunSearch}
          onEditSearch={handleEditSearch}
        />
      )}

      {showEditMenu && (
        <EditPopupMenu
          anchorRef={editButtonRef}
          onClose={() => setShowEditMenu(false)}
          onSelectAll={handleSelectAll}
          onUnselectAll={() => clearAllSelections()}
          onSplit={handleSplitFile}
          onJoin={handleJoinFiles}
          onReplaceInFiles={() => setShowReplaceDialog(true)}
          onCopyLink={handleCopyLink}
          unselectAllDisabled={selectedFileCount === 0 && !hasSelectedFolders}
          splitDisabled={selectedFileCount !== 1 || hasSelectedFolders}
          joinDisabled={selectedFileCount < 2 || hasSelectedFolders}
          copyLinkDisabled={!hasSelectedItems}
          onEnableCustomOrdering={!hasIndexFile && currentPath ? handleEnableCustomOrdering : undefined}
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
          message={`Move ${selectedItems.length} selected item(s) to trash?`}
          onConfirm={performDelete}
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
