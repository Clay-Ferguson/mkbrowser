import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './PopupMenu';

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

  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      {sorted.length === 0 ? (
        <PopupMenuItem label="No bookmarks" disabled onClick={onClose} />
      ) : (
        sorted.map((fullPath) => {
          const displayName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
          return (
            <PopupMenuItem
              key={fullPath}
              label={displayName}
              onClick={() => { onNavigate(fullPath); onClose(); }}
            />
          );
        })
      )}
    </PopupMenu>
  );
}
