import { getFileName, getParentPath, isAbsolutePath, joinPath, pathSep, splitPath, splitPathSegments } from './pathUtil';
import { decodeMarkdownUrl, splitHeadingFragment } from '../shared/markdownLinks';
import { isImageFile, isMarkdownFile } from '../shared/fileTypes';
import { stripFileIdSuffix } from '../shared/fileIdSuffix';

// Pure link-syntax helpers live in shared/ so the main process can use them too
// (the folder graph's link scan); re-exported so renderer call sites import them from here.
export { decodeMarkdownUrl, splitHeadingFragment } from '../shared/markdownLinks';

/**
 * True when a markdown link `href` points at a local file or folder (a relative or
 * absolute path, optionally with a `#heading` fragment) rather than a URL with a
 * scheme (`https:`, `file://`, `mailto:`, …) or an in-page `#anchor`. The scheme
 * must be 2+ characters so a Windows drive letter (`C:\…`) still counts as a path.
 */
export function isFileLinkHref(href: string | undefined): boolean {
  if (!href || href.startsWith('#')) return false;
  return !/^[a-z][a-z0-9+.-]+:/i.test(href);
}

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
 * Compute the path of `toPath` relative to the folder `dirPath` itself (rather than to a
 * file's parent, as {@link getRelativePath} does), with forward slashes — e.g. a file's
 * path relative to the browsing root.
 */
export function getPathRelativeToDir(dirPath: string, toPath: string): string {
  return relativePathFromParts({ parts: splitPathSegments(dirPath), root: pathRoot(dirPath) }, toPath);
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
 *
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
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

/**
 * Backslash-escapes square brackets and backslashes in a link label, since an
 * unescaped `]` would end it.
 */
function escapeLinkLabel(label: string): string {
  return label.replace(/[[\]\\]/g, '\\$&');
}

/**
 * The Markdown link to the Markdown file `targetPath` inserted into the file `fromFilePath` by
 * the editor menu's "Paste Link" (see `formatFileLink`) — `[README]( ../a/README.md#usage "id:36F7385CA")`:
 * a relative destination (angle-bracketed or encoded as needed, see `formatLinkDestination`)
 * with an optional heading `fragment`, labelled with `rawLabel` — Markdown label text, used
 * verbatim, so any escapes it carries are kept — or, by default, the file name minus `.md`. A non-empty `id` (the target's front-matter id) rides in the link title, so a
 * broken link can be auto-repaired (linkRepair.ts).
 *
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
 */
export function formatMarkdownFileLink(
  fromFilePath: string,
  targetPath: string,
  id: string,
  fragment: string | null = null,
  rawLabel: string | null = null,
): string {
  const dest = appendLinkFragment(formatLinkDestination(getRelativePath(fromFilePath, targetPath)), fragment ?? '');
  const text = rawLabel ?? escapeLinkLabel(getFileName(targetPath).replace(/\.md$/, ''));
  const title = id ? ` ${formatLinkTitle(`id:${id}`)}` : '';
  return `[${text}](${dest}${title})`;
}

/**
 * The Markdown link to any file or folder `targetPath` inserted into the file `fromFilePath`
 * by the editor menu's "Paste Link": a Markdown file's link as `formatMarkdownFileLink` makes
 * it (carrying `id`), an image as an inline image `![diagram.png](../images/diagram.png)`, and
 * anything else — a folder included — as `[name](../dest)`. `fragment` and `rawLabel` are as
 * for `formatMarkdownFileLink`; a non-Markdown label defaults to the full file or folder name,
 * minus any id it carries (`report--3D6B20DDF.pdf` is labelled `report.pdf`).
 *
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
 */
export function formatFileLink(
  fromFilePath: string,
  targetPath: string,
  isDirectory: boolean,
  id: string,
  fragment: string | null = null,
  rawLabel: string | null = null,
): string {
  const name = getFileName(targetPath);
  if (!isDirectory && isMarkdownFile(name)) return formatMarkdownFileLink(fromFilePath, targetPath, id, fragment, rawLabel);
  const dest = appendLinkFragment(formatLinkDestination(getRelativePath(fromFilePath, targetPath)), fragment ?? '');
  const link = `[${rawLabel ?? escapeLinkLabel(isDirectory ? name : stripFileIdSuffix(name))}](${dest})`;
  return !isDirectory && isImageFile(name) ? `!${link}` : link;
}

/**
 * The link copied by right-clicking a rendered heading: `[Heading Text]( docs/file.md#slug )`,
 * where `relPath` is the file's path relative to the browsing root (so the link is only
 * meaningful to "Paste Link", which re-targets it relative to the file it is pasted into).
 *
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
 */
export function formatHeadingLink(headingText: string, relPath: string, slug: string): string {
  return `[${escapeLinkLabel(headingText)}](${appendLinkFragment(formatLinkDestination(relPath), slug)})`;
}

/** A whole-text inline link: `[label](dest)` or `[label](<dest> "title")`. Group 1 is the raw label, group 2 the raw destination. */
const WHOLE_LINK_RE = /^\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^<>\n]*>|[^\s<]\S*?)(?:\s+"(?:[^"\\]|\\.)*")?\s*\)$/;

/**
 * Reads clipboard text as a file reference and returns the absolute paths it could name,
 * most specific first, with the heading fragment and link label split off; the caller checks
 * which (if any) exists. The text is either a Markdown link — `[Heading]( docs/file.md#slug )`
 * as copied by right-clicking a rendered heading (see `formatHeadingLink`), whose destination
 * is decoded and whose label is kept as written (still escaped) — or a bare path with an optional `#slug` (`label`
 * is then null). Each path is tried as an absolute path (when it is one) and relative to the
 * browsing root `rootPath`. Null for text that can't be either: empty, multi-line, or
 * implausibly long. Pure, for testability.
 *
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
 */
export function clipboardLinkCandidates(
  text: string,
  rootPath: string,
): { paths: string[]; fragment: string | null; label: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4096 || /[\r\n]/.test(trimmed)) return null;

  let dest = trimmed;
  let label: string | null = null;
  const link = WHOLE_LINK_RE.exec(trimmed);
  if (link) {
    label = link[1]!;
    dest = link[2]!.startsWith('<') ? link[2]!.slice(1, -1) : link[2]!;
  }

  const split = splitHeadingFragment(dest);
  const path = link ? decodeMarkdownUrl(split.path) : split.path;
  const paths: string[] = [];
  if (isAbsolutePath(path)) paths.push(path);
  if (rootPath) paths.push(joinPath(rootPath, path));
  return paths.length ? { paths, fragment: split.fragment, label } : null;
}
