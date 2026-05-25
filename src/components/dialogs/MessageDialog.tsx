import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_BLUE } from '../../utils/styles';

interface MessageDialogProps {
  message: string;
  onClose: () => void;
  title?: string;
  buttonLabel?: string;
}

function MessageDialog({ message, onClose, title = 'Message', buttonLabel = 'OK' }: MessageDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 max-w-md mx-4 shadow-xl overflow-hidden">
        <DlgHeader title={title} onClose={onClose} />
        <div className="p-6">
          <p className="text-slate-200 mb-6 whitespace-pre-wrap">{message}</p>
          <div className="flex justify-end">
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

export default MessageDialog;
