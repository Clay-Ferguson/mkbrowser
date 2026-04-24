import { useState, useEffect, useCallback, useRef } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { buildEntryHeaderId } from '../../utils/entryDom';
import {
  useItem,
  clearItemGoToLine,
  toggleItemExpanded,
  setItemReviewing,
  useHasIndexFile,
  useIndexYaml,
} from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorDialog from '../dialogs/ErrorDialog';
import CodeMirrorEditor from '../editor/CodeMirrorEditor';
import type { CodeMirrorEditorHandle } from '../editor/CodeMirrorEditor';
import DiffReviewEditor from '../editor/DiffReviewEditor';
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

function TextEntry({ entry, onRename, onDelete, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom }: TextEntryProps) {
  const item = useItem(entry.path);
  const [isRewriting, setIsRewriting] = useState(false);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const [selectedPromptName, setSelectedPromptName] = useState<string>('');
  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      setSelectedPromptName(config.aiRewritePrompt ?? '');
    });
  }, []);
  
  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
  } = useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: true });

  const hasIndexFile = useHasIndexFile();
  const indexYaml = useIndexYaml();
  const editMode = indexYaml?.options?.edit_mode ?? false;

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

  const handleEscape = useCallback(() => {
    if (edit.editContent === content) {
      edit.handleCancel();
    }
  }, [edit.editContent, content, edit.handleCancel]);

  const handleToggleExpanded = () => {
    toggleItemExpanded(entry.path);
  };

  return (
    <div className={`bg-slate-800 border group ${isHighlighted ? 'border-2 border-purple-500 relative z-10' : 'border-slate-700'} overflow-hidden`}>
      <div className="flex items-center gap-3 pl-4 pr-2 py-1 bg-slate-700/50 group-hover:bg-slate-700 border-b border-slate-700 transition-colors">
        {(!hasIndexFile || editMode) && (
          <SelectionCheckbox
            path={entry.path}
            name={entry.name}
            isSelected={isSelected}
          />
        )}
        {/* Text file icon - document with lines */}
        <DocumentTextIcon className="w-5 h-5 text-emerald-400 flex-shrink-0" />
        {isRenaming ? (
          <RenameInput
            ref={rename.inputRef}
            path={entry.path}
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
            id={buildEntryHeaderId(entry.path)}
            onClick={handleToggleExpanded}
            className="text-slate-300 font-medium truncate flex-1 cursor-pointer no-underline"
            title={isExpanded ? 'Collapse content' : 'Expand content'}
          >
            {entry.name}
          </span>
        )}
        {edit.isEditing ? (
          <div className="flex items-center gap-2">
            {!item?.reviewing && (
              <button
                onClick={async () => {
                  const selection = editorRef.current?.getSelection();
                  setIsRewriting(true);
                  try {
                    const result = selection
                      ? await window.electronAPI.rewriteContentSelection(edit.editContent, selection.from, selection.to)
                      : await window.electronAPI.rewriteContent(edit.editContent);
                    if ('error' in result) {
                      console.error('Rewrite failed:', result.error);
                      setAiErrorMessage(result.error);
                    } else {
                      setItemReviewing(entry.path, true, result.rewrittenContent);
                    }
                  } catch (err) {
                    console.error('Rewrite failed:', err);
                    setAiErrorMessage(err instanceof Error ? err.message : 'Unknown error');
                  } finally {
                    setIsRewriting(false);
                  }
                }}
                disabled={edit.saving || isRewriting}
                title={selectedPromptName ? `Rewrite as ${selectedPromptName}` : (hasSelection ? 'Rewrite selected text' : 'Rewrite')}
                className="px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50"
              >
                {isRewriting ? 'Rewriting with AI...' : (hasSelection ? 'AI Rewrite Selection' : 'AI Rewrite')}
              </button>
            )}
            {!item?.reviewing && (
              <>
                <button
                  onClick={edit.handleCancel}
                  disabled={edit.saving}
                  className="px-3 py-1 text-sm text-white bg-red-600 hover:bg-red-500 rounded transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={edit.handleSave}
                  disabled={edit.saving}
                  className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
                  data-testid="entry-save-button"
                >
                  {edit.saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        ) : !isRenaming && (
          <EntryActionBar
            path={entry.path}
            isBookmarked={isBookmarked}
            deleting={del.deleting}
            onRenameClick={rename.handleRenameClick}
            onDeleteClick={del.handleDeleteClick}
            onSaveSettings={onSaveSettings}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onMoveToTop={onMoveToTop}
            onMoveToBottom={onMoveToBottom}
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
            item?.reviewing && item.rewrittenContent !== undefined ? (
              <DiffReviewEditor
                originalText={edit.editContent}
                modifiedText={item.rewrittenContent}
                language="text"
                onAcceptAll={(finalText) => {
                  edit.setEditContent(finalText);
                  setItemReviewing(entry.path, false);
                }}
                onCancel={() => setItemReviewing(entry.path, false)}
              />
            ) : (
              <CodeMirrorEditor
                ref={editorRef}
                value={edit.editContent}
                onChange={edit.setEditContent}
                placeholder="Enter text content..."
                language="text"
                autoFocus
                goToLine={item?.goToLine}
                onGoToLineComplete={() => clearItemGoToLine(entry.path)}
                onEscape={handleEscape}
                onForceCancel={edit.handleCancel}
                onSave={edit.handleSave}
                onSelectionChange={setHasSelection}
              />
            )
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
          message={`Move "${entry.name}" to trash?`}
          onConfirm={del.handleDeleteConfirm}
          onCancel={del.handleDeleteCancel}
        />
      )}
      {aiErrorMessage && (
        <ErrorDialog
          message={aiErrorMessage}
          onClose={() => setAiErrorMessage(null)}
        />
      )}
    </div>
  );
}

export default TextEntry;
