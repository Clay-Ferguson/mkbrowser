import { useRef, useState, type ReactNode } from 'react';
import { Bars3Icon, CubeIcon } from '@heroicons/react/24/outline';
import { BUTTON_CLASS_SM_GREEN_MUTED, BUTTON_CLASS_SM_NEUTRAL_OUTLINED, BUTTON_CLASS_SM_PURPLE, ENTRY_EDITOR_ICON_BTN } from '../../../renderer/styles';
import ActiveEditPopupMenu from '../../menus/ActiveEditPopupMenu';
import InsertObjectPopupMenu from '../../menus/InsertObjectPopupMenu';
import { useAS } from '../../../store';
import { objectTypeOptions } from '../../../shared/objects/userTypes';

interface EntryEditToolbarProps {
  /** Whether the editor is in expanded mode — the "Expanded Editor" item's check mark (ActiveEditPopupMenu). */
  expandedEditor: boolean;
  /**
   * Toggle the expanded editor, from the "Editing actions" menu's "Expanded Editor" item.
   * Omit for callers whose editor is always expanded and where the toggle would therefore
   * be a no-op (see `alwaysExpandedEditor`); the item is then shown disabled.
   *
   * See: (single_file_browsing.md#always-expanded-editing-alwaysexpandededitor)
   */
  onToggleExpandedEditor?: () => void;

  /** Whether to show the AI Rewrite button. */
  showRewrite: boolean;
  /** Callback to trigger the AI rewrite operation. */
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
  /** Whether a save is in progress (disables both Cancel and Save buttons). */
  saving: boolean;
  /** Cancel handler — exits edit mode without saving. */
  onCancel: () => void;
  /** Save handler — persists the current editor content to disk. */
  onSave: () => void;

  /**
   * Opens the Calendar Info dialog, from the "Editing actions" hamburger menu
   * (ActiveEditPopupMenu). Omit for entries without calendar info; the item is then disabled.
   */
  onCalendarInfo?: () => void;

  /** Current `settings.enableThesaurus`, the "Thesaurus" item's check mark (ActiveEditPopupMenu). */
  thesaurusEnabled: boolean;
  /**
   * Flips the thesaurus on/off, from the "Editing actions" menu. Omitted where the synonym
   * strip can't appear; the item is then disabled. Supplied by useEditorChrome's toolbarProps.
   *
   * See: (thesaurus_view.md#where-the-item-appears)
   */
  onToggleThesaurus?: () => void;

  /**
   * Inserts an object of the picked type into the file's front matter, from the Insert Object
   * (cube) button's menu (InsertObjectPopupMenu). Omit where objects don't apply (non-Markdown
   * files); the button is then not shown.
   *
   * See: (USER_GUIDE.md#inserting-an-object-into-a-document)
   */
  onInsertObject?: (type: string) => void;

  /** Entry-specific buttons rendered first, before AI Rewrite (e.g. props/tags). */
  leftExtras?: ReactNode;
  /** Entry-specific buttons rendered between AI Rewrite and Cancel/Save (e.g. Ask AI). */
  middleExtras?: ReactNode;
}

/**
 * The shared edit-mode toolbar for editable entries (Text/Markdown). Renders
 * the AI Rewrite button, the "Editing actions" menu, and the Cancel/Save pair
 * — all of which were duplicated across TextEntry and MarkdownEntry. Entry-specific buttons are supplied via the `leftExtras` and
 * `middleExtras` slots.
 *
 * Just left of Cancel/Save sits an "Editing actions" hamburger opening
 * ActiveEditPopupMenu — the edit-mode counterpart of EntryActionBar's
 * EntryPopupMenu, which isn't shown while editing. Like Cancel/Save it is
 * hidden during an AI review. The expand/collapse toggle lives there as the
 * checkable "Expanded Editor" item.
 *
 * Left of the hamburger, when `onInsertObject` is given (Markdown), sits the Insert Object
 * (cube) button opening InsertObjectPopupMenu, the list of user-defined object types. It is
 * hidden during an AI review too, since inserting would edit the document under review.
 *
 * See: (USER_GUIDE.md#editing-files)
 * See: (USER_GUIDE.md#inserting-an-object-into-a-document)
 * See: (popup_menus.md#menus-inside-clickable-rows)
 * See: (USER_GUIDE.md#how-to-use-rewrite)
 * See: (USER_GUIDE.md#expand-editor)
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
  onCalendarInfo,
  thesaurusEnabled,
  onToggleThesaurus,
  onInsertObject,
  leftExtras,
  middleExtras,
}: EntryEditToolbarProps) {
  // Open flag and anchor for the "Editing actions" menu. See: (popup_menus.md#step-2-add-the-trigger-button-and-menu-to-the-parent-component)
  const [showMenu, setShowMenu] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Open flag and anchor for the Insert Object menu, and the types it lists (Types Editor).
  const [showInsertObjectMenu, setShowInsertObjectMenu] = useState(false);
  const insertObjectButtonRef = useRef<HTMLButtonElement>(null);
  const typeDefs = useAS(s => s.typeDefs);
  const objectTypes = objectTypeOptions(typeDefs);

  return (
    <>
    <div className="flex items-center gap-2">
      {leftExtras}
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
          {onInsertObject && (
            <button
              ref={insertObjectButtonRef}
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowInsertObjectMenu(prev => !prev); }}
              className={ENTRY_EDITOR_ICON_BTN}
              title="Insert object"
              aria-label="Insert object"
              data-testid="insert-object-menu-button"
            >
              <CubeIcon className="w-5 h-5" />
            </button>
          )}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowMenu(prev => !prev); }}
            className={ENTRY_EDITOR_ICON_BTN}
            title="Editing actions"
            aria-label="Editing actions"
            data-testid="active-edit-menu-button"
          >
            <Bars3Icon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={BUTTON_CLASS_SM_NEUTRAL_OUTLINED}
            data-testid="entry-cancel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className={BUTTON_CLASS_SM_GREEN_MUTED}
            data-testid="entry-save-button"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
    </div>
    {/* `showSaveCancel` also gates the menu, so a review starting while it's open closes it.
        Propagation is stopped so menu clicks don't reach the entry header's handlers. */}
    {showMenu && showSaveCancel && (
      <div
        className="contents"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <ActiveEditPopupMenu
          anchorRef={menuButtonRef}
          onClose={() => setShowMenu(false)}
          onCalendarInfo={onCalendarInfo}
          expandedEditor={expandedEditor}
          onToggleExpandedEditor={onToggleExpandedEditor}
          thesaurusEnabled={thesaurusEnabled}
          onToggleThesaurus={onToggleThesaurus}
        />
      </div>
    )}
    {showInsertObjectMenu && showSaveCancel && onInsertObject && (
      <div
        className="contents"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <InsertObjectPopupMenu
          anchorRef={insertObjectButtonRef}
          onClose={() => setShowInsertObjectMenu(false)}
          objectTypes={objectTypes}
          onInsertObject={onInsertObject}
        />
      </div>
    )}
    </>
  );
}
