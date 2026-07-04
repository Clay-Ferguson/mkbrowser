import { useState } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS, DLG_FOOTER_CLASS } from '../../renderer/styles';

interface NewCalendarFileDialogProps {
  initialFileName: string;
  onCreate: (fileName: string) => void;
  onCancel: () => void;
}

/**
 * Single-field dialog for naming a new calendar item file. Prefilled with
 * `initialFileName` (the caller supplies the calendar-appropriate default) and
 * confirms with a non-empty, trimmed name.
 */
function NewCalendarFileDialog({ initialFileName, onCreate, onCancel }: NewCalendarFileDialogProps) {
  const [fileName, setFileName] = useState(initialFileName);

  const handleCreate = () => {
    const trimmed = fileName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  };

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    handleCreate();
  };

  return (
    <Dialog
      title="New Calendar Item"
      onClose={onCancel}
      className="w-full max-w-md"
      testId="new-calendar-item-dlg"
    >
      <form className="p-6" onSubmit={handleSubmit}>
        <div className="mb-6">
          <label className={DLG_LABEL_CLASS}>File Name</label>
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className={DLG_INPUT_CLASS}
            placeholder="File name..."
            data-testid="new-calendar-item-dlg-filename"
          />
        </div>

        <div className={DLG_FOOTER_CLASS}>
          <button type="button" onClick={onCancel} className={BUTTON_CLASS_DLG_CANCEL}>
            Cancel
          </button>
          <button type="submit" data-testid="new-calendar-item-dlg-create" disabled={!fileName.trim()} className={BUTTON_CLASS_DLG_BLUE}>
            Create File
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default NewCalendarFileDialog;
