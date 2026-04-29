# Playwright E2E Tests

## Overview
This is the pattern for writing Playwright E2E tests that capture screenshots and narration for GIF/MP4 generation.

<!-- TOC -->

* [Overview](#overview)
* [File Location and Naming](#file-location-and-naming)
* [Required Imports](#required-imports)
* [Test Boilerplate (Top of Each Test)](#test-boilerplate-top-of-each-test)
* [Step Counter Convention](#step-counter-convention)
* [Core Media Helpers](#core-media-helpers)
  * [`takeStepScreenshot` — plain screenshot](#takestepscreenshot--plain-screenshot)
  * [`takeStepScreenshotWithHighlight` — screenshot with element highlighted](#takestepscreenshotwithhighlight--screenshot-with-element-highlighted)
  * [`writeNarration` — write companion narration file](#writenarration--write-companion-narration-file)
  * [`demonstrateClickForDemo` — click with demo timing](#demonstrateclickfordemo--click-with-demo-timing)
  * [`insertTextForDemo` — type text into the focused element](#inserttextfordemo--type-text-into-the-focused-element)
  * [`logScreenshotSummary` — log counts at end of test](#logscreenshotsummary--log-counts-at-end-of-test)
* [Typical Step Sequence Pattern](#typical-step-sequence-pattern)
* [Narration Writing Guidelines](#narration-writing-guidelines)
* [Assertions](#assertions)
* [Complete Skeleton](#complete-skeleton)

<!-- /TOC -->

Demo tests follow a strict pattern: they walk through a user-visible workflow step by step, capturing screenshots at each step and writing companion narration text files. Downstream tooling assembles these into a GIF and an MP4 with audio narration. The goal is to create clear, engaging demo videos that show off features in a tutorial style. We also do use these tests for basic E2E verification, so they have dual purpose: video createion and automated testing.

You can look at the file named `create-file-demo.spec.ts` for a complete example of the pattern. Below are detailed instructions and guidelines for writing new tests in this style.

## File Location and Naming

Place test files in `tests/e2e/` and name them `<demo-name>.spec.ts`. The test name (derived from the filename via `path.basename(__filename, '.spec.ts')`) is used as the screenshot subdirectory under `screenshots/`.

## Required Imports

```typescript
import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary } from './helpers/mediaUtils';
import * as fs from 'fs';
import * as path from 'path';
```

## Test Boilerplate (Top of Each Test)

Every demo test begins with this exact setup block inside the `test(...)` callback:

```typescript
// Create subfolder based on test file name
const testName = path.basename(__filename, '.spec.ts');
const screenshotDir = path.join(__dirname, '../../screenshots', testName);

// Clean and recreate screenshot directory on each run
fs.rmSync(screenshotDir, { recursive: true, force: true });
fs.mkdirSync(screenshotDir, { recursive: true });

// Clean up any previously created test files to avoid conflicts
const testDataDir = path.join(__dirname, '../../mkbrowser-test');
for (const file of fs.readdirSync(testDataDir).filter(f => /^my-.*\.md$/.test(f))) {
  fs.unlinkSync(path.join(testDataDir, file));
}

let step = 1;

// Wait for initial load
await mainWindow.waitForTimeout(2000);
```

Adjust the cleanup filter regex (`/^my-.*\.md$/`) as needed for the specific test if it creates differently-named files.

## Step Counter Convention

Use a single `let step = 1` counter, always incremented with `step++` inline in every call. Screenshots and narration files interleave — a screenshot is typically followed immediately by its narration, both consuming a step number:

```typescript
await takeStepScreenshot(mainWindow, screenshotDir, step++, 'descriptive-label');
writeNarration(screenshotDir, step++, 'Spoken narration for this moment in the demo.');
```

The output filenames are zero-padded to three digits (e.g. `001-files-visible.png`, `002-narration.txt`), so downstream tooling can sort them correctly.

## Core Media Helpers

All helpers are in `tests/e2e/helpers/mediaUtils.ts`.

### `takeStepScreenshot` — plain screenshot
```typescript
await takeStepScreenshot(mainWindow, screenshotDir, step++, 'label');
```
Use for general state captures: after navigation, after a save completes, etc.

### `takeStepScreenshotWithHighlight` — screenshot with element highlighted
```typescript
await takeStepScreenshotWithHighlight(mainWindow, locator, screenshotDir, step++, 'label');
```
Use just *before* clicking an element, or after typing into one, to draw the viewer's eye to it. Always take the highlight screenshot *before* `demonstrateClickForDemo` so the element is still visible without any transition state.

### `writeNarration` — write companion narration file
```typescript
writeNarration(screenshotDir, step++, 'Narration text that will be read aloud.');
```
`writeNarration` is synchronous. Write it immediately after the screenshot it accompanies. The narration should clearly describe what is visible on screen and what is about to happen next, in plain conversational language suitable for text-to-speech.

### `demonstrateClickForDemo` — click with demo timing
```typescript
await demonstrateClickForDemo(locator);
```
Adds 300 ms before and 1 000 ms after the click so a screen recorder captures the state change clearly.

### `insertTextForDemo` — type text into the focused element
```typescript
// Into an explicit input:
await insertTextForDemo(mainWindow, 'filename-here', true, filenameInput);

// Into whatever has focus (e.g. a CodeMirror editor):
await insertTextForDemo(mainWindow, multiLineContent, true);
```
The third argument `showHighlight` should be `true` for demo tests. Pass an optional `focusTarget` locator when the element to type into is not already focused.

### `logScreenshotSummary` — log counts at end of test
```typescript
logScreenshotSummary(screenshotDir);
```
Always call this as the final statement of the test body.

## Typical Step Sequence Pattern

Every demo test follows this rhythm:

1. **Wait + verify** the initial state is ready, then screenshot + narration.
2. **Highlight the UI control** that is about to be activated → `takeStepScreenshotWithHighlight` + narration.
3. **Interact** → `demonstrateClickForDemo` or `insertTextForDemo`.
4. **Screenshot the result** → `takeStepScreenshot` + narration describing what changed.
5. Repeat for each meaningful action until the workflow is complete.
6. **Assert** that the final state is as expected (e.g. `expect(saveButton).not.toBeVisible()`).
7. Call `logScreenshotSummary`.

## Narration Writing Guidelines

- Write for text-to-speech — no Markdown, no code blocks, complete sentences.
- Describe what is currently visible, then explain what is about to happen.
- Keep each narration to 1–4 sentences.
- Use phonetic pronunciation guides in square brackets for technical terms that TTS mispronounces, e.g. `[LaTeX](/lˈeɪtɛk/)`.
- Tone: friendly, tutorial-style, present tense.

## Assertions

Include lightweight `expect` assertions at key moments to guard against the demo silently failing:

```typescript
// Verify the app is ready before starting
await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });

// Verify the final action completed
await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
```

## Complete Skeleton

```typescript
import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary } from './helpers/mediaUtils';
import * as fs from 'fs';
import * as path from 'path';

test.describe('My Feature Demo', () => {
  test('demonstrate my feature', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });

    const testDataDir = path.join(__dirname, '../../mkbrowser-test');
    for (const file of fs.readdirSync(testDataDir).filter(f => /^my-.*\.md$/.test(f))) {
      fs.unlinkSync(path.join(testDataDir, file));
    }

    let step = 1;
    await mainWindow.waitForTimeout(2000);

    // Verify initial state
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
    writeNarration(screenshotDir, step++, 'Welcome to MkBrowser. Today we will demonstrate...');

    // --- workflow steps here ---

    logScreenshotSummary(screenshotDir);
  });
});
```

