/**
 * llamaServer.ts — llama.cpp server lifecycle manager (main process only)
 *
 * Manages a detached llama-server process that lives independently of
 * MkBrowser. The server is started lazily on first LLAMACPP inference
 * and survives app restarts.
 *
 * - ensureRunning(): health-check first; if unreachable, spawn start script
 * - stopServer():    run the stop script
 * - checkHealth():   single health ping → 'running' | 'stopped' | 'loading'
 */

import { spawn } from 'node:child_process';
import { getConfig } from './configMgr';

export type LlamaServerStatus = 'running' | 'stopped' | 'loading';

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Derive the health URL from the configured base URL.
 * Config stores e.g. "http://localhost:8080/v1" — the health endpoint
 * is at "http://localhost:8080/health" (strip the /v1 suffix).
 */
function getHealthUrl(): string {
  const config = getConfig();
  const baseUrl = config.llamacppBaseUrl || 'http://localhost:8080/v1';
  // Strip trailing /v1 or /v1/ to get the root
  const root = baseUrl.replace(/\/v1\/?$/, '');
  return `${root}/health`;
}

/**
 * Single health ping. Returns the server status.
 */
export async function checkHealth(): Promise<LlamaServerStatus> {
  const url = getHealthUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return 'stopped';
    const body = await res.json() as { status?: string };
    if (body.status === 'ok') return 'running';
    if (body.status === 'loading model') return 'loading';
    // Any other status (e.g. "no slot available") means it's alive
    return 'running';
  } catch {
    return 'stopped';
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

/**
 * Ensure the llama-server is running. If it's already reachable, returns
 * immediately. Otherwise spawns the configured start script as a detached
 * process and polls the health endpoint until the server is ready.
 *
 * Throws on failure (missing config, script not found, timeout).
 */
export async function ensureRunning(): Promise<void> {
  // Quick check — already running?
  const status = await checkHealth();
  if (status === 'running') return;

  const config = getConfig();
  const scriptPath = config.llamacppStartScript;
  if (!scriptPath) {
    throw new Error(
      'No llama.cpp start script configured. Set the path in AI Settings.'
    );
  }

  // Spawn the start script as a fully detached process.
  // It survives MkBrowser restarts. We don't hold the child reference.
  const child = spawn('bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // Poll health until the server is ready (up to 60 seconds)
  const POLL_INTERVAL = 500;
  const MAX_WAIT = 60_000;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const health = await checkHealth();
    if (health === 'running') return;
    // 'loading' means it's alive but still loading the model — keep waiting
  }

  throw new Error(
    'llama.cpp server did not become ready within 60 seconds. ' +
    'Try running the start script manually to see error output.'
  );
}

// ---------------------------------------------------------------------------
// Stop server
// ---------------------------------------------------------------------------

/**
 * Stop the llama-server by running the configured stop script.
 * Throws if no stop script is configured or the script fails.
 */
export async function stopServer(): Promise<void> {
  const config = getConfig();
  const scriptPath = config.llamacppStopScript;
  if (!scriptPath) {
    throw new Error(
      'No llama.cpp stop script configured. Set the path in AI Settings.'
    );
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn('bash', [scriptPath], {
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Stop script exited with code ${code}`));
    });
    child.on('error', (err) => {
      reject(new Error(`Failed to run stop script: ${err.message}`));
    });
  });
}
