# Single-File Browsing (`BrowseFile.tsx` vs `BrowseView.tsx`)

<!-- TOC -->

* [Overview](#overview)
* [The Deciding State: `browseFileName`](#the-deciding-state-browsefilename)
* [Why: `browseFileMode`](#why-browsefilemode)
* [Routing in `App.tsx` — Swap, Not Hide](#routing-in-apptsx--swap-not-hide)
* [Entering Single-File Mode: Tree Click](#entering-single-file-mode-tree-click)
* [Entering Single-File Mode: Expanded Editing](#entering-single-file-mode-expanded-editing)
* [Leaving Single-File Mode: The Index Tree](#leaving-single-file-mode-the-index-tree)
* [The Header: Breadcrumb + "Listing Hidden" Badge](#the-header-breadcrumb--listing-hidden-badge)
  * [Hidden While the Editor Is Maximized](#hidden-while-the-editor-is-maximized)
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
| Any **breadcrumb segment** — home icon included, and the **rightmost** segment (the file's own folder), which is the in-pane way back to the listing | `navigateToBrowserPath(segmentPath, scrollToFile)` |
| Tree context menu → **Browse** (on the file, or on any folder) | `navigateToBrowserPath` |
| A **folder** bookmark | `navigateToBrowserPath` |
| Ending an `'expanded-edit'` session (save/cancel, or collapsing the toggle) | `setItemEditing` / `toggleExpandedEditor` — `'expanded-edit'` mode only |

Note what is *not* an exit: clicking a folder row in the tree only expands/collapses it, and clicking another file swaps which file is browsed rather than leaving the mode.

## The Header: Breadcrumb + "Listing Hidden" Badge

While the file is being **read**, `BrowseFile` renders the same `PathBreadcrumb` header `BrowseView` does, with a **"Listing Hidden"** badge right-aligned beside it in that one header row — the same "path trail left, status right" shape the listing's header has. The header sits outside the scroll container, so it stays put while the file scrolls, and it is dropped entirely once the editor is maximized (see [below](#hidden-while-the-editor-is-maximized)).

This is a reversal, in two steps. The view originally rendered *no* breadcrumb, on the theory that a missing path header was the visual cue telling single-file mode apart from a folder listing that happens to hold exactly one file, and a right-aligned **Browse Folder** link stood in for the one thing the breadcrumb was useful for. In practice the breadcrumb is the fastest way to reach *any* ancestor folder — one click, from wherever you are — and that outweighs the cue. Once it was back, the link was saying what the breadcrumb's rightmost segment already did, so it became the badge instead: the cue kept as words, with the navigation left to the breadcrumb. Anything relying on "no breadcrumb means single-file mode" is therefore wrong; use `browseFileName` (or the `browse-file-main-content` testid) instead.

**Every segment is a live exit.** `onNavigate` is `handleBreadcrumbNavigate`, which calls `navigateToBrowserPath(path, scrollToFile)`. That action clears `browseFileName` unconditionally, so even the rightmost segment — this file's own folder — is a real exit rather than a no-op, and it is the only in-pane way back to the listing. `scrollToFile` carries over the behavior the old link had: when `highlightItem` lives in the folder being navigated to (which in practice means that rightmost segment), the listing lands scrolled to the browsed file rather than at the top of a folder the user may have scrolled deep into. It is guarded on the destination folder because `BrowseView` consumes `pendingScrollToFile` only once it finds the element, so a path from elsewhere would linger and hijack a later navigation. The home icon and each segment also remain drop targets, exactly as in the listing; a drop refreshes the view itself through `completeEntryDrop`.

The badge (`data-testid="listing-hidden-indicator"`) is a plain `<span>` — **not** a link, not a button, with no handler. Its whole job is the one thing the breadcrumb cannot do: say that this pane holds one file rather than a folder's contents, which is otherwise only inferable from the pane showing a single entry. Styled `text-amber-400 font-bold text-sm` so it reads as a standing status rather than something to click, and `whitespace-nowrap` so "Hidden" never stacks under "Listing" — the header is `flex-wrap` (for narrow panes and deep paths) and the badge is what would otherwise break.

### Hidden While the Editor Is Maximized

The header row is rendered under `{!editorMaximized && ...}` — **both halves go together**, breadcrumb and badge. A maximized editor covers the entire right-hand pane, and neither half of that row is aimed at someone with a cursor in a document: the breadcrumb offers to navigate away mid-edit, and "Listing Hidden" answers a question ("where are my other files?") that an editor is not asking. So the editor gets the pane with nothing above it.

```ts
const editorMaximized = editing && (alwaysExpandedEditor || settings.expandedEditor);
```

That expression deliberately **mirrors the entries' own `maximized`** (`(settings.expandedEditor || alwaysExpandedEditor) && edit.isEditing`, in `MarkdownEntry` and `TextEntry`) rather than assuming the two agree, so they cannot drift. Within `BrowseFile` it is always equal to `editing` — `'browse'` mode forces `alwaysExpandedEditor`, and `'expanded-edit'` mode only exists while `settings.expandedEditor` is on — but writing it out states the actual rule: it is the *maximized* editor that hides the header, not editing as such.

The distinction is worth keeping straight, because there are two editors:

| Editor | Where it renders | Header |
|---|---|---|
| **Inline** — a row in the folder listing, editing in place | `BrowseView` | `BrowseView`'s own header stays; `BrowseFile` is not involved at all |
| **Maximized** — the entry owns the whole pane | `BrowseFile` | hidden for the duration |

Do not simplify the guard to "is anything being edited". The inline editor never reaches this component, and a future non-maximized editor here should keep its header.

Two e2e specs cover it. `private-browse-file.spec.ts` asserts the breadcrumb visible inside `browse-file-breadcrumbs` while reading, the badge present and carrying no button role, then both gone once the editor opens and back after the save; it also exits twice, once through the breadcrumb's own folder segment and once through its home button. `private-expanded-edit.spec.ts` covers the `'expanded-edit'` half specifically: header gone while maximized, and `path-breadcrumb` visible again after collapsing back to the listing **with the edit still open inline** — the assertion that pins "maximized, not editing".

## What `BrowseFile` Renders

- **Header**: `PathBreadcrumb` on the left and the right-aligned, non-interactive **"Listing Hidden"** badge — both shown while reading, both dropped while the editor is maximized. See above. Outside the scroll container.
- **Body**: the same entry-type ternary the listing uses, minus the directory branch — `isMarkdown → isImageFile → isTextFile → GenericEntry`.
- **Omitted props**: index-order move handlers (`onMoveUp`/`onMoveDown`/…) and `documentMode`. `EntryActionBar` renders items purely by callback presence, so omitting them hides those buttons — that is the whole mechanism, no flags needed.
- `ImageEntry` gets `allImages={[entry]}`; that prop only feeds the fullscreen viewer's prev/next, and with one file on screen the file is the whole set.
- **Attachments**: if the file has a sibling `<name>.attach` folder, that folder row and its contents are rendered below the entry using the same `FolderEntry` + `AttachFolderContents` pair `BrowseView` uses (`data-testid="browse-file-attachments"`). They are hidden while editing. For files that fill the pane (text/PDF), the block is height-capped and scrolls independently. See `file_attachments.md` § Single-File Mode.
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
9. Both panes render a breadcrumb, so its presence says nothing about which mode is active — `browseFileName` is the only thing that does. Every breadcrumb segment in `BrowseFile` exits single-file mode, the rightmost one included, and the breadcrumb is the **only** interactive thing in that header: the "Listing Hidden" badge beside it is inert text and must stay that way, or the two start competing to mean the same thing.
10. `BrowseFile`'s header is hidden by `editorMaximized`, never by `editing` alone, and breadcrumb and badge are hidden together. The inline editor in the folder listing keeps `BrowseView`'s header and never renders through `BrowseFile`.

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
| Breadcrumb (rendered by both panes) | `src/components/PathBreadcrumb.tsx` |
| `alwaysExpandedEditor` prop | `src/components/entries/common/types.ts`, `MarkdownEntry.tsx`, `TextEntry.tsx`, `EntryEditToolbar.tsx` |
| e2e coverage — single-file browsing | `tests/e2e/private-browse-file.spec.ts` |
| e2e coverage — expanded editing | `tests/e2e/private-expanded-edit.spec.ts` |
| unit coverage — routing rules | `tests/expandedEditRouting.test.ts` |
