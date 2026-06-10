import { isImageFile } from './fileUtil';
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
export function getRelativePath(fromFilePath: string, toPath: string): string {
  const fromDir = getParentPath(fromFilePath);
  const fromParts = splitPathSegments(fromDir);
  const toParts = splitPathSegments(toPath);

  // Skip the shared leading path segments.
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i++;
  }

  const ups = fromParts.length - i;
  const segments = [...Array(ups).fill('..'), ...toParts.slice(i)];
  return segments.join('/');
}

/**
 * Build markdown link text for a set of full paths, made relative to the file
 * being edited. Image files become inline image embeds (`![]()`), everything
 * else becomes a standard link (`[]()`). Items are separated by a blank line.
 */
export function buildMarkdownLinks(currentFilePath: string, linkPaths: string[]): string {
  return linkPaths
    .map((fullPath) => {
      const name = getFileName(fullPath);
      const relPath = getRelativePath(currentFilePath, fullPath);
      // Percent-encode each path segment so spaces and other special characters
      // don't break the markdown link, while preserving the path separators.
      const url = relPath.split('/').map(encodeURIComponent).join('/');
      return isImageFile(name) ? `![${name}](${url})` : `[${name}](${url})`;
    })
    .join('\n\n');
}
