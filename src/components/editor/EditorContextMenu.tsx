import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Z_MODAL } from '../../utils/styles';
import type { ContextMenuState } from './useEditorContextMenu';

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

const VIEWPORT_MARGIN = 8;

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
  const [position, setPosition] = useState({ left: contextMenu.x, top: contextMenu.y });

  // Clamp the menu inside the viewport once it has been measured, so a click
  // near the right/bottom edge does not push the menu off-screen. Runs before
  // paint to avoid a visible jump from the raw click position.
  useLayoutEffect(() => {
    if (!contextMenu.visible || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(contextMenu.x, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(contextMenu.y, maxTop)),
    });
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

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
      style={{ left: position.left, top: position.top }}
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
