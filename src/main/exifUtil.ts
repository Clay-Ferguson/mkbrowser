import { exiftool } from 'exiftool-vendored';
import * as ExifReader from 'exifreader';
import { logger } from '../shared/logUtil';
import type { ExifData, ImageDimensions } from '../shared/shared';
/**
 * Write EXIF metadata to an image file. Accepts a grouped tag object (same as readExifMetadata output).
 * Only string values are supported. Returns true on success, false on error.
 */
// Read-only groups that cannot be written to
const READ_ONLY_GROUPS = new Set(['file', 'composite', 'pngFile']);

export async function writeExifMetadata(filePath: string, data: ExifData): Promise<boolean> {
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
    logger.error('Error writing EXIF:', err);
    return false;
  }
}

/**
 * EXIF orientations 5-8 display the image rotated 90°/270°, so the stored
 * width/height are swapped to match what the browser actually renders.
 */
function orientedDimensions(width: number, height: number, orientation: unknown): ImageDimensions {
  const isRotated90 = typeof orientation === 'number' && orientation >= 5 && orientation <= 8;
  return isRotated90 ? { width: height, height: width } : { width, height };
}

/**
 * Read an image's intrinsic pixel dimensions (as displayed, i.e. with EXIF
 * orientation applied) without decoding the pixel data. ExifReader parses
 * them straight from the file header into a per-format group: `file` (JPEG),
 * `pngFile` (PNG), `gif` (GIF), `riff` (WebP extended format only, with tag
 * names lacking the space). For anything it can't size (e.g. simple
 * lossy/lossless WebP) we fall back to exiftool, which is already bundled
 * for EXIF writes and covers essentially every format via a cheap stay-open
 * process. Returns null when dimensions can't be determined; rejects on
 * files that aren't a recognized image format at all.
 */
export async function readImageDimensions(filePath: string): Promise<ImageDimensions | null> {
  const tags = await ExifReader.load(filePath, { expanded: true, length: 128 * 1024 });

  const dimensionCandidates: Array<[unknown, unknown]> = [
    [tags.file?.['Image Width']?.value, tags.file?.['Image Height']?.value],
    [tags.pngFile?.['Image Width']?.value, tags.pngFile?.['Image Height']?.value],
    [tags.gif?.['Image Width']?.value, tags.gif?.['Image Height']?.value],
    [tags.riff?.ImageWidth?.value, tags.riff?.ImageHeight?.value],
  ];
  for (const [width, height] of dimensionCandidates) {
    if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
      return orientedDimensions(width, height, tags.exif?.Orientation?.value);
    }
  }

  const fallbackTags = await exiftool.read(filePath);
  const { ImageWidth: width, ImageHeight: height } = fallbackTags;
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    // Orientation is in exiftool-vendored's default numericTags, so it
    // arrives as the raw 1-8 EXIF value rather than a description string.
    return orientedDimensions(width, height, fallbackTags.Orientation);
  }
  return null;
}

/**
 * Read EXIF metadata from an image file and return it as a grouped map. Each
 * top-level key is a metadata group name (e.g. `"EXIF"`, `"XMP"`, `"ICC"`); each
 * value is a flat object mapping tag name to its human-readable description string.
 * Thumbnail groups are excluded. Tags whose description is not a string or number
 * are omitted. Groups with no eligible tags are omitted from the result.
 */
export async function readExifMetadata(filePath: string): Promise<ExifData> {
  const tags = await ExifReader.load(filePath, { expanded: true, length: 128 * 1024 });

  const result: ExifData = {};
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
