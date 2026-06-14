/**
 * Where a human-readable "Description" should be embedded for a given image type.
 * `group`/`tag` match the grouped EXIF shape used by readExifMetadata/writeExifMetadata.
 */
export interface ExifDescriptionTarget {
  group: string;
  tag: string;
}

/**
 * Resolve the EXIF group/tag that should hold a Description for the given file
 * (accepts a path or a bare extension). Returns null for unsupported types.
 *
 * This mirrors the OCR script's EMBED_TAG_MAP (merlin_ocr.py) so embedded text
 * lands in the same place whether written here or by OCR — keep the two in sync.
 */
export function getExifDescriptionTarget(filePathOrExt: string): ExifDescriptionTarget | null {
  const ext = filePathOrExt.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png':
      return { group: 'png', tag: 'Description' };
    case 'jpg':
    case 'jpeg':
      return { group: 'xmp-dc', tag: 'Description' }; // XMP Dublin Core namespace
    default:
      return null;
  }
}
