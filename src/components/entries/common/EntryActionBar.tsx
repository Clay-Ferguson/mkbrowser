import { useRef, useState } from 'react';
import { Bars3Icon, TrashIcon, ArrowUpIcon, ArrowDownIcon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import { api } from '../../../renderer/api';
import { getParentPath, getFileName, joinPath } from '../../../renderer/pathUtil';
import { BUTTON_CLASS_NORMAL, BUTTON_CLASS_RED, BUTTON_CLASS_BLUE } from '../../../renderer/styles';
import { toggleBookmark, addBookmark, toggleItemExpanded, setCurrentView, useAS, setPendingIndexTreeReveal, setHighlightItem, setBrowseFile } from '../../../store';
import BookmarkDialog from '../../dialogs/BookmarkDialog';
import EntryPopupMenu from '../../menus/EntryPopupMenu';

interface EntryActionBarProps {
  /** Full path of the entry */
  path: string;
  /** Whether the item is bookmarked */
  isBookmarked: boolean;
  /** Whether delete is in progress */
  deleting: boolean;
  /** Handler to start renaming */
  onRenameClick: (e?: React.MouseEvent) => void;
  /** Handler to show delete confirmation */
  onDeleteClick: (e?: React.MouseEvent) => void;
  /** Handler to persist settings after bookmark toggle */
  onSaveSettings: () => void;
  /** Move up in .INDEX.yaml (only provided in indexed mode; undefined hides the button) */
  onMoveUp?: () => void;
  /** Move down in .INDEX.yaml (only provided in indexed mode; undefined hides the button) */
  onMoveDown?: () => void;
  /** Move to top of .INDEX.yaml (Ctrl+Move Up) */
  onMoveToTop?: () => void;
  /** Move to bottom of .INDEX.yaml (Ctrl+Move Down) */
  onMoveToBottom?: () => void;
  /** Extra className for the container */
  className?: string;
  /** When true, hides the "Reveal in folder tree" button */
  isAttachment?: boolean;
  /** When provided, adds a menu item that pastes clipboard content as an attachment */
  onPasteClipboardAsAttachment?: () => void;
  /** Whether this entry is a folder (affects bookmark default name) */
  isFolder?: boolean;
}

/**
 * Reusable action button bar rendered on hover over an entry. Shows icon
 * buttons for: delete, reveal in folder tree, and move up/down (only in
 * indexed/document mode, when the move handlers are provided), plus a trailing
 * hamburger button opening EntryPopupMenu — which holds the remaining actions
 * (open with OS app, view file, paste clipboard as attachment, bookmark) as
 * text items, so the hover bar doesn't grow unbounded.
 */
export function EntryActionBar({
  path,
  isBookmarked,
  deleting,
  onDeleteClick,
  onSaveSettings,
  onMoveUp,
  onMoveDown,
  onMoveToTop,
  onMoveToBottom,
  className = '',
  isAttachment = false,
  onPasteClipboardAsAttachment,
  isFolder = false,
}: EntryActionBarProps) {
  const settings = useAS(s => s.settings);
  const browseFileName = useAS(s => s.browseFileName);
  const currentPath = useAS(s => s.currentPath);
  const [showBookmarkDialog, setShowBookmarkDialog] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // In single-file browsing mode this exact file is already the one on screen,
  // so the "View File" button would be a no-op — hide it.
  const isViewingThisFile = browseFileName !== null && joinPath(currentPath, browseFileName) === path;

  // Removing a bookmark is immediate; adding one opens a dialog so the user can give it a name.
  const handleBookmarkClick = () => {
    if (isBookmarked) {
      toggleBookmark(path);
      onSaveSettings();
    } else {
      setShowBookmarkDialog(true);
    }
  };

  const handleBookmarkSave = (name: string) => {
    setShowBookmarkDialog(false);
    addBookmark(path, name);
    onSaveSettings();
  };

  const handleBookmarkCancel = () => {
    setShowBookmarkDialog(false);
  };

  const handleOpenExternal = () => {
    void api.openExternal(path);
  };

  // Switch to single-file browsing of this file — the same effect as clicking
  // the file's row in the index tree (see IndexTreeView's handleNodeClick).
  const handleViewFile = () => {
    setHighlightItem(path);
    setBrowseFile(getParentPath(path), getFileName(path));
  };

  return (
    <>
    {showBookmarkDialog && (
      <BookmarkDialog
        path={path}
        isFolder={isFolder}
        onSave={handleBookmarkSave}
        onCancel={handleBookmarkCancel}
      />
    )}
    <div data-testid="entry-action-bar" className={`flex items-center gap-1 ${className}`}>
      {/* While the popup menu is open the bar stays visible even if the pointer
          leaves the entry — otherwise the menu's own anchor would fade out from
          under it. */}
      <div className={showMenu
        ? 'opacity-100 pointer-events-auto flex items-center gap-1'
        : 'opacity-0 pointer-events-none [transition:opacity_150ms_ease] group-hover:opacity-100 group-hover:pointer-events-auto group-hover:[transition:opacity_200ms_ease_400ms] flex items-center gap-1'}>
      <button
        type="button"
        onClick={onDeleteClick}
        disabled={deleting}
        className={BUTTON_CLASS_RED}
        title="Delete"
        data-testid="entry-delete-button"
      >
        <TrashIcon className="w-5 h-5" />
      </button>
      {!isAttachment && settings.indexTreeWidth !== 'hidden' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHighlightItem(path);
            setCurrentView('browser');
            setPendingIndexTreeReveal(path);
          }}
          className={BUTTON_CLASS_BLUE}
          title="Reveal in folder tree"
          data-testid="entry-reveal-button"
        >
          <ViewfinderCircleIcon className="w-5 h-5" />
        </button>
      )}
      {onMoveUp && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (e.ctrlKey && onMoveToTop) {
              onMoveToTop();
            } else {
              onMoveUp();
            }
          }}
          className={BUTTON_CLASS_NORMAL}
          title="Move up (Ctrl: move to top)"
          data-testid="entry-move-up-button"
        >
          <ArrowUpIcon className="w-5 h-5" />
        </button>
      )}
      {onMoveDown && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (e.ctrlKey && onMoveToBottom) {
              onMoveToBottom();
            } else {
              onMoveDown();
            }
          }}
          className={BUTTON_CLASS_NORMAL}
          title="Move down (Ctrl: move to bottom)"
          data-testid="entry-move-down-button"
        >
          <ArrowDownIcon className="w-5 h-5" />
        </button>
      )}
      {/* Always last: the overflow menu for actions without a dedicated icon. */}
      <button
        ref={menuButtonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setShowMenu(prev => !prev); }}
        className={BUTTON_CLASS_NORMAL}
        title="More actions"
        aria-label="More actions"
        data-testid="entry-menu-button"
      >
        <Bars3Icon className="w-5 h-5" />
      </button>
      </div>
    </div>
    {/* Rendered outside the hover-fade wrapper (a display:contents pass-through,
        so it adds no layout) and with propagation stopped, so menu clicks don't
        reach the entry header's context-menu/expand handlers. */}
    {showMenu && (
      <div
        className="contents"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <EntryPopupMenu
          anchorRef={menuButtonRef}
          onClose={() => setShowMenu(false)}
          onOpenExternal={handleOpenExternal}
          onViewFile={isViewingThisFile ? undefined : handleViewFile}
          onPasteClipboardAsAttachment={onPasteClipboardAsAttachment}
          isBookmarked={isBookmarked}
          onToggleBookmark={handleBookmarkClick}
        />
      </div>
    )}
    </>
  );
}

/**
 * Returns a callback that toggles the expanded state of the entry at `path` in the store.
 * Used by all entry types to wire the name-click handler.
 */
export function useToggleExpanded(path: string) {
  return () => toggleItemExpanded(path);
}
