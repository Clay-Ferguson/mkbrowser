import { useState, useRef } from 'react';
import { clsx } from 'clsx';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import {
  clearItemGoToLine,
  setItemReviewing,
  useAS,
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
import { getTextFileLanguage } from '../../shared/fileTypes';
import { ENTRY_CONTENT_AREA, ENTRY_LOADING } from '../../renderer/styles';


type TextEntryProps = BaseEntryProps;

/**
 * Entry component for plain-text files. Expands inline to show a read-only CodeMirror view;
 * clicking the content area opens an editable CodeMirror editor. Supports AI rewrite of the
 * whole document or a selected range, and shows a diff-review editor after a rewrite completes.
 */
function TextEntry(props: TextEntryProps) {
  const { entry, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false } = props;
  const item = useAS(s => s.items.get(entry.path));
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

  const hasIndexFile = useAS(s => s.hasIndexFile);
  const expandedEditor = useAS(s => s.settings.expandedEditor);
  // Expanded-editor mode: this entry is maximized to fill the browse area, so the shell,
  // content area, and editor all become nested flex columns (BrowseView flexes the outer chain).
  const maximized = expandedEditor && edit.isEditing;

  // Only exit edit mode on Escape when the content is unmodified; if the user has typed
  // something, Escape is passed through to CodeMirror (e.g. to dismiss autocomplete).
  const handleEscape = () => {
    // Read the edit buffer at call time — the editor flushes its debounced onChange right
    // before invoking onEscape, so this render's edit.editContent may predate the flush.
    const latest = useAS.getState().items.get(entry.path)?.editContent ?? edit.editContent;
    if (latest === content) {
      edit.handleCancel();
    }
  };

  const handleToggleExpanded = useToggleExpanded(entry.path);

  const handleToggleExpandedEditor = () => {
    setExpandedEditor(!expandedEditor);
    onSaveSettings();
  };

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
      onToggleExpandedEditor={handleToggleExpandedEditor}
      showRewrite={!item?.reviewing && aiRewriteMode}
      onAiRewrite={aiRewrite}
      rewriteDisabled={edit.saving || isRewriting}
      isRewriting={isRewriting}
      selectedPromptName={selectedPromptName}
      hasSelection={hasSelection}
      showSaveCancel={!item?.reviewing}
      saving={edit.saving}
      onCancel={edit.handleCancel}
      onSave={() => void edit.handleSave()}
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
        className={maximized ? 'flex-1 min-h-0 flex flex-col' : undefined}
      >
        <div className={clsx(ENTRY_CONTENT_AREA, maximized && 'flex-1 min-h-0 flex flex-col')}>
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
                onSave={() => void edit.handleSave()}
                onSelectionChange={setHasSelection}
                fillHeight={maximized}
              />
            )
          ) : (
            <CodeMirrorEditor
              key="view"
              value={content || ''}
              onChange={() => {}}
              language={fileLanguage}
              readOnly
              onViewModeClick={(line) => void edit.handleEditClick(line)}
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
