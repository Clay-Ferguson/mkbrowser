import { useState, useRef, useEffect } from 'react';
import { useItem, setItemContent, setItemEditing, setItemExpanded } from '../../../store';
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
 */
export function useEditMode({ path, content }: UseEditModeOptions): EditModeState {
  const item = useItem(path);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const editInitialized = useRef(false);

  const isEditing = item?.editing ?? false;

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

  const handleEditClick = () => {
    setEditContent(content);
    editInitialized.current = true;
    setItemExpanded(path, true);
    setItemEditing(path, true);
  };

  const handleCancel = () => {
    setEditContent('');
    setItemEditing(path, false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await window.electronAPI.writeFile(path, editContent);
      if (success) {
        setItemContent(path, editContent);
        setItemEditing(path, false);
        setEditContent('');
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
