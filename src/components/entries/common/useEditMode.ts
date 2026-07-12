import { useState, useRef, useEffect } from 'react';
import { api } from '../../../renderer/api';
import { useAS, setItemContent, setItemEditing, setItemExpanded, setItemEditContent, setItemReviewing } from '../../../store';
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
      // Stamp the cache with the file's real post-write mtime from the main
      // process — a renderer Date.now() is generally at or ahead of the disk
      // mtime, which would blind the pre-edit external-modification check to
      // any later edit landing in the same mtime window.
      setItemContent(path, result.content, result.mtime, result.size);
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
      // An already-populated editContent is live edit state (setItemEditing(false)
      // clears it), e.g. unsaved edits migrated by renameItem to the new path.
      // Adopt it instead of re-seeding from the last-saved content.
      if (item.editContent === undefined) {
        setItemEditContent(path, removeTOC(item.content));
      }
      editInitialized.current = true;
    }
  }, [isEditing, item?.content, item?.editContent, path]);

  const handleEditClick = async (goToLine?: number) => {
    // Check the file's current mtime on disk to detect external modifications.
    // `!==` rather than `>`: an external tool can leave an *older* mtime
    // (restore from backup) or one equal to a stale wall-clock cache stamp.
    const diskMtime = await api.getFileMtime(path);
    if (diskMtime > 0 && item && diskMtime !== item.modifiedTime) {
      // File was modified externally — re-read from disk before editing
      try {
        const fresh = await api.readFileWithMtime(path);
        // Cache the fresh content stamped with the mtime it was read at
        setItemContent(path, fresh.content, fresh.mtime, fresh.size);
        setItemEditContent(path, removeTOC(fresh.content));
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
