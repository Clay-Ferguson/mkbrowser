import { useState, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  MagnifyingGlassIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon,
  ArrowPathIcon, WrenchIcon, Squares2X2Icon, BarsArrowDownIcon,
  FolderPlusIcon, DocumentPlusIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { runOp } from '../../renderer/runOp';
import ToolsPopupMenu from '../menus/ToolsPopupMenu';
import EditPopupMenu from '../menus/EditPopupMenu';
import SearchPopupMenu from '../menus/SearchPopupMenu';
import SortPopupMenu from '../menus/SortPopupMenu';
import PathBreadcrumb from '../PathBreadcrumb';
import {
  clearAllSelections,
  selectItemsByPaths,
  expandAllItems,
  collapseAllItems,
  clearAllCutItems,
  cutSelectedItems,
  setCurrentPath,
  setCurrentView,
  setSortOrder,
  useExpansionCounts,
  setSelectedLinkItems,
  useAS,
  type ItemData,
  type SearchDefinition,
} from '../../store';
import { BUTTON_CLASS_BAR_BLUE, BUTTON_CLASS_BAR_RED, BUTTON_CLASS_TB_AMBER, BUTTON_CLASS_TB_BLUE, BUTTON_CLASS_TB_NORMAL } from '../../renderer/styles';
import { runSearch } from '../../renderer/searchUtil';
import { saveSettings } from '../../renderer/config';
import { splitSelectedFile, joinSelectedFiles, pasteFromClipboardOp, runOcr } from '../../renderer/fileOpsUtil';
import { showFolderCalendar } from '../../renderer/calendarNav';
import { showFolderAnalysis, showFolderGraph } from '../../renderer/folderToolsOp';
import { enableCustomOrdering } from '../../renderer/indexOrderOp';
import { startAiChat } from '../../renderer/aiChatOp';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';
import type { BrowseOverlay } from './browseOverlay';
import { getSelectedItems } from './browseListing';

type MenuKind = 'tools' | 'edit' | 'search' | 'sort';

/**
 * Every selection/cut flag the toolbar renders, in a single pass over the item
 * map. Primitives only, selected with `useShallow`, so a store write that
 * doesn't change any of them — e.g. every debounced keystroke in an inline
 * editor, which builds a new Map — doesn't re-render the toolbar. Handlers that
 * need the selected items themselves read them at call time with
 * {@link getSelectedItems}.
 *
 * Deliberately reports nothing about edit state: the map is global and holds
 * items from every folder visited this session, so a "something is editing"
 * flag derived here would stay true after navigating away from the file being
 * edited. Nothing in this view is edit-driven any more — a maximized editor
 * lives only in BrowseFile — so don't add one back.
 */
function summarizeSelection(items: Map<string, ItemData>) {
  let selectedCount = 0;
  let selectedFileCount = 0;
  let hasSelectedFolders = false;
  let hasCutItems = false;

  for (const item of items.values()) {
    if (item.isSelected) {
      selectedCount++;
      if (item.isDirectory) hasSelectedFolders = true;
      else selectedFileCount++;
    }
    if (item.isCut) hasCutItems = true;
  }

  return { selectedCount, selectedFileCount, hasSelectedFolders, hasCutItems };
}

interface BrowseToolbarProps {
  /** Opens one of BrowseView's dialogs. */
  onOpenOverlay: (overlay: BrowseOverlay) => void;
  onRefresh: () => void;
  onPasteIntoFolder: (folderPath: string) => void;
}

/**
 * BrowseView's header: the breadcrumbs on the left, and on the right the
 * action buttons (cut/delete/paste, create, calendar, clipboard paste,
 * expand/collapse, refresh) plus the Edit, Tools, Sort and Search menus.
 *
 * The menus' open state lives here, next to the buttons they anchor to. The
 * dialogs those menus open live in BrowseView and are opened through
 * `onOpenOverlay`. A menu item runs its action before calling the menu's
 * onClose, but since the two are separate state, closing the menu never
 * closes the dialog its action just opened.
 */
function BrowseToolbar({ onOpenOverlay, onRefresh, onPasteIntoFolder }: BrowseToolbarProps) {
  const rootPath = useAS(s => s.rootPath);
  const currentPath = useAS(s => s.currentPath);
  const hasIndexFile = useAS(s => s.hasIndexFile);
  const sortOrder = useAS(s => s.settings.sortOrder);
  const searchDefinitions = useAS(s => s.settings.searchDefinitions);
  const expansionCounts = useExpansionCounts();
  const { selectedCount, selectedFileCount, hasSelectedFolders, hasCutItems } =
    useAS(useShallow(s => summarizeSelection(s.items)));
  const hasSelectedItems = selectedCount > 0;

  const showExpandAll = expansionCounts.totalCount > 0 && expansionCounts.expandedCount < expansionCounts.totalCount;
  const showCollapseAll = expansionCounts.totalCount > 0 && expansionCounts.collapsedCount < expansionCounts.totalCount;

  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  // A second click on a menu's own button closes it (PopupMenu ignores
  // mousedowns on its anchor, so only this click sees it). Clicking another
  // menu's button closes the first via PopupMenu's click-outside handling.
  const toggleMenu = (which: MenuKind) => {
    setOpenMenu((m) => (m === which ? null : which));
  };
  // Conditional, like BrowseView's closeOverlay, so a late close from one menu
  // can't close a different menu opened since.
  const closeMenu = (which: MenuKind) => {
    setOpenMenu((m) => (m === which ? null : m));
  };

  /**
   * Marks selected items as cut. If any selected file has a sibling attachment
   * folder that was not also selected, prompts the user to confirm cutting the
   * file without its attachments before proceeding.
   */
  const handleCutClick = () => {
    const { items, currentEntries } = useAS.getState();
    const hasOrphanedAttachment = currentEntries.some((entry) => {
      if (entry.isDirectory || !items.get(entry.path)?.isSelected) return false;
      const attachName = `${entry.name}${ATTACH_SUFFIX}`;
      const attachEntry = currentEntries.find((e) => e.name === attachName);
      return attachEntry !== undefined && !items.get(attachEntry.path)?.isSelected;
    });
    if (hasOrphanedAttachment) {
      onOpenOverlay({ kind: 'cutOrphanConfirm' });
    } else {
      cutSelectedItems();
    }
  };

  const handleSplitFile = () => {
    if (!currentPath) return;
    runOp(async () => {
      await splitSelectedFile(currentPath, getSelectedItems(useAS.getState().items), hasIndexFile);
    }, 'Failed to split file: ');
  };

  const handleJoinFiles = () => {
    if (!currentPath) return;
    runOp(async () => {
      await joinSelectedFiles(currentPath, getSelectedItems(useAS.getState().items), hasIndexFile);
    }, 'Failed to join files: ');
  };

  const handlePasteFromClipboard = () => {
    runOp(async () => {
      await pasteFromClipboardOp(currentPath);
    }, 'Failed to paste from clipboard: ');
  };

  const handleRunOcr = () => {
    if (!currentPath) return;
    void runOcr(currentPath, useAS.getState().settings.ocrToolsFolder, useAS.getState().items);
  };

  const handleCopyLink = () => {
    const paths = getSelectedItems(useAS.getState().items).map((item) => item.path);
    setSelectedLinkItems(paths);
    clearAllSelections();
  };

  const handleSelectSortOrder = (order: Parameters<typeof setSortOrder>[0]) => {
    setSortOrder(order);
    saveSettings();
  };

  const handleEditSearch = (definition: SearchDefinition) => {
    setCurrentView('browser');
    onOpenOverlay({ kind: 'search', definition });
  };

  const handleSelectAll = () => {
    const currentFolderPaths = useAS.getState().currentEntries.map((entry) => entry.path);
    selectItemsByPaths(currentFolderPaths);
  };

  return (
    <>
      <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">

        <div data-testid="browser-header-breadcrumbs" className="flex items-center gap-3 min-w-0">
          <PathBreadcrumb
            rootPath={rootPath}
            currentPath={currentPath}
            onNavigate={setCurrentPath}
          />
        </div>

        <div data-testid="browser-header-actions" className="flex-1 flex items-center justify-end gap-2">
          {/* Cut button - shown when items are selected and no items are cut */}
          {hasSelectedItems && !hasCutItems && (
            <button
              type="button"
              onClick={handleCutClick}
              className={BUTTON_CLASS_BAR_BLUE}
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
              onClick={() => onOpenOverlay({ kind: 'deleteConfirm', count: selectedCount })}
              className={BUTTON_CLASS_BAR_RED}
              title="Delete selected items"
              data-testid="delete-button"
            >
              Del
            </button>
          )}

          {/* Paste button - shown whenever items are cut; pastes into the folder being browsed */}
          {hasCutItems && currentPath && (
            <button
              type="button"
              onClick={() => onPasteIntoFolder(currentPath)}
              className={BUTTON_CLASS_BAR_BLUE}
              title="Paste cut items into this folder"
              data-testid="paste-button"
            >
              Paste
            </button>
          )}

          {/* Undo Cut button - shown whenever items are cut */}
          {hasCutItems && (
            <button
              type="button"
              onClick={() => clearAllCutItems()}
              className={BUTTON_CLASS_BAR_BLUE}
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
                onClick={() => onOpenOverlay({ kind: 'createFile', insertAt: null })}
                className={BUTTON_CLASS_TB_BLUE}
                title="Create file"
                data-testid="create-file-button"
              >
                <DocumentPlusIcon className="w-6 h-6 text-blue-400" />
              </button>
              <button
                type="button"
                onClick={() => onOpenOverlay({ kind: 'createFolder', insertAt: null })}
                className={BUTTON_CLASS_TB_AMBER}
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
            onClick={() => toggleMenu('edit')}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Edit"
            data-testid="edit-menu-button"
          >
            <Squares2X2Icon className="w-6 h-6" />
          </button>

          {/* Tools menu button */}
          <button
            type="button"
            ref={toolsButtonRef}
            onClick={() => toggleMenu('tools')}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Tools"
            data-testid="tools-menu-button"
          >
            <WrenchIcon className="w-6 h-6" />
          </button>

          {/* Calendar button */}
          <button
            type="button"
            onClick={() => { if (currentPath) showFolderCalendar(currentPath); }}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Show Calendar"
            data-testid="calendar-button"
          >
            <CalendarDaysIcon className="w-6 h-6" />
          </button>

          {/* Sort order menu button */}
          {!hasIndexFile && (<button
            type="button"
            ref={sortButtonRef}
            onClick={() => toggleMenu('sort')}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Sort order"
            data-testid="sort-menu-button"
          >
            <BarsArrowDownIcon className="w-6 h-6" />
          </button>)}

          {/* Paste from clipboard button */}
          <button
            type="button"
            onClick={handlePasteFromClipboard}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Paste from clipboard"
            data-testid="paste-clipboard-button"
          >
            <ClipboardIcon className="w-6 h-6" />
          </button>

          {/* Search button */}
          <button
            type="button"
            ref={searchButtonRef}
            onClick={() => toggleMenu('search')}
            className={BUTTON_CLASS_TB_NORMAL}
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
              className={BUTTON_CLASS_TB_NORMAL}
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
              className={BUTTON_CLASS_TB_NORMAL}
              title="Collapse all"
              data-testid="collapse-all-button"
            >
              <ChevronUpIcon className="w-6 h-6" />
            </button>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={onRefresh}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Refresh"
            data-testid="refresh-button"
          >
            <ArrowPathIcon className="w-6 h-6" />
          </button>

        </div>
      </header>

      {openMenu === 'sort' && !hasIndexFile && (
        <SortPopupMenu
          anchorRef={sortButtonRef}
          onClose={() => closeMenu('sort')}
          currentSortOrder={sortOrder}
          onSelectSortOrder={handleSelectSortOrder}
        />
      )}

      {openMenu === 'search' && (
        <SearchPopupMenu
          anchorRef={searchButtonRef}
          onClose={() => closeMenu('search')}
          searchDefinitions={searchDefinitions}
          onNewSearch={() => onOpenOverlay({ kind: 'search' })}
          onRunSearch={(definition) => { if (currentPath) runSearch(currentPath, definition); }}
          onEditSearch={handleEditSearch}
        />
      )}

      {openMenu === 'edit' && (
        <EditPopupMenu
          anchorRef={editButtonRef}
          onClose={() => closeMenu('edit')}
          onSelectAll={handleSelectAll}
          onUnselectAll={() => clearAllSelections()}
          onSplit={handleSplitFile}
          onJoin={handleJoinFiles}
          onReplaceInFiles={() => onOpenOverlay({ kind: 'replace' })}
          onCopyLink={handleCopyLink}
          unselectAllDisabled={selectedFileCount === 0 && !hasSelectedFolders}
          splitDisabled={selectedFileCount !== 1 || hasSelectedFolders}
          joinDisabled={selectedFileCount < 2 || hasSelectedFolders}
          copyLinkDisabled={!hasSelectedItems}
          onEnableCustomOrdering={!hasIndexFile && currentPath ? () => enableCustomOrdering(currentPath) : undefined}
        />
      )}

      {openMenu === 'tools' && (
        <ToolsPopupMenu
          anchorRef={toolsButtonRef}
          onClose={() => closeMenu('tools')}
          onFolderAnalysis={() => { if (currentPath) showFolderAnalysis(currentPath); }}
          onFolderGraph={() => { if (currentPath) showFolderGraph(currentPath); }}
          onExport={() => onOpenOverlay({ kind: 'export' })}
          onRunOcr={handleRunOcr}
          onNewAiChat={() => { if (currentPath) startAiChat(currentPath); }}
        />
      )}
    </>
  );
}

export default BrowseToolbar;
