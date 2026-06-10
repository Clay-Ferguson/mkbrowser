# Code Audit Findings

**Date:** 2026-06-09
**Scope:** Full source tree (`src/**`, ~134 TS/TSX files, ~26k lines) — Electron main process & IPC layer, React renderer & store, utilities, calendar, and AI integration.

This report lists the most common anti-patterns and concrete bugs found in the codebase, ordered by severity. Every finding was verified against the actual source. A "What's done well" section at the end notes patterns worth keeping (and in one case, reusing as the fix for other findings).

**Severity framing:** mkbrowser is a local, single-user desktop app, so the renderer is largely trusted. The security findings below matter as *defense-in-depth*: they become exploitable only if the renderer is ever compromised through rendered content (e.g., an XSS in markdown/HTML rendering of untrusted files). They are listed as High rather than Critical for that reason.

---

## High severity

## Medium severity

### M3. Error swallowing that returns misleading defaults

- `src/utils/calendar/calendarLoader.ts:205-207`

  ```typescript
  } catch {
    return [];
  }
  ```

  Callers of `loadCalendarEntryForFile` cannot distinguish "file has no calendar events" from "file failed to read/parse" — parse failures silently vanish from the calendar.

- `src/main.ts:214-216`

  ```typescript
  frontMatterFileSaved(filePath, frontMatter, body).catch(() => {
    // errors already logged inside frontMatterFileSaved
  });
  ```

  Fire-and-forget with an empty catch; if the inner logging assumption ever breaks, failures are lost entirely.

**Fix:** At minimum `console.error` with the file path in these catches; ideally surface load failures to the UI.

### M5. Synchronous fs / exec calls on the main-process event loop inside IPC handlers

- `src/utils/launcherUtil.ts:15` — `fs.readFileSync` inside the `run-shell-script` handler.
- `src/utils/launcherUtil.ts:48,90` — `execSync('which …')` in a loop (up to 7 sequential blocking process spawns) to detect a terminal emulator, duplicated in both functions.
- `src/ai/usageTracker.ts:77-98` — `readFileSync`/`writeFileSync` for the usage file.

Each call blocks the main process, which in Electron stalls *all* windows' IPC. Low frequency today, but they're in request paths.

**Fix:** Switch to `fs.promises` and an async `which` check; cache the detected terminal emulator instead of re-probing every call (also de-duplicates the copy-pasted detection loop between `runShellScript` and `runInExternalTerminal`).

---

## Low severity

### L1. Nested `setTimeout` escapes the effect cleanup

**File:** `src/components/views/ThreadView.tsx:149-154`

```typescript
setTimeout(() => {
  const el = mainContainerRef.current;
  if (el) { el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); }
}, 300);
```

The outer timer (line 141) is cleared on unmount, but this inner 300 ms timer is not, so it can fire after unmount. Impact is minimal because the ref is null-checked, but the timer handle should be stored and cleared like the outer one.

### L2. Array index used in React keys

- `src/components/entries/MarkdownEntry.tsx:539` — `key={i}` for column articles. Harmless while columns are derived statically from content, but fragile if that changes.
- `src/components/views/SearchResultsView.tsx:230` — `` key={`${result.path}-${result.lineNumber || 0}-${index}`} `` — appending the index defeats content-identity keying if results are ever filtered or re-sorted in place.

### L3. `as any` casts around LangChain message objects

`src/ai/deepAgent.ts:130,211` and `src/ai/langGraph.ts:84,167,205,269,308` use `(msg as any).additional_kwargs`-style casts. Understandable given LangChain's loose typings, but a small typed helper (`getAdditionalKwargs(msg)`) would confine the unsafety to one place.

---

## Top recommendations (ranked)

1. **Centralize path validation** in the main process: extract the `ai/tools.ts` validate-and-whitelist logic and apply it to every file-path IPC handler (fixes H2, H3).
2. **Eliminate the free-form shell command IPC** (`run-in-external-terminal`) in favor of named, main-process-constructed operations (fixes H1).
3. **Create `src/utils/pathUtil.ts`** with `getParentPath`/`getFileName`/`joinPath` and migrate the 15+ hand-rolled call sites (fixes M1, M2).
4. **Replace sync fs/exec in main-process request paths** with async equivalents and cache the terminal-emulator probe (fixes M5).
