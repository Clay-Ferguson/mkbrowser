import { getParentPath, isAbsolutePath, pathSep, splitPath, splitPathSegments } from './pathUtil';

// Pure link-syntax helpers live in shared/ so the main process can use them too
// (the folder graph's link scan); re-exported so renderer call sites import them from here.
export { decodeMarkdownUrl, splitHeadingFragment } from '../shared/markdownLinks';

/**
 * Resolve a decoded markdown link destination to a filesystem path. An absolute
 * destination is returned as-is; a relative one is resolved against the directory
 * containing `sourceFilePath` (the markdown file the link appears in). Markdown
 * destinations use '/' regardless of platform; the result uses the native separator.
 */
export function resolveLinkPath(sourceFilePath: string, decodedHref: string): string {
  if (isAbsolutePath(decodedHref)) return decodedHref;
  const parts = splitPath(getParentPath(sourceFilePath));
  for (const part of decodedHref.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }
  return parts.join(pathSep());
}

/**
 * The filesystem root a path is anchored to, normalized for comparison: a Windows
 * drive ('c:'), a UNC share ('//server/share'), the POSIX root ('/'), or '' for a
 * relative path. Two paths with different roots have no common ancestor, so no
 * number of '../' segments can get from one to the other.
 */
function pathRoot(path: string): string {
  const driveLetter = /^([A-Za-z]):[/\\]/.exec(path)?.[1];
  if (driveLetter) return `${driveLetter.toLowerCase()}:`;
  if (/^[/\\]{2}/.test(path)) {
    const [server = '', share = ''] = splitPathSegments(path);
    return `//${server.toLowerCase()}/${share.toLowerCase()}`;
  }
  if (/^[/\\]/.test(path)) return '/';
  return '';
}

/** Windows roots (drives, UNC shares) are case-insensitive; POSIX paths are not. */
function isCaseInsensitiveRoot(root: string): boolean {
  return root !== '' && root !== '/';
}

/** The source directory of a relative-path computation, prepared once per source file. */
interface FromDir {
  parts: string[];
  root: string;
}

function toFromDir(fromFilePath: string): FromDir {
  const dir = getParentPath(fromFilePath);
  return { parts: splitPathSegments(dir), root: pathRoot(dir) };
}

/**
 * Compute the path of `toPath` relative to the directory containing `fromFilePath`.
 * Both arguments are absolute paths using either separator. The result always
 * uses forward slashes (markdown URL convention) with `../` segments to climb
 * out of the source directory as needed.
 */
/**
 * Core of {@link getRelativePath}, taking the source directory already split into
 * segments so a caller looping over many `toPath`s can prepare the (constant) source
 * directory once instead of on every call.
 */
function relativePathFromParts(from: FromDir, toPath: string): string {
  // Different roots (e.g. another Windows drive or UNC share) share no common
  // ancestor, so a relative path is impossible — emit the absolute path instead.
  if (pathRoot(toPath) !== from.root) return toPath.replace(/\\/g, '/');

  const toParts = splitPathSegments(toPath);
  const fromParts = from.parts;
  const ignoreCase = isCaseInsensitiveRoot(from.root);
  const key = (segment = '') => (ignoreCase ? segment.toLowerCase() : segment);

  // Skip the shared leading path segments.
  let i = 0;
  while (i < fromParts.length && i < toParts.length && key(fromParts[i]) === key(toParts[i])) {
    i++;
  }

  const ups = fromParts.length - i;
  const segments = [...Array<string>(ups).fill('..'), ...toParts.slice(i)];
  return segments.join('/');
}

export function getRelativePath(fromFilePath: string, toPath: string): string {
  return relativePathFromParts(toFromDir(fromFilePath), toPath);
}

/**
 * Percent-encode one path segment for use inside a markdown link destination.
 * `encodeURIComponent` leaves parentheses literal, and an unbalanced `)` in a
 * file name would terminate the `(...)` destination early, so those are encoded
 * too (`decodeMarkdownUrl` restores them).
 */
function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** True when every `(` in `s` is closed by a later `)` and vice versa. */
function hasBalancedParens(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Format a relative (forward-slash) path as a CommonMark link destination,
 * preferring the most readable form that standard Markdown renderers accept:
 *
 * 1. Bare — `path/to/file.md` — when the path has no whitespace or control
 *    characters and its parentheses are balanced (CommonMark allows both).
 * 2. Angle brackets — `<path/to my/file.md>` — when bare isn't allowed only
 *    because of spaces or unbalanced parentheses; inside `<...>` both are literal.
 * 3. Percent-encoded per segment — `path/to%20my/file.md` — as a last resort,
 *    for characters that would be misread in either literal form: `<`/`>` and
 *    line breaks (illegal inside `<...>`), `\` (starts a backslash escape), `%`
 *    (would be decoded by `decodeMarkdownUrl`), a character-reference-like `&…;`
 *    (decoded by the parser), or a leading `#` (read as an in-page anchor).
 */
export function formatLinkDestination(relPath: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[<>\\%\u0000-\u001f\u007f]|&#?\w+;|^#/.test(relPath)) {
    return relPath.split('/').map(encodePathSegment).join('/');
  }
  if (/\s/.test(relPath) || !hasBalancedParens(relPath)) return `<${relPath}>`;
  return relPath;
}

/**
 * Format `text` as a double-quoted CommonMark link title (`"..."`), the slot that
 * carries a target file's front-matter id: `[label](<dest> "id:3D6B20DDF")`.
 * Backslashes and double quotes are backslash-escaped so they can't end the title.
 */
export function formatLinkTitle(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * Append a heading fragment to a destination produced by `formatLinkDestination`,
 * inside the angle brackets when it has them. The fragment is a GitHub-style heading
 * slug — the same id rehype-slug gives the rendered heading — so it is already free
 * of whitespace and Markdown punctuation and needs no escaping of its own.
 */
export function appendLinkFragment(formattedDest: string, fragment: string): string {
  if (!fragment) return formattedDest;
  return formattedDest.endsWith('>')
    ? `${formattedDest.slice(0, -1)}#${fragment}>`
    : `${formattedDest}#${fragment}`;
}
