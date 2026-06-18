# Task: Validate `rrule` YAML instead of unchecked type assertion in `expandRRule`

## Context
- File: `src/utils/calendar/calendarLoader.ts`
- Functions: `loadCalendarEntryForFile`, `expandRRule`
- Interface: `RRuleYaml`

## Problem
The rrule block is fed into the engine via an unchecked cast:
```ts
if (parsed.rrule && typeof parsed.rrule === 'object' && !Array.isArray(parsed.rrule)) {
  return expandRRule(parsed.rrule as RRuleYaml, ...);
}
```
`parsed` is the result of `js-yaml`'s `load`, typed `Record<string, unknown>`. The
`as RRuleYaml` assertion **asserts a shape that has not been verified**. `RRuleYaml` declares
`interval?: number` and `count?: number`, but YAML lets the user write:
```yaml
rrule:
  freq: weekly
  interval: "2"     # string, not number
  count: abc       # garbage
```
`expandRRule` then passes `interval: rruleYaml.interval ?? 1` and `count: rruleYaml.count`
straight into `new RRule({...})`. A string `interval` ("2") or non-numeric `count` reaches
RRule with the wrong type, producing undefined behavior (NaN math, wrong recurrence, or a
thrown error caught only by the outer try/catch — which then silently drops the whole event).

`freq` is the only field actually validated (via `FREQ_MAP` lookup returning `undefined`).

## Why it matters
The type assertion makes TypeScript *believe* the data is well-typed when it is not, so the
compiler can't help. Malformed user front matter then silently yields wrong or missing
recurrences. This is both a type-safety smell and a latent correctness bug.

## Proposed solution
Add a small runtime validation/coercion step before constructing the rule, e.g.:
```ts
const interval = Number(rruleYaml.interval);
const safeInterval = Number.isInteger(interval) && interval > 0 ? interval : 1;
const count = Number(rruleYaml.count);
const safeCount = Number.isInteger(count) && count > 0 ? count : undefined;
```
Parse/validate `byday` tokens (already partly done via `BYDAY_MAP` + `.filter(Boolean)`) and
`until` (already via the date parser). Consider validating with a schema (e.g. `zod`) if the
project uses one. Avoid the bare `as RRuleYaml` cast; coerce into a validated object.

## Verification
- `interval: "2"` behaves the same as `interval: 2`.
- `count: abc` is ignored (treated as no count) rather than corrupting the rule.
- Valid rrules are unaffected.
