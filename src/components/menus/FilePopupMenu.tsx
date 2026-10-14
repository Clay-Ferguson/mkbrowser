import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';
import { useAS } from '../../store';
import { isPathInside } from '../../renderer/pathUtil';

interface FilePopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectFolder: () => void;
  /**
   * Opens the bundled Help documents folder as the browse root, in this window.
   * Currently unused: its menu item is commented out below, in favour of
   * "Browse Help (new window)", but kept so it can be re-enabled.
   */
  onBrowseHelpDocs: () => void;
  /** Launches a separate app instance that browses the Help documents. */
  onOpenHelpWindow: () => void;
  onQuit: () => void;
  /** Ordered list of recently visited folder paths (most-recent first). */
  recentFolders: string[];
  onOpenRecentFolder: (folder: string) => void;
}

/**
 * Popup menu for the File toolbar button. Shows "Open Folder", "Browse Help
 * (new window)", an optional list of recently visited folders, and "Quit". Recent
 * folders that resolve to the root ("/") are omitted since the root has its own
 * dedicated nav icon.
 */
export default function FilePopupMenu({
  anchorRef,
  onClose,
  onSelectFolder,
  onOpenHelpWindow,
  onQuit,
  recentFolders,
  onOpenRecentFolder,
}: FilePopupMenuProps) {
  const rootPath = useAS(s => s.rootPath);

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
    // Recent-folder labels are full paths that can be very long. This menu always opens
    // against the window's left edge, so let it grow to 90% of the viewport (overriding
    // MENU_CONTAINER's max-w-xs) before falling back to a horizontal scrollbar.
    <PopupMenu anchorRef={anchorRef} onClose={onClose} style={{ maxWidth: '90vw' }}>
      <PopupMenuItem
        label="Open Folder"
        onClick={() => { onSelectFolder(); onClose(); }}
        data-testid="menu-open-folder"
      />
      {/* Hidden for now in favour of "Browse Help (new window)"; kept for possible future use.
          To re-enable, also add `onBrowseHelpDocs` back to the destructured props.
      <PopupMenuItem
        label="Browse Help Documents"
        onClick={() => { onBrowseHelpDocs(); onClose(); }}
        data-testid="menu-browse-help"
      />
      */}
      <PopupMenuItem
        label="Browse Help (new window)"
        onClick={() => { onOpenHelpWindow(); onClose(); }}
        data-testid="menu-browse-help-window"
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
