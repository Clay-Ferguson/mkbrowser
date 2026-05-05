import { useEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import EditableCombobox, { type ComboboxOption } from '../EditableCombobox';
import type { SearchDefinition } from '../../store/types';
import * as globalHighlight from '../../utils/globalHighlight';

export type SearchMode = 'content' | 'filenames';
export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchSortBy = 'modified-time' | 'created-time' | 'line-time';
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
}

interface SearchDialogProps {
  onSearch: (options: SearchOptions) => void;
  onSave: (options: SearchOptions) => void;
  onCancel: () => void;
  onDeleteSearchDefinition: (name: string) => void;
  initialValues?: SearchDialogInitialValues;
  searchDefinitions: SearchDefinition[];
}

function SearchDialog({ onSearch, onSave, onCancel, onDeleteSearchDefinition, initialValues, searchDefinitions }: SearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState(
    initialValues?.searchQuery ? initialValues.searchQuery.replace(/\{\{nl\}\}/g, '\n') : ''
  );
  const [searchName, setSearchName] = useState(initialValues?.searchName || '');
  const [searchType, setSearchType] = useState<SearchType>(initialValues?.searchType || 'literal');
  const [searchMode, setSearchMode] = useState<SearchMode>(initialValues?.searchMode || 'content');
  const [sortBy, setSortBy] = useState<SearchSortBy>(initialValues?.sortBy || 'modified-time');
  const [sortDirection, setSortDirection] = useState<SearchSortDirection>(initialValues?.sortDirection || 'desc');
  const [searchImageExif, setSearchImageExif] = useState(initialValues?.searchImageExif ?? false);
  const [mostRecent, setMostRecent] = useState(initialValues?.mostRecent ?? false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Convert search definitions to combobox options (sorted alphabetically)
  const searchDefinitionOptions: ComboboxOption[] = [...searchDefinitions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((def) => ({
      value: def.name,
      label: def.name,
    }));

  // Handle selection of a saved search definition from the combobox
  const handleSelectSearchDefinition = (option: ComboboxOption) => {
    const selectedDef = searchDefinitions.find((def) => def.name === option.value);
    if (selectedDef) {
      setSearchName(selectedDef.name);
      setSearchQuery(selectedDef.searchText.replace(/\{\{nl\}\}/g, '\n'));
      setSearchType(selectedDef.searchMode);
      setSearchMode(selectedDef.searchTarget);
      setSortBy(selectedDef.sortBy || 'modified-time');
      setSortDirection(selectedDef.sortDirection || 'desc');
      setSearchImageExif(selectedDef.searchImageExif ?? false);
      setMostRecent(selectedDef.mostRecent ?? false);
      // Adjust textarea height after loading content
      setTimeout(adjustTextareaHeight, 0);
    }
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const lineHeight = 20; // approximate line height in pixels
      const minHeight = lineHeight * 4; // 4 rows minimum
      const newHeight = Math.max(minHeight, textarea.scrollHeight);
      textarea.style.height = `${newHeight}px`;
    }
  };

  const handleSearch = () => {
    // Replace newlines with spaces for search execution
    const cleanedQuery = searchQuery.replace(/[\r\n]+/g, ' ').trim();
    if (!cleanedQuery && !mostRecent) return;

    setError(null);

    // Encode newlines as {{nl}} for persistence in search definition
    const persistedQuery = searchQuery.replace(/[\r\n]+/g, '{{nl}}').trim();

    globalHighlight.setGlobalHighlightText(searchType === 'literal' ? cleanedQuery : '');
    onSearch({ query: persistedQuery, searchType, searchMode, searchName: searchName.trim(), sortBy, sortDirection, searchImageExif, mostRecent });
  };

  const handleSave = () => {
    if (!searchName.trim()) return;

    setError(null);

    // Encode newlines as {{nl}} for persistence in search definition
    const persistedQuery = searchQuery.replace(/[\r\n]+/g, '{{nl}}').trim();

    onSave({ query: persistedQuery, searchType, searchMode, searchName: searchName.trim(), sortBy, sortDirection, searchImageExif, mostRecent });
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSearchQuery(e.target.value);
    if (error) setError(null); // Clear error when user types
    adjustTextareaHeight();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 p-6 w-full max-w-2xl mx-4 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-100 mb-3">Search in folder</h2>

        <label className="block text-sm text-slate-400 mb-2">
          {searchType === 'advanced' ? 'JavaScript expression' : searchType === 'wildcard' ? 'Search text (use * as wildcard, matches up to 25 characters)' : 'Search text'}
        </label>
        <textarea
          ref={textareaRef}
          value={searchQuery}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          data-testid="search-query-input"
          rows={4}
          className={`w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border focus:outline-none text-sm font-mono resize-none ${error ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
            }`}
          placeholder={searchType === 'advanced' ? 'Functions: $, ts, past, future, today' : searchType === 'wildcard' ? 'intro*duction' : 'Enter search text...'}
          style={{ minHeight: '80px' }}
        />

        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2 mt-3">
            Search Name (optional - saves this search if provided)
          </label>
          <div className="flex gap-3">
            <EditableCombobox
              value={searchName}
              onChange={setSearchName}
              onSelect={handleSelectSearchDefinition}
              options={searchDefinitionOptions}
              placeholder="Enter a name to save, or select existing..."
              className="flex-1"
              data-testid="search-name-input"
            />
            <button
              onClick={handleSave}
              disabled={!searchName.trim()}
              data-testid="save-search-button"
              className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 disabled:cursor-not-allowed rounded transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => {
                if (searchName.trim()) {
                  setShowDeleteConfirm(true);
                }
              }}
              disabled={!searchName.trim()}
              data-testid="delete-search-button"
              className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 disabled:cursor-not-allowed rounded transition-colors"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Search Image EXIF and Most Recent checkboxes */}
        <div className="flex items-center gap-6 mb-3">
          <label className={`flex items-center gap-2 ${searchMode === 'filenames' ? 'opacity-50' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={searchImageExif}
              onChange={(e) => setSearchImageExif(e.target.checked)}
              disabled={searchMode === 'filenames'}
              data-testid="search-image-exif"
              className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-slate-300">Search Image EXIF</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mostRecent}
              onChange={(e) => setMostRecent(e.target.checked)}
              data-testid="search-most-recent"
              className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800 rounded"
            />
            <span className="text-sm text-slate-300">Recent Files</span>
          </label>
        </div>

        {/* Search mode radio buttons */}
        <fieldset className="border border-slate-600 rounded-md p-3 mb-3">
          <legend className="text-xs text-slate-400 px-2">Search Target</legend>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchMode"
                checked={searchMode === 'content'}
                onChange={() => setSearchMode('content')}
                data-testid="search-mode-content"
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">File Contents</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchMode"
                checked={searchMode === 'filenames'}
                onChange={() => setSearchMode('filenames')}
                data-testid="search-mode-filenames"
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">File Names</span>
            </label>
          </div>
        </fieldset>

        {/* Search Mode radio buttons */}
        <fieldset className="border border-slate-600 rounded-md p-3 mb-4">
          <legend className="text-xs text-slate-400 px-2">Search Mode</legend>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchType"
                checked={searchType === 'literal'}
                onChange={() => setSearchType('literal')}
                data-testid="search-type-literal"
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">Literal</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchType"
                checked={searchType === 'wildcard'}
                onChange={() => setSearchType('wildcard')}
                data-testid="search-type-wildcard"
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">Wild Card</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchType"
                checked={searchType === 'advanced'}
                onChange={() => setSearchType('advanced')}
                data-testid="search-type-advanced"
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">Advanced</span>
            </label>
          </div>
        </fieldset>

        {/* Sort By and Direction dropdowns */}
        <div className="flex gap-3 mb-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Sort Results By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SearchSortBy)}
              data-testid="sort-by-select"
              className="bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
            >
              <option value="modified-time">File Modification Time</option>
              <option value="created-time">File Creation Time</option>
              <option value="line-time">Time on Line</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Direction</label>
            <select
              value={sortDirection}
              onChange={(e) => setSortDirection(e.target.value as SearchSortDirection)}
              data-testid="sort-direction-select"
              className="bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
            >
              <option value="desc">DESC (newest first)</option>
              <option value="asc">ASC (oldest first)</option>
            </select>
          </div>
        </div>

        {error ? (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-2">
            {searchType === 'advanced' ? (
              <>Uses <code className="bg-slate-700 px-1 rounded">$("text")</code> function, or past(ts), future(ts), future(ts, days), today(ts). Combine with <code className="bg-slate-700 px-1 rounded">&&</code> and <code className="bg-slate-700 px-1 rounded">||</code></>
            ) : searchType === 'wildcard' ? (
              <>Use <code className="bg-slate-700 px-1 rounded">*</code> to match any characters. Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.</>
            ) : searchMode === 'filenames' ? (
              <>Searches file and folder names recursively (case-insensitive). Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.</>
            ) : searchImageExif ? (
              <>Searches .md, .txt, and image EXIF metadata recursively (case-insensitive). Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.</>
            ) : (
              <>Searches .md and .txt files recursively (case-insensitive). Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.</>
            )}
          </p>
        )}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            data-testid="cancel-search-button"
            className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSearch}
            disabled={!searchQuery.trim() && !mostRecent}
            data-testid="execute-search-button"
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded transition-colors"
          >
            Search
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete the search definition "${searchName}"?`}
          onConfirm={onConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

export default SearchDialog;
