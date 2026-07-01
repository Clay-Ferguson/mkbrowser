import type { RefObject } from 'react';
import type { SortOrder } from '../../shared/types';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

/** All available sort modes shown as checkable menu items. */
const sortOptions: { value: SortOrder; label: string }[] = [
  { value: 'alphabetical', label: 'Filename' },
  { value: 'created-chron', label: 'Created Time' },
  { value: 'created-reverse', label: 'Created Time (rev-chron)' },
  { value: 'modified-chron', label: 'Modified Time' },
  { value: 'modified-reverse', label: 'Modified Time (rev-chron)' },
];

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
      {sortOptions.map((option) => {
        const isActive = option.value === currentSortOrder;
        return (
          <PopupMenuItem
            key={option.value}
            label={option.label}
            selected={isActive}
            onClick={() => { onSelectSortOrder(option.value); onClose(); }}
          />
        );
      })}
    </PopupMenu>
  );
}
