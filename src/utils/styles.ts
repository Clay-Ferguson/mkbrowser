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

export const BUTTON_CLASS =      'p-1.5 text-slate-400 hover:text-white      hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';
export const BUTTON_CLASS_CYAN = 'p-1.5 text-slate-400 hover:text-cyan-400   hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';
export const BUTTON_CLASS_RED =  'p-1.5 text-slate-400 hover:text-red-400    hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';
export const BUTTON_CLASS_BLUE = 'p-1.5 text-slate-400 hover:text-blue-400   hover:bg-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer';