# 009 — `MONO_FONT` constant duplicated, and recreated per render in `TagsPicker`

## Role / Goal
You are working in `mkbrowser`. De-duplicate the monospace font-stack constant and stop recreating it on every render.

## Affected files
- `src/components/PropsDisplay.tsx` (module-level `const MONO_FONT = '...'`)
- `src/components/TagsPicker.tsx` (declares the *same* string, but **inside the component body**)

## Background
Both files contain the identical literal:

```ts
'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
```

In `PropsDisplay` it is a module constant (fine). In `TagsPicker` it is declared inside the function component:

```tsx
export default function TagsPicker(...) {
  ...
  const MONO_FONT = 'ui-monospace, ...';   // recreated every render
  ...
}
```

## The problems
1. **DRY violation across files** — two sources of truth for the same design token. If the font stack changes, two edits are required and can drift.
2. **Recreated each render** in `TagsPicker` — trivial cost, but it's a code-smell and means the value can't be referenced from outside or memoized.

## Proposed solution
Promote the font stack to a single shared location. This repo already has `src/utils/styles.ts` (it exports `CHECKBOX_CLASS`, used by `TagsPicker`). Add:

```ts
// src/utils/styles.ts
export const MONO_FONT_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
```

Then import it in both components and delete the local copies. (Even better long-term: express it as a Tailwind `font-mono` utility / theme token so it lives in CSS, but the shared constant is the minimal correct fix.)

## Acceptance criteria
- The font-stack literal exists in exactly one place.
- `PropsDisplay` and `TagsPicker` both import it; no local re-declarations.
- `TagsPicker` no longer declares the constant inside its render body.
