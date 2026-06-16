# 014 — `AppTabButtons`: fragile path-length boundary check and per-render handler recreation

## Role / Goal
You are working in `mkbrowser`. Harden the "navigate up" boundary test and reduce unnecessary per-render object/closure churn in `AppTabButtons`.

## Affected file
- `src/components/AppTabButtons.tsx`

## Issue A — string-length boundary comparison in `navigateUp`
```tsx
const navigateUp = useCallback(() => {
  if (!currentPath || currentPath === rootPath) return;
  const parent = getParentPath(currentPath);
  if (parent.length >= rootPath.length) {
    setCurrentPath(parent);
    ...
  }
}, [currentPath, rootPath]);
```

`parent.length >= rootPath.length` uses string length as a proxy for "parent is still within root." Length is not a reliable containment test: a sibling path can be longer than `rootPath` while not being under it, and trailing-separator differences (`/root` vs `/root/`) skew the comparison. This is the same family of bug as issue 010 (breadcrumb prefix). Prefer a segment-aware "is `parent` inside (or equal to) `rootPath`" check, ideally a shared helper in `src/utils/pathUtil.ts` reused by both this file and `PathBreadcrumb`.

## Issue B — `useCallback` dependency completeness
`navigateUp`'s body calls `setCurrentPath`, `setHighlightItem`, `setPendingScrollToFile` (module-level store imports — stable) and `getParentPath` (stable). The dep array `[currentPath, rootPath]` is functionally fine, but confirm `react-hooks/exhaustive-deps` is satisfied (module imports are typically treated as stable). No action needed beyond verification unless lint flags it.

## Issue C — handlers/object rebuilt every render
```tsx
const makeCloseHandler = (tabId, close) => () => { ... };
const closeHandlers: Partial<Record<AppView, () => void>> = { ... };
```
`makeCloseHandler` and the `closeHandlers` map (plus `visibleIds`/`tabs` derivations) are recreated on every render. This is low-impact for a small tab bar, but if you touch this file, consider `useMemo` for `closeHandlers` and `visibleIds`/`tabs` keyed on their real inputs (`currentView`, `visibleTabs`, `searchResults.length`, `folderAnalysis`, `folderGraph`, `isInAiThread`). Only do this if it improves clarity — do not over-engineer.

## Priority
Issue A is the substantive one (correctness). B and C are polish.

## Acceptance criteria
- "Up Level" navigation uses a segment-aware containment check rather than string length.
- Lint is clean for the hooks in this file.
- Tab visibility and close behavior are unchanged.
