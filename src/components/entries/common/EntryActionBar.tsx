import { PencilSquareIcon, PencilIcon, ArrowTopRightOnSquareIcon, TrashIcon, BookmarkIcon as BookmarkOutlineIcon, ArrowUpIcon, ArrowDownIcon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { BUTTON_CLZ_RENAME, BUTTON_CLZ_OPEN_EXTERNAL, BUTTON_CLZ_DELETE, BUTTON_CLZ_BOOKMARK } from '../../../utils/styles';
import { toggleBookmark, toggleItemExpanded, useHasIndexFile, useIndexYaml, useSettings, setPendingIndexTreeReveal, setHighlightItem } from '../../../store';

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
  /** Whether to show an edit button (for editable files) */
  showEditButton?: boolean;
  /** Handler for edit button */
  onEditClick?: () => void;
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
}

/**
 * Reusable action button bar for Entry components.
 * Renders insert, edit, rename, open-external, delete, and bookmark buttons.
 */
export function EntryActionBar({
  path,
  isBookmarked,
  deleting,
  onRenameClick,
  onDeleteClick,
  onSaveSettings,
  showEditButton = false,
  onEditClick,
  onMoveUp,
  onMoveDown,
  onMoveToTop,
  onMoveToBottom,
  className = '',
}: EntryActionBarProps) {
  const hasIndexFile = useHasIndexFile();
  const indexYaml = useIndexYaml();
  const editMode = indexYaml?.options?.edit_mode ?? false;
  const showEditActions = !hasIndexFile || editMode;
  const settings = useSettings();

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleBookmark(path);
    onSaveSettings();
  };

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.electronAPI.openExternal(path);
  };

  return (
    <div data-testid="entry-action-bar" className={`flex items-center gap-1 ${className}`}>
      <div className="opacity-0 pointer-events-none [transition:opacity_150ms_ease] group-hover:opacity-100 group-hover:pointer-events-auto group-hover:[transition:opacity_200ms_ease_400ms] flex items-center gap-1">
      {showEditActions && showEditButton && onEditClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEditClick();
          }}
          className={BUTTON_CLZ_RENAME}
          title="Edit content"
          data-testid="entry-edit-button"
        >
          <PencilSquareIcon className="w-5 h-5" />
        </button>
      )}
      {showEditActions && (
        <button
          onClick={onRenameClick}
          className={BUTTON_CLZ_RENAME}
          title="Rename"
          data-testid="entry-rename-button"
        >
          <PencilIcon className="w-5 h-5" />
        </button>
      )}
      {showEditActions && (
        <button
          onClick={onDeleteClick}
          disabled={deleting}
          className={BUTTON_CLZ_DELETE}
          title="Delete"
          data-testid="entry-delete-button"
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      )}
      <button
        onClick={handleOpenExternal}
        className={BUTTON_CLZ_OPEN_EXTERNAL}
        title="Open with OS App"
        data-testid="entry-open-external-button"
      >
        <ArrowTopRightOnSquareIcon className="w-5 h-5" />
      </button>
      {settings.indexTreeWidth !== 'hidden' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setHighlightItem(path);
            setPendingIndexTreeReveal(path);
          }}
          className={BUTTON_CLZ_BOOKMARK}
          title="Reveal in folder tree"
          data-testid="entry-reveal-button"
        >
          <ViewfinderCircleIcon className="w-5 h-5" />
        </button>
      )}
      <button
        onClick={handleBookmarkClick}
        className={BUTTON_CLZ_BOOKMARK}
        title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
        data-testid="entry-bookmark-button"
      >
        {isBookmarked ? (
          <BookmarkSolidIcon className="w-5 h-5 text-blue-400" />
        ) : (
          <BookmarkOutlineIcon className="w-5 h-5" />
        )}
      </button>
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
          className={BUTTON_CLZ_RENAME}
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
          className={BUTTON_CLZ_RENAME}
          title="Move down (Ctrl: move to bottom)"
          data-testid="entry-move-down-button"
        >
          <ArrowDownIcon className="w-5 h-5" />
        </button>
      )}
      </div>
    </div>
  );
}

/**
 * Utility to create a toggle expanded handler
 */
export function useToggleExpanded(path: string) {
  return () => toggleItemExpanded(path);
}
