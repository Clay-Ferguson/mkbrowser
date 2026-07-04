import { useState } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS, DLG_FOOTER_CLASS } from '../../renderer/styles';

interface BookmarkDialogProps {
  path: string;
  isFolder: boolean;
  initialName?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

// Last path segment, tolerant of trailing slashes and either separator.
function basename(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? p;
}

/**
 * Dialog for adding or editing a bookmark's display name (the path itself is
 * fixed and shown read-only). Passing `initialName` puts it in Edit mode — both
 * the title and that prop's presence drive the Add/Edit distinction. When no
 * name is supplied, the default seeds from the path's basename, dropping the
 * extension for files but keeping the full name for folders. Save is blocked
 * while the name is blank.
 */
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

  const handleSubmit = (e: React.SubmitEvent) => {
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
            data-testid="bookmark-name-input"
          />
        </div>

        <div className={DLG_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="bookmark-dialog-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="bookmark-dialog-save-button"
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default BookmarkDialog;
