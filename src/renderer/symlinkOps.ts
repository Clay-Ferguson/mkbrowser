/**
 * "Copy Symlink" / "Paste Symlink": the user picks a file or folder, then a
 * different folder, and a symbolic link to the first is created in the second
 * under the same name. The picked item lives in the store (`symlinkSource`), not
 * in any one view, so any menu can offer the paste; this module holds the logic
 * every such menu shares.
 *
 * See: (USER_GUIDE.md#creating-symbolic-links)
 */
import { api } from './api';
import { useAS, clearSymlinkSource, getCurrentPath, setAppError } from '../store';
import type { SymlinkSource } from '../store';
import { reloadExpandedTreeFolder } from './treeNodes';
import { refreshDirectory } from './directoryLoader';
import { affectsBrowseListing } from './dragAndDrop';
import { getParentPath, isPathInside, isSamePath } from './pathUtil';

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
