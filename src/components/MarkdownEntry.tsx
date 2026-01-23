import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type { FileEntry } from '../global';
import { useItem, setItemContent, setItemEditing, isCacheValid } from '../store';

interface MarkdownEntryProps {
  entry: FileEntry;
}

function MarkdownEntry({ entry }: MarkdownEntryProps) {
  const item = useItem(entry.path);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContent, setEditContent] = useState('');

  const isEditing = item?.editing ?? false;

  // Load content if not cached or cache is stale
  useEffect(() => {
    const loadContent = async () => {
      // Check if we have valid cached content
      if (isCacheValid(entry.path)) {
        return;
      }

      setLoading(true);
      try {
        const content = await window.electronAPI.readFile(entry.path);
        setItemContent(entry.path, content);
      } catch (err) {
        setItemContent(entry.path, '*Error reading file*');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [entry.path, entry.modifiedTime]);

  // Get content from cache or show loading state
  const content = item?.content ?? '';

  const handleEditClick = () => {
    setEditContent(content);
    setItemEditing(entry.path, true);
  };

  const handleCancel = () => {
    setEditContent('');
    setItemEditing(entry.path, false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await window.electronAPI.writeFile(entry.path, editContent);
      if (success) {
        setItemContent(entry.path, editContent);
        setItemEditing(entry.path, false);
        setEditContent('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 border-b border-slate-700">
        <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-slate-300 font-medium truncate flex-1">{entry.name}</span>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-3 py-1 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleEditClick}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
      </div>
      <div className="px-6 py-4">
        {loading && !content ? (
          <div className="text-slate-400 text-sm">Loading...</div>
        ) : isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-64 bg-slate-900 text-slate-200 font-mono text-sm p-3 rounded border border-slate-600 focus:border-blue-500 focus:outline-none resize-y"
            placeholder="Enter markdown content..."
          />
        ) : (
          <article className="prose prose-invert prose-sm max-w-none">
            <Markdown>{content || ''}</Markdown>
          </article>
        )}
      </div>
    </div>
  );
}

export default MarkdownEntry;
