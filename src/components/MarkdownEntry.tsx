import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type { FileEntry } from '../global';
import { useItem, setItemContent, isCacheValid } from '../store';

interface MarkdownEntryProps {
  entry: FileEntry;
}

function MarkdownEntry({ entry }: MarkdownEntryProps) {
  const item = useItem(entry.path);
  const [loading, setLoading] = useState(false);

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
  const content = item?.content;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 border-b border-slate-700">
        <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-slate-300 font-medium truncate">{entry.name}</span>
      </div>
      <div className="px-6 py-4">
        {loading && !content ? (
          <div className="text-slate-400 text-sm">Loading...</div>
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
