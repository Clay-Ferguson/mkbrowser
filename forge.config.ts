import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Packages listed in vite.main.config.ts `external` are NOT bundled by Vite —
 * they stay as bare `require()` calls in the built main.js.  The Forge Vite
 * plugin strips node_modules from the asar (it assumes everything is bundled),
 * so we must re-install these external deps inside the build directory before
 * the asar is created.
 * 
 * TODO: Need to check to see if this entire 'packageAfterCopy' stuff is really the best
 * way to handle this.  It works, but it feels a bit hacky.  Maybe there's a better way to
 * tell Forge "hey, these deps aren't bundled, make sure they get included in the final package"?
 */
const EXTERNAL_DEPENDENCY_PREFIXES = ['@langchain/', '@anthropic-ai/', 'langsmith', 'node-pty', 'exifreader'];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: './icon-256',
    extraResource: ['./icon-256.png', './resources/pdf-export', './resources/dictionaries'],
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      // Read the source package.json to get dependency versions
      const srcPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

      // Collect only the externalized dependencies
      const externalDeps: Record<string, string> = {};
      for (const [name, version] of Object.entries(srcPkg.dependencies as Record<string, string>)) {
        if (EXTERNAL_DEPENDENCY_PREFIXES.some(prefix => name.startsWith(prefix))) {
          externalDeps[name] = version;
        }
      }

      if (Object.keys(externalDeps).length === 0) return;

      // Write (or update) a package.json in the build directory so npm can install deps
      const buildPkgPath = path.join(buildPath, 'package.json');
      let buildPkg: Record<string, unknown> = {};
      if (fs.existsSync(buildPkgPath)) {
        buildPkg = JSON.parse(fs.readFileSync(buildPkgPath, 'utf-8'));
      }
      buildPkg.dependencies = { ...(buildPkg.dependencies as Record<string, string> ?? {}), ...externalDeps };
      fs.writeFileSync(buildPkgPath, JSON.stringify(buildPkg, null, 2));

      console.log('[forge hook] Installing external dependencies in build path:', Object.keys(externalDeps).join(', '));
      execSync('npm install --omit=dev', { cwd: buildPath, stdio: 'inherit' });
    },
  },
  makers: [
    new MakerDeb({
      options: {
        icon: './icon-256.png',
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
