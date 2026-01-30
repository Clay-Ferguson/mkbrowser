import { useEffect, useState, useRef } from 'react';
import { PencilSquareIcon, PencilIcon, ArrowTopRightOnSquareIcon, TrashIcon, DocumentPlusIcon, FolderPlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import type { FileEntry } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { CHECKBOX_CLASSES, RENAME_INPUT_CLASSES, INSERT_FILE_BUTTON_CLASSES, INSERT_FOLDER_BUTTON_CLASSES, RENAME_BUTTON_CLASSES, OPEN_EXTERNAL_BUTTON_CLASSES, DELETE_BUTTON_CLASSES } from '../../utils/styles';
import {
  useItem,
  useHighlightItem,
  setItemContent,
  setHighlightItem,
  setItemEditing,
  clearItemGoToLine,
  setItemRenaming,
  setItemSelected,
  setItemExpanded,
  toggleItemExpanded,
  isCacheValid,
} from '../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../utils/ordinals';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CodeMirrorEditor from '../CodeMirrorEditor';

interface TextEntryProps {
  entry: FileEntry;
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
}

function TextEntry({ entry, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow }: TextEntryProps) {
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
  const editInitialized = useRef(false);

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
      <div className="flex items-center gap-3 pl-4 pr-2 py-1 bg-slate-800/50 border-b border-slate-700">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => setItemSelected(entry.path, e.target.checked)}
          className={CHECKBOX_CLASSES}
          aria-label={`Select ${entry.name}`}
        />
        {/* Text file icon - document with lines */}
        <DocumentTextIcon className="w-5 h-5 text-emerald-400 flex-shrink-0" />
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
              <PencilSquareIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleRenameClick}
              className={RENAME_BUTTON_CLASSES}
              title="Rename"
            >
              <PencilIcon className="w-5 h-5" />
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
              placeholder="Enter text content..."
              language="text"
              autoFocus
              goToLine={item?.goToLine}
              onGoToLineComplete={() => clearItemGoToLine(entry.path)}
            />
          ) : (
            <pre 
              className="text-slate-200 font-mono text-sm whitespace-pre-wrap break-words cursor-pointer" 
              onDoubleClick={handleEditClick}
              title="Double-click to edit"
            >
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
