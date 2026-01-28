import { useState, useRef, useEffect } from 'react';
import { PencilSquareIcon, ArrowTopRightOnSquareIcon, TrashIcon, DocumentPlusIcon, FolderPlusIcon } from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { CHECKBOX_CLASSES, ENTRY_CONTAINER_CLASSES, RENAME_INPUT_CLASSES, INSERT_FILE_BUTTON_CLASSES, INSERT_FOLDER_BUTTON_CLASSES, RENAME_BUTTON_CLASSES, OPEN_EXTERNAL_BUTTON_CLASSES, DELETE_BUTTON_CLASSES } from '../../utils/styles';
import { useItem, useHighlightItem, setHighlightItem, setItemRenaming, setItemSelected } from '../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../utils/ordinals';
import ConfirmDialog from '../dialogs/ConfirmDialog';

interface FolderEntryProps {
  entry: FileEntry;
  onNavigate: (path: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
}

function FolderEntry({ entry, onNavigate, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow }: FolderEntryProps) {
  const item = useItem(entry.path);
  const highlightItem = useHighlightItem();
  const [newName, setNewName] = useState(entry.name);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = item?.renaming ?? false;
  const isSelected = item?.isSelected ?? false;
  const isHighlighted = highlightItem === entry.name;
  const showInsertIcons = hasOrdinalPrefix(entry.name);
  const nextOrdinalPrefix = showInsertIcons ? getNextOrdinalPrefix(entry.name) : null;

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleInputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleInsertFileBelow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (nextOrdinalPrefix) {
      onInsertFileBelow(nextOrdinalPrefix);
    }
  };

  const handleInsertFolderBelow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (nextOrdinalPrefix) {
      onInsertFolderBelow(nextOrdinalPrefix);
    }
  };

  return (
    <div
      onClick={() => !isRenaming && onNavigate(entry.path)}
      className={`w-full ${ENTRY_CONTAINER_CLASSES} ${isHighlighted ? 'border-2 border-purple-500' : 'border-slate-700 hover:border-slate-600'} hover:bg-slate-750 transition-colors text-left cursor-pointer`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => setItemSelected(entry.path, e.target.checked)}
        onClick={handleCheckboxClick}
        className={CHECKBOX_CLASSES}
        aria-label={`Select ${entry.name}`}
      />
      <FolderIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          id={buildEntryHeaderId(entry.name)}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          onClick={handleInputClick}
          disabled={saving}
          className={`${RENAME_INPUT_CLASSES} font-medium`}
        />
      ) : (
        <span id={buildEntryHeaderId(entry.name)} className="text-slate-200 font-medium truncate flex-1">{entry.name}</span>
      )}
      {isRenaming ? (
        <div className="flex-shrink-0" />
      ) : (
        <div className="flex items-center gap-1">
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
            onClick={(e) => {
              e.stopPropagation();
              window.electronAPI.openExternal(entry.path);
            }}
            className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 rounded transition-colors"
            title="Open in file manager"
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
      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete the folder "${entry.name}" and all its contents?`}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default FolderEntry;
