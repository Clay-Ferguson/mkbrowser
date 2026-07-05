import { useState, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import Typo from 'typo-js';
import { logger } from '../../shared/logUtil';
import { formatDate, formatTimestamp } from '../../shared/timeUtil';
import { hasDueProperty, injectCalendarFrontMatter } from '../../shared/calendarUtil';
import { isMarkdownFile } from '../../shared/fileTypes';
import { buildMarkdownLinks } from '../../renderer/linkUtil';
import { useAS } from '../../store';
import { wordAt, type SpellingSuggestion } from './spellChecker';

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  spelling?: SpellingSuggestion;
}

interface UseEditorContextMenuProps {
  viewRef: React.RefObject<EditorView | null>;
  typoRef: React.RefObject<Typo | null>;
  fileName?: string;
  filePath?: string;
  onMakeCalendarItem?: () => void;
  onMakeRepeatingCalendarItem?: () => void;
}

/**
 * Manages state and event handlers for the editor's right-click context menu.
 *
 * On right-click, checks whether the cursor lands on a misspelled word (using the same
 * tokenisation as the spell-check decorations) and surfaces spelling suggestions at the
 * top of the menu. Also exposes cut/copy/paste, select-all, timestamp/date insertion,
 * and — for Markdown files — "Paste Link" and calendar-item creation actions.
 *
 * Returns everything `EditorContextMenu` and `CodeMirrorEditor` need: the menu's
 * visibility/position state, all action handlers, and derived flags (`isMarkdown`,
 * `canPasteLink`, `calendarAlreadyExists`).
 */
export function useEditorContextMenu({ viewRef, typoRef, fileName, filePath, onMakeCalendarItem, onMakeRepeatingCalendarItem }: UseEditorContextMenuProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const [calendarAlreadyExists, setCalendarAlreadyExists] = useState(false);
  const selectedLinkItems = useAS(s => s.selectedLinkItems);

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  // Converts the click coordinates to a document position, checks whether that position
  // falls inside a misspelled word, and opens the menu with spelling suggestions when it does.
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const view = viewRef.current;
    const typo = typoRef.current;

    let spelling: SpellingSuggestion | undefined;

    if (view && typo) {
      // Get the position in the document from the click coordinates
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos !== null) {
        // Find the word at this position (same word definition as the underlines)
        const line = view.state.doc.lineAt(pos);
        const found = wordAt(line.text, pos - line.from);
        if (found && found.word.length >= 2 && !typo.check(found.word)) {
          spelling = {
            word: found.word,
            from: line.from + found.from,
            to: line.from + found.to,
            suggestions: typo.suggest(found.word, 5), // Get up to 5 suggestions
          };
        }
      }
    }

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      spelling,
    });
  };

  // Fire-and-forget menu handlers: sync `() => void` signature with the async
  // clipboard work (and its error handling) contained inside, so call sites can
  // pass them directly without a `void` adapter.
  const handleCut = () => {
    void (async () => {
      const view = viewRef.current;
      if (!view) return;

      const { from, to } = view.state.selection.main;
      if (from !== to) {
        const selectedText = view.state.sliceDoc(from, to);
        try {
          await navigator.clipboard.writeText(selectedText);
          view.dispatch({
            changes: { from, to, insert: '' },
          });
        } catch (err) {
          logger.error('Failed to cut to clipboard:', err);
        }
      }
      closeContextMenu();
      view.focus();
    })();
  };

  const handleCopy = () => {
    void (async () => {
      const view = viewRef.current;
      if (!view) return;

      const { from, to } = view.state.selection.main;
      if (from !== to) {
        const selectedText = view.state.sliceDoc(from, to);
        try {
          await navigator.clipboard.writeText(selectedText);
        } catch (err) {
          logger.error('Failed to copy to clipboard:', err);
        }
      }
      closeContextMenu();
      view.focus();
    })();
  };

  const handlePaste = () => {
    void (async () => {
      const view = viewRef.current;
      if (!view) return;

      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch (err) {
        logger.error('Failed to read from clipboard:', err);
        closeContextMenu();
        view.focus();
        return;
      }

      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      closeContextMenu();
      view.focus();
    })();
  };

  const handlePasteLink = () => {
    const view = viewRef.current;
    if (!view || !filePath || selectedLinkItems.length === 0) return;

    const text = buildMarkdownLinks(filePath, selectedLinkItems);
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    closeContextMenu();
    view.focus();
  };

  const handleSelectAll = () => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
    });
    closeContextMenu();
    view.focus();
  };

  const handleSpellingSuggestion = (suggestion: string) => {
    const view = viewRef.current;
    if (!view || !contextMenu.spelling) return;

    const { from, to } = contextMenu.spelling;
    view.dispatch({
      changes: { from, to, insert: suggestion },
      selection: { anchor: from + suggestion.length },
    });
    closeContextMenu();
    view.focus();
  };

  const handleInsertTimestamp = () => {
    const view = viewRef.current;
    if (!view) return;

    const timestamp = formatTimestamp();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: timestamp },
      selection: { anchor: from + timestamp.length },
    });
    closeContextMenu();
    view.focus();
  };

  const handleInsertDate = () => {
    const view = viewRef.current;
    if (!view) return;

    const date = formatDate();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: date },
      selection: { anchor: from + date.length },
    });
    closeContextMenu();
    view.focus();
  };

  // Shared implementation for both calendar-item variants. Aborts with an alert if a
  // 'due' property already exists in the front matter; otherwise injects the calendar
  // front matter and invokes the parent callback (used to trigger a save).
  const makeCalendarItem = (repeating: boolean, callback?: () => void) => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (hasDueProperty(currentContent)) {
      setCalendarAlreadyExists(true);
      closeContextMenu();
      return;
    }

    const newContent = injectCalendarFrontMatter(currentContent, repeating);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newContent },
    });
    closeContextMenu();
    view.focus();
    callback?.();
  };

  const handleMakeCalendarItem = () => {
    makeCalendarItem(false, onMakeCalendarItem);
  };

  const handleMakeRepeatingCalendarItem = () => {
    makeCalendarItem(true, onMakeRepeatingCalendarItem);
  };

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu.visible) return;

    // Local equivalent of closeContextMenu, so the effect only depends on the
    // (always-stable) state setter rather than an outer function.
    const close = () => setContextMenu(prev => ({ ...prev, visible: false }));
    const handleClick = () => close();
    const handleScroll = () => close();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        viewRef.current?.focus();
      }
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeyDown);

    // Returns the useEffect cleanup (an unsubscribe): removes the document 'click', 'scroll', and 'keydown' listeners on unmount / before re-run.
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu.visible, viewRef]);

  const isMarkdown = !!fileName && isMarkdownFile(fileName);

  return {
    contextMenu,
    handleContextMenu,
    handleCut,
    handleCopy,
    handlePaste,
    handlePasteLink,
    canPasteLink: !!filePath && selectedLinkItems.length > 0,
    handleSelectAll,
    handleSpellingSuggestion,
    handleInsertTimestamp,
    handleInsertDate,
    handleMakeCalendarItem,
    handleMakeRepeatingCalendarItem,
    isMarkdown,
    calendarAlreadyExists,
    setCalendarAlreadyExists,
  };
}
