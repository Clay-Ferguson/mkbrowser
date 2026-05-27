import React from 'react';

interface DlgHeaderProps {
  title: string;
  onClose: () => void;
}

/* this is the header component that we use to display the title bar for all of our dialog boxes, so they all look the same, and function the same way */
const DlgHeader: React.FC<DlgHeaderProps> = ({ title, onClose }) => (
  <div className="flex items-center justify-between pl-3 pr-1 py-1 border-b border-slate-600 flex-shrink-0 bg-slate-700 rounded-t-lg">
    <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
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
