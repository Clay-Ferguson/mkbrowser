import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from 'vitest';

// configMgr calls app.getPath('userData') at module load to locate config.yaml.
// Point Electron at a throwaway dir created before the module is imported.
const { tmpHome } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path') as typeof import('node:path');
  return { tmpHome: nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'configMgr-test-')) };
});

vi.mock('electron', () => ({ app: { getPath: () => tmpHome } }));

import { initConfig, getConfig, getConfigLoadError, updateConfig, withDefaultAISettings } from '../src/main/configMgr';
import { defaultSettings, cloneDefaultSettings } from '../src/main/configSchema';
import type { AIModelConfig, AppConfig } from '../src/shared/shared';

// configMgr uses app.getPath('userData') directly as CONFIG_DIR, so tmpHome IS the dir.
const CONFIG_DIR = tmpHome;
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

function writeConfig(content: string) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
}

function cleanConfigDir() {
  // Remove config files without deleting tmpHome itself (CONFIG_DIR === tmpHome).
  if (fs.existsSync(CONFIG_DIR)) {
    for (const f of fs.readdirSync(CONFIG_DIR)) {
      if (f.startsWith('config.yaml')) {
        fs.unlinkSync(path.join(CONFIG_DIR, f));
      }
    }
  }
}

beforeEach(() => {
  cleanConfigDir();
});

afterEach(() => {
  cleanConfigDir();
  vi.restoreAllMocks();
});

describe('initConfig — schema-validated load', () => {
  it('loads a valid config and normalizes malformed settings fields to defaults', async () => {
    writeConfig(yaml.dump({ browseFolder: '/home/me', settings: { fontSize: 5, foldersOnTop: false } }));
    await initConfig();
    const cfg = getConfig();
    expect(cfg.browseFolder).toBe('/home/me');
    // Bad enum reverted to default; valid override preserved.
    expect(cfg.settings?.fontSize).toBe(defaultSettings.fontSize);
    expect(cfg.settings?.foldersOnTop).toBe(false);
    // withDefaultAISettings still runs over the validated config (no built-in models).
    expect(cfg.aiModels).toBeUndefined();
    expect(cfg.aiModel).toBe('');
    expect(cfg.aiEnabled).toBe(false);
    expect(getConfigLoadError()).toBeNull();
  });

  it('falls back to defaults when the config file is unparseable YAML', async () => {
    writeConfig(': : not valid yaml : :');
    await initConfig();
    const cfg = getConfig();
    expect(cfg.browseFolder).toBe('');
    expect(cfg.settings).toMatchObject(defaultSettings);
  });

  it('falls back to defaults when the top level is not an object', async () => {
    writeConfig(yaml.dump('just a string'));
    await initConfig();
    const cfg = getConfig();
    expect(cfg.browseFolder).toBe('');
    expect(cfg.settings).toMatchObject(defaultSettings);
  });
});

describe('initConfig — file preservation on error', () => {
  it('does not overwrite a file that contains invalid YAML', async () => {
    const badContent = ': : not valid yaml : :';
    writeConfig(badContent);
    await initConfig();
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(badContent);
  });

  it('does not overwrite a file whose top-level YAML value is not an object', async () => {
    const badContent = yaml.dump('just a string');
    writeConfig(badContent);
    await initConfig();
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(badContent);
  });

  it('does not overwrite when readFileSync throws (e.g. permission error)', async () => {
    writeConfig(yaml.dump({ browseFolder: '/safe' }));
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    await initConfig();
    // The spy threw before writing anything; original content must still be there.
    // Restore the real readFileSync to read back the file for verification.
    vi.restoreAllMocks();
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(yaml.dump({ browseFolder: '/safe' }));
    expect(getConfig().browseFolder).toBe('');
  });

  it('writes defaults to disk on first run (no config file present)', async () => {
    expect(fs.existsSync(CONFIG_FILE)).toBe(false);
    await initConfig();
    expect(fs.existsSync(CONFIG_FILE)).toBe(true);
    const onDisk = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    expect(onDisk).toMatchObject({ browseFolder: '' });
  });
});

describe('initConfig — resilience to persist failures', () => {
  // initConfig()'s writes are seeding/normalization only (first-run defaults,
  // back-filled AI fields); the in-memory config is already complete before
  // they run. A failed flush must therefore never reject initConfig():
  // main.ts awaits it inside the app-ready handler, and a rejection there
  // lands in a catch block that skips setupIpcHandlers()/createWindow() —
  // i.e. a disk problem that only prevents *persisting* would leave the app
  // running with no window at all.
  it('first-run: resolves with in-memory defaults when the initial write fails', async () => {
    expect(fs.existsSync(CONFIG_FILE)).toBe(false);
    // Fail the atomic write at the temp-file open (what ENOSPC/EACCES look like).
    vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    );
    await expect(initConfig()).resolves.toBeUndefined();
    const cfg = getConfig();
    expect(cfg.browseFolder).toBe('');
    expect(cfg.aiEnabled).toBe(false);
    // A write failure is not a *load* error — nothing to surface to the user here.
    expect(getConfigLoadError()).toBeNull();
  });

  it('valid config needing AI back-fill: resolves and keeps loaded values when the write fails', async () => {
    // No AI fields on disk → withDefaultAISettings reports changed → initConfig persists.
    writeConfig(yaml.dump({ browseFolder: '/keep' }));
    vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    );
    await expect(initConfig()).resolves.toBeUndefined();
    // In-memory config is the loaded file plus AI defaults.
    expect(getConfig().browseFolder).toBe('/keep');
    expect(getConfig().aiEnabled).toBe(false);
    expect(getConfigLoadError()).toBeNull();
    // The failed atomic write must not have touched the original file.
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(yaml.dump({ browseFolder: '/keep' }));
  });
});

describe('initConfig — getConfigLoadError()', () => {
  it('returns null after a successful load', async () => {
    writeConfig(yaml.dump({ browseFolder: '/ok' }));
    await initConfig();
    expect(getConfigLoadError()).toBeNull();
  });

  it('returns null on first-run (missing file)', async () => {
    await initConfig();
    expect(getConfigLoadError()).toBeNull();
  });

  it('returns an error object when YAML is invalid', async () => {
    writeConfig(': : not valid yaml : :');
    await initConfig();
    const err = getConfigLoadError();
    expect(err).not.toBeNull();
    expect(typeof err?.error).toBe('string');
    expect(err?.error.length).toBeGreaterThan(0);
  });

  it('returns an error object when top-level YAML is not an object', async () => {
    writeConfig(yaml.dump('just a string'));
    await initConfig();
    const err = getConfigLoadError();
    expect(err).not.toBeNull();
    expect(err?.error).toContain('not an object');
  });

  it('returns an error object when readFileSync throws', async () => {
    writeConfig(yaml.dump({ browseFolder: '/safe' }));
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    await initConfig();
    vi.restoreAllMocks();
    const err = getConfigLoadError();
    expect(err).not.toBeNull();
    expect(err?.error).toContain('EACCES');
  });

  it('is reset to null on a subsequent successful initConfig()', async () => {
    writeConfig(': : not valid yaml : :');
    await initConfig();
    expect(getConfigLoadError()).not.toBeNull();

    // Now write a valid config and re-run.
    writeConfig(yaml.dump({ browseFolder: '/ok' }));
    await initConfig();
    expect(getConfigLoadError()).toBeNull();
  });
});

describe('initConfig — backup on error', () => {
  it('creates a .bak file alongside the broken config', async () => {
    writeConfig(': : not valid yaml : :');
    await initConfig();
    const files = fs.readdirSync(CONFIG_DIR);
    const baks = files.filter((f) => f.startsWith('config.yaml.bak-'));
    expect(baks.length).toBe(1);
    const err = getConfigLoadError();
    expect(err?.backupPath).toBeTruthy();
    expect(fs.existsSync(err?.backupPath ?? '')).toBe(true);
  });

  it('backup contains the original bad content', async () => {
    const badContent = ': : not valid yaml : :';
    writeConfig(badContent);
    await initConfig();
    const err = getConfigLoadError();
    expect(fs.readFileSync(err?.backupPath ?? '', 'utf-8')).toBe(badContent);
  });

  it('does not create a .bak file on first-run (no config present)', async () => {
    await initConfig();
    const files = fs.readdirSync(CONFIG_DIR);
    const baks = files.filter((f) => f.startsWith('config.yaml.bak-'));
    expect(baks.length).toBe(0);
  });

  it('does not create a .bak file on a successful load', async () => {
    writeConfig(yaml.dump({ browseFolder: '/ok' }));
    await initConfig();
    const files = fs.readdirSync(CONFIG_DIR);
    const baks = files.filter((f) => f.startsWith('config.yaml.bak-'));
    expect(baks.length).toBe(0);
  });
});

describe('withDefaultAISettings — pure function, no mutation', () => {
  it('does not mutate its input (frozen object)', () => {
    const input = Object.freeze({ browseFolder: '', settings: cloneDefaultSettings() });
    expect(() => withDefaultAISettings(input)).not.toThrow();
    // Input fields remain absent on the original object.
    expect((input as Record<string, unknown>).aiModels).toBeUndefined();
    expect((input as Record<string, unknown>).aiEnabled).toBeUndefined();
  });

  it('returns a new config object with AI defaults populated', () => {
    const input = { browseFolder: '/test', settings: cloneDefaultSettings() };
    const { config: result, changed } = withDefaultAISettings(input);
    expect(result).not.toBe(input);
    // There are no built-in models to inject.
    expect(result.aiModels).toBeUndefined();
    expect(result.aiModel).toBe('');
    expect(result.aiEnabled).toBe(false);
    expect(result.agenticMode).toBe(false);
    expect(result.agenticAllowedFolders).toBe('');
    expect(changed).toBe(true);
  });

  it('returns changed=false when all AI fields are already set correctly', () => {
    const input = { browseFolder: '', settings: cloneDefaultSettings() };
    // Apply once to get a fully populated config.
    const { config: populated } = withDefaultAISettings(input);
    // Apply again — nothing should differ.
    const { changed } = withDefaultAISettings(populated);
    expect(changed).toBe(false);
  });

  it('preserves the original browseFolder value on the returned config', () => {
    const input = { browseFolder: '/my/folder', settings: cloneDefaultSettings() };
    const { config: result } = withDefaultAISettings(input);
    expect(result.browseFolder).toBe('/my/folder');
  });

  it('normalizes invalid pricing values to 0 on a custom model', () => {
    const badModel: AIModelConfig = {
      name: 'My Custom Model',
      provider: 'OPENAI',
      model: 'gpt-test',
      inputPer1M: -5,
      outputPer1M: NaN,
      vision: false,
    };
    const input = { browseFolder: '', settings: cloneDefaultSettings(), aiModels: [badModel], aiModel: badModel.name };
    const { config: result, changed } = withDefaultAISettings(input);
    const custom = result.aiModels?.find((m) => m.name === 'My Custom Model');
    expect(custom).toBeDefined();
    expect(custom?.inputPer1M).toBe(0);
    expect(custom?.outputPer1M).toBe(0);
    expect(changed).toBe(true);
  });

  it('preserves valid pricing values on a custom model unchanged', () => {
    const goodModel: AIModelConfig = {
      name: 'My Custom Model',
      provider: 'OPENAI',
      model: 'gpt-test',
      inputPer1M: 1.5,
      outputPer1M: 2.0,
      vision: false,
    };
    const input = { browseFolder: '', settings: cloneDefaultSettings(), aiModels: [goodModel] };
    const { config: result } = withDefaultAISettings(input);
    const custom = result.aiModels?.find((m) => m.name === 'My Custom Model');
    expect(custom?.inputPer1M).toBe(1.5);
    expect(custom?.outputPer1M).toBe(2.0);
  });
});

describe('withDefaultAISettings — active model (aiModel) canonicalization', () => {
  function m(name: string): AIModelConfig {
    return { name, provider: 'OPENAI', model: `${name}-id`, inputPer1M: 0, outputPer1M: 0, vision: false };
  }
  const base = { browseFolder: '', settings: cloneDefaultSettings(), aiEnabled: false, agenticMode: false, agenticAllowedFolders: '' };

  it('keeps a selection that names an existing model', () => {
    const { config, changed } = withDefaultAISettings({ ...base, aiModels: [m('A'), m('B')], aiModel: 'B' });
    expect(config.aiModel).toBe('B');
    expect(changed).toBe(false);
  });

  it('canonicalizes a case/whitespace-different selection to the model\'s exact name', () => {
    const { config, changed } = withDefaultAISettings({ ...base, aiModels: [m('Local Llama')], aiModel: ' local llama ' });
    expect(config.aiModel).toBe('Local Llama');
    expect(changed).toBe(true);
  });

  it('falls back to the first model when the selection names no model', () => {
    const { config } = withDefaultAISettings({ ...base, aiModels: [m('A'), m('B')], aiModel: 'Gone' });
    expect(config.aiModel).toBe('A');
  });

  it('falls back to the first model when nothing is selected', () => {
    const { config } = withDefaultAISettings({ ...base, aiModels: [m('A')] });
    expect(config.aiModel).toBe('A');
  });

  it("is '' when there are no models", () => {
    const { config } = withDefaultAISettings({ ...base, aiModels: [], aiModel: 'Gone' });
    expect(config.aiModel).toBe('');
  });
});

describe('updateConfig — AI enforcement gating (issue 007)', () => {
  it('does not alter aiModels/aiModel when only a non-AI key is updated', async () => {
    await initConfig();
    const model: AIModelConfig = { name: 'Mine', provider: 'ANTHROPIC', model: 'x', inputPer1M: 0, outputPer1M: 0, vision: false };
    await updateConfig({ aiModels: [model], aiModel: 'Mine' });
    const before = getConfig();
    const modelsBefore = before.aiModels;
    const aiModelBefore = before.aiModel;

    await updateConfig({ curSubFolder: '/some/path' });

    const after = getConfig();
    expect(after.aiModel).toBe(aiModelBefore);
    expect(after.aiModels).toEqual(modelsBefore);
  });

  it('re-resolves the active model when an AI key is updated', async () => {
    await initConfig();
    const model: AIModelConfig = { name: 'Mine', provider: 'ANTHROPIC', model: 'x', inputPer1M: 0, outputPer1M: 0, vision: false };
    await updateConfig({ aiModels: [model], aiModel: 'mine' });
    expect(getConfig().aiModel).toBe('Mine');
    // Deleting every model clears the selection.
    await updateConfig({ aiModels: [] });
    expect(getConfig().aiModel).toBe('');
  });
});

describe('updateConfig — atomic, durable writes (issue 002)', () => {
  it('leaves the previous good config intact when the write/rename fails mid-flush', async () => {
    // Start from a known-good on-disk config.
    writeConfig(yaml.dump({ browseFolder: '/original' }));
    await initConfig();
    const goodOnDisk = fs.readFileSync(CONFIG_FILE, 'utf-8');

    // Simulate a crash between the temp-file write and the atomic rename: the
    // rename throws, so writeFileAtomic never replaces the target.
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('EIO: simulated crash'), { code: 'EIO' }),
    );

    // The in-memory state still updates synchronously...
    await expect(updateConfig({ browseFolder: '/changed' })).rejects.toThrow();
    expect(getConfig().browseFolder).toBe('/changed');

    vi.restoreAllMocks();

    // ...but the on-disk file is byte-for-byte the previous good config (no
    // truncation, no torn write), and the failed write left no temp file behind.
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(goodOnDisk);
    const stray = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.tmp'));
    expect(stray).toEqual([]);
  });

  it('persists a successful update to disk via the atomic write', async () => {
    writeConfig(yaml.dump({ browseFolder: '/original' }));
    await initConfig();

    await updateConfig({ browseFolder: '/new-folder' });

    const onDisk = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')) as { browseFolder: string };
    expect(onDisk.browseFolder).toBe('/new-folder');
    // No temp files linger after a successful flush.
    const stray = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.tmp'));
    expect(stray).toEqual([]);
  });
});

// There are no built-in models: config.yaml holds exactly the user's models.
describe('persisted aiModels — exactly the user\'s models', () => {
  const userModel: AIModelConfig = {
    name: 'My Custom Model',
    provider: 'OPENAI',
    model: 'gpt-custom',
    baseUrl: 'http://localhost:8080/v1',
    inputPer1M: 1,
    outputPer1M: 2,
    vision: false,
  };

  it('first run writes no models', async () => {
    await initConfig();
    const onDisk = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')) as AppConfig;
    expect(onDisk.aiModels).toBeUndefined();
    expect(onDisk.aiModel).toBe('');
  });

  it('writes the user models (with baseUrl) as given, and round-trips them', async () => {
    await initConfig();
    await updateConfig({ aiModels: [userModel], aiModel: userModel.name });

    const onDisk = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')) as AppConfig;
    expect(onDisk.aiModels).toEqual([userModel]);

    await initConfig();
    expect(getConfig().aiModels).toEqual([userModel]);
    expect(getConfig().aiModel).toBe(userModel.name);
  });

  it('does not rewrite the file on a restart that changes nothing', async () => {
    // A trailing comment is valid YAML that parses to the same config, so it
    // survives iff no write happened.
    await initConfig();
    await updateConfig({ aiModels: [userModel], aiModel: userModel.name });
    fs.appendFileSync(CONFIG_FILE, '\n# sentinel-not-rewritten\n', 'utf-8');

    await initConfig();

    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toContain('# sentinel-not-rewritten');
  });
});

describe('getConfig() — encapsulation (issue 014)', () => {
  it('returns Readonly<AppConfig>, preventing top-level mutation at the type level', async () => {
    await initConfig();
    const cfg = getConfig();
    // Runtime sanity: function returns a usable config object.
    expect(typeof cfg.browseFolder).toBe('string');
    // Type-level: the declared return type is Readonly<AppConfig>, not the mutable AppConfig.
    // This catches accidental mutations like cfg.browseFolder = '...' at compile time.
    expectTypeOf(cfg).toEqualTypeOf<Readonly<AppConfig>>();
    // Assert the readonly-ness directly with a never-invoked mutation probe:
    // expect-type's toEqualTypeOf ignores readonly modifiers, so
    // `.not.toEqualTypeOf<AppConfig>()` cannot express this.
    const rejectsMutation = (): void => {
      // @ts-expect-error -- Readonly<AppConfig> must reject property assignment
      cfg.browseFolder = '/nope';
    };
    void rejectsMutation;
  });
});

describe('configMgr module boundary (issue 020)', () => {
  // configMgr is a main-process runtime manager and must not become a secondary
  // import surface for shared types — those have a single canonical home in
  // src/shared/shared.ts. Type-only re-exports are erased at runtime so they
  // can't be detected via module exports; assert against the source instead.
  it('does not bulk re-export shared types from ../shared/shared', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/main/configMgr.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/export\s+type\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/shared['"]/);
  });
});
