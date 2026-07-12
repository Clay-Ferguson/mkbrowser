import { joinPath } from './pathUtil';

/**
 * Generates a timestamp-based filename in the format `YYYY-MM-DD--HH-MM-SS-mmm<extension>`,
 * used for pasted clipboard items where no meaningful name is available.
 * Milliseconds are included so two pastes in the same second don't collide (the
 * main-process write handlers overwrite existing files without warning).
 */
export function generateTimestampFilename(extension: string): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const millis = now.getMilliseconds().toString().padStart(3, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${millis}`;
  return `${timestamp}${extension}`;
}

/**
 * Base64-encodes binary data. Builds the intermediate binary string in chunks:
 * `btoa` needs one character per byte, but a per-byte concatenation is quadratic
 * and `String.fromCharCode(...bytes)` on a whole multi-MB image overflows the
 * argument stack, so neither extreme works for pasted screenshots.
 */
function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK_SIZE = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
}

export interface PasteFromClipboardResult {
  success: boolean;
  fileName?: string;
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Writes clipboard text out as a new timestamped `.md` file.
 */
async function pasteText(
  currentPath: string,
  text: string,
  writeFile: (path: string, content: string) => Promise<{ ok: boolean; content: string }>
): Promise<PasteFromClipboardResult> {
  const fileName = generateTimestampFilename('.md');
  const filePath = joinPath(currentPath, fileName);

  const result = await writeFile(filePath, text);
  if (result.ok) {
    return { success: true, fileName };
  }
  return { success: false, error: 'Failed to paste text from clipboard' };
}

/**
 * Handles a single clipboard item read through the modern Clipboard API, writing it
 * out as an image or a text file. Returns null if the item holds neither, so the
 * caller can try the next item.
 */
async function pasteClipboardItem(
  currentPath: string,
  item: ClipboardItem,
  writeFileBinary: (path: string, base64: string) => Promise<boolean>,
  writeFile: (path: string, content: string) => Promise<{ ok: boolean; content: string }>
): Promise<PasteFromClipboardResult | null> {
  // Check for image types first
  const imageType = item.types.find(type => type.startsWith('image/'));
  if (imageType) {
    const blob = await item.getType(imageType);
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);

    // Determine extension from MIME type (clipboard images are typically PNG)
    let ext = '.png';
    if (imageType === 'image/jpeg') ext = '.jpg';
    else if (imageType === 'image/gif') ext = '.gif';
    else if (imageType === 'image/webp') ext = '.webp';

    const fileName = generateTimestampFilename(ext);
    const filePath = joinPath(currentPath, fileName);

    const success = await writeFileBinary(filePath, base64);
    if (success) {
      return { success: true, fileName };
    }
    return { success: false, error: 'Failed to paste image from clipboard' };
  }

  if (item.types.includes('text/plain')) {
    const blob = await item.getType('text/plain');
    return pasteText(currentPath, await blob.text(), writeFile);
  }

  return null;
}

/**
 * Paste content from clipboard as a new file.
 * Handles both images and text, creating appropriately named files.
 *
 * `navigator.clipboard.read()` is the only call allowed to fall back to the older
 * `readText()` API: a failure there means the environment can't hand us clipboard
 * items at all. Failures *after* that point (decoding a blob, writing the file) are
 * real errors and are reported as such — retrying them as a text paste would hide
 * the cause and could write a spurious `.md` file in place of a failed image.
 */
export async function pasteFromClipboard(
  currentPath: string,
  writeFileBinary: (path: string, base64: string) => Promise<boolean>,
  writeFile: (path: string, content: string) => Promise<{ ok: boolean; content: string }>
): Promise<PasteFromClipboardResult> {
  let clipboardItems: ClipboardItem[] | undefined;
  if (typeof navigator.clipboard?.read === 'function') {
    try {
      clipboardItems = await navigator.clipboard.read();
    } catch {
      // Clipboard items unavailable (unsupported or blocked) — fall through to readText below.
      clipboardItems = undefined;
    }
  }

  if (clipboardItems) {
    try {
      for (const item of clipboardItems) {
        const result = await pasteClipboardItem(currentPath, item, writeFileBinary, writeFile);
        if (result) {
          return result;
        }
      }
    } catch (err) {
      return { success: false, error: `Failed to paste from clipboard: ${errorMessage(err)}` };
    }

    return { success: false, error: 'Clipboard is empty or contains unsupported content' };
  }

  // Fallback to older clipboard API for text
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      return { success: false, error: 'Clipboard is empty' };
    }
    return await pasteText(currentPath, text, writeFile);
  } catch {
    return { success: false, error: 'Unable to read clipboard. Please ensure clipboard access is allowed.' };
  }
}
