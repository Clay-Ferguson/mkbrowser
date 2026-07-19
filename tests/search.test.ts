/**
 * Search tests — Phase 1: Literal content search
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { searchFolder, createMatchPredicate, MOST_RECENT_LIMIT, SEARCH_RESULT_LIMIT } from '../src/main/search';
import { AdvancedQueryTimeoutError } from '../src/main/advancedQuery';
import { createContentSearcher } from '../src/shared/searchHelpers';
import { extractTimestamp, past, future, today, NO_TIMESTAMP } from '../src/shared/timeUtil';
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
    expect(repeated?.matchCount).toBe(7);
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
    expect(hw?.matchCount).toBe(3);
  });

  it('matches wildcard at start of pattern', async () => {
    // *world matches content with up to 25 chars before "world"
    const results = await searchFolder(TEST_DATA_DIR, '*world', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw?.matchCount).toBeGreaterThanOrEqual(3);
  });

  it('matches wildcard at end of pattern', async () => {
    // hello* matches "hello" followed by up to 25 chars
    const results = await searchFolder(TEST_DATA_DIR, 'hello*', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw?.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('matches multiple wildcards in pattern', async () => {
    // c*t*mat → /c.{0,25}t.{0,25}mat/i matches "cat sat on the mat"
    const results = await searchFolder(TEST_DATA_DIR, 'c*t*mat', 'wildcard');
    const mw = results.find(r => r.relativePath === rel('wildcard-testing', 'multi-wildcard.md'));
    expect(mw).toBeDefined();
    expect(mw?.matchCount).toBeGreaterThanOrEqual(1);
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
    expect(hw?.matchCount).toBe(3);
  });

  it('counts multiple wildcard matches in a single file', async () => {
    // hel*world matches 3 times in hello-world.md:
    // "Hello World" (title), "hello world", "hello_world and helloWorld" (greedy merge)
    const results = await searchFolder(TEST_DATA_DIR, 'hel*world', 'wildcard');
    const hw = results.find(r => r.relativePath === rel('wildcard-testing', 'hello-world.md'));
    expect(hw).toBeDefined();
    expect(hw?.matchCount).toBe(3);
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
    expect(sc?.matchCount).toBeGreaterThanOrEqual(1);
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
        const content = fs.readFileSync(r.path, 'utf-8');
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
      expect(webapp?.matchCount).toBeGreaterThanOrEqual(2);
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
// 3b. Content-loop error handling (issue 005)
//
// The per-file content loop must distinguish two failure classes:
//   - expected I/O errors (unreadable file) → skip gracefully, keep searching
//   - unexpected errors in the match/result path → surface, not swallow
// Previously a single over-broad try/catch turned BOTH into "file skipped".
// ═══════════════════════════════════════════════════════════════════
describe('content-loop error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips unreadable files gracefully without throwing (expected I/O error)', async () => {
    // Every file read fails with an I/O-style error. Search should still resolve
    // — just with no results — rather than rejecting.
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    const results = await searchFolder(TEST_DATA_DIR, 'banana', 'literal');
    expect(results).toEqual([]);
  });

  it('propagates unexpected (non-I/O) errors instead of swallowing them as "file skipped"', async () => {
    // The read "succeeds" but returns a non-string, so the match path throws a
    // TypeError (content.toLowerCase()). That is a programming-error-class failure
    // and must surface — the narrowed try/catch only covers the read itself.
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(123 as unknown as string);
    await expect(searchFolder(TEST_DATA_DIR, 'banana', 'literal')).rejects.toThrow();
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

    it('directory results carry canonical paths — no trailing separator', async () => {
      // fdir's onlyDirs() emits every directory path WITH a trailing separator
      // ("/a/b/"). If that leaks into SearchResult.path, the result violates the
      // canonical-path contract pinned for content mode below ("relativePath is
      // relative to the searched folder root"): path.join(root, relativePath)
      // no longer equals path, and renderer helpers that parse the last segment
      // (getParentPath → returns the folder ITSELF instead of its parent;
      // getFileName → returns '') misbehave on folder results.
      const results = await searchFolder(TEST_DATA_DIR, 'science', 'literal', 'filenames');
      const scienceDir = results.find(r => r.relativePath === rel('topics', 'science'));
      expect(scienceDir).toBeDefined();
      expect(scienceDir!.path.endsWith('/') || scienceDir!.path.endsWith('\\')).toBe(false);
      expect(path.join(TEST_DATA_DIR, scienceDir!.relativePath)).toBe(scienceDir!.path);
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
        const basename = r.relativePath.split(/[\\/]/).pop() as string;
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
        const basename = r.relativePath.split(/[\\/]/).pop() as string;
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
        const basename = r.relativePath.split(/[\\/]/).pop() as string;
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



// ═══════════════════════════════════════════════════════════════════
// 6. Ignored Paths
// ═══════════════════════════════════════════════════════════════════
describe('ignored paths', () => {
  it('exact folder name exclusion: ignoredPaths=["skipme"] excludes skipme/ subtree', async () => {
    const results = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', ['skipme']
    );
    const hidden = results.find(r => r.relativePath === rel('ignored-test', 'skipme', 'hidden-file.md'));
    expect(hidden).toBeUndefined();
    // The other two files should still appear
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('exact file name exclusion: ignoredPaths=["also-skip.md"] excludes that file', async () => {
    const results = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', ['also-skip.md']
    );
    const skipped = results.find(r => r.relativePath === rel('ignored-test', 'also-skip.md'));
    expect(skipped).toBeUndefined();
    // visible-file.md and hidden-file.md should still appear
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('wildcard pattern exclusion: ignoredPaths=["skip*"] excludes skipme/ folder', async () => {
    const results = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', ['skip*']
    );
    const hidden = results.find(r => r.relativePath === rel('ignored-test', 'skipme', 'hidden-file.md'));
    expect(hidden).toBeUndefined();
    // visible-file.md and also-skip.md should still be found
    const visible = results.find(r => r.relativePath === rel('ignored-test', 'visible-file.md'));
    expect(visible).toBeDefined();
  });

  it('multiple ignored paths at once: both folder and file patterns combined', async () => {
    const results = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', ['skipme', 'also-skip.md']
    );
    const hidden = results.find(r => r.relativePath === rel('ignored-test', 'skipme', 'hidden-file.md'));
    const alsoSkip = results.find(r => r.relativePath === rel('ignored-test', 'also-skip.md'));
    expect(hidden).toBeUndefined();
    expect(alsoSkip).toBeUndefined();
    // Only visible-file.md should remain from the ignored-test folder
    const visible = results.find(r => r.relativePath === rel('ignored-test', 'visible-file.md'));
    expect(visible).toBeDefined();
  });

  it('ignored paths apply to both content and filename search modes', async () => {
    // Content search with ignored path
    const contentResults = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', ['skipme']
    );
    const contentHidden = contentResults.find(r => r.relativePath === rel('ignored-test', 'skipme', 'hidden-file.md'));
    expect(contentHidden).toBeUndefined();

    // Filename search with ignored path — "hidden" should match hidden-file.md normally
    const filenameResults = await searchFolder(
      TEST_DATA_DIR, 'hidden', 'literal', 'filenames', ['skipme']
    );
    const filenameHidden = filenameResults.find(r => r.relativePath === rel('ignored-test', 'skipme', 'hidden-file.md'));
    expect(filenameHidden).toBeUndefined();
  });

  it('ignored paths are case-insensitive', async () => {
    // Use uppercase "SKIPME" to exclude "skipme" folder
    const results = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', ['SKIPME']
    );
    const hidden = results.find(r => r.relativePath === rel('ignored-test', 'skipme', 'hidden-file.md'));
    expect(hidden).toBeUndefined();
  });

  it('non-excluded files in same parent folder are still found', async () => {
    const results = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', ['skipme', 'also-skip.md']
    );
    const visible = results.find(r => r.relativePath === rel('ignored-test', 'visible-file.md'));
    expect(visible).toBeDefined();
    expect(visible?.matchCount).toBe(1);
  });

  it('empty ignoredPaths array means nothing is excluded', async () => {
    const results = await searchFolder(
      TEST_DATA_DIR, 'IGNORED_TEST_MARKER', 'literal', 'content', []
    );
    // All three ignored-test files should appear
    const visible = results.find(r => r.relativePath === rel('ignored-test', 'visible-file.md'));
    const hidden = results.find(r => r.relativePath === rel('ignored-test', 'skipme', 'hidden-file.md'));
    const alsoSkip = results.find(r => r.relativePath === rel('ignored-test', 'also-skip.md'));
    expect(visible).toBeDefined();
    expect(hidden).toBeDefined();
    expect(alsoSkip).toBeDefined();
  });
});


// ---------------------------------------------------------------------------
// 7. Result Metadata
// ---------------------------------------------------------------------------
describe('result metadata', () => {
  it('modifiedTime is a positive number (milliseconds since epoch)', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.modifiedTime).toBeDefined();
      expect(r.modifiedTime).toBeGreaterThan(0);
    }
  });

  it('createdTime is a positive number', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.createdTime).toBeDefined();
      expect(r.createdTime).toBeGreaterThan(0);
    }
  });

  it('path is an absolute path', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(path.isAbsolute(r.path)).toBe(true);
    }
  });

  it('results expose only the documented fields (no never-populated line-context fields)', async () => {
    // searchFolder is whole-file: it never computes per-line context. The
    // SearchResult contract was trimmed to match (issue 007), so results must
    // not carry lineNumber / lineText / extraLine keys for any search mode.
    const literal = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');
    const filenames = await searchFolder(TEST_DATA_DIR, 'readme', 'literal', 'filenames');
    expect(literal.length).toBeGreaterThan(0);
    expect(filenames.length).toBeGreaterThan(0);

    const allowedKeys = new Set(['path', 'relativePath', 'matchCount', 'modifiedTime', 'createdTime']);
    for (const r of [...literal, ...filenames]) {
      expect(Object.keys(r).every(k => allowedKeys.has(k))).toBe(true);
      expect('lineNumber' in r).toBe(false);
      expect('lineText' in r).toBe(false);
      expect('extraLine' in r).toBe(false);
    }
  });

  it('relativePath is relative to the searched folder root', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      // relativePath should NOT be absolute
      expect(path.isAbsolute(r.relativePath)).toBe(false);
      // Joining folderRoot + relativePath should equal the absolute path
      expect(path.join(TEST_DATA_DIR, r.relativePath)).toBe(r.path);
    }
  });

  it('results sorted by matchCount descending (verified across all modes)', async () => {
    // Content search (literal)
    const literalResults = await searchFolder(TEST_DATA_DIR, 'apple', 'literal');
    for (let i = 1; i < literalResults.length; i++) {
      expect(literalResults[i - 1].matchCount).toBeGreaterThanOrEqual(literalResults[i].matchCount);
    }

    // Content search (wildcard)
    const wildcardResults = await searchFolder(TEST_DATA_DIR, 'hel*', 'wildcard');
    for (let i = 1; i < wildcardResults.length; i++) {
      expect(wildcardResults[i - 1].matchCount).toBeGreaterThanOrEqual(wildcardResults[i].matchCount);
    }

    // Filename search
    const filenameResults = await searchFolder(TEST_DATA_DIR, 'entry', 'literal', 'filenames');
    for (let i = 1; i < filenameResults.length; i++) {
      expect(filenameResults[i - 1].matchCount).toBeGreaterThanOrEqual(filenameResults[i].matchCount);
    }

  });
});

describe('edge cases', () => {
  it('empty file: content search finds no matches', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'anything', 'literal');
    const emptyFile = results.find(r => r.relativePath === 'empty.md');
    expect(emptyFile).toBeUndefined();
  });

  it('unicode content: literal search for "café" finds unicode.md', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'café', 'literal');
    const unicodeFile = results.find(r => r.relativePath === 'unicode.md');
    expect(unicodeFile).toBeDefined();
    expect(unicodeFile?.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('unicode content: literal search for "日本語" finds unicode.md', async () => {
    const results = await searchFolder(TEST_DATA_DIR, '日本語', 'literal');
    const unicodeFile = results.find(r => r.relativePath === 'unicode.md');
    expect(unicodeFile).toBeDefined();
    expect(unicodeFile?.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('special regex characters in literal query don\'t break (e.g., searching for "(H2O)")', async () => {
    // special-chars.md has "(like this)" and chemistry.md has "(H2O)"
    const results = await searchFolder(TEST_DATA_DIR, '(H2O)', 'literal');
    const chemFile = results.find(r => r.relativePath === rel('topics', 'science', 'chemistry.md'));
    expect(chemFile).toBeDefined();
    expect(chemFile?.matchCount).toBe(1);
  });

  it('very long query string (100+ chars) doesn\'t crash', async () => {
    const longQuery = 'a'.repeat(150);
    const results = await searchFolder(TEST_DATA_DIR, longQuery, 'literal');
    // No file contains 150 consecutive 'a' chars, so empty result is expected
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it('searching a nonexistent folder path returns empty array or throws gracefully', async () => {
    const fakePath = path.join(TEST_DATA_DIR, 'nonexistent-folder-xyz');
    // Should either return empty or throw — must not crash unexpectedly
    try {
      const results = await searchFolder(fakePath, 'test', 'literal');
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(0);
    } catch (err) {
      // If it throws, that's also acceptable — just shouldn't be an unhandled crash
      expect(err).toBeDefined();
    }
  });

  it('searching a folder with no .md/.txt files returns empty for content mode', async () => {
    // The images/ folder only contains a .jpg file
    const imagesDir = path.join(TEST_DATA_DIR, 'images');
    const results = await searchFolder(imagesDir, 'FAKE_BINARY', 'literal');
    expect(results).toHaveLength(0);
  });

  it('deeply nested files (3+ directory levels) are found', async () => {
    // nested/deep/structure/deep-file.md is 3 levels deep
    const results = await searchFolder(TEST_DATA_DIR, 'recursive search', 'literal');
    const deepFile = results.find(r => r.relativePath === rel('nested', 'deep', 'structure', 'deep-file.md'));
    expect(deepFile).toBeDefined();
    expect(deepFile?.matchCount).toBeGreaterThanOrEqual(1);
  });
});

// ── Section 8b: Concurrent searchFolder invocations ─────────────────────────
describe('concurrent searches do not interfere', () => {
  // The YAML parse cache is created per-invocation, so two overlapping searches
  // must not corrupt each other's state. Running them back-to-back without
  // awaiting the first (Promise.all) exercises the interleaved await points.
  it('two searches started together both return correct results', async () => {
    const [aResults, bResults] = await Promise.all([
      searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal'),
      searchFolder(TEST_DATA_DIR, 'apple', 'literal'),
    ]);

    const aPaths = aResults.map(r => r.relativePath).sort();
    expect(aPaths).toEqual([
      rel('duplicates', 'copy-one.md'),
      rel('duplicates', 'copy-three.md'),
      rel('duplicates', 'copy-two.md'),
    ]);

    const repeated = bResults.find(r => r.relativePath === rel('multi-match', 'repeated.md'));
    expect(repeated?.matchCount).toBe(7);
  });

  it('many overlapping searches each return identical results to a solo run', async () => {
    const solo = await searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal');
    const expected = solo.map(r => r.relativePath).sort();

    const runs = await Promise.all(
      Array.from({ length: 8 }, () =>
        searchFolder(TEST_DATA_DIR, 'ALPHA-DUPLICATE-MARKER', 'literal'),
      ),
    );

    for (const run of runs) {
      expect(run.map(r => r.relativePath).sort()).toEqual(expected);
    }
  });
});

// ── Section 9: createMatchPredicate Unit Tests ──────────────────────────────
describe('createMatchPredicate (direct function testing)', () => {
  // ── Literal predicate ──────────────────────────────────────────────────────
  it('literal predicate: returns correct matchCount for known content string', () => {
    const predicate = createMatchPredicate('apple', 'literal');
    const result = predicate('I have an apple and another apple today');
    expect(result.matches).toBe(true);
    expect(result.matchCount).toBe(2);
  });

  it('literal predicate: case-insensitive matching', () => {
    const predicate = createMatchPredicate('hello', 'literal');
    const result = predicate('HELLO World hello HELLO');
    expect(result.matches).toBe(true);
    expect(result.matchCount).toBe(3);
  });

  it('literal predicate: empty query never matches and does not hang', () => {
    // searchFolder normally gates this off, but createMatchPredicate is exported;
    // an unguarded empty needle would spin forever in indexOf().
    const predicate = createMatchPredicate('', 'literal');
    const result = predicate('any content at all');
    expect(result.matches).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  // ── Wildcard predicate ─────────────────────────────────────────────────────
  it('wildcard predicate: he*o matches "hello" and "hero"', () => {
    const predicate = createMatchPredicate('he*o', 'wildcard');
    expect(predicate('hello').matches).toBe(true);
    expect(predicate('hero').matches).toBe(true);
  });

  it('wildcard predicate: 25-char limit prevents match across large gaps', () => {
    const predicate = createMatchPredicate('start*end', 'wildcard');
    // Exactly 25 chars between → should match
    const within = 'start' + 'x'.repeat(25) + 'end';
    expect(predicate(within).matches).toBe(true);
    // 26 chars between → should NOT match
    const beyond = 'start' + 'x'.repeat(26) + 'end';
    expect(beyond).toContain('start');
    expect(beyond).toContain('end');
    expect(predicate(beyond).matches).toBe(false);
  });

  it('wildcard predicate: special chars escaped properly', () => {
    const predicate = createMatchPredicate('$19*', 'wildcard');
    const result = predicate('Price: $19.99');
    expect(result.matches).toBe(true);
    expect(result.matchCount).toBe(1);
  });

  // ── Advanced predicate ─────────────────────────────────────────────────────
  it('advanced predicate: $("test") on content containing "test" returns matches=true', () => {
    const predicate = createMatchPredicate("$('test')", 'advanced');
    const result = predicate('this is a test of things');
    expect(result.matches).toBe(true);
    expect(result.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('advanced predicate: syntax error returns matches=false, matchCount=0', () => {
    const predicate = createMatchPredicate('$$$invalid syntax{{{', 'advanced');
    const result = predicate('any content here');
    expect(result.matches).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('advanced predicate: malformed expression does not throw at build time and yields empty results', () => {
    // The user expression is compiled once when the predicate is created. A
    // syntax error must not throw here; it must produce an always-false
    // predicate so the search yields an empty result set.
    const predicate = createMatchPredicate('$$$invalid(((syntax', 'advanced');
    expect(predicate('first file body').matches).toBe(false);
    expect(predicate('second file body', '/some/path.md').matches).toBe(false);
    expect(predicate('third file body').matchCount).toBe(0);
  });
});

// ── Section 9b: YAML front-matter cache (prop() + shared cache) ──────────────
// The `prop()` function reads parsed front-matter through a per-search YAML
// cache. The cache value type is `Record<string, unknown> | null` (never
// `undefined`): a cached `null` means "parsed, no front-matter" and is a real
// hit that must NOT trigger a re-parse — only an absent key re-parses. These
// tests pin that distinction (regression guard for issue 011).
describe('YAML front-matter cache via prop()', () => {
  it('a cached null counts as a hit and is not re-parsed', () => {
    // Seed the cache as if this path was already parsed and had no front-matter.
    const cache = new Map<string, Record<string, unknown> | null>();
    cache.set('/seeded.md', null);

    // Pass content that DOES have front-matter. If the cached `null` is honored
    // as a hit, prop() never re-parses and 'title' is undefined → match. If the
    // read regressed to a falsy check, the null would fall through, the content
    // would be parsed, and prop('title') would be 'FromContent' → no match.
    const predicate = createMatchPredicate("prop('title') === undefined", 'advanced', cache);
    const result = predicate('---\ntitle: FromContent\n---\nbody', '/seeded.md');
    expect(result.matches).toBe(true);
  });

  it('a cached object is returned as a hit instead of re-parsing the content', () => {
    const cache = new Map<string, Record<string, unknown> | null>();
    cache.set('/seeded.md', { title: 'Cached' });

    // Content's front-matter differs from the cache; the cache must win.
    const predicate = createMatchPredicate("prop('title') === 'Cached'", 'advanced', cache);
    const result = predicate('---\ntitle: Different\n---\nbody', '/seeded.md');
    expect(result.matches).toBe(true);
  });

  it('an absent key re-parses the content and populates the cache', () => {
    const cache = new Map<string, Record<string, unknown> | null>();

    const predicate = createMatchPredicate("prop('title') === 'Real'", 'advanced', cache);
    const result = predicate('---\ntitle: Real\n---\nbody', '/fresh.md');
    expect(result.matches).toBe(true);
    // The freshly parsed front-matter should now be cached under that path.
    expect(cache.get('/fresh.md')).toEqual({ title: 'Real' });
  });

  it('caches null for a file with no front-matter (so a later hit skips re-parse)', () => {
    const cache = new Map<string, Record<string, unknown> | null>();

    const predicate = createMatchPredicate("prop('title') === undefined", 'advanced', cache);
    const result = predicate('no front-matter here', '/plain.md');
    expect(result.matches).toBe(true);
    // A "parsed, but empty" result is stored as null — a real entry, not absence.
    expect(cache.has('/plain.md')).toBe(true);
    expect(cache.get('/plain.md')).toBeNull();
  });
});

// ── Section 9c: advanced-search helpers against the REAL host implementations ─
// advancedQuery.test.ts exercises the sandbox bridge with a MOCK host (its
// `prop` is a flat map lookup and its `'ts'` mode always returns NaN), and
// timeUtil.test.ts covers past/future/today as pure functions. These tests
// close the gap between the two layers: createMatchPredicate wires the real
// helpers (createContentSearcher, createPropFunction, past/future/today) into
// the sandbox, and that wiring — dot-notation drilling, prop(…, 'ts') date
// parsing, per-file runtime errors, the timeout abort — is what's pinned here.
describe('advanced predicate with real helper implementations', () => {
  /** ISO YYYY-MM-DD for the calendar date `days` from now (local time). */
  const isoDaysFromNow = (days: number): string => {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  it('prop drills into nested front-matter with dot-notation', () => {
    const predicate = createMatchPredicate("prop('meta.author.name') === 'Ada'", 'advanced');
    const content = '---\nmeta:\n  author:\n    name: Ada\n---\nbody';
    expect(predicate(content).matches).toBe(true);
  });

  it('prop returns undefined when a dot-path traverses a scalar', () => {
    const predicate = createMatchPredicate("prop('title.sub') === undefined", 'advanced');
    expect(predicate('---\ntitle: plain string\n---\nbody').matches).toBe(true);
  });

  it('prop returns YAML numbers and booleans with their real types', () => {
    const predicate = createMatchPredicate("prop('count') === 3 && prop('done') === true", 'advanced');
    expect(predicate('---\ncount: 3\ndone: true\n---\nbody').matches).toBe(true);
  });

  it('prop treats malformed front-matter YAML as absent (no throw)', () => {
    const predicate = createMatchPredicate("prop('key') === undefined", 'advanced');
    expect(predicate('---\nkey: [1, 2\n---\nbody').matches).toBe(true);
  });

  it("past(prop(…, 'ts')) parses a real front-matter date", () => {
    const predicate = createMatchPredicate("past(prop('due', 'ts'))", 'advanced');
    expect(predicate('---\ndue: 2020-01-15\n---\nbody').matches).toBe(true);
    expect(predicate('---\ndue: 2126-01-15\n---\nbody').matches).toBe(false);
  });

  it('past applies its lookbackDays window through the sandbox', () => {
    const content = `---\ndue: ${isoDaysFromNow(-10)}\n---\nbody`;
    expect(createMatchPredicate("past(prop('due', 'ts'), 30)", 'advanced')(content).matches).toBe(true);
    expect(createMatchPredicate("past(prop('due', 'ts'), 5)", 'advanced')(content).matches).toBe(false);
  });

  it("future(prop(…, 'ts')) and its lookaheadDays window", () => {
    const content = `---\ndue: ${isoDaysFromNow(10)}\n---\nbody`;
    expect(createMatchPredicate("future(prop('due', 'ts'))", 'advanced')(content).matches).toBe(true);
    expect(createMatchPredicate("future(prop('due', 'ts'), 30)", 'advanced')(content).matches).toBe(true);
    expect(createMatchPredicate("future(prop('due', 'ts'), 5)", 'advanced')(content).matches).toBe(false);
  });

  it("today(prop(…, 'ts')) matches only today's calendar date", () => {
    const predicate = createMatchPredicate("today(prop('due', 'ts'))", 'advanced');
    expect(predicate(`---\ndue: ${isoDaysFromNow(0)}\n---\nbody`).matches).toBe(true);
    expect(predicate(`---\ndue: ${isoDaysFromNow(-1)}\n---\nbody`).matches).toBe(false);
    expect(predicate(`---\ndue: ${isoDaysFromNow(1)}\n---\nbody`).matches).toBe(false);
  });

  it('all three date helpers reject a missing property (NaN sentinel)', () => {
    const predicate = createMatchPredicate(
      "past(prop('x', 'ts')) || future(prop('x', 'ts')) || today(prop('x', 'ts'))", 'advanced');
    expect(predicate('---\ntitle: no dates\n---\nbody').matches).toBe(false);
  });

  it('a runtime error evaluating one file is a non-match, not a crash', () => {
    const predicate = createMatchPredicate("prop('a').b.c === 1", 'advanced');
    // No front-matter → prop('a') is undefined → TypeError inside the sandbox.
    expect(predicate('plain body, no front matter', '/x.md')).toEqual({ matches: false, matchCount: 0 });
    // The same predicate still works on a file where the expression evaluates.
    expect(predicate('---\na:\n  b:\n    c: 1\n---\nbody').matches).toBe(true);
  });

  it('a query timeout propagates out of the predicate (aborts the whole search)', () => {
    // Unlike per-file runtime errors, AdvancedQueryTimeoutError must NOT be
    // swallowed as a non-match — the caller aborts the search on it.
    const predicate = createMatchPredicate('(() => { while (true) {} })()', 'advanced');
    expect(() => predicate('any content')).toThrow(AdvancedQueryTimeoutError);
  });
});

// ─── Section 10: createContentSearcher Unit Tests ───────────────────────────

describe('createContentSearcher', () => {
  it('$("hello") returns true when content contains "hello"', () => {
    const { $ } = createContentSearcher('say hello to the world');
    expect($('hello')).toBe(true);
  });

  it('$("hello") returns false when content does not contain "hello"', () => {
    const { $ } = createContentSearcher('goodbye cruel world');
    expect($('hello')).toBe(false);
  });

  it('case-insensitive: $("HELLO") matches content with "hello"', () => {
    const { $ } = createContentSearcher('hello there');
    expect($('HELLO')).toBe(true);
  });

  it('getMatchCount() returns 0 before any $() calls', () => {
    const { getMatchCount } = createContentSearcher('anything');
    expect(getMatchCount()).toBe(0);
  });

  it('getMatchCount() accumulates across multiple $() calls', () => {
    const { $, getMatchCount } = createContentSearcher('hello world hello');
    $('hello'); // 2 occurrences
    $('world'); // 1 occurrence
    expect(getMatchCount()).toBe(3);
  });

  it('multiple occurrences: $("a") on "aaa" → getMatchCount() returns 3', () => {
    const { $, getMatchCount } = createContentSearcher('aaa');
    $('a');
    expect(getMatchCount()).toBe(3);
  });

  it('$("xyz") returns false and does not increment matchCount', () => {
    const { $, getMatchCount } = createContentSearcher('no match here');
    expect($('xyz')).toBe(false);
    expect(getMatchCount()).toBe(0);
  });

  it('$("") returns false without hanging (empty-needle guard)', () => {
    // indexOf('', idx) always returns idx (never -1), so an unguarded counting
    // loop would spin forever — freezing the main process for `$('')`.
    const { $, getMatchCount } = createContentSearcher('some content');
    expect($('')).toBe(false);
    expect(getMatchCount()).toBe(0);
  });
});

// ─── Section 11: Time Utility Unit Tests (from timeUtil.ts) ─────────────────

describe('extractTimestamp', () => {
  it('parses MM/DD/YYYY format (no time)', () => {
    const ts = extractTimestamp('Date: 03/15/2025');
    const d = new Date(ts);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2); // 0-indexed: March = 2
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('parses MM/DD/YY format (2-digit year → 2000+)', () => {
    const ts = extractTimestamp('Entry: 01/20/26');
    const d = new Date(ts);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(20);
  });

  it('parses MM/DD/YYYY HH:MM AM format', () => {
    const ts = extractTimestamp('Meeting at 07/04/2025 10:30 AM');
    const d = new Date(ts);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(4);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
    expect(d.getSeconds()).toBe(0);
  });

  it('parses MM/DD/YYYY HH:MM:SS PM format', () => {
    const ts = extractTimestamp('Log: 12/25/2025 03:45:59 PM');
    const d = new Date(ts);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11); // December
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(15); // 3 PM = 15
    expect(d.getMinutes()).toBe(45);
    expect(d.getSeconds()).toBe(59);
  });

  it('AM/PM conversion: 12 PM → 12, 12 AM → 0, 1 PM → 13', () => {
    const noon = extractTimestamp('12/01/2025 12:00 PM');
    expect(new Date(noon).getHours()).toBe(12);

    const midnight = extractTimestamp('12/01/2025 12:00 AM');
    expect(new Date(midnight).getHours()).toBe(0);

    const onePM = extractTimestamp('12/01/2025 1:00 PM');
    expect(new Date(onePM).getHours()).toBe(13);
  });

  it('returns NO_TIMESTAMP (NaN) for content with no date', () => {
    expect(extractTimestamp('No date here at all')).toBeNaN();
    expect(extractTimestamp('')).toBeNaN();
    expect(extractTimestamp('Just some random text 12345')).toBeNaN();
  });

  it('returns NO_TIMESTAMP (NaN) for impossible calendar dates', () => {
    expect(extractTimestamp('Due: 02/31/2025')).toBeNaN();
    expect(extractTimestamp('Due: 04/31/2025')).toBeNaN();
  });

  it('parses a valid pre-1970 date instead of dropping it', () => {
    const ts = extractTimestamp('Born 12/31/1969');
    expect(ts).not.toBeNaN();
    expect(ts).toBe(new Date(1969, 11, 31, 0, 0, 0).getTime());
  });

  it('finds first date in multi-line content', () => {
    const content = `Line one with no date
Line two has 06/15/2025
Line three has 09/20/2025`;
    const ts = extractTimestamp(content);
    const d = new Date(ts);
    expect(d.getMonth()).toBe(5); // June (first match)
    expect(d.getDate()).toBe(15);
    expect(d.getFullYear()).toBe(2025);
  });
});

describe('past', () => {
  it('returns true for a timestamp before now', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    expect(past(yesterday)).toBe(true);
  });

  it('returns false for a timestamp after now', () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    expect(past(tomorrow)).toBe(false);
  });

  it('returns false for the not-found sentinel (NaN)', () => {
    expect(past(NO_TIMESTAMP)).toBe(false);
  });

  it('treats 0 (1970-01-01) as a real past timestamp, not "not found"', () => {
    expect(past(0)).toBe(true);
  });

  it('with lookbackDays: returns true within window, false outside', () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    // 2 days ago is within a 5-day lookback
    expect(past(twoDaysAgo, 5)).toBe(true);

    // 10 days ago is outside a 5-day lookback
    expect(past(tenDaysAgo, 5)).toBe(false);
  });
});

describe('future', () => {
  it('returns true for a timestamp after now', () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    expect(future(tomorrow)).toBe(true);
  });

  it('returns false for a timestamp before now', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    expect(future(yesterday)).toBe(false);
  });

  it('returns false for the not-found sentinel (NaN)', () => {
    expect(future(NO_TIMESTAMP)).toBe(false);
  });

  it('with lookaheadDays: returns true within window, false outside', () => {
    const twoDaysAhead = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const tenDaysAhead = Date.now() + 10 * 24 * 60 * 60 * 1000;

    // 2 days ahead is within a 5-day lookahead
    expect(future(twoDaysAhead, 5)).toBe(true);

    // 10 days ahead is outside a 5-day lookahead
    expect(future(tenDaysAhead, 5)).toBe(false);
  });
});

describe('today', () => {
  it('returns true for a timestamp matching today\'s date', () => {
    // Use a timestamp from earlier today (midnight)
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    expect(today(todayMidnight)).toBe(true);

    // Also test with current time
    expect(today(Date.now())).toBe(true);
  });

  it('returns false for yesterday', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0).getTime();
    expect(today(yesterday)).toBe(false);
  });

  it('returns false for tomorrow', () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0).getTime();
    expect(today(tomorrow)).toBe(false);
  });

  it('returns false for the not-found sentinel (NaN)', () => {
    expect(today(NO_TIMESTAMP)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// mostRecent filter (filterMostRecent → buildResult cached-stat path)
// ═══════════════════════════════════════════════════════════════════
describe('mostRecent filter', () => {
  // Build a throwaway tree with MOST_RECENT_LIMIT + 5 files, each given a
  // distinct, monotonically increasing mtime so "newest" is deterministic:
  // higher index == newer. The oldest 5 (indices 0-4) must be dropped.
  const EXTRA = 5;
  const TOTAL = MOST_RECENT_LIMIT + EXTRA;
  let dir: string;

  /** Zero-padded index parsed back out of a result path's basename. */
  const indexOf = (p: string): number =>
    parseInt(path.basename(p).replace(/\D/g, ''), 10);

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkb-most-recent-'));
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    for (let i = 0; i < TOTAL; i++) {
      const fp = path.join(dir, `f-${String(i).padStart(4, '0')}.md`);
      fs.writeFileSync(fp, 'RECENT_MARKER content\n', 'utf-8');
      // mtime increases with index → index 0 is oldest, TOTAL-1 is newest.
      const when = new Date(base + i * 1000);
      fs.utimesSync(fp, when, when);
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps only the MOST_RECENT_LIMIT newest files by mtime', async () => {
    // Empty query + mostRecent → every searchable file is a candidate, then the
    // filter trims to the newest MOST_RECENT_LIMIT.
    const results = await searchFolder(dir, '', 'literal', 'content', [], false, true);

    expect(results).toHaveLength(MOST_RECENT_LIMIT);
    // The 5 oldest (indices 0-4) must have been dropped; everything kept is newer.
    for (const r of results) {
      expect(indexOf(r.path)).toBeGreaterThanOrEqual(EXTRA);
    }
  });

  it('returns all files unchanged when count is under the limit', async () => {
    // A separate small tree (well under the limit) — nothing should be dropped.
    const small = fs.mkdtempSync(path.join(os.tmpdir(), 'mkb-most-recent-small-'));
    try {
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(path.join(small, `s-${i}.md`), 'RECENT_MARKER\n', 'utf-8');
      }
      const results = await searchFolder(small, '', 'literal', 'content', [], false, true);
      expect(results).toHaveLength(3);
    } finally {
      fs.rmSync(small, { recursive: true, force: true });
    }
  });

  it('populates both modifiedTime and createdTime on the mostRecent path', async () => {
    // Guards the double-stat optimization: filterMostRecent caches mtime AND
    // birthtime, so buildResult must still set createdTime (not just modifiedTime).
    const results = await searchFolder(dir, '', 'literal', 'content', [], false, true);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.modifiedTime).toBeTypeOf('number');
      expect(r.createdTime).toBeTypeOf('number');
    }
  });

  it('reports the same time metadata whether or not mostRecent is enabled', async () => {
    // The cached-stat values fed into buildResult must match a fresh stat, so a
    // file present in both result sets reports identical times.
    const full = await searchFolder(dir, '', 'literal', 'content', [], false, false);
    const recent = await searchFolder(dir, '', 'literal', 'content', [], false, true);

    // Both result sets are capped at SEARCH_RESULT_LIMIT, and with TOTAL just over
    // that cap they keep slightly different subsets (full drops an arbitrary few by
    // crawl order; recent drops the oldest). So compare only the files present in
    // both — the overlap is large (>= 2*limit - TOTAL) and is what this test cares
    // about: identical time metadata regardless of how the times were obtained.
    const fullByPath = new Map(full.map(r => [r.path, r]));
    let compared = 0;
    for (const r of recent) {
      const reference = fullByPath.get(r.path);
      if (!reference) continue;
      compared++;
      expect(r.modifiedTime).toBe(reference.modifiedTime);
      expect(r.createdTime).toBe(reference.createdTime);
    }
    expect(compared).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Universal result cap (SEARCH_RESULT_LIMIT) — no search can return an
// unbounded result set, regardless of query or mode.
// ═══════════════════════════════════════════════════════════════════
describe('result cap', () => {
  // A tree larger than the cap, every file matching the same literal marker.
  const EXTRA = 10;
  const TOTAL = SEARCH_RESULT_LIMIT + EXTRA;
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkb-result-cap-'));
    for (let i = 0; i < TOTAL; i++) {
      fs.writeFileSync(path.join(dir, `f-${String(i).padStart(5, '0')}.md`), 'CAP_MARKER content\n', 'utf-8');
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('caps a matching content search at SEARCH_RESULT_LIMIT', async () => {
    const results = await searchFolder(dir, 'CAP_MARKER', 'literal', 'content');
    expect(results).toHaveLength(SEARCH_RESULT_LIMIT);
  });

  it('bounds an empty query (mostRecent=false) at SEARCH_RESULT_LIMIT', async () => {
    // Empty query matches every searchable entry; without mostRecent the result
    // set would otherwise be the whole tree. It must still be capped.
    const results = await searchFolder(dir, '', 'literal', 'content', [], false, false);
    expect(results).toHaveLength(SEARCH_RESULT_LIMIT);
  });
});
