import { HomeIcon, BookmarkIcon as BookmarkOutlineIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';

export type PathBreadcrumbProps = {
  rootPath: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
};

function PathBreadcrumb({ rootPath, currentPath, onNavigate, isBookmarked, onToggleBookmark }: PathBreadcrumbProps) {
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

  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => onNavigate(normalizedRoot)}
        className="p-1 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded cursor-pointer flex-shrink-0 transition-colors"
        aria-label="Go to root folder"
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
            <span className="text-slate-500 mx-1">/</span>
            {isLast ? (
              <span
                className="text-slate-200 break-all"
              >
                {part}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(buildPathForIndex(index))}
                className="px-1 text-slate-200 hover:text-blue-400 hover:bg-slate-700 rounded cursor-pointer no-underline break-all transition-colors"
              >
                {part}
              </button>
            )}
          </div>
        );
      })}

      {parts.length > 0 && (
        <button
          type="button"
          onClick={onToggleBookmark}
          className="p-1 text-slate-400 hover:text-blue-400 rounded cursor-pointer flex-shrink-0 ml-1"
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
