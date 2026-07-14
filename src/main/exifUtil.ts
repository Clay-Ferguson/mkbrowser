import { ExifTool } from 'exiftool-vendored';
import * as ExifReader from 'exifreader';
import { logger } from '../shared/logUtil';
import type { ExifData, ExifWriteResult, ImageDimensions } from '../shared/shared';

/**
 * We deliberately run the system-installed exiftool from the PATH rather than
 * the perl script vendored in exiftool-vendored.pl: perl cannot read files
 * inside the packaged app.asar archive, so the vendored copy only works when
 * unpacked from the asar — machinery we've chosen not to maintain. exiftool
 * must be installed on the machine (e.g. `apt install libimage-exiftool-perl`);
 * if it isn't, EXIF reads/writes fail with a clear spawn error at first use
 * and the rest of the app is unaffected. No process is spawned until the
 * first EXIF operation.
 */
const exiftool = new ExifTool({ exiftoolPath: 'exiftool' });
/**
 * Write EXIF metadata to an image file. Accepts a grouped tag object (same as readExifMetadata output).
 * Only string values are supported.
 *
 * ExifTool reports a rejected tag as a warning rather than throwing, so a bad
 * value (or a tag unsupported by the file's format) silently writes nothing.
 * We therefore treat the write as successful only when ExifTool reports it
 * touched the file, and pass any warnings back to the caller.
 */
// Read-only groups that cannot be written to
const READ_ONLY_GROUPS = new Set(['file', 'composite', 'pngFile']);

/**
 * ExifTool's own tag-name grammar. Some of what we read back is a *display*
 * name rather than a tag name — PNG's IHDR fields arrive as "Image Width",
 * "Bit Depth", etc. ExifTool rejects the whole write if any single name is
 * malformed, so we drop those rather than let one derived field sink the
 * entire save.
 */
const VALID_TAG_NAME = /^[A-Za-z0-9_:*?+#^][A-Za-z0-9_:\-*?+#^]*$/;

export async function writeExifMetadata(filePath: string, data: ExifData): Promise<ExifWriteResult> {
  // Flatten grouped tags with group prefixes: { "EXIF:TagName": value, ... }
  // This preserves which metadata section each tag belongs to
  const tags: Record<string, string> = {};
  const skipped: string[] = [];

  for (const [groupName, groupTags] of Object.entries(data)) {
    // Skip read-only groups
    if (READ_ONLY_GROUPS.has(groupName)) {
      continue;
    }
    for (const [tag, value] of Object.entries(groupTags)) {
      // Use group:tag format for exiftool (e.g., "EXIF:ImageDescription")
      const name = `${groupName}:${tag}`;
      if (!VALID_TAG_NAME.test(name)) {
        skipped.push(`Skipped "${name}" — not a writable ExifTool tag name.`);
        continue;
      }
      tags[name] = value;
    }
  }

  if (Object.keys(tags).length === 0) {
    // Nothing writable to send. Handing ExifTool an empty tag set just earns a
    // "Nothing to do." warning, so report the skips directly instead.
    logger.warn('EXIF write had no writable tags:', filePath, skipped);
    return { ok: skipped.length === 0, warnings: skipped };
  }

  try {
    const res = await exiftool.write(filePath, tags);
    const warnings = [...skipped, ...(res.warnings ?? [])];
    // `unchanged` counts files ExifTool knew it needn't rewrite, which is still
    // a successful outcome; all three at zero means nothing was applied.
    const ok = res.created + res.updated + res.unchanged > 0;
    if (!ok) {
      logger.error('EXIF write applied no changes:', filePath, warnings);
    } else if (warnings.length > 0) {
      logger.warn('EXIF write completed with warnings:', filePath, warnings);
    }
    return { ok, warnings };
  } catch (err) {
    logger.error('Error writing EXIF:', err);
    return { ok: false, warnings: [String(err)] };
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
 * lossy/lossless WebP) we fall back to exiftool, which is already required
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
