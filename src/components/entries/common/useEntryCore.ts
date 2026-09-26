import { useAS } from '../../../store';
import type { EntryCoreState } from './types';

interface UseEntryCoreOptions {
  /** Full path of the entry */
  path: string;
  /** Name of the entry */
  name: string;
  /** Default expanded state (some entry types default to expanded) */
  defaultExpanded?: boolean;
}

/**
 * Hook that provides common entry state and derived values.
 * Consolidates store access and computed properties used by all Entry components.
 */
export function useEntryCore({ path, defaultExpanded = false }: UseEntryCoreOptions): EntryCoreState {
  // Derive per-row booleans inside the selectors so a change to the global
  // highlight/bookmarks — or to an unrelated field of this row's item (content
  // cache, times) — only re-renders the rows whose answer actually flips.
  const isRenaming = useAS(s => s.items.get(path)?.renaming ?? false);
  const isExpanded = useAS(s => s.items.get(path)?.isExpanded ?? defaultExpanded);
  const isSelected = useAS(s => s.items.get(path)?.isSelected ?? false);
  const isHighlighted = useAS(s => s.highlightItem === path);
  const isBookmarked = useAS(s => s.settings.bookmarks.some(b => b.path === path));

  return {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
  };
}
