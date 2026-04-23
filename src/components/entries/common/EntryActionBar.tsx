import { PencilSquareIcon, PencilIcon, ArrowTopRightOnSquareIcon, TrashIcon, BookmarkIcon as BookmarkOutlineIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { BUTTON_CLZ_RENAME, BUTTON_CLZ_OPEN_EXTERNAL, BUTTON_CLZ_DELETE, BUTTON_CLZ_BOOKMARK } from '../../../utils/styles';
import { toggleBookmark, toggleItemExpanded, useHasIndexFile, useIndexYaml } from '../../../store';

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
  className = '',
}: EntryActionBarProps) {
  const hasIndexFile = useHasIndexFile();
  const indexYaml = useIndexYaml();
  const editMode = indexYaml?.options?.edit_mode ?? false;
  const showEditActions = !hasIndexFile || editMode;

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
    <div className={`flex items-center gap-1 ${className}`}>
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
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          className={BUTTON_CLZ_RENAME}
          title="Move up"
          data-testid="entry-move-up-button"
        >
          <ArrowUpIcon className="w-5 h-5" />
        </button>
      )}
      {showEditActions && onMoveDown && (
        <button
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          className={BUTTON_CLZ_RENAME}
          title="Move down"
          data-testid="entry-move-down-button"
        >
          <ArrowDownIcon className="w-5 h-5" />
        </button>
      )}

    </div>
  );
}

/**
 * Utility to create a toggle expanded handler
 */
export function useToggleExpanded(path: string) {
  return () => toggleItemExpanded(path);
}
