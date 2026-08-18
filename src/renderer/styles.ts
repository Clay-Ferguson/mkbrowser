import type { ContentWidth } from '../store';

/**
 * Shared Tailwind CSS class strings for consistent styling across components
 */

/**
 * Get Tailwind classes for content width based on setting
 */
export function getContentWidthClasses(contentWidth: ContentWidth): string {
  switch (contentWidth) {
    case 'narrow':
      return 'max-w-2xl mx-auto px-4';
    case 'medium':
      return 'max-w-4xl mx-auto px-4';
    case 'wide':
      return 'max-w-6xl mx-auto px-4';
    case 'full':
      return 'px-4';
    default:
      return 'max-w-4xl mx-auto px-4';
  }
}

export const CHECKBOX_CLASS = 'h-5 w-5 accent-blue-500 flex-shrink-0 cursor-pointer';

// Shared monospace font stack. Used for inline `fontFamily` styles in UI components
// (PropsDisplay, TagsPicker) and CodeMirror editor themes (editorTheme, editorDateUtil).
export const MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Checkbox/radio <input> styling for dialog form fields. DLG_CHECK_RADIO_BASE is
// the shared sizing/border/focus styling; compose it with a `text-blue-*` accent
// (and `rounded` for checkboxes). CHECKBOX_FIELD_CLASS / RADIO_FIELD_CLASS are the
// defaults used by the CheckboxField / RadioField common components.
export const DLG_CHECK_RADIO_BASE = 'w-4 h-4 border-slate-600 bg-slate-900 focus:ring-blue-500 focus:ring-offset-slate-800';
export const CHECKBOX_FIELD_CLASS = `${DLG_CHECK_RADIO_BASE} rounded text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed`;
export const RADIO_FIELD_CLASS = `${DLG_CHECK_RADIO_BASE} text-blue-600`;

// Larger slate-700 checkbox used by the Settings views (composed with CheckboxField).
export const SETTINGS_CHECKBOX_CLASS = 'w-5 h-5 bg-slate-700 border border-slate-600 rounded text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer';

/* ==========================================================================
   BUTTONS — every button color in the app is defined here.

   Components must not spell a raw Tailwind color on a button (`bg-blue-600`,
   `text-red-400`, …). Reuse one of the constants below, or add a new one built
   from the shared size/variant pieces. The colors themselves are the `btn-*`
   theme colors declared in `src/index.css` (@theme), so the whole button theme
   can be re-skinned by editing that one block.

   Composition: every export is `${BTN} ${size} ${variant}` — `BTN` carries the
   behavior (transition, cursor, disabled treatment), the size pieces carry
   padding/rounding/type scale, and the variant pieces carry color only.
   ========================================================================== */

/** Behavior shared by every button, regardless of size or color. */
const BTN = 'transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

// --- Sizes ---------------------------------------------------------------
const SIZE_ICON = 'p-1.5 rounded';          // icon-only action-bar button
const SIZE_ICON_TB = 'p-1 rounded-lg';      // icon-only toolbar button (denser)
const SIZE_ICON_XS = 'p-0.5 rounded';       // icon-only tree/panel header button
const SIZE_SM = 'px-3 py-1 text-sm rounded';
const SIZE_BAR = 'px-3 py-1.5 text-sm font-medium rounded-lg';
const SIZE_DLG = 'px-4 py-2 text-sm rounded';
const SIZE_LG = 'px-6 py-3 font-medium rounded-lg';

// --- Color variants ------------------------------------------------------
// Solid fills. `btn-fg` is the one foreground that sits on all of them.
const FILL_BLUE = 'text-btn-fg bg-btn-blue hover:bg-btn-blue-hover';
const FILL_RED = 'text-btn-fg bg-btn-red hover:bg-btn-red-hover';
const FILL_GREEN = 'text-btn-fg bg-btn-green hover:bg-btn-green-hover';
const FILL_PURPLE = 'text-btn-fg bg-btn-purple hover:bg-btn-purple-hover';
const FILL_NEUTRAL = 'text-btn-neutral-fg bg-btn-neutral hover:bg-btn-neutral-hover';
const FILL_NEUTRAL_OUTLINED = `${FILL_NEUTRAL} border border-btn-neutral-border`;

// Ghost: transparent until hovered. `GHOST` idles neutral and picks up the
// accent on hover; `TINT_*` idles already colored (the icon's color carries
// meaning at rest, e.g. amber = folder).
const GHOST = 'text-btn-ghost hover:bg-btn-ghost-bg';
const TINT_BLUE = 'text-btn-accent-blue hover:text-btn-accent-blue-hover hover:bg-btn-ghost-bg';
const TINT_AMBER = 'text-btn-accent-amber hover:text-btn-accent-amber-hover hover:bg-btn-ghost-bg';
const TINT_GREEN = 'text-btn-accent-green hover:text-btn-accent-green-hover hover:bg-btn-ghost-bg';
const TINT_RED = 'text-btn-accent-red hover:text-btn-accent-red-hover hover:bg-btn-ghost-bg';

// --- Icon buttons: neutral at rest, accent-colored on hover --------------
export const BUTTON_CLASS_NORMAL = `${BTN} ${SIZE_ICON} ${GHOST} hover:text-btn-ghost-hover`;
export const BUTTON_CLASS_CYAN = `${BTN} ${SIZE_ICON} ${GHOST} hover:text-btn-accent-cyan`;
export const BUTTON_CLASS_RED = `${BTN} ${SIZE_ICON} ${GHOST} hover:text-btn-accent-red`;
export const BUTTON_CLASS_BLUE = `${BTN} ${SIZE_ICON} ${GHOST} hover:text-btn-accent-blue`;
export const BUTTON_CLASS_GREEN = `${BTN} ${SIZE_ICON} ${GHOST} hover:text-btn-accent-green`;

// --- Toolbar icon buttons (denser; the BrowseView / IndexInsertBar row) ---
export const BUTTON_CLASS_TB_NORMAL = `${BTN} ${SIZE_ICON_TB} ${GHOST} hover:text-btn-ghost-hover`;
export const BUTTON_CLASS_TB_BLUE = `${BTN} ${SIZE_ICON_TB} ${TINT_BLUE}`;
export const BUTTON_CLASS_TB_AMBER = `${BTN} ${SIZE_ICON_TB} ${TINT_AMBER}`;
export const BUTTON_CLASS_TB_GREEN = `${BTN} ${SIZE_ICON_TB} ${TINT_GREEN}`;
export const BUTTON_CLASS_TB_RED = `${BTN} ${SIZE_ICON_TB} ${TINT_RED}`;

/** Smallest icon button — tree/panel header controls. */
export const BUTTON_CLASS_XS = `${BTN} ${SIZE_ICON_XS} text-btn-neutral-fg hover:text-btn-ghost-hover hover:bg-btn-ghost-bg disabled:hover:bg-transparent`;

/** Icon-sized button with the neutral fill (icon-only toolbar action that still
 *  needs a visible chip, e.g. the search-results Refresh). */
export const BUTTON_CLASS_ICON_NEUTRAL = `${BTN} ${SIZE_ICON} ${FILL_NEUTRAL}`;

/** Solid icon button (colored background, for primary icon actions). */
export const BUTTON_CLASS_ICON_SOLID_BLUE = `${BTN} flex-shrink-0 p-1 rounded ${FILL_BLUE}`;

/** Icon button floated over image content — a black scrim, so it stays legible
 *  whatever the image underneath happens to be. */
const SCRIM = `${BTN} rounded-full bg-btn-scrim hover:bg-btn-scrim-hover text-white/70 hover:text-white`;
export const BUTTON_CLASS_SCRIM = `${SCRIM} p-1`;
/** Same, at the larger hit size the fullscreen image viewer uses. */
export const BUTTON_CLASS_SCRIM_LG = `${SCRIM} p-2`;

// --- Small inline action buttons -----------------------------------------
export const BUTTON_CLASS_SM_BLUE = `${BTN} ${SIZE_SM} ${FILL_BLUE}`;
export const BUTTON_CLASS_SM_RED = `${BTN} ${SIZE_SM} ${FILL_RED}`;
export const BUTTON_CLASS_SM_GREEN = `${BTN} ${SIZE_SM} ${FILL_GREEN}`;
export const BUTTON_CLASS_SM_PURPLE = `${BTN} ${SIZE_SM} ${FILL_PURPLE}`;
export const BUTTON_CLASS_SM_NEUTRAL = `${BTN} ${SIZE_SM} ${FILL_NEUTRAL}`;

// --- Toolbar (selection bar) action buttons ------------------------------
export const BUTTON_CLASS_BAR_BLUE = `${BTN} ${SIZE_BAR} ${FILL_BLUE}`;
export const BUTTON_CLASS_BAR_RED = `${BTN} ${SIZE_BAR} ${FILL_RED}`;
export const BUTTON_CLASS_BAR_NEUTRAL = `${BTN} ${SIZE_BAR} ${FILL_NEUTRAL_OUTLINED}`;

// --- Large dialog action buttons -----------------------------------------
export const BUTTON_CLASS_DLG_CANCEL = `${BTN} ${SIZE_DLG} ${FILL_NEUTRAL}`;
export const BUTTON_CLASS_DLG_BLUE = `${BTN} ${SIZE_DLG} ${FILL_BLUE}`;
export const BUTTON_CLASS_DLG_GREEN = `${BTN} ${SIZE_DLG} ${FILL_GREEN}`;
export const BUTTON_CLASS_DLG_RED = `${BTN} ${SIZE_DLG} ${FILL_RED}`;
/** Dialog-sized neutral button with a border, for standalone settings actions. */
export const BUTTON_CLASS_DLG_OUTLINED = `${BTN} px-4 py-2 text-sm rounded-lg ${FILL_NEUTRAL_OUTLINED}`;

/** Full-width primary call to action (the empty-state "Select Folder"). */
export const BUTTON_CLASS_LG_BLUE = `${BTN} w-full ${SIZE_LG} ${FILL_BLUE}`;

// --- Toggle / selected states --------------------------------------------
/** The "on" half of a two-state button (selected day, selected list row). */
export const BUTTON_CLASS_TOGGLE_ON = 'text-btn-fg bg-btn-blue';
/** The "off" half when the control reads as a filled pill. */
export const BUTTON_CLASS_TOGGLE_OFF = 'text-btn-label bg-btn-neutral hover:bg-btn-neutral-hover';
/** The "off" half when the control reads as a plain row. */
export const BUTTON_CLASS_TOGGLE_OFF_GHOST = 'text-btn-label hover:bg-btn-ghost-bg';

// --- Text-only ("link") buttons ------------------------------------------
export const BUTTON_CLASS_LINK = `${BTN} text-btn-label hover:text-btn-label-hover`;
export const BUTTON_CLASS_LINK_MUTED = `${BTN} text-btn-ghost hover:text-btn-ghost-hover`;
export const BUTTON_CLASS_LINK_RED = `${BTN} text-btn-ghost hover:text-btn-accent-red`;
export const BUTTON_CLASS_LINK_AMBER = `${BTN} text-btn-accent-amber hover:text-btn-accent-amber-hover`;

/** Dialog title-bar close ("×") button. */
export const BUTTON_CLASS_DLG_CLOSE = `${BTN} flex items-center justify-center w-7 h-7 text-2xl font-bold leading-none rounded-md border-2 text-btn-ghost hover:text-btn-ghost-hover border-btn-border hover:border-btn-border-hover`;

/** Dropdown caret welded to the right edge of an EditableCombobox input. */
export const BUTTON_CLASS_COMBO_TOGGLE = `${BTN} px-2 rounded-r border bg-btn-input-bg border-btn-input-border hover:bg-btn-input-bg-hover focus:outline-none focus:border-btn-focus`;

/** "Copy" button revealed on hover over a fenced code block. */
export const BUTTON_CLASS_CODE_COPY = `${BTN} absolute top-2 right-2 p-1.5 rounded bg-btn-neutral/80 hover:bg-btn-neutral-hover text-btn-ghost hover:text-btn-ghost-hover opacity-0 group-hover:opacity-100`;

/** Full-width clickable list row (folder analysis hashtag list). */
export const BUTTON_CLASS_ROW = `${BTN} w-full flex items-center justify-between py-1.5 px-3 rounded-lg text-left hover:bg-btn-row-hover`;

/** Chip / pill button (thesaurus synonyms). */
export const BUTTON_CLASS_CHIP = `${BTN} px-2 py-0.5 shrink-0 rounded-md text-sm leading-5 whitespace-nowrap select-none bg-btn-chip text-btn-label-hover border border-btn-border hover:border-btn-border-hover`;

// --- Editor context menu items -------------------------------------------
const EDITOR_MENU_ITEM_BASE = 'w-full px-4 py-2 text-left text-sm transition-colors';
export const EDITOR_MENU_ITEM = `${EDITOR_MENU_ITEM_BASE} cursor-pointer text-btn-neutral-fg hover:bg-btn-menu-hover`;
export const EDITOR_MENU_ITEM_ACCENT = `${EDITOR_MENU_ITEM_BASE} cursor-pointer text-btn-accent-blue hover:bg-btn-menu-hover`;
export const EDITOR_MENU_ITEM_DISABLED = `${EDITOR_MENU_ITEM_BASE} text-btn-label-off cursor-not-allowed`;

// --- Path breadcrumb -----------------------------------------------------
/** Resting colors for a breadcrumb button (the drag-over state swaps in
 *  ENTRY_DROP_TARGET instead, so these are the "not a drop target" half). */
export const BREADCRUMB_IDLE = 'text-btn-ghost hover:bg-btn-ghost-bg hover:border-btn-border';
export const BREADCRUMB_SEGMENT_IDLE = 'text-btn-neutral-fg hover:bg-btn-ghost-bg hover:border-btn-border';

// --- App tab bar ---------------------------------------------------------
const TAB_BASE = 'flex items-center text-base font-medium transition-colors cursor-pointer border-b-4';
export const TAB_BUTTON_ACTIVE = `${TAB_BASE} text-btn-label-hover border-btn-accent-blue`;
export const TAB_BUTTON_IDLE = `${TAB_BASE} text-btn-ghost hover:text-btn-neutral-fg border-transparent`;

// Stacking level for modal/popup layers (dialogs, popup menus, fullscreen
// overlays, context menus). Z_MODAL must stay above CodeMirror's internal
// z-indexes (.cm-panels = 300, .cm-tooltip = 500). Since .cm-editor does not
// create its own stacking context, those values otherwise compete at the root
// level and would render the editor's search panel or autocomplete tooltips on
// top of modal dialogs. Compose it into className strings rather than hard-coding
// `z-[1000]` so the level lives in one place.
export const Z_MODAL = 'z-[1000]';

// Dialog structural classes
export const DLG_OVERLAY_CLASS = `fixed inset-0 bg-black/50 flex items-center justify-center ${Z_MODAL}`;
export const DLG_CONTAINER = 'bg-slate-800 rounded-lg border-2 border-slate-400 shadow-xl';
// slate-900 input theme. The border color is applied by the caller so error
// states can swap in a red border without re-spelling the whole base string.
// DLG_INPUT_CLASS_BASE omits both width and border color; compose it with a
// width (`w-full`, `flex-1`) and a `border-{color} focus:border-{color}` pair.
export const DLG_INPUT_CLASS_BASE = 'bg-slate-900 text-slate-200 px-3 py-2 rounded border focus:outline-none text-sm';
export const DLG_INPUT_CLASS = `w-full ${DLG_INPUT_CLASS_BASE} border-slate-600 focus:border-blue-500`;

// slate-700 "ring" input theme. DLG_INPUT_CLASS_ALT is the full-size field used
// in form dialogs (compose `font-mono`, `cursor-pointer`, etc. as needed);
// DLG_INPUT_CLASS_ALT_COMPACT is the smaller inline variant.
export const DLG_INPUT_CLASS_ALT = 'w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm disabled:opacity-60 disabled:cursor-not-allowed';
export const DLG_INPUT_CLASS_ALT_COMPACT = 'bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
export const DLG_LABEL_CLASS = 'block text-sm text-slate-400 mb-2';
export const DLG_FOOTER_CLASS = 'flex justify-end gap-3';

// Entry component structural classes
export const ENTRY_OUTER = 'bg-slate-800 group overflow-hidden';
export const ENTRY_HIGHLIGHTED = 'border-2 border-purple-500 relative z-10';
/** Layout half of the entry header row, shared by its normal and drop-target states. */
const ENTRY_HEADER_ROW_LAYOUT = 'flex items-center gap-3 px-2 py-0.5 transition-colors';
export const ENTRY_HEADER_ROW = `${ENTRY_HEADER_ROW_LAYOUT} bg-blue-800/50 group-hover:bg-blue-700/70`;
export const ENTRY_HEADER_EXPANDED = 'border border-slate-500';
export const ENTRY_NAME_SPAN = 'text-slate-300 font-medium truncate flex-1 cursor-pointer no-underline';
/**
 * Highlight for a row that a drag is hovering and can be dropped on.
 *
 * The outline is drawn *inside* the row's own box (`-outline-offset-2`) rather than
 * around it. An outline never occupies layout space either way, so nothing shifts —
 * but an outset one is invisible on three sides here: ENTRY_OUTER sets
 * `overflow-hidden`, which clips it, and BrowseView overlaps adjacent rows by 1px
 * (`[&>div+div]:-mt-px`) to collapse their borders, which covers the bottom edge.
 * Insetting it puts every edge inside the clip region. `relative z-10` then lifts the
 * row above the neighbor that overlaps it.
 *
 * Callers must *replace* the row's normal background classes with this rather than
 * appending it (see ENTRY_HEADER_ROW_DROP, and the ternary in FolderEntry). Appending
 * does not work: `:where()` gives `group-hover:bg-…` and a plain `bg-…` the same
 * specificity, so the one Tailwind emits later — the variant — wins, and the pointer
 * is by definition over the row it is dragging across.
 */
export const ENTRY_DROP_TARGET = 'relative z-10 bg-blue-600/60 outline outline-2 -outline-offset-2 outline-green-400';
/** Entry header row while an acceptable drag hovers it. */
export const ENTRY_HEADER_ROW_DROP = `${ENTRY_HEADER_ROW_LAYOUT} ${ENTRY_DROP_TARGET}`;
export const ENTRY_CONTENT_AREA = 'px-6 py-4';
export const ENTRY_LOADING = 'text-slate-400 text-sm';
export const ENTRY_EDITOR_ICON_BTN = `${BTN} p-1 rounded text-btn-neutral-fg hover:text-btn-ghost-hover hover:bg-btn-ghost-bg`;
export const RENAME_INPUT_CLASS = 'flex-1 bg-slate-900 text-slate-200 px-2 py-1 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm';

// Popup menu structural classes
// Menus render in the browser's top layer via the Popover API (see PopupMenu.tsx),
// so they clear CodeMirror's internal panels/tooltips without needing Z_MODAL.
export const MENU_CONTAINER    = `fixed bg-slate-800 border-2 border-slate-400 rounded-lg shadow-xl p-2 min-w-[180px] max-w-xs`;
export const MENU_ITEM_BASE    = 'w-full text-left py-2 text-sm transition-colors flex items-center gap-2';
export const MENU_ITEM_ENABLED = 'text-btn-neutral-fg hover:bg-btn-menu-hover cursor-pointer';
export const MENU_ITEM_DISABLED = 'text-btn-label-off cursor-not-allowed';
export const MENU_DIVIDER      = 'border-t border-slate-500 my-1';
// Row with inline action buttons revealed on hover (e.g. bookmark rows)
export const MENU_ROW          = 'flex items-center gap-1 px-2 py-1 rounded hover:bg-btn-menu-hover group';
export const MENU_ICON_BTN     = 'p-1 rounded text-btn-ghost hover:bg-btn-menu-icon-hover cursor-pointer';
// Primary clickable label within a MENU_ROW (icon + truncated text)
export const MENU_ROW_LABEL    = 'flex items-center gap-2 flex-1 text-left text-sm text-btn-neutral-fg cursor-pointer min-w-0';
// Action button cluster revealed on row hover (sits beside MENU_ROW_LABEL)
export const MENU_ROW_ACTIONS  = 'flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pl-2';
// Icon sizing inside menu rows
export const MENU_ROW_ICON     = 'w-4 h-4 flex-shrink-0';
export const MENU_ACTION_ICON  = 'w-3.5 h-3.5';
// Folder vs. file icon colors used in menu rows
export const MENU_FOLDER_ICON  = 'text-btn-accent-amber';
export const MENU_FILE_ICON    = 'text-btn-accent-blue';