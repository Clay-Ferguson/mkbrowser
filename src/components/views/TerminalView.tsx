import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useCurrentPath, useRootPath } from '../../store';

/**
 * Module-level singletons so the terminal session persists across tab switches.
 * When the user navigates away from the Terminal tab and comes back, the React
 * component unmounts/remounts, but the Terminal instance & PTY stay alive.
 *
 * IMPORTANT: We also keep a persistent DOM element (`terminalContainer`) that
 * holds xterm's internal DOM.  xterm.js cannot re-`open()` onto a new element,
 * so instead of letting React destroy and recreate the host div, we reparent
 * the persistent element into/out of whatever wrapper React gives us.
 */
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let terminalContainer: HTMLDivElement | null = null; // persistent DOM host for xterm
let spawned = false;
let exited = false;
let exitCode: number | null = null;

/** Cleanup functions for IPC listeners */
let removeOutputListener: (() => void) | null = null;
let removeExitListener: (() => void) | null = null;

/**
 * Theme colours matching the MkBrowser dark UI (slate palette).
 */
const TERMINAL_THEME = {
  background: '#0f172a',   // slate-900
  foreground: '#e2e8f0',   // slate-200
  cursor: '#38bdf8',       // sky-400
  cursorAccent: '#0f172a',
  selectionBackground: '#334155', // slate-700
  selectionForeground: '#f8fafc', // slate-50
  // Standard ANSI colours (dark variant)
  black: '#1e293b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  // Bright variants
  brightBlack: '#475569',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc',
};

function createTerminal(): Terminal {
  // Create the persistent DOM element that will host xterm's internals.
  // This element is never destroyed — we reparent it on mount/unmount.
  terminalContainer = document.createElement('div');
  terminalContainer.style.width = '100%';
  terminalContainer.style.height = '100%';

  const term = new Terminal({
    theme: TERMINAL_THEME,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
    fontSize: 14,
    cursorBlink: true,
    cursorStyle: 'block',
    allowProposedApi: true,
    scrollback: 5000,
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // Open once into the persistent container — never again.
  term.open(terminalContainer);
  return term;
}

export default function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentPath = useCurrentPath();
  const rootPath = useRootPath();
  const cwd = currentPath || rootPath || process.env.HOME || '/';

  /**
   * Spawn (or re-attach) the PTY.
   */
  const spawnTerminal = useCallback(async (workingDir: string) => {
    if (spawned && !exited) return; // Already running
    exited = false;
    exitCode = null;
    spawned = true;

    const result = await window.electronAPI.terminalSpawn(workingDir);
    if (!result.success) {
      terminal?.writeln(`\r\n\x1b[31mFailed to start terminal: ${result.error}\x1b[0m`);
      spawned = false;
    }
  }, []);

  /**
   * Re-spawn after the process exited (user clicks Restart).
   */
  const handleRestart = useCallback(() => {
    if (terminal) {
      terminal.clear();
    }
    exited = false;
    exitCode = null;
    spawned = false;
    spawnTerminal(cwd);
  }, [cwd, spawnTerminal]);

  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;

    // First mount ever: create the Terminal + its persistent DOM host
    if (!terminal) {
      terminal = createTerminal();
    }

    // Reparent the persistent xterm container into the current React wrapper
    wrapper.appendChild(terminalContainer!);

    // Fit after reparent so dimensions are correct
    requestAnimationFrame(() => {
      fitAddon?.fit();
    });

    // Wire keystrokes → PTY
    const dataDisposable = terminal.onData((data: string) => {
      window.electronAPI.terminalWrite(data);
    });

    // Wire PTY output → terminal
    removeOutputListener = window.electronAPI.onTerminalOutput((data: string) => {
      terminal?.write(data);
    });

    // Wire PTY exit → show message
    removeExitListener = window.electronAPI.onTerminalExit((code: number) => {
      exited = true;
      exitCode = code;
      terminal?.writeln(`\r\n\x1b[90m[Process exited with code ${code} — press any key to restart]\x1b[0m`);
    });

    // Handle "press any key to restart" after exit
    const exitKeyDisposable = terminal.onKey(() => {
      if (exited) {
        handleRestart();
      }
    });

    // Auto-resize terminal when container size changes
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon?.fit();
        if (terminal && spawned && !exited) {
          window.electronAPI.terminalResize(terminal.cols, terminal.rows);
        }
      } catch {
        // Ignore resize errors during teardown
      }
    });
    resizeObserver.observe(wrapper);

    // Spawn the shell if not already running
    if (!spawned) {
      spawnTerminal(cwd);
    } else {
      // Re-attached — inform PTY of current size
      if (terminal && !exited) {
        window.electronAPI.terminalResize(terminal.cols, terminal.rows);
      }
    }

    // Focus the terminal
    terminal.focus();

    return () => {
      // Cleanup on unmount (tab switch) — but do NOT dispose the Terminal
      // or kill the PTY so the session persists.
      // Remove the persistent xterm container from the React wrapper so
      // React can safely destroy the wrapper div without taking xterm's
      // DOM with it.
      if (terminalContainer && wrapper.contains(terminalContainer)) {
        wrapper.removeChild(terminalContainer);
      }
      dataDisposable.dispose();
      exitKeyDisposable.dispose();
      removeOutputListener?.();
      removeOutputListener = null;
      removeExitListener?.();
      removeExitListener = null;
      resizeObserver.disconnect();
    };
  }, [cwd, spawnTerminal, handleRestart]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0"
      style={{ padding: '4px 0 0 4px', background: TERMINAL_THEME.background }}
    />
  );
}
