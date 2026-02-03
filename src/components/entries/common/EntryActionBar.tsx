import { PencilSquareIcon, PencilIcon, ArrowTopRightOnSquareIcon, TrashIcon, DocumentPlusIcon, FolderPlusIcon, BookmarkIcon as BookmarkOutlineIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { BUTTON_CLZ_INSERT_FILE, BUTTON_CLZ_INSERT_FOLDER, BUTTON_CLZ_RENAME, BUTTON_CLZ_OPEN_EXTERNAL, BUTTON_CLZ_DELETE, BUTTON_CLZ_BOOKMARK } from '../../../utils/styles';
import { toggleBookmark, toggleItemExpanded } from '../../../store';

interface EntryActionBarProps {
  /** Full path of the entry */
  path: string;
  /** Whether to show insert file/folder buttons */
  showInsertIcons: boolean;
  /** Next ordinal prefix for insert operations */
  nextOrdinalPrefix: string | null;
  /** Whether the item is bookmarked */
  isBookmarked: boolean;
  /** Whether delete is in progress */
  deleting: boolean;
  /** Handler to start renaming */
  onRenameClick: (e?: React.MouseEvent) => void;
  /** Handler to show delete confirmation */
  onDeleteClick: (e?: React.MouseEvent) => void;
  /** Handler to insert a file below */
  onInsertFileBelow: (defaultName: string) => void;
  /** Handler to insert a folder below */
  onInsertFolderBelow: (defaultName: string) => void;
  /** Handler to persist settings after bookmark toggle */
  onSaveSettings: () => void;
  /** Whether to show an edit button (for editable files) */
  showEditButton?: boolean;
  /** Handler for edit button */
  onEditClick?: () => void;
  /** Extra className for the container */
  className?: string;
}

/**
 * Reusable action button bar for Entry components.
 * Renders insert, edit, rename, open-external, delete, and bookmark buttons.
 */
export function EntryActionBar({
  path,
  showInsertIcons,
  nextOrdinalPrefix,
  isBookmarked,
  deleting,
  onRenameClick,
  onDeleteClick,
  onInsertFileBelow,
  onInsertFolderBelow,
  onSaveSettings,
  showEditButton = false,
  onEditClick,
  className = '',
}: EntryActionBarProps) {
  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleBookmark(path);
    onSaveSettings();
  };

  const handleInsertFileBelow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (nextOrdinalPrefix) {
      onInsertFileBelow(nextOrdinalPrefix);
    }
  };

  const handleInsertFolderBelow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (nextOrdinalPrefix) {
      onInsertFolderBelow(nextOrdinalPrefix);
    }
  };

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.electronAPI.openExternal(path);
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {showEditButton && onEditClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEditClick();
          }}
          className={BUTTON_CLZ_RENAME}
          title="Edit content"
        >
          <PencilSquareIcon className="w-5 h-5" />
        </button>
      )}
      <button
        onClick={onRenameClick}
        className={BUTTON_CLZ_RENAME}
        title="Rename"
      >
        <PencilIcon className="w-5 h-5" />
      </button>
      {showInsertIcons && (
        <>
          <button
            onClick={handleInsertFileBelow}
            className={BUTTON_CLZ_INSERT_FILE}
            title="Insert file below"
          >
            <DocumentPlusIcon className="w-5 h-5" />
          </button>
          <button
            onClick={handleInsertFolderBelow}
            className={BUTTON_CLZ_INSERT_FOLDER}
            title="Insert folder below"
          >
            <FolderPlusIcon className="w-5 h-5" />
          </button>
        </>
      )}
      <button
        onClick={handleOpenExternal}
        className={BUTTON_CLZ_OPEN_EXTERNAL}
        title="Open with system default"
      >
        <ArrowTopRightOnSquareIcon className="w-5 h-5" />
      </button>
      <button
        onClick={onDeleteClick}
        disabled={deleting}
        className={BUTTON_CLZ_DELETE}
        title="Delete"
      >
        <TrashIcon className="w-5 h-5" />
      </button>
      <button
        onClick={handleBookmarkClick}
        className={BUTTON_CLZ_BOOKMARK}
        title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
      >
        {isBookmarked ? (
          <BookmarkSolidIcon className="w-5 h-5 text-blue-400" />
        ) : (
          <BookmarkOutlineIcon className="w-5 h-5" />
        )}
      </button>
    </div>
  );
}

/**
 * Utility to create a toggle expanded handler
 */
export function useToggleExpanded(path: string) {
  return () => toggleItemExpanded(path);
}
