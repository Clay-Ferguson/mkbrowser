import { useState, useCallback, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import Typo from 'typo-js';
import { logger } from '../../utils/logUtil';
import { formatDate, formatTimestamp } from '../../utils/timeUtil';
import { hasDueProperty, injectCalendarFrontMatter } from '../../utils/calendar/calendarUtil';
import { isMarkdownFile } from '../../utils/fileTypes';
import { buildMarkdownLinks } from '../../utils/linkUtil';
import { useSelectedLinkItems } from '../../store';
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

export function useEditorContextMenu({ viewRef, typoRef, fileName, filePath, onMakeCalendarItem, onMakeRepeatingCalendarItem }: UseEditorContextMenuProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const [calendarAlreadyExists, setCalendarAlreadyExists] = useState(false);
  const selectedLinkItems = useSelectedLinkItems();

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
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
  }, [viewRef, typoRef]);

  const handleCut = useCallback(async () => {
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
  }, [closeContextMenu, viewRef]);

  const handleCopy = useCallback(async () => {
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
  }, [closeContextMenu, viewRef]);

  const handlePaste = useCallback(async () => {
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
  }, [closeContextMenu, viewRef]);

  const handlePasteLink = useCallback(() => {
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
  }, [filePath, selectedLinkItems, closeContextMenu, viewRef]);

  const handleSelectAll = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
    });
    closeContextMenu();
    view.focus();
  }, [closeContextMenu, viewRef]);

  const handleSpellingSuggestion = useCallback((suggestion: string) => {
    const view = viewRef.current;
    if (!view || !contextMenu.spelling) return;

    const { from, to } = contextMenu.spelling;
    view.dispatch({
      changes: { from, to, insert: suggestion },
      selection: { anchor: from + suggestion.length },
    });
    closeContextMenu();
    view.focus();
  }, [closeContextMenu, contextMenu.spelling, viewRef]);

  const handleInsertTimestamp = useCallback(() => {
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
  }, [closeContextMenu, viewRef]);

  const handleInsertDate = useCallback(() => {
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
  }, [closeContextMenu, viewRef]);

  const makeCalendarItem = useCallback((repeating: boolean, callback?: () => void) => {
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
  }, [closeContextMenu, viewRef]);

  const handleMakeCalendarItem = useCallback(() => {
    makeCalendarItem(false, onMakeCalendarItem);
  }, [makeCalendarItem, onMakeCalendarItem]);

  const handleMakeRepeatingCalendarItem = useCallback(() => {
    makeCalendarItem(true, onMakeRepeatingCalendarItem);
  }, [makeCalendarItem, onMakeRepeatingCalendarItem]);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClick = () => closeContextMenu();
    const handleScroll = () => closeContextMenu();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        viewRef.current?.focus();
      }
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu.visible, closeContextMenu, viewRef]);

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
