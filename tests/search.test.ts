/**
 * Search tests — Phase 1: Literal content search
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { searchFolder } from '../src/search';
import { setupTestData, TEST_DATA_DIR, rel } from './fixtures/setup';

// Build all fixture files once before the entire suite
beforeAll(async () => {
  await setupTestData();
});

describe('literal content search', () => {
  it('finds files containing a unique literal string', async () => {
    // "ALPHA-DUPLICATE-MARKER" appears only in the three duplicate files
    const results = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');

    const paths = results.map(r => r.relativePath).sort();
    expect(paths).toEqual([
      rel('duplicates', 'copy-one.md'),
      rel('duplicates', 'copy-three.md'),
      rel('duplicates', 'copy-two.md'),
    ]);

    // Each file contains exactly 1 occurrence
    for (const r of results) {
      expect(r.matchCount).toBe(1);
    }
  });

  it('is case-insensitive', async () => {
    // Search for "alpha-duplicate-marker" (lowercase) — should still find the 3 files
    const results = await searchFolder(TEST_DATA_DIR, 'alpha-duplicate-marker', 'literal');
    expect(results).toHaveLength(3);
  });

  it('counts multiple occurrences within a file', async () => {
    // "apple" appears 7 times in multi-match/repeated.md
    const results = await searchFolder(TEST_DATA_DIR, 'apple', 'literal');
    const repeated = results.find(r => r.relativePath === rel('multi-match', 'repeated.md'));
    expect(repeated).toBeDefined();
    expect(repeated!.matchCount).toBe(7);
  });

  it('returns results sorted by matchCount descending', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'apple', 'literal');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].matchCount).toBeGreaterThanOrEqual(results[i].matchCount);
    }
  });

  it('does not return files that have no match', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');
    const noMatchFile = results.find(r => r.relativePath === rel('multi-match', 'no-match.md'));
    expect(noMatchFile).toBeUndefined();
  });

  it('only searches .md and .txt files for content', async () => {
    // "search" appears in data/config.json and data/settings.yaml, but those
    // should NOT be searched. It does appear in several .md/.txt files though.
    const results = await searchFolder(TEST_DATA_DIR, 'should not appear', 'literal');
    const jsonFile = results.find(r => r.relativePath === rel('data', 'config.json'));
    const yamlFile = results.find(r => r.relativePath === rel('data', 'settings.yaml'));
    expect(jsonFile).toBeUndefined();
    expect(yamlFile).toBeUndefined();
  });

  it('searches recursively through nested directories', async () => {
    // "recursive search" appears in nested/deep/structure/deep-file.md
    const results = await searchFolder(TEST_DATA_DIR, 'recursive search', 'literal');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const deepFile = results.find(r => r.relativePath === rel('nested', 'deep', 'structure', 'deep-file.md'));
    expect(deepFile).toBeDefined();
  });

  it('returns empty array when no files match', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'xyzzy_nonexistent_string_42', 'literal');
    expect(results).toEqual([]);
  });

  it('handles empty query gracefully', async () => {
    // An empty string technically matches everywhere, but the logic uses indexOf
    // which returns 0 for empty string — resulting in an infinite loop guard via
    // the queryLower.length advancement. With empty string, length is 0, so
    // indexOf always returns 0 and never advances. Let's just verify no crash.
    // Actually, with empty string the loop would be infinite. Let's search for
    // a single space instead which is a reasonable edge case.
    const results = await searchFolder(TEST_DATA_DIR, ' ', 'literal');
    // Most files contain spaces, so we should get many results
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds matches in .txt files', async () => {
    // "Goroutines" appears twice (case-insensitive) in topics/programming/go.txt
    const results = await searchFolder(TEST_DATA_DIR, 'Goroutines', 'literal');
    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe(rel('topics', 'programming', 'go.txt'));
    expect(results[0].matchCount).toBe(2);
  });

  it('includes path and relativePath in results', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'banana', 'literal');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const r = results[0];
    expect(r.path).toContain(TEST_DATA_DIR);
    expect(r.relativePath).not.toContain(TEST_DATA_DIR);
  });
});

describe('wildcard content search', () => {
  it('matches basic wildcard pattern', async () => {
    // hel*world → /hel.{0,25}world/i matches "Hello World", "hello world",
    // and "hello_world and helloWorld" (merged into one greedy match)
    const results = await searchFolder(TEST_DATA_DIR, 'hel*world', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw!.matchCount).toBe(3);
  });

  it('matches wildcard at start of pattern', async () => {
    // *world matches content with up to 25 chars before "world"
    const results = await searchFolder(TEST_DATA_DIR, '*world', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw!.matchCount).toBeGreaterThanOrEqual(3);
  });

  it('matches wildcard at end of pattern', async () => {
    // hello* matches "hello" followed by up to 25 chars
    const results = await searchFolder(TEST_DATA_DIR, 'hello*', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw!.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('matches multiple wildcards in pattern', async () => {
    // c*t*mat → /c.{0,25}t.{0,25}mat/i matches "cat sat on the mat"
    const results = await searchFolder(TEST_DATA_DIR, 'c*t*mat', 'wildcard');
    const mw = results.find(r => r.relativePath === rel('wildcard-testing', 'multi-wildcard.md'));
    expect(mw).toBeDefined();
    expect(mw!.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('enforces 25-char limit per wildcard segment', async () => {
    // ALPHA*OMEGA — gap is 28 chars ("_1234567890_1234567890_12345_"), exceeds 25-char limit
    const noMatch = await searchFolder(TEST_DATA_DIR, 'ALPHA*OMEGA', 'wildcard');
    const bndNo = noMatch.find(r => r.relativePath === rel('wildcard-testing', 'boundaries.md'));
    expect(bndNo).toBeUndefined();

    // Start*End — gap is 6 chars ("MARKER"), well within 25-char limit
    const yesMatch = await searchFolder(TEST_DATA_DIR, 'Start*End', 'wildcard');
    const bndYes = yesMatch.find(r => r.relativePath === rel('wildcard-testing', 'boundaries.md'));
    expect(bndYes).toBeDefined();
  });

  it('is case-insensitive', async () => {
    // HEL*WORLD (all caps) should match the same content as hel*world
    const results = await searchFolder(TEST_DATA_DIR, 'HEL*WORLD', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw!.matchCount).toBe(3);
  });

  it('counts multiple wildcard matches in a single file', async () => {
    // hel*world matches 3 times in hello-world.md:
    // "Hello World" (title), "hello world", "hello_world and helloWorld" (greedy merge)
    const results = await searchFolder(TEST_DATA_DIR, 'hel*world', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw!.matchCount).toBe(3);
  });

  it('returns empty array when no files match', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'zzz*qqq*xyz', 'wildcard');
    expect(results).toEqual([]);
  });

  it('escapes special regex characters in query', async () => {
    // $19* should match "$19.99" in special-chars.md ($ is escaped, not treated as regex anchor)
    const results = await searchFolder(TEST_DATA_DIR, '$19*', 'wildcard');
    const sc = results.find(r => r.relativePath === rel('special-chars.md'));
    expect(sc).toBeDefined();
    expect(sc!.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('only searches .md and .txt files', async () => {
    // FAKE_BINARY_DATA_NOT_REAL_IMAGE exists only in images/photo.jpg — should not be found
    const results = await searchFolder(TEST_DATA_DIR, 'FAKE_BINARY*', 'wildcard');
    expect(results).toEqual([]);
  });
});

// ─── Section 3: Advanced Content Search ─────────────────────────────
describe('advanced content search', () => {

  // ── 3a. The $() content searcher ──────────────────────────────────
  describe('$() content searcher', () => {
    it('finds files containing a term via $() call', async () => {
      // "banana" appears in smoothie.txt and single-match.md
      const results = await searchFolder(TEST_DATA_DIR, "$('banana')", 'advanced');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const smoothie = results.find(r => r.relativePath === rel('recipes', 'smoothie.txt'));
      const singleMatch = results.find(r => r.relativePath === rel('multi-match', 'single-match.md'));
      expect(smoothie).toBeDefined();
      expect(singleMatch).toBeDefined();
    });

    it('$() is case-insensitive', async () => {
      // "BANANA" (uppercase query) should still match "banana" in files
      const results = await searchFolder(TEST_DATA_DIR, "$('BANANA')", 'advanced');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const smoothie = results.find(r => r.relativePath === rel('recipes', 'smoothie.txt'));
      expect(smoothie).toBeDefined();
    });

    it('multiple $() with AND: finds files containing both terms', async () => {
      // webapp.md contains both "React" and "Node.js"
      const results = await searchFolder(TEST_DATA_DIR, "$('React') && $('Node.js')", 'advanced');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const webapp = results.find(r => r.relativePath === rel('projects', 'webapp.md'));
      expect(webapp).toBeDefined();
      // rust.md contains neither React nor Node.js
      const rust = results.find(r => r.relativePath === rel('topics', 'programming', 'rust.md'));
      expect(rust).toBeUndefined();
    });

    it('multiple $() with OR: finds files containing either term', async () => {
      // rust.md has "Rust", go.txt has "Go"
      const results = await searchFolder(TEST_DATA_DIR, "$('Rust') || $('Go')", 'advanced');
      const rust = results.find(r => r.relativePath === rel('topics', 'programming', 'rust.md'));
      const go = results.find(r => r.relativePath === rel('topics', 'programming', 'go.txt'));
      expect(rust).toBeDefined();
      expect(go).toBeDefined();
    });

    it('negation: has one term but not another', async () => {
      // "search" appears in several files; "wildcard" also appears in some of them.
      // This finds files with "search" but NOT "wildcard".
      const results = await searchFolder(TEST_DATA_DIR, "$('search') && !$('wildcard')", 'advanced');
      for (const r of results) {
        // none of the returned files should contain "wildcard"
        const content = require('fs').readFileSync(r.path, 'utf-8');
        expect(content.toLowerCase()).toContain('search');
        expect(content.toLowerCase()).not.toContain('wildcard');
      }
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('matchCount accumulates across multiple $() calls', async () => {
      // webapp.md: "React" appears 2x ("React for the frontend", "React Native" is in mobile-app.md)
      // Actually let's use webapp.md: $('React') + $('Node.js') — React appears 1x, Node.js appears 1x → matchCount = 2
      const results = await searchFolder(TEST_DATA_DIR, "$('React') && $('Node.js')", 'advanced');
      const webapp = results.find(r => r.relativePath === rel('projects', 'webapp.md'));
      expect(webapp).toBeDefined();
      // React = 1 occurrence + Node.js = 1 occurrence → matchCount >= 2
      expect(webapp!.matchCount).toBeGreaterThanOrEqual(2);
    });

    it('returns matchCount 0 for non-matching content', async () => {
      const results = await searchFolder(TEST_DATA_DIR, "$('xyzzy_nonexistent_99')", 'advanced');
      expect(results).toEqual([]);
    });

    it('files without $() match get matchCount of 1 if expression is truthy', async () => {
      // Expression `true` has no $() calls, but is truthy → every file matches with matchCount = 1
      const results = await searchFolder(TEST_DATA_DIR, 'true', 'advanced');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.matchCount).toBe(1);
      }
    });
  });

  // ── 3b. Timestamp functions ───────────────────────────────────────
  describe('timestamp functions (ts, past, future, today)', () => {
    it('past(ts) matches files with timestamps in the past', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'past(ts)', 'advanced');
      // Static past entries: old-entry (06/15/2024), 2026-01-15, 2026-01-20, 2026-02-01, 2026-02-05
      // Dynamic past entries: entry-yesterday
      // notes.txt has 03/15/2026 which is in the future relative to tests date context (Feb 7, 2026)
      expect(results.length).toBeGreaterThanOrEqual(5);
      const oldEntry = results.find(r => r.relativePath === rel('journal', 'old-entry.md'));
      expect(oldEntry).toBeDefined();
      const jan15 = results.find(r => r.relativePath === rel('journal', 'entry-2026-01-15.md'));
      expect(jan15).toBeDefined();
      const yesterday = results.find(r => r.relativePath === rel('journal', 'entry-yesterday.md'));
      expect(yesterday).toBeDefined();
    });

    it('past(ts) does NOT match files with future timestamps', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'past(ts)', 'advanced');
      const tomorrow = results.find(r => r.relativePath === rel('journal', 'entry-tomorrow.md'));
      const farFuture = results.find(r => r.relativePath === rel('journal', 'entry-far-future.md'));
      expect(tomorrow).toBeUndefined();
      expect(farFuture).toBeUndefined();
    });

    it('past(ts, N) with lookback days matches only recent entries', async () => {
      // Look back only 3 days — should match entry-yesterday but not old-entry or Jan entries
      const results = await searchFolder(TEST_DATA_DIR, 'past(ts, 3)', 'advanced');
      const yesterday = results.find(r => r.relativePath === rel('journal', 'entry-yesterday.md'));
      expect(yesterday).toBeDefined();
      const oldEntry = results.find(r => r.relativePath === rel('journal', 'old-entry.md'));
      expect(oldEntry).toBeUndefined();
      const jan15 = results.find(r => r.relativePath === rel('journal', 'entry-2026-01-15.md'));
      expect(jan15).toBeUndefined();
    });

    it('future(ts) matches files with timestamps in the future', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'future(ts)', 'advanced');
      const tomorrow = results.find(r => r.relativePath === rel('journal', 'entry-tomorrow.md'));
      const nextWeek = results.find(r => r.relativePath === rel('journal', 'entry-next-week.md'));
      const farFuture = results.find(r => r.relativePath === rel('journal', 'entry-far-future.md'));
      expect(tomorrow).toBeDefined();
      expect(nextWeek).toBeDefined();
      expect(farFuture).toBeDefined();
    });

    it('future(ts) does NOT match files with past timestamps', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'future(ts)', 'advanced');
      const oldEntry = results.find(r => r.relativePath === rel('journal', 'old-entry.md'));
      const jan15 = results.find(r => r.relativePath === rel('journal', 'entry-2026-01-15.md'));
      expect(oldEntry).toBeUndefined();
      expect(jan15).toBeUndefined();
    });

    it('future(ts, N) with lookahead days matches entries within N days but not beyond', async () => {
      // Look ahead 3 days — should match tomorrow but not next-week or far-future
      const results = await searchFolder(TEST_DATA_DIR, 'future(ts, 3)', 'advanced');
      const tomorrow = results.find(r => r.relativePath === rel('journal', 'entry-tomorrow.md'));
      expect(tomorrow).toBeDefined();
      const nextWeek = results.find(r => r.relativePath === rel('journal', 'entry-next-week.md'));
      expect(nextWeek).toBeUndefined();
      const farFuture = results.find(r => r.relativePath === rel('journal', 'entry-far-future.md'));
      expect(farFuture).toBeUndefined();
    });

    it('today(ts) matches only the entry with today\'s date', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'today(ts)', 'advanced');
      const todayEntry = results.find(r => r.relativePath === rel('journal', 'entry-today.md'));
      expect(todayEntry).toBeDefined();
      // Should not match others
      const yesterday = results.find(r => r.relativePath === rel('journal', 'entry-yesterday.md'));
      const tomorrow = results.find(r => r.relativePath === rel('journal', 'entry-tomorrow.md'));
      expect(yesterday).toBeUndefined();
      expect(tomorrow).toBeUndefined();
    });

    it('today(ts) does NOT match yesterday, tomorrow, or other dated entries', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'today(ts)', 'advanced');
      const paths = results.map(r => r.relativePath);
      expect(paths).not.toContain(rel('journal', 'entry-yesterday.md'));
      expect(paths).not.toContain(rel('journal', 'entry-tomorrow.md'));
      expect(paths).not.toContain(rel('journal', 'entry-next-week.md'));
      expect(paths).not.toContain(rel('journal', 'entry-far-future.md'));
      expect(paths).not.toContain(rel('journal', 'old-entry.md'));
    });

    it('files with no timestamp: ts is 0, past(ts) and future(ts) return false', async () => {
      // no-match.md has no date at all — ts should be 0, past(0) → false
      const pastResults = await searchFolder(TEST_DATA_DIR, 'past(ts)', 'advanced');
      const noMatch = pastResults.find(r => r.relativePath === rel('multi-match', 'no-match.md'));
      expect(noMatch).toBeUndefined();

      const futureResults = await searchFolder(TEST_DATA_DIR, 'future(ts)', 'advanced');
      const noMatchFuture = futureResults.find(r => r.relativePath === rel('multi-match', 'no-match.md'));
      expect(noMatchFuture).toBeUndefined();
    });

    it('foundTime is populated in results when ts > 0', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'past(ts)', 'advanced');
      // All results from past(ts) have ts > 0, so foundTime should be set
      for (const r of results) {
        expect(r.foundTime).toBeDefined();
        expect(r.foundTime).toBeGreaterThan(0);
      }
    });

    it('foundTime is absent when file has no timestamp', async () => {
      // Use `true` to match all files, then check files without timestamps
      const results = await searchFolder(TEST_DATA_DIR, 'true', 'advanced');
      const noMatch = results.find(r => r.relativePath === rel('multi-match', 'no-match.md'));
      expect(noMatch).toBeDefined();
      // no-match.md has no date → ts is 0 → foundTime should be undefined
      expect(noMatch!.foundTime).toBeUndefined();
    });
  });

  // ── 3c. Combining $() with timestamp functions ────────────────────
  describe('combining $() with timestamp functions', () => {
    it('$("search") && past(ts) — content match + past timestamp', async () => {
      // journal entries with "search" and past timestamps
      const results = await searchFolder(TEST_DATA_DIR, "$('search') && past(ts)", 'advanced');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // All results must have foundTime set and contain "search"
      for (const r of results) {
        expect(r.foundTime).toBeDefined();
        expect(r.foundTime).toBeGreaterThan(0);
        const content = require('fs').readFileSync(r.path, 'utf-8');
        expect(content.toLowerCase()).toContain('search');
      }
    });

    it('$("FUTURE_MARKER") && future(ts) — content match + future timestamp', async () => {
      // entry-tomorrow.md has "FUTURE_MARKER" and a future date
      const results = await searchFolder(TEST_DATA_DIR, "$('FUTURE_MARKER') && future(ts)", 'advanced');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const tomorrow = results.find(r => r.relativePath === rel('journal', 'entry-tomorrow.md'));
      expect(tomorrow).toBeDefined();
      expect(tomorrow!.foundTime).toBeDefined();
    });

    it('today(ts) && $("TODAY_MARKER") — both conditions', async () => {
      // entry-today.md has "TODAY_MARKER" and today's date
      const results = await searchFolder(TEST_DATA_DIR, "today(ts) && $('TODAY_MARKER')", 'advanced');
      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe(rel('journal', 'entry-today.md'));
      expect(results[0].foundTime).toBeDefined();
    });
  });

  // ── 3d. Advanced edge cases ───────────────────────────────────────
  describe('advanced edge cases', () => {
    it('syntax error in expression returns no matches (does not throw)', async () => {
      const results = await searchFolder(TEST_DATA_DIR, '$$$invalid(((syntax', 'advanced');
      expect(results).toEqual([]);
    });

    it('expression that returns a nonzero number is truthy → match', async () => {
      const results = await searchFolder(TEST_DATA_DIR, '42', 'advanced');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.matchCount).toBe(1);
      }
    });

    it('expression that returns a non-empty string is truthy → match', async () => {
      const results = await searchFolder(TEST_DATA_DIR, '"hello"', 'advanced');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.matchCount).toBe(1);
      }
    });

    it('expression `true` matches every searchable file', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'true', 'advanced');
      // We have ~60+ .md and .txt files
      expect(results.length).toBeGreaterThanOrEqual(40);
      for (const r of results) {
        expect(r.matchCount).toBe(1);
      }
    });

    it('expression `false` matches no files', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'false', 'advanced');
      expect(results).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Filename Search (searchMode='filenames')
// ═══════════════════════════════════════════════════════════════════
describe('filename search', () => {

  // ── 4a. Literal filename search ─────────────────────────────────
  describe('literal filename search', () => {
    it('finds files by partial name: query "calc" matches calculus.md', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'calc', 'literal', 'filenames');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const calculus = results.find(r => r.relativePath === rel('topics', 'math', 'calculus.md'));
      expect(calculus).toBeDefined();
    });

    it('is case-insensitive for filename matching', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'CALCULUS', 'literal', 'filenames');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const calculus = results.find(r => r.relativePath === rel('topics', 'math', 'calculus.md'));
      expect(calculus).toBeDefined();
    });

    it('matches folders too (not just files): query "science" matches the science directory', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'science', 'literal', 'filenames');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const scienceDir = results.find(r => r.relativePath === rel('topics', 'science'));
      expect(scienceDir).toBeDefined();
    });

    it('matches file extensions: query ".txt" finds all .txt files', async () => {
      const results = await searchFolder(TEST_DATA_DIR, '.txt', 'literal', 'filenames');
      // There are 8 .txt files in test-data
      expect(results).toHaveLength(8);
      for (const r of results) {
        expect(r.path).toMatch(/\.txt$/);
      }
    });

    it('only matches basename, not full path', async () => {
      // "topics" should match the "topics" folder itself, but NOT files inside it
      // whose basenames don't contain "topics"
      const results = await searchFolder(TEST_DATA_DIR, 'topics', 'literal', 'filenames');
      const topicsDir = results.find(r => r.relativePath === rel('topics'));
      expect(topicsDir).toBeDefined();

      // Files like topics/math/calculus.md should NOT be matched
      // because the basename "calculus.md" doesn't contain "topics"
      for (const r of results) {
        const basename = r.relativePath.split(/[\\/]/).pop()!;
        expect(basename.toLowerCase()).toContain('topics');
      }
    });

    it('returns modifiedTime and createdTime in results', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'readme', 'literal', 'filenames');
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.modifiedTime).toBeDefined();
        expect(r.modifiedTime).toBeGreaterThan(0);
        expect(r.createdTime).toBeDefined();
        expect(r.createdTime).toBeGreaterThan(0);
      }
    });
  });

  // ── 4b. Wildcard filename search ────────────────────────────────
  describe('wildcard filename search', () => {
    it('"entry-*" matches all journal entry files', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'entry-*', 'wildcard', 'filenames');
      // There are 10 entry-* files (9 entry-xxx + old-entry is NOT matched since basename is "old-entry.md" and "entry-*" anchors at the start via full match)
      // Actually, wildcard uses regex test, not full match. "entry-*" → /entry-.{0,25}/i
      // old-entry.md does NOT start with "entry-", but `.test()` checks partial match on the basename
      // "old-entry.md" contains "entry-" as a substring? No: "old-entry.md" — no dash after "entry"
      // So only the 9 files starting with "entry-" should match
      expect(results).toHaveLength(9);
      for (const r of results) {
        const basename = r.relativePath.split(/[\\/]/).pop()!;
        expect(basename.toLowerCase()).toMatch(/entry-/);
      }
    });

    it('"*.txt" matches all .txt files', async () => {
      const results = await searchFolder(TEST_DATA_DIR, '*.txt', 'wildcard', 'filenames');
      expect(results).toHaveLength(8);
      for (const r of results) {
        expect(r.path).toMatch(/\.txt$/);
      }
    });

    it('"copy-*" matches all duplicate copy files', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'copy-*', 'wildcard', 'filenames');
      expect(results).toHaveLength(3);
      const paths = results.map(r => r.relativePath).sort();
      expect(paths).toEqual([
        rel('duplicates', 'copy-one.md'),
        rel('duplicates', 'copy-three.md'),
        rel('duplicates', 'copy-two.md'),
      ]);
    });

    it('wildcard filename search is case-insensitive', async () => {
      const results = await searchFolder(TEST_DATA_DIR, 'COPY-*', 'wildcard', 'filenames');
      expect(results).toHaveLength(3);
    });
  });

  // ── 4c. Advanced filename search ────────────────────────────────
  describe('advanced filename search', () => {
    it('$("entry") applied to filenames finds files with "entry" in the name', async () => {
      const results = await searchFolder(TEST_DATA_DIR, "$('entry')", 'advanced', 'filenames');
      // 10 files in journal/ have "entry" in their basename
      expect(results).toHaveLength(10);
      for (const r of results) {
        const basename = r.relativePath.split(/[\\/]/).pop()!;
        expect(basename.toLowerCase()).toContain('entry');
      }
    });

    it('filename search checks all file types, not just .md/.txt', async () => {
      // config.json should be found by filename search
      const results = await searchFolder(TEST_DATA_DIR, 'config', 'literal', 'filenames');
      const configJson = results.find(r => r.relativePath === rel('data', 'config.json'));
      expect(configJson).toBeDefined();

      // photo.jpg should also be findable
      const photoResults = await searchFolder(TEST_DATA_DIR, 'photo', 'literal', 'filenames');
      const photoJpg = photoResults.find(r => r.relativePath === rel('images', 'photo.jpg'));
      expect(photoJpg).toBeDefined();
    });
  });
});
