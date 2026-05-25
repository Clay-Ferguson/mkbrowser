import { useEffect, useRef, useState } from 'react';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE } from '../../utils/styles';

interface ReplaceDialogProps {
  onReplace: (searchText: string, replaceText: string) => void;
  onCancel: () => void;
}

function ReplaceDialog({ onReplace, onCancel }: ReplaceDialogProps) {
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleReplace = () => {
    if (!searchText.trim()) return;
    onReplace(searchText, replaceText);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleReplace();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 w-full max-w-md mx-4 shadow-xl overflow-hidden">
        <DlgHeader title="Replace in Files" onClose={onCancel} />
        <div className="p-6">
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2">
            Search for
          </label>
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
            placeholder="Text to find..."
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm text-slate-400 mb-2">
            Replace with
          </label>
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
            placeholder="Replacement text..."
          />
        </div>

        <p className="text-xs text-slate-500 mb-4">
          Replaces all occurrences in .md and .txt files recursively.
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            onClick={handleReplace}
            disabled={!searchText.trim()}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Replace
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default ReplaceDialog;
