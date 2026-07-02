import { useState, useEffect } from 'react';
import { api } from '../../../renderer/api';
import { useAS, setItemContent, isCacheValid } from '../../../store';
import { applyGlobalHighlight, globalHighlightText } from '../../../renderer/globalHighlight';
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
  const item = useAS(s => s.items.get(path));
  const [loading, setLoading] = useState(false);

  // Load content if not cached or cache is stale
  useEffect(() => {
    // Guards against an unmounted component (or a stale effect run after the
    // deps changed) writing its async readFile result into the store. Entries
    // can mount/unmount several times in quick succession on load (e.g. when
    // hasIndexFile flips and the list subtree re-mounts); without this guard
    // every aborted mount's readFile still resolves and calls setItemContent,
    // and that flood of store updates trips React's "Maximum update depth".
    let ignore = false;

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
        const content = await api.readFile(path);
        if (ignore) return;
        setItemContent(path, content);
        if (globalHighlightText) {
          requestAnimationFrame(() => applyGlobalHighlight(globalHighlightText));
        }
      } catch {
        if (!ignore) setItemContent(path, errorMessage);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void loadContent();

    return () => {
      ignore = true;
    };
  }, [path, modifiedTime, isExpanded, errorMessage]);

  // Get content from cache
  const content = item?.content ?? '';

  return {
    loading,
    content,
  };
}
