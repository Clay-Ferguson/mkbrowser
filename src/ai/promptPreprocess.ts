/**
 * Prompt preprocessing utilities — #file: directive parsing and expansion.
 *
 * This module is intentionally free of Electron and LangChain imports so that
 * it can be unit-tested in a plain Node environment.
 */
import { fdir } from 'fdir';
import fs from 'node:fs/promises';
import path from 'node:path';

const debug = false;

/** Matches a #file: directive on its own line. Captures the pattern after the colon. */
export const FILE_DIRECTIVE_REGEX = /^\s*#file:(.+?)\s*$/;

// ── Image detection & MIME mapping ─────────────────────────────────

/** Maximum image file size in bytes (10 MB). Larger images are skipped. */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/** File extensions we treat as images (sent as base64 image_url parts). */
export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.bmp', '.ico', '.tiff', '.tif', '.avif',
]);

/** Map a file extension to its MIME type. Defaults to 'application/octet-stream'. */
export function getImageMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.avif': 'image/avif',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

/** Check whether a filename has an image extension. */
export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** A single image attachment ready for a multimodal HumanMessage. */
export interface ImageAttachment {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

/**
 * Result of preprocessing a prompt. Contains the text portion (with
 * directives stripped and text-file contents appended in
 * `<attached_files>`) and any image attachments detected by extension.
 */
export interface PreprocessResult {
  /** Processed prompt text (directives stripped, text attachments appended). */
  text: string;
  /** Image files matched by #file: directives, base64-encoded. */
  images: ImageAttachment[];
}

/**
 * Convert a simple wildcard pattern (where `*` matches any sequence of characters)
 * into a RegExp. All other regex-special characters are escaped.
 *
 * Examples:
 *   `*`       → /^.*$/
 *   `*.md`    → /^.*\.md$/
 *   `data.*`  → /^data\..*$/
 *   `notes.txt` → /^notes\.txt$/
 */
export function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`);
}

/**
 * Parse `#file:<pattern>` directives from prompt text, resolve them against
 * the given folder (non-recursive), read matching files, and return a
 * {@link PreprocessResult} containing the cleaned prompt text (with text-file
 * contents in an `<attached_files>` block) plus any image attachments.
 *
 * - Directives must be on their own line.
 * - `HUMAN.md` is always excluded from matches.
 * - Duplicate files (by absolute path) are deduplicated.
 * - Patterns that match zero files are silently ignored.
 * - Image files (detected by extension) are read as binary and returned in
 *   the `images` array as base64-encoded {@link ImageAttachment} objects.
 *   Images larger than {@link MAX_IMAGE_SIZE_BYTES} are skipped with a note.
 * - When `includeImages` is `false`, image files are excluded entirely
 *   (useful for historical turns where re-sending images is wasteful).
 *
 * @param rawText       The raw HUMAN.md content (may contain #file: directives).
 * @param folderPath    Absolute path of the folder containing the HUMAN.md.
 * @param includeImages Whether to attach matched image files (default `true`).
 * @returns             A {@link PreprocessResult} with the processed prompt
 *                      text and any image attachments.
 */
export async function preprocessPrompt(
  rawText: string,
  folderPath: string,
  includeImages = true
): Promise<PreprocessResult> {
  const lines = rawText.split('\n');
  const promptLines: string[] = [];
  const patterns: string[] = [];

  // Separate directive lines from prompt lines
  for (const line of lines) {
    const match = FILE_DIRECTIVE_REGEX.exec(line);
    if (match) {
      patterns.push(match[1]);
    } else {
      promptLines.push(line);
    }
  }

  // No directives found — return the original text unchanged
  if (patterns.length === 0) {
    return { text: rawText, images: [] };
  }

  // List all files in the folder (non-recursive, depth 0)
  let allFiles: string[] = [];
  try {
    allFiles = await new fdir()
      .withFullPaths()
      .withMaxDepth(0)
      .crawl(folderPath)
      .withPromise();
  } catch {
    // Folder unreadable — return prompt with directives stripped
    return { text: promptLines.join('\n'), images: [] };
  }

  // Build set of matched files, deduplicating by absolute path
  const matchedFiles = new Set<string>();

  for (const pattern of patterns) {
    const regex = wildcardToRegex(pattern);
    for (const filePath of allFiles) {
      const fileName = path.basename(filePath);
      if (fileName === 'HUMAN.md') continue; // Always exclude
      if (regex.test(fileName)) {
        matchedFiles.add(filePath);
      }
    }
  }

  // No files matched — return prompt with directives stripped
  if (matchedFiles.size === 0) {
    return { text: promptLines.join('\n'), images: [] };
  }

  // Partition matched files into text files and image files
  const textFiles: string[] = [];
  const imageFiles: string[] = [];
  for (const filePath of matchedFiles) {
    if (isImageFile(path.basename(filePath))) {
      if (includeImages) {
        imageFiles.push(filePath);
      }
      // When includeImages is false, skip image files entirely
    } else {
      textFiles.push(filePath);
    }
  }

  // Read text files and build the <attached_files> block
  const fileBlocks: string[] = [];
  for (const filePath of textFiles) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const relativeName = path.basename(filePath);
      fileBlocks.push(`<file path="${relativeName}">\n${content}\n</file>`);
    } catch {
      // Skip unreadable files silently
    }
  }

  // Read image files and build ImageAttachment objects
  const images: ImageAttachment[] = [];
  const skippedNotes: string[] = [];
  for (const filePath of imageFiles) {
    try {
      const stat = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      if (stat.size > MAX_IMAGE_SIZE_BYTES) {
        skippedNotes.push(`[Skipped image "${fileName}": exceeds 10 MB limit (${(stat.size / (1024 * 1024)).toFixed(1)} MB)]`);
        continue;
      }
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(fileName).toLowerCase();
      images.push({
        fileName,
        mimeType: getImageMimeType(ext),
        base64Data: buffer.toString('base64'),
      });
    } catch {
      // Skip unreadable images silently
    }
  }

  // Build the final prompt text
  let finalText = promptLines.join('\n');

  if (fileBlocks.length > 0) {
    const attachedBlock = `<attached_files>\n${fileBlocks.join('\n')}\n</attached_files>`;
    finalText = `${finalText}\n\n${attachedBlock}`;
  }

  if (skippedNotes.length > 0) {
    finalText = `${finalText}\n\n${skippedNotes.join('\n')}`;
  }

  if (debug) {
    console.log('[preprocessPrompt] Final prompt with attached files:\n', finalText);
    console.log(`[preprocessPrompt] ${images.length} image attachment(s)`);
  }
  return { text: finalText, images };
}
