import { useEffect, useState, useRef } from 'react';
import type { FileEntry } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import {
  useItem,
  setItemContent,
  setItemEditing,
  setItemRenaming,
  setItemSelected,
  setItemExpanded,
  toggleItemExpanded,
  isCacheValid,
} from '../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../utils/ordinals';
import ConfirmDialog from '../dialogs/ConfirmDialog';

interface TextEntryProps {
  entry: FileEntry;
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
}

function TextEntry({ entry, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow }: TextEntryProps) {
  const item = useItem(entry.path);
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
        setItemContent(entry.path, 'Error reading file');
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
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-1 bg-slate-800/50 border-b border-slate-700">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => setItemSelected(entry.path, e.target.checked)}
          className="h-5 w-5 accent-blue-500 flex-shrink-0"
          aria-label={`Select ${entry.name}`}
        />
        {/* Text file icon - document with lines */}
        <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
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
            className="flex-1 bg-slate-900 text-slate-200 px-2 py-1 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm font-medium"
          />
        ) : (
          <span
            id={buildEntryHeaderId(entry.name)}
            onClick={handleToggleExpanded}
            className="text-slate-300 font-medium truncate flex-1 cursor-pointer hover:underline"
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
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
              title="Edit content"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
            <button
              onClick={handleRenameClick}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
              title="Rename"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            {showInsertIcons && (
              <>
                <button
                  onClick={handleInsertFileBelow}
                  className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
                  title="Insert file below"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>
                <button
                  onClick={handleInsertFolderBelow}
                  className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-700 rounded transition-colors"
                  title="Insert folder below"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                </button>
              </>
            )}
            <button
              onClick={() => window.electronAPI.openExternal(entry.path)}
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 rounded transition-colors"
              title="Open with system default"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
            <button
              onClick={handleDeleteClick}
              disabled={deleting}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
              title="Delete"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="px-6 py-4">
          {loading && !content ? (
            <div className="text-slate-400 text-sm">Loading...</div>
          ) : isEditing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-64 bg-slate-900 text-slate-200 font-mono text-sm p-3 rounded border border-slate-600 focus:border-blue-500 focus:outline-none resize-y"
              placeholder="Enter text content..."
            />
          ) : (
            <pre className="text-slate-200 font-mono text-sm whitespace-pre-wrap break-words">
              {content || ''}
            </pre>
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

export default TextEntry;
