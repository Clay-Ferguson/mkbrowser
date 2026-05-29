import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface SystemPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSettings: () => void;
  onAiSettings: () => void;
}

export default function SystemPopupMenu({
  anchorRef,
  onClose,
  onSettings,
  onAiSettings,
}: SystemPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
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
    </PopupMenu>
  );
}
