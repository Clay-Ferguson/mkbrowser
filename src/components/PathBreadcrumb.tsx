import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { HomeIcon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import { useAS, setPendingIndexTreeReveal, setCurrentView } from '../store';
import {
  ENTRY_DND_MIME,
  parseDragPayload,
  canDropInto,
  completeEntryDrop,
} from '../renderer/dragAndDrop';
import { BREADCRUMB_REVEAL_IDLE, BREADCRUMB_SEGMENT_IDLE, ENTRY_DROP_TARGET } from '../renderer/styles';
import { joinPath, splitPathSegments, isPathInside } from '../renderer/pathUtil';
import { reconcileAndRefresh } from '../renderer/indexOrderOp';
import { api } from '../renderer/api';
import { logger } from '../shared/logUtil';
import SymlinkBadge from './SymlinkBadge';

export type PathBreadcrumbProps = {
  rootPath: string;
  currentPath: string;
  onNavigate: (path: string) => void;
};

/**
 * The breadcrumb segments below the root, each with its absolute path:
 * `a/b` under `/root` gives `a` → `/root/a` and `b` → `/root/a/b`.
 */
function buildSegments(root: string, relativePath: string): { name: string; path: string }[] {
  const parts = splitPathSegments(relativePath);
  return parts.map((name, i) => ({ name, path: joinPath(root, ...parts.slice(0, i + 1)) }));
}

/**
 * Renders the current directory path as a row of clickable breadcrumb segments.
 *
 * Each ancestor segment is a clickable button that navigates to that directory.
 * The current folder's element (the rightmost segment, or the home icon at the
 * root) is the app's Refresh control: clicking it reloads the listing and the
 * index tree before handing the click to `onNavigate` as usual (which, in
 * single-file mode, returns to the folder listing). The root home icon is always
 * shown and always clickable, even at the root itself. Every segment — including
 * that home icon — doubles as a drag-and-drop target that accepts file/folder moves.
 * A "reveal in tree" button appears at the end when the index tree panel is visible.
 * Any segment (or the root) that is a symbolic link shows the SymlinkBadge.
 *
 * See: (single_file_browsing.md#the-header-breadcrumb--listing-hidden-badge)
 * See: (USER_GUIDE.md#symbolic-links)
 * See: (USER_GUIDE.md#drag-and-drop)
 * See: (index_tree.md#revealing-a-path)
 */
function PathBreadcrumb({ rootPath, currentPath, onNavigate }: PathBreadcrumbProps) {
  const indexTreeHidden = useAS(s => s.settings.indexTreeWidth === 'hidden');
  const hasIndexFile = useAS(s => s.hasIndexFile);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const normalizedRoot = rootPath.replace(/[/\\]+$/, '');
  const normalizedCurrent = currentPath.replace(/[/\\]+$/, '');
  const relativePath = isPathInside(normalizedRoot, normalizedCurrent)
    ? normalizedCurrent.slice(normalizedRoot.length)
    : normalizedCurrent;

  const segments = buildSegments(normalizedRoot, relativePath);

  // The root and segment paths that are symbolic links, for their badges. One
  // lstat batch per navigation. A result left over from the previous path is
  // harmless while the next loads: it is keyed by absolute path, and whether a
  // path is a link doesn't depend on which folder is being browsed.
  const [linkPaths, setLinkPaths] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let ignore = false;
    const paths = [normalizedRoot, ...buildSegments(normalizedRoot, relativePath).map(s => s.path)];
    api.findSymlinks(paths)
      .then(found => {
        if (!ignore) setLinkPaths(new Set(found));
      })
      .catch(err => logger.error('Failed to check breadcrumb paths for symlinks:', err));
    return () => {
      ignore = true;
    };
  }, [normalizedRoot, relativePath]);

  // Clicking the current folder refreshes it (listing + index tree) first.
  const handleClick = (path: string) => {
    if (path === normalizedCurrent) {
      reconcileAndRefresh(normalizedCurrent, hasIndexFile);
    }
    onNavigate(path);
  };

  const isAtRoot = segments.length === 0;

  // Produces drag-event handlers that make a breadcrumb segment a drop target for
  // ENTRY_DND_MIME payloads (dragged from BrowseView entry icons or the IndexTreeView).
  // See: (USER_GUIDE.md#drag-and-drop)
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

      completeEntryDrop(payload, folderPath)
        .catch(err => logger.error('Failed to move item into folder:', err));
    },
  });

  return (
    <div data-testid="path-breadcrumb" className="flex flex-wrap items-center gap-1 text-base">
      {/* Always rendered and always clickable, including when already at the
          root: there it is the current folder, so clicking it refreshes, and
          keeping the button live means it is still a drop target there. */}
      <button
        type="button"
        onClick={() => handleClick(normalizedRoot)}
        {...dropProps(normalizedRoot)}
        data-testid="breadcrumb-home-button"
        className={clsx(
          'flex items-center gap-1.5 p-2 border border-transparent rounded cursor-pointer flex-shrink-0 transition-colors',
          dragOverPath === normalizedRoot
            ? `text-white ${ENTRY_DROP_TARGET}`
            : BREADCRUMB_SEGMENT_IDLE,
        )}
        aria-label={isAtRoot ? 'Refresh root folder' : 'Go to root folder'}
        aria-current={isAtRoot ? 'location' : undefined}
        title={isAtRoot ? 'Refresh (root folder)' : 'Go to root folder'}
      >
        <HomeIcon className="w-5 h-5" />
        {linkPaths.has(normalizedRoot) && <SymlinkBadge />}
      </button>

      {isAtRoot && (
        <span className="text-btn-accent-amber font-medium">/</span>
      )}

      {segments.map(({ name: part, path: segmentPath }, index) => {
        const isDragOver = dragOverPath === segmentPath;
        const isCurrent = index === segments.length - 1;
        return (
          <div key={segmentPath} className="flex items-center">
            <span className="text-btn-accent-amber mx-1">/</span>

            <button
              type="button"
              onClick={() => handleClick(segmentPath)}
              {...dropProps(segmentPath)}
              data-testid={`breadcrumb-segment-${part}`}
              aria-current={isCurrent ? 'location' : undefined}
              title={isCurrent ? 'Refresh' : undefined}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2 py-1 border border-transparent rounded cursor-pointer no-underline break-all transition-colors',
                isDragOver
                  ? `text-white ${ENTRY_DROP_TARGET}`
                  : BREADCRUMB_SEGMENT_IDLE,
              )}
            >
              {part}
              {linkPaths.has(segmentPath) && <SymlinkBadge />}
            </button>

          </div>
        );
      })}

      {segments.length > 0 && !indexTreeHidden && (
        <button
          type="button"
          onClick={() => {
            setCurrentView('browser');
            setPendingIndexTreeReveal(currentPath);
          }}
          className={`p-2 border border-transparent rounded cursor-pointer flex-shrink-0 transition-colors ${BREADCRUMB_REVEAL_IDLE}`}
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
