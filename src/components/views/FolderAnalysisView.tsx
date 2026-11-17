import type { ComponentType, MouseEvent, SVGProps } from 'react';
import { HashtagIcon, TagIcon } from '@heroicons/react/24/outline';
import {
  useAS,
  type HashtagEntry,
} from '../../store';
import { BUTTON_CLASS_ROW } from '../../renderer/styles';

interface FolderAnalysisViewProps {
  /** A Content Hashtag (`#foo`) was clicked; `ctrlKey` asks for the exact tag. */
  onSearchHashtag: (hashtag: string, ctrlKey: boolean) => void;
  /** A Properties Tag (front matter `tags` name, no `#`) was clicked. */
  onSearchPropertyTag: (name: string) => void;
}

interface TagSectionProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  /** One line under the heading saying what the counts mean and what a click does. */
  hint: string;
  entries: HashtagEntry[];
  emptyText: string;
  /** Count unit, singular and plural (e.g. occurrence / occurrences). */
  unit: [string, string];
  /** Tooltip for one entry's button. */
  rowTitle: (tag: string) => string;
  onClickTag: (tag: string, e: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * One titled list of the Analysis results — tags sorted by count, each a button
 * that runs a search for it.
 *
 * See: (USER_GUIDE.md#analysis-results)
 */
function TagSection({ icon: Icon, title, hint, entries, emptyText, unit, rowTitle, onClickTag }: TagSectionProps) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-medium text-slate-200 flex items-center gap-2">
        <Icon className="w-5 h-5 text-blue-400" />
        {title}
        <span className="text-sm text-slate-400 font-normal">({entries.length} unique)</span>
      </h2>
      <p className="text-sm text-slate-400 mt-1 mb-3">{hint}</p>

      {entries.length === 0 ? (
        <p className="text-slate-400 py-4">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              onClick={(e) => onClickTag(entry.tag, e)}
              className={BUTTON_CLASS_ROW}
              title={rowTitle(entry.tag)}
            >
              <span className="text-blue-400 font-mono text-sm">{entry.tag}</span>
              <span className="text-slate-400 text-sm tabular-nums">
                {entry.count}
                <span className="text-slate-500 ml-1">{entry.count === 1 ? unit[0] : unit[1]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Displays the results of a folder analysis: total files scanned, then two
 * separately counted lists, each sorted by count:
 *  - **Properties Tags** — names in the front matter `tags` list (no `#`),
 *    counted per file. A click runs an advanced tag("foo") search.
 *  - **Content Hashtags** — `#foo` written in the body text, counted per
 *    occurrence. A plain click runs a literal search (substring, so #foo also
 *    finds #foobar, and file names match too); Ctrl+click searches for exactly
 *    that whole hashtag.
 *
 * See: (USER_GUIDE.md#analysis-results)
 * See: (USER_GUIDE.md#clicking-a-tag)
 */
function FolderAnalysisView({ onSearchHashtag, onSearchPropertyTag }: FolderAnalysisViewProps) {
  const folderAnalysis = useAS(s => s.folderAnalysis);

  if (!folderAnalysis) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <p className="text-slate-400">No analysis data available. Run a folder analysis from Tools &gt; Folder Analysis.</p>
      </div>
    );
  }

  const { hashtags, propertyTags, folderPath, totalFiles } = folderAnalysis;

  return (
    <main className="flex-1 min-h-0 overflow-y-auto pb-4">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <p className="text-sm font-mono text-btn-accent-amber truncate" title={folderPath}>{folderPath}</p>
          <p className="text-sm text-slate-400 mt-1">
            Scanned <span className="text-slate-200 font-medium">{totalFiles}</span> file{totalFiles !== 1 ? 's' : ''}
          </p>
        </div>

        <TagSection
          icon={TagIcon}
          title="Properties Tags"
          hint="Tags in front matter, counted by file • Click to find the files with the tag"
          entries={propertyTags}
          emptyText="No front matter tags found in the scanned files."
          unit={['file', 'files']}
          rowTitle={(tag) => `Find files tagged ${tag}`}
          onClickTag={(tag) => onSearchPropertyTag(tag)}
        />

        <TagSection
          icon={HashtagIcon}
          title="Content Hashtags"
          hint="Hashtags in the text, counted by occurrence • Click to search for the text • Ctrl+Click to search for the exact hashtag"
          entries={hashtags}
          emptyText="No hashtags found in the text of the scanned files."
          unit={['occurrence', 'occurrences']}
          rowTitle={(tag) => `Search for ${tag} (Ctrl+click for the exact hashtag)`}
          onClickTag={(tag, e) => onSearchHashtag(tag, e.ctrlKey)}
        />
      </div>
    </main>
  );
}

export default FolderAnalysisView;
