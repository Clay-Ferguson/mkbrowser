/**
 * Auto-repair of links whose target carries an id. A Markdown target carries it in its
 * front matter, and the link in its title — `[label](<dest> "id:3D6B20DDF")`, as written
 * by the editor's "Paste Link". Any other file carries it in its name —
 * `[report.pdf](../docs/report--3D6B20DDF.pdf)` (see shared/fileIdSuffix.ts). When such a
 * link is clicked and its destination no longer exists (the target, or the file containing
 * the link, was renamed or moved), the target is found by its id, opened, and the link's
 * destination is silently rewritten.
 */
import { api } from './api';
import { appendLinkFragment, decodeMarkdownUrl, formatLinkDestination, getRelativePath, resolveLinkPath, splitHeadingFragment } from './linkUtil';
import { getFileName, getParentPath, joinPath } from './pathUtil';
import { getVisibleElementById, scrollElementIntoView } from './entryDom';
import { getItem, navigateToBrowserPath, setBrowseFile, setHighlightItem, setItemContent, setLinkIdMismatch, setPendingScrollToHeadingSlug, useAS } from '../store';
import { logger } from '../shared/logUtil';
import { parseFrontMatter } from '../shared/frontMatterUtil';
import { isMarkdownFile } from '../shared/fileTypes';
import { fileIdSuffixOf } from '../shared/fileIdSuffix';

/**
 * A link destination (`<...>` or bare) followed by a double-quoted title, ending the
 * `](...)` of an inline link. Group 1 is the raw destination, group 2 the raw
 * (still backslash-escaped) title text.
 */
const LINK_WITH_TITLE_RE = /\]\(\s*(<[^<>\n]*>|[^\s<]\S*?)\s+"((?:[^"\\\n]|\\.)*)"\s*\)/g;

/**
 * The `](...)` of any inline link or image, with or without a title. Group 1 is the raw
 * destination: `<...>`, or bare — which may hold balanced parentheses, as
 * formatLinkDestination leaves them.
 */
const ANY_LINK_RE = /\]\(\s*(<[^<>\n]*>|(?:[^\s<()]|\([^\s()]*\))(?:[^\s()]|\([^\s()]*\))*)(?:\s+"(?:[^"\\\n]|\\.)*")?\s*\)/g;

/**
 * Opens a file on its own in BrowseFile (single-file mode), as from the index tree.
 *
 * With `headingSlug` (the rendered heading's id, the GitHub-style slug rehype-slug assigns)
 * it also scrolls to that heading: in place when this file is already the one on
 * screen and the heading is rendered, so hopping between a document's headings
 * doesn't remount it; otherwise by queueing `pendingScrollToHeadingSlug`, which
 * BrowseFile consumes once the file renders. browseFileName has to be checked as
 * well as the slug, because two documents can yield the same slug.
 *
 * See: (docs/technical_notes/single_file_browsing.md#heading-links-in-single-file-mode)
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
 * Opens a link's target: a folder is browsed into; anything else — including a failed
 * stat — opens on its own in single-file mode (see openFileSingle).
 */
export function openLinkTarget(path: string, headingSlug?: string): void {
  void api.isDirectory(path)
    .catch(() => false)
    .then((isDir) => {
      if (isDir) navigateToBrowserPath(path);
      else openFileSingle(path, headingSlug);
    });
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
 * Returns `content` with the destination of every inline link or image — titled or not —
 * that resolves (relative to `sourcePath`) to `brokenTarget` rewritten to point at
 * `newTarget`, relative to `sourcePath`. The label, title and any heading fragment are left
 * untouched, as is any link pointing elsewhere. Used for links whose target carries its id
 * in its name, where the destination itself is all that identifies the link. Pure, for
 * testability.
 */
export function replaceLinkDestinations(
  content: string,
  sourcePath: string,
  brokenTarget: string,
  newTarget: string,
): string {
  const newDest = formatLinkDestination(getRelativePath(sourcePath, newTarget));
  return content.replace(ANY_LINK_RE, (match: string, rawDest: string) => {
    const dest = rawDest.startsWith('<') ? rawDest.slice(1, -1) : rawDest;
    const { path, fragment } = splitHeadingFragment(dest);
    if (resolveLinkPath(sourcePath, decodeMarkdownUrl(path)) !== brokenTarget) return match;
    // A function replacement, so a `$` in the new path is never read as a pattern.
    return match.replace(rawDest, () => (fragment ? appendLinkFragment(newDest, fragment) : newDest));
  });
}

/**
 * Rewrites the broken links in `sourcePath` with `rewrite` (one of the replace*
 * functions above, bound to the broken and new targets) and refreshes the store's cached
 * content. Skipped while the file is being edited (checked again just before the write,
 * in case editing began during the read); a later click repairs it then. Never rejects —
 * failures are only logged.
 */
async function repairLinkInFile(sourcePath: string, rewrite: (content: string) => string): Promise<void> {
  if (getItem(sourcePath)?.editing) return;
  const read = await api.readFile(sourcePath);
  if (!read.ok) return;
  const fixed = rewrite(read.content);
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
 * "Paste Link" can ask the user before adding an id (addLinkTargetId).
 * Never rejects.
 */
export function readLinkTargetId(path: string): Promise<string> {
  return readFrontMatterId(path).then((id) => id ?? '');
}

/**
 * Resolves to the front-matter id a new link to the file at `path` should carry in its
 * title (see readLinkTargetId), and whether the user must first be asked to add an id:
 * true only when the file has none and isn't open in the editor. An id is never added
 * silently — an injected front-matter block is visible to anyone reading the file (e.g. a
 * README.md on GitHub), and a file-name id renames the file — and a file open in the
 * editor can't be rewritten or renamed (it would fight the edit buffer), so that one just
 * gets a plain link.
 *
 * A non-Markdown file's id is in its name (see shared/fileIdSuffix.ts), so its link never
 * carries a title: `id` is always '' and only `needsConsent` matters. Never rejects.
 */
export function resolveLinkTargetId(path: string): Promise<{ id: string; needsConsent: boolean }> {
  if (!isMarkdownFile(path)) {
    return Promise.resolve({ id: '', needsConsent: !fileIdSuffixOf(path) && !getItem(path)?.editing });
  }
  return readLinkTargetId(path).then((id) => ({ id, needsConsent: !id && !getItem(path)?.editing }));
}

/**
 * Resolves to the front-matter id of the Markdown file at `path`, adding a fresh id
 * to the file first when it has none — so the link made by "Paste Link"
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
          const rewrite = (content: string) => replaceIdLinkDestinations(content, sourcePath, targetPath, id, found);
          repairLinkInFile(sourcePath, rewrite).catch((err: unknown) => {
            logger.warn(`[linkRepair] Failed to repair link in ${sourcePath}:`, err);
          });
        }
      });
    });
}

/**
 * Opens the target of a link to a non-Markdown file that carries its id in its name
 * (`report--3D6B20DDF.pdf` — see shared/fileIdSuffix.ts). If `targetPath` exists it is
 * opened as usual; its name holds the id, so it can't be some other file. Otherwise the
 * file whose name carries the same id and extension is looked up — first in the target's
 * folder, then across the whole root folder — and, when found, opened while the link in
 * `sourcePath` is repaired in the background. When nothing is found, `targetPath` is
 * opened anyway so the usual not-found handling applies. A file whose extension was
 * changed is deliberately never matched.
 */
export function openIdSuffixLink(sourcePath: string, targetPath: string, headingSlug?: string): void {
  const suffix = fileIdSuffixOf(targetPath);
  void api.pathExists(targetPath)
    .catch(() => false)
    .then((exists) => {
      if (exists || !suffix) {
        openLinkTarget(targetPath, headingSlug);
        return;
      }
      return api.findFileByIdSuffix(suffix.id, suffix.ext, getParentPath(targetPath), useAS.getState().rootPath)
        .catch(() => null)
        .then((found) => {
          openFileSingle(found ?? targetPath, headingSlug);
          if (found) {
            const rewrite = (content: string) => replaceLinkDestinations(content, sourcePath, targetPath, found);
            repairLinkInFile(sourcePath, rewrite).catch((err: unknown) => {
              logger.warn(`[linkRepair] Failed to repair link in ${sourcePath}:`, err);
            });
          }
        });
    });
}
