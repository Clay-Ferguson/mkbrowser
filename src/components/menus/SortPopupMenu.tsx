import type { RefObject } from 'react';
import type { SortOrder } from '../../store/types';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

const sortOptions: { value: SortOrder; label: string }[] = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'created-chron', label: 'Created Time (chron)' },
  { value: 'created-reverse', label: 'Created Time (reverse-chron)' },
  { value: 'modified-chron', label: 'Modified Time (chron)' },
  { value: 'modified-reverse', label: 'Modified Time (reverse-chron)' },
];

interface SortPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  currentSortOrder: SortOrder;
  onSelectSortOrder: (order: SortOrder) => void;
}

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
        const label = isActive ? `✓  ${option.label}` : `    ${option.label}`;
        return (
          <PopupMenuItem
            key={option.value}
            label={label}
            onClick={() => { onSelectSortOrder(option.value); onClose(); }}
          />
        );
      })}
    </PopupMenu>
  );
}
