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

---

## ADDENDUM (Claude evaluation — 2026-06-17)

I verified the code and **agree the vulnerability is real and still present**: `src/components/MermaidDiagram.tsx:8` sets `securityLevel: 'loose'` and line 117 injects the resulting SVG via `dangerouslySetInnerHTML`. With `'loose'`, Mermaid does not sanitize node labels, so an attacker-authored ```mermaid``` block whose label contains e.g. `<img src=x onerror="...">` inside a foreignObject HTML label executes script on render (setting innerHTML doesn't run `<script>`, but it *does* fire inline event handlers on injected elements). This is a markdown *browser*, so the diagram source is untrusted.

I largely agree with the proposed solution, but I disagree with part of it and want it confirmed before coding. Two factual corrections plus one substantive disagreement:

### 1. The threat model understates the impact (it's worse than "annoying")
The renderer is **not** sandboxed from the filesystem. `src/preload.ts` exposes a broad IPC bridge on `window.electronAPI` including `readFile`, `writeFile`, `createFile`, `deleteFile`, `renameFile`, `writeFileBinary`, and `openExternal`. Renderer-side script execution can call these directly, so a malicious diagram is a path to **arbitrary local file read / write / delete**, not just visual annoyance. This raises the priority of the fix.

### 2. Proposed step 3 (Electron hardening) is already satisfied — no change needed
`src/main.ts:80-81` already sets `contextIsolation: true` and `nodeIntegration: false`. Good defense, but note it does **not** stop the attack above, because the file APIs are deliberately exposed across the context bridge. So hardening alone is insufficient; the `securityLevel` fix is the actual mitigation.

### 3. I agree with `securityLevel: 'strict'` (primary fix) — and it is safe for rendering
`'strict'` HTML-encodes label text and disables click handlers / `javascript:` links. Mermaid still renders labels via `foreignObject` (htmlLabels default stays on), so the `// HACK_BEGIN` width-fixup continues to apply. No interactivity/click features are used anywhere in `src` (only `MermaidDiagram.tsx` touches mermaid), so nothing depends on `'loose'`. **This single change closes the vulnerability** and meets both acceptance criteria.

### 4. I disagree with proposed step 2 (second-pass DOMPurify) as written
The prompt recommends running the produced SVG through DOMPurify as defense-in-depth. I'd hold off / make it conditional, for three reasons:

- **Dependency fragility.** `dompurify` is currently only a *transitive* dependency (pulled in by mermaid — it is **not** declared in `package.json`). Importing it directly relies on a sub-dependency that can disappear on any mermaid version bump. If we use it, we must add it (and its types) as a *direct* dependency first.
- **Redundancy.** Once `securityLevel: 'strict'` is set, Mermaid already runs label content through its own internal DOMPurify pass. A second sanitization of the *final* SVG adds little.
- **Real rendering-breakage risk that I cannot verify in this workflow.** Mermaid embeds a `<style>` block and heavy inline styling inside the SVG, plus XHTML inside `<foreignObject>`. A DOMPurify pass can strip these and silently break *all* diagrams. The acceptance criterion "valid diagrams still render correctly" requires visual confirmation in the running Electron app, which I can't do headlessly here.

**My recommendation:** Implement `securityLevel: 'strict'` now (with a brief comment explaining why) — that alone satisfies the acceptance criteria with near-zero rendering risk. Treat DOMPurify as a *separate, optional* follow-up, done only if (a) `dompurify` + `@types/dompurify` are added as direct dependencies and (b) someone verifies in-app that diagrams + the width hack still render, using `DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true } })`.

Per the workflow, I've stopped here and not coded. Please confirm: **(A)** apply `'strict'` only, **(B)** apply `'strict'` + add DOMPurify properly (declare dep + I'll need you to verify rendering in-app), or **(C)** something else.
