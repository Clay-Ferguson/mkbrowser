import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface IndexTreeContextMenuProps {
  /** Screen coordinates where the right-click occurred; the menu opens here. */
  mousePosition: { x: number; y: number };
  /** True when the right-clicked node is a directory (reserved for future use). */
  isDirectory: boolean;
  onClose: () => void;
  /** When provided, a "Browse" item is shown. */
  onBrowse?: () => void;
  /** When provided (shell scripts only), a "Run" item is shown. */
  onRun?: () => void;
  /** When provided, a "New File" item is shown. */
  onNewFile?: () => void;
  /** When provided, a "New Folder" item is shown. */
  onNewFolder?: () => void;
  /** When provided, a "Rename" item is shown. */
  onRename?: () => void;
  /** When provided, a "Delete" item is shown. */
  onDelete?: () => void;
  /** When provided, a "Cut" item is shown. */
  onCut?: () => void;
  /** When provided, a "Paste into Folder" item is shown. */
  onPaste?: () => void;
  /** When provided, a "Copy Path" item is shown. */
  onCopyPath?: () => void;
  /** When provided, a "Copy Symlink" item is shown. */
  onCopySymlink?: () => void;
  /** Greys out "Copy Symlink" (the node is itself a link; links to links aren't made). */
  copySymlinkDisabled?: boolean;
  /** When provided (folders only), a "Paste Symlink" item is shown. */
  onPasteSymlink?: () => void;
  /** Greys out "Paste Symlink" (nothing copied, or this folder can't take the link). */
  pasteSymlinkDisabled?: boolean;
  /** Name of the copied item, shown in the "Paste Symlink" label when set. */
  symlinkSourceName?: string;
}

/**
 * Right-click context menu for nodes in the index tree panel. Appears at the
 * cursor position and renders only the action items whose callbacks are provided
 * by the caller (optional items are omitted when the callback is absent). The
 * three create items are fenced off in their own divider section, since they add
 * to the folder's *contents* rather than acting on the clicked node itself.
 *
 * See: (USER_GUIDE.md#running-shell-scripts)
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
 * See: (USER_GUIDE.md#creating-symbolic-links)
 * See: (index_tree.md#context-menu)
 * See: (popup_menus.md#context-menus-mouse-position)
 */
export default function IndexTreeContextMenu({ mousePosition, isDirectory: _isDirectory, onClose, onBrowse, onRun, onNewFile, onNewFolder, onRename, onDelete, onCut, onPaste, onCopyPath, onCopySymlink, copySymlinkDisabled = false, onPasteSymlink, pasteSymlinkDisabled = false, symlinkSourceName }: IndexTreeContextMenuProps) {
  return (
    <PopupMenu mousePosition={mousePosition} onClose={onClose}>
      {onBrowse && (
        <PopupMenuItem
          label="Browse"
          onClick={() => { onBrowse(); onClose(); }}
          data-testid="browse-to-folder"
        />
      )}
      {onRun && (
        <PopupMenuItem
          label="Run"
          onClick={() => { onRun(); onClose(); }}
          data-testid="tree-run-script"
        />
      )}
      {(onNewFile || onNewFolder || onRename || onDelete) && <PopupMenuDivider />}
      {onNewFile && (
        <PopupMenuItem
          label="New File"
          onClick={() => { onNewFile(); onClose(); }}
          data-testid="tree-new-file"
        />
      )}
      {onNewFolder && (
        <PopupMenuItem
          label="New Folder"
          onClick={() => { onNewFolder(); onClose(); }}
        />
      )}
      {(onNewFile || onNewFolder) && <PopupMenuDivider />}
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
      {onCut && (
        <PopupMenuItem
          label="Cut"
          onClick={() => { onCut(); onClose(); }}
          data-testid="tree-cut"
        />
      )}
      {onPaste && (
        <PopupMenuItem
          label="Paste into Folder"
          onClick={() => { onPaste(); onClose(); }}
        />
      )}
      {(onCopyPath || onCopySymlink || onPasteSymlink) && <PopupMenuDivider />}
      {onCopyPath && (
        <PopupMenuItem
          label="Copy Path"
          onClick={() => { onCopyPath(); onClose(); }}
        />
      )}
      {onCopySymlink && (
        <PopupMenuItem
          label="Copy Symlink"
          onClick={() => { onCopySymlink(); onClose(); }}
          disabled={copySymlinkDisabled}
          data-testid="tree-copy-symlink"
        />
      )}
      {onPasteSymlink && (
        <PopupMenuItem
          label={symlinkSourceName ? `Paste Symlink "${symlinkSourceName}"` : 'Paste Symlink'}
          onClick={() => { onPasteSymlink(); onClose(); }}
          disabled={pasteSymlinkDisabled}
          data-testid="tree-paste-symlink"
        />
      )}
    </PopupMenu>
  );
}
