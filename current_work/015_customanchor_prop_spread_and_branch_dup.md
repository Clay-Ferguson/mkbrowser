# 015 — `CustomAnchor`: props spread *after* handlers, and duplicated external-URL branches

## Role / Goal
You are working in `mkbrowser`. Tighten `CustomAnchor` so caller-supplied props cannot silently override its event handlers, and collapse duplicated URL-handling branches.

## Affected file
- `src/components/CustomAnchor.tsx`

## Issue A — `{...props}` spread after `onClick`/`onMouseUp`
```tsx
return (
  <a href={href} onClick={handleClick} onMouseUp={(e) => e.stopPropagation()} {...props}>
    {children}
  </a>
);
```
Because `{...props}` is spread **after** the handlers, any `onClick`/`onMouseUp`/`href` arriving in `props` would override the component's own handlers. Today react-markdown is unlikely to pass those, so this is latent rather than actively broken — but the safe convention is to spread incoming props **first**, then set the handlers you must control:

```tsx
<a {...props} href={href} onClick={handleClick} onMouseUp={(e) => e.stopPropagation()}>
```
(Also relevant: `props` currently includes react-markdown's `node` — see issue 001 — which must be destructured out regardless of spread order.)

## Issue B — `http(s)://` and `file://` branches are identical
```tsx
if (href.startsWith('http://') || href.startsWith('https://')) {
  e.preventDefault(); void api.openExternalUrl(href); return;
}
if (href.startsWith('file://')) {
  e.preventDefault(); void api.openExternalUrl(href); return;
}
```
Both do exactly the same thing. Collapse into one condition:
```tsx
if (/^(https?:|file:)\/\//.test(href)) {
  e.preventDefault();
  void api.openExternalUrl(href);
  return;
}
```

## Issue C — minor: `folderPath` fallback
```tsx
const folderPath = getParentPath(targetPath) || targetPath;
```
When `targetPath` has no parent this navigates into the file path itself as if it were a folder. Verify `navigateToBrowserPath(folderPath, targetPath)` tolerates that, or guard the case. Low priority; document the intended behavior if it's deliberate.

## Acceptance criteria
- Component-critical handlers (`onClick`, `onMouseUp`, `href`) cannot be overridden by spread props.
- External `http(s)` and `file` links are handled by a single branch.
- Existing link behavior (external, anchor `#`, relative file navigation) is unchanged.
