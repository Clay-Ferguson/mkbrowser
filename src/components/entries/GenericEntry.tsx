import { DocumentIcon } from '@heroicons/react/24/outline';
import {
  useEntryCore,
  useRename,
  useDelete,
  useToggleExpanded,
  EntryActionBar,
  EntryShell,
  type BaseEntryProps,
} from './common';

type GenericEntryProps = BaseEntryProps;

function GenericEntry({ entry, onRename, onDelete, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false }: GenericEntryProps) {
  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
  } = useEntryCore({ path: entry.path, name: entry.name });

  const rename = useRename({
    path: entry.path,
    name: entry.name,
    isRenaming,
    onRename,
    onSaveSettings,
  });

  const del = useDelete({
    path: entry.path,
    onDelete,
  });

  const handleToggleExpanded = useToggleExpanded(entry.path);

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
          onSaveSettings={onSaveSettings}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onMoveToTop={onMoveToTop}
          onMoveToBottom={onMoveToBottom}
          className="-mr-1.5"
          isAttachment={isAttachment}
        />
      }
    />
  );
}

export default GenericEntry;
