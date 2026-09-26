import type { FileEntry } from '../../global';
import { useAS, getCutPaths, type ItemData, type SortOrder } from '../../store';
import { sortEntries } from '../../shared/fileTypes';

/**
 * The store's modified/created times for each listing entry, flattened as
 * `[modified0, created0, modified1, created1, …]` (falling back to the entry's
 * own times when the store has no item). A flat array of numbers so a
 * `useShallow` selector over it stays stable across writes that don't touch
 * any time — a saved file updates its item's times before the listing reloads.
 */
export function listingTimes(items: Map<string, ItemData>, entries: FileEntry[]): number[] {
  const times: number[] = [];
  for (const entry of entries) {
    const item = items.get(entry.path);
    times.push(item?.modifiedTime ?? entry.modifiedTime, item?.createdTime ?? entry.createdTime);
  }
  return times;
}

/**
 * The listing exactly as BrowseView shows it: cut entries hidden, each entry's
 * times taken from `times` (see {@link listingTimes}), and sorted by index
 * order in Document Mode or by the user's sort order otherwise.
 */
export function sortListing(
  entries: FileEntry[],
  times: number[],
  cutPaths: ReadonlySet<string>,
  hasIndexFile: boolean,
  sortOrder: SortOrder,
  foldersOnTop: boolean,
): FileEntry[] {
  const withCurrentTimes = entries.flatMap((entry, i) => {
    if (cutPaths.has(entry.path)) return [];
    const modifiedTime = times[2 * i] ?? entry.modifiedTime;
    const createdTime = times[2 * i + 1] ?? entry.createdTime;
    if (modifiedTime !== entry.modifiedTime || createdTime !== entry.createdTime) {
      return [{ ...entry, modifiedTime, createdTime }];
    }
    return [entry];
  });
  return hasIndexFile
    ? [...withCurrentTimes].sort((a, b) => {
        const aOrder = a.indexOrder ?? Infinity;
        const bOrder = b.indexOrder ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      })
    : sortEntries(withCurrentTimes, sortOrder, foldersOnTop);
}

/**
 * {@link sortListing} over the current store state, for call-time use in
 * handlers (e.g. resolving an IndexInsertBar's position to a sibling name).
 * BrowseEntryList renders from the same function, so an index taken from the
 * rendered list resolves to the same entry here.
 */
export function getSortedEntries(): FileEntry[] {
  const { currentEntries, items, hasIndexFile, settings } = useAS.getState();
  return sortListing(
    currentEntries,
    listingTimes(items, currentEntries),
    getCutPaths(items),
    hasIndexFile,
    settings.sortOrder,
    settings.foldersOnTop,
  );
}

/** The selected items, in the map's insertion order. For call-time use in handlers. */
export function getSelectedItems(items: Map<string, ItemData>): ItemData[] {
  return Array.from(items.values()).filter((item) => item.isSelected);
}
