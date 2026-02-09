import { ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import { useHasCutItems } from '../../store';
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
  onPasteIntoFolder?: (folderPath: string) => void;
}

function FolderEntry({ entry, onNavigate, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings, onPasteIntoFolder }: FolderEntryProps) {
  const {
    isRenaming,
    isSelected,
    isHighlighted,
    isBookmarked,
    showInsertIcons,
    nextOrdinalPrefix,
  } = useEntryCore({ path: entry.path, name: entry.name });

  const hasCutItems = useHasCutItems();
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
        <>
        {hasCutItems && onPasteIntoFolder && (
          <button
            onClick={(e) => { e.stopPropagation(); onPasteIntoFolder(entry.path); }}
            className="flex-shrink-0 px-2 py-0.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            title="Paste cut items into this folder"
          >
            <ClipboardDocumentIcon className="w-4 h-4 inline -mt-0.5 mr-0.5" />
            Paste
          </button>
        )}
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
          className="-mr-1.5"
        />
        </>
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
