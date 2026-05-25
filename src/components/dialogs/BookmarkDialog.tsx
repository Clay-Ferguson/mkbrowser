import { useEffect, useRef, useState } from 'react';
import DlgHeader from './common/DlgHeader';

interface BookmarkDialogProps {
  path: string;
  isFolder: boolean;
  initialName?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

function basename(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? p;
}

function BookmarkDialog({ path, isFolder, initialName, onSave, onCancel }: BookmarkDialogProps) {
  const base = basename(path);
  const defaultName = initialName ?? (isFolder
    ? base
    : base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base);

  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => e.stopPropagation()}>
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 w-full max-w-md mx-4 shadow-xl overflow-hidden">
        <DlgHeader title={initialName !== undefined ? 'Edit Bookmark' : 'Add Bookmark'} onClose={onCancel} />
        <div className="p-6">
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1">Path</label>
          <p className="text-sm text-slate-300 bg-slate-900 px-3 py-2 rounded border border-slate-700 break-all">
            {path}
          </p>
        </div>

        <div className="mb-6">
          <label className="block text-sm text-slate-400 mb-2">Display Name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
            placeholder="Bookmark name..."
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded transition-colors"
          >
            Save
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default BookmarkDialog;
