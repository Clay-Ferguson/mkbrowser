import { useState, type RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';
import MessageDialog from '../dialogs/MessageDialog';
import { toggleBookmark, isBookmarked } from '../../store';

interface BookmarksPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  bookmarks: string[];
  rootPath: string;
  onNavigate: (fullPath: string) => void;
}

export default function BookmarksPopupMenu({
  anchorRef,
  onClose,
  bookmarks,
  rootPath,
  onNavigate,
}: BookmarksPopupMenuProps) {
  const [missingPath, setMissingPath] = useState<string | null>(null);

  // Filter to bookmarks under rootPath
  const filtered = rootPath
    ? bookmarks.filter(b => b === rootPath || b.startsWith(rootPath + '/'))
    : bookmarks;

  // Sort alphabetically by display name (last path segment)
  const sorted = [...filtered].sort((a, b) => {
    const nameA = a.substring(a.lastIndexOf('/') + 1);
    const nameB = b.substring(b.lastIndexOf('/') + 1);
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  });

  const handleClick = async (fullPath: string) => {
    const exists = await window.electronAPI.pathExists(fullPath);
    if (!exists) {
      if (isBookmarked(fullPath)) toggleBookmark(fullPath);
      setMissingPath(fullPath);
      return;
    }
    onNavigate(fullPath);
    onClose();
  };

  return (
    <>
      <PopupMenu anchorRef={anchorRef} onClose={onClose}>
        {sorted.length === 0 ? (
          <PopupMenuItem label="No bookmarks" disabled onClick={onClose} />
        ) : (
          sorted.map((fullPath) => {
            // Display path relative to rootPath (not OS root)
            let displayName = fullPath;
            if (rootPath && (fullPath === rootPath || fullPath.startsWith(rootPath + '/'))) {
              displayName = fullPath.slice(rootPath.length);
              if (displayName.startsWith('/')) displayName = displayName.slice(1);
              // For the root itself, show "." for clarity
              if (!displayName) displayName = '.';
            }
            return (
              <PopupMenuItem
                key={fullPath}
                label={displayName}
                onClick={() => handleClick(fullPath)}
              />
            );
          })
        )}
      </PopupMenu>
      {missingPath && (
        <MessageDialog
          title="Bookmark Not Found"
          message={`The bookmarked path no longer exists and has been removed:\n\n${missingPath}`}
          onClose={() => { setMissingPath(null); onClose(); }}
        />
      )}
    </>
  );
}
