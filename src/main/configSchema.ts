/**
 * configSchema.ts — runtime validation for the main application config (config.yaml).
 *
 * `~/.config/mk-browser/config.yaml` is plain text on the user's disk that can be
 * hand-edited, synced, merged, or corrupted by external tools, so its parsed
 * contents are untrusted and `js-yaml`'s `load()` returns `unknown`. This mirrors
 * the trust model already applied to `.INDEX.yaml` in `utils/indexUtil.ts`
 * (`IndexYamlSchema` / `parseIndexYaml`).
 *
 * Unlike the index schema, the public `AppConfig` / `AppSettings` types in
 * `shared/shared.ts` are imported by renderer code, so we do NOT derive them via
 * `z.infer` here (that would pull `zod` into the renderer bundle). Instead the
 * hand-written interfaces stay canonical and this schema is cross-checked against
 * them at compile time (see `_SchemaMatchesAppConfig` below), so the two can't
 * drift.
 *
 * Tolerance rules — a corrupt config should degrade per-field, never throw and
 * never wipe the whole config:
 *  - a malformed scalar/enum field → its default (settings) or dropped (optional)
 *  - a `files`-style array that isn't an array → empty list
 *  - an individual array element that doesn't match → dropped (good ones kept)
 *  - unknown / forward-compat keys → preserved (`.loose()`), never stripped
 *  - a non-object top level (scalar, list, empty) → `null` from parseConfigYaml
 */

import { z } from 'zod';
import { AI_PROVIDERS, DEFAULT_IMAGE_SIZE, DEFAULT_PROPERTY_TYPE, PROPERTY_TYPES } from '../shared/shared';
import type { AppConfig, AppSettings } from '../shared/shared';

// ---------------------------------------------------------------------------
// Settings defaults (single source of truth; configMgr imports these)
// ---------------------------------------------------------------------------

export const defaultSettings: AppSettings = {
  fontSize: 'medium',
  sortOrder: 'alphabetical',
  imageCols: 1,
  foldersOnTop: true,
  showToc: true,
  ignoredPaths: '',
  searchDefinitions: [],
  contentWidth: 'medium',
  bookmarks: [],
  calendarItemsFolder: '',
  indexTreeWidth: 'narrow',
  showPropsInEditor: true,
  expandedEditor: false,
  imageSize: DEFAULT_IMAGE_SIZE,
  // Off by default: the synonym strip renders nothing at all while it is off, so a fresh
  // install gets the full editor height. It is opted into from the editor's right-click menu.
  // See: (thesaurus_view.md#the-onoff-switch-enablethesaurus)
  enableThesaurus: false,
  wordWrap: true,
  pasteToAttachmentsFolder: false,
};

/** Returns a fresh `AppSettings` with independent copies of all mutable arrays. */
export function cloneDefaultSettings(): AppSettings {
  return { ...defaultSettings, searchDefinitions: [], bookmarks: [] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * An array field whose individual elements are validated independently: any
 * element that fails `elem` is dropped (the good ones are kept), and a value
 * that isn't an array at all falls back to an empty list. Same shape as the
 * `files` handling in `IndexYamlSchema`.
 */
function tolerantArray<T extends z.ZodType>(elem: T) {
  return z
    .array(z.unknown())
    .transform((arr) =>
      arr.flatMap((e) => {
        const parsed = elem.safeParse(e);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      }),
    )
    .catch(() => [] as z.infer<T>[]);
}

/**
 * A string-keyed map whose values are validated independently: any entry whose
 * value fails `elem` is dropped (the good ones are kept, in key order), and a
 * value that isn't a plain object at all falls back to an empty map. The map
 * counterpart of `tolerantArray`.
 */
function tolerantRecord<T extends z.ZodType>(elem: T) {
  return z
    .record(z.string(), z.unknown())
    .transform((rec) => {
      const out: Record<string, z.infer<T>> = {};
      for (const [key, value] of Object.entries(rec)) {
        const parsed = elem.safeParse(value);
        if (parsed.success) out[key] = parsed.data as z.infer<T>;
      }
      return out;
    })
    .catch(() => ({}) as Record<string, z.infer<T>>);
}

/**
 * Coerce a value to a finite, non-negative number (accepting numeric strings).
 * Returns `undefined` on failure so callers can supply a fallback.
 */
export function coerceNonNegativeNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

const nonNegNumber = z.preprocess(coerceNonNegativeNumber, z.number());

// ---------------------------------------------------------------------------
// Element schemas
// ---------------------------------------------------------------------------

// Two hardening rules applied to every element schema below, both serving the
// top-of-file tolerance contract that a corrupt/legacy config should degrade
// per-field and never wipe a whole record:
//
//  1. Required *enum* fields get `.catch(<default>)` so an obsolete or malformed
//     value (e.g. a legacy `sortBy: line-time`, or an AI `provider` not yet in
//     AI_PROVIDERS) degrades to a sane default instead of failing the element —
//     which `tolerantArray` would then drop, silently deleting the record.
//  2. Every element schema is `.loose()` so unknown / forward-compat keys are
//     preserved across a read→write round-trip, matching what AppSettingsSchema
//     and AppConfigSchema already do at their levels. Without this, a newly
//     added field (the way `searchImageExif` was once added to saved searches)
//     is silently stripped on the next save until the schema is updated.

/**
 * Legacy migration: saved searches once stored the match type
 * (literal/wildcard/advanced) as `searchMode`; move it to `matchType`. A value
 * already under the new key wins.
 *
 * The search target was once a single enum (`target`, earlier `searchTarget`:
 * 'content' | 'filenames'), since replaced by the `searchContents` /
 * `searchNames` booleans. Those old keys are not converted — a definition
 * lacking the booleans just reads back as a File Contents search — but they are
 * dropped here, since `.loose()` would otherwise carry them forward on every save.
 */
function migrateLegacySearchKeys(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const { searchTarget, target, searchMode, ...rest } = value as Record<string, unknown>;
  return { matchType: searchMode, ...rest };
}

// Enum defaults mirror the Search dialog defaults (newSearchDefinition in shared/searchHelpers.ts).
const SearchDefinitionSchema = z.preprocess(migrateLegacySearchKeys, z
  .object({
    name: z.string(),
    // Legacy migration: queries were once saved single-line with each newline
    // encoded as a `{{nl}}` token. They are now stored with real newlines (YAML
    // handles multi-line strings), so decode any old tokens on load.
    searchText: z.string().transform((s) => s.replace(/\{\{nl\}\}/g, '\n')),
    searchContents: z.boolean().catch(true),
    searchNames: z.boolean().catch(false),
    matchType: z.enum(['literal', 'wildcard', 'advanced']).catch('literal'),
    sortBy: z.enum(['modified-time', 'created-time', 'file-name', 'custom']).catch('modified-time'),
    sortDirection: z.enum(['asc', 'desc']).catch('desc'),
    sortExpression: z.string().optional().catch(undefined),
    sortTitle: z.string().optional().catch(undefined),
    tags: z.string().optional().catch(undefined),
    type: z.string().optional().catch(undefined),
    tagCategoryCols: z.string().optional().catch(undefined),
    propertyCols: z.string().optional().catch(undefined),
    searchImageExif: z.boolean().optional(),
    mostRecent: z.boolean().optional(),
  })
  .loose());

const BookmarkSchema = z
  .object({
    path: z.string(),
    name: z.string(),
    isDirectory: z.boolean().optional().catch(undefined),
  })
  .loose();

// An unsupported `provider` degrades to AI_PROVIDERS[0] rather than dropping the
// whole model (name, model id, pricing): a mis-routed model is visible and
// fixable in the AI Models tab, whereas a vanished one is a silent surprise.
// See: (USER_GUIDE.md#configuring-ai-models)
const AIModelConfigSchema = z
  .object({
    name: z.string(),
    provider: z.enum(AI_PROVIDERS).catch(AI_PROVIDERS[0]),
    model: z.string(),
    baseUrl: z.string().optional().catch(undefined),
    inputPer1M: nonNegNumber.catch(0),
    outputPer1M: nonNegNumber.catch(0),
    vision: z.boolean().catch(false),
  })
  .loose();

const AIRewritePromptDefSchema = z
  .object({
    name: z.string(),
    prompt: z.string(),
  })
  .loose();

// User-defined object types (`types:` in config.yaml, edited in the Types Editor).
// A bare `name:` with no children parses as YAML null; treat it as an empty
// definition rather than dropping the property.
const nullToEmpty = (v: unknown) => (v === null ? {} : v);

const PropertyDefinitionSchema = z.preprocess(nullToEmpty, z
  .object({
    description: z.string().catch(''),
    // Missing (configs written before property types existed) or unrecognized → 'text'.
    type: z.enum(PROPERTY_TYPES).catch(DEFAULT_PROPERTY_TYPE),
  })
  .loose());

const TypeDefinitionSchema = z.preprocess(nullToEmpty, z
  .object({
    description: z.string().optional().catch(undefined),
    properties: tolerantRecord(PropertyDefinitionSchema),
  })
  .loose());

// ---------------------------------------------------------------------------
// Settings + top-level config schemas
// ---------------------------------------------------------------------------

const AppSettingsSchema = z
  .object({
    fontSize: z.enum(['small', 'medium', 'large', 'xlarge']).catch(defaultSettings.fontSize),
    sortOrder: z
      .enum(['alphabetical', 'created-chron', 'created-reverse', 'modified-chron', 'modified-reverse'])
      .catch(defaultSettings.sortOrder),
    imageCols: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .catch(defaultSettings.imageCols),
    foldersOnTop: z.boolean().catch(defaultSettings.foldersOnTop),
    showToc: z.boolean().catch(defaultSettings.showToc),
    ignoredPaths: z.string().catch(defaultSettings.ignoredPaths),
    searchDefinitions: tolerantArray(SearchDefinitionSchema),
    contentWidth: z.enum(['narrow', 'medium', 'wide', 'full']).catch(defaultSettings.contentWidth),
    bookmarks: tolerantArray(BookmarkSchema),
    calendarItemsFolder: z.string().catch(defaultSettings.calendarItemsFolder),
    // 'hidden' is accepted here although no UI sets it. See: (index_tree.md#toolbar-and-width)
    indexTreeWidth: z.enum(['hidden', 'narrow', 'medium', 'wide']).catch(defaultSettings.indexTreeWidth),
    showPropsInEditor: z.boolean().catch(defaultSettings.showPropsInEditor),
    expandedEditor: z.boolean().catch(defaultSettings.expandedEditor),
    // An unrecognized value (including the abandoned top-level imageSize's old
    // 'small'/'large' meaning) falls back to the default rather than erroring.
    imageSize: z.enum(['small', 'medium', 'large']).catch(defaultSettings.imageSize),
    enableThesaurus: z.boolean().catch(defaultSettings.enableThesaurus),
    wordWrap: z.boolean().catch(defaultSettings.wordWrap),
    pasteToAttachmentsFolder: z.boolean().catch(defaultSettings.pasteToAttachmentsFolder),
  })
  .loose();

const AppConfigSchema = z
  .object({
    browseFolder: z.string().catch(''),
    curSubFolder: z.string().optional().catch(undefined),
    settings: AppSettingsSchema.optional().catch(undefined),
    lastExportFolder: z.string().optional().catch(undefined),
    aiEnabled: z.boolean().optional().catch(undefined),
    aiModels: tolerantArray(AIModelConfigSchema).optional(),
    aiModel: z.string().optional().catch(undefined),
    agenticMode: z.boolean().optional().catch(undefined),
    agenticAllowedFolders: z.string().optional().catch(undefined),
    aiRewritePrompt: z.string().optional().catch(undefined),
    aiRewritePrompts: tolerantArray(AIRewritePromptDefSchema).optional(),
    fullDocContext: z.boolean().optional().catch(undefined),
    tagsPanelVisible: z.boolean().optional().catch(undefined),
    aiRewriteMode: z.boolean().optional().catch(undefined),
    calendarViewType: z.enum(['month', 'week', 'work_week', 'day', 'agenda']).optional().catch(undefined),
    recentFolders: tolerantArray(z.string()).optional(),
    types: tolerantRecord(TypeDefinitionSchema).optional(),
  })
  .loose();

/**
 * Compile-time guard: the schema's inferred output must stay assignable to the
 * hand-written `AppConfig`. If a field is added to `AppConfig` (or a type changes)
 * without a matching schema change, this — and the `return` in `parseConfigYaml`
 * — fail to compile.
 */
type _SchemaMatchesAppConfig = z.infer<typeof AppConfigSchema> extends AppConfig ? true : never;
const _schemaMatchesAppConfig: _SchemaMatchesAppConfig = true;
void _schemaMatchesAppConfig;

/**
 * Validate an already-parsed YAML value against the config schema. Returns a
 * well-formed `AppConfig` (malformed fields normalized away per the rules above)
 * or `null` when the top-level value isn't an object. Never throws.
 */
export function parseConfigYaml(parsed: unknown): AppConfig | null {
  const result = AppConfigSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
