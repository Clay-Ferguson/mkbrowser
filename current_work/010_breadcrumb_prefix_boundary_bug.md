# 010 — `PathBreadcrumb` relative-path computation has a prefix-boundary bug

## Role / Goal
You are working in `mkbrowser`. Fix an incorrect `startsWith` check that can mis-compute the relative path when one folder name is a string prefix of another.

## Affected file
- `src/components/PathBreadcrumb.tsx`

## Background
```tsx
const normalizedRoot = rootPath.replace(/[/\\]+$/, '');
const normalizedCurrent = currentPath.replace(/[/\\]+$/, '');
const relativePath = normalizedCurrent.startsWith(normalizedRoot)
  ? normalizedCurrent.slice(normalizedRoot.length)
  : normalizedCurrent;
```

`startsWith` does a raw string prefix test that ignores path-segment boundaries.

## The problem
Consider `rootPath = "/home/user/notes"` and `currentPath = "/home/user/notes-archive/2024"`.

- `normalizedCurrent.startsWith(normalizedRoot)` is `true` (`"/home/user/notes"` is a literal prefix of `"/home/user/notes-archive/..."`).
- `slice(normalizedRoot.length)` yields `"-archive/2024"`.
- `splitPathSegments("-archive/2024")` → `["-archive", "2024"]`, producing a breadcrumb that is wrong, and `buildPathForIndex` will then `joinPath(normalizedRoot, "-archive", ...)` → `"/home/user/notes/-archive"`, a path that does not exist. Clicking it navigates nowhere valid.

This is the classic "sibling directory sharing a name prefix" bug.

## Proposed solution
Only treat `current` as inside `root` when the next character after the prefix is a path separator (or the strings are equal). For example:

```ts
function isInside(root: string, child: string): boolean {
  if (child === root) return true;
  return child.startsWith(root) && /[/\\]/.test(child.charAt(root.length));
}

const relativePath = isInside(normalizedRoot, normalizedCurrent)
  ? normalizedCurrent.slice(normalizedRoot.length)
  : normalizedCurrent;
```

Check whether the repo already has a segment-aware "is path under root" helper in `src/utils/pathUtil.ts` and reuse it if so, rather than adding a new one. Also note that `AppTabButtons.tsx` uses a related fragile comparison (`parent.length >= rootPath.length`) — see issue 014.

## Acceptance criteria
- When `current` is a sibling whose name merely shares a prefix with `root`, the breadcrumb shows the full path (or correctly identifies it is not under root), not a corrupted `"-archive"` segment.
- Normal nested paths under root still render the correct relative breadcrumb.
