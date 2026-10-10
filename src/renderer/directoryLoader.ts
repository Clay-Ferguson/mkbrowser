import { api } from './api';
import { refreshExpandedNodes } from './treeNodes';
import {
  useAS,
  applyDirectoryListing,
  setCurrentEntries,
  setEntriesLoading,
  setAppError,
  setCurrentPath,
  getIndexTreeRoot,
  setIndexTreeRoot,
} from '../store';
import { logger } from '../shared/logUtil';
import { getParentPath } from './pathUtil';

/**
 * Monotonic token identifying the most recent loadDirectoryContents call.
 * Two loads of the *same* path can overlap (a directoryRefreshNonce bump or
 * refreshDirectory racing an in-flight load), and the path-based staleness
 * check alone can't order them — without this, the older read resolving last
 * would overwrite the newer listing.
 */
let latestLoadToken = 0;

/**
 * Reads the given directory via IPC and installs the result in the store as
 * `currentEntries`, syncing the items Map in the same update.
 */
export async function loadDirectoryContents(currentPath: string, showLoading: boolean): Promise<void> {
  if (!currentPath) return;
  const token = ++latestLoadToken;

  if (showLoading) {
    setEntriesLoading(true);
  }
  setAppError(null);
  // A slow read can resolve after the user has navigated elsewhere, or after a
  // newer load of the same path has started, so every state write below
  // (including the loading flip) is gated on this run still being the latest
  // request for the current path. The path check is still needed alongside the
  // token: the store's currentPath can change before App's effect fires the
  // next load (and bumps the token).
  const isStale = () =>
    token !== latestLoadToken || useAS.getState().currentPath !== currentPath;
  try {
    const files = await api.readDirectory(currentPath);
    if (isStale()) return;
    // A full listing of currentPath, so this also prunes the cached entries of
    // files that vanished from it (deleted or moved outside the app). Leaving
    // them behind would let a later paste/delete act on a stale isCut/isSelected
    // flag — see syncDirectoryItems.
    applyDirectoryListing(currentPath, files);
  } catch (err) {
    if (isStale()) return;
    // The folder was deleted (from the index tree, a folder entry, or outside
    // the app): navigate up to its nearest surviving ancestor instead of
    // showing an error. Changing currentPath makes App load that folder.
    const ancestor = await findExistingAncestor(currentPath);
    if (isStale()) return;
    if (ancestor) {
      setCurrentPath(ancestor);
      return;
    }
    logger.error('Failed to read directory:', err);
    setAppError('Failed to read directory');
    setCurrentEntries([]);
  } finally {
    if (!isStale()) {
      setEntriesLoading(false);
    }
  }
}

/**
 * When `path` no longer exists, returns its nearest ancestor that does, or null
 * if `path` itself still exists (so the read failed for some other reason,
 * e.g. permissions) or no ancestor exists.
 */
async function findExistingAncestor(path: string): Promise<string | null> {
  if (await api.pathExists(path)) return null;
  let candidate = path;
  for (;;) {
    const parent = getParentPath(candidate);
    if (!parent || parent === candidate) return null;
    if (await api.pathExists(parent)) return parent;
    candidate = parent;
  }
}

/**
 * Silently reloads the current folder's listing and every expanded folder in
 * the index tree, after a file operation changed what is on disk.
 */
export function refreshDirectory(): void {
  void loadDirectoryContents(useAS.getState().currentPath, false);
  refreshIndexTree();
}

/** Re-reads every expanded folder of the index tree and installs the result. */
function refreshIndexTree(): void {
  const root = getIndexTreeRoot();
  if (!root) return;
  refreshExpandedNodes(root)
    .then(newRoot => {
      // The result is built from the `root` snapshot. If the tree changed while
      // the reads were out (the user expanded/collapsed a folder, a newer
      // refresh landed, the tree root moved), installing it would revert that
      // change — redo the refresh from the current tree instead.
      if (getIndexTreeRoot() === root) setIndexTreeRoot(newRoot);
      else refreshIndexTree();
    })
    .catch((err: unknown) => logger.error('Failed to refresh index tree:', err));
}
