import { useState } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS, DLG_FOOTER_CLASS } from '../../utils/styles';

interface ReplaceDialogProps {
  onReplace: (searchText: string, replaceText: string) => void;
  onCancel: () => void;
}

function ReplaceDialog({ onReplace, onCancel }: ReplaceDialogProps) {
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  const handleReplace = () => {
    if (!searchText.trim()) return;
    onReplace(searchText, replaceText);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleReplace();
  };

  return (
    <Dialog title="Replace in Files" onClose={onCancel} className="w-full max-w-md">
      <form className="p-6" onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className={DLG_LABEL_CLASS}>
            Search for
          </label>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className={DLG_INPUT_CLASS}
            placeholder="Text to find..."
            data-testid="replace-search-input"
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
            className={DLG_INPUT_CLASS}
            placeholder="Replacement text..."
            data-testid="replace-text-input"
          />
        </div>

        <p className="text-xs text-slate-500 mb-4">
          Replaces all occurrences in .md and .txt files recursively.
        </p>

        <div className={DLG_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="replace-dialog-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!searchText.trim()}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="replace-dialog-submit-button"
          >
            Replace
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default ReplaceDialog;
