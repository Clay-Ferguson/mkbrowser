/**
 * Wikilink clicks, Obsidian-style: a `[[target]]` whose file doesn't exist yet is
 * created on the spot (empty) and opened for editing in single-file mode — no
 * prompt. Only a plain name is created this way, so a wikilink can only ever make a
 * file in the linking file's own folder.
 *
 * See: (USER_GUIDE.md#creating-files-from-wikilinks)
 */
import { api } from './api';
import { resolveLinkPath } from './linkUtil';
import { openFileSingle } from './linkRepair';
import { refreshDirectory } from './directoryLoader';
import { isMarkdownFile, isTextFile } from '../shared/fileTypes';
import { toErrorMessage } from '../shared/logUtil';
import { navigateToBrowserPath, setAppError, setPendingEditFile } from '../store';

/**
 * Characters a wikilink-created file's name can't contain: path separators (the file
 * must land in the linking file's own folder), the characters Windows forbids in file
 * names, the ones wikilink syntax reserves (`#` heading, `^` block, `|` alias,
 * brackets), and control characters.
 */
const INVALID_NAME_CHARS = /[/\\<>:"|?*#^[\]\p{Cc}]/u;

/**
 * True when a clicked wikilink's (decoded) target may be auto-created: a plain file
 * name that starts with a valid file name character — so never `.`/`..`-relative,
 * absolute, or reaching into another folder.
 *
 * See: (USER_GUIDE.md#creating-files-from-wikilinks)
 */
export function isCreatableWikiLinkTarget(target: string): boolean {
  return /^[^.\s]/u.test(target) && !INVALID_NAME_CHARS.test(target);
}

/**
 * The file a wikilink names: the target as written when it's already a Markdown or
 * text file, otherwise with `.md` appended (`[[My Note]]` → `My Note.md`).
 *
 * See: (USER_GUIDE.md#syntax)
 */
export function withWikiLinkExtension(target: string): string {
  return isMarkdownFile(target) || isTextFile(target) ? target : `${target}.md`;
}

/**
 * Follows a clicked wikilink in `sourcePath` (the Markdown file containing it):
 *   - a folder target browses into the folder; an existing file opens in single-file
 *     mode (scrolling to `headingSlug`, if given);
 *   - a missing target is retried with `.md` appended (`[[note]]` → `note.md`);
 *   - still missing, a creatable target (see isCreatableWikiLinkTarget) is created as
 *     an empty file next to `sourcePath` and opened for editing. Anything else opens as
 *     a plain file link would.
 * Never rejects — failures are reported as an app error.
 *
 * See: (USER_GUIDE.md#wikilinks)
 */
export function openWikiLink(sourcePath: string, target: string, headingSlug?: string): void {
  followWikiLink(sourcePath, target, headingSlug)
    .catch((err: unknown) => setAppError('Failed to open link: ' + toErrorMessage(err)));
}

async function followWikiLink(sourcePath: string, target: string, headingSlug?: string): Promise<void> {
  const targetPath = resolveLinkPath(sourcePath, target);
  if (await api.pathExists(targetPath)) {
    if (await api.isDirectory(targetPath).catch(() => false)) {
      navigateToBrowserPath(targetPath);
    } else {
      openFileSingle(targetPath, headingSlug);
    }
    return;
  }

  const filePath = withWikiLinkExtension(targetPath);
  if (filePath !== targetPath && await api.pathExists(filePath)) {
    openFileSingle(filePath, headingSlug);
    return;
  }

  if (!isCreatableWikiLinkTarget(target)) {
    openFileSingle(targetPath, headingSlug);
    return;
  }

  const created = await api.createFile(filePath, '');
  if (!created.success) {
    setAppError('Failed to create file: ' + (created.error ?? filePath));
    return;
  }
  // Queued before the file is opened: BrowseFile starts the edit once the reload
  // below has brought the new file into the listing.
  setPendingEditFile(filePath);
  openFileSingle(filePath);
  // Opening a file in the folder already on screen doesn't reload it, and the index
  // tree never reloads on its own — so refresh both to pick up the new file.
  refreshDirectory();
}
