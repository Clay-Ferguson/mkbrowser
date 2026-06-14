import { useState } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../utils/styles';

interface RenameDialogProps {
  currentName: string;
  isDirectory: boolean;
  onRename: (newName: string) => void;
  onCancel: () => void;
}

function RenameDialog({ currentName, isDirectory, onRename, onCancel }: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const itemLabel = isDirectory ? 'folder' : 'file';

  // Empty or unchanged means there's nothing to apply — a no-op, not a user cancel.
  const trimmedName = name.trim();
  const isNoOp = !trimmedName || trimmedName === currentName;

  const handleRename = () => {
    if (isNoOp) {
      // Nothing to rename; just dismiss the dialog.
      onCancel();
      return;
    }
    onRename(trimmedName);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleRename();
  };

  return (
    <Dialog title={`Rename ${itemLabel}`} onClose={onCancel} className="w-full max-w-md">
      <form className="p-6" onSubmit={handleSubmit}>
        <label className={DLG_LABEL_CLASS}>{isDirectory ? 'Folder name' : 'File name'}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={DLG_INPUT_CLASS}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isNoOp}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Rename
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default RenameDialog;
