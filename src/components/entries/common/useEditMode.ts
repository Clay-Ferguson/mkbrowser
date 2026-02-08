import { useState, useRef, useEffect, useCallback } from 'react';
import { useItem, setItemContent, setItemEditing, setItemExpanded, setItemEditContent } from '../../../store';
import type { EditModeState } from './types';

interface UseEditModeOptions {
  /** Full path of the file */
  path: string;
  /** Current file content (from useContentLoader) */
  content: string;
}

/**
 * Hook that handles edit mode logic for file Entry components.
 * Provides state and handlers for the code editor.
 *
 * Edit content is stored in the global store (ItemData.editContent) so that
 * sibling components like TagsPicker can read and modify it.
 */
export function useEditMode({ path, content }: UseEditModeOptions): EditModeState {
  const item = useItem(path);
  const [saving, setSaving] = useState(false);
  const editInitialized = useRef(false);

  const isEditing = item?.editing ?? false;
  const editContent = item?.editContent ?? '';

  // Stable callback for updating edit content in the store
  const setEditContent = useCallback(
    (newContent: string) => setItemEditContent(path, newContent),
    [path]
  );

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
      setItemEditContent(path, item.content);
      editInitialized.current = true;
    }
  }, [isEditing, item?.content, path]);

  const handleEditClick = () => {
    setItemEditContent(path, content);
    editInitialized.current = true;
    setItemExpanded(path, true);
    setItemEditing(path, true);
  };

  const handleCancel = () => {
    setItemEditing(path, false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await window.electronAPI.writeFile(path, editContent);
      if (success) {
        setItemContent(path, editContent);
        setItemEditing(path, false);
      }
    } finally {
      setSaving(false);
    }
  };

  return {
    isEditing,
    editContent,
    setEditContent,
    saving,
    handleEditClick,
    handleCancel,
    handleSave,
  };
}
