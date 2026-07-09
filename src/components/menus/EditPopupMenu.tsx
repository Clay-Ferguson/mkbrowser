import type { RefObject } from 'react';
import type { ImageSize } from '../../shared/shared';
import PopupMenu, { PopupMenuItem, PopupMenuDivider, PopupMenuComboBox, type PopupMenuComboBoxOption } from './base/PopupMenu';

/** The global inline image size choices, as offered by the menu's combo box. */
const IMAGE_SIZE_OPTIONS: readonly PopupMenuComboBoxOption<ImageSize>[] = [
  { value: 'small', label: 'Small Images' },
  { value: 'medium', label: 'Medium Images' },
  { value: 'large', label: 'Large Images' },
];

/**
 * Popup menu for the Edit toolbar button. Exposes file-level editing operations:
 * selection management, split/join, find-and-replace, copy link, and the global
 * inline image size. Each action callback is responsible for the actual
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
  /** Current global inline image size, shown as the combo box's selection. */
  imageSize: ImageSize;
  onChangeImageSize: (size: ImageSize) => void;
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
  onChangeImageSize,
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
      <PopupMenuComboBox
        value={imageSize}
        options={IMAGE_SIZE_OPTIONS}
        data-testid="menu-image-size"
        onChange={(size) => { onChangeImageSize(size); onClose(); }}
      />
    </PopupMenu>
  );
}
