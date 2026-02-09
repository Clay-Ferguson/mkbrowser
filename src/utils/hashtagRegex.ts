/**
 * Shared hashtag regex — single source of truth for hashtag pattern matching.
 *
 * Matches `#` followed by a letter, then any combination of letters, digits,
 * underscores, or hyphens. The first character after `#` must be a letter
 * (not a digit), so `#1ab` is NOT a hashtag but `#a1b` is.
 *
 * This module is process-neutral (no Node.js or browser APIs) so it can be
 * imported from both main and renderer code.
 *
 * ⚠️  Because this regex has the `g` flag, callers sharing the same instance
 * must reset `lastIndex = 0` before each use when calling `.exec()` in a loop.
 */
export const HASHTAG_REGEX = /#[a-zA-Z][a-zA-Z0-9_-]*/g;
