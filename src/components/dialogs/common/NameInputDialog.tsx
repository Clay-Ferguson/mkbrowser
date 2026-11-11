import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from './Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../../renderer/styles';

interface NameInputDialogProps {
  /** Dialog title, e.g. "Create new file". */
  title: string;
  /** Field label, e.g. "File name". */
  label: string;
  /** Input placeholder text. */
  placeholder: string;
  /**
   * Prefilled value for the name field. A later change is adopted (and selected) as long as
   * the user hasn't typed in the field yet — for callers that look the default up
   * asynchronously, like the editor's "Insert link" dialog fetching the page title.
   */
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
  /** Label of the submit button. Default "Create". */
  submitLabel?: string;
  /** Optional explanatory text shown below the input (e.g. the URL a link will point to). */
  note?: string;
  /**
   * Put the caret at the start of the prefilled value instead of selecting it, so typing goes
   * in front of it — for a default that is only a suffix to keep, like the `.png` extension
   * "Create & Paste File" suggests.
   */
  caretAtStart?: boolean;
  /** Extra fields under the name input, e.g. Create & Paste File's "Save in Attachments Folder" checkbox. */
  children?: ReactNode;
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
  submitLabel = 'Create',
  note,
  caretAtStart = false,
  children,
}: NameInputDialogProps) {
  const [name, setName] = useState(defaultName);
  // Whether the user has edited the field; until then a changed defaultName replaces it.
  const [dirty, setDirty] = useState(false);
  const [prevDefaultName, setPrevDefaultName] = useState(defaultName);
  if (defaultName !== prevDefaultName) {
    setPrevDefaultName(defaultName);
    if (!dirty) setName(defaultName);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  // Select an adopted default so typing replaces it, as Dialog does for the initial value —
  // or, with caretAtStart, put the caret in front of it (this runs after Dialog's own mount
  // effect, so it overrides that selection). Only while the field has focus, so a late
  // default never steals it from elsewhere.
  useEffect(() => {
    const input = inputRef.current;
    if (dirty || !input || document.activeElement !== input) return;
    if (caretAtStart) input.setSelectionRange(0, 0);
    else input.select();
  }, [defaultName, dirty, caretAtStart]);
  // The caller keeps this dialog open until its async create finishes, so a
  // double-click (or Enter twice) would otherwise fire a second create for the
  // same name — failing with "already exists" or, racing the first, inserting
  // the name into .INDEX.yaml twice. Editing the name re-arms it, for callers
  // that keep the dialog open on a rejected name (AISettingsView's persona
  // name collision).
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (submitted) return;
    setSubmitted(true);
    onCreate(normalizeName(name));
  };

  return (
    <Dialog title={title} onClose={onCancel} className="w-full max-w-md">
      <form className="p-6" onSubmit={handleSubmit}>
        <label className={DLG_LABEL_CLASS}>{label}</label>
        <input
          type="text"
          value={name}
          ref={inputRef}
          onChange={(e) => { setName(e.target.value); setDirty(true); setSubmitted(false); }}
          className={DLG_INPUT_CLASS}
          placeholder={placeholder}
          data-testid={inputTestId}
        />
        {note && <p className="mt-2 text-xs text-slate-400 break-all">{note}</p>}
        {children}
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
            disabled={submitted}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid={createTestId}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default NameInputDialog;
