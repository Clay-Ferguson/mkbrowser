import { useMemo, type RefObject } from 'react';
import type { SearchDefinition } from '../../store';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';
import { globalHighlightText, setGlobalHighlightText, applyGlobalHighlight } from '../../renderer/globalHighlight';

interface SearchPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Saved search definitions to list; rendered sorted alphabetically by name. */
  searchDefinitions: SearchDefinition[];
  onNewSearch: () => void;
  /** Called when the user left-clicks a saved search to run it immediately. */
  onRunSearch: (definition: SearchDefinition) => void;
  /** Called when the user right-clicks a saved search to edit its definition. */
  onEditSearch: (definition: SearchDefinition) => void;
}

/**
 * Popup menu for the Search toolbar button. Lists saved search definitions
 * alphabetically (left-click to run, right-click to edit) and provides a
 * "New Search…" entry at the top. Also shows "Clear Search Highlight" when a
 * global text highlight is active.
 */
export default function SearchPopupMenu({
  anchorRef,
  onClose,
  searchDefinitions,
  onNewSearch,
  onRunSearch,
  onEditSearch,
}: SearchPopupMenuProps) {
  // Sort definitions alphabetically by name
  const sorted = useMemo(() =>
    [...searchDefinitions].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    ),
    [searchDefinitions]
  );

  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="New Search..."
        onClick={() => { onNewSearch(); onClose(); }}
      />
      {globalHighlightText && (
        <PopupMenuItem
          label="Clear Search Highlight"
          onClick={() => { setGlobalHighlightText(null); applyGlobalHighlight(''); onClose(); }}
        />
      )}
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
