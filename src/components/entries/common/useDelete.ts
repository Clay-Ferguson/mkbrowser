import { useState, useCallback } from 'react';
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

  // Fire-and-forget: bound directly to a ConfirmDialog's `onConfirm` (a
  // `() => void` prop) and never awaited, so this uses the sync-signature +
  // internal try/catch convention. A failed IPC delete is reported rather than
  // surfacing as an unhandled promise rejection.
  const handleDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    setDeleting(true);
    void (async () => {
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
      } finally {
        setDeleting(false);
      }
    })();
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
