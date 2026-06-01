import { useEffect, useRef, useState } from 'react';
import { generateTimestampFolderName } from '../../utils/timeUtil';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_CONTAINER, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../utils/styles';

interface CreateFolderDialogProps {
  defaultName?: string;
  onCreate: (folderName: string) => void;
  onCancel: () => void;
}

function CreateFolderDialog({ defaultName = '', onCreate, onCancel }: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = () => {
    const trimmedName = folderName.trim();
    const finalName = trimmedName || generateTimestampFolderName();
    onCreate(finalName);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={DLG_OVERLAY_CLASS}>
      <div className={`${DLG_CONTAINER} w-full max-w-md mx-4 overflow-hidden`}>
        <DlgHeader title="Create new folder" onClose={onCancel} />
        <div className="p-6">
        <label className={DLG_LABEL_CLASS}>Folder name</label>
        <input
          ref={inputRef}
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={handleKeyDown}
          className={DLG_INPUT_CLASS}
          placeholder="Leave blank for YYYY-MM-DD--HH-MM-SS"
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Create
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default CreateFolderDialog;
