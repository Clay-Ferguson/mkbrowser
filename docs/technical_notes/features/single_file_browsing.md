# Single-File Browsing (`BrowseFile.tsx` vs `BrowseView.tsx`)

<!-- TOC -->

* [Overview](#overview)
* [The Deciding State: `browseFileName`](#the-deciding-state-browsefilename)
* [Routing in `App.tsx` — Swap, Not Hide](#routing-in-apptsx--swap-not-hide)
* [Entering Single-File Mode: Tree Click](#entering-single-file-mode-tree-click)
* [Leaving Single-File Mode: Breadcrumbs](#leaving-single-file-mode-breadcrumbs)
* [What `BrowseFile` Renders](#what-browsefile-renders)
* [Always-Expanded Editing (`alwaysExpandedEditor`)](#always-expanded-editing-alwaysexpandededitor)
* [Heading Clicks in Single-File Mode](#heading-clicks-in-single-file-mode)
* [Invariants](#invariants)
* [Code Locations](#code-locations)

<!-- /TOC -->

## Overview

The browser tab is a two-pane layout: `IndexTreeView` on the left, and on the right **either** a folder listing **or** one single file. Which one occupies the right pane is decided entirely by a single store field, `browseFileName`.

| Mode | Right pane | `browseFileName` |
|---|---|---|
| Listing mode | `BrowseView.tsx` — every file and folder in `currentPath`, as a scrolling list of entry components | `null` |
| Single-file mode | `BrowseFile.tsx` — exactly one entry, filling the pane | the bare file **name** |

Single-file mode is a *reading/focus* mode. It is not a different editor and not a different entry component: it renders the very same `MarkdownEntry` / `TextEntry` / `ImageEntry` / `GenericEntry` that the listing renders, just without any of its siblings. This matters when reasoning about it — there is no "single-file version" of an entry to keep in sync.

## The Deciding State: `browseFileName`

Lives in the view slice (`src/store/view.ts`), declared on `AppState` in `src/shared/types.ts`, initialized to `null` in `src/store/core.ts`.

It holds a bare **name**, not a path, and is always resolved against `currentPath`. The two are set together and can never drift:

- `setBrowseFile(folderPath, fileName)` sets `currentPath`, `currentView: 'browser'`, and `browseFileName` in **one** `set()` call.
- Any change of `currentPath` clears `browseFileName`. `setCurrentPath` and `navigateToBrowserPath` both include `browseFileName: null` in their patch unconditionally.
- `clearBrowseFile()` returns to listing mode without moving `currentPath`.

The consequence to rely on: **`browseFileName` can never name a file outside the folder currently in `currentPath`.** `BrowseFile` therefore resolves its entry by a plain `entries.find(e => e.name === browseFileName && !e.isDirectory)` against the already-loaded listing, with no path juggling.

`setCurrentPath` has one non-obvious branch. It early-returns when the path is unchanged — but in single-file mode "navigate to the folder I am already in" is a *meaningful* request (it is the common case, since the breadcrumb's last segment is the folder holding the browsed file). So that early-return path calls `clearBrowseFile()` before returning. Removing that line silently breaks the main way out of single-file mode.

## Routing in `App.tsx` — Swap, Not Hide

`App.tsx` (~`:544`) picks the pane with a ternary on `browseFileName`.

This deliberately does **not** use the `display:none` pattern that `App.tsx` uses for its top-level views. Mounting both panes at once would give the browsed file two live entry instances — two CodeMirror editors racing to register via `registerActiveMarkdownEditor`, plus duplicate DOM ids for heading anchors. The unmount is safe because the folder listing's scroll position is persisted per-folder in the store and restored when `BrowseView` remounts.

> Note this is an exception to the general "views never unmount" rule for this app. `BrowseFile` and `BrowseView` genuinely swap.

## Entering Single-File Mode: Tree Click

A plain left-click on any **file** row in `IndexTreeView` enters single-file mode — markdown or not (`handleNodeClick`, `IndexTreeView.tsx:328-331`):

```ts
if (!node.isDirectory) {
  setHighlightItem(node.path);
  setBrowseFile(getParentPath(node.path), node.name);
}
```

Two behaviors intentionally share that one click:

- **Every file** opens in the right pane.
- **Markdown files additionally** fall through to the heading-expansion branch below it, so the same click also expands/collapses the file's headings in the tree.

There is no context menu item for this; an earlier "Browse File" menu entry was removed in favor of the click. Folders are unaffected — clicking a folder expands/collapses it and never enters single-file mode. Ctrl+click on a `.sh` file runs the script and returns before any of this.

**Bookmarks are the second entry point.** `handleBookmarkNavigate` (`IndexTreeView.tsx:554`) routes a bookmarked *file* through `setBrowseFile` as well — a bookmark names one specific document, so opening it alone is what the click meant. A bookmarked *folder* still goes to `navigateToBrowserPath` and lands in listing mode. Note that the file/folder split here is a filename heuristic (`lastName.includes('.')`), shared with `BookmarksPopupMenu`'s icon choice; a folder whose name contains a dot is treated as a file by both.

## Leaving Single-File Mode: Breadcrumbs

`BrowseFile` renders `PathBreadcrumb` in a non-scrolling header, exactly as `BrowseView` does. Its `onNavigate` is just `setCurrentPath(path)` — which clears `browseFileName` and therefore swaps `BrowseView` back in at the clicked folder. **No breadcrumb-specific exit logic exists**; the exit falls out of the state rule above.

The home (root) button is always rendered and always clickable, *including when already at the root*. That is otherwise pointless for a folder listing, but it is what guarantees single-file mode always has a visible exit: when the browsed file sits in the root folder, the home button is the only segment there is to click. Do not "optimize" it back to disabled-at-root.

The other exit is the tree context menu's existing **Browse** item, which navigates to a folder listing.

## What `BrowseFile` Renders

- **Header**: `PathBreadcrumb` only, outside the scroll container.
- **Body**: the same entry-type ternary the listing uses, minus the directory branch — `isMarkdown → isImageFile → isTextFile → GenericEntry`.
- **Omitted props**: index-order move handlers (`onMoveUp`/`onMoveDown`/…) and `documentMode`. `EntryActionBar` renders items purely by callback presence, so omitting them hides those buttons — that is the whole mechanism, no flags needed.
- `ImageEntry` gets `allImages={[entry]}`; that prop only feeds the fullscreen viewer's prev/next, and with one file on screen the file is the whole set.
- **Auto-expand**: an effect on `[entry?.path]` calls `setItemExpanded(path, true)`. A single-file view whose one entry sat collapsed would be a dead end.
- **Not found**: if the name resolves to nothing (deleted externally, load in flight), it renders a placeholder rather than throwing.

Because entry components read their own state from the store by path and render their own CodeMirror, **click-to-edit, rename, delete and AI rewrite all work here with zero extra wiring.** Nothing about editing is hoisted into `BrowseView`, so nothing had to be extracted for `BrowseFile` to get it.

## Always-Expanded Editing (`alwaysExpandedEditor`)

In single-file mode the entry owns the entire pane, so a non-maximized editor would waste it. `BrowseFile` passes `alwaysExpandedEditor` to `MarkdownEntry` and `TextEntry`, which:

1. forces the maximized layout regardless of the global `expandedEditor` setting, and
2. hides the Expand/Collapse Editor toggle entirely, by passing `onToggleExpandedEditor={undefined}` to `EntryEditToolbar` (again: render-by-callback-presence).

This is a **per-call prop, not a setting write.** It deliberately neither reads nor writes the persisted `settings.expandedEditor`, so a trip through single-file mode leaves the user's folder-listing preference untouched. An e2e phase guards exactly that leak — if you refactor this into a settings mutation, that test will catch you, and it should.

Layout note: the maximized entry expects a flexed ancestor, so `BrowseFile` conditionally applies a nested flex-column chain (`overflow-hidden flex flex-col` on `<main>`, `flex-1 min-h-0 flex flex-col` on the wrapper), mirroring `BrowseView`. Plain-text files get this chain in *view* mode too, not just while editing — `TextEntry`'s CodeMirror otherwise caps itself at ~60% of the scroll area, which is right for a row in a list and wasteful for the one file that owns the view.

## Heading Clicks in Single-File Mode

`handleHeadingClick` (`IndexTreeView.tsx:572`) scrolls in place when the heading's document is already on screen, which keeps single-file mode intact while hopping between a document's headings. The check is:

```ts
const showingThisFile = browseFileName === null || joinPath(currentPath, browseFileName) === filePath;
if (showingThisFile && document.getElementById(node.slug)) { … }
```

`browseFileName` must be tested *as well as* the slug: two documents can produce the same slug, and in single-file mode only the one open file is rendered — so a bare slug hit for any other file is a false positive that would scroll to the wrong document's heading.

## Invariants

Things to preserve when touching this area:

1. `browseFileName` is a **name**, never a path, and is only ever valid relative to `currentPath`.
2. Any `currentPath` change clears it. Add a new navigation action? It must clear it too.
3. `BrowseFile` and `BrowseView` are never mounted simultaneously.
4. Entry components stay ignorant of which of the two mounted them. Anything that needs to differ is passed as a prop (as `alwaysExpandedEditor` is), never branched on a global.
5. `alwaysExpandedEditor` never writes `settings.expandedEditor`.

## Code Locations

| Concern | File |
|---|---|
| State field, actions (`setBrowseFile` / `clearBrowseFile`), clear-on-navigate | `src/store/view.ts` |
| `AppState` declaration | `src/shared/types.ts` |
| `initialState` | `src/store/core.ts` |
| Pane routing ternary | `src/App.tsx` (~`:544`) |
| Single-file pane | `src/components/views/BrowseFile.tsx` |
| Folder listing pane | `src/components/views/BrowseView.tsx` |
| Tree click → single-file mode | `src/components/views/IndexTreeView.tsx` (`handleNodeClick`) |
| Heading click / in-place scroll | `src/components/views/IndexTreeView.tsx` (`handleHeadingClick`) |
| Always-clickable home button | `src/components/PathBreadcrumb.tsx` |
| `alwaysExpandedEditor` prop | `src/components/entries/common/types.ts`, `MarkdownEntry.tsx`, `TextEntry.tsx`, `EntryEditToolbar.tsx` |
| e2e coverage | `tests/e2e/private-browse-file.spec.ts` |
