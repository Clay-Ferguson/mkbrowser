# Prompt: Create `private-replace-in-files.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-replace-in-files.spec.ts` in the MkBrowser repo. Read this whole document first, then study the two reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

## What the test verifies

The **Edit → Replace in Files** feature: a recursive, case-sensitive, literal find-and-replace across all `.md` and `.txt` files in the current folder and its subfolders. The test proves:

1. All occurrences are replaced (not just the first per file).
2. The replacement recurses into subfolders.
3. The match is **case-sensitive** (a differently-cased occurrence is left untouched).
4. A results summary dialog reports the replacement counts.
5. The changes are real on disk.

## Reference tests (read these first)

- `tests/e2e/private-split-and-join.spec.ts` — the closest model: seeds a dedicated subfolder, navigates into it, opens the **Edit** popup menu and clicks an item by role/name, verifies results on disk.
- `tests/e2e/private-cut-and-paste.spec.ts` — the canonical "private" test structure: seeding, refresh, disk assertions in `expect(...).toPass()`, cleanup.

Copy their overall structure: same imports, same `test.describe` / `test(...)` shape, same `({ mainWindow, testDataPath })` fixture args, same screenshot/narration cadence.

## Conventions you must follow (shared by all private tests)

- Import `test, expect` from `./fixtures/electronApp` and helpers from `./helpers/mediaUtils` (`takeScreenshot`, `writeNarration`, `demoClick`, `setCheckbox`, `logScreenshotSummary`, `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings` — import only the ones you use).
- Screenshot dir: `path.join(__dirname, '../../screenshots', testName)` where `testName = path.basename(__filename, '.spec.ts')`. Call `cleanupScreenshots`, `cleanupTestDataFiles`, and `await resetSettings(mainWindow)` at the start, and `logScreenshotSummary(screenshotDir)` at the end.
- Seed all markdown files with names matching `my-*.md` — that's the pattern `cleanupTestDataFiles()` deletes recursively. Seed folders must be removed/recreated manually with `fs.rmSync(..., { recursive: true, force: true })` + `fs.mkdirSync` because cleanup does not remove folders.
- After seeding files on disk, `await mainWindow.waitForTimeout(2000)` then `await demoClick(mainWindow.getByTestId('refresh-button'))` so the app sees them.
- The browse list lives in `mainWindow.getByTestId('browser-main-content')`.
- Every disk-state assertion goes inside `await expect(async () => { ... }).toPass({ timeout: 10000 })`.
- Interleave `takeScreenshot(...)` and `writeNarration(...)` at each step, incrementing a shared `step` counter, exactly like the reference tests. Narration text is a friendly 1–3 sentence explanation of what is on screen / about to happen, written as if narrating a demo video.
- Leave the test-data folder clean at the end (remove seeded folders via `fs`).
- Test-only changes need **no rebuild**. **Never run the Playwright test yourself** — when the spec is written, stop and ask the user to run it.

## Relevant UI selectors (verified against the source)

- Edit menu: `mainWindow.getByTestId('edit-menu-button')`; menu items are buttons — `mainWindow.getByRole('button', { name: 'Replace in Files', exact: true })` (see how `private-split-and-join.spec.ts` clicks `Split`).
- Replace dialog (`src/components/dialogs/ReplaceDialog.tsx`): `replace-search-input`, `replace-text-input`, `replace-dialog-submit-button`, `replace-dialog-cancel-button` test IDs.
- The results summary is shown in an alert dialog; its OK button is `alert-dialog-ok-button`. Verify the exact summary wording in the source (search for "Replaced" with `grep -a`) before asserting on the text; asserting a substring like `Replaced` plus the numbers is enough.

## Test scenario (step by step)

Seed a dedicated subfolder `my-replace-demo/` in `testDataPath` (rm + mkdir for a clean slate), containing:

- `my-replace-a.md` — contains the token `Widget` **twice** (e.g. two sentences), so the test proves all occurrences per file are replaced.
- `my-replace-b.md` — contains `Widget` once, plus the lowercase `widget` once (the case-sensitivity control — this one must survive).
- subfolder `sub/` with `my-replace-c.md` containing `Widget` once (the recursion proof).

Total expected: 4 replacements across 3 files; the lowercase `widget` untouched.

Then:

1. **Initial view** — refresh, navigate into `my-replace-demo` by clicking its name, assert the two files and the `sub` folder are visible. Screenshot + narration introducing Replace in Files.
2. **Open the dialog** — screenshot the Edit menu button, narration ("Replace in Files lives in the Edit menu"), `demoClick` it, assert the `Replace in Files` item is visible, screenshot + narration, click it. Assert the dialog inputs are visible.
3. **Fill the dialog** — fill search = `Widget`, replace = `Gadget`. Screenshot showing the filled dialog + narration explaining it will scan this folder and all subfolders, case-sensitively.
4. **Execute** — click `replace-dialog-submit-button`. Wait for the summary alert; assert it reports 4 replacements in 3 files (match the real wording found in the source). Screenshot the summary + narration. Dismiss with `alert-dialog-ok-button`.
5. **Verify in the UI** — the rendered markdown of expanded files may not auto-refresh; click `refresh-button`, then assert `Gadget` text is visible and `Widget` (exact case) has count 0 within `browser-main-content` for whatever content is rendered. Keep UI assertions modest — the authoritative check is disk.
6. **Verify on disk** (in `toPass`) — `my-replace-a.md` contains `Gadget` twice and no `Widget`; `my-replace-b.md` contains one `Gadget` **and still contains the lowercase `widget`**; `sub/my-replace-c.md` contains `Gadget`. Screenshot + narration calling out both the recursion and the untouched lowercase occurrence.
7. **Cleanup** — `fs.rmSync` the `my-replace-demo` folder recursively. Final narration wrapping up.

## Gotchas

- The dialog may normalize/trim inputs — type plain single-word tokens as specified above to stay clear of edge cases.
- Case-sensitivity is documented behavior (USER_GUIDE.md § Replace in Files); if the disk assertion for the lowercase `widget` fails, re-read the implementation before "fixing" the test — the test may have caught a real regression, so report it to the user instead of loosening the assertion.
- Menu popup items only exist while the menu is open; take the "about to click" screenshot after opening the menu, like the reference test does.
