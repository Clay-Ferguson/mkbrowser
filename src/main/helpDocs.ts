import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Absolute path of the bundled Help documents folder (a copy of the repo's `docs/user_guide/`).
 *
 * Packaged: `forge.config.ts` ships `./docs/user_guide` as an `extraResource`, which lands
 * (by its basename) directly under `process.resourcesPath` on every OS (e.g. the .deb
 * installs it at `/usr/lib/mk-browser/resources/user_guide`). Dev: the live repo
 * `docs/user_guide/` folder.
 *
 * See: (USER_GUIDE.md)
 */
export function getHelpDocsPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'user_guide')
    : path.join(app.getAppPath(), 'docs', 'user_guide');
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
