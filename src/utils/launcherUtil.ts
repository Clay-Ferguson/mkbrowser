import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Terminal emulators to probe for, in order of preference.
const TERMINALS = [
  { cmd: 'x-terminal-emulator', args: ['-e'] },
  { cmd: 'gnome-terminal', args: ['--'] },
  { cmd: 'konsole', args: ['-e'] },
  { cmd: 'xfce4-terminal', args: ['-e'] },
  { cmd: 'xterm', args: ['-e'] },
  { cmd: 'kitty', args: ['--'] },
  { cmd: 'alacritty', args: ['-e'] },
];

const NO_TERMINAL_ERROR =
  'No terminal emulator found. Please install gnome-terminal, konsole, xterm, or another terminal emulator.';

// Cached probe result: undefined = not probed yet, null = none installed.
let cachedTerminal: { cmd: string; args: string[] } | null | undefined;

/**
 * Find the first available terminal emulator. The probe runs `which` for each
 * candidate, so the result is cached after the first call.
 */
export async function findTerminalEmulator(): Promise<{ cmd: string; args: string[] } | null> {
  if (cachedTerminal !== undefined) return cachedTerminal;

  for (const terminal of TERMINALS) {
    try {
      await execAsync(`which ${terminal.cmd}`);
      cachedTerminal = terminal;
      return terminal;
    } catch {
      // not found, try next
    }
  }

  cachedTerminal = null;
  return null;
}

export async function runShellScript(filePath: string): Promise<{ success: boolean; error?: string }> {
  if (!filePath.endsWith('.sh')) {
    return { success: false, error: `Not a shell script: ${filePath}` };
  }

  // Read up to the first 10 lines to check for Terminal=false directive
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, 'utf-8');
  } catch {
    return { success: false, error: `Script not found: ${filePath}` };
  }
  const first10Lines = content.split('\n').slice(0, 10);
  const hideTerminal = first10Lines.some((line) => line.trim() === '# Terminal=false');

  const scriptDir = path.dirname(filePath);

  if (hideTerminal) {
    // Run the script without a visible terminal window
    const child = spawn('bash', [filePath], {
      cwd: scriptDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { success: true };
  }

  const terminal = await findTerminalEmulator();
  if (!terminal) {
    return { success: false, error: NO_TERMINAL_ERROR };
  }

  const child = spawn(terminal.cmd, [...terminal.args, filePath], {
    cwd: scriptDir,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { success: true };
}

export async function runInExternalTerminal(command: string): Promise<{ success: boolean; error?: string }> {
  const terminal = await findTerminalEmulator();
  if (!terminal) {
    return { success: false, error: NO_TERMINAL_ERROR };
  }

  const child = spawn(terminal.cmd, [...terminal.args, 'bash', '-c', `${command}; exec bash`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { success: true };
}
