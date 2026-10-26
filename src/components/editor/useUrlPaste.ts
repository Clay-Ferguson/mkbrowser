import { useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { formatUrlMarkdownLink, isPastedUrl, isUselessLinkTitle } from './urlPaste';

/** A link waiting on the "Insert link" dialog — from a pasted URL or the "Make Link" menu item. */
export interface PendingUrlPaste {
  /** The link destination. */
  url: string;
  /** The range the link replaces, captured when the dialog opened (the modal blocks edits meanwhile). */
  from: number;
  to: number;
  /** Suggested link text: the selected text, else the fetched page title once it arrives. */
  title: string;
  /** True while the page title is being fetched. */
  fetching: boolean;
  /**
   * What Cancel does: 'paste' inserts the raw URL (the paste the dialog intercepted);
   * 'makeLink' leaves the selected text as it was.
   */
  source: 'paste' | 'makeLink';
}

interface UseUrlPasteProps {
  viewRef: React.RefObject<EditorView | null>;
  /** Whether links can be made at all — editable Markdown editors only. */
  enabled: boolean;
}

/** Replaces `from..to` with `text` (clamped to the current doc) and puts the cursor after it. */
function insertAt(view: EditorView, from: number, to: number, text: string, userEvent: string): void {
  const len = view.state.doc.length;
  const start = Math.min(from, len);
  view.dispatch({
    changes: { from: start, to: Math.min(to, len), insert: text },
    selection: { anchor: start + text.length },
    userEvent,
  });
  view.focus();
}

/**
 * The editor's "Insert link" dialog, opened two ways:
 *
 * - Pasting a lone http(s) URL into a Markdown editor (Ctrl+V or the context menu's Paste):
 *   OK inserts `[title](url)` (or the bare URL when the title is blank or just the URL),
 *   Cancel pastes the raw URL. The title starts as the selected text when there is a selection.
 * - "Make Link" on a selection: the selected text becomes the link destination. OK replaces
 *   it with `[title](text)`, Cancel leaves it alone.
 *
 * Whenever the destination is a URL and there is no title yet, the page's `<title>` is
 * fetched (by the main process, see main/urlTitle) and dropped in when it arrives, unless the
 * user has started typing.
 */
export function useUrlPaste({ viewRef, enabled }: UseUrlPasteProps) {
  const [pending, setPending] = useState<PendingUrlPaste | null>(null);

  const openDialog = (entry: PendingUrlPaste) => {
    setPending(entry);
    if (!entry.fetching) return;
    void api.fetchUrlTitle(entry.url)
      .catch((err: unknown) => {
        logger.warn('Failed to fetch page title:', err);
        return '';
      })
      // A "title" that is just the URL is left out, so a blank field means "insert the bare URL".
      .then((fetched) => (isUselessLinkTitle(fetched, entry.url) ? '' : fetched))
      // Identity check: ignore a late title for a dialog that was already closed or replaced.
      .then((fetched) => setPending(p => (p === entry ? { ...p, title: fetched, fetching: false } : p)));
  };

  /**
   * Opens the dialog when `text` is a URL to link, returning true (the caller must then not
   * paste it); returns false for anything the caller should paste normally.
   */
  const beginUrlPaste = (text: string): boolean => {
    const view = viewRef.current;
    if (!enabled || !view || !isPastedUrl(text)) return false;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to).trim();
    // Single-line selections only make sense as link text.
    const title = selected.includes('\n') ? '' : selected;
    openDialog({ url: text.trim(), from, to, title, fetching: !title, source: 'paste' });
    return true;
  };

  /**
   * "Make Link": turns the selected text (less surrounding whitespace, which stays in the
   * document) into a link's destination. Only a URL gets its page title fetched; anything
   * else opens the dialog with an empty title.
   */
  const beginMakeLink = () => {
    const view = viewRef.current;
    if (!enabled || !view) return;
    const { from, to } = view.state.selection.main;
    const raw = view.state.sliceDoc(from, to);
    const url = raw.trim();
    if (!url) return;
    const start = from + raw.indexOf(url);
    openDialog({ url, from: start, to: start + url.length, title: '', fetching: isPastedUrl(url), source: 'makeLink' });
  };

  const confirmUrlPaste = (title: string) => {
    const view = viewRef.current;
    setPending(null);
    if (view && pending) {
      insertAt(view, pending.from, pending.to, formatUrlMarkdownLink(title, pending.url), pending.source === 'paste' ? 'input.paste' : 'input');
    }
  };

  const cancelUrlPaste = () => {
    const view = viewRef.current;
    setPending(null);
    if (!view || !pending) return;
    if (pending.source === 'paste') insertAt(view, pending.from, pending.to, pending.url, 'input.paste');
    else view.focus();
  };

  return { pendingUrlPaste: pending, beginUrlPaste, beginMakeLink, confirmUrlPaste, cancelUrlPaste };
}
