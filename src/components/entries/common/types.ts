import type { FileEntry } from '../../../global';

/**
 * Base props shared by all Entry components.
 * Individual components extend this with type-specific props.
 */
export interface BaseEntryProps {
  /** The file/folder entry data */
  entry: FileEntry;
  /** Callback when entry is renamed */
  onRename: () => void;
  /** Callback when entry is deleted */
  onDelete: () => void;
  /** Callback to insert a new file below this entry */
  onInsertFileBelow: (defaultName: string) => void;
  /** Callback to insert a new folder below this entry */
  onInsertFolderBelow: (defaultName: string) => void;
  /** Callback to persist settings after bookmark changes */
  onSaveSettings: () => void;
}

/**
 * Return type for useEntryCore hook
 */
export interface EntryCoreState {
  /** Whether item is in rename mode */
  isRenaming: boolean;
  /** Whether item content is expanded */
  isExpanded: boolean;
  /** Whether item is selected via checkbox */
  isSelected: boolean;
  /** Whether item is highlighted (just navigated to) */
  isHighlighted: boolean;
  /** Whether item is bookmarked */
  isBookmarked: boolean;
  /** Whether to show insert file/folder buttons (has ordinal prefix) */
  showInsertIcons: boolean;
  /** Next ordinal prefix for insert operations */
  nextOrdinalPrefix: string | null;
}

/**
 * Return type for useRename hook
 */
export interface RenameState {
  /** Current value in the rename input */
  newName: string;
  /** Update the rename input value */
  setNewName: (name: string) => void;
  /** Whether rename save is in progress */
  saving: boolean;
  /** Ref for the rename input element */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Start renaming */
  handleRenameClick: (e?: React.MouseEvent) => void;
  /** Cancel renaming */
  handleCancel: () => void;
  /** Save the new name */
  handleSave: () => Promise<void>;
  /** Handle keyboard events in rename input */
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Return type for useDelete hook
 */
export interface DeleteState {
  /** Whether delete is in progress */
  deleting: boolean;
  /** Whether delete confirmation dialog is shown */
  showDeleteConfirm: boolean;
  /** Show delete confirmation dialog */
  handleDeleteClick: (e?: React.MouseEvent) => void;
  /** Confirm and execute delete */
  handleDeleteConfirm: () => Promise<void>;
  /** Cancel delete */
  handleDeleteCancel: () => void;
}

/**
 * Return type for useContentLoader hook
 */
export interface ContentLoaderState {
  /** Whether content is loading */
  loading: boolean;
  /** Loaded content */
  content: string;
}

/**
 * Return type for useEditMode hook
 */
export interface EditModeState {
  /** Whether file is being edited */
  isEditing: boolean;
  /** Current editor content */
  editContent: string;
  /** Update editor content */
  setEditContent: (content: string) => void;
  /** Whether save is in progress */
  saving: boolean;
  /** Start editing (may re-read file from disk if externally modified) */
  handleEditClick: () => void | Promise<void>;
  /** Cancel editing */
  handleCancel: () => void;
  /** Save changes */
  handleSave: () => Promise<void>;
}
