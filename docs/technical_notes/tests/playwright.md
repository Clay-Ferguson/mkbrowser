# Playwright E2E Tests

## Overview
This is the pattern for writing Playwright E2E tests. Every test walks through a user-visible workflow step by step, capturing screenshots and companion narration text files at each step; downstream tooling assembles these into a GIF and an MP4 with spoken narration. The tests serve a **dual purpose**: demo-video creation *and* automated E2E verification.

There are two flavors, and they share the same helpers, screenshot/narration cadence, and file layout:

- **Demo tests** (`<name>-demo.spec.ts`, e.g. `create-file-demo.spec.ts`) — primarily for the tutorial videos. Read `create-file-demo.spec.ts` as the canonical example.
- **Private tests** (`private-<feature>.spec.ts`, e.g. `private-rename.spec.ts`, `private-cut-and-paste.spec.ts`) — primarily automated verification of a feature, with the filesystem as the authority for assertions. They still write screenshots/narration by the same conventions, but `playwright-test.sh` skips them in its default "run all" option and never builds videos from them.

When asked to create a test, decide which flavor fits (a "demonstrate feature X" request → demo; a "verify/prove feature X works" request → private), then follow the matching conventions below. **Study the named reference tests before writing** and copy their structure exactly — do not invent new patterns.

<!-- TOC -->

* [Overview](#overview)
* [File Location and Naming](#file-location-and-naming)
* [Required Imports](#required-imports)
* [Fixture Arguments](#fixture-arguments)
* [How the Harness Launches the App](#how-the-harness-launches-the-app)
* [Test Setup / Teardown Boilerplate](#test-setup--teardown-boilerplate)
* [Step Counter Convention](#step-counter-convention)
* [Core Media Helpers](#core-media-helpers)
  * [`takeScreenshot` — plain / highlighted screenshot](#takescreenshot--plain--highlighted-screenshot)
  * [`writeNarration` — write companion narration file](#writenarration--write-companion-narration-file)
  * [`demoClick` / `demoRightClick` — click with demo timing](#democlick--demorightclick--click-with-demo-timing)
  * [`insertText` — type text into the focused element](#inserttext--type-text-into-the-focused-element)
  * [`setCheckbox` — toggle a selection checkbox](#setcheckbox--toggle-a-selection-checkbox)
  * [`logScreenshotSummary` — log counts at end of test](#logscreenshotsummary--log-counts-at-end-of-test)
  * [`demoRefresh` — re-read the current folder](#demorefresh--re-read-the-current-folder)
  * [Lifecycle helpers](#lifecycle-helpers)
* [Seeding Test Data on Disk](#seeding-test-data-on-disk)
* [Disk Assertions (the authority)](#disk-assertions-the-authority)
* [Interacting with the UI](#interacting-with-the-ui)
  * [The browse list and refresh](#the-browse-list-and-refresh)
  * [Hover-revealed entry action bars](#hover-revealed-entry-action-bars)
  * [Views are hidden, not unmounted (`activeView`)](#views-are-hidden-not-unmounted-activeview)
  * [Popup menus](#popup-menus)
  * [Edit mode and the CodeMirror editor](#edit-mode-and-the-codemirror-editor)
  * [Inline rename](#inline-rename)
  * [Tabs](#tabs)
* [Seeding the OS Clipboard](#seeding-the-os-clipboard)
* [Time-Dependent (Timestamp) Filenames](#time-dependent-timestamp-filenames)
* [Image / Binary Assertions](#image--binary-assertions)
* [Typical Step Sequence Pattern](#typical-step-sequence-pattern)
* [Narration Writing Guidelines](#narration-writing-guidelines)
* [Assertions](#assertions)
* [General Discipline / Gotchas](#general-discipline--gotchas)
* [Complete Skeletons](#complete-skeletons)

<!-- /TOC -->

## File Location and Naming

Place test files in `tests/e2e/` and name them `<demo-name>.spec.ts` (demo) or `private-<feature>.spec.ts` (private). The test name — derived from the filename via `path.basename(__filename, '.spec.ts')` — is used as the screenshot subdirectory under `screenshots/`.

## Required Imports

```typescript
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot, writeNarration, demoClick, demoRightClick, demoRefresh, insertText,
  setCheckbox, logScreenshotSummary,
  cleanupScreenshots, cleanupTestDataFiles, resetSettings,
  findActionBarByFileName, openEntryMenu, activeView, ACTION_BAR_FADE_MS,
} from './helpers/mediaUtils';
import * as fs from 'fs';
import * as path from 'path';
```

All helpers live in `tests/e2e/helpers/mediaUtils.ts`. **Import only the ones you actually use.** Every spec (demo and private alike) uses the lifecycle helpers (`cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings`) plus the media helpers; private tests typically add the interaction helpers (`findActionBarByFileName`, `openEntryMenu`, `setCheckbox`, `activeView`, `demoRightClick`, `demoRefresh`).

## Fixture Arguments

The `test(...)` callback destructures fixtures from `./fixtures/electronApp`:

```typescript
async ({ mainWindow, testDataPath, electronApp }) => { ... }
```

- `mainWindow` — the Playwright `Page` for the app window (always needed).
- `testDataPath` — absolute path to the app's test-data folder, `mkbrowser-test/` at the repo root (the folder the app is browsing; it is checked into git). Needed by any test that seeds files on disk.
- `electronApp` — the Electron application handle; use `electronApp.evaluate(...)` to run code in the **main process** (e.g. to seed the OS clipboard). Destructure it only when needed.

Each test launches the app with a **fresh, seeded user-data dir** (`createSeededUserDataDir` in `helpers/mediaUtils.ts`, called by the `electronApp` fixture). So app config — bookmarks, settings — always starts clean and cannot leak between tests; there is no config cleanup to do.

## How the Harness Launches the App

- `playwright.config.ts` points at `tests/e2e/`, runs **one worker** (Electron instances would conflict in parallel), allows 2 minutes per test, and uses the HTML reporter. Its `globalSetup` is `tests/e2e/global-setup.ts`.
- `global-setup.ts` runs `npm run package` **only if** `.vite/build/main.js` or `.vite/renderer/main_window/index.html` is missing — it never detects a stale build, so rebuild yourself after any `src/` change. It then copies `resources/` into `.vite/build/resources/`, because launching `.vite/build/main.js` directly makes `app.getAppPath()` point there.
- The `electronApp` fixture (`tests/e2e/fixtures/electronApp.ts`) launches `.vite/build/main.js` with `--user-data-dir=<temp dir>` and the `mkbrowser-test/` path as the folder argument, sets `ELECTRON_DISABLE_SANDBOX=1`, and defaults `DISPLAY` to `:0`. The window is a real, visible window on the local display.
- The temp user-data dir is seeded from `tests/e2e/fixtures/seed-config.yaml` (as `config.yaml`) and `tests/e2e/fixtures/seed-tags.yaml` (as `tags.yaml`), and is deleted after the app closes. The seed config disables AI and pre-populates the search definitions the search demos rely on.

## Test Setup / Teardown Boilerplate

Every spec, demo or private, starts with the lifecycle helpers (this is exactly how `create-file-demo.spec.ts` begins):

```typescript
const testName = path.basename(__filename, '.spec.ts');
const screenshotDir = path.join(__dirname, '../../screenshots', testName);

cleanupScreenshots(screenshotDir);   // clears prior screenshots, keeps the dir
cleanupTestDataFiles();              // removes leftovers of earlier runs from mkbrowser-test/
await resetSettings(mainWindow);     // resets app config to a known baseline and reloads

let step = 1;
await mainWindow.waitForTimeout(2000);   // wait for initial load
```

Tests that exercise AI features call `resetSettings(mainWindow, { aiEnabled: true })`; tests that exercise inline editing in the folder listing call `resetSettings(mainWindow, { expandedEditor: false })` (see [Edit mode](#edit-mode-and-the-codemirror-editor)).

Always call `logScreenshotSummary(screenshotDir)` as the **final** statement of the test body.

## Step Counter Convention

Use a single `let step = 1` counter, always incremented inline with `step++` in every call. Screenshots and narration interleave — a screenshot is typically followed immediately by its narration, each consuming a step number:

```typescript
await takeScreenshot(mainWindow, focusEl, screenshotDir, step++, 'descriptive-label');
writeNarration(screenshotDir, step++, 'Spoken narration for this moment in the demo.');
```

Output filenames are zero-padded to three digits (`001-files-visible.png`, `002-narration.txt`) so downstream tooling sorts them correctly.

## Core Media Helpers

All helpers are in `tests/e2e/helpers/mediaUtils.ts` — read it for exact, current signatures before using an unfamiliar one.

### `takeScreenshot` — plain / highlighted screenshot
```typescript
await takeScreenshot(mainWindow, locator, screenshotDir, step++, 'label');
```
The **second argument is a `Locator | null`**: pass a locator to draw a highlight box around that element, or `null` for a plain full-window capture. The highlight is a separate overlay `<div>` (promoted into the browser's top layer, so it paints over open dialogs and popup menus) that is added just before the capture and removed right after it — see `screenshotWithHighlight` in `helpers/visual-indicators.ts`. Take the highlight screenshot *just before* `demoClick`ing the element (so it is still visible without any transition state), or right after typing into one, to draw the viewer's eye to it.

### `writeNarration` — write companion narration file
```typescript
writeNarration(screenshotDir, step++, 'Narration text that will be read aloud.');
```
Synchronous. Write it immediately after the screenshot it accompanies. See [Narration Writing Guidelines](#narration-writing-guidelines).

### `demoClick` / `demoRightClick` — click with demo timing
```typescript
await demoClick(locator);
await demoClick(button, { force: true });   // for hover-revealed action-bar buttons
await demoRightClick(locator);              // opens context menus (rename, editor menu)
```
`demoClick` adds ~300 ms before and ~1000 ms after the click so a screen recorder captures the state change. Pass `{ force: true }` when clicking a button that only appears on hover (see [Hover-revealed entry action bars](#hover-revealed-entry-action-bars)). `demoRightClick` fires a `contextmenu` event with the same demo timing.

### `insertText` — type text into the focused element
```typescript
await insertText(mainWindow, 'filename-here', true, filenameInput);   // into an explicit input
await insertText(mainWindow, multiLineContent, true);                 // into whatever is focused (e.g. CodeMirror)
```
The third argument `showHighlight` should be `true` for these tests. Pass the optional fourth `focusTarget` locator when the element is not already focused (an optional fifth `pauseBefore` overrides the 500 ms pause before typing). The text goes in as a **single** `keyboard.insertText` call (like a paste), not character-by-character, so CodeMirror's auto-indent never fires. When a `focusTarget` is given, `insertText` focuses it and presses `Ctrl+A` first, so the new text **replaces** the field's content; without one, the text is inserted at the current cursor position in whatever is focused.

### `setCheckbox` — toggle a selection checkbox
```typescript
await setCheckbox(checkbox, true);   // check
await setCheckbox(checkbox, false);  // uncheck
```
Highlights the element (or its enclosing `<label>`) first, then clicks only if the current state differs from the requested one. Works for radio buttons too (to turn them *on*). Use for direct toggling of checkboxes; use plain `expect(checkbox).toBeChecked()` / `.not.toBeChecked()` for state assertions.

### `logScreenshotSummary` — log counts at end of test
```typescript
logScreenshotSummary(screenshotDir);
```
Always the final statement of the test body.

### `demoRefresh` — re-read the current folder
```typescript
await demoRefresh(mainWindow);
```
Clicks the current folder's breadcrumb (the `aria-current="location"` segment inside `browser-header-breadcrumbs`), which is the app's Refresh control. Use it after seeding files on disk.

### Lifecycle helpers

- `cleanupScreenshots(screenshotDir)` — deletes every file and subfolder in the dir except an `external/` subfolder (where hand-made media for `addExternalFile` lives), creating the dir if absent. Call at the start.
- `cleanupTestDataFiles()` — walks `mkbrowser-test/` recursively and removes what earlier (possibly aborted) runs left behind: any **folder** named `my-*` (with everything in it), the AI-chat turn folders `A/` and `H/`, and any **file** named `my-*.md`, a timestamp-named `.md` (`YYYY-MM-DD--….md`, as created by Document Mode's insert bar), `AI.md` or `HUMAN.md`. Call at the start. Nothing tracked by git matches these patterns. Anything else a test creates is **not** removed — see [Seeding Test Data on Disk](#seeding-test-data-on-disk).
- `resetSettings(mainWindow, { aiEnabled = false, expandedEditor = true })` — updates the app config through the preload API (tags panel hidden, AI off unless `aiEnabled: true`, `showPropsInEditor` off, `expandedEditor` as given) and reloads the window. Call at the start, `await`ed. Note the **`expandedEditor` default is `true`**, so editing from the folder listing opens the maximized editor unless you pass `{ expandedEditor: false }`.
- `addExternalFile(screenshotDir, step, fileName)` — copies a hand-made file (e.g. `external/intro.png`) from the screenshot dir into the numbered sequence as `<step>-<basename>`, for demos that need media Playwright can't capture.

## Seeding Test Data on Disk

Most private tests seed their own files/folders in `testDataPath`, then refresh the app so it sees them.

- **Name every seeded markdown file `my-*.md` and every seeded folder `my-*`.** Those are the patterns `cleanupTestDataFiles()` removes recursively, so if a run aborts before its own cleanup, the next run still starts clean. A `my-*` folder is removed with everything inside it (including `.attach` folders and binaries), so put non-markdown seeds inside a `my-*` folder. Use distinctive, greppable names/contents so assertions can't collide with anything else in the tree.
- **Anything outside those patterns is NOT auto-cleaned** — e.g. a `.png`/`.txt` or a non-`my-` folder written directly into an existing checked-in folder. Avoid that, or remove it manually. For a clean slate at the start, `fs.rmSync(folder, { recursive: true, force: true })` then `fs.mkdirSync(folder)`. At the end, `fs.rmSync(..., { recursive: true, force: true })` the whole seeded tree anyway. **Leave the test-data folder exactly as you found it.**
- **After seeding, make the app notice:** `await mainWindow.waitForTimeout(2000)` then `await demoRefresh(mainWindow)` (from `helpers/mediaUtils.ts`).
- Seed a small binary (e.g. a tiny PNG) inline from base64 — no external fixture needed:
  ```typescript
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(path.join(imagesPath, 'diagram.png'), tinyPng);
  ```

## Disk Assertions (the authority)

For private tests the **filesystem is the source of truth**, not the UI. Wrap every disk-state assertion in an auto-retrying block so it tolerates the app's async write-through:

```typescript
await expect(async () => {
  const files = fs.readdirSync(attachDir);
  expect(files).toHaveLength(1);
  expect(fs.readFileSync(path.join(attachDir, files[0]), 'utf8')).toContain('Pasted Note One');
}).toPass({ timeout: 10000 });
```

Prefer `toContain` / substring matches over strict equality for written text (the app may add a trailing newline unless you've verified `writeFile` is byte-exact). Use fixed `waitForTimeout` sleeps only for deliberate timing guards (see the collision guard below), never as a substitute for `toPass`.

## Interacting with the UI

### The browse list and refresh
The browse (file) list lives in `mainWindow.getByTestId('browser-main-content')` — scope entry lookups to it. There is no Refresh button: clicking the current folder's breadcrumb (the rightmost segment, or the home icon at the root — it carries `aria-current="location"`) re-reads the folder and the index tree from disk. Use the `demoRefresh(mainWindow)` helper for this; the `navigate-up-button` goes up a level. Clicking a folder's name navigates into it; clicking a file's name expands it.

### Hover-revealed entry action bars
Each entry has an action bar (`entry-action-bar`) whose buttons are **revealed on hover**. To click one:

```typescript
const bar = findActionBarByFileName(mainContent, 'my-host-note.md');
await bar.hover();
await mainWindow.waitForTimeout(ACTION_BAR_FADE_MS);   // icons fade in on a delay — wait or screenshots capture them invisible
const button = bar.getByTestId('entry-delete-button');
await takeScreenshot(mainWindow, button, screenshotDir, step++, 'label');   // highlight it
await demoClick(button, { force: true });                                   // force past the hover gate
```

`findActionBarByFileName(scope, fileName)` scopes to one entry's bar. It matches only **markdown** entries (it looks inside `browser-entry-markdown`), so use your own locator for folders and other file types. Always `hover()` then `demoClick(..., { force: true })` — this is the same pattern as the entry-delete flow at the end of `private-cut-and-paste.spec.ts`.

**The icons are not instantly visible on hover.** The bar uses the `HOVER_REVEAL` class from `src/renderer/styles.ts`: a CSS opacity transition with a 400 ms delay plus a 200 ms fade, so wait `ACTION_BAR_FADE_MS` (700 ms) after `hover()` before any screenshot that should show them. Playwright's `toBeVisible()` does **not** wait for this — an `opacity: 0` element counts as "visible" — so only a timeout works. And the reveal is lost as soon as the mouse moves elsewhere (e.g. after clicking a dialog button): **re-hover + re-wait before any later screenshot** that narrates the icon's state.

The icon buttons on the bar are (verify test IDs against `EntryActionBar.tsx` before hardcoding): `entry-delete-button`, `entry-reveal-button` (reveal in folder tree), `entry-move-up-button` / `entry-move-down-button` (when the entry can be reordered), and, always last, `entry-menu-button` (the hamburger, "More actions").

**Less common actions live in the hamburger menu** (`EntryPopupMenu.tsx`, test ID `entry-popup-menu`), not on the bar: `menu-entry-open-external`, `menu-entry-view-file`, `menu-entry-bookmark` (label toggles `Add Bookmark` / `Remove Bookmark`), `menu-entry-make-folder`, `menu-entry-copy-path`, and the attachment items `menu-entry-paste-clipboard-attachment` ("Attach: Clipboard"), `menu-entry-attach-from-file`, `menu-entry-create-attachment`. Open it with the helper, which handles the hover, the fade wait, and a stale `:hover` left behind by a closed modal dialog:

```typescript
const menu = await openEntryMenu(findActionBarByFileName(mainContent, 'my-host-note.md'));
await demoClick(menu.getByTestId('menu-entry-bookmark'));
```

The returned locator is page-level, because the menu renders in the browser's top layer outside the action bar.

### Views are hidden, not unmounted (`activeView`)
`App.tsx` switches views with `display:none` rather than unmounting them, so **the DOM of hidden views (Browse, Search, Analysis, …) is still present**. A page-wide `getByText` can match a hidden view. Scope assertions to the currently displayed view with `activeView(mainWindow)` (it matches the one view wrapper carrying `data-active-view="true"`) when a feature switches views. In particular, hashtags in seeded markdown render as clickable links in the Browse view too — keep Browse-view assertions to file names and scope Analysis/Search assertions to `activeView`.

### Popup menus
Menus (`edit-menu-button` and `tools-menu-button` in the Browse toolbar, `bookmarks-menu-button` in the index tree panel, the per-entry `entry-menu-button`, …) open a popup whose items **only exist in the DOM while the menu is open** and **unmount when it closes** (e.g. by an outside click). The popup is rendered by `PopupMenu` in `src/components/menus/base/PopupMenu.tsx`, promoted into the browser's top layer via the Popover API. Consequences:

- Take the "about to click this item" screenshot *after* opening the menu, while it is open.
- To re-assert a menu's contents after it closed, reopen it.
- Menu items are buttons; click by test ID (`menu-paste-clipboard`, `menu-folder-analysis`) or by role: `getByRole('button', { name: 'Replace in Files', exact: true })`.
- **Disabled items:** `PopupMenuItem` renders `disabled` as a real `disabled` attribute on the button, so `toBeDisabled()` / `toBeEnabled()` work.

### Edit mode and the CodeMirror editor
- **Enter edit mode:** click a file's name to expand it, then click its rendered markdown body — `MarkdownEntry.tsx` opens the CodeMirror editor on a left-button mouse-up over the content when no text is selected. `entry-save-button` becoming visible confirms edit mode.
- **Where the editor opens depends on `expandedEditor`.** `resetSettings` turns it **on** by default, and then an edit started in the folder listing switches the Browse tab into single-file mode (`BrowseFile`) with a maximized editor; Save and Cancel return to the listing. To test inline editing in the listing, call `resetSettings(mainWindow, { expandedEditor: false })`. The routing rules live in `src/store/expandedEdit.ts`; `private-expanded-edit.spec.ts` covers them end to end.
- **Edit toolbar** (`EntryEditToolbar.tsx`): `entry-save-button`, `entry-cancel-button`, `entry-editor-expand-toggle-button` (maximize/restore), and `entry-editor-ai-rewrite-button` (AI only).
- **Type:** use `insertText`. Without a `focusTarget` it inserts at the cursor; with one it selects-all and replaces. To append, place the cursor at the end first (`Control+End`).
- **Editor context menu:** `demoRightClick` on the editor's `.cm-content` area (not the gutter/toolbar) opens `src/components/editor/EditorContextMenu.tsx`; items have test IDs like `editor-save` and `editor-insert-object`.
- **Save:** click `entry-save-button`, then wait for it to disappear (edit mode ended), as `create-file-demo.spec.ts` does.
- CodeMirror's DOM is virtualized; asserting on `.cm-content` text works for short documents, but the authoritative check is always the saved bytes on disk.

### Inline rename
Right-clicking (`demoRightClick`) an entry's **name text in its header row** opens an inline rename input in place of the name (`EntryShell.tsx` → `rename.handleRenameClick` on `onContextMenu`). Right-click the name, not the rendered body (which may bind right-click to other things). The header's right-click rename is disabled while that entry is being edited. The `RenameInput` has no `data-testid` — locate it as the focused textbox, `mainContent.locator('input:focus')`, as `private-rename.spec.ts` does. `fill()` the complete new name, then `Enter` saves / `Escape` cancels. Right-click is the only rename gesture, and it works the same for files and folders.

### Tabs
The tab bar is `app-tab-buttons` (it also holds the `navigate-up-button`); tabs (e.g. Analysis, Search Results) have `×` close buttons. Read `src/components/AppTabButtons.tsx` for how to locate a specific tab and its close button. A results tab only exists after its action has run.

## Seeding the OS Clipboard

Do **not** drive the OS clipboard with mouse gestures. Seed it programmatically from the **main process** via `electronApp.evaluate` (the renderer's `navigator.clipboard.read()` reads the same OS clipboard). `electronApp.evaluate` serializes its argument, so pass the raw string/base64 and build any Buffer *inside* the callback.

Text:
```typescript
await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardText);
```

Image (build the Buffer in-process):
```typescript
const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await electronApp.evaluate(({ clipboard, nativeImage }, base64) => {
  clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(base64, 'base64')));
}, tinyPngBase64);
```

- Tests run against **real OS clipboard state** — seed the clipboard yourself before *every* paste and assume nothing about its prior contents.
- Clean up at the end so later tests aren't affected: `await electronApp.evaluate(({ clipboard }) => clipboard.clear())`.
- If a renderer paste ever reports "Unable to read clipboard", that's a real app/permissions issue — report it to the user rather than working around it.

## Time-Dependent (Timestamp) Filenames

Clipboard attachments are named by `generateTimestampFilename(ext)` in `src/renderer/clipboard.ts` → `YYYY-MM-DD--HH-MM-SS-mmm.<ext>` (milliseconds included). **Never hardcode or assert an exact timestamp filename.** Discover the file after the operation:

```typescript
const files = fs.readdirSync(attachDir).filter(f => /^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}-\d{3}\.png$/.test(f));
```

The millisecond component makes two pastes in the same second produce distinct names, so no delay is needed between them. Still identify the newly-created file by diffing the directory listing before/after rather than assuming a single match.

## Image / Binary Assertions

- An image on the clipboard travels clipboard → Chromium Clipboard API → re-encode, so **the bytes written to disk will not equal the seeded base64** — never assert byte equality against the seed.
- Validate a written PNG by its magic bytes and nonzero length instead:
  ```typescript
  const buf = fs.readFileSync(pngPath);
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect(buf.length).toBeGreaterThan(8);
  ```
- A 1×1 seed image is effectively invisible — assert the `img` element's presence and `src`, never its visual size. Seed a larger solid-color PNG only if the demo screenshots benefit.
- `pasteFromClipboard` (`src/renderer/clipboard.ts`) checks `image/*` types **before** `text/plain`, so an image wins if both are present.

## Typical Step Sequence Pattern

Every test follows this rhythm:

1. **Wait + verify** the initial state is ready (assert a known item is visible), then screenshot + narration.
2. **Highlight the UI control** about to be activated → `takeScreenshot` (with its locator) + narration.
3. **Interact** → `demoClick` / `demoRightClick` / `insertText` / `setCheckbox`.
4. **Screenshot the result** → `takeScreenshot` + narration describing what changed. For private tests, also **assert on disk** (`toPass`).
5. Repeat for each meaningful action until the workflow is complete.
6. **Final assertions** (UI state, and for private tests the on-disk end state — including any *negative* proof, e.g. "nothing moved").
7. **Cleanup** any seeded folders/non-`my-*.md` files, then call `logScreenshotSummary`.

## Narration Writing Guidelines

- Write for text-to-speech — no Markdown, no code blocks, complete sentences.
- Describe what is currently visible, then explain what is about to happen.
- Keep each narration to 1–4 sentences, friendly and tutorial-style, present tense.
- Use phonetic pronunciation guides in square brackets for terms TTS mispronounces, e.g. `[LaTeX](/lˈeɪtɛk/)`.

## Assertions

Include lightweight `expect` assertions at key moments to guard against a silent failure:

```typescript
// Verify the app is ready before starting
await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });

// Verify an action completed
await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });

// State that flips asynchronously (e.g. the bookmark menu label, config writes): rely on the
// auto-retrying assertion rather than reading state immediately.
const menu = await openEntryMenu(findActionBarByFileName(mainContent, 'my-host-note.md'));
await expect(menu.getByTestId('menu-entry-bookmark')).toHaveText('Remove Bookmark');
```

## General Discipline / Gotchas

- **Verify selectors and exact strings against the source before hardcoding.** Test IDs, dynamic IDs that embed a name (e.g. `bookmark-item-<name>`, spaces included), menu labels, and summary wording ("Replaced …") all live in `src/` — `grep -a` for them and confirm. Dynamic IDs and labels change; do not trust memory.
- **`grep -a` always** — some source files contain UTF-8 punctuation that makes plain `grep` mislabel them "binary" and skip them.
- **Never run the Playwright tests yourself.** When the spec is written, stop and ask the user to run it.
- **Test-only changes need no rebuild.** But the e2e tests launch the *packaged* build from `.vite/build/`, and the build is not auto-detected as stale — so if you had to touch anything under `src/` (e.g. adding a `data-testid` because no existing locator worked), tell the user a `npm run package` rebuild is required before running.
- **A failing assertion may be a real regression, not a flaky test.** If a documented behavior (e.g. case-sensitivity in Replace in Files, or an attachment folder following a rename) fails, re-read the implementation and report a possible regression to the user instead of loosening the assertion.
- **Prefer unambiguous fixtures.** Design seeded contents so every expected number/string is exact (e.g. a known count of a distinctive hashtag across files and a subfolder), so counts and ordering assertions can't be satisfied by coincidence.

## Complete Skeletons

### Demo test

```typescript
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot, writeNarration, demoClick, insertText, logScreenshotSummary,
  cleanupScreenshots, cleanupTestDataFiles, resetSettings,
} from './helpers/mediaUtils';

test.describe('My Feature Demo', () => {
  test('demonstrate my feature', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    let step = 1;
    await mainWindow.waitForTimeout(2000);

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText('sample.md').first()).toBeVisible({ timeout: 10000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(screenshotDir, step++, 'Welcome to MkBrowser. Today we will demonstrate...');

    // --- workflow steps here ---

    logScreenshotSummary(screenshotDir);
  });
});
```

### Private (verification) test

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot, writeNarration, demoClick, demoRefresh, setCheckbox, logScreenshotSummary,
  cleanupScreenshots, cleanupTestDataFiles, resetSettings, findActionBarByFileName,
} from './helpers/mediaUtils';

test.describe('Private: My Feature', () => {
  test('verify my feature end to end', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed inside a my-* folder: cleanupTestDataFiles() removes it if a run aborts.
    const demoFolder = path.join(testDataPath, 'my-feature-demo');
    fs.rmSync(demoFolder, { recursive: true, force: true });
    fs.mkdirSync(demoFolder);
    fs.writeFileSync(path.join(demoFolder, 'my-host-note.md'), '# Host\n\nBody.\n');

    let step = 1;

    // Make the app see the seeded files.
    await mainWindow.waitForTimeout(2000);
    await demoRefresh(mainWindow);

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText('my-feature-demo')).toBeVisible({ timeout: 10000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(screenshotDir, step++, 'We start with a seeded folder...');

    // --- interact (hover action bars, menus, edit mode, etc.) ---

    // --- disk assertion (the authority) ---
    await expect(async () => {
      expect(fs.existsSync(path.join(demoFolder, 'expected-output'))).toBe(true);
    }).toPass({ timeout: 10000 });

    // Cleanup: remove everything cleanupTestDataFiles() won't catch.
    fs.rmSync(demoFolder, { recursive: true, force: true });

    logScreenshotSummary(screenshotDir);
  });
});
```
