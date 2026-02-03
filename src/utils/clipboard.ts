/**
 * Generate a timestamp-based filename
 */
export function generateTimestampFilename(extension: string): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${timestamp}${extension}`;
}

export interface PasteFromClipboardResult {
  success: boolean;
  fileName?: string;
  error?: string;
}

/**
 * Paste content from clipboard as a new file.
 * Handles both images and text, creating appropriately named files.
 */
export async function pasteFromClipboard(
  currentPath: string,
  writeFileBinary: (path: string, base64: string) => Promise<boolean>,
  writeFile: (path: string, content: string) => Promise<boolean>
): Promise<PasteFromClipboardResult> {
  try {
    // Try to read clipboard items (modern Clipboard API)
    const clipboardItems = await navigator.clipboard.read();
    
    for (const item of clipboardItems) {
      // Check for image types first
      const imageType = item.types.find(type => type.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        
        // Determine extension from MIME type (clipboard images are typically PNG)
        let ext = '.png';
        if (imageType === 'image/jpeg') ext = '.jpg';
        else if (imageType === 'image/gif') ext = '.gif';
        else if (imageType === 'image/webp') ext = '.webp';
        
        const fileName = generateTimestampFilename(ext);
        const filePath = `${currentPath}/${fileName}`;
        
        const success = await writeFileBinary(filePath, base64);
        if (success) {
          return { success: true, fileName };
        } else {
          return { success: false, error: 'Failed to paste image from clipboard' };
        }
      }
      
      // Check for text
      if (item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        const text = await blob.text();
        
        const fileName = generateTimestampFilename('.md');
        const filePath = `${currentPath}/${fileName}`;
        
        const success = await writeFile(filePath, text);
        if (success) {
          return { success: true, fileName };
        } else {
          return { success: false, error: 'Failed to paste text from clipboard' };
        }
      }
    }
    
    return { success: false, error: 'Clipboard is empty or contains unsupported content' };
  } catch {
    // Fallback to older clipboard API for text
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const fileName = generateTimestampFilename('.md');
        const filePath = `${currentPath}/${fileName}`;
        
        const success = await writeFile(filePath, text);
        if (success) {
          return { success: true, fileName };
        } else {
          return { success: false, error: 'Failed to paste text from clipboard' };
        }
      } else {
        return { success: false, error: 'Clipboard is empty' };
      }
    } catch {
      return { success: false, error: 'Unable to read clipboard. Please ensure clipboard access is allowed.' };
    }
  }
}
