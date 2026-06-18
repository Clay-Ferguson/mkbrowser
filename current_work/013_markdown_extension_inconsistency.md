# Task: Reconcile `.md` vs `.md`/`.markdown` extension handling across the calendar modules

## Context
- File: `src/utils/calendar/calendarUtil.ts` — `isMarkdownFile`
- File: `src/utils/calendar/calendarLoader.ts` — `loadCalendarEvents` filter
- File: `src/utils/calendar/calendarWatcher.ts` — `buildIgnoredFn` + handler guards

## Problem
The three modules disagree on what counts as a markdown file:
- `isMarkdownFile` (util) accepts **both** `.md` and `.markdown`:
  ```ts
  return fileName.toLowerCase().endsWith('.md') || fileName.toLowerCase().endsWith('.markdown');
  ```
- The loader only accepts `.md`: `path.extname(filePath).toLowerCase() === '.md'`.
- The watcher only accepts `.md` (both in `buildIgnoredFn` — `ext && ext !== '.md'` — and in the
  per-handler guards).

So a `.markdown` file is "markdown" by one helper but is **invisible** to the calendar loader
and watcher. A user with `.markdown` files would have them recognized in some parts of the app
but never appear on the calendar and never trigger watch updates.

## Why it matters
Inconsistent extension policy leads to "why isn't my file showing up?" bugs that are very hard
to track down because the answer depends on which code path touched the file.

## Solution to Implement
We should only consider ".md" files to be markdown. Any file with ".markdown" extension is considered an unknown file type, and handled like all other unknown file types.


## Verification
- A `.markdown` file is treated identically by `isMarkdownFile`, the loader, and the watcher.
- Decide and document the supported extension set in one place.
