# Prompt: Create `private-bookmarks.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-bookmarks.spec.ts` in the MkBrowser repo. Read this whole document first, then study the two reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

## What the test verifies

The full **Bookmarks** lifecycle:

1. Add a bookmark to a folder and to a file via the bookmark icon in the entry action bar (naming dialog appears, pre-filled with the filename).
2. The bookmark icon turns solid/active on bookmarked items.
3. Navigate somewhere else, open the bookmarks menu from the Index Tree panel, and jump to a bookmarked folder (the app navigates there).
4. Rename a bookmark from the menu's pencil button.
5. Delete a bookmark from the menu's trash button.
6. Remove the remaining bookmark by clicking the solid icon on the entry itself (immediate, no confirmation).

## Reference tests (read these first)

- `tests/e2e/private-cut-and-paste.spec.ts` — the canonical "private" test: seeding, refresh, hover-revealed action-bar buttons with `findActionBarByFileName` + `{ force: true }`, disk assertions, cleanup.
- `tests/e2e/file-explorer-demo.spec.ts` — interacts with the Index Tree panel on the left; read it for how tree-panel elements are located.

Copy their overall structure: same imports, same `test.describe` / `test(...)` shape, same `({ mainWindow, testDataPath })` fixture args, same screenshot/narration cadence.

## Conventions you must follow (shared by all private tests)

- Import `test, expect` from `./fixtures/electronApp` and helpers from `./helpers/mediaUtils` (`takeScreenshot`, `writeNarration`, `demoClick`, `setCheckbox`, `logScreenshotSummary`, `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings`, `findActionBarByFileName` — import only the ones you use).
- Screenshot dir: `path.join(__dirname, '../../screenshots', testName)` where `testName = path.basename(__filename, '.spec.ts')`. Call `cleanupScreenshots`, `cleanupTestDataFiles`, and `await resetSettings(mainWindow)` at the start, and `logScreenshotSummary(screenshotDir)` at the end.
- Seed all markdown files with names matching `my-*.md` — that's the pattern `cleanupTestDataFiles()` deletes recursively. Seed folders must be removed/recreated manually with `fs.rmSync(..., { recursive: true, force: true })` + `fs.mkdirSync` because cleanup does not remove folders.
- After seeding files on disk, `await mainWindow.waitForTimeout(2000)` then `await demoClick(mainWindow.getByTestId('refresh-button'))` so the app sees them.
- The browse list lives in `mainWindow.getByTestId('browser-main-content')`.
- Bookmarks are stored in the app config, and each test run launches with a **fresh seeded user-data dir** (see `fixtures/electronApp.ts` / `createSeededUserDataDir`), so the test always starts with zero bookmarks and leftover bookmarks cannot leak between runs — no bookmark cleanup needed.
- Interleave `takeScreenshot(...)` and `writeNarration(...)` at each step, incrementing a shared `step` counter, exactly like the reference tests. Narration text is a friendly 1–3 sentence explanation of what is on screen / about to happen, written as if narrating a demo video.
- Leave the test-data folder clean at the end (remove seeded folders via `fs`).
- Test-only changes need **no rebuild**. **Never run the Playwright test yourself** — when the spec is written, stop and ask the user to run it.

## Relevant UI selectors (verified against the source)

- Entry action bar: `entry-action-bar` test ID; use `findActionBarByFileName(mainContent, fileName)` to scope to one entry's bar. Bars are hover-revealed: `hover()` first, then `demoClick(button, { force: true })`.
- Bookmark toggle on an entry: `entry-bookmark-button` (inside that entry's action bar). Its `title` attribute flips between `Add bookmark` and `Remove bookmark` — use the title to assert bookmarked state.
- Bookmark naming dialog (`src/components/dialogs/BookmarkDialog.tsx`): `bookmark-name-input`, `bookmark-dialog-save-button`, `bookmark-dialog-cancel-button`.
- Bookmarks menu button at the top of the Index Tree panel: `bookmarks-menu-button` (in `src/components/views/IndexTreeView.tsx`).
- Inside the menu (`src/components/menus/BookmarksPopupMenu.tsx`), per-bookmark dynamic test IDs: `bookmark-item-<name>`, `bookmark-edit-button-<name>`, `bookmark-delete-button-<name>` (hover the item row to reveal the edit/delete buttons). The rename flow reuses the bookmark dialog inputs — verify in the source.
- If the Index Tree panel can be collapsed, the seed config's default state is what the app launches with; check `file-explorer-demo.spec.ts` for whether the tree needs to be revealed first (`breadcrumb-reveal-tree-button` exists for that).

## Test scenario (step by step)

Seed in `testDataPath` root (rm + mkdir the folder for a clean slate):
- folder `my-bookmark-folder/` containing one file `my-inside-note.md` (so navigating to the bookmark shows something)
- file `my-bookmark-note.md`

Then:

1. **Initial view** — refresh, assert both seeded items visible. Screenshot + narration introducing bookmarks.
2. **Bookmark the folder** — hover its action bar, screenshot the `entry-bookmark-button`, narration; click it (force). Assert the dialog appears with `bookmark-name-input` pre-filled with the folder name. Screenshot + narration ("we can accept the default name or type our own"). Save with the default name. Assert the entry's bookmark button now has `title="Remove bookmark"`. Screenshot + narration about the icon turning solid.
3. **Bookmark the file** — same flow on `my-bookmark-note.md`, but this time clear the input and type a custom name, e.g. `My Favorite Note`, before saving. Screenshot + narration.
4. **Navigate away** — click into `my-bookmark-folder`, so the current location is no longer the root (this makes the upcoming bookmark navigation observable). Assert `my-inside-note.md` is visible. Screenshot + narration.
5. **Open the bookmarks menu** — click `bookmarks-menu-button`; assert both bookmark entries are listed (`bookmark-item-<name>` — mind the exact name strings used when saving). Screenshot + narration explaining the menu lists bookmarks alphabetically.
6. **Navigate via bookmark** — while still inside `my-bookmark-folder`, click the **file** bookmark (`My Favorite Note`). Assert the app navigated back to the root so that `my-bookmark-note.md` is visible in `browser-main-content`. Screenshot + narration.
7. **Rename a bookmark** — reopen the menu, hover the folder bookmark's row, click `bookmark-edit-button-<name>`, change the name (e.g. to `Project Home`), save. Reopen/assert the menu now shows `Project Home` and not the old name. Screenshots + narration.
8. **Delete a bookmark from the menu** — hover the `Project Home` row, click its `bookmark-delete-button-...`. Assert it disappears from the menu. Screenshot + narration ("deleting a bookmark never touches the file or folder itself"). Close the menu.
9. **Remove the last bookmark from the entry** — on `my-bookmark-note.md`'s action bar, click the solid bookmark icon; assert its `title` flips back to `Add bookmark` with no dialog. Reopen the bookmarks menu and assert it is empty (check the source for the empty-state rendering). Screenshot + narration.
10. **Cleanup** — `fs.rmSync` `my-bookmark-folder` recursively (the `my-*.md` files are caught by `cleanupTestDataFiles`, but unlink them anyway). Final narration wrapping up.

## Gotchas

- Dynamic test IDs embed the bookmark **name**, spaces included (`bookmark-item-My Favorite Note`) — check `BookmarksPopupMenu.tsx` for exactly how the ID is built before hardcoding.
- Menu rows reveal their edit/delete buttons on hover — hover the row, then `{ force: true }` click, same pattern as entry action bars.
- The bookmarks menu is a popup: clicking elsewhere closes it. Re-open it each time you need to assert its contents.
- Bookmark toggling writes to the config asynchronously; assert the `title` flip with a normal `expect(...).toBeVisible()`-style auto-retrying assertion rather than reading state immediately.
