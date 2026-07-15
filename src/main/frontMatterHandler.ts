import path from 'node:path';
import { dialog } from 'electron';
import { convertMDtoHTML } from '../shared/exportMDtoHTML';
import { writeFileAtomic } from './atomicWrite';
import { logger } from '../shared/logUtil';

/**
 * Called after a Markdown file has been successfully saved.
 *
 * If the front matter contains an `autogen.outputFile` property, the file
 * body (content without YAML) is rendered to HTML and written to that path.
 *
 * `outputFile` may be:
 *   - An absolute path — used as-is.
 *   - A relative path — resolved against the directory of the source file.
 *
 * The target MUST have a `.html` extension. This is the only validation of
 * the path: it stops a hand-edited (or typo'd) `outputFile` from silently
 * overwriting the Markdown source itself, or any other non-HTML document,
 * with generated HTML. An invalid extension raises a visible error dialog
 * and no file is written. The write itself uses `writeFileAtomic` so a crash
 * mid-write can never leave a truncated target.
 *
 * Other errors during autogen are logged but do not propagate (the primary
 * save has already succeeded).
 */
export async function frontMatterFileSaved(
  sourceFilePath: string,
  frontMatterYaml: Record<string, unknown>,
  content: string,
): Promise<void> {
  const autogen = frontMatterYaml['autogen'];
  if (autogen === null || typeof autogen !== 'object' || Array.isArray(autogen)) {
    return;
  }

  const autogenObj = autogen as Record<string, unknown>;
  const outputFile = autogenObj['outputFile'];
  if (typeof outputFile !== 'string' || outputFile.trim() === '') {
    return;
  }

  // Resolve relative paths against the source file's directory
  const resolvedOutput = path.isAbsolute(outputFile)
    ? outputFile
    : path.resolve(path.dirname(sourceFilePath), outputFile);

  // The target must be an .html file. This is the sole guard against an
  // outputFile that resolves back to the Markdown source (or any other
  // document) being clobbered with generated HTML.
  if (path.extname(resolvedOutput).toLowerCase() !== '.html') {
    dialog.showErrorBox(
      'Invalid autogen.outputFile',
      `The front-matter "autogen.outputFile" must name a file with a .html extension.\n\n` +
        `Got: ${outputFile}\n\n` +
        `No file was written.`,
    );
    return;
  }

  try {
    const html = await convertMDtoHTML(content);
    await writeFileAtomic(resolvedOutput, html);
    logger.log(`[autogen] Wrote ${resolvedOutput}`);
  } catch (error) {
    logger.warn(`[autogen] Failed to write ${resolvedOutput}:`, error);
  }
}
