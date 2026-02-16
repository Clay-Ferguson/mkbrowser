import { useRef, useLayoutEffect, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { CheckIcon } from '@heroicons/react/24/solid';

export interface PopupMenuProps {
  /** Ref to the button/element that triggered the menu */
  anchorRef: RefObject<HTMLElement | null>;
  /** Called when the menu should close (click outside, Escape, item click) */
  onClose: () => void;
  children: ReactNode;
  /** Optional extra inline styles merged onto the menu container */
  style?: React.CSSProperties;
}

/**
 * Reusable popup menu that positions itself below an anchor element.
 * Handles click-outside dismiss, Escape key, and viewport edge-clipping.
 */
export default function PopupMenu({ anchorRef, onClose, children, style: extraStyle }: PopupMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // Calculate position relative to anchor, adjusting for viewport edges
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const menu = menuRef.current;
    if (!menu) return;

    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Default: below the anchor, left-aligned with anchor's left edge
    let top = anchorRect.bottom + 4;
    let left = anchorRect.left;

    // If menu overflows right edge, align menu's right edge with anchor's right edge
    if (left + menuRect.width > viewportWidth - 8) {
      left = anchorRect.right - menuRect.width;
    }

    // If still overflowing left, clamp to left edge
    if (left < 8) {
      left = 8;
    }

    // If menu overflows bottom, flip above the anchor
    if (top + menuRect.height > viewportHeight - 8) {
      top = anchorRect.top - menuRect.height - 4;
    }

    // If flipped above and still overflowing top, clamp to top edge
    if (top < 8) {
      top = 8;
    }

    setPosition({ top, left });
  }, [anchorRef]);

  // Click-outside dismiss
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [anchorRef, onClose]);

  // Escape key dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-slate-800 border-2 border-slate-400 rounded-lg shadow-xl py-1 px-0.5 min-w-[180px]"
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
  'data-testid': dataTestId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** If undefined: no checkbox area. If true: show checkmark. If false: show empty space (for alignment). */
  selected?: boolean;
  'data-testid'?: string;
}) {
  // When selected is defined (true or false), we reserve space for the checkbox
  const hasCheckboxArea = selected !== undefined;

  return (
    <button
      className={`w-full text-left py-2 text-sm transition-colors flex items-center gap-2 ${
        hasCheckboxArea ? 'px-3' : 'px-4'
      } ${
        disabled
          ? 'text-slate-500 cursor-not-allowed'
          : 'text-slate-200 hover:bg-blue-800 cursor-pointer'
      }`}
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
      <span>{label}</span>
    </button>
  );
}

/** A horizontal divider line inside a PopupMenu. */
export function PopupMenuDivider() {
  return <div className="border-t border-slate-700 my-1" />;
}
