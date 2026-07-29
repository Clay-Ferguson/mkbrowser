import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface EntryPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenExternal: () => void;
  /** When omitted, the "View File" item is hidden (e.g. this file is already the one on screen). */
  onViewFile?: () => void;
  /** When omitted, the "Paste Clipboard as Attachment" item is hidden. */
  onPasteClipboardAsAttachment?: () => void;
  /** Drives the bookmark item's label between add and remove. */
  isBookmarked: boolean;
  onToggleBookmark: () => void;
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
  onPasteClipboardAsAttachment,
  isBookmarked,
  onToggleBookmark,
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
      {onPasteClipboardAsAttachment && (
        <PopupMenuItem
          label="Paste Clipboard as Attachment"
          data-testid="menu-entry-paste-clipboard-attachment"
          onClick={() => { onPasteClipboardAsAttachment(); onClose(); }}
        />
      )}
      <PopupMenuItem
        label={isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
        data-testid="menu-entry-bookmark"
        onClick={() => { onToggleBookmark(); onClose(); }}
      />
    </PopupMenu>
  );
}
