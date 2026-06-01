import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_CONTAINER } from '../../utils/styles';

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
    <div className={DLG_OVERLAY_CLASS}>
      <div
        className={`${DLG_CONTAINER} max-w-md mx-4 overflow-hidden${
          scrollable ? ' max-h-[70vh] flex flex-col' : ''
        }`}
      >
        <DlgHeader title={title} onClose={onClose} />
        <div className={`p-6${scrollable ? ' flex flex-col flex-1 overflow-hidden' : ''}`}>
          <p
            className={`text-slate-200 mb-6${scrollable ? ' overflow-y-auto' : ''}${
              preserveWhitespace ? ' whitespace-pre-wrap' : ''
            }`}
          >
            {message}
          </p>
          <div className={`flex justify-end${scrollable ? ' flex-shrink-0' : ''}`}>
            <button
              onClick={onClose}
              className={BUTTON_CLASS_DLG_BLUE}
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AlertDialog;
