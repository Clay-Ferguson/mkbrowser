import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface EntryPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenExternal: () => void;
  /** When omitted, the "View File" item is hidden (e.g. this file is already the one on screen). */
  onViewFile?: () => void;
}

/**
 * Popup menu for the hamburger button on an entry's EntryActionBar. Holds the
 * per-entry actions that don't warrant a dedicated icon button, keeping the
 * hover bar from growing unbounded. Text-only by design — no icons.
 */
export default function EntryPopupMenu({
  anchorRef,
  onClose,
  onOpenExternal,
  onViewFile,
}: EntryPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose} align="right" data-testid="entry-popup-menu">
      <PopupMenuItem
        label="Open with OS App"
        data-testid="menu-entry-open-external"
        onClick={() => { onOpenExternal(); onClose(); }}
      />
      {onViewFile && (
        <PopupMenuItem
          label="View File"
          data-testid="menu-entry-view-file"
          onClick={() => { onViewFile(); onClose(); }}
        />
      )}
    </PopupMenu>
  );
}
