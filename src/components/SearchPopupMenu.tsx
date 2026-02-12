import type { RefObject } from 'react';
import type { SearchDefinition } from '../store';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './PopupMenu';

interface SearchPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  searchDefinitions: SearchDefinition[];
  onNewSearch: () => void;
  onRunSearch: (definition: SearchDefinition) => void;
  onEditSearch: (definition: SearchDefinition) => void;
}

export default function SearchPopupMenu({
  anchorRef,
  onClose,
  searchDefinitions,
  onNewSearch,
  onRunSearch,
  onEditSearch,
}: SearchPopupMenuProps) {
  // Sort definitions alphabetically by name
  const sorted = [...searchDefinitions].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="New Search..."
        onClick={() => { onNewSearch(); onClose(); }}
      />
      {sorted.length > 0 && (
        <>
          <PopupMenuDivider />
          {sorted.map((def) => (
            <div
              key={def.name}
              onContextMenu={(e) => {
                e.preventDefault();
                onEditSearch(def);
                onClose();
              }}
            >
              <PopupMenuItem
                label={def.name}
                onClick={() => { onRunSearch(def); onClose(); }}
              />
            </div>
          ))}
        </>
      )}
    </PopupMenu>
  );
}
