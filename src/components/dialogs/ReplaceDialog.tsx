import { useEffect, useRef, useState } from 'react';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_INPUT_CLASS, DLG_LABEL_CLASS, DLG_FOOTER_CLASS } from '../../utils/styles';

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
    <div className={DLG_OVERLAY_CLASS}>
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 w-full max-w-md mx-4 shadow-xl overflow-hidden">
        <DlgHeader title="Replace in Files" onClose={onCancel} />
        <div className="p-6">
        <div className="mb-4">
          <label className={DLG_LABEL_CLASS}>
            Search for
          </label>
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={handleKeyDown}
            className={DLG_INPUT_CLASS}
            placeholder="Text to find..."
          />
        </div>

        <div className="mb-6">
          <label className={DLG_LABEL_CLASS}>
            Replace with
          </label>
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleKeyDown}
            className={DLG_INPUT_CLASS}
            placeholder="Replacement text..."
          />
        </div>

        <p className="text-xs text-slate-500 mb-4">
          Replaces all occurrences in .md and .txt files recursively.
        </p>

        <div className={DLG_FOOTER_CLASS}>
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
