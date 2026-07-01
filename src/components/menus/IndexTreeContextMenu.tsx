import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface IndexTreeContextMenuProps {
  /** Screen coordinates where the right-click occurred; the menu opens here. */
  mousePosition: { x: number; y: number };
  /** True when the right-clicked node is a directory (reserved for future use). */
  isDirectory: boolean;
  onClose: () => void;
  onBrowse: () => void;
  /** When provided, a "New Folder" item is shown. */
  onNewFolder?: () => void;
  /** When provided, a "Rename" item is shown. */
  onRename?: () => void;
  /** When provided, a "Delete" item is shown. */
  onDelete?: () => void;
  /** When provided, a "Paste into Folder" item is shown. */
  onPaste?: () => void;
  /** When provided, a "Paste Link" item is shown. */
  onPasteLink?: () => void;
  /** When provided, a "Copy Path" item is shown. */
  onCopyPath?: () => void;
  /** When provided, a "Copy Relative Path" item is shown. */
  onCopyRelativePath?: () => void;
}

/**
 * Right-click context menu for nodes in the index tree panel. Appears at the
 * cursor position and renders only the action items whose callbacks are provided
 * by the caller (optional items are omitted when the callback is absent).
 */
export default function IndexTreeContextMenu({ mousePosition, isDirectory: _isDirectory, onClose, onBrowse, onNewFolder, onRename, onDelete, onPaste, onPasteLink, onCopyPath, onCopyRelativePath }: IndexTreeContextMenuProps) {
  return (
    <PopupMenu mousePosition={mousePosition} onClose={onClose}>
      <PopupMenuItem
        label="Browse"
        onClick={() => { onBrowse(); onClose(); }}
        data-testid="browse-to-folder"
      />
      {(onNewFolder || onRename || onDelete) && <PopupMenuDivider />}
      {onNewFolder && (
        <PopupMenuItem
          label="New Folder"
          onClick={() => { onNewFolder(); onClose(); }}
        />
      )}
      {onRename && (
        <PopupMenuItem
          label="Rename"
          onClick={() => { onRename(); onClose(); }}
        />
      )}
      {onDelete && (
        <PopupMenuItem
          label="Delete"
          onClick={() => { onDelete(); onClose(); }}
        />
      )}
      {onPaste && (
        <PopupMenuItem
          label="Paste into Folder"
          onClick={() => { onPaste(); onClose(); }}
        />
      )}
      {onPasteLink && (
        <PopupMenuItem
          label="Paste Link"
          onClick={() => { onPasteLink(); onClose(); }}
        />
      )}
      {(onCopyPath || onCopyRelativePath) && <PopupMenuDivider />}
      {onCopyPath && (
        <PopupMenuItem
          label="Copy Path"
          onClick={() => { onCopyPath(); onClose(); }}
        />
      )}
      {onCopyRelativePath && (
        <PopupMenuItem
          label="Copy Relative Path"
          onClick={() => { onCopyRelativePath(); onClose(); }}
        />
      )}
    </PopupMenu>
  );
}
