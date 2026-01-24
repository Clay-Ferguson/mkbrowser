import { useEffect, useRef, useState } from 'react';

export interface SearchOptions {
  query: string;
  isAdvanced: boolean;
}

interface SearchDialogProps {
  onSearch: (options: SearchOptions) => void;
  onCancel: () => void;
}

function SearchDialog({ onSearch, onCancel }: SearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdvanced, setIsAdvanced] = useState(false);
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
    
    // Validate advanced search requires contains() predicate
    if (isAdvanced && !cleanedQuery.includes('contains(')) {
      setError('Advanced search requires a contains() predicate expression');
      return;
    }
    
    setError(null);
    onSearch({ query: cleanedQuery, isAdvanced });
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
        
        {/* Advanced checkbox */}
        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={isAdvanced}
            onChange={(e) => setIsAdvanced(e.target.checked)}
            className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-800"
          />
          <span className="text-sm text-slate-300">Advanced</span>
        </label>

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
          placeholder={isAdvanced ? 'contains("ABC") || contains("DEF")' : 'Enter search text...'}
          style={{ minHeight: '80px' }}
        />
        {error ? (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-2">
            {isAdvanced ? (
              <>Uses <code className="bg-slate-700 px-1 rounded">contains("text")</code> function. Combine with <code className="bg-slate-700 px-1 rounded">&&</code> and <code className="bg-slate-700 px-1 rounded">||</code></>
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
