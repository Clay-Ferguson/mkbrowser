import fs from 'node:fs';
import path from 'node:path';
import { customAlphabet } from 'nanoid';

/** Random hex suffix for temp file names (filesystem-safe, collision-resistant). */
const randomSuffix = customAlphabet('0123456789abcdef', 8);

/**
 * Writes content to filePath atomically: writes to a sibling temp file first,
 * fsyncs it, then renames it into place. On Linux/macOS, rename() is POSIX-atomic
 * within the same filesystem, so readers always see either the old complete file
 * or the new complete file — never a truncated, half-written intermediate state.
 *
 * The fsync (handle.sync()) forces the temp file's bytes to physically reach the
 * disk BEFORE the rename. Without it, a power loss could leave the rename durable
 * while the data blocks it points at were never written — i.e. a renamed-but-empty
 * or garbage file. fsync-before-rename is the standard durable-write technique.
 *
 * The temp file is created in the SAME directory as the target (rename is only
 * atomic within one filesystem/mount) and given a leading-dot, randomized name
 * so that:
 *   - a concurrent crawl skips it (the app's hidden-file convention excludes
 *     anything starting with '.'), and
 *   - concurrent writers never collide on the temp path.
 *
 * If anything fails, the temp file is unlinked (best effort) so a failed
 * operation never litters the tree with stray temp files.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${randomSuffix()}.tmp`);
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(tmpPath, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync(); // fsync: flush bytes to disk before the rename
    await handle.close();
    handle = undefined;
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup: close a still-open handle, then unlink the temp file.
    // It may not exist (open may have failed before creating it), so ignore
    // cleanup errors and rethrow the original failure to the caller.
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore — nothing more we can do
      }
    }
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // ignore — nothing to clean up
    }
    throw err;
  }
}
