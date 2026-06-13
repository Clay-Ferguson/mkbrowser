import { useState } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS, DLG_FOOTER_CLASS } from '../../utils/styles';

interface NewCalendarFileDialogProps {
  initialFileName: string;
  onCreate: (fileName: string) => void;
  onCancel: () => void;
}

function NewCalendarFileDialog({ initialFileName, onCreate, onCancel }: NewCalendarFileDialogProps) {
  const [fileName, setFileName] = useState(initialFileName);

  const handleCreate = () => {
    const trimmed = fileName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Dialog
      title="New Calendar Item"
      onClose={onCancel}
      className="w-full max-w-md"
      testId="new-calendar-item-dlg"
    >
      <div className="p-6">
        <div className="mb-6">
          <label className={DLG_LABEL_CLASS}>File Name</label>
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            onKeyDown={handleKeyDown}
            className={DLG_INPUT_CLASS}
            placeholder="File name..."
            data-testid="new-calendar-item-dlg-filename"
          />
        </div>

        <div className={DLG_FOOTER_CLASS}>
          <button type="button" onClick={onCancel} className={BUTTON_CLASS_DLG_CANCEL}>
            Cancel
          </button>
          <button type="button" data-testid="new-calendar-item-dlg-create" onClick={handleCreate} disabled={!fileName.trim()} className={BUTTON_CLASS_DLG_BLUE}>
            Create File
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default NewCalendarFileDialog;
