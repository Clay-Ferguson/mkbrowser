import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';
import { useRootPath } from '../../store';
import { isPathInside } from '../../utils/pathUtil';

interface FilePopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectFolder: () => void;
  onQuit: () => void;
  recentFolders: string[];
  onOpenRecentFolder: (folder: string) => void;
}

export default function FilePopupMenu({
  anchorRef,
  onClose,
  onSelectFolder,
  onQuit,
  recentFolders,
  onOpenRecentFolder,
}: FilePopupMenuProps) {
  const rootPath = useRootPath();

  const folderLabel = (folder: string) => {
    if (rootPath && isPathInside(rootPath, folder)) {
      const rel = folder.slice(rootPath.length).replace(/^[/\\]/, '');
      return rel || '/';
    }
    return folder;
  };

  // Skip any recent item that resolves to the root ("/"). Navigating to root has its own
  // dedicated icon, so it adds no value as a Recent Items entry.
  const recentItems = recentFolders
    .map((folder) => ({ folder, label: folderLabel(folder) }))
    .filter(({ label }) => label !== '/');

  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Open Folder"
        onClick={() => { onSelectFolder(); onClose(); }}
        data-testid="menu-open-folder"
      />
      {recentItems.length > 0 && (
        <>
          <PopupMenuDivider />
          {recentItems.map(({ folder, label }) => (
            <PopupMenuItem
              key={folder}
              label={label}
              onClick={() => { onOpenRecentFolder(folder); onClose(); }}
            />
          ))}
          <PopupMenuDivider />
        </>
      )}
      {recentItems.length === 0 && <PopupMenuDivider />}
      <PopupMenuItem
        label="Quit"
        onClick={() => { onQuit(); onClose(); }}
      />
    </PopupMenu>
  );
}
