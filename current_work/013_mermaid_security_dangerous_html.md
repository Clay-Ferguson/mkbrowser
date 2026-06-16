# 013 — Mermaid renders with `securityLevel: 'loose'` into `dangerouslySetInnerHTML`

## Role / Goal
You are working in `mkbrowser`. Review and tighten the Mermaid rendering path, which currently combines a permissive security level with raw HTML injection.

## Affected file
- `src/components/MermaidDiagram.tsx`

## Background
```tsx
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});
...
return <div ... dangerouslySetInnerHTML={{ __html: svg }} />;
```

`securityLevel: 'loose'` tells Mermaid **not** to sanitize the diagram output: it allows click handlers, `javascript:` links, and arbitrary HTML in node labels. That SVG string is then injected verbatim via `dangerouslySetInnerHTML`.

## The problem / threat model
This app is a markdown *browser* — it renders markdown files the user opens, which may have been authored by someone else (downloaded notes, shared vaults, cloned repos, AI-generated content). A malicious ```mermaid``` block could embed scripts or `javascript:` interactions that execute in the Electron renderer. Depending on this renderer's `nodeIntegration` / `contextIsolation` settings, renderer-side script execution can range from annoying to a path toward local file/system access. Even in a hardened renderer, `securityLevel: 'loose'` is broader than this feature needs.

## Proposed solution
1. **Lower the security level.** Use `securityLevel: 'strict'` (Mermaid's default sanitizes HTML labels and disables interactivity) unless a specific feature requires `'loose'`. If clickable nodes are not a product requirement, `'strict'` is correct.
2. **Defense in depth:** even with a safer security level, run the produced SVG through a sanitizer (e.g. DOMPurify with SVG profile) before `dangerouslySetInnerHTML`. Note the existing `// HACK_BEGIN` width-fixup already string-manipulates the SVG; sanitization would slot in right after that step.
3. Confirm the Electron `BrowserWindow` uses `contextIsolation: true` and `nodeIntegration: false` (this is a renderer-process file; verify in the main-process window creation code). That mitigation is orthogonal but important context.

## Notes
- If `'loose'` is a deliberate product decision (interactive diagrams), document *why* in a comment and ensure the renderer is hardened + SVG sanitized. Do not silently keep `'loose'` without that justification.

## Acceptance criteria
- Mermaid no longer renders untrusted diagrams with full unsanitized HTML/JS unless explicitly justified.
- Valid diagrams still render correctly (including the width-fixup hack).
