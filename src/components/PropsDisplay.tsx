import { clsx } from 'clsx';
import { extractTimestamp, getDaysFromToday, formatDaysDisplay } from '../shared/timeUtil';
import { useAS } from '../store';
import { isAllTagCategory } from '../shared/tagUtil';
import { MONO_FONT_STACK, TAG_PILL_BASE, TAG_PILL_SELECTED, TAG_PILL_HOVER } from '../renderer/styles';

// Returns a human-readable relative-date tooltip ("N days ago", "today", etc.) for
// date-like string values, or undefined if the string doesn't parse as a recognizable date.
function getDateTooltip(value: unknown): string | undefined {
  const str = String(value);
  const timestamp = extractTimestamp(str);
  if (Number.isNaN(timestamp)) return undefined;
  const days = getDaysFromToday(timestamp);
  return "Date:\n\n"+formatDaysDisplay(days);
}

// Two-part "left | right" pill (property key | value, tag category | tag): the outer shell
// and the amber left half. Each caller supplies its own right-half colors.
const SPLIT_PILL = 'inline-flex shrink-0 items-stretch rounded-md text-sm border border-slate-400/60 select-none whitespace-nowrap overflow-hidden';
const SPLIT_PILL_LEFT = 'px-2 py-0.5 bg-amber-700/50 text-amber-200';

interface PropsDisplayProps {
  tags: string[];
  props?: Record<string, unknown>;
  onTagClick?: () => void;
  /** Click anywhere on a pill (the key half, the divider, or the value half when
   *  `onPropValueClick` is absent). */
  onPropClick?: (key: string) => void;
  /** Click on the value half only. Given, it takes over that half of every pill, so the
   *  handler must fall back to the `onPropClick` behavior for keys it doesn't special-case. */
  onPropValueClick?: (key: string, value: string) => void;
  /** Tooltip for the value half, when it should differ from the pill's own tooltip. */
  propValueTitle?: (key: string, value: string) => string | undefined;
}

/**
 * Read-only display of Front Matter metadata as pill badges.
 *
 * Renders two groups side-by-side:
 *   1. Property pills — key/value pairs from front matter (excluding 'id' and 'tags').
 *      Each pill shows "key | value" with the key in amber and the value in slate. The two
 *      halves are separately clickable: `onPropValueClick`, when supplied, owns the value
 *      half while `onPropClick` owns the rest of the pill.
 *   2. Hashtag pills — values from the front matter 'tags' array, shown in blue. A tag
 *      defined in a tags.yaml category other than "all" shows "category | tag", styled like
 *      a property pill but with the tag half in blue; "all" and undefined tags show the tag alone.
 *
 * Returns null when there is nothing to display.
 */
export default function PropsDisplay({ tags, props, onTagClick, onPropClick, onPropValueClick, propValueTitle }: PropsDisplayProps) {
  const propEntries = props
    ? Object.entries(props).filter(([key, value]) => key !== 'id' && typeof value !== 'object').sort(([a], [b]) => a.localeCompare(b))
    : [];
  const tagCategoryByTag = useAS(s => s.tagCategoryByTag);
  const hasTags = tags.length > 0;
  const hasProps = propEntries.length > 0;

  if (!hasTags && !hasProps) return null;

  const propPills = propEntries.map(([key, value]) => {
    const dateTooltip = getDateTooltip(value);
    const valueStr = String(value);
    const valueTooltip = propValueTitle?.(key, valueStr);
    return (
      <span
        key={key}
        onClick={() => onPropClick?.(key)}
        // The entry's content area opens the editor on mouseup, which would fire before this pill's
        // click. onPropClick decides what a pill click does, so keep the mouseup from reaching it.
        onMouseUp={onPropClick ? (e) => e.stopPropagation() : undefined}
        className={clsx(
          SPLIT_PILL,
          onPropClick && ['cursor-pointer hover:brightness-125', TAG_PILL_HOVER],
        )}
        style={{ fontFamily: MONO_FONT_STACK }}
        title={dateTooltip}
      >
        <span className={SPLIT_PILL_LEFT}>{key}</span>
        <span className="w-px bg-slate-400/60" />
        {/* The value half gets its own handler when one is given; stopPropagation keeps the
            pill's onPropClick from also firing as the event bubbles out. */}
        <span
          className="px-2 py-0.5 bg-slate-600/50 text-slate-200"
          onClick={onPropValueClick ? (e) => { e.stopPropagation(); onPropValueClick(key, valueStr); } : undefined}
          title={valueTooltip ?? dateTooltip}
        >
          {valueStr}
        </span>
      </span>
    );
  });

  // Deduped: front matter like `tags: [a, a]` is legal YAML, and a repeated tag would
  // otherwise produce duplicate React keys.
  const tagPills = [...new Set(tags)].sort((a, b) => a.localeCompare(b)).map((tag) => {
    const category = tagCategoryByTag[tag];
    if (category !== undefined && !isAllTagCategory(category)) {
      return (
        <span
          key={tag}
          onClick={onTagClick}
          className={clsx(
            SPLIT_PILL,
            onTagClick && ['cursor-pointer hover:brightness-125', TAG_PILL_HOVER],
          )}
          style={{ fontFamily: MONO_FONT_STACK }}
        >
          <span className={SPLIT_PILL_LEFT}>{category}</span>
          <span className="w-px bg-slate-400/60" />
          <span className="px-2 py-0.5 bg-blue-600/50 text-blue-100">{tag}</span>
        </span>
      );
    }
    return (
      <span
        key={tag}
        onClick={onTagClick}
        className={clsx(
          TAG_PILL_BASE,
          TAG_PILL_SELECTED,
          onTagClick && ['cursor-pointer hover:brightness-125', TAG_PILL_HOVER],
        )}
        style={{ fontFamily: MONO_FONT_STACK }}
      >
        {tag}
      </span>
    );
  });

  return (
    <div className="flex flex-wrap justify-end gap-2 mb-2">
      {propPills}
      {tagPills}
    </div>
  );
}
