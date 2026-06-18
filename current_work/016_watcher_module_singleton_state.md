# Task: Reconsider the module-level singleton state in `calendarWatcher.ts`

## Context
- File: `src/utils/calendar/calendarWatcher.ts`
- Module-level vars: `currentWatcher`, `currentFolder`

## Problem
Watcher state is held in module-level mutable globals:
```ts
let currentWatcher: ReturnType<typeof chokidar.watch> | null = null;
let currentFolder: string | null = null;
```
Consequences:
- **Only one folder can be watched at a time** — a hard architectural limit baked in by the
  singleton, not by any stated requirement.
- **Not unit-testable in isolation** — tests can't instantiate independent watchers; state leaks
  between test cases unless `stopCalendarWatcher` is religiously called.
- **Hidden coupling** — callers interact with implicit global state rather than an object they own.

This is a common Node anti-pattern. It may be an acceptable deliberate choice for this app (there
is presumably one active vault), but it should be a conscious decision, not an accident.

## Why it matters
Module-global mutable state limits future flexibility (multi-vault, split views) and makes the
module awkward to test. Even if the single-watcher constraint is intentional, encapsulating it
improves testability and clarifies ownership.

## Proposed solution (choose based on product needs)
- **Low effort:** Keep the singleton but document explicitly that the design intentionally
  supports exactly one active watcher, and ensure `stop` fully resets state (see `017_*`).
- **Better:** Introduce a `CalendarWatcher` class/factory that owns its `watcher`/`folder`
  state; the app holds one instance. This keeps current behavior while making the module
  testable and allowing multiple instances later.

## Verification
- If refactored to a class: existing call sites compile against the new API and behavior is
  unchanged; a test can create/stop independent instances without shared state.
