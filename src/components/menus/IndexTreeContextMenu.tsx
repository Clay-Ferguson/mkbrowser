import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface IndexTreeContextMenuProps {
  mousePosition: { x: number; y: number };
  isDirectory: boolean;
  onClose: () => void;
  onBrowse: () => void;
}

export default function IndexTreeContextMenu({ mousePosition, isDirectory, onClose, onBrowse }: IndexTreeContextMenuProps) {
  return (
    <PopupMenu mousePosition={mousePosition} onClose={onClose}>
      <PopupMenuItem
        label={isDirectory ? 'Browse to Folder' : 'Browse to File'}
        onClick={() => { onBrowse(); onClose(); }}
      />
    </PopupMenu>
  );
}
