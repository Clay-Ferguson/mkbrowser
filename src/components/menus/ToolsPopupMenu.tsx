import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';
import { useAS } from '../../store';

interface ToolsPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onFolderAnalysis: () => void;
  onFolderGraph: () => void;
  onMarkdownGraph: () => void;
  onExport: () => void;
  onExportHtml: () => void;
  onNewAiChat: () => void;
  onRunOcr: () => void;
}

/**
 * Popup menu for the Tools toolbar button. Exposes advanced folder operations:
 * AI chat (when AI is enabled), folder analysis, OCR, then (each group below a
 * divider) the folder graph of all files or of Markdown files only, and the
 * export options.
 */
export default function ToolsPopupMenu({
  anchorRef,
  onClose,
  onFolderAnalysis,
  onFolderGraph,
  onMarkdownGraph,
  onExport,
  onExportHtml,
  onNewAiChat,
  onRunOcr,
}: ToolsPopupMenuProps) {
  // Read live from the store so toggling "Enable AI" in AI Settings takes effect without a restart.
  const aiEnabled = useAS(s => s.aiConfig.aiEnabled);
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      {aiEnabled && (
        <PopupMenuItem
          label="New AI Chat"
          data-testid="menu-new-ai-chat"
          onClick={() => { onNewAiChat(); onClose(); }}
        />
      )}
      <PopupMenuItem
        label="Folder Analysis"
        data-testid="menu-folder-analysis"
        onClick={() => { onFolderAnalysis(); onClose(); }}
      />
      <PopupMenuItem
        label="Run OCR"
        data-testid="menu-run-ocr"
        onClick={() => { onRunOcr(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Graph All"
        data-testid="menu-folder-graph"
        onClick={() => { onFolderGraph(); onClose(); }}
      />
      <PopupMenuItem
        label="Graph Markdown"
        data-testid="menu-markdown-graph"
        onClick={() => { onMarkdownGraph(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Export to File"
        data-testid="menu-export"
        onClick={() => { onExport(); onClose(); }}
      />
      <PopupMenuItem
        label="Export to Folder (HTML)"
        data-testid="menu-export-html"
        onClick={() => { onExportHtml(); onClose(); }}
      />
    </PopupMenu>
  );
}
