# 002 — Image-path resolution cache is unbounded and never invalidated

## Role / Goal
You are working in `mkbrowser`. Address a memory-growth and staleness problem in the module-level image path cache.

## Affected file
- `src/components/markdownImgResolver.tsx`

## Background
The module keeps a process-lifetime cache:

```ts
const imagePathCache = new Map<string, string | null>();
```

Keyed by `` `${entryPath}|${imageSrc}` `` and storing the resolved absolute path (or `null` when not found). `resolveImagePath` walks up to `MAX_IMAGE_SEARCH_DEPTH` parent directories doing `await api.pathExists(...)` for each candidate, so caching is a sensible optimization.

## The problems
1. **Unbounded growth.** The map is never pruned. In a long-lived Electron session where the user browses many folders/files, it accumulates one entry per unique `(markdownFile, imageSrc)` pair forever. This is a slow memory leak.
2. **Stale negative results.** A `null` (image-not-found) result is cached permanently. If the user later creates the missing image on disk, the app will keep showing the "Image not found" placeholder for that markdown file until the app restarts, because the cache short-circuits before re-checking the filesystem.
3. **Stale positive results.** If a previously-resolved image is deleted or moved, the cache still returns the old absolute path. The `<img onError>` handler will eventually flip `hasError`, so this is less severe than the negative case, but the cache is still authoritative and wrong.

## Proposed solutions (pick based on desired behavior)
- **Bound the cache size.** Convert to a simple LRU (e.g. cap at N entries; on insert past the cap, delete the oldest key). Even a naive "clear when size exceeds N" is far better than unbounded.
- **Do not cache negatives, or cache them with a short TTL.** Caching `null` is the most user-visible bug. Either skip caching `null`, or store `{ value, timestamp }` and treat negatives as expired after a few seconds so newly-created images appear.
- **Expose an invalidation hook.** Provide an exported `clearImagePathCache()` (or invalidate-by-prefix) that the app can call when it knows the filesystem changed (folder reload, file create/delete/rename events). The project already reloads directories elsewhere (see `reloadExpandedTreeFolder` in `src/utils/dragAndDrop`), which would be a natural place to invalidate.

## Recommended minimal fix
1. Stop caching `null` results (or give them a short TTL), so missing-then-created images recover without restart.
2. Add a size cap with LRU-style eviction to bound memory.

## Acceptance criteria
- Creating an image file that was previously missing causes it to render without an app restart.
- The cache cannot grow without bound during a long session.
- Existing happy-path resolution (image present) still avoids redundant `pathExists` calls.
