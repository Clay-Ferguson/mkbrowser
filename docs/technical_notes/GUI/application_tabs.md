# Pattern for Application Pages (i.e. Views, Tabs, Panels)

## Overview 

This application uses a Tab-layout where tabs/views are the different top level views (aka panels) that we display in the application. Their names are defined in file `src/store/types.ts` in the following line of code. 

```
export type AppView = 'browser' | 'search-results' | 'settings' ...;
```

The 'browser' one (`BrowseView.tsx`) is the main default application tab  (see: `src/App.tsx` also), but any pages other than the main (browser) page should follow a pattern similar to what you find in `src/components/views/*.tsx` components, for exmaple.

## Tab Navigation

Each page has a corresponding tab button in the tab panel at the top of the screen (Browse, Search, Settings). When the user clicks a tab button, we update the `currentView` in the global `AppState`, and that causes the page to display at next render. We have clickable application tabs in the `AppTabButtons.tsx` component which lets users choose which tab to make active. Similar to most other tab panel designs, we can only have one tab active at a time. And of course, the purpose of the tab buttons is to select which tab to view.

## Mounting and Scroll Position (important)

A view is **mounted the first time the user activates its tab, then kept mounted forever after**. We do not unmount inactive views — instead we toggle their visibility with CSS (`display: 'flex' | 'none'`). In `src/App.tsx`:

- A single `AppTabButtons` header and a single error `AlertDialog` are rendered once, outside the per-view wrappers.
- A `visitedViews` set (state) tracks which views have been activated. Each view's wrapper is only rendered once its view has been visited (`visitedViews.has(view) && ...`), and within that wrapper `display` is set from `currentView === view`.
- `FolderGraphView` keeps its extra `folderGraph && ...` gate (it only exists once a graph has been generated).

Because each view owns its own scroll container (`<main className="...overflow-y-auto">`) and that container is never removed from the DOM, **the browser preserves each view's scroll position natively** across tab switches. There is no scroll-position save/restore layer — switching away and back simply re-shows the same DOM with its scrollTop intact, with no flicker.

### The one exception: BrowseView per-folder scroll

`BrowseView` is a single mounted instance that is **reused across folder navigation** (the `currentPath` changes while the same DOM container stays mounted). So it still saves/restores scroll position **per folder path** via `getBrowserScrollPosition` / `setBrowserScrollPosition` in `src/store/scroll.ts`. That store now only holds browser per-folder positions; the old per-view scroll positions and the `useScrollPersistence` hook were removed once views stopped unmounting.

## React Global State Management

Example: `setCurrentView('search-results');`
