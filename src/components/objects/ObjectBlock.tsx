import type { ReactNode } from 'react';
import ErrorBoundary from '../ErrorBoundary';

interface ObjectBlockProps {
  /** The object's `type` (e.g. "person"), shown as the card's caption. */
  type: string;
  /** The file content the object was read from. A change clears a render error left by the previous content. */
  source: string;
  /** The card body (`GenericObject`), already bound to its validated data. */
  children: ReactNode;
  /** Opens the editor on the object's front matter. */
  onMouseUp: (e: React.MouseEvent) => void;
}

/**
 * The card a file's object (its typed front matter) is rendered in: a bordered frame with the type name as a
 * caption line across the top, above the card body. `not-prose` keeps the Typography plugin's article
 * styles (paragraph margins, link colours, …) out of the card, so the body styles itself.
 *
 * A click (other than on a link) opens the editor with the front matter shown and the cursor on
 * the object's first property line.
 */
export default function ObjectBlock({ type, source, children, onMouseUp }: ObjectBlockProps) {
  return (
    <div
      onMouseUp={onMouseUp}
      data-testid="object-block"
      data-object-type={type}
      className="not-prose mb-4 w-fit max-w-full min-w-64 rounded-md border border-slate-600 bg-slate-700/50 px-4 pt-2 pb-3 text-slate-200"
    >
      {/* On a row of its own, right-aligned, so it takes vertical space rather than horizontal:
          the type's content below gets the card's full width and can never run under it. */}
      <div className="mb-1 text-right text-xs leading-none uppercase tracking-wide text-sky-400 select-none">{type}</div>
      <ErrorBoundary label={`${type} object`} resetKeys={[source]}>
        {children}
      </ErrorBoundary>
    </div>
  );
}

interface InvalidObjectHintProps {
  type: string;
  /** Completes the sentence "Invalid <type>: …". */
  error: string;
}

/**
 * Shown in place of the card when the front matter's `type` is a defined object type but its
 * values don't fit it (e.g. a list where text is expected), saying why there is no card.
 */
export function InvalidObjectHint({ type, error }: InvalidObjectHintProps) {
  return (
    <div data-testid="invalid-object-hint" className="mt-1 text-xs text-amber-300/90">
      Invalid {type}: {error}
    </div>
  );
}
