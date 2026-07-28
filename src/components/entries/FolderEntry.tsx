import { clsx } from 'clsx';
import { ClipboardDocumentIcon, FolderIcon } from '@heroicons/react/24/solid';
import { hasAnyCutItems, useAS } from '../../store';
import { buildEntryHeaderId } from '../../renderer/entryDom';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';
import {
  makeEntryDragStartHandler,
  canDropInto,
  completeEntryDrop,
} from '../../renderer/dragAndDrop';
import { BUTTON_CLASS_ICON_SOLID_BLUE, ENTRY_HIGHLIGHTED, ENTRY_DROP_TARGET } from '../../renderer/styles';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import {
  useEntry,
  useDropTarget,
  EntryActionBar,
  RenameInput,
  SelectionCheckbox,
} from './common';
import type { BaseEntryProps } from './common';

interface FolderEntryProps extends BaseEntryProps {
  onNavigate: (path: string) => void;
  onPasteIntoFolder?: (folderPath: string) => void;
  onRefreshDirectory?: () => void;
  isAttachFolder?: boolean;
  indentFolder?: boolean;
}

/**
 * Entry component for directories. Clicking navigates into the folder; right-click starts inline
 * rename. Also acts as a drag-and-drop target: items dragged from the entry list or index tree can
 * be dropped here to move them into this folder. Attach folders (created automatically as siblings
 * of their parent file) suppress the move-up/down buttons even in indexed (document) mode, since
 * their position in the index is tied to their parent file.
 */
function FolderEntry(props: FolderEntryProps) {
  const { entry, onNavigate, onSaveSettings, onPasteIntoFolder, onRefreshDirectory, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachFolder, indentFolder } = props;
  // Folders select the full name on rename; they don't use isExpanded.
  const { core, rename, del } = useEntry(props, { selectFullName: true });
  const { isRenaming, isSelected, isHighlighted, isBookmarked } = core;
  const { inputRef: renameInputRef, newName, setNewName, saving: renameSaving, handleKeyDown, handleSave, handleRenameClick } = rename;

  const hasCutItems = useAS(s => hasAnyCutItems(s.items));
  const item = useAS(s => s.items.get(entry.path));
  const hasIndexFile = useAS(s => s.hasIndexFile);
  const aiHint = item?.aiHint;

  const handleInputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Drop target: accept a file/folder dragged from the entry list or the index tree
  // and move it into this folder.
  const drop = useDropTarget(
    payload => canDropInto(payload, entry.path),
    payload => void completeEntryDrop(payload, entry.path, onRefreshDirectory)
  );

  return (
    <div className={clsx('group', indentFolder && 'pl-8', isHighlighted && ENTRY_HIGHLIGHTED)}>
      <div
        onClick={() => !isRenaming && onNavigate(entry.path)}
        onContextMenu={(e) => { e.preventDefault(); if (!isRenaming) rename.handleRenameClick(e); }}
        {...drop.dropProps}
        className={clsx(
          'w-full flex items-center gap-3 px-2 py-0 transition-colors text-left cursor-pointer',
          drop.isDragOver ? ENTRY_DROP_TARGET : 'bg-transparent hover:bg-blue-700/70',
        )}
      >
        <SelectionCheckbox
          path={entry.path}
          name={entry.name}
          isSelected={isSelected}
          onClick={handleCheckboxClick}
        />
        {/* Entry Icon */}
        <span
          className="flex-shrink-0 cursor-grab"
          draggable
          onDragStart={makeEntryDragStartHandler({ path: entry.path, name: entry.name, isDirectory: true })}
        >
          <FolderIcon className="w-5 h-5 text-amber-500" />
        </span>
        {isRenaming ? (
          <RenameInput
            ref={renameInputRef}
            path={entry.path}
            value={newName}
            onChange={setNewName}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            onClick={handleInputClick}
            disabled={renameSaving}
            className="font-medium"
          />
        ) : (
          <>
            <span id={buildEntryHeaderId(entry.path)} className={clsx('font-medium truncate flex-shrink-0', indentFolder ? 'text-slate-400 italic' : 'text-slate-200')}>{indentFolder ? `*${ATTACH_SUFFIX}` : entry.name}</span>
            {aiHint && (
              <span className="text-slate-400 italic text-sm truncate min-w-0" title={aiHint}>{aiHint}</span>
            )}
            <span className="flex-1" />
          </>
        )}
        {isRenaming ? (
          <div className="flex-shrink-0" />
        ) : (
          <>
            <EntryActionBar
              path={entry.path}
              isBookmarked={isBookmarked}
              isFolder={true}
              deleting={del.deleting}
              onRenameClick={handleRenameClick}
              onDeleteClick={del.handleDeleteClick}
              onSaveSettings={onSaveSettings}
              onMoveUp={isAttachFolder && hasIndexFile ? undefined : onMoveUp}
              onMoveDown={isAttachFolder && hasIndexFile ? undefined : onMoveDown}
              onMoveToTop={isAttachFolder && hasIndexFile ? undefined : onMoveToTop}
              onMoveToBottom={isAttachFolder && hasIndexFile ? undefined : onMoveToBottom}
              className="-mr-1.5"
            />
            {hasCutItems && onPasteIntoFolder && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPasteIntoFolder(entry.path); }}
                className={BUTTON_CLASS_ICON_SOLID_BLUE}
                title="Paste cut items into this folder"
                aria-label="Paste cut items into this folder"
              >
                <ClipboardDocumentIcon className="w-4 h-4 text-white" />
              </button>
            )}
          </>
        )}
        {del.showDeleteConfirm && (
          <ConfirmDialog
            message={`Move the folder "${entry.name}" and all its contents to trash?`}
            onConfirm={del.handleDeleteConfirm}
            onCancel={del.handleDeleteCancel}
          />
        )}
      </div>
    </div>
  );
}

export default FolderEntry;
