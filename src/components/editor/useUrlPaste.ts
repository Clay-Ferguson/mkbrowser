import { useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { formatUrlMarkdownLink, isPastedUrl } from './urlPaste';

/** A pasted URL waiting on the "Insert link" dialog. */
export interface PendingUrlPaste {
  url: string;
  /** The selection the paste replaces, captured at paste time (the modal blocks edits meanwhile). */
  from: number;
  to: number;
  /** Suggested link text: the selected text, else the fetched page title once it arrives. */
  title: string;
  /** True while the page title is being fetched. */
  fetching: boolean;
}

interface UseUrlPasteProps {
  viewRef: React.RefObject<EditorView | null>;
  /** Whether pasted URLs get the dialog — editable Markdown editors only. */
  enabled: boolean;
}

/** Replaces `from..to` with `text` (clamped to the current doc) and puts the cursor after it. */
function insertAt(view: EditorView, from: number, to: number, text: string): void {
  const len = view.state.doc.length;
  const start = Math.min(from, len);
  view.dispatch({
    changes: { from: start, to: Math.min(to, len), insert: text },
    selection: { anchor: start + text.length },
    userEvent: 'input.paste',
  });
  view.focus();
}

/**
 * Pasting a lone http(s) URL into a Markdown editor — by Ctrl+V or the context menu's Paste —
 * opens an "Insert link" dialog instead of pasting: OK inserts `[title](url)`, Cancel pastes
 * the raw URL. The title starts as the selected text when there is a selection; otherwise
 * the page's `<title>` is fetched (by the main process, see main/urlTitle) and dropped in
 * when it arrives, unless the user has started typing.
 */
export function useUrlPaste({ viewRef, enabled }: UseUrlPasteProps) {
  const [pending, setPending] = useState<PendingUrlPaste | null>(null);

  /**
   * Opens the dialog when `text` is a URL to link, returning true (the caller must then not
   * paste it); returns false for anything the caller should paste normally.
   */
  const beginUrlPaste = (text: string): boolean => {
    const view = viewRef.current;
    if (!enabled || !view || !isPastedUrl(text)) return false;
    const url = text.trim();
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to).trim();
    // Single-line selections only make sense as link text.
    const title = selected.includes('\n') ? '' : selected;
    const entry: PendingUrlPaste = { url, from, to, title, fetching: !title };
    setPending(entry);
    if (!title) {
      void api.fetchUrlTitle(url)
        .catch((err: unknown) => {
          logger.warn('Failed to fetch page title:', err);
          return '';
        })
        // Identity check: ignore a late title for a dialog that was already closed or replaced.
        .then((fetched) => setPending(p => (p === entry ? { ...p, title: fetched, fetching: false } : p)));
    }
    return true;
  };

  const confirmUrlPaste = (title: string) => {
    const view = viewRef.current;
    setPending(null);
    if (view && pending) insertAt(view, pending.from, pending.to, formatUrlMarkdownLink(title, pending.url));
  };

  const cancelUrlPaste = () => {
    const view = viewRef.current;
    setPending(null);
    if (view && pending) insertAt(view, pending.from, pending.to, pending.url);
  };

  return { pendingUrlPaste: pending, beginUrlPaste, confirmUrlPaste, cancelUrlPaste };
}
