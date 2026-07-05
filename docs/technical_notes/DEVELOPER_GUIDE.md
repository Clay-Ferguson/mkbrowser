# MkBrowser is an Electron App

<!-- TOC -->
* [Overview](#overview)
* [React State Management](#react-state-management)
  * [How does this application handle global state?](#how-does-this-application-handle-global-state)
  * [Why Zustand (and how we got here)](#why-zustand-and-how-we-got-here)
  * [The store core (`src/store/core.ts`)](#the-store-core-srcstorecorets)
  * [The immutability contract](#the-immutability-contract)
  * [The slice architecture](#the-slice-architecture)
    * [Anatomy of a slice](#anatomy-of-a-slice)
  * [Reading state](#reading-state)
    * [Reactive reads — selectors (inside render)](#reactive-reads--selectors-inside-render)
    * [Non-reactive reads — `getState()` and getters (outside render)](#non-reactive-reads--getstate-and-getters-outside-render)
    * [Selector identity and `useShallow`](#selector-identity-and-useshallow)
  * [Writing state — actions](#writing-state--actions)
    * [No-op guards](#no-op-guards)
    * [Batching multiple fields in one update](#batching-multiple-fields-in-one-update)
  * [The items Map — a deeper look](#the-items-map--a-deeper-look)
  * [Non-reactive, module-level stores](#non-reactive-module-level-stores)
  * [Persistence and the IPC boundary](#persistence-and-the-ipc-boundary)
    * [Main process is the source of truth (`src/main/configMgr.ts`)](#main-process-is-the-source-of-truth-srcmainconfigmgrts)
    * [Re-hydration at startup (`src/renderer/config.ts`)](#re-hydration-at-startup-srcrendererconfigts)
    * [Persisting store changes back to config](#persisting-store-changes-back-to-config)
    * [Session-only (never persisted) state](#session-only-never-persisted-state)
  * [The store's relationship to the wider app](#the-stores-relationship-to-the-wider-app)
  * [Adding a new piece of state — checklist](#adding-a-new-piece-of-state--checklist)
  * [Rules of thumb (the short list)](#rules-of-thumb-the-short-list)
  * [Local AI Model Inference Troubleshooting](#local-ai-model-inference-troubleshooting)
* [React Compiler](#react-compiler)
  * [The coding standard (the short list)](#the-coding-standard-the-short-list)
  * [What a "bailout" is and why we care](#what-a-bailout-is-and-why-we-care)
  * [Known bailout causes and their fixes](#known-bailout-causes-and-their-fixes)
  * [The exhaustive-deps escape patterns](#the-exhaustive-deps-escape-patterns)
  * [Guard layer 1 — ESLint](#guard-layer-1--eslint)
  * [Guard layer 2 — `compiler-coverage.mjs` (the source of truth)](#guard-layer-2--compiler-coveragemjs-the-source-of-truth)
<!-- /TOC -->

## Overview

In Electron, your app runs in **two separate processes** that can't directly call each other's code:

1. **Main process** (`main.ts`) — runs Node.js, has full OS access (file system, native dialogs, menus, etc.)
2. **Renderer process** (`App.tsx`) — runs in a Chromium browser window, no Node.js access (for security)

**IPC (Inter-Process Communication)** is the message-passing bridge between them. It works like a client-server HTTP API, but over Electron's internal channel instead of a network:

| Concept | Web analogy | Electron equivalent |
|---------|-------------|---------------------|
| Define an endpoint | `app.get('/api/files', handler)` | `ipcMain.handle('read-file', handler)` |
| Call the endpoint | `fetch('/api/files')` | `ipcRenderer.invoke('read-file', path)` |
| Return data | `res.json(data)` | `return data` from the handler |

The `ipcMain.handle(channel, handler)` pattern you see ~40 times in your `main.ts` is the **request/response** pattern — the renderer `await`s a result. There's also a **push** pattern (`webContents.send` / `ipcRenderer.on`) used for events like the streaming AI chunks.

The **preload script** (`preload.ts`) sits in between as a security boundary. It selectively exposes specific IPC calls to the renderer via `contextBridge.exposeInMainWorld`, so the renderer only sees `window.electronAPI.readFile(path)` — never raw `ipcRenderer` access. That's why your AGENTS.md describes the "three-file sync" requirement: every new capability needs a handler in `main.ts`, a bridge method in `preload.ts`, and a type in `global.d.ts`.

For your refactoring: each `ipcMain.handle(...)` is essentially an independent route handler. You can freely extract them into separate modules (e.g., `ipc/fileHandlers.ts`, `ipc/aiHandlers.ts`) and just import + register them in `main.ts`, the same way you'd split a monolithic Express `app.js` into route files.

## React State Management

### How does this application handle global state?

MkBrowser keeps all of its shared, application-wide state in a **single [Zustand](https://zustand.docs.pmnd.rs/) store** (Zustand v5) that lives under `src/store/`. There is exactly one store — `useAS`, created in `src/store/core.ts` — holding one `AppState` object plus all of the store's **actions**, composed from cohesive slice files using Zustand's documented [slices pattern](https://zustand.docs.pmnd.rs/guides/slices-pattern). Components **read** with direct selectors (`useAS(s => s.currentPath)`) that subscribe them to exactly the value they use, and they **write** through actions — functions defined *inside* the store alongside the state they mutate, also exported from the slice files as plain functions (`upsertItems`, `setCurrentPath`, `toggleBookmark`, `setAiConfig`, …) so non-React code can call them. Every action produces a *new* immutable copy of whatever slice of state it touches; Zustand notifies subscribers and React re-renders exactly the components whose selected values changed.

Because the store is a module-level singleton, any code in the renderer — React component, hook, plain utility function, or an async IPC callback — can import an action from the store barrel (`src/store/index.ts`) and call it. There is no provider to wrap the app in, no `dispatch`, no reducers, no action-type constants, and no context threading. State that must survive across app restarts (settings, the current subfolder, AI configuration, etc.) is **not** stored in the browser; it is persisted by the Electron *main* process to a YAML config file and re-hydrated into the store at startup. The renderer store is therefore best understood as the live, in-memory, reactive picture of the app, and the main-process config manager (`src/main/configMgr.ts`) is the durable source of truth for the subset of that state which is persistent.

The rest of this section explains the moving parts: the store core, how the store is split into slices, the read and write patterns (and the selector-identity rules that make them efficient), the special-case non-reactive stores, how state is persisted and re-hydrated across the IPC boundary, and a checklist for adding new state.

### Why Zustand (and how we got here)

The store began life as a hand-rolled mini-Zustand: a module-scope `AppState` object, a listener `Set`, a shallow-merging `setState(patch)`, and a selector hook built on React's `useSyncExternalStore`. Since that was architecturally identical to Zustand, we migrated to the real library and got the same design with less code to maintain, plus Zustand's ecosystem (`useShallow` for derived selectors, optional devtools/persist middleware later). The properties that motivated the custom store still hold:

- **Built on `useSyncExternalStore` under the hood** — the officially-blessed React 18/19 primitive for subscribing components to an external store without tearing (inconsistent reads across a render). Zustand wraps it for us.
- **No Context re-render cascades.** A single React Context holding the whole app state would re-render *every* consumer on *any* change. Per-selector subscriptions mean a component that only reads `settings.fontSize` is not disturbed when, say, a search result arrives.
- **Callable from anywhere.** Actions are reachable as plain functions on a module singleton (`useAS.getState().someAction(...)`, or the slice files' exported wrappers), so non-React code (utilities, async IPC handlers, menu-event listeners) mutates state the same way components do — no hooks-only restriction.
- **Trivial to unit test.** Slices are plain modules; a test can call an action and assert via `getState()` with no React renderer involved.

### The store core (`src/store/core.ts`)

`core.ts` defines the store and the shared types every slice builds on. Slice files import these; application code generally does not (it uses the actions and selectors described below).

- **`StoreState`** — the full store type: `AppState & ImageSlice & AiConfigSlice & SearchSlice & ...` — i.e. the plain state fields plus the action interfaces contributed by every slice. (`AppState` itself is defined in `src/shared/types.ts`.)
- **`StoreSet`** / **`StoreGet`** — the `set`/`get` signatures handed to slice creators. `set` takes a `Partial<StoreState>` patch and **shallow-merges** it (Zustand's default): it produces a brand-new top-level state object and notifies subscribers. Slices only ever patch state fields, never actions.
- **`useAS`** — the store itself, created as:

  ```ts
  export const useAS = create<StoreState>()((set, get) => ({
    ...initialState,
    ...createImageSlice(set),
    ...createAiConfigSlice(set, get),
    ...createSearchSlice(set),
    // ...one creator per slice; items last (largest)
  }));
  ```

  `initialState` (also in `core.ts`) is a fully-populated `AppState` defining every field the app tracks and its initial value (`items: new Map()`, `currentPath: ''`, `currentView: 'browser'`, `settings: defaultSettings`, `aiConfig: defaultAiConfig`, and so on).
- **`getState()`** — a thin wrapper over `useAS.getState()`: returns the current `StoreState` *non-reactively*. Use it to read state outside of render (in an event handler, an async callback, or another action) without subscribing — and to reach the actions from imperative code (`getState().setCurrentPath(...)`).

There is deliberately **no free-form `setState`** exported anymore: all mutations go through the actions the slices define inside the store.

Two defaults also live here so the core owns its own initial values without importing a slice: **`defaultSettings`** (the initial `AppSettings`) and **`defaultAiConfig`** (the initial `AiConfigState`). They are re-exported from their respective slices (`settings.ts`, `aiConfig.ts`) for convenience.

### The immutability contract

Zustand's `set` only replaces the *top-level* state object (shallow merge). It does **not** deep-clone. So the golden rule for every action is: **never mutate a nested object, array, `Map`, or `Set` in place — build a new one.** For example, the `upsertItems` action does `const newItems = new Map(get().items)`, mutates the *copy*, then `set({ items: newItems })`. If it mutated the existing Map in place, the selector-identity check (`Object.is(prev, next)`) that Zustand runs for every subscribed component would see the same Map reference and skip the re-render — the UI would silently go stale. This new-object-on-every-change discipline is what makes the whole reactive system work, and it is also what makes referential-identity selection (below) possible.

### The slice architecture

`StoreState` is one big type, but the *code* that mutates and reads it is split into cohesive **slices** under `src/store/`, each a plain module that owns a related group of fields and contributes its actions to the single store:

| Slice file | Responsibility |
|------------|----------------|
| `core.ts` | The store itself (`useAS`), `getState`, the `StoreState`/`StoreSet`/`StoreGet` types, plus `initialState`, `defaultSettings`, `defaultAiConfig`. Composes every slice. |
| `items.ts` | The `items` `Map<path, ItemData>` — the file/folder listing and all per-item flags (selected, cut, expanded, editing, renaming, cached content, tags, props). The largest slice. |
| `view.ts` | View/navigation state: `currentView`, `currentPath`, `rootPath`, `visibleTabs`, pending scroll/edit signals, folder analysis/graph, the directory-refresh nonce, expanded-editor flag. |
| `settings.ts` | The persisted `AppSettings` (font size, sort order, content width, bookmarks, ignored paths, index-tree width, etc.) and all bookmark operations. |
| `search.ts` | Search results, the query/folder/name they came from, sort options, and the persistent result highlight. |
| `aiConfig.ts` | The renderer-side reactive *mirror* of the main process's AI configuration (see persistence, below). |
| `calendar.ts` | Calendar events, loading flag, active/target folder, view type (month/week/day), and the centered date. |
| `indexTree.ts` | The hierarchical `.INDEX.yaml` navigation tree (`indexTreeRoot`) and its expand/collapse/reveal operations. |
| `image.ts` | Inline image display size and its CSS-transition flag. |
| `scroll.ts` | Browser-view scroll positions per folder — a **non-reactive** module-level store (see below), not part of the Zustand store. |
| `index.ts` | The **barrel**: re-exports `useAS` and every slice's actions, getters, and helpers, plus the shared store types. This is the single public import surface for the rest of the app. |

**Always import from the barrel**, e.g. `import { useAS, upsertItems, setCurrentPath } from '../../store'`. Components should not reach into individual slice files. The barrel also re-exports the store *type* interfaces (`AppState`, `AppSettings`, `AiConfigState`, `ItemData`, `TreeNode`, `FileNode`, etc.), all of which are actually declared in `src/shared/types.ts` and simply passed through `index.ts`.

#### Anatomy of a slice

Every reactive slice follows the same shape (see `image.ts` for the smallest complete example):

```ts
// 1. The actions this slice contributes to the store
export interface ImageSlice {
  setImageSize: (size: ImageSize) => void;
  setImageSizeTransitioning: (value: boolean) => void;
  setImageSizeWithTransition: (size: ImageSize) => void;
}

// 2. The slice creator, called by core.ts inside create().
//    A *function declaration* (not a const arrow) so it is hoisted and safe
//    under the core ↔ slice import cycle regardless of module load order.
export function createImageSlice(set: StoreSet): ImageSlice {
  return {
    setImageSize: (size) => set({ imageSize: size }),
    setImageSizeTransitioning: (value) => set({ imageSizeTransitioning: value }),
    setImageSizeWithTransition: (size) =>
      set({ imageSize: size, imageSizeTransitioning: true }),
  };
}

// 3. Thin non-hook wrappers so imperative code (and tests) can call plain
//    functions from the barrel; they delegate to the in-store actions.
export function setImageSize(size: ImageSize): void {
  getState().setImageSize(size);
}
```

Besides the creator and wrappers, slices export **pure readers** where imperative code needs them (`getSettings`, `getAiConfig`, `getItem`, `getEditingItem`, `getCutItems`, `isCacheValid`, `getItemEditContent`, `getIndexTreeRoot`, …). These are deliberately *not* in the store: they mutate nothing, they just read `getState()`.

### Reading state

There are two ways to read, and choosing correctly matters.

#### Reactive reads — selectors (inside render)

Inside a React component or custom hook, read through `useAS` with a selector so the component re-renders when — and only when — that value changes:

```ts
const settings = useAS(s => s.settings);          // AppSettings
const view = useAS(s => s.currentView);           // AppView
const item = useAS(s => s.items.get(path));       // ItemData | undefined for one path
const aiConfig = useAS(s => s.aiConfig);          // AiConfigState
```

There are no per-field wrapper hooks (`useSettings()`, `useCurrentPath()`, …) anymore — components select directly. The rare *derived* read that must return a fresh object lives in a small exported hook (e.g. `useExpansionCounts()` in `items.ts`) built on `useShallow` (below).

#### Non-reactive reads — `getState()` and getters (outside render)

In event handlers, async callbacks, or other actions — anywhere that is *not* a render — read via `getState()` or a slice's non-reactive getter (`getSettings()`, `getItem(path)`, `getAiConfig()`, `getIndexTreeRoot()`, `getItemEditContent(path)`, etc.). These return the current value without subscribing. Using `getState()` inside render would read a value without registering for updates, so the component would not re-render when it changes — use a selector there instead.

#### Selector identity and `useShallow`

Zustand compares the previous and next result of your selector with **`Object.is`** and re-renders only when they differ. Because every action replaces the slices it touches with brand-new objects (and leaves untouched slices at their existing reference), a selector that returns **a primitive or a value already stored in state** (e.g. `s => s.items`, `s => s.currentPath`) is safe and maximally efficient: the reference is stable while unchanged and differs precisely when it changed.

A selector that **allocates a fresh object/array on every call** — `s => ({ a: s.x, b: s.y })` or `s => s.items.filter(...)` — is never `Object.is`-equal to its last result and would re-render on every store change (and, returned from `useSyncExternalStore`'s snapshot, drive an infinite render loop). The fix is standard Zustand: wrap the selector in [`useShallow`](https://zustand.docs.pmnd.rs/hooks/use-shallow) from `zustand/react/shallow`, which compares the result *shallowly* (key-by-key / element-by-element) instead of by identity:

```ts
// items.ts — derives a fresh counts object, so it needs useShallow
export function useExpansionCounts(): ExpansionCounts {
  return useAS(useShallow(s => computeExpansionCounts(s.items, s.currentPath)));
}
```

A derived selector that returns a **primitive** needs no wrapping — `Object.is` on a boolean/number/string is already a value comparison. `items.ts` exports the pure helper `hasAnyCutItems(items)` for exactly this: components subscribe with `useAS(s => hasAnyCutItems(s.items))`.

### Writing state — actions

All writes go through **actions defined inside the store** by the slice creators. An action:

1. reads what it needs via the creator's `get()`,
2. builds new immutable copies of the slices it changes (`new Map(...)`, `{ ...existing, field }`, `[...arr]`),
3. calls `set({ ...the changed fields })`, which shallow-merges and notifies subscribers.

```ts
// settings.ts — inside createSettingsSlice(set, get)
setFontSize: (fontSize) => set({ settings: { ...get().settings, fontSize } }),
```

Callers have two equivalent entry points: components and imperative code alike normally call the slice's exported wrapper function (`setFontSize('large')` imported from the barrel), which delegates to `getState().setFontSize(...)`; code that already has a state snapshot can call the action on it directly. The wrappers keep the public API plain functions — easy to import anywhere and easy to mock in tests.

#### No-op guards

Many actions **early-return when nothing actually changes**. Zustand's `set` always creates a new top-level state object and notifies every subscriber (each then re-runs its selector), so the guard avoids that pointless sweep:

```ts
// view.ts — inside createViewSlice(set, get)
setCurrentView: (view) => {
  if (get().currentView === view) return;   // no-op guard
  set({ currentView: view });
},
```

The batch actions on the items Map (`clearAllSelections`, `expandAllItems`, `cutSelectedItems`, `deleteItems`, …) take this further: they build a candidate new Map but track a `hasChanges` flag and only `set` if at least one entry was actually modified. Follow this convention in new actions — it keeps the render graph quiet.

#### Batching multiple fields in one update

Because `set` takes a `Partial<StoreState>`, one action can atomically update several fields with a single notification. `navigateToBrowserPath`, for instance, sets `currentPath`, `currentView`, and optionally `pendingScrollToFile` in one `set` — so subscribers see a single consistent transition rather than a flurry of intermediate states. Likewise `setImageSizeWithTransition` patches `imageSize` + `imageSizeTransitioning` together. Prefer one `set` with several keys over several sequential `set` calls. (This atomicity is also why the app has exactly **one** store — splitting state across multiple Zustand stores would turn these single notifications into multi-store, inconsistent-window updates.)

### The items Map — a deeper look

`items` is the busiest piece of state, so it has its own idioms in `items.ts`:

- **Keyed by full path** in a `Map<string, ItemData>` for O(1) lookup, insertion, and deletion. `ItemData` (defined in `src/shared/types.ts`) carries both the file metadata (`path`, `name`, `isDirectory`, `modifiedTime`, `createdTime`) and all the transient UI flags (`isSelected`, `isCut`, `isExpanded`, `editing`, `editContent`, `renaming`, `reviewing`, cached `content` + `contentCachedAt`, parsed `tags` + `props`).
- **Per-item referential identity.** Every mutation clones the Map *and* replaces only the specific entry object(s) that changed (`newItems.set(path, { ...existing, isSelected: !existing.isSelected })`). Unchanged entries keep their exact object reference. This is what makes the per-item selector `useAS(s => s.items.get(path))` cheap: Zustand's `Object.is` check on the selector result means a component rendering one file re-renders only when *that* file's entry object changes — a change to a *different* file (a new Map, but the same entry reference for this path) does not disturb it. This per-item isolation is essential in a folder view that may render hundreds of entries.
- **Content caching & invalidation.** `mergeItem` (used by `upsertItem`/`upsertItems`) refreshes metadata on re-scan and *invalidates* cached content when the file's `modifiedTime` is newer than `contentCachedAt`. `isCacheValid(path)` and `setItemContent` manage this; note `content` is checked for `undefined` (never loaded) rather than falsiness, so an empty file still counts as cached.
- **Direct getters for imperative code.** `getItem`, `getEditingItem`, `getCutItems`, `getItemEditContent` read the Map without subscribing, for use in handlers and callbacks.
- **Renames preserve state.** `renameItem` moves the entry from `oldPath` to `newPath` in the Map (delete + set) while spreading the old flags/content forward, so a selected/expanded item stays selected/expanded through a rename instead of leaving a phantom entry.

### Non-reactive, module-level stores

Not everything belongs in the reactive store. **`scroll.ts`** deliberately keeps browser-view scroll positions in a plain module-level `Map<path, number>` (`browserPositions`) with `getBrowserScrollPosition` / `setBrowserScrollPosition`, *outside* the Zustand store. Scroll positions are written eagerly as the user scrolls but only read imperatively on folder change; routing them through the reactive store would either cause a torrent of re-renders or risk tearing if the snapshot were mutated without notifying listeners. Keeping them out of the reactive state makes "update without re-rendering" explicit and safe. Most other views retain scroll natively because `App.tsx` hides inactive views with `display:none` (they stay mounted, so the DOM keeps their `scrollTop`); the browser view is the exception because a single mounted instance is reused across folder navigation, which is why it needs this manual save/restore.

### Persistence and the IPC boundary

The renderer store is in-memory and vanishes on reload. The **durable** subset of state is persisted by the main process. Understanding the split is essential.

#### Main process is the source of truth (`src/main/configMgr.ts`)

`configMgr.ts` owns the persistent `AppConfig` (browse folder, current subfolder, `settings`, AI configuration, recent folders, calendar view type, image size, …). It reads the YAML config file (`config.yaml` in Electron's `userData` dir) exactly **once** at startup via `initConfig()`, then serves all reads from the in-memory `_config` object. Writes go through `updateConfig(partial)`, which shallow-merges the keys provided, treats `undefined` values as deletions, and enqueues an atomic, serialized, fsync'd flush to disk. Renderers reach it over IPC via `api.getConfig()` and `api.updateConfig(...)`. Crucially, `updateConfig` is **partial and per-key**: each call touches only the keys it carries, so concurrent writes to different keys never clobber each other, and there is deliberately no whole-config "replace" path exposed to the renderer.

#### Re-hydration at startup (`src/renderer/config.ts`)

`loadConfig()` runs once, early in `App.tsx`'s mount effect. It calls `api.getConfig()` and pushes the persisted values into the store via the normal actions: `setSettings({ ...defaultSettings, ...config.settings })` (merging over defaults so newly-added settings fields get sane values on old config files), `setCalendarViewType`, `setImageSize`, and `setAiConfig(...)` to seed the AI mirror. It also validates the saved browse folder and current subfolder and calls `setCurrentPath`. From that point on, the store drives the UI.

#### Persisting store changes back to config

Changes flow back to disk explicitly — the store does **not** auto-persist. Patterns you'll see:

- **Settings:** the Settings view mutates the store live (`setFontSize`, `setSortOrder`, `toggleBookmark`, …) for instant UI feedback, and persistence happens by calling `api.updateConfig({ settings: getSettings() })` (see `handleSaveSettings` in `App.tsx`).
- **Navigation:** an effect in `App.tsx` persists `curSubFolder` and `recentFolders` via `api.updateConfig(...)` whenever `currentPath`/`rootPath`/`recentFolders` change — each as its own config key so nothing else is clobbered.
- **AI config — the two-write mirror pattern.** The AI configuration is special: `src/store/aiConfig.ts` holds a renderer-reactive **mirror** (`aiConfig` in `AppState`) of what is authoritatively stored in `configMgr`. The mirror exists so long-lived consumers (the editor's AI Rewrite button, ThreadView's persona dropdown, AISettingsView) can select `useAS(s => s.aiConfig)` and update *live* when the config changes elsewhere, instead of reading a one-time `api.getConfig()` snapshot that goes stale. To keep the two in sync, any code changing an AI field calls **`saveAiConfig(updates)`** in `renderer/config.ts` — the single sync point — which both persists via `api.updateConfig(updates)` **and** mirrors the change into the store via `setAiConfig(...)`. A shared `pickAiConfig` projection maps `AppConfig` keys onto the `AiConfigState` mirror shape, and is used by both `loadConfig` (seeding) and `saveAiConfig` (persisting), so the mirror has exactly one projection point. Never call `api.updateConfig` directly for an AI key — that would update disk but leave the live mirror stale.

#### Session-only (never persisted) state

Plenty of `AppState` is intentionally ephemeral and resets on restart: the `items` Map, search results, `visibleTabs` (tab visibility is session-only by design — see `showTab`/`hideTab`), pending scroll/edit signals, `folderAnalysis`/`folderGraph`, the index tree, calendar events, and all transient UI flags. Only the fields explicitly written through `api.updateConfig` survive a restart.

### The store's relationship to the wider app

State flows into the store from several directions, all landing on the same actions:

- **IPC results.** After `api.getDirectoryContents(path)` etc., the renderer calls `upsertItems(...)` to fold the results into the store.
- **Native menu events.** Native menu clicks are sent from `main.ts` via `webContents.send`, exposed by `preload.ts` as `onEventRequested`-style listeners, registered in `App.tsx`, and handled by calling store actions (cut/paste/select-all → `cutSelectedItems`, etc.). See the "Menu → IPC → Renderer Event" pattern in `AGENTS.md`.
- **User interaction** in components, via the same actions.

The reactive path out of the store is uniform: `useAS(selector)` → Zustand's subscription → re-render when the selected value changes.

### Adding a new piece of state — checklist

To add a new field to the global store:

1. **Add the field to `AppState`** in `src/shared/types.ts` (and give it an initial value in `initialState` in `core.ts`). If it's a new settings/config field, add it to `AppSettings`/`AppConfig` and to `defaultSettings`/the config schema instead.
2. **Pick or create the right slice** under `src/store/`. Group it with related state; only make a new slice for a genuinely new concern. (A new slice needs a `createXxxSlice` creator composed into `create()` in `core.ts` and its action interface added to `StoreState` — copy the shape of `image.ts`.)
3. **Write the action** inside the slice creator: add its signature to the slice's action interface, build new immutable copies of what it changes, and call `set`. Add a no-op guard if the value can be set to its current value. Batch related fields into one `set`. Export a thin wrapper function that delegates to `getState().yourAction(...)` so imperative code and tests keep a plain-function API.
4. **Read it with a direct selector** — `useAS(s => s.yourField)` — no wrapper hook needed. Add a non-reactive `getYourField()` getter (a free function reading `getState()`) if imperative code needs it. For a *derived* value that returns a fresh object/array, export a small hook that wraps the selector in `useShallow` (see `useExpansionCounts`); a derived primitive needs no wrapping.
5. **Confirm it flows through the `index.ts` barrel** (it already does `export * from './yourSlice'`; a brand-new slice file needs its `export *` line added).
6. **If it must persist:** add the key to `AppConfig` and the config schema, seed it in `loadConfig()`, and write it back with `api.updateConfig({ yourKey })` at the appropriate moment (or, for AI keys, through `saveAiConfig`). If it's a live-updating mirror of main-process config, follow the `aiConfig` mirror pattern.

### Rules of thumb (the short list)

- **Read in render → `useAS(selector)`. Read outside render → `getState()`/getter.**
- **Write → an action inside the store** (via its exported wrapper). Never mutate nested state in place.
- **Every change allocates a new object/Map/Set/array** for the slice it touches; leave untouched slices at their existing reference.
- **Selectors return primitives or stored references by default** — a selector that builds a fresh object/array must be wrapped in `useShallow`.
- **Guard no-ops** so you don't notify every subscriber for nothing.
- **One store.** Don't create additional Zustand stores — multi-field patches must stay atomic.
- **Import from the `src/store` barrel**, not individual slice files.
- **Persistence is explicit**, lives in the main process (`configMgr`), and is re-hydrated by `loadConfig()`; the store itself never writes to disk.

### Local AI Model Inference Troubleshooting

For local inference we have 'llamacpp' folder setup to be able to run 'llama-server'. If you happen to be running on extremely limited hardware these are the two settings you can change to turn off some advanced reasoning and agent of capabilities, to run just a minimalist chatbot:

1) In `deepAgents.ts` set `USE_DEEP_AGENTS` variable to false. There's currently no way to alter this without an app rebuild.
2) In `start-server.sh` make sure you have `--reasoning off`, which makes the model run without reasoniong and so it's tryign to do less and can therefore complete inference in a shorter amount of time with less GPU/CPU power.

## React Compiler

On July 3, 2026 this codebase migrated to the **React Compiler** and removed **every `useCallback` and `useMemo`** from the renderer. The compiler (`babel-plugin-react-compiler`, wired into `vite.renderer.config.mts` — renderer only; main/preload have no React) analyzes each component and hook at build time and inserts memoization automatically, more thoroughly than hand-written `useCallback`/`useMemo` ever did: it memoizes intermediate values, JSX subtrees, and callbacks alike, keyed on precise dependency analysis rather than hand-maintained dep arrays.

### The coding standard (the short list)

- **Never add `useCallback` or `useMemo`.** The compiler provides memoization; manual memoization is dead code at best and a compiler-confuser at worst. `grep -rn "useCallback\|useMemo" src` should stay empty.
- **Never add an `eslint-disable` for any `react-hooks/*` rule.** A suppression makes the *build* compiler skip the entire component (see "bailouts" below), and this is the one bailout cause our lint guard structurally cannot detect. Restructure the code so the rule passes honestly instead (patterns below).
- **Put compiler-unsupported constructs in module-level helper functions.** The compiler only compiles components and hooks — a plain module-level function can freely use `try/finally`, `this`, mutation of module globals, etc. This is the universal escape hatch and the fix for almost every bailout.
- **Write new components/hooks normally otherwise.** No special annotations, no wrapper patterns — just follow the rules of React (don't read/write refs during render, don't mutate props/state) and the compiler handles the rest.

### What a "bailout" is and why we care

The compiler compiles **per component/hook** (each function is a separate unit). When it encounters something it can't handle *anywhere* inside a unit — including deep inside a nested callback — it **bails out**: it silently skips that unit and emits the original code unchanged. Nothing fails; the app still works. But because this codebase has **no manual memoization left**, a bailed-out component is *fully de-memoized*: every render creates new function identities, `memo()` children stop skipping renders, and effects with function deps re-fire on every render. So here, a bailout is a real performance regression that would otherwise be invisible — which is why we run two layers of guards (below).

### Known bailout causes and their fixes

| Cause | Fix |
|---|---|
| `try { } finally { }` (or `try` without `catch`) anywhere in the unit | Convert async work to a promise chain — `.then().catch().finally()` (e.g. `setBusy(true); void op().catch(...).finally(() => setBusy(false))`) — or extract the try/finally into a module-level helper function. |
| Conditionals / logical ops / optional chaining (`?:`, `\|\|`, `&&`, `?.`) inside a `try` or `catch` block | Hoist the value expressions out of the try, or extract the whole block to a module-level helper (e.g. an `errorMessage(err)` helper for the classic `err instanceof Error ? err.message : '...'` pattern in a catch). |
| Writing a ref during render (`someRef.current = value` in the component body) | Move the sync into a no-deps `useEffect` declared before the other effects (see `CodeMirrorEditor.tsx` — its "latest callback" refs are synced this way). |
| Mutating a module-level variable (e.g. `++idCounter`) | Wrap the mutation in a module-level function (`nextMermaidId()` in `MermaidDiagram.tsx`). |
| `this` expressions (e.g. a d3 `.each(function () { this.getBBox() })` callback) | Extract the callback to a module-level function with a typed `this` parameter (`measureLabelFootprint` in `FolderGraphView.tsx`). |
| `eslint-disable` of any `react-hooks` rule | Remove the suppression and restructure so the rule passes (patterns below). |

### The exhaustive-deps escape patterns

Removing a suppression usually means confronting `react-hooks/exhaustive-deps` honestly. The recurring situations and their proven fixes:

1. **Function only used by one effect** → move the function *inside* the effect and depend on its real inputs.
2. **Function used by an effect + other call sites** → give the effect its own local copy built on stable primitives (state setters, refs), or move the load logic into the effect keyed on a `refreshTick` state that other callers bump.
3. **Mount-time configuration** (props intentionally read once, when an effect builds a long-lived object like a CodeMirror `EditorView`) → snapshot them into a ref at first render and read the snapshot inside the effect. Refs are exempt from dep arrays, so `[]` passes honestly:

   ```ts
   // Captured once; the mount effect intentionally uses first-render values.
   const mountConfigRef = useRef({ value, language, autoFocus /* … */ });

   useEffect(() => {
     const cfg = mountConfigRef.current;
     // build the long-lived object from cfg.*
   }, []);   // honest: only refs and module-level helpers are referenced
   ```

   See `CodeMirrorEditor.tsx` and `DiffReviewEditor.tsx` for the full pattern. Props that *do* change during the object's lifetime get their own small sync effects instead.
4. **"Latest callback" refs** (handlers inside a once-created object must call current props) → keep the refs, but sync them in a no-deps effect (runs after every render), never during render.

One companion gotcha: **`react-hooks/set-state-in-effect`** flags *synchronous* `setState` in an effect body. When an effect kicks off async loading, keep the pre-await `setLoading(true)` inside the async function (module-level helper or async IIFE), not directly in the effect body.

### Guard layer 1 — ESLint

`eslint.config.mjs` enables the full `eslint-plugin-react-hooks` v7 compiler-powered rule set as **errors** for `src/**` (scoped there because the typed rules need a TypeScript program, supplied by `parserOptions.projectService`). Beyond the recommended set (`rules-of-hooks`, `exhaustive-deps`, `refs`, `purity`, `set-state-in-effect`, `immutability`, …), two non-default rules act as bailout guards:

- **`react-hooks/todo`** — flags constructs the compiler doesn't support *yet* (try/finally, `this`, global mutation, …). This is the rule that makes an innocent-looking `try/finally` fail lint instead of silently de-memoizing a component.
- **`react-hooks/syntax`** — flags invalid JS the compiler rejects outright.

Lint gives fast, in-editor feedback — but it is **advisory, not authoritative**, for two structural reasons:

1. **Version skew.** The lint plugin bundles its *own* compiler snapshot, released independently of the `babel-plugin-react-compiler` version the build uses. They will essentially never be the same version, in either direction. (Concrete example from the migration: the newer lint compiler accepts conditionals inside try/catch, which the build's 1.0.0 still bails on — lint stayed green while the build silently de-memoized `FolderEntry`.)
2. **Suppressions are invisible to lint.** In lint mode the compiler deliberately ignores `eslint-disable` comments (verified in the plugin source — `react-hooks/rule-suppression` never fires on them), so a suppression-caused bailout can never fail lint. Mitigation: a suppression requires a literal disable comment in the diff, so it can't slip in silently — treat any new `eslint-disable react-hooks/*` in review as a defect.

### Guard layer 2 — `compiler-coverage.mjs` (the source of truth)

The repo-root script **`compiler-coverage.mjs`** runs the *exact* compiler version the renderer build uses over the sources and reports, per component/hook, what compiled and what bailed (and why). It closes both lint gaps above, and it is a **permanent fixture**, not a workaround — no lint configuration can replicate "run the actual build plugin."

- `node compiler-coverage.mjs` — **gate mode**: scans every non-`.d.ts` file under `src/`, prints only problems plus a summary, exits 1 on any bailout. `build.sh` runs this after lint and aborts the build on failure (~3 s for the whole tree).
- `node compiler-coverage.mjs <files...>` — **verbose mode**: per-function report including `OK` lines. Use this while working on a specific file.

**Workflow when a bailout appears** (locally or in the build): read the `BAIL` reason, apply the matching fix from the table above (usually: extract to a module-level helper), then re-run the script on the file until every unit reports `OK`. Verify with `yarn lint` and `yarn vitest run`.

**Workflow when upgrading the compiler**: check `npm view babel-plugin-react-compiler dist-tags`, upgrade, and re-run the gate — version changes are exactly when new bailouts (or newly-compiling code) appear. Note from the migration: as of 2026-07 even the experimental compiler builds do **not** support try/finally, and the experimental compiler is *stricter* about leftover manual memoization — another reason the "no `useCallback`/`useMemo` at all" end state is the right one.
