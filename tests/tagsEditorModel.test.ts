import { describe, it, expect } from 'vitest';
import {
  fromLoaded,
  toTagCategories,
  dropBlankTags,
  validate,
  newEditorCategory,
  newEditorTag,
  type EditorCategory,
} from '../src/components/views/tagsEditorModel';
import type { TagCategory } from '../src/shared/tagUtil';

function makeCategory(name: string, tags: [string, string][] = []): EditorCategory {
  return {
    ...newEditorCategory(),
    name,
    tags: tags.map(([n, d]) => ({ ...newEditorTag(), name: n, description: d })),
  };
}

describe('fromLoaded / toTagCategories', () => {
  const loaded: TagCategory[] = [
    { name: 'priority', tags: [{ tag: 'p1', description: 'High' }, { tag: 'p2', description: 'Medium' }] },
    { name: 'all', tags: [] },
  ];

  it('round-trips, preserving order', () => {
    expect(toTagCategories(fromLoaded(loaded))).toEqual(loaded);
  });

  it('assigns unique row ids', () => {
    const editor = fromLoaded(loaded);
    const ids = [...editor.map((c) => c.id), ...editor.flatMap((c) => c.tags.map((t) => t.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flattens multi-line descriptions', () => {
    const editor = fromLoaded([{ name: 'c', tags: [{ tag: 't', description: 'a\nb\n' }] }]);
    expect(editor[0]!.tags[0]!.description).toBe('a b');
  });

  it('trims tag names on the way out', () => {
    expect(toTagCategories([makeCategory('c', [['  t  ', 'd']])])).toEqual([
      { name: 'c', tags: [{ tag: 't', description: 'd' }] },
    ]);
  });
});

describe('dropBlankTags', () => {
  it('drops rows with neither a name nor a description', () => {
    const out = dropBlankTags([makeCategory('c', [['a', ''], ['  ', '  '], ['', 'desc only']])]);
    expect(out[0]!.tags.map((t) => [t.name, t.description])).toEqual([['a', ''], ['', 'desc only']]);
  });
});

describe('validate', () => {
  it('accepts a valid model', () => {
    expect(validate([makeCategory('a', [['x', '']]), makeCategory('b', [['x', '']])])).toBeNull();
  });

  it('rejects an empty category name', () => {
    expect(validate([makeCategory('  ')])).toBe('Category names cannot be empty.');
  });

  it('rejects duplicate category names', () => {
    expect(validate([makeCategory('a'), makeCategory(' a ')])).toBe('Category names must be unique.');
  });

  it('rejects a nameless tag that has a description', () => {
    expect(validate([makeCategory('c', [['', 'desc']])])).toBe('Tags in "c" that have a description need a name.');
  });

  it('rejects duplicate tag names within a category', () => {
    expect(validate([makeCategory('c', [['x', ''], [' x ', '']])])).toBe('Duplicate tag names in category "c".');
  });
});
