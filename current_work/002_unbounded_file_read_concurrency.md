# Task: Bound the file-read concurrency in `loadCalendarEvents`

## Context
- File: `src/utils/calendar/calendarLoader.ts`
- Function: `loadCalendarEvents`

## Problem
`loadCalendarEvents` crawls a folder with `fdir`, then does:

```ts
const files = await api.withPromise();
const results = await Promise.all(files.map(loadCalendarEntryForFile));
```

`Promise.all(files.map(...))` kicks off a `fs.promises.readFile` for **every** markdown file
in the vault **simultaneously**. There is no concurrency limit. On a large vault (thousands
of `.md` files) this attempts to open thousands of file descriptors at once, which can:
- Hit the OS open-file-descriptor limit and throw `EMFILE: too many open files`.
- Spike memory (all file contents resident at once) and starve the event loop.

This is a latent scalability bug — it works fine on small test folders and fails on real
large knowledge bases, which is exactly the use case for a calendar over a markdown vault.

## Why it matters
A single large-vault user gets a hard failure (`EMFILE`) or severe slowdown on calendar load,
with no graceful degradation. The per-file `try/catch` in `loadCalendarEntryForFile` does not
help because `EMFILE` originates from the sheer number of concurrent opens, not one bad file.

## Proposed solution
Process files with a bounded concurrency pool instead of unbounded `Promise.all`. Options:
1. Add a small dependency such as `p-limit` and wrap each call:
   `const limit = pLimit(32); await Promise.all(files.map(f => limit(() => loadCalendarEntryForFile(f))));`
2. Or implement a tiny worker-pool/`for await` batching helper (process N at a time) to avoid
   a new dependency.

Pick a sensible cap (e.g. 16–64). Keep the existing per-file error isolation.

## Verification
- Generate/point at a folder with ~5,000+ `.md` files and confirm the calendar loads without
  `EMFILE` and with stable memory.
- Result set is identical to the previous implementation (order-independent; callers `.flat()`
  the results).
