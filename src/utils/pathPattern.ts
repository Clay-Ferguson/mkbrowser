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
