import { useState, useCallback } from 'react';
import type { DeleteState } from './types';
import { deleteItems } from '../../../store';

interface UseDeleteOptions {
  /** Full path of the entry to delete */
  path: string;
  /** Callback after successful delete */
  onDelete: () => void;
}

/**
 * Hook that handles delete logic for Entry components.
 * Provides state and handlers for delete confirmation dialog.
 */
export function useDelete({ path, onDelete }: UseDeleteOptions): DeleteState {
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteClick = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setShowDeleteConfirm(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    setShowDeleteConfirm(false);
    setDeleting(true);
    try {
      const success = await window.electronAPI.deleteFile(path);
      if (success) {
        // Remove the deleted item from the store so it no longer appears
        // as selected or referenced in memory
        deleteItems([path]);
        onDelete();
      }
    } finally {
      setDeleting(false);
    }
  }, [path, onDelete]);

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  return {
    deleting,
    showDeleteConfirm,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  };
}
