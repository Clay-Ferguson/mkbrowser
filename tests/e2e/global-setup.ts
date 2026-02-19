import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Copy the resources folder into .vite/build/ so that when Playwright launches
 * Electron directly (setting app.getAppPath() to .vite/build/), the main process
 * can still locate resource files like the PDF export script.
 * When running via electron-forge start, app.getAppPath() returns the project root
 * and resources/ is found there naturally — this only matters for the Playwright path.
 */
function copyResourcesToBuild() {
  const projectRoot = path.join(__dirname, '../../');
  const resourcesSrc = path.join(projectRoot, 'resources');
  const resourcesDest = path.join(projectRoot, '.vite/build/resources');
  if (fs.existsSync(resourcesSrc)) {
    fs.cpSync(resourcesSrc, resourcesDest, { recursive: true });
    console.log('Copied resources/ into .vite/build/resources/');
  }
}

/**
 * Global setup for Playwright tests.
 * Ensures the Vite dev build exists before running tests.
 */
export default async function globalSetup() {
  console.log('Checking Electron app build...');
  
  const mainJsPath = path.join(__dirname, '../../.vite/build/main.js');
  const rendererPath = path.join(__dirname, '../../.vite/renderer/main_window/index.html');
  
  // Check if Vite build exists
  if (fs.existsSync(mainJsPath) && fs.existsSync(rendererPath)) {
    console.log('Vite build found.');
    copyResourcesToBuild();
    return;
  }
  
  // Build using Electron Forge package (which builds Vite outputs)
  console.log('Building app with Electron Forge...');
  try {
    execSync('npm run package', { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '../../')
    });
    console.log('Build complete!');
    copyResourcesToBuild();
  } catch (error) {
    console.error('Build failed:', error);
    throw error;
  }
}
