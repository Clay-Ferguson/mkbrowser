# Folder Graph View

## Overview

The Folder Graph is a top-level application tab that visualizes the recursive
folder structure of the currently-browsed directory as an interactive D3
force-directed graph. Folders and files become nodes; parent→child
relationships become edges. Users can drag nodes (with full physics
response), zoom with the mousewheel, pan by dragging the background, and
click any node to navigate to it in the Browse view.

The feature is launched from **Tools → Folder Graph** in the
`ToolsPopupMenu`. Once launched, the resulting tab persists in the tab bar
until the user re-launches the scan (which replaces the data) or quits the
app.

## Files

### New files

- `src/folderGraph.ts` — main-process scanner. Recursively walks a folder
  using `fs.promises.readdir`, producing the `{ nodes, links, truncated }`
  payload for the renderer. Exports two tunables:
  - `MAX_DEPTH = 5` — maximum recursion depth from the root (root = 0).
  - `MAX_NODES = 1000` — hard cap on node count.
  Uses BFS so the truncation point, when reached, is breadth-fair (closer
  nodes win over deeper ones). Honors the same hidden-file +
  `settings.ignoredPaths` exclude semantics as `folderAnalysis.ts`.
- `src/components/views/FolderGraphView.tsx` — the React component that
  renders and drives the D3 simulation. See **Component internals** below.

### Modified files

- `src/store/types.ts` — adds `'folder-graph'` to the `AppView` union, and
  the `FolderGraphNode`, `FolderGraphLink`, `FolderGraphState` interfaces.
  `FolderGraphState` is the shape held in `AppState.folderGraph` (or `null`
  when no graph has been generated).
- `src/store/store.ts` — adds `folderGraph: null` to initial state, plus
  `setFolderGraph()` action and `useFolderGraph()` hook. There is **no**
  layout-persistence action; see **Persistence model** for why.
- `src/store/index.ts` — re-exports the new types/action/hook.
- `src/main.ts` — registers the `scan-folder-tree` IPC handler. The handler
  reads `settings.ignoredPaths` from the app config and delegates to
  `scanFolderTree`.
- `src/preload.ts` — exposes `scanFolderTree(folderPath)` on
  `window.electronAPI` and exports the `FolderGraphScanResult` type.
- `src/global.d.ts` — mirrors the `FolderGraphScanResult` interface and the
  `scanFolderTree` signature on `ElectronAPI`.
- `src/components/menus/ToolsPopupMenu.tsx` — adds the "Folder Graph" menu
  item with `data-testid="menu-folder-graph"` and an `onFolderGraph` prop.
- `src/components/views/BrowseView.tsx` — wires `onFolderGraph` to call
  `window.electronAPI.scanFolderTree(currentPath)`, populates the store via
  `setFolderGraph(...)`, and switches the active view with
  `setCurrentView('folder-graph')`.
- `src/components/AppTabButtons.tsx` — adds the "Folder Graph" tab to
  `allTabs` and surfaces it in `visibleIds` whenever `useFolderGraph()`
  returns a non-null value.
- `src/App.tsx` — the post-loading render uses a single Fragment-returning
  `return` with conditional siblings for each view. The `FolderGraphView`
  wrapper is rendered whenever `folderGraph` is non-null and toggled via
  `style={{ display: currentView === 'folder-graph' ? 'flex' : 'none' }}`.
  This pattern is what makes layout persistence work; see below.

### Dependencies added

`d3-force`, `d3-selection`, `d3-drag`, `d3-zoom` (runtime) and their
`@types/*` packages. The full `d3` umbrella package is **not** used — only
the four submodules we actually need, which keeps the bundle small.

## End-to-end flow

1. User opens **Tools → Folder Graph** in `BrowseView.tsx`.
2. `BrowseView`'s `onFolderGraph` calls `window.electronAPI.scanFolderTree(currentPath)`.
3. Preload forwards via `ipcRenderer.invoke('scan-folder-tree', folderPath)`.
4. `main.ts`'s handler reads `settings.ignoredPaths` and calls
   `scanFolderTree(folderPath, ignoredPaths)`.
5. `folderGraph.ts` does a BFS, returns `{ folderPath, nodes, links, truncated }`.
6. `BrowseView` calls `setFolderGraph(...)` (which triggers
   `useFolderGraph()` subscribers) and `setCurrentView('folder-graph')`.
7. `App.tsx` renders the folder-graph wrapper visible (and the "Folder Graph"
   tab appears in `AppTabButtons` because `folderGraph` is now non-null).
8. `FolderGraphView` builds the simulation in a `useEffect` keyed on
   `[folderGraph, ready]`.

## Component internals (`FolderGraphView.tsx`)

The view owns an `<svg>` via a ref and lets D3 manage everything inside it.
React only re-renders the outer shell (header, container).

### Initialization

A `ResizeObserver` flips a `ready` state flag the first time the container
has non-zero dimensions. The build effect (`useEffect`) gates on `ready` and
non-null `folderGraph`. It re-runs only when `folderGraph` identity changes
(i.e., the user re-launched from the menu) — **not** on container resize.

The effect:

1. Computes `childCount` per parent for sizing folder nodes.
2. Deep-copies `nodes` and `links` into local `simNodes` / `simLinks`. This
   is critical: **`d3-force` mutates its input arrays**, adding `vx`, `vy`,
   etc. and replacing `link.source` / `link.target` strings with node
   references. Copying keeps the store data clean.
3. Clears the SVG and appends a single `zoomLayer` `<g>` that holds both
   the links group and the nodes group. The zoom transform is applied to
   this layer so links and nodes pan/zoom together.
4. Renders one `<line>` per link, one `<g>` per node containing a
   `<circle>`, a native `<title>` (full path tooltip), and a `<text>` label
   (truncated to 24 chars, with a dark `paint-order: stroke` outline so it
   reads against any background).
5. Builds the simulation:
   - `forceLink(...).id(d => d.id).distance(60).strength(0.7)`
   - `forceManyBody().strength(-220)`
   - `forceCenter(width / 2, height / 2)`
   - `forceCollide().radius(d => nodeRadius(d) + 4)`
6. Attaches `d3-zoom` (scale extent `[0.1, 8]`) to the SVG root, applying
   the transform to `zoomLayer`.
7. Attaches `d3-drag` to each node group (see **Drag** below).
8. Registers a one-shot `sim.on('end', zoomToFit)` so the view fits the
   graph in the viewport on first settle. Subsequent settles (e.g., after a
   drag) do not re-zoom — that would be jarring.

### Visual encoding

- Folders use a depth color ramp (cyan → blues → violet → warm) capped at
  the deepest entry.
- Files render as slate-gray circles.
- Folder radius scales with `sqrt(childCount)` (capped) so wide folders
  read as larger nodes.

### Click vs drag

Clicks are not gated manually. `d3-drag`'s `clickDistance(4)` suppresses
the click event when the gesture moved more than 4px. So a static
mousedown→mouseup fires `click`; a real drag does not. The click handler:

- For folders: `navigateToBrowserPath(d.id)` — switches to the Browse view
  on that folder.
- For files: `navigateToBrowserPath(parentFolder, d.id)` — navigates to the
  parent and scrolls the file into view.

### Drag (physics-responsive)

Standard d3-force drag pattern:

- `start`: warm the simulation with `alphaTarget(0.3).restart()`, pin the
  dragged node by setting `d.fx = d.x; d.fy = d.y;`.
- `drag`: update `d.fx / d.fy` to the cursor position.
- `end`: cool the simulation with `alphaTarget(0)` and **release** the
  dragged node (`d.fx = d.fy = undefined`) so the system equilibrates and
  the user feels a physics response.

## Persistence model

> **Why there is no `freezeFolderGraphLayout` or persisted `x`/`y` on
> nodes:** the FolderGraphView is kept mounted across tab switches. Layout
> state (zoom transform, drag positions, simulation alpha) all live in the
> live DOM and on the simulation object — no serialization needed.

This is enforced by the structure of `App.tsx`. After the loading and
welcome-screen early-returns, App returns a single Fragment containing:

- The folder-graph wrapper, conditionally rendered when `folderGraph` is
  non-null, with `display: none` when `currentView !== 'folder-graph'`.
- A separate sibling for each non-graph view, conditionally rendered only
  when its `currentView` matches.

Because the folder-graph wrapper sits at a stable position in the React
tree, switching tabs does **not** unmount it. The SVG, d3-zoom's stored
transform (kept on the SVG node via `__zoom`), and node `fx`/`fy` from
prior drags all persist as live DOM/JS state.

> **Why this matters for D3:** D3 is fundamentally an imperative, DOM-mutating
> library. Letting React unmount/remount the host element forces a full
> rebuild of the simulation and the loss of any drag-pinned positions and
> zoom transform. Mount once, hide via CSS — same strategy that works for
> any D3 + React integration.

The trade-off is one minor wart: when `folderGraph` is non-null and a
different tab is active, `AppTabButtons` is rendered twice (once in the
hidden folder-graph wrapper, once in the visible branch). It's cheap and
harmless; both instances render the same store-driven tab list.

## Adjusting limits

`MAX_DEPTH` and `MAX_NODES` in `src/folderGraph.ts` are the only places to
tune scan limits. When `MAX_NODES` is hit the result has `truncated: true`
and the view shows an amber "truncated — node cap reached" indicator in the
header.

## Re-launching

Clicking **Tools → Folder Graph** again (on any folder) calls
`setFolderGraph(...)` with a fresh object. The `folderGraph` identity in
the store changes, the build effect re-runs, the previous simulation is
torn down (`sim.stop()`, listener removal), and a new one is built. This is
the only path that resets the layout — switching tabs never does.

## Search-based Graph (alternate data source)

The Folder Graph can also be populated from the current **search results**
instead of a recursive folder scan. This produces a tree containing only
the files that matched the search plus the ancestor folders needed to
connect them up to a common root.

### Entry point

A right-justified **Graph View** button in the `SearchResultsView` header
(`src/components/views/SearchResultsView.tsx`). When clicked it:

1. Calls `buildFolderGraphFromSearchResults(searchResults)` to construct a
   `FolderGraphState`.
2. Pushes that state into the store via `setFolderGraph(...)`.
3. Switches the active view with `setCurrentView('folder-graph')`.

The button is disabled when `searchResults` is empty.

### Tree builder

`src/utils/searchTreeBuilder.ts` exports `buildFolderGraphFromSearchResults`,
a pure function with no React or Electron dependencies. The algorithm:

1. Detect path separator (`/` or `\`) from the result paths.
2. Split each result path into segments.
3. Compute the longest common path prefix across all results, capped at
   `length - 1` per path so the common ancestor is always a directory, not
   a file. That prefix becomes the root node id.
4. Walk each path left-to-right. For each accumulated parent path not yet
   in a `Map<string, FolderGraphNode>`, add a directory node and a
   parent→child link. The final segment of each path is added as a
   non-directory (file) leaf.
5. Return `{ folderPath, nodes, links, truncated: false }` — the same
   shape the existing scan-based flow produces.

The Map keyed by full path makes "have I already added this folder?"
checks O(1), avoiding any tree traversal during construction.

### Why this is client-side, not IPC

Search results already contain absolute paths and live in the renderer's
store. Building the tree is pure string manipulation — no filesystem
access is needed (we trust the paths the search returned). So this feature
adds **no new IPC handler** and reuses the existing
`setFolderGraph` / `setCurrentView` actions and the unchanged
`FolderGraphView`. The view does not know or care whether its data came
from a scan or from search results.

### Files

- New: `src/utils/searchTreeBuilder.ts`.
- Modified: `src/components/views/SearchResultsView.tsx` — adds the
  **Graph View** button and the click handler that builds the graph and
  switches views.

No changes to `FolderGraphView.tsx`, `main.ts`, `preload.ts`,
`global.d.ts`, or store types — the produced state matches the existing
`FolderGraphState` shape exactly.

### Edge cases

- Empty results: button disabled.
- Single result: root is the file's parent directory.
- Results with no common prefix (e.g. across drives on Windows): root id
  falls back to `''` with each top-level segment hanging off it. Rare in
  practice — searches are scoped to a folder.

## Testing notes

- Menu item: `data-testid="menu-folder-graph"`.
- Tab button: `data-testid="tab-button-folder-graph"` (provided by
  `AppTabButtons`'s template).
- The simulation's `end` event fires asynchronously when alpha drops below
  `alphaMin` (default `0.001`). E2E tests that need a settled layout should
  wait for it rather than poll on a fixed delay.
