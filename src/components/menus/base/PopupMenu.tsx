// Popup menus: the shared base every menu is built from. See: (popup_menus.md)
import { useRef, useLayoutEffect, useEffect, useEffectEvent, useState, type ReactNode, type RefObject, type ComponentType } from 'react';
import { clsx } from 'clsx';
import { CheckIcon } from '@heroicons/react/24/solid';
import { MENU_CONTAINER, MENU_ITEM_BASE, MENU_ITEM_ENABLED, MENU_ITEM_DISABLED, MENU_DIVIDER } from '../../../renderer/styles';

/**
 * Gap in px between the anchor element (or cursor) and the menu.
 *
 * See: (popup_menus.md#positioning-behavior)
 */
const ANCHOR_GAP = 4;
/**
 * Minimum px kept between the menu and each viewport edge.
 *
 * See: (popup_menus.md#positioning-behavior)
 */
const VIEWPORT_MARGIN = 8;
/**
 * Smallest height in px a too-tall menu is squeezed into on one side of its
 * anchor/cursor. If neither side has this much room, the menu instead takes the
 * whole viewport height (covering the anchor) and scrolls there.
 *
 * See: (popup_menus.md#height-limit-and-scrolling)
 */
const MIN_SCROLL_HEIGHT = 160;

// Props of the base menu container. See: (popup_menus.md#1-base-component--srccomponentsmenusbasepopupmenutsx)
export interface PopupMenuProps {
  /** Ref to the button/element that triggered the menu */
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * Mouse coordinates to position the menu at (alternative to anchorRef, for
   * context menus; used when both are given)
   *
   * See: (popup_menus.md#context-menus-mouse-position)
   */
  mousePosition?: { x: number; y: number };
  /**
   * Called when the menu should close (click outside or Escape). An item click
   * does not call it: each item's onClick must call onClose itself.
   *
   * See: (popup_menus.md#dismiss-behavior)
   */
  onClose: () => void;
  /**
   * When true, click-outside and Escape dismissal are suppressed (e.g. while a sub-dialog is open)
   *
   * See: (popup_menus.md#dismiss-behavior)
   */
  disableClose?: boolean;
  /**
   * Which of the menu's corners lines up with the anchor. 'left' (default) puts
   * the menu's top-left under the anchor's bottom-left; 'right' puts its
   * top-right under the anchor's bottom-right — the natural choice for a button
   * sitting at the right end of a toolbar. Ignored when `mousePosition` is used.
   *
   * See: (popup_menus.md#positioning-behavior)
   */
  align?: 'left' | 'right';
  children: ReactNode;
  /**
   * Optional extra inline styles merged onto the menu container (usually a
   * `maxWidth` that lifts MENU_CONTAINER's max-w-xs cap)
   *
   * See: (popup_menus.md#styling-reference)
   */
  style?: React.CSSProperties;
  /** Optional test hook rendered on the menu container */
  'data-testid'?: string;
}

/**
 * Reusable popup menu that renders in the browser's top layer (via the Popover
 * API) and positions itself below an anchor element or at mouse coordinates.
 * Handles click-outside dismiss, Escape key, and viewport edge-clipping.
 *
 * See: (popup_menus.md#1-base-component--srccomponentsmenusbasepopupmenutsx)
 * See: (popup_menus.md#rendering-layer-popover-api)
 */
export default function PopupMenu({ anchorRef, mousePosition, onClose, disableClose = false, align = 'left', children, style: extraStyle, 'data-testid': dataTestId }: PopupMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // maxHeight is set only when the menu is too tall for the room it was given;
  // MENU_CONTAINER's overflow-y-auto then turns on its own vertical scrollbar.
  // See: (popup_menus.md#height-limit-and-scrolling)
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight?: number } | null>(null);

  // Destructure to primitive coordinates so the positioning effect can depend on
  // the numbers rather than the mousePosition object's identity. A caller passing
  // an inline { x, y } literal would otherwise re-create it every render and make
  // the effect tear down / re-attach its resize+scroll listeners each time.
  // See: (popup_menus.md#context-menus-mouse-position)
  const mouseX = mousePosition?.x;
  const mouseY = mousePosition?.y;

  // Effect event so the dismiss listeners always call the latest onClose without
  // re-subscribing every render when callers pass an inline arrow function.
  // See: (popup_menus.md#dismiss-behavior)
  const onCloseEvent = useEffectEvent(() => onClose());

  // Promote the menu into the browser's top layer via the Popover API, then
  // position it. Top-layer rendering sits above all page content regardless of
  // z-index/overflow/transform — the same benefit Dialog.tsx gets from
  // <dialog>.showModal() — so the menu no longer needs Z_MODAL to clear
  // CodeMirror's internal panels/tooltips. We use popover="manual" (not "auto")
  // because auto popovers are light-dismissed by showModal() and can't be kept
  // open while a sub-dialog is up (the disableClose case); dismissal is instead
  // handled by the click-outside/Escape listeners below, exactly as before.
  // showPopover() must run before the first updatePosition() because a hidden
  // popover has no measurable size.
  //
  // Reposition while open if the viewport resizes or scrolls, so the menu stays
  // anchored instead of detaching/overflowing. Scroll uses capture to also catch
  // scrolling inside nested scrollable containers (but not the menu's own
  // scrolling, which can't move it). A ResizeObserver also repositions when the
  // menu's own size changes: its content changing while open, or its vertical
  // scrollbar appearing and widening it after maxHeight is first applied.
  // See: (popup_menus.md#rendering-layer-popover-api)
  // See: (popup_menus.md#positioning-behavior)
  // See: (popup_menus.md#height-limit-and-scrolling)
  useLayoutEffect(() => {
    // Calculate position relative to anchor or mouse position, adjusting for viewport edges
    const updatePosition = () => {
      const menu = menuRef.current;
      if (!menu) return;

      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      // The menu's full height as if uncapped. menuRect.height can't be used: once
      // an earlier pass set maxHeight it reports the capped height. scrollHeight is
      // content + padding even while capped; offsetHeight - clientHeight adds the
      // borders (and a horizontal scrollbar, if any).
      const naturalHeight = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;

      // `below` is the top edge when opening downward; `aboveBottom` is the bottom
      // edge when flipped to open upward.
      let below: number;
      let aboveBottom: number;
      let left: number;

      if (mouseX !== undefined && mouseY !== undefined) {
        below = mouseY;
        aboveBottom = mouseY - ANCHOR_GAP;
        left = mouseX;
      } else {
        const anchor = anchorRef?.current;
        if (!anchor) return;
        const anchorRect = anchor.getBoundingClientRect();
        below = anchorRect.bottom + ANCHOR_GAP;
        aboveBottom = anchorRect.top - ANCHOR_GAP;

        // The menu has already been laid out at its natural (content-driven)
        // width by this point, so menuRect.width lets us anchor the right edge
        // without the caller having to know how wide the menu is.
        if (align === 'right') {
          left = anchorRect.right - menuRect.width;
        } else {
          left = anchorRect.left;
          // If menu overflows right edge, align menu's right edge with anchor's right edge
          if (left + menuRect.width > viewportWidth - VIEWPORT_MARGIN) {
            left = anchorRect.right - menuRect.width;
          }
        }
      }

      // Clamp right edge
      if (left + menuRect.width > viewportWidth - VIEWPORT_MARGIN) {
        left = viewportWidth - menuRect.width - VIEWPORT_MARGIN;
      }

      // If still overflowing left, clamp to left edge
      if (left < VIEWPORT_MARGIN) {
        left = VIEWPORT_MARGIN;
      }

      // Vertical placement: open downward if it fits, else flip upward if that
      // fits. If neither fits, cap the height (the menu then scrolls internally)
      // to the roomier side, keeping the anchor/cursor uncovered — unless even
      // that side is cramped, in which case use the whole viewport height.
      // See: (popup_menus.md#height-limit-and-scrolling)
      const spaceBelow = viewportHeight - VIEWPORT_MARGIN - below;
      const spaceAbove = aboveBottom - VIEWPORT_MARGIN;
      let top: number;
      let maxHeight: number | undefined;
      if (naturalHeight <= spaceBelow) {
        top = below;
      } else if (naturalHeight <= spaceAbove) {
        top = aboveBottom - naturalHeight;
      } else if (Math.max(spaceBelow, spaceAbove) >= MIN_SCROLL_HEIGHT) {
        if (spaceBelow >= spaceAbove) {
          top = below;
          maxHeight = spaceBelow;
        } else {
          top = VIEWPORT_MARGIN;
          maxHeight = spaceAbove;
        }
      } else {
        top = VIEWPORT_MARGIN;
        const fullHeight = viewportHeight - 2 * VIEWPORT_MARGIN;
        // Only cap when it doesn't fit the full height either
        if (naturalHeight > fullHeight) maxHeight = Math.max(fullHeight, 0);
      }

      setPosition({ top, left, maxHeight });
    };

    // Scroll events from the menu itself (its own scrollbar) don't move it.
    const onScroll = (e: Event) => {
      if (e.target !== menuRef.current) updatePosition();
    };

    const menu = menuRef.current;
    if (menu && !menu.matches(':popover-open')) {
      try {
        menu.showPopover();
      } catch {
        // Already shown (e.g. a StrictMode effect re-invocation); ignore.
      }
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', onScroll, true);
    // Re-setting identical values doesn't change the menu's size, so this can't loop.
    const resizeObserver = new ResizeObserver(() => updatePosition());
    if (menu) resizeObserver.observe(menu);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', onScroll, true);
      resizeObserver.disconnect();
    };
  }, [anchorRef, mouseX, mouseY, align]);

  // Click-outside and Escape dismiss. A mousedown on the menu's own scrollbar
  // targets the menu element itself, so contains() keeps the menu open for it.
  // See: (popup_menus.md#dismiss-behavior)
  // See: (popup_menus.md#height-limit-and-scrolling)
  useEffect(() => {
    if (disableClose) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const anchorContains = anchorRef?.current?.contains(target) ?? false;
      if (menuRef.current && !menuRef.current.contains(target) && !anchorContains) {
        onCloseEvent();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseEvent();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    // Returns the useEffect cleanup (an unsubscribe): removes the document 'mousedown' and 'keydown' listeners on unmount.
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, disableClose]);

  return (
    <div
      ref={menuRef}
      popover="manual"
      data-testid={dataTestId}
      className={MENU_CONTAINER}
      style={{
        top: position?.top,
        left: position?.left,
        maxHeight: position?.maxHeight,
        // Neutralise the UA popover defaults (inset: 0; margin: auto) so our
        // computed top/left position the menu instead of stretching it edge-to-edge.
        right: 'auto',
        bottom: 'auto',
        margin: 0,
        // Keep invisible until position is calculated to avoid flicker
        visibility: position ? 'visible' : 'hidden',
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}

// Props of a single clickable menu row. See: (popup_menus.md#1-base-component--srccomponentsmenusbasepopupmenutsx)
export interface PopupMenuItemProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** If undefined: no checkbox area. If true: show checkmark. If false: show empty space (for alignment). */
  selected?: boolean;
  /** Optional icon component to display to the left of the label. */
  icon?: ComponentType<{ className?: string }>;
  'data-testid'?: string;
}

/**
 * A clickable menu item inside a PopupMenu. It does not close the menu: its
 * onClick must run the action and then call the menu's onClose.
 *
 * See: (popup_menus.md#1-base-component--srccomponentsmenusbasepopupmenutsx)
 * See: (popup_menus.md#step-1-create-the-menu-component)
 */
export function PopupMenuItem({
  label,
  onClick,
  disabled = false,
  selected,
  icon: Icon,
  'data-testid': dataTestId,
}: PopupMenuItemProps) {
  // When selected is defined (true or false), we reserve space for the checkbox
  const hasCheckboxArea = selected !== undefined;

  return (
    <button
      type="button"
      className={clsx(
        MENU_ITEM_BASE,
        hasCheckboxArea ? 'px-3' : 'px-4',
        disabled ? MENU_ITEM_DISABLED : MENU_ITEM_ENABLED,
      )}
      onClick={onClick}
      disabled={disabled}
      data-testid={dataTestId}
    >
      {hasCheckboxArea && (
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          {selected && <CheckIcon className="w-5 h-5 text-white" />}
        </div>
      )}
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

/**
 * A horizontal divider line inside a PopupMenu.
 *
 * See: (popup_menus.md#1-base-component--srccomponentsmenusbasepopupmenutsx)
 */
export function PopupMenuDivider() {
  return <div className={MENU_DIVIDER} />;
}

export interface PopupMenuComboBoxOption<T extends string> {
  value: T;
  label: string;
}

export interface PopupMenuComboBoxProps<T extends string> {
  /** Optional caption rendered above the select. Omit when the option labels speak for themselves. */
  label?: string;
  value: T;
  options: readonly PopupMenuComboBoxOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  'data-testid'?: string;
}

/**
 * A menu row holding a native `<select>`, for settings that pick one of several
 * values rather than firing an action. The native select is deliberate: Chromium
 * renders its dropdown as an OS-level widget above the popover top layer that
 * PopupMenu lives in, and clicking an option raises no document `mousedown`, so
 * PopupMenu's click-outside dismissal never sees it. The row itself is not a
 * button — clicks inside it must not close the menu, so callers close (or not)
 * from `onChange`.
 *
 * See: (popup_menus.md#1-base-component--srccomponentsmenusbasepopupmenutsx)
 */
export function PopupMenuComboBox<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  'data-testid': dataTestId,
}: PopupMenuComboBoxProps<T>) {
  return (
    <div className="px-4 py-2 flex flex-col gap-1">
      {label && <span className="text-xs text-slate-400">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        data-testid={dataTestId}
        className={clsx(
          'w-full text-sm rounded px-2 py-1 bg-slate-700 border border-slate-500 transition-colors',
          'focus:outline-none focus:ring-1 focus:ring-blue-500',
          disabled ? 'text-slate-500 cursor-not-allowed' : 'text-slate-200 cursor-pointer hover:bg-slate-600',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
