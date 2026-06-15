import { useRef, useLayoutEffect, useEffect, useState, type ReactNode, type RefObject, type ComponentType } from 'react';
import { CheckIcon } from '@heroicons/react/24/solid';
import { MENU_CONTAINER, MENU_ITEM_BASE, MENU_ITEM_ENABLED, MENU_ITEM_DISABLED, MENU_DIVIDER } from '../../../utils/styles';

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
 * Reusable popup menu that positions itself below an anchor element or at mouse coordinates.
 * Handles click-outside dismiss, Escape key, and viewport edge-clipping.
 */
export default function PopupMenu({ anchorRef, mousePosition, onClose, disableClose = false, children, style: extraStyle, 'data-testid': dataTestId }: PopupMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // Calculate position relative to anchor or mouse position, adjusting for viewport edges
  useLayoutEffect(() => {
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
      top = anchorRect.bottom + 4;
      left = anchorRect.left;

      // If menu overflows right edge, align menu's right edge with anchor's right edge
      if (left + menuRect.width > viewportWidth - 8) {
        left = anchorRect.right - menuRect.width;
      }
    }

    // Clamp right edge
    if (left + menuRect.width > viewportWidth - 8) {
      left = viewportWidth - menuRect.width - 8;
    }

    // If still overflowing left, clamp to left edge
    if (left < 8) {
      left = 8;
    }

    // If menu overflows bottom, flip above the cursor/anchor
    if (top + menuRect.height > viewportHeight - 8) {
      top = (mousePosition ? mousePosition.y : (anchorRef?.current?.getBoundingClientRect().top ?? top)) - menuRect.height - 4;
    }

    // If flipped above and still overflowing top, clamp to top edge
    if (top < 8) {
      top = 8;
    }

    setPosition({ top, left });
  }, [anchorRef, mousePosition]);

  // Click-outside dismiss
  useEffect(() => {
    if (disableClose) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const anchorContains = anchorRef?.current?.contains(target) ?? false;
      if (menuRef.current && !menuRef.current.contains(target) && !anchorContains) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [anchorRef, onClose, disableClose]);

  // Escape key dismiss
  useEffect(() => {
    if (disableClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, disableClose]);

  return (
    <div
      ref={menuRef}
      data-testid={dataTestId}
      className={MENU_CONTAINER}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        // Keep invisible until position is calculated to avoid flicker
        visibility: position ? 'visible' : 'hidden',
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}

/** A clickable menu item inside a PopupMenu. */
export function PopupMenuItem({
  label,
  onClick,
  disabled = false,
  selected,
  icon: Icon,
  'data-testid': dataTestId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** If undefined: no checkbox area. If true: show checkmark. If false: show empty space (for alignment). */
  selected?: boolean;
  /** Optional icon component to display to the left of the label. */
  icon?: ComponentType<{ className?: string }>;
  'data-testid'?: string;
}) {
  // When selected is defined (true or false), we reserve space for the checkbox
  const hasCheckboxArea = selected !== undefined;

  return (
    <button
      className={`${MENU_ITEM_BASE} ${hasCheckboxArea ? 'px-3' : 'px-4'} ${disabled ? MENU_ITEM_DISABLED : MENU_ITEM_ENABLED}`}
      onClick={() => {
        if (!disabled) {
          onClick();
        }
      }}
      disabled={disabled}
      data-testid={dataTestId}
    >
      {hasCheckboxArea && (
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          {selected && <CheckIcon className="w-5 h-5 text-white" />}
        </div>
      )}
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
      <span>{label}</span>
    </button>
  );
}

/** A horizontal divider line inside a PopupMenu. */
export function PopupMenuDivider() {
  return <div className={MENU_DIVIDER} />;
}
