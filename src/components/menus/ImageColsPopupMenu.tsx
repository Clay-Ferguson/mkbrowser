import type { RefObject } from 'react';
import type { ImageCols } from '../../shared/types';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

const IMAGE_COLS_OPTIONS: { value: ImageCols; label: string }[] = [
  { value: 1, label: '1 Img Column' },
  { value: 2, label: '2 Img Columns' },
  { value: 3, label: '3 Img Columns' },
  { value: 4, label: '4 Img Columns' },
];

interface ImageColsPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** The currently active column count; its menu item is rendered with a checkmark. */
  currentImageCols: ImageCols;
  onSelectImageCols: (imageCols: ImageCols) => void;
  /** Document Mode always uses the single-column layout, so every item is disabled there. */
  disabled: boolean;
}

/**
 * Popup menu for the Image columns toolbar button. Renders a checkable list of
 * column counts for laying out image entries side by side in the listing.
 */
export default function ImageColsPopupMenu({
  anchorRef,
  onClose,
  currentImageCols,
  onSelectImageCols,
  disabled,
}: ImageColsPopupMenuProps) {

  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      {IMAGE_COLS_OPTIONS.map(({ value, label }) => (
        <PopupMenuItem
          key={value}
          label={label}
          selected={currentImageCols === value}
          disabled={disabled}
          onClick={() => { onSelectImageCols(value); onClose(); }}
        />
      ))}
    </PopupMenu>
  );
}
