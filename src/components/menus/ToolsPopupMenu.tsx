import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';
import { useAS } from '../../store';

interface ToolsPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  // Runs the built-in Recent Files search. See: (USER_GUIDE.md#recent-files)
  onRecentFiles: () => void;
  onFolderAnalysis: () => void;
  // Graph All (`menu-folder-graph`) and Graph Markdown (`menu-markdown-graph`).
  // See: (folder_graph.md#renderer)
  onFolderGraph: () => void;
  onMarkdownGraph: () => void;
  onExport: () => void;
  onExportHtml: () => void;
  onNewAiChat: () => void;
}

/**
 * Popup menu for the Tools toolbar button. Exposes advanced folder operations:
 * the built-in Recent Files listing, then (each group below a divider) AI chat
 * (when AI is enabled) and folder analysis, the folder graph of all files or of
 * Markdown files only, and the export options.
 *
 * See: (USER_GUIDE.md#recent-files)
 * See: (ai_chat.md#starting-a-conversation)
 * See: (folder_graph.md#overview)
 * See: (USER_GUIDE.md#folder-analysis)
 * See: (USER_GUIDE.md#launching-the-graph)
 * See: (USER_GUIDE.md#exporting)
 * See: (popup_menus.md#existing-example)
 */
export default function ToolsPopupMenu({
  anchorRef,
  onClose,
  onRecentFiles,
  onFolderAnalysis,
  onFolderGraph,
  onMarkdownGraph,
  onExport,
  onExportHtml,
  onNewAiChat,
}: ToolsPopupMenuProps) {
  // Read live from the store so toggling "Enable AI" in AI Settings takes effect without a restart.
  // See: (popup_menus.md#step-1-create-the-menu-component)
  const aiEnabled = useAS(s => s.aiConfig.aiEnabled);
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Recent Files"
        data-testid="menu-recent-files"
        onClick={() => { onRecentFiles(); onClose(); }}
      />
      <PopupMenuDivider />
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
