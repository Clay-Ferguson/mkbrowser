// Builds `resources/thesaurus/moby.txt.gz` — the single data file behind the editor's
// thesaurus pane — from the Moby Thesaurus II word list, plus an inflection alias table
// derived from AGID (see AGID_URL below).
//
// This is a ONE-TIME authoring tool, not part of the build: the generated file is
// committed, and nothing in `npm run package` invokes this. Re-run it only to regenerate
// the data:
//
//     node build-thesaurus.mjs
//
// ⚠️ IF YOU CHANGE THE PARSING OR OUTPUT LOGIC BELOW, RE-RUN THIS AND COMMIT THE RESULT.
// Nothing verifies that the committed `moby.txt.gz` was produced by the current version of
// this file. The unit tests exercise these functions against small synthetic inputs and
// separately assert properties of the shipped file, but neither would notice that
// regenerating would now produce different bytes — so the code and the data can silently
// drift apart. The reader (`src/main/thesaurusUtil.ts`) is delimiter-driven and holds no
// byte offsets, so line content and ordering can change freely; what must stay in sync is
// the FORMAT CONTRACT described below.
//
// Source: https://www.gutenberg.org/files/3202/files/mthesaur.txt (~24 MB). Moby Thesaurus
// II was placed in the PUBLIC DOMAIN by its author, Grady Ward, so the derived file ships
// with the app under no conditions at all.
//
// WHY MOBY, given it is not the obvious choice: the alternatives are all WordNet, and
// WordNet is a lexical database built on strict synonymy rather than a writer's thesaurus.
// Its entry for "huge" contains exactly {immense, vast, Brobdingnagian} — and every
// offline npm thesaurus package (`thesaurus`, `word-thesaurus`, `js-synonyms`,
// `synonyms-array`) returns that same handful, because they all wrap the same data. Moby
// gives "huge" 55 words and averages 83 per entry. It is ordered alphabetically with no
// relevance ranking, so the lists carry visible noise; that was accepted deliberately, as
// breadth is the whole point of the feature.
//
// INPUT FORMAT — one line per root word, comma-separated, root word first:
//
//     huge,Atlantean,Brobdingnagian,Cyclopean,Gargantuan,abysmal,astronomic,...
//
// OUTPUT FORMAT — one line per key, tab-separated, the whole file sorted by key. Two kinds
// of line share the one namespace, told apart by the ALIAS_PREFIX on the value:
//
//     huge	Atlantean,Brobdingnagian,Cyclopean,Gargantuan,abysmal,astronomic,...
//     took	=take
//
// A synonym line carries the comma-joined list; an alias line points an inflected form at
// the root that holds them. Verified against the upstream file: no synonym contains a tab,
// and nothing in Moby starts with '=' in either position, so both splits are unambiguous.
// Nothing is capped or filtered — the entries ship exactly as Moby has them.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://www.gutenberg.org/files/3202/files/mthesaur.txt';

// AGID (Automatically Generated Inflection Database), from the SCOWL project — a
// root -> every-inflected-form table for English. Moby is keyed by root words only, and
// `src/main/thesaurusUtil.ts` reduces regular inflections with suffix rules, but those
// rules cannot reach irregulars: "was", "took", "went", "brought". Measured on ~284k words
// of prose, that gap is 5% of all tokens — the most common verbs in the language. AGID is
// where the irregulars come from.
const AGID_URL = 'https://raw.githubusercontent.com/en-wl/wordlist/master/agid/infl.txt';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resources', 'thesaurus');
const OUT_FILE = path.join(OUT_DIR, 'moby.txt.gz');

// Marks an alias line's value. Verified absent from Moby in both positions (no key and no
// synonym list starts with it), so it cannot collide with real data.
const ALIAS_PREFIX = '=';

// Part-of-speech preference when one inflected form belongs to several roots. Verbs first:
// in running prose an inflected word is overwhelmingly a verb form, and this is what makes
// "leaves" resolve to `leave` rather than `leaf`, and "lives" to `live` rather than `life`.
const POS_RANK = { V: 0, N: 1, A: 2 };

/**
 * Parses the Moby word list into `Map<lowercased root word, synonyms[]>`.
 *
 * Root words are lowercased for lookup; entries that collide once lowercased are merged
 * rather than overwriting each other. A word never lists itself, and repeats within an
 * entry are dropped case-insensitively — both occur in the source.
 */
export function parseMoby(text) {
  const result = new Map();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const fields = trimmed.split(',');
    const word = fields[0].trim().toLowerCase();
    if (word.length === 0) continue;

    const existing = result.get(word);
    const synonyms = existing ?? [];
    const seen = new Set([word, ...synonyms.map(s => s.toLowerCase())]);

    for (const field of fields.slice(1)) {
      const term = field.trim();
      const key = term.toLowerCase();
      if (term.length === 0 || seen.has(key)) continue;
      seen.add(key);
      synonyms.push(term);
    }

    if (synonyms.length > 0 && existing === undefined) result.set(word, synonyms);
  }

  return result;
}

/**
 * Parses AGID's `infl.txt` into `Map<inflected form, candidate[]>`, where each candidate is
 * `{ root, rank, dubious }`.
 *
 * INPUT FORMAT — `root POS: slot | slot | ...`, each slot a comma-separated variant list:
 *
 *     run    V: ran | run | running | runs
 *     good   A: better | best
 *     breath V?: breathed | breathing | breaths
 *     star   V: starred, stared!< 1 | starring, staring!< 1
 *
 * Three pieces of AGID's own annotation are honored rather than stripped, because each one
 * prevents a wrong answer:
 *
 * - **`!` and `<` mark a variant as incorrect or a common misspelling.** `star` lists
 *   `stared!<` because people write it for "starred". Treating those as real forms is what
 *   makes "stared" resolve to `star` instead of `stare` (and "hoped" to `hop`), so they are
 *   discarded outright.
 * - **`?` after the POS marks a questionable part of speech.** `breath V?` and `discus V?`
 *   exist alongside the genuine `breathe V` and `discuss V`; preferring the unquestioned
 *   entry is what resolves "breathing" and "discussed" correctly.
 * - **The POS letter itself** breaks the remaining ties (see `POS_RANK`).
 *
 * Trailing variant-level digits (`wast 2`) and `{...}` notes carry no meaning here and are
 * stripped.
 */
export function parseAgid(text) {
  const candidates = new Map();

  for (const line of text.split('\n')) {
    const match = line.match(/^(\S+)\s+([VNA])(\??):\s*(.*)$/);
    if (!match) continue;

    const [, rawRoot, pos, questioned, body] = match;
    const root = rawRoot.toLowerCase();
    const rank = POS_RANK[pos];
    const dubious = questioned === '?' ? 1 : 0;

    for (const slot of body.split('|')) {
      for (const variant of slot.split(',')) {
        const raw = variant.trim();
        // Incorrect form or known misspelling — never a valid way to reach this root.
        if (raw.includes('!') || raw.includes('<')) continue;

        const form = raw
          .replace(/\{[^}]*\}/g, '')
          .replace(/[?~]/g, '')
          .replace(/\s+[\d.]+$/, '')
          .trim()
          .toLowerCase();

        if (form.length === 0 || form === root || !/^[a-z][a-z' -]*$/.test(form)) continue;

        if (!candidates.has(form)) candidates.set(form, []);
        candidates.get(form).push({ root, rank, dubious });
      }
    }
  }

  return candidates;
}

/**
 * Builds the alias table: `Map<inflected form, root>`, covering only forms that need one.
 *
 * A form is skipped when it already has its own Moby entry (the exact-match lookup wins
 * before any alias is consulted) and when none of its roots is a Moby entry (an alias
 * pointing at a word with no synonyms could only ever produce an empty pane). The surviving
 * candidates are ordered by AGID's own confidence signals — unquestioned POS first, then
 * `POS_RANK`, then alphabetically so the output is deterministic.
 *
 * The result is flat by construction: every alias target is a real synonym entry, never
 * another alias, so resolution at lookup time is a single hop.
 */
export function buildAliases(candidates, entries) {
  const aliases = new Map();

  for (const [form, list] of candidates) {
    if (entries.has(form)) continue;

    const best = list
      .filter(c => entries.has(c.root))
      .sort((a, b) => a.dubious - b.dubious || a.rank - b.rank || a.root.localeCompare(b.root))[0];

    if (best !== undefined) aliases.set(form, best.root);
  }

  return aliases;
}

/**
 * Serializes both tables into the one output file, sorted by key so the whole file is a
 * single ordered list. Synonym lines are `word\tsyn1,syn2`; alias lines are `form\t=root`.
 */
export function serialize(entries, aliases = new Map()) {
  const lines = [
    ...[...entries.entries()].map(([w, syns]) => [w, syns.join(',')]),
    ...[...aliases.entries()].map(([form, root]) => [form, ALIAS_PREFIX + root]),
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return lines.map(([k, v]) => `${k}\t${v}`).join('\n') + '\n';
}

async function main() {
  process.stdout.write(`Downloading ${SOURCE_URL}\n`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const source = await response.text();
  process.stdout.write(`  ${source.length.toLocaleString()} bytes\n`);

  const entries = parseMoby(source);

  process.stdout.write(`Downloading ${AGID_URL}\n`);
  const agidResponse = await fetch(AGID_URL);
  if (!agidResponse.ok) {
    throw new Error(`Download failed: ${agidResponse.status} ${agidResponse.statusText}`);
  }
  const agidSource = await agidResponse.text();
  process.stdout.write(`  ${agidSource.length.toLocaleString()} bytes\n`);

  const aliases = buildAliases(parseAgid(agidSource), entries);

  const output = serialize(entries, aliases);
  const gzipped = zlib.gzipSync(Buffer.from(output, 'utf-8'), { level: 9 });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, gzipped);

  const total = [...entries.values()].reduce((sum, list) => sum + list.length, 0);
  process.stdout.write(
    `Wrote ${OUT_FILE}\n` +
    `  ${entries.size.toLocaleString()} words, ${total.toLocaleString()} synonyms ` +
    `(avg ${(total / entries.size).toFixed(1)} per word)\n` +
    `  ${aliases.size.toLocaleString()} inflection aliases\n` +
    `  ${output.length.toLocaleString()} bytes raw, ${gzipped.length.toLocaleString()} bytes gzipped\n`
  );
}

// Only download and write when run as a script — importing this module (the unit tests
// exercise the parser directly) must have no side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
