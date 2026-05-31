import { useState, useEffect, useCallback, useRef } from 'react';
import { DocumentTextIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { makeEntryDragStartHandler } from '../../utils/dragAndDrop';
import {
  useItem,
  clearItemGoToLine,
  toggleItemExpanded,
  setItemReviewing,
  useHasIndexFile,
  useExpandedEditor,
  setExpandedEditor,
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
import { logger } from '../../utils/logUtil';
import { getTextFileLanguage, formatFlyoverInfo } from '../../utils/fileUtil';
import { BUTTON_CLASS_SM_BLUE, BUTTON_CLASS_SM_RED, BUTTON_CLASS_SM_PURPLE, ENTRY_OUTER, ENTRY_HIGHLIGHTED, ENTRY_HEADER_ROW, ENTRY_HEADER_EXPANDED, ENTRY_NAME_SPAN, ENTRY_CONTENT_AREA, ENTRY_LOADING, ENTRY_EDITOR_ICON_BTN } from '../../utils/styles';


type TextEntryProps = BaseEntryProps;

function TextEntry({ entry, onRename, onDelete, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false }: TextEntryProps) {
  const item = useItem(entry.path);
  const [isRewriting, setIsRewriting] = useState(false);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const fileLanguage = getTextFileLanguage(entry.name);
  // Consolidated into a single state object so the mount-time config load fires
  // ONE React update instead of two, and guarded so a resolve after unmount
  // doesn't setState on a dead component (see MarkdownEntry for the same fix).
  const [aiConfig, setAiConfig] = useState({ selectedPromptName: '', aiRewriteMode: false });
  const { selectedPromptName, aiRewriteMode } = aiConfig;
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getConfig().then((config) => {
      if (cancelled) return;
      setAiConfig({
        selectedPromptName: config.aiRewritePrompt ?? '',
        aiRewriteMode: !!config.aiRewriteMode,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
  } = useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: true });

  const hasIndexFile = useHasIndexFile();
  const expandedEditor = useExpandedEditor();

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

  const aiRewrite = async () => {
    const selection = editorRef.current?.getSelection();
    setIsRewriting(true);
    try {
      const result = selection
        ? await window.electronAPI.rewriteContentSelection(edit.editContent, selection.from, selection.to, entry.path, hasIndexFile)
        : await window.electronAPI.rewriteContent(edit.editContent, entry.path, hasIndexFile);
      if ('error' in result) {
        logger.error('Rewrite failed:', result.error);
        setAiErrorMessage(result.error);
      } else {
        setItemReviewing(entry.path, true, result.rewrittenContent);
      }
    } catch (err) {
      logger.error('Rewrite failed:', err);
      setAiErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRewriting(false);
    }
  };

  return (
    <div className={`${ENTRY_OUTER} ${isHighlighted ? ENTRY_HIGHLIGHTED : ''}`}>
      <div className={`${ENTRY_HEADER_ROW} ${isExpanded ? ENTRY_HEADER_EXPANDED : ''}`}>
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
          onDragStart={makeEntryDragStartHandler({ path: entry.path, name: entry.name, isDirectory: false })}
        >
          <DocumentTextIcon className="w-5 h-5 text-emerald-400" />
        </span>
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
            className={ENTRY_NAME_SPAN}
            title={formatFlyoverInfo(entry)}
          >
            {entry.name}
          </span>
        )}
        {edit.isEditing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpandedEditor(!expandedEditor)}
              title={expandedEditor ? 'Collapse editor' : 'Expand editor'}
              className={ENTRY_EDITOR_ICON_BTN}
            >
              {expandedEditor
                ? <ArrowsPointingInIcon className="w-5 h-5" />
                : <ArrowsPointingOutIcon className="w-5 h-5" />}
            </button>
            {!item?.reviewing && aiRewriteMode && (
              <button
                onClick={aiRewrite}
                disabled={edit.saving || isRewriting}
                title={selectedPromptName ? `Rewrite as ${selectedPromptName}` : (hasSelection ? 'Rewrite selected text' : 'Rewrite')}
                className={BUTTON_CLASS_SM_PURPLE}
              >
                {isRewriting ? 'Rewriting with AI...' : (hasSelection ? 'AI Rewrite Selection' : 'AI Rewrite')}
              </button>
            )}
            {!item?.reviewing && (
              <>
                <button
                  onClick={edit.handleCancel}
                  disabled={edit.saving}
                  className={BUTTON_CLASS_SM_RED}
                >
                  Cancel
                </button>
                <button
                  onClick={edit.handleSave}
                  disabled={edit.saving}
                  className={BUTTON_CLASS_SM_BLUE}
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
            isAttachment={isAttachment}
          />
        )}
      </div>
      {isExpanded && (
        <div className={ENTRY_CONTENT_AREA}>
          {loading && !content ? (
            <div className={ENTRY_LOADING}>Loading...</div>
          ) : edit.isEditing ? (
            item?.reviewing && item.rewrittenContent !== undefined ? (
              <DiffReviewEditor
                originalText={edit.editContent}
                modifiedText={item.rewrittenContent}
                language={fileLanguage}
                onAcceptAll={(finalText) => {
                  edit.setEditContent(finalText);
                  setItemReviewing(entry.path, false);
                }}
                onCancel={() => setItemReviewing(entry.path, false)}
              />
            ) : (
              <CodeMirrorEditor
                key="edit"
                ref={editorRef}
                value={edit.editContent}
                onChange={edit.setEditContent}
                placeholder="Enter text content..."
                language={fileLanguage}
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
            <CodeMirrorEditor
              key="view"
              value={content || ''}
              onChange={() => {}}
              language={fileLanguage}
              readOnly
            />
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
