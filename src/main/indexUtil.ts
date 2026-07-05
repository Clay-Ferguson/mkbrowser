import fs from 'node:fs';
import path from 'node:path';
import { load, dump } from 'js-yaml';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import { parseFrontMatter } from '../shared/frontMatterUtil';
import { compareNames } from '../shared/fileTypes';
import { ATTACH_SUFFIX, INDEX_FILENAME } from '../shared/specialFiles';
import { writeFileAtomic } from './atomicWrite';
import { mapWithConcurrency } from '../shared/asyncUtil';
import { logger } from '../shared/logUtil';

/**
 * Error-handling contract for this module's exported functions.
 *
 * Most of these are exposed (largely 1:1) as IPC handlers, so a predictable,
 * uniform contract matters: the renderer must be able to tell success from
 * failure across the boundary. Two shapes, by role:
 *
 *  - **Readers** return their data or a benign empty value (`null` / `[]`) and do
 *    not throw for the ordinary "nothing there" case — a missing `.INDEX.yaml`
 *    just means the directory isn't in Document Mode. `readIndexYaml` returns
 *    `IndexYaml | null`.
 *    The one deliberate exception is `getSortedDirEntries`, which lets a hard
 *    `readdir` failure throw (see its doc comment): its only caller wraps it and
 *    must surface that as a real error rather than silently export an empty file.
 *
 *  - **Mutators** (`reconcileIndexedFiles`, `writeIndexOptions`,
 *    `moveInIndexYaml`, `moveToEdgeInIndexYaml`, `insertIntoIndexYaml`,
 *    `renameInIndexYaml`, `validateAttachFolderLocation`) return
 *    `{ success: boolean; error?: string }` and never throw — every failure is
 *    caught and returned so the caller decides whether to surface it. A
 *    documented no-op (e.g. renaming an entry that isn't present, or reconciling
 *    a non-Document-Mode folder) is a `{ success: true }`, not a failure. The
 *    best-effort, self-healing mutators (`renameInIndexYaml`,
 *    `validateAttachFolderLocation`) additionally log on failure because their
 *    callers intentionally don't surface the result — the on-disk action already
 *    succeeded and the next reconcile heals the index.
 */

const generateId = customAlphabet('0123456789ABCDEF', 9);

/**
 * Bound on concurrent filesystem operations during reconciliation. Each visible
 * file is stat'd/read/written independently, so we fan these out rather than
 * awaiting one round-trip at a time (which sums to N round-trips on large or slow
 * directories). The limit keeps us from opening thousands of fds at once (EMFILE)
 * — the same rationale as the other bounded fs fan-outs in this codebase.
 */
const RECONCILE_FILE_CONCURRENCY = 32;

/**
 * Shared options for every js-yaml `dump()` in this module.
 *
 * `lineWidth: -1` disables js-yaml's default 80-column line folding so long
 * filenames (in the `files` list) and long user-authored front-matter values
 * (titles, descriptions, URLs) are never wrapped/reflowed on a routine write —
 * matching the convention already used in tagUtil.ts and joinUtil.ts.
 * `noRefs: true` avoids emitting YAML anchors/aliases for duplicate references.
 */
const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true } as const;

/** Absolute path to the .INDEX.yaml file for a given directory. */
function indexPathFor(dirPath: string): string {
  return path.join(dirPath, INDEX_FILENAME);
}

/**
 * Per-directory serialization for .INDEX.yaml mutations.
 *
 * Every mutator in this module follows read → modify-in-memory → writeFileAtomic.
 * `writeFileAtomic` makes the *final* write atomic (temp file + rename), so a
 * reader never sees a half-written file — but it does NOT make the surrounding
 * read-modify-write atomic as a unit. Two operations on the same directory can
 * both read the old index, then each write back its own version, and the later
 * write silently drops the earlier one's change (a lost update). The UI can fire
 * such operations in quick succession (e.g. an insert immediately followed by a
 * move, or rapid move clicks), so this is a real hazard. See issue 013.
 *
 * Everything here runs in the single Electron main process, so a promise-chain
 * mutex keyed by directory is sufficient: each operation waits for the previous
 * one on the same .INDEX.yaml to settle before it reads, so reads and writes
 * never interleave. Different directories never block each other.
 *
 * The tail promise stored in the map never rejects — errors are swallowed for
 * the *lock* only, not for the caller, who still receives fn's real
 * result/rejection — so one failed mutation can't break the chain for the next.
 * The map entry is deleted once its chain drains, so the map can't grow without
 * bound.
 */
const indexLocks = new Map<string, Promise<void>>();

function withIndexLock<T>(dirPath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(dirPath);
  const prev = indexLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  // Keep the chain alive even if fn throws: the next waiter chains off this
  // (always-resolving) tail, while the current caller still sees run's outcome.
  const tail = run.then(
    () => {},
    () => {},
  );
  indexLocks.set(key, tail);
  void tail.then(() => {
    if (indexLocks.get(key) === tail) indexLocks.delete(key);
  });
  return run;
}

/**
 * Returns `content` with a front-matter `id` field, plus the id that was used.
 *
 * The front matter is round-tripped through js-yaml: parse → set `id` → `dump`.
 * We never hand-edit YAML text ourselves (no string-splicing the `id` line),
 * because writing even a sliver of YAML parsing/serialization by hand is exactly
 * the kind of thing that breaks on quoting, comments, multi-line scalars, etc.
 * The cost is that the block is *normalized* by the round-trip — key order and
 * quoting may change and YAML comments are dropped — which is an accepted
 * trade-off; field values themselves are preserved. The new `id` is emitted
 * first; any pre-existing `id` (e.g. a collision being re-keyed) is replaced.
 *
 * `isTaken` lets a caller reject ids already in use — reconcileIndexedFiles must
 * keep ids unique within a directory; by default any generated id is accepted.
 *
 * This is the single home for id injection: both reconcileIndexedFiles and
 * ensureFrontMatterIdIfIndexed call it, so the logic can't drift between them.
 */
function injectFrontMatterId(
  content: string,
  isTaken: (id: string) => boolean = () => false,
): { content: string; id: string } {
  let id = generateId();
  while (isTaken(id)) id = generateId();

  const { yaml: fm, content: body } = parseFrontMatter(content);

  // Drop any existing id and re-add the new one first so it wins and leads the
  // block. `fm` is null when the file had no front matter — then we start fresh.
  const { id: _oldId, ...rest } = fm ?? {};
  const updated = { id, ...rest };
  return { content: `---\n${dump(updated, YAML_DUMP_OPTS)}---\n${body}`, id };
}

/**
 * True when an fs error is the ordinary "file does not exist" case. A missing
 * .INDEX.yaml simply means the directory isn't in Document Mode, so callers
 * treat ENOENT as expected (and silent) while logging any other errno.
 */
function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * Runtime schema for .INDEX.yaml. The file is plain text on the user's disk that
 * can be hand-edited, synced, merged, or corrupted by external tools, so its
 * parsed contents are untrusted and `js-yaml`'s `load()` returns `unknown`.
 *
 * This schema is the single source of truth: the `IndexEntry` / `IndexOptions` /
 * `IndexYaml` types below are derived from it via `z.infer`, so the runtime
 * validation and the compile-time types can never drift out of sync.
 *
 * Tolerance rules — a corrupt index should degrade cleanly, never throw:
 *  - a `files` value that isn't an array → empty list
 *  - individual entries that aren't `{ name: string }` → dropped (good ones kept)
 *  - a missing / non-object `options` → empty options
 */
const IndexEntrySchema = z.object({
  name: z.string(),
  id: z.string().optional(),
  create_time: z.number().optional(),
  size: z.number().optional(),
});

const IndexYamlSchema = z.object({
  files: z
    .array(z.unknown())
    .transform((arr) =>
      arr.flatMap((e) => {
        const parsed = IndexEntrySchema.safeParse(e);
        return parsed.success ? [parsed.data] : [];
      }),
    )
    .catch([]),
  options: z.record(z.string(), z.unknown()).catch({}),
});

export type IndexEntry = z.infer<typeof IndexEntrySchema>;
export type IndexOptions = z.infer<typeof IndexYamlSchema>['options'];
export type IndexYaml = z.infer<typeof IndexYamlSchema>;

/**
 * Validates an already-parsed YAML value against the index schema. Returns a
 * well-formed `IndexYaml` (with `files` and `options` always present) or `null`
 * when the top-level value isn't an object (empty file, a bare scalar, a list).
 * Never throws — malformed structure is normalized away per the rules above.
 */
export function parseIndexYaml(parsed: unknown): IndexYaml | null {
  const result = IndexYamlSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Reads and parses .INDEX.yaml from dirPath. Returns the validated object, or
 * null if the file doesn't exist or can't be parsed.
 */
export async function readIndexYaml(dirPath: string): Promise<IndexYaml | null> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const content = await fs.promises.readFile(indexFilePath, 'utf8');
    return parseIndexYaml(load(content));
  } catch (err) {
    // A missing index is the normal "not Document Mode" case; anything else
    // (malformed YAML, EACCES, …) is worth surfacing.
    if (!isENOENT(err)) {
      logger.warn(`readIndexYaml: cannot read/parse "${indexFilePath}": ${err}`);
    }
    return null;
  }
}

/** Stat fingerprint used to detect renames of non-markdown files. */
type Fingerprint = { createTime: number; size: number };

/**
 * The "createTime:size:ext" key under which a non-markdown file is recorded for
 * rename detection. Centralized so the build, match, and filter sites can't
 * drift apart on how the key is composed.
 */
function fingerprintOf(createTime: number, size: number, name: string): string {
  return `${createTime}:${size}:${path.extname(name).toLowerCase()}`;
}

/**
 * Reads a directory and returns only its visible (non-hidden) entries, mirroring
 * BrowseView's visibility rule (a leading '.' marks an entry hidden). Throws on
 * readdir failure so the orchestrator can log it and bail.
 */
async function readVisibleEntries(dirPath: string): Promise<fs.Dirent[]> {
  const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  return dirEntries.filter((e) => !e.name.startsWith('.'));
}

/**
 * Stats every visible non-markdown file to build the maps used for rename
 * detection: `nameToStat` (name → {createTime, size}) and `fingerprintToVisibleNames`
 * (fingerprint → all names sharing it). Files that can't be stat'd are skipped (no
 * fingerprint → no rename detection for them).
 *
 * The fingerprint ("createTime:size:ext") is deliberately *not* assumed unique:
 * `stat.birthtimeMs` is unreliable on some Linux filesystems (returns 0), and even
 * a real birthtime collides for empty files or batch-created copies of the same
 * type. So a fingerprint can legitimately map to several disk files — we keep the
 * full list (rather than last-writer-wins) so reconcileEntries can recognize the
 * ambiguity and refuse to re-point an entry to the wrong file. See reconcileEntries.
 */
async function buildNonMarkdownFingerprints(
  dirPath: string,
  visibleEntries: fs.Dirent[],
): Promise<{ nameToStat: Map<string, Fingerprint>; fingerprintToVisibleNames: Map<string, string[]> }> {
  const nameToStat = new Map<string, Fingerprint>();
  const fingerprintToVisibleNames = new Map<string, string[]>();

  const nonMarkdownFiles = visibleEntries.filter(
    (e) => !e.isDirectory() && !e.name.toLowerCase().endsWith('.md'),
  );

  // Stat the files in parallel (bounded): each stat is an independent fs
  // round-trip, so serial awaits would sum to N round-trips on large/slow
  // directories. Files that can't be stat'd yield null (rename detection skipped
  // for them); a per-file failure never aborts the batch. mapWithConcurrency
  // preserves input order, so assembling the maps from its results below stays
  // deterministic (matching the previous in-order build).
  const stats = await mapWithConcurrency(
    nonMarkdownFiles,
    RECONCILE_FILE_CONCURRENCY,
    async (entry) => {
      try {
        const stat = await fs.promises.stat(path.join(dirPath, entry.name));
        return { name: entry.name, createTime: Math.round(stat.birthtimeMs), size: stat.size };
      } catch (err) {
        logger.debug(
          `reconcileIndexedFiles: stat failed for "${path.join(dirPath, entry.name)}": ${err}`,
        );
        return null;
      }
    },
  );

  for (const s of stats) {
    if (!s) continue;
    nameToStat.set(s.name, { createTime: s.createTime, size: s.size });
    const fp = fingerprintOf(s.createTime, s.size, s.name);
    const names = fingerprintToVisibleNames.get(fp);
    if (names) names.push(s.name);
    else fingerprintToVisibleNames.set(fp, [s.name]);
  }
  return { nameToStat, fingerprintToVisibleNames };
}

/**
 * Ensures every visible markdown file has a unique front-matter `id` (assigning
 * and persisting one when it's missing or collides with an older file), and
 * returns the bidirectional name↔id maps used for rename/duplicate detection.
 *
 * Files are processed oldest-first (tie-broken by name) so that when two share
 * an id — e.g. a copy/paste duplicated the front matter — the oldest keeps the
 * id and any newer duplicate is re-keyed. So a freshly pasted copy is the one
 * that gets a fresh id, while the original keeps its identity (and its existing
 * .INDEX.yaml entry).
 */
async function ensureMarkdownIds(
  dirPath: string,
  visibleEntries: fs.Dirent[],
): Promise<{ nameToId: Map<string, string>; idToName: Map<string, string> }> {
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();

  const markdownEntries = visibleEntries.filter(
    (e) => !e.isDirectory() && e.name.toLowerCase().endsWith('.md'),
  );

  // Phase 1 — stat every markdown file in parallel (bounded) to get its birthtime.
  // These stats are independent, so serial awaits would sum to N round-trips. A
  // stat failure leaves createTime at 0 (treated as oldest — best effort).
  const markdownFiles = await mapWithConcurrency(
    markdownEntries,
    RECONCILE_FILE_CONCURRENCY,
    async (entry) => {
      let createTime = 0;
      try {
        createTime = (await fs.promises.stat(path.join(dirPath, entry.name))).birthtimeMs;
      } catch (err) {
        logger.debug(
          `reconcileIndexedFiles: stat failed for "${path.join(dirPath, entry.name)}", treating as oldest: ${err}`,
        );
      }
      return { name: entry.name, createTime };
    },
  );
  // Oldest first; tie-break by name so ordering (and thus which file keeps a
  // shared id) is deterministic when creation times are equal.
  markdownFiles.sort((a, b) => a.createTime - b.createTime || a.name.localeCompare(b.name));

  // Phase 2 — read every file's content in parallel (bounded), preserving the
  // oldest-first order (mapWithConcurrency returns results in input order). A read
  // failure yields null content and is skipped below (no id → excluded from rename
  // detection), matching the previous per-file skip.
  const contents = await mapWithConcurrency(
    markdownFiles,
    RECONCILE_FILE_CONCURRENCY,
    async ({ name }) => {
      const filePath = path.join(dirPath, name);
      try {
        return { name, rawContent: await fs.promises.readFile(filePath, 'utf8') as string | null };
      } catch (err) {
        logger.debug(`reconcileIndexedFiles: cannot read "${filePath}": ${err}`);
        return { name, rawContent: null };
      }
    },
  );

  // Phase 3 — decide ids sequentially in oldest-first order. This loop is purely
  // synchronous (no awaits), so the cross-file collision logic that mutates and
  // reads idToName/nameToId runs without interleaving — exactly as the old serial
  // loop did. Files needing a (re)written id are collected for a batched write.
  const pendingWrites: Array<{ name: string; filePath: string; content: string }> = [];
  for (const { name, rawContent } of contents) {
    if (rawContent === null) continue; // unreadable — skip (no id assigned)
    const { yaml: fm } = parseFrontMatter(rawContent);

    // A file needs a fresh id when it has none, or when its id is already
    // claimed by an older file. Filenames are unique within a directory, so a
    // hit in idToName here means a true duplicate id — e.g. a copy/paste that
    // carried the source file's front-matter id. Re-key the (newer) duplicate
    // so the per-directory uniqueness invariant rename detection relies on holds.
    let fileId = fm?.id ? String(fm.id) : undefined;
    const collidingName = fileId ? idToName.get(fileId) : undefined;
    if (!fileId || collidingName !== undefined) {
      if (fileId && collidingName !== undefined) {
        logger.warn(
          `reconcileIndexedFiles: duplicate front-matter id "${fileId}" in "${name}" (already used by older file "${collidingName}"); assigning a new id`,
        );
      }
      // Inject an id not already in use in this directory, preserving any
      // existing front-matter formatting (see injectFrontMatterId).
      const injected = injectFrontMatterId(rawContent, (id) => idToName.has(id));
      fileId = injected.id;
      pendingWrites.push({ name, filePath: path.join(dirPath, name), content: injected.content });
    }
    nameToId.set(name, fileId);
    idToName.set(fileId, name);
  }

  // Phase 4 — persist the injected ids in parallel (bounded). Writes target
  // distinct paths, so they're independent. If a write fails the file couldn't be
  // persisted, so drop it from the maps (no id → excluded from rename detection),
  // matching the original per-file skip on a failed read/write.
  await mapWithConcurrency(
    pendingWrites,
    RECONCILE_FILE_CONCURRENCY,
    async ({ name, filePath, content }) => {
      try {
        await writeFileAtomic(filePath, content);
      } catch (err) {
        logger.debug(`reconcileIndexedFiles: cannot update "${filePath}": ${err}`);
        const id = nameToId.get(name);
        nameToId.delete(name);
        if (id) idToName.delete(id);
      }
    },
  );

  return { nameToId, idToName };
}

/**
 * Reconciles the existing index entries against what's on disk: applies detected
 * renames in place (by id for markdown, by fingerprint for non-markdown), drops
 * entries whose file/folder no longer exists, and collects the set of names that
 * matched a disk entry ("handled") so the caller knows which visible entries are
 * still new. Name-only entries also pick up an id when their file now has one.
 *
 * Non-markdown fingerprints (createTime:size:ext) are not guaranteed unique, so a
 * rename is only inferred when the fingerprint maps one-to-one (one index entry ↔
 * one disk file). Ambiguous (colliding) fingerprints fall back to name-only
 * matching and are never re-pointed — a missed rename is preferred to binding an
 * entry to the wrong file. See issue 009 / the Document Mode technical note.
 *
 * Pure: reads only the supplied maps and returns the filtered entries plus the
 * handled-name set — no filesystem access. (Entry objects are mutated in place
 * for renames/id-assignment, matching the previous inline behavior.)
 */
export function reconcileEntries(
  files: IndexEntry[],
  maps: {
    idToName: Map<string, string>;
    fingerprintToVisibleNames: Map<string, string[]>;
    nameToId: Map<string, string>;
    visibleNames: Set<string>;
  },
): { files: IndexEntry[]; handledNames: Set<string> } {
  const { idToName, fingerprintToVisibleNames, nameToId, visibleNames } = maps;
  const handledNames = new Set<string>();

  // Count how many index entries claim each fingerprint. A "createTime:size:ext"
  // fingerprint is only a trustworthy rename signal when it maps one-to-one — a
  // single index entry to a single disk file. When several entries and/or several
  // disk files share it (collision; common for empty files or when birthtime is an
  // unreliable 0), re-pointing would silently bind an entry to the wrong file. So
  // in the ambiguous case we fall back to name-only matching and never re-point —
  // safely missing a rename rather than corrupting the index. See issue 009.
  const indexFingerprintCounts = new Map<string, number>();
  for (const entry of files) {
    if (!entry.id && entry.create_time !== undefined && entry.size !== undefined) {
      const fp = fingerprintOf(entry.create_time, entry.size, entry.name);
      indexFingerprintCounts.set(fp, (indexFingerprintCounts.get(fp) ?? 0) + 1);
    }
  }

  for (const entry of files) {
    if (entry.id) {
      // Markdown entry: match by id to detect renames
      const actualName = idToName.get(entry.id);
      if (actualName) {
        entry.name = actualName;
        handledNames.add(actualName);
      }
      // If no actualName: file was deleted — will be filtered out below
    } else if (entry.create_time !== undefined && entry.size !== undefined) {
      // Fingerprinted non-markdown entry: match by (create_time, size, ext).
      const fp = fingerprintOf(entry.create_time, entry.size, entry.name);
      const diskNames = fingerprintToVisibleNames.get(fp);
      if (diskNames?.length === 1 && indexFingerprintCounts.get(fp) === 1) {
        // Unambiguous 1:1 fingerprint → confident rename detection.
        entry.name = diskNames[0]!; 
        handledNames.add(entry.name);
      } else if (visibleNames.has(entry.name)) {
        // Ambiguous fingerprint (collision) — match by name only, never re-point.
        handledNames.add(entry.name);
      }
      // Otherwise the name is gone and the fingerprint is ambiguous → treat as
      // deleted (filtered out below) rather than risk a wrong re-point.
    } else {
      // Name-only entry (folder or old-style non-markdown without fingerprint)
      handledNames.add(entry.name);
      const id = nameToId.get(entry.name);
      if (id) entry.id = id;
    }
  }

  // Remove entries for files/folders that no longer exist on disk. After the loop
  // above, a non-id entry's `name` is correct iff its file still exists on disk
  // (a confident rename updated it; a name-only match left it; a deletion leaves a
  // name no longer present), so visibility-by-name is the single keep test.
  const kept = files.filter((entry) => {
    if (entry.id) return idToName.has(entry.id) || visibleNames.has(entry.name);
    return visibleNames.has(entry.name);
  });

  return { files: kept, handledNames };
}

/**
 * Appends visible entries not yet handled by reconciliation as new index
 * entries: markdown files get their id, other files get a create_time+size
 * fingerprint (for future rename detection), and folders get just a name.
 *
 * Pure: returns a new array (the existing entries first, then any appended
 * ones) — no filesystem access.
 */
export function appendNewEntries(
  files: IndexEntry[],
  visibleEntries: fs.Dirent[],
  handledNames: Set<string>,
  maps: { nameToId: Map<string, string>; nameToStat: Map<string, Fingerprint> },
): IndexEntry[] {
  const { nameToId, nameToStat } = maps;
  const result = [...files];
  for (const entry of visibleEntries) {
    if (!handledNames.has(entry.name)) {
      const newEntry: IndexEntry = { name: entry.name };
      const id = nameToId.get(entry.name);
      if (id) {
        newEntry.id = id;
      } else if (!entry.isDirectory()) {
        const stat = nameToStat.get(entry.name);
        if (stat) {
          newEntry.create_time = stat.createTime;
          newEntry.size = stat.size;
        }
      }
      result.push(newEntry);
    }
  }
  return result;
}

/**
 * Reconciles a directory's .INDEX.yaml with the actual markdown files on disk.
 * - Ensures every .md file has a unique `id` in its YAML front matter.
 * - Creates .INDEX.yaml if it doesn't exist.
 * - Updates index entry names when an id match detects a rename.
 * - Appends any new files not yet listed in the index.
 *
 * This is a thin orchestrator over the focused helpers above; the rename/filter
 * (reconcileEntries) and append (appendNewEntries) steps are pure and unit-tested
 * directly.
 */
export async function reconcileIndexedFiles(
  dirPath: string,
  createIfMissing = false,
): Promise<{ success: boolean; error?: string }> {
  // Serialized per-directory (withIndexLock) so a reconcile can't interleave
  // with a concurrent insert/move/rename/save on the same .INDEX.yaml and lose
  // either side's update. See issue 013.
  return withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      // Read the raw existing index up front: we need it both to decide whether to
      // bail (no index + !createIfMissing) and, verbatim, to skip an unchanged
      // rewrite at the end. A missing index is normal; log anything else.
      let existingIndexContent: string | null = null;
      try {
        existingIndexContent = await fs.promises.readFile(indexFilePath, 'utf8');
      } catch (err) {
        if (!isENOENT(err)) {
          logger.debug(`reconcileIndexedFiles: cannot read "${indexFilePath}": ${err}`);
        }
      }
      // Not Document Mode and not asked to create one — a no-op, not a failure.
      if (existingIndexContent === null && !createIfMissing) return { success: true };

      let visibleEntries: fs.Dirent[];
      try {
        visibleEntries = await readVisibleEntries(dirPath);
      } catch (err) {
        // Can't list the directory — reconciliation can't proceed at all.
        logger.warn(`reconcileIndexedFiles: cannot read directory "${dirPath}": ${err}`);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
      const visibleNames = new Set(visibleEntries.map((e) => e.name));

      const { nameToStat, fingerprintToVisibleNames } = await buildNonMarkdownFingerprints(
        dirPath,
        visibleEntries,
      );
      const { nameToId, idToName } = await ensureMarkdownIds(dirPath, visibleEntries);

      // Parse existing index (already read above) or start fresh
      let existingFiles: IndexEntry[] = [];
      let existingOptions: IndexOptions = {};
      if (existingIndexContent !== null) {
        try {
          const parsed = parseIndexYaml(load(existingIndexContent));
          if (parsed) {
            existingFiles = parsed.files;
            existingOptions = parsed.options;
          }
        } catch (err) {
          // Corrupt YAML (load threw) — start fresh (the rebuilt index will overwrite it).
          logger.warn(`reconcileIndexedFiles: malformed "${indexFilePath}", rebuilding: ${err}`);
        }
      }

      const { files: reconciledFiles, handledNames } = reconcileEntries(existingFiles, {
        idToName,
        fingerprintToVisibleNames,
        nameToId,
        visibleNames,
      });
      const files = appendNewEntries(reconciledFiles, visibleEntries, handledNames, {
        nameToId,
        nameToStat,
      });

      const newContent = dump({ files, options: existingOptions }, YAML_DUMP_OPTS);
      if (newContent !== existingIndexContent) {
        await writeFileAtomic(indexFilePath, newContent);
      }
      return { success: true };
    } catch (err) {
      // Any unexpected failure (e.g. the final index write) — surface it as a
      // structured error rather than rejecting, so the IPC caller (e.g. the
      // "enable custom ordering" path) can report it. See issue 016.
      logger.warn(`reconcileIndexedFiles: failed for "${dirPath}": ${err}`);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Writes the options section of .INDEX.yaml, preserving the files array.
 */
export async function writeIndexOptions(
  dirPath: string,
  options: IndexOptions,
): Promise<{ success: boolean; error?: string }> {
  // Serialized per-directory (withIndexLock) so the read-modify-write can't
  // interleave with another index mutation and clobber the files list. See issue 013.
  return withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      const existing = await readIndexYaml(dirPath);
      const updated: IndexYaml = {
        files: existing?.files ?? [],
        options: { ...existing?.options, ...options },
      };
      await writeFileAtomic(indexFilePath, dump(updated, YAML_DUMP_OPTS));
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Ensures every "*.attach" folder entry in a files array immediately follows its
 * associated file entry. Returns a new array if any reordering was needed, or
 * the original array reference if nothing changed.
 *
 * Algorithm:
 *  1. Partition entries into attach entries (attMap keyed by name) and non-attach entries.
 *  2. Rebuild the list by emitting each non-attach entry followed by its attach sibling (if any).
 *  3. Append any orphaned attach entries at the end (shouldn't happen, but handles edge cases).
 */
function reorderAttachFolders(files: IndexEntry[]): IndexEntry[] {
  const attMap = new Map<string, IndexEntry>();
  const nonAttach: IndexEntry[] = [];

  for (const entry of files) {
    if (entry.name.endsWith(ATTACH_SUFFIX)) {
      attMap.set(entry.name, entry);
    } else {
      nonAttach.push(entry);
    }
  }

  const finalFiles: IndexEntry[] = [];
  for (const entry of nonAttach) {
    finalFiles.push(entry);
    const attachName = `${entry.name}${ATTACH_SUFFIX}`;
    const attachEntry = attMap.get(attachName);
    if (attachEntry) {
      finalFiles.push(attachEntry);
      attMap.delete(attachName);
    }
  }
  // Append any orphaned attach entries
  for (const orphan of attMap.values()) {
    finalFiles.push(orphan);
  }

  // Detect change by comparing name sequences
  const changed = finalFiles.some((e, i) => e.name !== files[i]?.name);
  return changed ? finalFiles : files;
}

/**
 * Reads .INDEX.yaml and reorders any out-of-place "*.attach" folder entries so
 * each immediately follows its associated file. Writes back only if changed.
 */
export async function validateAttachFolderLocation(
  dirPath: string,
): Promise<{ success: boolean; error?: string }> {
  // Serialized per-directory (withIndexLock) so its read-modify-write can't
  // interleave with another index mutation. See issue 013. (The move helpers no
  // longer call this — they fold the same reorder into their single write.)
  return withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      const indexYaml = await readIndexYaml(dirPath);
      if (!indexYaml?.files) return { success: true }; // not Document Mode — nothing to reorder

      const reordered = reorderAttachFolders(indexYaml.files);
      if (reordered === indexYaml.files) return { success: true }; // no change

      await writeFileAtomic(
        indexFilePath,
        dump({ ...indexYaml, files: reordered }, YAML_DUMP_OPTS),
      );
      return { success: true };
    } catch (err) {
      // Best-effort; record the failed reorder but don't throw.
      logger.warn(`validateAttachFolderLocation: failed to reorder "${indexFilePath}": ${err}`);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Moves an entry up or down one position in .INDEX.yaml by swapping it with its neighbor.
 */
export async function moveInIndexYaml(
  dirPath: string,
  name: string,
  direction: 'up' | 'down',
): Promise<{ success: boolean; error?: string }> {
  // Serialized per-directory (withIndexLock) so concurrent moves/inserts can't
  // lose each other's update. The attach-folder reorder is folded into this
  // function's single write (via reorderAttachFolders) rather than a second
  // read-modify-write through validateAttachFolderLocation — fewer disk ops and,
  // since validateAttachFolderLocation also takes the lock, no self-deadlock.
  return withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      const indexYaml = await readIndexYaml(dirPath);
      if (!indexYaml) return { success: false, error: `${INDEX_FILENAME} not found or unreadable` };
      const files = indexYaml.files;

      const idx = files.findIndex((f) => f.name === name);
      if (idx === -1) return { success: false, error: `Entry "${name}" not found in index` };

      let swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      let swapEntry = files[swapIdx];
      if (!swapEntry) return { success: true };

      // Skip over any attach folder at the swap target — landing on one would be
      // immediately undone by the attach reorder below.
      if (swapEntry.name.endsWith(ATTACH_SUFFIX)) {
        swapIdx = direction === 'up' ? swapIdx - 1 : swapIdx + 1;
        swapEntry = files[swapIdx];
        if (!swapEntry) return { success: true };
      }

      const movedEntry = files[idx];
      if (!movedEntry) return { success: true };
      files[idx] = swapEntry;
      files[swapIdx] = movedEntry;

      const reordered = reorderAttachFolders(files);
      const newContent = dump({ ...indexYaml, files: reordered }, YAML_DUMP_OPTS);
      await writeFileAtomic(indexFilePath, newContent);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Does the 'move to top' and 'move to bottom' of a file
 */
export async function moveToEdgeInIndexYaml(
  dirPath: string,
  name: string,
  edge: 'top' | 'bottom',
): Promise<{ success: boolean; error?: string }> {
  // Serialized per-directory (withIndexLock); the attach reorder is folded into
  // the single write here rather than a follow-up validateAttachFolderLocation
  // call (which would re-read/re-write and, sharing the lock, deadlock). See issue 013.
  return withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      const indexYaml = await readIndexYaml(dirPath);
      if (!indexYaml) return { success: false, error: `${INDEX_FILENAME} not found or unreadable` };
      const files = indexYaml.files;

      const idx = files.findIndex((f) => f.name === name);
      if (idx === -1) return { success: false, error: `Entry "${name}" not found in index` };

      const [entry] = files.splice(idx, 1);
      if (!entry) return { success: false, error: `Entry "${name}" not found in index` };
      if (edge === 'top') {
        files.unshift(entry);
      } else {
        files.push(entry);
      }

      const reordered = reorderAttachFolders(files);
      const newContent = dump({ ...indexYaml, files: reordered }, YAML_DUMP_OPTS);
      await writeFileAtomic(indexFilePath, newContent);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * The single, canonical Document Mode ordering rule for the entries of one
 * directory, given that directory's `.INDEX.yaml` `files` list.
 *
 * Returns a comparator over entry *names* that orders by each name's position in
 * the index, with any names absent from the index ("extras" — e.g. a file just
 * created but not yet reconciled into `.INDEX.yaml`) sorting *after* the indexed
 * entries, tie-broken by natural name order (`compareNames`).
 *
 * Both the main UI listing (`readDirectory` in fileUtil) and document export
 * (`getSortedDirEntries` → exportUtil) build their ordering from this one
 * function, so the exported document order can never silently diverge from the
 * on-screen order for an indexed folder. (See issue 015.)
 */
export function compareByIndexOrder(
  indexFiles: IndexEntry[],
): (a: string, b: string) => number {
  const nameToOrder = new Map(indexFiles.map((f, i) => [f.name, i]));
  return (a, b) => {
    const aOrder = nameToOrder.get(a) ?? Infinity;
    const bOrder = nameToOrder.get(b) ?? Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return compareNames(a, b);
  };
}

/**
 * Returns the visible entries of a directory in document-mode order when a
 * .INDEX.yaml exists, or alphabetically when it does not.
 *
 * "Visible" means non-hidden (name does not start with '.').
 * The returned objects carry `name`, `entryPath`, and `isDir` so callers
 * don't need a second readdir call.
 *
 * Contract note (issue 016): unlike the other readers in this module, this one
 * *throws* if the directory's `readdir` fails — it does not swallow it into an
 * empty list. That is deliberate. The directory here is the data source itself
 * (not an optional .INDEX.yaml), and the sole caller — `exportFolderContents` —
 * runs under an IPC handler that catches the throw and reports a real error.
 * Returning `[]` instead would silently turn an unreadable directory into a
 * "no files found" export, masking the failure. (The inner `readIndexYaml` call
 * still degrades to alphabetical order on its own failure, per the reader rule.)
 *
 * @throws if `fs.promises.readdir(dirPath)` fails (missing/inaccessible dir).
 */
export async function getSortedDirEntries(
  dirPath: string,
): Promise<Array<{ name: string; entryPath: string; isDir: boolean }>> {
  const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const visible = dirEntries.filter((e) => !e.name.startsWith('.'));

  const toItem = (e: fs.Dirent) => ({
    name: e.name,
    entryPath: path.join(dirPath, e.name),
    isDir: e.isDirectory(),
  });

  const items = visible.map(toItem);

  const indexYaml = await readIndexYaml(dirPath);
  if (!indexYaml?.files?.length) {
    // No document mode — natural-name (numeric-aware) fallback, files and folders
    // sorted together so ordinal-prefixed names control order.
    return items.sort((a, b) => compareNames(a.name, b.name));
  }

  // Document mode: order by the canonical .INDEX.yaml rule shared with the main
  // UI listing (readDirectory), so exported order can never diverge from
  // on-screen order. Extras not yet in the index sort after, by name. (issue 015)
  const compare = compareByIndexOrder(indexYaml.files);
  return items.sort((a, b) => compare(a.name, b.name));
}

/**
 * Result of {@link ensureFrontMatterIdIfIndexed}: the (possibly modified)
 * content to write, and the id that was newly injected — or `null` when nothing
 * changed (not Document Mode, or the file already had an id). When `addedId` is
 * non-null the caller must, *after* persisting `content`, call
 * {@link recordFrontMatterIdInIndex} so the id is recorded in .INDEX.yaml.
 */
export interface EnsureFrontMatterIdResult {
  content: string;
  addedId: string | null;
}

/**
 * If `filePath` is a markdown file in a Document Mode folder (a sibling
 * .INDEX.yaml exists) and its content has no front-matter `id`, returns the
 * content with a freshly injected id plus that id as `addedId`. Otherwise
 * returns the content unchanged with `addedId: null`.
 *
 * This function deliberately does NOT touch .INDEX.yaml. The id is recorded in
 * the index by {@link recordFrontMatterIdInIndex}, which the caller invokes only
 * *after* the (id-bearing) content has been written to disk. That ordering
 * closes the partial-failure window in issue 014: the index can never record an
 * id for content that was never written — at worst the file has an id the index
 * doesn't yet know about, which the next reconcile heals. Splitting "compute the
 * content" from "persist the index" is what makes file-then-index ordering
 * possible across the IPC write-file handler.
 *
 * Safe to call unconditionally on every .md save — a no-op (addedId: null) when
 * the directory has no .INDEX.yaml or the file already has an id.
 */
export async function ensureFrontMatterIdIfIndexed(
  filePath: string,
  content: string,
): Promise<EnsureFrontMatterIdResult> {
  const indexFilePath = indexPathFor(path.dirname(filePath));

  // Document Mode is signalled by a readable, well-formed .INDEX.yaml sibling.
  let indexYaml: IndexYaml | null = null;
  try {
    const raw = await fs.promises.readFile(indexFilePath, 'utf8');
    indexYaml = parseIndexYaml(load(raw));
  } catch (err) {
    // A missing index is the normal "not Document Mode" case; surface anything else.
    if (!isENOENT(err)) {
      logger.warn(`ensureFrontMatterIdIfIndexed: cannot read/parse "${indexFilePath}": ${err}`);
    }
    return { content, addedId: null }; // no usable .INDEX.yaml — nothing to do
  }
  if (!indexYaml) return { content, addedId: null };

  const { yaml: fm } = parseFrontMatter(content);
  if (fm?.id) return { content, addedId: null }; // already has an id

  // Inject a new id, preserving any existing front-matter formatting
  // (see injectFrontMatterId). The index is updated separately, post-write.
  const { content: newContent, id: addedId } = injectFrontMatterId(content);
  return { content: newContent, addedId };
}

/**
 * Records `fileId` as the front-matter id of `filePath`'s entry in its
 * directory's .INDEX.yaml. Must be called *after* the file content carrying that
 * id has been written to disk (see {@link ensureFrontMatterIdIfIndexed}).
 *
 * If an entry for the file already exists, its id is set; otherwise a new
 * `{ name, id }` entry is appended — so a brand-new file (saved before reconcile
 * has appended it) leaves file and index consistent immediately rather than only
 * after the next reconcile (issue 014). A no-op if the directory left Document
 * Mode in the meantime.
 *
 * Serialized per-directory via withIndexLock so it can't interleave with a
 * concurrent reconcile/move/insert and lose the update (issue 013).
 */
export async function recordFrontMatterIdInIndex(filePath: string, fileId: string): Promise<void> {
  const dirPath = path.dirname(filePath);
  const fileName = path.basename(filePath);
  await withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      const indexYaml = await readIndexYaml(dirPath);
      if (!indexYaml) return; // no longer Document Mode — nothing to record
      const entry = indexYaml.files.find((f) => f.name === fileName);
      if (entry) {
        entry.id = fileId;
      } else {
        indexYaml.files.push({ name: fileName, id: fileId });
      }
      await writeFileAtomic(indexFilePath, dump(indexYaml, YAML_DUMP_OPTS));
    } catch (err) {
      // Best-effort: the file already carries the id, so a failed index write
      // self-heals on the next reconcile. Record it but don't throw.
      logger.warn(`recordFrontMatterIdInIndex: failed to record id for "${fileName}" in "${indexFilePath}": ${err}`);
    }
  });
}

/**
 * Renames an entry in .INDEX.yaml from oldName to newName.
 * A documented no-op (returning success) if .INDEX.yaml doesn't exist or oldName
 * isn't found. Returns the module-standard `{ success, error }` (see the
 * error-handling contract at the top of this file); best-effort, so it also logs
 * on failure for the caller (the rename IPC handler) that doesn't surface it.
 */
export async function renameInIndexYaml(
  dirPath: string,
  oldName: string,
  newName: string,
): Promise<{ success: boolean; error?: string }> {
  // Serialized per-directory (withIndexLock). The rename handler can call this
  // twice in a row (the file, then its .attach folder) on the same directory;
  // the lock makes the second read see the first's write instead of racing it.
  // See issue 013.
  return withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      const indexYaml = await readIndexYaml(dirPath);
      if (!indexYaml?.files) return { success: true }; // not Document Mode — nothing to rename
      const entry = indexYaml.files.find((f) => f.name === oldName);
      if (!entry) return { success: true }; // no such entry — nothing to rename
      entry.name = newName;
      await writeFileAtomic(indexFilePath, dump(indexYaml, YAML_DUMP_OPTS));
      return { success: true };
    } catch (err) {
      // Best-effort; record the failed index update but don't throw.
      logger.warn(`renameInIndexYaml: failed to rename "${oldName}" → "${newName}" in "${indexFilePath}": ${err}`);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Ensures the markdown file at filePath has a front-matter `id`, returning it.
 * If the file already has one it is returned unchanged; otherwise a fresh id is
 * injected (preserving any existing front matter — see injectFrontMatterId) and
 * persisted. Returns null when the file can't be read or written, so callers can
 * degrade to a name-only index entry rather than failing.
 *
 * Unlike ensureMarkdownIds (the bulk reconcile path), this does not check the id
 * against the rest of the directory for uniqueness — it seeds identity for a
 * single freshly-created file, and the astronomically-unlikely collision would be
 * detected and re-keyed by the next reconcile anyway. This matches the unchecked
 * injection already done by ensureFrontMatterIdIfIndexed on save.
 */
async function ensureFileFrontMatterId(filePath: string): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const { yaml: fm } = parseFrontMatter(content);
    if (fm?.id) return String(fm.id);
    const { content: updated, id } = injectFrontMatterId(content);
    await writeFileAtomic(filePath, updated);
    return id;
  } catch (err) {
    logger.debug(`ensureFileFrontMatterId: cannot ensure id for "${filePath}": ${err}`);
    return null;
  }
}

/**
 * Builds the IndexEntry for a single on-disk entry named `name` in `dirPath`,
 * seeding the same identity reconcileIndexedFiles would assign when appending it:
 *  - markdown file → ensures (and records) a front-matter `id`, so rename
 *    detection works immediately rather than only after the next reconcile;
 *  - other file    → records a create_time+size fingerprint from `fs.stat`;
 *  - folder         → name only.
 *
 * Best-effort: any fs failure (stat/read/write) degrades to a name-only entry,
 * exactly as the bulk append path does when a file can't be stat'd/read — the
 * next reconcile fills in the missing identity.
 */
async function buildEntryForName(dirPath: string, name: string): Promise<IndexEntry> {
  const entry: IndexEntry = { name };
  const filePath = path.join(dirPath, name);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    logger.debug(`buildEntryForName: stat failed for "${filePath}": ${err}`);
    return entry; // name-only; next reconcile will seed identity
  }

  if (stat.isDirectory()) return entry; // folders carry name only

  if (name.toLowerCase().endsWith('.md')) {
    const id = await ensureFileFrontMatterId(filePath);
    if (id) entry.id = id;
  } else {
    entry.create_time = Math.round(stat.birthtimeMs);
    entry.size = stat.size;
  }
  return entry;
}

/**
 * Inserts a new entry into the .INDEX.yaml files array at the position
 * immediately after insertAfterName (or at position 0 when null).
 * Existing entries and their id fields are preserved.
 *
 * The new entry is seeded with identity up front (markdown id / non-markdown
 * fingerprint) via buildEntryForName, so a rename of the just-inserted file is
 * tracked immediately rather than only after the next reconcile.
 */
export async function insertIntoIndexYaml(
  dirPath: string,
  newName: string,
  insertAfterName: string | null,
): Promise<{ success: boolean; error?: string }> {
  // Serialized per-directory (withIndexLock) so a concurrent move/insert can't
  // read the pre-insert index and write it back, dropping this entry. See issue 013.
  return withIndexLock(dirPath, async () => {
    const indexFilePath = indexPathFor(dirPath);
    try {
      const indexYaml = (await readIndexYaml(dirPath)) ?? { files: [], options: {} };
      const files = indexYaml.files;

      const newEntry = await buildEntryForName(dirPath, newName);
      if (insertAfterName === null) {
        files.unshift(newEntry);
      } else {
        const idx = files.findIndex((f) => f.name === insertAfterName);
        if (idx === -1) {
          files.push(newEntry);
        } else {
          files.splice(idx + 1, 0, newEntry);
        }
      }

      const newContent = dump({ ...indexYaml, files }, YAML_DUMP_OPTS);
      await writeFileAtomic(indexFilePath, newContent);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
