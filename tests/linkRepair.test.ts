import { describe, it, expect } from 'vitest';
import { replaceIdLinkDestinations } from '../src/renderer/linkRepair';

const SRC = '/notes/thread/index.md';
const BROKEN = '/notes/Job Interview Thread/HUMAN.md';

describe('replaceIdLinkDestinations', () => {
  it('rewrites an angle-bracket destination relative to the source file', () => {
    const content = 'See [HUMAN](<../Job Interview Thread/HUMAN.md> "id:3D6B20DDF") here.';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, '3D6B20DDF', '/notes/Job Interview Thread/PERSON.md'))
      .toBe('See [HUMAN](<../Job Interview Thread/PERSON.md> "id:3D6B20DDF") here.');
  });

  it('switches to a bare destination when the new path needs no brackets', () => {
    const content = '[HUMAN](<../Job Interview Thread/HUMAN.md> "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/notes/thread/sub/human.md'))
      .toBe('[HUMAN](sub/human.md "id:ABC")');
  });

  it('rewrites a bare, percent-encoded destination', () => {
    const content = '[HUMAN](../Job%20Interview%20Thread/HUMAN.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md'))
      .toBe('[HUMAN](../../other/HUMAN.md "id:ABC")');
  });

  it('leaves a link with a different id alone', () => {
    const content = '[HUMAN](<../Job Interview Thread/HUMAN.md> "id:XYZ")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md')).toBe(content);
  });

  it('leaves a link with the same id but another destination alone', () => {
    const content = '[HUMAN](elsewhere.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md')).toBe(content);
  });

  it('leaves links without an id title alone', () => {
    const content = '[HUMAN](<../Job Interview Thread/HUMAN.md> "Some title")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md')).toBe(content);
  });

  it('fixes every matching occurrence and keeps labels', () => {
    const content = [
      'a [one](<../Job Interview Thread/HUMAN.md> "id:ABC")',
      'b [two](../Job%20Interview%20Thread/HUMAN.md "id:ABC")',
    ].join('\n');
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/notes/thread/HUMAN.md')).toBe([
      'a [one](HUMAN.md "id:ABC")',
      'b [two](HUMAN.md "id:ABC")',
    ].join('\n'));
  });

  it('formats a new path containing spaces in angle brackets', () => {
    const content = '[x](old.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, '/notes/thread/old.md', 'ABC', '/notes/thread/new name.md'))
      .toBe('[x](<new name.md> "id:ABC")');
  });

  it('treats a $ in the new path literally', () => {
    const content = '[x](old.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, '/notes/thread/old.md', 'ABC', '/notes/thread/$&cost.md'))
      .toBe('[x]($&cost.md "id:ABC")');
  });

  it('matches an id title containing escaped quotes', () => {
    const content = '[x](old.md "id:A\\"B")';
    expect(replaceIdLinkDestinations(content, SRC, '/notes/thread/old.md', 'A"B', '/notes/thread/new.md'))
      .toBe('[x](new.md "id:A\\"B")');
  });
});
