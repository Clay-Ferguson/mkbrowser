import { useState, useRef } from 'react';
import { clsx } from 'clsx';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import {
  clearItemGoToLine,
  useAS,
  toggleItemExpanded,
} from '../../store';
import CodeMirrorEditor from '../editor/CodeMirrorEditor';
import type { CodeMirrorEditorHandle } from '../editor/CodeMirrorEditor';
import AlertDialog from '../dialogs/AlertDialog';
import {
  useEditableEntry,
  useEditorChrome,
  useAiConfig,
  useAiRewrite,
  EntryActionBar,
  EntryEditToolbar,
  EntryShell,
  bindAttachMenu,
  type BaseEntryProps,
  type AttachMenuProps,
} from './common';
import { getTextFileLanguage } from '../../shared/fileTypes';
import { ENTRY_CONTENT_AREA, ENTRY_LOADING } from '../../renderer/styles';


type TextEntryProps = BaseEntryProps & AttachMenuProps;

/**
 * Entry component for plain-text files. Expands inline to show a read-only CodeMirror view;
 * clicking the content area opens an editable CodeMirror editor. Supports AI rewrite of the
 * whole document or a selected range; after a rewrite completes, the editor itself enters an
 * in-place diff review (CodeMirror's unified merge view) via its `reviewText` prop.
 */
function TextEntry(props: TextEntryProps) {
  const { entry, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false, alwaysExpandedEditor = false } = props;
  const item = useAS(s => s.items.get(entry.path));
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const fileLanguage = getTextFileLanguage(entry.name);
  const { selectedPromptName } = useAiConfig();

  const { core, rename, del, loading, content, edit } = useEditableEntry(props, {
    defaultExpanded: true,
    errorMessage: 'Error reading file',
  });
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  const hasIndexFile = useAS(s => s.hasIndexFile);
  const chrome = useEditorChrome({
    path: entry.path,
    edit,
    alwaysExpandedEditor,
    // `alwaysExpandedEditor` callers (BrowseFile) hand this entry the whole pane, so it fills
    // the available height in *view* mode too — not just while editing. In the folder listing
    // the entry is one row among many, so there maximizing stays tied to editing.
    fillPaneWhenViewing: true,
    onCancel: edit.handleCancel,
  });
  const { maximized } = chrome;

  const handleToggleExpanded = () => toggleItemExpanded(entry.path);

  const { isRewriting, aiRewrite } = useAiRewrite({
    path: entry.path,
    hasIndexFile,
    editorRef,
    editContent: edit.editContent,
    onError: setAiErrorMessage,
  });

  const headerRight = edit.isEditing ? (
    <EntryEditToolbar
      {...chrome.toolbarProps}
      showRewrite={chrome.canRewrite}
      onAiRewrite={aiRewrite}
      rewriteDisabled={edit.saving || isRewriting}
      isRewriting={isRewriting}
      selectedPromptName={selectedPromptName}
      hasSelection={hasSelection}
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
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onMoveToTop={onMoveToTop}
      onMoveToBottom={onMoveToBottom}
      className="-mr-1.5"
      isAttachment={isAttachment}
      {...bindAttachMenu(entry.path, props)}
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
        isEditing={edit.isEditing}
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
              onEscape={chrome.handleEscape}
              onForceCancel={edit.handleCancel}
              onSave={() => void edit.handleSave()}
              onSaveKeepEditing={edit.handleSaveKeepEditing}
              onSelectionChange={setHasSelection}
              fillHeight={maximized}
              {...chrome.reviewProps}
            />
          ) : (
            <CodeMirrorEditor
              key="view"
              value={content || ''}
              onChange={() => {}}
              language={fileLanguage}
              readOnly
              fillHeight={maximized}
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
