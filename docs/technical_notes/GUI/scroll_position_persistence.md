# Scroll Position Persistence

## Overview

Each main view in the app is conditionally rendered based on `currentView` in the global store. When a user switches tabs, React unmounts the old view component and mounts the new one. To avoid losing the user's scroll position across these unmount/remount cycles, every scrollable view saves its scroll position to a shared in-memory store and restores it on mount.

Scroll positions are **session-only** — they are never persisted to disk.

---

## State Shape

`src/store/types.ts` defines the `ScrollPositions` interface:

```typescript
export interface ScrollPositions {
  browser: Map<string, number>;   // per-folder positions, keyed by path
  'search-results': number;
  settings: number;
  'folder-analysis': number;
  'ai-settings': number;
  thread: number;
}
```

The browser view uses `Map<string, number>` because the user may navigate to many different folders and each needs an independent scroll position. All other views store a single `number`.

Initial state is set in `src/store/store.ts` (`initialState.scrollPositions`), with all values at `0` and `browser` as an empty `Map`.

---

## Store Getters / Setters

`src/store/store.ts` exports paired getter/setter functions for each view:

| View | Getter | Setter |
|------|--------|--------|
| browser | `getBrowserScrollPosition(path: string): number` | `setBrowserScrollPosition(path: string, position: number): void` |
| search-results | `getSearchResultsScrollPosition(): number` | `setSearchResultsScrollPosition(position: number): void` |
| settings | `getSettingsScrollPosition(): number` | `setSettingsScrollPosition(position: number): void` |
| folder-analysis | `getFolderAnalysisScrollPosition(): number` | `setFolderAnalysisScrollPosition(position: number): void` |
| ai-settings | `getAISettingsScrollPosition(): number` | `setAISettingsScrollPosition(position: number): void` |
| thread | `getThreadScrollPosition(): number` | `setThreadScrollPosition(position: number): void` |

**Critical detail**: all setters mutate `state` directly but do **not** call `emitChange()`. This prevents the scroll save from triggering a full re-render of the component tree.

---

## The `useScrollPersistence` Hook

`src/utils/useScrollPersistence.ts` is a reusable hook used by all views except `BrowseView` (which has additional complexity):

```typescript
export function useScrollPersistence(
  getPosition: () => number,
  setPosition: (position: number) => void
) {
  const containerRef = useRef<HTMLElement | null>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RESTORE: runs once on mount, 50ms delay for DOM readiness
  useEffect(() => {
    const savedPosition = getPosition();
    if (savedPosition > 0 && containerRef.current) {
      setTimeout(() => {
        containerRef.current?.scrollTo({ top: savedPosition, behavior: 'instant' });
      }, 50);
    }
  }, [getPosition]);

  // SAVE: debounced 150ms after each scroll event
  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    const scrollTop = e.currentTarget.scrollTop;
    scrollSaveTimerRef.current = setTimeout(() => {
      setPosition(scrollTop);
    }, 150);
  }, [setPosition]);

  // CLEANUP: prevent stale timer after unmount
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    };
  }, []);

  return { containerRef, handleScroll };
}
```

### Usage pattern (all simple views)

```typescript
const { containerRef: mainContainerRef, handleScroll: handleMainScroll } = useScrollPersistence(
  getSearchResultsScrollPosition,
  setSearchResultsScrollPosition
);

// In JSX:
<main ref={mainContainerRef} onScroll={handleMainScroll} className="flex-1 min-h-0 overflow-y-auto">
  ...
</main>
```

Views using this hook: `SearchResultsView`, `SettingsView`, `FolderAnalysisView`, `AISettingsView`, `ThreadView`.

---

## BrowseView: Manual Scroll Management

`src/components/views/BrowseView.tsx` does **not** use `useScrollPersistence`. It handles scroll manually because it must also support two special scroll modes:

- **`pendingScrollToFile`** — scroll a specific file item into view (triggered by clicking a search result or index tree entry)
- **`pendingScrollToHeadingSlug`** — after the markdown content renders, scroll a heading into view (750ms additional delay for render)

### Key refs

```typescript
const mainContainerRef = useRef<HTMLElement | null>(null);
const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const previousPathRef = useRef<string | null>(null);
```

`previousPathRef` tracks the last rendered `currentPath` so that the effect can detect a folder navigation event.

### Save logic

A `useEffect` keyed on `[loading, pendingScrollToFile, ...]` saves the previous folder's position before restoring the new one:

```typescript
if (isNewFolder && previousPathRef.current && mainContainerRef.current) {
  setBrowserScrollPosition(previousPathRef.current, mainContainerRef.current.scrollTop);
}
```

An `onScroll` handler on `<main>` debounces and saves the current folder's position as the user scrolls:

```typescript
const handleMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
  if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
  scrollSaveTimerRef.current = setTimeout(() => {
    if (currentPath) {
      setBrowserScrollPosition(currentPath, e.currentTarget.scrollTop);
    }
  }, 150);
}, [currentPath]);
```

### Restore logic

After a 100ms delay (to let React finish rendering the new folder's file list):

```typescript
setTimeout(() => {
  if (pendingScrollToFile) {
    scrollItemIntoView(pendingScrollToFile, false);
    clearPendingScrollToFile();
    // ... optional heading scroll after 750ms
  } else if (isNewFolder) {
    const savedPosition = getBrowserScrollPosition(currentPath);
    mainContainerRef.current?.scrollTo({ top: savedPosition, behavior: 'instant' });
  }
}, 100);
```

---

## Timing Reference

| Delay | Purpose | Location |
|-------|---------|----------|
| 50ms | Restore scroll after mount (DOM ready) | `useScrollPersistence.ts` |
| 100ms | Restore scroll after folder navigation (React render settle) | `BrowseView.tsx` |
| 150ms | Debounce scroll save | all scroll handlers |
| 750ms | Scroll to heading after markdown content renders | `BrowseView.tsx` |
| 300ms | Scroll to bottom after CodeMirror editor mounts | `ThreadView.tsx` |

---

## Tab Switching Mechanism

`src/App.tsx` conditionally renders views based on `currentView` from the store. There is no CSS `display:none` or `visibility:hidden` — views that are not current are simply not rendered. This means React fully unmounts them (running cleanup effects) and fully remounts them on return (running mount effects, including scroll restore).

Tab buttons in `src/components/AppTabButtons.tsx` call `setCurrentView(tab.id)` to trigger a view switch.

---

## ThreadView Special Case

`ThreadView` adds a `pendingThreadScrollToBottom` flag in the store. When set, the view scrolls to the bottom of the message list after mounting. There is an additional 300ms delay after the CodeMirror editor mounts before the final scroll-to-bottom is applied, to account for the editor's own render time.

---

## Adding Scroll Persistence to a New View

1. Add a `number` field to `ScrollPositions` in `src/store/types.ts`.
2. Initialize it to `0` in `initialState.scrollPositions` in `src/store/store.ts`.
3. Add a getter and setter function in `src/store/store.ts` — **do not call `emitChange()` in the setter**.
4. Call `useScrollPersistence(getter, setter)` in the new view component.
5. Attach `containerRef` as `ref` and `handleScroll` as `onScroll` to the scrollable `<main>` element.
