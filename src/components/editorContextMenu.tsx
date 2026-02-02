import { useState, useCallback, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import Typo from 'typo-js';
import { formatDate, formatTimestamp } from '../utils/timeUtil';
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
}

export function useEditorContextMenu({ viewRef, typoRef }: UseEditorContextMenuProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });

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
      await navigator.clipboard.writeText(selectedText);
      view.dispatch({
        changes: { from, to, insert: '' },
      });
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
      await navigator.clipboard.writeText(selectedText);
    }
    closeContextMenu();
    view.focus();
  }, [viewRef, closeContextMenu]);

  const handlePaste = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const text = await navigator.clipboard.readText();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    closeContextMenu();
    view.focus();
  }, [viewRef, closeContextMenu]);

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

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClick = () => closeContextMenu();
    const handleScroll = () => closeContextMenu();

    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu.visible, closeContextMenu]);

  return {
    contextMenu,
    handleContextMenu,
    handleCut,
    handleCopy,
    handlePaste,
    handleSelectAll,
    handleSpellingSuggestion,
    handleInsertTimestamp,
    handleInsertDate,
  };
}

interface EditorContextMenuProps {
  contextMenu: ContextMenuState;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onSpellingSuggestion: (suggestion: string) => void;
  onInsertTimestamp: () => void;
  onInsertDate: () => void;
}

export function EditorContextMenu({
  contextMenu,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onSpellingSuggestion,
  onInsertTimestamp,
  onInsertDate,
}: EditorContextMenuProps) {
  if (!contextMenu.visible) return null;

  return (
    <div
      className="fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {contextMenu.spelling && (
        <>
          <div className="px-4 py-1 text-xs text-red-400 font-medium">
            Misspelled: "{contextMenu.spelling.word}"
          </div>
          {contextMenu.spelling.suggestions.length > 0 ? (
            contextMenu.spelling.suggestions.map((suggestion, index) => (
              <button
                key={index}
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
        onClick={onCut}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Cut</span>
        <span className="text-slate-500 text-xs">Ctrl+X</span>
      </button>
      <button
        onClick={onCopy}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Copy</span>
        <span className="text-slate-500 text-xs">Ctrl+C</span>
      </button>
      <button
        onClick={onPaste}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Paste</span>
        <span className="text-slate-500 text-xs">Ctrl+V</span>
      </button>
      <div className="border-t border-slate-600 my-1" />
      <button
        onClick={onSelectAll}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Select All</span>
        <span className="text-slate-500 text-xs">Ctrl+A</span>
      </button>
      <div className="border-t border-slate-600 my-1" />
      <button
        onClick={onInsertTimestamp}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Insert Timestamp</span>
        <span className="text-slate-500 text-xs">Ctrl+T</span>
      </button>
      <button
        onClick={onInsertDate}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
      >
        <span>Insert Date</span>
        <span className="text-slate-500 text-xs">Ctrl+D</span>
      </button>
    </div>
  );
}
