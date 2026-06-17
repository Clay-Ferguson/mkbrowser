import { extractTimestamp, getDaysFromToday, formatDaysDisplay } from '../utils/timeUtil';
import { MONO_FONT_STACK } from '../utils/styles';

function getDateTooltip(value: unknown): string | undefined {
  const str = String(value);
  const timestamp = extractTimestamp(str);
  if (timestamp <= 0) return undefined;
  const days = getDaysFromToday(timestamp);
  return "Date:\n\n"+formatDaysDisplay(days);
}

interface PropsDisplayProps {
  tags: string[];
  props?: Record<string, unknown>;
  onTagClick?: () => void;
  onPropClick?: (key: string) => void;
}

/**
 * Read-only display of Front Matter metadata as pill badges.
 *
 * Renders two groups side-by-side:
 *   1. Property pills — key/value pairs from front matter (excluding 'id' and 'tags').
 *      Each pill shows "key | value" with the key in amber and the value in slate.
 *   2. Hashtag pills — values from the front matter 'tags' array, shown in blue.
 *
 * Returns null when there is nothing to display.
 */
export default function PropsDisplay({ tags, props, onTagClick, onPropClick }: PropsDisplayProps) {
  const propEntries = props
    ? Object.entries(props).filter(([key, value]) => key !== 'id' && typeof value !== 'object').sort(([a], [b]) => a.localeCompare(b))
    : [];
  const hasTags = tags.length > 0;
  const hasProps = propEntries.length > 0;

  if (!hasTags && !hasProps) return null;

  const propPills = propEntries.map(([key, value]) => {
    const dateTooltip = getDateTooltip(value);
    return (
      <span
        key={key}
        onClick={() => onPropClick?.(key)}
        className={`inline-flex items-stretch rounded-md text-sm border border-slate-400/60 select-none whitespace-nowrap overflow-hidden${onPropClick ? ' cursor-pointer hover:brightness-125' : ''}`}
        style={{ fontFamily: MONO_FONT_STACK }}
        title={dateTooltip}
      >
        <span className="px-2 py-0.5 bg-amber-700/50 text-amber-200">{key}</span>
        <span className="w-px bg-slate-400/60" />
        <span className="px-2 py-0.5 bg-slate-600/50 text-slate-200">{String(value)}</span>
      </span>
    );
  });

  const tagPills = [...tags].sort((a, b) => a.localeCompare(b)).map((tag) => (
    <span
      key={tag}
      onClick={onTagClick}
      className={`px-2 py-0.5 rounded-md text-sm bg-blue-600/50 text-blue-100 border border-slate-400/60 select-none whitespace-nowrap${onTagClick ? ' cursor-pointer hover:brightness-125' : ''}`}
      style={{ fontFamily: MONO_FONT_STACK }}
    >
      {tag.startsWith('#') ? tag : `#${tag}`}
    </span>
  ));

  return (
    <div className="flex flex-nowrap justify-end gap-x-2 mb-2">
      {propPills}
      {tagPills}
    </div>
  );
}
