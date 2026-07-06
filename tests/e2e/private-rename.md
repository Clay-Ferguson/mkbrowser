# Prompt: Create `private-rename.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-rename.spec.ts` in the MkBrowser repo. Read this whole document first, then study the two reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

## What the test verifies

MkBrowser's **rename** feature, in three phases:

1. Rename a markdown file via the inline rename input, and verify the rename on disk.
2. Rename a folder the same way, and verify on disk.
3. Rename a markdown file that has an **attachments folder** (`<name>.md.attach`), and verify that MkBrowser automatically renames the `.attach` folder to match the new file name (this association-preserving rename is the high-value assertion of this test).

## Reference tests (read these first)

- `tests/e2e/private-cut-and-paste.spec.ts` — the canonical "private" test: seeding files on disk, refresh, checkbox selection, disk assertions wrapped in `expect(...).toPass()`, cleanup.
- `tests/e2e/private-split-and-join.spec.ts` — seeding a dedicated subfolder, navigating into it, Edit-menu usage.

Copy their overall structure: same imports, same `test.describe` / `test(...)` shape, same `({ mainWindow, testDataPath })` fixture args, same screenshot/narration cadence.

## Conventions you must follow (shared by all private tests)

- Import `test, expect` from `./fixtures/electronApp` and helpers from `./helpers/mediaUtils` (`takeScreenshot`, `writeNarration`, `demoClick`, `demoRightClick`, `setCheckbox`, `logScreenshotSummary`, `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings`, `findActionBarByFileName` — import only the ones you use).
- Screenshot dir: `path.join(__dirname, '../../screenshots', testName)` where `testName = path.basename(__filename, '.spec.ts')`. Call `cleanupScreenshots`, `cleanupTestDataFiles`, and `await resetSettings(mainWindow)` at the start, and `logScreenshotSummary(screenshotDir)` at the end.
- Seed all markdown files with names matching `my-*.md` — that's the pattern `cleanupTestDataFiles()` deletes recursively. Seed folders must be removed/recreated manually with `fs.rmSync(..., { recursive: true, force: true })` + `fs.mkdirSync` because cleanup does not remove folders.
- After seeding files on disk, `await mainWindow.waitForTimeout(2000)` then `await demoClick(mainWindow.getByTestId('refresh-button'))` so the app sees them.
- The browse list lives in `mainWindow.getByTestId('browser-main-content')`.
- Every disk-state assertion goes inside `await expect(async () => { ... }).toPass({ timeout: 10000 })`.
- Interleave `takeScreenshot(...)` and `writeNarration(...)` at each step, incrementing a shared `step` counter, exactly like the reference tests. Narration text is a friendly 1–3 sentence explanation of what is on screen / about to happen, written as if narrating a demo video.
- Leave the test-data folder clean at the end: delete (via `fs`) everything the test created that `cleanupTestDataFiles()` won't catch (folders, non-`my-*.md` files).
- Test-only changes need **no rebuild**. **Never run the Playwright test yourself** — when the spec is written, stop and ask the user to run it.

## How rename works in the UI (verified against the source — trust this)

- **Trigger**: right-click (`contextmenu`) on an entry's header row opens an inline rename input in place of the name (`EntryShell.tsx` calls `rename.handleRenameClick` on `onContextMenu`). Use the `demoRightClick` helper from `mediaUtils` on the entry's name text. Folders additionally have a rename (pencil) action-bar button wired to `onRenameClick`, but right-click works for both files and folders — use right-click for both so the flow is uniform.
- **The input**: `RenameInput` (`src/components/entries/common/RenameInput.tsx`) has no `data-testid`. Locate it as the focused textbox after the right-click, e.g. `mainContent.locator('input:focus')` — verify this locator against the component source before relying on it, and add a `data-testid` **only if you cannot make an existing locator work** (if you do touch `src/`, tell the user a `yarn package` rebuild is required before running).
- **Commit / cancel**: `Enter` saves, `Escape` cancels. Use `fill()` then `press('Enter')`.
- For files, rename pre-selects the base name (extension preserved); for folders the full name is selected. Just `fill()` the complete new name to avoid depending on selection behavior.

## Test scenario (step by step)

Seed (in `testDataPath` root):
- `my-rename-target.md` (any short markdown body)
- folder `my-rename-folder/` (empty)
- `my-attached-note.md` plus folder `my-attached-note.md.attach/` containing one file, e.g. `my-attachment-content.md` (using the `my-*.md` pattern keeps cleanup automatic)

Then:

1. **Initial view** — refresh, assert all seeded items visible. Screenshot + narration introducing the rename feature.
2. **Rename the file** — right-click `my-rename-target.md`'s name; assert the rename input appears; screenshot + narration ("the name has become an editable field"). Fill `my-renamed-target.md`, press Enter. Assert the new name is visible in `browser-main-content` and the old name has count 0. Disk assertion: new path exists, old path gone. Screenshot + narration.
3. **Rename the folder** — same flow on `my-rename-folder`, renaming to `my-renamed-folder`. Same UI + disk assertions. Screenshot + narration.
4. **Attachment-folder auto-rename** — narrate that `my-attached-note.md` has an attachments folder and that MkBrowser keeps the association intact across renames. Right-click-rename `my-attached-note.md` to `my-relocated-note.md`. Disk assertions: `my-relocated-note.md` exists, `my-relocated-note.md.attach/` exists and still contains the attachment file, and both old paths are gone. Screenshot + narration emphasizing the `.attach` folder followed the file automatically.
5. **Escape cancels** (cheap bonus assertion) — right-click the renamed file again, type a garbage name, press `Escape`, assert the name on screen is unchanged and disk is unchanged. Screenshot + narration.
6. **Cleanup** — `fs.rmSync` the renamed folder and the `.attach` folder; the renamed `my-*.md` files are caught by the next run's `cleanupTestDataFiles()`, but delete them anyway with `fs.unlinkSync` so the folder is left exactly as found. Final narration wrapping up.

## Gotchas

- Right-click may also be bound to other things inside the rendered markdown body — right-click the entry's **name text in its header**, not the content area.
- Entry action bars are revealed on hover; if you use any action-bar button, `hover()` the bar first and pass `{ force: true }` to `demoClick` (see the end of `private-cut-and-paste.spec.ts`).
- `.attach` folders may render specially; assert folder presence on disk rather than relying on how the `.attach` folder is displayed in the list.
- If a rename produces a confirm/alert dialog you didn't expect, check `confirm-dialog-confirm-button` / `alert-dialog-ok-button` test IDs.
