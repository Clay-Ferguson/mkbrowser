# Testing

MkBrowser uses [Vitest](https://vitest.dev/) as its unit-test framework. Vitest was chosen for its native integration with the project's Vite build tooling, zero-config TypeScript support, and fast execution.

This document covers the Vitest unit tests. The Playwright end-to-end tests, which drive the packaged Electron app, are covered in `playwright.md` (in this folder).

## Quick Reference

```bash
npm test            # Run all unit tests once (vitest run)
npm run test:watch  # Run tests in watch mode (re-runs on file changes)
```

`pre-package.sh` runs `npm test` followed by `npm run lint`, and aborts on any failure. Both `build.sh` and `playwright-test.sh` (when you choose to build) run it before packaging, so a failing unit test blocks a build.

## Project Layout

```
vitest.config.ts          # Vitest configuration (node environment, tests/ directory)
tests/
  *.test.ts               # Unit test specs (one file per module/feature area)
  fixtures/
    setup.ts              # Shared search fixtures — generates the test-data/ directory
    personTypeDefs.ts     # Shared object-type definitions used by the object/type tests
  e2e/                    # Playwright specs (not run by Vitest — see playwright.md)
test-data/                # Generated search fixture files (gitignored)
```

- **Test specs** live directly in the `tests/` directory at the project root. There are dozens of them, covering search, the store slices, file operations, config, markdown/link utilities, the editor helpers, AI helpers, and more.
- **Shared fixtures** live in `tests/fixtures/`.
- **Search test data** is generated under `test-data/` at the project root. This directory is fully disposable: `setupTestData()` wipes and recreates it.

## Configuration

The Vitest config is in `vitest.config.ts`:

- **Environment**: `node`. Tests run against Node.js APIs; there is no browser or DOM.
- **Include pattern**: `tests/**/*.test.ts`. The Playwright specs under `tests/e2e/` are named `*.spec.ts`, so Vitest never picks them up.

## Test Data Strategy

Tests prefer real files on disk over mocking the file system. There are two patterns:

1. **The shared search fixture tree** (`tests/fixtures/setup.ts`), used by `search.test.ts`. It writes a fixed set of files under `test-data/` so search queries hit a known set of files.
2. **Per-test temporary folders.** Many other tests (for example the `searchAndReplace`, `configMgr`, `fileUtil`, and `atomicWrite` tests) create their own folder with `fs.mkdtempSync(path.join(os.tmpdir(), …))` and remove it afterwards. Use this pattern when a test needs a small, purpose-built file structure or writes to disk.

Real files exercise the actual file system code paths (directory traversal, file reading, path resolution), and keep the repo clean, since `test-data/` is in `.gitignore`.

Where a module reaches the Electron preload bridge, tests mock the API module instead (`vi.mock('../src/renderer/api')`); see "The API Layer" in the project's `AGENTS.md`.

### The search fixture (`tests/fixtures/setup.ts`)

| Export | Description |
|--------|-------------|
| `setupTestData()` | Wipes `test-data/` and writes all fixture files. Call in `beforeAll()`. |
| `teardownTestData()` | Removes `test-data/` entirely. Optional cleanup for `afterAll()`. |
| `TEST_DATA_DIR` | Absolute path to the fixture data directory. Defaults to `<repoRoot>/test-data`, but the `MKB_TEST_DATA_DIR` env var overrides it (see below). |
| `rel(...segments)` | Helper to build OS-correct relative paths for assertions. |

The fixture holds about 60 files, mostly `.md` with some `.txt`, across multiple subdirectories. Their content covers various search scenarios: unique markers, duplicate content, repeated terms, case variations, deeply nested paths, special characters, timestamps, and non-searchable file types (`.json`, `.yaml`, `.jpg`). Tests must treat these files as read-only.

### Relocating the fixture data — `MKB_TEST_DATA_DIR`

`TEST_DATA_DIR` honors the `MKB_TEST_DATA_DIR` env var and falls back to
`<repoRoot>/test-data` when it is unset. This exists because some filesystems do
not record a file birth time, and a few tests assert `createdTime > 0`. The
main case is a virtiofs share into a KVM virtual machine (where the AI coding
agent runs), on which `statx` reports no birth time at all. Pointing the
fixtures at a local filesystem (`export MKB_TEST_DATA_DIR=/tmp/mkb-test-data`)
fixes those failures.

The override covers only the Vitest search fixtures. It does **not** affect the
Playwright e2e suite, which browses the checked-in `mkbrowser-test/` folder.

## Architecture — What's Testable

The logic the tests exercise lives in modules that do not need a running Electron app. The search-related ones are:

| Module | What it provides |
|--------|-----------------|
| `src/main/search.ts` | `searchFolder()` / `searchFolderWithTotal()` — recursive file search with literal, wildcard, and advanced modes, sorting, and a result cap |
| `src/main/advancedQuery.ts` | Evaluation of advanced (JavaScript-expression) queries, with syntax and timeout errors |
| `src/shared/searchHelpers.ts` | `createContentSearcher()` — case-insensitive content matching |
| `src/shared/timeUtil.ts` | `extractTimestamp()`, `past()`, `future()`, `today()` — timestamp utilities |
| `src/main/searchAndReplace.ts` | `searchAndReplace()` — bulk find-and-replace across files |

The Electron IPC handlers in `src/main.ts` are thin wrappers that load configuration and delegate to modules like these. This separation means the business logic can be tested directly without starting Electron. The same pattern holds for most other tested areas: pure logic is kept in `src/shared/`, `src/main/`, `src/store/`, or `src/renderer/` utility modules that the tests import directly.

## Writing New Tests

1. Create a new `.test.ts` file in the `tests/` directory (or add to an existing one).
2. Import from `vitest` (`describe`, `it`, `expect`, `beforeAll`, etc.).
3. If your test needs the search fixture files, call `setupTestData()` in `beforeAll()` and use `TEST_DATA_DIR` as the root path. If it needs its own files, or writes to disk, create a temporary folder instead.
4. Import the module under test directly (e.g., `import { searchFolder } from '../src/main/search'`).

Example:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { searchFolder } from '../src/main/search';
import { setupTestData, TEST_DATA_DIR } from './fixtures/setup';

beforeAll(async () => {
  await setupTestData();
});

describe('my new search tests', () => {
  it('finds the expected files', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'some query', { matchType: 'literal' });
    expect(results).toHaveLength(3);
  });
});
```
