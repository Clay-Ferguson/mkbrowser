import { memo } from 'react';
import type { FileEntry } from '../../global';
import FolderEntry from '../entries/FolderEntry';
import MarkdownEntry from '../entries/MarkdownEntry';
import GenericEntry from '../entries/GenericEntry';
import ImageEntry from '../entries/ImageEntry';
import TextEntry from '../entries/TextEntry';
import PDFEntry from '../entries/PDFEntry';
import ErrorBoundary from '../ErrorBoundary';
import IndexInsertBar from '../IndexInsertBar';
import AttachFolderContents from './AttachFolderContents';
import { useAS } from '../../store';
import { isImageFile, isTextFile, isPdfFile } from '../../shared/fileTypes';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';

interface BrowseEntryRowProps {
  entry: FileEntry;
  /** Position in the sorted listing; the IndexInsertBar below this row inserts at `index + 1`. */
  index: number;
  isFirst: boolean;
  isLast: boolean;
  /** Document Mode (the folder has an .INDEX.yaml): enables the move handlers. */
  hasIndexFile: boolean;
  /**
   * For an attach folder listed directly after the file that owns it, that
   * file's path: the folder is indented under it and shown only while the
   * owner is expanded. Null for every other row.
   */
  ownerPath: string | null;
  /** Show an IndexInsertBar below this row (Document Mode, next row is not an attach folder). */
  showInsertBarAfter: boolean;
  allImages: FileEntry[];
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
 * One row of BrowseView's folder listing: the typed entry component for
 * `entry`, the attach-folder contents under an expanded owner, and (in
 * Document Mode) the IndexInsertBar that follows it.
 *
 * A module-level component, rather than inline JSX in BrowseView's `.map()`,
 * because the React Compiler doesn't memoize per `.map()` iteration: inlined,
 * every BrowseView render rebuilt every row's move/insert closures and
 * re-rendered every entry. Here each row builds its own handlers from stable
 * props, and memo() (below) skips rows whose props didn't change.
 */
function BrowseEntryRow({
  entry, index, isFirst, isLast, hasIndexFile, ownerPath, showInsertBarAfter, allImages,
  onNavigate, onRename, onDelete, onPasteIntoFolder,
  onPasteAsAttachment, onPasteClipboardAsAttachment, onAttachFromFile, onCreateAttachment,
  onMoveEntry, onMoveEntryToEdge, onInsertFileAt, onInsertFolderAt,
}: BrowseEntryRowProps) {
  // Selected here rather than passed down, so expanding or collapsing a file
  // re-renders only the attach-folder row beneath it, not the whole listing.
  const parentExpanded = useAS(s => ownerPath === null || (s.items.get(ownerPath)?.isExpanded ?? false));

  const moveUp = hasIndexFile && !isFirst ? () => onMoveEntry(entry.name, 'up') : undefined;
  const moveDown = hasIndexFile && !isLast ? () => onMoveEntry(entry.name, 'down') : undefined;
  const moveToTop = hasIndexFile && !isFirst ? () => onMoveEntryToEdge(entry.name, 'top') : undefined;
  const moveToBottom = hasIndexFile && !isLast ? () => onMoveEntryToEdge(entry.name, 'bottom') : undefined;
  const isAttach = entry.name.endsWith(ATTACH_SUFFIX);
  const indentFolder = ownerPath !== null;
  // The three attach menu items are identical on every file type — the
  // `<file>.attach` convention is keyed off the whole filename, so an image or a
  // PDF owns attachments exactly as a Markdown file does. Spread as one group so
  // the listing can't drift into offering them on some rows but not others.
  const attachMenuHandlers = { onPasteClipboardAsAttachment, onAttachFromFile, onCreateAttachment };

  return (
    <div>
      <ErrorBoundary label={entry.name} resetKeys={[entry.modifiedTime]}>
        {entry.isDirectory ? (
          <>
            {/* Folders are shown whenever their parent is expanded (attach folders included). */}
            {parentExpanded && (
              <FolderEntry entry={entry} onNavigate={onNavigate} onRename={onRename} onDelete={onDelete} onPasteIntoFolder={onPasteIntoFolder} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} isAttachFolder={isAttach} indentFolder={indentFolder} />
            )}
            {isAttach && entry.attachments && parentExpanded && (
              <AttachFolderContents
                entries={entry.attachments}
                level={1}
                onNavigate={onNavigate}
                onRename={onRename}
                onDelete={onDelete}
                onPasteIntoFolder={onPasteIntoFolder}
              />
            )}
          </>
        ) : entry.isMarkdown ? (
          <MarkdownEntry entry={entry} view="browser" onRename={onRename} onDelete={onDelete} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} onPasteAsAttachment={onPasteAsAttachment} {...attachMenuHandlers} documentMode={hasIndexFile} />
        ) : isImageFile(entry.name) ? (
          <ImageEntry entry={entry} allImages={allImages} onRename={onRename} onDelete={onDelete} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} {...attachMenuHandlers} />
        ) : isTextFile(entry.name) ? (
          <TextEntry entry={entry} onRename={onRename} onDelete={onDelete} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} {...attachMenuHandlers} />
        ) : isPdfFile(entry.name) ? (
          <PDFEntry entry={entry} onRename={onRename} onDelete={onDelete} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} {...attachMenuHandlers} />
        ) : (
          <GenericEntry entry={entry} onRename={onRename} onDelete={onDelete} onMoveUp={moveUp} onMoveDown={moveDown} onMoveToTop={moveToTop} onMoveToBottom={moveToBottom} {...attachMenuHandlers} />
        )}
      </ErrorBoundary>
      {showInsertBarAfter && (
        <IndexInsertBar onInsertFile={() => onInsertFileAt(index + 1)} onInsertFolder={() => onInsertFolderAt(index + 1)} />
      )}
    </div>
  );
}

// memo() is justified under the DEVELOPER_GUIDE rule (one per row of a large
// .map() list) because every prop is stable: `entry` keeps its identity until
// the listing reloads, the flags are primitives, `allImages` changes only with
// the listing, and every handler is compiled in BrowseView/App on inputs that
// change only on navigation or a listing change. So a BrowseView render for
// anything else (selection summary, menus, dialogs) skips every row.
export default memo(BrowseEntryRow);
