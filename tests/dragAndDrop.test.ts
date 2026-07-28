/**
 * Unit tests for the pure drop-validation predicates in src/renderer/dragAndDrop.ts.
 * These decide whether a drag may be dropped at all; the move itself (completeEntryDrop /
 * dropAsAttachment) needs the IPC bridge and is exercised manually / in the packaged app.
 */
import { describe, it, expect } from 'vitest';
import { canDropInto, canDropAsAttachment, parseDragPayload, type DragPayload } from '../src/renderer/dragAndDrop';

function file(path: string): DragPayload {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { path, name, isDirectory: false };
}

function folder(path: string): DragPayload {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { path, name, isDirectory: true };
}

// ---------------------------------------------------------------------------
// canDropInto — dropping onto a folder
// ---------------------------------------------------------------------------

describe('canDropInto', () => {
  it('accepts a file dropped into a different folder', () => {
    expect(canDropInto(file('/root/a/notes.md'), '/root/b')).toBe(true);
  });

  it('rejects a drop into the folder the item already lives in', () => {
    expect(canDropInto(file('/root/a/notes.md'), '/root/a')).toBe(false);
  });

  it('rejects a folder dropped onto itself', () => {
    expect(canDropInto(folder('/root/a'), '/root/a')).toBe(false);
  });

  it('rejects a folder dropped into its own descendant', () => {
    expect(canDropInto(folder('/root/a'), '/root/a/sub/deeper')).toBe(false);
  });

  it('does not treat a sibling with a shared name prefix as a descendant', () => {
    // The boundary-correct check exists so '/root/projects-archive' is not seen
    // as living inside '/root/projects'.
    expect(canDropInto(folder('/root/projects'), '/root/projects-archive')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canDropAsAttachment — dropping onto a file
// ---------------------------------------------------------------------------

describe('canDropAsAttachment', () => {
  it('accepts a file dropped onto a different file in the same folder', () => {
    expect(canDropAsAttachment(file('/root/a/diagram.png'), '/root/a/notes.md')).toBe(true);
  });

  it('accepts a folder dropped onto a file', () => {
    expect(canDropAsAttachment(folder('/root/a/assets'), '/root/a/notes.md')).toBe(true);
  });

  it('rejects a file dropped onto itself', () => {
    // Without this the file would be moved into an .attach folder named after itself.
    expect(canDropAsAttachment(file('/root/a/notes.md'), '/root/a/notes.md')).toBe(false);
  });

  it("rejects a file's own attach folder dropped back onto it", () => {
    expect(canDropAsAttachment(folder('/root/a/notes.md.attach'), '/root/a/notes.md')).toBe(false);
  });

  it('rejects an item that is already attached to that file', () => {
    expect(canDropAsAttachment(file('/root/a/notes.md.attach/diagram.png'), '/root/a/notes.md')).toBe(false);
  });

  it('rejects a folder dropped onto a file it contains', () => {
    expect(canDropAsAttachment(folder('/root/a'), '/root/a/sub/notes.md')).toBe(false);
  });

  it('accepts re-attaching an item from one file to another', () => {
    expect(canDropAsAttachment(file('/root/a/one.md.attach/diagram.png'), '/root/a/two.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseDragPayload
// ---------------------------------------------------------------------------

describe('parseDragPayload', () => {
  it('round-trips a serialized payload', () => {
    const payload = folder('/root/a/assets');
    expect(parseDragPayload(JSON.stringify(payload))).toEqual(payload);
  });

  it('defaults isDirectory to false when absent', () => {
    expect(parseDragPayload('{"path":"/root/a/x.md","name":"x.md"}')).toEqual({
      path: '/root/a/x.md',
      name: 'x.md',
      isDirectory: false,
    });
  });

  it('returns null for an empty string, malformed JSON, or a payload missing fields', () => {
    expect(parseDragPayload('')).toBeNull();
    expect(parseDragPayload('{not json')).toBeNull();
    expect(parseDragPayload('{"path":"/root/a/x.md"}')).toBeNull();
  });
});
