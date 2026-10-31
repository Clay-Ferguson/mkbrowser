import { useEffect, useRef, useState } from 'react';
import { useAS } from '../../store';
import { api } from '../../renderer/api';
import { joinPath } from '../../renderer/pathUtil';
import { getContentWidthClasses } from '../../renderer/styles';
import { logger, toErrorMessage } from '../../shared/logUtil';
import MarkdownView from '../entries/MarkdownView';
import HelpSearchBar from './HelpSearchBar';

/**
 * The document the Help tab shows, relative to the bundled Help documents folder.
 *
 * See: (USER_GUIDE.md)
 */
const HELP_FILE = 'USER_GUIDE.md';

type HelpDoc =
  | { status: 'loading' }
  | { status: 'loaded'; path: string; content: string }
  | { status: 'error'; message: string };

// Module-level no-op so MarkdownView (memo'd) gets a stable prop: the Help tab has no click-to-edit.
function noEdit(): void {}

/** Loads the User Guide from the bundled Help documents folder. */
async function loadHelpDoc(): Promise<HelpDoc> {
  const folder = await api.getHelpDocsPath();
  if (!folder) return { status: 'error', message: 'Help documents folder not found.' };
  const path = joinPath(folder, HELP_FILE);
  const result = await api.readFile(path);
  if (!result.ok) return { status: 'error', message: `Failed to read ${HELP_FILE}: ${result.error}` };
  return { status: 'loaded', path, content: result.content };
}

/**
 * The Help tab: a read-only render of the bundled User Guide (`docs/user_guide/USER_GUIDE.md`).
 * Rendered through the same MarkdownView pipeline as the Browse tab, so local images,
 * math, diagrams and in-page TOC links all work, but clicking does not open an editor.
 * The guide's own TOC is always shown, since this tab has no index tree beside it.
 * A search bar (HelpSearchBar) sits right-aligned above the scrolling guide, outside the
 * scroll area so it stays visible, and searches only the rendered guide. The guide is
 * focusable (tabIndex -1) so the search bar can focus it after a search, letting the arrow
 * keys and Enter step through matches at once.
 *
 * See: (USER_GUIDE.md)
 */
export default function HelpView() {
  const contentWidth = useAS(s => s.settings.contentWidth);
  const [doc, setDoc] = useState<HelpDoc>({ status: 'loading' });
  const articleRef = useRef<HTMLDivElement>(null);

  // The Help documents are static, so they are loaded once, when the tab is first opened.
  useEffect(() => {
    let cancelled = false;
    void loadHelpDoc()
      .catch((err: unknown): HelpDoc => ({ status: 'error', message: 'Failed to load Help: ' + toErrorMessage(err) }))
      .then((loaded) => {
        if (loaded.status === 'error') logger.error(loaded.message);
        if (!cancelled) setDoc(loaded);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {doc.status === 'loaded' && (
        <div className="flex justify-end px-3 py-2">
          <div className="w-1/2 min-w-md max-w-full">
            <HelpSearchBar rootRef={articleRef} />
          </div>
        </div>
      )}
      <main data-testid="help-view" className="flex-1 min-h-0 overflow-y-auto pb-4 pt-1 pr-3 pl-3">
        <div className={getContentWidthClasses(contentWidth)}>
          {doc.status === 'loaded' ? (
            <div ref={articleRef} tabIndex={-1} className="py-4 outline-none">
              <MarkdownView content={doc.content} showToc entryPath={doc.path} onEditClick={noEdit} />
            </div>
          ) : (
            <p className="text-slate-400 py-12 text-center" data-testid="help-view-status">
              {doc.status === 'loading' ? 'Loading Help…' : doc.message}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
