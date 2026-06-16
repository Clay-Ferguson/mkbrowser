# 006 — `blockClickComponents` uses `any` for component props

## Role / Goal
You are working in `mkbrowser`. Replace the `any`-typed component factory in `blockClickComponents` with proper react-markdown types.

## Affected file
- `src/components/blockClickComponents.tsx`

## Background
```tsx
function block<Tag extends keyof React.JSX.IntrinsicElements>(Tag: Tag) {
  return ({ node, children, ...props }: any) => {
    const line: number = node?.position?.start?.line ?? 0;
    return <Tag {...props} onMouseUp={makeHandler(line)}>{children}</Tag>;
  };
}
```

The returned component is typed `any`, which disables type checking on `node`, `children`, and `props`, and silently allows shape errors. This is a TypeScript best-practice violation (`@typescript-eslint/no-explicit-any`).

Note: this file *correctly* destructures `node` out (good — it is the model for issue 001). The only problem here is the `any`.

## Proposed solution
react-markdown exports an `ExtraProps` type that carries the `node` field. Combine it with the intrinsic element's prop type:

```tsx
import type { ExtraProps } from 'react-markdown';

function block<Tag extends keyof React.JSX.IntrinsicElements>(Tag: Tag) {
  return ({ node, children, ...props }:
            React.JSX.IntrinsicElements[Tag] & ExtraProps) => {
    const line = node?.position?.start?.line ?? 0;
    return <Tag {...props} onMouseUp={makeHandler(line)}>{children}</Tag>;
  };
}
```

If the generic spread fights the type checker, an acceptable fallback is to type the parameter as `React.PropsWithChildren<ExtraProps & Record<string, unknown>>` — still far better than `any` because it preserves `node`'s shape and forbids implicit-any elsewhere.

## Acceptance criteria
- No `any` in the file.
- `node?.position?.start?.line` remains correctly typed (`ExtraProps['node']` is a hast node with `position`).
- `tsc` and lint pass; rendered behavior unchanged.
