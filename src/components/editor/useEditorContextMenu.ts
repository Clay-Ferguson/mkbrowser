import { useState, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import Typo from 'typo-js';
import { logger } from '../../shared/logUtil';
import { formatDate, formatTimestamp } from '../../shared/timeUtil';
import { isMarkdownFile } from '../../shared/fileTypes';
import { saveSettings } from '../../renderer/config';
import { useAS, setEnableThesaurus, setWordWrap, setShowPropsInEditor } from '../../store';
import { wordAt, isSpellCheckExempt, type SpellingSuggestion } from './spellChecker';
import { objectTypeOptions, planObjectInsertion } from '../../shared/objects/userTypes';
import { api } from '../../renderer/api';
import { clipboardLinkCandidates, formatFileLink } from '../../renderer/linkUtil';
import { resolveLinkTargetId } from '../../renderer/linkRepair';
import { getFileName } from '../../renderer/pathUtil';

/** An existing file or folder named by the clipboard text, offered by "Paste Link". */
export interface PasteLinkTarget {
  /** Absolute path of the file or folder. */
  targetPath: string;
  /** Whether `targetPath` is a folder. */
  isDirectory: boolean;
  /** Heading slug from a `file.md#slug` clipboard text, or null. */
  fragment: string | null;
  /** Raw (still escaped) label of a `[label](path)` clipboard link — e.g. the heading text — or null for a bare path. */
  label: string | null;
}

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
  /**
   * Set (shortly after the menu opens) when the clipboard holds the path of an existing file
   * or folder, which shows the "Paste Link" item. Cleared whenever the menu is opened afresh.
   */
  pasteLink?: PasteLinkTarget;
  /** Whether the editor had a non-empty selection when the menu opened — shows "Make Link". */
  hasSelection?: boolean;
}

/**
 * Resolves to the existing file or folder the clipboard text names, if any: a Markdown link
 * `[Heading](docs/file.md#slug)` (as copied by right-clicking a rendered heading) or a bare
 * path (as copied by the index tree's "Copy Path"), either one relative to the browsing root
 * or absolute, with an optional heading slug. Resolves to null otherwise, including when the
 * clipboard can't be read; never rejects.
 */
async function findClipboardLinkTarget(rootPath: string): Promise<PasteLinkTarget | null> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (err) {
    logger.warn('Failed to read from clipboard:', err);
    return null;
  }
  const parsed = clipboardLinkCandidates(text, rootPath);
  if (!parsed) return null;
  for (const path of parsed.paths) {
    if (await api.pathExists(path)) {
      return { targetPath: path, isDirectory: await api.isDirectory(path), fragment: parsed.fragment, label: parsed.label };
    }
  }
  return null;
}

/** Replaces `view`'s selection with `text`, leaving the cursor after it, and focuses the editor. */
function insertAtSelection(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

interface UseEditorContextMenuProps {
  viewRef: React.RefObject<EditorView | null>;
  typoRef: React.RefObject<Typo | null>;
  /** Absolute path of the file being edited; enables the Markdown-only items. */
  filePath?: string;
  /** Whether the editor accepts edits — false hides "Paste Link". */
  editable?: boolean;
  onSave?: () => void;
  /**
   * Whether this editor is one the thesaurus plugin was installed into — live prose only,
   * the same gate `CodeMirrorEditor` applies when building its extension list. False here
   * hides the Enable/Disable Thesaurus item, since toggling a setting no plugin is reading
   * would do nothing.
   */
  thesaurusCapable?: boolean;
  /**
   * Shows the front matter in this editor right away (reconfigures its front-matter
   * compartment), ahead of the store setting catching up. Insert Object needs it before it
   * writes there — see handleInsertObject.
   */
  revealFrontMatter?: () => void;
  /**
   * Offered the clipboard text first on Paste; returns true when it took the paste over (a
   * URL headed for the "Insert link" dialog — see useUrlPaste), so Paste inserts nothing.
   */
  interceptPaste?: (text: string) => boolean;
  /** "Make Link": opens the "Insert link" dialog for the selection (see useUrlPaste). Omitted where links can't be made. */
  makeLink?: () => void;
}

/**
 * Manages state and event handlers for the editor's right-click context menu.
 *
 * On right-click, checks whether the cursor lands on a misspelled word (using the same
 * tokenisation as the spell-check decorations) and surfaces spelling suggestions at the
 * top of the menu. Also exposes save-in-place, cut/copy/paste, "Paste Link" (when the clipboard names an existing file), select-all, timestamp/date
 * insertion, the word-wrap and thesaurus on/off switches, and — for Markdown files — "Insert Object" (which swaps the menu for a list of the user-defined object types from the Types Editor, and adds the picked one to the file's front matter).
 *
 * Returns everything `EditorContextMenu` and `CodeMirrorEditor` need: the menu's
 * visibility/position state, all action handlers, and derived flags (`isMarkdown`,
 * `canSave`, `canToggleThesaurus`, `thesaurusEnabled`, `wordWrap`).
 */
export function useEditorContextMenu({ viewRef, typoRef, filePath, editable = true, onSave, thesaurusCapable = false, revealFrontMatter, interceptPaste, makeLink }: UseEditorContextMenuProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  // Why Insert Object refused (e.g. the file already holds an object of another type); shown in an alert.
  const [insertObjectError, setInsertObjectError] = useState<string | null>(null);
  // A "Paste Link" to a file with no id, waiting on the user's choice of whether to add
  // one (see AddLinkIdDialog).
  const [pendingIdLink, setPendingIdLink] = useState<PasteLinkTarget | null>(null);
  const thesaurusEnabled = useAS(s => s.settings.enableThesaurus);
  const wordWrap = useAS(s => s.settings.wordWrap);
  // Only `BrowseFile` (single-file mode) mounts the synonym strip, and that is what
  // `browseFileName` being set means. Offering the switch in a folder-listing inline editor
  // would turn the feature on with nowhere for the synonyms to appear.
  // See: (docs/technical_notes/features/single_file_browsing.md#the-deciding-state-browsefilename)
  const singleFileMode = useAS(s => s.browseFileName !== null);
  // The user-defined object types (Types Editor) that "Insert Object" offers.
  const typeDefs = useAS(s => s.typeDefs);

  const isMarkdown = !!filePath && isMarkdownFile(getFileName(filePath));

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

    const { clientX: x, clientY: y } = e;
    const hasSelection = !!view && !view.state.selection.main.empty;
    setContextMenu({ visible: true, x, y, spelling, hasSelection });

    // The clipboard check is async (a clipboard read plus a stat or two), so like the spelling
    // suggestions it fills in after the menu is up — unless the menu has since closed or reopened
    // elsewhere.
    if (isMarkdown && editable) {
      void findClipboardLinkTarget(useAS.getState().rootPath).then((pasteLink) => {
        if (!pasteLink) return;
        setContextMenu(prev => (prev.visible && prev.x === x && prev.y === y ? { ...prev, pasteLink } : prev));
      });
    }

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

      if (interceptPaste?.(text)) {
        closeContextMenu();
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

  // Inserts the "Paste Link" link to `target` carrying `id` (see formatFileLink).
  const insertPasteLink = (target: PasteLinkTarget, id: string) => {
    const view = viewRef.current;
    if (!view || !filePath) return;
    insertAtSelection(view, formatFileLink(filePath, target.targetPath, target.isDirectory, id, target.fragment, target.label));
  };

  // "Paste Link" — inserts a link to the file or folder the clipboard names (see
  // findClipboardLinkTarget), relative to this file, in place of the selection, keeping the
  // clipboard link's label (the heading text) when it had one. An image becomes an inline
  // image. A Markdown target's front-matter id goes in the link title; any other file's id
  // is part of its name (`report--3D6B20DDF.pdf`). When the file has no id the user is first
  // asked whether to add one (pendingIdLink → AddLinkIdDialog), unless it can't be given one
  // (see resolveLinkTargetId). A folder just gets a plain link.
  const handlePasteMarkdownLink = () => {
    const target = contextMenu.pasteLink;
    closeContextMenu();
    if (!viewRef.current || !target || !filePath) return;

    if (target.isDirectory) {
      insertPasteLink(target, '');
      return;
    }
    void resolveLinkTargetId(target.targetPath).then(({ id, needsConsent }) => {
      if (needsConsent) setPendingIdLink(target);
      else insertPasteLink(target, id);
    });
  };

  // The ID dialog's choice: the id to put in the link title ('' for none) and where the
  // target now is (a non-Markdown file is renamed to carry its id).
  const handleIdLinkChosen = (id: string, targetPath: string) => {
    if (pendingIdLink) insertPasteLink({ ...pendingIdLink, targetPath }, id);
  };

  // Clears the pending "Paste Link" once the ID dialog closes, whatever the choice; a
  // dismissal links nothing and just hands focus back to the editor.
  const closeIdLinkDialog = () => {
    setPendingIdLink(null);
    viewRef.current?.focus();
  };

  // "Make Link" — turns the selection into a Markdown link via the "Insert link" dialog.
  const handleMakeLink = () => {
    closeContextMenu();
    makeLink?.();
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

  // Makes the file's front matter an object of the picked type (a file holds at most one object,
  // and it lives there): adds its `type:` line and every property the front matter doesn't have
  // yet, with a blank value, creating the front matter if needed. Existing values are kept, so
  // picking the type the file's object already is just fills in its missing properties. Refuses
  // — with an alert, changing nothing — when the file already holds an object of another type.
  //
  // The front matter is shown first, in this editor (revealFrontMatter) and in the setting, so
  // the user sees what was added; with it still hidden, the cursor guard would also clamp the
  // cursor out of the new lines. The cursor ends up on the first property, ready for its value.
  const handleInsertObject = (type: string) => {
    const view = viewRef.current;
    closeContextMenu();
    if (!view) return;

    const plan = planObjectInsertion(view.state.doc.toString(), typeDefs, type);
    if (!plan.ok) {
      setInsertObjectError(plan.error);
      return;
    }

    revealFrontMatter?.();
    setShowPropsInEditor(true);
    saveSettings();
    view.dispatch({
      changes: { from: plan.from, to: plan.to, insert: plan.insert },
      selection: { anchor: plan.cursor },
      scrollIntoView: true,
    });
    view.focus();
  };

  const closeInsertObjectError = () => {
    setInsertObjectError(null);
    viewRef.current?.focus();
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

  // Flips `settings.wordWrap`. Every mounted editor re-syncs its line-wrapping compartment
  // from the store, so the change applies everywhere at once, not just to this editor.
  const handleToggleWordWrap = () => {
    const view = viewRef.current;
    setWordWrap(!wordWrap);
    closeContextMenu();
    view?.focus();
    saveSettings();
  };

  // Opens CodeMirror's built-in search panel (top of the editor, set up by `search({ top: true })`),
  // which has both the find and replace fields; it moves focus into the search field itself and
  // pre-fills it with the current selection, so the editor is deliberately not re-focused here.
  const handleSearchReplace = () => {
    const view = viewRef.current;
    closeContextMenu();
    if (view) openSearchPanel(view);
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

  return {
    contextMenu,
    handleContextMenu,
    handleSave,
    canSave: !!onSave,
    handleCut,
    handleCopy,
    handlePaste,
    handlePasteMarkdownLink,
    handleMakeLink,
    canMakeLink: makeLink !== undefined,
    handleSelectAll,
    handleSpellingSuggestion,
    handleInsertTimestamp,
    handleInsertDate,
    handleOpenInsertObject,
    handleInsertObject,
    objectTypes: objectTypeOptions(typeDefs),
    insertObjectError,
    closeInsertObjectError,
    pendingIdLink,
    handleIdLinkChosen,
    closeIdLinkDialog,
    handleToggleThesaurus,
    canToggleThesaurus: thesaurusCapable && singleFileMode,
    thesaurusEnabled,
    handleToggleWordWrap,
    wordWrap,
    handleSearchReplace,
    isMarkdown,
  };
}
