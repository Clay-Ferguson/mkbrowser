# Testing

MkBrowser uses [Vitest](https://vitest.dev/) as its test framework. Vitest was chosen for its native integration with the project's Vite build tooling, zero-config TypeScript support, and fast execution.

## Quick Reference

```bash
npm test          # Run all tests once
npm run test:watch  # Run tests in watch mode (re-runs on file changes)
```

## Project Layout

```
vitest.config.ts          # Vitest configuration (node environment, tests/ directory)
tests/
  fixtures/
    setup.ts              # Shared fixture utilities — creates test-data/ directory
  search.test.ts          # Search algorithm tests
test-data/                # Auto-generated fixture files (gitignored)
```

- **Test specs** live in the `tests/` directory at the project root.
- **Shared fixtures** live in `tests/fixtures/`.
- **Test data** is dynamically generated under `test-data/` at the project root. This directory is fully disposable — the test suite wipes and recreates it before each run.

## Configuration

The Vitest config is in `vitest.config.ts`:

- **Environment**: `node` — tests run against Node.js APIs (no browser/DOM needed).
- **Include pattern**: `tests/**/*.test.ts`

## Test Data Strategy

Rather than using mocks or static fixture files checked into the repo, the test suite dynamically generates real files on disk under `test-data/`. This approach:

- Exercises the actual file system code paths (directory traversal, file reading, path resolution).
- Keeps the repo clean — `test-data/` is in `.gitignore`.
- Gives tests full control to create whatever file structures they need.

The fixture setup (`tests/fixtures/setup.ts`) exports:

| Export | Description |
|--------|-------------|
| `setupTestData()` | Wipes `test-data/` and writes all fixture files. Call in `beforeAll()`. |
| `teardownTestData()` | Removes `test-data/` entirely. Optional cleanup for `afterAll()`. |
| `TEST_DATA_DIR` | Absolute path to the `test-data/` directory. |
| `rel(...segments)` | Helper to build OS-correct relative paths for assertions. |

The fixture files include ~50 `.md` and `.txt` files across multiple subdirectories, with content designed to cover various search scenarios: unique markers, duplicate content, repeated terms, case variations, deeply nested paths, special characters, timestamps, and non-searchable file types (`.json`, `.yaml`, `.jpg`).

## Architecture — What's Testable

The core logic that tests exercise has been extracted into standalone modules that have no Electron dependencies:

| Module | What it provides |
|--------|-----------------|
| `src/search.ts` | `searchFolder()` — recursive file search with literal, wildcard, and advanced modes |
| `src/utils/searchUtil.ts` | `createContentSearcher()` — case-insensitive content matching |
| `src/utils/timeUtil.ts` | `extractTimestamp()`, `past()`, `future()`, `today()` — timestamp utilities |
| `src/searchAndReplace.ts` | `searchAndReplace()` — bulk find-and-replace across files |

The Electron IPC handlers in `src/main.ts` are thin wrappers that load configuration and delegate to these modules. This separation means the business logic can be tested directly without starting Electron.

## Writing New Tests

1. Create a new `.test.ts` file in the `tests/` directory (or add to an existing one).
2. Import from `vitest` (`describe`, `it`, `expect`, `beforeAll`, etc.).
3. If your test needs fixture files, call `setupTestData()` in `beforeAll()` and use `TEST_DATA_DIR` as the root path.
4. Import the module under test directly (e.g., `import { searchFolder } from '../src/search'`).

Example:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { searchFolder } from '../src/search';
import { setupTestData, TEST_DATA_DIR } from './fixtures/setup';

beforeAll(async () => {
  await setupTestData();
});

describe('my new search tests', () => {
  it('finds the expected files', async () => {
    const results = await searchFolder(TEST_DATA_DIR, 'some query', 'literal');
    expect(results).toHaveLength(3);
  });
});
```
