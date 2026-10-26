import { describe, it, expect } from 'vitest';
import {
  fileIdSuffixOf,
  generateFileId,
  idSuffixLost,
  parseFileIdSuffix,
  stripFileIdSuffix,
  withFileIdSuffix,
} from '../src/shared/fileIdSuffix';

describe('parseFileIdSuffix', () => {
  it('splits a name carrying an id before its extension', () => {
    expect(parseFileIdSuffix('report--3D6B20DDF.pdf')).toEqual({ base: 'report', id: '3D6B20DDF', ext: '.pdf' });
  });

  it('handles a name with no extension', () => {
    expect(parseFileIdSuffix('Makefile--3D6B20DDF')).toEqual({ base: 'Makefile', id: '3D6B20DDF', ext: '' });
  });

  it('puts the id before the last extension only', () => {
    expect(parseFileIdSuffix('archive.tar--3D6B20DDF.gz')).toEqual({ base: 'archive.tar', id: '3D6B20DDF', ext: '.gz' });
  });

  it('keeps double hyphens inside the base name', () => {
    expect(parseFileIdSuffix('a--b--3D6B20DDF.png')).toEqual({ base: 'a--b', id: '3D6B20DDF', ext: '.png' });
  });

  it('does not take timestamp names for ids', () => {
    expect(parseFileIdSuffix('2026-10-25--03-04-05-PM.png')).toBeNull();
  });

  it('requires exactly 9 uppercase hex characters', () => {
    expect(parseFileIdSuffix('report--3d6b20ddf.pdf')).toBeNull();
    expect(parseFileIdSuffix('report--3D6B20DD.pdf')).toBeNull();
    expect(parseFileIdSuffix('report--3D6B20DDFF.pdf')).toBeNull();
    expect(parseFileIdSuffix('report--3D6B20DDG.pdf')).toBeNull();
    expect(parseFileIdSuffix('--3D6B20DDF.pdf')).toBeNull();
  });
});

describe('withFileIdSuffix / stripFileIdSuffix', () => {
  it('inserts the id before the extension', () => {
    expect(withFileIdSuffix('report.pdf', 'ABC123DEF')).toBe('report--ABC123DEF.pdf');
    expect(withFileIdSuffix('Makefile', 'ABC123DEF')).toBe('Makefile--ABC123DEF');
    expect(withFileIdSuffix('.hidden', 'ABC123DEF')).toBe('.hidden--ABC123DEF');
  });

  it('round-trips through parse and strip', () => {
    const named = withFileIdSuffix('my report.v2.pdf', generateFileId());
    expect(parseFileIdSuffix(named)?.ext).toBe('.pdf');
    expect(stripFileIdSuffix(named)).toBe('my report.v2.pdf');
  });

  it('leaves a name without an id alone', () => {
    expect(stripFileIdSuffix('2026-10-25--03-04-05-PM.png')).toBe('2026-10-25--03-04-05-PM.png');
  });
});

describe('fileIdSuffixOf', () => {
  it('reads the id from the last path segment', () => {
    expect(fileIdSuffixOf('/r/a--b/report--3D6B20DDF.pdf')?.id).toBe('3D6B20DDF');
    expect(fileIdSuffixOf('C:\\r\\report--3D6B20DDF.pdf')?.id).toBe('3D6B20DDF');
  });

  it('ignores Markdown files, whose id is in their front matter', () => {
    expect(fileIdSuffixOf('/r/notes--3D6B20DDF.md')).toBeNull();
  });
});

describe('idSuffixLost', () => {
  it('is false for a name that never had an id', () => {
    expect(idSuffixLost('report.pdf', 'annual.pdf')).toBe(false);
  });

  it('is false when the id and extension are kept', () => {
    expect(idSuffixLost('report--3D6B20DDF.pdf', 'annual--3D6B20DDF.pdf')).toBe(false);
    expect(idSuffixLost('report--3D6B20DDF.pdf', 'report--3D6B20DDF.PDF')).toBe(false);
  });

  it('is true when the id is dropped or changed', () => {
    expect(idSuffixLost('report--3D6B20DDF.pdf', 'report.pdf')).toBe(true);
    expect(idSuffixLost('report--3D6B20DDF.pdf', 'report--3D6B20DDE.pdf')).toBe(true);
  });

  it('is true when the extension changes', () => {
    expect(idSuffixLost('report--3D6B20DDF.pdf', 'report--3D6B20DDF.png')).toBe(true);
  });
});
