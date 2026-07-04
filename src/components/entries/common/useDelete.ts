import { useState } from 'react';
import { api } from '../../../renderer/api';
import type { DeleteState } from './types';
import { deleteItems } from '../../../store';
import { logger } from '../../../shared/logUtil';

interface UseDeleteOptions {
  /** Full path of the entry to delete */
  path: string;
  /** Callback after successful delete */
  onDelete: () => void;
}

/**
 * Deletes the file via IPC and updates the store. Module-level (not in the
 * hook) so its try/catch/finally doesn't make the React Compiler bail out on
 * useDelete. A failed IPC delete is reported rather than surfacing as an
 * unhandled promise rejection.
 */
async function performDelete(path: string, onDelete: () => void): Promise<void> {
  try {
    const success = await api.deleteFile(path);
    if (success) {
      // Remove the deleted item from the store so it no longer appears
      // as selected or referenced in memory
      deleteItems([path]);
      onDelete();
    }
  } catch (err) {
    logger.error('Failed to delete file:', err);
  }
}

/**
 * Hook that handles delete logic for Entry components.
 * Provides state and handlers for delete confirmation dialog.
 */
export function useDelete({ path, onDelete }: UseDeleteOptions): DeleteState {
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setShowDeleteConfirm(true);
  };

  // Fire-and-forget: bound directly to a ConfirmDialog's `onConfirm` (a
  // `() => void` prop) and never awaited, so this uses the sync-signature
  // convention with the async work (and its error handling) in performDelete.
  const handleDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setDeleting(true);
    void performDelete(path, onDelete).finally(() => setDeleting(false));
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  return {
    deleting,
    showDeleteConfirm,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  };
}
