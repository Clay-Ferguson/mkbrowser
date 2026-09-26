import { DocumentIcon } from '@heroicons/react/24/outline';
import {
  useEntry,
  EntryActionBar,
  EntryShell,
  bindAttachMenu,
  type BaseEntryProps,
  type AttachMenuProps,
} from './common';
import { toggleItemExpanded } from '../../store';

type GenericEntryProps = BaseEntryProps & AttachMenuProps;

/**
 * Entry component for files with no dedicated renderer (not Markdown, text, or image).
 * Renders a header row with rename, bookmark, delete, and move actions. The entry does
 * not expand — clicking the name has no effect beyond the hover action bar.
 */
function GenericEntry(props: GenericEntryProps) {
  const { entry, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false } = props;
  const { core, rename, del } = useEntry(props);
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  const handleToggleExpanded = () => toggleItemExpanded(entry.path);

  return (
    <EntryShell
      entry={entry}
      icon={<DocumentIcon className="w-5 h-5 text-slate-300" />}
      isAttachment={isAttachment}
      isHighlighted={isHighlighted}
      isExpanded={isExpanded}
      isSelected={isSelected}
      isRenaming={isRenaming}
      rename={rename}
      del={del}
      onToggleExpanded={handleToggleExpanded}
      expandedAffectsHeader={false}
      headerRight={
        <EntryActionBar
          path={entry.path}
          isBookmarked={isBookmarked}
          deleting={del.deleting}
          onRenameClick={rename.handleRenameClick}
          onDeleteClick={del.handleDeleteClick}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onMoveToTop={onMoveToTop}
          onMoveToBottom={onMoveToBottom}
          className="-mr-1.5"
          isAttachment={isAttachment}
          {...bindAttachMenu(entry.path, props)}
        />
      }
    />
  );
}

export default GenericEntry;
