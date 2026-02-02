interface ErrorDialogProps {
  message: string;
  onClose: () => void;
  title?: string;
  buttonLabel?: string;
}

function ErrorDialog({ message, onClose, title = 'Error', buttonLabel = 'OK' }: ErrorDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 max-w-md mx-4 shadow-xl">
        <h2 className="text-slate-100 text-lg font-semibold mb-3">{title}</h2>
        <p className="text-slate-200 mb-6">{message}</p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorDialog;
