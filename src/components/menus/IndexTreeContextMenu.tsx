import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface IndexTreeContextMenuProps {
  mousePosition: { x: number; y: number };
  isDirectory: boolean;
  onClose: () => void;
  onBrowse: () => void;
  onNewFolder?: () => void;
  onRenameFolder?: () => void;
  onDeleteFolder?: () => void;
  onPaste?: () => void;
  onPasteLink?: () => void;
}

export default function IndexTreeContextMenu({ mousePosition, isDirectory, onClose, onBrowse, onNewFolder, onRenameFolder, onDeleteFolder, onPaste, onPasteLink }: IndexTreeContextMenuProps) {
  return (
    <PopupMenu mousePosition={mousePosition} onClose={onClose}>
      <PopupMenuItem
        label={isDirectory ? 'Browse to Folder' : 'Browse to File'}
        onClick={() => { onBrowse(); onClose(); }}
      />
      {(onNewFolder || onRenameFolder || onDeleteFolder) && <PopupMenuDivider />}
      {onNewFolder && (
        <PopupMenuItem
          label="New Folder"
          onClick={() => { onNewFolder(); onClose(); }}
        />
      )}
      {onRenameFolder && (
        <PopupMenuItem
          label="Rename Folder"
          onClick={() => { onRenameFolder(); onClose(); }}
        />
      )}
      {onDeleteFolder && (
        <PopupMenuItem
          label="Delete Folder"
          onClick={() => { onDeleteFolder(); onClose(); }}
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
