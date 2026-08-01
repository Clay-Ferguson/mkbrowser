# Thesaurus View (Cursor-Driven Synonym Strip)

<!-- TOC -->

* [Overview](#overview)
* [The On/Off Switch (`enableThesaurus`)](#the-onoff-switch-enablethesaurus)
* [Why Moby, and What Was Rejected](#why-moby-and-what-was-rejected)
* [The Data File and Its Generator](#the-data-file-and-its-generator)
* [Packaging the Data](#packaging-the-data)
* [Main Process: `thesaurusUtil.ts`](#main-process-thesaurusutilts)
* [Finding the Root Word](#finding-the-root-word)
* [The IPC Surface](#the-ipc-surface)
* [Renderer: Detecting the Word Under the Cursor](#renderer-detecting-the-word-under-the-cursor)
* [Wiring Into `CodeMirrorEditor`](#wiring-into-codemirroreditor)
* [The Store Slice, and Why It Exists](#the-store-slice-and-why-it-exists)
* [`ThesaurusView` Rendering](#thesaurusview-rendering)
* [Clicking a Pill: Insert, Never Replace](#clicking-a-pill-insert-never-replace)
* [Testing](#testing)
* [Gotchas](#gotchas)
* [Invariants](#invariants)
* [Code Locations](#code-locations)

<!-- /TOC -->

## Overview

While a file is open for editing in **single-file mode** (`BrowseFile.tsx`), a strip below the editor shows synonyms for the word under the cursor, as pills. Clicking one inserts it into the document after that word — it never replaces it (see [Clicking a Pill](#clicking-a-pill-insert-never-replace)).

There is no gesture to invoke it. The user clicks a word (or simply stops typing), and after ~2 seconds of stillness the synonyms appear. The strip is mounted **only while editing** and only by `BrowseFile` — inline edits in the folder listing (`BrowseView`) render no strip at all.

A checkbox in the strip's corner turns the whole feature off, persistently — see [The On/Off Switch](#the-onoff-switch-enablethesaurus).

The data flows one way, across the whole three-process boundary:

```
CodeMirror ViewPlugin (idle timer)          src/renderer/editor/editorThesaurusUtil.ts
  -> setThesaurusWord(word)                 src/store/thesaurus.ts
    -> store field `thesaurusWord`          src/shared/types.ts (AppState)
      -> ThesaurusView reads it             src/components/editor/ThesaurusView.tsx
        -> api.lookupThesaurus(word)        src/renderer/api.ts
          -> ipcRenderer 'lookup-thesaurus' src/preload.ts
            -> main handler                 src/main.ts
              -> lookupThesaurus()          src/main/thesaurusUtil.ts
                -> resources/thesaurus/moby.txt.gz
```

Only the **word** travels through the store. The lookup itself happens in `ThesaurusView`, which is deliberate: an editor with no strip mounted never causes the data file to be read at all.

## The On/Off Switch (`enableThesaurus`)

A checkbox in the strip's top-left corner is the feature's master switch, backed by `settings.enableThesaurus` (a `boolean`, defaulting to **true**) and persisted to `config.yaml` like any other setting.

**Off means off, not hidden.** The whole point of the switch is that the idle plugin costs something on every keystroke, so nothing may run when it is unchecked:

| Layer | What the flag does |
|---|---|
| `createThesaurusPlugin` | `schedule()` returns without arming a timer, so no `setTimeout`, no word scan, no report. `report()` re-checks, because the user can uncheck the box during a 2-second countdown already in flight. |
| `setEnableThesaurus` | Clears `thesaurusWord` in the same `set()` — one atomic patch, per the single-store rule. |
| `ThesaurusView` | The lookup effect returns early, so the main process is never asked to read the 25 MB data file. |

**The flag is passed to the plugin as a getter, not a value.** `createThesaurusPlugin(setThesaurusWord, () => getSettings().enableThesaurus)` — the extension list is built **once at mount** and never reconfigured (see [Wiring Into `CodeMirrorEditor`](#wiring-into-codemirroreditor)), and the checkbox that flips the flag sits in the pane below that very editor. A captured value would leave the setting inert until the next edit began. This is also the reason `schedule()` clears `lastReported` while disabled: the store's word was cleared too, so returning to the same word must not be suppressed as a repeat.

There is no reactive channel from the store *into* the plugin, so **re-enabling takes effect on the next cursor move or keystroke** rather than instantly. That is a deliberate non-feature: adding one would mean reconfiguring a compartment on a setting almost nobody toggles twice.

The strip therefore stays mounted whenever editing, whatever the flag says — with the pills gone it is one row tall, which is the only place the switch can live. (`BrowseFile` still mounts it only while editing, so the setting is reachable only from an open editor.)

## Why Moby, and What Was Rejected

This is the part worth reading before "improving" the data source. Several obvious-looking approaches were tried, measured, and abandoned. Do not redo them.

**The requirement is breadth.** The feature is judged on whether `huge` returns something like a real thesaurus (~50 words), not on precision.

| Approach | `huge` returns | Verdict |
|---|---|---|
| WordNet / MyThes (the original implementation) | **5** — immense, vast, Brobdingnagian, large, big | Rejected. Far too thin. |
| npm `thesaurus` | 4 | Same data. |
| npm `word-thesaurus` | 4 | Same data. |
| npm `js-synonyms` | 5 | Same data. |
| npm `synonyms-array` | 6 | Same data. |
| WordNet + adjective cluster expansion | 87, well-ranked | Rejected — see below. |
| **Moby Thesaurus (current)** | **54** | Shipped. |
| Datamuse `ml=` API | 30, best quality | Rejected — needs network. |

Key findings, each verified empirically:

- **No offline npm library beats what WordNet already gives.** They all wrap the same WordNet database, so they all return the same handful. Swapping in a library changes nothing. This was checked by installing and running each one.
- **WordNet is a lexical database built on strict synonymy, not a writer's thesaurus.** Its synset for "huge" genuinely contains only `{huge, immense, vast, Brobdingnagian}`. Some common words (`underneath`) have *no usable entry at all* — WordNet records it as two singleton synsets with zero relations.
- **WordNet adjective cluster expansion works but only for adjectives.** Walking satellite → cluster head → all sibling satellites yields 87 well-ranked words for `huge`. But nouns and verbs have no cluster structure, so `walk` stayed at 8. Coordinate-term expansion for nouns/verbs was tried and was too noisy (`walk` → *condemn, enforce, pressure*).
- **Ranking Moby by corpus frequency makes it worse, not better.** Using WordNet's `cntlist.rev` tag counts to sort Moby's lists floated common-but-irrelevant words to the top (`walk` → *turn, area, place, number, art, inch*). Frequency is not relevance.
- **Reciprocal-link ranking of Moby also fails.** Keeping only terms whose own entry links back *dropped* `below` and `beneath` from `underneath` while keeping `bedrock` and `buttocks`.

Moby's known cost, accepted deliberately: entries are **alphabetical with no relevance ranking**, so visible noise is unavoidable (`huge` leads with *Atlantean, Brobdingnagian, Cyclopean*). This was an explicit product decision — breadth over ordering.

## The Data File and Its Generator

- **`build-thesaurus.mjs`** (repo root) — the generator. Its header documents the source URLs, licensing, and the derivation rules (which of AGID's annotations are honored, and why); **that reasoning is not duplicated here.** Read the file itself before modifying the pipeline.
- **`resources/thesaurus/moby.txt.gz`** — the generated, **committed** data file. 9.4 MB gzipped (~25 MB raw). It holds two kinds of line in one namespace: 30,195 synonym entries (2,519,306 synonyms, average 83 per word, nothing capped or filtered) and 36,512 inflection aliases (see [Finding the Root Word](#finding-the-root-word)).

Two things about the generator that matter operationally:

1. **It is a one-time authoring tool, not part of the build.** Nothing in `npm run package` invokes it. It is run manually (`node build-thesaurus.mjs`) only to regenerate the data, and its output is committed.
2. It lives at the repo root alongside `compiler-coverage.mjs` and `bundle-fingerprint.mjs`, matching the convention that root `.mjs` tools are untyped and unlinted (see the `files` globs in `eslint.config.mjs`).

`moby.txt.gz` must remain the **only** file under `resources/thesaurus/`. A unit test asserts this, because earlier iterations shipped `thesaurus.txt.gz` (MyThes) and `lemmas.txt.gz` (WordNet exception lists) and a leftover would make it ambiguous which source is live.

### The file format

This is the contract between `build-thesaurus.mjs` (writer) and `src/main/thesaurusUtil.ts` (reader) — the one thing that must stay in sync between them. Gzipped UTF-8 text, one record per line, sorted by key. Two kinds of line share a single namespace, told apart by whether the value begins with `=`:

Five consecutive lines from the shipped file, truncated at the right (tabs shown as `→`):

```
hug→abduct,accost,accueil,address,adhere,adhere to,agglomerate,around,bear,bear hug,…
huge→Atlantean,Brobdingnagian,Cyclopean,Gargantuan,Herculean,Homeric,abysmal,…
hugeness→ampleness,amplitude,boundlessness,bulk,enormity,enormousness,expanse,…
hugenesses→=hugeness
huger→=huge
```

| | |
|---|---|
| **Synonym line** | `word` TAB `syn1,syn2,syn3…` — the key holds the synonyms directly |
| **Alias line** | `form` TAB `=root` — an inflected form pointing at the entry that holds them |

Rules the reader depends on:

- **Tab separates key from value; the first tab wins.** No synonym contains a tab (verified against the upstream Moby file).
- **Comma separates synonyms.** No synonym contains a comma. Multi-word synonyms are ordinary values (`walk of life`, `take the air`).
- **`=` is reserved as the alias marker.** Verified absent from Moby in both positions — no key and no synonym list begins with it.
- **Keys are lowercased; synonyms keep their original case** (so `Brobdingnagian` displays properly while lookup stays case-insensitive).
- **No positional dependency whatsoever.** The reader does `split('\n')` → `indexOf('\t')` → `slice()`, and holds no byte offsets or line numbers. Adding, removing, or reordering lines is always safe; the sort order is for human diffability, not correctness.

That last point is why a regenerated file with different content can be dropped in without touching any code. What *would* break the reader is changing a delimiter, the alias marker, or the one-record-per-line shape.

⚠️ **Nothing verifies that the committed `moby.txt.gz` was produced by the current `build-thesaurus.mjs`.** If you change the generator's parsing or output logic, re-run it and commit the result — the tests will not catch the drift (see [Gotchas](#gotchas)).

## Packaging the Data

`forge.config.ts` lists `./resources/thesaurus` in `packagerConfig.extraResource`, next to `./resources/dictionaries`. That copies the folder verbatim to `<resources>/thesaurus/` in the packaged app.

`thesaurusFilePath()` in `src/main/thesaurusUtil.ts` therefore branches exactly like the existing dictionary loader in `main.ts`:

```ts
isPackaged ? path.join(resourcesPath, 'thesaurus', 'moby.txt.gz')
           : path.join(appPath, 'resources', 'thesaurus', 'moby.txt.gz')
```

The paths are passed **in** as an argument rather than read from `app` inside the util, which is what makes `lookupThesaurus` unit-testable against a temp directory.

⚠️ A packaging mistake here is invisible to lint, unit tests, and `npm run package` itself. Verify with `npm run package` and then check `out/mk-browser-linux-x64/resources/thesaurus/`.

For Playwright, `tests/e2e/global-setup.ts` copies `resources/` into `.vite/build/resources/`, so the dev branch resolves correctly under the e2e harness.

## Main Process: `thesaurusUtil.ts`

`src/main/thesaurusUtil.ts` is main-process only (`node:fs`, `node:zlib`).

- **Lazy and cached.** Module-level `entries: Map<string, string> | null` and `loadingPromise`. The file is never read until the first lookup, so users who never open the editor pay nothing. Concurrent callers share the one in-flight promise so the ~25 MB decompress-and-parse happens once per session.
- **Failure is retryable.** The `.catch` clears `loadingPromise` before rethrowing, so a later lookup can retry rather than being permanently stuck on a rejected promise.
- **`parseThesaurus(text)`** splits on the first tab per line and stores the raw value as **one string**, interpreting it only for the key actually looked up. Eagerly splitting 2.5 M synonyms would cost far more memory than the raw text, for arrays almost none of which are read. Both synonym lines and alias lines land in this one map.

Because the cache is a module singleton, **tests that exercise `lookupThesaurus` against a temp fixture poison it for later tests in the same file.** The shipped-data tests deliberately call `parseThesaurus`/`findRoot` directly instead of going through `lookupThesaurus`.

## Finding the Root Word

**Moby is keyed by root words only.** It has `walk` but not `walked`, `take` but not `took`. Prose is mostly inflected, so without a reduction step the strip goes blank on most verbs — measured at **41% of prose tokens** finding nothing with exact matching alone.

`findRoot(word, index)` in `src/main/thesaurusUtil.ts` resolves in two stages: the **alias table** first, then the **suffix rules**. Both mechanisms are documented at their definitions; what follows is the reasoning that does not belong in either file.

### Why there are two mechanisms

They cover disjoint failure modes, and neither alone is sufficient:

| | covers | misses |
|---|---|---|
| `DETACHMENT_RULES` (suffix heuristics) | regular inflections — `walked`, `creating`, `replied` | every irregular: `was`, `took`, `went`, `brought` |
| Alias table (AGID data) | everything AGID records, irregulars included | words AGID has no entry for at all |

Measured over ~284k words of prose (two public-domain novels plus `docs/USER_GUIDE.md`):

| approach | prose tokens resolved |
|---|---|
| exact match only | 58.7% |
| suffix rules only | 67.7% |
| alias table only | 72.6% |
| **both (shipped)** | **72.7%** |

The 5-point jump from rules to aliases is almost entirely irregular verbs — *was, had, were, are, been, has, did, seen, came, went, took, told, knew, gave, brought* — i.e. the most common words in the language. That is why the alias table was added.

The residual ~27% is function words and proper nouns (*the, and, that, his, Elizabeth, Ahab*). Those are absent from Moby's 30,195-word vocabulary and should be; it is not a lemmatization failure and no lemmatizer will fix it.

### Why the alias table wins over the rules

Aliases are authoritative morphology; the rules are a heuristic. The concrete case that forces the ordering is **`does`**: the `-es`→`-e` rule reaches `doe`, a real Moby entry, so before the alias table a cursor on "does" showed synonyms for a female deer. It occurred 196 times in the benchmark corpus.

### Why the rules were kept

They are far more accurate than they look. Benchmarked against AGID over the same corpus, they fired on 5,072 words and produced a root AGID does not recognise **6 times (0.1%)** — and five of those six are 1–2× rarities (`maned`, `legatees`, `corpses`, `liest`, `slided`). The sixth was `does`, now fixed by the alias table. They also keep working for words AGID has no record of. Deleting them would trade a measurable coverage loss for no simplification worth having.

### Alternatives that were evaluated and rejected

- **`wink-lemmatizer`** (npm, maintained) — measured **identically** to AGID at 72.6%. Rejected because it would be a *runtime* main-process dependency: it must go in `dependencies` and physically ship inside the asar. AGID gets the same result as a build-time input with no dependency at all.
- **`javascript-lemmatizer`** (npm) — 72.3%, same objection.
- **Porter/Snowball stemmers** (`stemmer`, `porter2`, …) — wrong tool entirely. Stemmers produce non-words (`creating` → `creat`), which can never match a key in a real word list.
- **A second data file for the aliases.** Rejected to preserve the one-file invariant; the aliases share `moby.txt.gz` instead, at a cost of ~197 KB (+2.1%).

Also worth knowing: **Moby itself publishes no guidance on this.** It is a bare comma-separated dump with no header, README, code, or API, so there is no upstream convention to follow and no reference implementation to copy. Every consumer solves this themselves.

### Invariants the generator guarantees

`findRoot` resolves a single alias hop and never chains, which is safe only because `buildAliases` enforces both of these:

- Every alias target is a **real synonym entry**, never another alias.
- A form that already has its own Moby entry is **never** aliased away — this is why `children` keeps its own synonym list rather than deferring to `child`.

A unit test re-checks both against the shipped file, so a generator change cannot quietly break them.

## The IPC Surface

Standard three-file sync (see `AGENTS.md`):

| File | Change |
|---|---|
| `src/main.ts` | `ipcMain.handle('lookup-thesaurus', ...)` |
| `src/preload.ts` | `lookupThesaurus: (word) => ipcRenderer.invoke('lookup-thesaurus', word)` |
| `src/shared/shared.ts` | `lookupThesaurus` on `ElectronAPI`, plus the `ThesaurusLookup` interface |

```ts
export interface ThesaurusLookup {
  /** The entry the synonyms came from: the word as typed when it had its own
   *  entry, the root when it did not, null when nothing was found. */
  lemma: string | null;
  synonyms: string[];
}
```

`lemma` exists so the UI can be honest that a cursor on `walked` is showing `walk`'s synonyms — a base form next to an inflected one is a grammar mismatch the user should see coming when they click a pill.

The main handler **swallows errors** and resolves `{ lemma: null, synonyms: [] }` after logging. A missing or corrupt data file leaves the pane empty rather than surfacing an error dialog mid-edit.

## Renderer: Detecting the Word Under the Cursor

`src/renderer/editor/editorThesaurusUtil.ts` — a plain `.ts` module (not a component), so the React Compiler never touches it.

```ts
export const THESAURUS_IDLE_MS = 2000;
export const MIN_THESAURUS_WORD_LENGTH = 3;
export function thesaurusWordAtCursor(state: EditorState): string | null
export function createThesaurusPlugin(onWord: (word: string | null) => void)
```

**`thesaurusWordAtCursor(state)` takes an `EditorState`, not an `EditorView`.** The cursor and document are all it needs, and taking the state is what lets it be unit-tested with no DOM (`tests/thesaurusWordAtCursor.test.ts` builds bare `EditorState.create(...)` values).

It **reuses `wordAt()` from `src/components/editor/spellChecker.ts`** rather than writing its own tokenizer, so the thesaurus and the right-click spelling suggestions can never disagree about where a word begins and ends. It skips YAML front matter via `frontMatterEndLine()` and words shorter than `MIN_THESAURUS_WORD_LENGTH`.

The `ViewPlugin` returned by `createThesaurusPlugin`:

- `update()` restarts the timer on `docChanged || selectionSet || focusChanged`. Both typing *and* cursor movement reset it.
- `report()` has two guards that matter:
  - **`if (!view.hasFocus) return;`** — several editors can be mounted at once (every expanded entry in a folder listing has one). Without this, whichever was constructed last would feed the pane.
  - **`if (word === this.lastReported) return;`** — arrow-keying within one word must not re-trigger a lookup and make the pills flicker.
- `destroy()` clears the timer and reports `null`, so ending an edit clears the strip.

## Wiring Into `CodeMirrorEditor`

The plugin is added to the mount-time extension list in `src/components/editor/CodeMirrorEditor.tsx` (~line 540), gated:

```ts
...(cfg.readOnly || isCodeLanguage(cfg.language)
  ? []
  : [createThesaurusPlugin(setThesaurusWord, () => getSettings().enableThesaurus)]),
```

`isCodeLanguage()` is a **module-level helper** added for this feature; it replaced an inline `const` that the spell-check gate used, so both gates now share one definition. Module-level because the React Compiler does not compile plain functions.

The editor view is built **once on mount** from `mountConfigRef`, so this gating is decided per editor instance and never reconfigured. That is correct here: edit mode and view mode are different `CodeMirrorEditor` instances (`key="edit"`). It is also exactly why `enableThesaurus` is handed over as a getter rather than a value — see [The On/Off Switch](#the-onoff-switch-enablethesaurus).

## The Store Slice, and Why It Exists

`src/store/thesaurus.ts` — a one-field slice, registered in `src/store/core.ts` and exported from `src/store/index.ts`.

```ts
export interface ThesaurusSlice { setThesaurusWord: (word: string | null) => void; }
export function setThesaurusWord(word: string | null): void   // thin wrapper
```

`thesaurusWord: string | null` is declared on `AppState` in `src/shared/types.ts` and initialized to `null` in `core.ts`.

**The slice exists because there is no prop path.** `BrowseFile` renders the strip, but CodeMirror lives two levels below it inside `TextEntry`/`MarkdownEntry`. The store is the only channel between them. (Per `AGENTS.md`, this is a slice in the single store — do **not** add a second Zustand store.)

`setThesaurusWord` **no-ops when the word is unchanged**. The idle plugin fires on a timer and re-reports are common (focus changes, remounts); patching state anyway would re-run the pane's lookup effect and blink the pills.

## `ThesaurusView` Rendering

`src/components/editor/ThesaurusView.tsx`. Mounted by `BrowseFile.tsx` as `{editing && <ThesaurusView />}` — a **sibling of `<main>`**, not a child, so it is a fixed strip the maximized CodeMirror simply gets shorter by, rather than something that scrolls away with the document.

Two columns: the on/off checkbox (`thesaurus-enabled`), which is always there, and the content area, which is rendered only when enabled. Four content states, each with a `data-testid`:

| State | testid |
|---|---|
| No word under cursor | `thesaurus-idle` |
| Lookup in flight, nothing shown yet | `thesaurus-loading` |
| Word found nothing | `thesaurus-empty` |
| Pills | `thesaurus-synonyms` (container), `thesaurus-label` (the lemma chip) |

The two are a flex row rather than one wrap flow so the switch stays in the corner while the pills reflow past it; `items-start` plus a pill-sized line box on the label is what lines the checkbox up with the *first* row of pills instead of centring it against eight rows. Note that the column costs the pill area ~110px of width, so the same word wraps into more rows than it did before the checkbox existed.

`onSaveSettings` is a prop (from `BrowseFile`, which already receives it) rather than an `api.updateConfig` call of its own, matching how every other persisted toggle in the entry components works.

**Stale handling.** While a new word's lookup is in flight, the *previous* result stays on screen (`result` still holds the old word) and is dimmed via `stale ? ' opacity-50' : ''`. A cursor crossing a sentence would otherwise blank the strip repeatedly, which is more distracting than briefly stale pills.

**The lemma chip.** Rendered only when `result.lemma !== result.word` — i.e. only when there is a base form to disclose. It sits **inside the wrap flow**, not in a column of its own, so when there is nothing to disclose the strip is 100% synonyms. (An earlier version had a permanent "THESAURUS" label in a flex column; it was removed at the user's request.)

**Height.**

```ts
const PILL_ROWS = 8;
const PILL_AREA_MAX_HEIGHT = `calc(${PILL_ROWS} * 1.625rem + ${PILL_ROWS - 1} * 0.375rem)`;
```

A pill is `1.625rem` tall (a `text-sm` `leading-5` line = 1.25rem, plus `py-0.5` top and bottom = 0.25rem, plus 1px borders = 0.125rem) and rows sit `gap-1.5` (0.375rem) apart. **N rows have N−1 gaps** — getting that wrong silently clips the last row mid-pill. Change `PILL_ROWS` alone; the rest follows. The arithmetic holds at every `settings.fontSize` because the pills are `text-sm` regardless of the editor's font, and it depends on the pills setting `leading-5` explicitly rather than inheriting a line height.

**Performance is fine at the extremes and was measured, not assumed.** Moby's largest entries are enormous (`cut` = 1446, `set` = 1151, `turn` = 1107, `run` = 1023; 738 entries exceed 300). Rendering 1446 pills showed no measurable difference from a small entry in the running app, so there is **no render cap** — matching the "maximum coverage" requirement.

## Clicking a Pill: Insert, Never Replace

Clicking a pill **inserts** the synonym just past the word the cursor is in, leaving the original word alone. `the witness replied` + a click on `answer` becomes `the witness replied answer`, and the user deletes whichever word they don't want.

This is a product decision, not a stepping stone to replacement:

- **Moby's lists are unranked breadth** (see [Why Moby](#why-moby-and-what-was-rejected)), so a mis-click is not unlikely — and replacing would silently destroy the user's prose with no preview.
- **The lemma problem disappears.** A cursor on `walked` shows `walk`'s synonyms, so *replacing* would produce "the witness stride". Inserting puts the base form next to the inflected one, where the mismatch is visible and the user fixes it while deleting the original anyway.
- The cost is one manual deletion; the benefit is that no click can ever lose text.

### Where it goes

`synonymInsertPos(state)` — the first whitespace at or after the cursor, else the end of the line. Scanning only the current line is complete rather than a shortcut: a line ends at either a line break (whitespace, so the scan stops there regardless) or the end of the document. It takes an `EditorState` for the same reason `thesaurusWordAtCursor` does — unit-testable with no DOM.

The rule is followed literally at punctuation: `he replied,` inserts *after* the comma. That keeps `replied,` deletable as one unit.

A **leading space is part of the inserted text**, or `walked` + `stride` would come out `walkedstride`. The cursor lands after the insertion and `view.focus()` returns focus to the editor (the click moved it to the pill), so typing carries straight on.

### Getting back into the editor

The store channel runs editor → strip only, and a click needs strip → editor. That direction is a **module-level `sourceView: EditorView | null`** in `editorThesaurusUtil.ts`, set from the plugin's `report()` at the moment it publishes a word and cleared when it reports `null` or is destroyed.

Publishing the word and claiming the strip being the *same event* is what makes this safe: the pills on screen and `sourceView` cannot disagree, because one assignment produces both. With several editors mounted, the focus guard in `report()` has already picked the right one. A module-level reference rather than store state because nothing renders off it — as state it would be a field whose every write triggers a pointless re-render.

`insertSynonymAfterWord(synonym)` returns `false` when there is no view (the editor went away between render and click); `ThesaurusView` logs and does nothing, since there is nothing to tell the user.

Because it is an ordinary `view.dispatch`, the insertion flows through CodeMirror's `updateListener` into the debounced `onChange` like any keystroke — it lands in the store's edit buffer, saves normally, and undoes with Ctrl+Z.

The pills carry `cursor-pointer`, a brighter `hover:` background, and a title; the `tabIndex={-1}` they had while inert is **gone**, so they are keyboard reachable now that they do something.

## Testing

| File | Covers |
|---|---|
| `tests/thesaurus.test.ts` | `parseMoby`/`parseAgid`/`buildAliases`/`serialize` from the generator; `parseThesaurus`, `findRoot` (rules *and* aliases), `lookupThesaurus`; assertions on the **shipped** data file, including that no alias dangles or chains |
| `tests/thesaurusWordAtCursor.test.ts` | `thesaurusWordAtCursor` and `synonymInsertPos` against bare `EditorState`s — word boundaries, front matter, minimum length; insert offsets at word edges, on whitespace, at line and document ends |
| `tests/e2e/private-thesaurus.spec.ts` | The whole chain in the packaged app |

The e2e spec is the only thing that exercises plugin → store → IPC → data file → render together. It asserts: no strip while browsing; strip appears on edit; an **inflected** word (`replied`) is answered from its root with the `reply` label; moving the cursor swaps the pills and the label disappears for a word with its own entry; the strip stays under half the pane height (a runaway guard on the `PILL_ROWS` cap, not a pixel spec); unchecking the box mid-edit drops the pills and shrinks the strip while the checkbox survives, and re-checking it brings synonyms back on the next cursor move; clicking a pill inserts that word into the document after the looked-up word; ending the edit removes it.

Two things the checkbox phase depends on: clicking the checkbox **takes focus out of the editor**, so focus must be clicked back before any keystroke (the plugin reports only from the focused editor); and the re-enable step must move the cursor, since nothing pushes the setting into the running plugin.

The pill-click phase **undoes its own insertion** (Ctrl+Z) before the final phase, and must: `TextEntry` ignores Escape while the buffer differs from the file, so a modified document would strand the "ending the edit removes the strip" assertion. The undo doubles as a check that the insertion is an ordinary entry in CodeMirror's history.

⚠️ **`npm run package` before running e2e after any `src/` change.** `tests/e2e/global-setup.ts` only builds when the bundle is *missing* — it does not detect staleness, so you will silently test old code.

## Gotchas

- **The committed data file can silently drift from the generator.** Nothing checks that `moby.txt.gz` was produced by the current `build-thesaurus.mjs`. The unit tests exercise its parser functions against small synthetic inputs and separately assert properties of the shipped file, but neither notices that regenerating would now yield different bytes. Change the generator's logic → re-run it → commit the output.
- **Picking e2e test words is not obvious.** `shouted` looks like a good lemmatization test but has its own Moby entry (as an adjective) and never reaches `findRoot`. Verify a candidate is genuinely absent from the data before asserting on it.
- **`tsconfig.node.json` has a thesaurus-specific entry.** `tests/thesaurusWordAtCursor.test.ts` imports `editorThesaurusUtil`, which reaches `spellChecker.ts` and so `typo-js` (which ships no types). That project's `include` therefore lists `src/renderer/typo-js.d.ts` alongside `src/global.d.ts`. Removing it breaks `npm run lint` at the *second* `tsc` only.
- **Do not clear `result` when `word` becomes null.** The `react-hooks/set-state-in-effect` lint rule rejects a synchronous `setState` in an effect body. The render already keys off `word`, so the stale result is simply not displayed.
- **No `useCallback`/`useMemo`** anywhere in this feature — React Compiler. Run `node compiler-coverage.mjs src/components/editor/ThesaurusView.tsx` after touching it.
- The strip renders **only** in `BrowseFile`. If you want it in `BrowseView` too, the `view.hasFocus` guard in the plugin already makes multiple mounted editors safe.

## Invariants

1. `resources/thesaurus/` contains exactly one file, `moby.txt.gz`. (Asserted by unit test.)
2. `moby.txt.gz` is generated only by `build-thesaurus.mjs`, and is committed.
3. `findRoot` returns the word itself whenever it is a synonym entry, before any alias or rule is consulted.
4. Every alias target is a real synonym entry, never another alias; a form with its own Moby entry is never aliased away. (Both asserted by unit test.)
5. Only `thesaurusWord` (a string or null) crosses the store; synonyms never do. The return path (a clicked pill) does not use the store at all — it is `sourceView`.
6. The idle plugin reports only from the focused editor, and `sourceView` is set from that same report, so the editor a pill inserts into is always the one its word came from.
7. A clicked pill only ever **adds** text. Nothing in this feature deletes or replaces any of the user's prose.
8. `ThesaurusView` is mounted only while editing, only by `BrowseFile` — and once mounted it renders its on/off checkbox unconditionally, since that is the only control that can turn the feature back on.
9. With `settings.enableThesaurus` false, no timer is armed, no word is scanned, and no lookup is issued.
10. Adding a package for this feature requires human authorization (`AGENTS.md`) — none is currently used.

## Code Locations

| Path | Role |
|---|---|
| `build-thesaurus.mjs` | One-time generator; read its header before touching the pipeline |
| `resources/thesaurus/moby.txt.gz` | The committed data file (9.4 MB): synonym entries + inflection aliases |
| `forge.config.ts` | `extraResource` entry that ships the folder |
| `src/main/thesaurusUtil.ts` | Load/cache, `parseThesaurus`, `findRoot`, `lookupThesaurus` |
| `src/main.ts` | `lookup-thesaurus` IPC handler (~line 211) |
| `src/preload.ts` | Bridge method (~line 14) |
| `src/shared/shared.ts` | `ThesaurusLookup`, `ElectronAPI.lookupThesaurus` |
| `src/shared/types.ts` | `AppState.thesaurusWord` |
| `src/shared/shared.ts` | `AppSettings.enableThesaurus` |
| `src/main/configSchema.ts` | `enableThesaurus` default (`true`) + zod field |
| `src/store/settings.ts` | `setEnableThesaurus` (clears `thesaurusWord` when switched off) |
| `src/store/thesaurus.ts` | The slice + `setThesaurusWord` wrapper |
| `src/store/core.ts` | Slice registration, `thesaurusWord: null` initial state, `enableThesaurus: true` default |
| `src/store/index.ts` | Barrel re-export |
| `src/renderer/editor/editorThesaurusUtil.ts` | Idle `ViewPlugin`, `thesaurusWordAtCursor`, `sourceView` + `synonymInsertPos` / `insertSynonymAfterWord` |
| `src/components/editor/CodeMirrorEditor.tsx` | Extension wiring (~line 540), `isCodeLanguage` (~line 130) |
| `src/components/editor/ThesaurusView.tsx` | The strip, the on/off checkbox, the pill click handler |
| `src/components/views/BrowseFile.tsx` | Mounts the strip, passes `onSaveSettings` (~line 241) |
| `src/components/editor/spellChecker.ts` | Source of the shared `wordAt` tokenizer |
| `tsconfig.node.json` | `typo-js.d.ts` include needed by the thesaurus tests |
