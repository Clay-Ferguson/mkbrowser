# 001 — `node` prop from react-markdown leaks onto DOM elements

## Role / Goal
You are working in the `mkbrowser` Electron + React + TypeScript project. Fix a bug where the internal `node` object that `react-markdown` passes to custom components is being forwarded onto real DOM elements, producing React console warnings and shipping a non-standard attribute to the DOM.

## Affected files
- `src/components/CustomAnchor.tsx`
- `src/components/CustomCode.tsx`
- `src/components/CustomPre.tsx`
- `src/components/markdownImgResolver.tsx` (the `CustomImage` component returned by `createCustomImage`)

## Background / How these are wired
`src/components/entries/MarkdownView.tsx` registers these as react-markdown component overrides, e.g.:

```tsx
a: (props) => <CustomAnchor entryPath={entryPath} {...props} />,
img: createCustomImage(entryPath),
code: CustomCode,
pre: CustomPre,
```

react-markdown (v10 in this project) passes every custom component a `node` prop containing the underlying hast (HTML AST) node, in addition to the normal HTML attributes. None of these components are interested in `node`, but each of them does something like:

```tsx
function CustomAnchor({ href, children, entryPath, ...props }) {
  return <a href={href} ...>{...props}</a>; // props still contains `node`
}
```

Because `node` is not destructured out, it ends up inside `...props` and is spread onto the DOM element (`<a>`, `<code>`, `<pre>`, `<img>`). React then emits a warning similar to:

> Warning: React does not recognize the `node` prop on a DOM element. If you intentionally want it to appear in the DOM as a custom attribute, spell it as lowercase `node` instead.

## The problem
1. Console noise on every markdown render that contains links / code / images.
2. A meaningless `node` attribute may be serialized onto the DOM.
3. It signals that *all* unknown props (not just `node`) are being passed through blindly.

## Reference: the correct pattern already exists in this repo
`src/components/blockClickComponents.tsx` does this correctly:

```tsx
return ({ node, children, ...props }: any) => { ... }
```

It explicitly destructures `node` so it never reaches the DOM. (Note: that file uses `any` — see issue 006 — but its handling of `node` is the model to copy.)

## Proposed solution
In each affected component, explicitly pull `node` out of the props so it cannot be spread onto the DOM element. For example:

```tsx
function CustomAnchor({ href, children, entryPath, node, ...props }: CustomAnchorProps) {
  // `node` intentionally discarded; it is react-markdown's internal hast node.
  ...
}
```

Add `node?: unknown` to each component's prop type (or extend the appropriate react-markdown `ExtraProps`/`Components['a']` type) so TypeScript knows the prop exists. react-markdown exports an `ExtraProps` type that already declares `node`; importing and intersecting with it is the cleanest fix:

```tsx
import type { ExtraProps } from 'react-markdown';
type CustomAnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps & { entryPath: string };
```

Then destructure `node` out in every one of the four components.

## Acceptance criteria
- No `node` attribute appears on rendered `<a>`, `<code>`, `<pre>`, or `<img>` elements.
- No "React does not recognize the `node` prop" warnings when rendering markdown with links, code blocks, and images.
- Type checking (`tsc`) and lint still pass.
