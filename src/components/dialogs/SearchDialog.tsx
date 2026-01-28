import { useEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import EditableCombobox, { type ComboboxOption } from '../EditableCombobox';
import type { SearchDefinition } from '../../store/types';

export type SearchMode = 'content' | 'filenames';
export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchBlock = 'entire-file' | 'file-lines';

export interface SearchOptions {
  query: string;
  searchType: SearchType;
  searchMode: SearchMode;
  searchBlock: SearchBlock;
  searchName: string;
}

export interface SearchDialogInitialValues {
  searchQuery?: string;
  searchName?: string;
  searchType?: SearchType;
  searchMode?: SearchMode;
  searchBlock?: SearchBlock;
}

interface SearchDialogProps {
  onSearch: (options: SearchOptions) => void;
  onCancel: () => void;
  onDeleteSearchDefinition: (name: string) => void;
  initialValues?: SearchDialogInitialValues;
  searchDefinitions: SearchDefinition[];
}

function SearchDialog({ onSearch, onCancel, onDeleteSearchDefinition, initialValues, searchDefinitions }: SearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState(
    initialValues?.searchQuery ? initialValues.searchQuery.replace(/\{\{nl\}\}/g, '\n') : ''
  );
  const [searchName, setSearchName] = useState(initialValues?.searchName || '');
  const [searchType, setSearchType] = useState<SearchType>(initialValues?.searchType || 'literal');
  const [searchMode, setSearchMode] = useState<SearchMode>(initialValues?.searchMode || 'content');
  const [searchBlock, setSearchBlock] = useState<SearchBlock>(initialValues?.searchBlock || 'entire-file');
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
      setSearchBlock(selectedDef.searchBlock);
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
    if (!cleanedQuery) return;
    
    setError(null);
    
    // Encode newlines as {{nl}} for persistence in search definition
    const persistedQuery = searchQuery.replace(/[\r\n]+/g, '{{nl}}').trim();
    
    onSearch({ query: persistedQuery, searchType, searchMode, searchBlock, searchName: searchName.trim() });
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 w-full max-w-2xl mx-4 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-100 mb-3">Search in folder</h2>
      
        <label className="block text-sm text-slate-400 mb-2">
          {searchType === 'advanced' ? 'JavaScript expression' : searchType === 'wildcard' ? 'Search text (use * as wildcard, matches up to 25 characters)' : 'Search text'}
        </label>
        <textarea
          ref={textareaRef}
          value={searchQuery}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          rows={4}
          className={`w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border focus:outline-none text-sm font-mono resize-none ${
            error ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
          }`}
          placeholder={searchType === 'advanced' ? '$(\'ABC\') || $(\'DEF\')' : searchType === 'wildcard' ? 'intro*duction' : 'Enter search text...'}
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
            />
            <button
              onClick={() => {
                if (searchName.trim()) {
                  setShowDeleteConfirm(true);
                }
              }}
              disabled={!searchName.trim()}
              className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 disabled:cursor-not-allowed rounded transition-colors"
            >
              Delete
            </button>
          </div>
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
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">Advanced</span>
            </label>
          </div>
        </fieldset>

        {/* Search block radio buttons (only enabled for file contents search with advanced mode) */}
        <fieldset className={`border border-slate-600 rounded-md p-3 mb-3 ${searchMode === 'filenames' || searchType !== 'advanced' ? 'opacity-50' : ''}`}>
          <legend className="text-xs text-slate-400 px-2">Search Block</legend>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchBlock"
                checked={searchBlock === 'entire-file'}
                onChange={() => setSearchBlock('entire-file')}
                disabled={searchMode === 'filenames' || searchType !== 'advanced'}
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-sm text-slate-300">Entire File</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchBlock"
                checked={searchBlock === 'file-lines'}
                onChange={() => setSearchBlock('file-lines')}
                disabled={searchMode === 'filenames' || searchType !== 'advanced'}
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-sm text-slate-300">File Lines</span>
            </label>
          </div>
        </fieldset>

        {error ? (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-2">
            {searchType === 'advanced' ? (
              <>Uses <code className="bg-slate-700 px-1 rounded">$("text")</code> function. Combine with <code className="bg-slate-700 px-1 rounded">&&</code> and <code className="bg-slate-700 px-1 rounded">||</code></>
            ) : searchType === 'wildcard' ? (
              <>Use <code className="bg-slate-700 px-1 rounded">*</code> to match any characters. Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.</>
            ) : searchMode === 'filenames' ? (
              <>Searches file and folder names recursively (case-insensitive). Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.</>
            ) : (
              <>Searches .md and .txt files recursively (case-insensitive). Press <code className="bg-slate-700 px-1 rounded">Ctrl+Enter</code> to search.</>
            )}
          </p>
        )}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSearch}
            disabled={!searchQuery.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded transition-colors"
          >
            Search
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete the search definition "${searchName}"?`}
          onConfirm={() => {
            if (searchName.trim()) {
              onDeleteSearchDefinition(searchName.trim());
              setSearchName('');
            }
            setShowDeleteConfirm(false);
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

export default SearchDialog;
