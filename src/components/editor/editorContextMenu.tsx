import { useState, useCallback, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import Typo from 'typo-js';
import { logger } from '../../utils/logUtil';
import { formatDate, formatTimestamp } from '../../utils/timeUtil';
import { isMarkdownFile, hasDueProperty, injectCalendarFrontMatter } from '../../utils/calendar/calendarUtil';
import { buildMarkdownLinks } from '../../utils/linkUtil';
import { Z_MODAL } from '../../utils/styles';
import { useSelectedLinkItems } from '../../store';
import type { SpellingSuggestion } from './spellChecker';

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
        // Find the word at this position
        const line = view.state.doc.lineAt(pos);
        const lineText = line.text;
        const posInLine = pos - line.from;

        // Find word boundaries
        let wordStart = posInLine;
        let wordEnd = posInLine;

        // Expand left to find word start
        while (wordStart > 0 && /[a-zA-Z']/.test(lineText[wordStart - 1])) {
          wordStart--;
        }

        // Expand right to find word end
        while (wordEnd < lineText.length && /[a-zA-Z']/.test(lineText[wordEnd])) {
          wordEnd++;
        }

        if (wordEnd > wordStart) {
          const word = lineText.slice(wordStart, wordEnd);
          // Check if it's misspelled
          if (word.length >= 2 && !typo.check(word)) {
            const suggestions = typo.suggest(word, 5); // Get up to 5 suggestions
            spelling = {
              word,
              from: line.from + wordStart,
              to: line.from + wordEnd,
              suggestions,
            };
          }
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
  }, [viewRef, closeContextMenu]);

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
  }, [viewRef, closeContextMenu]);

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
  }, [viewRef, closeContextMenu]);

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
  }, [viewRef, filePath, selectedLinkItems, closeContextMenu]);

  const handleSelectAll = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
    });
    closeContextMenu();
    view.focus();
  }, [viewRef, closeContextMenu]);

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
  }, [viewRef, closeContextMenu, contextMenu.spelling]);

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
  }, [viewRef, closeContextMenu]);

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
  }, [viewRef, closeContextMenu]);

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
  }, [viewRef, closeContextMenu]);

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

interface EditorContextMenuProps {
  contextMenu: ContextMenuState;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onPasteLink: () => void;
  canPasteLink: boolean;
  onSelectAll: () => void;
  onSpellingSuggestion: (suggestion: string) => void;
  onInsertTimestamp: () => void;
  onInsertDate: () => void;
  onMakeCalendarItem?: () => void;
  onMakeRepeatingCalendarItem?: () => void;
  isMarkdown?: boolean;
}

export function EditorContextMenu({
  contextMenu,
  onCut,
  onCopy,
  onPaste,
  onPasteLink,
  canPasteLink,
  onSelectAll,
  onSpellingSuggestion,
  onInsertTimestamp,
  onInsertDate,
  onMakeCalendarItem,
  onMakeRepeatingCalendarItem,
  isMarkdown,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the menu container (not an item) when it opens, so it is keyboard-
  // operable without visually highlighting the first item for mouse users.
  useEffect(() => {
    if (contextMenu.visible) {
      menuRef.current?.focus();
    }
  }, [contextMenu.visible]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = current < items.length - 1 ? current + 1 : 0;
    else next = current > 0 ? current - 1 : items.length - 1;

    items[next].focus();
  };

  if (!contextMenu.visible) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Editor context menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={`fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 ${Z_MODAL} min-w-[140px] focus:outline-none [&_button:focus]:outline-none [&_button:focus-visible]:bg-slate-700`}
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {contextMenu.spelling && (
        <>
          <div className="px-4 py-1 text-xs text-red-400 font-medium">
            Misspelled: "{contextMenu.spelling.word}"
          </div>
          {contextMenu.spelling.suggestions.length > 0 ? (
            contextMenu.spelling.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                role="menuitem"
                tabIndex={-1}
                onClick={() => onSpellingSuggestion(suggestion)}
                className="w-full px-4 py-2 text-left text-sm text-blue-300 hover:bg-slate-700"
              >
                {suggestion}
              </button>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-slate-500 italic">
              No suggestions available
            </div>
          )}
          <div className="border-t border-slate-600 my-1" />
        </>
      )}
      <button
        role="menuitem"
        tabIndex={-1}
        onClick={onCut}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Cut</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+X</span>
      </button>
      <button
        role="menuitem"
        tabIndex={-1}
        onClick={onCopy}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Copy</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+C</span>
      </button>
      <button
        role="menuitem"
        tabIndex={-1}
        onClick={onPaste}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Paste</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+V</span>
      </button>
      {isMarkdown && (
        <button
          role="menuitem"
          tabIndex={-1}
          onClick={onPasteLink}
          disabled={!canPasteLink}
          className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between ${canPasteLink ? 'text-slate-200 hover:bg-slate-700' : 'text-slate-500 cursor-not-allowed'}`}
          data-testid="editor-paste-link"
        >
          <span>Paste Link</span>
        </button>
      )}
      <div className="border-t border-slate-600 my-1" />
      <button
        role="menuitem"
        tabIndex={-1}
        onClick={onSelectAll}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Select All</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+A</span>
      </button>
      <div className="border-t border-slate-600 my-1" />
      <button
        role="menuitem"
        tabIndex={-1}
        onClick={onInsertTimestamp}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Insert Timestamp</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+T</span>
      </button>
      <button
        role="menuitem"
        tabIndex={-1}
        onClick={onInsertDate}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Insert Date</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+D</span>
      </button>
      {isMarkdown && (
        <>
          <div className="border-t border-slate-600 my-1" />
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={onMakeRepeatingCalendarItem}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
          >
            Calendar Item (Reps)
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={onMakeCalendarItem}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
          >
            Calendar Item
          </button>
        </>
      )}
    </div>
  );
}
