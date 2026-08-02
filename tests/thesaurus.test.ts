/**
 * Tests for the thesaurus pipeline: the Moby → shipped-file conversion done by the
 * repo-root `build-thesaurus.mjs`, and the main-process side that reads the result
 * (`src/main/thesaurusUtil.ts`).
 *
 * The conversion is a one-time authoring step whose output is committed, so what matters
 * here is that the rules it encodes stay correct. On the lookup side the load-bearing part
 * is reducing a word to its root: Moby is keyed by root words only, so without it a large
 * share of the words in ordinary prose would find nothing at all. That runs in two stages —
 * the AGID-derived alias table, then the suffix rules — and both are covered here, along
 * with the guarantees `buildAliases` must uphold for single-hop resolution to be safe.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { parseMoby, parseAgid, buildAliases, serialize } from '../build-thesaurus.mjs';
import { parseThesaurus, findRoot, lookupThesaurus, singleWordsFirst } from '../src/main/thesaurusUtil';

describe('parseMoby', () => {
  it('keys each line by its root word and keeps the rest as synonyms', () => {
    const entries = parseMoby('huge,immense,vast\nquick,fast,speedy\n');
    expect(entries.get('huge')).toEqual(['immense', 'vast']);
    expect(entries.get('quick')).toEqual(['fast', 'speedy']);
  });

  it('lowercases the root word but leaves synonyms as written', () => {
    // Moby carries proper nouns as synonyms ("Brobdingnagian"), and those should display
    // with their real capitalisation even though lookup is case-insensitive.
    const entries = parseMoby('Huge,Brobdingnagian,vast\n');
    expect(entries.get('huge')).toEqual(['Brobdingnagian', 'vast']);
    expect(entries.has('Huge')).toBe(false);
  });

  it('never lists a word as its own synonym', () => {
    expect(parseMoby('huge,huge,vast\n').get('huge')).toEqual(['vast']);
  });

  it('dedupes repeats within an entry, case-insensitively', () => {
    expect(parseMoby('huge,vast,Vast,immense\n').get('huge')).toEqual(['vast', 'immense']);
  });

  it('skips blank lines and entries with no synonyms', () => {
    // A bare root word would otherwise "succeed" with an empty pill row.
    const entries = parseMoby('huge,vast\n\nlonely\n,orphan\n');
    expect(entries.size).toBe(1);
    expect(entries.has('lonely')).toBe(false);
  });

  it('keeps multi-word synonyms intact', () => {
    expect(parseMoby('walk,walk of life,take the air\n').get('walk'))
      .toEqual(['walk of life', 'take the air']);
  });

  it('does not cap how many synonyms an entry keeps', () => {
    // Breadth is the entire reason this data source was chosen over WordNet; Moby's
    // largest entries run past 1,400 words and ship whole.
    const many = Array.from({ length: 500 }, (_, i) => `syn${i}`);
    expect(parseMoby(`word,${many.join(',')}\n`).get('word')).toHaveLength(500);
  });
});

/**
 * One AGID candidate root for an inflected form. Declared here because the generator is an
 * untyped root `.mjs`, so its exports arrive as `any` and the typed-lint rules reject
 * reaching into them without a shape.
 */
interface AgidCandidate {
  root: string;
  /** POS_RANK of the root's part of speech: verb 0, noun 1, adjective 2. */
  rank: number;
  /** 1 when AGID marked the part of speech questionable (`V?`), else 0. */
  dubious: number;
}

const agidCandidates = (text: string): Map<string, AgidCandidate[]> =>
  parseAgid(text) as Map<string, AgidCandidate[]>;

describe('parseAgid', () => {
  /** The roots AGID offers for `form`, in the order buildAliases would consider them. */
  const rootsFor = (text: string, form: string): string[] =>
    [...(agidCandidates(text).get(form) ?? [])]
      .sort((a, b) => a.dubious - b.dubious || a.rank - b.rank || a.root.localeCompare(b.root))
      .map(c => c.root);

  it('maps every inflected form back to its root', () => {
    const roots = agidCandidates('walk V: walked | walking | walks\n');
    expect([...roots.keys()].sort()).toEqual(['walked', 'walking', 'walks']);
    expect(roots.get('walked')?.[0]?.root).toBe('walk');
  });

  it('captures irregular forms, which is the entire reason AGID is used', () => {
    const text = 'be V: was | were | been\ngo V: went | gone\ngood A: better | best\n';
    expect(rootsFor(text, 'was')).toEqual(['be']);
    expect(rootsFor(text, 'went')).toEqual(['go']);
    expect(rootsFor(text, 'better')).toEqual(['good']);
  });

  it('discards forms AGID flags as incorrect or misspelled', () => {
    // `star` lists "stared!<" because people write it for "starred". Honoring that marker
    // is what stops "stared" resolving to `star` instead of `stare`.
    const text = 'star V: starred, stared!< 1 | stars\nstare V: stared | stares\n';
    expect(rootsFor(text, 'stared')).toEqual(['stare']);
  });

  it('prefers an unquestioned part of speech over a questionable one', () => {
    // `breath V?` exists alongside the genuine `breathe V`.
    const text = 'breath V?: breathed | breathing\nbreathe V: breathed | breathing\n';
    expect(rootsFor(text, 'breathing')[0]).toBe('breathe');
  });

  it('prefers a verb root over a noun root', () => {
    // In prose an inflected word is overwhelmingly a verb form, so "leaves" is `leave`.
    const text = 'leaf N: leaves\nleave V: left | leaving | leaves\n';
    expect(rootsFor(text, 'leaves')[0]).toBe('leave');
  });

  it('strips variant levels and brace notes, and ignores unparseable lines', () => {
    const roots = agidCandidates('be V: was, wast 2 | are {archaic}\nnot a record\n');
    expect(roots.has('wast')).toBe(true);
    expect(roots.has('are')).toBe(true);
  });
});

describe('buildAliases', () => {
  const entries = new Map([['walk', ['stride']], ['be', ['exist']], ['doe', ['deer']]]);

  it('aliases an inflected form to its root', () => {
    const aliases = buildAliases(parseAgid('walk V: walked | walking\n'), entries);
    expect(aliases.get('walked')).toBe('walk');
    expect(aliases.get('walking')).toBe('walk');
  });

  it('skips a form that already has its own synonym entry', () => {
    // The exact-match lookup wins before any alias is consulted, so the alias is dead weight.
    const aliases = buildAliases(parseAgid('deer N: doe\n'), entries);
    expect(aliases.has('doe')).toBe(false);
  });

  it('skips a form whose only roots have no synonym entry', () => {
    // Pointing at a word with no synonyms could only ever produce an empty pane.
    const aliases = buildAliases(parseAgid('fly V: flew | flown\n'), entries);
    expect(aliases.size).toBe(0);
  });

  it('never produces an alias that points at another alias', () => {
    // findRoot resolves a single hop, so a chain would silently dead-end.
    const aliases = buildAliases(parseAgid('be V: was | were | been\nwalk V: walked\n'), entries);
    for (const target of aliases.values()) expect(aliases.has(target)).toBe(false);
  });
});

describe('serialize', () => {
  it('writes tab-separated, comma-joined lines sorted by word', () => {
    const entries = new Map([['quick', ['fast', 'speedy']], ['big', ['large']]]);
    expect(serialize(entries)).toBe('big\tlarge\nquick\tfast,speedy\n');
  });

  it('interleaves alias lines into the same sorted namespace', () => {
    const entries = new Map([['walk', ['stride']]]);
    const aliases = new Map([['ambled', 'walk'], ['walked', 'walk']]);
    expect(serialize(entries, aliases)).toBe('ambled\t=walk\nwalk\tstride\nwalked\t=walk\n');
  });

  it('round-trips through the main process parser', () => {
    const parsed = parseThesaurus(serialize(parseMoby('huge,immense,vast\n')));
    expect(parsed.get('huge')).toBe('immense,vast');
  });
});

describe('parseThesaurus', () => {
  it('indexes each line by its word', () => {
    const map = parseThesaurus('big\tlarge,huge\nquick\tfast\n');
    expect(map.get('big')).toBe('large,huge');
    expect(map.get('quick')).toBe('fast');
  });

  it('skips blank and malformed lines rather than indexing junk', () => {
    expect(parseThesaurus('big\tlarge\n\nno-tab-here\n').size).toBe(1);
  });
});

describe('findRoot', () => {
  // Deliberately includes 'bed' and 'be': stripping "-ed" from a real word is the classic
  // way this goes wrong, and trying the word as written first is what prevents it.
  const index = new Map(
    ['walk', 'create', 'cry', 'watch', 'bus', 'quick', 'happy', 'reply', 'bed', 'be', 'ease']
      .map(w => [w, 'syn'] as const)
  );
  const find = (w: string) => findRoot(w, index);

  it('returns the word unchanged when it has its own entry', () => {
    expect(find('walk')).toBe('walk');
  });

  it('prefers the exact entry over any rule that could strip it', () => {
    // Without this, "-ed" detachment would answer "bed" with synonyms for "be".
    expect(find('bed')).toBe('bed');
  });

  it('detaches regular verb inflections', () => {
    expect(find('walked')).toBe('walk');
    expect(find('walking')).toBe('walk');
    expect(find('walks')).toBe('walk');
    expect(find('created')).toBe('create');
    expect(find('creating')).toBe('create');
    expect(find('creates')).toBe('create');
  });

  it('detaches the y-swapping forms', () => {
    expect(find('replied')).toBe('reply');
    expect(find('cries')).toBe('cry');
    expect(find('happiest')).toBe('happy');
  });

  it('detaches plurals, including the spelling-changing ones', () => {
    expect(find('watches')).toBe('watch');
    expect(find('buses')).toBe('bus');
  });

  it('detaches regular comparatives and superlatives', () => {
    expect(find('quicker')).toBe('quick');
    expect(find('quickest')).toBe('quick');
  });

  it('falls through a rule that produces a non-word to one that works', () => {
    // 'ses' fires first and yields "eas", which is not an entry; 'es' then yields "ease".
    expect(find('eases')).toBe('ease');
  });

  it('refuses to reduce a word to a two-letter stem', () => {
    // 'bes' -> 'be' is spelling-plausible and semantically nonsense; the length floor
    // is what stops short accidents like this from reaching the pane.
    expect(find('bes')).toBeNull();
  });

  it('returns null for unknown words', () => {
    expect(find('xyzzy')).toBeNull();
  });
});

describe('findRoot with alias lines', () => {
  // '=take' style values are how irregulars reach their root; see the file-format note in
  // src/main/thesaurusUtil.ts.
  const index = new Map([
    ['take', 'grab,seize'],
    ['do', 'perform'],
    ['doe', 'deer'],
    ['walk', 'stride'],
    ['took', '=take'],
    ['does', '=do'],
    ['dangling', '=missing'],
  ]);
  const find = (w: string) => findRoot(w, index);

  it('follows an alias to the entry that holds the synonyms', () => {
    expect(find('took')).toBe('take');
  });

  it('prefers the alias over a suffix rule that would reach a different word', () => {
    // This is the case the alias table exists to fix: '-es' -> '-e' finds the real word
    // "doe" first, so without the alias a cursor on "does" showed synonyms for a deer.
    expect(find('does')).toBe('do');
  });

  it('follows an alias reached through a suffix rule', () => {
    // "tooks" is not a word, but the path (rule -> "took" -> alias -> "take") must not
    // dead-end at the alias line.
    expect(find('tooks')).toBe('take');
  });

  it('returns null when an alias points at a missing entry, rather than the alias itself', () => {
    // A malformed file must degrade to "no synonyms", never to a wrong or unresolvable key.
    expect(find('dangling')).toBeNull();
  });

  it('still prefers a real entry over any alias interpretation', () => {
    expect(find('walk')).toBe('walk');
    expect(find('doe')).toBe('doe');
  });
});

describe('singleWordsFirst', () => {
  it('moves multi-word phrases behind the single words', () => {
    expect(singleWordsFirst(['walk of life', 'stride', 'take the air', 'amble']))
      .toEqual(['stride', 'amble', 'walk of life', 'take the air']);
  });

  it('moves hyphenated terms behind the single words too', () => {
    // A hyphen makes a compound just as a space does — both are things the user is less
    // likely to want to drop straight into a sentence, so both fall to the back.
    expect(singleWordsFirst(['first-rate', 'lovely', 'good-looking', 'fair']))
      .toEqual(['lovely', 'fair', 'first-rate', 'good-looking']);
  });

  it('preserves the original order within each group', () => {
    // Moby entries are alphabetical and have no relevance ranking, so that order is all
    // there is to keep — a partition keeps it without depending on a stable sort.
    // Spaces and hyphens land in the same bucket, interleaved as they were.
    expect(singleWordsFirst(['a b', 'apple', 'c-d', 'banana', 'e f', 'cherry']))
      .toEqual(['apple', 'banana', 'cherry', 'a b', 'c-d', 'e f']);
  });

  it('handles the all-words, all-compound and empty cases', () => {
    expect(singleWordsFirst(['one', 'two'])).toEqual(['one', 'two']);
    expect(singleWordsFirst(['on the nose', 'well-nigh'])).toEqual(['on the nose', 'well-nigh']);
    expect(singleWordsFirst([])).toEqual([]);
  });
});

describe('lookupThesaurus', () => {
  // A stand-in for the packaged resources tree, holding a small thesaurus.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkbrowser-thesaurus-'));
  fs.mkdirSync(path.join(dir, 'thesaurus'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'thesaurus', 'moby.txt.gz'),
    zlib.gzipSync(Buffer.from('quick\tspeedy,in nothing flat,fast\nbig\tlarge\nwalk\tstride\ntook\t=take\ntake\tgrab\n', 'utf-8')),
  );
  const paths = { resourcesPath: dir, appPath: dir, isPackaged: true };

  it('returns single words before phrases, reporting the word itself as the root', async () => {
    // "in nothing flat" sits between the two words in the file; the pane gets it last.
    expect(await lookupThesaurus('quick', paths))
      .toEqual({ lemma: 'quick', synonyms: ['speedy', 'fast', 'in nothing flat'] });
  });

  it('matches case-insensitively and ignores surrounding whitespace', async () => {
    expect(await lookupThesaurus('  Quick ', paths))
      .toEqual({ lemma: 'quick', synonyms: ['speedy', 'fast', 'in nothing flat'] });
  });

  it('answers an inflected word from its root, and says which', async () => {
    // The reported root is what lets the pane admit it is showing "walk" for "walked".
    expect(await lookupThesaurus('walked', paths)).toEqual({ lemma: 'walk', synonyms: ['stride'] });
  });

  it('resolves an alias to real synonyms, never returning the alias marker', async () => {
    expect(await lookupThesaurus('took', paths)).toEqual({ lemma: 'take', synonyms: ['grab'] });
  });

  it('returns nothing for an unknown or empty word', async () => {
    expect(await lookupThesaurus('xyzzy', paths)).toEqual({ lemma: null, synonyms: [] });
    expect(await lookupThesaurus('   ', paths)).toEqual({ lemma: null, synonyms: [] });
  });
});

describe('the shipped data file', () => {
  // Read directly rather than through lookupThesaurus: that function caches its index in a
  // module singleton (deliberately — the decompress-and-parse must happen once per session),
  // which the temp-directory suite above has already populated.
  const shipped = path.join(__dirname, '..', 'resources', 'thesaurus', 'moby.txt.gz');
  const index = () => parseThesaurus(zlib.gunzipSync(fs.readFileSync(shipped)).toString('utf-8'));

  it('exists and is indexable', () => {
    // Guards the packaging contract: forge.config.ts copies resources/thesaurus verbatim,
    // so a missing or renamed file here is invisible until the packaged app is run.
    expect(fs.existsSync(shipped)).toBe(true);
    expect(index().size).toBeGreaterThan(29_000);
  });

  it('is the only data file under resources/thesaurus', () => {
    // The WordNet-derived files this replaced must not linger: they are dead weight, and a
    // stale one left behind would quietly make it ambiguous which source is live.
    expect(fs.readdirSync(path.dirname(shipped)).sort()).toEqual(['moby.txt.gz']);
  });

  it('gives everyday words the breadth this data source was chosen for', () => {
    const map = index();
    // The whole reason for moving off WordNet: it offered five words for "huge".
    const huge = map.get('huge')?.split(',') ?? [];
    expect(huge.length).toBeGreaterThan(40);
    for (const w of ['colossal', 'enormous', 'gigantic', 'immense', 'mammoth', 'tremendous', 'vast']) {
      expect(huge).toContain(w);
    }
    // WordNet had no entry at all for this one, which is what first exposed the problem.
    expect(map.get('underneath')?.split(',') ?? []).toEqual(expect.arrayContaining(['below', 'beneath']));
  });

  it('resolves regular inflections through root detachment', () => {
    const map = index();
    expect(findRoot('walked', map)).toBe('walk');
    expect(findRoot('creating', map)).toBe('create');
    expect(findRoot('replied', map)).toBe('reply');
    expect(findRoot('quickest', map)).toBe('quick');
    // Words that already have entries are still answered as themselves.
    expect(findRoot('huge', map)).toBe('huge');
    expect(findRoot('bed', map)).toBe('bed');
  });

  it('resolves irregular inflections through the alias table', () => {
    // These are the most common verbs in English and no suffix rule can reach any of them;
    // before the alias table a cursor on any of them found nothing at all.
    const map = index();
    for (const [form, root] of [
      ['was', 'be'], ['were', 'be'], ['been', 'be'], ['had', 'have'], ['has', 'have'],
      ['took', 'take'], ['went', 'go'], ['brought', 'bring'], ['told', 'tell'],
      ['knew', 'know'], ['gave', 'give'], ['feet', 'foot'], ['sat', 'sit'], ['got', 'get'],
    ] as const) {
      expect([form, findRoot(form, map)]).toEqual([form, root]);
    }
  });

  it('lets a plural with its own Moby entry keep it, rather than aliasing it away', () => {
    // "children" carries its own synonym list in Moby, so exact match wins and the reader
    // gets that list instead of "child"'s. buildAliases skips such forms for this reason.
    expect(findRoot('children', index())).toBe('children');
  });

  it('resolves the ambiguous forms the suffix rules got wrong', () => {
    const map = index();
    // '-es' -> '-e' reaches the real word "doe" before "do"; the alias must win.
    expect(findRoot('does', map)).toBe('do');
    // AGID flags "stared" under `star` as a misspelling, so it must resolve to "stare".
    expect(findRoot('stared', map)).toBe('stare');
    expect(findRoot('hoped', map)).toBe('hope');
    expect(findRoot('breathing', map)).toBe('breathe');
  });

  it('never leaves an alias pointing at a missing entry or at another alias', () => {
    // Both would silently produce an empty pane for a word that should have synonyms.
    const map = index();
    let aliases = 0;
    for (const [, value] of map) {
      if (!value.startsWith('=')) continue;
      aliases++;
      const target = map.get(value.slice(1));
      expect(target).toBeDefined();
      expect(target?.startsWith('=')).toBe(false);
    }
    expect(aliases).toBeGreaterThan(30_000);
  });
});
