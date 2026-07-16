/**
 * Process-neutral helpers for escaping text and turning wildcard path patterns
 * into RegExp objects. Single source of truth for the regex-escaping and
 * wildcard-matching logic that was previously duplicated across the search,
 * folder-analysis, folder-graph and calendar-watcher modules.
 *
 * This module must NOT import Node.js or browser/React APIs so it can be
 * bundled into both the main and renderer processes (mirrors hashtagRegex.ts).
 */

/** Characters with special meaning in a regex, including `*`. */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** Same set but WITHOUT `*`, so `*` survives to become a wildcard. */
const REGEX_SPECIAL_EXCEPT_STAR = /[.+?^${}()|[\]\\]/g;

/**
 * Escape a string so it matches literally in a regex (including any `*`).
 * Use this when the input is plain text to be found verbatim.
 */
export function escapeRegexLiteral(str: string): string {
  return str.replace(REGEX_SPECIAL, '\\$&');
}

/**
 * Escape a string but leave `*` intact so it can later be expanded into a
 * wildcard (`*` → some `.`-based pattern by the caller).
 */
export function escapeRegexExceptWildcard(str: string): string {
  return str.replace(REGEX_SPECIAL_EXCEPT_STAR, '\\$&');
}

/**
 * Convert a wildcard pattern (`*` = any run of characters) into an anchored
 * RegExp, e.g. `*.md` → /^.*\.md$/i.
 *
 * @param pattern         wildcard pattern, e.g. "*.md", "temp*", "notes.txt"
 * @param caseInsensitive add the `i` flag (default true)
 */
export function wildcardToAnchoredRegex(pattern: string, caseInsensitive = true): RegExp {
  const body = escapeRegexExceptWildcard(pattern).replace(/\*/g, '.*');
  return new RegExp(`^${body}$`, caseInsensitive ? 'i' : '');
}

/**
 * Convert an array of wildcard path patterns into anchored, case-insensitive
 * RegExp objects suitable for matching file/folder names or full paths.
 */
export function buildIgnoredPatterns(paths: string[]): RegExp[] {
  return paths.map(p => wildcardToAnchoredRegex(p));
}

/**
 * Build the standard exclude predicate shared by the folder crawlers: hidden
 * entries (leading dot) are always excluded, plus anything matching the
 * user-configured ignore patterns (matched against both the basename and the
 * full path). Patterns support `*` wildcards.
 */
export function buildExcludePredicate(
  ignoredPaths: string[],
): (name: string, fullPath: string) => boolean {
  const patterns = buildIgnoredPatterns(ignoredPaths);
  return (name: string, fullPath: string): boolean => {
    // Always exclude hidden files/folders (starting with '.')
    if (name.startsWith('.')) return true;
    return patterns.some(p => p.test(name) || p.test(fullPath));
  };
}

/**
 * Single exclusion predicate shared by the calendar's initial crawl (fdir) and its
 * live watcher (chokidar), so both observe exactly the same set of files — otherwise
 * events load on the initial scan but never live-update (or vice versa).
 *
 * Excludes hidden entries and user ignore patterns (via {@link buildExcludePredicate},
 * anchored, matched against basename and full path). Non-`.md` *files* are excluded,
 * but **directories are always traversable** so their `.md` children are reached — a
 * folder named `notes.2024` has a non-`.md` "extension" and must not be pruned.
 *
 * `isDirectory` is a tri-state: `true`/`false` when known, `undefined` when not (e.g.
 * a watcher pre-stat check where chokidar hasn't provided `stats` yet). When unknown,
 * the extension rule is skipped and the entry is kept, so it is never pruned before it
 * can be identified as a directory.
 */
export function buildCalendarFilter(
  ignoredPaths: string[],
): (name: string, fullPath: string, isDirectory?: boolean) => boolean {
  const shouldExclude = buildExcludePredicate(ignoredPaths);
  return (name: string, fullPath: string, isDirectory?: boolean): boolean => {
    if (shouldExclude(name, fullPath)) return true;
    // Only files are subject to the .md filter; directories and unknowns pass through.
    if (isDirectory === false && !name.toLowerCase().endsWith('.md')) return true;
    return false;
  };
}
