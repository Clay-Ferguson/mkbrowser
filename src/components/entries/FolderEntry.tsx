import { useState } from 'react';
import { ClipboardDocumentIcon, FolderIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import { useHasCutItems, useItem, useHasIndexFile, deleteItems } from '../../store';
import { buildEntryHeaderId } from '../../utils/entryDom';
import {
  makeEntryDragStartHandler,
  ENTRY_DND_MIME,
  parseDragPayload,
  canDropInto,
  moveEntryIntoFolder,
  reloadExpandedTreeFolder,
} from '../../utils/dragAndDrop';
import { BUTTON_CLASS_ICON_SOLID_BLUE, ENTRY_HIGHLIGHTED } from '../../utils/styles';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import {
  useEntry,
  EntryActionBar,
  RenameInput,
  SelectionCheckbox,
} from './common';
import type { BaseEntryProps } from './common';

interface FolderEntryProps extends BaseEntryProps {
  onNavigate: (path: string) => void;
  onPasteIntoFolder?: (folderPath: string) => void;
  onRefreshDirectory?: () => void;
  isAttachFolder?: boolean;
  indentFolder?: boolean;
}

function FolderEntry(props: FolderEntryProps) {
  const { entry, onNavigate, onSaveSettings, onPasteIntoFolder, onRefreshDirectory, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachFolder, indentFolder } = props;
  // Folders select the full name on rename; they don't use isExpanded.
  const { core, rename, del } = useEntry(props, { selectFullName: true });
  const { isRenaming, isSelected, isHighlighted, isBookmarked } = core;

  const hasCutItems = useHasCutItems();
  const item = useItem(entry.path);
  const hasIndexFile = useHasIndexFile();
  const aiHint = item?.aiHint;

  const handleInputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Drop target: accept a file/folder dragged from the IndexTreeView and move it into this folder.
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(ENTRY_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const payload = parseDragPayload(e.dataTransfer.getData(ENTRY_DND_MIME));
    if (!payload || !canDropInto(payload, entry.path)) return;

    const result = await moveEntryIntoFolder(payload, entry.path);
    if (!result.success) return;

    // Drop the moved item from the store so the browse view stops showing it.
    deleteItems([payload.path]);

    // Refresh the source folder in the tree if it is expanded (this folder is collapsed
    // in the tree by definition while being browsed, so only the source can need a reload).
    await reloadExpandedTreeFolder(result.sourceFolder);

    // Refresh the browse view in case the moved item came from the folder being viewed.
    onRefreshDirectory?.();
  };

  return (
    <div className={`${indentFolder ? '' : 'bg-slate-800'} group ${isHighlighted ? ENTRY_HIGHLIGHTED : ''}`} style={indentFolder ? { paddingLeft: '32px' } : undefined}>
      <div
        onClick={() => !isRenaming && onNavigate(entry.path)}
        onContextMenu={(e) => { e.preventDefault(); if (!isRenaming) rename.handleRenameClick(e); }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e)}
        className={`w-full flex items-center gap-3 px-2 py-0 ${isDragOver ? 'bg-blue-600/60 outline outline-1 outline-blue-400' : isHighlighted ? 'bg-blue-800/50' : 'bg-blue-800/50 hover:bg-blue-700/70'} transition-colors text-left cursor-pointer`}
      >
        {(
          <SelectionCheckbox
            path={entry.path}
            name={entry.name}
            isSelected={isSelected}
            onClick={handleCheckboxClick}
          />
        )}
        {/* Entry Icon */}
        <span
          className="flex-shrink-0 cursor-grab"
          draggable
          onDragStart={makeEntryDragStartHandler({ path: entry.path, name: entry.name, isDirectory: true })}
        >
          <FolderIcon className="w-5 h-5 text-amber-500" />
        </span>
        {isRenaming ? (
          <RenameInput
            ref={rename.inputRef}
            path={entry.path}
            name={entry.name}
            value={rename.newName}
            onChange={rename.setNewName}
            onKeyDown={rename.handleKeyDown}
            onBlur={rename.handleSave}
            onClick={handleInputClick}
            disabled={rename.saving}
            className="font-medium"
          />
        ) : (
          <>
            <span id={buildEntryHeaderId(entry.path)} className={`font-medium truncate flex-shrink-0${indentFolder ? ' text-slate-400 italic' : ' text-slate-200'}`}>{indentFolder ? '*.attach' : entry.name}</span>
            {aiHint && (
              <span className="text-slate-400 italic text-sm truncate min-w-0" title={aiHint}>{aiHint}</span>
            )}
            <span className="flex-1" />
          </>
        )}
        {isRenaming ? (
          <div className="flex-shrink-0" />
        ) : (
          <>
            <EntryActionBar
              path={entry.path}
              isBookmarked={isBookmarked}
              isFolder={true}
              deleting={del.deleting}
              onRenameClick={rename.handleRenameClick}
              onDeleteClick={del.handleDeleteClick}
              onSaveSettings={onSaveSettings}
              onMoveUp={isAttachFolder && hasIndexFile ? undefined : onMoveUp}
              onMoveDown={isAttachFolder && hasIndexFile ? undefined : onMoveDown}
              onMoveToTop={isAttachFolder && hasIndexFile ? undefined : onMoveToTop}
              onMoveToBottom={isAttachFolder && hasIndexFile ? undefined : onMoveToBottom}
              className="-mr-1.5"
            />
            {hasCutItems && onPasteIntoFolder && (
              <button
                onClick={(e) => { e.stopPropagation(); onPasteIntoFolder(entry.path); }}
                className={BUTTON_CLASS_ICON_SOLID_BLUE}
                title="Paste cut items into this folder"
                aria-label="Paste cut items into this folder"
              >
                <ClipboardDocumentIcon className="w-4 h-4 text-white" />
              </button>
            )}
          </>
        )}
        {del.showDeleteConfirm && (
          <ConfirmDialog
            message={`Move the folder "${entry.name}" and all its contents to trash?`}
            onConfirm={del.handleDeleteConfirm}
            onCancel={del.handleDeleteCancel}
          />
        )}
      </div>
    </div>
  );
}

export default FolderEntry;
