import { ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import { useHasCutItems, useItem } from '../../store';
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
  onSaveSettings: () => void;
  onPasteIntoFolder?: (folderPath: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function FolderEntry({ entry, onNavigate, onRename, onDelete, onSaveSettings, onPasteIntoFolder, onMoveUp, onMoveDown }: FolderEntryProps) {
  const {
    isRenaming,
    isSelected,
    isHighlighted,
    isBookmarked,
  } = useEntryCore({ path: entry.path, name: entry.name });

  const hasCutItems = useHasCutItems();
  const item = useItem(entry.path);
  const aiHint = item?.aiHint;
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
      className={`w-full ${ENTRY_CONTAINER_CLASSES} ${isHighlighted ? 'border-2 border-purple-500 relative z-10' : 'border-slate-700 hover:bg-slate-700'} transition-colors text-left cursor-pointer`}
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
          path={entry.path}
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
        <>
          <span id={buildEntryHeaderId(entry.path)} className="text-slate-200 font-medium truncate flex-shrink-0">{entry.name}</span>
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
          isBookmarked={isBookmarked}
          deleting={del.deleting}
          onRenameClick={rename.handleRenameClick}
          onDeleteClick={del.handleDeleteClick}
          onSaveSettings={onSaveSettings}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          className="-mr-1.5"
        />
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
  );
}

export default FolderEntry;
