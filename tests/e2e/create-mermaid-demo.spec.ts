import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateTypingForDemo, demonstrateClickForDemo, insertTextForDemo } from './helpers/mediaUtils';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test - Mermaid Diagram Rendering
 * 
 * This test demonstrates MkBrowser's automatic Mermaid diagram rendering capability.
 * Creates a file with a software architecture diagram and shows how it's rendered
 * automatically when the file is saved.
 * 
 * This is the third video in the tutorial series, building on the basic
 * file creation workflow and LaTeX rendering from previous demos.
 *
 * Run with: npm run test:e2e -- create-mermaid-demo.spec.ts
 * Then convert to video with: ./create-video-from-screenshots.sh create-mermaid-demo
 */
test.describe('Create Mermaid Demo', () => {
  test('demonstrate Mermaid diagram rendering', async ({ mainWindow }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    // Clean and recreate screenshot directory on each run
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });

    // Clean up any previously created test file to avoid conflicts
    const testFilePath = path.join(__dirname, '../../test-data/mkbrowser-test/my-architecture-diagram.md');
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify files are visible
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
    writeNarration(screenshotDir, step++, 'Welcome back to MkBrowser. In this demo, we\'ll explore another powerful feature: automatic Mermaid diagram rendering. Mermaid lets you create professional diagrams using simple text-based syntax. Let\'s create a software architecture diagram to see this in action.');

    // Click the create file button
    const createButton = mainWindow.getByTestId('create-file-button');
    await takeStepScreenshotWithHighlight(mainWindow, createButton, screenshotDir, step++, 'about-to-click-create');
    writeNarration(screenshotDir, step++, 'We\'ll start by creating a new file for our architecture diagram.');

    await demonstrateClickForDemo(createButton);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'create-dialog-open');
    writeNarration(screenshotDir, step++, 'The Create File dialog opens. Let\'s give our file a descriptive name that reflects its content.');

    // Type the filename
    const filenameInput = mainWindow.getByTestId('create-file-dialog-input');
    await demonstrateTypingForDemo(mainWindow, 'my-architecture-diagram', true, filenameInput, 120);

    await takeStepScreenshotWithHighlight(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');
    writeNarration(screenshotDir, step++, 'We\'ve named it "my-architecture-diagram". Now let\'s create the file and add our diagram content.');

    // Click Create button in dialog
    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await takeStepScreenshotWithHighlight(mainWindow, createDialogButton, screenshotDir, step++, 'about-to-create-file');
    writeNarration(screenshotDir, step++, 'Clicking Create to open our new file.');

    await demonstrateClickForDemo(createDialogButton);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'new-file-created');
    writeNarration(screenshotDir, step++, 'Perfect! Our file is created and the editor is ready. Now let\'s add a Mermaid diagram. We\'ll create a diagram showing a modern web application architecture with multiple interconnected components.');

    // Type the Mermaid diagram content with explanation
    const mermaidContent = `A modern web application typically has several interconnected components:

\`\`\`mermaid
graph TB
    Client[Web Browser]
    FE[Frontend<br/>React App]
    API[Backend API<br/>Node.js/Express]
    Cache[(Redis Cache)]
    DB[(PostgreSQL<br/>Database)]
    Queue[Message Queue<br/>RabbitMQ]
    Worker[Background Worker]
    
    Client -->|HTTPS| FE
    FE -->|REST API| API
    API -->|Query Cache| Cache
    API -->|Read/Write| DB
    API -->|Publish Jobs| Queue
    Queue -->|Process| Worker
    Worker -->|Update| DB
    
    style FE fill:#61dafb
    style API fill:#339933
    style DB fill:#336791
    style Cache fill:#dc382d
\`\`\``;

    await insertTextForDemo(mainWindow, mermaidContent, true);

    // Take screenshot with the content typed
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await takeStepScreenshotWithHighlight(mainWindow, cmEditor, screenshotDir, step++, 'diagram-typed');
    writeNarration(screenshotDir, step++, 'We\'ve entered our diagram description and the Mermaid code. Notice the code is surrounded by triple backticks with "mermaid" as the language identifier — this tells MkBrowser to render it as a diagram. The code itself uses simple text syntax: nodes in brackets, arrows for connections, and optional styling. It\'s much easier than drawing diagrams manually! Now watch what happens when we save.');

    // Click Save button
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await takeStepScreenshotWithHighlight(mainWindow, saveButton, screenshotDir, step++, 'about-to-save');
    writeNarration(screenshotDir, step++, 'Let\'s save the file and see the Mermaid magic happen.');

    await demonstrateClickForDemo(saveButton);

    // Wait a moment for the rendering to complete
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'diagram-rendered');
    writeNarration(screenshotDir, step++, 'Incredible! The simple text code has been transformed into a beautiful, professional diagram. You can see all the components of our web application — the browser, frontend React app, backend API, database, cache, message queue, and background worker — all connected with labeled arrows showing how data flows through the system. The color-coded components make it even easier to understand. This makes MkBrowser perfect for documenting system architectures, planning new features, or explaining technical designs to your team. No special diagram tools needed — just write your Mermaid code and MkBrowser handles the rest.');

    // Verify save completed
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });

    const files = fs.readdirSync(screenshotDir);
    const pngCount = files.filter(f => f.endsWith('.png')).length;
    const txtCount = files.filter(f => f.endsWith('.txt')).length;
    console.log(`\n✓ Created ${pngCount} screenshots and ${txtCount} narration files in ${screenshotDir}`);
    console.log('Run ./create-video-from-screenshots.sh create-mermaid-demo to create video');
  });
});
