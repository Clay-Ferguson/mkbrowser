import { useState, useRef, useEffect } from 'react';
import { api, ipcErrorMessage } from '../../../renderer/api';
import { setAppError, setHighlightItem, setItemRenaming, renameItem } from '../../../store';
import type { RenameState } from './types';
import { getFileName, getParentPath, joinPath } from '../../../renderer/pathUtil';
import { saveSettings } from '../../../renderer/config';
import { idSuffixLost } from '../../../shared/fileIdSuffix';

interface UseRenameOptions {
  /** Full path of the entry */
  path: string;
  /** Current name of the entry */
  name: string;
  /** Whether rename mode is active */
  isRenaming: boolean;
  /** Callback after successful rename */
  onRename: () => void;
  /** Whether to select full name (folders) or name without extension (files) */
  selectFullName?: boolean;
  /**
   * Whether to ask before a rename drops or changes the `--ID` the name carries (or its
   * extension), which would stop links to the file from repairing themselves (see
   * shared/fileIdSuffix.ts). Set for files; folders carry no id.
   */
  guardIdSuffix?: boolean;
}

/**
 * Renames the file via IPC and, on success, updates the store (bookmarks,
 * item entry, highlight). Module-level (not in the hook) so its
 * try/catch/finally doesn't make the React Compiler bail out on useRename.
 * A failed rename (thrown or `false`) is reported through the app error
 * dialog rather than surfacing as an unhandled rejection or failing silently.
 */
async function performRename(
  path: string,
  trimmedName: string,
  onRename: () => void,
): Promise<void> {
  try {
    const dirPath = getParentPath(path);
    const newPath = joinPath(dirPath, trimmedName);
    const success = await api.renameFile(path, newPath);
    if (success) {
      // Move the item entry from old path to new path in the store, preserving
      // selection and other state (prevents phantom selections). This also
      // remaps every other slice holding paths (bookmarks, calendar events,
      // copied links) and returns true when a bookmark changed, in which case
      // the settings must be persisted.
      if (renameItem(path, newPath, trimmedName)) {
        saveSettings();
      }
      setHighlightItem(newPath, { history: false });
      onRename();
    } else {
      setAppError(`Could not rename "${getFileName(path)}" to "${trimmedName}". An item with that name may already exist.`);
    }
  } catch (err) {
    setAppError(`Could not rename "${getFileName(path)}": ${ipcErrorMessage(err)}`);
  }
}

/**
 * Hook that handles rename logic for Entry components.
 * Provides state, refs, and handlers for the rename input.
 *
 * See: (USER_GUIDE.md#renaming)
 */
export function useRename({
  path,
  name,
  isRenaming,
  onRename,
  selectFullName = false,
  guardIdSuffix = false,
}: UseRenameOptions): RenameState {
  const [newName, setNewName] = useState(name);
  const [saving, setSaving] = useState(false);
  // A new name that would lose the file's `--ID`, waiting on the user's confirmation.
  // See: (USER_GUIDE.md#inserting-links-to-other-files)
  const [pendingIdRename, setPendingIdRename] = useState<string | null>(null);
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

  const handleRenameClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNewName(name);
    setItemRenaming(path, true);
  };

  const handleCancel = () => {
    setNewName(name);
    setItemRenaming(path, false);
  };

  const commitRename = (trimmedName: string) => {
    setSaving(true);
    void performRename(path, trimmedName, onRename).finally(() => setSaving(false));
  };

  // Fire-and-forget (`() => void`): bound to the rename input's onBlur and the
  // Enter key, never awaited, so the async rename + its error handling live
  // in performRename and callers can invoke it directly.
  const handleSave = () => {
    // The confirmation dialog taking focus blurs the input, which lands here again.
    if (pendingIdRename !== null) return;
    // Trim leading/trailing whitespace from the whole name, then also trim
    // the stem separately so spaces before the extension are removed too.
    const full = newName.trim();
    const dotIndex = full.lastIndexOf('.');
    const trimmedName = dotIndex > 0
      ? full.substring(0, dotIndex).trim() + full.substring(dotIndex)
      : full;
    if (!trimmedName || trimmedName === name) {
      handleCancel();
      return;
    }

    if (guardIdSuffix && idSuffixLost(name, trimmedName)) {
      setPendingIdRename(trimmedName);
      return;
    }
    commitRename(trimmedName);
  };

  // The id-loss confirmation's "Rename": goes ahead with the held name.
  const handleIdRenameConfirm = () => {
    const pending = pendingIdRename;
    setPendingIdRename(null);
    if (pending !== null) commitRename(pending);
  };

  // The id-loss confirmation's "Cancel": stays in rename mode so the name can be fixed
  // (closing the dialog hands focus back to whatever had it, the input after an Enter).
  const handleIdRenameCancel = () => {
    setPendingIdRename(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter/Escape during IME composition confirm/cancel the composition itself.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return {
    newName,
    setNewName,
    saving,
    inputRef,
    handleRenameClick,
    handleCancel,
    handleSave,
    handleKeyDown,
    pendingIdRename,
    handleIdRenameConfirm,
    handleIdRenameCancel,
  };
}
