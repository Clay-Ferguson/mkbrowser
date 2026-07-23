import { DocumentTextIcon } from '@heroicons/react/24/outline';
import PdfViewer from '../PdfViewer';
import {
  useEntry,
  useToggleExpanded,
  EntryActionBar,
  EntryShell,
  type BaseEntryProps,
} from './common';

type PDFEntryProps = BaseEntryProps;

/**
 * Entry component for PDF files. Expands to render the document inline via
 * PdfViewer (Chromium's built-in PDF viewer). Collapsed by default so a folder
 * listing doesn't spawn an embed per PDF until one is clicked; in single-file
 * mode BrowseFile's auto-expand effect opens it. Header actions (rename,
 * bookmark, delete, move) mirror the other entry types — the PDF itself is
 * read-only here, so there is no edit path.
 */
function PDFEntry(props: PDFEntryProps) {
  const { entry, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false } = props;
  const { core, rename, del } = useEntry(props);
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  const handleToggleExpanded = useToggleExpanded(entry.path);

  return (
    <EntryShell
      entry={entry}
      icon={<DocumentTextIcon className="w-5 h-5 text-red-400" />}
      isAttachment={isAttachment}
      isHighlighted={isHighlighted}
      isExpanded={isExpanded}
      isSelected={isSelected}
      isRenaming={isRenaming}
      rename={rename}
      del={del}
      onToggleExpanded={handleToggleExpanded}
      nameClassName="text-red-400 truncate flex-1 cursor-pointer no-underline"
      nameTitle={isExpanded ? 'Collapse PDF' : 'Expand PDF'}
      headerRight={
        <EntryActionBar
          path={entry.path}
          isBookmarked={isBookmarked}
          deleting={del.deleting}
          onRenameClick={rename.handleRenameClick}
          onDeleteClick={del.handleDeleteClick}
          onSaveSettings={onSaveSettings}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onMoveToTop={onMoveToTop}
          onMoveToBottom={onMoveToBottom}
          className="-mr-1.5"
          isAttachment={isAttachment}
        />
      }
    >
      <div className="px-4 pb-4">
        <PdfViewer path={entry.path} />
      </div>
    </EntryShell>
  );
}

export default PDFEntry;
