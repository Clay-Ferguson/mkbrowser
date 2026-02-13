import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface ToolsPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onFolderAnalysis: () => void;
  onRenumberFiles: () => void;
  onExport: () => void;
}

export default function ToolsPopupMenu({
  anchorRef,
  onClose,
  onFolderAnalysis,
  onRenumberFiles,
  onExport,
}: ToolsPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Folder Analysis"
        onClick={() => { onFolderAnalysis(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Re-Number Files"
        onClick={() => { onRenumberFiles(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Export..."
        onClick={() => { onExport(); onClose(); }}
      />
    </PopupMenu>
  );
}
