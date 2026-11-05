/**
 * "Copy Symlink" / "Paste Symlink": the user picks a file or folder, then a
 * different folder, and a symbolic link to the first is created in the second
 * under the same name. The picked item lives in the store (`symlinkSource`), not
 * in any one view, so any menu can offer the paste; this module holds the logic
 * every such menu shares, along with "Open Symlink".
 *
 * See: (USER_GUIDE.md#creating-symbolic-links)
 * See: (USER_GUIDE.md#opening-a-links-original)
 */
import { api } from './api';
import { useAS, clearSymlinkSource, getCurrentPath, navigateToBrowserPath, setAppError, setBrowseFile, setHighlightItem } from '../store';
import type { SymlinkSource } from '../store';
import { reloadExpandedTreeFolder } from './treeNodes';
import { refreshDirectory } from './directoryLoader';
import { affectsBrowseListing } from './dragAndDrop';
import { getFileName, getParentPath, isPathInside, isSamePath } from './pathUtil';

/**
 * Whether "Paste Symlink" into `folder` should be enabled: something has been
 * copied, `folder` is not the one it already sits in (the link would need its
 * name), and a copied folder is not being linked into itself or beneath itself.
 * The main process re-checks all of this with symlinks resolved; this is the
 * cheap check that greys the menu item out.
 *
 * See: (USER_GUIDE.md#creating-symbolic-links)
 */
export function canPasteSymlinkInto(source: SymlinkSource | null, folder: string): boolean {
  if (!source) return false;
  if (isSamePath(getParentPath(source.path), folder)) return false;
  return !(source.isDirectory && isPathInside(source.path, folder));
}

/**
 * Creates the link to the copied item inside `destFolder`, then brings the
 * folder's .INDEX.yaml, the browse view and the index tree in step with disk.
 * The copied item is forgotten only on success; after a failure (reported via
 * setAppError) it stays armed so the user can pick another folder.
 *
 * See: (USER_GUIDE.md#creating-symbolic-links)
 */
export async function pasteSymlink(destFolder: string): Promise<void> {
  const source = useAS.getState().symlinkSource;
  if (!source) return;

  const result = await api.createSymlink(source.path, destFolder);
  if (!result.success) {
    setAppError(result.error || `Could not create a link to "${source.name}".`);
    return;
  }
  clearSymlinkSource();

  await api.reconcileIndexedFiles(destFolder, false);

  // Read the path after the awaits: the user may have navigated meanwhile.
  if (affectsBrowseListing(destFolder, getCurrentPath())) {
    refreshDirectory();
  }
  await reloadExpandedTreeFolder(destFolder);
}

/**
 * "Open Symlink": shows a link's original in the browse view, the same way the
 * tree opens things. A folder opens as a listing (as "Browse" does); a file opens
 * alone in single-file mode, highlighted (as clicking a file in the tree does).
 * Nothing moves in the tree itself.
 *
 * An original outside the root folder is not opened: the app shows only what is
 * under the root, so the user is told instead.
 *
 * @param name - The link's own name, for the message.
 * @param linkTarget - The link's absolute target (FileEntry.linkTarget).
 * @param isDirectory - Whether the link leads to a folder.
 *
 * See: (USER_GUIDE.md#opening-a-links-original)
 * See: (single_file_browsing.md#entering-single-file-mode-tree-click)
 */
export function openSymlinkTarget(name: string, linkTarget: string, isDirectory: boolean): void {
  const rootPath = useAS.getState().rootPath;
  if (!rootPath || !isPathInside(rootPath, linkTarget)) {
    setAppError(`"${name}" links to ${linkTarget}, which is outside the root folder, so it can't be opened here.`);
    return;
  }
  if (isDirectory) {
    navigateToBrowserPath(linkTarget);
    return;
  }
  setHighlightItem(linkTarget);
  setBrowseFile(getParentPath(linkTarget), getFileName(linkTarget));
}
