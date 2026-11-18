import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface ActiveEditPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Opens the Calendar Info dialog. When omitted (non-Markdown files), the item is shown disabled. */
  onCalendarInfo?: () => void;
  /**
   * Whether the editor is currently maximized (`settings.expandedEditor`, or always-expanded
   * single-file mode), shown as a check mark beside "Expanded Editor".
   */
  expandedEditor: boolean;
  /**
   * Flips the expanded-editor preference. Omitted where the editor is always expanded
   * (`alwaysExpandedEditor`) and the toggle would be a no-op; the item is then shown disabled.
   *
   * See: (USER_GUIDE.md#expand-editor)
   * See: (single_file_browsing.md#always-expanded-editing-alwaysexpandededitor)
   */
  onToggleExpandedEditor?: () => void;
  /** Current `settings.enableThesaurus`, shown as a check mark beside "Thesaurus". */
  thesaurusEnabled: boolean;
  /**
   * Flips `settings.enableThesaurus`. Omitted where the synonym strip can't appear (folder
   * listing, code files); the item is then shown disabled.
   *
   * See: (thesaurus_view.md#where-the-item-appears)
   */
  onToggleThesaurus?: () => void;
}

/**
 * Popup menu for the hamburger button on the edit-mode toolbar (EntryEditToolbar),
 * shown just left of Cancel/Save while a file is being edited. It is the edit-mode
 * counterpart of EntryPopupMenu, which is only available when the file is not being
 * edited, and is the home for actions that apply to the active edit session.
 * Text-only by design — no icons. "Expanded Editor" and "Thesaurus" are checkable settings
 * (check mark when on, like SortPopupMenu's items), so every item reserves the check column to
 * keep labels aligned.
 *
 * See: (USER_GUIDE.md#expand-editor)
 * See: (USER_GUIDE.md#thesaurus)
 * See: (calendar_view.md#calendarview-component)
 * See: (popup_menus.md#2-specific-menu-components--srccomponentsmenus)
 * See: (popup_menus.md#menus-inside-clickable-rows)
 */
export default function ActiveEditPopupMenu({
  anchorRef,
  onClose,
  onCalendarInfo,
  expandedEditor,
  onToggleExpandedEditor,
  thesaurusEnabled,
  onToggleThesaurus,
}: ActiveEditPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose} align="right" data-testid="active-edit-popup-menu">
      <PopupMenuItem
        label="Calendar Info"
        data-testid="menu-active-edit-calendar-info"
        selected={false}
        disabled={!onCalendarInfo}
        onClick={() => { onCalendarInfo?.(); onClose(); }}
      />
      {/* Persisted settings rather than actions on this file, so they get their own group. */}
      <PopupMenuDivider />
      <PopupMenuItem
        label="Expanded Editor"
        data-testid="menu-active-edit-expanded-editor"
        selected={expandedEditor}
        disabled={!onToggleExpandedEditor}
        onClick={() => { onToggleExpandedEditor?.(); onClose(); }}
      />
      <PopupMenuItem
        label="Thesaurus"
        data-testid="menu-active-edit-thesaurus"
        selected={thesaurusEnabled}
        disabled={!onToggleThesaurus}
        onClick={() => { onToggleThesaurus?.(); onClose(); }}
      />
    </PopupMenu>
  );
}
