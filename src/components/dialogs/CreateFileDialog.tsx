import { useState } from 'react';
import { generateTimestampFileName } from '../../utils/timeUtil';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../utils/styles';

interface CreateFileDialogProps {
  defaultName?: string;
  onCreate: (fileName: string) => void;
  onCancel: () => void;
}

function CreateFileDialog({ defaultName = '', onCreate, onCancel }: CreateFileDialogProps) {
  const [fileName, setFileName] = useState(defaultName);

  const handleCreate = () => {
    const trimmedName = fileName.trim();
    const baseName = trimmedName || generateTimestampFileName().replace(/\.md$/, '');
    const normalizedName = baseName.includes('.') ? baseName : `${baseName}.md`;
    onCreate(normalizedName);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleCreate();
  };

  return (
    <Dialog title="Create new file" onClose={onCancel} className="w-full max-w-md">
      <form className="p-6" onSubmit={handleSubmit}>
        <label className={DLG_LABEL_CLASS}>File name</label>
        <input
          type="text"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          className={DLG_INPUT_CLASS}
          placeholder="Leave blank for YYYY-MM-DD--HH-MM-SS.md"
          data-testid="create-file-dialog-input"
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
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="create-file-dialog-create-button"
          >
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default CreateFileDialog;
