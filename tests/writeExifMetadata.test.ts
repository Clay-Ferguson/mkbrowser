/**
 * writeExifMetadata tests — ExifTool does not throw when it rejects a tag; it
 * writes nothing (or only the tags it accepts) and reports the rest as
 * warnings. These tests pin that contract: a rejected tag must surface as
 * ok:false, a partially-applied write must still surface its warnings, and a
 * clean write must report no warnings. Fixtures are a minimal 1x1 JPEG written
 * to a temp dir and mutated by the real exiftool binary.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { exiftool } from 'exiftool-vendored';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { writeExifMetadata, readExifMetadata } from '../src/main/exifUtil';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exifwrite-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// These tests drive the real exiftool stay-open child process; shut it down or
// the vitest process never exits.
afterAll(async () => {
  await exiftool.end();
});

// Minimal 1x1 JPEG, with no EXIF block of its own.
const BASE_JPG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
// Minimal 1x1 PNG.
const BASE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function fixture(name: string, base64: string): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

const jpegFixture = (name: string) => fixture(name, BASE_JPG);
const pngFixture = (name: string) => fixture(name, BASE_PNG);

describe('writeExifMetadata', () => {
  it('writes an accepted tag and reports no warnings', async () => {
    const filePath = await jpegFixture('ok.jpg');

    const res = await writeExifMetadata(filePath, { EXIF: { ImageDescription: 'a description' } });

    expect(res).toEqual({ ok: true, warnings: [] });
    const meta = await readExifMetadata(filePath);
    expect(meta.exif?.ImageDescription).toBe('a description');
  });

  it('reports ok:false with warnings when ExifTool rejects the only tag', async () => {
    const filePath = await jpegFixture('bad.jpg');

    // Orientation goes through ExifTool's PrintConv, which accepts descriptions
    // like "Rotate 90 CW" — not arbitrary text. ExifTool warns and writes nothing.
    const res = await writeExifMetadata(filePath, { EXIF: { Orientation: 'not-an-orientation' } });

    expect(res.ok).toBe(false);
    expect(res.warnings.join('\n')).toMatch(/Orientation/i);
  });

  it('surfaces warnings even when the write partially succeeds', async () => {
    const filePath = await jpegFixture('partial.jpg');

    const res = await writeExifMetadata(filePath, {
      EXIF: { ImageDescription: 'kept', Orientation: 'not-an-orientation' },
    });

    // The good tag lands, so the write is ok — but the rejected one must not be silent.
    expect(res.ok).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);

    const meta = await readExifMetadata(filePath);
    expect(meta.exif?.ImageDescription).toBe('kept');
  });

  it('writes a PNG description without the derived IHDR fields sinking the write', async () => {
    const filePath = await pngFixture('desc.png');

    // What the ExifDialog's "Add Description" produces for a PNG.
    const res = await writeExifMetadata(filePath, { png: { Description: 'a caption' } });

    expect(res).toEqual({ ok: true, warnings: [] });
    const meta = await readExifMetadata(filePath);
    expect(meta.png?.Description).toBe('a caption');
  });

  it('drops display-name tags (e.g. PNG "Image Width") instead of failing the whole write', async () => {
    const filePath = await pngFixture('mixed.png');

    // "Image Width" is a display name, not a tag name; ExifTool rejects the
    // entire write if it is passed through, taking the good tag down with it.
    const res = await writeExifMetadata(filePath, {
      png: { 'Image Width': '40', Description: 'survives' },
    });

    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/Image Width/);

    const meta = await readExifMetadata(filePath);
    expect(meta.png?.Description).toBe('survives');
  });

  it('reports ok with no warnings when there is nothing to write', async () => {
    const filePath = await jpegFixture('empty.jpg');

    expect(await writeExifMetadata(filePath, {})).toEqual({ ok: true, warnings: [] });
  });

  it('skips read-only groups rather than sending them to ExifTool', async () => {
    const filePath = await jpegFixture('readonly.jpg');

    const res = await writeExifMetadata(filePath, {
      file: { FileName: 'ignored.jpg' },
      EXIF: { ImageDescription: 'written' },
    });

    expect(res).toEqual({ ok: true, warnings: [] });
    expect(path.basename(filePath)).toBe('readonly.jpg');
  });
});
