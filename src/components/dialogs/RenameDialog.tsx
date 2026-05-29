import { useEffect, useRef, useState } from 'react';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_CONTAINER, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../utils/styles';

interface RenameDialogProps {
  currentName: string;
  isDirectory: boolean;
  onRename: (newName: string) => void;
  onCancel: () => void;
}

function RenameDialog({ currentName, isDirectory, onRename, onCancel }: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemLabel = isDirectory ? 'folder' : 'file';

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={DLG_OVERLAY_CLASS}>
      <div className={`${DLG_CONTAINER} w-full max-w-md mx-4 overflow-hidden`}>
        <DlgHeader title={`Rename ${itemLabel}`} onClose={onCancel} />
        <div className="p-6">
        <label className={DLG_LABEL_CLASS}>{isDirectory ? 'Folder name' : 'File name'}</label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          className={DLG_INPUT_CLASS}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            onClick={handleRename}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Rename
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default RenameDialog;
