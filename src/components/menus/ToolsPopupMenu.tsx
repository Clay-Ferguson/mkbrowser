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
  onSettings: () => void;
  onAiSettings: () => void;
}

export default function ToolsPopupMenu({
  anchorRef,
  onClose,
  aiEnabled,
  onFolderAnalysis,
  onRenumberFiles,
  onExport,
  onNewAiChat,
  onSettings,
  onAiSettings,
}: ToolsPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      {aiEnabled && (
        <>
          <PopupMenuItem
            label="New AI Chat"
            onClick={() => { onNewAiChat(); onClose(); }}
          />
        </>
      )}
      <PopupMenuItem
        label="Folder Analysis"
        onClick={() => { onFolderAnalysis(); onClose(); }}
      />
      <PopupMenuItem
        label="Re-Number Files"
        onClick={() => { onRenumberFiles(); onClose(); }}
      />
      <PopupMenuItem
        label="Export..."
        onClick={() => { onExport(); onClose(); }}
      />
      <PopupMenuDivider />

      <PopupMenuItem
        label="Settings"
        onClick={() => { onSettings(); onClose(); }}
      />
      {aiEnabled && (
        <>
          <PopupMenuItem
            label="AI Settings"
            onClick={() => { onAiSettings(); onClose(); }}
          />
        </>
      )}
    </PopupMenu>
  );
}
