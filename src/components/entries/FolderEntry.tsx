import { FolderIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { ENTRY_CONTAINER_CLASSES } from '../../utils/styles';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import {
  useEntryCore,
  useRename,
  useDelete,
  EntryActionBar,
  RenameInput,
  SelectionCheckbox,
} from './common';

interface FolderEntryProps {
  entry: FileEntry;
  onNavigate: (path: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
  onSaveSettings: () => void;
}

function FolderEntry({ entry, onNavigate, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings }: FolderEntryProps) {
  const {
    isRenaming,
    isSelected,
    isHighlighted,
    isBookmarked,
    showInsertIcons,
    nextOrdinalPrefix,
  } = useEntryCore({ path: entry.path, name: entry.name });

  const rename = useRename({
    path: entry.path,
    name: entry.name,
    isRenaming,
    onRename,
    onSaveSettings,
    selectFullName: true, // Folders select full name
  });

  const del = useDelete({
    path: entry.path,
    onDelete,
  });

  const handleInputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      onClick={() => !isRenaming && onNavigate(entry.path)}
      className={`w-full ${ENTRY_CONTAINER_CLASSES} ${isHighlighted ? 'border-2 border-purple-500' : 'border-slate-700 hover:border-slate-600'} hover:bg-slate-750 transition-colors text-left cursor-pointer`}
    >
      <SelectionCheckbox
        path={entry.path}
        name={entry.name}
        isSelected={isSelected}
        onClick={handleCheckboxClick}
      />
      <FolderIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
      {isRenaming ? (
        <RenameInput
          ref={rename.inputRef}
          name={entry.name}
          value={rename.newName}
          onChange={rename.setNewName}
          onKeyDown={rename.handleKeyDown}
          onBlur={rename.handleSave}
          onClick={handleInputClick}
          disabled={rename.saving}
          className="font-medium"
        />
      ) : (
        <span id={buildEntryHeaderId(entry.name)} className="text-slate-200 font-medium truncate flex-1">{entry.name}</span>
      )}
      {isRenaming ? (
        <div className="flex-shrink-0" />
      ) : (
        <EntryActionBar
          path={entry.path}
          showInsertIcons={showInsertIcons}
          nextOrdinalPrefix={nextOrdinalPrefix}
          isBookmarked={isBookmarked}
          deleting={del.deleting}
          onRenameClick={rename.handleRenameClick}
          onDeleteClick={del.handleDeleteClick}
          onInsertFileBelow={onInsertFileBelow}
          onInsertFolderBelow={onInsertFolderBelow}
          onSaveSettings={onSaveSettings}
        />
      )}
      {del.showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete the folder "${entry.name}" and all its contents?`}
          onConfirm={del.handleDeleteConfirm}
          onCancel={del.handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default FolderEntry;
