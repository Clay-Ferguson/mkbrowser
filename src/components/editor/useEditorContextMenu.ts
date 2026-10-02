import { useState, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import Typo from 'typo-js';
import { logger } from '../../shared/logUtil';
import { formatDate, formatTimestamp } from '../../shared/timeUtil';
import { isMarkdownFile } from '../../shared/fileTypes';
import { buildMarkdownLinks } from '../../renderer/linkUtil';
import { saveSettings } from '../../renderer/config';
import { useAS, setEnableThesaurus } from '../../store';
import { wordAt, isSpellCheckExempt, type SpellingSuggestion } from './spellChecker';
import { OBJECT_TYPE_OPTIONS, objectTemplate } from '../objects/objectRegistry';
import { objectInsertion } from '../../renderer/editor/editorObjectUtil';

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  spelling?: SpellingSuggestion;
  /**
   * Set once "Insert Object" has been clicked: the menu then shows the list of object types
   * in place of its normal items. Cleared whenever the menu is opened afresh.
   */
  submenu?: 'insertObject';
}

interface UseEditorContextMenuProps {
  viewRef: React.RefObject<EditorView | null>;
  typoRef: React.RefObject<Typo | null>;
  fileName?: string;
  filePath?: string;
  onSave?: () => void;
  /**
   * Whether this editor is one the thesaurus plugin was installed into — live prose only,
   * the same gate `CodeMirrorEditor` applies when building its extension list. False here
   * hides the Enable/Disable Thesaurus item, since toggling a setting no plugin is reading
   * would do nothing.
   */
  thesaurusCapable?: boolean;
}

/**
 * Manages state and event handlers for the editor's right-click context menu.
 *
 * On right-click, checks whether the cursor lands on a misspelled word (using the same
 * tokenisation as the spell-check decorations) and surfaces spelling suggestions at the
 * top of the menu. Also exposes save-in-place, cut/copy/paste, select-all, timestamp/date
 * insertion, the thesaurus on/off switch, and — for Markdown files — "Paste Link" and
 * "Insert Object" (which swaps the menu for a list of the registered object types).
 *
 * Returns everything `EditorContextMenu` and `CodeMirrorEditor` need: the menu's
 * visibility/position state, all action handlers, and derived flags (`isMarkdown`,
 * `canPasteLink`, `canSave`, `canToggleThesaurus`, `thesaurusEnabled`).
 */
export function useEditorContextMenu({ viewRef, typoRef, fileName, filePath, onSave, thesaurusCapable = false }: UseEditorContextMenuProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const selectedLinkItems = useAS(s => s.selectedLinkItems);
  const thesaurusEnabled = useAS(s => s.settings.enableThesaurus);
  // Only `BrowseFile` (single-file mode) mounts the synonym strip, and that is what
  // `browseFileName` being set means. Offering the switch in a folder-listing inline editor
  // would turn the feature on with nowhere for the synonyms to appear.
  const singleFileMode = useAS(s => s.browseFileName !== null);

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  // Converts the click coordinates to a document position, checks whether that position
  // falls inside a misspelled word, and opens the menu with spelling suggestions when it does.
  //
  // Only the misspelling *check* runs before the menu opens — it's a hash lookup and costs
  // nothing. `typo.suggest()` is an edit-distance-2 search that blocks for ~70-400ms on a
  // word it hasn't seen before (it memoizes per word, which is why only the first click on
  // a word ever felt slow). Running it here would hold up the menu's first paint, so the
  // menu opens immediately with `suggestions: null` and the search is deferred to after
  // paint: rAF fires just before the frame that shows the menu, and the zero-delay timeout
  // queued inside it runs right after that frame is on screen.
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
        if (found && found.word.length >= 2 && !typo.check(found.word) && !isSpellCheckExempt(view.state, line.from + found.from)) {
          spelling = {
            word: found.word,
            from: line.from + found.from,
            to: line.from + found.to,
            suggestions: null,
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

    if (spelling && typo) {
      const { word } = spelling;
      requestAnimationFrame(() => {
        setTimeout(() => {
          const suggestions = typo.suggest(word, 5); // Get up to 5 suggestions
          // Fill the suggestions in, unless the menu has since closed or moved to
          // a different word.
          setContextMenu(prev =>
            prev.visible && prev.spelling?.word === word && prev.spelling.suggestions === null
              ? { ...prev, spelling: { ...prev.spelling, suggestions } }
              : prev
          );
        }, 0);
      });
    }
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

  // "Save" — unlike Ctrl+S (save and exit), this writes the file and leaves the user in the
  // editor. The menu is closed and focus handed back to the editor first, so the caller's save
  // (and its green saved-flash) runs against an already-focused editor the user can keep typing in.
  const handleSave = () => {
    const view = viewRef.current;
    closeContextMenu();
    view?.focus();
    onSave?.();
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

  // "Insert Object" — swaps the open menu's items for the list of object types. The menu stays
  // where it is; only its content changes.
  const handleOpenInsertObject = () => {
    setContextMenu(prev => ({ ...prev, submenu: 'insertObject' }));
  };

  // Inserts an empty block of the picked type at the cursor and leaves the cursor on its
  // first field.
  const handleInsertObject = (type: string) => {
    const view = viewRef.current;
    const template = objectTemplate(type);
    if (!view || !template) return;

    view.dispatch(objectInsertion(view.state, template));
    closeContextMenu();
    view.focus();
  };

  // The thesaurus master switch (`settings.enableThesaurus`). It lives here rather than in
  // the strip itself so that "off" can mean the strip renders nothing at all — a checkbox
  // inside it would have to keep a row of chrome on screen to stay clickable.
  //
  // Handing focus back to the editor is not just tidiness — the idle plugin schedules on
  // `focusChanged`, so it is what re-arms the countdown when the feature is switched on
  // mid-edit. Synonyms appear a couple of seconds later with no further gesture.
  const handleToggleThesaurus = () => {
    const view = viewRef.current;
    setEnableThesaurus(!thesaurusEnabled);
    closeContextMenu();
    view?.focus();
    saveSettings();
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
    handleSave,
    canSave: !!onSave,
    handleCut,
    handleCopy,
    handlePaste,
    handlePasteLink,
    canPasteLink: !!filePath && selectedLinkItems.length > 0,
    handleSelectAll,
    handleSpellingSuggestion,
    handleInsertTimestamp,
    handleInsertDate,
    handleOpenInsertObject,
    handleInsertObject,
    objectTypes: OBJECT_TYPE_OPTIONS,
    handleToggleThesaurus,
    canToggleThesaurus: thesaurusCapable && singleFileMode,
    thesaurusEnabled,
    isMarkdown,
  };
}
