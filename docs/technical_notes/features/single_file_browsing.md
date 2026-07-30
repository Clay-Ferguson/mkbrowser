# Single-File Browsing (`BrowseFile.tsx` vs `BrowseView.tsx`)

<!-- TOC -->

* [Overview](#overview)
* [The Deciding State: `browseFileName`](#the-deciding-state-browsefilename)
* [Why: `browseFileMode`](#why-browsefilemode)
* [Routing in `App.tsx` — Swap, Not Hide](#routing-in-apptsx--swap-not-hide)
* [Entering Single-File Mode: Tree Click](#entering-single-file-mode-tree-click)
* [Entering Single-File Mode: Expanded Editing](#entering-single-file-mode-expanded-editing)
* [Leaving Single-File Mode: The Index Tree](#leaving-single-file-mode-the-index-tree)
* [No Breadcrumbs Here — On Purpose](#no-breadcrumbs-here--on-purpose)
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

Single-file mode is not a different editor and not a different entry component: it renders the very same `MarkdownEntry` / `TextEntry` / `ImageEntry` / `GenericEntry` that the listing renders, just without any of its siblings. This matters when reasoning about it — there is no "single-file version" of an entry to keep in sync.

It serves two purposes, told apart by `browseFileMode`: *reading/focus* (the user asked for this one file) and *expanded editing* (a maximized editor took over the pane). **`BrowseFile` is the only place a maximized editor lives** — `BrowseView` renders a folder listing and nothing else.

## The Deciding State: `browseFileName`

Lives in the view slice (`src/store/view.ts`), declared on `AppState` in `src/shared/types.ts`, initialized to `null` in `src/store/core.ts`.

It holds a bare **name**, not a path, and is always resolved against `currentPath`. The two are set together and can never drift:

- `setBrowseFile(folderPath, fileName, mode = 'browse')` sets `currentPath`, `currentView: 'browser'`, `browseFileName` and `browseFileMode` in **one** `set()` call.
- Any change of `currentPath` clears `browseFileName`. `setCurrentPath` and `navigateToBrowserPath` both include `browseFileName: null` in their patch unconditionally.
- `clearBrowseFile()` returns to listing mode without moving `currentPath`.

The consequence to rely on: **`browseFileName` can never name a file outside the folder currently in `currentPath`.** `BrowseFile` therefore resolves its entry by a plain `entries.find(e => e.name === browseFileName && !e.isDirectory)` against the already-loaded listing, with no path juggling.

`setCurrentPath` has one non-obvious branch. It early-returns when the path is unchanged — but in single-file mode "navigate to the folder I am already in" is a *meaningful* request (it is the common case, since the browsed file usually lives in `currentPath`). So that early-return path calls `clearBrowseFile()` before returning. Removing that line silently breaks a way out of single-file mode.

## Why: `browseFileMode`

`browseFileName` says *which* file; `browseFileMode` says *why*, and that decides how the one entry behaves:

| Mode | Entered by | Editor toggle | Ends by |
|---|---|---|---|
| `'browse'` | tree click, bookmark, `EntryActionBar`'s "View File" | **hidden** (`alwaysExpandedEditor`) | tree "Browse" / a folder bookmark only — editing does not exit |
| `'expanded-edit'` | starting an edit in the folder listing with `settings.expandedEditor` on | **visible** | the edit ending (save/cancel), collapsing the toggle, or navigating |

It is **only meaningful while `browseFileName` is non-null**. `setBrowseFile` always writes it, so a value left over from a previous single-file session can never be read stale — which is why the actions that clear `browseFileName` do not have to clear it too.

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

## Entering Single-File Mode: Expanded Editing

`settings.expandedEditor` is a persisted user preference meaning "editing opens maximized". It is **implemented by view routing, not by CSS**: with it on, starting an edit on a file in the folder listing enters single-file mode with `browseFileMode: 'expanded-edit'`, and `BrowseFile` hosts the maximized editor.

The rules live in `src/store/expandedEdit.ts` as pure predicates over a state snapshot, and are applied inside `setItemEditing` (`src/store/items.ts`) — one choke point, folded into the same atomic `set()` as the edit flag. That covers every way an edit starts or ends: click-to-edit, `BrowseView`'s `pendingEditFile` timer (search-results jump-to-edit), and `App.tsx`'s global Escape handler.

`enterExpandedEditPatch` routes only when **all** of these hold, and each check earns its place:

| Check | Excludes |
|---|---|
| `settings.expandedEditor` | the default: editing stays inline in the listing |
| `currentView === 'browser'` | `ThreadView`, which renders entries in a scrolling block and ignores expanded editing |
| `getParentPath(path) === currentPath` | attachments — `*_attach` contents are rendered by `AttachFolderContents` from another folder, and deliberately keep editing inline |
| `browseFileName === null` | a file already open in `'browse'` mode, whose caller owns the pane on its own terms |

Exiting is the mirror image: `setItemEditing(path, false)` clears `browseFileName` when the pane is given over to a maximized edit **of that same file** (`isExpandedEditOf`). The path check matters — the global Escape handler closes the first editing item it finds, which may be a leftover from another folder, and that must not evict the file on screen. Save-and-keep-editing never touches `editing`, so it correctly stays in the maximized editor.

The expand/collapse toggle goes through `toggleExpandedEditor(path)` (view slice), which flips the preference **and** moves the editor in one update — expanding hands the file the pane, collapsing returns to the listing with the editor still open inline. There is deliberately no bare `setExpandedEditor`: flipping the flag without moving the editor is never correct.

> **Why this design.** Expanded editing used to be a class chain on `BrowseView` itself, driven by a scan of the items map for "something is editing". That map is global and long-lived, so the flag stayed true after navigating away from the file being edited: the listing fell back to showing every entry while the maximize classes stayed on, and every row became an equal-share flex item. Deriving layout from a global edit-state scan is the bug; the fix is that no view derives layout from edit state at all any more. Do not add such a scan back — `summarizeItems` in `BrowseView.tsx` carries the same warning.

## Leaving Single-File Mode: The Index Tree

Every exit is a navigation, and **no exit-specific logic exists** — it all falls out of the state rule above (any `currentPath` change clears `browseFileName`, and `navigateToBrowserPath` clears it unconditionally so re-navigating to the folder you are already in works too).

| Exit | Mechanism |
|---|---|
| The **Browse Folder** link, top-right of the pane | `navigateToBrowserPath(currentPath)` |
| Tree context menu → **Browse** (on the file, or on any folder) | `navigateToBrowserPath` |
| A **folder** bookmark | `navigateToBrowserPath` |
| Ending an `'expanded-edit'` session (save/cancel, or collapsing the toggle) | `setItemEditing` / `toggleExpandedEditor` — `'expanded-edit'` mode only |

Note what is *not* an exit: clicking a folder row in the tree only expands/collapses it, and clicking another file swaps which file is browsed rather than leaving the mode.

## No Breadcrumbs Here — On Purpose

`BrowseFile` deliberately renders **no `PathBreadcrumb`**, and this is the one visible difference between it and `BrowseView`. With a breadcrumb header the two views are pixel-identical whenever a folder holds exactly one file, so a user who has forgotten they clicked a tree file reads the pane as "my other files vanished" — the breadcrumb actively reinforces the misreading by naming a folder whose contents are not what is on screen. Its absence is the cue that this is one file, not a listing.

What the breadcrumb *was* genuinely useful for here — "take me back to the folder this file is in" — is kept as a single **Browse Folder** text link, right-aligned above the entry and outside the scroll container (`data-testid="browse-folder-link"`). It calls `navigateToBrowserPath(currentPath)`, which is the whole implementation: `currentPath` already *is* the containing folder, and that action clears `browseFileName` unconditionally, so navigating to the folder you are already "in" works. Styled as bare text in amber (`text-amber-500`, matching the folder icon color) so it reads as a link, not a header. Its `title` is `Open Folder <name>`, which doubles as the way to see which folder the file lives in — the one piece of information the breadcrumb carried.

The link is **hidden while the file is being edited** (`!editing`, the same store read that drives the maximized layout): offering "leave for the folder listing" mid-edit is not what this view should be doing, and the row would otherwise eat space off the top of a maximized editor.

Do **not** grow this back into a breadcrumb. A path trail is what made the two views look alike; one right-aligned link does not.

An e2e phase asserts `path-breadcrumb` has count 0 while single-file mode is active, and exits through the link (`private-browse-file.spec.ts`), so a re-added breadcrumb fails the suite.

## What `BrowseFile` Renders

- **Header**: no breadcrumbs — just the right-aligned **Browse Folder** link (see above), outside the scroll container.
- **Body**: the same entry-type ternary the listing uses, minus the directory branch — `isMarkdown → isImageFile → isTextFile → GenericEntry`.
- **Omitted props**: index-order move handlers (`onMoveUp`/`onMoveDown`/…) and `documentMode`. `EntryActionBar` renders items purely by callback presence, so omitting them hides those buttons — that is the whole mechanism, no flags needed.
- `ImageEntry` gets `allImages={[entry]}`; that prop only feeds the fullscreen viewer's prev/next, and with one file on screen the file is the whole set.
- **Auto-expand**: an effect on `[entry?.path]` calls `setItemExpanded(path, true)`. A single-file view whose one entry sat collapsed would be a dead end.
- **Not found**: if the name resolves to nothing (deleted externally, load in flight), it renders a placeholder rather than throwing.

Because entry components read their own state from the store by path and render their own CodeMirror, **click-to-edit, rename, delete and AI rewrite all work here with zero extra wiring.** Nothing about editing is hoisted into `BrowseView`, so nothing had to be extracted for `BrowseFile` to get it.

## Always-Expanded Editing (`alwaysExpandedEditor`)

In `'browse'` mode the entry owns the entire pane, so a non-maximized editor would waste it. `BrowseFile` passes `alwaysExpandedEditor` to `MarkdownEntry` and `TextEntry`, which:

1. forces the maximized layout regardless of the global `expandedEditor` setting, and
2. hides the Expand/Collapse Editor toggle entirely, by passing `onToggleExpandedEditor={undefined}` to `EntryEditToolbar` (again: render-by-callback-presence).

This is a **per-call prop, not a setting write.** It deliberately neither reads nor writes the persisted `settings.expandedEditor`, so a trip through single-file mode leaves the user's folder-listing preference untouched. An e2e phase guards exactly that leak — if you refactor this into a settings mutation, that test will catch you, and it should.

**In `'expanded-edit'` mode the prop is not passed** (`alwaysExpandedEditor={browseFileMode === 'browse'}`). Nothing else has to change: the global setting is true by construction there, so `editorExpanded` / `maximized` come out the same way — and because the prop is absent, the toggle renders and the user can hand the pane back. That single line is the whole difference between the two modes.

Layout note: the maximized entry expects a flexed ancestor, so `BrowseFile` conditionally applies a nested flex-column chain (`overflow-hidden flex flex-col` on `<main>`, `flex-1 min-h-0 flex flex-col` on the wrapper). This is the only place that chain exists. Plain-text files get it in *view* mode too, not just while editing — `TextEntry`'s CodeMirror otherwise caps itself at ~60% of the scroll area, which is right for a row in a list and wasteful for the one file that owns the view.

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
6. `BrowseFile` is the only place a maximized editor lives. `BrowseView` renders a folder listing and nothing else — no edit-driven layout, no edit-driven scroll bookkeeping.
7. No view derives layout from a scan of the items map for edit state. The map is global and long-lived; such a flag goes stale the moment the user navigates away.
8. `browseFileMode` is written only by `setBrowseFile` and the two routing rules. It is read only while `browseFileName` is non-null.
9. `BrowseFile` renders no breadcrumb — its absence is the only visual signal that the pane holds one file rather than a folder listing. The **Browse Folder** link replaces its usefulness, not its form.

## Code Locations

| Concern | File |
|---|---|
| State fields, actions (`setBrowseFile` / `clearBrowseFile` / `toggleExpandedEditor`), clear-on-navigate | `src/store/view.ts` |
| Expanded-edit routing rules (`enterExpandedEditPatch`, `isExpandedEditOf`) | `src/store/expandedEdit.ts` |
| Where those rules are applied (`setItemEditing`) | `src/store/items.ts` |
| `AppState` declaration | `src/shared/types.ts` |
| `initialState` | `src/store/core.ts` |
| Pane routing ternary | `src/App.tsx` (~`:544`) |
| Single-file pane | `src/components/views/BrowseFile.tsx` |
| Folder listing pane | `src/components/views/BrowseView.tsx` |
| Tree click → single-file mode | `src/components/views/IndexTreeView.tsx` (`handleNodeClick`) |
| Heading click / in-place scroll | `src/components/views/IndexTreeView.tsx` (`handleHeadingClick`) |
| Breadcrumb (rendered by `BrowseView`, never by `BrowseFile`) | `src/components/PathBreadcrumb.tsx` |
| `alwaysExpandedEditor` prop | `src/components/entries/common/types.ts`, `MarkdownEntry.tsx`, `TextEntry.tsx`, `EntryEditToolbar.tsx` |
| e2e coverage — single-file browsing | `tests/e2e/private-browse-file.spec.ts` |
| e2e coverage — expanded editing | `tests/e2e/private-expanded-edit.spec.ts` |
| unit coverage — routing rules | `tests/expandedEditRouting.test.ts` |
