import { DocumentTextIcon, DocumentIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { getIconForFileExtension } from '../shared/fileTypes';

/**
 * The icon for a file, chosen and colored by its type (markdown, text, image,
 * pdf, or anything else). Shared by the index tree and the search results so a
 * file looks the same in both. Folders are not handled here — callers draw
 * their own folder icons (e.g. open/closed in the tree).
 */
function FileTypeIcon({ fileName }: { fileName: string }) {
  switch (getIconForFileExtension(fileName)) {
    case 'markdown': return <DocumentTextIcon className="w-5 h-5 text-blue-400 shrink-0" />;
    case 'text':     return <DocumentTextIcon className="w-5 h-5 text-emerald-400 shrink-0" />;
    case 'image':    return <PhotoIcon className="w-5 h-5 text-green-500 shrink-0" />;
    case 'pdf':      return <DocumentTextIcon className="w-5 h-5 text-red-400 shrink-0" />;
    default:         return <DocumentIcon className="w-5 h-5 text-slate-300 shrink-0" />;
  }
}

export default FileTypeIcon;
