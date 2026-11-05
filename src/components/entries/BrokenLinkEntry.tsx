import { clsx } from 'clsx';
import { TrashIcon } from '@heroicons/react/24/outline';
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import { useAS } from '../../store';
import { buildEntryHeaderId } from '../../renderer/entryDom';
import { withLinkFlyover } from '../../renderer/linkFlyover';
import {
  BUTTON_CLASS_RED,
  ENTRY_CONTENT_AREA,
  ENTRY_HEADER_EXPANDED,
  ENTRY_HEADER_ROW,
  ENTRY_HIGHLIGHTED,
  ENTRY_OUTER,
  ENTRY_OUTER_EXPANDED,
  HOVER_REVEAL,
} from '../../renderer/styles';
import FileTypeIcon from '../FileTypeIcon';
import BrokenLinkBadge from '../BrokenLinkBadge';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { useDelete } from './common';

interface BrokenLinkEntryProps {
  /** A FileEntry with `isBrokenLink` set. */
  entry: FileEntry;
  /** Called after the link has been deleted. */
  onDelete: () => void;
}

/**
 * Browse-view row for a broken symbolic link (its target no longer exists), used
 * in place of the typed entry components in the folder listing, in single-file
 * mode and among attachments. There is nothing to show, open or edit, so the row
 * offers only Delete: no hamburger menu, rename, selection, drag or drop target,
 * and no content. Its body is a red "Symlink Target not found" notice naming the
 * missing target.
 *
 * See: (USER_GUIDE.md#broken-links)
 */
function BrokenLinkEntry({ entry, onDelete }: BrokenLinkEntryProps) {
  const rootPath = useAS(s => s.rootPath);
  const isHighlighted = useAS(s => s.highlightItem === entry.path);
  const del = useDelete({ path: entry.path, onDelete });
  const linkLine = withLinkFlyover(undefined, entry.linkTarget, rootPath);

  return (
    <div
      data-testid="broken-link-entry"
      className={clsx(ENTRY_OUTER, ENTRY_OUTER_EXPANDED, isHighlighted && ENTRY_HIGHLIGHTED)}
    >
      <div className={clsx(ENTRY_HEADER_ROW, ENTRY_HEADER_EXPANDED)}>
        <span className="flex-shrink-0">
          <FileTypeIcon fileName={entry.name} />
        </span>
        <span
          id={buildEntryHeaderId(entry.path)}
          className="text-slate-300 font-medium flex-1 min-w-0 flex items-center gap-1.5"
          title={linkLine}
        >
          <span className="truncate">{entry.name}</span>
          <BrokenLinkBadge />
        </span>
        <div className={`${HOVER_REVEAL} flex items-center gap-1 -mr-1.5`}>
          <button
            type="button"
            onClick={del.handleDeleteClick}
            disabled={del.deleting}
            className={BUTTON_CLASS_RED}
            title="Delete"
            data-testid="entry-delete-button"
          >
            <TrashIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className={ENTRY_CONTENT_AREA}>
        <div className="flex items-center gap-3 rounded-md border border-red-500/60 bg-red-950/40 p-3">
          <ExclamationTriangleIcon className="w-8 h-8 shrink-0 text-red-500" />
          <div className="min-w-0">
            <div className="font-medium text-red-200">Symlink Target not found</div>
            {linkLine && <div className="text-sm text-red-300/80 break-all">{linkLine}</div>}
          </div>
        </div>
      </div>
      {del.showDeleteConfirm && (
        <ConfirmDialog
          message={`Delete the broken link "${entry.name}"?`}
          onConfirm={del.handleDeleteConfirm}
          onCancel={del.handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default BrokenLinkEntry;
