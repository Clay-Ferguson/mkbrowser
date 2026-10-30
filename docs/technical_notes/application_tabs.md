# Pattern for Application Pages (i.e. Views, Tabs, Panels)

## Overview 

This application uses a tab layout where each tab is one of the top-level views (aka panels or pages) that we display. The set of views is the `AppView` union type in `src/shared/types.ts`:

```ts
export type AppView = 'browser' | 'search-results' | 'settings' | 'folder-analysis' | 'ai-settings' | 'thread' | 'folder-graph' | 'calendar' | 'types-editor' | 'tags-editor' | 'help';
```

Each view is a component in `src/components/views/`:

| `AppView` | Tab label | Component |
|-----------|-----------|-----------|
| `browser` | Browse | `IndexTreeView` + `BrowseView` (or `BrowseFile` in single-file mode) |
| `thread` | AI Chat | `ThreadView` |
| `search-results` | Search | `SearchResultsView` |
| `folder-analysis` | Analysis | `FolderAnalysisView` |
| `folder-graph` | Graph | `FolderGraphView` |
| `settings` | Settings | `SettingsView` |
| `ai-settings` | AI Settings | `AISettingsView` |
| `types-editor` | Types | `TypesEditorView` |
| `tags-editor` | Tags | `TagsEditorView` |
| `calendar` | Calendar | `CalendarView` |
| `help` | Help | `HelpView` |

The `browser` view is the main, default tab (see `src/App.tsx`). Any new page should follow the pattern of the existing components in `src/components/views/`.

## Tab Navigation

The tab bar is the `AppTabButtons` component (`src/components/AppTabButtons.tsx`). It holds the app logo (which opens the File menu), the tab buttons, the System menu button, the Back/Forward buttons, and an "Up Level" button that appears on the Browse and AI Chat tabs when browsing below the root folder.

The active tab is `currentView` in the single Zustand store (the view slice, `src/store/view.ts`). Clicking a tab button calls `setCurrentView(tab.id)`, and the views re-render to show the new one. Only one tab is active at a time.

### Which tabs are shown

Not every tab is always in the tab bar. The `allTabs` array in `AppTabButtons` defines the canonical order (Browse, AI Chat, Search, Analysis, Graph, Settings, AI Settings, Types, Tags, Calendar, Help), and it is filtered down to the tabs that should currently be visible. A tab is visible for one of two reasons:

- **Explicitly shown.** The store's `visibleTabs` set (initially just `browser`) is changed with `showTab(tab)` / `hideTab(tab)`. The System menu opens Settings, AI Settings, Types, Tags, and Help this way (`showTab` then `setCurrentView`). The Calendar tab is shown the same way, by `showCalendarForFolder` in the calendar slice, by `src/renderer/calendarNav.ts`, and by `SearchResultsView`. `visibleTabs` is not persisted, so it resets on restart.
- **Derived from data.** These tabs appear whenever their data exists:
  - Search: `lastSearchDefinition !== null`. It is set as soon as any search runs, so a search with no results still shows the tab.
  - Analysis: `folderAnalysis !== null`.
  - Graph: `folderGraph !== null`.
  - AI Chat: the current folder's entries contain a `HUMAN.md` or `AI.md` file (`isAiThreadByEntries`), or AI Chat is already the active view.

### Closing tabs

Every tab except Browse and AI Chat has a close (×) button. Closing a tab clears whatever keeps it visible: `hideTab` for the explicitly shown tabs, `clearSearchResults()` for Search, `setFolderAnalysis(null)` for Analysis, and `setFolderGraph(null)` for Graph. If the closed tab was the active one, the view falls back to Browse. The AI Chat tab has no close button, because its visibility follows the folder being browsed.

## Mounting and Scroll Position (important)

A view is **mounted the first time the user activates its tab, and then stays mounted**. We do not unmount inactive views. Instead we toggle their visibility with CSS (`display: 'flex' | 'none'`). In `src/App.tsx`:

- One `AppTabButtons` header and the app-level dialogs (the error `AlertDialog`, the `appMessage` `AlertDialog`, and `LinkIdMismatchDialog`) are rendered once, outside the per-view wrappers.
- A `visitedViews` set (local state in `App`, starting with `browser`) tracks which views have been activated. The active view is added to it during render, so a newly visited view mounts in the same render pass. Each view's wrapper is only rendered once its view has been visited (`visitedViews.has(view) && ...`). Within that wrapper, `display` is set from `currentView === view`.
- `visitedViews` is never pruned. Closing a tab hides it from the tab bar but leaves its view mounted (and hidden) for the rest of the session.
- **`FolderGraphView` is the exception.** It is gated on `folderGraph !== null` instead of `visitedViews`, so it mounts as soon as a graph exists and unmounts when the Graph tab is closed.
- Each view wrapper is built by `viewProps(view)`. It carries a `data-testid="view-<id>"` and, on the active view only, `data-active-view="true"`. Because hidden views are still in the DOM, a bare `getByTestId()` in an e2e test can match the same element in several tabs. Tests should scope their lookups to a view (see the `activeView` test helper).
- Each view is wrapped in its own `ErrorBoundary`.

Each view owns its own scroll container (usually a `<main className="... overflow-y-auto">`), and that container is never removed from the DOM. So **the browser preserves each view's scroll position natively** across tab switches. Switching away and back re-shows the same DOM with its `scrollTop` intact, with no flicker and no save/restore code. The same holds for other DOM and component state, such as open CodeMirror editors (undo history and cursor) and `FolderGraphView`'s d3 simulation and zoom.

### Hidden views are live

Because hidden views stay mounted, they keep re-rendering on store changes, and their effects keep running. Effects that should only run for the visible tab (fetches, DOM measuring or scrolling, consuming pending intents) must gate on `useIsActiveView(view)` from the store barrel and list it in their deps. Don't hand-write `currentView !== 'x'` checks. Background work that must run regardless of the active tab (IPC listeners, the calendar file watcher) belongs in `App`, not in a view. Don't replace the `display` toggle with React's `<Activity>`. For the reasons, see DEVELOPER_GUIDE.md § "Views Never Unmount".

### The Browse tab

The `browser` wrapper holds `IndexTreeView` (unless `settings.indexTreeWidth` is `'hidden'`) beside either `BrowseView` (the folder listing) or `BrowseFile` (single-file browsing). The choice depends on `browseFileName`. Here the two are **swapped, not hidden**: mounting both would give the browsed file two live entry instances. So `BrowseView` does unmount and remount when entering and leaving single-file mode. See `single_file_browsing.md`.

### The one exception to native scroll: BrowseView per-folder scroll

`BrowseView` is a single mounted instance that is **reused across folder navigation**: `currentPath` changes while the same DOM container stays mounted. So it still saves and restores its scroll position **per folder path**. It does this with `setBrowserScrollPosition` / `getBrowserScrollPosition` from `src/store/scroll.ts`, a plain module-level Map kept outside the reactive store. The `usePendingBrowseIntents` hook drives this. It also restores the position when `BrowseView` remounts after leaving single-file mode. `scroll.ts` only holds these browser per-folder positions. Other views need no scroll bookkeeping. For the full picture (per-folder restore, pending scroll requests, the settle phase, and hidden-view pitfalls), see `scroll_management.md`.

## Switching Views from Code

`currentView` lives in the store, so any code can switch tabs through the action wrappers exported from `src/store` (the `index.ts` barrel):

```ts
setCurrentView('search-results');
```

Related helpers:

- `navigateToBrowserPath(path, scrollToFile?, view = 'browser')` sets the folder, switches the view, and exits single-file browsing, all in one atomic state update.
- `showTab(tab)` / `hideTab(tab)` / `isTabVisible(tab)` manage the `visibleTabs` set. Call `showTab` before `setCurrentView` for any tab that is not data-derived, or the view will be active with no tab button.
- `showCalendarForFolder(folder)` shows and selects the Calendar tab and starts loading, in one update.
- `useIsActiveView(view)` is the hook that tells a component whether its view is the one on screen.

Components read the active view reactively with `useAS(s => s.currentView)`.

## Adding a New Tab

1. Add the id to the `AppView` union in `src/shared/types.ts`.
2. Create the view component in `src/components/views/`. Give it its own scroll container, and gate any visible-only effects on `useIsActiveView`.
3. In `src/App.tsx`, add a `visitedViews.has('<id>') && <div {...viewProps('<id>')}><ErrorBoundary>…</ErrorBoundary></div>` block.
4. In `AppTabButtons`, add an entry to `allTabs` in the right position, and add a close handler to `closeHandlers` unless the tab is permanent.
5. Decide how the tab becomes visible. Either open it with `showTab` and then `setCurrentView` (for example from the System menu), or derive its visibility from store data in the `visibleIds` set.
