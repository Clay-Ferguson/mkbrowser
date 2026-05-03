import { DocumentPlusIcon, FolderPlusIcon } from '@heroicons/react/24/outline';

interface IndexInsertBarProps {
  onInsertFile: () => void;
  onInsertFolder: () => void;
}

function IndexInsertBar({ onInsertFile, onInsertFolder }: IndexInsertBarProps) {
  return (
    <div className="flex justify-center gap-2 py-0">
      <button
        data-testid="insert-file-here"
        onClick={onInsertFile}
        className="p-2 text-blue-400 hover:text-blue-300 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
        title="Insert file here"
      >
        <DocumentPlusIcon className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
      </button>
      <button
        data-testid="insert-folder-here"
        onClick={onInsertFolder}
        className="p-2 text-amber-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
        title="Insert folder here"
      >
        <FolderPlusIcon className="w-5 h-5 text-amber-500 group-hover:text-amber-400" />
      </button>
    </div>
  );
}

export default IndexInsertBar;
