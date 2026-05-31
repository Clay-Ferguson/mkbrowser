import { useState } from 'react';
import { ArrowTopRightOnSquareIcon, TrashIcon, BookmarkIcon as BookmarkOutlineIcon, ArrowUpIcon, ArrowDownIcon, ViewfinderCircleIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { BUTTON_CLASS_NORMAL, BUTTON_CLASS_CYAN, BUTTON_CLASS_RED, BUTTON_CLASS_BLUE } from '../../../utils/styles';
import { toggleBookmark, addBookmark, toggleItemExpanded, useHasIndexFile, useIndexYaml, useSettings, setPendingIndexTreeReveal, setHighlightItem } from '../../../store';
import BookmarkDialog from '../../dialogs/BookmarkDialog';

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
  /** When provided, shows a clipboard paste button that pastes clipboard content as an attachment */
  onPasteClipboardAsAttachment?: () => void;
  /** Whether this entry is a folder (affects bookmark default name) */
  isFolder?: boolean;
}

/**
 * Reusable action button bar for Entry components.
 * Renders insert, edit, rename, open-external, delete, and bookmark buttons.
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
  const showEditActions = true;
  const settings = useSettings();
  const [showBookmarkDialog, setShowBookmarkDialog] = useState(false);

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.electronAPI.openExternal(path);
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
      <div className="opacity-0 pointer-events-none [transition:opacity_150ms_ease] group-hover:opacity-100 group-hover:pointer-events-auto group-hover:[transition:opacity_200ms_ease_400ms] flex items-center gap-1">
      {showEditActions && (
        <button
          onClick={onDeleteClick}
          disabled={deleting}
          className={BUTTON_CLASS_RED}
          title="Delete"
          data-testid="entry-delete-button"
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      )}
      <button
        onClick={handleOpenExternal}
        className={BUTTON_CLASS_CYAN}
        title="Open with OS App"
        data-testid="entry-open-external-button"
      >
        <ArrowTopRightOnSquareIcon className="w-5 h-5" />
      </button>
      {!isAttachment && settings.indexTreeWidth !== 'hidden' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setHighlightItem(path);
            setPendingIndexTreeReveal(path);
          }}
          className={BUTTON_CLASS_BLUE}
          title="Reveal in folder tree"
          data-testid="entry-reveal-button"
        >
          <ViewfinderCircleIcon className="w-5 h-5" />
        </button>
      )}
      <button
        onClick={handleBookmarkClick}
        className={BUTTON_CLASS_BLUE}
        title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
        data-testid="entry-bookmark-button"
      >
        {isBookmarked ? (
          <BookmarkSolidIcon className="w-5 h-5 text-blue-400" />
        ) : (
          <BookmarkOutlineIcon className="w-5 h-5" />
        )}
      </button>
      {onPasteClipboardAsAttachment && (
        <button
          onClick={(e) => { e.stopPropagation(); onPasteClipboardAsAttachment(); }}
          className={BUTTON_CLASS_BLUE}
          title="Paste Clipboard as Attachment under this file"
          data-testid="entry-paste-clipboard-attachment-button"
        >
          <ClipboardDocumentIcon className="w-5 h-5" />
        </button>
      )}
      {showEditActions && onMoveUp && (
        <button
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
      {showEditActions && onMoveDown && (
        <button
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
      </div>
    </div>
    </>
  );
}

/**
 * Utility to create a toggle expanded handler
 */
export function useToggleExpanded(path: string) {
  return () => toggleItemExpanded(path);
}
