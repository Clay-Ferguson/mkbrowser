# 004 — `CustomPre` duplicates the copy-button block (DRY violation)

## Role / Goal
You are working in `mkbrowser`. Remove duplicated JSX in `CustomPre` so the copy button is defined once.

## Affected file
- `src/components/CustomPre.tsx`

## Background
`CustomPre` returns two different wrappers (one for fenced code with a language, one for plain `<pre>`), and each branch contains a near-identical copy button:

```tsx
<button onClick={handleCopy} className="absolute top-2 right-2 ...">
  {copied ? <ClipboardDocumentCheckIcon .../> : <ClipboardDocumentIcon .../>}
</button>
```

The same ~10 lines appear twice. The only differences are:
- the language branch hides the button when `isMermaid` is true,
- the wrapper `<div>` className differs slightly (`not-prose mb-4` vs none).

## The problem
Duplicated JSX must be edited in two places to stay consistent (styling, accessibility attributes, behavior). This is exactly the kind of drift that causes subtle inconsistencies later.

## Proposed solution
Extract the button into a single local component or a `const copyButton = (...)` element rendered conditionally:

```tsx
const CopyButton = () => (
  <button
    type="button"
    onClick={handleCopy}
    className="absolute top-2 right-2 ..."
    title={copied ? 'Copied!' : 'Copy code'}
    aria-label={copied ? 'Copied' : 'Copy code'}
  >
    {copied ? <ClipboardDocumentCheckIcon className="w-4 h-4 text-green-400" />
            : <ClipboardDocumentIcon className="w-4 h-4" />}
  </button>
);
```

Then render `{!isMermaid && <CopyButton />}` in the language branch and `<CopyButton />` in the plain branch. While here, also add `type="button"` to the button (currently missing — see issue 011) so it never acts as a form submit.

## Acceptance criteria
- The copy button JSX exists in exactly one place.
- Behavior is unchanged: mermaid blocks still have no copy button; all other code blocks and plain `<pre>` blocks still have one.
- Button has `type="button"`.
