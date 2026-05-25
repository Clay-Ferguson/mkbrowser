import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fdir } from 'fdir';
import { getSortedDirEntries } from './indexUtil';

function rewriteImagePathsToAbsolute(content: string, sourceFilePath: string): string {
  const sourceDir = path.dirname(sourceFilePath);

  function shouldSkip(rawPath: string): boolean {
    return (
      rawPath === '' ||
      rawPath.startsWith('http://') ||
      rawPath.startsWith('https://') ||
      rawPath.startsWith('//') ||
      rawPath.startsWith('/') ||
      rawPath.startsWith('data:') ||
      rawPath.startsWith('#')
    );
  }

  function resolveIfExists(rawPath: string): string {
    const match = rawPath.match(/^([^?#]+)([?#].*)?$/);
    if (!match) return rawPath;
    const filePart = match[1];
    const suffix = match[2] ?? '';
    const resolved = path.resolve(sourceDir, filePart);
    if (!fs.existsSync(resolved)) return rawPath;
    return resolved + suffix;
  }

  // Rewrite markdown image syntax: ![alt](path)
  let result = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (fullMatch, alt, rawPath) => {
    if (shouldSkip(rawPath)) return fullMatch;
    const newPath = resolveIfExists(rawPath);
    return `![${alt}](${newPath})`;
  });

  // Rewrite HTML img tags: <img ... src="..." ...>
  result = result.replace(/<img([^>]+)>/gi, (fullMatch, attrs) => {
    let replaced = attrs.replace(/(\bsrc=")([^"]+)(")/i, (_m: string, pre: string, rawPath: string, post: string) => {
      if (shouldSkip(rawPath)) return _m;
      return pre + resolveIfExists(rawPath) + post;
    });
    replaced = replaced.replace(/(\bsrc=')([^']+)(')/i, (_m: string, pre: string, rawPath: string, post: string) => {
      if (shouldSkip(rawPath)) return _m;
      return pre + resolveIfExists(rawPath) + post;
    });
    return `<img${replaced}>`;
  });

  return result;
}

/**
 * Concatenate all .md and .txt files in a folder (optionally including subfolders)
 * into a single markdown string, with optional filename headers and dividers.
 */
export async function exportFolderContents(
  sourceFolder: string,
  outputFolder: string,
  outputFileName: string,
  includeSubfolders: boolean,
  includeFilenames: boolean,
  includeDividers: boolean,
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  // Recursive depth-first function: files and subdirs are sorted together in one
  // case-insensitive pass so ordinal prefixes (00010_, 999_, etc.) fully control order.
  const processFolder = async (folderPath: string, relativePath: string): Promise<string[]> => {
    const parts: string[] = [];

    // Sorted entries — honours .INDEX.yaml document-mode ordering when present,
    // falls back to alphabetical for folders without one.
    const sortedEntries = await getSortedDirEntries(folderPath);

    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif']);

    // Filter to eligible items (text files, images, and when requested, subdirs)
    const items = sortedEntries.filter((item) => {
      if (item.isDir) return includeSubfolders;
      const lower = item.name.toLowerCase();
      return lower.endsWith('.md') || lower.endsWith('.txt') || imageExtensions.has(path.extname(lower));
    });

    for (const item of items) {
      if (item.isDir) {
        const subRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;
        const subParts = await processFolder(item.entryPath, subRelativePath);
        parts.push(...subParts);
      } else if (imageExtensions.has(path.extname(item.name.toLowerCase()))) {
        const altText = path.basename(item.name, path.extname(item.name));
        parts.push(`\n![${altText}](${item.entryPath})\n`);
      } else {
        const rawContent = await fs.promises.readFile(item.entryPath, 'utf-8');
        const content = rewriteImagePathsToAbsolute(rawContent, item.entryPath);
        if (includeFilenames) {
          const fileLabel = relativePath ? `${relativePath}/${item.name}` : item.name;
          parts.push(`File: ${fileLabel}\n\n${content}`);
        } else {
          parts.push(content);
        }
      }
    }

    return parts;
  };

  // Process the source folder
  const allParts = await processFolder(sourceFolder, '');

  if (allParts.length === 0) {
    return {
      success: false,
      error: includeSubfolders
        ? 'No markdown or text files found in the folder or its subfolders.'
        : 'No markdown or text files found in the current folder.',
    };
  }

  const separator = includeDividers ? '\n\n---\n\n' : '\n\n';
  const concatenatedContent = allParts.join(separator);

  // Write the output file
  const outputPath = path.join(outputFolder, outputFileName);
  await fs.promises.writeFile(outputPath, concatenatedContent, 'utf-8');

  return {
    success: true,
    outputPath,
  };
}

/**
 * Launch a PDF export in an external terminal window.
 *
 * @param markdownPath  Absolute path to the source markdown file
 * @param pdfPath       Absolute path for the generated PDF
 * @param resourcePath  Directory containing `generate-pdf.sh`
 * @param sourceFolder  Optional root folder to search for a glossary file
 */
export async function exportToPdf(
  markdownPath: string,
  pdfPath: string,
  resourcePath: string,
  sourceFolder?: string,
): Promise<{ success: boolean; error?: string }> {
  const scriptPath = path.join(resourcePath, 'generate-pdf.sh');

  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    return {
      success: false,
      error: `PDF export script not found at: ${scriptPath}`,
    };
  }

  // Try common Linux terminal emulators in order of preference
  const terminals = [
    { cmd: 'x-terminal-emulator', args: ['-e'] },
    { cmd: 'gnome-terminal', args: ['--'] },
    { cmd: 'konsole', args: ['-e'] },
    { cmd: 'xfce4-terminal', args: ['-e'] },
    { cmd: 'xterm', args: ['-e'] },
    { cmd: 'kitty', args: ['--'] },
    { cmd: 'alacritty', args: ['-e'] },
  ];

  // Find the first available terminal
  let terminalCmd: string | null = null;
  let terminalArgs: string[] = [];

  for (const terminal of terminals) {
    try {
      execSync(`which ${terminal.cmd}`, { stdio: 'ignore' });
      terminalCmd = terminal.cmd;
      terminalArgs = terminal.args;
      break;
    } catch {
      // Terminal not found, try next
    }
  }

  if (!terminalCmd) {
    return {
      success: false,
      error: 'No terminal emulator found. Please install gnome-terminal, konsole, xterm, or another terminal emulator.',
    };
  }

  // Check if a glossary file exists anywhere under the source folder (recursive)
  let glossaryPath: string | undefined;
  if (sourceFolder) {
    const matches = await new fdir()
      .withFullPaths()
      .filter((f) => path.basename(f).endsWith('Glossary_of_Terms.md'))
      .crawl(sourceFolder)
      .withPromise();
    if (matches.length > 0) {
      glossaryPath = matches[0];
    }
  }

  // Spawn the terminal with the script (optional glossary path as $3)
  const scriptArgs = glossaryPath
    ? [...terminalArgs, scriptPath, markdownPath, pdfPath, glossaryPath]
    : [...terminalArgs, scriptPath, markdownPath, pdfPath];
  const child = spawn(terminalCmd, scriptArgs, {
    detached: true,
    stdio: 'ignore',
  });

  // Detach the process so it doesn't block the app
  child.unref();

  return { success: true };
}
