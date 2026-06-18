# Task: De-duplicate the identical `change`/`add` handlers and redundant extension checks

## Context
- File: `src/utils/calendar/calendarWatcher.ts`
- Functions: `startCalendarWatcher`, `buildIgnoredFn`

## Problem
1. The `change` and `add` handlers are **byte-for-byte identical** apart from a comment:
   ```ts
   if (path.extname(filePath).toLowerCase() !== '.md') return;
   loadCalendarEntryForFile(filePath)
     .then(results => onChanged(results, filePath))
     .catch((err: unknown) => logger.error(`Failed to load calendar events for ${filePath}:`, err));
   ```
   This logic is duplicated.

2. The `.md` extension check inside the handlers is **redundant** with `buildIgnoredFn`, which
   already returns `true` (ignore) for any file whose extension is present and not `.md`. The
   double-guard is dead-ish defensive code that obscures which layer is actually responsible for
   extension filtering.

## Why it matters
Duplicated handler bodies drift over time (one gets a fix the other doesn't). Redundant guards
make it unclear where the real filtering happens, which makes the extension policy harder to
reason about (see also `013_*` on the `.md` vs `.markdown` inconsistency).

## Proposed solution
1. Extract a single named handler and bind it to both events:
   ```ts
   const handleUpsert = (filePath: string) => {
     if (path.extname(filePath).toLowerCase() !== '.md') return;
     loadCalendarEntryForFile(filePath)
       .then(results => onChanged(results, filePath))
       .catch((err: unknown) => logger.error(`Failed to load calendar events for ${filePath}:`, err));
   };
   currentWatcher.on('change', handleUpsert);
   currentWatcher.on('add', handleUpsert);
   ```
2. Decide on a single source of truth for extension filtering (the `ignored` predicate) and
   document why the in-handler check is kept (defense-in-depth) or remove it.

## Verification
- `change` and `add` behave identically (one shared function).
- Non-`.md` files still never reach `loadCalendarEntryForFile`.
