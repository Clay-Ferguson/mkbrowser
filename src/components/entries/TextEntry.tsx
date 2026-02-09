import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { buildEntryHeaderId } from '../../utils/entryDom';
import {
  useItem,
  clearItemGoToLine,
  toggleItemExpanded,
} from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CodeMirrorEditor from '../CodeMirrorEditor';
import {
  useEntryCore,
  useRename,
  useDelete,
  useContentLoader,
  useEditMode,
  EntryActionBar,
  RenameInput,
  SelectionCheckbox,
  type BaseEntryProps,
} from './common';

type TextEntryProps = BaseEntryProps;

function TextEntry({ entry, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings }: TextEntryProps) {
  const item = useItem(entry.path);
  
  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
    showInsertIcons,
    nextOrdinalPrefix,
  } = useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: true });

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

  const { loading, content } = useContentLoader({
    path: entry.path,
    modifiedTime: entry.modifiedTime,
    isExpanded,
    errorMessage: 'Error reading file',
  });

  const edit = useEditMode({
    path: entry.path,
    content,
  });

  const handleToggleExpanded = () => {
    toggleItemExpanded(entry.path);
  };

  return (
    <div className={`bg-slate-800 rounded-lg border ${isHighlighted ? 'border-2 border-purple-500' : 'border-slate-700'} overflow-hidden`}>
      <div className="flex items-center gap-3 pl-4 pr-2 py-1 bg-slate-800/50 border-b border-slate-700">
        <SelectionCheckbox
          path={entry.path}
          name={entry.name}
          isSelected={isSelected}
        />
        {/* Text file icon - document with lines */}
        <DocumentTextIcon className="w-5 h-5 text-emerald-400 flex-shrink-0" />
        {isRenaming ? (
          <RenameInput
            ref={rename.inputRef}
            name={entry.name}
            value={rename.newName}
            onChange={rename.setNewName}
            onKeyDown={rename.handleKeyDown}
            onBlur={rename.handleSave}
            disabled={rename.saving}
            className="font-medium"
          />
        ) : (
          <span
            id={buildEntryHeaderId(entry.name)}
            onClick={handleToggleExpanded}
            className="text-slate-300 font-medium truncate flex-1 cursor-pointer no-underline"
            title={isExpanded ? 'Collapse content' : 'Expand content'}
          >
            {entry.name}
          </span>
        )}
        {edit.isEditing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={edit.handleCancel}
              disabled={edit.saving}
              className="px-3 py-1 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={edit.handleSave}
              disabled={edit.saving}
              className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
            >
              {edit.saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        ) : !isRenaming && (
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
            showEditButton
            onEditClick={edit.handleEditClick}
            className="-mr-1.5"
          />
        )}
      </div>
      {isExpanded && (
        <div className="px-6 py-4">
          {loading && !content ? (
            <div className="text-slate-400 text-sm">Loading...</div>
          ) : edit.isEditing ? (
            <CodeMirrorEditor
              value={edit.editContent}
              onChange={edit.setEditContent}
              placeholder="Enter text content..."
              language="text"
              autoFocus
              goToLine={item?.goToLine}
              onGoToLineComplete={() => clearItemGoToLine(entry.path)}
            />
          ) : (
            <pre 
              className="text-slate-200 font-mono text-sm whitespace-pre-wrap break-words cursor-pointer" 
              onDoubleClick={edit.handleEditClick}
              title="Double-click to edit"
            >
              {content || ''}
            </pre>
          )}
        </div>
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

export default TextEntry;
