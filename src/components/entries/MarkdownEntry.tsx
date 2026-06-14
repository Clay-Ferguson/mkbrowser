import { useEffect, useState, useRef, useCallback } from 'react';
import { DocumentTextIcon, ArrowLeftEndOnRectangleIcon, TagIcon as TagIconOutline, AdjustmentsHorizontalIcon as PropsIconOutline, PaperClipIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { TagIcon as TagIconSolid, AdjustmentsHorizontalIcon as PropsIconSolid } from '@heroicons/react/24/solid';
import Markdown from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import { api } from '../../services/api';
import 'katex/dist/katex.min.css';
import type { FileEntry } from '../../global';
import type { AppView } from '../../types/types';
import { removeTOC } from '../../utils/tocUtil';
import { preprocessMathEscapes, stripHtmlComments, preprocessWikiLinks, splitOnColumnBreaks, safeUrlTransform } from '../../utils/mkUtil';
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
import { createCustomImage } from '../markdownImgResolver';
import CustomAnchor from '../CustomAnchor';
import CustomCode from '../CustomCode';
import CustomPre from '../CustomPre';
import { createBlockClickComponents } from '../blockClickComponents';
import { logger } from '../../utils/logUtil';
import { getParentPath } from '../../utils/pathUtil';
import { registerActiveMarkdownEditor, unregisterActiveMarkdownEditor } from '../../utils/activeMarkdownEditor';
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
import { BUTTON_CLASS_BLUE, BUTTON_CLASS_SM_PURPLE, BUTTON_CLASS_ICON_SOLID_BLUE, ENTRY_CONTENT_AREA, ENTRY_LOADING, ENTRY_EDITOR_ICON_BTN } from '../../utils/styles';


interface MarkdownEntryProps extends BaseEntryProps {
  entry: FileEntry;
  view: AppView;
  onPasteAsAttachment?: (filePath: string) => void;
  onPasteClipboardAsAttachment?: (filePath: string) => void;
  isAttachment?: boolean;
}

const TIMESTAMP_FILENAME_RE = /^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}-(AM|PM)\.md$/;

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

  const blockComponents = createBlockClickComponents(edit.handleEditClick);

  const handleEscape = useCallback(() => {
    if (edit.editContent === removeTOC(content)) {
      edit.handleCancel();
    }
  }, [edit.editContent, content, edit.handleCancel]);

  const handleToggleExpanded = useToggleExpanded(entry.path);

  const [showCalendarDialog, setShowCalendarDialog] = useState(false);
  // Pending cursor offset to apply once the editor reflects a content change (see handleToggleShowProps)
  const [pendingCursorPos, setPendingCursorPos] = useState<number | null>(null);
  const { aiEnabled, aiRewriteMode, selectedPromptName, tagsVisible, setTagsVisible } = useAiConfig();

  const handleToggleTagsVisible = () => {
    const newVisible = !tagsVisible;
    setTagsVisible(newVisible);
    api.updateConfig({ tagsPanelVisible: newVisible }).catch((err) => {
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

  const isHumanFile = aiEnabled && entry.name === 'HUMAN.md';
  const isAiFile = aiEnabled && entry.name === 'AI.md';
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);

  useEffect(() => {
    if (edit.isEditing && editorRef.current) {
      registerActiveMarkdownEditor(entry.path, editorRef.current);
    } else {
      unregisterActiveMarkdownEditor(entry.path);
    }
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
        setPendingEditFile(result.filePath, undefined, view);
      }
    } finally {
      setIsReplyLoading(false);
    }
  };

  const rawContent = showToc ? (content || '') : removeTOC(content || '');
  const processedContent = preprocessWikiLinks(preprocessMathEscapes(stripHtmlComments(rawContent)));
  const columns = splitOnColumnBreaks(processedContent);
  const columnBlockComponents = columns.map(col => createBlockClickComponents(edit.handleEditClick, col.lineOffset));

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
            onClick={handleToggleShowProps}
            title={showPropsInEditor ? 'Hide properties' : 'Show properties'}
            className={`${ENTRY_EDITOR_ICON_BTN} border ${showPropsInEditor ? 'border-slate-400' : 'border-transparent'}`}
          >
            {showPropsInEditor
              ? <PropsIconSolid className="w-5 h-5" />
              : <PropsIconOutline className="w-5 h-5" />}
          </button>
          <button
            onClick={handleToggleTagsVisible}
            title={tagsVisible ? 'Hide tags' : 'Show tags'}
            className={`${ENTRY_EDITOR_ICON_BTN} border ${tagsVisible ? 'border-slate-400' : 'border-transparent'}`}
          >
            {tagsVisible
              ? <TagIconSolid className="w-5 h-5" />
              : <TagIconOutline className="w-5 h-5" />}
          </button>
          <button
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
                  onAcceptAll={(finalText) => {
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
              {columns.length > 1 ? (
                <div
                  style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: '1.5rem' }}
                >
                  {columns.map((col, i) => (
                    <article
                      key={col.lineOffset}
                      className={`prose prose-invert prose-base max-w-none prose-hr:border-slate-400 prose-hr:my-2${i > 0 ? ' border-l border-slate-600 pl-6' : ''}`}
                    >
                      <Markdown
                        remarkPlugins={[remarkFrontmatter, remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
                        rehypePlugins={[rehypeKatex, rehypeSlug]}
                        // react-markdown strips any URL whose scheme isn't in its default
                        // whitelist, so file:// links would be silently dropped. safeUrlTransform
                        // allow-lists the schemes we need (incl. file://) while still blocking
                        // dangerous ones like javascript:.
                        urlTransform={safeUrlTransform}
                        components={{
                          ...columnBlockComponents[i],
                          a: (props) => <CustomAnchor entryPath={entry.path} {...props} />,
                          img: createCustomImage(entry.path),
                          code: CustomCode,
                          pre: CustomPre,
                        }}
                      >
                        {col.text}
                      </Markdown>
                    </article>
                  ))}
                </div>
              ) : (
                <article
                  className="prose prose-invert prose-base max-w-none prose-hr:border-slate-400 prose-hr:my-2"
                >
                  <Markdown
                    remarkPlugins={[remarkFrontmatter, remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
                    rehypePlugins={[rehypeKatex, rehypeSlug]}
                    // react-markdown strips any URL whose scheme isn't in its default
                    // whitelist, so file:// links would be silently dropped. safeUrlTransform
                    // allow-lists the schemes we need (incl. file://) while still blocking
                    // dangerous ones like javascript:.
                    urlTransform={safeUrlTransform}
                    components={{
                      ...blockComponents,
                      a: (props) => <CustomAnchor entryPath={entry.path} {...props} />,
                      img: createCustomImage(entry.path),
                      code: CustomCode,
                      pre: CustomPre,
                    }}
                  >
                    {columns[0].text}
                  </Markdown>
                </article>
              )}
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
