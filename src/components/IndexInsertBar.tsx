import { DocumentPlusIcon, FolderPlusIcon } from '@heroicons/react/24/outline';

interface IndexInsertBarProps {
  onInsertFile: () => void;
  onInsertFolder: () => void;
}

/**
 * A pair of insert-here buttons (file and folder) that float in the right-hand
 * gutter at a specific index position in the entry list.
 *
 * Uses a zero-height wrapper so the bar occupies no vertical space in the layout;
 * the buttons are positioned absolutely into the gutter column reserved by the
 * entry list's padding.
 */
function IndexInsertBar({ onInsertFile, onInsertFolder }: IndexInsertBarProps) {
  return (
    <div className="relative h-0">
      <div className="absolute top-0 right-0 translate-x-full flex flex-row gap-1">
        <button
          type="button"
          data-testid="insert-file-here"
          onClick={onInsertFile}
          className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          title="Insert file here"
        >
          <DocumentPlusIcon className="w-5 h-5" />
        </button>
        <button
          type="button"
          data-testid="insert-folder-here"
          onClick={onInsertFolder}
          className="p-1.5 text-amber-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          title="Insert folder here"
        >
          <FolderPlusIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export default IndexInsertBar;
