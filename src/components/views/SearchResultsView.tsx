import { useState } from 'react';
import { MagnifyingGlassIcon, TrashIcon, ShareIcon, CalendarDaysIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/16/solid';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import {
  removeSearchResult,
  setHighlightItem,
  setHighlightedSearchResult,
  navigateToBrowserPath,
  setBrowseFile,
  deleteItems,
  setFolderGraph,
  setCurrentView,
  showTab,
  setCalendarSource,
  setCalendarLoading,
  setCalendarTargetDate,
  setAppError,
  setSearchColumnSort,
  useAS,
} from '../../store';
import { getFileName, getParentPath } from '../../renderer/pathUtil';
import { executeSearch } from '../../renderer/searchUtil';
import { buildFolderGraphFromSearchResults } from '../../shared/searchTreeBuilder';
import { ALL_PROPERTIES, discoverPropertyNames, formatOrderValue, formatPropertyValue, parsePropertyCols, parseTagCategoryCols, propertyValue, sortByText, tagCategoryCellValue, tagCategoryLookup, priorityHighlight, type PriorityHighlight } from '../../shared/searchHelpers';
import { toCalendarEvents } from '../../shared/calendarUtil';
import { ymdPrefixDeltaString } from '../../shared/timeUtil';
import { setCalendarEventsIfCurrent } from '../../renderer/calendarNav';
import type { CalendarSource, SearchColumnSort, SearchResultItem, SearchSortBy, SearchSortDirection } from '../../shared/types';
import { BUTTON_CLASS_ICON_NEUTRAL, BUTTON_CLASS_LINK, BUTTON_CLASS_LINK_BLUE, BUTTON_CLASS_RED, BUTTON_CLASS_SM_NEUTRAL, HOVER_REVEAL, getContentWidthClasses } from '../../renderer/styles';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import FileTypeIcon from '../FileTypeIcon';

/** A results-table row (heading or result): a subgrid spanning every column. */
const RESULTS_ROW = 'grid grid-cols-subgrid col-span-full';
/** The results table never squeezes or wraps a column: every column is as wide as
 * its widest value, and when they don't all fit, the view scrolls horizontally.
 * `w-max min-w-full` makes the table its natural width, but never narrower than
 * the content area, so on a wide window the Name track's `1fr` takes the spare
 * width and the table still spans the page. New columns should use `max-content`
 * tracks and `whitespace-nowrap` cells the same way. */
const TABLE_WIDTH = 'w-max min-w-full';
/**
 * The table's `grid-template-columns`. Path fits its widest folder path; Name is
 * at least its widest name (and takes any spare width, so the name sits right
 * next to its path); the sort-value column (absent for a file-name sort), one
 * column per tag category, one per property, and Actions fit their contents.
 * An inline style, not a Tailwind class, because the number of tag and property
 * columns is only known at runtime.
 */
function tableColumnTracks(showSortColumn: boolean, extraColumnCount: number): string {
  const fitted = (showSortColumn ? 1 : 0) + extraColumnCount + 1;
  return ['max-content', 'minmax(max-content,1fr)', ...Array<string>(fitted).fill('max-content')].join(' ');
}
/** Vertical padding of a result row's cells: the same `py-0.5` as a Browse-view
 * entry header (ENTRY_HEADER_ROW_PADDING), so a row is exactly that tall. It sits
 * on the cells rather than the row so the column dividers run the full height. */
const RESULT_CELL_PAD = 'py-0.5';
/** The 1px light-gray line between columns. A left border adds width, not height. */
const COLUMN_DIVIDER = 'border-l border-slate-600';
const CELL_PATH = 'flex items-center px-2 whitespace-nowrap';
const CELL_NAME = `flex items-center gap-2 px-2 whitespace-nowrap ${COLUMN_DIVIDER}`;
const CELL_ORDER = `flex items-center px-3 whitespace-nowrap ${COLUMN_DIVIDER}`;
/** A tag category column's cell; laid out like the sort-value column. */
const CELL_TAG_CATEGORY = CELL_ORDER;
/** A tag category cell with no tags in that category. */
const NO_TAGS = '—';
/** A property column's cell; laid out like the sort-value column. */
const CELL_PROPERTY = CELL_ORDER;
/** A property cell whose file has no value for that property. */
const NO_VALUE = '—';
/** A tag category cell's text, unless it is a highlighted priority. */
const TAG_CELL_TEXT = 'text-slate-400';
/**
 * Opinionated colors for a PRIORITY column, so the most urgent files can be
 * spotted while scanning down the list (see priorityHighlight): `p1` on red with
 * white text, `p2` on yellow with near-black text — each well above 4.5:1
 * contrast. The cell's text classes replace TAG_CELL_TEXT. Other priorities keep
 * the plain look.
 */
const PRIORITY_CELL_CLASSES: Record<PriorityHighlight, { cell: string; text: string }> = {
  p1: { cell: 'bg-red-700', text: 'text-white font-semibold' },
  p2: { cell: 'bg-yellow-400', text: 'text-slate-900 font-semibold' },
};
const CELL_ACTIONS = `flex items-center px-2 ${COLUMN_DIVIDER}`;
/** Horizontal lines between result rows, drawn as inset shadows rather than
 * borders so they take no layout space (keeping each row the height of a
 * Browse-view entry header). The last row also gets a bottom edge. */
const ROW_DIVIDERS = 'shadow-[inset_0_1px_0_var(--color-slate-700)] last:shadow-[inset_0_1px_0_var(--color-slate-700),inset_0_-1px_0_var(--color-slate-700)]';
/** The same row lines (ROW_DIVIDERS), for a cell with its own background: a
 * row's inset shadow is painted beneath its cells, so a filled cell (a
 * highlighted priority) would hide the lines unless it draws them itself. The
 * last row's cells also draw its bottom edge. */
const CELL_ROW_DIVIDER = 'shadow-[inset_0_1px_0_var(--color-slate-700)]';
const CELL_ROW_DIVIDER_LAST = 'shadow-[inset_0_1px_0_var(--color-slate-700),inset_0_-1px_0_var(--color-slate-700)]';

/** The sort-value column's heading: what its values are, which depends on the
 * Sort By choice. A file-name sort has no such column — the Name column already
 * shows the name. A custom sort uses its search's own column title when it has
 * one (see sortColumnTitle). */
const SORT_COLUMN_TITLES: Record<Exclude<SearchSortBy, 'file-name'>, string> = {
  'created-time': 'Created',
  'modified-time': 'Modified',
  custom: 'Custom',
};

/** The sort-value column's heading for a sort other than by file name: a custom
 * sort's Column title from the Search dialog, else the Sort By choice's default. */
function sortColumnTitle(sortBy: Exclude<SearchSortBy, 'file-name'>, customTitle: string | undefined): string {
  return (sortBy === 'custom' && customTitle?.trim()) || SORT_COLUMN_TITLES[sortBy];
}

/** Opinionated short headings for tag category columns whose values are short
 * (`p1`, …), keyed by lowercased category name, so those columns stay as narrow
 * as their values instead of being widened by a long heading. */
const ABBREVIATED_TAG_COLUMN_TITLES: Record<string, string> = {
  priority: 'PRI.',
  category: 'CAT.',
};

/** A tag category column's full name: the category's name as tags.yaml spells
 * it (matched ignoring case), else as the search typed it (e.g. an unknown name). */
function tagColumnName(name: string, knownCategories: readonly string[]): string {
  const lower = name.toLowerCase();
  return knownCategories.find(c => c.toLowerCase() === lower) ?? name;
}

/** A tag category column's heading: its abbreviation, if it has one (see
 * ABBREVIATED_TAG_COLUMN_TITLES), else its full name. */
function tagColumnTitle(fullName: string): string {
  return ABBREVIATED_TAG_COLUMN_TITLES[fullName.toLowerCase()] ?? fullName;
}

/** The summary's description of a built-in (non-custom) sort order. */
function describeSortOrder(sortBy: SearchSortBy, direction: SearchSortDirection): string {
  if (sortBy === 'file-name') return `file name (${direction === 'asc' ? 'A–Z' : 'Z–A'})`;
  const what = sortBy === 'created-time' ? 'creation time' : 'modification time';
  return `${what} (${direction === 'asc' ? 'oldest first' : 'newest first'})`;
}

/** Column ids for click-to-sort (see SearchColumnSort): the fixed columns, a
 * tag category column's id from its name as the search listed it, and a
 * property column's id from its property name. */
const COL_PATH = 'path';
const COL_NAME = 'name';
const COL_SORT = 'sort';
function tagColumnId(name: string): string {
  return `tag:${name}`;
}
const PROPERTY_COLUMN_PREFIX = 'prop:';
function propertyColumnId(name: string): string {
  return `${PROPERTY_COLUMN_PREFIX}${name}`;
}

/** A property cell's text: the result's value for the property (see
 * formatPropertyValue), or NO_VALUE. See: (USER_GUIDE.md#property-columns) */
function propertyCellText(result: SearchResultItem, name: string): string {
  return formatPropertyValue(propertyValue(result.frontMatter, name)) ?? NO_VALUE;
}

/** A tag category cell's text: its tags, comma-separated, or NO_TAGS. */
function tagCellText(tags: readonly string[]): string {
  return tags.length > 0 ? tags.join(', ') : NO_TAGS;
}

/**
 * The text a click-to-sort column orders a result by: the cell's text as shown,
 * except a Created/Modified column, whose shown time is 12-hour
 * (`hh:mm AM/PM`) and so would not sort as text — it uses the timestamp itself
 * (blank when missing, so those sort first ascending).
 *
 * See: (USER_GUIDE.md#sorting-by-a-column)
 */
function columnSortText(
  result: SearchResultItem,
  column: string,
  sortBy: SearchSortBy,
  tagLookup: ReadonlyMap<string, string>,
): string {
  if (column === COL_PATH) return getParentPath(result.relativePath);
  if (column === COL_NAME) return getFileName(result.path);
  if (column === COL_SORT) {
    const time = sortBy === 'created-time' ? result.createdTime : sortBy === 'modified-time' ? result.modifiedTime : null;
    if (time === null) return formatOrderValue(result, sortBy);
    return time ? String(time).padStart(16, '0') : '';
  }
  if (column.startsWith(PROPERTY_COLUMN_PREFIX)) return propertyCellText(result, column.slice(PROPERTY_COLUMN_PREFIX.length));
  return tagCellText(tagCategoryCellValue(result.tags, column.slice('tag:'.length), tagLookup));
}

/** The sort a click on `column`'s heading switches to: ascending for a new
 * column, the other direction for the column already sorted by. */
function nextColumnSort(current: SearchColumnSort | null, column: string): SearchColumnSort {
  const direction = current?.column === column && current.direction === 'asc' ? 'desc' : 'asc';
  return { column, direction };
}

interface SortableHeadingProps {
  /** The heading cell's layout classes (the column's cell class plus padding). */
  className: string;
  column: string;
  columnSort: SearchColumnSort | null;
  title?: string;
  testId?: string;
  children: React.ReactNode;
}

/**
 * A results-table column heading that sorts the table by its column when
 * clicked (anywhere in the cell), again to reverse, with an arrow showing the
 * direction while it is the sorted column. The inner button gives keyboard
 * access; its click bubbles to the cell's handler.
 *
 * See: (USER_GUIDE.md#sorting-by-a-column)
 */
function SortableHeading({ className, column, columnSort, title, testId, children }: SortableHeadingProps) {
  const direction = columnSort?.column === column ? columnSort.direction : null;
  return (
    <div
      className={`${className} gap-1 cursor-pointer`}
      role="columnheader"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      title={title}
      onClick={() => setSearchColumnSort(nextColumnSort(columnSort, column))}
      data-testid={testId}
      data-sort={direction ?? undefined}
    >
      <button type="button" className={`${BUTTON_CLASS_LINK} uppercase tracking-wider font-semibold`}>{children}</button>
      {direction === 'asc' && <ChevronUpIcon className="w-4 h-4 flex-shrink-0" aria-hidden />}
      {direction === 'desc' && <ChevronDownIcon className="w-4 h-4 flex-shrink-0" aria-hidden />}
    </div>
  );
}

/**
 * Displays the results of the most recent folder search as a sorted table with
 * columns: Path (the folder part of the relative path, blank for a result
 * directly in the searched folder), Name (icon and file or folder name), the
 * sort value (the value the results were sorted by, headed Created, Modified or
 * Custom — or a custom sort's own Column title — to match the Sort By choice — see formatOrderValue; left out of a
 * file-name sort, whose value the Name column already shows), one column per
 * tag category listed in the search's Tag Category Columns (each result's front
 * matter tags in that category, or for ALL, its tags in no other category —
 * see tagCategoryCellValue; worked out here from the live tag definitions, so
 * a tags.yaml edit shows without re-running the search; in a PRIORITY column
 * p1 cells are red and p2 cells yellow; PRIORITY and CATEGORY are headed
 * PRI. and CAT. to keep those columns narrow), one column per front matter
 * property listed in the search's Properties (or, for `*`, every property found
 * in the results but `tags` — see discoverPropertyNames; a list or mapping
 * value shows as `obj.`), and Actions (headed ACT, holding
 * just Delete, which appears only while the pointer rests on the row). Clicking a file row opens that file on
 * its own in the Browse view (single-file mode, same as clicking a file in the
 * index tree); clicking a folder row browses the folder's parent, scrolled to
 * the folder. Clicking a row's Path cell instead browses the folder the result
 * is in, scrolled to the result (the same as the index tree's Browse menu item).
 * The results can also be rendered two other ways: as a folder graph via the
 * "Graph" button, and — for the subset of results that are calendar files —
 * on the Calendar tab via the "Calendar" button. The refresh button re-runs the
 * search that produced the list, discarding the current results entirely. The
 * results arrive already sorted by the search's chosen order (file name, created
 * time, or modified time, and direction); when the result cap truncated them, the
 * header says "Showing N of M".
 *
 * See: (USER_GUIDE.md#search-results)
 * See: (USER_GUIDE.md#tag-category-columns)
 * See: (USER_GUIDE.md#property-columns)
 */
function SearchResultsView() {
  const searchResults = useAS(s => s.searchResults);
  const searchTotalMatches = useAS(s => s.searchTotalMatches);
  const searchQuery = useAS(s => s.searchQuery);
  const searchFolder = useAS(s => s.searchFolder);
  const searchName = useAS(s => s.searchName);
  const fontSize = useAS(s => s.settings.fontSize);
  const contentWidth = useAS(s => s.settings.contentWidth);
  const highlightedSearchResult = useAS(s => s.highlightedSearchResult);
  const searchSortBy = useAS(s => s.searchSortBy);
  const searchSortDirection = useAS(s => s.searchSortDirection);
  const lastSearchDefinition = useAS(s => s.lastSearchDefinition);
  const searchColumnSort = useAS(s => s.searchColumnSort);
  const tagCategoryByTag = useAS(s => s.tagCategoryByTag);
  const tagCategoryNames = useAS(s => s.tagCategoryNames);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Results arrive already in the chosen order: the main process sorts them
  // (with compareSearchResults) before applying the result cap, and deleting a
  // result keeps the rest in place. `searchResults` is never reordered, so it
  // stays the "Original Order"; a clicked column heading only shows a sorted
  // copy of it (computed below, once the tag lookup is known).
  // See: (USER_GUIDE.md#search-results)
  const truncated = searchTotalMatches > searchResults.length;

  // Font size CSS class mapping
  const fontSizeClass = {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  }[fontSize];

  // Opens a file result by itself (single-file view); a folder result in its parent's listing. See: (USER_GUIDE.md#using-search)
  const handleResultClick = (resultPath: string, isDirectory: boolean) => {
    // Track this as the highlighted search result
    setHighlightedSearchResult({ path: resultPath });

    // Extract the parent folder from the result path
    const folderPath = getParentPath(resultPath);

    // Highlight the item in the browser view with purple border
    setHighlightItem(resultPath);

    if (isDirectory) {
      // A folder has no single-file view, so show it in its parent's listing.
      navigateToBrowserPath(folderPath, resultPath);
    } else {
      // A file opens on its own (single-file mode, as from the index tree), so
      // stepping through results shows just the one clicked each time — no
      // scroll-to-file needed since it is the only thing on screen.
      // See: (single_file_browsing.md#why-browsefilemode)
      setBrowseFile(folderPath, getFileName(resultPath));
    }
  };

  // A search has run (even one that found nothing, or a Recent Files search
  // with an empty query) whenever its definition is recorded.
  const hasSearched = lastSearchDefinition !== null;

  // Path cell: browses the folder the result is in (a full listing, never
  // single-file mode), scrolled to and highlighting the result — the same as the
  // index tree's "Browse" context-menu item. See: (USER_GUIDE.md#search-results)
  const handlePathClick = (e: React.MouseEvent, resultPath: string) => {
    // The row's own click would open the file by itself instead.
    e.stopPropagation();
    setHighlightedSearchResult({ path: resultPath });
    setHighlightItem(resultPath);
    navigateToBrowserPath(getParentPath(resultPath), resultPath);
  };

  // A file-name sort gets no sort-value column: its value, the file name, is
  // already in the Name column. See: (USER_GUIDE.md#search-results)
  const showSortColumn = searchSortBy !== 'file-name';

  // Tag category columns, between the sort-value column and Actions.
  // See: (USER_GUIDE.md#tag-category-columns)
  const tagColumns = parseTagCategoryCols(lastSearchDefinition?.tagCategoryCols);
  const tagLookup = tagCategoryLookup(tagCategoryByTag);
  // Property columns, between the tag category columns and Actions. For `*`
  // they come from the results in the search's own order (not a clicked
  // column's order), so sorting by a column never moves the columns.
  // See: (USER_GUIDE.md#property-columns)
  const parsedPropertyCols = parsePropertyCols(lastSearchDefinition?.propertyCols);
  const propertyColumns = parsedPropertyCols === ALL_PROPERTIES ? discoverPropertyNames(searchResults) : parsedPropertyCols;
  const gridTemplateColumns = tableColumnTracks(showSortColumn, tagColumns.length + propertyColumns.length);

  // The rows in display order: the search's own order, or sorted by the clicked
  // column's text. See: (USER_GUIDE.md#sorting-by-a-column)
  const displayedResults = searchColumnSort
    ? sortByText(searchResults, r => columnSortText(r, searchColumnSort.column, searchSortBy, tagLookup), searchColumnSort.direction)
    : searchResults;

  // The Tags and Type filters the search applied (they only apply to contents searches).
  // See: (USER_GUIDE.md#using-search)
  const searchTags = lastSearchDefinition?.searchContents ? lastSearchDefinition.tags?.trim() ?? '' : '';
  const searchType = lastSearchDefinition?.searchContents ? lastSearchDefinition.type?.trim() ?? '' : '';
  const hasFilters = searchTags !== '' || searchType !== '';

  // Get the folder name for display
  const folderName = getFileName(searchFolder) || searchFolder;

  // Helper function to check if a result is highlighted
  const isHighlighted = (path: string): boolean => {
    if (!highlightedSearchResult) return false;
    return highlightedSearchResult.path === path;
  };

  const handleDeleteClick = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const fileName = getFileName(path);
    setDeleteTarget({ path, name: fileName });
  };

  const handleDeleteConfirm = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    void api.deleteFile(target.path)
      .then((success) => {
        if (!success) return;
        // Remove the deleted item from the store so it no longer appears
        // as selected or referenced in memory
        deleteItems([target.path]);
        // Remove the deleted file from search results
        removeSearchResult(target.path);
      })
      .catch((err: unknown) => {
        logger.error('Failed to delete file:', err);
      })
      .finally(() => {
        setDeleting(false);
        setDeleteTarget(null);
      });
  };

  const handleDeleteCancel = () => {
    setDeleteTarget(null);
  };

  /**
   * Opens the Calendar tab showing only the search results that are calendar
   * files. The main process re-reads each result's front matter, so which files
   * qualify is decided by the same parser the folder scan uses. This replaces
   * whatever the calendar was previously showing, and is a snapshot — the load
   * stops the folder watcher, since the results can span many folders.
   *
   * See: (application_tabs.md#which-tabs-are-shown)
   * See: (calendar_view.md#search-source--snapshot)
   * See: (USER_GUIDE.md#search-results)
   * See: (USER_GUIDE.md#find-upcoming-calendar-items)
   */
  const handleShowCalendar = () => {
    if (searchResults.length === 0) return;
    showTab('calendar');
    setCurrentView('calendar');
    const source: CalendarSource = {
      kind: 'search',
      folder: searchFolder,
      query: searchQuery,
      name: searchName,
      totalResults: searchResults.length,
    };
    setCalendarSource(source);
    setCalendarTargetDate(null);
    setCalendarLoading(true);
    void api.loadCalendarEventsForFiles(searchResults.map(r => r.path))
      .then((results) => {
        setCalendarEventsIfCurrent(source, toCalendarEvents(results));
      })
      .catch((err: unknown) => {
        logger.error('Failed to load calendar from search results:', err);
        setCalendarEventsIfCurrent(source, []);
      });
  };

  /**
   * Re-executes the search that produced this list. Files may have been
   * edited, created, renamed, or deleted since it ran, so nothing here is
   * patched up: `executeSearch` scans the same folder with the same stored
   * parameters and overwrites the results outright. Disabled when no search
   * definition was recorded (results restored some other way).
   *
   * See: (USER_GUIDE.md#search-results)
   */
  const handleRefresh = () => {
    const definition = lastSearchDefinition;
    if (!definition || !searchFolder || refreshing) return;
    setRefreshing(true);
    void executeSearch(searchFolder, definition)
      .catch((err: unknown) => {
        logger.error('Failed to refresh search results:', err);
        setAppError('Search failed: ' + (err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        setRefreshing(false);
      });
  };

  // Graph button: builds the folder graph from the results, client-side.
  // See: (folder_graph.md#search-based-graph-alternate-data-source)
  // See: (USER_GUIDE.md#search-based-graph)
  const handleShowGraph = () => {
    if (searchResults.length === 0) return;
    setFolderGraph(buildFolderGraphFromSearchResults(searchResults));
    setCurrentView('folder-graph');
  };

  return (
    <div className={`flex-1 flex flex-col min-h-0 bg-slate-900 ${fontSizeClass}`}>
      {/* Header - only show search info when a search has been executed */}
      {hasSearched && (
        <header className="flex-shrink-0">
          <div className="flex items-center gap-3 px-4 py-2">
            {/* Title: folder icon, then the searched folder's name. Clicking it
                browses the searched folder, like a result's Path cell does for
                the result's folder. See: (USER_GUIDE.md#search-results) */}
            <button
              type="button"
              className="flex items-center gap-1.5 min-w-0 cursor-pointer"
              onClick={() => navigateToBrowserPath(searchFolder)}
              title={`Browse ${searchFolder}`}
              data-testid="search-results-folder"
            >
              <FolderIcon className="w-5 h-5 text-folder flex-shrink-0" />
              <span className="text-sm font-mono text-folder truncate">{folderName}</span>
            </button>
            <div className="ml-auto flex-shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={handleShowGraph}
                disabled={searchResults.length === 0}
                className={`${BUTTON_CLASS_SM_NEUTRAL} flex items-center gap-1.5`}
                title="View search results as folder graph"
                data-testid="search-graph-view-button"
              >
                <ShareIcon className="w-4 h-4" />
                Graph
              </button>
              <button
                type="button"
                onClick={handleShowCalendar}
                disabled={searchResults.length === 0}
                className={`${BUTTON_CLASS_SM_NEUTRAL} flex items-center gap-1.5`}
                title="View the calendar items among the search results"
                data-testid="search-calendar-view-button"
              >
                <CalendarDaysIcon className="w-4 h-4" />
                Calendar
              </button>
              {/* Refresh: re-runs the search from scratch (icon only) */}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={!lastSearchDefinition || refreshing}
                className={`${BUTTON_CLASS_ICON_NEUTRAL} flex items-center`}
                title="Re-run this search"
                data-testid="search-refresh-button"
              >
                <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main content */}
      {/* Scrolls both ways: vertically through a long result list, and
          horizontally when the results table is wider than the window (its
          columns never wrap). Being the one scroller for both axes keeps the
          sticky column headings working and puts the horizontal scrollbar at the
          bottom of the window rather than at the bottom of a long table. */}
      <main className="flex-1 min-h-0 overflow-auto">
        <div className={`${getContentWidthClasses(contentWidth)} pt-2 pb-6`}>
        {/* Search summary: what was searched, then the result count and sort order */}
        {hasSearched && (
          <div className="flex items-start gap-4 text-sm text-slate-300 mb-4">
            <div className="min-w-0">
            {searchName && (
              <span className="text-purple-300 font-semibold mr-2">{searchName}:</span>
            )}
            Searched for{' '}
            {(searchQuery || !hasFilters) && <span className="font-mono text-green-400">&quot;{searchQuery}&quot;</span>}
            {searchQuery && hasFilters && ' with '}
            {searchTags && <>tags <span className="font-mono text-green-400" data-testid="search-summary-tags">{searchTags}</span></>}
            {searchTags && searchType && ' and '}
            {searchType && <>type <span className="font-mono text-green-400" data-testid="search-summary-type">{searchType}</span></>}
            {searchResults.length > 0 && (
              <>
                <span className="mx-2">•</span>
                {truncated
                  ? <>Showing {searchResults.length} of {searchTotalMatches.toLocaleString()} files found</>
                  : <>{searchResults.length} file{searchResults.length !== 1 ? 's' : ''} found</>}
                <span className="mx-2">•</span>
                <span>
                  {searchSortBy === 'custom'
                    ? <>Sorted by <span className="font-mono text-green-400">{lastSearchDefinition?.sortExpression}</span> ({searchSortDirection === 'asc' ? 'ascending' : 'descending'})</>
                    : <>Sorted by {describeSortOrder(searchSortBy, searchSortDirection)}</>}
                </span>
              </>
            )}
            </div>
            {/* Back to the search's own order after sorting by a column. Kept
                in the layout (just invisible) while unsorted, so clicking a
                heading never shifts the table. See: (USER_GUIDE.md#sorting-by-a-column) */}
            <button
              type="button"
              onClick={() => setSearchColumnSort(null)}
              className={`${BUTTON_CLASS_LINK_BLUE} ml-auto flex-shrink-0 whitespace-nowrap ${searchColumnSort ? '' : 'invisible'}`}
              aria-hidden={!searchColumnSort}
              disabled={!searchColumnSort}
              title="Show the results in the search's own order"
              data-testid="search-original-order"
            >
              Original Order
            </button>
          </div>
        )}
        {!hasSearched ? (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-300 mb-2">No search yet</p>
            <p className="text-slate-500">
              Use the <MagnifyingGlassIcon className="w-4 h-4 inline-block mx-1 align-text-bottom" /> search button on the Browse tab to search your files.
            </p>
          </div>
        ) : searchResults.length === 0 ? (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">
              {searchQuery || hasFilters ? 'No results found' : 'No files found'}
            </p>
          </div>
        ) : (
          // Results table: Path | Name | sort value | tag categories… | properties… | Actions
          // (no sort value for a file-name sort). One grid owns the column tracks and every row
          // (heading and results) is a subgrid spanning them all, so the columns
          // line up across rows while each row stays its own element (click
          // target, hover background, highlight outline).
          // See: (USER_GUIDE.md#search-results)
          <div className={`grid ${TABLE_WIDTH}`} style={{ gridTemplateColumns }} role="table" data-testid="search-results-table">
            {/* Column headings — sticky, so they stay in view while a long
                result list scrolls beneath them. */}
            <div
              className={`${RESULTS_ROW} sticky top-0 z-10 bg-slate-700 border-x border-t border-slate-700 text-xs font-semibold uppercase tracking-wider text-slate-300 select-none`}
              role="row"
            >
              {/* Every heading but Actions sorts the table by its column. */}
              <SortableHeading className={`${CELL_PATH} py-1.5`} column={COL_PATH} columnSort={searchColumnSort}>Path</SortableHeading>
              <SortableHeading className={`${CELL_NAME} py-1.5`} column={COL_NAME} columnSort={searchColumnSort}>Name</SortableHeading>
              {showSortColumn && (
                <SortableHeading className={`${CELL_ORDER} py-1.5`} column={COL_SORT} columnSort={searchColumnSort} testId="search-sort-column-title">
                  {sortColumnTitle(searchSortBy, lastSearchDefinition?.sortTitle)}
                </SortableHeading>
              )}
              {tagColumns.map((name) => {
                const fullName = tagColumnName(name, tagCategoryNames);
                return (
                  <SortableHeading key={name} className={`${CELL_TAG_CATEGORY} py-1.5`} column={tagColumnId(name)} columnSort={searchColumnSort} title={fullName} testId="search-tag-column-title">
                    {tagColumnTitle(fullName)}
                  </SortableHeading>
                );
              })}
              {propertyColumns.map((name) => (
                <SortableHeading key={name} className={`${CELL_PROPERTY} py-1.5`} column={propertyColumnId(name)} columnSort={searchColumnSort} title={name} testId="search-property-column-title">
                  {name}
                </SortableHeading>
              ))}
              <div className={`${CELL_ACTIONS} py-1.5`} role="columnheader">Act</div>
            </div>

            {/* Result rows touch, forming the table body: each row draws its
                left, top and right edges (the top edge doubling as the divider
                from the row above) and only the last row adds a bottom edge. */}
            {displayedResults.map((result, index) => {
              const highlighted = isHighlighted(result.path);
              const fileName = getFileName(result.path);
              // The highlight is an inset outline so it can frame all four sides
              // without changing the shared borders between rows.
              const highlightClass = highlighted
                ? 'outline-2 -outline-offset-2 outline-purple-500' : '';
              // The value these results were sorted by — never blank.
              const orderValue = formatOrderValue(result, searchSortBy);
              // Hover text: the value, plus how far away it is when it's a date.
              const orderDelta = ymdPrefixDeltaString(orderValue);
              const orderTitle = orderDelta ? `${orderValue}\n${orderDelta}` : orderValue;

              return (
              <div
                key={result.path}
                onClick={() => handleResultClick(result.path, result.isDirectory === true)}
                className={`${RESULTS_ROW} group hover:bg-slate-700/60 border-x border-slate-700 ${ROW_DIVIDERS} ${highlightClass} transition-colors cursor-pointer`}
                role="row"
              >
                {/* Path: the folder part of the relative path (blank for a
                    result directly in the searched folder). Clicking anywhere in
                    the cell browses that folder rather than opening the result. */}
                <div
                  className={`${CELL_PATH} ${RESULT_CELL_PAD}`}
                  role="cell"
                  onClick={(e) => handlePathClick(e, result.path)}
                  title={`Browse ${getParentPath(result.path)}`}
                  data-testid="search-result-path"
                >
                  {/* Folder-colored text, like folders everywhere else, but no icon and no hover change */}
                  <span className="text-folder">{getParentPath(result.relativePath)}</span>
                </div>

                {/* Name: folder or file-type icon, then the file or folder name */}
                <div className={`${CELL_NAME} ${RESULT_CELL_PAD}`} role="cell">
                  {result.isDirectory
                    ? <FolderIcon className="w-5 h-5 text-folder flex-shrink-0" />
                    : <FileTypeIcon fileName={fileName} />}
                  <span className="text-slate-200" title={result.path} data-testid="search-result-name">{fileName}</span>
                </div>

                {/* Sort value: the value this result was sorted by, shown whole
                    on one line (the column widens to fit it) */}
                {showSortColumn && (
                  <div className={`${CELL_ORDER} ${RESULT_CELL_PAD}`} role="cell">
                    <span
                      className="text-sm text-slate-400 font-mono"
                      title={orderTitle}
                      data-testid="search-result-sort-value"
                    >
                      {orderValue}
                    </span>
                  </div>
                )}

                {/* Tag category columns: the result's tags in each listed category,
                    with p1/p2 in a PRIORITY column colored to stand out */}
                {tagColumns.map((name) => {
                  const tags = tagCategoryCellValue(result.tags, name, tagLookup);
                  const text = tagCellText(tags);
                  const highlight = priorityHighlight(name, tags);
                  const colors = highlight ? PRIORITY_CELL_CLASSES[highlight] : null;
                  return (
                    <div
                      key={name}
                      className={`${CELL_TAG_CATEGORY} ${RESULT_CELL_PAD} ${colors ? `${colors.cell} ${index === displayedResults.length - 1 ? CELL_ROW_DIVIDER_LAST : CELL_ROW_DIVIDER}` : ''}`}
                      role="cell"
                      data-priority={highlight ?? undefined}
                    >
                      <span className={`text-sm font-mono ${colors?.text ?? TAG_CELL_TEXT}`} data-testid="search-result-tag-cell">{text}</span>
                    </div>
                  );
                })}

                {/* Property columns: the result's front matter value for each
                    property; a date's hover text adds how far away it is */}
                {propertyColumns.map((name) => {
                  const text = propertyCellText(result, name);
                  const delta = ymdPrefixDeltaString(text);
                  return (
                    <div key={name} className={`${CELL_PROPERTY} ${RESULT_CELL_PAD}`} role="cell">
                      <span
                        className={`text-sm font-mono ${TAG_CELL_TEXT}`}
                        title={delta ? `${text}\n${delta}` : text}
                        data-testid="search-result-property-cell"
                      >
                        {text}
                      </span>
                    </div>
                  );
                })}

                {/* Actions, revealed only while the row is hovered so a long
                    result list isn't cluttered with icons (same behavior as
                    EntryActionBar in the Browse view). */}
                <div className={`${CELL_ACTIONS} ${RESULT_CELL_PAD}`} role="cell">
                  <div className={`${HOVER_REVEAL} flex items-center gap-2`}>
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => handleDeleteClick(e, result.path)}
                    disabled={deleting}
                    className={BUTTON_CLASS_RED}
                    title="Delete"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
        </div>
      </main>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <ConfirmDialog
          message={`Are you sure you want to delete "${deleteTarget.name}"?`}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default SearchResultsView;
