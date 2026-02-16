import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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
  } catch (error) {
    console.error('Build failed:', error);
    throw error;
  }
}
