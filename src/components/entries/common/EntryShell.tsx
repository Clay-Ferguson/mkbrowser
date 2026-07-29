import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import type { FileEntry } from '../../../global';
import { buildEntryHeaderId } from '../../../renderer/entryDom';
import { formatFlyoverInfo } from '../../../shared/fileTypes';
import { makeEntryDragStartHandler, canDropAsAttachment, dropAsAttachment } from '../../../renderer/dragAndDrop';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { RenameInput } from './RenameInput';
import { SelectionCheckbox } from './SelectionCheckbox';
import { useDropTarget } from './useDropTarget';
import type { RenameState, DeleteState } from './types';
import {
  ENTRY_OUTER,
  ENTRY_HIGHLIGHTED,
  ENTRY_HEADER_ROW,
  ENTRY_HEADER_EXPANDED,
  ENTRY_NAME_SPAN,
  ENTRY_HEADER_ROW_DROP,
} from '../../../renderer/styles';

interface EntryShellProps {
  /** The file entry — used for path/name/drag/flyover */
  entry: FileEntry;
  /** The colored icon element rendered in the draggable handle */
  icon: ReactNode;
  /** When true, hides the selection checkbox (attachment rows) */
  isAttachment?: boolean;
  /** Passed to makeEntryDragStartHandler (defaults to false) */
  isDirectory?: boolean;

  // State (sourced from the hooks the caller already runs)
  isHighlighted: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  /** True while the entry's editor is open — suppresses right-click rename (from useEditMode) */
  isEditing?: boolean;
  rename: RenameState;
  del: DeleteState;

  /** Toggle expansion (from useToggleExpanded) */
  onToggleExpanded: () => void;

  // Slots
  /** Class for the name span (defaults to ENTRY_NAME_SPAN) */
  nameClassName?: string;
  /** Title/flyover for the name span (defaults to formatFlyoverInfo(entry)) */
  nameTitle?: string;
  /** Extra class for the rename input */
  renameClassName?: string;
  /** Header-right area — action bar / edit toolbar / extras, fully owned by caller (hidden while renaming) */
  headerRight?: ReactNode;
  /** Expanded body, rendered only when isExpanded */
  children?: ReactNode;
  /** Confirmation message for the delete dialog (defaults to `Move "name" to trash?`) */
  deleteMessage?: string;
  /** Extra classes on the outer wrapper */
  className?: string;
  /** Whether to apply ENTRY_HEADER_EXPANDED when expanded (Generic does not expand) */
  expandedAffectsHeader?: boolean;
  /** Test id passthrough on the outer wrapper */
  'data-testid'?: string;
}

/**
 * Shared presentational skeleton for the file-type entry components
 * (Generic / Image / Text / Markdown). Owns the outer wrapper, header row
 * with right-click rename, selection checkbox, draggable icon, the
 * rename-input/name-span swap, the header-right slot, the expanded body,
 * and the trailing delete confirmation dialog.
 *
 * Component-specific state, handlers, and the expanded body's own markup stay
 * in the individual components — only the duplicated skeleton lives here.
 */
export function EntryShell({
  entry,
  icon,
  isAttachment = false,
  isDirectory = false,
  isHighlighted,
  isExpanded,
  isSelected,
  isRenaming,
  isEditing = false,
  rename,
  del,
  onToggleExpanded,
  nameClassName = ENTRY_NAME_SPAN,
  nameTitle,
  renameClassName,
  headerRight,
  children,
  deleteMessage,
  className,
  expandedAffectsHeader = true,
  'data-testid': dataTestId,
}: EntryShellProps) {
  const { inputRef: renameInputRef, newName, setNewName, saving: renameSaving, handleKeyDown, handleSave } = rename;

  // Drop target: an entry dragged onto this file becomes one of its attachments,
  // creating the file's `.attach` folder on demand. Every file-type entry gets
  // this by virtue of rendering through the shell.
  const drop = useDropTarget(
    payload => canDropAsAttachment(payload, entry.path),
    payload => void dropAsAttachment(payload, entry.path)
  );

  return (
    <div
      data-testid={dataTestId}
      className={clsx(ENTRY_OUTER, isHighlighted && ENTRY_HIGHLIGHTED, className)}
    >
      {/* Drop handlers sit on the header row, not the outer wrapper, so dragging
          across an expanded entry's body doesn't light the row up. */}
      <div
        className={clsx(
          drop.isDragOver ? ENTRY_HEADER_ROW_DROP : ENTRY_HEADER_ROW,
          expandedAffectsHeader && isExpanded && ENTRY_HEADER_EXPANDED,
        )}
        // Right-click renames — but not while the entry's editor is open: entering
        // rename mode there swaps the name for the rename input and hides the edit
        // toolbar out from under an in-progress edit. No handler at all while
        // editing, so the event is left alone rather than preventDefault'd.
        onContextMenu={isEditing ? undefined : (e) => { e.preventDefault(); if (!isRenaming) rename.handleRenameClick(e); }}
        {...drop.dropProps}
      >
        {!isAttachment && (
          <SelectionCheckbox
            path={entry.path}
            name={entry.name}
            isSelected={isSelected}
          />
        )}
        {/* Entry Icon */}
        <span
          className="flex-shrink-0 cursor-grab"
          draggable
          onDragStart={makeEntryDragStartHandler({ path: entry.path, name: entry.name, isDirectory })}
        >
          {icon}
        </span>
        {isRenaming ? (
          <RenameInput
            ref={renameInputRef}
            path={entry.path}
            value={newName}
            onChange={setNewName}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            disabled={renameSaving}
            className={renameClassName}
          />
        ) : (
          <span
            id={buildEntryHeaderId(entry.path)}
            onClick={onToggleExpanded}
            className={nameClassName}
            title={nameTitle ?? formatFlyoverInfo(entry)}
          >
            {entry.name}
          </span>
        )}
        {!isRenaming && headerRight}
      </div>
      {isExpanded && children}
      {del.showDeleteConfirm && (
        <ConfirmDialog
          message={deleteMessage ?? `Move "${entry.name}" to trash?`}
          onConfirm={del.handleDeleteConfirm}
          onCancel={del.handleDeleteCancel}
        />
      )}
    </div>
  );
}
