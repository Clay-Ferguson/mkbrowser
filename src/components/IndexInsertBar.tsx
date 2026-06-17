import { DocumentPlusIcon, FolderPlusIcon } from '@heroicons/react/24/outline';

interface IndexInsertBarProps {
  onInsertFile: () => void;
  onInsertFolder: () => void;
}

function IndexInsertBar({ onInsertFile, onInsertFolder }: IndexInsertBarProps) {
  // A zero-height wrapper keeps the insert point at its correct vertical position
  // in the flow without consuming any vertical space. The buttons are absolutely
  // positioned into the right-hand gutter (reserved by padding on the entry list)
  // and stacked over-under to minimize horizontal footprint.
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
