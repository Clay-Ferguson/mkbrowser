import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface EntryPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenExternal: () => void;
  /** When omitted, the "View File" item is hidden (folders, or this file is already the one on screen). */
  onViewFile?: () => void;
  /** When omitted, the "Attach: Clipboard" item is hidden. */
  onPasteClipboardAsAttachment?: () => void;
  /** When omitted, the "Attach: Existing File" item is hidden. */
  onAttachFromFile?: () => void;
  /** When omitted, the "Attach: New Markdown" item is hidden. */
  onCreateAttachment?: () => void;
  /** When omitted, the "Make Folder" item is hidden (folders). */
  onMakeFolder?: () => void;
  /** Copies the entry's absolute path to the clipboard (same as the index tree's "Copy Path"). */
  onCopyPath: () => void;
  /** Drives the bookmark item's label between add and remove. */
  isBookmarked: boolean;
  onToggleBookmark: () => void;
}

/**
 * Popup menu for the hamburger button on an entry's EntryActionBar. Holds the
 * per-entry actions that don't warrant a dedicated icon button, keeping the
 * hover bar from growing unbounded. Text-only by design — no icons. The
 * "Attach" items sit at the bottom, below a divider.
 *
 * See: (file_attachments.md#entry-menu-the-three-attach-items-srccomponentsmenusentrypopupmenutsx)
 * See: (USER_GUIDE.md#adding-a-bookmark)
 * See: (USER_GUIDE.md#make-folder-wrap-a-file-in-a-folder)
 * See: (USER_GUIDE.md#adding-attachments)
 */
export default function EntryPopupMenu({
  anchorRef,
  onClose,
  onOpenExternal,
  onViewFile,
  onPasteClipboardAsAttachment,
  onAttachFromFile,
  onCreateAttachment,
  onMakeFolder,
  onCopyPath,
  isBookmarked,
  onToggleBookmark,
}: EntryPopupMenuProps) {
  const hasAttachItems = !!(onPasteClipboardAsAttachment || onAttachFromFile || onCreateAttachment);
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
      <PopupMenuItem
        label={isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
        data-testid="menu-entry-bookmark"
        onClick={() => { onToggleBookmark(); onClose(); }}
      />
      {onMakeFolder && (
        <PopupMenuItem
          label="Make Folder"
          data-testid="menu-entry-make-folder"
          onClick={() => { onMakeFolder(); onClose(); }}
        />
      )}
      <PopupMenuItem
        label="Copy Path"
        data-testid="menu-entry-copy-path"
        onClick={() => { onCopyPath(); onClose(); }}
      />
      {hasAttachItems && <PopupMenuDivider />}
      {onPasteClipboardAsAttachment && (
        <PopupMenuItem
          label="Attach: Clipboard"
          data-testid="menu-entry-paste-clipboard-attachment"
          onClick={() => { onPasteClipboardAsAttachment(); onClose(); }}
        />
      )}
      {onAttachFromFile && (
        <PopupMenuItem
          label="Attach: Existing File"
          data-testid="menu-entry-attach-from-file"
          onClick={() => { onAttachFromFile(); onClose(); }}
        />
      )}
      {onCreateAttachment && (
        <PopupMenuItem
          label="Attach: New Markdown"
          data-testid="menu-entry-create-attachment"
          onClick={() => { onCreateAttachment(); onClose(); }}
        />
      )}
    </PopupMenu>
  );
}
