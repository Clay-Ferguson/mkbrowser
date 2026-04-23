import { HomeIcon, BookmarkIcon as BookmarkOutlineIcon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import type { AppView } from '../store/types';
import { useSettings, useHighlightItem, setPendingIndexTreeReveal } from '../store';

export type PathBreadcrumbProps = {
  rootPath: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  view?: AppView;
};

function PathBreadcrumb({ rootPath, currentPath, onNavigate, isBookmarked, onToggleBookmark, view }: PathBreadcrumbProps) {
  const settings = useSettings();
  const highlightItem = useHighlightItem();
  const normalizedRoot = rootPath.replace(/\/+$/, '');
  const normalizedCurrent = currentPath.replace(/\/+$/, '');
  const relativePath = normalizedCurrent.startsWith(normalizedRoot)
    ? normalizedCurrent.slice(normalizedRoot.length)
    : normalizedCurrent;

  const parts = relativePath
    .split('/')
    .filter(Boolean);

  const buildPathForIndex = (index: number) => {
    if (index < 0) return normalizedRoot;
    const segmentPath = parts.slice(0, index + 1).join('/');
    return `${normalizedRoot}/${segmentPath}`;
  };

  const atRoot = normalizedCurrent === normalizedRoot;
  return (
    <div className="flex flex-wrap items-center gap-1 text-base">
      <button
        type="button"
        onClick={() => !atRoot && onNavigate(normalizedRoot)}
        disabled={atRoot}
        className={
          `p-2 text-slate-400 flex-shrink-0 transition-colors cursor-pointer bg-transparent border-none outline-none
          hover:bg-slate-800/20 active:bg-slate-800/30 disabled:opacity-30 disabled:cursor-not-allowed`
        }
        aria-label="Go to root folder"
        title="Go to root folder"
        style={{ background: 'none', border: 'none', outline: 'none' }}
      >
        <HomeIcon className="w-5 h-5" />
      </button>

      {parts.length === 0 && (
        <span className="text-slate-200 font-medium">/</span>
      )}

      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        return (
          <div key={`${part}-${index}`} className="flex items-center">
            <span className="text-slate-200 mx-1">/</span>
            {isLast ? (
              <span
                className="px-2 py-1 text-purple-400 font-bold break-all"
              >
                {part}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(buildPathForIndex(index))}
                className="px-2 py-1 text-slate-200 hover:bg-slate-700 border border-transparent hover:border-slate-500 rounded cursor-pointer no-underline break-all transition-colors"
              >
                {part}
              </button>
            )}
          </div>
        );
      })}

      {settings.indexTreeWidth !== 'hidden' && (
        <button
          type="button"
          onClick={() => setPendingIndexTreeReveal(highlightItem ?? currentPath)}
          className="p-2 text-slate-400 hover:bg-slate-700 border border-transparent hover:border-slate-500 rounded cursor-pointer flex-shrink-0 transition-colors"
          aria-label="Reveal in folder tree"
          title="Reveal in folder tree"
        >
          <ViewfinderCircleIcon className="w-5 h-5" />
        </button>
      )}

      {parts.length > 0 && view !== 'thread' && (
        <button
          type="button"
          onClick={onToggleBookmark}
          className="p-1 text-slate-400 rounded cursor-pointer flex-shrink-0 ml-1"
          aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
          {isBookmarked ? (
            <BookmarkSolidIcon className="w-5 h-5 text-blue-400" />
          ) : (
            <BookmarkOutlineIcon className="w-5 h-5" />
          )}
        </button>
      )}
    </div>
  );
}

export default PathBreadcrumb;
