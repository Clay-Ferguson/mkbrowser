# Screen Recording System for User Documentation 

## Overview

This document describes the screenshot-based video recording system used to create user guide videos and documentation for MkBrowser. Playwright E2E tests write screenshots and narration text files at key interaction points as they drive the app. A sibling project, **KoCreator** (`../kocreator`), then turns each test's screenshots and narration into an MP4 (with text-to-speech narration from Kokoro TTS) and an animated GIF, using FFmpeg.

For how to *write* the tests themselves (helpers, selectors, conventions), see `playwright.md` in this folder.

<!-- TOC -->

* [Overview](#overview)
* [How The System Works](#how-the-system-works)
  * [1. Test Execution → Media Generation](#1-test-execution--media-generation)
  * [2. Test Runner → User Workflow](#2-test-runner--user-workflow)
  * [3. Video Generation → Final Output](#3-video-generation--final-output)
  * [Prerequisites](#prerequisites)
* [Quick Reference](#quick-reference)
  * [Essential Helper Functions (from `mediaUtils.ts`)](#essential-helper-functions-from-mediautilsts)
  * [Typical Test Structure](#typical-test-structure)
* [System Components](#system-components)
  * [1. Playwright Test Runner Script](#1-playwright-test-runner-script)
  * [2. Media Utilities Library](#2-media-utilities-library)
  * [3. Visual Indicators Library](#3-visual-indicators-library)
  * [4. Demo Test Specs](#4-demo-test-specs)
  * [5. Video Creation Tool (KoCreator)](#5-video-creation-tool-kocreator)
* [Technical Deep Dive](#technical-deep-dive)
  * [CodeMirror Editor Handling](#codemirror-editor-handling)
  * [Playwright Electron Integration](#playwright-electron-integration)
* [Usage Workflow](#usage-workflow)
  * [Creating New Demo Videos](#creating-new-demo-videos)
  * [Typical File Structure After Test Run](#typical-file-structure-after-test-run)
  * [Customization Options](#customization-options)
* [File Structure](#file-structure)
* [Dependencies](#dependencies)
  * [NPM Packages](#npm-packages)
  * [System Packages](#system-packages)
  * [KoCreator and Kokoro TTS (Required for Video Generation)](#kocreator-and-kokoro-tts-required-for-video-generation)
* [Best Practices](#best-practices)
  * [1. Use Media Utility Helpers](#1-use-media-utility-helpers)
  * [2. Screenshot and Narration Pairing](#2-screenshot-and-narration-pairing)
  * [3. File Naming](#3-file-naming)
  * [4. Visual Indicator Placement](#4-visual-indicator-placement)
  * [5. Test Independence](#5-test-independence)
  * [6. Video Length](#6-video-length)
* [Troubleshooting](#troubleshooting)
  * [Screenshots Are Empty/Black](#screenshots-are-emptyblack)
  * [Visual Indicators Not Visible](#visual-indicators-not-visible)
  * [Screenshots Have Different Sizes](#screenshots-have-different-sizes)
  * [FFmpeg Not Found](#ffmpeg-not-found)
  * [Video Generation Is Skipped](#video-generation-is-skipped)
  * [Generated Audio Sounds Wrong](#generated-audio-sounds-wrong)
* [Future Enhancements](#future-enhancements)
  * [Potential Improvements](#potential-improvements)
  * [Alternative Approaches Considered](#alternative-approaches-considered)
* [Conclusion](#conclusion)

<!-- /TOC --> 

## How The System Works

The video creation system is an integrated workflow that connects three main components:

### 1. Test Execution → Media Generation
Playwright E2E tests (like `tests/e2e/create-file-demo.spec.ts`) generate:
- **Screenshots** (`.png` files) — captured at key interaction points using `takeScreenshot()`, optionally with a highlight box around one element
- **Narration text files** (`.txt` files) — written immediately after screenshots using `writeNarration()`

Both are saved to `screenshots/<test-name>/` (at the repo root, gitignored) with sequential 3-digit numbering (001, 002, 003...).

### 2. Test Runner → User Workflow
`playwright-test.sh` (repo root) manages the complete workflow:
- Offers to build the app first (runs `pre-package.sh` — unit tests + lint — then `npm run package`)
- Offers to run all demo tests, all tests including `private-*` ones, one specific test, or no test at all (just build a video from existing screenshots)
- Asks **up front** whether to generate videos afterwards, so a long run can be left unattended
- Cleans the old screenshots, narration files, and `generated-wav/` cache of each test it is about to run
- Executes the Playwright tests
- If you asked for videos, runs KoCreator for each test, then opens the `test-videos/` folder
- Finally offers to open the Playwright HTML report

### 3. Video Generation → Final Output
`../kocreator/create-video.py` converts test output to videos:
- Scans the screenshot folder for `.png`, `.txt`, `.mp3`, and `.wav` files, in filename order
- Converts `.txt` narration files to `.wav` audio with Kokoro TTS (run in-process; cached in a `generated-wav/` subfolder)
- Creates one video segment per screenshot or audio clip, all on one fixed canvas
- Concatenates the segments into the final `.mp4` (with audio), and builds a `.gif` from the images alone
- Writes both to `test-videos/` (repo root, gitignored)

**Complete workflow example**:
```bash
./playwright-test.sh
# → "Build app before running tests? [Y/n]" → Y
# → Select option 3 (specific test), then pick create-file-demo from the list
# → "Generate video(s) after running the test(s)? [y/N]" → y
# → Test generates: screenshots/create-file-demo/*.png and *.txt files
# → Creates: test-videos/create-file-demo.mp4 and create-file-demo.gif
```

### Prerequisites
- **KoCreator** must be checked out as a sibling folder (`../kocreator`) and set up with its `setup.sh`, and **uv** must be on your `PATH`. See [KoCreator and Kokoro TTS](#kocreator-and-kokoro-tts-required-for-video-generation). The tests themselves run without it; only video generation needs it.

## Quick Reference

### Essential Helper Functions (from `mediaUtils.ts`)

```typescript
// Screenshot. Pass a locator to draw a red highlight box around that element
// just for this capture, or null for a plain full-window screenshot.
await takeScreenshot(mainWindow, focusElement, screenshotDir, step++, 'description');
await takeScreenshot(mainWindow, null, screenshotDir, step++, 'description');

// Write narration text (converted to speech during video generation)
writeNarration(screenshotDir, step++, 'Narration text explaining what the user sees...');

// Bulk-insert text with highlight (optionally focus — and select-all in — a target element first)
await insertText(mainWindow, 'text to type', true, inputLocator);

// Demonstrate clicking with proper timing
await demoClick(buttonLocator);
```

### Typical Test Structure

```typescript
test('feature demo', async ({ mainWindow }) => {
  const testName = path.basename(__filename, '.spec.ts');
  const screenshotDir = path.join(__dirname, '../../screenshots', testName);

  cleanupScreenshots(screenshotDir);
  cleanupTestDataFiles();
  await resetSettings(mainWindow);

  let step = 1;
  await mainWindow.waitForTimeout(2000);

  // 1. Show initial state
  await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
  writeNarration(screenshotDir, step++, 'Describe what user sees...');

  // 2. Highlight element before interaction
  await takeScreenshot(mainWindow, button, screenshotDir, step++, 'about-to-click');
  writeNarration(screenshotDir, step++, 'Explain what will happen...');

  // 3. Perform action
  await demoClick(button);

  // 4. Show result
  await takeScreenshot(mainWindow, null, screenshotDir, step++, 'result');
  writeNarration(screenshotDir, step++, 'Describe the result...');

  logScreenshotSummary(screenshotDir);
});
```

## System Components

### 1. Playwright Test Runner Script
**Location**: `playwright-test.sh`

An interactive bash script that orchestrates the entire testing and video creation workflow.

#### Prompts, in order:
1. **"Build app before running tests? [Y/n]"** — on yes, runs `pre-package.sh` (unit tests and lint) and then `npm run package`, aborting if either fails. The e2e tests run against the packaged `.vite/build/` output and never rebuild a stale one themselves, so say yes after any source change.
2. **"Select test scope"**:
   - `1) Run all tests (except private ones)` — every `tests/e2e/*.spec.ts` not prefixed with `private-`
   - `2) Run all tests (including private ones)`
   - `3) Run specific test` — shows a numbered list of every spec file to choose from
   - `4) Build Video from Existing Images/Wavs` — pick a test, skip running it, and (after a confirmation prompt) build its video from what is already in `screenshots/<test-name>/`
3. **"Generate video(s) after running the test(s)? [y/N]"** — asked for options 1–3, before anything runs.
4. **"Open HTML report? [Y/n]"** — at the end; kills any running report server and runs `npx playwright show-report`.

#### Behavior details:
- **Screenshot cleanup**: before running, removes `screenshots/<test>/*.png`, `*.txt`, and the `generated-wav/` folder for each test about to run. Other subfolders (such as `external/`) are kept.
- **Video generation**: for each test, runs KoCreator as
  `uv run --directory ../kocreator python ../kocreator/create-video.py <mkbrowser-root> <test-name> --no-intro`
  after sourcing `../kocreator/uv-env.sh` (which selects KoCreator's per-machine virtualenv). If `../kocreator/uv-env.sh` is missing or `uv` is not on `PATH`, it prints a message and skips the video.
- **Run-all videos**: with option 1 or 2, a video is generated for every **non-private** spec (private tests are never demos), with a 90-second "CPU cooldown" pause after each one.
- **No intro**: the script always passes `--no-intro`, so the shared `screenshots/intro/` splash is **not** prepended by this script. Run KoCreator by hand to include it (see [Customization Options](#customization-options)).
- **Opening results**: on Linux, opens `test-videos/` with `xdg-open` after video generation.

### 2. Media Utilities Library
**Location**: `tests/e2e/helpers/mediaUtils.ts`

Provides standardized functions for capturing screenshots and writing narration files during test execution (it also holds the test lifecycle and UI interaction helpers documented in `playwright.md`):

#### Functions:

**`takeScreenshot(mainWindow, locator, screenshotDir, step, filenameSuffix)`**
- Captures a full-window screenshot with standardized 3-digit numbering
- `locator` is a `Locator | null`: with a locator, the element is highlighted for this capture only (via `screenshotWithHighlight`); with `null`, it is a plain screenshot
- Example: `await takeScreenshot(mainWindow, createButton, screenshotDir, step++, 'about-to-click-create')`
- Generates: `003-about-to-click-create.png`

**`writeNarration(screenshotDir, step, narrationText)`**
- Writes a narration text file with matching step numbering
- Example: `writeNarration(screenshotDir, step++, 'Welcome to MkBrowser...')`
- Generates: `002-narration.txt`
- Text files are later converted to audio by Kokoro TTS

**`addExternalFile(screenshotDir, step, fileName)`**
- Copies a hand-made file into the numbered sequence as `<step>-<basename>`, for media Playwright can't capture (e.g. a PDF viewer window)
- Example: `addExternalFile(screenshotDir, step++, 'external/pdf-complete.png')` (from `generate-pdf-demo.spec.ts`)
- Keep such files in `screenshots/<test-name>/external/`, which `cleanupScreenshots` and `playwright-test.sh` both leave alone

**`insertText(mainWindow, text, showHighlight, focusTarget?, pauseBefore = 500)`**
- Bulk-inserts text in one go (like a paste), with an optional highlight box around the target (15-second duration)
- With a `focusTarget`, focuses it and selects all first, so the text replaces the field's content
- With no `focusTarget`, inserts at the cursor of whatever is focused; the highlight then falls back to the CodeMirror editor container, or the focused element
- Works with CodeMirror editors, `<textarea>`, and `<input>` elements

**`demoClick(locator, options?)`** / **`demoRightClick(locator)`**
- Clicks with a 300 ms pause before and a 1000 ms pause after, so each state change is settled before the next screenshot
- `options` are passed through to Playwright's `click` (e.g. `{ force: true }` for hover-revealed buttons)

**`setCheckbox(locator, shouldBeChecked)`**
- Highlights the checkbox or radio button (with its `<label>`), then clicks it only if its state must change

**`logScreenshotSummary(screenshotDir)`**
- Logs how many `.png` and `.txt` files the test produced; call it last

### 3. Visual Indicators Library
**Location**: `tests/e2e/helpers/visual-indicators.ts`

Draws the red highlight boxes that show where user interactions occur in screenshots.

#### How highlighting works:
Highlights are drawn as a **standalone overlay `<div>`** appended to `<body>`, not by styling the target element. An element's own border or box-shadow gets clipped by any ancestor with `overflow: hidden`/`auto`; the overlay is `position: fixed` at the element's viewport coordinates instead, so it is never clipped.
- The box is padded 4 px around the element and clamped to the viewport, so it is never cut off at the window edge.
- It is `pointer-events: none`, so it never interferes with clicks or typing.
- It is promoted into the browser's **top layer** with the Popover API (`popover="manual"` + `showPopover()`). The app's modal dialogs and popup menus also live in the top layer, which paints above every z-index; since the overlay is shown after the dialog or menu opened, it paints on top of them.
- It removes itself as soon as the highlighted element leaves the DOM or stops being visible (checked every animation frame, which also catches views hidden with `display: none`), so a stale box can never sit over new content.
- Checkbox and radio inputs are widened to their enclosing `<label>`.

#### Functions:

**`showHighlightOverlay(page, locator | null, durationMs?)`**
- Draws the overlay. With a `null` locator it targets the CodeMirror editor container, or else the focused element. With a duration it removes itself after that long; without one it stays until `removeHighlightOverlay(page)`.

**`screenshotWithHighlight(page, locator, screenshotPath)`**
- Shows the overlay, waits 150 ms for it to paint, captures the screenshot, then removes the overlay. Used by `takeScreenshot` whenever a locator is passed, so the highlight is guaranteed to be in the image and gone afterwards.

**`highlightElement(page, locator, duration = 800)`**
- Shows the overlay for `duration` ms and returns after 300 ms, leaving the highlight visible. Used by `setCheckbox`.

**`demonstrateTyping(page, text, options)`**
- Older helper that types character-by-character with a highlight. No current spec uses it; prefer `insertText`.

#### Visual Style:
Defined by the `HIGHLIGHT` constant: a `2px solid #ff6666` border plus a glow (`0 0 30px rgba(255, 68, 68, 0.8)` outside and `inset 0 0 20px rgba(255, 68, 68, 0.2)` inside).

### 4. Demo Test Specs
**Location**: `tests/e2e/*-demo.spec.ts` (e.g. `create-file-demo.spec.ts`, `create-mermaid-demo.spec.ts`, `search-demo.spec.ts`, `ai-chat-demo.spec.ts`, …)

Playwright E2E tests that generate both screenshots and narration files during execution. `create-file-demo.spec.ts` is the canonical example.

**Key Points**:
- Each test run generates BOTH screenshots (`.png`) AND narration text files (`.txt`)
- Screenshots and narration share one step counter, so they interleave (a screenshot on an odd number followed by its narration on the next even number works well)
- Each test cleans its own `screenshots/<test-name>/` directory at the start with `cleanupScreenshots()`
- Files are ready for video generation immediately after the test completes
- Narration text files are converted to speech by Kokoro TTS during video generation

### 5. Video Creation Tool (KoCreator)
**Location**: `../kocreator/create-video.py` (a separate project; its `README.md` is the authoritative reference)

A Python script, run with `uv`, that converts the screenshots and narration text files into video files. It accepts interleaved `.png` screenshots and audio in several formats, all ordered by filename:

| Extension | Description |
|-----------|-------------|
| `.png`    | Screenshot image — displayed for `FRAME_DURATION` seconds |
| `.mp3`    | Pre-recorded audio — played while holding the most recent screenshot |
| `.wav`    | Pre-recorded audio (lossless) — same behavior as `.mp3` |
| `.txt`    | Narration text — converted to WAV audio via **Kokoro TTS**, then used like `.wav` |

**Usage**:
```bash
cd ../kocreator && source uv-env.sh
uv run create-video.py <base-folder> <subfolder-name> [--no-intro] [--threads N]
```
It reads `<base-folder>/screenshots/<subfolder-name>/` and writes `<base-folder>/test-videos/<subfolder-name>.mp4` and `.gif`.

**How it works**:
1. Collects the `.png`, `.mp3`, `.wav`, and `.txt` files in the screenshot folder, sorted by filename
2. Unless `--no-intro` is given, prepends the files of a sibling `intro/` folder (`screenshots/intro/`) — MP4 only
3. Checks that the first file is a `.png` (audio needs a preceding image to display)
4. Converts each `.txt` to a `.wav` with Kokoro TTS, loaded in-process from KoCreator's virtualenv (voice `am_liam`). Results are cached in a `generated-wav/` subfolder and reused while they are newer than their `.txt`
5. Picks one canvas size (the most common screenshot size, scaled down to fit 1920×1080 if needed) and scales/letterboxes every frame onto it — screenshots are never upscaled
6. For each `.png`, creates a video segment showing the image for `FRAME_DURATION` seconds with silent audio
7. For each audio file, creates a segment holding the most recent screenshot while the audio plays (duration detected via `ffprobe`)
8. Verifies that all segments share identical stream parameters, then concatenates them with `ffmpeg -f concat -c copy`
9. Builds the GIF from the images only, using a generated palette (GIF has no audio; the intro is not included)
10. Deletes the temporary `test-videos/<name>-segments/` folder and the palette file

**Encoding** (constants near the top of `create-video.py`):
- `FRAME_DURATION`: seconds per screenshot (default: 2)
- `KOKORO_VOICE`: TTS voice (default: `am_liam`)
- H.264 High profile, level 4.0, 8-bit `yuv420p`, `-preset slow`, `-crf 18`, constant 30 fps, BT.709 colour tags, square pixels
- AAC-LC audio, 44.1 kHz, mono, 64 kbps
- `+faststart` MP4 container, for web streaming
- `HIGH_PERFORMANCE = False` / `MAX_THREADS = 4`: ffmpeg and TTS are capped at 4 threads by default for a quieter run (override per run with `--threads N`)

The single fixed resolution matters: hardware video decoders (Safari, Chrome/Edge on Windows, Firefox) stop showing frames when an MP4's resolution changes mid-stream, so a video built from mixed-size screenshots would play audio over a blank picture.

**Output**: `test-videos/<subfolder-name>.mp4` and `test-videos/<subfolder-name>.gif`

#### Audio Narration

Playwright tests generate both screenshots (`.png`) and narration text files (`.txt`) with the `writeNarration()` helper. These files are interleaved with numeric prefixes in the screenshot folder, ready for video generation:

```
screenshots/create-file-demo/
  001-files-visible.png         # Shown for FRAME_DURATION (2s)
  002-narration.txt             # Text → Kokoro TTS → WAV → audio segment
  003-about-to-click-create.png # Shown for FRAME_DURATION (2s)
  004-narration.txt             # Text → Kokoro TTS → WAV → audio segment
  005-create-dialog-open.png    # Shown for FRAME_DURATION (2s)
  006-narration.txt             # Text → Kokoro TTS → WAV → audio segment
  007-filename-entered.png      # Shown for FRAME_DURATION (2s)
  generated-wav/                # Cached WAV files from Kokoro TTS (auto-created)
    002-narration.wav
    004-narration.wav
    006-narration.wav
```

**Supported audio formats**:
- **`.txt`** — Plain text narration. Automatically converted to WAV via Kokoro TTS (local, offline, no cloud APIs). Generated WAV files are cached in a `generated-wav/` subfolder and reused on subsequent runs if the `.txt` source hasn't changed.
- **`.mp3`** — Pre-recorded audio clips (if you prefer to record your own narration).
- **`.wav`** — Pre-recorded lossless audio clips.

**Rules**:
- The first file (by sort order, intro included) **must** be a `.png` — audio needs a preceding image to display
- Use consistent-width numeric prefixes (e.g., 3-digit: `001`, `002`, `003`)
- Audio duration is detected automatically via `ffprobe`

#### Writing Narration Text Files

Narration `.txt` files are generated during Playwright test execution by the `writeNarration()` helper. They contain plain English text that Kokoro TTS will speak aloud:

```typescript
// In your test file
writeNarration(screenshotDir, step++, 
  'Welcome to MkBrowser. Here we can see our files displayed in a browsable list. ' +
  'Markdown files are rendered inline, and we can create, edit, and organize ' +
  'files right from this interface. Let\'s create a new file to see how it works.');
```

This generates a `.txt` file containing exactly that text.

Tips:
- Write conversationally — Kokoro TTS handles natural language well
- Keep each narration segment focused on what's visible in the preceding screenshot
- Punctuation affects pacing: periods create pauses, commas create brief pauses
- Kokoro uses misaki for pronunciation, so you can override how a word is spoken with `[word](/phonemes/)`, e.g. `[LaTeX](/lˈeɪtɛk/)`
- Generated WAV files are cached in `screenshots/<test-name>/generated-wav/` — delete this folder to force regeneration

## Technical Deep Dive

### CodeMirror Editor Handling

CodeMirror 6 creates a nested DOM structure, and the element that actually has focus (`.cm-content`) sits deep inside it:
```
div.rounded (container)
  └─ div (editorRef)
      └─ div.cm-editor (CodeMirror root)
          └─ div.cm-scroller
              └─ div.cm-content (actual editable area)
```

Highlighting the focused `.cm-content` would box only the text area, not the editor. So when `insertText` (or `showHighlightOverlay`) is called with no locator, the overlay targets the editor as a whole:

1. Find the `.cm-editor` element
2. Use its closest ancestor with the `.rounded` class (the outer container), or `.cm-editor` itself if there is none
3. Draw the overlay around that element's bounding box

```javascript
const cmEditor = document.querySelector('.cm-editor');
if (cmEditor) {
  target = cmEditor.parentElement?.closest('.rounded') ?? cmEditor;
} else {
  target = document.activeElement;
}
```

Because the highlight is a separate fixed-position overlay (see [Visual Indicators Library](#3-visual-indicators-library)), no styles are applied to the editor itself, and nothing has to fight Tailwind's classes or the editor's overflow clipping.

### Playwright Electron Integration

MkBrowser uses Playwright's Electron support via the `_electron` module, wrapped in the custom fixture in `tests/e2e/fixtures/electronApp.ts`:

```typescript
import { _electron as electron } from '@playwright/test';

const userDataDir = createSeededUserDataDir();   // throwaway config dir

const app = await electron.launch({
  args: [mainJsPath, `--user-data-dir=${userDataDir}`, testDataPath],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SANDBOX: '1',
    DISPLAY: process.env.DISPLAY || ':0',
  },
  timeout: 30000,
});

const mainWindow = await app.firstWindow();
```

**Key Characteristics**:
- `mainJsPath` is the packaged `.vite/build/main.js`, so run `npm run package` after any source change
- `testDataPath` is the checked-in `mkbrowser-test/` folder, passed as the folder to browse
- Each test gets a fresh user-data dir seeded from `tests/e2e/fixtures/seed-config.yaml` and `seed-tags.yaml`, so the user's real config is never touched
- The app opens a real, visible window on the local display (`DISPLAY`, default `:0`), so the tests need a graphical session
- Screenshots come from `page.screenshot()`, which captures the renderer's page directly rather than recording the screen. Playwright's built-in video recording is not used for the demo videos

## Usage Workflow

### Creating New Demo Videos

The complete workflow from test creation to video generation:

1. **Prerequisites** (one-time setup): set up KoCreator in `../kocreator` (see [KoCreator and Kokoro TTS](#kocreator-and-kokoro-tts-required-for-video-generation)).

2. **Create a demo spec file** in `tests/e2e/` named `<feature-name>-demo.spec.ts`, modeled on `create-file-demo.spec.ts`.

3. **Import the helpers** you use:
   ```typescript
   import { test, expect } from './fixtures/electronApp';
   import {
     takeScreenshot, writeNarration, insertText, demoClick, logScreenshotSummary,
     cleanupScreenshots, cleanupTestDataFiles, resetSettings,
   } from './helpers/mediaUtils';
   ```

4. **Structure your test** to generate screenshots and narration, following [Typical Test Structure](#typical-test-structure).

5. **Run the test using playwright-test.sh**:
   ```bash
   ./playwright-test.sh
   # Build app? → Y (needed after any source change)
   # Select option 3, then pick feature-name-demo from the numbered list
   # Generate video(s)? → y
   ```
   
   The script will:
   - Clean the old files out of `screenshots/feature-name-demo/`
   - Run the test, which writes numbered `.png` screenshots and `.txt` narration files
   - Build the video with KoCreator and open the `test-videos/` folder

6. **Or generate the video later**: rerun `./playwright-test.sh` and choose option 4 (build video from existing images/wavs), or run KoCreator directly:
   ```bash
   cd ../kocreator && source uv-env.sh
   uv run create-video.py ../mkbrowser feature-name-demo --no-intro
   ```
   
   KoCreator will:
   - Convert `.txt` files to `.wav` audio using Kokoro TTS
   - Cache generated audio in the `generated-wav/` subfolder
   - Create video segments from screenshots and audio
   - Concatenate them into the final MP4, and build the GIF

7. **Output location**: 
   - `test-videos/feature-name-demo.mp4` — Full video with audio narration
   - `test-videos/feature-name-demo.gif` — Animated GIF (images only, no audio)

### Typical File Structure After Test Run

```
screenshots/create-file-demo/
  001-files-visible.png
  002-narration.txt
  003-about-to-click-create.png
  004-narration.txt
  005-create-dialog-open.png
  006-narration.txt
  007-filename-entered.png
  ...
  generated-wav/              # Created during video generation
    002-narration.wav
    004-narration.wav
    006-narration.wav
    ...

test-videos/
  create-file-demo.mp4        # Main video output
  create-file-demo.gif        # Animated GIF output
```

KoCreator also creates `test-videos/create-file-demo-segments/` and `create-file-demo-palette.png` while it works, and deletes both when it finishes successfully.

### Customization Options

#### Adjust Frame Duration, Voice, or Quality
Edit the constants near the top of `../kocreator/create-video.py`:
```python
FRAME_DURATION = 3   # seconds per screenshot without audio (default 2)
KOKORO_VOICE = "am_liam"
```
The `-crf 18` / `-preset slow` encoder settings are in the same file. Every segment must be encoded with identical settings, so change them in that one place only.

#### Include the Intro Splash
`screenshots/intro/` holds a shared splash (an image plus its narration) that KoCreator prepends to the MP4 of any demo. `playwright-test.sh` always passes `--no-intro`; to include the splash, run KoCreator by hand without that flag:
```bash
cd ../kocreator && source uv-env.sh
uv run create-video.py ../mkbrowser create-file-demo
```

#### Adjust Text Insertion
Use `insertText()` for standard demo text insertion:
```typescript
// Insert at the cursor of the currently focused element
await insertText(mainWindow, 'text to insert', true);

// Focus a specific element, select all, then insert (replacing its content)
await insertText(mainWindow, 'text to insert', true, inputLocator);
```

## File Structure

```
mkbrowser/
├── tests/
│   └── e2e/
│       ├── fixtures/
│       │   ├── electronApp.ts           # Playwright Electron fixtures (launch, mainWindow, testDataPath)
│       │   ├── seed-config.yaml         # Seed config.yaml for each test's throwaway user-data dir
│       │   └── seed-tags.yaml           # Seed tags.yaml for the same
│       ├── helpers/
│       │   ├── visual-indicators.ts     # Highlight overlay functions
│       │   └── mediaUtils.ts            # Screenshot, narration, lifecycle & interaction helpers
│       ├── global-setup.ts              # Builds the app if no build exists; copies resources/
│       ├── *-demo.spec.ts               # Demo tests (videos are generated from these)
│       └── private-*.spec.ts            # Verification tests (no videos)
├── mkbrowser-test/                      # Checked-in folder the e2e tests browse
├── screenshots/                         # Generated media (gitignored)
│   ├── intro/                           # Shared intro splash (used only without --no-intro)
│   └── create-file-demo/
│       ├── 001-files-visible.png        # Screenshot
│       ├── 002-narration.txt            # Narration text (converted via Kokoro TTS)
│       ├── 003-about-to-click-create.png
│       ├── 004-narration.txt
│       ├── ...
│       └── generated-wav/               # Cached WAV files from TTS (auto-created)
│           ├── 002-narration.wav
│           ├── 004-narration.wav
│           └── ...
├── test-videos/                         # Generated videos (gitignored)
│   ├── create-file-demo.mp4             # Video with audio
│   └── create-file-demo.gif             # Images only (no audio)
├── playwright.config.ts                 # Playwright config (single worker, HTML reporter)
└── playwright-test.sh                   # Test runner with video generation

kocreator/                               # Sibling project (separate repository)
├── create-video.py                      # Builds the MP4 and GIF
├── kokoro-txt-to-wav.py                 # Standalone single-file text-to-WAV utility
├── setup.sh                             # One-time setup (espeak-ng, ffmpeg, Python deps)
├── uv-env.sh                            # Selects the per-machine venv (.venv-<hostname>)
├── pyproject.toml / uv.lock             # Pinned Python dependencies
└── README.md                            # Full KoCreator documentation
```

## Dependencies

### NPM Packages
- `@playwright/test`: Test framework and Electron automation
- `electron`: Required by Playwright for Electron testing

### System Packages
- `ffmpeg`: Video encoding, segment creation, and concatenation
- `ffprobe`: Audio duration and segment checks (ships with ffmpeg)
- `espeak-ng`: Used by Kokoro's phonemizer for words it doesn't know

`./install-prerequisites.sh` installs `ffmpeg` (along with the app's other system prerequisites), and KoCreator's `setup.sh` installs both `ffmpeg` and `espeak-ng`.

### KoCreator and Kokoro TTS (Required for Video Generation)
- **Location**: `../kocreator` (a sibling folder to the mkbrowser project)
- **Runtime**: a [uv](https://docs.astral.sh/uv/) Python project (Python 3.12) using the `kokoro` package from hexgrad (Apache 2.0). It runs offline on the CPU after setup.
- **Virtualenv**: per machine, `.venv-<hostname>/`, selected by sourcing `uv-env.sh`. This lets a host and a VM share the folder without breaking each other's venv. `playwright-test.sh` sources it for you.
- **Voice**: `am_liam` (set by `KOKORO_VOICE` in `create-video.py`)

One-time setup:
```bash
# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh

cd ../kocreator
./setup.sh   # installs espeak-ng + ffmpeg, syncs Python deps from uv.lock, downloads the Kokoro model, runs a smoke test
```

The first run of `setup.sh` needs internet access to download the Kokoro model and voices (cached under `~/.cache/huggingface/`). After that, `create-video.py` runs with `HF_HUB_OFFLINE=1` and never contacts the internet.

## Best Practices

### 1. Use Media Utility Helpers
- Always use `takeScreenshot()` and `writeNarration()` from `mediaUtils.ts` for consistent file naming
- Pass a locator to `takeScreenshot()` for screenshots that should highlight an element
- Use `insertText()` and `demoClick()` for proper demo timing
- These helpers handle 3-digit numbering automatically via the `step` counter

### 2. Screenshot and Narration Pairing
- Generate narration immediately after each relevant screenshot
- Use odd step numbers for screenshots, even for narration (e.g., 001, 002, 003, 004...)
- Keep narration focused on what's visible in the preceding screenshot
- Each narration should explain what the user sees or what action is about to happen

### 3. File Naming
- Screenshot filenames are auto-generated but should use descriptive suffixes
- Good: `003-about-to-click-create.png` 
- Bad: `03-click.png`
- The helper functions handle the numeric prefix automatically

### 4. Visual Indicator Placement
- Take the highlighted screenshot BEFORE the click, to draw attention to what will be clicked
- Take one right after typing, with the input or editor as the locator, to show where the text went
- Passing a locator to `takeScreenshot()` guarantees the highlight is in the image and removed afterwards

### 5. Test Independence
- Demo tests are separate from verification tests: demos end with `-demo.spec.ts`, verification tests start with `private-`
- `playwright-test.sh` generates videos only for non-private specs
- Every test starts with `cleanupScreenshots`, `cleanupTestDataFiles`, and `resetSettings` (see `playwright.md`)
- Include artificial delays where needed for better visual clarity

### 6. Video Length
- Keep videos under 60 seconds when possible
- Break complex workflows into multiple shorter videos
- Each video should demonstrate one clear feature or workflow

## Troubleshooting

### Screenshots Are Empty/Black
- **Cause**: Window not fully rendered before screenshot
- **Solution**: Add `await mainWindow.waitForTimeout(2000)` before the first screenshot, and assert a known item is visible

### Visual Indicators Not Visible
- **Cause**: The highlighted element is hidden (e.g. a hover-revealed button at opacity 0, or a view hidden with `display: none`) — the overlay removes itself as soon as its target isn't visible
- **Solution**: Make sure the element is really showing first; for entry action-bar buttons, `hover()` and wait `ACTION_BAR_FADE_MS` before the screenshot (see `playwright.md`)

### Screenshots Have Different Sizes
- **Cause**: The window size changed during the test, or an external image was added
- **Solution**: Nothing is required — KoCreator letterboxes every frame onto one canvas and prints a notice naming the sizes it found. For the best result, keep the window size constant

### FFmpeg Not Found
- **Cause**: System package not installed
- **Solution**: Run `../kocreator/setup.sh`, `./install-prerequisites.sh`, or `sudo apt-get install ffmpeg`

### Video Generation Is Skipped
- **Symptoms**: `playwright-test.sh` prints "kocreator not found at … — skipping video generation." or "uv not found in PATH (kocreator requires it) — skipping video generation."
- **Solution**: Check out KoCreator into `../kocreator`, install uv, and run `../kocreator/setup.sh`
- If `create-video.py` itself reports that the `kokoro` package is not installed, the venv for this machine hasn't been built: run `source uv-env.sh && uv sync --locked` in `../kocreator` (or rerun `setup.sh`)

### Generated Audio Sounds Wrong
- **Cause**: Cached WAV file is stale or corrupted, or a word is mispronounced
- **Solution**: Delete the `generated-wav/` folder to force regeneration, then rebuild the video (option 4 in `playwright-test.sh`). For mispronounced words, add a phonetic override (`[word](/phonemes/)`) to the narration:
  ```bash
  rm -rf screenshots/<test-name>/generated-wav
  ```

## Future Enhancements

### Potential Improvements
1. ✓ **AI text-to-speech narration**: **Implemented!** — Kokoro TTS converts `.txt` narration files to speech automatically
2. ✓ **Shared intro splash**: **Implemented!** — KoCreator prepends `screenshots/intro/` unless `--no-intro` is passed
3. **Animated transitions**: Add fade/slide effects between screenshots
4. **Zoomed details**: Highlight small UI elements with zoom-in effect
5. **Keyboard visualization**: Show keypresses as overlays
6. **Mouse trail**: Show cursor movement path between clicks
7. **Split-screen**: Show before/after side-by-side
8. **Real-time recording**: Explore alternative Electron screen capture methods

### Alternative Approaches Considered
- **OBS Studio automation**: Too complex to automate reliably
- **Puppeteer video recording**: Doesn't support Electron
- **Electron's native screenshot API**: Still requires stitching
- **Live screen recording of the test run**: Captures every transition and timing hiccup; stills plus narration give precise control over what the viewer sees

## Conclusion

The screenshot-based approach with integrated narration generation provides a reliable, maintainable solution for creating user documentation videos. The workflow is fully integrated:

1. **Test execution**: Playwright tests generate both screenshots and narration text files
2. **Test runner**: `playwright-test.sh` builds the app, runs the tests, and generates the videos in one unattended pass
3. **Video generation**: KoCreator's `create-video.py` converts text to speech via Kokoro TTS and produces the final MP4 and GIF

**Key Benefits**:
- **Precise control**: Capture exactly what you want with helper utilities
- **Consistency**: Reproducible results every time
- **Quality**: Browser-compatible MP4s with natural-sounding narration
- **Flexibility**: Easy to adjust timing, visual indicators, and narration
- **Integrated workflow**: One script runs the tests and generates the videos
