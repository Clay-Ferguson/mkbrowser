import type { FileEntry } from '../global';

interface FolderEntryProps {
  entry: FileEntry;
  onNavigate: (path: string) => void;
}

function FolderEntry({ entry, onNavigate }: FolderEntryProps) {
  return (
    <button
      onClick={() => onNavigate(entry.path)}
      className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-750 hover:border-slate-600 transition-colors text-left"
    >
      <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
      <span className="text-slate-200 font-medium truncate">{entry.name}</span>
      <svg className="w-4 h-4 text-slate-500 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

export default FolderEntry;
