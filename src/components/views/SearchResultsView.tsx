import {
  setCurrentView,
  useSearchResults,
  useSearchQuery,
  useSearchFolder,
  useSettings,
} from '../../store';

interface SearchResultsViewProps {
  onNavigateToResult: (folderPath: string, fileName: string) => void;
}

function SearchResultsView({ onNavigateToResult }: SearchResultsViewProps) {
  const searchResults = useSearchResults();
  const searchQuery = useSearchQuery();
  const searchFolder = useSearchFolder();
  const settings = useSettings();

  // Font size CSS class mapping
  const fontSizeClass = {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
  }[settings.fontSize];

  const handleBack = () => {
    setCurrentView('browser');
  };

  const handleResultClick = (resultPath: string) => {
    // Extract the parent folder and file name from the result path
    const lastSlashIndex = resultPath.lastIndexOf('/');
    const folderPath = resultPath.substring(0, lastSlashIndex);
    const fileName = resultPath.substring(lastSlashIndex + 1);
    onNavigateToResult(folderPath, fileName);
  };

  // Get the folder name for display
  const folderName = searchFolder.split('/').pop() || searchFolder;

  return (
    <div className={`min-h-screen bg-slate-900 ${fontSizeClass}`}>
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Back button */}
            <button
              onClick={handleBack}
              className="p-2 rounded-lg transition-colors text-slate-400 hover:bg-slate-700"
              title="Back to browser"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Title */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-200 font-medium">Search Results</span>
                <span className="text-slate-500">
                  for "{searchQuery}" in {folderName}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {searchResults.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-slate-400">No results found for "{searchQuery}"</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Results count */}
            <div className="text-sm text-slate-500 mb-4">
              {searchResults.length} file{searchResults.length !== 1 ? 's' : ''} found
            </div>

            {/* Results list */}
            {searchResults.map((result) => (
              <div
                key={result.path}
                onClick={() => handleResultClick(result.path)}
                className="bg-slate-800 rounded-lg border border-slate-700 p-4 hover:border-slate-600 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {/* File icon */}
                  <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>

                  {/* File path */}
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200 truncate" title={result.path}>
                      {result.relativePath}
                    </div>
                  </div>

                  {/* Match count */}
                  <div className="text-sm text-slate-500 flex-shrink-0">
                    {result.matchCount} match{result.matchCount !== 1 ? 'es' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default SearchResultsView;
