import { useState, useEffect } from 'react';
import { useItem, setItemContent, isCacheValid } from '../../../store';
import type { ContentLoaderState } from './types';

interface UseContentLoaderOptions {
  /** Full path of the file */
  path: string;
  /** File modification time (for cache invalidation) */
  modifiedTime: number;
  /** Whether content is expanded/visible */
  isExpanded: boolean;
  /** Error message to show on load failure */
  errorMessage?: string;
}

/**
 * Hook that handles content loading for file Entry components.
 * Manages loading state and caches content in the store.
 */
export function useContentLoader({
  path,
  modifiedTime,
  isExpanded,
  errorMessage = 'Error reading file',
}: UseContentLoaderOptions): ContentLoaderState {
  const item = useItem(path);
  const [loading, setLoading] = useState(false);

  // Load content if not cached or cache is stale
  useEffect(() => {
    const loadContent = async () => {
      if (!isExpanded) {
        return;
      }

      // Check if we have valid cached content
      if (isCacheValid(path)) {
        return;
      }

      setLoading(true);
      try {
        const content = await window.electronAPI.readFile(path);
        setItemContent(path, content);
      } catch {
        setItemContent(path, errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [path, modifiedTime, isExpanded, errorMessage]);

  // Get content from cache
  const content = item?.content ?? '';

  return {
    loading,
    content,
  };
}
