# Search Unit Tests — Complete Test Plan

All tests use `searchFolder()` from `src/search.ts` against dynamically generated files in `test-data/`.
Fixture setup is in `tests/fixtures/setup.ts`.

Well, be putting an 'x' in each '[ ]' (bullet point) as it's created to keep track of progress as we build out thest tests.

---

## 1. Literal Content Search (`searchType='literal'`, `searchMode='content'`, `searchBlock='entire-file'`)

Already implemented in `tests/search.test.ts`. Included here for completeness.

- [x] Finds files containing a unique literal string (`ALPHA-DUPLICATE-MARKER` → 3 files)
- [x] Case-insensitive matching (lowercase query finds uppercase content)
- [x] Counts multiple occurrences within a file (`apple` → 7 in repeated.md)
- [x] Results sorted by matchCount descending
- [x] Non-matching files absent from results
- [x] Only searches .md and .txt files (ignores .json, .yaml, .jpg)
- [x] Searches recursively through nested directories
- [x] Returns empty array when no files match
- [x] Handles single-space query without crashing
- [x] Finds matches in .txt files
- [x] Results include both `path` (absolute) and `relativePath`

---

## 2. Wildcard Content Search (`searchType='wildcard'`, `searchMode='content'`, `searchBlock='entire-file'`)

- [x] Basic wildcard: `hel*world` matches `hello world`, `hello_world`, `helloWorld` in wildcard-testing/
- [x] Wildcard at start: `*world` matches files containing words ending in "world"
- [x] Wildcard at end: `hello*` matches words starting with "hello"
- [x] Multiple wildcards: `c*t*mat` matches "cat sat on the mat" (via `c...t...mat`)
- [x] Wildcard 25-char limit: `*` between tokens matches at most 25 chars — construct a case where >25 chars between tokens causes no match
- [x] Case-insensitive: wildcard search is case-insensitive
- [x] Counts multiple wildcard matches in a single file
- [x] No match returns empty array
- [x] Special regex chars in query are escaped (e.g., `$19*` should match `$19.99`)
- [x] Only searches .md and .txt (same file-type filtering as literal)

---

## 3. Advanced Content Search (`searchType='advanced'`, `searchMode='content'`, `searchBlock='entire-file'`)

### 3a. The `$()` content searcher

- [x] Single `$()` call: `$('banana')` finds files containing "banana"
- [x] `$()` is case-insensitive
- [x] Multiple `$()` with AND: `$('React') && $('Node.js')` finds files containing both
- [x] Multiple `$()` with OR: `$('Rust') || $('Go')` finds files containing either
- [x] Negation: `$('search') && !$('wildcard')` — has "search" but not "wildcard"
- [x] `$()` matchCount accumulates across multiple `$()` calls in one expression
- [x] `$()` returns false for non-matching content, matchCount stays 0
- [x] Files without any `$()` match still get matchCount of 1 if expression is truthy (e.g., `true`)

### 3b. Timestamp functions (`ts`, `past`, `future`, `today`)

- [x] `past(ts)` matches files with timestamps in the past (journal entries from 2024, Jan 2026, etc.)
- [x] `past(ts)` does NOT match files with future timestamps (entry-tomorrow.md, entry-far-future.md)
- [x] `past(ts, N)` with lookback days — matches only entries within N days ago
- [x] `future(ts)` matches files with timestamps in the future (entry-tomorrow.md, entry-next-week.md, entry-far-future.md)
- [x] `future(ts)` does NOT match files with past timestamps
- [x] `future(ts, N)` with lookahead days — matches entries within N days ahead but not beyond
- [x] `today(ts)` matches only entry-today.md
- [x] `today(ts)` does NOT match yesterday, tomorrow, or other dated entries
- [x] Files with no timestamp: `ts` is 0, so `past(ts)` and `future(ts)` return false
- [x] `foundTime` field is populated in results when `ts > 0`
- [x] `foundTime` is absent/undefined when file has no timestamp

### 3c. Combining `$()` with timestamp functions

- [x] `$('search') && past(ts)` — files that contain "search" AND have a past timestamp
- [x] `$('FUTURE_MARKER') && future(ts)` — content match + future timestamp
- [x] `today(ts) && $('TODAY_MARKER')` — both conditions

### 3d. Advanced edge cases

- [x] Syntax error in expression returns no matches (doesn't throw)
- [x] Expression that returns a number: nonzero is truthy → match
- [x] Expression that returns a string: non-empty is truthy → match
- [x] Expression `true` matches every file (matchCount = 1 each)
- [x] Expression `false` matches no files

---

## 4. Filename Search (`searchMode='filenames'`)

### 4a. Literal filename search (`searchType='literal'`)

- [x] Finds files by partial name: query `calc` matches `calculus.md`
- [x] Case-insensitive filename match
- [x] Matches folders too (not just files): query `science` matches `topics/science` directory
- [x] Matches file extensions: query `.txt` finds all .txt files
- [x] Only matches basename, not full path (query `topics` matches the `topics` folder but not files inside it unless their name contains "topics")
- [x] Returns modifiedTime and createdTime in results

### 4b. Wildcard filename search (`searchType='wildcard'`)

- [x] `entry-*` matches all journal entry files
- [x] `*.txt` matches all .txt files
- [x] `copy-*` matches all duplicate copy files
- [x] Wildcard is case-insensitive

### 4c. Advanced filename search (`searchType='advanced'`)

- [x] `$('entry')` applied to filenames finds files with "entry" in the name
- [x] Filename search checks all file types, not just .md/.txt

---

## 5. File-Lines Mode (`searchBlock='file-lines'`)

### 5a. Literal file-lines

- [ ] Returns individual line results with `lineNumber` and `lineText`
- [ ] `TARGET_WORD` in known-lines.md: results on lines 2 and 4 specifically
- [ ] `lineNumber` is 1-based
- [ ] `lineText` contains the full text of the matching line
- [ ] Multiple results from the same file have the same `path` and `relativePath`
- [ ] matchCount per line reflects occurrences on that single line
- [ ] `FIND_ME` on line 2 of multi-per-line.md has matchCount=2 (appears twice)
- [ ] `FIND_ME` on line 4 of multi-per-line.md has matchCount=1
- [ ] Non-matching lines are excluded from results

### 5b. Wildcard file-lines

- [ ] Wildcard pattern applied per-line rather than whole file
- [ ] Line results include lineNumber and lineText

### 5c. Advanced file-lines

- [ ] `$()` operates on each individual line, not the whole file
- [ ] Timestamp extraction per-line: only lines containing a date will have `foundTime`

---

## 6. Ignored Paths (`ignoredPaths` parameter)

- [ ] Exact folder name exclusion: `ignoredPaths=['skipme']` excludes `ignored-test/skipme/` subtree
- [ ] Exact file name exclusion: `ignoredPaths=['also-skip.md']` excludes that specific file
- [ ] Wildcard pattern exclusion: `ignoredPaths=['skip*']` excludes `skipme/` folder
- [ ] Multiple ignored paths at once: both folder and file patterns combined
- [ ] Ignored paths apply to both content and filename search modes
- [ ] Ignored paths are case-insensitive
- [ ] Non-excluded files in same parent folder are still found (`visible-file.md` still appears)
- [ ] Empty ignoredPaths array means nothing is excluded

---

## 7. Result Metadata

- [ ] `modifiedTime` is a positive number (milliseconds since epoch)
- [ ] `createdTime` is a positive number
- [ ] `path` is an absolute path
- [ ] `relativePath` is relative to the searched folder root
- [ ] Sorting: results sorted by matchCount descending (verified across all modes)

---

## 8. Edge Cases

- [ ] Empty file (empty.md): content search finds no matches
- [ ] Unicode content: literal search for `café` finds unicode.md
- [ ] Unicode content: literal search for `日本語` finds unicode.md
- [ ] Special regex characters in literal query don't break (e.g., searching for `(H2O)`)
- [ ] Very long query string (100+ chars) doesn't crash
- [ ] Searching a nonexistent folder path returns empty array (or throws gracefully)
- [ ] Searching a folder with no .md/.txt files returns empty for content mode
- [ ] Deeply nested files (3+ directory levels) are found

---

## 9. `createMatchPredicate` Unit Tests (direct function testing)

These test the predicate factory directly without file I/O, for fast isolated validation.

- [ ] Literal predicate: returns correct matchCount for known content string
- [ ] Literal predicate: case-insensitive matching
- [ ] Wildcard predicate: `he*o` matches "hello" but not "hero" (25-char limit is actually generous enough for both — test with tighter boundaries)
- [ ] Wildcard predicate: special chars escaped properly
- [ ] Advanced predicate: `$('test')` on content containing "test" returns matches=true
- [ ] Advanced predicate: syntax error returns matches=false, matchCount=0
- [ ] Advanced predicate: `ts` injection with valid timestamp populates foundTime
- [ ] Advanced predicate: `ts` injection with no timestamp yields foundTime=undefined

---

## 10. `createContentSearcher` Unit Tests (from searchUtil.ts)

- [ ] `$('hello')` returns true when content contains "hello"
- [ ] `$('hello')` returns false when content doesn't contain "hello"
- [ ] Case-insensitive: `$('HELLO')` matches content with "hello"
- [ ] `getMatchCount()` returns 0 before any `$()` calls
- [ ] `getMatchCount()` accumulates across multiple `$()` calls
- [ ] Multiple occurrences: `$('a')` on "aaa" → getMatchCount() returns 3
- [ ] `$('xyz')` returns false and doesn't increment matchCount

---

## 11. Time Utility Unit Tests (from timeUtil.ts)

### `extractTimestamp`

- [ ] Parses `MM/DD/YYYY` format (no time)
- [ ] Parses `MM/DD/YY` format (2-digit year → 2000+)
- [ ] Parses `MM/DD/YYYY HH:MM AM` format
- [ ] Parses `MM/DD/YYYY HH:MM:SS PM` format
- [ ] AM/PM conversion: 12 PM → 12, 12 AM → 0, 1 PM → 13
- [ ] Returns 0 for content with no date
- [ ] Finds first date in multi-line content

### `past`

- [ ] Returns true for a timestamp before now
- [ ] Returns false for a timestamp after now
- [ ] Returns false for timestamp=0
- [ ] With lookbackDays: returns true within window, false outside

### `future`

- [ ] Returns true for a timestamp after now
- [ ] Returns false for a timestamp before now
- [ ] Returns false for timestamp=0
- [ ] With lookaheadDays: returns true within window, false outside

### `today`

- [ ] Returns true for a timestamp matching today's date
- [ ] Returns false for yesterday
- [ ] Returns false for tomorrow
- [ ] Returns false for timestamp=0

---

## Fixture File Summary

All files live in `test-data/` (generated by `tests/fixtures/setup.ts`).

| Directory | Purpose | Count |
|-----------|---------|-------|
| (root) | General: readme, notes, empty, special-chars, unicode | 5 |
| docs/ | Documentation-style files | 5 |
| topics/science/ | Science content | 4 |
| topics/math/ | Math content | 3 |
| topics/programming/ | Programming language guides | 6 |
| journal/ | Timestamped entries (static + dynamic) | 10 |
| projects/ | Project descriptions | 4 |
| recipes/ | Recipe content (variety) | 3 |
| nested/deep/structure/ | Deep nesting | 2 |
| case-testing/ | Case variations | 3 |
| duplicates/ | Identical content files | 3 |
| multi-match/ | Repeated/single/no match | 3 |
| wildcard-testing/ | Wildcard-specific patterns | 5 |
| line-numbers/ | Known-line-number content | 2 |
| ignored-test/ | ignoredPaths testing | 3 |
| images/, data/ | Non-searchable file types | 3 |
| **Total** | | **~64** |

Dynamic files (generated with dates relative to "now" in `setupTestData`):
- `journal/entry-today.md` — today's date
- `journal/entry-yesterday.md` — yesterday
- `journal/entry-tomorrow.md` — tomorrow
- `journal/entry-next-week.md` — +7 days
- `journal/entry-far-future.md` — +365 days
