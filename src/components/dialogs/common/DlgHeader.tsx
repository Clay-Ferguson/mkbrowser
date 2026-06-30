interface DlgHeaderProps {
  title: string;
  onClose: () => void;
  /** id applied to the title <h3> so the parent Dialog references it via
   *  aria-labelledby. Required: the header is always the dialog's accessible name. */
  titleId: string;
}

/**
 * The shared title bar rendered at the top of every Dialog: the dialog title on
 * the left and a Close (✕) button on the right. Centralizing it here keeps all
 * dialogs looking and behaving the same. The title `<h3>` carries `titleId` so
 * the parent Dialog can reference it via aria-labelledby for the accessible name.
 */
const DlgHeader = ({ title, onClose, titleId }: DlgHeaderProps) => (
  <div className="flex items-center justify-between pl-3 pr-1 py-1 border-b border-slate-600 flex-shrink-0 bg-slate-700 rounded-t-lg">
    <h3 id={titleId} className="text-lg font-semibold text-slate-100">{title}</h3>
    <button
      type="button"
      onClick={onClose}
      className="text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-center w-7 h-7 text-2xl font-bold border-2 border-slate-500 hover:border-slate-300 rounded-md leading-none"
      aria-label="Close"
    >
      ×
    </button>
  </div>
);

export default DlgHeader;
