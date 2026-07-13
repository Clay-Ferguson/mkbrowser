import { useEffect, useState, useRef } from 'react';
import { clsx } from 'clsx';
import { DocumentTextIcon, ArrowLeftEndOnRectangleIcon, TagIcon as TagIconOutline, AdjustmentsHorizontalIcon as PropsIconOutline, PaperClipIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { TagIcon as TagIconSolid, AdjustmentsHorizontalIcon as PropsIconSolid } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import { saveAiConfig } from '../../renderer/config';
import type { FileEntry } from '../../global';
import type { AppView } from '../../shared/types';
import { removeTOC } from '../../shared/tocUtil';
import { splitFrontMatter } from '../../shared/frontMatterUtil';
import {
  useAS,
  hasAnyCutItems,
  setHighlightItem,
  clearItemGoToLine,
  navigateToBrowserPath,
  setPendingEditFile,
  setPendingThreadScrollToBottom,
  setItemReviewing,
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


/**
 * Creates the reply HUMAN.md for the next conversation turn and navigates to it.
 * Module-level (not in the component) so its try/catch/finally doesn't make the
 * React Compiler bail out on MarkdownEntry.
 */
async function replyToAiAndNavigate(entryPath: string, view: AppView): Promise<void> {
  try {
    const parentFolder = getParentPath(entryPath);
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
  } catch (err) {
    logger.error('Reply error:', err);
  }
}


/**
 * Entry component for Markdown files. Expands inline to show a rendered MarkdownView; clicking
 * the content area (or any block) opens an inline CodeMirror editor. Supports:
 * - AI rewrite of the whole document or a selected range (via the shared streaming dialog)
 * - Ask AI (sends the file content to the AI; only shown for HUMAN.md files)
 * - Reply (creates a new HUMAN.md for the next conversation turn; only shown for AI.md files)
 * - Tags panel and front-matter properties display/editing
 * - Calendar-info editing via a dedicated dialog
 * - Paste-as-attachment workflows (both cut-items and clipboard)
 * In document mode, timestamp-based file names are hidden from the header row.
 */
function MarkdownEntry(props: MarkdownEntryProps) {
  const { entry, view, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, onPasteAsAttachment, onPasteClipboardAsAttachment, isAttachment = false } = props;
  const item = useAS(s => s.items.get(entry.path));
  const hasCutItems = useAS(s => hasAnyCutItems(s.items));

  const { core, rename, del, loading, content, edit } = useEditableEntry(props, {
    defaultExpanded: true,
    errorMessage: '*Error reading file*',
  });
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  const { showToc, showPropsInEditor, expandedEditor } = useAS(s => s.settings);
  const hasIndexFile = useAS(s => s.hasIndexFile);
  // Expanded-editor mode: this entry is maximized to fill the browse area, so the shell,
  // content area, and editor all become nested flex columns (BrowseView flexes the outer chain).
  const maximized = expandedEditor && edit.isEditing;

  // Only exit edit mode on Escape when the content is unmodified (comparing without TOC, since the
  // TOC block is stripped on edit entry). If the user has typed something, Escape falls through to
  // CodeMirror (e.g. to dismiss autocomplete).
  const handleEscape = () => {
    if (edit.editContent === removeTOC(content)) {
      edit.handleCancel();
    }
  };

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

  // When enabling the props panel for the first time on a file that has no front matter,
  // prepend an empty YAML block so the editor starts inside the delimiters.
  const handleToggleShowProps = () => {
    const turningOn = !showPropsInEditor;
    if (turningOn && !splitFrontMatter(edit.editContent)) {
      edit.setEditContent('---\n\n---\n' + edit.editContent);
      // Position cursor on the blank line between the two '---' delimiters (offset 4). Applied via
      // goToPosition so it runs deterministically after the editor syncs the new content.
      setPendingCursorPos(4);
    }
    setShowPropsInEditor(turningOn);
    onSaveSettings();
  };

  const handleToggleExpandedEditor = () => {
    setExpandedEditor(!expandedEditor);
    onSaveSettings();
  };

  const isHumanFile = aiEnabled && entry.name === HUMAN_FILENAME;
  const isAiFile = aiEnabled && entry.name === AI_FILENAME;
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);

  // Registers the editor handle so that external callers (e.g. global search jump-to-line) can
  // reach the live CodeMirror instance. Registration happens in the onReady callback rather than
  // an effect because effects can run before the imperative handle is attached on first mount.
  // The effect below handles unregistration when editing ends, the path changes, or the component unmounts.
  const handleEditorReady = (handle: CodeMirrorEditorHandle) => {
    registerActiveMarkdownEditor(entry.path, handle);
  };

  useEffect(() => {
    // Returns the useEffect cleanup (an unsubscribe-style teardown): unregisters this active Markdown editor when editing ends, the path changes, or on unmount.
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

  // Promise .finally() instead of try/finally: the React Compiler bails out on
  // any try statement with a finalizer, which would de-optimize this component.
  const handleAskAi = async (promptContent?: string) => {
    const textToSend = promptContent || content;
    if (!textToSend) return;
    setIsAiLoading(true);
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
    }).finally(() => setIsAiLoading(false));
  };

  const { isRewriting, aiRewrite: handleAiRewrite } = useAiRewrite({
    path: entry.path,
    hasIndexFile,
    editorRef,
    editContent: edit.editContent,
    onError: setAiErrorMessage,
    runner: runWithStreamingDialog,
  });

  const handleReply = () => {
    setIsReplyLoading(true);
    void replyToAiAndNavigate(entry.path, view).finally(() => setIsReplyLoading(false));
  };

  const onAskAI = () => {
    void (async () => {
      await edit.handleSave();
      await handleAskAi(edit.editContent);
    })();
  };
  
  const headerRight = edit.isEditing ? (
    <EntryEditToolbar
      expandedEditor={expandedEditor}
      onToggleExpandedEditor={handleToggleExpandedEditor}
      showRewrite={!item?.reviewing && aiRewriteMode}
      onAiRewrite={handleAiRewrite}
      rewriteDisabled={edit.saving || isRewriting}
      isRewriting={isRewriting}
      selectedPromptName={selectedPromptName}
      hasSelection={hasSelection}
      showSaveCancel={!item?.reviewing}
      saving={edit.saving}
      onCancel={edit.handleCancel}
      onSave={() => void edit.handleSave()}
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
            onClick={onAskAI}
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

  const clickOnProp = (key: string): void => {
    void (async () => {
      const propPrefix = `${key}:`;
      const line = content.split('\n').findIndex(l => l.startsWith(propPrefix)) + 1;
      await edit.handleEditClick(line > 0 ? line : undefined);
      setShowPropsInEditor(true);
      onSaveSettings();
    })();
  };

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
        headerRight={headerRight}
        className={maximized ? 'flex-1 min-h-0 flex flex-col' : undefined}
      >
        <div
          className={clsx(ENTRY_CONTENT_AREA, maximized && 'flex-1 min-h-0 flex flex-col')}
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
                    onSave={() => void edit.handleSave()}
                    onSelectionChange={setHasSelection}
                    showPropsInEditor={showPropsInEditor}
                    fillHeight={maximized}
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
                  onTagClick={() => {
                    void (async () => {
                      await edit.handleEditClick();
                      setTagsVisible(true);
                    })();
                  }}
                  onPropClick={clickOnProp}
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
