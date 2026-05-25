import { ClipboardDocumentIcon, FolderIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import { useHasCutItems, useItem, useHasIndexFile, useIndexYaml } from '../../store';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { BUTTON_CLASS_ICON_SOLID_BLUE } from '../../utils/styles';
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
  onMoveToTop?: () => void;
  onMoveToBottom?: () => void;
  isAttachFolder?: boolean;
  indentFolder?: boolean;
}

function FolderEntry({ entry, onNavigate, onRename, onDelete, onSaveSettings, onPasteIntoFolder, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachFolder, indentFolder }: FolderEntryProps) {
  const {
    isRenaming,
    isSelected,
    isHighlighted,
    isBookmarked,
  } = useEntryCore({ path: entry.path, name: entry.name });

  const hasCutItems = useHasCutItems();
  const item = useItem(entry.path);
  const hasIndexFile = useHasIndexFile();
  const indexYaml = useIndexYaml();
  const editMode = indexYaml?.options?.edit_mode ?? false;
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
    <div className={`${indentFolder ? '' : 'bg-slate-800'} group ${isHighlighted ? 'border-2 border-purple-500 relative z-10' : ''}`} style={indentFolder ? { paddingLeft: '32px' } : undefined}>
      <div
        onClick={() => !isRenaming && onNavigate(entry.path)}
        className={`w-full flex items-center gap-3 px-2 py-0 ${isHighlighted ? 'bg-blue-800/50' : 'bg-blue-800/50 hover:bg-blue-700/70'} transition-colors text-left cursor-pointer`}
      >
        {(!hasIndexFile || editMode) && (
          <SelectionCheckbox
            path={entry.path}
            name={entry.name}
            isSelected={isSelected}
            onClick={handleCheckboxClick}
          />
        )}
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
            <span id={buildEntryHeaderId(entry.path)} className={`font-medium truncate flex-shrink-0${indentFolder ? ' text-slate-400 italic' : ' text-slate-200'}`}>{indentFolder ? '*.attach' : entry.name}</span>
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
              onRenameClick={rename.handleRenameClick}
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
