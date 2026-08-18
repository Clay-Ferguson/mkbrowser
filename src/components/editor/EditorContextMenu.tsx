import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { EDITOR_MENU_ITEM, EDITOR_MENU_ITEM_ACCENT, EDITOR_MENU_ITEM_DISABLED, Z_MODAL } from '../../renderer/styles';
import type { ContextMenuState } from './useEditorContextMenu';

interface EditorContextMenuProps {
  contextMenu: ContextMenuState;
  onSave: () => void;
  /** Whether the Save item is shown — false in read-only views and during an AI review. */
  canSave: boolean;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onPasteLink: () => void;
  canPasteLink: boolean;
  onSelectAll: () => void;
  onSpellingSuggestion: (suggestion: string) => void;
  onInsertTimestamp: () => void;
  onInsertDate: () => void;
  onToggleThesaurus: () => void;
  /** Whether the thesaurus item is shown — only where the synonym strip can actually appear. */
  canToggleThesaurus: boolean;
  /** Current state of `settings.enableThesaurus`, which is what the item's wording flips on. */
  thesaurusEnabled: boolean;
  onMakeCalendarItem?: () => void;
  onMakeRepeatingCalendarItem?: () => void;
  isMarkdown?: boolean;
}

// Minimum gap (px) kept between the menu edge and the browser viewport on all sides.
const VIEWPORT_MARGIN = 8;

/**
 * Floating context menu for the CodeMirror editor. Renders at the right-click coordinates,
 * clamped so it stays fully within the viewport. Includes Save (writes the file without
 * leaving edit mode), standard edit actions (cut/copy/paste, select all), timestamp/date
 * insertion, optional spell-check suggestions, the thesaurus on/off switch, and
 * Markdown-only items (Paste Link, calendar item creation). Closes on outside click,
 * scroll, or Escape.
 */
export function EditorContextMenu({
  contextMenu,
  onSave,
  canSave,
  onCut,
  onCopy,
  onPaste,
  onPasteLink,
  canPasteLink,
  onSelectAll,
  onSpellingSuggestion,
  onInsertTimestamp,
  onInsertDate,
  onToggleThesaurus,
  canToggleThesaurus,
  thesaurusEnabled,
  onMakeCalendarItem,
  onMakeRepeatingCalendarItem,
  isMarkdown,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: contextMenu.x, top: contextMenu.y });

  // Clamp the menu inside the viewport once it has been measured, so a click
  // near the right/bottom edge does not push the menu off-screen. Runs before
  // paint to avoid a visible jump from the raw click position. Re-runs when the
  // spelling suggestions arrive, since they change the menu's height.
  useLayoutEffect(() => {
    if (!contextMenu.visible || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(contextMenu.x, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(contextMenu.y, maxTop)),
    });
  }, [contextMenu.visible, contextMenu.x, contextMenu.y, contextMenu.spelling?.suggestions]);

  // Focus the menu container (not an item) when it opens, so it is keyboard-
  // operable without visually highlighting the first item for mouse users.
  useEffect(() => {
    if (contextMenu.visible) {
      menuRef.current?.focus();
    }
  }, [contextMenu.visible]);

  // Arrow/Home/End keyboard navigation within the menu — moves focus between menu items.
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

    const target = items[next];
    if (!target) return;
    target.focus();
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
      {canSave && (
        <>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={onSave}
            className={EDITOR_MENU_ITEM}
            data-testid="editor-save"
          >
            Save
          </button>
          <div className="border-t border-slate-600 my-1" />
        </>
      )}
      {contextMenu.spelling && (
        <>
          <div className="px-4 py-1 text-xs text-red-400 font-medium">
            Misspelled: &quot;{contextMenu.spelling.word}&quot;
          </div>
          {contextMenu.spelling.suggestions === null ? (
            <div className="px-4 py-2 text-sm text-slate-500 italic">
              Finding suggestions…
            </div>
          ) : contextMenu.spelling.suggestions.length > 0 ? (
            contextMenu.spelling.suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                role="menuitem"
                tabIndex={-1}
                onClick={() => onSpellingSuggestion(suggestion)}
                className={EDITOR_MENU_ITEM_ACCENT}
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
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onCut}
        className={`${EDITOR_MENU_ITEM} flex items-center justify-between`}
      >
        <span>Cut</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+X</span>
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onCopy}
        className={`${EDITOR_MENU_ITEM} flex items-center justify-between`}
      >
        <span>Copy</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+C</span>
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onPaste}
        className={`${EDITOR_MENU_ITEM} flex items-center justify-between`}
      >
        <span>Paste</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+V</span>
      </button>
      {isMarkdown && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={onPasteLink}
          disabled={!canPasteLink}
          className={clsx('flex items-center justify-between', canPasteLink ? EDITOR_MENU_ITEM : EDITOR_MENU_ITEM_DISABLED)}
          data-testid="editor-paste-link"
        >
          <span>Paste Link</span>
        </button>
      )}
      <div className="border-t border-slate-600 my-1" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onSelectAll}
        className={`${EDITOR_MENU_ITEM} flex items-center justify-between`}
      >
        <span>Select All</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+A</span>
      </button>
      <div className="border-t border-slate-600 my-1" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onInsertTimestamp}
        className={`${EDITOR_MENU_ITEM} flex items-center justify-between`}
      >
        <span>Insert Timestamp</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+T</span>
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onInsertDate}
        className={`${EDITOR_MENU_ITEM} flex items-center justify-between`}
      >
        <span>Insert Date</span>
        <span className="text-slate-500 text-xs ml-4">Ctrl+D</span>
      </button>
      {/* The synonym strip's only control. Its own group: it changes a persisted setting
          rather than touching the document, unlike everything above it. */}
      {canToggleThesaurus && (
        <>
          <div className="border-t border-slate-600 my-1" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={onToggleThesaurus}
            className={EDITOR_MENU_ITEM}
            data-testid="editor-toggle-thesaurus"
          >
            {thesaurusEnabled ? 'Hide Thesaurus' : 'Show Thesaurus'}
          </button>
        </>
      )}
      {isMarkdown && (
        <>
          <div className="border-t border-slate-600 my-1" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={onMakeRepeatingCalendarItem}
            className={EDITOR_MENU_ITEM}
          >
            Calendar Item (Reps)
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={onMakeCalendarItem}
            className={EDITOR_MENU_ITEM}
          >
            Calendar Item
          </button>
        </>
      )}
    </div>
  );
}
