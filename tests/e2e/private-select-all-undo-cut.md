# Prompt: Create `private-select-all-undo-cut.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-select-all-undo-cut.spec.ts` in the MkBrowser repo. Read this whole document first, then study the two reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

## What the test verifies

The selection-management items in the **Edit** popup menu, and the cut-cancellation safety net:

1. **Select All** — selects every item in the current folder (all checkboxes become checked, and the header Cut/Delete buttons appear).
2. **Unselect All** — clears every selection (checkboxes unchecked, header buttons disappear).
3. **Undo Cut** — after cutting items (which hides them from the list and shows paste buttons on folders), Undo Cut restores them: the hidden items reappear, paste buttons vanish, and **nothing moved on disk**.
4. The `Undo Cut` menu item is disabled when nothing is cut (it has an `undoCutDisabled` state — verify how "disabled" renders in `src/components/menus/EditPopupMenu.tsx` before asserting).

This test intentionally proves a *negative*: after cut + undo, the filesystem is byte-for-byte where it started.

## Reference tests (read these first)

- `tests/e2e/private-cut-and-paste.spec.ts` — the cut workflow this test partially reuses: checkbox selection, the `cut-button`, cut items disappearing, per-folder paste buttons (`Paste cut items into this folder`).
- `tests/e2e/private-split-and-join.spec.ts` — how to open the Edit popup menu (`edit-menu-button`) and click a menu item by `getByRole('button', { name: '...', exact: true })`.

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

- Edit menu: `edit-menu-button`; items are buttons labeled `Undo Cut`, `Select All`, `Unselect All` (see `src/components/menus/EditPopupMenu.tsx`).
- Selection checkboxes: `mainContent.getByRole('checkbox', { name: 'Select <fileName>' })`; use `setCheckbox(checkbox, true/false)` for direct toggling and plain `expect(checkbox).toBeChecked()` / `.not.toBeChecked()` for state assertions.
- Header buttons that appear only with a selection: `cut-button`, `delete-button`.
- Per-folder paste affordance while items are cut: `getByRole('button', { name: 'Paste cut items into this folder' })`.

## Test scenario (step by step)

Seed a dedicated subfolder `my-undo-cut-demo/` in `testDataPath` (rm + mkdir for a clean slate), containing:
- three files: `my-item-one.md`, `my-item-two.md`, `my-item-three.md`
- one destination folder `dest/` (empty) — it exists to prove paste buttons appear/disappear, and to prove nothing lands in it

Then:

1. **Initial view** — refresh, navigate into `my-undo-cut-demo`, assert all three files and `dest` visible. Screenshot + narration introducing the Edit menu's selection tools.
2. **Undo Cut starts disabled** — open the Edit menu, assert the `Undo Cut` item is disabled (verify how EditPopupMenu renders disabled items — likely a `disabled` attribute on the button). Screenshot + narration ("nothing has been cut yet, so Undo Cut is grayed out"). Close the menu (check the reference tests / component for how to close — clicking the menu button again or pressing Escape).
3. **Select All** — open the Edit menu, screenshot the `Select All` item + narration, click it. Assert all three file checkboxes **and** the `dest` folder checkbox are checked, and the `cut-button` / `delete-button` appeared in the header. Screenshot + narration.
4. **Unselect All** — reopen the menu, click `Unselect All`. Assert all checkboxes unchecked and header buttons gone. Screenshot + narration.
5. **Cut two files** — `setCheckbox` on `my-item-one.md` and `my-item-two.md`, click `cut-button`. Assert both disappear from the list, `my-item-three.md` remains, and the paste button is visible on the `dest` folder row. Screenshot + narration recapping cut behavior.
6. **Undo Cut** — open the Edit menu; assert `Undo Cut` is now enabled; screenshot + narration ("we've changed our minds"). Click it. Assert: both files are visible in the list again, the paste buttons have count 0, and (in `toPass`) all three files still exist in `my-undo-cut-demo/` on disk while `dest/` is still empty (`fs.readdirSync(destPath).length === 0`). Screenshot + narration emphasizing that the pending move was cancelled and no file moved.
7. **Undo Cut disabled again** — reopen the Edit menu and assert `Undo Cut` is back to disabled. Screenshot + narration. Close the menu.
8. **Cleanup** — `fs.rmSync` the `my-undo-cut-demo` folder recursively. Final narration wrapping up.

## Gotchas

- After Undo Cut, whether the restored items come back **selected or unselected** is an implementation detail — read the store code (`src/store/items.ts`, search for undo-cut handling with `grep -a`) and assert whichever it actually does, or skip that assertion entirely.
- `Select All` may include hidden/system entries beyond the four seeded items if any exist; scope checkbox assertions to the four known names rather than counting all checkboxes.
- Menu items unmount when the menu closes — every screenshot of a menu item must happen while the menu is open.
- The disabled state of `Undo Cut`: check `EditPopupMenu.tsx` and its menu-item base component (`src/components/menus/base/`) for whether disabled renders as `[disabled]`, `aria-disabled`, or a click-swallowing style, and assert accordingly (`toBeDisabled()` only works for real `disabled` attributes).
