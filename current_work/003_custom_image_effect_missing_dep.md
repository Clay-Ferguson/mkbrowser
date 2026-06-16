# 003 — `CustomImage` effect omits `entryPath` from its dependency array

## Role / Goal
You are working in `mkbrowser`. Make the image-resolution effect honor all of its inputs and satisfy `react-hooks/exhaustive-deps`.

## Affected file
- `src/components/markdownImgResolver.tsx` (inside `createCustomImage` → `CustomImage`)

## Background
```tsx
useEffect(() => {
  ...
  const resolved = await resolveImagePath(entryPath, src);
  ...
}, [src]);   // <-- entryPath is used but not listed
```

The effect reads both `src` (a prop of `CustomImage`) and `entryPath` (captured from the enclosing `createCustomImage` factory), but only `src` is in the dependency array.

## Why it currently "works" but is still wrong
`entryPath` is captured by closure when the factory runs, and `MarkdownView` recreates the component via `useMemo(..., [entryPath])`, so today a change in `entryPath` produces a brand-new component identity that remounts and re-runs the effect. That masks the bug.

However this is fragile:
- It is an `exhaustive-deps` lint violation (suppressed or not, it's a latent correctness hazard).
- If anyone later stabilizes the factory (e.g. memoizes `createCustomImage` by something other than `entryPath`, or reuses the component), the same `<img>` could keep showing an image resolved against a *stale* `entryPath`.

## Proposed solution
Add `entryPath` to the dependency array:

```tsx
}, [src, entryPath]);
```

This is correct regardless of how the component is instantiated and removes the lint violation. Confirm `react-hooks/exhaustive-deps` is clean afterward (the `isMounted` guard and `resolveImagePath` are already handled appropriately).

## Acceptance criteria
- Effect dependency array is `[src, entryPath]`.
- No `exhaustive-deps` warning for this hook.
- Image resolution still updates correctly when either `src` or `entryPath` changes.
