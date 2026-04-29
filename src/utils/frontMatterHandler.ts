import path from 'node:path';
import fs from 'node:fs';
import { convertMDtoHTML } from './exportMDtoHTML';
import { logger } from './logUtil';

/**
 * Called after a Markdown file has been successfully saved.
 *
 * If the front matter contains an `autogen.outputFile` property, the file
 * body (content without YAML) is written verbatim to that path.
 *
 * `outputFile` may be:
 *   - An absolute path — used as-is.
 *   - A relative path — resolved against the directory of the source file.
 *
 * Errors during autogen are logged but do not propagate (the primary save
 * has already succeeded).
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

  try {
    const html = await convertMDtoHTML(content);
    await fs.promises.writeFile(resolvedOutput, html, 'utf-8');
    logger.log(`[autogen] Wrote ${resolvedOutput}`);
  } catch (error) {
    logger.warn(`[autogen] Failed to write ${resolvedOutput}:`, error);
  }
}
