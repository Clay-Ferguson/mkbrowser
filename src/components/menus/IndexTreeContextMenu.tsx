import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface IndexTreeContextMenuProps {
  mousePosition: { x: number; y: number };
  isDirectory: boolean;
  onClose: () => void;
  onBrowse: () => void;
  onPaste?: () => void;
  onPasteLink?: () => void;
}

export default function IndexTreeContextMenu({ mousePosition, isDirectory, onClose, onBrowse, onPaste, onPasteLink }: IndexTreeContextMenuProps) {
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
      {onPasteLink && (
        <PopupMenuItem
          label="Paste Link"
          onClick={() => { onPasteLink(); onClose(); }}
        />
      )}
    </PopupMenu>
  );
}
