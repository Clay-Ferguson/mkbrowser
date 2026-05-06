import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface ToolsPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  aiEnabled: boolean;
  onFolderAnalysis: () => void;
  onFolderGraph: () => void;
  onExport: () => void;
  onNewAiChat: () => void;
  onRunOcr: () => void;
}

export default function ToolsPopupMenu({
  anchorRef,
  onClose,
  aiEnabled,
  onFolderAnalysis,
  onFolderGraph,
  onExport,
  onNewAiChat,
  onRunOcr,
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
        label="Folder Graph"
        data-testid="menu-folder-graph"
        onClick={() => { onFolderGraph(); onClose(); }}
      />
      <PopupMenuItem
        label="Export..."
        data-testid="menu-export"
        onClick={() => { onExport(); onClose(); }}
      />
      <PopupMenuItem
        label="Run OCR"
        data-testid="menu-run-ocr"
        onClick={() => { onRunOcr(); onClose(); }}
      />
    </PopupMenu>
  );
}
