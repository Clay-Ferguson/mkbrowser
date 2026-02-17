# Screen Recording System for User Documentation 

## Overview

This document describes the screenshot-based video recording system used to create user guide videos and documentation for MkBrowser. The system uses Playwright E2E tests to generate both screenshots and narration text files at key interaction points during automated test workflows, then combines them into video files using FFmpeg and Kokoro TTS for text-to-speech narration.

## How The System Works

The video creation system is an integrated workflow that connects three main components:

### 1. Test Execution → Media Generation
Playwright E2E tests (like [create-file-demo.spec.ts](tests/e2e/create-file-demo.spec.ts)) automatically generate:
- **Screenshots** (`.png` files) — Captured at key interaction points using `takeStepScreenshot()` or `takeStepScreenshotWithHighlight()`
- **Narration text files** (`.txt` files) — Written immediately after screenshots using `writeNarration()`

Both are saved to `screenshots/<test-name>/` with sequential 3-digit numbering (001, 002, 003...).

### 2. Test Runner → User Workflow
[`playwright-test.sh`](playwright-test.sh) manages the complete workflow:
- Offers to run all tests or a specific demo test
- Cleans old screenshots when running specific tests
- Executes the Playwright test
- After successful completion, prompts: "Generate video from screenshots? [y/N]"
- If answered 'y', automatically invokes the video generation script

### 3. Video Generation → Final Output
[`create-video-from-screenshots.sh`](create-video-from-screenshots.sh) converts test output to videos:
- Scans the screenshot folder for `.png` and `.txt` files
- Validates that Kokoro TTS is available (located in sibling `../kocreator` folder)
- Converts `.txt` narration files to `.wav` audio using Kokoro TTS (cached in `generated-wav/` subfolder)
- Creates video segments combining screenshots with audio narration
- Concatenates segments into final `.mp4` (with audio) and `.gif` (images only) files
- Outputs to `test-videos/` directory

**Complete workflow example**:
```bash
./playwright-test.sh
# → Select option 2 (specific test)
# → Test generates: screenshots/create-file-demo/*.png and *.txt files
# → Prompt: "Generate video from screenshots? [y/N]" → y
# → Creates: test-videos/create-file-demo.mp4 and create-file-demo.gif
```

### Prerequisites
- **Kokoro TTS**: Must be cloned and set up in a sibling folder (`../kocreator`) before running demo tests
- **One-time setup**:
  ```bash
  cd ~/ferguson/projects  # Or wherever your mkbrowser folder is
  git clone https://github.com/hexgrad/kokoro kokoro
  cd kokoro
  ./setup-kokoro.sh  # Install Kokoro TTS engine and voice models
  ```

## Architecture Decision

### Why Screenshot-Based Instead of Live Recording?

**Problem**: When Playwright launches Electron applications via `_electron.launch()`, the windows are controlled internally and not exposed to the X11 window system. This means external screen capture tools like `xdotool` and `ffmpeg` cannot detect or record these windows.

**Attempted Solutions**:
- Using `xvfb-run` for virtual display: ❌ Windows still not visible to external tools
- Using `xdotool` to find window by title: ❌ Playwright-controlled windows not in X11 window list
- Playwright's built-in video recording: ❌ Only works for browser contexts, not Electron apps

**Solution**: Capture screenshots at specific points during test execution, then stitch them together into videos using FFmpeg. This approach:
- ✅ Works reliably with Playwright + Electron
- ✅ Provides precise control over what gets captured
- ✅ Allows custom visual indicators to show user interactions
- ✅ Produces high-quality output suitable for documentation

## Quick Reference

### Essential Helper Functions (from `mediaUtils.ts`)

```typescript
// Screenshot without highlight
await takeStepScreenshot(mainWindow, screenshotDir, step++, 'description');

// Screenshot with highlight on a specific element
await takeStepScreenshotWithHighlight(mainWindow, buttonLocator, screenshotDir, step++, 'description');

// Write narration text (converted to speech during video generation)
writeNarration(screenshotDir, step++, 'Narration text explaining what the user sees...');

// Demonstrate typing with highlight
await demonstrateTypingForDemo(mainWindow, 'text to type', true, inputLocator);

// Demonstrate clicking with proper timing
await demonstrateClickForDemo(buttonLocator);
```

### Typical Test Structure

```typescript
test('feature demo', async ({ mainWindow }) => {
  const testName = path.basename(__filename, '.spec.ts');
  const screenshotDir = path.join(__dirname, '../../screenshots', testName);
  fs.rmSync(screenshotDir, { recursive: true, force: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  
  let step = 1;
  
  // 1. Show initial state
  await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
  writeNarration(screenshotDir, step++, 'Describe what user sees...');
  
  // 2. Highlight element before interaction
  await takeStepScreenshotWithHighlight(mainWindow, button, screenshotDir, step++, 'about-to-click');
  writeNarration(screenshotDir, step++, 'Explain what will happen...');
  
  // 3. Perform action
  await demonstrateClickForDemo(button);
  
  // 4. Show result
  await takeStepScreenshot(mainWindow, screenshotDir, step++, 'result');
  writeNarration(screenshotDir, step++, 'Describe the result...');
});
```

## System Components

### 1. Playwright Test Runner Script
**Location**: `playwright-test.sh`

A bash script that orchestrates the entire testing and video creation workflow:

#### Features:
- **Interactive menu**: Choose between running all tests or a specific test
- **Screenshot cleanup**: Automatically cleans old screenshots when running specific tests
- **Test execution**: Runs Playwright E2E tests via npm or npx
- **Video generation prompt**: After successful test runs, offers to automatically generate videos from captured screenshots and narration
- **Report viewing**: Opens the Playwright HTML test report for review

#### Usage:
```bash
./playwright-test.sh

# Select option 2 to run create-file-demo.spec.ts
# Test will generate screenshots + narration files
# Script will prompt: "Generate video from screenshots? [y/N]"
# Answering 'y' automatically runs create-video-from-screenshots.sh
```

### 2. Media Utilities Library
**Location**: `tests/e2e/helpers/mediaUtils.ts`

Provides standardized functions for capturing screenshots and writing narration files during test execution:

#### Functions:

**`takeStepScreenshot(mainWindow, screenshotDir, step, filenameSuffix)`**
- Captures a screenshot with standardized 3-digit numbering
- Example: `await takeStepScreenshot(mainWindow, screenshotDir, step++, 'files-visible')`
- Generates: `001-files-visible.png`

**`writeNarration(screenshotDir, step, narrationText)`**
- Writes narration text file with matching step number
- Example: `writeNarration(screenshotDir, step++, 'Welcome to MkBrowser...')`
- Generates: `002-narration.txt`
- Text files are later converted to audio by Kokoro TTS

**`takeStepScreenshotWithHighlight(mainWindow, locator, screenshotDir, step, filenameSuffix)`**
- Captures screenshot with visual highlight applied to specified element
- Uses atomic highlight application to guarantee visibility in captured image
- Example: `await takeStepScreenshotWithHighlight(mainWindow, createButton, screenshotDir, step++, 'about-to-click-create')`

**`demonstrateTypingForDemo(mainWindow, text, showHighlight, locator, typingDelay)`**
- Shows typing with visual highlight for demo clarity
- Default typing delay: 150ms per keystroke
- Highlight persists during typing for screenshots

**`demonstrateClickForDemo(locator)`**
- Demonstrates clicks with appropriate pauses for video recording
- Adds timing before/after clicks for visual clarity

### 3. Visual Indicators Library
**Location**: `tests/e2e/helpers/visual-indicators.ts`

Provides low-level visual cues that show where user interactions occur in screenshots:

#### Functions:

**`highlightElement(page, locator, duration)`**
- Adds thick, highly visible red glowing border around an element
- Used to draw attention to clickable elements
- Border: 6px solid with 3px offset and intense double box-shadow
- Duration: How long the highlight persists (default: 800ms)
- Returns after 100ms, leaving highlight visible for screenshots

**`demonstrateTyping(page, text, options)`**
- Highlights the focused input/editor where typing occurs
- Handles both native inputs and CodeMirror editors
- Options: `showHighlight`, `typingDelay`, `highlightDuration`
- Special handling for CodeMirror: Targets the container div with `.rounded` class for better visibility

#### Visual Style:
- **Color**: Red (#ff4444) for consistency across all indicators
- **Border**: 6px solid borders with 3px offset for maximum visibility
- **Glow**: Dual-layer box-shadow with rgba(255, 68, 68, 0.9) and 0.7 for intense glow effect
- **Animations**: CSS transitions and keyframe animations for smooth effects

#### Timing Behavior:
Visual indicator functions return quickly but leave indicators visible:
- Indicators are created with auto-removal via `setTimeout`
- Functions return after a short delay (100-200ms) for rendering
- Indicators persist for their full `duration` parameter
- This allows screenshots to capture indicators while they're still visible
- Example: `highlightElement(page, locator, 800)` returns after 100ms, but highlight stays for 800ms

### 4. Demo Test Specs
**Location**: `tests/e2e/create-file-demo.spec.ts`

Playwright E2E tests that generate both screenshots and narration files during execution:

**Example structure**:
```typescript
test('complete workflow with visual indicators', async ({ mainWindow }) => {
  const testName = path.basename(__filename, '.spec.ts');
  const screenshotDir = path.join(__dirname, '../../screenshots', testName);
  
  // Clean and recreate screenshot directory
  fs.rmSync(screenshotDir, { recursive: true, force: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  
  let step = 1;
  
  // Capture screenshot
  await takeStepScreenshot(mainWindow, screenshotDir, step++, 'files-visible');
  
  // Write narration immediately after related screenshot
  writeNarration(screenshotDir, step++, 'Welcome to MkBrowser...');
  
  // Highlight and capture element before interaction
  await takeStepScreenshotWithHighlight(mainWindow, createButton, screenshotDir, step++, 'about-to-click-create');
  writeNarration(screenshotDir, step++, 'We\'ll click the Create File button...');
  
  // Demonstrate actions with proper timing
  await demonstrateClickForDemo(createButton);
  await demonstrateTypingForDemo(mainWindow, 'my-journal-entry', true, filenameInput);
});
```

**Key Points**:
- Each test run generates BOTH screenshots (.png) AND narration text files (.txt)
- Screenshots and narration use sequential step numbers (odd for screenshots, even for narration works well)
- The test automatically creates/cleans the `screenshots/<test-name>/` directory
- Files are ready for video generation immediately after test completion
- Narration text files will be converted to speech by Kokoro TTS during video generation

### 5. Video Creation Script
**Location**: `create-video-from-screenshots.sh`

Bash script that converts the screenshots and narration text files (generated by Playwright tests) into video files. It supports interleaved `.png` screenshots and audio in several formats, all ordered by filename:

| Extension | Description |
|-----------|-------------|
| `.png`    | Screenshot image — displayed for `FRAME_DURATION` seconds |
| `.mp3`    | Pre-recorded audio — played while holding the most recent screenshot |
| `.wav`    | Pre-recorded audio (lossless) — same behavior as `.mp3` |
| `.txt`    | Narration text — converted to WAV audio via **Kokoro TTS**, then used like `.wav` |

**How it works**:
1. Scans the screenshot folder for `.png`, `.mp3`, `.wav`, and `.txt` files, sorted by filename
2. If any `.txt` files are found, validates that Kokoro TTS is available at `../kokoro` and converts each `.txt` to a `.wav` file (cached in a `generated-wav/` subfolder inside the screenshot directory)
3. Walks files in order, maintaining a "current image" reference
4. For each `.png`: creates a video segment showing the image for `FRAME_DURATION` seconds with silent audio
5. For each audio file (`.mp3`, `.wav`, or converted `.txt`): creates a video segment holding the most recent screenshot on screen while the audio plays (duration detected via `ffprobe`)
6. All segments are normalized to 44100 Hz stereo AAC audio for consistent concatenation
7. Concatenates segments into the final MP4 with `ffmpeg -f concat -c copy`
8. GIF is generated from images only (GIF format has no audio support)

**Parameters**:
- `FRAME_DURATION`: Seconds per screenshot (default: 2)
- `PIPER_TTS`: Path to the Piper `tts.sh` script (default: `../piper/tts.sh` relative to the script)
- `preset slow`: Better compression, slower encoding
- `crf 18`: High quality (lower = better, range: 0-51)
- `yuv420p`: Color format for broad compatibility
- `faststart`: Optimize for web streaming

**Output**: `test-videos/<subfolder-name>.mp4` and `test-videos/<subfolder-name>.gif`

#### Audio Narration

Playwright tests automatically generate both screenshots (.png) and narration text files (.txt) using the `writeNarration()` helper function. These files are interleaved with numeric prefixes in the screenshot folder, ready for video generation:

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
- The first file (by sort order) **must** be a `.png` — audio needs a preceding image to display
- Use consistent-width numeric prefixes (e.g., 3-digit: `001`, `002`, `003`)
- Audio duration is detected automatically via `ffprobe`
- All audio is normalized to 44100 Hz stereo during encoding for consistent concatenation

#### Kokoro TTS Setup

Kokoro TTS is a fast, local neural text-to-speech engine. The Kokoro project must be cloned into a sibling folder (`../kocreator` relative to the mkbrowser project root). 

**One-time setup**:

1. Clone the Kokoro repository as a sibling to the mkbrowser folder:
   ```bash
   cd ~/ferguson/projects  # Or wherever your mkbrowser folder is located
   git clone https://github.com/hexgrad/kokoro kokoro
   ```

2. Run the setup script to install Kokoro:
   ```bash
   cd kocreator
   ./setup-kokoro.sh    # Creates venv, installs kokoro-tts, downloads voice models
   ```

Once set up, the video creation script will automatically invoke Kokoro TTS when it encounters `.txt` narration files. No internet connection is required after the initial setup.

The `KOKORO_PROJECT_DIR` variable at the top of `create-video-from-screenshots.sh` controls the path to the Kokoro project directory (default: `../kocreator`). Override it if your Kokoro project is in a different location.

#### Writing Narration Text Files

Narration `.txt` files are automatically generated during Playwright test execution using the `writeNarration()` helper function. They contain plain English text that Kokoro TTS will speak aloud:

```typescript
// In your test file
writeNarration(screenshotDir, step++, 
  'Welcome to MkBrowser. Here we can see our files displayed in a browsable list. ' +
  'Markdown files are rendered inline, and we can create, edit, and organize ' +
  'files right from this interface. Let\'s create a new file to see how it works.');
```

This generates a `.txt` file that looks like:
```
Welcome to MkBrowser. Here we can see our files displayed in a browsable list.
Markdown files are rendered inline, and we can create, edit, and organize
files right from this interface. Let's create a new file to see how it works.
```

Tips:
- Write conversationally — Kokoro TTS handles natural language well
- Keep each narration segment focused on what's visible in the preceding screenshot
- Punctuation affects pacing: periods create pauses, commas create brief pauses
- Generated WAV files are cached in `screenshots/<test-name>/generated-wav/` — delete this folder to force regeneration

## Technical Deep Dive

### CodeMirror Editor Handling

CodeMirror 6 creates a complex nested DOM structure:
```
div.rounded (container)
  └─ div (editorRef)
      └─ div.cm-editor (CodeMirror root)
          └─ div.cm-scroller
              └─ div.cm-content (actual editable area)
```

**Challenge**: The `:focus` selector targets deeply nested elements, and applying styles to them doesn't create visible highlights due to parent overflow/clipping.

**Solution**:
1. Find `.cm-editor` element
2. Traverse up to parent with `.rounded` class (the outer container)
3. Apply border + box-shadow to the container
4. Use `!important` to override existing Tailwind styles

```javascript
const cmEditor = document.querySelector('.cm-editor');
if (cmEditor) {
  editorElement = cmEditor.parentElement?.closest('.rounded') as HTMLElement;
}

// Apply styles that override everything
editorElement.style.setProperty('border', '4px solid #ff4444', 'important');
editorElement.style.setProperty('box-shadow',
  '0 0 30px rgba(255, 68, 68, 0.8), inset 0 0 20px rgba(255, 68, 68, 0.2)',
  'important');
```

### Playwright Electron Integration

MkBrowser uses Playwright's Electron testing capabilities via the `_electron` module:

```typescript
import { _electron as electron } from '@playwright/test';

const app = await electron.launch({
  args: [mainJsPath, testDataPath],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SANDBOX: '1',
  },
});

const mainWindow = await app.firstWindow();
```

**Key Characteristics**:
- Electron app runs as a subprocess controlled by Playwright
- Windows are NOT exposed to the host OS window manager
- This is intentional for test isolation and cross-platform consistency
- Video recording APIs designed for browser contexts don't apply
- Screenshots via `page.screenshot()` work because they capture the render tree directly

## Usage Workflow

### Creating New Demo Videos

The complete workflow from test creation to video generation:

1. **Prerequisites** (one-time setup):
   ```bash
   # Clone Kokoro TTS as a sibling project
   cd ~/ferguson/projects  # Or wherever your mkbrowser folder is
   git clone https://github.com/hexgrad/kokoro kokoro
   cd kocreator
   ./setup-kokoro.sh    # Install Kokoro TTS engine
   ```

2. **Create a demo spec file** in `tests/e2e/`:
   ```bash
   # Create new test file
   touch tests/e2e/feature-name-demo.spec.ts
   ```

3. **Import media utilities**:
   ```typescript
   import { 
     takeStepScreenshot, 
     takeStepScreenshotWithHighlight,
     writeNarration,
     demonstrateTypingForDemo,
     demonstrateClickForDemo 
   } from './helpers/mediaUtils';
   ```

4. **Structure your test** to generate screenshots and narration:
   ```typescript
   test('demo workflow', async ({ mainWindow }) => {
     const testName = path.basename(__filename, '.spec.ts');
     const screenshotDir = path.join(__dirname, '../../screenshots', testName);
     
     // Clean and recreate screenshot directory
     fs.rmSync(screenshotDir, { recursive: true, force: true });
     fs.mkdirSync(screenshotDir, { recursive: true });
     
     let step = 1;
     
     // Capture initial state
     await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
     writeNarration(screenshotDir, step++, 'Welcome message describing what user sees...');
     
     // Highlight element before interaction
     await takeStepScreenshotWithHighlight(mainWindow, button, screenshotDir, step++, 'about-to-click');
     writeNarration(screenshotDir, step++, 'Explain what will happen when button is clicked...');
     
     // Perform action with demo timing
     await demonstrateClickForDemo(button);
     
     // Show result
     await takeStepScreenshot(mainWindow, screenshotDir, step++, 'after-click');
     writeNarration(screenshotDir, step++, 'Describe the result...');
   });
   ```

5. **Run the test using playwright-test.sh**:
   ```bash
   ./playwright-test.sh
   # Select option 2 for specific test
   # Enter test name: feature-name-demo
   ```
   
   The test will:
   - Clean the `screenshots/feature-name-demo/` directory
   - Generate numbered `.png` screenshots
   - Generate numbered `.txt` narration files
   - Display test results in HTML report

6. **Generate video** (prompted automatically):
   ```
   Generate video from screenshots? [y/N]: y
   ```
   
   Or run manually later:
   ```bash
   ./create-video-from-screenshots.sh feature-name-demo
   ```
   
   The script will:
   - Validate Kokoro TTS is available (if `.txt` files present)
   - Convert `.txt` files to `.wav` audio using Kokoro TTS
   - Cache generated audio in `generated-wav/` subfolder
   - Create video segments from screenshots and audio
   - Concatenate into final MP4 and GIF files

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
  create-file-demo-segments/  # Temporary (can be deleted)
```

### Customization Options

#### Adjust Frame Duration (Slower/Faster Video)
Edit `create-video-from-screenshots.sh`:
```bash
FRAME_DURATION=3  # 3 seconds per screenshot (slower)
FRAME_DURATION=1  # 1 second per screenshot (faster)
```

#### Adjust Video Quality
Edit the FFmpeg command in `create-video-from-screenshots.sh`:
```bash
-crf 15  # Higher quality, larger file
-crf 23  # Lower quality, smaller file
```

#### Adjust Typing Speed and Highlight Duration
Modify the parameters when calling `demonstrateTypingForDemo()`:
```typescript
await demonstrateTypingForDemo(
  mainWindow, 
  'text to type', 
  true,           // showHighlight
  inputLocator,   // optional locator
  200             // typingDelay in ms (default: 150)
);
```

Or use the low-level `demonstrateTyping()` for more control:
```typescript
await demonstrateTyping(mainWindow, 'text', {
  locator: inputElement,
  showHighlight: true,
  highlightDuration: 10000,  // 10 seconds
  typingDelay: 200,          // Slower typing
  pauseAfter: 1000,          // Pause after typing
});
```

## File Structure

```
mkbrowser/
├── tests/
│   └── e2e/
│       ├── fixtures/
│       │   └── electronApp.ts           # Playwright Electron setup
│       ├── helpers/
│       │   ├── visual-indicators.ts     # Low-level visual indicator functions
│       │   └── mediaUtils.ts            # Screenshot & narration helper functions
│       ├── open-folder.spec.ts          # Regular test (no recording)
│       └── create-file-demo.spec.ts     # Demo test with screenshots & narration
├── screenshots/                         # Generated media (gitignored)
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
├── playwright-test.sh                  # Test runner with video generation prompt
├── create-video-from-screenshots.sh    # FFmpeg conversion script
└── SCREEN_RECORDINGS.md                # This document

kocreator/                                  # Sibling project (separate repository)
├── setup-kokoro.sh                     # One-time installation script
├── .venv/                               # Python virtual environment
└── ... # Kokoro TTS engine files
```

## Dependencies

### NPM Packages
- `@playwright/test`: Test framework and Electron automation
- `electron`: Required by Playwright for Electron testing

### System Packages
- `ffmpeg`: Video encoding, segment creation, and concatenation
- `ffprobe`: Audio duration detection (ships with ffmpeg)

### Kokoro TTS (Required for `.txt` Narration)
- **Location**: `../kocreator` (sibling folder to the mkbrowser project)
- **Setup**: Clone from GitHub and run `./setup-kokoro.sh`
- **Repository**: https://github.com/hexgrad/kokoro
- **Voice model**: `bm_daniel` (default, downloaded during setup)
- **Runtime**: Python venv with `kokoro-tts` package (local, no internet needed after setup)

Install system dependencies via:
```bash
./install-prerequisites.sh  # Installs both NPM and system dependencies
```

Install Kokoro TTS (one-time):
```bash
cd ~/ferguson/projects  # Or wherever your mkbrowser folder is
git clone https://github.com/hexgrad/kokoro kokoro
cd kokoro
./setup-kocreator.sh
```

## Best Practices

### 1. Use Media Utility Helpers
- Always use `takeStepScreenshot()` and `writeNarration()` from `mediaUtils.ts` for consistent file naming
- Use `takeStepScreenshotWithHighlight()` for screenshots that need visual indicators
- Use `demonstrateTypingForDemo()` and `demonstrateClickForDemo()` for proper demo timing
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
- Show highlights BEFORE clicks to draw attention
- Keep highlights visible DURING typing
- Use `takeStepScreenshotWithHighlight()` to guarantee highlight visibility
- Default durations are tuned for typical interactions

### 5. Test Independence
- Demo tests should be separate from functional tests
- Demo test files should end with `-demo.spec.ts`
- Tests should clean and recreate the screenshot directory at the start
- Include artificial delays where needed for better visual clarity

### 6. Video Length
- Keep videos under 60 seconds when possible
- Break complex workflows into multiple shorter videos
- Each video should demonstrate one clear feature or workflow

## Troubleshooting

### Screenshots Are Empty/Black
- **Cause**: Window not fully rendered before screenshot
- **Solution**: Add `await page.waitForTimeout(1000)` before first screenshot

### Visual Indicators Not Visible
- **Cause**: Styles being overridden, or wrong element targeted
- **Solution**: Use browser DevTools to inspect element, adjust selectors in `visual-indicators.ts`

### Video Has Wrong Aspect Ratio
- **Cause**: Screenshots have different sizes
- **Solution**: FFmpeg scaling filter handles this, but ensure consistent window size

### Highlights Disappear Before Screenshot
- **Cause**: Duration too short
- **Solution**: Increase `highlightDuration` parameter

### FFmpeg Not Found
- **Cause**: System package not installed
- **Solution**: Run `./install-prerequisites.sh` or `sudo apt-get install ffmpeg`

### Kokoro TTS Not Found Error
- **Cause**: Kokoro TTS not installed in expected location (`../kokoro`)
- **Symptoms**: Video generation script fails with "Kokoro TTS not found" error
- **Solution**: 
  ```bash
  cd ~/ferguson/projects  # Or wherever your mkbrowser folder is
  git clone https://github.com/hexgrad/kokoro kokoro
  cd kocreator
  ./setup-kokoro.sh
  ```

### Generated Audio Sounds Wrong
- **Cause**: Cached WAV file is stale or corrupted
- **Solution**: Delete the `generated-wav/` folder to force regeneration:
  ```bash
  rm -rf screenshots/<test-name>/generated-wav
  ./create-video-from-screenshots.sh <test-name>
  ```

## Future Enhancements

### Potential Improvements
1. ✓ **AI text-to-speech narration**: **Implemented!** — Kokoro TTS converts `.txt` narration files to speech automatically
2. **Animated transitions**: Add fade/slide effects between screenshots
3. **Zoomed details**: Highlight small UI elements with zoom-in effect
4. **Keyboard visualization**: Show keypresses as overlays
5. **Mouse trail**: Show cursor movement path between clicks
6. **Split-screen**: Show before/after side-by-side
7. **Real-time recording**: Explore alternative Electron screen capture methods

### Alternative Approaches Considered
- **OBS Studio automation**: Too complex for CI/CD
- **Puppeteer video recording**: Doesn't support Electron
- **Electron's native screenshot API**: Still requires stitching
- **X11 screen recording with proper window detection**: Not feasible with Playwright's isolation

## Conclusion

The screenshot-based approach with integrated narration generation provides a reliable, maintainable solution for creating user documentation videos. The workflow is fully integrated:

1. **Test execution**: Playwright tests automatically generate both screenshots and narration text files
2. **Test runner**: `playwright-test.sh` offers to generate videos immediately after test completion
3. **Video generation**: `create-video-from-screenshots.sh` converts text to speech via Kokoro TTS and produces final videos

**Key Benefits**:
- **Precise control**: Capture exactly what you want with helper utilities
- **Consistency**: Reproducible results every time
- **Quality**: High-quality output with natural-sounding narration
- **Flexibility**: Easy to adjust timing, visual indicators, and narration
- **CI/CD friendly**: Can run in headless environments
- **Integrated workflow**: Single script runs test and generates video

The system successfully works around Playwright's Electron window isolation limitations while providing all the features needed for professional documentation videos with spoken narration.
