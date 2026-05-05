import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

export async function runShellScript(filePath: string): Promise<{ success: boolean; error?: string }> {
  if (!filePath.endsWith('.sh')) {
    return { success: false, error: `Not a shell script: ${filePath}` };
  }

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Script not found: ${filePath}` };
  }

  // Read up to the first 10 lines to check for Terminal=false directive
  const content = fs.readFileSync(filePath, 'utf-8');
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

  // Find an available terminal emulator
  const terminals = [
    { cmd: 'x-terminal-emulator', args: ['-e'] },
    { cmd: 'gnome-terminal', args: ['--'] },
    { cmd: 'konsole', args: ['-e'] },
    { cmd: 'xfce4-terminal', args: ['-e'] },
    { cmd: 'xterm', args: ['-e'] },
    { cmd: 'kitty', args: ['--'] },
    { cmd: 'alacritty', args: ['-e'] },
  ];

  let terminalCmd: string | null = null;
  let terminalArgs: string[] = [];

  for (const terminal of terminals) {
    try {
      execSync(`which ${terminal.cmd}`, { stdio: 'ignore' });
      terminalCmd = terminal.cmd;
      terminalArgs = terminal.args;
      break;
    } catch {
      // not found, try next
    }
  }

  if (!terminalCmd) {
    return {
      success: false,
      error: 'No terminal emulator found. Please install gnome-terminal, konsole, xterm, or another terminal emulator.',
    };
  }

  const child = spawn(terminalCmd, [...terminalArgs, filePath], {
    cwd: scriptDir,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { success: true };
}
