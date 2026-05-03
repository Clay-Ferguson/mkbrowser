import { useEffect, useState, useRef, useCallback } from 'react';
import { DocumentTextIcon, ClipboardDocumentIcon, ClipboardDocumentCheckIcon, ViewfinderCircleIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, TagIcon as TagIconOutline } from '@heroicons/react/24/outline';
import { TagIcon as TagIconSolid } from '@heroicons/react/24/solid';
import Markdown from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { FileEntry } from '../../global';
import type { AppView } from '../../store/types';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { removeTOC } from '../../utils/tocUtils';
import { preprocessMathEscapes, stripHtmlComments, preprocessWikiLinks, splitOnColumnBreaks } from '../../utils/mkUtils';
import {
  useItem,
  useSettings,
  setHighlightItem,
  clearItemGoToLine,
  toggleItemExpanded,
  navigateToBrowserPath,
  setPendingEditFile,
  setPendingThreadScrollToBottom,
  setItemReviewing,
  useHasIndexFile,
  useIndexYaml,
  useExpandedEditor,
  setExpandedEditor,
} from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorDialog from '../dialogs/ErrorDialog';
import StreamingDialog from '../dialogs/StreamingDialog';
import CodeMirrorEditor from '../editor/CodeMirrorEditor';
import type { CodeMirrorEditorHandle } from '../editor/CodeMirrorEditor';
import DiffReviewEditor from '../editor/DiffReviewEditor';
import TagsPicker from './TagsPicker';
import { createCustomImage } from './markdownImgResolver';
import CustomAnchor from './CustomAnchor';
import MermaidDiagram from './MermaidDiagram';
import { logger } from '../../utils/logUtil';
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


// Custom code component for syntax highlighting and mermaid diagrams
function CustomCode({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  // Check if this is a mermaid code block
  if (language === 'mermaid') {
    return <MermaidDiagram code={codeString} />;
  }

  // For fenced code blocks with a language, use syntax highlighting
  if (language) {
    return (
      <SyntaxHighlighter
        style={oneDark as { [key: string]: React.CSSProperties }}
        language={language}
        PreTag="div"
        customStyle={{ margin: 0, border: '1px solid #475569', borderRadius: '0.375rem' }}
      >
        {codeString}
      </SyntaxHighlighter>
    );
  }

  // For inline code or code blocks without a language, render normally
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

// Custom pre component with copy-to-clipboard button
function CustomPre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);

  // Check if the child code element has a language class (meaning SyntaxHighlighter or Mermaid will render it)
  const codeElement = children as React.ReactElement;
  const codeClassName = (codeElement?.props as { className?: string })?.className || '';
  const languageMatch = /language-(\w+)/.exec(codeClassName);
  const hasLanguage = !!languageMatch;
  const isMermaid = languageMatch?.[1] === 'mermaid';

  const handleCopy = async () => {
    // Extract text content from children (the code element)
    const codeContent = (codeElement?.props as { children?: string })?.children;
    const textToCopy = String(codeContent).replace(/\n$/, '');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  };

  // For code blocks with a language (SyntaxHighlighter or Mermaid), don't wrap in <pre>
  if (hasLanguage) {
    return (
      <div className="relative group not-prose">
        {children}
        {!isMermaid && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? (
              <ClipboardDocumentCheckIcon className="w-4 h-4 text-green-400" />
            ) : (
              <ClipboardDocumentIcon className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative group">
      <pre {...props}>{children}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? (
          <ClipboardDocumentCheckIcon className="w-4 h-4 text-green-400" />
        ) : (
          <ClipboardDocumentIcon className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

interface MarkdownEntryProps extends BaseEntryProps {
  entry: FileEntry;
  view: AppView;
}

function MarkdownEntry({ entry, view, onRename, onDelete, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom }: MarkdownEntryProps) {
  const item = useItem(entry.path);

  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
  } = useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: true });

  const { showToc } = useSettings();
  const hasIndexFile = useHasIndexFile();
  const indexYaml = useIndexYaml();
  const editMode = indexYaml?.options?.edit_mode ?? false;
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
    errorMessage: '*Error reading file*',
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

  const [tagsVisible, setTagsVisible] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [selectedPromptName, setSelectedPromptName] = useState<string>('');
  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      setAiEnabled(!!config.aiEnabled);
      setSelectedPromptName(config.aiRewritePrompt ?? '');
      setTagsVisible(config.tagsPanelVisible ?? false);
    });
  }, []);

  const handleToggleTagsVisible = async () => {
    const newVisible = !tagsVisible;
    setTagsVisible(newVisible);
    const config = await window.electronAPI.getConfig();
    await window.electronAPI.saveConfig({ ...config, tagsPanelVisible: newVisible });
  };

  const isHumanFile = aiEnabled && entry.name === 'HUMAN.md';
  const isAiFile = aiEnabled && entry.name === 'AI.md';
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const [isReplyLoading, setIsReplyLoading] = useState(false);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [showStreamingDialog, setShowStreamingDialog] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  const handleStreamingDialogClose = () => {
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

    // Show the streaming dialog only when the first real chunk arrives.
    // Checking hasScriptedAnswer() here is useless — it lives in the main
    // process and is always false from the renderer's perspective.
    const unsubscribeChunk = window.electronAPI.onAiStreamChunk(() => {
      setShowStreamingDialog(true);
      unsubscribeChunk();
    });

    try {
      const parentFolder = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const result = await window.electronAPI.askAi(textToSend, parentFolder);
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
        // If the streaming dialog is visible it will trigger navigation when it
        // closes; otherwise navigate immediately (e.g. scripted / non-streaming).
        if (showStreamingDialog) {
          pendingNavigationRef.current = navigate;
        } else {
          navigate();
        }
      }
    } finally {
      unsubscribeChunk();
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

  return (
    <div data-testid="browser-entry-markdown" className={`bg-slate-800 group ${isHighlighted ? 'border-2 border-purple-500 relative z-10' : ''} overflow-hidden`}>
      <div className={`flex items-center gap-3 pl-4 pr-2 py-1 bg-blue-800/50 group-hover:bg-blue-700/70 ${isExpanded ? 'border border-slate-500' : ''} transition-colors`}>
        {(!hasIndexFile || editMode) && (
          <SelectionCheckbox
            path={entry.path}
            name={entry.name}
            isSelected={isSelected}
          />
        )}
        <DocumentTextIcon className="w-5 h-5 text-blue-400 flex-shrink-0" />
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
            <button
              onClick={handleToggleTagsVisible}
              title={tagsVisible ? 'Hide tags' : 'Show tags'}
              className="p-1 text-slate-200 hover:text-slate-100 hover:bg-slate-600 rounded transition-colors cursor-pointer"
            >
              {tagsVisible
                ? <TagIconSolid className="w-5 h-5" />
                : <TagIconOutline className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setExpandedEditor(!expandedEditor)}
              title={expandedEditor ? 'Collapse editor' : 'Expand editor'}
              className="p-1 text-slate-200 hover:text-slate-100 hover:bg-slate-600 rounded transition-colors cursor-pointer"
            >
              {expandedEditor
                ? <ArrowsPointingInIcon className="w-5 h-5" />
                : <ArrowsPointingOutIcon className="w-5 h-5" />}
            </button>
            {!item?.reviewing && (
              <button
                onClick={handleAiRewrite}
                disabled={edit.saving || isRewriting}
                title={selectedPromptName ? `Rewrite as ${selectedPromptName}` : (hasSelection ? 'Rewrite selected text' : 'Rewrite')}
                className="px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50 cursor-pointer"
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
                className="px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50 flex-shrink-0 cursor-pointer"
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
                  className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50 cursor-pointer"
                  data-testid="entry-save-button"
                >
                  {edit.saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        ) : !isRenaming && (
          <>
            {isAiFile && (
              <button
                data-testid="ai-reply-button"
                onClick={handleReply}
                disabled={isReplyLoading}
                className="px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50 flex-shrink-0 cursor-pointer"
              >
                {isReplyLoading ? 'Creating...' : 'Reply'}
              </button>
            )}
            {view === 'thread' && (
              <button
                onClick={() => {
                  const folderPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
                  setHighlightItem(entry.path);
                  navigateToBrowserPath(folderPath, entry.path);
                }}
                className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors cursor-pointer"
                title="Show in browser"
                data-testid="show-in-browser-button"
              >
                <ViewfinderCircleIcon className="w-5 h-5" />
              </button>
            )}
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
          </>
        )}
      </div>
      {isExpanded && (
        <div className="px-6 py-4">
          {loading && !content ? (
            <div className="text-slate-400 text-sm">Loading...</div>
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
                  />
                </>
              )}
            </>
          ) : (
            columns.length > 1 ? (
              <div
                style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: '1.5rem' }}
                className="cursor-pointer"
                onDoubleClick={edit.handleEditClick}
                title="Double-click to edit"
              >
                {columns.map((col, i) => (
                  <article
                    key={i}
                    className={`prose prose-invert prose-base max-w-none${i > 0 ? ' border-l border-slate-600 pl-6' : ''}`}
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
                        a: (props) => <CustomAnchor entryPath={entry.path} {...props} />,
                        img: createCustomImage(entry.path),
                        code: CustomCode,
                        pre: CustomPre,
                      }}
                    >
                      {col}
                    </Markdown>
                  </article>
                ))}
              </div>
            ) : (
              <article
                className="prose prose-invert prose-base max-w-none cursor-pointer"
                onDoubleClick={edit.handleEditClick}
                title="Double-click to edit"
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
                    a: (props) => <CustomAnchor entryPath={entry.path} {...props} />,
                    img: createCustomImage(entry.path),
                    code: CustomCode,
                    pre: CustomPre,
                  }}
                >
                  {columns[0]}
                </Markdown>
              </article>
            )
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
      {showStreamingDialog && (
        <StreamingDialog
          onClose={handleStreamingDialogClose}
          onCancel={handleCancelStream}
        />
      )}
    </div>
  );
}

export default MarkdownEntry;
