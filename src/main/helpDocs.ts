import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { logger } from '../shared/logUtil';
import { OPEN_FILE_ARG } from './openFileArg';

/**
 * Command-line flag that launches MkBrowser as a "Help instance": a separate app
 * process that browses the bundled Help documents instead of the user's folders.
 */
export const HELP_DOCS_ARG = '--help-docs';

/** True when this process was launched as a Help instance (see HELP_DOCS_ARG). */
export const isHelpInstance = process.argv.includes(HELP_DOCS_ARG);

/** Window title of a Help instance, so it is distinguishable from the user's own window. */
export const HELP_WINDOW_TITLE = 'MkBrowser Help';

/** The document a Help instance opens first, relative to the Help documents folder. */
const HELP_START_FILE = 'USER_GUIDE.md';

/**
 * Absolute path of the bundled Help documents folder (a copy of the repo's `docs/`).
 *
 * Packaged: `forge.config.ts` ships `./docs` as an `extraResource`, which lands
 * directly under `process.resourcesPath` on every OS (e.g. the .deb installs it at
 * `/usr/lib/mk-browser/resources/docs`). Dev: the live repo `docs/` folder.
 */
export function getHelpDocsPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'docs')
    : path.join(app.getAppPath(), 'docs');
}

/** The Help documents folder, or null if it is missing (e.g. a broken install). */
export async function findHelpDocsFolder(): Promise<string | null> {
  const docsPath = getHelpDocsPath();
  try {
    const stat = await fs.promises.stat(docsPath);
    return stat.isDirectory() ? docsPath : null;
  } catch {
    return null;
  }
}

/**
 * Give a Help instance its own profile and config folder (`<userData>/help-instance`).
 * Must run before `app.ready`. Without this, the Help instance would share the
 * user's `config.yaml` (its startup would overwrite their `browseFolder`, and the
 * two processes' config writes would clobber each other) and Chromium profile.
 */
export function isolateHelpInstanceProfile(): void {
  if (!isHelpInstance) return;
  app.setPath('userData', path.join(app.getPath('userData'), 'help-instance'));
}

/**
 * Launch a new, independent MkBrowser process that browses the Help documents,
 * starting on HELP_START_FILE in single-file mode.
 * Multiple Help instances are allowed. In dev, `process.execPath` is the electron
 * binary, so the app path must be passed as well.
 */
export function launchHelpInstance(): void {
  const args = app.isPackaged ? [] : [app.getAppPath()];
  if (process.argv.includes('--no-sandbox')) args.push('--no-sandbox');
  args.push(HELP_DOCS_ARG, `${OPEN_FILE_ARG}=${HELP_START_FILE}`);

  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => logger.error('Failed to launch Help instance:', err));
  child.unref();
}
