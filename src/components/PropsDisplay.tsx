import { clsx } from 'clsx';
import { XMarkIcon } from '@heroicons/react/16/solid';
import { extractTimestamp, getDaysFromToday, formatDaysDisplay } from '../shared/timeUtil';
import { BUTTON_CLASS_PILL_DELETE, MONO_FONT_STACK, PILL_PAD_Y, PILL_TEXT_TRIM, TAG_PILL_BASE, TAG_PILL_SELECTED, TAG_PILL_HOVER } from '../renderer/styles';

// Returns a human-readable relative-date tooltip ("N days ago", "today", etc.) for
// date-like string values, or undefined if the string doesn't parse as a recognizable date.
function getDateTooltip(value: unknown): string | undefined {
  const str = String(value);
  const timestamp = extractTimestamp(str);
  if (Number.isNaN(timestamp)) return undefined;
  const days = getDaysFromToday(timestamp);
  return "Date:\n\n"+formatDaysDisplay(days);
}

// Multi-part pill ("key | value" property pill, and any pill with a delete end-cap): the outer
// shell and the amber key half.
const SPLIT_PILL = 'inline-flex shrink-0 items-stretch rounded-md text-sm border border-slate-400/60 select-none whitespace-nowrap overflow-hidden';
// Each half is a flex item (so text-box-trim applies) holding its text directly.
const SPLIT_PILL_HALF = `px-2 ${PILL_PAD_Y} ${PILL_TEXT_TRIM}`;
const SPLIT_PILL_LEFT = `${SPLIT_PILL_HALF} bg-amber-700/50 text-amber-200`;
const PILL_DIVIDER = 'w-px bg-slate-400/60';
const CLICKABLE_PILL = ['cursor-pointer hover:brightness-125', TAG_PILL_HOVER];

interface PillDeleteCapProps {
  /** Accessible name and tooltip, e.g. `Remove property "due"`. */
  label: string;
  onDelete: () => void;
}

/**
 * The divider plus "×" button that ends a pill while its file is being edited. The click is
 * kept from bubbling into the pill's own click handler (which would open the front matter or
 * the tag picker instead). The mousedown is deliberately *not* prevented: moving focus off the
 * editor is what flushes its debounced onChange, so the delete sees the latest keystrokes.
 *
 * See: (USER_GUIDE.md#removing-a-property-or-tag)
 */
function PillDeleteCap({ label, onDelete }: PillDeleteCapProps) {
  return (
    <>
      <span className={PILL_DIVIDER} />
      <button
        type="button"
        className={BUTTON_CLASS_PILL_DELETE}
        aria-label={label}
        title={label}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <XMarkIcon className="w-3.5 h-3.5" />
      </button>
    </>
  );
}

interface PropsDisplayProps {
  tags: string[];
  props?: Record<string, unknown>;
  onTagClick?: () => void;
  /** Click anywhere on a pill (the key half, the divider, or the value half when
   *  `onPropValueClick` is absent). */
  onPropClick?: (key: string) => void;
  /** Click on the value half only. Given, it takes over that half of every pill, so the
   *  handler must fall back to the `onPropClick` behavior for keys it doesn't special-case.
   *  MarkdownEntry uses it to make a `due` date jump to the Calendar tab.
   *
   *  See: (calendar_view.md#calendarview-component) */
  onPropValueClick?: (key: string, value: string) => void;
  /** Tooltip for the value half, when it should differ from the pill's own tooltip. */
  propValueTitle?: (key: string, value: string) => string | undefined;
  /** Given, every property pill ends in an "×" that calls this to delete the property.
   *  MarkdownEntry passes it only while the file is being edited. */
  onPropDelete?: (key: string) => void;
  /** Given, every tag pill ends in an "×" that calls this to delete the tag (see onPropDelete). */
  onTagDelete?: (tag: string) => void;
}

/**
 * Read-only display of Front Matter metadata as pill badges.
 *
 * Renders two groups side-by-side:
 *   1. Property pills — key/value pairs from front matter (excluding 'id' and 'tags').
 *      Each pill shows "key | value" with the key in amber and the value in slate. The two
 *      halves are separately clickable: `onPropValueClick`, when supplied, owns the value
 *      half while `onPropClick` owns the rest of the pill.
 *   2. Hashtag pills — values from the front matter 'tags' array, each shown alone as a
 *      single blue pill (a tag's tags.yaml category is deliberately not shown: it isn't a
 *      property name, so a "category | tag" split pill read as one).
 *
 * When `onPropDelete` / `onTagDelete` are given (the file is being edited), each pill also ends
 * in an "×" end-cap that deletes that property or tag immediately, with no confirmation.
 *
 * Returns null when there is nothing to display.
 *
 * See: (USER_GUIDE.md#jumping-to-a-date-from-a-file)
 * See: (USER_GUIDE.md#how-objects-are-displayed)
 */
export default function PropsDisplay({ tags, props, onTagClick, onPropClick, onPropValueClick, propValueTitle, onPropDelete, onTagDelete }: PropsDisplayProps) {
  const propEntries = props
    ? Object.entries(props).filter(([key, value]) => key !== 'id' && typeof value !== 'object').sort(([a], [b]) => a.localeCompare(b))
    : [];
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
          onPropClick && CLICKABLE_PILL,
        )}
        style={{ fontFamily: MONO_FONT_STACK }}
        title={dateTooltip}
      >
        <span className={SPLIT_PILL_LEFT}>{key}</span>
        <span className={PILL_DIVIDER} />
        {/* The value half gets its own handler when one is given; stopPropagation keeps the
            pill's onPropClick from also firing as the event bubbles out. */}
        <span
          className={`${SPLIT_PILL_HALF} bg-slate-600/50 text-slate-200`}
          onClick={onPropValueClick ? (e) => { e.stopPropagation(); onPropValueClick(key, valueStr); } : undefined}
          title={valueTooltip ?? dateTooltip}
        >
          {valueStr}
        </span>
        {onPropDelete && <PillDeleteCap label={`Remove property "${key}"`} onDelete={() => onPropDelete(key)} />}
      </span>
    );
  });

  // Deduped: front matter like `tags: [a, a]` is legal YAML, and a repeated tag would
  // otherwise produce duplicate React keys. A deletable tag pill needs a second segment for its
  // "×", so it takes the multi-part shell, with the tag in the same blue as a plain tag pill.
  const tagPills = [...new Set(tags)].sort((a, b) => a.localeCompare(b)).map((tag) => (onTagDelete ? (
    <span
      key={tag}
      onClick={onTagClick}
      className={clsx(SPLIT_PILL, onTagClick && CLICKABLE_PILL)}
      style={{ fontFamily: MONO_FONT_STACK }}
    >
      <span className={clsx(SPLIT_PILL_HALF, TAG_PILL_SELECTED)}>{tag}</span>
      <PillDeleteCap label={`Remove tag "${tag}"`} onDelete={() => onTagDelete(tag)} />
    </span>
  ) : (
    <span
      key={tag}
      onClick={onTagClick}
      className={clsx(TAG_PILL_BASE, TAG_PILL_SELECTED, onTagClick && CLICKABLE_PILL)}
      style={{ fontFamily: MONO_FONT_STACK }}
    >
      {tag}
    </span>
  )));

  return (
    <div className="flex flex-wrap justify-end gap-2 mb-2">
      {propPills}
      {tagPills}
    </div>
  );
}
