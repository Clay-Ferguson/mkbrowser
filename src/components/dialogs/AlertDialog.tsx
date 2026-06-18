import { clsx } from 'clsx';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_BLUE } from '../../utils/styles';

interface AlertDialogProps {
  message: string;
  onClose: () => void;
  title?: string;
  buttonLabel?: string;
  /** Constrain height and let long message text scroll (the old ErrorDialog look). */
  scrollable?: boolean;
  /** Preserve line breaks in the message (the old MessageDialog look). */
  preserveWhitespace?: boolean;
}

function AlertDialog({
  message,
  onClose,
  title = 'Message',
  buttonLabel = 'OK',
  scrollable = false,
  preserveWhitespace = false,
}: AlertDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      className={clsx('max-w-md', scrollable && 'max-h-[70vh] flex flex-col')}
    >
      <div className={clsx('p-6', scrollable && 'flex flex-col flex-1 overflow-hidden')}>
        <p
          className={clsx(
            'text-slate-200 mb-6',
            scrollable && 'overflow-y-auto',
            preserveWhitespace && 'whitespace-pre-wrap',
          )}
        >
          {message}
        </p>
        <div className={clsx('flex justify-end', scrollable && 'flex-shrink-0')}>
          <button
            type="button"
            onClick={onClose}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default AlertDialog;
