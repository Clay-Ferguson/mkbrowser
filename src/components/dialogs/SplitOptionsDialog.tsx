import { useState } from 'react';
import Dialog from './common/Dialog';
import { DEFAULT_SPLIT_DELIMITER, parseSplitDelimiter } from '../../renderer/splitUtil';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_CANCEL, DLG_FOOTER_CLASS, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../renderer/styles';

interface SplitOptionsDialogProps {
  /** Receives the delimiter already parsed into literal text (`\n` → newline). */
  onSplit: (delimiter: string) => void;
  onCancel: () => void;
}

/**
 * Shown before the Edit menu's "Split" runs, to gather its options. Currently the
 * only option is "Split Delimiter": the text the file is cut apart at, where `\n`
 * stands for a newline and every other character is taken verbatim.
 */
function SplitOptionsDialog({ onSplit, onCancel }: SplitOptionsDialogProps) {
  const [delimiter, setDelimiter] = useState(DEFAULT_SPLIT_DELIMITER);

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!delimiter) return;
    onSplit(parseSplitDelimiter(delimiter));
  };

  return (
    <Dialog
      title="Split Options"
      onClose={onCancel}
      className="w-full max-w-md"
      testId="split-options-dialog"
    >
      <form className="p-6" onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className={DLG_LABEL_CLASS} htmlFor="split-options-delimiter">
            Split Delimiter
          </label>
          <input
            id="split-options-delimiter"
            type="text"
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value)}
            className={`${DLG_INPUT_CLASS} font-mono`}
            spellCheck={false}
            data-testid="split-options-delimiter-input"
          />
        </div>

        <p className="text-xs text-slate-500 mb-6">
          Type <code>\n</code> for a newline; everything else is matched exactly.
          The default, <code>\n\n</code>, splits at every blank line. <code>\n---\n</code> splits
          wherever <code>---</code> is on a line by itself. Front matter always stays with the
          first part.
        </p>

        <div className={DLG_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="split-options-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!delimiter}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="split-options-submit-button"
          >
            Split
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default SplitOptionsDialog;
