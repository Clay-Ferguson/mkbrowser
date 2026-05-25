import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_CONTAINER } from '../../utils/styles';

interface ErrorDialogProps {
  message: string;
  onClose: () => void;
  title?: string;
  buttonLabel?: string;
}

function ErrorDialog({ message, onClose, title = 'Error', buttonLabel = 'OK' }: ErrorDialogProps) {
  return (
    <div className={DLG_OVERLAY_CLASS}>
      <div className={`${DLG_CONTAINER} max-w-md mx-4 max-h-[70vh] flex flex-col overflow-hidden`}>
        <DlgHeader title={title} onClose={onClose} />
        <div className="p-6 flex flex-col flex-1 overflow-hidden">
          <p className="text-slate-200 mb-6 overflow-y-auto">{message}</p>
          <div className="flex justify-end flex-shrink-0">
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

export default ErrorDialog;
