import { useEffect, useRef, useState } from 'react';

export type SearchMode = 'content' | 'filenames';

export interface SearchOptions {
  query: string;
  isAdvanced: boolean;
  searchMode: SearchMode;
}

interface SearchDialogProps {
  onSearch: (options: SearchOptions) => void;
  onCancel: () => void;
}

function SearchDialog({ onSearch, onCancel }: SearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('content');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    // Remove all newlines and trim the query before using it
    const cleanedQuery = searchQuery.replace(/[\r\n]+/g, ' ').trim();
    if (!cleanedQuery) return;
    
    // Validate advanced search requires $() predicate
    if (isAdvanced && !cleanedQuery.includes('$(')) {
      setError('Advanced search requires a $() predicate expression');
      return;
    }
    
    setError(null);
    onSearch({ query: cleanedQuery, isAdvanced, searchMode });
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
          {isAdvanced ? 'JavaScript expression' : 'Search text'}
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
          placeholder={isAdvanced ? '$("ABC") || $("DEF")' : 'Enter search text...'}
          style={{ minHeight: '80px' }}
        />

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

        {/* Search type radio buttons */}
        <fieldset className="border border-slate-600 rounded-md p-3 mb-4">
          <legend className="text-xs text-slate-400 px-2">Search Mode</legend>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchType"
                checked={!isAdvanced}
                onChange={() => setIsAdvanced(false)}
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">Literal</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchType"
                checked={isAdvanced}
                onChange={() => setIsAdvanced(true)}
                className="w-4 h-4 border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300">Advanced</span>
            </label>
          </div>
        </fieldset>

        {error ? (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-2">
            {isAdvanced ? (
              <>Uses <code className="bg-slate-700 px-1 rounded">$("text")</code> function. Combine with <code className="bg-slate-700 px-1 rounded">&&</code> and <code className="bg-slate-700 px-1 rounded">||</code></>
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
    </div>
  );
}

export default SearchDialog;
