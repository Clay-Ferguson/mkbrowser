import { useState } from 'react';
import { generateTimestampFolderName } from '../../utils/timeUtil';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../utils/styles';

interface CreateFolderDialogProps {
  defaultName?: string;
  onCreate: (folderName: string) => void;
  onCancel: () => void;
}

function CreateFolderDialog({ defaultName = '', onCreate, onCancel }: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState(defaultName);

  const handleCreate = () => {
    const trimmedName = folderName.trim();
    const finalName = trimmedName || generateTimestampFolderName();
    onCreate(finalName);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Dialog title="Create new folder" onClose={onCancel} className="w-full max-w-md">
      <div className="p-6">
        <label className={DLG_LABEL_CLASS}>Folder name</label>
        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={handleKeyDown}
          className={DLG_INPUT_CLASS}
          placeholder="Leave blank for YYYY-MM-DD--HH-MM-SS"
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
            onClick={handleCreate}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Create
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default CreateFolderDialog;
