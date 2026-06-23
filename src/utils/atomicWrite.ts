import fs from 'node:fs';
import path from 'node:path';
import { customAlphabet } from 'nanoid';

/** Random hex suffix for temp file names (filesystem-safe, collision-resistant). */
const randomSuffix = customAlphabet('0123456789abcdef', 8);

/**
 * Writes content to filePath atomically: writes to a sibling temp file first,
 * then renames it into place. On Linux/macOS, rename() is POSIX-atomic within
 * the same filesystem, so readers always see either the old complete file or
 * the new complete file — never a truncated, half-written intermediate state.
 *
 * The temp file is created in the SAME directory as the target (rename is only
 * atomic within one filesystem/mount) and given a leading-dot, randomized name
 * so that:
 *   - a concurrent crawl skips it (the app's hidden-file convention excludes
 *     anything starting with '.'), and
 *   - concurrent writers never collide on the temp path.
 *
 * If the write or rename fails, the temp file is unlinked (best effort) so a
 * failed operation never litters the tree with stray temp files.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${randomSuffix()}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup: the temp file may not exist (writeFile may have
    // failed before creating it), so ignore unlink errors and rethrow the
    // original failure to the caller.
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // ignore — nothing to clean up
    }
    throw err;
  }
}
