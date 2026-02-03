import { useState, useRef, useEffect, useCallback } from 'react';
import { setHighlightItem, setItemRenaming, updateBookmarkPath } from '../../../store';
import type { RenameState } from './types';

interface UseRenameOptions {
  /** Full path of the entry */
  path: string;
  /** Current name of the entry */
  name: string;
  /** Whether rename mode is active */
  isRenaming: boolean;
  /** Callback after successful rename */
  onRename: () => void;
  /** Callback when bookmark path is updated */
  onSaveSettings: () => void;
  /** Whether to select full name (folders) or name without extension (files) */
  selectFullName?: boolean;
}

/**
 * Hook that handles rename logic for Entry components.
 * Provides state, refs, and handlers for the rename input.
 */
export function useRename({
  path,
  name,
  isRenaming,
  onRename,
  onSaveSettings,
  selectFullName = false,
}: UseRenameOptions): RenameState {
  const [newName, setNewName] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      if (selectFullName) {
        inputRef.current.select();
      } else {
        // Select filename without extension
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
          inputRef.current.setSelectionRange(0, dotIndex);
        } else {
          inputRef.current.select();
        }
      }
    }
  }, [isRenaming, name, selectFullName]);

  const handleRenameClick = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNewName(name);
    setItemRenaming(path, true);
  }, [name, path]);

  const handleCancel = useCallback(() => {
    setNewName(name);
    setItemRenaming(path, false);
  }, [name, path]);

  const handleSave = useCallback(async () => {
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === name) {
      handleCancel();
      return;
    }

    setSaving(true);
    try {
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      const newPath = `${dirPath}/${trimmedName}`;
      const success = await window.electronAPI.renameFile(path, newPath);
      if (success) {
        // Update bookmark if this item was bookmarked
        if (updateBookmarkPath(path, newPath)) {
          onSaveSettings();
        }
        setItemRenaming(path, false);
        setHighlightItem(trimmedName);
        onRename();
      }
    } finally {
      setSaving(false);
    }
  }, [newName, name, path, handleCancel, onRename, onSaveSettings]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  return {
    newName,
    setNewName,
    saving,
    inputRef,
    handleRenameClick,
    handleCancel,
    handleSave,
    handleKeyDown,
  };
}
