/**
 * Path utilities for renderer code, which cannot use Node's `path` module.
 *
 * Parsing functions (getParentPath, getFileName, splitPath) accept BOTH '/'
 * and '\' separators, because paths can originate from user config, markdown
 * links, or the main process (which uses the native separator of the
 * platform). Joining functions use the platform separator reported by the
 * preload bridge ('\' on Windows, '/' on Linux/macOS).
 */

import { getApi } from '../services/api';

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
