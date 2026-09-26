import { setAppError } from '../store';
import { ipcErrorMessage } from './api';

/**
 * Fire-and-forget runner for user-initiated async operations (handlers bound to
 * button clicks, menu items, drag-and-drop, and `() => void` entry props):
 * awaits `op` and reports a failure through `onError` — the app-wide error
 * dialog by default — prefixed, instead of leaking an unhandled rejection or
 * failing silently.
 *
 * Module-level (a plain function, not compiled) so handlers need no try/catch
 * bodies — the React Compiler bails out on try/finally and on value blocks
 * (`?.`, `||`, ternaries) inside a try/catch statement.
 *
 * Rule: every user-initiated async operation reports failure through
 * setAppError (here, or directly for `ok: false`/`success: false` results).
 * Log-only is for background work the user didn't ask for.
 */
export function runOp(op: () => Promise<unknown>, errorPrefix: string, onError: (msg: string) => void = setAppError): void {
  op().catch((err: unknown) => onError(errorPrefix + ipcErrorMessage(err)));
}
