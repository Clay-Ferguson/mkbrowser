import { useState } from 'react';
import { clsx } from 'clsx';
import { HomeIcon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import { useAS, setPendingIndexTreeReveal, setCurrentView, deleteItems } from '../store';
import {
  ENTRY_DND_MIME,
  parseDragPayload,
  canDropInto,
  moveEntryIntoFolder,
  reloadExpandedTreeFolder,
} from '../renderer/dragAndDrop';
import { joinPath, splitPathSegments, isPathInside } from '../renderer/pathUtil';
import { logger } from '../shared/logUtil';

export type PathBreadcrumbProps = {
  rootPath: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  /** Called after a drop moves an item into the currently-browsed folder, so the view refreshes. */
  onRefreshDirectory?: () => void;
};

/**
 * Renders the current directory path as a row of clickable breadcrumb segments.
 *
 * Each ancestor segment is a clickable button that navigates to that directory.
 * The current (rightmost) segment is non-interactive. Every segment — including the
 * root home icon — doubles as a drag-and-drop target that accepts file/folder moves.
 * A "reveal in tree" button appears at the end when the index tree panel is visible.
 */
function PathBreadcrumb({ rootPath, currentPath, onNavigate, onRefreshDirectory }: PathBreadcrumbProps) {
  const settings = useAS(s => s.settings);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const normalizedRoot = rootPath.replace(/[/\\]+$/, '');
  const normalizedCurrent = currentPath.replace(/[/\\]+$/, '');
  const relativePath = isPathInside(normalizedRoot, normalizedCurrent)
    ? normalizedCurrent.slice(normalizedRoot.length)
    : normalizedCurrent;

  const parts = splitPathSegments(relativePath);

  // Returns the absolute path for breadcrumb segment at `index`; -1 resolves to root.
  const buildPathForIndex = (index: number) => {
    if (index < 0) return normalizedRoot;
    return joinPath(normalizedRoot, ...parts.slice(0, index + 1));
  };

  const atRoot = normalizedCurrent === normalizedRoot;

  // Produces drag-event handlers that make a breadcrumb segment a drop target for
  // ENTRY_DND_MIME payloads (dragged from BrowseView entry icons or the IndexTreeView).
  const dropProps = (folderPath: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(ENTRY_DND_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverPath !== folderPath) setDragOverPath(folderPath);
    },
    onDragLeave: () => setDragOverPath(prev => (prev === folderPath ? null : prev)),
    onDrop: (e: React.DragEvent) => void (async () => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);

      const payload = parseDragPayload(e.dataTransfer.getData(ENTRY_DND_MIME));
      if (!payload || !canDropInto(payload, folderPath)) return;

      const result = await moveEntryIntoFolder(payload, folderPath);
      if (!result.success) return;

      deleteItems([payload.path]);
      await reloadExpandedTreeFolder(folderPath);
      await reloadExpandedTreeFolder(result.sourceFolder);

      // Only the currently-browsed folder (the rightmost breadcrumb) is shown in the BrowseView;
      // refresh it if the drop changed its contents (item moved into or out of it).
      if (folderPath === normalizedCurrent || result.sourceFolder === normalizedCurrent) {
        onRefreshDirectory?.();
      }
    })().catch(err => logger.error('Failed to move item into folder:', err)),
  });

  return (
    <div data-testid="path-breadcrumb" className="flex flex-wrap items-center gap-1 text-base">
      {parts.length > 0 &&
      <button
        type="button"
        onClick={() => !atRoot && onNavigate(normalizedRoot)}
        disabled={atRoot}
        {...dropProps(normalizedRoot)}
        data-testid="breadcrumb-home-button"
        className={clsx(
          'p-2 text-slate-400 hover:bg-slate-700 border rounded cursor-pointer flex-shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent',
          dragOverPath === normalizedRoot
            ? 'bg-blue-600/60 border-blue-400'
            : 'border-transparent hover:border-slate-500',
        )}
        aria-label="Go to root folder"
        title="Go to root folder"
      >
        <HomeIcon className="w-5 h-5" />
      </button>}

      {parts.length === 0 && (
        <span className="text-slate-200 font-medium">/</span>
      )}

      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        const segmentPath = buildPathForIndex(index);
        const isDragOver = dragOverPath === segmentPath;
        return (
          <div key={segmentPath} className="flex items-center">
            <span className="text-slate-200 mx-1">/</span>
            {isLast ? (
              <span
                {...dropProps(segmentPath)}
                className={clsx(
                  'px-2 py-1 text-purple-400 font-bold break-all rounded border',
                  isDragOver ? 'bg-blue-600/60 border-blue-400' : 'border-transparent',
                )}
              >
                {part}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segmentPath)}
                {...dropProps(segmentPath)}
                data-testid={`breadcrumb-segment-${part}`}
                className={clsx(
                  'px-2 py-1 text-slate-200 hover:bg-slate-700 border rounded cursor-pointer no-underline break-all transition-colors',
                  isDragOver
                    ? 'bg-blue-600/60 border-blue-400'
                    : 'border-transparent hover:border-slate-500',
                )}
              >
                {part}
              </button>
            )}
          </div>
        );
      })}

      {parts.length > 0 && settings.indexTreeWidth !== 'hidden' && (
        <button
          type="button"
          onClick={() => {
            setCurrentView('browser');
            setPendingIndexTreeReveal(currentPath);
          }}
          className="p-2 text-slate-400 hover:bg-slate-700 border border-transparent hover:border-slate-500 rounded cursor-pointer flex-shrink-0 transition-colors"
          aria-label="Reveal in folder tree"
          title="Reveal in folder tree"
          data-testid="breadcrumb-reveal-tree-button"
        >
          <ViewfinderCircleIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

export default PathBreadcrumb;
