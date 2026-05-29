import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';
import { useRootPath } from '../../store';

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
    if (rootPath && folder.startsWith(rootPath)) {
      const rel = folder.slice(rootPath.length).replace(/^\//, '');
      return rel || '/';
    }
    return folder;
  };

  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Open Folder"
        onClick={() => { onSelectFolder(); onClose(); }}
        data-testid="menu-open-folder"
      />
      {recentFolders.length > 0 && (
        <>
          <PopupMenuDivider />
          {recentFolders.map((folder) => (
            <PopupMenuItem
              key={folder}
              label={folderLabel(folder)}
              onClick={() => { onOpenRecentFolder(folder); onClose(); }}
            />
          ))}
          <PopupMenuDivider />
        </>
      )}
      {recentFolders.length === 0 && <PopupMenuDivider />}
      <PopupMenuItem
        label="Quit"
        onClick={() => { onQuit(); onClose(); }}
      />
    </PopupMenu>
  );
}
