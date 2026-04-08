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
  onOpenTerminal: () => void;
  onRunOcr: () => void;
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
  onOpenTerminal,
  onRunOcr,
  onSettings,
  onAiSettings,
}: ToolsPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      {aiEnabled && (
        <>
          <PopupMenuItem
            label="New AI Chat"
            data-testid="menu-new-ai-chat"
            onClick={() => { onNewAiChat(); onClose(); }}
          />
        </>
      )}
      <PopupMenuItem
        label="Folder Analysis"
        data-testid="menu-folder-analysis"
        onClick={() => { onFolderAnalysis(); onClose(); }}
      />
      <PopupMenuItem
        label="Re-Number Files"
        data-testid="menu-renumber-files"
        onClick={() => { onRenumberFiles(); onClose(); }}
      />
      <PopupMenuItem
        label="Export..."
        data-testid="menu-export"
        onClick={() => { onExport(); onClose(); }}
      />
      <PopupMenuItem
        label="Open Terminal"
        data-testid="menu-open-terminal"
        onClick={() => { onOpenTerminal(); onClose(); }}
      />
      <PopupMenuItem
        label="Run OCR"
        data-testid="menu-run-ocr"
        onClick={() => { onRunOcr(); onClose(); }}
      />
      <PopupMenuDivider />

      <PopupMenuItem
        label="Settings"
        data-testid="menu-settings"
        onClick={() => { onSettings(); onClose(); }}
      />
      {aiEnabled && (
        <>
          <PopupMenuItem
            label="AI Settings"
            data-testid="menu-ai-settings"
            onClick={() => { onAiSettings(); onClose(); }}
          />
        </>
      )}
    </PopupMenu>
  );
}
