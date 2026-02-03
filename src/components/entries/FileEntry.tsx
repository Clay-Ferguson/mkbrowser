import { DocumentIcon } from '@heroicons/react/24/outline';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { ENTRY_CONTAINER_CLASSES } from '../../utils/styles';
import { toggleItemExpanded } from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import {
  useEntryCore,
  useRename,
  useDelete,
  EntryActionBar,
  RenameInput,
  SelectionCheckbox,
  type BaseEntryProps,
} from './common';

type FileEntryProps = BaseEntryProps;

function FileEntry({ entry, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings }: FileEntryProps) {
  const {
    isRenaming,
    isExpanded,
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
  });

  const del = useDelete({
    path: entry.path,
    onDelete,
  });

  const handleToggleExpanded = () => {
    toggleItemExpanded(entry.path);
  };

  return (
    <div className={`${ENTRY_CONTAINER_CLASSES} ${isHighlighted ? 'border-2 border-purple-500' : 'border-slate-700'}`}>
      <SelectionCheckbox
        path={entry.path}
        name={entry.name}
        isSelected={isSelected}
      />
      <DocumentIcon className="w-5 h-5 text-slate-500 flex-shrink-0" />
      {isRenaming ? (
        <RenameInput
          ref={rename.inputRef}
          name={entry.name}
          value={rename.newName}
          onChange={rename.setNewName}
          onKeyDown={rename.handleKeyDown}
          onBlur={rename.handleSave}
          disabled={rename.saving}
        />
      ) : (
        <span
          id={buildEntryHeaderId(entry.name)}
          onClick={handleToggleExpanded}
          className="text-slate-400 truncate flex-1 cursor-pointer no-underline"
          title={isExpanded ? 'Collapse content' : 'Expand content'}
        >
          {entry.name}
        </span>
      )}
      {!isRenaming && (
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
          message={`Are you sure you want to delete "${entry.name}"?`}
          onConfirm={del.handleDeleteConfirm}
          onCancel={del.handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default FileEntry;
