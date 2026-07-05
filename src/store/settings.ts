import type { AppSettings, FontSize, SortOrder, ContentWidth, IndexTreeWidth } from '../shared/types';
import { getState, defaultSettings } from './core';
import type { StoreSet, StoreGet } from './core';

export { defaultSettings };

// ============================================================================
// Settings - application settings and bookmarks
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface SettingsSlice {
  setSettings: (settings: AppSettings) => void;
  setFontSize: (fontSize: FontSize) => void;
  setSortOrder: (sortOrder: SortOrder) => void;
  setFoldersOnTop: (foldersOnTop: boolean) => void;
  setShowToc: (showToc: boolean) => void;
  setShowPropsInEditor: (showPropsInEditor: boolean) => void;
  setIgnoredPaths: (ignoredPaths: string) => void;
  setContentWidth: (contentWidth: ContentWidth) => void;
  setOcrToolsFolder: (ocrToolsFolder: string) => void;
  setCalendarItemsFolder: (calendarItemsFolder: string) => void;
  setIndexTreeWidth: (indexTreeWidth: IndexTreeWidth) => void;
  toggleBookmark: (filePath: string) => boolean;
  addBookmark: (filePath: string, name: string) => void;
  updateBookmarkPath: (oldPath: string, newPath: string) => boolean;
  updateBookmarkName: (filePath: string, name: string) => void;
  removeBookmark: (filePath: string) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createSettingsSlice(set: StoreSet, get: StoreGet): SettingsSlice {
  return {
    /** Update application settings. */
    setSettings: (settings) => set({ settings }),

    /** Update the font size setting. */
    setFontSize: (fontSize) => set({ settings: { ...get().settings, fontSize } }),

    /** Update the sort order setting. */
    setSortOrder: (sortOrder) => set({ settings: { ...get().settings, sortOrder } }),

    /** Update the folders on top setting. */
    setFoldersOnTop: (foldersOnTop) => set({ settings: { ...get().settings, foldersOnTop } }),

    setShowToc: (showToc) => set({ settings: { ...get().settings, showToc } }),

    setShowPropsInEditor: (showPropsInEditor) =>
      set({ settings: { ...get().settings, showPropsInEditor } }),

    /** Update the ignored paths setting. */
    setIgnoredPaths: (ignoredPaths) => set({ settings: { ...get().settings, ignoredPaths } }),

    /** Update the content width setting. */
    setContentWidth: (contentWidth) => set({ settings: { ...get().settings, contentWidth } }),

    /** Update the OCR tools folder setting. */
    setOcrToolsFolder: (ocrToolsFolder) =>
      set({ settings: { ...get().settings, ocrToolsFolder } }),

    /** Update the calendar items folder setting (where new calendar files are created). */
    setCalendarItemsFolder: (calendarItemsFolder) =>
      set({ settings: { ...get().settings, calendarItemsFolder } }),

    /** Update the index tree width setting. */
    setIndexTreeWidth: (indexTreeWidth) =>
      set({ settings: { ...get().settings, indexTreeWidth } }),

    /**
     * Toggle bookmark for a file path.
     * If the path is bookmarked, removes it. If not, adds it.
     * Returns the new bookmarked state.
     */
    toggleBookmark: (filePath) => {
      const settings = get().settings;
      const currentBookmarks = settings.bookmarks;
      const isCurrentlyBookmarked = currentBookmarks.some(b => b.path === filePath);

      const newBookmarks = isCurrentlyBookmarked
        ? currentBookmarks.filter(b => b.path !== filePath)
        : [...currentBookmarks, { path: filePath, name: filePath }];

      set({ settings: { ...settings, bookmarks: newBookmarks } });

      return !isCurrentlyBookmarked;
    },

    /** Add a bookmark with a specific display name. */
    addBookmark: (filePath, name) => {
      const settings = get().settings;
      const currentBookmarks = settings.bookmarks;
      if (currentBookmarks.some(b => b.path === filePath)) return;
      set({ settings: { ...settings, bookmarks: [...currentBookmarks, { path: filePath, name }] } });
    },

    /**
     * Update a bookmark path when a file/folder is renamed.
     * If the oldPath is bookmarked, updates it to the newPath.
     * Returns true if a bookmark was updated.
     */
    updateBookmarkPath: (oldPath, newPath) => {
      const settings = get().settings;
      const currentBookmarks = settings.bookmarks;
      const index = currentBookmarks.findIndex(b => b.path === oldPath);

      if (index === -1) {
        return false;
      }

      const existing = currentBookmarks[index];
      if (!existing) return false;

      const newBookmarks = [...currentBookmarks];
      newBookmarks[index] = { ...existing, path: newPath };

      set({ settings: { ...settings, bookmarks: newBookmarks } });

      return true;
    },

    updateBookmarkName: (filePath, name) => {
      const settings = get().settings;
      const currentBookmarks = settings.bookmarks;
      const index = currentBookmarks.findIndex(b => b.path === filePath);
      if (index === -1) return;

      const existing = currentBookmarks[index];
      if (!existing) return;

      const newBookmarks = [...currentBookmarks];
      newBookmarks[index] = { ...existing, name };

      set({ settings: { ...settings, bookmarks: newBookmarks } });
    },

    removeBookmark: (filePath) => {
      const settings = get().settings;
      const currentBookmarks = settings.bookmarks;
      set({ settings: { ...settings, bookmarks: currentBookmarks.filter(b => b.path !== filePath) } });
    },
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setSettings(settings: AppSettings): void {
  getState().setSettings(settings);
}

export function setFontSize(fontSize: FontSize): void {
  getState().setFontSize(fontSize);
}

export function setSortOrder(sortOrder: SortOrder): void {
  getState().setSortOrder(sortOrder);
}

export function setFoldersOnTop(foldersOnTop: boolean): void {
  getState().setFoldersOnTop(foldersOnTop);
}

export function setShowToc(showToc: boolean): void {
  getState().setShowToc(showToc);
}

export function setShowPropsInEditor(showPropsInEditor: boolean): void {
  getState().setShowPropsInEditor(showPropsInEditor);
}

export function setIgnoredPaths(ignoredPaths: string): void {
  getState().setIgnoredPaths(ignoredPaths);
}

export function setContentWidth(contentWidth: ContentWidth): void {
  getState().setContentWidth(contentWidth);
}

export function setOcrToolsFolder(ocrToolsFolder: string): void {
  getState().setOcrToolsFolder(ocrToolsFolder);
}

export function setCalendarItemsFolder(calendarItemsFolder: string): void {
  getState().setCalendarItemsFolder(calendarItemsFolder);
}

export function setIndexTreeWidth(indexTreeWidth: IndexTreeWidth): void {
  getState().setIndexTreeWidth(indexTreeWidth);
}

export function toggleBookmark(filePath: string): boolean {
  return getState().toggleBookmark(filePath);
}

export function addBookmark(filePath: string, name: string): void {
  getState().addBookmark(filePath, name);
}

export function updateBookmarkPath(oldPath: string, newPath: string): boolean {
  return getState().updateBookmarkPath(oldPath, newPath);
}

export function updateBookmarkName(filePath: string, name: string): void {
  getState().updateBookmarkName(filePath, name);
}

export function removeBookmark(filePath: string): void {
  getState().removeBookmark(filePath);
}

/**
 * Check if a file path is bookmarked
 */
export function isBookmarked(filePath: string): boolean {
  return getState().settings.bookmarks.some(b => b.path === filePath);
}

/**
 * Get current settings (non-reactive, for use outside React)
 */
export function getSettings(): AppSettings {
  return getState().settings;
}
