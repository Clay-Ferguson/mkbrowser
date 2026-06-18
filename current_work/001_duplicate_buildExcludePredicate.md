# Task: Remove the duplicated `buildExcludePredicate` in `calendarLoader.ts`

## Context
- File: `src/utils/calendar/calendarLoader.ts`
- Related: `src/utils/pathPattern.ts`

## Problem
`calendarLoader.ts` defines its own private `buildExcludePredicate(ignoredPaths)` that
converts wildcard ignore-patterns into anchored, case-insensitive `RegExp` objects and
returns a `(name, fullPath) => boolean` predicate.

This is an almost line-for-line copy of the exported `buildExcludePredicate` in
`src/utils/pathPattern.ts`. The header comment in `pathPattern.ts` explicitly states it is
the **"single source of truth for the regex-escaping and wildcard-matching logic that was
previously duplicated across the search, folder-analysis, folder-graph and calendar-watcher
modules."** The calendar **loader** was evidently missed during that consolidation, so the
duplication that file set out to eliminate still exists here.

Worse, the two copies have **diverged**:
- The local copy inlines its own escape regex `/[.+?^${}()|[\]\\/]/g` — note it escapes `/`,
  which the canonical `escapeRegexExceptWildcard` (`/[.+?^${}()|[\]\\]/g`) does not.
- Any future fix to the shared matching logic (e.g. anchoring, case handling) will silently
  miss the calendar loader.

## Why it matters
Divergent copies of "what counts as ignored" mean the calendar crawl can include/exclude
files differently from the rest of the app, producing confusing, hard-to-reproduce behavior.
It also violates DRY and defeats the stated purpose of `pathPattern.ts`.

## Proposed solution
1. Delete the private `buildExcludePredicate` from `calendarLoader.ts`.
2. Import the canonical one: `import { buildExcludePredicate } from '../pathPattern';`
3. Confirm the call site in `loadCalendarEvents` still works unchanged (same signature
   `(name, fullPath) => boolean`).
4. Verify behavior parity: the canonical version also excludes dot-files and matches against
   both basename and full path, so semantics should be identical apart from the stray `/`
   escaping (which was a no-op in practice).

## Verification
- Type-check passes.
- Crawling a folder with an ignore pattern (e.g. `node_modules`, `*.tmp`) excludes the same
  files as the search/folder-graph features do.
