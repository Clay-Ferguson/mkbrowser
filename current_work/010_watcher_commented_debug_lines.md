# Task: Remove the commented-out `console.log` debug lines in the calendar watcher

## Context
- File: `src/utils/calendar/calendarWatcher.ts`
- Inside the `change`, `add`, `unlink`, and `unlinkDir` handlers.

## Problem
Each watcher handler begins with a commented-out debug print, e.g.:
```ts
currentWatcher.on('change', (filePath: string) => {
  // console.log("************ onChange: "+filePath);
  ...
```
Similar lines exist for `onAdd`, `onUnlink`, and `onUnlinkDir`. These are dead, commented-out
debugging statements left in the source.

## Why it matters
Commented-out code is noise: it rots, misleads readers about intent, and is exactly what version
control exists to recover. The project also has a structured `logger` (`logUtil.ts`) with a
`debug` level, so ad-hoc `console.log` is not the sanctioned approach anyway.

## Proposed solution
- Delete the commented-out `console.log` lines outright; **or**
- If this tracing is genuinely useful, replace each with a real `logger.debug(...)` call (which
  is gated/structured) rather than a commented `console.log`.

Recommended: delete them — git history preserves them if ever needed.

## Verification
- No commented-out `console.log` remains in the file.
- If converted to `logger.debug`, lint passes (no bare `console` usage).
