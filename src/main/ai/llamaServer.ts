/**
 * llamaServer.ts — llama.cpp server lifecycle manager (main process only)
 *
 * Manages a detached llama-server process that lives independently of
 * MkBrowser. The server is started lazily on first LLAMACPP inference
 * and survives app restarts.
 *
 * The start/stop/status scripts live in the separate llama-deck project
 * (https://github.com/Clay-Ferguson/llama-deck), which the user installs
 * separately; its location is configured in AI Settings.
 *
 * - ensureRunning(): health-check first; if unreachable, spawn start script
 * - stopServer():    run the stop script
 * - checkHealth():   single health ping → 'running' | 'stopped' | 'loading'
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../configMgr';

export type LlamaServerStatus = 'running' | 'stopped' | 'loading';

const START_SCRIPT = 'start-server.sh';
const STOP_SCRIPT = 'stop-server.sh';

/**
 * How long to wait for the server to answer /health after starting it.
 * Loading a large model into (V)RAM routinely takes several minutes on the
 * first start — a short timeout would abandon a server that is still coming up.
 */
const START_TIMEOUT_MS = 15 * 60_000;

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
 * Model load can take several minutes, so this polls for up to
 * START_TIMEOUT_MS. Every step is awaited (no synchronous waiting), so the
 * main process event loop — and therefore the renderer's IPC — stays free
 * for the whole wait.
 *
 * Throws on failure (missing config, script not found, spawn error, timeout).
 */
export async function ensureRunning(): Promise<void> {
  // Quick check — already running?
  const status = await checkHealth();
  if (status === 'running') return;

  const config = getConfig();
  const folder = config.llamacppFolder;
  if (!folder) {
    throw new Error(
      'No llama-deck folder configured. Set the path in AI Settings.'
    );
  }

  const scriptPath = path.join(folder, START_SCRIPT);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Start script not found: ${scriptPath}`);
  }

  // Pass reasoning mode to the start script: "on" when Agentic Mode is
  // enabled, otherwise "off". The user must restart the server for a
  // change to this setting to take effect.
  const reasoning = config.agenticMode ? 'on' : 'off';

  // Spawn the start script as a fully detached process.
  // It survives MkBrowser restarts. We don't hold the child reference.
  const child = spawn('bash', [scriptPath, reasoning], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  // An unhandled 'error' event on a ChildProcess is thrown as an uncaught
  // exception, which would take down the main process. Record it instead and
  // let the poll loop below surface it.
  let spawnError: Error | undefined;
  child.on('error', (err) => { spawnError = err; });
  child.unref();

  const POLL_INTERVAL = 1000;
  const start = Date.now();

  while (Date.now() - start < START_TIMEOUT_MS) {
    await new Promise((r) => { setTimeout(r, POLL_INTERVAL); });
    if (spawnError) {
      throw new Error(`Failed to run start script: ${spawnError.message}`);
    }
    const health = await checkHealth();
    if (health === 'running') return;
    // 'loading' means it's alive but still loading the model — keep waiting
  }

  const minutes = Math.round(START_TIMEOUT_MS / 60_000);
  throw new Error(
    `llama.cpp server did not become ready within ${minutes} minutes. ` +
    'It may still be loading — use the `status.sh` script in your llama-deck folder to check status or troubleshoot. '
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
  const folder = config.llamacppFolder;
  if (!folder) {
    throw new Error(
      'No llama-deck folder configured. Set the path in AI Settings.'
    );
  }

  const scriptPath = path.join(folder, STOP_SCRIPT);

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
