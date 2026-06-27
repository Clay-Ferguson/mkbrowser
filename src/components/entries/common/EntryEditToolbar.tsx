import type { ReactNode } from 'react';
import { ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import { BUTTON_CLASS_SM_BLUE, BUTTON_CLASS_SM_RED, BUTTON_CLASS_SM_PURPLE, ENTRY_EDITOR_ICON_BTN } from '../../../utils/styles';

interface EntryEditToolbarProps {
  /** Whether the editor is in expanded mode. */
  expandedEditor: boolean;
  /** Toggle the expanded editor. */
  onToggleExpandedEditor: () => void;

  /** Whether to show the AI Rewrite button. */
  showRewrite: boolean;
  onAiRewrite: () => void;
  /** Disable the rewrite button (saving / rewrite already in flight). */
  rewriteDisabled: boolean;
  /** Whether a rewrite is in flight (drives the button label). */
  isRewriting: boolean;
  /** Selected prompt/persona name, shown in the rewrite button title. */
  selectedPromptName: string;
  /** Whether there's an active editor selection (drives label/title). */
  hasSelection: boolean;

  /** Whether to show the Cancel/Save pair (hidden during review). */
  showSaveCancel: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;

  /** Entry-specific buttons rendered before the expand button (e.g. props/tags/calendar). */
  leftExtras?: ReactNode;
  /** Entry-specific buttons rendered between AI Rewrite and Cancel/Save (e.g. Ask AI). */
  middleExtras?: ReactNode;
}

/**
 * The shared edit-mode toolbar for editable entries (Text/Markdown). Renders
 * the expand/collapse editor button, the AI Rewrite button, and the
 * Cancel/Save pair — all of which were duplicated across TextEntry and
 * MarkdownEntry. Entry-specific buttons are supplied via the `leftExtras` and
 * `middleExtras` slots.
 */
export function EntryEditToolbar({
  expandedEditor,
  onToggleExpandedEditor,
  showRewrite,
  onAiRewrite,
  rewriteDisabled,
  isRewriting,
  selectedPromptName,
  hasSelection,
  showSaveCancel,
  saving,
  onCancel,
  onSave,
  leftExtras,
  middleExtras,
}: EntryEditToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      {leftExtras}
      <button
        type="button"
        onClick={onToggleExpandedEditor}
        title={expandedEditor ? 'Collapse editor' : 'Expand editor'}
        className={ENTRY_EDITOR_ICON_BTN}
        data-testid="entry-editor-expand-toggle-button"
      >
        {expandedEditor
          ? <ArrowsPointingInIcon className="w-5 h-5" />
          : <ArrowsPointingOutIcon className="w-5 h-5" />}
      </button>
      {showRewrite && (
        <button
          type="button"
          onClick={onAiRewrite}
          disabled={rewriteDisabled}
          title={selectedPromptName ? `Rewrite as ${selectedPromptName}` : (hasSelection ? 'Rewrite selected text' : 'Rewrite')}
          className={BUTTON_CLASS_SM_PURPLE}
          data-testid="entry-editor-ai-rewrite-button"
        >
          {isRewriting ? 'Rewriting with AI...' : (hasSelection ? 'AI Rewrite Selection' : 'AI Rewrite')}
        </button>
      )}
      {middleExtras}
      {showSaveCancel && (
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={BUTTON_CLASS_SM_RED}
            data-testid="entry-cancel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className={BUTTON_CLASS_SM_BLUE}
            data-testid="entry-save-button"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
}
