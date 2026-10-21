import { useRef, useState } from 'react';
import type { JoinOptions } from '../../renderer/joinUtil';
import { parseSplitDelimiter } from '../../renderer/splitUtil';
import Dialog from './common/Dialog';
import CheckboxField from './common/CheckboxField';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_CANCEL, DLG_FOOTER_CLASS, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../renderer/styles';

interface JoinOptionsDialogProps {
  /** Number of files that will be joined, shown so the user knows what they're confirming. */
  fileCount: number;
  onJoin: (options: JoinOptions) => void;
  onCancel: () => void;
}

/**
 * Shown before the Edit menu's "Join" runs, to gather its options:
 * - "Join Delimiter": text placed between each pair of files with a blank line on each side,
 *   where `\n` stands for a newline (same convention as the Split Options dialog).
 *   Left empty, the files are joined with the default separator.
 * - "Include Filenames": puts each file's name in bold on its own line above that
 *   file's content.
 * Returns the choices through onJoin.
 */
function JoinOptionsDialog({ fileCount, onJoin, onCancel }: JoinOptionsDialogProps) {
  const [delimiter, setDelimiter] = useState('');
  const [includeFilenames, setIncludeFilenames] = useState(false);
  // Focus Join rather than the (usually left empty) delimiter field, so Enter confirms.
  const joinButtonRef = useRef<HTMLButtonElement>(null);

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    onJoin({ includeFilenames, delimiter: parseSplitDelimiter(delimiter) });
  };

  return (
    <Dialog
      title="Join Options"
      onClose={onCancel}
      className="w-full max-w-md"
      testId="join-options-dialog"
      initialFocusRef={joinButtonRef}
    >
      <form className="p-6" onSubmit={handleSubmit}>
        <p className="text-sm text-slate-400 mb-4">
          Join {fileCount} selected files, in filename order, into the first of them. The other
          files are deleted after the joined file is written.
        </p>

        <div className="mb-4">
          <label className={DLG_LABEL_CLASS} htmlFor="join-options-delimiter">
            Join Delimiter
          </label>
          <input
            id="join-options-delimiter"
            type="text"
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value)}
            className={`${DLG_INPUT_CLASS} font-mono`}
            spellCheck={false}
            data-testid="join-options-delimiter-input"
          />
          <p className="text-xs text-slate-500 mt-2">
            Placed between each pair of files, with a blank line on each side, so <code>---</code>
            becomes a horizontal rule. Type <code>\n</code> for a newline; everything else is used exactly.
            Leave empty to separate files with just blank lines.
          </p>
        </div>

        <div className="mb-6">
          <CheckboxField
            label="Include Filenames"
            checked={includeFilenames}
            onChange={setIncludeFilenames}
            testId="join-options-include-filenames"
            description="Put each file's name, in bold, on its own line above that file's content."
          />
        </div>

        <div className={DLG_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="join-options-cancel-button"
          >
            Cancel
          </button>
          <button
            ref={joinButtonRef}
            type="submit"
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="join-options-submit-button"
          >
            Join
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default JoinOptionsDialog;
