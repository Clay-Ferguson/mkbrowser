import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { OcrTarget } from '../shared/shared';

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

/**
 * Run a shell script (`.sh` file) in an external terminal window. If the script's
 * first 10 lines contain the directive `# Terminal=false`, the script is instead
 * launched silently in the background with no visible terminal. In both cases the
 * child process is detached so the app does not wait for it to finish.
 *
 * Returns `{ success: false }` when the file is not a `.sh` script, cannot be
 * read, or no terminal emulator is available.
 */
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

/**
 * Wrap an arbitrary string as a single POSIX shell token. Anything inside single
 * quotes is taken literally by the shell, so the only character needing special
 * handling is `'` itself, which is closed, escaped, and reopened (`'\''`). The
 * returned value is safe to splice into a `bash -c` command string.
 */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run ocr.sh in a new external terminal window. The OCR tools folder is used as the
 * working directory (so ocr.sh is found and run from there) rather than being spliced
 * into the command, and every target path/label is passed through shellQuote, so
 * user-controlled paths can never escape into executable shell.
 */
export async function runOcrInTerminal(
  ocrToolsFolder: string,
  targets: OcrTarget[]
): Promise<{ success: boolean; error?: string }> {
  const terminal = await findTerminalEmulator();
  if (!terminal) {
    return { success: false, error: NO_TERMINAL_ERROR };
  }
  if (targets.length === 0) {
    return { success: false, error: 'No OCR targets provided.' };
  }

  const calls = targets.map((target) => {
    const ocrCall = `./ocr.sh ${shellQuote(target.path)}`;
    return target.label ? `echo ${shellQuote(target.label)} && ${ocrCall}` : ocrCall;
  });
  const command = calls.join(' && ');

  const child = spawn(terminal.cmd, [...terminal.args, 'bash', '-c', `${command}; exec bash`], {
    cwd: ocrToolsFolder,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { success: true };
}
