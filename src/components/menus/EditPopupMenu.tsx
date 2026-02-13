import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface EditPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onUndoCut: () => void;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onMoveToFolder: () => void;
  onSplit: () => void;
  onJoin: () => void;
  onReplaceInFiles: () => void;
  // Disable conditions
  unselectAllDisabled: boolean;
  moveToFolderDisabled: boolean;
  splitDisabled: boolean;
  joinDisabled: boolean;
}

export default function EditPopupMenu({
  anchorRef,
  onClose,
  onUndoCut,
  onSelectAll,
  onUnselectAll,
  onMoveToFolder,
  onSplit,
  onJoin,
  onReplaceInFiles,
  unselectAllDisabled,
  moveToFolderDisabled,
  splitDisabled,
  joinDisabled,
}: EditPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Undo Cut"
        onClick={() => { onUndoCut(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Select All"
        onClick={() => { onSelectAll(); onClose(); }}
      />
      <PopupMenuItem
        label="Unselect All"
        onClick={() => { onUnselectAll(); onClose(); }}
        disabled={unselectAllDisabled}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Move to Folder"
        onClick={() => { onMoveToFolder(); onClose(); }}
        disabled={moveToFolderDisabled}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Split"
        onClick={() => { onSplit(); onClose(); }}
        disabled={splitDisabled}
      />
      <PopupMenuItem
        label="Join"
        onClick={() => { onJoin(); onClose(); }}
        disabled={joinDisabled}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Replace in Files"
        onClick={() => { onReplaceInFiles(); onClose(); }}
      />
    </PopupMenu>
  );
}
