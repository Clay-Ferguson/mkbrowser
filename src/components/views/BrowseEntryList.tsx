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
}

/**
 * BrowseView's folder listing: the loading and empty states, and otherwise
 * the current folder's entries — sorted by {@link sortListing}, cut entries
 * hidden — as one BrowseEntryRow each, plus the leading IndexInsertBar in
 * Document Mode.
 */
function BrowseEntryList({
  onNavigate, onRename, onDelete, onPasteIntoFolder,
  onPasteAsAttachment, onPasteClipboardAsAttachment, onAttachFromFile, onCreateAttachment,
  onMoveEntry, onMoveEntryToEdge, onInsertFileAt, onInsertFolderAt,
}: BrowseEntryListProps) {
  // Deliberately no `useAS(s => s.items)`: the Map is replaced on every items
  // write (each debounced keystroke in an inline editor), and subscribing to it
  // re-rendered the whole listing. These are narrow derived values instead.
  const entries = useAS(s => s.currentEntries);
  const loading = useAS(s => s.entriesLoading);
  const hasIndexFile = useAS(s => s.hasIndexFile);
  const sortOrder = useAS(s => s.settings.sortOrder);
  const foldersOnTop = useAS(s => s.settings.foldersOnTop);
  const cutPaths = useAS(s => getCutPaths(s.items));
  const times = useAS(useShallow(s => listingTimes(s.items, entries)));

  const sortedEntries = sortListing(entries, times, cutPaths, hasIndexFile, sortOrder, foldersOnTop);
  const allImages = sortedEntries.filter((entry) => !entry.isDirectory && isImageFile(entry.name));

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
    <div className={hasIndexFile ? 'pr-12' : '[&>div+div]:-mt-px'}>
      {hasIndexFile && !sortedEntries[0]?.name.endsWith(ATTACH_SUFFIX) && (
        <IndexInsertBar onInsertFile={() => onInsertFileAt(0)} onInsertFolder={() => onInsertFolderAt(0)} />
      )}
      {sortedEntries.map((entry, idx) => {
        const prevEntry = sortedEntries[idx - 1];
        // An attach folder listed right after the file that owns it is
        // indented under that file and shown only while it is expanded.
        const isOwnedAttach = entry.name.endsWith(ATTACH_SUFFIX) && prevEntry?.name === entry.name.slice(0, -ATTACH_SUFFIX.length);
        return (
          <BrowseEntryRow
            key={entry.path}
            entry={entry}
            index={idx}
            isFirst={idx === 0}
            isLast={idx === sortedEntries.length - 1}
            hasIndexFile={hasIndexFile}
            ownerPath={isOwnedAttach && prevEntry ? prevEntry.path : null}
            showInsertBarAfter={hasIndexFile && !sortedEntries[idx + 1]?.name.endsWith(ATTACH_SUFFIX)}
            allImages={!entry.isDirectory && isImageFile(entry.name) ? allImages : NO_IMAGES}
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
          />
        );
      })}
    </div>
  );
}

export default BrowseEntryList;
