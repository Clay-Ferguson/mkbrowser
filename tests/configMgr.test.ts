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

import { initConfig, getConfig, getConfigLoadError, updateConfig, withDefaultAISettings } from '../src/configMgr';
import { defaultSettings, cloneDefaultSettings } from '../src/configSchema';
import type { AIModelConfig, AppConfig } from '../src/types/shared';

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
    // withDefaultAISettings still runs over the validated config.
    expect(Array.isArray(cfg.aiModels)).toBe(true);
    expect(cfg.aiModels?.length).toBeGreaterThan(0);
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
    expect(Array.isArray(result.aiModels)).toBe(true);
    expect(result.aiModels?.length).toBeGreaterThan(0);
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
      readonly: false,
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
      readonly: false,
    };
    const { config: populated } = withDefaultAISettings({ browseFolder: '', settings: cloneDefaultSettings() });
    const input = { ...populated, aiModels: [...(populated.aiModels ?? []), goodModel] };
    const { config: result } = withDefaultAISettings(input);
    const custom = result.aiModels?.find((m) => m.name === 'My Custom Model');
    expect(custom?.inputPer1M).toBe(1.5);
    expect(custom?.outputPer1M).toBe(2.0);
  });
});

describe('updateConfig — AI enforcement gating (issue 007)', () => {
  it('does not alter aiModels/aiModel when only a non-AI key is updated', async () => {
    await initConfig();
    const before = getConfig();
    const modelsBefore = before.aiModels ? [...before.aiModels] : [];
    const aiModelBefore = before.aiModel;

    await updateConfig({ curSubFolder: '/some/path' });

    const after = getConfig();
    expect(after.aiModel).toBe(aiModelBefore);
    expect(after.aiModels).toEqual(modelsBefore);
  });

  it('still enforces AI defaults when an AI key is updated', async () => {
    await initConfig();
    // Wipe aiModels to simulate a partial config; updating aiEnabled should re-inject them.
    await updateConfig({ aiEnabled: true, aiModels: undefined });
    const after = getConfig();
    expect(Array.isArray(after.aiModels)).toBe(true);
    expect((after.aiModels?.length ?? 0)).toBeGreaterThan(0);
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

describe('getConfig() — encapsulation (issue 014)', () => {
  it('returns Readonly<AppConfig>, preventing top-level mutation at the type level', async () => {
    await initConfig();
    const cfg = getConfig();
    // Runtime sanity: function returns a usable config object.
    expect(typeof cfg.browseFolder).toBe('string');
    // Type-level: the declared return type is Readonly<AppConfig>, not the mutable AppConfig.
    // This catches accidental mutations like cfg.browseFolder = '...' at compile time.
    expectTypeOf(cfg).toEqualTypeOf<Readonly<AppConfig>>();
    expectTypeOf(cfg).not.toEqualTypeOf<AppConfig>();
  });
});
