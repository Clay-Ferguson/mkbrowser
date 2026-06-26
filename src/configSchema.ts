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
 * `types/shared.ts` are imported by renderer code, so we do NOT derive them via
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
import { AI_PROVIDERS } from './types/shared';
import type { AppConfig, AppSettings } from './types/shared';

// ---------------------------------------------------------------------------
// Settings defaults (single source of truth; configMgr imports these)
// ---------------------------------------------------------------------------

export const defaultSettings: AppSettings = {
  fontSize: 'medium',
  sortOrder: 'alphabetical',
  foldersOnTop: true,
  showToc: true,
  ignoredPaths: '',
  searchDefinitions: [],
  contentWidth: 'medium',
  bookmarks: [],
  ocrToolsFolder: '',
  calendarItemsFolder: '',
  showPropsInEditor: true,
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
function tolerantArray<T extends z.ZodTypeAny>(elem: T) {
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

// Enum defaults mirror the SearchDialog form defaults.
const SearchDefinitionSchema = z
  .object({
    name: z.string(),
    searchText: z.string(),
    searchTarget: z.enum(['content', 'filenames']).catch('content'),
    searchMode: z.enum(['literal', 'wildcard', 'advanced']).catch('literal'),
    sortBy: z.enum(['modified-time', 'created-time', 'file-name']).catch('modified-time'),
    sortDirection: z.enum(['asc', 'desc']).catch('desc'),
    searchImageExif: z.boolean().optional(),
    mostRecent: z.boolean().optional(),
  })
  .loose();

const BookmarkSchema = z
  .object({
    path: z.string(),
    name: z.string(),
  })
  .loose();

// An unsupported `provider` degrades to AI_PROVIDERS[0] rather than dropping the
// whole model (name, model id, pricing): a mis-routed model is visible and
// fixable in the UI, whereas a vanished one is a silent surprise.
const AIModelConfigSchema = z
  .object({
    name: z.string(),
    provider: z.enum(AI_PROVIDERS).catch(AI_PROVIDERS[0]),
    model: z.string(),
    inputPer1M: nonNegNumber.catch(0),
    outputPer1M: nonNegNumber.catch(0),
    vision: z.boolean().catch(false),
    readonly: z.boolean().catch(false),
  })
  .loose();

const AIRewritePromptDefSchema = z
  .object({
    name: z.string(),
    prompt: z.string(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Settings + top-level config schemas
// ---------------------------------------------------------------------------

const AppSettingsSchema = z
  .object({
    fontSize: z.enum(['small', 'medium', 'large', 'xlarge']).catch(defaultSettings.fontSize),
    sortOrder: z
      .enum(['alphabetical', 'created-chron', 'created-reverse', 'modified-chron', 'modified-reverse'])
      .catch(defaultSettings.sortOrder),
    foldersOnTop: z.boolean().catch(defaultSettings.foldersOnTop),
    showToc: z.boolean().catch(defaultSettings.showToc),
    ignoredPaths: z.string().catch(defaultSettings.ignoredPaths),
    searchDefinitions: tolerantArray(SearchDefinitionSchema),
    contentWidth: z.enum(['narrow', 'medium', 'wide', 'full']).catch(defaultSettings.contentWidth),
    bookmarks: tolerantArray(BookmarkSchema),
    ocrToolsFolder: z.string().catch(defaultSettings.ocrToolsFolder),
    calendarItemsFolder: z.string().catch(defaultSettings.calendarItemsFolder),
    showPropsInEditor: z.boolean().catch(defaultSettings.showPropsInEditor),
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
    llamacppBaseUrl: z.string().optional().catch(undefined),
    llamacppFolder: z.string().optional().catch(undefined),
    agenticMode: z.boolean().optional().catch(undefined),
    agenticAllowedFolders: z.string().optional().catch(undefined),
    aiRewritePrompt: z.string().optional().catch(undefined),
    aiRewritePrompts: tolerantArray(AIRewritePromptDefSchema).optional(),
    fullDocContext: z.boolean().optional().catch(undefined),
    tagsPanelVisible: z.boolean().optional().catch(undefined),
    aiRewriteMode: z.boolean().optional().catch(undefined),
    calendarViewType: z.enum(['month', 'week', 'work_week', 'day', 'agenda']).optional().catch(undefined),
    recentFolders: tolerantArray(z.string()).optional(),
    imageSize: z.enum(['small', 'large']).optional().catch(undefined),
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
