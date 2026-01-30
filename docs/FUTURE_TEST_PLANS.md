# Future Test Plans (MkBrowser)

AI Generated plan for how we can eventually add testing.

This document captures a phased plan for adding tests. It assumes **Vitest + React Testing Library** and uses **jsdom** for component tests. The first phases focus on non-GUI logic, followed by React component tests, and finally Electron API mocking strategies.

> Important Note: This plan is intentionally staged. Early phases avoid Electron and UI complexity to build confidence quickly.

## Phase 0 — Baseline Setup (project-wide)

**Goal:** Establish a test runner, conventions, and a minimal test harness.

1. **Add dev dependencies** (common setup for Vite + React + TS):
   - `vitest`
   - `@testing-library/react`
   - `@testing-library/jest-dom`
   - `@testing-library/user-event`
   - `jsdom`
   - `@types/jsdom`

2. **Add a test script** in `package.json`:
   - Example: `"test": "vitest"`
   - Optional: `"test:watch": "vitest --watch"`

3. **Create a base config** (recommended: `vitest.config.ts`):
   - Default to `environment: "node"`
   - Use `environment: "jsdom"` only in component tests

4. **Add global setup file** (optional but common):
   - `src/test/setup.ts`
   - Import `@testing-library/jest-dom` once

### Naming Conventions

- Unit tests: `*.test.ts` or `*.spec.ts`
- Component tests: `*.test.tsx`
- Place tests near source files or in `src/__tests__/` (choose one and stay consistent)

**Recommended convention for this repo:**
- Co-locate tests next to source files.
  - Example: `src/utils/timeUtils.test.ts`
  - Example: `src/components/entries/FolderEntry.test.tsx`

---

## Phase 1 — Non-GUI Unit Tests (no DOM, no Electron)

**Goal:** Validate pure logic first (store + utilities). These are fast and deterministic.

### Targets

- Store logic: `src/store/store.ts`
- Store types: `src/store/types.ts`
- Utilities: `src/utils/*`

### Suggested Test Areas

1. **Store actions**
   - `upsertItem` creates new item or updates existing
   - `setItemExpanded` toggles `isExpanded`
   - `setItemSelected` toggles `isSelected`

2. **Utilities**
   - Sorting utilities (if present) with known inputs
   - `searchUtils` tokenization / matching
   - `timeUtils` formatting with fixed timestamps
   - `ordinals` output for known values

### Example (Utility Test)

```ts
// src/utils/ordinals.test.ts
import { toOrdinal } from "./ordinals";

describe("toOrdinal", () => {
  it("formats common cases", () => {
    expect(toOrdinal(1)).toBe("1st");
    expect(toOrdinal(2)).toBe("2nd");
    expect(toOrdinal(3)).toBe("3rd");
    expect(toOrdinal(4)).toBe("4th");
  });

  it("formats teens correctly", () => {
    expect(toOrdinal(11)).toBe("11th");
    expect(toOrdinal(12)).toBe("12th");
    expect(toOrdinal(13)).toBe("13th");
  });
});
```

### Example (Store Test)

```ts
// src/store/store.test.ts
import { upsertItem, setItemExpanded, getState } from "./store";

const samplePath = "/tmp/sample.md";

beforeEach(() => {
  // Reset store state if a reset helper is added.
  // If not available, consider adding a test-only helper later.
});

describe("store actions", () => {
  it("upserts an item", () => {
    upsertItem({
      path: samplePath,
      name: "sample.md",
      type: "markdown",
      isExpanded: false,
      isSelected: false,
    });

    const state = getState();
    const item = state.items.get(samplePath);

    expect(item?.name).toBe("sample.md");
  });

  it("expands an item", () => {
    setItemExpanded(samplePath, true);
    const state = getState();
    expect(state.items.get(samplePath)?.isExpanded).toBe(true);
  });
});
```

> Tip: For store tests, consider adding a **test-only reset helper** to avoid cross-test leakage.

---

## Phase 2 — React Component Tests (jsdom)

**Goal:** Test key UI behaviors with `jsdom` and React Testing Library.

### Why jsdom here?

Component tests need DOM APIs like `document`, `window`, and event dispatch. `jsdom` provides these in memory without running a real browser.

### Targets (high value)

- Entry components: `FolderEntry`, `MarkdownEntry`, `FileEntry`
- Dialogs: `ConfirmDialog`, `CreateFileDialog`
- Views: `SearchResultsView`, `SettingsView`

### Example Setup

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: "src/test/setup.ts",
  },
});
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom";
```

For component tests, override to `jsdom` in the test file or via `describe` block config:

```ts
// src/components/entries/FolderEntry.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FolderEntry from "./FolderEntry";

// Optional per-file environment override
export const test = { environment: "jsdom" };

describe("FolderEntry", () => {
  it("renders the folder name", () => {
    render(
      <FolderEntry
        path="/demo"
        name="Demo Folder"
        isExpanded={false}
      />
    );

    expect(screen.getByText("Demo Folder")).toBeInTheDocument();
  });
});
```

### Suggested Component Behaviors to Test

- Toggle expansion on click
- Checkbox reflects `isSelected`
- Markdown card expands/collapses properly
- Dialog validation (e.g., empty name errors)

> Important Note: Keep component tests **small** and **behavioral**. Avoid snapshot-heavy tests.

---

## Phase 3 — Electron API Mocking (for future tests)

**Goal:** Prepare tests that interact with Electron APIs without launching Electron.

MkBrowser uses a **preload bridge** (`window.electronAPI`) to communicate with the main process. For unit/component tests, you can mock the bridge instead of running Electron.

### Mock Strategy Overview

1. **Declare a test-only mock** in `src/test/mocks/electronAPI.ts`:
   - Provide stubbed methods that return predictable values

2. **Inject the mock** in test setup:
   - Set `globalThis.window.electronAPI = mock`

3. **Use the mock in tests**
   - Verify calls and simulate returned values

### Example Mock

```ts
// src/test/mocks/electronAPI.ts
export const electronAPIMock = {
  readDirectory: async () => ({ items: [] }),
  readFile: async () => "# Mocked content",
  onCutRequested: () => () => {},
  onPasteRequested: () => () => {},
};
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom";
import { electronAPIMock } from "./mocks/electronAPI";

Object.defineProperty(window, "electronAPI", {
  value: electronAPIMock,
  configurable: true,
});
```

### What This Enables

- Component tests that depend on `window.electronAPI`
- Store tests that load data through mocked IPC responses
- Predictable behavior without Electron runtime

> Tip: Keep the mock minimal and only add methods when tests require them.

---

## Optional Phase 4 — Integration or E2E

When ready, consider a separate plan for integration tests that **launch Electron** or use **Playwright**. This is intentionally deferred until unit and component tests are stable.

---

## Summary Roadmap

1. **Phase 0**: Add Vitest + RTL + jsdom basics
2. **Phase 1**: Non-GUI logic tests (store + utils)
3. **Phase 2**: React component tests (jsdom)
4. **Phase 3**: Electron API mocking (preload bridge)
5. **Phase 4**: Optional integration/E2E tests

If you decide to implement this later, start with Phase 1 for quick wins and confidence.
