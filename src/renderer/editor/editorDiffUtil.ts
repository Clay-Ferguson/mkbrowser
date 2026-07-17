/**
 * Smallest single replacement turning `old` into `next`: scans the common prefix and
 * suffix so a CodeMirror dispatch only touches the region that actually changed.
 *
 * Replacing the whole document instead would map CodeMirror's scroll anchor (and any
 * selection) to position 0, yanking the editor to the top on every external content
 * sync — and collapse the change into one undo entry spanning the entire file.
 *
 * The suffix scan is capped at `min(old.length, next.length) - prefix` so the prefix
 * and suffix regions never overlap (e.g. "aa" → "aaa" inserts one "a" rather than
 * double-counting the shared runs). For equal inputs the result is an empty insertion
 * at the end of the string — a no-op change.
 */
export function minimalDiff(old: string, next: string): { from: number; to: number; insert: string } {
  let p = 0;
  const maxP = Math.min(old.length, next.length);
  while (p < maxP && old.charCodeAt(p) === next.charCodeAt(p)) p++;
  let s = 0;
  const maxS = Math.min(old.length - p, next.length - p);
  while (s < maxS && old.charCodeAt(old.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
  return { from: p, to: old.length - s, insert: next.slice(p, next.length - s) };
}
