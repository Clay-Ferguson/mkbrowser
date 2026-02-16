# Screen Recording System for User Documentation

## Overview

This document describes the screenshot-based video recording system used to create user guide videos and documentation for MkBrowser. The system uses Playwright to capture screenshots at key interaction points during automated tests, then combines them into video files using FFmpeg.

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

## System Components

### 1. Visual Indicators Library
**Location**: `tests/e2e/helpers/visual-indicators.ts`

Provides visual cues that show where user interactions occur in screenshots:

#### Functions:

**`highlightElement(page, locator, duration)`**
- Adds thick, highly visible red glowing border around an element
- Used to draw attention to clickable elements
- Border: 6px solid with 3px offset and intense double box-shadow
- Duration: How long the highlight persists (default: 800ms)
- Returns after 100ms, leaving highlight visible for screenshots

**`demonstrateClick(page, locator, options)`**
- All-in-one function for demonstrating clicks
- Combines: highlight → pause → click
- Options: `pauseBefore`, `pauseAfter`

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

### 2. Demo Test Specs
**Location**: `tests/e2e/open-folder-demo-enhanced.spec.ts`

Example structure:
```typescript
test('complete workflow with visual indicators', async ({ mainWindow }) => {
  const screenshotDir = path.join(__dirname, '../../screenshots');
  let step = 1;

  const screenshot = async (name: string) => {
    await mainWindow.screenshot({
      path: path.join(screenshotDir, `${String(step).padStart(3, '0')}-${name}.png`)
    });
    step++;
  };

  // 1. Capture initial state
  await screenshot('01-initial-view');

  // 2. Demonstrate button click
  await highlightElement(mainWindow, createButton);
  await screenshot('02-about-to-click');
  await demonstrateClick(mainWindow, createButton);
  await screenshot('03-after-click');

  // 3. Demonstrate typing
  await demonstrateTyping(mainWindow, 'text', { highlightDuration: 8000 });
  await screenshot('04-content-typed');
});
```

**Key Points**:
- Screenshots are numbered sequentially (001-, 002-, 003-...)
- Numbering ensures correct ordering when FFmpeg processes them
- Visual indicators are applied BEFORE screenshots to capture them
- Timing is critical: highlights must persist long enough for screenshots

### 3. Video Creation Script
**Location**: `create-video-from-screenshots.sh`

Bash script that converts screenshots to video using FFmpeg:

```bash
ffmpeg -y \
    -framerate "1/$FRAME_DURATION" \
    -pattern_type glob \
    -i "$SCREENSHOT_DIR/*.png" \
    -c:v libx264 \
    -preset slow \
    -crf 18 \
    -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" \
    -movflags +faststart \
    "$OUTPUT_FILE"
```

**Parameters**:
- `FRAME_DURATION`: Seconds per screenshot (default: 2)
- `preset slow`: Better compression, slower encoding
- `crf 18`: High quality (lower = better, range: 0-51)
- `yuv420p`: Color format for broad compatibility
- `faststart`: Optimize for web streaming

**Output**: `test-videos/user-guide-TIMESTAMP.mp4`

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

1. **Create a demo spec file** in `tests/e2e/`:
   ```bash
   tests/e2e/feature-name-demo.spec.ts
   ```

2. **Import visual indicators**:
   ```typescript
   import { demonstrateClick, demonstrateTyping } from './helpers/visual-indicators';
   ```

3. **Structure your test with screenshots**:
   - Show initial state
   - Before each interaction: highlight + show cursor
   - Take screenshot showing "about to interact"
   - Perform interaction
   - Take screenshot showing result
   - Keep highlights visible long enough for screenshots

4. **Run the test**:
   ```bash
   npm run test:e2e -- feature-name-demo.spec.ts
   ```

5. **Create the video**:
   ```bash
   ./create-video-from-screenshots.sh
   ```

6. **Output location**: `test-videos/user-guide-TIMESTAMP.mp4`

### Customization Options

#### Adjust Frame Duration (Slower/Faster Video)
Edit `create-video-from-screenshots.sh`:
```bash
FRAME_DURATION=3  # 3 seconds per screenshot (slower)
FRAME_DURATION=1  # 1 second per screenshot (faster)
```

#### Adjust Video Quality
Edit the FFmpeg command:
```bash
-crf 15  # Higher quality, larger file
-crf 23  # Lower quality, smaller file
```

#### Adjust Visual Indicator Appearance
Edit `tests/e2e/helpers/visual-indicators.ts`:
```javascript
// Change color from red to blue
element.style.setProperty('border', '4px solid #4444ff', 'important');

// Change glow intensity
element.style.setProperty('box-shadow', '0 0 40px rgba(68, 68, 255, 1.0)', 'important');

// Change cursor emoji
cursor.innerHTML = '☝️';  // Different pointer
cursor.innerHTML = '🖱️';  // Mouse icon
```

#### Adjust Highlight Duration
```typescript
await demonstrateTyping(page, 'text', {
  highlightDuration: 10000,  // 10 seconds
  typingDelay: 200,          // Slower typing
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
│       │   └── visual-indicators.ts     # Visual indicator library
│       ├── open-folder.spec.ts          # Regular test (no recording)
│       └── open-folder-demo-enhanced.spec.ts  # Demo with visual indicators
├── screenshots/                         # Generated screenshots (gitignored)
│   ├── 001-step-name.png
│   ├── 002-step-name.png
│   └── ...
├── test-videos/                         # Generated videos (gitignored)
│   └── user-guide-TIMESTAMP.mp4
├── create-video-from-screenshots.sh    # FFmpeg conversion script
└── SCREEN_RECORDINGS.md                # This document
```

## Dependencies

### NPM Packages
- `@playwright/test`: Test framework and Electron automation
- `electron`: Required by Playwright for Electron testing

### System Packages
- `ffmpeg`: Video encoding and screenshot stitching
- `xdotool`: Used in initial attempts but not required for current system

Install via:
```bash
./install-prerequisites.sh  # Installs both NPM and system dependencies
```

## Best Practices

### 1. Timing is Everything
- Ensure highlights persist long enough for screenshots
- Use `highlightDuration` parameter to control how long highlights stay visible
- Default durations are tuned for typical interactions, but adjust as needed

### 2. Screenshot Naming
- Use descriptive names: `03-about-to-click-create` not `03-click`
- Include step numbers to maintain order
- Format: `###-description.png` (three digits for up to 999 steps)

### 3. Visual Indicator Placement
- Show cursor BEFORE clicking
- Keep highlights visible DURING and AFTER actions
- For typing, show highlight during the entire typing sequence

### 4. Test Independence
- Demo tests should be separate from functional tests
- Use descriptive test names: "User Guide Demo" not "Test Feature"
- Demo tests may include artificial delays for better visuals

### 5. Video Length
- Keep videos under 30 seconds when possible
- Break complex workflows into multiple shorter videos
- Each video should demonstrate one clear feature

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

## Future Enhancements

### Potential Improvements
1. **Add audio narration**: Generate text-to-speech and combine with video
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

The screenshot-based approach provides a reliable, maintainable solution for creating user documentation videos. While not true "live recording," it offers several advantages:

- **Precise control**: Capture exactly what you want
- **Consistency**: Reproducible results every time
- **Quality**: High-quality output with no frame drops
- **Flexibility**: Easy to adjust timing and visual indicators
- **CI/CD friendly**: Can run in headless environments

The system successfully works around Playwright's Electron window isolation limitations while providing all the features needed for professional documentation videos.
