import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface IndexTreeContextMenuProps {
  mousePosition: { x: number; y: number };
  isDirectory: boolean;
  onClose: () => void;
  onBrowse: () => void;
  onNewFolder?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onPaste?: () => void;
  onPasteLink?: () => void;
}

export default function IndexTreeContextMenu({ mousePosition, isDirectory, onClose, onBrowse, onNewFolder, onRename, onDelete, onPaste, onPasteLink }: IndexTreeContextMenuProps) {
  return (
    <PopupMenu mousePosition={mousePosition} onClose={onClose}>
      <PopupMenuItem
        label={isDirectory ? 'Browse to Folder' : 'Browse to File'}
        onClick={() => { onBrowse(); onClose(); }}
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
    </PopupMenu>
  );
}
