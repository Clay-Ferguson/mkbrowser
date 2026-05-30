import { useEffect, useRef, useState } from 'react';
import { ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import ConfirmDialog from './ConfirmDialog';
import DlgHeader from './common/DlgHeader';
import type { SearchDefinition } from '../../types/types';
import * as globalHighlight from '../../utils/globalHighlight';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_CONTAINER, DLG_LABEL_CLASS } from '../../utils/styles';

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
    initialValues?.searchQuery ? initialValues.searchQuery.replace(/\{\{nl\}\}/g, '\n') : (globalHighlight.globalHighlightText || '')
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

  const sortedDefinitions = [...searchDefinitions].sort((a, b) => a.name.localeCompare(b.name));

  const handleSelectSearchDefinition = (def: SearchDefinition) => {
    setSearchName(def.name);
    setSearchQuery(def.searchText.replace(/\{\{nl\}\}/g, '\n'));
    setSearchType(def.searchMode);
    setSearchMode(def.searchTarget);
    setSortBy(def.sortBy || 'modified-time');
    setSortDirection(def.sortDirection || 'desc');
    setSearchImageExif(def.searchImageExif ?? false);
    setMostRecent(def.mostRecent ?? false);
    setTimeout(adjustTextareaHeight, 0);
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const lineHeight = 20;
      const minHeight = lineHeight * 4;
      const newHeight = Math.max(minHeight, textarea.scrollHeight);
      textarea.style.height = `${newHeight}px`;
    }
  };

  const handleSearch = () => {
    const cleanedQuery = searchQuery.replace(/[\r\n]+/g, ' ').trim();
    if (!cleanedQuery && !mostRecent) return;

    setError(null);

    const persistedQuery = searchQuery.replace(/[\r\n]+/g, '{{nl}}').trim();

    globalHighlight.setGlobalHighlightText(searchType === 'literal' ? cleanedQuery : '');
    onSearch({ query: persistedQuery, searchType, searchMode, searchName: searchName.trim(), sortBy, sortDirection, searchImageExif, mostRecent });
  };

  const handleSave = () => {
    if (!searchName.trim()) return;

    setError(null);

    const persistedQuery = searchQuery.replace(/[\r\n]+/g, '{{nl}}').trim();

    onSave({ query: persistedQuery, searchType, searchMode, searchName: searchName.trim(), sortBy, sortDirection, searchImageExif, mostRecent });
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSearchQuery(e.target.value);
    if (error) setError(null);
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
    <div className={DLG_OVERLAY_CLASS}>
      <div className={`${DLG_CONTAINER} w-full max-w-4xl mx-4 flex flex-col`} style={{ maxHeight: '90vh' }}>
        <DlgHeader title="Search" onClose={onCancel} />
        <div className="flex min-h-0 flex-1" style={{ minHeight: '480px' }}>

          {/* Left panel: saved search definitions */}
          <div className="flex flex-col border-r border-slate-600" style={{ width: '33.333%' }}>
            <div className="p-6 pb-1">
              <label className={DLG_LABEL_CLASS}>Search Definition Name</label>
              <input
                type="text"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="Enter a name..."
                data-testid="search-name-input"
                className="w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
              />
              <div className="flex justify-end gap-1 mt-1">
                <button
                  onClick={handleSave}
                  disabled={!searchName.trim()}
                  data-testid="save-search-button"
                  title="Save search definition"
                  className="p-1 rounded text-green-400 hover:text-green-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { if (searchName.trim()) setShowDeleteConfirm(true); }}
                  disabled={!searchName.trim()}
                  data-testid="delete-search-button"
                  title="Delete search definition"
                  className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 p-2" style={{ overflow: 'auto' }}>
              {sortedDefinitions.length === 0 ? (
                <p className="text-xs text-slate-500 p-2">No saved searches yet.</p>
              ) : (
                <ul className="space-y-0.5" style={{ minWidth: 'max-content' }}>
                  {sortedDefinitions.map((def) => (
                    <li key={def.name}>
                      <button
                        onClick={() => handleSelectSearchDefinition(def)}
                        className={`w-full text-left px-3 py-1.5 rounded text-sm whitespace-nowrap overflow-hidden text-ellipsis ${
                          searchName === def.name
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-300 hover:bg-slate-700'
                        }`}
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
              className={`w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border focus:outline-none text-sm font-mono resize-none ${error ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
                }`}
              placeholder={searchType === 'advanced' ? 'Functions: $, past, future, today' : searchType === 'wildcard' ? 'intro*duction' : 'Enter search text...'}
              style={{ minHeight: '80px' }}
            />

            <div className="flex items-center gap-6 mb-3 mt-3">
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
                  <option value="file-name">File Name</option>
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

            <div className="flex justify-end items-center gap-3 mt-6">
              <div className="flex gap-3">
                <button
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
