import { useItem, useHighlightItem, useSettings } from '../../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../../utils/ordinals';
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
export function useEntryCore({ path, name, defaultExpanded = false }: UseEntryCoreOptions): EntryCoreState {
  const item = useItem(path);
  const highlightItem = useHighlightItem();
  const settings = useSettings();

  const isRenaming = item?.renaming ?? false;
  const isExpanded = item?.isExpanded ?? defaultExpanded;
  const isSelected = item?.isSelected ?? false;
  const isHighlighted = highlightItem === name;
  const isBookmarked = (settings.bookmarks || []).includes(path);
  const showInsertIcons = hasOrdinalPrefix(name);
  const nextOrdinalPrefix = showInsertIcons ? getNextOrdinalPrefix(name) : null;

  return {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
    showInsertIcons,
    nextOrdinalPrefix,
  };
}
