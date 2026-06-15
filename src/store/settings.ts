import type { AppSettings, FontSize, SortOrder, ContentWidth, IndexTreeWidth } from '../types/types';
import { getState, setState, useStoreValue } from './core';

// ============================================================================
// Settings - application settings and bookmarks
// ============================================================================

/**
 * Update application settings
 */
export function setSettings(settings: AppSettings): void {
  setState({ settings });
}

/**
 * Update the font size setting
 */
export function setFontSize(fontSize: FontSize): void {
  setState({ settings: { ...getState().settings, fontSize } });
}

/**
 * Update the sort order setting
 */
export function setSortOrder(sortOrder: SortOrder): void {
  setState({ settings: { ...getState().settings, sortOrder } });
}

/**
 * Update the folders on top setting
 */
export function setFoldersOnTop(foldersOnTop: boolean): void {
  setState({ settings: { ...getState().settings, foldersOnTop } });
}

export function setShowToc(showToc: boolean): void {
  setState({ settings: { ...getState().settings, showToc } });
}

export function setShowPropsInEditor(showPropsInEditor: boolean): void {
  setState({ settings: { ...getState().settings, showPropsInEditor } });
}

/**
 * Update the ignored paths setting
 */
export function setIgnoredPaths(ignoredPaths: string): void {
  setState({ settings: { ...getState().settings, ignoredPaths } });
}

/**
 * Update the content width setting
 */
export function setContentWidth(contentWidth: ContentWidth): void {
  setState({ settings: { ...getState().settings, contentWidth } });
}

/**
 * Update the OCR tools folder setting
 */
export function setOcrToolsFolder(ocrToolsFolder: string): void {
  setState({ settings: { ...getState().settings, ocrToolsFolder } });
}

/**
 * Update the calendar items folder setting (where new calendar files are created)
 */
export function setCalendarItemsFolder(calendarItemsFolder: string): void {
  setState({ settings: { ...getState().settings, calendarItemsFolder } });
}

/**
 * Update the index tree width setting
 */
export function setIndexTreeWidth(indexTreeWidth: IndexTreeWidth): void {
  setState({ settings: { ...getState().settings, indexTreeWidth } });
}

/**
 * Toggle bookmark for a file path.
 * If the path is bookmarked, removes it. If not, adds it.
 * Returns the new bookmarked state.
 */
export function toggleBookmark(filePath: string): boolean {
  const settings = getState().settings;
  const currentBookmarks = settings.bookmarks || [];
  const isCurrentlyBookmarked = currentBookmarks.some(b => b.path === filePath);

  const newBookmarks = isCurrentlyBookmarked
    ? currentBookmarks.filter(b => b.path !== filePath)
    : [...currentBookmarks, { path: filePath, name: filePath }];

  setState({ settings: { ...settings, bookmarks: newBookmarks } });

  return !isCurrentlyBookmarked;
}

/**
 * Add a bookmark with a specific display name.
 */
export function addBookmark(filePath: string, name: string): void {
  const settings = getState().settings;
  const currentBookmarks = settings.bookmarks || [];
  if (currentBookmarks.some(b => b.path === filePath)) return;
  setState({ settings: { ...settings, bookmarks: [...currentBookmarks, { path: filePath, name }] } });
}

/**
 * Check if a file path is bookmarked
 */
export function isBookmarked(filePath: string): boolean {
  return (getState().settings.bookmarks || []).some(b => b.path === filePath);
}

/**
 * Update a bookmark path when a file/folder is renamed.
 * If the oldPath is bookmarked, updates it to the newPath.
 * Returns true if a bookmark was updated.
 */
export function updateBookmarkPath(oldPath: string, newPath: string): boolean {
  const settings = getState().settings;
  const currentBookmarks = settings.bookmarks || [];
  const index = currentBookmarks.findIndex(b => b.path === oldPath);

  if (index === -1) {
    return false;
  }

  const newBookmarks = [...currentBookmarks];
  newBookmarks[index] = { ...newBookmarks[index], path: newPath };

  setState({ settings: { ...settings, bookmarks: newBookmarks } });

  return true;
}

export function updateBookmarkName(filePath: string, name: string): void {
  const settings = getState().settings;
  const currentBookmarks = settings.bookmarks || [];
  const index = currentBookmarks.findIndex(b => b.path === filePath);
  if (index === -1) return;

  const newBookmarks = [...currentBookmarks];
  newBookmarks[index] = { ...newBookmarks[index], name };

  setState({ settings: { ...settings, bookmarks: newBookmarks } });
}

export function removeBookmark(filePath: string): void {
  const settings = getState().settings;
  const currentBookmarks = settings.bookmarks || [];
  setState({ settings: { ...settings, bookmarks: currentBookmarks.filter(b => b.path !== filePath) } });
}

/**
 * Get current settings (non-reactive, for use outside React)
 */
export function getSettings(): AppSettings {
  return getState().settings;
}

/**
 * Hook to subscribe to settings
 */
export function useSettings(): AppSettings {
  return useStoreValue(s => s.settings);
}
