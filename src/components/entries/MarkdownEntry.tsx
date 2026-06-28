import { useEffect, useState, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { DocumentTextIcon, ArrowLeftEndOnRectangleIcon, TagIcon as TagIconOutline, AdjustmentsHorizontalIcon as PropsIconOutline, PaperClipIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { TagIcon as TagIconSolid, AdjustmentsHorizontalIcon as PropsIconSolid } from '@heroicons/react/24/solid';
import { api } from '../../services/api';
import { saveAiConfig } from '../../config';
import type { FileEntry } from '../../global';
import type { AppView } from '../../shared/types';
import { removeTOC } from '../../shared/tocUtil';
import {
  useItem,
  useSettings,
  useHasCutItems,
  setHighlightItem,
  clearItemGoToLine,
  navigateToBrowserPath,
  setPendingEditFile,
  setPendingThreadScrollToBottom,
  setItemReviewing,
  useHasIndexFile,
  useExpandedEditor,
  setExpandedEditor,
  setShowPropsInEditor,
} from '../../store';
import AlertDialog from '../dialogs/AlertDialog';
import StreamingDialog from '../dialogs/StreamingDialog';
import EditCalendarDialog from '../dialogs/EditCalendarDialog';
import CodeMirrorEditor from '../editor/CodeMirrorEditor';
import type { CodeMirrorEditorHandle } from '../editor/CodeMirrorEditor';
import DiffReviewEditor from '../editor/DiffReviewEditor';
import TagsPicker from '../TagsPicker';
import PropsDisplay from '../PropsDisplay';
import MarkdownView from './MarkdownView';
import { logger } from '../../shared/logUtil';
import { getParentPath } from '../../renderer/pathUtil';
import { registerActiveMarkdownEditor, unregisterActiveMarkdownEditor } from '../../renderer/activeMarkdownEditor';
import { HUMAN_FILENAME, AI_FILENAME } from '../../shared/specialFiles';
import { TIMESTAMP_FILENAME_RE } from '../../shared/timeUtil';
import {
  useEditableEntry,
  useToggleExpanded,
  useAiConfig,
  useAiRewrite,
  useAiStreamingDialog,
  EntryActionBar,
  EntryEditToolbar,
  EntryShell,
  type BaseEntryProps,
} from './common';
import { BUTTON_CLASS_BLUE, BUTTON_CLASS_SM_PURPLE, BUTTON_CLASS_ICON_SOLID_BLUE, ENTRY_CONTENT_AREA, ENTRY_LOADING, ENTRY_EDITOR_ICON_BTN } from '../../renderer/styles';


interface MarkdownEntryProps extends BaseEntryProps {
  entry: FileEntry;
  view: AppView;
  onPasteAsAttachment?: (filePath: string) => void;
  onPasteClipboardAsAttachment?: (filePath: string) => void;
  isAttachment?: boolean;
}


function MarkdownEntry(props: MarkdownEntryProps) {
  const { entry, view, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, onPasteAsAttachment, onPasteClipboardAsAttachment, isAttachment = false, documentMode = false } = props;
  const item = useItem(entry.path);
  const hasCutItems = useHasCutItems();

  const { core, rename, del, loading, content, edit } = useEditableEntry(props, {
    defaultExpanded: true,
    errorMessage: '*Error reading file*',
  });
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  const { showToc, showPropsInEditor } = useSettings();
  const hasIndexFile = useHasIndexFile();
  const expandedEditor = useExpandedEditor();

  const { editContent: editEditContent, handleCancel: editHandleCancel } = edit;
  const handleEscape = useCallback(() => {
    if (editEditContent === removeTOC(content)) {
      editHandleCancel();
    }
  }, [editEditContent, content, editHandleCancel]);

  const handleToggleExpanded = useToggleExpanded(entry.path);

  const [showCalendarDialog, setShowCalendarDialog] = useState(false);
  // Pending cursor offset to apply once the editor reflects a content change (see handleToggleShowProps)
  const [pendingCursorPos, setPendingCursorPos] = useState<number | null>(null);
  const { aiEnabled, aiRewriteMode, selectedPromptName, tagsVisible, setTagsVisible } = useAiConfig();

  const handleToggleTagsVisible = () => {
    // saveAiConfig both persists and mirrors into the store (which the editor
    // subscribes to), so this updates the panel and survives a restart.
    saveAiConfig({ tagsPanelVisible: !tagsVisible }).catch((err) => {
      logger.error('Failed to persist tags-panel visibility:', err);
    });
  };

  const handleToggleShowProps = () => {
    const turningOn = !showPropsInEditor;
    if (turningOn && !edit.editContent.startsWith('---')) {
      edit.setEditContent('---\n\n---\n' + edit.editContent);
      // Position cursor on the blank line between the two '---' delimiters (offset 4). Applied via
      // goToPosition so it runs deterministically after the editor syncs the new content.
      setPendingCursorPos(4);
    }
    setShowPropsInEditor(turningOn);
    onSaveSettings();
  };

  const isHumanFile = aiEnabled && entry.name === HUMAN_FILENAME;
  const isAiFile = aiEnabled && entry.name === AI_FILENAME;
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);

  // Register from the editor's onReady callback (rather than reading editorRef in an effect, which
  // can run before the imperative handle is attached on first mount). The effect below handles
  // unregistration when editing ends, the path changes, or the component unmounts.
  const handleEditorReady = useCallback((handle: CodeMirrorEditorHandle) => {
    registerActiveMarkdownEditor(entry.path, handle);
  }, [entry.path]);

  useEffect(() => {
    return () => {
      unregisterActiveMarkdownEditor(entry.path);
    };
  }, [edit.isEditing, entry.path]);
  const [isReplyLoading, setIsReplyLoading] = useState(false);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);

  const {
    showStreamingDialog,
    handleStreamingDialogClose,
    handleCancelStream,
    runWithStreamingDialog,
  } = useAiStreamingDialog({ onError: setAiErrorMessage });

  const handleAskAi = async (promptContent?: string) => {
    const textToSend = promptContent || content;
    if (!textToSend) return;
    setIsAiLoading(true);
    try {
      await runWithStreamingDialog(async (defer) => {
        const parentFolder = getParentPath(entry.path);
        const result = await api.askAi(textToSend, parentFolder);
        if ('error' in result) {
          setAiErrorMessage(result.error);
        } else {
          defer(() => {
            if (view === 'thread') {
              navigateToBrowserPath(result.responseFolder, undefined, 'thread');
              setPendingThreadScrollToBottom();
            } else {
              navigateToBrowserPath(result.responseFolder);
            }
          });
        }
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  const { isRewriting, aiRewrite: handleAiRewrite } = useAiRewrite({
    path: entry.path,
    hasIndexFile,
    editorRef,
    editContent: edit.editContent,
    onError: setAiErrorMessage,
    runner: runWithStreamingDialog,
  });

  const handleReply = async () => {
    setIsReplyLoading(true);
    try {
      const parentFolder = getParentPath(entry.path);
      const result = await api.replyToAi(parentFolder, true);
      if ('error' in result) {
        logger.error('Reply error:', result.error);
      } else {
        if (view === 'thread') {
          navigateToBrowserPath(result.folderPath, undefined, 'thread');
          setPendingThreadScrollToBottom();
        } else {
          navigateToBrowserPath(result.folderPath, `${result.folderPath}/HUMAN.md`, view);
        }
        setPendingEditFile(result.filePath, view);
      }
    } finally {
      setIsReplyLoading(false);
    }
  };

  const headerRight = edit.isEditing ? (
    <EntryEditToolbar
      expandedEditor={expandedEditor}
      onToggleExpandedEditor={() => setExpandedEditor(!expandedEditor)}
      showRewrite={!item?.reviewing && aiRewriteMode}
      onAiRewrite={handleAiRewrite}
      rewriteDisabled={edit.saving || isRewriting}
      isRewriting={isRewriting}
      selectedPromptName={selectedPromptName}
      hasSelection={hasSelection}
      showSaveCancel={!item?.reviewing}
      saving={edit.saving}
      onCancel={edit.handleCancel}
      onSave={edit.handleSave}
      leftExtras={
        <>
          <button
            type="button"
            onClick={handleToggleShowProps}
            title={showPropsInEditor ? 'Hide properties' : 'Show properties'}
            className={clsx(ENTRY_EDITOR_ICON_BTN, 'border', showPropsInEditor ? 'border-slate-400' : 'border-transparent')}
          >
            {showPropsInEditor
              ? <PropsIconSolid className="w-5 h-5" />
              : <PropsIconOutline className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={handleToggleTagsVisible}
            title={tagsVisible ? 'Hide tags' : 'Show tags'}
            className={clsx(ENTRY_EDITOR_ICON_BTN, 'border', tagsVisible ? 'border-slate-400' : 'border-transparent')}
          >
            {tagsVisible
              ? <TagIconSolid className="w-5 h-5" />
              : <TagIconOutline className="w-5 h-5" />}
          </button>
          <button
            type="button"
            data-testid="edit-calendar-info"
            onClick={() => setShowCalendarDialog(true)}
            title="Calendar Info"
            className={`${ENTRY_EDITOR_ICON_BTN} border border-transparent`}
          >
            <CalendarIcon className="w-5 h-5" />
          </button>
        </>
      }
      middleExtras={
        isHumanFile && !item?.reviewing ? (
          <button
            type="button"
            data-testid="ask-ai-button"
            onClick={async () => {
              await edit.handleSave();
              await handleAskAi(edit.editContent);
            }}
            disabled={edit.saving || isAiLoading}
            className={`${BUTTON_CLASS_SM_PURPLE} flex-shrink-0`}
          >
            {isAiLoading ? 'Streaming...' : 'Ask AI'}
          </button>
        ) : undefined
      }
    />
  ) : (
    <>
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
        onPasteClipboardAsAttachment={onPasteClipboardAsAttachment ? () => onPasteClipboardAsAttachment(entry.path) : undefined}
      />
      {hasCutItems && onPasteAsAttachment && !entry.hasAttachFolder && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPasteAsAttachment(entry.path); }}
          className={BUTTON_CLASS_ICON_SOLID_BLUE}
          title="Paste cut items as attachments to this file"
          aria-label="Paste cut items as attachments to this file"
        >
          <PaperClipIcon className="w-4 h-4 text-white" />
        </button>
      )}
      {view === 'thread' && (
        <button
          type="button"
          onClick={() => {
            const folderPath = getParentPath(entry.path);
            setHighlightItem(entry.path);
            navigateToBrowserPath(folderPath, entry.path);
          }}
          className={BUTTON_CLASS_BLUE}
          title="Show in Browse View"
          data-testid="show-in-browser-button"
        >
          <ArrowLeftEndOnRectangleIcon className="w-5 h-5" />
        </button>
      )}
      {isAiFile && (
        <button
          type="button"
          data-testid="ai-reply-button"
          onClick={handleReply}
          disabled={isReplyLoading}
          className={`${BUTTON_CLASS_SM_PURPLE} flex-shrink-0`}
        >
          {isReplyLoading ? 'Creating...' : 'Reply'}
        </button>
      )}
    </>
  );

  return (
    <>
      <EntryShell
        data-testid="browser-entry-markdown"
        entry={entry}
        icon={<DocumentTextIcon className="w-5 h-5 text-blue-400" />}
        isAttachment={isAttachment}
        isHighlighted={isHighlighted}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isRenaming={isRenaming}
        rename={rename}
        del={del}
        onToggleExpanded={handleToggleExpanded}
        renameClassName="font-medium"
        nameContent={!isExpanded || !(documentMode && TIMESTAMP_FILENAME_RE.test(entry.name)) ? entry.name : ''}
        headerRight={headerRight}
      >
        <div
          className={ENTRY_CONTENT_AREA}
          onMouseUp={!edit.isEditing ? (e) => { if (e.button === 0 && !window.getSelection()?.toString()) void edit.handleEditClick(); } : undefined}
        >
          {loading && !content ? (
            <div className={ENTRY_LOADING}>Loading...</div>
          ) : edit.isEditing ? (
            <>
              {item?.reviewing && item.rewrittenContent !== undefined ? (
                <DiffReviewEditor
                  originalText={edit.editContent}
                  modifiedText={item.rewrittenContent}
                  language="markdown"
                  onComplete={(finalText) => {
                    edit.setEditContent(finalText);
                    setItemReviewing(entry.path, false);
                  }}
                  onCancel={() => setItemReviewing(entry.path, false)}
                />
              ) : (
                <>
                  {tagsVisible && <TagsPicker filePath={entry.path} />}
                  <CodeMirrorEditor
                    ref={editorRef}
                    onReady={handleEditorReady}
                    value={edit.editContent}
                    onChange={edit.setEditContent}
                    placeholder="Enter markdown content..."
                    language="markdown"
                    autoFocus
                    goToLine={item?.goToLine}
                    onGoToLineComplete={() => clearItemGoToLine(entry.path)}
                    goToPosition={pendingCursorPos}
                    onGoToPositionComplete={() => setPendingCursorPos(null)}
                    onEscape={handleEscape}
                    onForceCancel={edit.handleCancel}
                    onSave={edit.handleSave}
                    onSelectionChange={setHasSelection}
                    showPropsInEditor={showPropsInEditor}
                    fileName={entry.name}
                    filePath={entry.path}
                    onMakeCalendarItem={() => {
                      setShowPropsInEditor(true);
                      onSaveSettings();
                    }}
                    onMakeRepeatingCalendarItem={() => {
                      setShowPropsInEditor(true);
                      onSaveSettings();
                    }}
                  />
                </>
              )}
            </>
          ) : (
            <>
              {(item?.tags?.length || item?.props && Object.keys(item.props).filter(k => k !== 'id').length > 0) && (
                <PropsDisplay
                  tags={item.tags ?? []}
                  props={item.props}
                  onTagClick={async () => {
                    await edit.handleEditClick();
                    setTagsVisible(true);
                  }}
                  onPropClick={async (key) => {
                    const line = (content?.split('\n') ?? []).findIndex(l => l.startsWith(`${key}:`)) + 1;
                    await edit.handleEditClick(line > 0 ? line : undefined);
                    setShowPropsInEditor(true);
                    onSaveSettings();
                  }}
                />
              )}
              <MarkdownView
                content={content || ''}
                showToc={showToc}
                entryPath={entry.path}
                onEditClick={edit.handleEditClick}
              />
            </>
          )}
        </div>
      </EntryShell>
      {showCalendarDialog && (
        <EditCalendarDialog
          content={edit.editContent}
          onSave={(newContent) => {
            edit.setEditContent(newContent);
            setShowCalendarDialog(false);
            // setShowPropsInEditor(true);
            onSaveSettings();
          }}
          onCancel={() => setShowCalendarDialog(false)}
        />
      )}
      {aiErrorMessage && (
        <AlertDialog
          scrollable
          title="Error"
          message={aiErrorMessage}
          onClose={() => setAiErrorMessage(null)}
        />
      )}
      {showStreamingDialog && (
        <StreamingDialog
          onClose={handleStreamingDialogClose}
          onCancel={handleCancelStream}
        />
      )}
    </>
  );
}

export default MarkdownEntry;
