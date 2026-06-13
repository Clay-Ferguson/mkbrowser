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

  const handleRename = () => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === currentName) {
      onCancel();
      return;
    }
    onRename(trimmedName);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRename();
    }
  };

  return (
    <Dialog title={`Rename ${itemLabel}`} onClose={onCancel} className="w-full max-w-md">
      <div className="p-6">
        <label className={DLG_LABEL_CLASS}>{isDirectory ? 'Folder name' : 'File name'}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
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
            type="button"
            onClick={handleRename}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Rename
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default RenameDialog;
