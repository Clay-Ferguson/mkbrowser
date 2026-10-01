import { useShallow } from 'zustand/react/shallow';
import { FolderIcon } from '@heroicons/react/24/outline';
import IndexInsertBar from '../IndexInsertBar';
import BrowseEntryRow from './BrowseEntryRow';
import { useAS, getCutPaths } from '../../store';
import { isImageFile } from '../../shared/fileTypes';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';
import { listingTimes, sortListing } from './browseListing';
import type { FileEntry } from '../../global';

// Shared by every non-image row: `allImages` is rebuilt whenever the sorted
// listing is (a cut/uncut, a saved file's new times), and handing that fresh
// array to every memo()'d BrowseEntryRow re-rendered the whole listing. Only
// image rows read it (for the fullscreen viewer's prev/next).
const NO_IMAGES: FileEntry[] = [];

// Container classes for the image grid (the `imageCols` setting), spelled out
// as static strings so Tailwind's scanner sees them. Non-image rows span the
// full width (BrowseEntryRow's `spanFull`), so CSS grid auto-placement starts
// every run of images at column 1 and gives every other entry its own row. Only
// adjacent full-width rows overlap by 1px (the single-column listing's border
// collapse); image cells are spaced by the column gap and their own vertical
// padding instead, so side-by-side cells stay aligned.
const GRID_CLASS_BASE = 'grid items-start gap-x-2 [&>.col-span-full+.col-span-full]:-mt-px [&>div:not(.col-span-full)]:py-1';
const GRID_COLS_CLASS: Record<2 | 3 | 4, string> = {
  2: `${GRID_CLASS_BASE} grid-cols-2`,
  3: `${GRID_CLASS_BASE} grid-cols-3`,
  4: `${GRID_CLASS_BASE} grid-cols-4`,
};

interface BrowseEntryListProps {
  onNavigate: (path: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onPasteIntoFolder: (folderPath: string) => void;
  onPasteAsAttachment: (filePath: string) => void;
  onPasteClipboardAsAttachment: (filePath: string) => void;
  onAttachFromFile: (filePath: string) => void;
  onCreateAttachment: (filePath: string) => void;
  onMoveEntry: (name: string, direction: 'up' | 'down') => void;
  onMoveEntryToEdge: (name: string, edge: 'top' | 'bottom') => void;
  onInsertFileAt: (insertIndex: number) => void;
  onInsertFolderAt: (insertIndex: number) => void;
  onPasteAt: (insertIndex: number) => void;
}

/**
 * BrowseView's folder listing: the loading and empty states, and otherwise
 * the current folder's entries — sorted by {@link sortListing}, cut entries
 * hidden — as one BrowseEntryRow each, plus the leading IndexInsertBar in
 * Document Mode. With `imageCols > 1` (outside Document Mode) the list is a CSS
 * grid in which images sit side by side and every other entry is full-width.
 */
function BrowseEntryList({
  onNavigate, onRename, onDelete, onPasteIntoFolder,
  onPasteAsAttachment, onPasteClipboardAsAttachment, onAttachFromFile, onCreateAttachment,
  onMoveEntry, onMoveEntryToEdge, onInsertFileAt, onInsertFolderAt, onPasteAt,
}: BrowseEntryListProps) {
  // Deliberately no `useAS(s => s.items)`: the Map is replaced on every items
  // write (each debounced keystroke in an inline editor), and subscribing to it
  // re-rendered the whole listing. These are narrow derived values instead.
  const entries = useAS(s => s.currentEntries);
  const loading = useAS(s => s.entriesLoading);
  const hasIndexFile = useAS(s => s.hasIndexFile);
  const sortOrder = useAS(s => s.settings.sortOrder);
  const foldersOnTop = useAS(s => s.settings.foldersOnTop);
  const imageCols = useAS(s => s.settings.imageCols);
  const cutPaths = useAS(s => getCutPaths(s.items));
  const times = useAS(useShallow(s => listingTimes(s.items, entries)));

  const sortedEntries = sortListing(entries, times, cutPaths, hasIndexFile, sortOrder, foldersOnTop);
  const allImages = sortedEntries.filter((entry) => !entry.isDirectory && isImageFile(entry.name));
  // Offered whenever anything is cut — including items cut from this same
  // document, where the paste moves them to that position (a reorder).
  const showPasteHere = hasIndexFile && cutPaths.size > 0;
  // Document Mode always keeps the single-column layout (insert bars and the
  // move gutter sit between every row).
  const gridActive = imageCols > 1 && !hasIndexFile;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (sortedEntries.length === 0) {
    return (
      <div className="text-center py-12">
        <FolderIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
        <p className="text-slate-400">This folder is empty</p>
      </div>
    );
  }

  // Note: The 'div+div' stuff below is: Adjacent sibling divs overlap by 1px so neighboring borders collapse into a single line.
  // A single unified branch is used (rather than a `hasIndexFile ? A : B` ternary) so the outer element stays a stable
  // <div> when hasIndexFile flips on load — that lets React reconcile the keyed children instead of unmounting/remounting
  // the whole entry list (the remount storm was tripping React's max-update-depth). Index-only bits (move handlers,
  // IndexInsertBars, attach-folder gating) are computed conditionally inside BrowseEntryRow.
  return (
    // The gutter widens while the insert bars carry a third (paste) button.
    <div className={gridActive ? GRID_COLS_CLASS[imageCols as 2 | 3 | 4] : hasIndexFile ? (showPasteHere ? 'pr-20' : 'pr-12') : '[&>div+div]:-mt-px'}>
      {hasIndexFile && !sortedEntries[0]?.name.endsWith(ATTACH_SUFFIX) && (
        <IndexInsertBar
          onInsertFile={() => onInsertFileAt(0)}
          onInsertFolder={() => onInsertFolderAt(0)}
          onPaste={showPasteHere ? () => onPasteAt(0) : undefined}
        />
      )}
      {sortedEntries.map((entry, idx) => {
        const prevEntry = sortedEntries[idx - 1];
        // An attach folder listed right after the file that owns it is
        // indented under that file and shown only while it is expanded.
        const isOwnedAttach = entry.name.endsWith(ATTACH_SUFFIX) && prevEntry?.name === entry.name.slice(0, -ATTACH_SUFFIX.length);
        const isImage = !entry.isDirectory && isImageFile(entry.name);
        // In the grid, an image's attach folder would be a full-width row that
        // breaks the image run (and, even collapsed, an empty wrapper that still
        // takes a grid cell), so it isn't rendered; the image notes it instead.
        if (gridActive && isOwnedAttach && prevEntry && !prevEntry.isDirectory && isImageFile(prevEntry.name)) {
          return null;
        }
        const nextEntry = sortedEntries[idx + 1];
        const attachmentsHidden = gridActive && isImage && nextEntry?.name === `${entry.name}${ATTACH_SUFFIX}`;
        return (
          <BrowseEntryRow
            key={entry.path}
            entry={entry}
            index={idx}
            isFirst={idx === 0}
            isLast={idx === sortedEntries.length - 1}
            hasIndexFile={hasIndexFile}
            ownerPath={isOwnedAttach && prevEntry ? prevEntry.path : null}
            showInsertBarAfter={hasIndexFile && !nextEntry?.name.endsWith(ATTACH_SUFFIX)}
            showPasteHere={showPasteHere}
            spanFull={gridActive && !isImage}
            attachmentsHidden={attachmentsHidden}
            allImages={isImage ? allImages : NO_IMAGES}
            onNavigate={onNavigate}
            onRename={onRename}
            onDelete={onDelete}
            onPasteIntoFolder={onPasteIntoFolder}
            onPasteAsAttachment={onPasteAsAttachment}
            onPasteClipboardAsAttachment={onPasteClipboardAsAttachment}
            onAttachFromFile={onAttachFromFile}
            onCreateAttachment={onCreateAttachment}
            onMoveEntry={onMoveEntry}
            onMoveEntryToEdge={onMoveEntryToEdge}
            onInsertFileAt={onInsertFileAt}
            onInsertFolderAt={onInsertFolderAt}
            onPasteAt={onPasteAt}
          />
        );
      })}
    </div>
  );
}

export default BrowseEntryList;
