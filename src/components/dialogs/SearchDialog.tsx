import { useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import Dialog from './common/Dialog';
import SearchDefinitionsPanel from './SearchDefinitionsPanel';
import CheckboxField from './common/CheckboxField';
import RadioGroup from './common/RadioGroup';
import JsCodeInput from './common/JsCodeInput';
import type { SearchDefinition, SearchSortBy, SearchSortDirection } from '../../shared/types';
import * as globalHighlight from '../../renderer/globalHighlight';
import { api } from '../../renderer/api';
import { initialSearchDefinition, isSearchDefinitionDirty } from '../../shared/searchHelpers';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_SAVE, DLG_LABEL_CLASS, DLG_INPUT_CLASS_BASE, DLG_CHECK_RADIO_BASE } from '../../renderer/styles';

// Search's checkbox/radio inputs use a blue-500 accent (vs the blue-600 default
// in CheckboxField/RadioField), so override the input class to preserve it.
const SEARCH_CHECKBOX_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-500 rounded disabled:opacity-50 disabled:cursor-not-allowed`;
const SEARCH_RADIO_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-500`;

interface SearchDialogProps {
  onSearch: (definition: SearchDefinition) => void;
  onSave: (definition: SearchDefinition) => void;
  onCancel: () => void;
  onRenameSearchDefinition: (oldName: string, newName: string) => void;
  onDeleteSearchDefinition: (name: string) => void;
  /** The search to edit; omitted for a new search. */
  initialDefinition?: SearchDefinition;
  searchDefinitions: SearchDefinition[];
}

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
}

/**
 * The full search dialog, laid out like TagsEditorView: a left panel listing the
 * saved search definitions (SearchDefinitionsPanel) and a right panel of search
 * options — the query, the target (file contents and/or names), the match type
 * (literal/wildcard/advanced), the EXIF / recent-files / calendar-items-only
 * toggles, and result sorting.
 *
 * The form edits one SearchDefinition. Selecting a row in the list loads that
 * saved definition (its name is shown above the form); with no row selected the
 * form is an unnamed, unsaved search. List changes are saved immediately: ＋
 * saves the current form under a new name, ✎ renames, ✕ deletes (after a
 * ConfirmDialog). Option changes to the selected definition are saved only by
 * Save (onSave) and can be undone by Revert. Search (onSearch) never saves, so a
 * saved search can be tweaked for a one-off run. Switching rows, Revert, and
 * Close all confirm before discarding unsaved changes.
 *
 * Newlines in the query are kept as real newlines all the way through (saved
 * definitions and the search itself). For literal searches the query is also
 * pushed into the globalHighlight module so matches stay highlighted in the
 * document view after the dialog closes.
 */
function SearchDialog({ onSearch, onSave, onCancel, onRenameSearchDefinition, onDeleteSearchDefinition, initialDefinition, searchDefinitions }: SearchDialogProps) {
  const [def, setDef] = useState(() =>
    initialSearchDefinition(initialDefinition, globalHighlight.getGlobalHighlightText())
  );
  // The saved definition the form is editing (preselected when opened to edit one), or null.
  const [selectedName, setSelectedName] = useState<string | null>(() =>
    initialDefinition && searchDefinitions.some((d) => d.name === initialDefinition.name)
      ? initialDefinition.name
      : null
  );
  const { searchText: searchQuery, matchType, searchContents, searchNames, sortBy, sortDirection } = def;
  /** The selected definition as saved, if it still exists. */
  const saved = selectedName === null ? undefined : searchDefinitions.find((d) => d.name === selectedName);
  /** The form has option changes that Save would write to the selected definition. */
  const dirty = saved ? isSearchDefinitionDirty(def, saved) : false;
  /** Neither target is checked, so there is nothing to search. */
  const noTarget = !searchContents && !searchNames;
  const searchImageExif = def.searchImageExif ?? false;
  const mostRecent = def.mostRecent ?? false;
  const calendarItemsOnly = def.calendarItemsOnly ?? false;
  /** A change handler that sets one field of the definition being edited. */
  const set = <K extends keyof SearchDefinition>(key: K) => (value: SearchDefinition[K]) =>
    setDef((d) => ({ ...d, [key]: value }));
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  /** Syntax error found in the Advanced query on the last Search/Save, if any. */
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  /** The Advanced-mode code editor's editable element (set by JsCodeInput). */
  const codeInputRef = useRef<HTMLElement>(null);

  /** Runs `action` at once, or after confirming when it would discard unsaved changes. */
  const confirmIfDirty = (action: () => void) => {
    if (dirty && saved) {
      setPendingConfirm({ message: `Discard unsaved changes to "${saved.name}"?`, onConfirm: action });
    } else {
      action();
    }
  };

  const handleSelectSearchDefinition = (selected: SearchDefinition) => {
    if (selected.name === saved?.name) return;
    confirmIfDirty(() => {
      setSyntaxError(null);
      setDef(initialSearchDefinition(selected, null));
      setSelectedName(selected.name);
    });
  };

  /** For Advanced queries, records any syntax error and resolves false if there is one.
   *  The main process parses the query with the same compiler the search uses (the
   *  renderer can't: its CSP forbids eval, so `new Function` always throws here). */
  const checkSyntax = (query: string): Promise<boolean> => {
    if (matchType !== 'advanced' || !query) {
      setSyntaxError(null);
      return Promise.resolve(true);
    }
    return api.checkAdvancedQuerySyntax(query).then((error) => {
      setSyntaxError(error);
      return !error;
    });
  };

  const handleCodeChange = (value: string) => {
    setSyntaxError(null);
    set('searchText')(value);
  };

  const handleSearch = () => {
    const query = searchQuery.trim();
    if ((!query && !mostRecent) || noTarget) return;
    void checkSyntax(query).then((ok) => {
      if (!ok) return;
      // The highlighter matches within single DOM text nodes, so it can't match
      // across a line break; highlight the query with its newlines flattened.
      const cleanedQuery = query.replace(/[\r\n]+/g, ' ');
      globalHighlight.setGlobalHighlightText(matchType === 'literal' ? cleanedQuery : '');
      onSearch({ ...def, name: saved?.name ?? '', searchText: query });
    });
  };

  /** ＋ in the list: saves the current form under a new name and selects it. */
  const handleCreate = (name: string): Promise<boolean> => {
    const query = searchQuery.trim();
    return checkSyntax(query).then((ok) => {
      if (!ok) return false;
      onSave({ ...def, name, searchText: query });
      setSelectedName(name);
      return true;
    });
  };

  const handleRename = (oldName: string, newName: string) => {
    onRenameSearchDefinition(oldName, newName);
    if (selectedName === oldName) setSelectedName(newName);
  };

  const handleRequestDelete = (name: string) => {
    setPendingConfirm({
      message: `Are you sure you want to delete the search definition "${name}"?`,
      onConfirm: () => {
        onDeleteSearchDefinition(name);
        // The form keeps its values and becomes the unnamed search.
        if (selectedName === name) setSelectedName(null);
      },
    });
  };

  const handleSave = () => {
    if (!saved || !dirty) return;
    const query = searchQuery.trim();
    void checkSyntax(query).then((ok) => {
      if (ok) onSave({ ...def, name: saved.name, searchText: query });
    });
  };

  const handleRevert = () => {
    if (!saved) return;
    setPendingConfirm({
      message: `Discard unsaved changes to "${saved.name}"?`,
      onConfirm: () => {
        setSyntaxError(null);
        setDef(initialSearchDefinition(saved, null));
      },
    });
  };

  const handleClose = () => {
    confirmIfDirty(() => {
      if (matchType === 'literal') {
        const cleanedQuery = searchQuery.replace(/[\r\n]+/g, ' ').trim();
        globalHighlight.setGlobalHighlightText(cleanedQuery || null);
      }
      onCancel();
    });
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    set('searchText')(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <>
      <Dialog
        title="Search"
        onClose={handleClose}
        className="w-full max-w-4xl flex flex-col max-h-[90vh]"
        initialFocusRef={matchType === 'advanced' ? codeInputRef : queryInputRef}
      >
        <div className="flex min-h-[480px] flex-1 overflow-hidden">

          {/* Left panel: saved search definitions */}
          <SearchDefinitionsPanel
            definitions={searchDefinitions}
            selectedName={saved?.name ?? null}
            onSelect={handleSelectSearchDefinition}
            onCreate={handleCreate}
            onRename={handleRename}
            onRequestDelete={handleRequestDelete}
          />

          {/* Right panel: search options for the selected (or unnamed) definition */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <div
              className="pl-6 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 truncate"
              data-testid="search-dialog-editing-label"
            >
              {saved
                ? <>Editing &ldquo;{saved.name}&rdquo;</>
                : <span className="normal-case font-normal italic text-slate-500">Unsaved search</span>}
            </div>
            <div className="flex flex-col flex-1 px-6 pb-6 overflow-y-auto min-h-0">
              <label className={DLG_LABEL_CLASS}>
                {matchType === 'advanced'
                  ? 'JavaScript expression'
                  : matchType === 'wildcard'
                    ? (!searchContents
                        ? 'File name pattern (* matches any characters; must match the whole name)'
                        : 'Search text (use * as wildcard, matches up to 25 characters)')
                    : 'Search text'}
              </label>
              {matchType === 'advanced' ? (
                <>
                  <JsCodeInput
                    value={searchQuery}
                    onChange={handleCodeChange}
                    onSubmit={handleSearch}
                    placeholder="Functions: $, tag, p.name, ts, past, future, today"
                    testId="search-query-input"
                    focusRef={codeInputRef}
                  />
                  {syntaxError && (
                    <p className="text-xs text-red-400 mt-1 break-words" data-testid="search-query-syntax-error">
                      Syntax error: {syntaxError}
                    </p>
                  )}
                </>
              ) : (
                <input
                  type="text"
                  ref={queryInputRef}
                  value={searchQuery}
                  onChange={handleQueryChange}
                  onKeyDown={handleKeyDown}
                  data-testid="search-query-input"
                  className={`w-full ${DLG_INPUT_CLASS_BASE} font-mono text-base! border-slate-600 focus:border-blue-500`}
                  placeholder={matchType === 'wildcard' ? (!searchContents ? '*.md' : 'intro*duction') : 'Enter search text...'}
                />
              )}

              <div className="flex items-center gap-6 mb-3 mt-3">
                <CheckboxField
                  label="Search Image EXIF"
                  checked={searchImageExif}
                  onChange={set('searchImageExif')}
                  // Images can never be calendar items, so the two are mutually exclusive.
                  disabled={!searchContents || calendarItemsOnly}
                  testId="search-image-exif"
                  inputClassName={SEARCH_CHECKBOX_CLASS}
                />
                <CheckboxField
                  label="Recent Files"
                  checked={mostRecent}
                  onChange={set('mostRecent')}
                  testId="search-most-recent"
                  inputClassName={SEARCH_CHECKBOX_CLASS}
                />
                <CheckboxField
                  label="Calendar Items"
                  checked={calendarItemsOnly}
                  onChange={set('calendarItemsOnly')}
                  // Calendar-ness is a front-matter property, so it only means
                  // something for a content search (see searchFolder, which
                  // likewise ignores the flag in a names-only search).
                  disabled={!searchContents}
                  testId="search-calendar-items-only"
                  inputClassName={SEARCH_CHECKBOX_CLASS}
                />
              </div>

              <fieldset className="border border-slate-600 rounded-md p-3 mb-3">
                <legend className="text-xs text-slate-400 px-2">Search Target</legend>
                <div className="flex items-center gap-6">
                  <CheckboxField
                    label="File Contents"
                    checked={searchContents}
                    onChange={set('searchContents')}
                    testId="search-target-contents"
                    inputClassName={SEARCH_CHECKBOX_CLASS}
                  />
                  <CheckboxField
                    label="File Names"
                    checked={searchNames}
                    onChange={set('searchNames')}
                    testId="search-target-names"
                    inputClassName={SEARCH_CHECKBOX_CLASS}
                  />
                </div>
                {/* Folders are only matched by a names-only search (see searchFolder). */}
                <p className="text-xs text-slate-500 mt-2">
                  Choose &apos;File Names&apos; by itself to include folder names in the search.
                </p>
              </fieldset>

              <RadioGroup
                legend="Search Mode"
                name="matchType"
                value={matchType}
                onChange={set('matchType')}
                className="mb-4"
                inputClassName={SEARCH_RADIO_CLASS}
                options={[
                  { value: 'literal', label: 'Literal', testId: 'search-type-literal' },
                  { value: 'wildcard', label: 'Wild Card', testId: 'search-type-wildcard' },
                  { value: 'advanced', label: 'Advanced', testId: 'search-type-advanced' },
                ]}
              />

              <fieldset className="border border-slate-600 rounded-md p-3 mb-3">
                <legend className="text-xs text-slate-400 px-2">Order</legend>
                <div className="flex gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Sort By</label>
                    <select
                      value={sortBy}
                      onChange={(e) => set('sortBy')(e.target.value as SearchSortBy)}
                      data-testid="sort-by-select"
                      className={`${DLG_INPUT_CLASS_BASE} border-slate-600 focus:border-blue-500`}
                    >
                      <option value="modified-time">File Modification Time</option>
                      <option value="created-time">File Creation Time</option>
                      <option value="file-name">File Name</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Direction</label>
                    <select
                      value={sortDirection}
                      onChange={(e) => set('sortDirection')(e.target.value as SearchSortDirection)}
                      data-testid="sort-direction-select"
                      className={`${DLG_INPUT_CLASS_BASE} border-slate-600 focus:border-blue-500`}
                    >
                      <option value="desc">DESC (newest first)</option>
                      <option value="asc">ASC (oldest first)</option>
                    </select>
                  </div>
                </div>
              </fieldset>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-slate-600 flex-shrink-0">
          <div className="text-sm min-w-0">
            {dirty && (
              <span className="text-amber-400 italic" data-testid="search-dialog-dirty">Unsaved changes</span>
            )}
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              data-testid="cancel-search-button"
              className={BUTTON_CLASS_DLG_CANCEL}
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleRevert}
              disabled={!dirty}
              data-testid="search-dialog-revert-button"
              className={BUTTON_CLASS_DLG_CANCEL}
            >
              Revert
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty}
              title={saved ? undefined : 'Click ＋ to save this as a new search'}
              data-testid="search-dialog-save-button"
              className={BUTTON_CLASS_DLG_SAVE}
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleSearch}
              disabled={(!searchQuery.trim() && !mostRecent) || noTarget}
              data-testid="execute-search-button"
              className={BUTTON_CLASS_DLG_BLUE}
            >
              Search
            </button>
          </div>
        </div>
      </Dialog>

      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={() => { pendingConfirm.onConfirm(); setPendingConfirm(null); }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </>
  );
}

export default SearchDialog;
