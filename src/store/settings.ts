import type { AppSettings, FontSize, SortOrder, ContentWidth, IndexTreeWidth } from '../shared/types';
import type { ImageSize } from '../shared/shared';
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
  setImageSize: (imageSize: ImageSize) => void;
  setEnableThesaurus: (enableThesaurus: boolean) => void;
  toggleBookmark: (filePath: string) => boolean;
  addBookmark: (filePath: string, name: string, isDirectory: boolean) => void;
  updateBookmarkName: (filePath: string, name: string) => void;
  setBookmarkIsDirectory: (filePath: string, isDirectory: boolean) => void;
  removeBookmark: (filePath: string) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createSettingsSlice(set: StoreSet, get: StoreGet): SettingsSlice {
  /** Write one scalar setting, skipping the update when the value is unchanged. */
  function patchSettings<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    const settings = get().settings;
    if (settings[key] === value) return;
    set({ settings: { ...settings, [key]: value } });
  }

  return {
    /** Update application settings. */
    setSettings: (settings) => set({ settings }),

    /** Update the font size setting. */
    setFontSize: (fontSize) => patchSettings('fontSize', fontSize),

    /** Update the sort order setting. */
    setSortOrder: (sortOrder) => patchSettings('sortOrder', sortOrder),

    /** Update the folders on top setting. */
    setFoldersOnTop: (foldersOnTop) => patchSettings('foldersOnTop', foldersOnTop),

    setShowToc: (showToc) => patchSettings('showToc', showToc),

    setShowPropsInEditor: (showPropsInEditor) =>
      patchSettings('showPropsInEditor', showPropsInEditor),

    // `expandedEditor` is deliberately NOT settable on its own: flipping it
    // has to move the editor between the folder listing and BrowseFile in the
    // same update. Use `toggleExpandedEditor(path)` in the view slice.

    /** Update the ignored paths setting. */
    setIgnoredPaths: (ignoredPaths) => patchSettings('ignoredPaths', ignoredPaths),

    /** Update the content width setting. */
    setContentWidth: (contentWidth) => patchSettings('contentWidth', contentWidth),

    /** Update the OCR tools folder setting. */
    setOcrToolsFolder: (ocrToolsFolder) =>
      patchSettings('ocrToolsFolder', ocrToolsFolder),

    /** Update the calendar items folder setting (where new calendar files are created). */
    setCalendarItemsFolder: (calendarItemsFolder) =>
      patchSettings('calendarItemsFolder', calendarItemsFolder),

    /** Update the index tree width setting. */
    setIndexTreeWidth: (indexTreeWidth) =>
      patchSettings('indexTreeWidth', indexTreeWidth),

    /** Update the inline image display size setting. */
    setImageSize: (imageSize) => patchSettings('imageSize', imageSize),

    /**
     * Turn the editor's synonym strip on or off. Switching it off also drops any
     * word the idle plugin had already published, so re-enabling starts from a
     * clean strip rather than showing synonyms for wherever the cursor last sat.
     */
    setEnableThesaurus: (enableThesaurus) => {
      if (get().settings.enableThesaurus === enableThesaurus) return;
      set({
        settings: { ...get().settings, enableThesaurus },
        ...(enableThesaurus ? null : { thesaurusWord: null }),
      });
    },

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

    /** Add a bookmark with a specific display name, recording whether it is a folder. */
    addBookmark: (filePath, name, isDirectory) => {
      const settings = get().settings;
      const currentBookmarks = settings.bookmarks;
      if (currentBookmarks.some(b => b.path === filePath)) return;
      set({ settings: { ...settings, bookmarks: [...currentBookmarks, { path: filePath, name, isDirectory }] } });
    },

    // Bookmark paths are remapped on rename by the cross-slice renameItem
    // action in items.ts, which handles bookmarks to descendants of a renamed
    // folder as well as exact matches.

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

    /** Backfills `isDirectory` on a bookmark saved before that field existed. */
    setBookmarkIsDirectory: (filePath, isDirectory) => {
      const settings = get().settings;
      const currentBookmarks = settings.bookmarks;
      const index = currentBookmarks.findIndex(b => b.path === filePath);
      const existing = currentBookmarks[index];
      if (!existing || existing.isDirectory === isDirectory) return;

      const newBookmarks = [...currentBookmarks];
      newBookmarks[index] = { ...existing, isDirectory };
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

export function setImageSize(imageSize: ImageSize): void {
  getState().setImageSize(imageSize);
}

export function setEnableThesaurus(enableThesaurus: boolean): void {
  getState().setEnableThesaurus(enableThesaurus);
}

export function toggleBookmark(filePath: string): boolean {
  return getState().toggleBookmark(filePath);
}

export function addBookmark(filePath: string, name: string, isDirectory: boolean): void {
  getState().addBookmark(filePath, name, isDirectory);
}

export function updateBookmarkName(filePath: string, name: string): void {
  getState().updateBookmarkName(filePath, name);
}

export function setBookmarkIsDirectory(filePath: string, isDirectory: boolean): void {
  getState().setBookmarkIsDirectory(filePath, isDirectory);
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
