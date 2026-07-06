# Prompt: Create `private-folder-analysis.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-folder-analysis.spec.ts` in the MkBrowser repo. Read this whole document first, then study the reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

## What the test verifies

The **Tools → Folder Analysis** feature, which recursively scans all `.md` and `.txt` files under the current folder and reports every hashtag with its occurrence count, sorted by frequency:

1. Running the analysis opens the **Analysis** tab with correct totals: number of files scanned, unique hashtag count, and per-hashtag occurrence counts.
2. Hashtag counts aggregate across files **and** subfolders (recursion).
3. The list is sorted most-frequent-first.
4. Clicking a hashtag in the results runs a literal content search for it and switches to the **Search Results** tab, listing exactly the files containing that tag.
5. Closing the Analysis tab (its × button) returns to Browse and discards the analysis.

## Reference tests (read these first)

- `tests/e2e/custom-tags-demo.spec.ts` — the existing test closest to hashtag behavior; read it for any established hashtag/search assertions.
- `tests/e2e/search-demo.spec.ts` — how the Search Results view is asserted and how tabs are handled.
- `tests/e2e/private-cut-and-paste.spec.ts` — the canonical "private" test structure: seeding, refresh, disk assertions, cleanup.

Copy their overall structure: same imports, same `test.describe` / `test(...)` shape, same `({ mainWindow, testDataPath })` fixture args, same screenshot/narration cadence.

## Conventions you must follow (shared by all private tests)

- Import `test, expect` from `./fixtures/electronApp` and helpers from `./helpers/mediaUtils` (`takeScreenshot`, `writeNarration`, `demoClick`, `logScreenshotSummary`, `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings`, `activeView` — import only the ones you use; `activeView(mainWindow)` returns the currently displayed view, useful because views are hidden with `display:none` rather than unmounted).
- Screenshot dir: `path.join(__dirname, '../../screenshots', testName)` where `testName = path.basename(__filename, '.spec.ts')`. Call `cleanupScreenshots`, `cleanupTestDataFiles`, and `await resetSettings(mainWindow)` at the start, and `logScreenshotSummary(screenshotDir)` at the end.
- Seed all markdown files with names matching `my-*.md` — that's the pattern `cleanupTestDataFiles()` deletes recursively. Seed folders must be removed/recreated manually with `fs.rmSync(..., { recursive: true, force: true })` + `fs.mkdirSync` because cleanup does not remove folders.
- After seeding files on disk, `await mainWindow.waitForTimeout(2000)` then `await demoClick(mainWindow.getByTestId('refresh-button'))` so the app sees them.
- The browse list lives in `mainWindow.getByTestId('browser-main-content')`; the Analysis and Search views are separate views — locate text within the active view, not the whole page, to avoid matches from the hidden Browse view.
- Interleave `takeScreenshot(...)` and `writeNarration(...)` at each step, incrementing a shared `step` counter, exactly like the reference tests. Narration text is a friendly 1–3 sentence explanation of what is on screen / about to happen, written as if narrating a demo video.
- Leave the test-data folder clean at the end (remove seeded folders via `fs`).
- Test-only changes need **no rebuild**. **Never run the Playwright test yourself** — when the spec is written, stop and ask the user to run it.

## Relevant UI selectors (verified against the source)

- Tools menu: `tools-menu-button`; the analysis item is `menu-folder-analysis`.
- Analysis view: `src/components/views/FolderAnalysisView.tsx` — shows the folder path, total files scanned, a `(<N> unique)` hashtag count, and one clickable button per hashtag showing name + occurrence count. Read the component to get the exact rendering (how the count is displayed, what the button's accessible name is) before writing assertions.
- Tab bar: `app-tab-buttons` test ID; tabs have × close buttons. Read `src/components/AppTabButtons.tsx` (or wherever the tab bar lives — `grep -a` for `app-tab-buttons`) for how to locate a specific tab and its close button.
- Search results view: see how `search-demo.spec.ts` asserts results.

## Test scenario (step by step)

Seed a dedicated subfolder `my-analysis-demo/` in `testDataPath` (rm + mkdir for a clean slate). Design the fixture contents so every expected number is unambiguous:

- `my-analysis-alpha.md` — contains `#projectx` twice and `#urgent` once.
- `my-analysis-beta.md` — contains `#projectx` once.
- subfolder `sub/` with `my-analysis-gamma.md` — contains `#projectx` once and `#backlog` once.

Expected analysis: 3 files scanned; 3 unique hashtags; counts `#projectx` = 4, `#urgent` = 1, `#backlog` = 1; `#projectx` listed first (highest frequency). Files containing `#urgent`: only `my-analysis-alpha.md`. Use distinctive made-up tag names like these so nothing else in the test tree can collide with them.

Then:

1. **Initial view** — refresh, navigate into `my-analysis-demo`, assert the seeded files/folder are visible. Screenshot + narration introducing Folder Analysis.
2. **Run the analysis** — open the Tools menu (`tools-menu-button`), screenshot the `menu-folder-analysis` item + narration, click it. Assert the Analysis view appears (folder path shown, "3" total files, "(3 unique)"). Screenshot + narration.
3. **Verify counts and ordering** — assert each hashtag row shows its expected count, and that `#projectx` appears **before** the count-1 tags in the list (e.g. compare bounding boxes or use `:nth` ordering on the hashtag buttons — read the component first to pick a robust locator). Screenshot + narration explaining the counts include the file inside the subfolder.
4. **Click a hashtag** — screenshot the `#urgent` button + narration ("every hashtag is a live link into search"), click it. Assert the app switched to the Search Results view and that it lists `my-analysis-alpha.md` and **not** the other two files. Screenshot + narration.
5. **Return to the Analysis tab** — click the Analysis tab in `app-tab-buttons`; assert the results are still there (tab persistence). Screenshot + narration.
6. **Close the Analysis tab** — click its × button; assert the app is back on the Browse view and the Analysis tab is gone from the tab bar. Screenshot + narration ("closing the tab discards the analysis").
7. **Cleanup** — close the Search tab too if it is still open (leave the app on Browse), then `fs.rmSync` the `my-analysis-demo` folder recursively. Final narration wrapping up.

## Gotchas

- **Hashtags inside seeded markdown render as clickable links in the Browse view too** — keep Browse-view assertions to file names, and scope Analysis/Search assertions to the active view (`activeView` helper), because hidden views keep their DOM (views are hidden with `display:none`, never unmounted).
- The hashtag scanner's tag syntax is `#` + letters/digits/underscore/hyphen; write the seeded tags inline in normal sentences, each occurrence separated by whitespace, so the count is exactly what you wrote. Do not put tags in front matter for this test — the analysis counts content hashtags.
- Whether the analysis search uses `#urgent` (with hash) as the literal query affects what the Search view header shows; assert on the result file list, which is unambiguous, rather than the query echo.
- The Analysis tab only exists after an analysis has run — do not look for it before step 2.
