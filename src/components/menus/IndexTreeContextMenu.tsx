import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface IndexTreeContextMenuProps {
  mousePosition: { x: number; y: number };
  isDirectory: boolean;
  onClose: () => void;
  onBrowse: () => void;
  onPaste?: () => void;
}

export default function IndexTreeContextMenu({ mousePosition, isDirectory, onClose, onBrowse, onPaste }: IndexTreeContextMenuProps) {
  return (
    <PopupMenu mousePosition={mousePosition} onClose={onClose}>
      <PopupMenuItem
        label={isDirectory ? 'Browse to Folder' : 'Browse to File'}
        onClick={() => { onBrowse(); onClose(); }}
      />
      {onPaste && (
        <PopupMenuItem
          label="Paste into Folder"
          onClick={() => { onPaste(); onClose(); }}
        />
      )}
    </PopupMenu>
  );
}
