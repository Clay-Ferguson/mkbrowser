# Task: Consolidate the two duplicated `M/D/Y` date parsers

## Context
- File: `src/utils/calendar/calendarLoader.ts` — `parseDueDate(dateStr): Date | null`
- File: `src/utils/calendar/calendarUtil.ts` — `parseDueStr(dueStr): Date | undefined`

## Problem
Two functions parse the same `M/D/YYYY` / `M/D/YY` on-disk date format into a local `Date`:
- `parseDueDate` (loader) — `.trim()`s, returns `null` on failure.
- `parseDueStr` (util) — does not trim, returns `undefined` on failure.

They are nearly identical but differ in:
- Null convention (`null` vs `undefined`).
- Whitespace trimming.
- Both share the same rollover bug (see `003_*`).

This is a DRY violation: the same format is parsed by two slightly different implementations,
so any fix (e.g. the validation fix in `003_*`) must be made twice and can drift.

## Why it matters
Two parsers for one format invites inconsistency — e.g. the loader might accept a date the
writer-side rejects, or vice versa. Consolidation also gives a single place to apply the
range-validation fix.

## Proposed solution
1. Create one canonical parser (e.g. keep `parseDueStr` in `calendarUtil.ts`, or move both to a
   small shared module) with a single null convention. Recommend returning `Date | null` and
   trimming input.
2. Have `calendarLoader.ts` import and use it instead of its private `parseDueDate`.
3. Apply the `003_*` range-validation fix once, in the consolidated function.
4. Note: `parseDueDate` is also used to parse the `rrule.until` value in `expandRRule`; make
   sure the shared parser is used there too.

## Verification
- Type-check passes; only one date-parsing implementation remains.
- Both the loader path and the writer/`formatDueDate` round-trip path behave identically.
