/**
 * Canonical type for the file-I/O operations injected into the transactional
 * edit utilities (`splitFile`, `joinFiles`). Grouping these callbacks into one
 * object — instead of passing each as a separate positional parameter — keeps
 * call sites readable and guards against accidentally transposing two of the
 * similarly-typed `(path: string) => Promise<...>` callbacks.
 *
 * The signatures intentionally match the corresponding methods on
 * `ElectronAPI` (see `src/types/shared.ts`), so the live `api` proxy is
 * structurally assignable to `FileOps` and can be passed directly.
 *
 * Functions that need only a subset use `Pick<FileOps, ...>` to keep their
 * required surface explicit while sharing this one canonical type.
 */
export interface FileOps {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<{ ok: boolean; content: string }>;
  createFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  pathExists: (path: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<boolean>;
}
