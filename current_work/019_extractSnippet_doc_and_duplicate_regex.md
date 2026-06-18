# Task: Fix `extractSnippet` doc wording and share its front-matter regex

## Context
- File: `src/utils/calendar/calendarLoader.ts`
- Functions: `extractSnippet`, `extractFrontMatterYaml`
- Interface field: `CalendarEventResult.snippet`

## Problem
Two small issues in the snippet path:

1. **Misleading documentation.** `snippet` is documented as
   `/** First 5 lines (up to 400 chars) of body content after front matter */`, but
   `extractSnippet` filters out blank lines *before* taking 5:
   ```ts
   const lines = body.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 5);
   ```
   So it is actually the **first 5 non-blank lines**, which can pull content from much further
   down the document than "first 5 lines" implies. The comment and behavior disagree.

2. **Duplicated front-matter regex.** `extractSnippet` re-runs essentially the same
   front-matter-stripping regex that `extractFrontMatterYaml` already runs:
   - `extractFrontMatterYaml`: `/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/`
   - `extractSnippet`:         `/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/`
   Both are executed against the full file content in `loadCalendarEntryForFile`, so the front
   matter is matched twice with two copies of the pattern that must be kept in sync.

## Why it matters
The doc/behavior mismatch can mislead callers about what the snippet contains. The duplicated
regex is a DRY issue — if the front-matter grammar ever changes, both copies must change together
or the snippet and the YAML parse will disagree about where the body starts.

## Proposed solution
1. Update the `snippet` doc comment to say "first 5 **non-blank** lines (up to 400 chars) of body
   content after front matter" — or change the code to take the first 5 lines verbatim if that was
   the real intent.
2. Factor the front-matter match into one helper (e.g. `splitFrontMatter(content)` returning
   `{ yaml, body }`) and have both `extractFrontMatterYaml` and `extractSnippet` consume it, so the
   pattern lives in exactly one place. This also dovetails with `005_*`.

## Verification
- The `snippet` comment matches actual behavior.
- Front-matter boundary logic for the snippet/body split exists in a single helper.
- Snippets are unchanged for representative files (or intentionally changed if option 1b chosen).
