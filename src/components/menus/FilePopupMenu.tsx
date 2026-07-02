import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';
import { useAppStore } from '../../store';
import { isPathInside } from '../../renderer/pathUtil';

interface FilePopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectFolder: () => void;
  onQuit: () => void;
  /** Ordered list of recently visited folder paths (most-recent first). */
  recentFolders: string[];
  onOpenRecentFolder: (folder: string) => void;
}

/**
 * Popup menu for the File toolbar button. Shows "Open Folder", an optional
 * list of recently visited folders, and "Quit". Recent folders that resolve
 * to the root ("/") are omitted since the root has its own dedicated nav icon.
 */
export default function FilePopupMenu({
  anchorRef,
  onClose,
  onSelectFolder,
  onQuit,
  recentFolders,
  onOpenRecentFolder,
}: FilePopupMenuProps) {
  const rootPath = useAppStore(s => s.rootPath);

  /**
   * Returns a display label for a recent folder. When the folder is inside the
   * current root, the label is the root-relative path; otherwise the full path
   * is returned. Returns "/" when the folder equals the root itself.
   */
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
