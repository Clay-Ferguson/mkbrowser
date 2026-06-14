import { useState } from 'react';
import Dialog from './Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../../utils/styles';

interface NameInputDialogProps {
  /** Dialog title, e.g. "Create new file". */
  title: string;
  /** Field label, e.g. "File name". */
  label: string;
  /** Input placeholder text. */
  placeholder: string;
  /** Prefilled value for the name field. */
  defaultName?: string;
  /**
   * Turn the raw (untrimmed) field value into the final name passed to onCreate.
   * Owns the per-kind rules: trimming, falling back to a generated name when
   * blank, applying a default extension, etc.
   */
  normalizeName: (raw: string) => string;
  onCreate: (name: string) => void;
  onCancel: () => void;
  /** data-testid for the text input. */
  inputTestId?: string;
  /** data-testid for the Create button. */
  createTestId?: string;
}

/**
 * Single-field "name this thing" creation dialog shared by CreateFileDialog and
 * CreateFolderDialog. The only behavioural difference between callers is how the
 * raw input is turned into a final name, which they supply via `normalizeName`.
 */
function NameInputDialog({
  title,
  label,
  placeholder,
  defaultName = '',
  normalizeName,
  onCreate,
  onCancel,
  inputTestId,
  createTestId,
}: NameInputDialogProps) {
  const [name, setName] = useState(defaultName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(normalizeName(name));
  };

  return (
    <Dialog title={title} onClose={onCancel} className="w-full max-w-md">
      <form className="p-6" onSubmit={handleSubmit}>
        <label className={DLG_LABEL_CLASS}>{label}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={DLG_INPUT_CLASS}
          placeholder={placeholder}
          data-testid={inputTestId}
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
            data-testid={createTestId}
          >
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default NameInputDialog;
