import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface ToolsPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  aiEnabled: boolean;
  onFolderAnalysis: () => void;
  onRenumberFiles: () => void;
  onExport: () => void;
  onNewAiChat: () => void;
}

export default function ToolsPopupMenu({
  anchorRef,
  onClose,
  aiEnabled,
  onFolderAnalysis,
  onRenumberFiles,
  onExport,
  onNewAiChat,
}: ToolsPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      {aiEnabled && (
        <>
          <PopupMenuItem
            label="New AI Chat"
            onClick={() => { onNewAiChat(); onClose(); }}
          />
          <PopupMenuDivider />
        </>
      )}
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
