import { isImageFile } from '../shared/fileTypes';
import { getFileName, getParentPath, splitPathSegments } from './pathUtil';

/**
 * Decode a percent-encoded markdown URL back into a filesystem path.
 * Markdown links encode spaces and other special characters (e.g. `%20`),
 * but the on-disk path uses the literal characters, so the URL must be
 * decoded before it can be resolved against the file system. Falls back to
 * the original string if it is not validly encoded.
 */
export function decodeMarkdownUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Compute the path of `toPath` relative to the directory containing `fromFilePath`.
 * Both arguments are absolute paths using either separator. The result always
 * uses forward slashes (markdown URL convention) with `../` segments to climb
 * out of the source directory as needed.
 */
/**
 * Core of {@link getRelativePath}, taking the source directory already split into
 * segments so a caller looping over many `toPath`s can split the (constant) source
 * directory once instead of on every call.
 */
function relativePathFromParts(fromParts: string[], toPath: string): string {
  const toParts = splitPathSegments(toPath);

  // Skip the shared leading path segments.
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i++;
  }

  const ups = fromParts.length - i;
  const segments = [...Array<string>(ups).fill('..'), ...toParts.slice(i)];
  return segments.join('/');
}

export function getRelativePath(fromFilePath: string, toPath: string): string {
  return relativePathFromParts(splitPathSegments(getParentPath(fromFilePath)), toPath);
}

/**
 * Build markdown link text for a set of full paths, made relative to the file
 * being edited. Image files become inline image embeds (`![]()`), everything
 * else becomes a standard link (`[]()`). Items are separated by a blank line.
 */
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

export function buildMarkdownLinks(currentFilePath: string, linkPaths: string[]): string {
  const fromParts = splitPathSegments(getParentPath(currentFilePath));
  return linkPaths
    .map((fullPath) => {
      const name = getFileName(fullPath);
      const relPath = relativePathFromParts(fromParts, fullPath);
      // Percent-encode each path segment so spaces and other special characters
      // don't break the markdown link, while preserving the path separators.
      const url = relPath.split('/').map(encodePathSegment).join('/');
      return isImageFile(name) ? `![${name}](${url})` : `[${name}](${url})`;
    })
    .join('\n\n');
}
