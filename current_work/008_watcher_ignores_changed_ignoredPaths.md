# Task: Restart the calendar watcher when `ignoredPaths` changes (not just the folder)

## Context
- File: `src/utils/calendar/calendarWatcher.ts`
- Function: `startCalendarWatcher`

## Problem
The guard at the top of `startCalendarWatcher` is:
```ts
if (currentFolder === folderPath && currentWatcher !== null) return;
```
It only compares the **folder path**. If the caller invokes `startCalendarWatcher` with the
**same folder but a different `ignoredPaths`** array (e.g. the user edits their ignore patterns
in settings), the function early-returns and the watcher keeps using the **old** ignore rules.
The new patterns silently never take effect until the folder itself changes or the app restarts.

## Why it matters
Changing ignore patterns is a normal user action. Silently not honoring it is a confusing bug:
the calendar keeps surfacing (or keeps hiding) files the user just told it to stop (or start)
watching, with no feedback.

## Proposed solution
Include the ignore configuration in the "already watching the same thing" check. For example,
store the last-used patterns and compare:
```ts
const sameIgnores = currentIgnored !== null &&
  currentIgnored.length === ignoredPaths.length &&
  currentIgnored.every((p, i) => p === ignoredPaths[i]);
if (currentFolder === folderPath && currentWatcher !== null && sameIgnores) return;
```
Persist `currentIgnored = ignoredPaths` alongside `currentFolder` when (re)starting, and clear
it in `stopCalendarWatcher`.

## Verification
- Calling `startCalendarWatcher` with the same folder but new patterns rebuilds the watcher and
  the new patterns take effect.
- Calling it twice with identical folder + identical patterns still no-ops (no needless restart).
