import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// configMgr calls app.getPath('home') at module load to locate config.yaml, so
// point Electron at a throwaway home dir created before the module is imported.
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

import { initConfig, getConfig, getConfigLoadError } from '../src/configMgr';
import { defaultSettings } from '../src/configSchema';

const CONFIG_DIR = path.join(tmpHome, '.config', 'mk-browser');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

function writeConfig(content: string) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
}

beforeEach(() => {
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('initConfig — schema-validated load', () => {
  it('loads a valid config and normalizes malformed settings fields to defaults', () => {
    writeConfig(yaml.dump({ browseFolder: '/home/me', settings: { fontSize: 5, foldersOnTop: false } }));
    initConfig();
    const cfg = getConfig();
    expect(cfg.browseFolder).toBe('/home/me');
    // Bad enum reverted to default; valid override preserved.
    expect(cfg.settings?.fontSize).toBe(defaultSettings.fontSize);
    expect(cfg.settings?.foldersOnTop).toBe(false);
    // createDefaultAISettings still runs over the validated config.
    expect(Array.isArray(cfg.aiModels)).toBe(true);
    expect(cfg.aiModels?.length).toBeGreaterThan(0);
    expect(getConfigLoadError()).toBeNull();
  });

  it('falls back to defaults when the config file is unparseable YAML', () => {
    writeConfig(': : not valid yaml : :');
    initConfig();
    const cfg = getConfig();
    expect(cfg.browseFolder).toBe('');
    expect(cfg.settings).toMatchObject(defaultSettings);
  });

  it('falls back to defaults when the top level is not an object', () => {
    writeConfig(yaml.dump('just a string'));
    initConfig();
    const cfg = getConfig();
    expect(cfg.browseFolder).toBe('');
    expect(cfg.settings).toMatchObject(defaultSettings);
  });
});

describe('initConfig — file preservation on error', () => {
  it('does not overwrite a file that contains invalid YAML', () => {
    const badContent = ': : not valid yaml : :';
    writeConfig(badContent);
    initConfig();
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(badContent);
  });

  it('does not overwrite a file whose top-level YAML value is not an object', () => {
    const badContent = yaml.dump('just a string');
    writeConfig(badContent);
    initConfig();
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(badContent);
  });

  it('does not overwrite when readFileSync throws (e.g. permission error)', () => {
    writeConfig(yaml.dump({ browseFolder: '/safe' }));
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    initConfig();
    // The spy threw before writing anything; original content must still be there.
    // Restore the real readFileSync to read back the file for verification.
    vi.restoreAllMocks();
    expect(fs.readFileSync(CONFIG_FILE, 'utf-8')).toBe(yaml.dump({ browseFolder: '/safe' }));
    expect(getConfig().browseFolder).toBe('');
  });

  it('writes defaults to disk on first run (no config file present)', () => {
    expect(fs.existsSync(CONFIG_FILE)).toBe(false);
    initConfig();
    expect(fs.existsSync(CONFIG_FILE)).toBe(true);
    const onDisk = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    expect(onDisk).toMatchObject({ browseFolder: '' });
  });
});

describe('initConfig — getConfigLoadError()', () => {
  it('returns null after a successful load', () => {
    writeConfig(yaml.dump({ browseFolder: '/ok' }));
    initConfig();
    expect(getConfigLoadError()).toBeNull();
  });

  it('returns null on first-run (missing file)', () => {
    initConfig();
    expect(getConfigLoadError()).toBeNull();
  });

  it('returns an error object when YAML is invalid', () => {
    writeConfig(': : not valid yaml : :');
    initConfig();
    const err = getConfigLoadError();
    expect(err).not.toBeNull();
    expect(typeof err?.error).toBe('string');
    expect(err?.error.length).toBeGreaterThan(0);
  });

  it('returns an error object when top-level YAML is not an object', () => {
    writeConfig(yaml.dump('just a string'));
    initConfig();
    const err = getConfigLoadError();
    expect(err).not.toBeNull();
    expect(err?.error).toContain('not an object');
  });

  it('returns an error object when readFileSync throws', () => {
    writeConfig(yaml.dump({ browseFolder: '/safe' }));
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    initConfig();
    vi.restoreAllMocks();
    const err = getConfigLoadError();
    expect(err).not.toBeNull();
    expect(err?.error).toContain('EACCES');
  });

  it('is reset to null on a subsequent successful initConfig()', () => {
    writeConfig(': : not valid yaml : :');
    initConfig();
    expect(getConfigLoadError()).not.toBeNull();

    // Now write a valid config and re-run.
    writeConfig(yaml.dump({ browseFolder: '/ok' }));
    initConfig();
    expect(getConfigLoadError()).toBeNull();
  });
});

describe('initConfig — backup on error', () => {
  it('creates a .bak file alongside the broken config', () => {
    writeConfig(': : not valid yaml : :');
    initConfig();
    const files = fs.readdirSync(CONFIG_DIR);
    const baks = files.filter((f) => f.startsWith('config.yaml.bak-'));
    expect(baks.length).toBe(1);
    const err = getConfigLoadError();
    expect(err?.backupPath).toBeTruthy();
    expect(fs.existsSync(err!.backupPath!)).toBe(true);
  });

  it('backup contains the original bad content', () => {
    const badContent = ': : not valid yaml : :';
    writeConfig(badContent);
    initConfig();
    const err = getConfigLoadError();
    expect(fs.readFileSync(err!.backupPath!, 'utf-8')).toBe(badContent);
  });

  it('does not create a .bak file on first-run (no config present)', () => {
    initConfig();
    const files = fs.readdirSync(CONFIG_DIR);
    const baks = files.filter((f) => f.startsWith('config.yaml.bak-'));
    expect(baks.length).toBe(0);
  });

  it('does not create a .bak file on a successful load', () => {
    writeConfig(yaml.dump({ browseFolder: '/ok' }));
    initConfig();
    const files = fs.readdirSync(CONFIG_DIR);
    const baks = files.filter((f) => f.startsWith('config.yaml.bak-'));
    expect(baks.length).toBe(0);
  });
});
