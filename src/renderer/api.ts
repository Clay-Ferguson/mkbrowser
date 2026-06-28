import type { ElectronAPI } from '../shared/shared';

/**
 * Single, typed access point to the Electron preload bridge (the IPC boundary).
 *
 * Renderer code — components, hooks, and utilities — should import `api` from
 * here instead of reaching for `window.electronAPI` directly. Centralizing the
 * bridge in one module keeps the IPC surface isolated, decouples presentational
 * components from the preload global, and makes them easy to unit-test: a test
 * mocks this module (`vi.mock('../renderer/api')`) rather than stubbing a
 * browser global on every run.
 *
 * The exported `api` is a Proxy that forwards lazily to the live
 * `window.electronAPI`. Forwarding lazily (rather than capturing the bridge at
 * import time) means this module is safe to import in any context and always
 * reflects the current global, which also keeps test setup simple.
 */

/**
 * Returns the raw preload bridge, or `undefined` when running outside the
 * Electron renderer (e.g. unit tests under Node). Prefer the `api` proxy for
 * normal calls; reach for this only when the bridge may legitimately be absent
 * and you need to fall back gracefully.
 */
export function getApi(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

export const api: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop) {
    const bridge = getApi();
    if (!bridge) {
      throw new Error(
        `electronAPI is unavailable (accessed "${String(prop)}" outside the renderer process)`,
      );
    }
    return bridge[prop as keyof ElectronAPI];
  },
});
