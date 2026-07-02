export type { AppState, AppView, AppSettings, AiConfigState, Bookmark, FontSize, SortOrder, ContentWidth, IndexTreeWidth, ItemData, SearchResultItem, SearchDefinition, SearchSortBy, SearchSortDirection, FolderAnalysisState, FolderGraphState, FolderGraphNode, FolderGraphLink, HashtagEntry, ThreadEntry, ThreadChildFolder, TreeNode, FileNode, MarkdownFileNode, MarkdownHeadingNode, CalendarEvent } from '../shared/types';
export { createItemData } from '../shared/types';

// Store is split into cohesive slices, each contributing its actions to the
// single Zustand store composed in `./core` (slices pattern). This barrel is
// the single public import surface for the rest of the app.
export { useAppStore } from './core';
export * from './items';
export * from './search';
export * from './settings';
export * from './aiConfig';
export * from './calendar';
export * from './indexTree';
export * from './scroll';
export * from './image';
export * from './view';
