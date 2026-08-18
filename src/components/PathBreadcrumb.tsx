import { useState } from 'react';
import { clsx } from 'clsx';
import { HomeIcon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import { useAS, setPendingIndexTreeReveal, setCurrentView } from '../store';
import {
  ENTRY_DND_MIME,
  parseDragPayload,
  canDropInto,
  completeEntryDrop,
} from '../renderer/dragAndDrop';
import { BREADCRUMB_IDLE, BREADCRUMB_SEGMENT_IDLE, ENTRY_DROP_TARGET } from '../renderer/styles';
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
 * The current (rightmost) segment is non-interactive. The root home icon is always
 * shown and always clickable, even at the root itself. Every segment — including
 * that home icon — doubles as a drag-and-drop target that accepts file/folder moves.
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
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);

      // Read the drag payload synchronously — the DataTransfer is only valid
      // during the event dispatch, before any await.
      const payload = parseDragPayload(e.dataTransfer.getData(ENTRY_DND_MIME));
      if (!payload || !canDropInto(payload, folderPath)) return;

      completeEntryDrop(payload, folderPath, onRefreshDirectory)
        .catch(err => logger.error('Failed to move item into folder:', err));
    },
  });

  return (
    <div data-testid="path-breadcrumb" className="flex flex-wrap items-center gap-1 text-base">
      {/* Always rendered and always clickable, including when already at the
          root: navigating to the root you are already on is a harmless no-op,
          and keeping the button live means it is still a drop target there. */}
      <button
        type="button"
        onClick={() => onNavigate(normalizedRoot)}
        {...dropProps(normalizedRoot)}
        data-testid="breadcrumb-home-button"
        className={clsx(
          'p-2 border border-transparent rounded cursor-pointer flex-shrink-0 transition-colors',
          dragOverPath === normalizedRoot
            ? `text-white ${ENTRY_DROP_TARGET}`
            : BREADCRUMB_IDLE,
        )}
        aria-label="Go to root folder"
        title="Go to root folder"
      >
        <HomeIcon className="w-5 h-5" />
      </button>

      {parts.length === 0 && (
        <span className="text-slate-200 font-medium">/</span>
      )}

      {parts.map((part, index) => {
        const segmentPath = buildPathForIndex(index);
        const isDragOver = dragOverPath === segmentPath;
        return (
          <div key={segmentPath} className="flex items-center">
            <span className="text-slate-200 mx-1">/</span>

            <button
              type="button"
              onClick={() => onNavigate(segmentPath)}
              {...dropProps(segmentPath)}
              data-testid={`breadcrumb-segment-${part}`}
              className={clsx(
                'px-2 py-1 border border-transparent rounded cursor-pointer no-underline break-all transition-colors',
                isDragOver
                  ? `text-white ${ENTRY_DROP_TARGET}`
                  : BREADCRUMB_SEGMENT_IDLE,
              )}
            >
              {part}
            </button>

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
          className={`p-2 border border-transparent rounded cursor-pointer flex-shrink-0 transition-colors ${BREADCRUMB_IDLE}`}
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
