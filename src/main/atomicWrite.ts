import fs from 'node:fs';
import path from 'node:path';
import { customAlphabet } from 'nanoid';

/** Random hex suffix for temp file names (filesystem-safe, collision-resistant). */
const randomSuffix = customAlphabet('0123456789abcdef', 8);

/**
 * fsyncs a directory, flushing its inode so that a rename() into it is durable.
 *
 * rename() only updates the directory's in-memory inode; until that inode is
 * flushed, a power loss can roll the entry back to the old name — resurrecting
 * the PREVIOUS version of the file even though the write reported success.
 * fsyncing the directory after the rename closes that window.
 *
 * Best effort by design: opening a directory as a file is not portable (Windows
 * rejects it, and some filesystems reject the fsync itself). The rename has
 * already succeeded and the new bytes are already on disk by this point, so a
 * failure here costs durability of the final metadata flip, not correctness —
 * never a reason to fail the caller's save.
 */
async function syncDirectory(dir: string): Promise<void> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(dir, 'r');
    await handle.sync();
  } catch {
    // Unsupported on this platform/filesystem — ignore (see note above).
  }
  if (handle) {
    try {
      await handle.close();
    } catch {
      // ignore — nothing more we can do
    }
  }
}

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
 * The parent directory is then fsynced AFTER the rename (see syncDirectory), since
 * the rename lands in the directory's inode and would otherwise be free to roll
 * back on a power loss, resurrecting the old version of the file. That flush is
 * best effort — where the platform refuses it, the fallback is losing the newest
 * save and re-reading the previous complete version, never a torn file.
 *
 * WHERE THE FSYNCS ACTUALLY EARN THEIR COST: on stock Linux ext4 (data=ordered,
 * the default) both fsyncs are close to redundant — that mount option already
 * refuses to commit the rename until the file's data blocks are on disk, so the
 * failure modes above cannot arise, and auto_da_alloc covers the rename-over-
 * existing case a second time. They are insurance for the environments this app
 * also ships to, or gets aimed at, where no such ordering is promised:
 *   - macOS (APFS/HFS+) and Windows (NTFS): both journal metadata, but neither
 *     orders a file's data ahead of the rename that publishes it;
 *   - network / FUSE / cloud-synced folders (NFS, sshfs, Dropbox, Drive,
 *     OneDrive): a folder browser gets pointed straight at these routinely, and
 *     they batch, reorder, and define their own rename semantics;
 *   - ext4 mounted data=writeback, which drops data-before-metadata ordering
 *     deliberately, for throughput.
 * The fsyncs are not free (each is a real journal commit + device flush, and the
 * directory fsync is a second barrier on top of the file's). But measure before
 * removing them, and note that the platform where the cost shows up is not the
 * platform that needs the guarantee — benchmarking on Linux ext4 will make them
 * look like pure overhead precisely because that is the one case already covered.
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
 *
 * SYMLINKS: if the target path is a symlink, the temp-file+rename would replace
 * the *link itself* with a regular file, silently forking the document from its
 * real target. So for a symlink we instead write *through* the link with a plain
 * (non-atomic) write: it follows the link and rewrites the real target's bytes,
 * keeping the link — and the target's inode, mode, and ownership — intact. The
 * trade-off is loss of atomicity (a crash mid-write can leave a torn file), which
 * is acceptable for the uncommon symlinked-document case.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  // Write through a symlink rather than clobbering it (see SYMLINKS note above).
  // lstat does not follow the link, so isSymbolicLink() detects the link itself.
  // A missing target (first write) or unstattable path falls through to the
  // atomic path below, which creates the file fresh.
  //
  // The catch guards ONLY the lstat. The write-through itself must sit OUTSIDE
  // it: an earlier version wrapped both, so when the target WAS a symlink but
  // the write-through failed (dangling link → ENOENT, read-only target →
  // EACCES), the error was swallowed and control fell into the atomic path —
  // which "succeeded" by renaming a temp file over the link, replacing the link
  // with a regular file and silently forking the document from its real target,
  // the exact outcome this branch exists to prevent. Once we know filePath is a
  // symlink, write-through is the only acceptable strategy; its failure must
  // propagate to the caller, never trigger the rename fallback.
  let isSymlink = false;
  try {
    isSymlink = (await fs.promises.lstat(filePath)).isSymbolicLink();
  } catch {
    // Target absent or unstattable — use the atomic path below.
  }
  if (isSymlink) {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return;
  }

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

    // Preserve the target's permission bits. rename() replaces the target with a
    // brand-new inode, so the temp file's default mode (0666 & umask, typically
    // 0644) would otherwise silently widen a restricted file — e.g. a 0600 private
    // note becomes world-readable after any rewrite. Copy the existing mode onto
    // the temp file before the rename. When the target doesn't exist yet (a first
    // write), there's nothing to preserve, so keep the default mode.
    try {
      const { mode } = await fs.promises.stat(filePath);
      await fs.promises.chmod(tmpPath, mode);
    } catch {
      // Target absent (first write) or mode unreadable — keep the default mode.
    }

    await fs.promises.rename(tmpPath, filePath);
    // Flush the rename itself. Never throws, so it cannot reach the cleanup below
    // and unlink/report failure for a write that already succeeded.
    await syncDirectory(dir);
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
