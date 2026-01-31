import { useState } from 'react';
import { MagnifyingGlassIcon, DocumentTextIcon, TrashIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import {
  setSearchResults,
  setHighlightItem,
  navigateToBrowserPath,
  setPendingEditFile,
  setSearchResultsScrollPosition,
  getSearchResultsScrollPosition,
  useSearchResults,
  useSearchQuery,
  useSearchFolder,
  useSettings,
} from '../../store';
import { useScrollPersistence } from '../../utils/useScrollPersistence';
import ConfirmDialog from '../dialogs/ConfirmDialog';

interface SearchResultsViewProps {
  onNavigateToResult: (folderPath: string, fileName: string) => void;
}

function SearchResultsView({ onNavigateToResult }: SearchResultsViewProps) {
  const searchResults = useSearchResults();
  const searchQuery = useSearchQuery();
  const searchFolder = useSearchFolder();
  const settings = useSettings();
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  
  // Scroll position persistence
  const { containerRef: mainContainerRef, handleScroll: handleMainScroll } = useScrollPersistence(
    getSearchResultsScrollPosition,
    setSearchResultsScrollPosition
  );

  // Helper function to calculate days difference from today
  const getDaysFromToday = (timestamp: number): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(timestamp);
    targetDate.setHours(0, 0, 0, 0);
    const diffMs = targetDate.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  };

  // Helper function to format the days display
  const formatDaysDisplay = (days: number): string => {
    if (days === 0) return '(today)';
    
    const absDays = Math.abs(days);
    const sign = days < 0 ? '-' : '';
    
    // For small values (< 31 days), just show days
    if (absDays < 31) {
      return `(${sign}${absDays} day${absDays !== 1 ? 's' : ''})`;
    }
    
    // Calculate years, months, and remaining days
    const years = Math.floor(absDays / 365);
    const remainingAfterYears = absDays % 365;
    const months = Math.floor(remainingAfterYears / 30);
    const remainingDays = remainingAfterYears % 30;
    
    // Build the display string, omitting zero values
    const parts: string[] = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (remainingDays > 0) parts.push(`${remainingDays}d`);
    
    return `(${sign}${parts.join(' ')})`;
  };

  // Helper function to get the color class for days
  const getDaysColorClass = (days: number): string => {
    if (days === 0) return 'text-white';
    if (days < 0) return 'text-orange-400';
    return 'text-green-400';
  };

  // Debug: Log search results to see if foundTime is present
  // console.log('Search results:', searchResults);
  // console.log('First result:', searchResults[0]);

  // Check if any result has a non-zero foundTime
  const hasFoundTimes = searchResults.some(r => r.foundTime && r.foundTime > 0);
  // console.log('Has found times:', hasFoundTimes);

  // Sort results by foundTime if any result has it
  const sortedResults = hasFoundTimes
    ? [...searchResults].sort((a, b) => {
        const timeA = a.foundTime || 0;
        const timeB = b.foundTime || 0;
        return timeA - timeB; // Chronological order (oldest first)
      })
    : searchResults;
  // console.log('Sorted results:', sortedResults);

  // Font size CSS class mapping
  const fontSizeClass = {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  }[settings.fontSize];

  const handleResultClick = (resultPath: string) => {
    // Extract the parent folder and file name from the result path
    const lastSlashIndex = resultPath.lastIndexOf('/');
    const folderPath = resultPath.substring(0, lastSlashIndex);
    const fileName = resultPath.substring(lastSlashIndex + 1);
    onNavigateToResult(folderPath, fileName);
  };

  // Get the folder name for display
  const folderName = searchFolder.split('/').pop() || searchFolder;

  // Helper function to determine priority border styling
  const getPriorityBorder = (lineText?: string): string => {
    if (!lineText) return 'border border-slate-700 hover:border-slate-600';
    if (lineText.includes('#p1')) return 'border-2 border-orange-500 hover:border-orange-400';
    if (lineText.includes('#p2')) return 'border-2 border-yellow-400 hover:border-yellow-300';
    return 'border border-slate-700 hover:border-slate-600';
  };

  const handleDeleteClick = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const fileName = path.substring(path.lastIndexOf('/') + 1);
    setDeleteTarget({ path, name: fileName });
  };

  const handleEditClick = (e: React.MouseEvent, resultPath: string, lineNumber?: number) => {
    e.stopPropagation();
    // Extract the parent folder and file name from the result path
    const lastSlashIndex = resultPath.lastIndexOf('/');
    const folderPath = resultPath.substring(0, lastSlashIndex);
    const fileName = resultPath.substring(lastSlashIndex + 1);

    // Set highlight and navigate to browser view
    setHighlightItem(fileName);
    navigateToBrowserPath(folderPath, fileName);

    // Set the pending edit so App.tsx will start editing after items load
    // Include the line number if available (for scrolling to the match)
    setPendingEditFile(resultPath, lineNumber);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const success = await window.electronAPI.deleteFile(deleteTarget.path);
      if (success) {
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
      {/* Header */}
      <header className="flex-shrink-0">
        <div className="flex items-center gap-3 px-2 py-2">
          {/* Title */}
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-200 font-medium">Search Results</span>
            <span className="text-slate-500 truncate">
              for "{searchQuery}" in {folderName}
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main 
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        <div className="max-w-4xl mx-auto px-4 py-6">
        {searchResults.length === 0 ? (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">No results found for "{searchQuery}"</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Results count */}
            <div className="text-sm text-slate-500 mb-4">
              {searchResults.length} file{searchResults.length !== 1 ? 's' : ''} found
              {hasFoundTimes && (
                <span className="ml-2 text-blue-400 font-medium">• Items Ordered by Time</span>
              )}
            </div>

            {/* Results list */}
            {sortedResults.map((result, index) => {              
              return (
              <div
                key={`${result.path}-${result.lineNumber || 0}-${index}`}
                onClick={() => handleResultClick(result.path)}
                className={`bg-slate-800 rounded-lg ${getPriorityBorder(result.lineText)} px-2 py-1.5 transition-colors cursor-pointer`}
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
                      {result.foundTime && result.foundTime > 0 && (() => {
                        const days = getDaysFromToday(result.foundTime);
                        return (
                          <span className={`text-sm font-semibold ${getDaysColorClass(days)}`}>
                            {formatDaysDisplay(days)}
                          </span>
                        );
                      })()}
                    </div>
                    {/* Show matching line text if available */}
                    {result.lineText && (
                      <div className="text-sm text-slate-400 truncate mt-0.5 font-mono" title={result.lineText}>
                        {result.lineText}
                      </div>
                    )}
                  </div>

                  {/* Match count */}
                  <div className="text-sm text-slate-500 flex-shrink-0">
                    {result.matchCount} match{result.matchCount !== 1 ? 'es' : ''}
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={(e) => handleEditClick(e, result.path, result.lineNumber)}
                    className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
                    title="Edit file"
                  >
                    <PencilSquareIcon className="w-5 h-5" />
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDeleteClick(e, result.path)}
                    disabled={deleting}
                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
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
