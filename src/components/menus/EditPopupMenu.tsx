import type { RefObject } from 'react';
import type { ImageSize } from '../../shared/shared';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

/**
 * Popup menu for the Edit toolbar button. Exposes file-level editing operations:
 * selection management, split/join, find-and-replace, copy link, and the global
 * inline image size toggle. Each action callback is responsible for the actual
 * operation; the menu only wires up the items and closes itself after a selection.
 */
interface EditPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onSplit: () => void;
  onJoin: () => void;
  onReplaceInFiles: () => void;
  onCopyLink: () => void;
  /** Current global inline image size — decides which direction the toggle item offers. */
  imageSize: ImageSize;
  onToggleImageSize: () => void;
  // Disable conditions
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
  onSelectAll,
  onUnselectAll,
  onSplit,
  onJoin,
  onReplaceInFiles,
  onCopyLink,
  imageSize,
  onToggleImageSize,
  unselectAllDisabled,
  splitDisabled,
  joinDisabled,
  copyLinkDisabled,
  onEnableCustomOrdering,
}: EditPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
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
      <PopupMenuDivider />
      <PopupMenuItem
        label={imageSize === 'small' ? 'Switch to large image size' : 'Switch to small image size'}
        data-testid="menu-toggle-image-size"
        onClick={() => { onToggleImageSize(); onClose(); }}
      />
    </PopupMenu>
  );
}
