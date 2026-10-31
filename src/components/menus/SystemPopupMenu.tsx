import type { RefObject } from 'react';
import PopupMenu, { PopupMenuDivider, PopupMenuItem } from './base/PopupMenu';

interface SystemPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSettings: () => void;
  onAiSettings: () => void;
  onTypesEditor: () => void;
  /** Opens the Tags tab (the hashtag editor). */
  onTagsEditor: () => void;
  /** Opens the Help tab (a read-only render of the User Guide). */
  onHelp: () => void;
}

/**
 * Popup menu for the system (gear/hamburger) toolbar button. Provides
 * navigation to the general Settings view, the AI Settings view, the
 * Types Editor view, the Tags (hashtag editor) view, and the Help tab.
 *
 * See: (USER_GUIDE.md#settings)
 * See: (USER_GUIDE.md#opening-the-types-editor)
 * See: (USER_GUIDE.md#managing-your-hashtag-library-tags-editor)
 */
export default function SystemPopupMenu({
  anchorRef,
  onClose,
  onSettings,
  onAiSettings,
  onTypesEditor,
  onTagsEditor,
  onHelp,
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
        label="Types"
        data-testid="menu-types-editor"
        onClick={() => { onTypesEditor(); onClose(); }}
      />
      <PopupMenuItem
        label="Tags"
        data-testid="menu-edit-hashtags"
        onClick={() => { onTagsEditor(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Help"
        data-testid="menu-help"
        onClick={() => { onHelp(); onClose(); }}
      />
    </PopupMenu>
  );
}
