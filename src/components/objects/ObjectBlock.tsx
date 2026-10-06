import type { ReactNode } from 'react';
import ErrorBoundary from '../ErrorBoundary';

interface ObjectBlockProps {
  /** The object's `type` (e.g. "person"), shown as the card's caption. */
  type: string;
  /** The block's YAML source. Editing it clears a render error left by the previous content. */
  source: string;
  /** The card body (`GenericObject`), already bound to its validated data. */
  children: ReactNode;
  /** Opens the editor at the block's source line (see useBlockEditClick). */
  onMouseUp: (e: React.MouseEvent) => void;
}

/**
 * The card every typed object block is rendered in: a bordered frame with the type name as a
 * caption line across the top, above the card body. `not-prose` keeps the Typography plugin's article
 * styles (paragraph margins, link colours, …) out of the card, so the body styles itself.
 *
 * A click (other than on a link) opens the editor with the cursor on the block's opening fence,
 * the same way a click on a paragraph or heading does.
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
      <div className="mb-1 text-right text-xs leading-none uppercase tracking-wide text-slate-400 select-none">{type}</div>
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
 * Shown under a YAML block whose `type` is a defined object type but whose values don't fit
 * it. The block itself still renders as ordinary code; this says why it isn't a card.
 */
export function InvalidObjectHint({ type, error }: InvalidObjectHintProps) {
  return (
    <div data-testid="invalid-object-hint" className="mt-1 text-xs text-amber-300/90">
      Invalid {type}: {error}
    </div>
  );
}
