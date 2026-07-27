import { useRef, useState, useLayoutEffect } from 'react';
import ConfirmDialog from './ConfirmDialog';
import Dialog from './common/Dialog';
import SearchDefinitionsPanel from './SearchDefinitionsPanel';
import CheckboxField from './common/CheckboxField';
import RadioGroup from './common/RadioGroup';
import type { SearchDefinition } from '../../shared/types';
import * as globalHighlight from '../../renderer/globalHighlight';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_LABEL_CLASS, DLG_INPUT_CLASS_BASE, DLG_CHECK_RADIO_BASE } from '../../renderer/styles';

// Search's checkbox/radio inputs use a blue-500 accent (vs the blue-600 default
// in CheckboxField/RadioField), so override the input class to preserve it.
const SEARCH_CHECKBOX_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-500 rounded disabled:opacity-50 disabled:cursor-not-allowed`;
const SEARCH_RADIO_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-500`;

export type SearchMode = 'content' | 'filenames';
export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchSortBy = 'modified-time' | 'created-time' | 'file-name';
export type SearchSortDirection = 'asc' | 'desc';

export interface SearchOptions {
  query: string;
  searchType: SearchType;
  searchMode: SearchMode;
  searchName: string;
  sortBy: SearchSortBy;
  sortDirection: SearchSortDirection;
  searchImageExif: boolean;
  mostRecent: boolean;
  calendarItemsOnly: boolean;
}

export interface SearchDialogInitialValues {
  searchQuery?: string;
  searchName?: string;
  searchType?: SearchType;
  searchMode?: SearchMode;
  sortBy?: SearchSortBy;
  sortDirection?: SearchSortDirection;
  searchImageExif?: boolean;
  mostRecent?: boolean;
  calendarItemsOnly?: boolean;
}

interface SearchDialogProps {
  onSearch: (options: SearchOptions) => void;
  onSave: (options: SearchOptions) => void;
  onCancel: () => void;
  onDeleteSearchDefinition: (name: string) => void;
  initialValues?: SearchDialogInitialValues;
  searchDefinitions: SearchDefinition[];
}

/**
 * The full search dialog: a left panel of saved search definitions
 * (SearchDefinitionsPanel) and a right panel of search options — the query, the
 * target (file contents vs. names), the mode (literal/wildcard/advanced), the
 * EXIF / recent-files / calendar-items-only toggles, and result sorting. It can
 * run a search (onSearch), save the options as a named definition (onSave), or delete one
 * (onDeleteSearchDefinition, gated behind a ConfirmDialog).
 *
 * Two cross-cutting behaviours worth knowing:
 *  - Newlines in the query are persisted as the `{{nl}}` token (definitions are
 *    single-line) and expanded back to real newlines when loaded/edited.
 *  - For literal searches the query is pushed into the globalHighlight module so
 *    matches stay highlighted in the document view after the dialog closes.
 */
function SearchDialog({ onSearch, onSave, onCancel, onDeleteSearchDefinition, initialValues, searchDefinitions }: SearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState(
    initialValues?.searchQuery ? initialValues.searchQuery.replace(/\{\{nl\}\}/g, '\n') : (globalHighlight.getGlobalHighlightText() || '')
  );
  const [searchName, setSearchName] = useState(initialValues?.searchName || '');
  const [searchType, setSearchType] = useState<SearchType>(initialValues?.searchType || 'literal');
  const [searchMode, setSearchMode] = useState<SearchMode>(initialValues?.searchMode || 'content');
  const [sortBy, setSortBy] = useState<SearchSortBy>(initialValues?.sortBy || 'modified-time');
  const [sortDirection, setSortDirection] = useState<SearchSortDirection>(initialValues?.sortDirection || 'desc');
  const [searchImageExif, setSearchImageExif] = useState(initialValues?.searchImageExif ?? false);
  const [mostRecent, setMostRecent] = useState(initialValues?.mostRecent ?? false);
  const [calendarItemsOnly, setCalendarItemsOnly] = useState(initialValues?.calendarItemsOnly ?? false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resize the textarea to fit its content whenever the query changes (including
  // when a saved definition is loaded). useLayoutEffect runs after the DOM is
  // updated but before paint, so scrollHeight is measured against the new value
  // with no flicker — and no magic setTimeout(0).
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const minHeight = 20 * 4; // ~4 lines
    textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`;
  }, [searchQuery]);

  const handleSelectSearchDefinition = (def: SearchDefinition) => {
    setSearchName(def.name);
    setSearchQuery(def.searchText.replace(/\{\{nl\}\}/g, '\n'));
    setSearchType(def.searchMode);
    setSearchMode(def.searchTarget);
    setSortBy(def.sortBy);
    setSortDirection(def.sortDirection);
    setSearchImageExif(def.searchImageExif ?? false);
    setMostRecent(def.mostRecent ?? false);
    setCalendarItemsOnly(def.calendarItemsOnly ?? false);
  };

  const handleSearch = () => {
    const cleanedQuery = searchQuery.replace(/[\r\n]+/g, ' ').trim();
    if (!cleanedQuery && !mostRecent) return;

    const persistedQuery = searchQuery.replace(/[\r\n]+/g, '{{nl}}').trim();

    globalHighlight.setGlobalHighlightText(searchType === 'literal' ? cleanedQuery : '');
    onSearch({ query: persistedQuery, searchType, searchMode, searchName: searchName.trim(), sortBy, sortDirection, searchImageExif, mostRecent, calendarItemsOnly });
  };

  const handleSave = () => {
    if (!searchName.trim()) return;

    const persistedQuery = searchQuery.replace(/[\r\n]+/g, '{{nl}}').trim();

    onSave({ query: persistedQuery, searchType, searchMode, searchName: searchName.trim(), sortBy, sortDirection, searchImageExif, mostRecent, calendarItemsOnly });
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSearch();
    }
  };

  const onConfirm = () => {
    if (searchName.trim()) {
      onDeleteSearchDefinition(searchName.trim());
      setSearchName('');
    }
    setShowDeleteConfirm(false);
  }

  return (
    <>
      <Dialog
        title="Search"
        onClose={onCancel}
        className="w-full max-w-4xl flex flex-col max-h-[90vh]"
        initialFocusRef={textareaRef}
      >
        <div className="flex min-h-[480px] flex-1">

          {/* Left panel: saved search definitions */}
          <SearchDefinitionsPanel
            searchName={searchName}
            onSearchNameChange={setSearchName}
            definitions={searchDefinitions}
            onSelect={handleSelectSearchDefinition}
            onSave={handleSave}
            onRequestDelete={() => setShowDeleteConfirm(true)}
          />

          {/* Right panel: search options */}
          <div className="flex flex-col flex-1 p-6 overflow-y-auto min-h-0">
            <label className={DLG_LABEL_CLASS}>
              {searchType === 'advanced' ? 'JavaScript expression' : searchType === 'wildcard' ? 'Search text (use * as wildcard, matches up to 25 characters)' : 'Search text'}
            </label>
            <textarea
              ref={textareaRef}
              value={searchQuery}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              data-testid="search-query-input"
              rows={4}
              className={`w-full ${DLG_INPUT_CLASS_BASE} font-mono resize-none border-slate-600 focus:border-blue-500 min-h-[80px]`}
              placeholder={searchType === 'advanced' ? 'Functions: $, past, future, today' : searchType === 'wildcard' ? 'intro*duction' : 'Enter search text...'}
            />

            <div className="flex items-center gap-6 mb-3 mt-3">
              <CheckboxField
                label="Search Image EXIF"
                checked={searchImageExif}
                onChange={setSearchImageExif}
                // Images can never be calendar items, so the two are mutually exclusive.
                disabled={searchMode === 'filenames' || calendarItemsOnly}
                testId="search-image-exif"
                inputClassName={SEARCH_CHECKBOX_CLASS}
              />
              <CheckboxField
                label="Recent Files"
                checked={mostRecent}
                onChange={setMostRecent}
                testId="search-most-recent"
                inputClassName={SEARCH_CHECKBOX_CLASS}
              />
              <CheckboxField
                label="Calendar Items"
                checked={calendarItemsOnly}
                onChange={setCalendarItemsOnly}
                // Calendar-ness is a front-matter property, so it only means
                // something for a content search (see searchFolder, which
                // likewise ignores the flag in filenames mode).
                disabled={searchMode === 'filenames'}
                testId="search-calendar-items-only"
                inputClassName={SEARCH_CHECKBOX_CLASS}
              />
            </div>

            <RadioGroup
              legend="Search Target"
              name="searchMode"
              value={searchMode}
              onChange={setSearchMode}
              className="mb-3"
              inputClassName={SEARCH_RADIO_CLASS}
              options={[
                { value: 'content', label: 'File Contents+Names', testId: 'search-mode-content' },
                { value: 'filenames', label: 'File Names', testId: 'search-mode-filenames' },
              ]}
            />

            <RadioGroup
              legend="Search Mode"
              name="searchType"
              value={searchType}
              onChange={setSearchType}
              className="mb-4"
              inputClassName={SEARCH_RADIO_CLASS}
              options={[
                { value: 'literal', label: 'Literal', testId: 'search-type-literal' },
                { value: 'wildcard', label: 'Wild Card', testId: 'search-type-wildcard' },
                { value: 'advanced', label: 'Advanced', testId: 'search-type-advanced' },
              ]}
            />

            <div className="flex gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Sort Results By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SearchSortBy)}
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
                  onChange={(e) => setSortDirection(e.target.value as SearchSortDirection)}
                  data-testid="sort-direction-select"
                  className={`${DLG_INPUT_CLASS_BASE} border-slate-600 focus:border-blue-500`}
                >
                  <option value="desc">DESC (newest first)</option>
                  <option value="asc">ASC (oldest first)</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-slate-500 mt-2">
              {/* Scope sentence — what gets searched. The 'content' target matches
                  file names as well as contents, but only for literal/wildcard: an
                  advanced expression is JavaScript evaluated against file content,
                  so it never matches names (in the 'filenames' target it is applied
                  to the name instead, which is why that branch comes first). */}
              {searchMode === 'filenames' ? (
                <>Searches file and folder names recursively (case-insensitive).</>
              ) : searchType === 'advanced' ? (
                <>Searches file contents only — advanced expressions never match file names.</>
              ) : calendarItemsOnly ? (
                <>Searches only calendar items — .md files with a <code className="bg-slate-700 px-1 rounded">due:</code> front matter property — matching their contents or their file name (case-insensitive).</>
              ) : searchImageExif ? (
                <>Searches the contents of .md, .txt, and image EXIF metadata, plus every file name, recursively (case-insensitive).</>
              ) : (
                <>Searches the contents of .md and .txt files, plus every file name, recursively (case-insensitive).</>
              )}
              {searchType === 'wildcard' && (
                <> Use <code className="bg-slate-700 px-1 rounded">*</code> to match any characters.</>
              )}
              {searchType === 'advanced' && (
                <> Uses the <code className="bg-slate-700 px-1 rounded">$(&quot;text&quot;)</code> function, or past(ts), future(ts), future(ts, days), today(ts). Combine with <code className="bg-slate-700 px-1 rounded">&&</code> and <code className="bg-slate-700 px-1 rounded">||</code>.</>
              )}
              {' '}Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.
            </p>

            <div className="flex justify-end items-center gap-3 mt-6">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (searchType === 'literal') {
                      const cleanedQuery = searchQuery.replace(/[\r\n]+/g, ' ').trim();
                      globalHighlight.setGlobalHighlightText(cleanedQuery || null);
                      requestAnimationFrame(() => globalHighlight.applyGlobalHighlight(cleanedQuery || null));
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
                  disabled={!searchQuery.trim() && !mostRecent}
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
          message={`Are you sure you want to delete the search definition "${searchName}"?`}
          onConfirm={onConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}

export default SearchDialog;
