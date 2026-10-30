# Scroll Management

* [Overview](#overview)
* [Tab Switches: Handled by the DOM](#tab-switches-handled-by-the-dom)
* [Per-Folder Positions in the Browser View](#per-folder-positions-in-the-browser-view)
  * [Why a module-level Map, not the store](#why-a-module-level-map-not-the-store)
  * [Saving](#saving)
  * [Restoring](#restoring)
* [Pending Scroll Requests](#pending-scroll-requests)
  * [`pendingScrollToFile`](#pendingscrolltofile)
  * [`pendingScrollToHeadingSlug`](#pendingscrolltoheadingslug)
  * [`pendingThreadScrollToBottom`](#pendingthreadscrolltobottom)
* [The Settle Phase (`entryDom.ts`)](#the-settle-phase-entrydomts)
  * [Settle entry points](#settle-entry-points)
  * [How a settle phase runs](#how-a-settle-phase-runs)
  * [Constants](#constants)
* [Hidden Views: Pitfalls](#hidden-views-pitfalls)
* [Other, Local Scrolls](#other-local-scrolls)
* [Rules for New Scroll Code](#rules-for-new-scroll-code)
* [History: What Was Tried and Replaced](#history-what-was-tried-and-replaced)
* [Code Map](#code-map)

## Overview

Scrolling in a React app is hard for one reason: **the element you want to scroll to usually doesn't exist yet, and once it exists it keeps moving.** A folder has to load before its entries render. Each entry then loads its own body (markdown text, images, mermaid, KaTeX) on later commits, and each one that fills in pushes everything below it down the page. A single `scrollTo` at "the right moment" lands in the wrong place, and a fixed `setTimeout` delay is only a guess at when that moment is.

The app deals with this in four parts:

1. **Tab switches** keep their position for free, because views are never unmounted.
2. **The browser view** saves a scroll position for each folder and restores it when you navigate back.
3. **Pending scroll requests** are store flags that mean "scroll to X once it renders". The view that renders X consumes the flag on the commit where X appears, before the browser paints that commit.
4. **The settle phase** keeps the target in place while late content reflows the page. It is driven by a `ResizeObserver` and stops as soon as the user scrolls.

One rule runs through all four: **no timer guesses.** Every scroll fires on a real event: a commit, a resize, or the target appearing. The one interval left is the poll in `scrollElementIntoView`, which checks whether a heading has rendered yet; it does not decide when to scroll.

Scroll positions are **session-only**. Nothing about scrolling is written to `config.yaml`.

## Tab Switches: Handled by the DOM

`App.tsx` mounts each view the first time its tab is visited and then keeps it mounted. Inactive views get `display: none` (see `application_tabs.md` and DEVELOPER_GUIDE § "Views Never Unmount"). Each view owns its own `<main className="... overflow-y-auto">`, and that element is never removed, so the browser keeps its `scrollTop` across tab switches. There is no save/restore code for this.

The one exception is the swap between `BrowseView` and `BrowseFile` (single-file mode). That swap really does unmount `BrowseView`; see [Restoring](#restoring).

## Per-Folder Positions in the Browser View

`BrowseView` is a single instance that is reused for every folder. When `currentPath` changes, the same `<main>` shows a different listing, so the DOM's own `scrollTop` belongs to whichever folder was shown last. The view therefore saves and restores a position for each folder path itself. That logic lives in `usePendingBrowseIntents` (`src/components/views/usePendingBrowseIntents.ts`), which `BrowseView` calls with its `mainContainerRef`.

### Why a module-level Map, not the store

`src/store/scroll.ts` holds the positions in a plain `Map<string, number>` (`browserPositions`) with `getBrowserScrollPosition` / `setBrowserScrollPosition`, **outside** the Zustand store. Positions are written constantly while the user scrolls, but they are only read imperatively when the folder changes. If they lived in the reactive store, every scroll would notify subscribers and re-render components. Mutating the store's state without notifying subscribers would avoid that, but it risks tearing. A plain module-level Map makes "update without re-rendering" explicit. An unknown path reads as `0`.

### Saving

The position is saved in two places:

- **While scrolling.** `handleMainScroll` (the hook's return value, wired to `<main onScroll>`) saves `scrollTop` for `currentPath`, debounced by 150 ms. The debounce timer is cleared on unmount.
- **On folder change.** When the effect sees that `currentPath` differs from `previousPathRef`, it saves the container's current `scrollTop` under the *previous* path first. This catches a scroll that is still inside the debounce window.

### Restoring

The main effect in `usePendingBrowseIntents` waits for `entriesLoading` to be false. It then restores with `holdScrollTop(main, getBrowserScrollPosition(currentPath))` in two cases:

- **`isNewFolder`**: the user navigated to another folder within the browser tab.
- **`isFirstMount`** (`previousPathRef` is still `null`): `BrowseView` has just been remounted, because single-file mode (browsing one file, or a maximized edit) swaps it out for `BrowseFile` instead of hiding it. The position comes back as fresh as the last debounced save, so within about 150 ms of accurate. At app startup nothing has been saved yet, so the restore is a harmless `scrollTo(0)`.

`holdScrollTop` is needed rather than a plain `scrollTo` because the entries' bodies are usually still loading on the first commit. The listing may not yet be tall enough to reach the saved offset, so the browser clamps the first scroll short. `holdScrollTop` re-applies the offset as the content grows and **stops as soon as the offset is reached**, so it never fights a listing that has already grown to fit.

Two cases keep the restore out of the way:

- **The browser tab is inactive.** The effect returns early. It still updates `previousPathRef` to `currentPath` (unless the ref is `null`), so coming back to the tab isn't mistaken for a folder navigation, which would save a `scrollTop` that belongs to a listing no longer shown. A `null` ref is left `null`, because a view that mounted while hidden still owes its first restore.
- **A pending file or heading scroll is queued.** The restore would fight it, so the restore is skipped. See below.

## Pending Scroll Requests

Code that wants to show something at a particular scroll position rarely owns the DOM that will contain it, and that DOM doesn't exist yet. So it sets a flag in the store (`view.ts`), and the view that renders the target consumes the flag. Every consumer follows the same rules:

- **Consume only on success.** Clear the flag when the scroll actually happened, not when the effect ran, so a commit that arrives before the target exists doesn't throw the request away.
- **Gate on `useIsActiveView`.** A hidden pane has no layout, so the request waits for the tab to become visible.
- **Scroll before paint where the first frame matters.** Use `useLayoutEffect`, so the first frame the user sees is already at the final position.

| Flag | Set by | Consumed by | Hands off to |
|------|--------|-------------|--------------|
| `pendingScrollToFile` | `navigateToBrowserPath(path, scrollToFile)`, `setPendingScrollToFile`, and `setItemEditing` when leaving a maximized edit | `usePendingItemScroll` (layout effect, in `BrowseView`) | `scrollItemIntoView(path, false, true)`: instant centering, then settle |
| `pendingScrollToHeadingSlug` | `openFileSingle` in `linkRepair.ts` | `BrowseFile` (passive effect); `usePendingBrowseIntents` also handles it | `scrollElementIntoView(slug, true)`: poll for the heading, smooth centering, then settle |
| `pendingThreadScrollToBottom` | `MarkdownEntry` after a reply is created in the thread view | `ThreadView` (layout effect) | `pinScrollToBottom(main)`: bottom, then settle |

### `pendingScrollToFile`

Many routes land on a specific file in a listing: search results, the index tree, the calendar, the folder graph, markdown links, the up button, leaving a maximized edit, creating or pasting a file, and the image viewer's jump. All of them go through this flag.

`usePendingItemScroll` (`src/components/views/usePendingItemScroll.ts`) consumes it in a `useLayoutEffect` with **no dependency array**. Nobody can know in advance which commit will first render the target entry, because that depends on when the folder load resolves. So the effect runs after every commit of `BrowseView` and asks the DOM whether the target is there yet. When the flag is `null`, that check costs nothing. Because the scroll happens before paint, the listing never shows a frame at the old offset. (Its predecessor was a passive effect with a 100 ms timeout, which always painted once at the wrong offset and then jumped.)

It must be called from the component that renders the entries, not from an ancestor, so that it runs on the commit where the entry rows appear.

`usePendingBrowseIntents` doesn't consume this flag. It reads it only as a gate: while the flag is set, neither the heading scroll nor the folder restore runs. Clearing the flag re-runs that effect, so neither is missed.

A request for a file that never renders stays pending until the next request replaces it. Callers that could produce such a path guard against it; for example, `BrowseFile`'s `handleBreadcrumbNavigate` passes `scrollToFile` only when the file lives in the destination folder. See `single_file_browsing.md`.

### `pendingScrollToHeadingSlug`

A `file.md#slug` link calls `openFileSingle(path, slug)`. If that file is already the one on screen in single-file mode and the heading has rendered, it scrolls in place with no flag. Otherwise it queues the slug and opens the file in `BrowseFile`, which consumes the slug once the entry for the current folder's file has rendered. `browseFileName` is compared as well as the slug, because two documents can produce the same slug.

`scrollElementIntoView` is fire-and-forget, so the flag is cleared immediately. If the heading isn't in the DOM yet, it polls for it (every 100 ms, giving up after 3 s, for example when a slug is stale). It then scrolls **smoothly**, because this is a scroll the user asked for, and starts a settle phase with smooth corrections.

`usePendingBrowseIntents` also consumes this flag, after `pendingScrollToFile` has landed. Today the only producer, `openFileSingle`, always routes to `BrowseFile`, so in practice the listing never sees the flag. The branch is there for any future caller that navigates the listing to a heading.

### `pendingThreadScrollToBottom`

`ThreadView` scrolls to the bottom in a `useLayoutEffect` once the thread has loaded (`loaded` means the entries on screen belong to the current path), the view is active, and the flag is set. The flag stays set until that scroll actually runs, so a request that arrives without a path change isn't lost. The pending-edit effect that opens the reply's editor also calls `pinScrollToBottom`, so the pin follows the bottom down as CodeMirror mounts and grows. No delay is needed for either.

## The Settle Phase (`entryDom.ts`)

A layout effect only runs when *its own* component commits. An entry that finishes loading its body below the target is a commit of that child, not of `BrowseView`, so it can't re-trigger the effect. Yet that content can still reflow the page and slide the target away. The settle phase in `src/renderer/entryDom.ts` covers that gap.

### Settle entry points

| Function | Initial scroll | Keeps the container at | Ends early when |
|----------|---------------|------------------------|-----------------|
| `scrollItemIntoView(path, highlight, settle)` | instant, centered on the entry header | the entry, centered | the entry leaves the DOM |
| `scrollElementIntoView(id, highlight)` | smooth, centered (after polling for the element) | the element, centered | the element leaves the DOM |
| `pinScrollToBottom(container)` | instant, to the bottom | `scrollHeight - clientHeight` | n/a |
| `holdScrollTop(container, top)` | instant, to `top` | `top` | the offset is reached (within tolerance) |

Centering is done by hand (`computeCenteredScrollTop` plus `container.scrollTo`), not with `element.scrollIntoView`. `scrollIntoView` also scrolls every scrollable ancestor, which can break the Electron layout. The container is found with `element.closest('main')`, never with a global `document.querySelector('main')`, because hidden views keep their own `<main>` elements in the DOM. `scrollIntoView` is used only as a fallback when the element has no `<main>` ancestor, and in that case there is no settle phase.

### How a settle phase runs

`beginSettleCorrections(container, desiredTop, behavior)` works like this:

- **Observes** each direct child of the container with a `ResizeObserver`. The container's own box never changes size, but growth anywhere inside it shows up as a change in a direct child's height. A `MutationObserver` adds new direct children to the watch list as they mount. On each callback, if the scroll position is more than `SETTLE_TOLERANCE_PX` from the target, it scrolls back.
- **Stops**, through a single `AbortController` that removes every listener, observer and timer, on any of:
  - user input: `wheel`, `touchstart`, or `mousedown` on the container (which covers scrollbar drags), or `keydown` on the window. It never fights the user for the scrollbar;
  - `desiredTop()` returning `null` (the target is gone);
  - the container being hidden (`clientHeight === 0`, i.e. a tab switch). Correcting a pane with no layout would set its scroll to zero;
  - `SETTLE_WINDOW_MS` elapsing.
- **Replaces** any settle phase already running on the same container (`activeSettles`), so two targets never fight over the scrollbar.
- **Scrolls the same way the caller did.** An instant scroll that ran before paint gets instant corrections; otherwise each reflow would animate the page for a user who never asked to scroll. A smooth heading scroll gets smooth corrections.

`DYNAMIC_SCROLL_TO_ELEMENT` at the top of the file switches off the settle phase for `scrollElementIntoView`. It then falls back to a single scroll after `ONE_SHOT_SCROLL_DELAY_MS`, which is how the app behaved before settling was added. Keep it `true`. The switch exists only for diagnosing problems.

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| (debounce in `handleMainScroll`) | 150 ms | Per-folder scroll save |
| `FIND_ELEMENT_INTERVAL_MS` / `FIND_ELEMENT_TIMEOUT_MS` | 100 ms / 3000 ms | Polling for a heading that hasn't rendered |
| `SETTLE_WINDOW_MS` | 2500 ms | Upper bound on a settle phase (it usually ends sooner, on user input) |
| `SETTLE_TOLERANCE_PX` | 4 px | Drift ignored; also the point at which `holdScrollTop` counts as arrived |
| `ONE_SHOT_SCROLL_DELAY_MS` | 1000 ms | Only when `DYNAMIC_SCROLL_TO_ELEMENT` is `false` |

## Hidden Views: Pitfalls

Because views stay mounted while hidden, the DOM always contains content that isn't visible. Scroll code has to account for that:

- **Duplicate ids.** `ThreadView` renders the same `HUMAN.md`/`AI.md` entries as the browser listing, so the same entry-header ids and heading slugs appear twice, and the thread's copy comes earlier in DOM order. Use `getVisibleElementById`, never `document.getElementById`. It returns the first match that passes `checkVisibility()`. The same applies to in-page `#anchor` links in `CustomAnchor`.
- **No layout while hidden.** Measuring or scrolling a `display: none` pane gives nonsense. Gate pending-request consumers on `useIsActiveView(view)` and list it in the effect's deps, so the request runs when the tab is shown. The settle phase cancels itself when its container is hidden.
- **Don't confuse "tab came back" with "folder changed".** This is the `previousPathRef` bookkeeping described under [Restoring](#restoring).

## Other, Local Scrolls

These scroll their own small containers and don't use the machinery above:

| Where | What |
|-------|------|
| `IndexTreeView` | Reveals the selected node: a `useLayoutEffect` keyed on `treeRoot` centers the row on the commit that first renders it |
| `CustomAnchor` | In-page `#anchor` links (Electron's native hash navigation doesn't reach a nested scroll container) |
| `HelpSearchBar` | Centers the current find-in-page match |
| `EditableCombobox` | Keeps the highlighted option visible |
| `StreamingDialog` | Keeps streamed output scrolled to the bottom |
| `ThesaurusView` | Resets the synonym strip to the top when a new lookup result arrives |
| `CodeMirrorEditor` | Scrolls inside the editor through CodeMirror's own `EditorView.scrollIntoView`, never the DOM |

## Rules for New Scroll Code

1. **A new view needs no scroll persistence.** Give it its own `<main className="flex-1 min-h-0 overflow-y-auto">`, and tab switches keep its position.
2. **To land on something that renders later, add or reuse a pending flag** in `view.ts`, and consume it in the component that renders the target. Clear it only once the scroll has happened.
3. **Use a layout effect** when the first painted frame must already be at the right position. Use a passive effect when a frame of delay doesn't matter.
4. **Never wait with `setTimeout`.** If content can reflow after your scroll, use one of the `entryDom` settle entry points (or add one built on `beginSettleCorrections`).
5. **Look up targets with `getVisibleElementById`** and resolve the container from the element (`closest('main')`).
6. **Gate on `useIsActiveView`.**
7. **Keep high-frequency scroll state out of the reactive store** (see `scroll.ts`).

## History: What Was Tried and Replaced

Most older scroll code was removed because it relied on views unmounting or on timers. In order:

- **Unmount and remount with a save/restore layer** (`a18219b`, January 2026). Every view saved its scroll position into a `scrollPositions` object in the store through a `useScrollPersistence` hook, with a 150 ms debounced save and a restore 50 ms after mount. Commit `ee2b580` removed it when views stopped unmounting. Only the browser's per-folder Map is left, now in `scroll.ts`.
- **Fixed delays**, such as a 100 ms wait before the item scroll, 50 to 300 ms waits in the thread view, and a 750 ms wait in the index tree. These were replaced by the layout effects and the `ResizeObserver` settle phase described above, most of them in commit `5a09e51`.
- **Hide, resize, re-anchor, fade in** (`704432c`, May 2026). A toggle on an image changed the size of every image in the listing at once. To keep the clicked image in view through that reflow, the toggle applied the new size and `opacity: 0` in one store update. It then waited two `requestAnimationFrame`s, so the hidden frame with the new layout had actually painted. While still invisible, it called `scrollIntoView({ behavior: 'instant', block: 'center' })` on the clicked image (found by its `img[src]`), then cleared the flag so the container faded back in over 1 s. The double rAF matters: a CSS opacity transition only animates if its starting value has painted. Commit `3fce48c` removed the technique when image size moved to the Settings view, where no listing is on screen while it changes. It is still a sound pattern for any future single action that resizes most of the visible content.

## Code Map

| Concern | Location |
|---------|----------|
| Per-folder position store | `src/store/scroll.ts` |
| Per-folder save/restore and the browser's pending requests | `src/components/views/usePendingBrowseIntents.ts` |
| Pre-paint scroll to a file | `src/components/views/usePendingItemScroll.ts` |
| Heading request in single-file mode | `src/components/views/BrowseFile.tsx` |
| Heading link entry point | `src/renderer/linkRepair.ts` (`openFileSingle`) |
| Thread scroll to bottom | `src/components/views/ThreadView.tsx` |
| Pending flags and their actions | `src/store/view.ts` |
| Centering, settle phase, visible-element lookup | `src/renderer/entryDom.ts` |
| Views kept mounted (`display: none`) | `src/App.tsx`; `application_tabs.md` |
