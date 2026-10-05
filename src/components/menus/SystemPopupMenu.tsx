import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface SystemPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSettings: () => void;
  onAiSettings: () => void;
  onTypesEditor: () => void;
}

/**
 * Popup menu for the system (gear/hamburger) toolbar button. Provides
 * navigation to the general Settings view, the AI Settings view, and the
 * Types Editor view.
 */
export default function SystemPopupMenu({
  anchorRef,
  onClose,
  onSettings,
  onAiSettings,
  onTypesEditor,
}: SystemPopupMenuProps) {
  return (
    <PopupMenu data-testid="system-popup-menu" anchorRef={anchorRef} onClose={onClose}>
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
        label="Types Editor"
        data-testid="menu-types-editor"
        onClick={() => { onTypesEditor(); onClose(); }}
      />
    </PopupMenu>
  );
}
