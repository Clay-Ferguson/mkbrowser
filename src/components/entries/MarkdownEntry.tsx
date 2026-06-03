import { useEffect, useState, useRef, useCallback } from 'react';
import { DocumentTextIcon, ArrowLeftEndOnRectangleIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, TagIcon as TagIconOutline, AdjustmentsHorizontalIcon as PropsIconOutline, PaperClipIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { TagIcon as TagIconSolid, AdjustmentsHorizontalIcon as PropsIconSolid } from '@heroicons/react/24/solid';
import Markdown from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import 'katex/dist/katex.min.css';
import type { FileEntry } from '../../global';
import type { AppView } from '../../types/types';
import { removeTOC } from '../../utils/tocUtil';
import { preprocessMathEscapes, stripHtmlComments, preprocessWikiLinks, splitOnColumnBreaks } from '../../utils/mkUtil';
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
  useIndexYaml,
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
import { registerActiveMarkdownEditor, unregisterActiveMarkdownEditor } from '../../utils/activeMarkdownEditor';
import {
  useEditableEntry,
  useToggleExpanded,
  EntryActionBar,
  EntryShell,
  type BaseEntryProps,
} from './common';
import { BUTTON_CLASS_BLUE, BUTTON_CLASS_SM_BLUE, BUTTON_CLASS_SM_PURPLE, BUTTON_CLASS_ICON_SOLID_BLUE, ENTRY_CONTENT_AREA, ENTRY_LOADING, ENTRY_EDITOR_ICON_BTN } from '../../utils/styles';


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
  // Consolidated into a single state object so the mount-time config load
  // fires ONE React update instead of four. Four separate setState calls per
  // mount multiplied the update pressure that was tripping React's nested
  // update limit when entries re-mount.
  const [entryConfig, setEntryConfig] = useState({
    aiEnabled: false,
    aiRewriteMode: false,
    selectedPromptName: '',
    tagsVisible: false,
  });
  const { aiEnabled, aiRewriteMode, selectedPromptName, tagsVisible } = entryConfig;
  const setTagsVisible = useCallback((visible: boolean) => {
    setEntryConfig((prev) => ({ ...prev, tagsVisible: visible }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getConfig().then((config) => {
      if (cancelled) return;
      setEntryConfig({
        aiEnabled: !!config.aiEnabled,
        aiRewriteMode: !!config.aiRewriteMode,
        selectedPromptName: config.aiRewritePrompt ?? '',
        tagsVisible: config.tagsPanelVisible ?? false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleTagsVisible = async () => {
    const newVisible = !tagsVisible;
    setTagsVisible(newVisible);
    await window.electronAPI.updateConfig({ tagsPanelVisible: newVisible });
  };

  const handleToggleShowProps = () => {
    const turningOn = !showPropsInEditor;
    if (turningOn && !edit.editContent.startsWith('---')) {
      edit.setEditContent('---\n\n---\n' + edit.editContent);
      // Position cursor on the blank line between the two '---' delimiters (offset 4)
      setTimeout(() => editorRef.current?.focusAtPosition(4), 50);
    }
    setShowPropsInEditor(turningOn);
    onSaveSettings();
  };

  const isHumanFile = aiEnabled && entry.name === 'HUMAN.md';
  const isAiFile = aiEnabled && entry.name === 'AI.md';
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
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
  const [showStreamingDialog, setShowStreamingDialog] = useState(false);
  const showStreamingDialogRef = useRef(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  const handleStreamingDialogClose = () => {
    showStreamingDialogRef.current = false;
    setShowStreamingDialog(false);
    if (pendingNavigationRef.current) {
      pendingNavigationRef.current();
      pendingNavigationRef.current = null;
    }
  };

  const handleAskAi = async (promptContent?: string) => {
    const textToSend = promptContent || content;
    if (!textToSend) return;
    setIsAiLoading(true);

    // Only show the streaming dialog when actual stream events arrive.
    // Scripted answers (used in tests) resolve immediately with no events,
    // so the dialog should never appear for them.
    const unsubChunk = window.electronAPI.onAiStreamChunk(() => {
      if (!showStreamingDialogRef.current) {
        showStreamingDialogRef.current = true;
        setShowStreamingDialog(true);
      }
      unsubChunk();
    });

    try {
      const parentFolder = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const result = await window.electronAPI.askAi(textToSend, parentFolder);
      unsubChunk(); // no-op if already fired; cancels if scripted (no chunks came)
      if ('error' in result) {
        setAiErrorMessage(result.error);
      } else {
        const navigate = () => {
          if (view === 'thread') {
            navigateToBrowserPath(result.responseFolder, undefined, 'thread');
            setPendingThreadScrollToBottom();
          } else {
            navigateToBrowserPath(result.responseFolder);
          }
        };
        // Use ref (not state) for a synchronous check: if streaming started,
        // defer navigation until the user closes the dialog; otherwise navigate now.
        if (showStreamingDialogRef.current) {
          pendingNavigationRef.current = navigate;
        } else {
          navigate();
        }
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleCancelStream = () => {
    window.electronAPI.cancelAiStream();
  };

  const handleAiRewrite = async () => {
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

  const handleReply = async () => {
    setIsReplyLoading(true);
    try {
      const parentFolder = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const result = await window.electronAPI.replyToAi(parentFolder, true);
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
    <div className="flex items-center gap-2">
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
                onClick={handleAiRewrite}
                disabled={edit.saving || isRewriting}
                title={selectedPromptName ? `Rewrite as ${selectedPromptName}` : (hasSelection ? 'Rewrite selected text' : 'Rewrite')}
                className={BUTTON_CLASS_SM_PURPLE}
              >
                {isRewriting ? 'Rewriting with AI...' : (hasSelection ? 'AI Rewrite Selection' : 'AI Rewrite')}
              </button>
            )}
            {isHumanFile && !item?.reviewing && (
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
            )}
            {!item?.reviewing && (
              <>
                <button
                  onClick={edit.handleCancel}
                  disabled={edit.saving}
                  className="px-3 py-1 text-sm text-white bg-red-700 hover:bg-red-600 rounded transition-colors disabled:opacity-50 cursor-pointer"
                  data-testid="entry-cancel-button"
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
                  const folderPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
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
          onMouseUp={!edit.isEditing ? () => { if (!window.getSelection()?.toString()) edit.handleEditClick(); } : undefined}
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
                    onEscape={handleEscape}
                    onForceCancel={edit.handleCancel}
                    onSave={edit.handleSave}
                    onSelectionChange={setHasSelection}
                    showPropsInEditor={showPropsInEditor}
                    fileName={entry.name}
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
                      key={i}
                      className={`prose prose-invert prose-base max-w-none prose-hr:border-slate-400 prose-hr:my-2${i > 0 ? ' border-l border-slate-600 pl-6' : ''}`}
                    >
                      <Markdown
                        remarkPlugins={[remarkFrontmatter, remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
                        rehypePlugins={[rehypeKatex, rehypeSlug]}
                        // react-markdown v10 strips any URL whose protocol isn't in its default
                        // whitelist (http, https, mailto, etc.), so file:// links would be silently
                        // replaced with an empty string. An identity function bypasses that
                        // sanitization and lets our CustomAnchor handler receive the full URL intact.
                        urlTransform={(url) => url}
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
                    // react-markdown v10 strips any URL whose protocol isn't in its default
                    // whitelist (http, https, mailto, etc.), so file:// links would be silently
                    // replaced with an empty string. An identity function bypasses that
                    // sanitization and lets our CustomAnchor handler receive the full URL intact.
                    urlTransform={(url) => url}
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
