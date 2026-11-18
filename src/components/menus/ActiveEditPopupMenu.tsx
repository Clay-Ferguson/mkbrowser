import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface ActiveEditPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Opens the Calendar Info dialog. When omitted (non-Markdown files), the item is shown disabled. */
  onCalendarInfo?: () => void;
}

/**
 * Popup menu for the hamburger button on the edit-mode toolbar (EntryEditToolbar),
 * shown just left of Cancel/Save while a file is being edited. It is the edit-mode
 * counterpart of EntryPopupMenu, which is only available when the file is not being
 * edited, and is the home for actions that apply to the active edit session.
 * Text-only by design — no icons.
 *
 * See: (calendar_view.md#calendarview-component)
 * See: (popup_menus.md#2-specific-menu-components--srccomponentsmenus)
 * See: (popup_menus.md#menus-inside-clickable-rows)
 */
export default function ActiveEditPopupMenu({
  anchorRef,
  onClose,
  onCalendarInfo,
}: ActiveEditPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose} align="right" data-testid="active-edit-popup-menu">
      <PopupMenuItem
        label="Calendar Info"
        data-testid="menu-active-edit-calendar-info"
        disabled={!onCalendarInfo}
        onClick={() => { onCalendarInfo?.(); onClose(); }}
      />
    </PopupMenu>
  );
}
