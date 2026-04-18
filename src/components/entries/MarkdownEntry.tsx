import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowPathIcon, DocumentTextIcon, ClipboardDocumentIcon, ClipboardDocumentCheckIcon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import mermaid from 'mermaid';
import type { FileEntry } from '../../global';
import type { AppView } from '../../store/types';
import { buildEntryHeaderId } from '../../utils/entryDom';
import {
  useItem,
  setHighlightItem,
  clearItemGoToLine,
  toggleItemExpanded,
  navigateToBrowserPath,
  setPendingEditFile,
  setPendingThreadScrollToBottom,
  setItemReviewing,
} from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorDialog from '../dialogs/ErrorDialog';
import StreamingDialog from '../dialogs/StreamingDialog';
import CodeMirrorEditor from '../editor/CodeMirrorEditor';
import type { CodeMirrorEditorHandle } from '../editor/CodeMirrorEditor';
import DiffReviewEditor from '../editor/DiffReviewEditor';
import TagsPicker from './TagsPicker';
import { createCustomImage } from './markdownImgResolver';
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


// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

/**
 * Preprocess content to handle escaped dollar signs for LaTeX math.
 * Converts \$ to HTML entity &#36; so it renders as a literal $ 
 * without triggering math mode. This is the standard LaTeX escape convention.
 */
function preprocessMathEscapes(content: string): string {
  return content.replace(/\\\$/g, '&#36;');
}

/**
 * Preprocess wikilinks: convert [[target]] and [[target|alias]] syntax
 * into standard markdown links before rendering.
 *
 * Supports:
 *   [[file]]              → [file](file)
 *   [[file|description]]  → [description](file)
 *   [[file#section]]      → [file#section](file#section)
 *   [[file#section|desc]] → [desc](file#section)
 */
function preprocessWikiLinks(content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const pipeIndex = inner.indexOf('|');
    if (pipeIndex !== -1) {
      const target = inner.slice(0, pipeIndex).trim();
      const alias = inner.slice(pipeIndex + 1).trim();
      return `[${alias}](${target})`;
    }
    return `[${inner}](${inner})`;
  });
}

// Render queue to serialize mermaid renders (mermaid can't handle concurrent renders)
const mermaidRenderQueue: Array<() => Promise<void>> = [];
let isRenderingMermaid = false;

async function processMermaidQueue() {
  if (isRenderingMermaid || mermaidRenderQueue.length === 0) return;

  isRenderingMermaid = true;
  const task = mermaidRenderQueue.shift();

  if (task) {
    try {
      await task();
    } catch {
      // Error handled by the task itself
    }
  }

  isRenderingMermaid = false;

  // Process next item in queue
  if (mermaidRenderQueue.length > 0) {
    processMermaidQueue();
  }
}

function queueMermaidRender(task: () => Promise<void>) {
  mermaidRenderQueue.push(task);
  processMermaidQueue();
}

// Counter for unique IDs (more reliable than useId for mermaid)
let mermaidIdCounter = 0;

// Component to render Mermaid diagrams
function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const idRef = useRef<number | null>(null);

  // Assign a stable ID on mount
  if (idRef.current === null) {
    idRef.current = ++mermaidIdCounter;
  }

  useEffect(() => {
    let isMounted = true;
    const diagramId = idRef.current;

    setLoading(true);
    setSvg('');
    setError('');

    queueMermaidRender(async () => {
      try {
        const safeId = `mermaid-diagram-${diagramId}-${Date.now()}`;
        const result = await mermaid.render(safeId, code);

        if (isMounted) {
          // HACK_BEGIN
          // Mermaid's text-width measurement tends to run slightly narrow,
          // causing foreignObject labels to clip on the right edge.
          // Widen every foreignObject by 15% to give text room to breathe.
          const fixedSvg = result.svg.replace(
            /(<foreignObject\b[^>]*?\bwidth=")([^"]+)(")/g,
            (_match, prefix, widthStr, suffix) => {
              const newWidth = parseFloat(widthStr) * 1.15;
              return `${prefix}${newWidth}${suffix}`;
            }
          );
          setSvg(fixedSvg);
          // HACK_END

          setError('');
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setSvg('');
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [code]);

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded p-3 text-red-300 text-sm">
        <strong>Mermaid Error:</strong> {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <ArrowPathIcon className="animate-spin h-5 w-5 mr-3" />
        <span>Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram flex justify-center my-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Custom anchor component factory - creates a component that can access entry path
function createCustomAnchor(entryPath: string) {
  return function CustomAnchor({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href) return;

      // Handle external URLs - open in system browser
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        window.electronAPI.openExternalUrl(href);
        return;
      }

      // Handle relative links (./file.md, ../folder/file.md, or just file.md)
      // Skip anchor-only links and other protocols
      if (!href.startsWith('#') && !href.includes('://')) {
        e.preventDefault();

        // Get the directory containing this markdown file
        const currentDir = entryPath.substring(0, entryPath.lastIndexOf('/'));

        // Resolve the relative path
        let targetPath: string;
        if (href.startsWith('/')) {
          // Absolute path from root - use as-is
          targetPath = href;
        } else {
          // Relative path - resolve from current directory
          const parts = currentDir.split('/');
          const hrefParts = href.split('/');

          for (const part of hrefParts) {
            if (part === '..') {
              parts.pop();
            } else if (part !== '.' && part !== '') {
              parts.push(part);
            }
          }
          targetPath = parts.join('/');
        }

        // Extract folder and filename from the resolved path
        const lastSlash = targetPath.lastIndexOf('/');
        const folderPath = lastSlash > 0 ? targetPath.substring(0, lastSlash) : targetPath;

        // Navigate to the folder and scroll to/highlight the file
        setHighlightItem(targetPath);
        navigateToBrowserPath(folderPath, targetPath);
        return;
      }
    };

    return (
      <a href={href} onClick={handleClick} {...props}>
        {children}
      </a>
    );
  };
}

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
      console.error('Failed to copy:', err);
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
            className="absolute top-2 right-2 p-1.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
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
        className="absolute top-2 right-2 p-1.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
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

function MarkdownEntry({ entry, view, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings }: MarkdownEntryProps) {
  const item = useItem(entry.path);

  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
    showInsertIcons,
    nextOrdinalPrefix,
  } = useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: true });

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

  const [aiEnabled, setAiEnabled] = useState(false);
  const [selectedPromptName, setSelectedPromptName] = useState<string>('');
  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      setAiEnabled(!!config.aiEnabled);
      setSelectedPromptName(config.aiRewritePrompt ?? '');
    });
  }, []);

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
    setShowStreamingDialog(true);
    try {
      const parentFolder = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const result = await window.electronAPI.askAi(textToSend, parentFolder);
      if ('error' in result) {
        setAiErrorMessage(result.error);
      } else {
        pendingNavigationRef.current = () => {
          if (view === 'thread') {
            navigateToBrowserPath(result.responseFolder, undefined, 'thread');
            setPendingThreadScrollToBottom();
          } else {
            navigateToBrowserPath(result.responseFolder);
          }
        };
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleCancelStream = () => {
    window.electronAPI.cancelAiStream();
  };

  const handleReply = async () => {
    setIsReplyLoading(true);
    try {
      const parentFolder = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const result = await window.electronAPI.replyToAi(parentFolder, true);
      if ('error' in result) {
        console.error('Reply error:', result.error);
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

  return (
    <div className={`bg-slate-800 border group ${isHighlighted ? 'border-2 border-purple-500 relative z-10' : 'border-slate-700'} overflow-hidden`}>
      <div className="flex items-center gap-3 pl-4 pr-2 py-1 bg-slate-700/50 group-hover:bg-slate-700 border-b border-slate-700 transition-colors">
        <SelectionCheckbox
          path={entry.path}
          name={entry.name}
          isSelected={isSelected}
        />
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
                    } else {
                      setItemReviewing(entry.path, true, result.rewrittenContent);
                    }
                  } catch (err) {
                    console.error('Rewrite failed:', err);
                  } finally {
                    setIsRewriting(false);
                  }
                }}
                disabled={edit.saving || isRewriting}
                title={selectedPromptName ? `Rewrite as ${selectedPromptName}` : (hasSelection ? 'Rewrite selected text' : 'Rewrite')}
                className="px-3 py-1 text-sm text-slate-300 hover:text-white bg-slate-500 hover:bg-slate-400 rounded transition-colors disabled:opacity-50"
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
                  data-testid="entry-cancel-button"
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
            {isHumanFile && !item?.reviewing && (
              <button
                data-testid="ask-ai-button"
                onClick={async () => {
                  await edit.handleSave();
                  await handleAskAi(edit.editContent);
                }}
                disabled={edit.saving || isAiLoading}
                className="px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {isAiLoading ? 'Streaming...' : 'Ask AI'}
              </button>
            )}
          </div>
        ) : !isRenaming && (
          <>
            {isHumanFile && (
              <button
                data-testid="ask-ai-button"
                onClick={() => handleAskAi()}
                disabled={isAiLoading || !content}
                className="px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {isAiLoading ? 'Streaming...' : 'Ask AI'}
              </button>
            )}
            {isAiFile && (
              <button
                data-testid="ai-reply-button"
                onClick={handleReply}
                disabled={isReplyLoading}
                className="px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50 flex-shrink-0"
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
                className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
                title="Show in browser"
                data-testid="show-in-browser-button"
              >
                <ViewfinderCircleIcon className="w-5 h-5" />
              </button>
            )}
            <EntryActionBar
              path={entry.path}
              showInsertIcons={showInsertIcons}
              nextOrdinalPrefix={nextOrdinalPrefix}
              isBookmarked={isBookmarked}
              deleting={del.deleting}
              onRenameClick={rename.handleRenameClick}
              onDeleteClick={del.handleDeleteClick}
              onInsertFileBelow={onInsertFileBelow}
              onInsertFolderBelow={onInsertFolderBelow}
              onSaveSettings={onSaveSettings}
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
              )}
              <TagsPicker filePath={entry.path} />
            </>
          ) : (
            <article
              className="prose prose-invert prose-base max-w-none cursor-pointer"
              onDoubleClick={edit.handleEditClick}
              title="Double-click to edit"
            >
              <Markdown
                remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  a: createCustomAnchor(entry.path),
                  img: createCustomImage(entry.path),
                  code: CustomCode,
                  pre: CustomPre,
                }}
              >
                {preprocessWikiLinks(preprocessMathEscapes(content || ''))}
              </Markdown>
            </article>
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
