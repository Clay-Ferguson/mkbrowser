import { useState } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../renderer/styles';

interface RenameDialogProps {
  currentName: string;
  isDirectory: boolean;
  onRename: (newName: string) => void;
  onCancel: () => void;
}

/**
 * Dialog for renaming a file or folder. The label and title adapt to
 * `isDirectory`. A blank or unchanged name is treated as a no-op that simply
 * dismisses via onCancel (see below) rather than calling onRename.
 */
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

  const handleSubmit = (e: React.SubmitEvent) => {
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
          data-testid="rename-dialog-input"
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="rename-dialog-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isNoOp}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="rename-dialog-submit-button"
          >
            Rename
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default RenameDialog;
