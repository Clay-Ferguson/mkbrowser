/**
 * readImageDimensions tests — verifies that an image's intrinsic pixel
 * dimensions are read from the file header for each container format the
 * markdown renderer needs (GIF, PNG, JPEG, plus WebP via the exiftool
 * fallback), and that non-image files reject. Fixtures are built in-test from
 * minimal valid image bytes: a 1x1 base image with its header dimension
 * fields patched to distinctive values, proving the numbers come from the
 * header (the pixel data is still 1x1).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { exiftool } from 'exiftool-vendored';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { readImageDimensions } from '../src/main/exifUtil';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imgdims-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// The WebP test exercises the exiftool fallback, which spawns exiftool's
// stay-open child process; shut it down or the vitest process never exits.
afterAll(async () => {
  await exiftool.end();
});

/** Write raw bytes to a file in the temp dir and return its path. */
async function writeFixture(name: string, bytes: Buffer): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

// 1x1 GIF89a; logical-screen width/height live at bytes 6-9 (little-endian).
const BASE_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// 1x1 PNG; IHDR width/height live at bytes 16-23 (big-endian).
const BASE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// Minimal 1x1 JPEG (SOF0 frame header carries the dimensions).
const BASE_JPG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
// Minimal 1x1 lossless (VP8L) WebP — a *simple* WebP with no VP8X chunk, so
// ExifReader can't size it and readImageDimensions must use the exiftool fallback.
const BASE_WEBP = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

describe('readImageDimensions', () => {
  it('reads dimensions from a GIF header', async () => {
    const gif = Buffer.from(BASE_GIF, 'base64');
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(200, 8);
    const filePath = await writeFixture('anim.gif', gif);

    expect(await readImageDimensions(filePath)).toEqual({ width: 320, height: 200 });
  });

  it('reads dimensions from a PNG header', async () => {
    const png = Buffer.from(BASE_PNG, 'base64');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    const filePath = await writeFixture('shot.png', png);

    expect(await readImageDimensions(filePath)).toEqual({ width: 640, height: 480 });
  });

  it('reads dimensions from a JPEG frame header', async () => {
    const filePath = await writeFixture('photo.jpg', Buffer.from(BASE_JPG, 'base64'));

    expect(await readImageDimensions(filePath)).toEqual({ width: 1, height: 1 });
  });

  it('reads dimensions from a simple WebP via the exiftool fallback', async () => {
    const filePath = await writeFixture('pic.webp', Buffer.from(BASE_WEBP, 'base64'));

    expect(await readImageDimensions(filePath)).toEqual({ width: 1, height: 1 });
  });

  it('rejects for a non-image file', async () => {
    const filePath = await writeFixture('notes.md', Buffer.from('# not an image\n', 'utf8'));

    await expect(readImageDimensions(filePath)).rejects.toThrow();
  });
});
