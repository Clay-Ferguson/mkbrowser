/**
 * Auto-repair of Markdown links that carry their target's front-matter id in the
 * link title — `[label](<dest> "id:3D6B20DDF")`, as written by "Paste Link into
 * Editor". When such a link is clicked and its destination no longer exists (the
 * target, or the file containing the link, was renamed or moved), the target is
 * found by its id, opened, and the link's destination is silently rewritten.
 */
import { api } from './api';
import { appendLinkFragment, decodeMarkdownUrl, formatLinkDestination, getRelativePath, resolveLinkPath, splitHeadingFragment } from './linkUtil';
import { getFileName, getParentPath, joinPath } from './pathUtil';
import { getVisibleElementById, scrollElementIntoView } from './entryDom';
import { getItem, setBrowseFile, setHighlightItem, setItemContent, setLinkIdMismatch, setPendingScrollToHeadingSlug, useAS } from '../store';
import { logger } from '../shared/logUtil';
import { parseFrontMatter } from '../shared/frontMatterUtil';

/**
 * A link destination (`<...>` or bare) followed by a double-quoted title, ending the
 * `](...)` of an inline link. Group 1 is the raw destination, group 2 the raw
 * (still backslash-escaped) title text.
 */
const LINK_WITH_TITLE_RE = /\]\(\s*(<[^<>\n]*>|[^\s<]\S*?)\s+"((?:[^"\\\n]|\\.)*)"\s*\)/g;

/**
 * Opens a file on its own in BrowseView (single-file mode), as from the index tree.
 *
 * With `headingSlug` (the rendered heading's id — see tocUtil's extractHeadingTree)
 * it also scrolls to that heading: in place when this file is already the one on
 * screen and the heading is rendered, so hopping between a document's headings
 * doesn't remount it; otherwise by queueing `pendingScrollToHeadingSlug`, which
 * BrowseFile consumes once the file renders. browseFileName has to be checked as
 * well as the slug, because two documents can yield the same slug.
 */
export function openFileSingle(path: string, headingSlug?: string): void {
  setHighlightItem(path);
  if (headingSlug) {
    const { currentPath, browseFileName } = useAS.getState();
    const showingThisFile = browseFileName !== null && joinPath(currentPath, browseFileName) === path;
    if (showingThisFile && getVisibleElementById(headingSlug)) {
      scrollElementIntoView(headingSlug, true);
      return;
    }
    setPendingScrollToHeadingSlug(headingSlug);
  }
  setBrowseFile(getParentPath(path), getFileName(path));
}

/**
 * Returns `content` with the destination of every link titled `"id:<id>"` that
 * resolves (relative to `sourcePath`) to `brokenTarget` rewritten to point at
 * `newTarget`, relative to `sourcePath`. The label, title and any heading fragment
 * (`#slug`) are left untouched, as is any link pointing elsewhere. Pure, for testability.
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
    const { path, fragment } = splitHeadingFragment(dest);
    if (resolveLinkPath(sourcePath, decodeMarkdownUrl(path)) !== brokenTarget) return match;
    // A function replacement, so a `$` in the new path is never read as a pattern.
    return match.replace(rawDest, () => (fragment ? appendLinkFragment(newDest, fragment) : newDest));
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
 * Resolves to the front-matter id of the Markdown file at `path` for use as a link
 * title, or '' when it has none (or can't be read). Never writes the file — so
 * "Paste Link into Editor" can ask the user before adding an id (addLinkTargetId).
 * Never rejects.
 */
export function readLinkTargetId(path: string): Promise<string> {
  return readFrontMatterId(path).then((id) => id ?? '');
}

/**
 * Resolves to the front-matter id of the Markdown file at `path`, adding a fresh id
 * to the file first when it has none — so the link made by "Paste Link into Editor"
 * can later be auto-repaired. Only called once the user has agreed to the id being
 * written (an injected front-matter block is visible to anyone reading the file).
 * A file open in the editor is only read, never rewritten (that would fight the edit
 * buffer). Resolves to '' when there is no id; never rejects.
 */
export function addLinkTargetId(path: string): Promise<string> {
  if (getItem(path)?.editing) return readLinkTargetId(path);
  return api.ensureFrontMatterId(path)
    .then(({ id, written }) => {
      // The file was rewritten with its new id: refresh the cached content, stamped
      // exactly as after a normal save (see useEditMode.writeFileAndExitEditMode).
      if (written) setItemContent(path, written.content, written.mtime, written.size, written.createdTime);
      return id ?? '';
    })
    .catch((err: unknown) => {
      logger.warn(`[linkRepair] Failed to add an id to ${path}:`, err);
      return '';
    });
}

/**
 * Reads the front-matter id of the Markdown file at `path`: '' when it has none, or
 * null when the file couldn't be read. Never rejects.
 */
function readFrontMatterId(path: string): Promise<string | null> {
  return api.readFile(path)
    .then((result) => {
      if (!result.ok) return null;
      const idVal = parseFrontMatter(result.content).yaml?.id;
      return idVal !== null && idVal !== undefined ? String(idVal).trim() : '';
    })
    .catch(() => null);
}

/** Looks up the file carrying `id`: first in `likelyDir`, then across the root folder. */
function findById(id: string, likelyDir: string): Promise<string | null> {
  return api.findMarkdownById(id, likelyDir, useAS.getState().rootPath).catch(() => null);
}

/**
 * Checks that the file a link titled `"id:<id>"` opened really carries that id. When
 * its front-matter id differs (or it has none), the file carrying `id` is looked up
 * and the user is warned — the file at the link's path may have been replaced by an
 * unrelated one (e.g. the original was renamed and a new file took its name). An
 * unreadable file is not reported. Never rejects.
 */
function checkOpenedFileId(openedPath: string, id: string): Promise<void> {
  return readFrontMatterId(openedPath).then((openedId) => {
    if (openedId === null || openedId === id) return;
    return findById(id, getParentPath(openedPath)).then((otherPath) => {
      setLinkIdMismatch({ linkId: id, openedPath, openedId: openedId || null, otherPath });
    });
  });
}

/**
 * Opens the target of a Markdown link titled `"id:<id>"`. If `targetPath` exists it
 * is opened, and then checked to really carry that id (see checkOpenedFileId).
 * Otherwise the file carrying that id is looked up — first in the target's folder,
 * then across the whole root folder — and, when found, opened while the link in
 * `sourcePath` is repaired in the background. When nothing is found, `targetPath` is
 * opened anyway so the usual not-found handling applies. `headingSlug` (from a
 * `file.md#slug` link) scrolls to that heading in whichever file is opened.
 */
export function openIdLink(sourcePath: string, targetPath: string, id: string, headingSlug?: string): void {
  void api.pathExists(targetPath)
    .catch(() => false)
    .then((exists) => {
      if (exists) {
        openFileSingle(targetPath, headingSlug);
        return checkOpenedFileId(targetPath, id);
      }
      return findById(id, getParentPath(targetPath)).then((found) => {
        openFileSingle(found ?? targetPath, headingSlug);
        if (found) {
          repairLinkInFile(sourcePath, targetPath, id, found).catch((err: unknown) => {
            logger.warn(`[linkRepair] Failed to repair link in ${sourcePath}:`, err);
          });
        }
      });
    });
}
