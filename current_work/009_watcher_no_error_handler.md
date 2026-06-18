# Task: Handle the chokidar `error` event in the calendar watcher

## Context
- File: `src/utils/calendar/calendarWatcher.ts`
- Function: `startCalendarWatcher`

## Problem
The watcher registers handlers for `change`, `add`, `unlink`, and `unlinkDir`, but **not** for
chokidar's `error` event. Chokidar emits `error` for problems such as `ENOSPC` (inotify watch
limit exhausted on Linux), `EPERM`, or the watched root disappearing.

With no `error` listener attached, these failures are at best swallowed and at worst surface as
an unhandled error on the underlying emitter. Either way the user gets no signal that file
watching has silently stopped working, so the calendar quietly goes stale.

## Why it matters
On Linux, hitting the inotify watch limit (`ENOSPC`) is a real and common failure for large
trees. Without an `error` handler the app can't log or react, and the symptom ("calendar stopped
updating") is very hard to diagnose.

## Proposed solution
Attach an error handler that logs via the existing `logger`:
```ts
currentWatcher.on('error', (err: unknown) =>
  logger.error('Calendar watcher error:', err));
```
Optionally surface a user-visible notice for fatal cases (e.g. `ENOSPC`). Use the same `logger`
the module already imports.

## Verification
- Triggering a watcher error (e.g. deleting the watched root, or simulating `ENOSPC`) produces a
  logged error instead of an unhandled emitter error.
