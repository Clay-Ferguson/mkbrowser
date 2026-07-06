# Prompt: Create `private-clipboard-image-attachment.spec.ts`

You are going to write a new Playwright e2e test file at `tests/e2e/private-clipboard-image-attachment.spec.ts` in the MkBrowser repo. Read this whole document first, then study the reference tests named below, then write the spec. Follow the existing conventions exactly — do not invent new patterns.

This is the **image-path sibling** of `private-clipboard-attachment.spec.ts` (the text path). If that spec already exists in `tests/e2e/`, read it first and mirror its structure — this test differs only in what goes onto the clipboard and what comes out on disk.

## What the test verifies

The **Paste Clipboard as Attachment** button (`entry-paste-clipboard-attachment-button`, title `Paste Clipboard as Attachment under this file`) when the clipboard holds an **image**:

1. Seed the OS clipboard with a PNG image.
2. Click the paste-clipboard-attachment button on a seeded markdown file that has **no** `.attach` folder yet.
3. Verify `<name>.md.attach/` was created on disk containing exactly one timestamp-named **`.png`** file that is a valid PNG (magic bytes) with nonzero size.
4. Verify the `.attach` folder appears in the browse list, and that navigating into it shows the image entry rendering an inline preview (`img` element).
5. Paste a **second** image onto the same file and verify it lands in the **existing** `.attach` folder alongside the first (two `.png` files).

## How the feature works internally (verified against the source — trust this)

- Button: `src/components/entries/common/EntryActionBar.tsx` (~line 156), in each markdown entry's hover-revealed action bar in the Browse view.
- Handler chain: `BrowseView.tsx` `doPasteClipboardAsAttachment` → `ensureAttachFolder(filePath)` (creates `<fileName>.md.attach/` if missing) → `pasteFromClipboardOp` (`src/renderer/fileOpsUtil.ts`) → `pasteFromClipboard` (`src/renderer/clipboard.ts`).
- `pasteFromClipboard` calls `navigator.clipboard.read()` and checks for `image/*` types **before** text. It base64-encodes the blob and writes it via `api.writeFileBinary` to a file named by `generateTimestampFilename(ext)` — format `YYYY-MM-DD--HH-MM-SS.png` (extension from MIME type; clipboard images read through the Clipboard API are effectively always `image/png`). **The filename is time-dependent, so never hardcode it** — discover it with `fs.readdirSync`.

## Seeding an image onto the clipboard

Use Electron's main-process `clipboard` + `nativeImage`. `electronApp.evaluate` serializes its argument, so pass the base64 string and build the Buffer **inside** the main process:

```ts
const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

await electronApp.evaluate(({ clipboard, nativeImage }, base64) => {
  clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(base64, 'base64')));
}, tinyPngBase64);
```

The `electronApp` fixture comes from `./fixtures/electronApp` — destructure `async ({ electronApp, mainWindow, testDataPath }) => { ... }`.

**Important:** the image travels clipboard → Chromium Clipboard API → re-encode, so the bytes written to disk will **not** equal the seeded base64. Do not assert byte equality with the seed. Assert instead: the file starts with the PNG magic bytes (`89 50 4E 47 0D 0A 1A 0A` — in Node: `buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))`) and `buf.length > 8`.

## Reference tests (read these first)

- `tests/e2e/private-clipboard-attachment.spec.ts` (if present) — the text-path sibling; mirror it.
- `tests/e2e/private-cut-and-paste.spec.ts` — the canonical "private" test: seeding, refresh, hover-revealed action-bar buttons via `findActionBarByFileName` + `demoClick(..., { force: true })`, disk assertions in `expect(...).toPass()`, cleanup.
- `tests/e2e/ai-vision-demo.spec.ts` — check it for any established pattern of asserting an image entry's inline rendering.

## Conventions you must follow (shared by all private tests)

- Import `test, expect` from `./fixtures/electronApp` and helpers from `./helpers/mediaUtils` (`takeScreenshot`, `writeNarration`, `demoClick`, `logScreenshotSummary`, `cleanupScreenshots`, `cleanupTestDataFiles`, `resetSettings`, `findActionBarByFileName` — import only the ones you use).
- Screenshot dir: `path.join(__dirname, '../../screenshots', testName)` where `testName = path.basename(__filename, '.spec.ts')`. Call `cleanupScreenshots`, `cleanupTestDataFiles`, and `await resetSettings(mainWindow)` at the start, and `logScreenshotSummary(screenshotDir)` at the end.
- Seed markdown files with names matching `my-*.md`; folders — including the `.attach` folder this test creates (and the `.png` files inside it, which `cleanupTestDataFiles()` does **not** match) — must be cleaned up manually with `fs.rmSync(..., { recursive: true, force: true })`.
- After seeding files on disk, `await mainWindow.waitForTimeout(2000)` then `await demoClick(mainWindow.getByTestId('refresh-button'))`.
- The browse list lives in `mainWindow.getByTestId('browser-main-content')`.
- Every disk-state assertion goes inside `await expect(async () => { ... }).toPass({ timeout: 10000 })`.
- Interleave `takeScreenshot(...)` and `writeNarration(...)` at each step with a shared `step` counter. Narration text is a friendly 1–3 sentence demo-video-style explanation of what is on screen / about to happen.
- Test-only changes need **no rebuild**. **Never run the Playwright test yourself** — when the spec is written, stop and ask the user to run it.

## Test scenario (step by step)

Seed a dedicated subfolder `my-clip-image-demo/` in `testDataPath` (rm + mkdir for a clean slate) containing one file, `my-image-host.md`, with a short body.

1. **Initial view** — refresh, navigate into `my-clip-image-demo`, assert `my-image-host.md` is visible and (disk check) that `my-image-host.md.attach` does not exist. Screenshot + narration introducing pasting a screenshot/image from the clipboard straight onto a note as an attachment.
2. **Seed the clipboard** — write the tiny PNG to the clipboard via the main-process snippet above. Optionally sanity-check the seed inside the same `evaluate` (`!clipboard.readImage().isEmpty()`) and assert it returned true. Brief narration ("we've placed an image on the system clipboard, as if we had just taken a screenshot").
3. **First paste** — `findActionBarByFileName(mainContent, 'my-image-host.md')`, `hover()`, screenshot the `entry-paste-clipboard-attachment-button` + narration, `demoClick(button, { force: true })`.
4. **Verify creation on disk** — `toPass` assertion: `my-image-host.md.attach/` exists and contains exactly one file matching `/^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}\.png$/`, and that file passes the PNG-magic-bytes check with length > 8. UI: the `my-image-host.md.attach` folder row is visible (refresh if needed). Screenshot + narration pointing out the auto-created attachments folder and that the image type was detected automatically.
5. **Inspect the attachment** — navigate into the `.attach` folder; assert the timestamped `.png` is listed and that an `img` element for it is present (image entries render inline previews; click the entry to expand if it isn't shown automatically — check `ImageEntry.tsx` / `ai-vision-demo.spec.ts` for how images render before choosing the locator; assert element presence and `src`, not visual appearance — the seed is a 1×1 pixel). Screenshot + narration. Navigate back up (`navigate-up-button`).
6. **Second paste** — wait `1500` ms (timestamp-collision guard — two pastes in the same second would produce the same filename and overwrite), re-seed the clipboard with the same snippet, hover the action bar, click the button again. `toPass` assertion: the `.attach` folder now contains **two** `.png` files, both passing the magic-bytes check. Identify the new one by diffing the directory listing from step 4. Screenshot + narration emphasizing reuse of the existing folder.
7. **Cleanup** — `clipboard.clear()` via `electronApp.evaluate` so later tests aren't affected, then `fs.rmSync` the whole `my-clip-image-demo` tree recursively. Final narration wrapping up.

## Gotchas

- **Image beats text**: `pasteFromClipboard` checks image types before `text/plain`, so if the clipboard somehow held both, the image wins — irrelevant here as long as each paste is preceded by its own `writeImage` seed.
- **Never assert exact timestamp filenames or byte equality with the seeded PNG** (see above) — regex the name, magic-check the bytes.
- The action bar is hover-revealed: always `hover()` then `demoClick(..., { force: true })`, exactly like the entry-delete flow at the end of `private-cut-and-paste.spec.ts`.
- A 1×1 image renders essentially invisibly — assert the `img` element and its `src`, never its visible size. If a bigger canvas helps the demo screenshots, you may instead seed a larger solid-color PNG by generating one in the main process (`nativeImage.createFromBuffer` of any valid PNG you embed as base64) — but the 1×1 is sufficient for correctness.
- This test runs against real OS clipboard state: seed the clipboard yourself before **every** paste and assume nothing about its prior contents.
