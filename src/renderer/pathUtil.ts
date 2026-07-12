/**
 * Path utilities for renderer code, which cannot use Node's `path` module.
 *
 * Parsing functions (getParentPath, getFileName, splitPath) accept BOTH '/'
 * and '\' separators, because paths can originate from user config, markdown
 * links, or the main process (which uses the native separator of the
 * platform). Joining functions use the platform separator reported by the
 * preload bridge ('\' on Windows, '/' on Linux/macOS).
 */

import { getApi } from './api';

let cachedSep: string | null = null;

/** The platform path separator: '\' on Windows, '/' elsewhere. */
export function pathSep(): string {
  if (cachedSep === null) {
    // Falls back to '/' outside the renderer (e.g. unit tests).
    cachedSep = getApi()?.pathSep ?? '/';
  }
  return cachedSep;
}

/** Index of the last separator ('/' or '\') in the path, or -1 if none. */
function lastSepIndex(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
}

/** True if the path ends with a separator ('/' or '\'). */
export function endsWithSep(path: string): boolean {
  return path.endsWith('/') || path.endsWith('\\');
}

/**
 * The parent folder of a path, without the trailing separator.
 * Returns '' when the path contains no separator (e.g. a bare file name).
 */
export function getParentPath(path: string): string {
  const idx = lastSepIndex(path);
  return idx === -1 ? '' : path.substring(0, idx);
}

/** The last segment of a path (file or folder name). */
export function getFileName(path: string): string {
  return path.substring(lastSepIndex(path) + 1);
}

/**
 * Joins path parts with the platform separator, collapsing duplicate
 * separators at the boundaries. Empty parts are skipped.
 */
export function joinPath(...parts: string[]): string {
  const sep = pathSep();
  let result = '';
  for (const part of parts) {
    if (!part) continue;
    if (!result) {
      result = part;
      continue;
    }
    const left = endsWithSep(result) ? result.slice(0, -1) : result;
    const right = part.startsWith('/') || part.startsWith('\\') ? part.slice(1) : part;
    result = `${left}${sep}${right}`;
  }
  return result;
}

/** Splits a path on either separator. Does not remove empty segments. */
export function splitPath(path: string): string[] {
  return path.split(/[/\\]/);
}

/** Splits a path on either separator, dropping empty segments. */
export function splitPathSegments(path: string): string[] {
  return splitPath(path).filter(Boolean);
}

/** True for rooted paths: '/unix/style', '\\server\share', or 'C:\windows\style'. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[/\\]/.test(path);
}

/** Ensures the path ends with exactly one platform separator. */
export function ensureTrailingSep(path: string): string {
  return endsWithSep(path) ? path : `${path}${pathSep()}`;
}

/**
 * If `path` is `oldRoot` itself or nested inside it (segment-aware, so a
 * sibling like '.../notes-archive' is not affected by moving '.../notes'),
 * return the equivalent path under `newRoot`; otherwise null. The tail is
 * carried over verbatim, keeping whichever separator it already used.
 */
export function remapMovedPath(path: string, oldRoot: string, newRoot: string): string | null {
  const from = oldRoot.replace(/[/\\]+$/, '');
  if (!isPathInside(from, path)) return null;
  return newRoot.replace(/[/\\]+$/, '') + path.substring(from.length);
}

/**
 * True if two paths denote the same location. Separator spelling ('/' vs '\'),
 * repeated separators and trailing separators are all ignored, so '/a/b',
 * '/a/b/' and '\a\b' compare equal. Raw string equality is not enough: paths
 * reach the renderer from several sources (the store, drag payloads, the main
 * process) that do not agree on those details.
 */
export function isSamePath(a: string, b: string): boolean {
  return normalizePathForCompare(a) === normalizePathForCompare(b);
}

/** Strips trailing separators and collapses/normalizes the rest to the platform separator. */
function normalizePathForCompare(path: string): string {
  const sep = pathSep();
  const rooted = isAbsolutePath(path) && !/^[A-Za-z]:/.test(path) ? sep : '';
  return rooted + splitPathSegments(path).join(sep);
}

/**
 * True if `child` is `root` itself or nested inside it, comparing on path-segment
 * boundaries so a sibling like '.../notes-archive' is NOT considered inside
 * '.../notes'. Trailing separators are ignored and either separator is accepted.
 */
export function isPathInside(root: string, child: string): boolean {
  const r = root.replace(/[/\\]+$/, '');
  const c = child.replace(/[/\\]+$/, '');
  if (c === r) return true;
  // Boundary must be a separator so '.../notes-archive' is not "inside" '.../notes'.
  // Accept either separator (paths may mix '/' and '\' regardless of platform).
  return c.startsWith(r) && /[/\\]/.test(c.charAt(r.length));
}
