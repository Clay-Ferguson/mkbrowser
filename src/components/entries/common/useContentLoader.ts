import { useState, useEffect } from 'react';
import { api } from '../../../renderer/api';
import { useAS, setItemContent, isItemCacheValid, getItem } from '../../../store';
import { applyGlobalHighlight, getGlobalHighlightText } from '../../../renderer/globalHighlight';
import type { ContentLoaderState } from './types';

interface UseContentLoaderOptions {
  /** Full path of the file */
  path: string;
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
    if (getGlobalHighlightText()) {
      requestAnimationFrame(() => applyGlobalHighlight(getGlobalHighlightText()));
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
  isExpanded,
  errorMessage = 'Error reading file',
}: UseContentLoaderOptions): ContentLoaderState {
  const item = useAS(s => s.items.get(path));
  const [loading, setLoading] = useState(false);

  // Reactive cache validity, derived from the subscribed item. Depending on
  // this (rather than an mtime prop) makes the loader self-healing: *any*
  // invalidation — content wiped by isReplacedFile when a file's birthtime
  // changed behind our back, or a stale contentCachedAt after an external
  // edit — flips it to false and re-triggers the load, even when the mtime is
  // unchanged. With an mtime dep alone, a wipe without an mtime change left
  // the entry permanently blank until app restart. No re-read loop is
  // possible: a load that leaves the cache invalid (e.g. the store mtime
  // already moved ahead of the read) keeps this false, and an unchanged dep
  // never re-runs the effect.
  const cacheValid = isItemCacheValid(item);

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
    if (isExpanded && !cacheValid) {
      void loadFileContent(path, errorMessage, () => ignore, setLoading);
    }

    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the ignore flag so the pending loadFileContent() promise can't set state after unmount/re-run.
    return () => {
      ignore = true;
    };
  }, [path, cacheValid, isExpanded, errorMessage]);

  // Get content from cache. `undefined` means never loaded — an empty file
  // reads back as '', which is content like any other.
  const hasContent = item?.content !== undefined;
  const content = item?.content ?? '';

  return {
    // Derived against the cache rather than reported raw, because a read that
    // is superseded mid-flight can never clear its own flag: the ignore guard
    // gates the `finally` too. That is routine, not an unmount-only edge case —
    // two views can render the same path at once (App.tsx hides views with CSS
    // instead of unmounting them), so a sibling entry's load landing first
    // flips `cacheValid` and re-runs this effect while this read is still out.
    // Content in hand means there is nothing to wait for, whoever fetched it.
    // Untreated, this stranded *empty* files on "Loading..." forever: callers
    // test `loading && !content`, where '' is indistinguishable from unloaded.
    loading: loading && !hasContent,
    content,
  };
}
