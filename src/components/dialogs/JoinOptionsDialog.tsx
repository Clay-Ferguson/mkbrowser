import { useRef, useState } from 'react';
import type { JoinOptions } from '../../renderer/joinUtil';
import Dialog from './common/Dialog';
import CheckboxField from './common/CheckboxField';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_CANCEL, DLG_FOOTER_CLASS } from '../../renderer/styles';

interface JoinOptionsDialogProps {
  /** Number of files that will be joined, shown so the user knows what they're confirming. */
  fileCount: number;
  onJoin: (options: JoinOptions) => void;
  onCancel: () => void;
}

/**
 * Shown before the Edit menu's "Join" runs, to gather its options. Currently the
 * only option is "Include Filenames", which puts each file's name in bold on its
 * own line above that file's content. Returns the choice through onJoin.
 */
function JoinOptionsDialog({ fileCount, onJoin, onCancel }: JoinOptionsDialogProps) {
  const [includeFilenames, setIncludeFilenames] = useState(false);
  // There's no text field to autofocus, so focus Join: Enter then confirms.
  const joinButtonRef = useRef<HTMLButtonElement>(null);

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    onJoin({ includeFilenames });
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
