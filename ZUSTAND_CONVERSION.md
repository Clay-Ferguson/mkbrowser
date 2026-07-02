# Zustand Conversion Plan

This document is the checklist/guide for migrating MkBrowser's global state from the
hand-rolled `useSyncExternalStore` store to [Zustand](https://zustand.docs.pmnd.rs/).
Check items off (i.e. change `[ ]` to `[x]`) as they are completed and keep this file updated as the source of truth
for the migration.

## Background & Strategy

The current store (`src/store/`) is architecturally a hand-rolled mini-Zustand: a
module-scope `AppState` object, a listener `Set`, a shallow-merging `setState(patch)`,
and a `useStoreValue(selector)` hook built on `useSyncExternalStore`. Every slice and
component reaches the store exclusively through four exports of `src/store/core.ts`:
`getState`, `setState`, `useStoreValue`, and `subscribe`.

That chokepoint makes the migration a **two-phase** effort:

- **Phase 1 — Engine swap (one small PR, done all at once).** Replace the internals of
  `core.ts` with a Zustand store. The four exports keep their exact signatures, so the
  other ~1,570 lines of slice code and every component remain byte-for-byte unchanged.
  Zustand's `setState` shallow-merges partial state by default — identical semantics to
  our current `setState(patch)` — and a Zustand store exposes `.getState()` /
  `.setState()` statically, so non-React callers (menu event handlers in `App.tsx`,
  services) keep working.
- **Phase 2 — Idiomatic Zustand (incremental, at leisure).** Modernize slice-by-slice
  toward standard Zustand conventions: actions inside the store, `useShallow` for
  derived selectors, devtools middleware, direct-selector hook style.

**⚠️ Do NOT migrate by standing up separate Zustand stores per slice while the old
store still runs.** Our actions make atomic multi-field patches (e.g.
`setImageSizeWithTransition` in `src/store/image.ts` patches `imageSize` +
`imageSizeTransitioning` together; `src/store/view.ts` patches `pendingEditFile` +
`pendingEditView` together), and slices read each other's state via the shared
`getState`. Splitting state across stores mid-transition would break that atomicity
(two notifications, an inconsistent-state window — the tearing
`useSyncExternalStore` exists to prevent) and create two sources of truth. Keep
**one** store throughout.

## Phase 1: Engine Swap (single PR)

- [x] `yarn add zustand` (Yarn Classic — do not use npm).
- [x] Rewrite the internals of `src/store/core.ts`:
  - Create the store with state only (actions stay in slice files for now):
    ```ts
    import { create } from 'zustand';

    const useAppStore = create<AppState>()(() => initialState);
    ```
  - Re-export the same four functions as thin wrappers:
    - `getState()` → `useAppStore.getState()`
    - `setState(patch)` → `useAppStore.setState(patch)` (shallow merge is Zustand's default)
    - `useStoreValue(selector)` → `useAppStore(selector)`
    - `subscribe(listener)` → `useAppStore.subscribe(listener)`
  - Keep `defaultSettings`, `defaultAiConfig`, and `initialState` exactly as they are.
  - Delete the now-unused hand-rolled listener set / `emitChange` (check for external
    callers of `emitChange` first; convert any to `setState`).
- [x] Confirm no other file imports Zustand or changes in this PR — slices, components,
  and `src/store/index.ts` barrel stay untouched.
- [x] Run the unit tests (`yarn test` / vitest). (893 passed)
- [x] `yarn package` (done — build rebuilt), then run the Playwright e2e suite
  (**pending — run manually**).
- [x] Manual smoke test: browse folders, search, settings save/load, calendar view,
  index tree, image-size transition (exercises an atomic multi-field patch), and the
  edit-file flow (exercises `pendingEditFile`/`pendingEditView`).

## Phase 2: Idiomatic Zustand (incremental — each item is its own small commit/PR)

These can be done in any order, whenever convenient (e.g. while touching a slice for
other reasons). None are urgent; Phase 1 already delivers the Zustand foundation.

### 2a. Adopt `useShallow` and retire the "never return a fresh object" caveat

**What the caveat is:** `core.ts` currently documents that a selector passed to
`useStoreValue` must never return a freshly-allocated object/array (e.g.
`s => ({ a: s.a, b: s.b })` or `s => s.items.filter(...)`). Reason: the hook compares
the previous and next selector results with `Object.is`; a fresh object/array is a new
identity every call, so React sees "changed" on every render → spurious re-renders or
infinite loops. Today we work around this with cached derived snapshots (see
`getExpansionCountsSnapshot` referenced in the `core.ts` comment).

**The standard Zustand fix:** wrap the selector in
[`useShallow`](https://zustand.docs.pmnd.rs/hooks/use-shallow) from `zustand/react/shallow`.
It compares the selector result *shallowly* (element-by-element / key-by-key) instead of
by identity, so selectors may freely return derived objects, arrays, or tuples:

```ts
import { useShallow } from 'zustand/react/shallow';
const { a, b } = useAppStore(useShallow(s => ({ a: s.a, b: s.b })));
```

- [x] Find the cached-snapshot workarounds (`getExpansionCountsSnapshot` and any
      similar patterns) and replace them with `useShallow` selectors. (It was the
      only such pattern: `useExpansionCounts` in `items.ts` now uses a
      `useShallow`-wrapped selector over a pure `computeExpansionCounts(items, path)`;
      the module-level cache is gone. `useItem` was also moved off raw
      `useSyncExternalStore` onto `useStoreValue`, removing the last direct
      `useSyncExternalStore` use in the store.)
- [x] Update/remove the caveat comment on `useStoreValue` in `core.ts` (now points
      to `useShallow` for derived selectors instead of cached snapshots).

### 2b. Move actions inside the store definition (Zustand "slices pattern")

**What this means:** standard Zustand defines actions as functions *inside* the
`create()` call, alongside the state they mutate, using the provided `set`/`get`:

```ts
const useAppStore = create<AppState & Actions>()((set, get) => ({
  ...initialState,
  setCurrentPath: (path) => set({ currentPath: path }),
  ...
}));
```

Currently our actions are free module functions in slice files calling the shared
`setState`. Because we have many cohesive slices, the documented
[slices pattern](https://zustand.docs.pmnd.rs/guides/slices-pattern) fits well: each
slice file exports a `createXxxSlice(set, get)` function, and `core.ts` composes them
into the single store. This is what most Zustand codebases of this size do.

- [ ] Convert one slice first (suggest `image.ts` — smallest) to validate the pattern.
- [ ] Convert remaining slices one at a time: `scroll.ts`, `aiConfig.ts`, `search.ts`,
      `calendar.ts`, `indexTree.ts`, `settings.ts`, `view.ts`, `items.ts` (largest last).
- [ ] Keep the `src/store/index.ts` barrel as the single public import surface.

### 2c. (Optional) Selector-hook convention: direct selectors vs. per-field wrapper hooks

**What this means:** idiomatic Zustand components select directly from the store hook:

```ts
const currentPath = useAppStore(s => s.currentPath);
```

Our codebase instead exposes per-field wrapper hooks (`useCurrentPath()`,
`useSettings()`, etc.). Both styles are legitimate — plenty of Zustand codebases keep
wrapper hooks deliberately as a nicer, typo-proof API. The wrappers cost nothing and
can remain indefinitely, or components can be gradually migrated to direct selectors
to match the most common Zustand convention.

- [ ] Decide: keep wrapper hooks (zero work) or migrate components to direct
      `useAppStore(selector)` calls (mechanical, can be done folder-by-folder).
- [ ] If migrating, delete each wrapper hook once its last caller is converted.

### 2d. (Optional) Middleware

- [ ] `devtools` middleware for Redux DevTools time-travel debugging (with named
      actions once 2b is done). Note: in Electron this requires installing the Redux
      DevTools extension into the Electron session (e.g. via
      `electron-devtools-installer`) — evaluate whether it's worth it.
- [ ] `persist` middleware — **probably not needed**: settings already persist through
      the main process via IPC (`api.*` → `ipcMain` handlers), and duplicating
      persistence in localStorage would create a second source of truth. Revisit only
      if some purely-UI state (e.g. `imageSize`, `indexTreeWidth`) should survive
      restarts without a settings-file round-trip.

## Phase 3: update `DEVELOPER_GUIDE.md`
this file contains lots of details about our existing global state management which will now change once we have fully adopted the Zustand library.

## Verification (applies to every phase/commit)

1. `yarn test` (vitest unit tests — safe to run freely).
2. `yarn package` to rebuild `.vite/build/` (e2e tests silently run stale bundles
   otherwise), then run the Playwright e2e suite.
3. Manual smoke of the flows listed under Phase 1.

## Key files

| File | Role in migration |
|------|-------------------|
| `src/store/core.ts` | Phase 1 engine swap; later composes slices (2b) |
| `src/store/*.ts` slices | Untouched in Phase 1; converted one-by-one in 2b |
| `src/store/index.ts` | Barrel — stays the single public import surface |
| `package.json` / `yarn.lock` | Add `zustand` (Yarn Classic) |
