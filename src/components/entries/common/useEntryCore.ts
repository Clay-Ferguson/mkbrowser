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
  const item = useAS(s => s.items.get(path));
  const highlightItem = useAS(s => s.highlightItem);
  const settings = useAS(s => s.settings);

  const isRenaming = item?.renaming ?? false;
  const isExpanded = item?.isExpanded ?? defaultExpanded;
  const isSelected = item?.isSelected ?? false;
  const isHighlighted = highlightItem === path;
  const isBookmarked = (settings.bookmarks || []).some(b => b.path === path);

  return {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
  };
}
