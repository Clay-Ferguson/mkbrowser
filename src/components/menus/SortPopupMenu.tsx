import type { RefObject } from 'react';
import type { SortOrder } from '../../shared/types';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

interface SortPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** The currently active sort order; its menu item is rendered with a checkmark. */
  currentSortOrder: SortOrder;
  onSelectSortOrder: (order: SortOrder) => void;
}

/**
 * Popup menu for the Sort toolbar button. Renders a checkable list of sort
 * options.
 */
export default function SortPopupMenu({
  anchorRef,
  onClose,
  currentSortOrder,
  onSelectSortOrder,
}: SortPopupMenuProps) {

  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Filename"
        selected={currentSortOrder === 'alphabetical'}
        onClick={() => { onSelectSortOrder('alphabetical'); onClose(); }}
      />
      <PopupMenuItem
        label="Created Time"
        selected={currentSortOrder === 'created-chron'}
        onClick={() => { onSelectSortOrder('created-chron'); onClose(); }}
      />
      <PopupMenuItem
        label="Created Time (rev-chron)"
        selected={currentSortOrder === 'created-reverse'}
        onClick={() => { onSelectSortOrder('created-reverse'); onClose(); }}
      />
      <PopupMenuItem
        label="Modified Time"
        selected={currentSortOrder === 'modified-chron'}
        onClick={() => { onSelectSortOrder('modified-chron'); onClose(); }}
      />
      <PopupMenuItem
        label="Modified Time (rev-chron)"
        selected={currentSortOrder === 'modified-reverse'}
        onClick={() => { onSelectSortOrder('modified-reverse'); onClose(); }}
      />
    </PopupMenu>
  );
}
