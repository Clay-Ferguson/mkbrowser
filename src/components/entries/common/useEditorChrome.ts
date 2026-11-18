import type { RefObject } from 'react';
import { useAS, toggleExpandedEditor, isEditUnmodified, setItemReviewing, setEnableThesaurus } from '../../../store';
import { saveSettings } from '../../../renderer/config';
import type { CodeMirrorEditorHandle } from '../../editor/CodeMirrorEditor';
import type { EditModeState } from './types';

interface UseEditorChromeOptions {
  path: string;
  edit: EditModeState;
  /**
   * The entry owns the whole pane (BrowseFile 'browse' mode): the editor is always expanded.
   *
   * See: (single_file_browsing.md#always-expanded-editing-alwaysexpandededitor)
   */
  alwaysExpandedEditor: boolean;
  /**
   * Fill the pane in *view* mode too when `alwaysExpandedEditor` is set, not just while editing.
   * Plain text wants this (its read-only CodeMirror would otherwise cap its height); rendered
   * Markdown keeps its natural, page-scrolled height until it is edited. Must agree with
   * BrowseFile's `fillsPane`.
   *
   * See: (single_file_browsing.md#always-expanded-editing-alwaysexpandededitor)
   */
  fillPaneWhenViewing?: boolean;
  /** Ends the edit session without saving (the entry may wrap edit.handleCancel with extra cleanup). */
  onCancel: () => void;
  /** The editing CodeMirrorEditor; the Thesaurus toggle hands focus back to it. */
  editorRef: RefObject<CodeMirrorEditorHandle | null>;
  /**
   * Whether the editing CodeMirrorEditor installs the thesaurus plugin — prose, not code:
   * `!isCodeLanguage(language)`, the same expression its extension list uses (the editing
   * editor is never read-only).
   *
   * See: (thesaurus_view.md#where-the-item-appears)
   */
  thesaurusCapable: boolean;
}

/**
 * The edit-session "chrome" shared by TextEntry and MarkdownEntry: expanded-editor layout,
 * the expand toggle, Escape-to-cancel, the base AI Rewrite rule, and the in-place review
 * wiring for CodeMirrorEditor, and the "Editing actions" menu's Thesaurus switch. Kept in one place so the two entries can't drift apart
 * (as the `showRewrite` rule once did). Entry-specific differences are explicit options.
 */
export function useEditorChrome({ path, edit, alwaysExpandedEditor, fillPaneWhenViewing = false, onCancel, editorRef, thesaurusCapable }: UseEditorChromeOptions) {
  const expandedEditor = useAS(s => s.settings.expandedEditor);
  const reviewing = useAS(s => s.items.get(path)?.reviewing ?? false);
  const rewrittenContent = useAS(s => s.items.get(path)?.rewrittenContent ?? null);
  // aiRewriteMode stays persisted when AI is turned off, so both flags must gate the button.
  const rewriteEnabled = useAS(s => s.aiConfig.aiEnabled && s.aiConfig.aiRewriteMode);
  const thesaurusEnabled = useAS(s => s.settings.enableThesaurus);
  // Only `BrowseFile` (single-file mode) mounts the synonym strip, and that is what
  // `browseFileName` being set means. Offering the switch in a folder-listing inline editor
  // would turn the feature on with nowhere for the synonyms to appear.
  // See: (single_file_browsing.md#the-deciding-state-browsefilename)
  // See: (thesaurus_view.md#where-the-item-appears)
  const singleFileMode = useAS(s => s.browseFileName !== null);

  // Expanded-editor mode: this entry is maximized to fill the browse area, so the shell,
  // content area, and editor all become nested flex columns (BrowseFile flexes the outer chain —
  // it is the only view that ever hosts a maximized editor).
  // See: (single_file_browsing.md#always-expanded-editing-alwaysexpandededitor)
  const editorExpanded = expandedEditor || alwaysExpandedEditor;
  const maximized = (editorExpanded && edit.isEditing) || (fillPaneWhenViewing && alwaysExpandedEditor);

  // Only exit edit mode on Escape when the content is unmodified (see isEditUnmodified for the
  // TOC-stripping rule). If the user has typed something, Escape falls through to CodeMirror
  // (e.g. to dismiss autocomplete).
  // See: (USER_GUIDE.md#editor-keyboard-shortcuts)
  const handleEscape = () => {
    // Read the edit buffer at call time — the editor flushes its debounced onChange right
    // before invoking onEscape, so this render's edit.editContent may predate the flush.
    if (isEditUnmodified(useAS.getState().items.get(path))) {
      onCancel();
    }
  };

  // Flips the preference AND moves the editor to match: expanding hands this
  // file the whole pane via BrowseFile, collapsing drops back to the folder
  // listing with the editor still open inline.
  // See: (single_file_browsing.md#entering-single-file-mode-expanded-editing)
  // See: (USER_GUIDE.md#expand-editor)
  const handleToggleExpandedEditor = () => {
    toggleExpandedEditor(path);
    saveSettings();
  };

  // The thesaurus master switch (`settings.enableThesaurus`). It lives in a menu rather than
  // in the strip itself so that "off" can mean the strip renders nothing at all — a checkbox
  // inside it would have to keep a row of chrome on screen to stay clickable.
  //
  // Handing focus back to the editor is not just tidiness — the idle plugin schedules on
  // `focusChanged`, so it is what re-arms the countdown when the feature is switched on
  // mid-edit. Synonyms appear a couple of seconds later with no further gesture.
  // See: (thesaurus_view.md#the-onoff-switch-enablethesaurus)
  // See: (USER_GUIDE.md#thesaurus)
  const handleToggleThesaurus = () => {
    setEnableThesaurus(!thesaurusEnabled);
    editorRef.current?.focus();
    saveSettings();
  };

  return {
    editorExpanded,
    maximized,
    reviewing,
    handleEscape,
    /** Base rule for the AI Rewrite button; entries may AND in their own conditions. */
    canRewrite: !reviewing && rewriteEnabled,
    /** Spread into EntryEditToolbar. */
    toolbarProps: {
      expandedEditor: editorExpanded,
      // Omitted when the editor is always expanded — the toggle would be a
      // no-op, so the "Expanded Editor" menu item is disabled (shown checked).
      onToggleExpandedEditor: alwaysExpandedEditor ? undefined : handleToggleExpandedEditor,
      showSaveCancel: !reviewing,
      saving: edit.saving,
      thesaurusEnabled,
      onToggleThesaurus: thesaurusCapable && singleFileMode ? handleToggleThesaurus : undefined,
    },
    /** Spread into the editing CodeMirrorEditor. */
    reviewProps: {
      reviewText: reviewing ? rewrittenContent : null,
      onReviewComplete: (finalText: string) => {
        edit.setEditContent(finalText);
        setItemReviewing(path, false);
      },
      onReviewCancel: () => setItemReviewing(path, false),
    },
  };
}
