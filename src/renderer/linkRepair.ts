/**
 * Auto-repair of Markdown links that carry their target's front-matter id in the
 * link title — `[label](<dest> "id:3D6B20DDF")`, as written by "Paste Link into
 * Editor". When such a link is clicked and its destination no longer exists (the
 * target, or the file containing the link, was renamed or moved), the target is
 * found by its id, opened, and the link's destination is silently rewritten.
 */
import { api } from './api';
import { decodeMarkdownUrl, formatLinkDestination, getRelativePath, resolveLinkPath } from './linkUtil';
import { getFileName, getParentPath } from './pathUtil';
import { getItem, setBrowseFile, setHighlightItem, setItemContent, useAS } from '../store';
import { logger } from '../shared/logUtil';

/**
 * A link destination (`<...>` or bare) followed by a double-quoted title, ending the
 * `](...)` of an inline link. Group 1 is the raw destination, group 2 the raw
 * (still backslash-escaped) title text.
 */
const LINK_WITH_TITLE_RE = /\]\(\s*(<[^<>\n]*>|[^\s<]\S*?)\s+"((?:[^"\\\n]|\\.)*)"\s*\)/g;

/** Opens a file on its own in BrowseView (single-file mode), as from the index tree. */
export function openFileSingle(path: string): void {
  setHighlightItem(path);
  setBrowseFile(getParentPath(path), getFileName(path));
}

/**
 * Returns `content` with the destination of every link titled `"id:<id>"` that
 * resolves (relative to `sourcePath`) to `brokenTarget` rewritten to point at
 * `newTarget`, relative to `sourcePath`. The label and title are left untouched,
 * as is any link pointing elsewhere. Pure, for testability.
 */
export function replaceIdLinkDestinations(
  content: string,
  sourcePath: string,
  brokenTarget: string,
  id: string,
  newTarget: string,
): string {
  const newDest = formatLinkDestination(getRelativePath(sourcePath, newTarget));
  return content.replace(LINK_WITH_TITLE_RE, (match: string, rawDest: string, rawTitle: string) => {
    if (rawTitle.replace(/\\(.)/g, '$1').trim() !== `id:${id}`) return match;
    const dest = rawDest.startsWith('<') ? rawDest.slice(1, -1) : rawDest;
    if (resolveLinkPath(sourcePath, decodeMarkdownUrl(dest)) !== brokenTarget) return match;
    // A function replacement, so a `$` in the new path is never read as a pattern.
    return match.replace(rawDest, () => newDest);
  });
}

/**
 * Rewrites the broken id links in `sourcePath` to point at `newTarget` and refreshes
 * the store's cached content. Skipped while the file is being edited (checked again
 * just before the write, in case editing began during the read); a later click
 * repairs it then. Never rejects — failures are only logged.
 */
async function repairLinkInFile(sourcePath: string, brokenTarget: string, id: string, newTarget: string): Promise<void> {
  if (getItem(sourcePath)?.editing) return;
  const read = await api.readFile(sourcePath);
  if (!read.ok) return;
  const fixed = replaceIdLinkDestinations(read.content, sourcePath, brokenTarget, id, newTarget);
  if (fixed === read.content || getItem(sourcePath)?.editing) return;
  const result = await api.writeFile(sourcePath, fixed);
  if (!result.ok) {
    logger.warn(`[linkRepair] Failed to repair link in ${sourcePath}:`, result.error);
    return;
  }
  // Same stamping as a normal save (see useEditMode.writeFileAndExitEditMode).
  setItemContent(sourcePath, result.content, result.mtime, result.size, result.createdTime);
}

/**
 * Opens the target of a Markdown link titled `"id:<id>"`. If `targetPath` exists it
 * is opened as-is. Otherwise the file carrying that id is looked up — first in the
 * target's folder, then across the whole root folder — and, when found, opened while
 * the link in `sourcePath` is repaired in the background. When nothing is found,
 * `targetPath` is opened anyway so the usual not-found handling applies.
 */
export function openIdLink(sourcePath: string, targetPath: string, id: string): void {
  void api.pathExists(targetPath)
    .then((exists) => exists ? targetPath
      : api.findMarkdownById(id, getParentPath(targetPath), useAS.getState().rootPath))
    .catch(() => null)
    .then((found) => {
      openFileSingle(found ?? targetPath);
      if (found && found !== targetPath) {
        repairLinkInFile(sourcePath, targetPath, id, found).catch((err: unknown) => {
          logger.warn(`[linkRepair] Failed to repair link in ${sourcePath}:`, err);
        });
      }
    });
}
