import { exiftool } from 'exiftool-vendored';
/**
 * Write EXIF metadata to an image file. Accepts a grouped tag object (same as readExifMetadata output).
 * Only string values are supported. Returns true on success, false on error.
 */
// Read-only groups that cannot be written to
const READ_ONLY_GROUPS = new Set(['file', 'composite', 'pngFile']);

export async function writeExifMetadata(filePath: string, data: Record<string, Record<string, string>>): Promise<boolean> {
  // Flatten grouped tags with group prefixes: { "EXIF:TagName": value, ... }
  // This preserves which metadata section each tag belongs to
  const tags: Record<string, string> = {};

  for (const [groupName, groupTags] of Object.entries(data)) {
    // Skip read-only groups
    if (READ_ONLY_GROUPS.has(groupName)) {
      continue;
    }
    for (const [tag, value] of Object.entries(groupTags)) {
      // Use group:tag format for exiftool (e.g., "EXIF:ImageDescription")
      tags[`${groupName}:${tag}`] = value;
    }
  }

  try {
    await exiftool.write(filePath, tags);
    return true;
  } catch (err) {
    console.error('Error writing EXIF:', err);
    return false;
  }
}
import ExifReader from 'exifreader';

/**
 * Read EXIF metadata from an image file, returning grouped tag descriptions.
 */
export async function readExifMetadata(filePath: string): Promise<Record<string, Record<string, string>>> {
  const tags = await ExifReader.load(filePath, { expanded: true, length: 128 * 1024 });

  const result: Record<string, Record<string, string>> = {};
  const skipGroups = new Set(['Thumbnail', 'thumbnail']);

  for (const [groupName, groupTags] of Object.entries(tags)) {
    if (skipGroups.has(groupName)) continue;
    if (typeof groupTags !== 'object' || groupTags === null) continue;

    const groupResult: Record<string, string> = {};
    for (const [tagName, tagValue] of Object.entries(groupTags as Record<string, unknown>)) {
      if (tagValue && typeof tagValue === 'object' && 'description' in tagValue) {
        const desc = (tagValue as { description: unknown }).description;
        if (typeof desc === 'string') {
          groupResult[tagName] = desc;
        } else if (typeof desc === 'number') {
          groupResult[tagName] = String(desc);
        }
      }
    }
    if (Object.keys(groupResult).length > 0) {
      result[groupName] = groupResult;
    }
  }
  return result;
}
