import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { SearchDefinition } from '../../shared/types';
import { validateSearchDefinitionName } from '../../shared/searchHelpers';
import { BUTTON_CLASS_LINK_MUTED, BUTTON_CLASS_LINK_RED, DLG_INPUT_CLASS_ALT_COMPACT } from '../../renderer/styles';

/** The name being typed in place: a brand-new definition, or a rename of `name`. */
type NameEdit = { kind: 'new' } | { kind: 'rename'; name: string };

interface SearchDefinitionsPanelProps {
  /** Unsorted saved searches; sorted by name for display here. */
  definitions: SearchDefinition[];
  /** Name of the definition the dialog's form is editing, or null for an unsaved search. */
  selectedName: string | null;
  onSelect: (def: SearchDefinition) => void;
  /** Saves the dialog's current form under `name`; resolves false if it couldn't
   *  (e.g. an Advanced query with a syntax error), leaving the name input open. */
  onCreate: (name: string) => Promise<boolean>;
  onRename: (oldName: string, newName: string) => void;
  onRequestDelete: (name: string) => void;
}

/**
 * Left panel of the Search dialog: the saved search definitions, modeled on the
 * category list in TagsEditorView. ＋ adds a row whose name is typed in place
 * (it saves the dialog's current form under that name); each row has hover ✎
 * (rename in place) and ✕ (delete) buttons. Enter or blur commits a name, Escape
 * or a blank name cancels, and a clashing name shows an error under the input.
 * Every list change is saved immediately by the dialog's callbacks.
 *
 * See: (USER_GUIDE.md#saving-search-definitions)
 */
function SearchDefinitionsPanel({
  definitions,
  selectedName,
  onSelect,
  onCreate,
  onRename,
  onRequestDelete,
}: SearchDefinitionsPanelProps) {
  const sortedDefinitions = [...definitions].sort((a, b) => a.name.localeCompare(b.name));
  const [edit, setEdit] = useState<NameEdit | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  // Set once Enter/Escape has ended the edit, so a blur fired as the input
  // unmounts can't commit (or re-commit) it.
  const editDoneRef = useRef(false);

  const startEdit = (next: NameEdit, value: string) => {
    editDoneRef.current = false;
    setEdit(next);
    setEditValue(value);
    setEditError(null);
  };

  const endEdit = () => {
    editDoneRef.current = true;
    setEdit(null);
    setEditError(null);
  };

  /** Commits the typed name. With `keepOpenOnError` (Enter) a bad name leaves the
   *  input open with the error; otherwise (blur) the edit is just cancelled. */
  const commitEdit = (keepOpenOnError: boolean) => {
    if (!edit || editDoneRef.current) return;
    const name = editValue.trim();
    if (!name) { endEdit(); return; }
    const currentName = edit.kind === 'rename' ? edit.name : undefined;
    const error = validateSearchDefinitionName(name, definitions.map((d) => d.name), currentName);
    if (error) {
      if (keepOpenOnError) setEditError(error);
      else endEdit();
      return;
    }
    if (edit.kind === 'new') {
      // Mark the edit done while the save is pending so a blur can't commit it
      // again; reopen it for Enter if the save fails.
      editDoneRef.current = true;
      void onCreate(name).then((ok) => {
        if (!ok && keepOpenOnError) editDoneRef.current = false;
        else endEdit();
      });
      return;
    }
    if (name !== edit.name) {
      onRename(edit.name, name);
    }
    endEdit();
  };

  const renderNameInput = () => (
    <div className="flex-1 min-w-0">
      <input
        type="text"
        value={editValue}
        autoFocus
        placeholder="Search name"
        onChange={(e) => { setEditValue(e.target.value); setEditError(null); }}
        onBlur={() => commitEdit(false)}
        onKeyDown={(e) => {
          // Enter/Escape during IME composition confirm/cancel the
          // composition itself — not the name edit.
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endEdit(); }
        }}
        data-testid="search-definition-name-input"
        className={`${DLG_INPUT_CLASS_ALT_COMPACT} w-full`}
      />
      {editError && (
        <p className="text-xs text-red-400 mt-1 whitespace-normal" data-testid="search-definition-name-error">
          {editError}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col border-r border-slate-600 w-1/3 min-w-0">
      <div className="pl-4 pr-4 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
        <span>Saved Searches</span>
        <button
          type="button"
          title="Save current search as…"
          onClick={() => startEdit({ kind: 'new' }, '')}
          className={`${BUTTON_CLASS_LINK_MUTED} text-lg leading-none`}
          data-testid="search-definition-add-button"
        >
          ＋
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {edit?.kind === 'new' && (
          <div className="flex items-start gap-1 px-2 py-1.5 rounded bg-slate-700">
            {renderNameInput()}
          </div>
        )}
        {sortedDefinitions.map((def) => {
          const renaming = edit?.kind === 'rename' && edit.name === def.name;
          const selected = selectedName === def.name;
          return (
            <div
              key={def.name}
              className={clsx(
                'flex items-center gap-1 px-2 py-1.5 rounded group',
                selected
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200',
              )}
            >
              {renaming ? renderNameInput() : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect(def)}
                    aria-pressed={selected}
                    title={def.name}
                    className="flex-1 min-w-0 text-left text-sm truncate cursor-pointer"
                    data-testid={`search-definition-row-${def.name}`}
                  >
                    {def.name}
                  </button>
                  <button
                    type="button"
                    title="Rename"
                    onClick={() => startEdit({ kind: 'rename', name: def.name }, def.name)}
                    className={`${BUTTON_CLASS_LINK_MUTED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                    data-testid={`search-definition-edit-button-${def.name}`}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    title="Delete search definition"
                    onClick={() => onRequestDelete(def.name)}
                    className={`${BUTTON_CLASS_LINK_RED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                    data-testid={`search-definition-delete-button-${def.name}`}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          );
        })}
        {sortedDefinitions.length === 0 && edit?.kind !== 'new' && (
          <p className="text-xs text-slate-500 p-2">No saved searches yet. Click ＋ to save the current search.</p>
        )}
      </div>
    </div>
  );
}

export default SearchDefinitionsPanel;
