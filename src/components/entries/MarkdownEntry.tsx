import { useEffect, useState, useRef } from 'react';
import { PencilSquareIcon, ArrowTopRightOnSquareIcon, TrashIcon, Bars3Icon, DocumentPlusIcon, FolderPlusIcon, ArrowPathIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';
import type { FileEntry } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { CHECKBOX_CLASSES, RENAME_INPUT_CLASSES, INSERT_FILE_BUTTON_CLASSES, INSERT_FOLDER_BUTTON_CLASSES, RENAME_BUTTON_CLASSES, OPEN_EXTERNAL_BUTTON_CLASSES, DELETE_BUTTON_CLASSES } from '../../utils/styles';
import {
  useItem,
  useHighlightItem,
  setItemContent,
  setHighlightItem,
  setItemEditing,
  setItemRenaming,
  setItemSelected,
  setItemExpanded,
  toggleItemExpanded,
  isCacheValid,
  navigateToBrowserPath,
} from '../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../utils/ordinals';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CodeMirrorEditor from '../CodeMirrorEditor';

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

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

  // For other code blocks, render normally
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

interface MarkdownEntryProps {
  entry: FileEntry;
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
}

function MarkdownEntry({ entry, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow }: MarkdownEntryProps) {
  const item = useItem(entry.path);
  const highlightItem = useHighlightItem();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [newName, setNewName] = useState(entry.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isEditing = item?.editing ?? false;
  const isRenaming = item?.renaming ?? false;
  const isExpanded = item?.isExpanded ?? true;
  const isSelected = item?.isSelected ?? false;
  const isHighlighted = highlightItem === entry.name;
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
      <div className="flex items-center gap-3 px-4 py-1 bg-slate-800/50 border-b border-slate-700">
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
          <div className="flex items-center gap-1">
            <button
              onClick={handleEditClick}
              className={RENAME_BUTTON_CLASSES}
              title="Edit content"
            >
              <Bars3Icon className="w-5 h-5" />
            </button>
            <button
              onClick={handleRenameClick}
              className={RENAME_BUTTON_CLASSES}
              title="Rename"
            >
              <PencilSquareIcon className="w-5 h-5" />
            </button>
            {showInsertIcons && (
              <>
                <button
                  onClick={handleInsertFileBelow}
                  className={INSERT_FILE_BUTTON_CLASSES}
                  title="Insert file below"
                >
                  <DocumentPlusIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={handleInsertFolderBelow}
                  className={INSERT_FOLDER_BUTTON_CLASSES}
                  title="Insert folder below"
                >
                  <FolderPlusIcon className="w-5 h-5" />
                </button>
              </>
            )}
            <button
              onClick={() => window.electronAPI.openExternal(entry.path)}
              className={OPEN_EXTERNAL_BUTTON_CLASSES}
              title="Open with system default"
            >
              <ArrowTopRightOnSquareIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleDeleteClick}
              disabled={deleting}
              className={DELETE_BUTTON_CLASSES}
              title="Delete"
            >
              <TrashIcon className="w-5 h-5" />
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
            />
          ) : (
            <article 
              className="prose prose-invert prose-base max-w-none cursor-pointer" 
              onDoubleClick={handleEditClick}
              title="Double-click to edit"
            >
              <Markdown
                remarkPlugins={[[remarkMath, { singleDollarTextMath: false }]]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  a: createCustomAnchor(entry.path),
                  code: CustomCode,
                }}
              >
                {content || ''}
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
