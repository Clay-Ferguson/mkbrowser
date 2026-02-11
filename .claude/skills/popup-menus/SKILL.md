```skill
---
name: popup-menus
description: Pattern for creating popup menus anchored to icon buttons
---

# Instructions

## Overview

Popup menus are icon-triggered dropdown menus that appear over the page content, anchored below the button the user clicked. They automatically adjust position to avoid being clipped by viewport edges. Clicking a menu item fires a callback and dismisses the menu. Clicking outside or pressing Escape also dismisses it.

## Architecture: Two Layers

### 1. Base Component — `src/components/PopupMenu.tsx`

This is the shared, reusable foundation. **Do not duplicate this logic.** It provides:

- **`PopupMenu`** — wrapper that handles positioning, click-outside dismiss, Escape key dismiss, and viewport edge-clipping. It accepts an `anchorRef` (ref to the trigger button), `onClose` callback, and `children`.
- **`PopupMenuItem`** — a single clickable menu row. Props: `label` (string), `onClick` (callback), `disabled?` (boolean).
- **`PopupMenuDivider`** — a horizontal separator line between menu items.

### 2. Specific Menu Component — e.g. `src/components/ToolsPopupMenu.tsx`

Each menu gets its own component file in `src/components/`. It composes `PopupMenu`, `PopupMenuItem`, and `PopupMenuDivider` to define the menu's items. See `ToolsPopupMenu.tsx` as the reference example.

## Creating a New Popup Menu

### Step 1: Create the menu component

Create `src/components/YourPopupMenu.tsx`:

```tsx
import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem, PopupMenuDivider } from './PopupMenu';

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
        onClick={() => { onSomeAction(); onClose(); }}
      />
      <PopupMenuDivider />
      <PopupMenuItem
        label="Another Action"
        onClick={() => { onAnotherAction(); onClose(); }}
      />
    </PopupMenu>
  );
}
```

**Key rule:** Every `PopupMenuItem` `onClick` handler must call both the action callback AND `onClose()` so the menu dismisses after the user clicks.

### Step 2: Add the trigger button and menu to the parent component

In the parent (typically `src/App.tsx`):

1. **Import** the menu component and an icon (from `@heroicons/react/24/outline` or `/24/solid`).

2. **Add state and ref:**
   ```tsx
   const [showYourMenu, setShowYourMenu] = useState(false);
   const yourButtonRef = useRef<HTMLButtonElement>(null);
   ```

3. **Add the trigger button** (follows the standard icon button pattern):
   ```tsx
   <button
     ref={yourButtonRef}
     onClick={() => setShowYourMenu(prev => !prev)}
     className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
     title="Your Menu"
   >
     <YourIcon className="w-5 h-5" />
   </button>
   ```

4. **Conditionally render the menu** (place it near the other dialogs/menus at the bottom of the JSX return):
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

## Positioning Behavior

The base `PopupMenu` component handles all positioning automatically:

- **Default**: appears 4px below the anchor, left-aligned with the anchor's left edge.
- **Right edge overflow**: shifts left so the menu's right edge aligns with the anchor's right edge. If still overflowing, clamps to 8px from the left viewport edge.
- **Bottom edge overflow**: flips above the anchor (4px gap). If still overflowing, clamps to 8px from the top viewport edge.
- Uses `fixed` positioning with `getBoundingClientRect()` for viewport-relative coordinates.
- Renders off-screen (`visibility: hidden`) until position is calculated to prevent flicker.

## Dismiss Behavior

Handled automatically by `PopupMenu`:

- **Click outside**: `mousedown` listener on `document` checks if click target is outside both the menu and the anchor button.
- **Escape key**: `keydown` listener on `document`.
- **Menu item click**: each `PopupMenuItem`'s `onClick` should call `onClose()`.

## Styling Reference

All popup menus use these consistent Tailwind classes (defined in `PopupMenu.tsx`):

- **Menu container**: `fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[180px]`
- **Menu item**: `w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-700`
- **Disabled item**: `text-slate-500 cursor-not-allowed`
- **Divider**: `border-t border-slate-700 my-1`
- **Trigger button**: `p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors` with `w-5 h-5` icon

## Existing Example

`ToolsPopupMenu.tsx` is the canonical reference implementation. It provides three menu items (Folder Analysis, Re-Number Files, Export) with dividers between them, triggered by a `WrenchIcon` button in the `data-id="browser-header-actions"` div in `App.tsx`.
```
