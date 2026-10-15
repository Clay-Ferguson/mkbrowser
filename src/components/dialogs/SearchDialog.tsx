import { useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import Dialog from './common/Dialog';
import SearchDefinitionsPanel from './SearchDefinitionsPanel';
import CheckboxField from './common/CheckboxField';
import RadioGroup from './common/RadioGroup';
import JsCodeInput from './common/JsCodeInput';
import type { SearchDefinition, SearchSortBy, SearchSortDirection } from '../../shared/types';
import * as globalHighlight from '../../renderer/globalHighlight';
import { initialSearchDefinition } from '../../shared/searchHelpers';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_LABEL_CLASS, DLG_INPUT_CLASS_BASE, DLG_CHECK_RADIO_BASE } from '../../renderer/styles';

// Search's checkbox/radio inputs use a blue-500 accent (vs the blue-600 default
// in CheckboxField/RadioField), so override the input class to preserve it.
const SEARCH_CHECKBOX_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-500 rounded disabled:opacity-50 disabled:cursor-not-allowed`;
const SEARCH_RADIO_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-500`;

interface SearchDialogProps {
  onSearch: (definition: SearchDefinition) => void;
  onSave: (definition: SearchDefinition) => void;
  onCancel: () => void;
  onDeleteSearchDefinition: (name: string) => void;
  /** The search to edit; omitted for a new search. */
  initialDefinition?: SearchDefinition;
  searchDefinitions: SearchDefinition[];
}

/**
 * The full search dialog: a left panel of saved search definitions
 * (SearchDefinitionsPanel) and a right panel of search options — the query, the
 * target (file contents and/or names), the match type (literal/wildcard/advanced),
 * the EXIF / recent-files / calendar-items-only toggles, and result sorting. The
 * form edits one SearchDefinition, which it can run (onSearch — which never
 * saves, even when the search is named), save under its name (onSave, the Save
 * button), or delete (onDeleteSearchDefinition, gated behind a ConfirmDialog).
 *
 * Newlines in the query are kept as real newlines all the way through (saved
 * definitions and the search itself). For literal searches the query is also
 * pushed into the globalHighlight module so matches stay highlighted in the
 * document view after the dialog closes.
 */
function SearchDialog({ onSearch, onSave, onCancel, onDeleteSearchDefinition, initialDefinition, searchDefinitions }: SearchDialogProps) {
  const [def, setDef] = useState(() =>
    initialSearchDefinition(initialDefinition, globalHighlight.getGlobalHighlightText())
  );
  const { name: searchName, searchText: searchQuery, matchType, searchContents, searchNames, sortBy, sortDirection } = def;
  /** Neither target is checked, so there is nothing to search. */
  const noTarget = !searchContents && !searchNames;
  const searchImageExif = def.searchImageExif ?? false;
  const mostRecent = def.mostRecent ?? false;
  const calendarItemsOnly = def.calendarItemsOnly ?? false;
  /** A change handler that sets one field of the definition being edited. */
  const set = <K extends keyof SearchDefinition>(key: K) => (value: SearchDefinition[K]) =>
    setDef((d) => ({ ...d, [key]: value }));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const queryInputRef = useRef<HTMLInputElement>(null);
  /** The Advanced-mode code editor's editable element (set by JsCodeInput). */
  const codeInputRef = useRef<HTMLElement>(null);

  const handleSelectSearchDefinition = (selected: SearchDefinition) => {
    setDef(initialSearchDefinition(selected, null));
  };

  const handleSearch = () => {
    const query = searchQuery.trim();
    if ((!query && !mostRecent) || noTarget) return;

    // The highlighter matches within single DOM text nodes, so it can't match
    // across a line break; highlight the query with its newlines flattened.
    const cleanedQuery = query.replace(/[\r\n]+/g, ' ');
    globalHighlight.setGlobalHighlightText(matchType === 'literal' ? cleanedQuery : '');
    onSearch({ ...def, name: searchName.trim(), searchText: query });
  };

  const handleSave = () => {
    if (!searchName.trim()) return;

    onSave({ ...def, name: searchName.trim(), searchText: searchQuery.trim() });
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

  const onConfirm = () => {
    if (searchName.trim()) {
      onDeleteSearchDefinition(searchName.trim());
      set('name')('');
    }
    setShowDeleteConfirm(false);
  }

  return (
    <>
      <Dialog
        title="Search"
        onClose={onCancel}
        className="w-full max-w-4xl flex flex-col max-h-[90vh]"
        initialFocusRef={matchType === 'advanced' ? codeInputRef : queryInputRef}
      >
        <div className="flex min-h-[480px] flex-1">

          {/* Left panel: saved search definitions */}
          <SearchDefinitionsPanel
            searchName={searchName}
            onSearchNameChange={set('name')}
            definitions={searchDefinitions}
            onSelect={handleSelectSearchDefinition}
            onSave={handleSave}
            onRequestDelete={() => setShowDeleteConfirm(true)}
          />

          {/* Right panel: search options */}
          <div className="flex flex-col flex-1 p-6 overflow-y-auto min-h-0">
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
              <JsCodeInput
                value={searchQuery}
                onChange={set('searchText')}
                onSubmit={handleSearch}
                placeholder="Functions: $, tag, prop, past, future, today"
                testId="search-query-input"
                focusRef={codeInputRef}
              />
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

            <div className="flex justify-end items-center gap-3 mt-6">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (matchType === 'literal') {
                      const cleanedQuery = searchQuery.replace(/[\r\n]+/g, ' ').trim();
                      globalHighlight.setGlobalHighlightText(cleanedQuery || null);
                    }
                    onCancel();
                  }}
                  data-testid="cancel-search-button"
                  className={BUTTON_CLASS_DLG_CANCEL}
                >
                  Close
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
          </div>
        </div>
      </Dialog>

      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete the search definition "${searchName.trim()}"?`}
          onConfirm={onConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}

export default SearchDialog;
