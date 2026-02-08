import { HashtagIcon } from '@heroicons/react/24/outline';
import {
  setFolderAnalysisScrollPosition,
  getFolderAnalysisScrollPosition,
  useFolderAnalysis,
} from '../../store';
import { useScrollPersistence } from '../../utils/useScrollPersistence';

interface FolderAnalysisViewProps {
  onSearchHashtag: (hashtag: string, ctrlKey: boolean) => void;
}

function FolderAnalysisView({ onSearchHashtag }: FolderAnalysisViewProps) {
  const folderAnalysis = useFolderAnalysis();

  // Scroll position persistence
  const { containerRef: mainContainerRef, handleScroll: handleMainScroll } = useScrollPersistence(
    getFolderAnalysisScrollPosition,
    setFolderAnalysisScrollPosition
  );

  if (!folderAnalysis) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <p className="text-slate-400">No analysis data available. Run a folder analysis from Tools &gt; Folder Analysis.</p>
      </div>
    );
  }

  const { hashtags, folderPath, totalFiles } = folderAnalysis;

  return (
    <main
      ref={mainContainerRef}
      onScroll={handleMainScroll}
      className="flex-1 min-h-0 overflow-y-auto pb-4"
    >
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <p className="text-sm text-slate-400">
            Scanned <span className="text-slate-300 font-medium">{totalFiles}</span> file{totalFiles !== 1 ? 's' : ''} in{' '}
            <span className="text-slate-300 font-mono text-xs">{folderPath}</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">Click for File Search. CTRL-Click for Line-by-Line Search</p>
        </div>

        {/* Hashtags section */}
        <div className="mb-6">
          <h2 className="text-lg font-medium text-slate-200 mb-3 flex items-center gap-2">
            <HashtagIcon className="w-5 h-5 text-blue-400" />
            Hashtags
            <span className="text-sm text-slate-400 font-normal">({hashtags.length} unique)</span>
          </h2>

          {hashtags.length === 0 ? (
            <p className="text-slate-400 py-4">No hashtags found in the scanned files.</p>
          ) : (
            <div className="space-y-1">
              {hashtags.map((entry) => (
                <button
                  key={entry.tag}
                  type="button"
                  onClick={(e) => onSearchHashtag(entry.tag, e.ctrlKey)}
                  className="w-full flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer text-left"
                  title={`Search for ${entry.tag} (Ctrl+click for advanced search)`}
                >
                  <span className="text-blue-400 font-mono text-sm">{entry.tag}</span>
                  <span className="text-slate-400 text-sm tabular-nums">
                    {entry.count}
                    <span className="text-slate-500 ml-1">{entry.count === 1 ? 'occurrence' : 'occurrences'}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default FolderAnalysisView;
