# Task: Make `stopCalendarWatcher` await the close and avoid the restart race

## Context
- File: `src/utils/calendar/calendarWatcher.ts`
- Functions: `stopCalendarWatcher`, `startCalendarWatcher`

## Problem
`stopCalendarWatcher` fires `close()` but does not await it, and nulls the reference immediately:
```ts
export function stopCalendarWatcher(): void {
  if (currentWatcher) {
    currentWatcher.close()                       // async — not awaited
      .catch((err: unknown) => logger.error('Failed to close calendar watcher:', err));
    currentWatcher = null;                        // cleared before close resolves
    currentFolder = null;
  }
}
```
`chokidar`'s `close()` is asynchronous. Because the function is `void` and clears the reference
synchronously:
1. A subsequent `startCalendarWatcher` (which calls `stopCalendarWatcher` then immediately creates
   a new watcher) can spin up a **new** watcher while the **old** one is still tearing down. The
   two briefly coexist, which can produce duplicate `change`/`add` events for the same file or
   leaked file handles.
2. Callers cannot `await` a clean shutdown (e.g. on app quit or folder switch), so there's no way
   to guarantee the old watcher is fully closed before proceeding.

## Why it matters
The overlap window can cause duplicate calendar updates and resource leaks during folder switches
(a common operation), and there is no reliable way to sequence a clean teardown.

## Proposed solution
1. Make `stopCalendarWatcher` return the close promise:
   ```ts
   export async function stopCalendarWatcher(): Promise<void> {
     if (!currentWatcher) return;
     const watcher = currentWatcher;
     currentWatcher = null;
     currentFolder = null;
     try { await watcher.close(); }
     catch (err) { logger.error('Failed to close calendar watcher:', err); }
   }
   ```
2. Make `startCalendarWatcher` `await stopCalendarWatcher()` before creating the new watcher (this
   makes `start` async — update call sites accordingly), or otherwise serialize start/stop so a new
   watcher is never created until the previous close resolves.

## Verification
- Rapidly switching folders does not produce duplicate calendar events and does not leak watchers.
- App-quit / teardown paths can `await` a guaranteed-clean shutdown.
