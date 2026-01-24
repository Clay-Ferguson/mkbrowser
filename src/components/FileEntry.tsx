import { useState, useRef, useEffect } from 'react';
import type { FileEntry as FileEntryType } from '../global';
import { buildEntryHeaderId } from '../utils/entryDom';
import { useItem, setItemRenaming, setItemSelected, toggleItemExpanded } from '../store';
import ConfirmDialog from './ConfirmDialog';

interface FileEntryProps {
  entry: FileEntryType;
  onRename: () => void;
  onDelete: () => void;
}

function FileEntry({ entry, onRename, onDelete }: FileEntryProps) {
  const item = useItem(entry.path);
  const [newName, setNewName] = useState(entry.name);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = item?.renaming ?? false;
  const isExpanded = item?.isExpanded ?? false;
  const isSelected = item?.isSelected ?? false;

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension
      const dotIndex = entry.name.lastIndexOf('.');
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [isRenaming, entry.name]);

  const handleRenameClick = () => {
    setNewName(entry.name);
    setItemRenaming(entry.path, true);
  };

  const handleCancel = () => {
    setNewName(entry.name);
    setItemRenaming(entry.path, false);
  };

  const handleSave = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === entry.name) {
      handleCancel();
      return;
    }

    setSaving(true);
    try {
      const dirPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const newPath = `${dirPath}/${trimmedName}`;
      const success = await window.electronAPI.renameFile(entry.path, newPath);
      if (success) {
        setItemRenaming(entry.path, false);
        onRename();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
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

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg border border-slate-700">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => setItemSelected(entry.path, e.target.checked)}
        className="h-5 w-5 accent-blue-500 flex-shrink-0"
        aria-label={`Select ${entry.name}`}
      />
      <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          id={buildEntryHeaderId(entry.name)}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          disabled={saving}
          className="flex-1 bg-slate-900 text-slate-200 px-2 py-1 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
        />
      ) : (
        <span id={buildEntryHeaderId(entry.name)} className="text-slate-400 truncate flex-1">{entry.name}</span>
      )}
      <button
        onClick={handleToggleExpanded}
        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
        title={isExpanded ? 'Collapse content' : 'Expand content'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isExpanded ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          )}
        </svg>
      </button>
      {!isRenaming && (
        <>
          <button
            onClick={handleRenameClick}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Rename"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={handleDeleteClick}
            disabled={deleting}
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </>
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

export default FileEntry;
