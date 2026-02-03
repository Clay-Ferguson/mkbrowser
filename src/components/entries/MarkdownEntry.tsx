import { useEffect, useState, useRef } from 'react';
import { PencilSquareIcon, PencilIcon, ArrowTopRightOnSquareIcon, TrashIcon, DocumentPlusIcon, FolderPlusIcon, ArrowPathIcon, DocumentTextIcon, ClipboardDocumentIcon, ClipboardDocumentCheckIcon, BookmarkIcon as BookmarkOutlineIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import mermaid from 'mermaid';
import type { FileEntry } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { CHECKBOX_CLASSES, RENAME_INPUT_CLASSES, BUTTON_CLZ_INSERT_FILE, BUTTON_CLZ_INSERT_FOLDER, BUTTON_CLZ_RENAME, BUTTON_CLZ_OPEN_EXTERNAL, BUTTON_CLZ_DELETE, BUTTON_CLZ_BOOKMARK } from '../../utils/styles';
import {
  useItem,
  useHighlightItem,
  useSettings,
  setItemContent,
  setHighlightItem,
  setItemEditing,
  clearItemGoToLine,
  setItemRenaming,
  setItemSelected,
  setItemExpanded,
  toggleItemExpanded,
  toggleBookmark,
  updateBookmarkPath,
  isCacheValid,
  navigateToBrowserPath,
} from '../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../utils/ordinals';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CodeMirrorEditor from '../CodeMirrorEditor';
import { createCustomImage } from './markdownImgResolver';

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
          setSvg(result.svg);
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
        const fileName = lastSlash > 0 ? targetPath.substring(lastSlash + 1) : targetPath;
        
        // Navigate to the folder and scroll to/highlight the file
        setHighlightItem(fileName);
        navigateToBrowserPath(folderPath, fileName);
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

interface MarkdownEntryProps {
  entry: FileEntry;
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
  onSaveSettings: () => void;
}

function MarkdownEntry({ entry, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings }: MarkdownEntryProps) {
  const item = useItem(entry.path);
  const highlightItem = useHighlightItem();
  const settings = useSettings();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [newName, setNewName] = useState(entry.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const editInitialized = useRef(false);

  const isEditing = item?.editing ?? false;
  const isRenaming = item?.renaming ?? false;
  const isExpanded = item?.isExpanded ?? true;
  const isSelected = item?.isSelected ?? false;
  const isHighlighted = highlightItem === entry.name;
  const isBookmarked = (settings.bookmarks || []).includes(entry.path);
  const showInsertIcons = hasOrdinalPrefix(entry.name);
  const nextOrdinalPrefix = showInsertIcons ? getNextOrdinalPrefix(entry.name) : null;

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      // Select filename without extension
      const dotIndex = entry.name.lastIndexOf('.');
      if (dotIndex > 0) {
        renameInputRef.current.setSelectionRange(0, dotIndex);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [isRenaming, entry.name]);

  // Reset initialization flag when exiting edit mode
  useEffect(() => {
    if (!isEditing) {
      editInitialized.current = false;
    }
  }, [isEditing]);

  // Initialize editContent when entering edit mode and content is available
  // This handles external triggers (e.g., from search results edit button)
  useEffect(() => {
    if (isEditing && !editInitialized.current && item?.content !== undefined) {
      setEditContent(item.content);
      editInitialized.current = true;
    }
  }, [isEditing, item?.content]);

  // Load content if not cached or cache is stale
  useEffect(() => {
    const loadContent = async () => {
      if (!isExpanded) {
        return;
      }

      // Check if we have valid cached content
      if (isCacheValid(entry.path)) {
        return;
      }

      setLoading(true);
      try {
        const content = await window.electronAPI.readFile(entry.path);
        setItemContent(entry.path, content);
      } catch (err) {
        setItemContent(entry.path, '*Error reading file*');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [entry.path, entry.modifiedTime, isExpanded]);

  // Get content from cache or show loading state
  const content = item?.content ?? '';

  const handleEditClick = () => {
    setEditContent(content);
    editInitialized.current = true;
    setItemExpanded(entry.path, true);
    setItemEditing(entry.path, true);
  };

  const handleCancel = () => {
    setEditContent('');
    setItemEditing(entry.path, false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await window.electronAPI.writeFile(entry.path, editContent);
      if (success) {
        setItemContent(entry.path, editContent);
        setItemEditing(entry.path, false);
        setEditContent('');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRenameClick = () => {
    setNewName(entry.name);
    setItemRenaming(entry.path, true);
  };

  const handleRenameCancel = () => {
    setNewName(entry.name);
    setItemRenaming(entry.path, false);
  };

  const handleRenameSave = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === entry.name) {
      handleRenameCancel();
      return;
    }

    setRenameSaving(true);
    try {
      const dirPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const newPath = `${dirPath}/${trimmedName}`;
      const success = await window.electronAPI.renameFile(entry.path, newPath);
      if (success) {
        // Update bookmark if this item was bookmarked
        if (updateBookmarkPath(entry.path, newPath)) {
          onSaveSettings();
        }
        setItemRenaming(entry.path, false);
        setHighlightItem(trimmedName);
        onRename();
      }
    } finally {
      setRenameSaving(false);
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    setShowDeleteConfirm(false);
    setDeleting(true);
    try {
      const success = await window.electronAPI.deleteFile(entry.path);
      if (success) {
        onDelete();
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const handleBookmarkClick = () => {
    toggleBookmark(entry.path);
    onSaveSettings();
  };

  const handleToggleExpanded = () => {
    toggleItemExpanded(entry.path);
  };

  const handleInsertFileBelow = () => {
    if (nextOrdinalPrefix) {
      onInsertFileBelow(nextOrdinalPrefix);
    }
  };

  const handleInsertFolderBelow = () => {
    if (nextOrdinalPrefix) {
      onInsertFolderBelow(nextOrdinalPrefix);
    }
  };

  return (
    <div className={`bg-slate-800 rounded-lg border ${isHighlighted ? 'border-2 border-purple-500' : 'border-slate-700'} overflow-hidden`}>
      <div className="flex items-center gap-3 pl-4 pr-2 py-1 bg-slate-800/50 border-b border-slate-700">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => setItemSelected(entry.path, e.target.checked)}
          className={CHECKBOX_CLASSES}
          aria-label={`Select ${entry.name}`}
        />
        <DocumentTextIcon className="w-5 h-5 text-blue-400 flex-shrink-0" />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            id={buildEntryHeaderId(entry.name)}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSave}
            disabled={renameSaving}
            className={`${RENAME_INPUT_CLASSES} font-medium`}
          />
        ) : (
          <span
            id={buildEntryHeaderId(entry.name)}
            onClick={handleToggleExpanded}
            className="text-slate-300 font-medium truncate flex-1 cursor-pointer no-underline"
            title={isExpanded ? 'Collapse content' : 'Expand content'}
          >
            {entry.name}
          </span>
        )}
        {isEditing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-3 py-1 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        ) : !isRenaming && (
          <div className="flex items-center gap-1 -mr-1.5">
            <button
              onClick={handleEditClick}
              className={BUTTON_CLZ_RENAME}
              title="Edit content"
            >
              <PencilSquareIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleRenameClick}
              className={BUTTON_CLZ_RENAME}
              title="Rename"
            >
              <PencilIcon className="w-5 h-5" />
            </button>
            {showInsertIcons && (
              <>
                <button
                  onClick={handleInsertFileBelow}
                  className={BUTTON_CLZ_INSERT_FILE}
                  title="Insert file below"
                >
                  <DocumentPlusIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={handleInsertFolderBelow}
                  className={BUTTON_CLZ_INSERT_FOLDER}
                  title="Insert folder below"
                >
                  <FolderPlusIcon className="w-5 h-5" />
                </button>
              </>
            )}
            <button
              onClick={() => window.electronAPI.openExternal(entry.path)}
              className={BUTTON_CLZ_OPEN_EXTERNAL}
              title="Open with system default"
            >
              <ArrowTopRightOnSquareIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleDeleteClick}
              disabled={deleting}
              className={BUTTON_CLZ_DELETE}
              title="Delete"
            >
              <TrashIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleBookmarkClick}
              className={BUTTON_CLZ_BOOKMARK}
              title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            >
              {isBookmarked ? (
                <BookmarkSolidIcon className="w-5 h-5 text-blue-400" />
              ) : (
                <BookmarkOutlineIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="px-6 py-4">
          {loading && !content ? (
            <div className="text-slate-400 text-sm">Loading...</div>
          ) : isEditing ? (
            <CodeMirrorEditor
              value={editContent}
              onChange={setEditContent}
              placeholder="Enter markdown content..."
              language="markdown"
              autoFocus
              goToLine={item?.goToLine}
              onGoToLineComplete={() => clearItemGoToLine(entry.path)}
            />
          ) : (
            <article 
              className="prose prose-invert prose-base max-w-none cursor-pointer" 
              onDoubleClick={handleEditClick}
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
                {preprocessMathEscapes(content || '')}
              </Markdown>
            </article>
          )}
        </div>
      )}
      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete "${entry.name}"?`}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default MarkdownEntry;
