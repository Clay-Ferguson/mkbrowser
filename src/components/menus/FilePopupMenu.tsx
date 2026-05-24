import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface FilePopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectFolder: () => void;
  onQuit: () => void;
  onSettings: () => void;
  onAiSettings: () => void;
  onEditHashtags: () => void;
}

export default function FilePopupMenu({
  anchorRef,
  onClose,
  onSelectFolder,
  onQuit,
  onSettings,
  onAiSettings,
  onEditHashtags,
}: FilePopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Open Folder"
        onClick={() => { onSelectFolder(); onClose(); }}
        data-testid="menu-open-folder"
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Settings"
        data-testid="menu-settings"
        onClick={() => { onSettings(); onClose(); }}
      />
      <PopupMenuItem
        label="AI Settings"
        data-testid="menu-ai-settings"
        onClick={() => { onAiSettings(); onClose(); }}
      />
      <PopupMenuItem
        label="Edit Hashtags"
        data-testid="menu-edit-hashtags"
        onClick={() => { onEditHashtags(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Quit"
        onClick={() => { onQuit(); onClose(); }}
      />
    </PopupMenu>
  );
}
