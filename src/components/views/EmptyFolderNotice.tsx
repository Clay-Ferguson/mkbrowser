import { useEffect, useState } from 'react';
import { FolderIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api } from '../../renderer/api';
import { runOp } from '../../renderer/runOp';
import { deleteEmptyFolderOp } from '../../renderer/fileOpsUtil';
import { getParentPath, isPathInside } from '../../renderer/pathUtil';
import { BUTTON_CLASS_RED } from '../../renderer/styles';
import { useAS } from '../../store';

/**
 * BrowseEntryList's empty state, with a button to delete the folder itself.
 *
 * An empty *listing* is not an empty *folder*: the listing hides dotfiles
 * (.INDEX.yaml among them) and cut entries. So the delete button is offered
 * only once the main process has confirmed, unfiltered, that the folder holds
 * nothing on disk beyond its own .INDEX.yaml (an empty Document Mode folder
 * still counts as empty; that file is deleted first) — and the delete itself
 * is an `rmdir`, which the OS refuses for a folder with content.
 */
function EmptyFolderNotice() {
  const currentPath = useAS(s => s.currentPath);
  const rootPath = useAS(s => s.rootPath);
  const entries = useAS(s => s.currentEntries);
  // The folder the disk check last confirmed empty. Compared against
  // currentPath at render, so a result for a folder since navigated away from
  // can never enable the button.
  const [verifiedEmptyPath, setVerifiedEmptyPath] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Re-verified whenever the listing is reloaded (`entries` is replaced then).
  useEffect(() => {
    if (!currentPath) return;
    let ignore = false;
    api.isFolderEmpty(currentPath)
      .then((empty) => {
        if (!ignore) setVerifiedEmptyPath(empty ? currentPath : null);
      })
      .catch(() => {
        if (!ignore) setVerifiedEmptyPath(null);
      });
    return () => {
      ignore = true;
    };
  }, [currentPath, entries]);

  // The root folder has no parent inside the browsed tree to navigate to.
  const canDelete = verifiedEmptyPath === currentPath
    && currentPath !== rootPath
    && isPathInside(rootPath, getParentPath(currentPath));

  const handleDelete = () => {
    setDeleting(true);
    runOp(() => deleteEmptyFolderOp(currentPath).finally(() => setDeleting(false)), 'Failed to delete folder: ');
  };

  return (
    <div className="text-center py-12">
      <FolderIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
      <p className="text-slate-400">This folder is empty</p>
      {canDelete && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={BUTTON_CLASS_RED}
            title="Delete this folder"
            data-testid="delete-empty-folder-button"
          >
            <TrashIcon className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default EmptyFolderNotice;
