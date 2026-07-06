# Prompt: Create `private-copy-link.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-copy-link.spec.ts` in the MkBrowser repo. Read this whole document first, then study the reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

## What the test verifies

The **Copy Link / Paste Link** workflow (USER_GUIDE.md § Copy Link): capture files in the browser with checkboxes + **Edit → Copy Link**, then paste them as **relative Markdown links** into a markdown file being edited in a *different folder*. Specifically:

1. Copy Link remembers the selected items and clears the checkboxes automatically, without moving or modifying any files.
2. Paste Link (editor right-click context menu) inserts one link per captured item at the cursor, each on its own line separated by a blank line.
3. Paths are computed **relative to the file being edited** (e.g. `../images/…` from a sibling folder).
4. Image files are pasted as inline images (`![name](path)`), documents as normal links (`[name](path)`).
5. The links survive a save — verified byte-level on disk — and the pasted image actually renders in the file's rendered view.

## Reference tests (read these first)

- `tests/e2e/create-file-demo.spec.ts` — editing flow: typing with the `insertText` helper, saving with `entry-save-button`, waiting for edit mode to end.
- `tests/e2e/private-split-and-join.spec.ts` — opening the Edit popup menu and clicking an item; the "private" test structure.
- `tests/e2e/private-cut-and-paste.spec.ts` — checkbox selection, disk assertions in `expect(...).toPass()`, cleanup.

Copy their overall structure: same imports, same `test.describe` / `test(...)` shape, same `({ mainWindow, testDataPath })` fixture args, same screenshot/narration cadence.

## Conventions you must follow (shared by all private tests)

- Import `test, expect` from `./fixtures/electronApp` and helpers from `./helpers/mediaUtils` (`takeScreenshot`, `writeNarration`, `demoClick`, `demoRightClick`, `setCheckbox`, `insertText`, `logScreenshotSummary`, `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings` — import only the ones you use).
- Screenshot dir: `path.join(__dirname, '../../screenshots', testName)` where `testName = path.basename(__filename, '.spec.ts')`. Call `cleanupScreenshots`, `cleanupTestDataFiles`, and `await resetSettings(mainWindow)` at the start, and `logScreenshotSummary(screenshotDir)` at the end.
- Seed all markdown files with names matching `my-*.md` — that's the pattern `cleanupTestDataFiles()` deletes recursively. Seed folders (and non-`.md` files like the PNG below) must be cleaned up manually with `fs.rmSync(..., { recursive: true, force: true })`.
- After seeding files on disk, `await mainWindow.waitForTimeout(2000)` then `await demoClick(mainWindow.getByTestId('refresh-button'))` so the app sees them.
- The browse list lives in `mainWindow.getByTestId('browser-main-content')`.
- Every disk-state assertion goes inside `await expect(async () => { ... }).toPass({ timeout: 10000 })`.
- Interleave `takeScreenshot(...)` and `writeNarration(...)` at each step, incrementing a shared `step` counter, exactly like the reference tests. Narration text is a friendly 1–3 sentence explanation of what is on screen / about to happen, written as if narrating a demo video.
- Test-only changes need **no rebuild**. **Never run the Playwright test yourself** — when the spec is written, stop and ask the user to run it.

## Relevant UI selectors and mechanics (verified against the source)

- Copy Link menu item: Edit menu (`edit-menu-button`) → `menu-copy-link` test ID (label `Copy Link`, in `src/components/menus/EditPopupMenu.tsx`).
- **Entering edit mode**: clicking the rendered markdown body of an expanded file enters edit mode (`MarkdownEntry.tsx` fires `handleEditClick` on mouse-up over the content when no text is selected). So: click the file name to expand it, then click its rendered body text to open the CodeMirror editor. `entry-save-button` becoming visible confirms edit mode.
- **Paste Link**: right-click inside the CodeMirror editor (`CodeMirrorEditor.tsx` handles `onContextMenu`) to open the editor context menu (`src/components/editor/EditorContextMenu.tsx`); the item is `editor-paste-link` test ID (label `Paste Link`). It only appears while a markdown file is open for editing and links have been captured. Use `demoRightClick` on the editor's content area (`.cm-content`).
- **Cursor placement**: click at the end of the editor text before right-clicking, so links are appended after the existing content. Keep the seeded body a single short line to make the expected final file content predictable.
- Saving: `entry-save-button`, then wait for it to disappear (edit mode ended), as `create-file-demo.spec.ts` does.
- Seed the image by writing a tiny PNG from base64 — no external fixture needed:
  ```ts
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(path.join(imagesPath, 'diagram.png'), tinyPng);
  ```

## Test scenario (step by step)

Seed a dedicated tree `my-copylink-demo/` in `testDataPath` (rm + mkdir for a clean slate):

- `my-copylink-demo/images/diagram.png` — the tiny PNG above
- `my-copylink-demo/reference/my-source-notes.md` — a short markdown file (the link **target**)
- `my-copylink-demo/writing/my-report.md` — body exactly one line, e.g. `# My Report` (the file that will **receive** the links)

Expected relative paths from `writing/my-report.md`: `../images/diagram.png` and `../reference/my-source-notes.md`.

**Design constraint (this shapes the whole test):** Copy Link captures one selection set at a time, and a second Copy Link *replaces* the first. The two link targets live in *different* folders, so one checkbox pass cannot reach both. The test therefore runs **two rounds** — round one captures and pastes the image, round two captures and pastes the document. Do not try to select files across two folders in a single capture.

Then:

1. **Initial view** — refresh, navigate into `my-copylink-demo`, assert the three subfolders are visible. Screenshot + narration introducing Copy Link: linking to files in *other* folders without typing paths by hand.
2. **Round one — capture the image** — navigate into `images/`, check `diagram.png`'s selection checkbox (`getByRole('checkbox', { name: 'Select diagram.png' })`). Screenshot + narration. Open the Edit menu (`edit-menu-button`), screenshot `menu-copy-link` + narration, click it. Assert the checkbox is now **unchecked** (Copy Link clears selections automatically). Screenshot + narration noting nothing was moved — the path was merely remembered.
3. **Round one — paste the image link** — navigate up (`navigate-up-button`) and into `writing/`, expand `my-report.md` by clicking its name, click its rendered body to enter edit mode (assert `entry-save-button` visible). Click at the end of the text and press `End`/`Enter` as needed to put the cursor on a fresh line. Right-click in the editor (`demoRightClick` on `.cm-content`), assert the `editor-paste-link` item is visible, screenshot + narration, click it. Assert the editor content now contains `![diagram.png](../images/diagram.png)` (assert on the visible `.cm-content` text — keep it simple). Screenshot + narration about the relative path being computed automatically.
4. **Save round one** — click `entry-save-button`, wait for edit mode to end. Assert the rendered view of `my-report.md` now displays an inline **image** (an `img` element whose `src` resolves to the diagram). Disk assertion (`toPass`): the file contains the exact image-link line. Screenshot + narration.
5. **Round two — capture the document** — navigate to `reference/`, select `my-source-notes.md`, Edit → Copy Link (assert the checkbox cleared). Screenshot + narration explaining a new Copy Link replaces the previously captured set.
6. **Round two — paste the document link** — navigate back to `writing/`, re-enter edit mode on `my-report.md`, cursor to end, right-click → Paste Link. Assert the editor shows `[my-source-notes.md](../reference/my-source-notes.md)`. Save; assert the rendered view shows a clickable link labeled `my-source-notes.md`. Disk assertion: the file contains both the image line and the document-link line, with the original `# My Report` heading intact. Screenshots + narration at capture, paste, and after save.
7. **Prove targets untouched** — disk assertion that `images/diagram.png` and `reference/my-source-notes.md` still exist at their original paths (Copy Link never moves files). Narration reinforcing this.
8. **Cleanup** — `fs.rmSync` the whole `my-copylink-demo` tree recursively. Final narration wrapping up.

## Gotchas
- CodeMirror's DOM is virtualized; asserting on `.cm-content` text works for short documents like this one. The authoritative assertion is always the saved file's bytes on disk.
- `demoRightClick` must land inside the editor text area, not on the gutter or toolbar.
- The exact link-text format (whether the label is the bare filename, and how spaces are encoded) is defined in the paste-link implementation — `grep -a` for `editor-paste-link` / the paste-link handler and confirm the expected strings before hardcoding them in assertions.
- If the rendered `img` fails to display because a 1×1 PNG is too small to see, the assertion should target the `img` element's existence/`src`, not its visual appearance.
- Expanding + clicking the body of a file whose body is only a heading: click the heading text itself; if the mouse-up-to-edit handler is finicky, check how `MarkdownEntry.tsx` line ~370 guards the click (left button, no text selection) and mimic that.
