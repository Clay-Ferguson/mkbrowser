# Task: Replace hand-rolled front-matter parsing in `calendarUtil.ts` with a robust approach

## Context
- File: `src/utils/calendar/calendarUtil.ts`
- Contrast with: `src/utils/calendar/calendarLoader.ts`, which parses front matter with
  `js-yaml` (`load(...)`) and a `^---\r?\n([\s\S]*?)\r?\n---...` regex.

## Problem
`calendarUtil.ts` detects and edits front matter by hand using:
```ts
content.startsWith('---')
const end = content.indexOf('\n---', 3);
content.slice(3, end);
```
This appears in `hasDueProperty`, `getDueProperty`, `getStartProperty`, `getDurationProperty`,
`setFrontMatterProperty`, `setDueProperty`, and `getFrontMatterParts`. It is fragile:

1. **CRLF**: `indexOf('\n---')` will not find a closing fence written as `\r\n---`. The loader's
   regex explicitly tolerates `\r?\n`; the writer does not, so the two disagree on Windows-style
   line endings.
2. **False fence match**: `indexOf('\n---', 3)` matches the first `\n---` *anywhere* in the
   document, including a `---` that appears in the body (e.g. a horizontal rule or a code block)
   when the real front matter is absent or malformed. There is no requirement that the closing
   fence be on its own line.
3. **Round-trip divergence**: the loader reads with a YAML parser but the util writes with string
   splicing. A value the writer produces may parse differently than intended, and vice versa.

## Why it matters
Reads and writes of the *same* file go through *two different* front-matter parsers with
different rules. That is a recipe for subtle corruption (e.g. an injected property landing in
the body, or CRLF files silently treated as having no front matter).

## Proposed solution
Prefer one of:
- **Reuse the loader's regex** for fence detection in the util too (handle `\r?\n`, anchor the
  closing fence to line start), via a shared helper, so reads and writes agree; **or**
- Adopt a small front-matter library (e.g. `gray-matter`) for both read and write so parsing is
  consistent and YAML-correct.

At minimum, make the util's fence detection CRLF-aware and anchor the closing `---` to the start
of a line (`/^---$/m`-style), matching the loader.

## Verification
- A file with `\r\n` line endings and valid front matter is correctly detected/edited.
- A document with a `---` horizontal rule in the body but no front matter is **not** treated as
  having front matter.
- Reading back a property written by the util yields the same value the loader's YAML parse sees.
