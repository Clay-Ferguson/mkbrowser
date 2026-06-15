# Code Review: `src/store/store.ts`

Scope: a review of `src/store/store.ts` (1957 lines) against general TypeScript / React /
Electron industry conventions and best practices. Findings are ordered roughly by impact.
Each item explains *what* the issue is, *why* it matters, and a concrete *suggestion*.

---

## 6. Repeated inline union/object literal types instead of named types

**What:**
- `'month' | 'week' | 'work_week' | 'day' | 'agenda'` is written out in
  `useCalendarViewType`, `setCalendarViewType` (and again in `types.ts`).
- `{ path: string; lineNumber?: number }` is repeated in `getHighlightedSearchResultSnapshot`,
  `setHighlightedSearchResult`, and `useHighlightedSearchResult`.

**Why it matters:** Duplicated structural types drift apart over time and obscure intent.

**Suggestion:** Define `type CalendarViewType = ...` and `type HighlightedSearchResult = ...`
once (in `types.ts`) and reference them everywhere, including the `AppState` field declarations.


## 8. Redundant `bookmarks || []` defensive guards

**What:** `state.settings.bookmarks || []` appears in ~6 functions (`toggleBookmark`,
`addBookmark`, `isBookmarked`, `updateBookmarkPath`, `updateBookmarkName`, `removeBookmark`).

**Why it matters:** `AppSettings.bookmarks` is typed as `Bookmark[]` (non-optional) and the
default state initializes it to `[]`, so the guard is dead defensive code that's duplicated many
times. If `bookmarks` can actually be `undefined`, the *type* should say so; otherwise the guards
should go.

**Suggestion:** Drop the `|| []` fallbacks (the type guarantees an array), or — if persisted
settings really can omit it — normalize it once at load time / make the field optional and handle
it in one place.




## 10. "Silent" scroll-position setters mutate `state` without `emitChange`

**What:** `setBrowserScrollPosition` and the other scroll setters replace the global `state`
object but deliberately skip `emitChange()` to avoid re-renders.

**Why it matters:** This is fragile with `useSyncExternalStore`. Mutating the snapshot without
notifying listeners means a later unrelated `emitChange()` will expose this state, and any reader
calling `getSnapshot` in between sees a changed reference that React was never told about — a
classic tearing risk. It works today only because nothing reactively reads scroll positions.

**Suggestion:** Keep scroll positions in a separate non-reactive store (a plain `Map`/ref) rather
than in the reactive `state` object, so "update without notifying" is explicit and safe rather
than an implicit exception to the store's contract.


## 11. Inconsistent JSDoc and naming conventions

**What:**
- Many older actions have JSDoc; newer ones (`setExpandedEditor`, the image-size and several
  calendar setters/hooks) have none.
- `setImageSizeStore` carries a `Store` suffix that no other setter uses
  (`setImageSize` would match the convention; the suffix looks like a workaround for a naming
  collision).

**Why it matters:** Inconsistency makes the module feel unmaintained and forces readers to guess
intent.

**Suggestion:** Apply documentation and naming uniformly; rename `setImageSizeStore` to a
consistent name (resolving whatever collision motivated the suffix).

## 12. Heavy type assertions in `updateNodeByPath` / index-tree helpers

**What:** `updateNodeByPath`, `expandIndexTreeNode`, `setIndexTreeNodeLoading`, and
`collapseIndexTreeNode` rely on chained `as PathNode` / `as FileNode` / `as TreeNode[]` casts,
plus `'path' in child` narrowing followed by a cast.

**Why it matters:** Casts defeat the type checker exactly where the tree's mixed
(`FileNode`/`MarkdownHeadingNode`) structure is most error-prone. A wrong assumption here compiles
silently.

**Suggestion:** Model the node hierarchy with a proper discriminated union (e.g. a `kind`
discriminant) and use real type guards (`isFileNode(node)`), so the recursion narrows without
casts.
