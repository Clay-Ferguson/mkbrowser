# Pattern for creating popup menus

## Overview

Popup menus are small dropdown menus that float over the page content. Most are opened by an icon button and appear just below it. Context menus (right-click) use the same component and appear at the mouse position instead. The menu moves itself so the viewport edges never cut it off, and it follows its anchor when the window is resized or scrolled. Clicking a menu item runs a callback and closes the menu. Clicking outside the menu or pressing Escape also closes it.

## Architecture: Two Layers

### 1. Base Component — `src/components/menus/base/PopupMenu.tsx`

This is the shared, reusable foundation. **Do not duplicate this logic.** It exports:

- **`PopupMenu`** (default export): the menu container. It handles positioning, closing on click-outside and Escape, and keeping the menu inside the viewport. Props:
  - `anchorRef?`: ref to the trigger element. The menu opens below it.
  - `mousePosition?`: `{ x, y }` viewport coordinates. Use this instead of `anchorRef` for context menus. When both are given, `mousePosition` is used.
  - `onClose`: called when the user clicks outside or presses Escape.
  - `align?`: `'left'` (default) or `'right'`. Controls which corner of the menu lines up with the anchor (see Positioning Behavior). It is ignored when `mousePosition` is used.
  - `disableClose?`: when `true`, click-outside and Escape do not close the menu. Use it while a sub-dialog opened from the menu is showing (see `BookmarksPopupMenu`).
  - `style?`: extra inline styles merged onto the container. This is usually used to lift the `max-w-xs` width cap.
  - `data-testid?`: a test hook on the container.
  - `children`
- **`PopupMenuItem`**: a single clickable menu row, rendered as a `<button type="button">`. Props:
  - `label` (string)
  - `onClick`
  - `disabled?`
  - `selected?`: leave it `undefined` for a plain item with no check column. Set it to `true` to show a check mark, or `false` to keep the check column empty so the item lines up with its checked siblings. Single-choice menus such as `SortPopupMenu` and `ImageColsPopupMenu` use this.
  - `icon?`: an icon component shown to the left of the label. No current menu uses it.
  - `data-testid?`
- **`PopupMenuDivider`**: a horizontal separator line between groups of items.
- **`PopupMenuComboBox`**: a menu row that holds a native `<select>`. It is for settings that choose one of several values instead of running an action. The row is not a button, so clicking inside it does not close the menu. The caller closes the menu (or leaves it open) from `onChange`. A native select is used on purpose: Chromium draws its dropdown as an OS-level widget, and clicking an option fires no document `mousedown`, so the menu's click-outside handler never sees that click. No live menu uses it today. The commented-out "Reference" blocks in `EditPopupMenu.tsx` are the worked example.

### 2. Specific Menu Components — `src/components/menus/`

Each menu has its own component file in `src/components/menus/`. Each one builds its items from the base pieces above. Current menus:

| Menu | Opened from | Notes |
|------|-------------|-------|
| `ToolsPopupMenu` | Wrench button in `BrowseToolbar` | Canonical simple example: action items in groups separated by dividers |
| `EditPopupMenu` | Edit button in `BrowseToolbar` | Disabled items driven by the selection; commented-out `PopupMenuComboBox` reference |
| `SearchPopupMenu` | Magnifying-glass button in `BrowseToolbar` | Saved searches; right-click a search to edit it |
| `SortPopupMenu` | Sort button in `BrowseToolbar` | Single-choice list using `selected` |
| `ImageColsPopupMenu` | Image-columns button in `BrowseToolbar` | Single-choice list using `selected`; all items disabled in Document Mode |
| `FilePopupMenu` | App logo in `AppTabButtons` | Recent folders; `style={{ maxWidth: '90vw' }}` for long paths |
| `SystemPopupMenu` | Hamburger button in `AppTabButtons` | Opens settings/editor tabs |
| `EntryPopupMenu` | Hamburger "More actions" button in `EntryActionBar` | `align="right"`; items hidden when their callback is omitted |
| `BookmarksPopupMenu` | Bookmarks button in `IndexTreeView` | Custom rows with hover action buttons; `disableClose` while its edit dialog is open |
| `IndexTreeContextMenu` | Right-click on an index tree node in `IndexTreeView` | Uses `mousePosition` instead of `anchorRef` |

The CodeMirror editor's right-click menu (`src/components/editor/EditorContextMenu.tsx`) is a separate, older implementation. It does **not** use `PopupMenu`. It does its own positioning and dismissal, uses the `EDITOR_MENU_ITEM*` style constants, and stacks with `Z_MODAL` instead of the popover top layer.

## Creating a New Popup Menu

### Step 1: Create the menu component

Create `src/components/menus/YourPopupMenu.tsx`:

```tsx
import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './base/PopupMenu';

interface YourPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  // Add a callback prop for each menu action:
  onSomeAction: () => void;
  onAnotherAction: () => void;
}

export default function YourPopupMenu({
  anchorRef,
  onClose,
  onSomeAction,
  onAnotherAction,
}: YourPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose}>
      <PopupMenuItem
        label="Some Action"
        data-testid="menu-some-action"
        onClick={() => { onSomeAction(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Another Action"
        data-testid="menu-another-action"
        onClick={() => { onAnotherAction(); onClose(); }}
      />
    </PopupMenu>
  );
}
```

**Key rule:** `PopupMenu` only calls `onClose` for click-outside and Escape. It does **not** close the menu when an item is clicked. So every `PopupMenuItem` `onClick` handler must call the action callback **and** `onClose()`.

Conventions the existing menus follow:

- **Optional items:** to show an item only some of the time, make its callback prop optional and render the item only when the callback is given. `EntryPopupMenu` and `IndexTreeContextMenu` work this way. Put any divider that only belongs to optional items behind the same condition.
- **Store reads:** a menu may read from the store directly when an item's visibility depends on app state. For example, `ToolsPopupMenu` reads `aiConfig.aiEnabled` to decide whether to show "New AI Chat".
- **Test ids:** give every item a `data-testid` (usually `menu-...`) so the Playwright e2e tests can click it.
- **React Compiler:** `useCallback` and `useMemo` are not used anywhere. Write plain inline arrow functions, as shown above.

### Step 2: Add the trigger button and menu to the parent component

Put the trigger button in whichever component owns that part of the UI, such as `BrowseToolbar`, `AppTabButtons`, `EntryActionBar` or `IndexTreeView`. `App.tsx` no longer does this.

1. **Import** the menu component and an icon (from `@heroicons/react/24/outline` or `/24/solid`).

2. **Add state and ref:**
   ```tsx
   const [showYourMenu, setShowYourMenu] = useState(false);
   const yourButtonRef = useRef<HTMLButtonElement>(null);
   ```

3. **Add the trigger button.** Use a `BUTTON_CLASS_*` constant from `src/renderer/styles.ts` for its style, never raw Tailwind colors (see "Button Colors" in `AGENTS.md`). Toolbar buttons use `BUTTON_CLASS_TB_NORMAL` with a `w-6 h-6` icon. Entry action-bar buttons use `BUTTON_CLASS_NORMAL` with a `w-5 h-5` icon.
   ```tsx
   <button
     type="button"
     ref={yourButtonRef}
     onClick={() => setShowYourMenu(prev => !prev)}
     className={BUTTON_CLASS_TB_NORMAL}
     title="Your Menu"
     data-testid="your-menu-button"
   >
     <YourIcon className="w-6 h-6" />
   </button>
   ```
   The toggle (`prev => !prev`) is what makes a second click on the button close the menu. `PopupMenu`'s click-outside handler ignores mousedowns on the anchor, so the button's own click handler is the only thing that sees that second click.

4. **Conditionally render the menu**, usually after the toolbar/header JSX:
   ```tsx
   {showYourMenu && (
     <YourPopupMenu
       anchorRef={yourButtonRef}
       onClose={() => setShowYourMenu(false)}
       onSomeAction={() => { /* handler logic */ }}
       onAnotherAction={() => { /* handler logic */ }}
     />
   )}
   ```

#### Several menus in one toolbar

`BrowseToolbar` owns five menus. It keeps a single `openMenu: MenuKind | null` state instead of one boolean per menu. `toggleMenu(which)` opens that menu, or closes it if it is already open. `closeMenu(which)` closes the menu only if it is still the open one, so a late `onClose` from one menu cannot close a different menu that has been opened since. Clicking a second menu's button closes the first through the first menu's click-outside handling. To add another toolbar menu there, add a new `MenuKind` value and follow the same pattern.

#### Context menus (mouse position)

For a right-click menu, record the click coordinates and pass them as `mousePosition` instead of `anchorRef`. This is what `IndexTreeView` does for `IndexTreeContextMenu`:

```tsx
const handleContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY /* , ...per-target callbacks */ });
};

{contextMenu && (
  <YourContextMenu
    mousePosition={{ x: contextMenu.x, y: contextMenu.y }}
    onClose={() => setContextMenu(null)}
  />
)}
```

You can pass an inline `{ x, y }` object. `PopupMenu` reads the plain numbers out of it before using them in its effect, so a new object on each render does not re-attach its listeners.

#### Menus inside clickable rows

If the trigger button sits inside an element that has its own click or context-menu handlers (for example an entry header), stop propagation both on the button and around the menu. Otherwise clicks on menu items reach the row's handlers. `EntryActionBar` wraps `EntryPopupMenu` in a `<div className="contents">` that calls `stopPropagation()` for both `onClick` and `onContextMenu`.

## Rendering Layer (Popover API)

`PopupMenu` renders its container with `popover="manual"` and calls `showPopover()` when it mounts. That places the menu in the browser's **top layer**, above all page content no matter what `z-index`, `overflow` or `transform` other elements use. This is the same benefit `Dialog.tsx` gets from `<dialog>.showModal()`, so menus do not need a z-index class to appear above CodeMirror's internal panels and tooltips.

- It uses `"manual"` rather than `"auto"` because an auto popover is closed automatically when a modal dialog opens. That would make the `disableClose` case impossible, where the menu stays open under a sub-dialog. Closing is handled by `PopupMenu`'s own listeners instead.
- The inline style sets `right: auto; bottom: auto; margin: 0`. This cancels the browser's default popover styles (`inset: 0; margin: auto`), which would otherwise center and stretch the menu.
- `src/renderer/overlayDom.ts` exports `isKeyForOverlay(e)`. It returns true when a keypress belongs to an open `<dialog>` or `[popover]`. Document-level key handlers (in `App.tsx`, `FullscreenImageViewer`, `HelpSearchBar`) call it and return early, so app shortcuts do not fire while a menu is open. A new popup menu gets this automatically.

## Positioning Behavior

The base `PopupMenu` computes `top`/`left` in a `useLayoutEffect`, after the menu has been laid out at its natural width. It uses `fixed` positioning and `getBoundingClientRect()` for viewport-relative coordinates.

- **Anchor, `align="left"` (default)**: the menu's top-left corner sits 4px (`ANCHOR_GAP`) below the anchor's bottom-left corner. If that overflows the right edge, the menu's right edge is lined up with the anchor's right edge instead.
- **Anchor, `align="right"`**: the menu's top-right corner sits 4px below the anchor's bottom-right corner. This suits buttons at the right end of a bar, such as the entry hamburger button.
- **Mouse position**: the menu's top-left corner is placed at the cursor.
- **Edge clamping** (all modes): the menu is kept at least 8px (`VIEWPORT_MARGIN`) inside the right and left viewport edges. If it overflows the bottom, it flips to sit above the anchor's top edge (or above the cursor) with a 4px gap, then is clamped 8px from the top.
- **Repositioning**: while the menu is open, it recalculates on window `resize` and on `scroll`. The scroll listener uses capture so it also catches scrolling inside nested scroll containers.
- **No flicker**: the container stays `visibility: hidden` until its first position has been calculated.

## Dismiss Behavior

Handled automatically by `PopupMenu`, unless `disableClose` is `true`:

- **Click outside**: a `mousedown` listener on `document` calls `onClose` when the target is outside both the menu and the anchor element.
- **Escape key**: a `keydown` listener on `document`.
- Both listeners call the latest `onClose` through `useEffectEvent`, so passing an inline arrow function does not make them re-subscribe on every render.

Not handled by `PopupMenu`:

- **Menu item click**: each `PopupMenuItem`'s `onClick` must call `onClose()` itself (see Step 1).
- **Second click on the trigger button**: the parent's toggle handles it (see Step 2).

## Styling Reference

The menu's style classes are constants in `src/renderer/styles.ts`, not literals in `PopupMenu.tsx`:

- **`MENU_CONTAINER`**: `fixed bg-slate-800 border-2 border-slate-400 rounded-lg shadow-xl p-2 min-w-[180px] max-w-xs`
- **`MENU_ITEM_BASE`**: `w-full text-left py-2 text-sm transition-colors flex items-center gap-2`, plus `px-4` (or `px-3` when the item has a check column)
- **`MENU_ITEM_ENABLED`**: `text-btn-neutral-fg hover:bg-btn-menu-hover cursor-pointer`
- **`MENU_ITEM_DISABLED`**: `text-btn-label-off cursor-not-allowed`
- **`MENU_DIVIDER`**: `border-t border-slate-500 my-1`

To let a menu grow wider than `max-w-xs`, pass a `style` with a `maxWidth`. `FilePopupMenu` uses `'90vw'` and `BookmarksPopupMenu` uses `'calc(100vw - 16px)'`.

For rows that carry their own buttons, which a plain `PopupMenuItem` can't hold, `styles.ts` also provides `MENU_ROW`, `MENU_ROW_LABEL`, `MENU_ROW_ACTIONS` (action buttons that appear when the row is hovered), `MENU_ROW_ICON`, `MENU_ICON_BTN` (with `MENU_ICON_BTN_EDIT` / `MENU_ICON_BTN_DELETE` hover colors), `MENU_ACTION_ICON`, and the `MENU_FOLDER_ICON` / `MENU_FILE_ICON` colors. `BookmarksPopupMenu` is the reference for building rows this way.

## Existing Example

`src/components/menus/ToolsPopupMenu.tsx` is the canonical reference for a simple action menu. Its items are, in order:

- New AI Chat (shown only when AI is enabled)
- Folder Analysis
- *(divider)*
- Graph All
- Graph Markdown
- *(divider)*
- Export to File
- Export to Folder (HTML)

It is opened by the `WrenchIcon` button (`data-testid="tools-menu-button"`) in the `data-testid="browser-header-actions"` div of `src/components/views/BrowseToolbar.tsx`.

For other patterns, see:

- `SortPopupMenu`: checked single-choice items.
- `IndexTreeContextMenu`: a right-click menu.
- `BookmarksPopupMenu`: custom rows with action buttons, and `disableClose` while a sub-dialog is open.
