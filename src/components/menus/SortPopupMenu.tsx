import type { RefObject } from 'react';
import type { SortOrder } from '../../store/types';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';

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
  hasIndexOrder?: boolean;
  onSelectSortOrder: (order: SortOrder) => void;
}

export default function SortPopupMenu({
  anchorRef,
  onClose,
  currentSortOrder,
  hasIndexOrder,
  onSelectSortOrder,
}: SortPopupMenuProps) {
  if (hasIndexOrder) {
    return (
      <PopupMenu anchorRef={anchorRef} onClose={onClose} style={{ maxWidth: '20rem' }}>
        <div className="px-4 py-2 text-sm text-slate-400 italic select-none" onClick={onClose}>
          Files ordered by .INDEX.yaml
        </div>
      </PopupMenu>
    );
  }

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
    </PopupMenu>
  );
}
