import { clsx } from 'clsx';
import { ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { SearchDefinition } from '../../shared/types';
import { BUTTON_CLASS_TB_GREEN, BUTTON_CLASS_TB_RED, BUTTON_CLASS_TOGGLE_OFF_GHOST, BUTTON_CLASS_TOGGLE_ON, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../renderer/styles';

interface SearchDefinitionsPanelProps {
  searchName: string;
  onSearchNameChange: (name: string) => void;
  /** Unsorted saved searches; sorted by name for display here. */
  definitions: SearchDefinition[];
  onSelect: (def: SearchDefinition) => void;
  onSave: () => void;
  onRequestDelete: () => void;
}

/** Left panel of the Search dialog: the definition-name field plus the list of
 *  saved search definitions, with save/delete actions. */
function SearchDefinitionsPanel({
  searchName,
  onSearchNameChange,
  definitions,
  onSelect,
  onSave,
  onRequestDelete,
}: SearchDefinitionsPanelProps) {
  const sortedDefinitions = [...definitions].sort((a, b) => a.name.localeCompare(b.name));
  const hasName = searchName.trim().length > 0;

  return (
    <div className="flex flex-col border-r border-slate-600 w-1/3">
      <div className="p-6 pb-1">
        <label className={DLG_LABEL_CLASS}>Search Definition Name</label>
        <input
          type="text"
          value={searchName}
          onChange={(e) => onSearchNameChange(e.target.value)}
          placeholder="Enter a name..."
          data-testid="search-name-input"
          className={DLG_INPUT_CLASS}
        />
        <div className="flex justify-end gap-1 mt-1">
          <button
            type="button"
            onClick={onSave}
            disabled={!hasName}
            data-testid="save-search-button"
            title="Save search definition"
            className={BUTTON_CLASS_TB_GREEN}
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRequestDelete}
            disabled={!hasName}
            data-testid="delete-search-button"
            title="Delete search definition"
            className={BUTTON_CLASS_TB_RED}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 p-2 overflow-auto">
        {sortedDefinitions.length === 0 ? (
          <p className="text-xs text-slate-500 p-2">No saved searches yet.</p>
        ) : (
          <ul className="space-y-0.5 min-w-max">
            {sortedDefinitions.map((def) => (
              <li key={def.name}>
                <button
                  type="button"
                  onClick={() => onSelect(def)}
                  className={clsx(
                    'w-full text-left px-3 py-1.5 rounded text-sm whitespace-nowrap overflow-hidden text-ellipsis',
                    searchName === def.name ? BUTTON_CLASS_TOGGLE_ON : BUTTON_CLASS_TOGGLE_OFF_GHOST,
                  )}
                  title={def.name}
                >
                  {def.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SearchDefinitionsPanel;
