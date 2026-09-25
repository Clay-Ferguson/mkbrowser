import type { ReactNode } from 'react';
import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { toErrorMessage } from '../shared/logUtil';
import { BUTTON_CLASS_SM_NEUTRAL } from '../renderer/styles';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback UI; defaults to a small inline error card with a "Try again" button. */
  fallback?: (props: FallbackProps) => ReactNode;
  /** Short description of what failed (e.g. a file name), shown in the default fallback. */
  label?: string;
  /**
   * When any value in this array changes while the boundary is showing its
   * fallback, the error is cleared and the children re-render — e.g. pass
   * `[entry.modifiedTime]` so a file row recovers once the file is fixed on
   * disk. Unlike a changing `key`, this never remounts healthy children.
   */
  resetKeys?: unknown[];
}

function DefaultFallback({ error, resetErrorBoundary, label }: FallbackProps & { label?: string }) {
  return (
    <div
      role="alert"
      data-testid="error-boundary-fallback"
      className="m-1 p-3 rounded-md border border-red-500/50 bg-red-950/30 text-sm text-red-200 flex items-start gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{label ? `Failed to render ${label}` : 'Something went wrong while rendering this section'}</div>
        <div className="mt-1 font-mono text-xs text-red-300 break-words whitespace-pre-wrap">{toErrorMessage(error)}</div>
      </div>
      <button type="button" className={BUTTON_CLASS_SM_NEUTRAL} onClick={() => resetErrorBoundary()}>
        Try again
      </button>
    </div>
  );
}

/**
 * Catches render-time exceptions in its subtree so one bad file, markdown
 * block, or view shows an inline error card instead of unmounting the whole
 * React root. A thin wrapper over `react-error-boundary` that supplies the
 * app's default fallback card.
 *
 * Logging happens once, centrally, via the root's `onCaughtError` in
 * `src/renderer.tsx` — this component only renders the fallback.
 */
function ErrorBoundary({ children, fallback, label, resetKeys }: ErrorBoundaryProps) {
  return (
    <ReactErrorBoundary
      resetKeys={resetKeys}
      fallbackRender={fallback ?? ((props) => <DefaultFallback {...props} label={label} />)}
    >
      {children}
    </ReactErrorBoundary>
  );
}

export default ErrorBoundary;
