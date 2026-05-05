const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

interface PropsDisplayProps {
  tags: string[];
  props?: Record<string, unknown>;
  floatRight?: boolean;
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
export default function PropsDisplay({ tags, props, floatRight = false }: PropsDisplayProps) {
  const propEntries = props
    ? Object.entries(props).filter(([key]) => key !== 'id')
    : [];
  const hasTags = tags.length > 0;
  const hasProps = propEntries.length > 0;

  if (!hasTags && !hasProps) return null;

  const totalPills = tags.length + propEntries.length;

  const propPills = propEntries.map(([key, value]) => (
    <span
      key={key}
      className="inline-flex items-stretch rounded-md text-sm border border-slate-400/60 select-none whitespace-nowrap overflow-hidden"
      style={{ fontFamily: MONO_FONT }}
    >
      <span className="px-2 py-0.5 bg-amber-700/50 text-amber-200">{key}</span>
      <span className="w-px bg-slate-400/60" />
      <span className="px-2 py-0.5 bg-slate-600/50 text-slate-200">{String(value)}</span>
    </span>
  ));

  const tagPills = tags.map((tag) => (
    <span
      key={tag}
      className="px-2 py-0.5 rounded-md text-sm bg-blue-600/50 text-blue-100 border border-slate-400/60 select-none whitespace-nowrap"
      style={{ fontFamily: MONO_FONT }}
    >
      {tag.startsWith('#') ? tag : `#${tag}`}
    </span>
  ));

  if (floatRight) {
    return (
      <div className="flex flex-nowrap gap-x-2 ml-4 mb-2" style={{ float: 'right' }}>
        {propPills}
        {tagPills}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 mb-3">
      {propPills}
      {tagPills}
    </div>
  );
}
