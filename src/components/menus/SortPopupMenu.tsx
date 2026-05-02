import type { RefObject } from 'react';
import type { SortOrder } from '../../store/types';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

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
  currentSortOrder: SortOrder;
  onSelectSortOrder: (order: SortOrder) => void;
  onEnableCustomOrdering?: () => void;
}

export default function SortPopupMenu({
  anchorRef,
  onClose,
  currentSortOrder,
  onSelectSortOrder,
  onEnableCustomOrdering,
}: SortPopupMenuProps) {

  return (
    // maxWidth hack: this menu renders inexplicably wide without it; root cause unknown
    <PopupMenu anchorRef={anchorRef} onClose={onClose} style={{ maxWidth: '20rem' }}>
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
      {onEnableCustomOrdering && (
        <>
          <PopupMenuDivider />
          <PopupMenuItem
            label="Enable Document Mode"
            onClick={() => { onEnableCustomOrdering(); onClose(); }}
          />
        </>
      )}
    </PopupMenu>
  );
}
