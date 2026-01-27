import { useState, useRef, useEffect } from 'react';
import { PencilSquareIcon, ArrowTopRightOnSquareIcon, TrashIcon, DocumentPlusIcon, FolderPlusIcon, DocumentIcon } from '@heroicons/react/24/outline';
import type { FileEntry as FileEntryType } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { CHECKBOX_CLASSES, ENTRY_CONTAINER_CLASSES, RENAME_INPUT_CLASSES, INSERT_FILE_BUTTON_CLASSES, INSERT_FOLDER_BUTTON_CLASSES, RENAME_BUTTON_CLASSES, OPEN_EXTERNAL_BUTTON_CLASSES, DELETE_BUTTON_CLASSES } from '../../utils/styles';
import { useItem, useHighlightItem, setHighlightItem, setItemRenaming, setItemSelected, toggleItemExpanded } from '../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../utils/ordinals';
import ConfirmDialog from '../dialogs/ConfirmDialog';

interface FileEntryProps {
  entry: FileEntryType;
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
}

function FileEntry({ entry, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow }: FileEntryProps) {
  const item = useItem(entry.path);
  const highlightItem = useHighlightItem();
  const [newName, setNewName] = useState(entry.name);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = item?.renaming ?? false;
  const isExpanded = item?.isExpanded ?? false;
  const isSelected = item?.isSelected ?? false;
  const isHighlighted = highlightItem === entry.name;
  const showInsertIcons = hasOrdinalPrefix(entry.name);
  const nextOrdinalPrefix = showInsertIcons ? getNextOrdinalPrefix(entry.name) : null;

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
        setHighlightItem(trimmedName);
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
    <div className={`${ENTRY_CONTAINER_CLASSES} ${isHighlighted ? 'border-purple-500' : 'border-slate-700'}`}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => setItemSelected(entry.path, e.target.checked)}
        className={CHECKBOX_CLASSES}
        aria-label={`Select ${entry.name}`}
      />
      <DocumentIcon className="w-5 h-5 text-slate-500 flex-shrink-0" />
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
          className={RENAME_INPUT_CLASSES}
        />
      ) : (
        <span
          id={buildEntryHeaderId(entry.name)}
          onClick={handleToggleExpanded}
          className="text-slate-400 truncate flex-1 cursor-pointer no-underline"
          title={isExpanded ? 'Collapse content' : 'Expand content'}
        >
          {entry.name}
        </span>
      )}
      {!isRenaming && (
        <>
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
            onClick={handleRenameClick}
            className={RENAME_BUTTON_CLASSES}
            title="Rename"
          >
            <PencilSquareIcon className="w-5 h-5" />
          </button>
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
