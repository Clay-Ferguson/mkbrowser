import { useState, useRef, useEffect } from 'react';
import { api } from '../../../renderer/api';
import { useAS, setItemContent, setItemEditing, setItemExpanded, setItemEditContent, setItemReviewing } from '../../../store';
import { applyGlobalHighlight, getGlobalHighlightText } from '../../../renderer/globalHighlight';
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
      // any later edit landing in the same mtime window. The post-write
      // createdTime (birthtime) must be adopted too: the atomic save renames a
      // new inode into place, and a stale birthtime makes the next directory
      // refresh wipe the item as "replaced" (isReplacedFile).
      setItemContent(path, result.content, result.mtime, result.size, result.createdTime);
      setItemEditing(path, false);
      if (getGlobalHighlightText()) {
        requestAnimationFrame(() => applyGlobalHighlight(getGlobalHighlightText()));
      }
    }
  } catch (err) {
    logger.error('Failed to save file:', err);
  }
}

/**
 * Writes the file and stays in edit mode — backs the editor context menu's "Save" item,
 * which lets the user checkpoint their work and keep typing. Commits the saved content to
 * the store exactly like writeFileAndExitEditMode (the mtime/size/createdTime stamping
 * matters just as much here) but leaves `editing` — and the edit buffer — alone.
 *
 * The edit buffer is re-seeded from what actually landed on disk because the main process
 * can rewrite the content it saves (TOC regeneration, injecting a Document Mode `id` into
 * the front matter); without this the buffer would drift from the file, and the next
 * Escape-if-unmodified check would compare against — and a later save would re-write —
 * stale text. In the common case the saved content matches the buffer, so nothing is
 * dispatched into the editor at all.
 *
 * Resolves true only when the write succeeded, so callers can show saved-confirmation
 * feedback. Module-level (not in the hook) so its try/catch doesn't make the React
 * Compiler bail out on useEditMode.
 */
async function writeFileKeepEditing(path: string, editContent: string): Promise<boolean> {
  try {
    const result = await api.writeFile(path, editContent);
    if (!result.ok) return false;
    setItemContent(path, result.content, result.mtime, result.size, result.createdTime);
    const savedBuffer = removeTOC(result.content);
    if (savedBuffer !== editContent) {
      setItemEditContent(path, savedBuffer);
    }
    return true;
  } catch (err) {
    logger.error('Failed to save file:', err);
    return false;
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
    if (getGlobalHighlightText()) {
      requestAnimationFrame(() => applyGlobalHighlight(getGlobalHighlightText()));
    }
  };

  // Stays async because the "Ask AI" button awaits it before continuing
  // (MarkdownEntry.tsx). Error handling lives in writeFileAndExitEditMode.
  const handleSave = async () => {
    setSaving(true);
    // Read the edit buffer from the store at call time, not from this render's closure: the
    // editor flushes its debounced onChange synchronously right before invoking onSave (Ctrl+S)
    // and on blur (Save button click), so the store is current but this component has not
    // re-rendered yet — the closure's editContent may be missing the final keystrokes.
    const latest = useAS.getState().items.get(path)?.editContent ?? editContent;
    await writeFileAndExitEditMode(path, latest).finally(() => setSaving(false));
  };

  // Save without leaving the editor (context menu "Save"). Reads the edit buffer from the
  // store at call time for the same reason handleSave does — the editor flushes its
  // debounced onChange right before invoking this, so the store is current but this
  // component has not re-rendered yet.
  const handleSaveKeepEditing = async (): Promise<boolean> => {
    setSaving(true);
    const latest = useAS.getState().items.get(path)?.editContent ?? editContent;
    return await writeFileKeepEditing(path, latest).finally(() => setSaving(false));
  };

  return {
    isEditing,
    editContent,
    setEditContent,
    saving,
    handleEditClick,
    handleCancel,
    handleSave,
    handleSaveKeepEditing,
  };
}
