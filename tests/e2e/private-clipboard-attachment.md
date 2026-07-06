# Prompt: Create `private-clipboard-attachment.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-clipboard-attachment.spec.ts` in the MkBrowser repo. Read this whole document first, then study the reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

## What the test verifies

The **Paste Clipboard as Attachment** feature: every markdown entry's action bar has a button (`entry-paste-clipboard-attachment-button`, title `Paste Clipboard as Attachment under this file`) that takes whatever is on the OS clipboard and saves it as a new file inside the entry's attachments folder (`<name>.md.attach/`), creating that folder if it doesn't exist. This test exercises the **text** path:

1. Seed the OS clipboard with a known markdown string.
2. Click the paste-clipboard-attachment button on a seeded markdown file that has **no** `.attach` folder yet.
3. Verify the `.attach` folder was created on disk, containing exactly one timestamp-named `.md` file whose content equals the clipboard text.
4. Verify the `.attach` folder appears in the browse list, and that navigating into it shows the pasted file with its markdown rendered.
5. Paste a **second** clipboard text onto the same file and verify it lands in the **existing** `.attach` folder alongside the first (now two files).

## How the feature works internally (verified against the source — trust this)

- Button: `src/components/entries/common/EntryActionBar.tsx` (~line 156), rendered in each markdown entry's hover-revealed action bar in the Browse view.
- Handler chain: `BrowseView.tsx` `doPasteClipboardAsAttachment` → `ensureAttachFolder(filePath)` (creates `<fileName>.md.attach/` if missing) → `pasteFromClipboardOp` (`src/renderer/fileOpsUtil.ts`) → `pasteFromClipboard` (`src/renderer/clipboard.ts`).
- `pasteFromClipboard` reads via `navigator.clipboard.read()`; for `text/plain` it writes the text to a file named by `generateTimestampFilename('.md')` — format `YYYY-MM-DD--HH-MM-SS.md`. **The filename is time-dependent, so never hardcode it**: after pasting, `fs.readdirSync` the `.attach` folder and find the new `.md` file.
- If the clipboard is empty/unsupported the app shows an error — a correctly seeded clipboard avoids this.

## Seeding the clipboard

Do NOT try to drive the OS clipboard with mouse gestures. Seed it programmatically via Electron's **main-process** `clipboard` module, which is the most reliable route (the renderer's `navigator.clipboard.read()` reads the same OS clipboard):

```ts
await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardText);
```

The `electronApp` fixture is available from `./fixtures/electronApp` — destructure it alongside `mainWindow` and `testDataPath`: `async ({ electronApp, mainWindow, testDataPath }) => { ... }`. (`electronApp.evaluate` runs inside the Electron main process with the `electron` module as its first argument.)

If `navigator.clipboard.read()` in the renderer is denied permission (it shouldn't be in Electron, but if the paste produces the "Unable to read clipboard" error), report that to the user rather than hacking around it — it would be a real app/permissions issue.

## Reference tests (read these first)

- `tests/e2e/private-cut-and-paste.spec.ts` — the canonical "private" test: seeding, refresh, hover-revealed action-bar buttons via `findActionBarByFileName` + `demoClick(..., { force: true })`, disk assertions in `expect(...).toPass()`, cleanup.
- `tests/e2e/private-split-and-join.spec.ts` — navigating into folders and asserting rendered markdown content.

Copy their overall structure: same imports, same `test.describe` / `test(...)` shape, same screenshot/narration cadence.

## Conventions you must follow (shared by all private tests)

- Import `test, expect` from `./fixtures/electronApp` and helpers from `./helpers/mediaUtils` (`takeScreenshot`, `writeNarration`, `demoClick`, `logScreenshotSummary`, `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings`, `findActionBarByFileName` — import only the ones you use).
- Screenshot dir: `path.join(__dirname, '../../screenshots', testName)` where `testName = path.basename(__filename, '.spec.ts')`. Call `cleanupScreenshots`, `cleanupTestDataFiles`, and `await resetSettings(mainWindow)` at the start, and `logScreenshotSummary(screenshotDir)` at the end.
- Seed markdown files with names matching `my-*.md` (that's what `cleanupTestDataFiles()` deletes recursively); folders — including the `.attach` folder this test creates — must be cleaned up manually with `fs.rmSync(..., { recursive: true, force: true })`.
- After seeding files on disk, `await mainWindow.waitForTimeout(2000)` then `await demoClick(mainWindow.getByTestId('refresh-button'))`.
- The browse list lives in `mainWindow.getByTestId('browser-main-content')`.
- Every disk-state assertion goes inside `await expect(async () => { ... }).toPass({ timeout: 10000 })`.
- Interleave `takeScreenshot(...)` and `writeNarration(...)` at each step with a shared `step` counter. Narration text is a friendly 1–3 sentence demo-video-style explanation of what is on screen / about to happen.
- Test-only changes need **no rebuild**. **Never run the Playwright test yourself** — when the spec is written, stop and ask the user to run it.

## Test scenario (step by step)

Seed a dedicated subfolder `my-clip-attach-demo/` in `testDataPath` (rm + mkdir for a clean slate) containing one file, `my-host-note.md`, with a short body. Define two clipboard payloads with distinctive, greppable content, e.g.:

- `clipText1 = '# Pasted Note One\n\nThis paragraph arrived from the clipboard.'`
- `clipText2 = '# Pasted Note Two\n\nA second clipboard paste into the same attachments folder.'`

Then:

1. **Initial view** — refresh, navigate into `my-clip-attach-demo`, assert `my-host-note.md` is visible and that no `.attach` folder exists yet (disk check: `my-host-note.md.attach` absent). Screenshot + narration introducing attachments and the clipboard-paste shortcut.
2. **Seed the clipboard** — `electronApp.evaluate` write of `clipText1` (no UI change; brief narration explaining we've placed markdown text on the system clipboard).
3. **First paste** — locate the entry's action bar with `findActionBarByFileName(mainContent, 'my-host-note.md')`, `hover()` it, screenshot the `entry-paste-clipboard-attachment-button` inside it + narration ("this button pastes the clipboard as an attachment under this file"), then `demoClick(button, { force: true })`.
4. **Verify creation** — disk assertion (`toPass`): folder `my-host-note.md.attach/` exists and contains exactly one `.md` file matching `/^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}\.md$/`, whose content equals `clipText1`. UI assertion: the `my-host-note.md.attach` folder row is visible in `browser-main-content` (in a normal folder, `.attach` folders show as regular folders; click `refresh-button` first if needed). Screenshot + narration pointing out the auto-created folder.
5. **Inspect the attachment** — navigate into the `.attach` folder; assert the timestamp-named file is listed and the rendered markdown shows `Pasted Note One` (the paste flow auto-expands the new file — but don't depend on that; click the file name to expand if the heading isn't visible). Screenshot + narration. Navigate back up (`navigate-up-button`).
6. **Second paste into the existing folder** — seed the clipboard with `clipText2`, hover the same action bar, click the button again. Disk assertion: the `.attach` folder now contains **two** `.md` files, one containing `Pasted Note One` and the other `Pasted Note Two`. Screenshot + narration emphasizing reuse of the existing attachments folder.
7. **Cleanup** — clear the clipboard (`clipboard.clear()` via `electronApp.evaluate`) so later tests aren't affected, then `fs.rmSync` the whole `my-clip-attach-demo` tree recursively. Final narration wrapping up.

## Gotchas

- **Timestamp collision in step 6**: if both pastes happen within the same second, the second file would get the *same* name and overwrite the first. Guard with `await mainWindow.waitForTimeout(1500)` between the two pastes.
- **Never assert an exact timestamp filename** — always discover it with `fs.readdirSync` + the regex above. For step 6, diff the directory listing before/after to identify the new file.
- The action-bar button only exists on markdown entries in the Browse view and the bar is hover-revealed — always `hover()` then force-click, exactly like the entry-delete flow at the end of `private-cut-and-paste.spec.ts`.
- The paste writes through the app, so the UI refreshes itself via `onRefreshDirectory` — but the disk assertions are the authority; use the `toPass` retry window rather than fixed sleeps (except the deliberate 1500 ms collision guard).
- This test runs with real OS clipboard state: it must **seed the clipboard itself before every paste** and must not assume anything was on it beforehand.
- The written file content may gain a trailing newline or be written verbatim — assert with `toContain` on the distinctive heading/paragraph strings rather than strict equality, unless you verify in `writeFile`'s implementation that content is written byte-exact.
