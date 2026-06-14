import { useState } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS, DLG_FOOTER_CLASS } from '../../utils/styles';

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

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSave();
  };

  return (
    <Dialog
      title={initialName !== undefined ? 'Edit Bookmark' : 'Add Bookmark'}
      onClose={onCancel}
      className="w-full max-w-md"
    >
      <form className="p-6" onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1">Path</label>
          <p className="text-sm text-slate-300 bg-slate-900 px-3 py-2 rounded border border-slate-700 break-all">
            {path}
          </p>
        </div>

        <div className="mb-6">
          <label className={DLG_LABEL_CLASS}>Display Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={DLG_INPUT_CLASS}
            placeholder="Bookmark name..."
          />
        </div>

        <div className={DLG_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default BookmarkDialog;
