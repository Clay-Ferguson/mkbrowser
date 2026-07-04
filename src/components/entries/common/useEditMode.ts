import { useState, useRef, useEffect } from 'react';
import { api } from '../../../renderer/api';
import { useAS, setItemContent, setItemEditing, setItemExpanded, setItemEditContent, setItemReviewing, upsertItem } from '../../../store';
import { applyGlobalHighlight, globalHighlightText } from '../../../renderer/globalHighlight';
import { removeTOC } from '../../../shared/tocUtil';
import { logger } from '../../../shared/logUtil';
import type { EditModeState } from './types';

interface UseEditModeOptions {
  /** Full path of the file */
  path: string;
  /** Current file content (from useContentLoader) */
  content: string;
}

/**
 * Writes the file via IPC and, on success, commits the saved content to the
 * store and exits edit mode. Module-level (not in the hook) so its
 * try/catch/finally doesn't make the React Compiler bail out on useEditMode.
 * The catch keeps a failed IPC write from becoming an unhandled rejection at
 * the fire-and-forget bindings (Ctrl+S, Save button, onBlur); callers that
 * await it observe a resolved (no-op) result on failure, matching the
 * pre-existing behavior when `result.ok` is false.
 */
async function writeFileAndExitEditMode(path: string, editContent: string): Promise<void> {
  try {
    const result = await api.writeFile(path, editContent);
    if (result.ok) {
      setItemContent(path, result.content, Date.now());
      setItemEditing(path, false);
      if (globalHighlightText) {
        requestAnimationFrame(() => applyGlobalHighlight(globalHighlightText));
      }
    }
  } catch (err) {
    logger.error('Failed to save file:', err);
  }
}

/**
 * Hook that handles edit mode logic for file Entry components.
 * Provides state and handlers for the code editor.
 *
 * Edit content is stored in the global store (ItemData.editContent) so that
 * child components like TagsPicker can read and modify it.
 */
export function useEditMode({ path, content }: UseEditModeOptions): EditModeState {
  const item = useAS(s => s.items.get(path));
  const [saving, setSaving] = useState(false);
  const editInitialized = useRef(false);

  const isEditing = item?.editing ?? false;
  const editContent = item?.editContent ?? '';

  const setEditContent = (newContent: string) => setItemEditContent(path, newContent);

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
      setItemEditContent(path, removeTOC(item.content));
      editInitialized.current = true;
    }
  }, [isEditing, item?.content, path]);

  const handleEditClick = async (goToLine?: number) => {
    // Check the file's current mtime on disk to detect external modifications
    const diskMtime = await api.getFileMtime(path);
    if (diskMtime > 0 && item && diskMtime > item.modifiedTime) {
      // File was modified externally — re-read from disk before editing
      try {
        const freshContent = await api.readFile(path);
        // Update the store with the new modifiedTime and content
        upsertItem(path, item.name, item.isDirectory, diskMtime, item.createdTime);
        setItemContent(path, freshContent);
        setItemEditContent(path, removeTOC(freshContent));
      } catch {
        // If re-read fails, fall back to cached content
        setItemEditContent(path, removeTOC(content));
      }
    } else {
      setItemEditContent(path, removeTOC(content));
    }
    editInitialized.current = true;
    setItemExpanded(path, true);
    setItemEditing(path, true, goToLine);
  };

  const handleCancel = () => {
    setItemReviewing(path, false);
    setItemEditing(path, false);
    if (globalHighlightText) {
      requestAnimationFrame(() => applyGlobalHighlight(globalHighlightText));
    }
  };

  // Stays async because the "Ask AI" button awaits it before continuing
  // (MarkdownEntry.tsx). Error handling lives in writeFileAndExitEditMode.
  const handleSave = async () => {
    setSaving(true);
    await writeFileAndExitEditMode(path, editContent).finally(() => setSaving(false));
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
