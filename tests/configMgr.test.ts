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

import { initConfig, getConfig } from '../src/configMgr';
import { defaultSettings } from '../src/configSchema';

const CONFIG_FILE = path.join(tmpHome, '.config', 'mk-browser', 'config.yaml');

function writeConfig(content: string) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
}

beforeEach(() => {
  fs.rmSync(path.dirname(CONFIG_FILE), { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(CONFIG_FILE), { recursive: true, force: true });
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
