import type { ContentWidth } from '../store';

/**
 * Shared Tailwind CSS class strings for consistent styling across components
 */

/**
 * Get Tailwind classes for content width based on setting
 */
export function getContentWidthClasses(contentWidth: ContentWidth): string {
  switch (contentWidth) {
    case 'narrow':
      return 'max-w-2xl mx-auto px-4';
    case 'medium':
      return 'max-w-4xl mx-auto px-4';
    case 'wide':
      return 'max-w-6xl mx-auto px-4';
    case 'full':
      return 'px-4';
    default:
      return 'max-w-4xl mx-auto px-4';
  }
}

export const CHECKBOX_CLASS = 'h-5 w-5 accent-blue-500 flex-shrink-0 cursor-pointer';

export const BUTTON_CLASS_NORMAL = 'p-1.5 text-slate-400 hover:text-white      hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';
export const BUTTON_CLASS_CYAN =   'p-1.5 text-slate-400 hover:text-cyan-400   hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';
export const BUTTON_CLASS_RED =    'p-1.5 text-slate-400 hover:text-red-400    hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';
export const BUTTON_CLASS_BLUE =   'p-1.5 text-slate-400 hover:text-blue-400   hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';

// Large dialog action buttons
export const BUTTON_CLASS_DLG_CANCEL = 'px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors cursor-pointer';
export const BUTTON_CLASS_DLG_BLUE   = 'px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BUTTON_CLASS_DLG_GREEN  = 'px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-500 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BUTTON_CLASS_DLG_RED    = 'px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

// Small inline action buttons
export const BUTTON_CLASS_SM_BLUE   = 'px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BUTTON_CLASS_SM_RED    = 'px-3 py-1 text-sm text-white bg-red-600 hover:bg-red-500 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BUTTON_CLASS_SM_PURPLE = 'px-3 py-1 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BUTTON_CLASS_SM_GREEN  = 'px-3 py-1 text-sm text-white bg-green-600 hover:bg-green-500 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

// Solid blue icon button (blue background, for primary icon actions)
export const BUTTON_CLASS_ICON_SOLID_BLUE = 'flex-shrink-0 p-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors cursor-pointer';

// Dialog structural classes
export const DLG_OVERLAY_CLASS = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
export const DLG_CONTAINER = 'bg-slate-800 rounded-lg border-2 border-slate-400 shadow-xl';
export const DLG_INPUT_CLASS = 'w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm';
export const DLG_LABEL_CLASS = 'block text-sm text-slate-400 mb-2';
export const DLG_FOOTER_CLASS = 'flex justify-end gap-3';

// Entry component structural classes
export const ENTRY_OUTER = 'bg-slate-800 group overflow-hidden';
export const ENTRY_HIGHLIGHTED = 'border-2 border-purple-500 relative z-10';
export const ENTRY_HEADER_ROW = 'flex items-center gap-3 px-2 py-0 bg-blue-800/50 group-hover:bg-blue-700/70 transition-colors';
export const ENTRY_HEADER_EXPANDED = 'border border-slate-500';
export const ENTRY_NAME_SPAN = 'text-slate-300 font-medium truncate flex-1 cursor-pointer no-underline';
export const ENTRY_CONTENT_AREA = 'px-6 py-4';
export const ENTRY_LOADING = 'text-slate-400 text-sm';
export const ENTRY_EDITOR_ICON_BTN = 'p-1 text-slate-200 hover:text-slate-100 hover:bg-slate-600 rounded transition-colors cursor-pointer';
export const RENAME_INPUT_CLASS = 'flex-1 bg-slate-900 text-slate-200 px-2 py-1 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm';