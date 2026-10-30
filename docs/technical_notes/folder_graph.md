# Folder Graph View

## Overview

The Folder Graph is a top-level application tab (labelled **Graph**) that
visualizes the recursive folder structure of a directory as an interactive D3
force-directed graph. Folders and files become nodes; parent→child
relationships become edges. Users can drag nodes (with full physics
response), zoom with the mousewheel, pan by dragging the background, hover a
node for path/containment highlighting and a content preview, and click any
node to open it in the Browse view. An optional **Links** overlay draws an
arrow from each Markdown file to the graph nodes it links to.

There are three ways to populate it:

- **Tools → Graph All** (in the Browse toolbar's Tools menu) — scans every
  file and folder under the folder being browsed.
- **Tools → Graph Markdown** — the same scan restricted to `.md` files and
  the folders that lead to them.
- The **Graph** button in the Search Results header — builds the graph from
  the current search results instead of a folder scan (see
  [Search-based Graph](#search-based-graph-alternate-data-source)).

All three fill the same `folderGraph` store slot; `FolderGraphView` does not
know or care which source produced it. The tab stays in the tab bar until the
user closes it (its close button calls `setFolderGraph(null)`) or replaces the
data by launching another graph.

## Files

### Main process

- `src/main/folderGraph.ts` — the scanner, `scanFolderTree`. Recursively
  walks a folder with `fs.promises.readdir`, producing the
  `{ folderPath, nodes, links, truncated, foldersOnly }` payload for the
  renderer. Exports two tunables:
  - `MAX_DEPTH = 10` — maximum recursion depth from the root (root = 0).
  - `MAX_NODES = 2000` — hard cap on node count (files + folders, including
    the root).
  See [Scan algorithm](#scan-algorithm) below.
- `src/main/folderGraphLinks.ts` — `scanFolderGraphLinks`, the file-to-file
  link scan behind the **Links** toggle. Deliberately separate from the tree
  scan; see [File-to-file links overlay](#file-to-file-links-overlay).
- `src/main.ts` — registers two IPC handlers:
  - `scan-folder-tree` — parses `settings.ignoredPaths` from the app config
    and calls `scanFolderTree(folderPath, ignoredPaths, markdownOnly)`.
    Errors are logged and **re-thrown** so the renderer can show the reason
    (e.g. the node cap was exceeded) rather than an empty graph.
  - `scan-folder-graph-links` — calls `scanFolderGraphLinks(folderPath, nodeIds)`.

### IPC surface

- `src/preload.ts` — exposes `scanFolderTree(folderPath, markdownOnly?)` and
  `scanFolderGraphLinks(folderPath, nodeIds)`.
- `src/shared/shared.ts` — the `FolderGraphScanResult` interface and both
  method signatures on `ElectronAPI`.

### Renderer

- `src/renderer/folderToolsOp.ts` — `showFolderGraph(folderPath, markdownOnly)`
  runs the scan, stores the result, and switches to the graph tab;
  `loadFolderGraphFileLinks(graph)` runs the link scan. Both go through
  `runOp`, so failures surface in the app-wide error dialog.
- `src/components/views/FolderGraphView.tsx` — the React component that
  renders the SVG and drives D3. See
  [Component internals](#component-internals-foldergraphviewtsx).
- `src/components/views/graphSim.ts` — the force model (`buildSimulation`,
  `seedRadialPositions`, `nodeRadius`, the physics constants) and the
  worker message types. Has no DOM, React, or d3-selection dependency, so the
  same code runs on the main thread and in the worker.
- `src/components/views/graphSimWorker.ts` — Web Worker that computes the
  initial layout off the UI thread.
- `src/components/views/forceLabelRect.ts` — custom rectangular collision
  force over each node's circle + label footprint.
- `src/components/views/forceCrossGroupRepel.ts` — custom supplementary
  repulsion force between nodes of different "repulsion groups".
- `src/shared/searchTreeBuilder.ts` — `buildFolderGraphFromSearchResults`,
  the search-results data source.
- `src/components/menus/ToolsPopupMenu.tsx` — the **Graph All**
  (`menu-folder-graph`) and **Graph Markdown** (`menu-markdown-graph`) items,
  via the `onFolderGraph` / `onMarkdownGraph` props.
- `src/components/views/BrowseToolbar.tsx` — wires those props to
  `showFolderGraph(currentPath)` and `showFolderGraph(currentPath, true)`.
- `src/components/views/SearchResultsView.tsx` — the **Graph** button.
- `src/components/AppTabButtons.tsx` — the `folder-graph` entry in `allTabs`
  (label "Graph"), shown whenever `folderGraph` is non-null; its close handler
  clears `folderGraph` and falls back to Browse if the graph tab was active.
- `src/App.tsx` — mounts the `view-folder-graph` wrapper whenever
  `folderGraph` is non-null. See [Persistence model](#persistence-model).

### Store and types

- `src/shared/types.ts` — `'folder-graph'` in the `AppView` union; the
  `FolderGraphNode`, `FolderGraphLink`, and `FolderGraphState` interfaces;
  and three `AppState` fields:
  - `folderGraph: FolderGraphState | null` — the graph data.
  - `folderGraphFileLinks: FolderGraphLink[] | null` — the Links overlay's
    edges for the current graph (null = not scanned yet).
  - `showGraphFileLinks: boolean` — the Links toggle (session only, off by
    default).
- `src/store/core.ts` — initial values (`null`, `null`, `false`).
- `src/store/view.ts` — `setFolderGraph`, `setFolderGraphFileLinks`,
  `setShowGraphFileLinks`. `setFolderGraph` also resets
  `folderGraphFileLinks` to `null` in the same update, since those edges
  belong to the old graph. There is **no** layout-persistence action; see
  [Persistence model](#persistence-model).

Components read these with direct selectors (`useAS(s => s.folderGraph)`);
there is no `useFolderGraph()` wrapper hook.

### Dependencies

`d3-force`, `d3-selection`, `d3-drag`, `d3-zoom`, and `d3-quadtree` (used by
the two custom forces), with their `@types/*` packages. They are in
`devDependencies`, because the renderer bundle inlines them. `d3-transition`
is imported for its side effect (it adds `.transition()` to selections, used
by the animated zoom-to-fit) and arrives transitively through `d3-zoom`. Our
code never imports the `d3` umbrella package.

## End-to-end flow (folder scan)

1. User picks **Tools → Graph All** or **Graph Markdown** in the Browse toolbar.
2. `BrowseToolbar` calls `showFolderGraph(currentPath, markdownOnly)`.
3. `showFolderGraph` bumps a module-level `latestGraphId` and calls
   `api.scanFolderTree(folderPath, markdownOnly)`.
4. Preload forwards via `ipcRenderer.invoke('scan-folder-tree', ...)`.
5. The `main.ts` handler reads `settings.ignoredPaths` and calls
   `scanFolderTree(...)`, which returns the result or throws.
6. Back in `showFolderGraph`, the result is dropped if a newer graph scan was
   started in the meantime (so a slow scan of a big folder can't overwrite a
   newer one). Otherwise it calls `setFolderGraph(...)` and
   `setCurrentView('folder-graph')`. A thrown error reaches the error dialog
   as "Failed to scan folder graph: …".
7. `App.tsx` mounts the graph wrapper, and the Graph tab appears in
   `AppTabButtons` because `folderGraph` is now non-null.
8. `FolderGraphView`'s build effect, keyed on `[folderGraph, ready]`, renders
   the SVG and starts the layout worker.

## Scan algorithm

`scanFolderTree` **never returns a partial graph**. It tries up to two scans:

1. A full scan (folders + files). If it fits within `MAX_NODES`, that's the
   result.
2. Otherwise a folders-only scan, returned with `foldersOnly: true`.
3. If even that exceeds `MAX_NODES`, it throws ("exceeds the 2000-node limit
   even with files excluded").

So the user gets everything if it fits, otherwise a complete folders-only
graph, otherwise an error. A consequence is that a successful scan always has
`truncated: false`; the field (and the view's "truncated" indicator) only
records what the internal pass saw.

Each pass (`scanFolderTreeInternal`):

- Is an iterative BFS from the root, so if the cap is hit the cut-off is
  breadth-fair (closer nodes win over deeper ones). Folders at `MAX_DEPTH`
  are added as nodes but not descended into.
- Sorts each directory's entries folders-first, then by name
  (case-insensitive), so results are deterministic.
- Excludes entries with `buildExcludePredicate(ignoredPaths)` from
  `src/shared/pathPattern.ts`: hidden (dot) entries always, plus anything
  matching the user's ignore patterns against either the basename or the full
  path. This is the same predicate the other folder crawlers share.
- Skips unreadable directories silently.

With `markdownOnly`:

- Only `.md` files (per `isMarkdownFile`) become file nodes.
- Every folder on the way from a Markdown file up to the root is marked as
  holding Markdown. After the scan, folders without Markdown beneath them are
  pruned (the root is always kept), along with their links.
- Only nodes that will survive pruning count toward `MAX_NODES`, so empty
  folders don't use up the budget.

## Component internals (`FolderGraphView.tsx`)

The view owns an `<svg>` via a ref and lets D3 manage everything inside it.
React only renders the outer shell: the header and the container, plus a wait
spinner while the layout is computed.

### Initialization

A `ResizeObserver` flips a `ready` state flag the first time the container
has non-zero dimensions. The build effect gates on `ready` and a non-null
`folderGraph`. It re-runs only when `folderGraph` identity changes (a new
graph was launched), **not** on container resize; resizes are handled by
re-framing the existing graph (see [Resize](#resize)).

The effect:

1. Computes `childCount` per parent (folder radius scales with it).
2. Copies `nodes` and `links` into local `simNodes` / `simLinks`.
   **`d3-force` mutates its inputs** (adding `x`, `y`, `vx`, `vy`, and
   replacing link `source` / `target` strings with node references), so
   copying keeps the store data clean. Each node also gets a
   `crossRepelGroup`: the parent folder path for a file, the folder's own
   path for a folder.
3. Builds lookup maps for hover highlighting: each folder's direct children,
   and each node's parent.
4. Clears the SVG and appends a single `zoom-layer` `<g>`, which holds, in
   order: the containment links group (`<line>`s), the file-links group
   (empty until the Links overlay is drawn), and the nodes group. The zoom
   transform is applied to this layer so everything pans and zooms together.
   An arrowhead `<marker>` for file links goes in `<defs>`.
5. Renders one `<g>` per node containing a `<circle>`, a native `<title>`
   tooltip (the node's path relative to the graph root), and a `<text>` label
   (the full name, with a dark `paint-order: stroke` outline so it reads
   against anything behind it).
6. If `USE_LABEL_PHYSICS` is on (it is), measures every label with `getBBox()`
   (`measureLabelFootprint`) and stores the circle + label footprint box on
   the node as `bx0`/`by0`/`bx1`/`by1`. This is the only part of the force
   model that needs a DOM, which is why it happens here and not in the worker.
7. Attaches click, hover, and zoom handlers (below). `d3-zoom` (scale extent
   `[0.1, 8]`) is attached to the SVG root.
8. Shows the spinner, creates the layout worker, and posts it a
   `SettleRequest` (see [Layout worker](#layout-worker)).

### Layout worker

The initial layout ("settle") runs in `graphSimWorker.ts`, a module Web
Worker created per graph build with
`new Worker(new URL('./graphSimWorker.ts', import.meta.url), { type: 'module' })`.
This keeps the UI thread free (the spinner keeps animating) for graphs of up
to 2000 nodes.

- **Request:** the node fields the physics needs (explicitly picked, so the
  main thread's hover-preview cache is never cloned across), fresh
  string-endpoint links, and the container's width and height.
- **In the worker:** `seedRadialPositions` places the nodes in a radial tree
  (root at the center, each depth one ring further out, each subtree given an
  angular sector sized by its node count). This starts the layout near its
  equilibrium and avoids d3's packed default start, which made convergence
  slow. Then `buildSimulation` builds the force model and the worker calls
  `sim.tick()` in a plain loop for `settleTickCount(sim)` ticks, the same
  number d3's own timer would run to take alpha from 1 to `alphaMin`.
- **Response:** a `Float64Array` of `[x, y, vx, vy]` per node, sent as a
  transferable buffer.

When the response arrives, the view:

1. Copies the positions onto `simNodes` (`applySettledPositions`).
2. Rebuilds the same force model on the main thread over those positions and
   sets its alpha to 0, so it stays still until a drag wakes it.
3. Syncs the DOM to the positions and subscribes `tick` for later drags.
4. Attaches `d3-drag` to the nodes. Nothing is draggable during the settle.
5. Hides the spinner and calls `zoomToFit(true)`: a 600 ms animated
   transition that fits the graph's bounding box in the container with 60 px
   padding, at a scale of at most 2.

If the worker fails to start (e.g. a bundling or CSP regression), the error is
logged and the spinner is removed, revealing the unsettled graph. This is
deliberate: there is no main-thread fallback that would hide the problem.

While the settle runs, the SVG is hidden with `visibility: hidden` (the
`invisible` class), not `display: none`, because label measurement needs
layout.

### Force model (`graphSim.ts`)

`buildSimulation` returns a **stopped** simulation; the worker ticks it
manually and the main thread only restarts it for drags. The forces:

- `link` — `forceLink` with strength 0.7 and a rest length of 130
  (`LINK_DISTANCE_FOLDER`) for folder→subfolder links, 60
  (`LINK_DISTANCE_FILE`) for folder→file links. Files hug their parent while
  folder hubs keep some distance from each other.
- `charge` — `forceManyBody`, strength −220, capped at 180 px
  (`CHARGE_DISTANCE_MAX`). Without the cap, the summed repulsion between
  distant subtrees stretches the links that join them far past their rest
  length.
- `hubRepel` — long-range `forceManyBody` emitted only by folders (files have
  strength 0): −200 − 40 × childCount, no stronger than −2200, out to 1500 px.
  This separates subtrees into distinct clumps once the graph is wider than
  the charge range.
- `crossRepel` — `forceCrossGroupRepel`, extra repulsion between nodes with
  different `crossRepelGroup`s, capped at the charge range: 440 for files in
  different folders, 500 for a file and a folder that isn't its parent, 0 for
  folder pairs (`hubRepel` handles those). A file and its own parent share a
  group and are exempt.
- `center` — `forceCenter` at the container's center. Kept as a separate
  handle so a resize can retarget it.
- `collide` — `forceLabelRect` (strength 0.7, 3 iterations), rectangular
  collision over each node's circle + label footprint, so labels never
  overlap. Setting `USE_LABEL_PHYSICS` to `false` reverts to plain
  `forceCollide` with radius `nodeRadius + 4`.

Each extra force has a `USE_*` boolean constant to switch it off.

### Visual encoding

- Root: bright red (`#ef4444`).
- Folders: orange (`#fb923c`).
- Markdown files (`.md` / `.markdown`): blue (`#60a5fa`).
- Other files: light gray (`#cbd5e1`).
- The highlighted item (`highlightItem` in the store): purple
  (`#a855f7`) with a bold label.
- Radius: 5 px for files; folders get 5 + √childCount, adding at most 10 px.
- Containment links: slate (`#475569`) at 0.7 opacity.

### Hover

- **Highlighting.** Hovering any node paints the path from it up to the root
  red: the links, and the labels of the node and each ancestor, in bold.
  Hovering a folder also paints its direct children and the links to them
  green. If the Links overlay is on, the hovered node's own file links (in
  and out) go to full opacity and all others dim. Leaving the node clears
  the highlighting.
- **Content preview.** Hovering a `.md` or `.txt` file swaps its `<title>`
  tooltip from the relative path to a preview: the file name, an underline,
  and the first five non-blank body lines (front matter removed, at most 500
  characters, with `…` when there is more). The preview is cached on the node
  together with the file's mtime and regenerated only when the file has
  changed. On a read error, the path tooltip stays.

### Click vs drag

Clicks are not gated manually. `d3-drag`'s `clickDistance(4)` suppresses the
click event when the gesture moved more than 4 px, so a static
mousedown→mouseup fires `click` and a real drag does not. The click handler
first calls `setHighlightItem(d.id)` and repaints the node purple right away,
so the highlight is already there when the user comes back to the tab. Then:

- For folders: `navigateToBrowserPath(d.id)` switches to the Browse view on
  that folder.
- For files: `setBrowseFile(parentFolder, fileName)` opens the file on its own
  in single-file mode, as the index tree and search results do (see
  `single_file_browsing.md`).

A separate effect repaints the highlight whenever `highlightItem` changes
elsewhere in the app, without rebuilding the graph.

### Drag (physics-responsive)

The standard d3-force drag pattern, run on the main-thread simulation:

- `start`: warm the simulation with `alphaTarget(0.3).restart()` and pin the
  dragged node (`d.fx = d.x; d.fy = d.y`).
- `drag`: move `d.fx` / `d.fy` to the cursor.
- `end`: cool with `alphaTarget(0)` and **release** the node
  (`d.fx = d.fy = undefined`) so the graph settles around it and the user
  sees the physics respond.

### Resize

The `ResizeObserver` calls `handleContainerResize` (through a ref written by
the build effect). It retargets the center force and, unless the user has
zoomed or panned by hand, re-fits the graph instantly with
`zoomToFit(false)`. A manual zoom or pan (a zoom event with a `sourceEvent`)
makes the viewport the user's, and later resizes leave their transform alone.
The simulation is **not** restarted on resize, since that would make nodes
drift on every resize step. During the settle there is no simulation to
retarget and no fit is done; the settle's own `zoomToFit` reads the container
size when it runs, so the finished layout is still framed correctly.

### Cleanup

The build effect's cleanup terminates the worker, interrupts any running
zoom transition, stops the main-thread simulation, removes the tick and zoom
listeners, and clears the refs the other effects use (`applyHighlightRef`,
`resizeGraphRef`, `drawFileLinksRef`).

### Header

The header shows the graph's root path; a "Folders Only, too many files" badge
when `foldersOnly` is set; the node count (split into folders and files) and
link count; the file-link count, or "scanning file links…", while the Links
toggle is on; an amber "truncated — node cap reached" note if `truncated` is
set; a short usage hint; and the **Links** checkbox
(`folder-graph-file-links-toggle`).

## File-to-file links overlay

The **Links** checkbox draws hot-pink (`#FF69B4`) curved arrows from each
Markdown file to every graph node (file or folder) it links to. The arrows
are drawn only; they play no part in the force layout, so turning them on or
off never re-runs the layout.

- **Lazy scan.** The overlay is off by default and costs no file reads until
  turned on. A separate effect, keyed on
  `[folderGraph, ready, showGraphFileLinks, folderGraphFileLinks]`, calls
  `loadFolderGraphFileLinks(folderGraph)` when the toggle is on and the edges
  haven't been loaded. Once they're in the store, it draws them through
  `drawFileLinksRef`. Turning the toggle off just removes the arcs; the edges
  stay cached until `setFolderGraph` replaces the graph. A result that lands
  after the graph was replaced is dropped.
- **Folders-only graphs** have no file nodes, so the checkbox is disabled.
- **Main-process scan (`scanFolderGraphLinks`).** The renderer sends the
  graph's root and node ids, so no directory is walked again. Only Markdown
  ids under the root are read, up to 32 at a time, and files over 5 MB are
  skipped. Links are found with `extractLinkDestinations` and resolved the
  same way a click in the app resolves them: relative to the linking file,
  percent-decoded, with a `#heading` fragment ignored. A wikilink without an
  extension that doesn't match a node also tries `<target>.md`. Self-links and
  links to anything outside the graph are dropped, and duplicate pairs are
  collapsed.
- **Drawing.** Each link is a quadratic arc that always bends to the left of
  its direction, so two files linking to each other show two separate arcs.
  The end is pulled back to the target circle's edge so the arrowhead sits on
  the circle. Opacity is 0.6 at rest (see [Hover](#hover) for the hover
  change). The arcs are redrawn on every tick, so they follow dragged nodes.

## Persistence model

> **Why there is no frozen layout or persisted `x`/`y` on nodes:** the
> FolderGraphView stays mounted across tab switches. Layout state (zoom
> transform, node positions, simulation) lives in the live DOM and on the
> simulation object, so nothing needs to be saved.

This follows from how `App.tsx` renders views (see DEVELOPER_GUIDE.md §
"Views Never Unmount"). A view is mounted on its first visit and then kept,
with only its `display` style switching between `flex` and `none`. The graph
wrapper (`data-testid="view-folder-graph"`) is mounted whenever `folderGraph`
is non-null. `AppTabButtons` is rendered once, above all the view wrappers.

Because the graph wrapper stays mounted, switching tabs does **not** unmount
it. The SVG, d3-zoom's stored transform (kept on the SVG node as `__zoom`),
and the node positions all survive. A dragged node is released when the drag
ends, so what persists is the layout the graph settled into afterward.

> **Why this matters for D3:** D3 is an imperative, DOM-mutating library.
> Letting React unmount and remount the host element would force a full
> rebuild of the simulation and lose the layout and zoom. Mount once and hide
> with CSS. This is also why the app must not move to React's `<Activity>`,
> which runs effect cleanups on hide and would tear the graph down.

Closing the Graph tab sets `folderGraph` to `null`, which unmounts the
wrapper; the next graph starts fresh.

## Re-launching

Launching a graph again (from either Tools item, on any folder, or from
search results) calls `setFolderGraph(...)` with a new object. The
`folderGraph` identity changes, so the build effect's cleanup tears down the
old graph (worker, simulation, listeners) and a new one is built with a new
worker settle. Launching a new graph is the only way to reset the layout;
switching tabs never does.

## Search-based Graph (alternate data source)

The Folder Graph can also be built from the current **search results**
instead of a folder scan. The resulting tree contains only the matching
items plus the ancestor folders needed to connect them to a common root.

### Entry point

A **Graph** button in the `SearchResultsView` header
(`src/components/views/SearchResultsView.tsx`). Its `handleShowGraph`:

1. Does nothing if there are no results.
2. Calls `buildFolderGraphFromSearchResults(searchResults)` to build a
   `FolderGraphState`.
3. Stores it with `setFolderGraph(...)`.
4. Switches to the tab with `setCurrentView('folder-graph')`.

The button is disabled when `searchResults` is empty. Its `data-testid` is
`search-graph-view-button`.

A sibling **Calendar** button (`search-calendar-view-button`) sits right
after it and does the same for a different view: it opens the Calendar tab
with the search results that are calendar files. Unlike Graph, it isn't
purely client-side; deciding which results qualify means re-reading their
front matter, so it goes through IPC. See `calendar_view.md` § Event Sources.

### Tree builder

`src/shared/searchTreeBuilder.ts` exports `buildFolderGraphFromSearchResults`,
a pure function with no React or Electron dependencies. The algorithm:

1. Detect the path separator: `\` if any result path uses only backslashes,
   otherwise `/`.
2. Split each result path into segments (keeping a leading `/` as the first
   segment of a POSIX path).
3. Compute the longest common path prefix across all results, limited so it
   never includes a path's last segment. The common ancestor is therefore
   always a directory, and that prefix becomes the root node id.
4. Walk each path from left to right. Each accumulated path not yet in a
   `Map<string, FolderGraphNode>` is added as a node, with a parent→child
   link. Every segment except the last is a directory. The last is a file
   leaf, unless the result itself is a folder (`isDirectory`, as from a File
   Names search), in which case it is drawn as a folder.
5. Return `{ folderPath, nodes, links, truncated: false, foldersOnly: false }`,
   the same shape the folder scan produces.

The Map keyed by full path makes the "have I already added this folder?"
check O(1), so no tree traversal is needed during construction.

### Why this is client-side, not IPC

Search results already hold absolute paths and live in the renderer's store.
Building the tree is pure string manipulation; no filesystem access is needed
(we trust the paths the search returned). So this source has **no IPC
handler** and reuses `setFolderGraph` / `setCurrentView` and
`FolderGraphView` unchanged. Hover previews and the Links overlay work the
same as for a scanned graph, since they only need node ids.

### Edge cases

- Empty results: button disabled.
- Single file result: the root is the file's parent directory.
- Results with no common prefix (e.g. on different drives on Windows): the
  root id is `''`, named `/`, and each top-level segment hangs off it. Rare in
  practice, since searches are scoped to a folder. The Links overlay won't
  find any sources in this case, because it only reads files under the root
  path.

## Adjusting limits and physics

- **Scan limits:** `MAX_DEPTH` and `MAX_NODES` in `src/main/folderGraph.ts`.
  Raising `MAX_NODES` also raises the layout cost (the settle runs in the
  worker, but the main thread still renders every node and measures every
  label).
- **Link scan:** `LINK_SCAN_CONCURRENCY` and `MAX_LINK_SCAN_FILE_BYTES` in
  `src/main/folderGraphLinks.ts`.
- **Physics:** the constants at the top of `src/components/views/graphSim.ts`
  (link distances, charge, hub and cross-group repulsion, label collision,
  and the `USE_*` switches).
- **Colors and file-link styling:** the constants at the top of
  `FolderGraphView.tsx`.

## Testing notes

- Menu items: `data-testid="menu-folder-graph"` (Graph All) and
  `menu-markdown-graph` (Graph Markdown).
- Tab button: `tab-button-folder-graph`; close button: `tab-close-folder-graph`
  (both from `AppTabButtons`'s template).
- View wrapper: `view-folder-graph`, which has `data-active-view="true"` while
  the tab is shown.
- Links toggle: `folder-graph-file-links-toggle`.
- Search results button: `search-graph-view-button`.
- The layout is finished when the "Laying out N nodes…" spinner disappears
  and the SVG loses its `invisible` class; the 600 ms zoom-to-fit animation
  starts at that moment. There is no simulation `end` event to wait for (the
  settle runs in a worker), so e2e tests should wait on the spinner instead
  of a fixed delay.
- Unit tests: `tests/searchTreeBuilder.test.ts`,
  `tests/folderGraphLinks.test.ts`, and `tests/forceCrossGroupRepel.test.ts`.
