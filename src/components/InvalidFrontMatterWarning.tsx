import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { FrontMatterError } from '../shared/frontMatterUtil';

interface InvalidFrontMatterWarningProps {
  error: FrontMatterError;
  /** Opens the editor on the front matter, at the problem line when it is known. */
  onMouseUp: (e: React.MouseEvent) => void;
}

/**
 * Shown above a rendered Markdown file whose front matter isn't valid YAML. Such a block is read as
 * holding nothing, so without this the file's tags, property pills, and object card would simply be
 * missing with no hint why. A click (like a click on a pill) opens the editor at the problem line.
 *
 * See: (USER_GUIDE.md#invalid-front-matter)
 */
export default function InvalidFrontMatterWarning({ error, onMouseUp }: InvalidFrontMatterWarningProps) {
  return (
    <div
      data-testid="invalid-front-matter-warning"
      onMouseUp={onMouseUp}
      className="not-prose mb-4 flex items-start gap-2 rounded-md border border-orange-500/70 bg-orange-900/30 px-3 py-2 text-sm text-orange-200"
    >
      <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 text-orange-400" />
      <div>
        <div className="font-semibold text-orange-300">
          Invalid YAML in front matter{error.line !== null ? ` (line ${error.line})` : ''}: {error.reason}
        </div>
        <div className="mt-0.5 text-orange-200/80">
          The properties were not read, so this file&apos;s tags, properties, and object card are not shown.
          A value that starts with <code>[</code> or <code>{'{'}</code>, or contains <code>{': '}</code> or <code>{' #'}</code>, must be enclosed in double quotes.
        </div>
      </div>
    </div>
  );
}
