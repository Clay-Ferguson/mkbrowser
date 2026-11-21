import { useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import Dialog from './common/Dialog';
import SearchDefinitionsPanel from './SearchDefinitionsPanel';
import CheckboxField from './common/CheckboxField';
import JsCodeInput from './common/JsCodeInput';
import type { SearchDefinition, SearchMatchType, SearchSortBy, SearchSortDirection } from '../../shared/types';
import * as globalHighlight from '../../renderer/globalHighlight';
import { api } from '../../renderer/api';
import { initialSearchDefinition, invalidPropertyCols, isSearchDefinitionDirty, parseTagCategoryCols, parseTypeFilter, unknownTagCategories } from '../../shared/searchHelpers';
import { useAS } from '../../store';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_SAVE, DLG_LABEL_CLASS, DLG_INPUT_CLASS_BASE, DLG_CHECK_RADIO_BASE } from '../../renderer/styles';

// Search's checkbox inputs use a blue-500 accent (vs the blue-600 default
// in CheckboxField), so override the input class to preserve it.
const SEARCH_CHECKBOX_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-500 rounded disabled:opacity-50 disabled:cursor-not-allowed`;

/** What each Direction option means for the chosen Sort By. */
const SORT_DIRECTION_HINTS: Record<SearchSortBy, { desc: string; asc: string }> = {
  'modified-time': { desc: 'newest first', asc: 'oldest first' },
  'created-time': { desc: 'newest first', asc: 'oldest first' },
  'file-name': { desc: 'Z–A', asc: 'A–Z' },
  custom: { desc: 'largest / latest first', asc: 'smallest / earliest first' },
};

const NO_SORT_EXPRESSION_TITLE = 'Enter a sort expression, or choose another Sort By.';

const INVALID_PROPERTIES_TITLE = 'Fix the invalid names in Properties.';

const FRONT_MATTER_NEEDS_CONTENTS_TITLE = "Tags and Types are read from file contents, so they need 'File Contents' checked.";

/** The Tags and Type inputs: the query input's look, plus a disabled state. */
const FRONT_MATTER_INPUT_CLASS = `w-full ${DLG_INPUT_CLASS_BASE} font-mono text-base! border-slate-600 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed`;

/** The custom sort's Column title input: about 20 characters wide, since it only
 *  heads a narrow results column (the title itself has no length limit). */
const SORT_TITLE_INPUT_CLASS = `w-[24ch] max-w-full ${DLG_INPUT_CLASS_BASE} border-slate-600 focus:border-blue-500`;

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
 * options — the query, the front matter Tags and Type filters, the target (file contents and/or names), the match type
 * (literal/wildcard/advanced), the EXIF / recent-files toggles, result
 * sorting (including a Custom sort by a JavaScript expression), and the
 * Columns the results view adds: Tag Category Columns (with a warning naming any
 * entry that isn't a tags.yaml category) and Properties (front matter property
 * columns; an invalid name blocks Search and Save).
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
 *
 * See: (USER_GUIDE.md#using-search)
 * See: (USER_GUIDE.md#saving-search-definitions)
 * See: (USER_GUIDE.md#custom-sort-order)
 * See: (USER_GUIDE.md#tag-category-columns)
 * See: (USER_GUIDE.md#property-columns)
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
  const sortExpression = def.sortExpression ?? '';
  const sortTitle = def.sortTitle ?? '';
  const tags = def.tags ?? '';
  /** The Tags field will filter the search (it needs File Contents; see searchFolder). */
  const hasTags = searchContents && tags.trim().length > 0;
  const type = def.type ?? '';
  /** The Types field will filter the search (it needs File Contents, like Tags). */
  const hasType = searchContents && parseTypeFilter(type).length > 0;
  const tagCategoryCols = def.tagCategoryCols ?? '';
  const tagCategoryNames = useAS(s => s.tagCategoryNames);
  /** Entries in Tag Category Columns that aren't tags.yaml categories (likely typos). */
  const unknownTagCols = unknownTagCategories(parseTagCategoryCols(tagCategoryCols), tagCategoryNames);
  const propertyCols = def.propertyCols ?? '';
  /** Entries in Properties that aren't usable property names; Search and Save refuse them. */
  const badPropertyCols = invalidPropertyCols(propertyCols);
  const invalidProperties = badPropertyCols.length > 0;
  /** There is something to search for: a query, tags, a type, or the Recent Files listing. */
  const hasCriteria = searchQuery.trim().length > 0 || hasTags || hasType || mostRecent;
  /** Sort By is Custom but there is no expression to sort by. */
  const noSortExpression = sortBy === 'custom' && !sortExpression.trim();
  /** A problem in the form that blocks both Search and Save, as the buttons' hover text. */
  const blockedTitle = noSortExpression ? NO_SORT_EXPRESSION_TITLE : invalidProperties ? INVALID_PROPERTIES_TITLE : undefined;
  /** A change handler that sets one field of the definition being edited. */
  const set = <K extends keyof SearchDefinition>(key: K) => (value: SearchDefinition[K]) =>
    setDef((d) => ({ ...d, [key]: value }));
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  /** Syntax error found in the Advanced query on the last Search/Save, if any. */
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  /** Problem found with the custom sort expression on the last Search/Save, if any. */
  const [sortError, setSortError] = useState<string | null>(null);
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
      setSortError(null);
      setDef(initialSearchDefinition(selected, null));
      setSelectedName(selected.name);
    });
  };

  /** For an Advanced query and a custom sort expression, records any syntax errors and
   *  resolves false if there is one. The main process parses each with the same compiler
   *  the search uses (the renderer can't: its CSP forbids eval, so `new Function` always
   *  throws here). */
  const checkSyntax = (query: string): Promise<boolean> => {
    const sortExpr = sortExpression.trim();
    return Promise.all([
      matchType === 'advanced' && query ? api.checkAdvancedQuerySyntax(query) : null,
      sortBy === 'custom' && sortExpr ? api.checkAdvancedQuerySyntax(sortExpr) : null,
    ]).then(([queryError, sortSyntaxError]) => {
      setSyntaxError(queryError);
      setSortError(sortSyntaxError && `Syntax error: ${sortSyntaxError}`);
      return !queryError && !sortSyntaxError;
    });
  };

  /** The form as a definition to search with or save: the query, tags, type, sort
   *  expression, sort title, tag category columns and properties trimmed, and an
   *  empty one left out of the saved config. */
  const toDefinition = (name: string, query: string): SearchDefinition => ({
    ...def,
    name,
    searchText: query,
    tags: tags.trim() || undefined,
    type: type.trim() || undefined,
    sortExpression: sortExpression.trim() || undefined,
    sortTitle: sortTitle.trim() || undefined,
    tagCategoryCols: tagCategoryCols.trim() || undefined,
    propertyCols: propertyCols.trim() || undefined,
  });

  const handleCodeChange = (value: string) => {
    setSyntaxError(null);
    set('searchText')(value);
  };

  const handleSortExpressionChange = (value: string) => {
    setSortError(null);
    set('sortExpression')(value);
  };

  const handleSearch = () => {
    const query = searchQuery.trim();
    if (!hasCriteria || noTarget || blockedTitle) return;
    void checkSyntax(query).then((ok) => {
      if (!ok) return;
      // The highlighter matches within single DOM text nodes, so it can't match
      // across a line break; highlight the query with its newlines flattened.
      const cleanedQuery = query.replace(/[\r\n]+/g, ' ');
      globalHighlight.setGlobalHighlightText(matchType === 'literal' ? cleanedQuery : '');
      onSearch(toDefinition(saved?.name ?? '', query));
    });
  };

  /** ＋ in the list: saves the current form under a new name and selects it. */
  const handleCreate = (name: string): Promise<boolean> => {
    if (noSortExpression) {
      setSortError(NO_SORT_EXPRESSION_TITLE);
      return Promise.resolve(false);
    }
    // The Properties field already shows its own error.
    if (invalidProperties) return Promise.resolve(false);
    const query = searchQuery.trim();
    return checkSyntax(query).then((ok) => {
      if (!ok) return false;
      onSave(toDefinition(name, query));
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
    if (!saved || !dirty || blockedTitle) return;
    const query = searchQuery.trim();
    void checkSyntax(query).then((ok) => {
      if (ok) onSave(toDefinition(saved.name, query));
    });
  };

  const handleRevert = () => {
    if (!saved) return;
    setPendingConfirm({
      message: `Discard unsaved changes to "${saved.name}"?`,
      onConfirm: () => {
        setSyntaxError(null);
        setSortError(null);
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

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    set('tags')(e.target.value);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    set('type')(e.target.value);
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
              {/* Mode and Target share the top row; items-end lines up the bottom of
                  the Target box with the bottom of the Mode drop-down. */}
              <div className="flex items-end gap-6 mb-3 shrink-0">
                <div>
                  <label htmlFor="search-mode-select" className={DLG_LABEL_CLASS}>Mode</label>
                  <select
                    id="search-mode-select"
                    value={matchType}
                    onChange={(e) => set('matchType')(e.target.value as SearchMatchType)}
                    data-testid="search-mode-select"
                    className={`${DLG_INPUT_CLASS_BASE} border-slate-600 focus:border-blue-500`}
                  >
                    <option value="literal" data-testid="search-type-literal">Literal</option>
                    <option value="wildcard" data-testid="search-type-wildcard">Wild Card</option>
                    <option value="advanced" data-testid="search-type-advanced">Advanced</option>
                  </select>
                </div>

                <fieldset className="border border-slate-600 rounded-md px-3 pb-2 pt-1">
                  <legend className="text-xs text-slate-400 px-2">Target</legend>
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
                </fieldset>
              </div>

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
                    placeholder="Functions: $, tag, p.name, f.size, ts, past, future, today"
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
                  className={`w-full shrink-0 ${DLG_INPUT_CLASS_BASE} font-mono text-base! border-slate-600 focus:border-blue-500`}
                  placeholder={matchType === 'wildcard' ? (!searchContents ? '*.md' : 'intro*duction') : 'Enter search text...'}
                />
              )}

              {/* Front matter filters: Tags and Type, side by side at half width each. */}
              <div className="flex gap-3 mt-3 shrink-0">
                <div className="flex-1 min-w-0">
                  <label className={`${DLG_LABEL_CLASS} truncate`}>
                    Tags (comma-separated, <span className="font-mono">!tag</span> excludes)
                  </label>
                  <input
                    type="text"
                    value={tags}
                    onChange={handleTagsChange}
                    onKeyDown={handleKeyDown}
                    disabled={!searchContents}
                    title={searchContents ? undefined : FRONT_MATTER_NEEDS_CONTENTS_TITLE}
                    data-testid="search-tags-input"
                    className={FRONT_MATTER_INPUT_CLASS}
                    placeholder="e.g. purchased, p1, !done"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className={`${DLG_LABEL_CLASS} truncate`}>Types</label>
                  <input
                    type="text"
                    value={type}
                    onChange={handleTypeChange}
                    onKeyDown={handleKeyDown}
                    disabled={!searchContents}
                    title={searchContents ? undefined : FRONT_MATTER_NEEDS_CONTENTS_TITLE}
                    data-testid="search-type-input"
                    className={FRONT_MATTER_INPUT_CLASS}
                    placeholder="e.g. todo, person"
                  />
                </div>
              </div>

              <fieldset className="border border-slate-600 rounded-md p-3 mb-3 mt-3">
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
                      <option value="custom">Custom</option>
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
                      <option value="desc">DESC ({SORT_DIRECTION_HINTS[sortBy].desc})</option>
                      <option value="asc">ASC ({SORT_DIRECTION_HINTS[sortBy].asc})</option>
                    </select>
                  </div>
                </div>
                {sortBy === 'custom' && (
                  <div className="mt-3">
                    <label className="block text-xs text-slate-400 mb-1">
                      Sort expression (files with no value are listed last)
                    </label>
                    <JsCodeInput
                      value={sortExpression}
                      onChange={handleSortExpressionChange}
                      onSubmit={handleSearch}
                      placeholder="e.g. ts(p.due)  or  [p.priority, ts(p.due)]"
                      testId="sort-expression-input"
                      compact
                    />
                    {sortError && (
                      <p className="text-xs text-red-400 mt-1 break-words" data-testid="sort-expression-error">
                        {sortError}
                      </p>
                    )}
                    <label className="block text-xs text-slate-400 mb-1 mt-3">
                      Column title (heads the sort column in the results)
                    </label>
                    <input
                      type="text"
                      value={sortTitle}
                      onChange={(e) => set('sortTitle')(e.target.value)}
                      onKeyDown={handleKeyDown}
                      data-testid="sort-title-input"
                      className={SORT_TITLE_INPUT_CLASS}
                      placeholder="e.g. Due"
                    />
                  </div>
                )}
              </fieldset>

              {/* Columns: extra results columns. Display only, so (unlike Tags and
                  Type) they work without File Contents. */}
              <fieldset className="border border-slate-600 rounded-md p-3 mb-3 shrink-0">
                <legend className="text-xs text-slate-400 px-2">Columns</legend>
                {/* Tag Category Columns: one column per tag category.
                    See: (USER_GUIDE.md#tag-category-columns) */}
                <div>
                  <label htmlFor="search-tag-category-cols-input" className={DLG_LABEL_CLASS}>
                    Tag Category (comma-separated tag categories)
                  </label>
                  <input
                    id="search-tag-category-cols-input"
                    type="text"
                    value={tagCategoryCols}
                    onChange={(e) => set('tagCategoryCols')(e.target.value)}
                    onKeyDown={handleKeyDown}
                    data-testid="search-tag-category-cols-input"
                    className={FRONT_MATTER_INPUT_CLASS}
                    placeholder="e.g. priority, all"
                  />
                  {unknownTagCols.length > 0 && (
                    <p className="text-xs text-amber-400 mt-1 break-words" data-testid="search-tag-category-cols-unknown">
                      {unknownTagCols.length === 1 ? 'Not a tag category' : 'Not tag categories'}: {unknownTagCols.join(', ')}
                    </p>
                  )}
                </div>

                {/* Properties: one column per front matter property, or * for every
                    property found. See: (USER_GUIDE.md#property-columns) */}
                <div className="mt-3">
                  <label htmlFor="search-property-cols-input" className={DLG_LABEL_CLASS}>
                    Properties (comma-separated front matter properties, or *)
                  </label>
                  <input
                    id="search-property-cols-input"
                    type="text"
                    value={propertyCols}
                    onChange={(e) => set('propertyCols')(e.target.value)}
                    onKeyDown={handleKeyDown}
                    data-testid="search-property-cols-input"
                    className={FRONT_MATTER_INPUT_CLASS}
                    placeholder="e.g. type, due  or  *"
                  />
                  {invalidProperties && (
                    <p className="text-xs text-red-400 mt-1 break-words" data-testid="search-property-cols-error">
                      {badPropertyCols.length === 1 ? 'Invalid property name' : 'Invalid property names'}: {badPropertyCols.join(', ')}
                    </p>
                  )}
                </div>
              </fieldset>

              <div className="flex items-center gap-6">
                <CheckboxField
                  label="Search Image EXIF"
                  checked={searchImageExif}
                  onChange={set('searchImageExif')}
                  disabled={!searchContents}
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
              </div>
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
              disabled={!dirty || !!blockedTitle}
              title={saved ? blockedTitle : 'Click ＋ to save this as a new search'}
              data-testid="search-dialog-save-button"
              className={BUTTON_CLASS_DLG_SAVE}
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleSearch}
              disabled={!hasCriteria || noTarget || !!blockedTitle}
              title={blockedTitle}
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
