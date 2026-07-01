import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

/**
 * Popup menu for the Edit toolbar button. Exposes file-level editing operations:
 * undo cut, selection management, split/join, find-and-replace, and copy link.
 * Each action callback is responsible for the actual operation; the menu only
 * wires up the items and closes itself after a selection.
 */
interface EditPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onUndoCut: () => void;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onSplit: () => void;
  onJoin: () => void;
  onReplaceInFiles: () => void;
  onCopyLink: () => void;
  // Disable conditions
  undoCutDisabled: boolean;
  unselectAllDisabled: boolean;
  splitDisabled: boolean;
  joinDisabled: boolean;
  copyLinkDisabled: boolean;
  /** When provided, an "Enable Document Mode" item is appended after a divider. */
  onEnableCustomOrdering?: () => void;
}

export default function EditPopupMenu({
  anchorRef,
  onClose,
  onUndoCut,
  onSelectAll,
  onUnselectAll,
  onSplit,
  onJoin,
  onReplaceInFiles,
  onCopyLink,
  undoCutDisabled,
  unselectAllDisabled,
  splitDisabled,
  joinDisabled,
  copyLinkDisabled,
  onEnableCustomOrdering,
}: EditPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Undo Cut"
        onClick={() => { onUndoCut(); onClose(); }}
        disabled={undoCutDisabled}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Select All"
        onClick={() => { onSelectAll(); onClose(); }}
      />
      <PopupMenuItem
        label="Unselect All"
        onClick={() => { onUnselectAll(); onClose(); }}
        disabled={unselectAllDisabled}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Split"
        onClick={() => { onSplit(); onClose(); }}
        disabled={splitDisabled}
      />
      <PopupMenuItem
        label="Join"
        onClick={() => { onJoin(); onClose(); }}
        disabled={joinDisabled}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Replace in Files"
        onClick={() => { onReplaceInFiles(); onClose(); }}
      />
      <PopupMenuItem
        label="Copy Link"
        data-testid="menu-copy-link"
        onClick={() => { onCopyLink(); onClose(); }}
        disabled={copyLinkDisabled}
      />
      {onEnableCustomOrdering && (
        <>
          <PopupMenuItem
            label="Enable Document Mode"
            onClick={() => { onEnableCustomOrdering(); onClose(); }}
          />
        </>
      )}
    </PopupMenu>
  );
}
