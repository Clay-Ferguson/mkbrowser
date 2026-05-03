const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

interface TagsDisplayProps {
  tags: string[];
}

/**
 * Read-only display of Front Matter tags as pill badges.
 * Returns null when there are no tags — no overhead for untagged files.
 */
export default function TagsDisplay({ tags }: TagsDisplayProps) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 mb-3" style={{ fontFamily: MONO_FONT }}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="px-2 py-0.5 rounded-md text-sm bg-blue-600/50 text-blue-100 border border-slate-400/60 select-none"
        >
          {tag.startsWith('#') ? tag : `#${tag}`}
        </span>
      ))}
    </div>
  );
}
