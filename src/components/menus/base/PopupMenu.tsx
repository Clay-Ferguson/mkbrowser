import { useRef, useLayoutEffect, useEffect, useState, type ReactNode, type RefObject, type ComponentType } from 'react';
import { clsx } from 'clsx';
import { CheckIcon } from '@heroicons/react/24/solid';
import { MENU_CONTAINER, MENU_ITEM_BASE, MENU_ITEM_ENABLED, MENU_ITEM_DISABLED, MENU_DIVIDER } from '../../../renderer/styles';

/** Gap in px between the anchor element and the menu. */
const ANCHOR_GAP = 4;
/** Minimum px kept between the menu and each viewport edge. */
const VIEWPORT_MARGIN = 8;

export interface PopupMenuProps {
  /** Ref to the button/element that triggered the menu */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Mouse coordinates to position the menu at (alternative to anchorRef) */
  mousePosition?: { x: number; y: number };
  /** Called when the menu should close (click outside, Escape, item click) */
  onClose: () => void;
  /** When true, click-outside and Escape dismissal are suppressed (e.g. while a sub-dialog is open) */
  disableClose?: boolean;
  children: ReactNode;
  /** Optional extra inline styles merged onto the menu container */
  style?: React.CSSProperties;
  /** Optional test hook rendered on the menu container */
  'data-testid'?: string;
}

/**
 * Reusable popup menu that renders in the browser's top layer (via the Popover
 * API) and positions itself below an anchor element or at mouse coordinates.
 * Handles click-outside dismiss, Escape key, and viewport edge-clipping.
 */
export default function PopupMenu({ anchorRef, mousePosition, onClose, disableClose = false, children, style: extraStyle, 'data-testid': dataTestId }: PopupMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // Keep the latest onClose in a ref so the dismiss listeners don't re-subscribe
  // every render when callers pass an inline arrow function.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

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
  // scrolling inside nested scrollable containers.
  useLayoutEffect(() => {
    // Calculate position relative to anchor or mouse position, adjusting for viewport edges
    const updatePosition = () => {
      const menu = menuRef.current;
      if (!menu) return;

      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top: number;
      let left: number;

      if (mousePosition) {
        top = mousePosition.y;
        left = mousePosition.x;
      } else {
        const anchor = anchorRef?.current;
        if (!anchor) return;
        const anchorRect = anchor.getBoundingClientRect();
        top = anchorRect.bottom + ANCHOR_GAP;
        left = anchorRect.left;

        // If menu overflows right edge, align menu's right edge with anchor's right edge
        if (left + menuRect.width > viewportWidth - VIEWPORT_MARGIN) {
          left = anchorRect.right - menuRect.width;
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

      // If menu overflows bottom, flip above the cursor/anchor
      if (top + menuRect.height > viewportHeight - VIEWPORT_MARGIN) {
        const flipFrom = mousePosition ? mousePosition.y : (anchorRef?.current?.getBoundingClientRect().top ?? top);
        top = flipFrom - menuRect.height - ANCHOR_GAP;
      }

      // If flipped above and still overflowing top, clamp to top edge
      if (top < VIEWPORT_MARGIN) {
        top = VIEWPORT_MARGIN;
      }

      setPosition({ top, left });
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
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, mousePosition]);

  // Click-outside and Escape dismiss
  useEffect(() => {
    if (disableClose) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const anchorContains = anchorRef?.current?.contains(target) ?? false;
      if (menuRef.current && !menuRef.current.contains(target) && !anchorContains) {
        onCloseRef.current();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
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

/** A clickable menu item inside a PopupMenu. */
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

/** A horizontal divider line inside a PopupMenu. */
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
