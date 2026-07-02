# MkBrowser is an Electron App

<!-- TOC -->
* [Overview](#overview)
* [React State Management](#react-state-management)
  * [How does this application handle global state?](#how-does-this-application-handle-global-state)
  * [Why a custom store instead of Redux/Context?](#why-a-custom-store-instead-of-reduxcontext)
  * [The core primitives (`src/store/core.ts`)](#the-core-primitives-srcstorecorets)
  * [The immutability contract](#the-immutability-contract)
  * [The slice architecture](#the-slice-architecture)
  * [Reading state](#reading-state)
    * [Reactive reads — hooks (inside render)](#reactive-reads--hooks-inside-render)
    * [Non-reactive reads — `getState()` and getters (outside render)](#non-reactive-reads--getstate-and-getters-outside-render)
    * [The referential-identity rule for selectors](#the-referential-identity-rule-for-selectors)
    * [Derived values and cached snapshots](#derived-values-and-cached-snapshots)
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

MkBrowser keeps all of its shared, application-wide state in a **single custom store** built directly on React's `useSyncExternalStore` hook, not Redux, Zustand, Jotai, MobX, or the React Context API. The entire store lives under `src/store/`. At its heart is one plain JavaScript object — a single `AppState` value held in a module-level `let state` variable inside `src/store/core.ts` — plus a `Set` of listener callbacks. Components never touch that object directly. Instead they **read** through small, purpose-built hooks (`useItem`, `useSettings`, `useCurrentPath`, `useAiConfigState`, …) that subscribe to changes, and they **write** through plain exported functions we call *actions* (`upsertItems`, `setCurrentPath`, `toggleBookmark`, `setAiConfig`, …). Every action produces a *new* immutable copy of whatever slice of state it touches and then notifies all subscribers, so React re-renders exactly the components that read the changed data.

Because the store is a module-level singleton, any code in the renderer — React component, hook, plain utility function, or an async IPC callback — can import an action from the store barrel (`src/store/index.ts`) and call it. There is no provider to wrap the app in, no `dispatch`, no reducers, no action-type constants, and no context threading. State that must survive across app restarts (settings, the current subfolder, AI configuration, etc.) is **not** stored in the browser; it is persisted by the Electron *main* process to a YAML config file and re-hydrated into the store at startup. The renderer store is therefore best understood as the live, in-memory, reactive picture of the app, and the main-process config manager (`src/main/configMgr.ts`) is the durable source of truth for the subset of that state which is persistent.

The rest of this section explains the moving parts: the core primitives, how the store is split into slices, the read and write patterns (and the referential-identity rules that make them efficient), the special-case non-reactive stores, how state is persisted and re-hydrated across the IPC boundary, and a checklist for adding new state.

### Why a custom store instead of Redux/Context?

The store predates and deliberately avoids the ceremony of Redux while still giving us a single, predictable, centralized state container:

- **`useSyncExternalStore` is the officially-blessed React 18/19 primitive** for subscribing components to an external mutable source without tearing (inconsistent reads across a render). We lean on it directly rather than pulling in a library that wraps it.
- **No Context re-render cascades.** A single React Context holding the whole app state would re-render *every* consumer on *any* change. Our per-slice (and per-item) subscription model means a component that only reads `settings.fontSize` is not disturbed when, say, a search result arrives.
- **Callable from anywhere.** Actions are just functions on a module singleton, so non-React code (utilities, async IPC handlers, menu-event listeners) mutates state the same way components do — no hooks-only restriction.
- **Trivial to unit test.** Slices are plain modules; a test can call an action and assert via `getState()` with no React renderer involved.

### The core primitives (`src/store/core.ts`)

Everything is built on a handful of primitives that live in `core.ts`. Slice files import these; application code generally does not (it uses the higher-level actions and hooks the slices export).

- **`state`** — a private module-level `let state: AppState`. This is the *only* mutable reference in the whole store. It starts life as `initialState`, a fully-populated `AppState` object (see `core.ts`) that defines every field the app tracks and its initial value (`items: new Map()`, `currentPath: ''`, `currentView: 'browser'`, `settings: defaultSettings`, `aiConfig: defaultAiConfig`, and so on).
- **`listeners`** — a `Set<() => void>` of subscriber callbacks.
- **`subscribe(listener)`** — adds a listener and returns an unsubscribe function. This is the first argument to every `useSyncExternalStore` call in the app.
- **`emitChange()`** — iterates `listeners` and calls each one, telling React "something changed, re-check your snapshots." (It also contains a commented-out debug line showing how to log a specific field on every change — handy for troubleshooting spurious updates.)
- **`getState()`** — returns the current `state` object *non-reactively*. Use this when you need to read state outside of render (in an event handler, an async callback, or another action) without subscribing.
- **`setState(patch)`** — the single write path. It does `state = { ...state, ...patch }` (a shallow merge that produces a brand-new top-level object) and then calls `emitChange()`. **Every** mutation in the store ultimately funnels through `setState`.
- **`useStoreValue(selector)`** — the generic selector hook, defined as `useSyncExternalStore(subscribe, () => selector(state))`. Most of the app's read hooks are thin wrappers around this (e.g. `useCurrentView = () => useStoreValue(s => s.currentView)`).

Two defaults also live here so the core owns its own initial values without importing a slice: **`defaultSettings`** (the initial `AppSettings`) and **`defaultAiConfig`** (the initial `AiConfigState`). They are re-exported from their respective slices (`settings.ts`, `aiConfig.ts`) for convenience.

### The immutability contract

`setState` only replaces the *top-level* state object. It does **not** deep-clone. So the golden rule for every action is: **never mutate a nested object, array, `Map`, or `Set` in place — build a new one.** For example, `upsertItems` does `const newItems = new Map(getState().items)`, mutates the *copy*, then `setState({ items: newItems })`. If it mutated the existing Map in place, `useSyncExternalStore`'s identity check (`Object.is(prev, next)`) would see the same Map reference and skip the re-render — the UI would silently go stale. This new-object-on-every-change discipline is what makes the whole reactive system work, and it is also what makes referential-identity selection (below) possible.

### The slice architecture

`AppState` is one big interface (defined in `src/shared/types.ts`), but the *code* that mutates and reads it is split into cohesive **slices** under `src/store/`, each a plain module that imports the core primitives and owns a related group of fields:

| Slice file | Responsibility |
|------------|----------------|
| `core.ts` | The shared `state` / `subscribe` / `emitChange` / `getState` / `setState` / `useStoreValue` primitives, plus `initialState`, `defaultSettings`, `defaultAiConfig`. Every other slice builds on this. |
| `items.ts` | The `items` `Map<path, ItemData>` — the file/folder listing and all per-item flags (selected, cut, expanded, editing, renaming, cached content, tags, props). The largest slice. |
| `view.ts` | View/navigation state: `currentView`, `currentPath`, `rootPath`, `visibleTabs`, pending scroll/edit signals, folder analysis/graph, the directory-refresh nonce, expanded-editor flag. |
| `settings.ts` | The persisted `AppSettings` (font size, sort order, content width, bookmarks, ignored paths, index-tree width, etc.) and all bookmark operations. |
| `search.ts` | Search results, the query/folder/name they came from, sort options, and the persistent result highlight. |
| `aiConfig.ts` | The renderer-side reactive *mirror* of the main process's AI configuration (see persistence, below). |
| `calendar.ts` | Calendar events, loading flag, active/target folder, view type (month/week/day), and the centered date. |
| `indexTree.ts` | The hierarchical `.INDEX.yaml` navigation tree (`indexTreeRoot`) and its expand/collapse/reveal operations. |
| `image.ts` | Inline image display size and its CSS-transition flag. |
| `scroll.ts` | Browser-view scroll positions per folder — a **non-reactive** module-level store (see below). |
| `index.ts` | The **barrel**: re-exports every slice's actions and hooks, plus the shared store types. This is the single public import surface for the rest of the app. |

**Always import from the barrel**, e.g. `import { useItem, upsertItems, setCurrentPath } from '../../store'`. Components should not reach into individual slice files. The barrel also re-exports the store *type* interfaces (`AppState`, `AppSettings`, `AiConfigState`, `ItemData`, `TreeNode`, `FileNode`, etc.), all of which are actually declared in `src/shared/types.ts` and simply passed through `index.ts`.

### Reading state

There are two ways to read, and choosing correctly matters.

#### Reactive reads — hooks (inside render)

Inside a React component or custom hook, read through one of the slice-provided hooks so the component re-renders when that value changes:

```ts
const settings = useSettings();          // AppSettings
const view = useCurrentView();           // AppView
const item = useItem(path);              // ItemData | undefined for one path
const aiConfig = useAiConfigState();     // AiConfigState
```

Most of these are one-liners over `useStoreValue(selector)`. A few that need custom snapshot logic call `useSyncExternalStore` directly (`useItem`, `useExpansionCounts`).

#### Non-reactive reads — `getState()` and getters (outside render)

In event handlers, async callbacks, or other actions — anywhere that is *not* a render — read via `getState()` or a slice's non-reactive getter (`getSettings()`, `getItem(path)`, `getAiConfig()`, `getIndexTreeRoot()`, `getItemEditContent(path)`, etc.). These return the current value without subscribing. Using `getState()` inside render would read a value without registering for updates, so the component would not re-render when it changes — reach for a hook there instead.

#### The referential-identity rule for selectors

This is the single most important thing to understand about reading state, and it is documented right on `useStoreValue` in `core.ts`:

> A selector must return **either a primitive or a value already stored in state** (e.g. `s => s.items`). It must **never return a freshly-allocated object/array**.

`useSyncExternalStore` calls the snapshot function on every render and after every change, and bails out of re-rendering only when the new snapshot is `Object.is`-equal to the previous one. Because every action replaces the slices it touches with brand-new objects (and leaves untouched slices at their existing reference), returning `s => s.items` or `s => s.settings` is safe: the reference is stable while unchanged and differs precisely when it changed. But a selector like `s => s.items.size > 0 ? [...] : []` or `s => ({ a: s.x, b: s.y })` allocates a new array/object on *every* call, is never `Object.is`-equal to the last, and drives an **infinite render loop**. When you genuinely need a derived value, compute a *cached* snapshot instead (next section).

#### Derived values and cached snapshots

When a read needs to *compute* something across state (rather than return a stored reference), memoize the computation so the snapshot stays referentially stable between changes. The canonical example is `getExpansionCountsSnapshot` in `items.ts`, backing the `useExpansionCounts()` hook. It scans the `items` Map to count expanded/collapsed entries in the current folder — an O(n) scan that would allocate a fresh result object every call. To keep it stable, it caches the last result keyed on the two inputs the scan depends on (the `items` Map reference and `currentPath`); it recomputes only when either input's identity changes, and otherwise returns the *same* cached object, so `useSyncExternalStore` correctly skips re-renders. Any new derived/aggregate selector should follow this same "cache keyed on the state references it depends on" pattern.

### Writing state — actions

All writes go through exported **action** functions on the slices. An action:

1. reads what it needs via `getState()`,
2. builds new immutable copies of the slices it changes (`new Map(...)`, `{ ...existing, field }`, `[...arr]`),
3. calls `setState({ ...the changed slices })`, which merges and fires `emitChange()`.

```ts
// settings.ts — replace one field, preserving the rest, with a fresh object
export function setFontSize(fontSize: FontSize): void {
  setState({ settings: { ...getState().settings, fontSize } });
}
```

#### No-op guards

Many actions **early-return when nothing actually changes**, to avoid a pointless `emitChange()` that would wake every subscriber. You'll see this pattern throughout:

```ts
export function setCurrentView(view: AppView): void {
  if (getState().currentView === view) return;   // no-op guard
  setState({ currentView: view });
}
```

The batch actions on the items Map (`clearAllSelections`, `expandAllItems`, `cutSelectedItems`, `deleteItems`, …) take this further: they build a candidate new Map but track a `hasChanges` flag and only `setState` if at least one entry was actually modified. Follow this convention in new actions — it keeps the render graph quiet.

#### Batching multiple fields in one update

Because `setState` takes a `Partial<AppState>`, one action can atomically update several fields with a single notification. `navigateToBrowserPath`, for instance, sets `currentPath`, `currentView`, and optionally `pendingScrollToFile` in one `setState` — so subscribers see a single consistent transition rather than a flurry of intermediate states. Prefer one `setState` with several keys over several sequential `setState` calls.

### The items Map — a deeper look

`items` is the busiest piece of state, so it has its own idioms in `items.ts`:

- **Keyed by full path** in a `Map<string, ItemData>` for O(1) lookup, insertion, and deletion. `ItemData` (defined in `src/shared/types.ts`) carries both the file metadata (`path`, `name`, `isDirectory`, `modifiedTime`, `createdTime`) and all the transient UI flags (`isSelected`, `isCut`, `isExpanded`, `editing`, `editContent`, `renaming`, `reviewing`, cached `content` + `contentCachedAt`, parsed `tags` + `props`).
- **Per-item referential identity.** Every mutation clones the Map *and* replaces only the specific entry object(s) that changed (`newItems.set(path, { ...existing, isSelected: !existing.isSelected })`). Unchanged entries keep their exact object reference. This is what makes the **`useItem(path)`** hook cheap: it subscribes with a snapshot of `getState().items.get(path)`, and `useSyncExternalStore`'s `Object.is` check means a component rendering one file re-renders only when *that* file's object changes — a change to a *different* file (a new Map, but the same entry reference for this path) does not disturb it. This per-item isolation is essential in a folder view that may render hundreds of entries.
- **Content caching & invalidation.** `mergeItem` (used by `upsertItem`/`upsertItems`) refreshes metadata on re-scan and *invalidates* cached content when the file's `modifiedTime` is newer than `contentCachedAt`. `isCacheValid(path)` and `setItemContent` manage this; note `content` is checked for `undefined` (never loaded) rather than falsiness, so an empty file still counts as cached.
- **Direct getters for imperative code.** `getItem`, `getEditingItem`, `getCutItems`, `getItemEditContent` read the Map without subscribing, for use in handlers and callbacks.
- **Renames preserve state.** `renameItem` moves the entry from `oldPath` to `newPath` in the Map (delete + set) while spreading the old flags/content forward, so a selected/expanded item stays selected/expanded through a rename instead of leaving a phantom entry.

### Non-reactive, module-level stores

Not everything belongs in the reactive `AppState`. **`scroll.ts`** deliberately keeps browser-view scroll positions in a plain module-level `Map<path, number>` (`browserPositions`) with `getBrowserScrollPosition` / `setBrowserScrollPosition`, *outside* `useSyncExternalStore`. Scroll positions are written eagerly as the user scrolls but only read imperatively on folder change; routing them through the reactive store would either cause a torrent of re-renders or risk tearing if the snapshot were mutated without notifying listeners. Keeping them out of the reactive state makes "update without re-rendering" explicit and safe. Most other views retain scroll natively because `App.tsx` hides inactive views with `display:none` (they stay mounted, so the DOM keeps their `scrollTop`); the browser view is the exception because a single mounted instance is reused across folder navigation, which is why it needs this manual save/restore.

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
- **AI config — the two-write mirror pattern.** The AI configuration is special: `src/store/aiConfig.ts` holds a renderer-reactive **mirror** (`aiConfig` in `AppState`) of what is authoritatively stored in `configMgr`. The mirror exists so long-lived consumers (the editor's AI Rewrite button, ThreadView's persona dropdown, AISettingsView) can `useAiConfigState()` and update *live* when the config changes elsewhere, instead of reading a one-time `api.getConfig()` snapshot that goes stale. To keep the two in sync, any code changing an AI field calls **`saveAiConfig(updates)`** in `renderer/config.ts` — the single sync point — which both persists via `api.updateConfig(updates)` **and** mirrors the change into the store via `setAiConfig(...)`. A shared `pickAiConfig` projection maps `AppConfig` keys onto the `AiConfigState` mirror shape, and is used by both `loadConfig` (seeding) and `saveAiConfig` (persisting), so the mirror has exactly one projection point. Never call `api.updateConfig` directly for an AI key — that would update disk but leave the live mirror stale.

#### Session-only (never persisted) state

Plenty of `AppState` is intentionally ephemeral and resets on restart: the `items` Map, search results, `visibleTabs` (tab visibility is session-only by design — see `showTab`/`hideTab`), pending scroll/edit signals, `folderAnalysis`/`folderGraph`, the index tree, calendar events, and all transient UI flags. Only the fields explicitly written through `api.updateConfig` survive a restart.

### The store's relationship to the wider app

State flows into the store from several directions, all landing on the same actions:

- **IPC results.** After `api.getDirectoryContents(path)` etc., the renderer calls `upsertItems(...)` to fold the results into the store.
- **Native menu events.** Native menu clicks are sent from `main.ts` via `webContents.send`, exposed by `preload.ts` as `onEventRequested`-style listeners, registered in `App.tsx`, and handled by calling store actions (cut/paste/select-all → `cutSelectedItems`, etc.). See the "Menu → IPC → Renderer Event" pattern in `AGENTS.md`.
- **User interaction** in components, via the actions their hooks sit alongside.

The reactive path out of the store is uniform: hook → `useSyncExternalStore(subscribe, snapshot)` → re-render on `emitChange()`.

### Adding a new piece of state — checklist

To add a new field to the global store:

1. **Add the field to `AppState`** in `src/shared/types.ts` (and give it an initial value in `initialState` in `core.ts`). If it's a new settings/config field, add it to `AppSettings`/`AppConfig` and to `defaultSettings`/the config schema instead.
2. **Pick or create the right slice** under `src/store/`. Group it with related state; only make a new slice for a genuinely new concern.
3. **Write an action** that builds new immutable copies of what it changes and calls `setState`. Add a no-op guard if the value can be set to its current value. Batch related fields into one `setState`.
4. **Write a read hook** as a thin `useStoreValue(s => s.yourField)` wrapper (returning a primitive or a stored reference — never a fresh allocation). Add a non-reactive `getYourField()` getter if imperative code needs it. For a *derived* value, use the cached-snapshot pattern (`getExpansionCountsSnapshot`).
5. **Export both from the slice**, and confirm they flow through the `index.ts` barrel (it already does `export * from './yourSlice'`).
6. **If it must persist:** add the key to `AppConfig` and the config schema, seed it in `loadConfig()`, and write it back with `api.updateConfig({ yourKey })` at the appropriate moment (or, for AI keys, through `saveAiConfig`). If it's a live-updating mirror of main-process config, follow the `aiConfig` mirror pattern.

### Rules of thumb (the short list)

- **Read in render → hook. Read outside render → `getState()`/getter.**
- **Write → an action → `setState`.** Never assign `state` or mutate nested state in place.
- **Every change allocates a new object/Map/Set/array** for the slice it touches; leave untouched slices at their existing reference.
- **Selectors return primitives or stored references only** — never a freshly-built object/array (infinite-loop hazard). Cache derived values.
- **Guard no-ops** so you don't fire `emitChange()` for nothing.
- **Import from the `src/store` barrel**, not individual slice files.
- **Persistence is explicit**, lives in the main process (`configMgr`), and is re-hydrated by `loadConfig()`; the store itself never writes to disk.

### Local AI Model Inference Troubleshooting

For local inference we have 'llamacpp' folder setup to be able to run 'llama-server'. If you happen to be running on extremely limited hardware these are the two settings you can change to turn off some advanced reasoning and agent of capabilities, to run just a minimalist chatbot:

1) In `deepAgents.ts` set `USE_DEEP_AGENTS` variable to false. There's currently no way to alter this without an app rebuild.
2) In `start-server.sh` make sure you have `--reasoning off`, which makes the model run without reasoniong and so it's tryign to do less and can therefore complete inference in a shorter amount of time with less GPU/CPU power.
