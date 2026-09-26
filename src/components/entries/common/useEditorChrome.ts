import { useAS, toggleExpandedEditor, isEditUnmodified, setItemReviewing } from '../../../store';
import { saveSettings } from '../../../renderer/config';
import type { EditModeState } from './types';

interface UseEditorChromeOptions {
  path: string;
  edit: EditModeState;
  /** The entry owns the whole pane (BrowseFile 'browse' mode): the editor is always expanded. */
  alwaysExpandedEditor: boolean;
  /**
   * Fill the pane in *view* mode too when `alwaysExpandedEditor` is set, not just while editing.
   * Plain text wants this (its read-only CodeMirror would otherwise cap its height); rendered
   * Markdown keeps its natural, page-scrolled height until it is edited. Must agree with
   * BrowseFile's `fillsPane`.
   */
  fillPaneWhenViewing?: boolean;
  /** Ends the edit session without saving (the entry may wrap edit.handleCancel with extra cleanup). */
  onCancel: () => void;
}

/**
 * The edit-session "chrome" shared by TextEntry and MarkdownEntry: expanded-editor layout,
 * the expand toggle, Escape-to-cancel, the base AI Rewrite rule, and the in-place review
 * wiring for CodeMirrorEditor. Kept in one place so the two entries can't drift apart
 * (as the `showRewrite` rule once did). Entry-specific differences are explicit options.
 */
export function useEditorChrome({ path, edit, alwaysExpandedEditor, fillPaneWhenViewing = false, onCancel }: UseEditorChromeOptions) {
  const expandedEditor = useAS(s => s.settings.expandedEditor);
  const reviewing = useAS(s => s.items.get(path)?.reviewing ?? false);
  const rewrittenContent = useAS(s => s.items.get(path)?.rewrittenContent ?? null);
  // aiRewriteMode stays persisted when AI is turned off, so both flags must gate the button.
  const rewriteEnabled = useAS(s => s.aiConfig.aiEnabled && s.aiConfig.aiRewriteMode);

  // Expanded-editor mode: this entry is maximized to fill the browse area, so the shell,
  // content area, and editor all become nested flex columns (BrowseFile flexes the outer chain —
  // it is the only view that ever hosts a maximized editor).
  const editorExpanded = expandedEditor || alwaysExpandedEditor;
  const maximized = (editorExpanded && edit.isEditing) || (fillPaneWhenViewing && alwaysExpandedEditor);

  // Only exit edit mode on Escape when the content is unmodified (see isEditUnmodified for the
  // TOC-stripping rule). If the user has typed something, Escape falls through to CodeMirror
  // (e.g. to dismiss autocomplete).
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
  const handleToggleExpandedEditor = () => {
    toggleExpandedEditor(path);
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
      // no-op, so the button is hidden rather than shown doing nothing.
      onToggleExpandedEditor: alwaysExpandedEditor ? undefined : handleToggleExpandedEditor,
      showSaveCancel: !reviewing,
      saving: edit.saving,
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
