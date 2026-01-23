import type { FileEntry as FileEntryType } from '../global';

interface FileEntryProps {
  entry: FileEntryType;
}

function FileEntry({ entry }: FileEntryProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg border border-slate-700">
      <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <span className="text-slate-400 truncate">{entry.name}</span>
    </div>
  );
}

export default FileEntry;
