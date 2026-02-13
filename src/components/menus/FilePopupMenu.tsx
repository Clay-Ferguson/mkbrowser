import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface FilePopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectFolder: () => void;
  onQuit: () => void;
}

export default function FilePopupMenu({
  anchorRef,
  onClose,
  onSelectFolder,
  onQuit,
}: FilePopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Open Folder"
        onClick={() => { onSelectFolder(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Quit"
        onClick={() => { onQuit(); onClose(); }}
      />
    </PopupMenu>
  );
}
