import { useState, useEffect } from 'react';
import { api } from '../../../renderer/api';
import { useAS, setItemContent, isCacheValid, getItem } from '../../../store';
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

// Module-level (not compiled by the React Compiler): the try/finally would make
// the compiler bail out on the hook if it lived inside it.
async function loadFileContent(
  path: string,
  errorMessage: string,
  isIgnored: () => boolean,
  setLoading: (loading: boolean) => void,
): Promise<void> {
  setLoading(true);
  try {
    // mtime/size come from the same file handle as the content, so the cache
    // stamp describes exactly the bytes that were read — a separate stat (or a
    // store-supplied mtime) could describe a different version of the file.
    const { content, mtime, size } = await api.readFileWithMtime(path);
    if (isIgnored()) return;
    setItemContent(path, content, mtime, size);
    if (globalHighlightText) {
      requestAnimationFrame(() => applyGlobalHighlight(globalHighlightText));
    }
  } catch {
    // Stamp the error message with the last known mtime: it stays cache-valid
    // (no re-read loop) until the file's mtime actually changes.
    if (!isIgnored()) setItemContent(path, errorMessage, getItem(path)?.modifiedTime ?? 0);
  } finally {
    if (!isIgnored()) setLoading(false);
  }
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

    // Only load when expanded and there is no valid cached content.
    if (isExpanded && !isCacheValid(path)) {
      void loadFileContent(path, errorMessage, () => ignore, setLoading);
    }

    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the ignore flag so the pending loadFileContent() promise can't set state after unmount/re-run.
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
