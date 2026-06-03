import { useEffect, useRef, useState } from 'react';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_CONTAINER, DLG_INPUT_CLASS, DLG_LABEL_CLASS, DLG_FOOTER_CLASS } from '../../utils/styles';

interface NewCalendarFileDialogProps {
  initialFileName: string;
  onCreate: (fileName: string) => void;
  onCancel: () => void;
}

function NewCalendarFileDialog({ initialFileName, onCreate, onCancel }: NewCalendarFileDialogProps) {
  const [fileName, setFileName] = useState(initialFileName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleCreate = () => {
    const trimmed = fileName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div data-testid="new-calendar-item-dlg" className={DLG_OVERLAY_CLASS} onClick={(e) => e.stopPropagation()}>
      <div className={`${DLG_CONTAINER} w-full max-w-md mx-4 overflow-hidden`}>
        <DlgHeader title="New Calendar Item" onClose={onCancel} />
        <div className="p-6">
          <div className="mb-6">
            <label className={DLG_LABEL_CLASS}>File Name</label>
            <input
              ref={inputRef}
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
            <button onClick={onCancel} className={BUTTON_CLASS_DLG_CANCEL}>
              Cancel
            </button>
            <button  data-testid="new-calendar-item-dlg-create" onClick={handleCreate} disabled={!fileName.trim()} className={BUTTON_CLASS_DLG_BLUE}>
              Create File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NewCalendarFileDialog;
