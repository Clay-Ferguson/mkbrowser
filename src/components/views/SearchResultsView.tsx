import { useState } from 'react';
import { clsx } from 'clsx';
import { MagnifyingGlassIcon, DocumentTextIcon, TrashIcon, PencilSquareIcon, ShareIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import {
  setSearchResults,
  setHighlightItem,
  setHighlightedSearchResult,
  navigateToBrowserPath,
  setPendingEditFile,
  deleteItems,
  setFolderGraph,
  setCurrentView,
  useSearchResults,
  useSearchQuery,
  useSearchFolder,
  useSearchName,
  useSettings,
  useHighlightedSearchResult,
  useSearchSortBy,
  useSearchSortDirection,
} from '../../store';
import { getFileName, getParentPath } from '../../utils/pathUtil';
import { buildFolderGraphFromSearchResults } from '../../utils/searchTreeBuilder';
import { getContentWidthClasses, BUTTON_CLASS_BLUE, BUTTON_CLASS_RED } from '../../utils/styles';
import ConfirmDialog from '../dialogs/ConfirmDialog';

interface SearchResultsViewProps {
  onNavigateToResult: (folderPath: string, resultPath: string) => void;
}

function SearchResultsView({ onNavigateToResult }: SearchResultsViewProps) {
  const searchResults = useSearchResults();
  const searchQuery = useSearchQuery();
  const searchFolder = useSearchFolder();
  const searchName = useSearchName();
  const settings = useSettings();
  const highlightedSearchResult = useHighlightedSearchResult();
  const searchSortBy = useSearchSortBy();
  const searchSortDirection = useSearchSortDirection();
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Sort results based on the selected sort option and direction
  const sortedResults = [...searchResults].sort((a, b) => {
    if (searchSortBy === 'file-name') {
      const nameA = getFileName(a.relativePath) || a.relativePath;
      const nameB = getFileName(b.relativePath) || b.relativePath;
      const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      return searchSortDirection === 'asc' ? cmp : -cmp;
    }
    let timeA: number;
    let timeB: number;
    if (searchSortBy === 'created-time') {
      timeA = a.createdTime || 0;
      timeB = b.createdTime || 0;
    } else {
      timeA = a.modifiedTime || 0;
      timeB = b.modifiedTime || 0;
    }
    return searchSortDirection === 'asc' ? timeA - timeB : timeB - timeA;
  });
  // console.log('Sorted results:', sortedResults);

  // Font size CSS class mapping
  const fontSizeClass = {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  }[settings.fontSize];

  const handleResultClick = (resultPath: string, lineNumber?: number) => {
    // Track this as the highlighted search result
    setHighlightedSearchResult({ path: resultPath, lineNumber });
    
    // Extract the parent folder from the result path
    const folderPath = getParentPath(resultPath);

    // Highlight the item in the browser view with purple border
    setHighlightItem(resultPath);

    onNavigateToResult(folderPath, resultPath);
  };

  // Detect if a search has actually been executed
  const hasSearched = searchQuery.length > 0 || searchResults.length > 0;

  // Get the folder name for display
  const folderName = getFileName(searchFolder) || searchFolder;

  // Helper function to check if a result is highlighted
  const isHighlighted = (path: string, lineNumber?: number): boolean => {
    if (!highlightedSearchResult) return false;
    return highlightedSearchResult.path === path && 
           highlightedSearchResult.lineNumber === lineNumber;
  };

  const handleDeleteClick = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const fileName = getFileName(path);
    setDeleteTarget({ path, name: fileName });
  };

  const handleEditClick = (e: React.MouseEvent, resultPath: string, lineNumber?: number) => {
    e.stopPropagation();

    // Track this as the highlighted search result
    setHighlightedSearchResult({ path: resultPath, lineNumber });

    // Extract the parent folder from the result path
    const folderPath = getParentPath(resultPath);

    // Set highlight and navigate to browser view
    setHighlightItem(resultPath);
    navigateToBrowserPath(folderPath, resultPath);

    // Set the pending edit so App.tsx will start editing after items load
    // Include the line number if available (for scrolling to the match)
    setPendingEditFile(resultPath, lineNumber);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const success = await api.deleteFile(deleteTarget.path);
      if (success) {
        // Remove the deleted item from the store so it no longer appears
        // as selected or referenced in memory
        deleteItems([deleteTarget.path]);
        // Remove the deleted file from search results
        const updatedResults = searchResults.filter(r => r.path !== deleteTarget.path);
        setSearchResults(updatedResults, searchQuery, searchFolder);
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteTarget(null);
  };

  return (
    <div className={`flex-1 flex flex-col min-h-0 bg-slate-900 ${fontSizeClass}`}>
      {/* Header - only show search info when a search has been executed */}
      {hasSearched && (
        <header className="flex-shrink-0">
          <div className="flex items-center gap-3 px-4 py-2">
            {/* Title */}
            <div className="text-sm text-slate-300 truncate">
              {searchName && (
                <span className="text-purple-300 font-semibold mr-2">{searchName}:</span>
              )}
              Searched for <span className="text-slate-200 font-medium">"{searchQuery}"</span> in {folderName}
            </div>
            <button
              type="button"
              onClick={() => {
                if (searchResults.length === 0) return;
                const graph = buildFolderGraphFromSearchResults(searchResults);
                setFolderGraph(graph);
                setCurrentView('folder-graph');
              }}
              disabled={searchResults.length === 0}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 text-sm text-slate-200 bg-slate-700 hover:bg-slate-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title="View search results as folder graph"
            >
              <ShareIcon className="w-4 h-4" />
              Graph View
            </button>
          </div>
        </header>
      )}

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className={`${getContentWidthClasses(settings.contentWidth)} pt-2 pb-6`}>
        {!hasSearched ? (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-300 mb-2">No search yet</p>
            <p className="text-slate-500">
              Use the <MagnifyingGlassIcon className="w-4 h-4 inline-block mx-1 align-text-bottom" /> search button on the Browse tab to search your files.
            </p>
          </div>
        ) : searchResults.length === 0 ? (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">No results found for "{searchQuery}"</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Results count */}
            <div className="text-sm text-slate-300 mb-4">
              {searchResults.length} file{searchResults.length !== 1 ? 's' : ''} found
              <span className="ml-2 text-slate-300">
                • Sorted by {searchSortBy === 'file-name' ? 'file name' : searchSortBy === 'created-time' ? 'creation time' : 'modification time'} ({searchSortBy === 'file-name' ? (searchSortDirection === 'asc' ? 'A–Z' : 'Z–A') : (searchSortDirection === 'asc' ? 'oldest first' : 'newest first')})
              </span>
            </div>

            {/* Results list */}
            {sortedResults.map((result) => {
              const highlighted = isHighlighted(result.path, result.lineNumber);
              const borderClass = highlighted 
                ? 'border-2 border-purple-500' : 'border border-slate-700 hover:border-slate-600';
              
              return (
              <div
                key={`${result.path}-${result.lineNumber || 0}`}
                onClick={() => handleResultClick(result.path, result.lineNumber)}
                className={`bg-slate-800 rounded-lg ${borderClass} px-2 py-1.5 transition-colors cursor-pointer`}
              >
                <div className="flex items-start gap-2">
                  {/* File icon */}
                  <DocumentTextIcon className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />

                  {/* File path with optional line number */}
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200 flex flex-wrap items-center gap-x-2 gap-y-0.5 break-words" title={result.path}>
                      <span className="break-all">{result.relativePath}</span>
                      {result.lineNumber && result.lineNumber > 0 && (
                        <span className="text-sm text-amber-400">:{result.lineNumber}</span>
                      )}
                    </div>
                    {/* Show matching line text if available */}
                    {result.lineText && (
                      <div
                        className={clsx(
                          'text-sm truncate mt-0.5 font-mono',
                          /#p1\b/i.test(result.lineText) ? 'text-orange-400' :
                          /#p2\b/i.test(result.lineText) ? 'text-yellow-400' :
                          /#p3\b/i.test(result.lineText) ? 'text-blue-400' :
                          'text-slate-400',
                        )}
                        title={result.lineText}
                      >
                        {result.lineText}
                      </div>
                    )}
                    {/* Show extra context line below match if available */}
                    {result.extraLine && (
                      <div className="text-sm text-slate-500 truncate font-mono" title={result.extraLine}>
                        ↳ {result.extraLine}
                      </div>
                    )}
                  </div>

                  {/* Match count */}
                  <div className="text-sm text-slate-500 flex-shrink-0">
                    {result.matchCount} match{result.matchCount !== 1 ? 'es' : ''}
                  </div>

                  {/* Edit button */}
                  <button
                    type="button"
                    onClick={(e) => handleEditClick(e, result.path, result.lineNumber)}
                    className={BUTTON_CLASS_BLUE}
                    title="Edit file"
                  >
                    <PencilSquareIcon className="w-5 h-5" />
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => handleDeleteClick(e, result.path)}
                    disabled={deleting}
                    className={BUTTON_CLASS_RED}
                    title="Delete"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
        </div>
      </main>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <ConfirmDialog
          message={`Are you sure you want to delete "${deleteTarget.name}"?`}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default SearchResultsView;
