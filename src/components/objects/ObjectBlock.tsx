import type { ReactNode } from 'react';
import ErrorBoundary from '../ErrorBoundary';

interface ObjectBlockProps {
  /** The object's `type` (e.g. "person"), shown as the card's caption. */
  type: string;
  /** The block's YAML source. Editing it clears a render error left by the previous content. */
  source: string;
  /** The type's own component, already bound to its validated data. */
  children: ReactNode;
}

/**
 * The card every typed object block is rendered in: a bordered frame with the type name as a
 * caption, around the type's own component. `not-prose` keeps the Typography plugin's article
 * styles (paragraph margins, link colours, …) out of the card, so each type styles itself.
 *
 * Deliberately has no mouse handlers: a click falls through to the entry's content area, which
 * opens the editor exactly as a click on an ordinary code block does.
 */
export default function ObjectBlock({ type, source, children }: ObjectBlockProps) {
  return (
    <div
      data-testid="object-block"
      data-object-type={type}
      className="not-prose relative mb-4 w-fit max-w-full min-w-64 rounded-md border border-slate-600 bg-slate-800/60 px-4 py-3 text-slate-200"
    >
      <span className="absolute top-2 right-3 text-xs uppercase tracking-wide text-slate-500 select-none">{type}</span>
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
 * Shown under a YAML block whose `type` is a registered object type but whose fields don't fit
 * it. The block itself still renders as ordinary code; this says why it isn't a card.
 */
export function InvalidObjectHint({ type, error }: InvalidObjectHintProps) {
  return (
    <div data-testid="invalid-object-hint" className="mt-1 text-xs text-amber-300/90">
      Invalid {type}: {error}
    </div>
  );
}
