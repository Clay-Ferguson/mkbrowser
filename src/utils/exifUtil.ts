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
