# 008 — Interactive `<span>` elements with `onClick` are not keyboard-accessible

## Role / Goal
You are working in `mkbrowser`. Convert click-handling non-interactive elements into proper interactive controls (or add the missing semantics) so they are operable by keyboard and exposed to assistive tech.

## Affected files
- `src/components/PropsDisplay.tsx` (the property pills and tag pills both attach `onClick` to `<span>`)
- `src/components/PathBreadcrumb.tsx` (the last/"current" breadcrumb segment is a `<span>` that receives `dropProps`; this one is less critical since it isn't click-navigable, but it is the same anti-pattern family — see note)

## Background
`PropsDisplay` renders clickable pills:

```tsx
<span onClick={() => onPropClick?.(key)} className="... cursor-pointer ...">
```
and similarly for tag pills with `onTagClick`.

A bare `<span onClick>` is not focusable, not in the tab order, does not fire on Enter/Space, and is announced as plain text by screen readers. This is the most common React accessibility lint failure (`jsx-a11y/no-static-element-interactions`, `jsx-a11y/click-events-have-key-events`).

## Proposed solution
For genuinely clickable pills (`PropsDisplay` when `onPropClick`/`onTagClick` is provided), prefer a real `<button type="button">`:

```tsx
<button type="button" onClick={() => onPropClick?.(key)} className="...">
```
Reset default button styling via the existing className (these pills already fully control their look). Only render a `<button>` when a handler exists; otherwise render a plain `<span>` (no interactivity, no `cursor-pointer`). This matches the existing conditional `onPropClick ? ' cursor-pointer ...' : ''` logic.

If converting to `<button>` is undesirable for layout reasons, the minimum fix is to add `role="button"`, `tabIndex={0}`, and an `onKeyDown` that triggers the handler on Enter/Space.

For `PathBreadcrumb`'s last segment `<span>`: it is intentionally non-navigable (it's the current folder), so it does not need a click role. Leave its appearance, but be aware it carries `dropProps` (drag/drop) — that is fine on a span and needs no keyboard equivalent.

## Acceptance criteria
- Clickable property/tag pills are reachable via Tab and activate on Enter/Space.
- Non-clickable pills (no handler passed) remain inert and are not focusable.
- No `jsx-a11y` violations for these elements.
