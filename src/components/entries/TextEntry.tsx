import { useState, useCallback, useRef } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import {
  useItem,
  clearItemGoToLine,
  setItemReviewing,
  useHasIndexFile,
  useExpandedEditor,
  setExpandedEditor,
} from '../../store';
import CodeMirrorEditor from '../editor/CodeMirrorEditor';
import type { CodeMirrorEditorHandle } from '../editor/CodeMirrorEditor';
import DiffReviewEditor from '../editor/DiffReviewEditor';
import AlertDialog from '../dialogs/AlertDialog';
import {
  useEditableEntry,
  useToggleExpanded,
  useAiConfig,
  useAiRewrite,
  EntryActionBar,
  EntryEditToolbar,
  EntryShell,
  type BaseEntryProps,
} from './common';
import { getTextFileLanguage } from '../../utils/fileTypes';
import { ENTRY_CONTENT_AREA, ENTRY_LOADING } from '../../utils/styles';


type TextEntryProps = BaseEntryProps;

function TextEntry(props: TextEntryProps) {
  const { entry, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false } = props;
  const item = useItem(entry.path);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const fileLanguage = getTextFileLanguage(entry.name);
  const { selectedPromptName, aiRewriteMode } = useAiConfig();

  const { core, rename, del, loading, content, edit } = useEditableEntry(props, {
    defaultExpanded: true,
    errorMessage: 'Error reading file',
  });
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  const hasIndexFile = useHasIndexFile();
  const expandedEditor = useExpandedEditor();

  const handleEscape = useCallback(() => {
    if (edit.editContent === content) {
      edit.handleCancel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO(hooks): missing dep(s) 'edit' - review before adding (may alter behavior)
  }, [edit.editContent, content, edit.handleCancel]);

  const handleToggleExpanded = useToggleExpanded(entry.path);

  const { isRewriting, aiRewrite } = useAiRewrite({
    path: entry.path,
    hasIndexFile,
    editorRef,
    editContent: edit.editContent,
    onError: setAiErrorMessage,
  });

  const headerRight = edit.isEditing ? (
    <EntryEditToolbar
      expandedEditor={expandedEditor}
      onToggleExpandedEditor={() => setExpandedEditor(!expandedEditor)}
      showRewrite={!item?.reviewing && aiRewriteMode}
      onAiRewrite={aiRewrite}
      rewriteDisabled={edit.saving || isRewriting}
      isRewriting={isRewriting}
      selectedPromptName={selectedPromptName}
      hasSelection={hasSelection}
      showSaveCancel={!item?.reviewing}
      saving={edit.saving}
      onCancel={edit.handleCancel}
      onSave={edit.handleSave}
    />
  ) : (
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
      className="-mr-1.5"
      isAttachment={isAttachment}
    />
  );

  return (
    <>
      <EntryShell
        data-testid="browser-entry-text"
        entry={entry}
        icon={<DocumentTextIcon className="w-5 h-5 text-emerald-400" />}
        isAttachment={isAttachment}
        isHighlighted={isHighlighted}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isRenaming={isRenaming}
        rename={rename}
        del={del}
        onToggleExpanded={handleToggleExpanded}
        renameClassName="font-medium"
        headerRight={headerRight}
      >
        <div
          className={ENTRY_CONTENT_AREA}
          onMouseUp={!edit.isEditing ? () => { if (!window.getSelection()?.toString()) void edit.handleEditClick(); } : undefined}
        >
          {loading && !content ? (
            <div className={ENTRY_LOADING}>Loading...</div>
          ) : edit.isEditing ? (
            item?.reviewing && item.rewrittenContent !== undefined ? (
              <DiffReviewEditor
                originalText={edit.editContent}
                modifiedText={item.rewrittenContent}
                language={fileLanguage}
                onComplete={(finalText) => {
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
      </EntryShell>
      {aiErrorMessage && (
        <AlertDialog
          scrollable
          title="Error"
          message={aiErrorMessage}
          onClose={() => setAiErrorMessage(null)}
        />
      )}
    </>
  );
}

export default TextEntry;
