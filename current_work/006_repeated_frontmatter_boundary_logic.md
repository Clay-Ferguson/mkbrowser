# Task: Extract the repeated front-matter boundary detection in `calendarUtil.ts`

## Context
- File: `src/utils/calendar/calendarUtil.ts`

## Problem
The exact same three-line preamble is copy-pasted into at least six functions:
```ts
if (!content.startsWith('---')) return ...;
const end = content.indexOf('\n---', 3);
if (end === -1) return ...;
const frontMatter = content.slice(3, end); // or slice(0, end + 4)
```
It appears in `hasDueProperty`, `getDueProperty`, `getStartProperty`, `getDurationProperty`,
and `setFrontMatterProperty`/`setDueProperty`. The file *already* has a `getFrontMatterParts`
helper that encapsulates this, but it is only used by the `rrule` functions — the rest never
adopted it.

## Why it matters
DRY violation: any change to how the front-matter boundary is computed (e.g. the CRLF fix from
`005_*`) must be applied in 6+ places, and the `slice(3, end)` vs `slice(0, end+4)` variants are
easy to get subtly wrong. The inconsistency also makes the file longer and harder to read than
it needs to be.

## Proposed solution
1. Make every getter/setter route through `getFrontMatterParts` (or a slightly expanded version
   of it). For example:
   ```ts
   export function getDueProperty(content: string): string | null {
     const parts = getFrontMatterParts(content);
     if (!parts) return null;
     const m = parts.fm.match(/^due\s*:\s*(.+)$/m);
     return m ? m[1].trim() : null;
   }
   ```
2. Consider a generic `getScalarProperty(content, key)` to collapse `getDueProperty`,
   `getStartProperty`, and `getDurationProperty` into one parameterized function (they differ
   only by key and the optional surrounding quotes for `start`).
3. Do this together with `005_*` so the consolidated helper is also CRLF-correct.

## Verification
- All getters/setters return the same results as before for representative inputs.
- The boundary-detection code exists in exactly one place.
