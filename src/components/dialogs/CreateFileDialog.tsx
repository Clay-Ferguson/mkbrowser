import { useEffect, useRef, useState } from 'react';
import { generateTimestampFileName } from '../../utils/timeUtil';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_CONTAINER, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../utils/styles';

interface CreateFileDialogProps {
  defaultName?: string;
  onCreate: (fileName: string) => void;
  onCancel: () => void;
}

function CreateFileDialog({ defaultName = '', onCreate, onCancel }: CreateFileDialogProps) {
  const [fileName, setFileName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = () => {
    const trimmedName = fileName.trim();
    const baseName = trimmedName || generateTimestampFileName().replace(/\.md$/, '');
    const normalizedName = baseName.includes('.') ? baseName : `${baseName}.md`;
    onCreate(normalizedName);
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
        <DlgHeader title="Create new file" onClose={onCancel} />
        <div className="p-6">
        <label className={DLG_LABEL_CLASS}>File name</label>
        <input
          ref={inputRef}
          type="text"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          onKeyDown={handleKeyDown}
          className={DLG_INPUT_CLASS}
          placeholder="Leave blank for YYYY-MM-DD--HH-MM-SS.md"
          data-testid="create-file-dialog-input"
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
            data-testid="create-file-dialog-create-button"
          >
            Create
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default CreateFileDialog;
