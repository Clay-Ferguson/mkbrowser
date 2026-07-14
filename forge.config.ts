import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/**
 * vite.main.config.mts externalizes ALL of node_modules from the main-process
 * bundle — main.js contains only our own code, and every package is loaded by
 * Node at runtime via bare `require()` calls.  The Forge Vite plugin strips
 * node_modules from the asar (it assumes everything is bundled), so we must
 * re-install the main process's dependencies inside the build directory before
 * the asar is created.
 *
 * This list is every npm package imported directly by src/main.ts or src/main/
 * (their transitive deps are pulled in automatically by the npm install).
 * When the main process starts importing a new package, add it here — a stale
 * list fails loudly with "Cannot find module" on first launch of the packaged
 * app.  'electron' itself is provided by the runtime and must not be listed.
 *
 * TODO: Need to check to see if this entire 'packageAfterCopy' stuff is really the best
 * way to handle this.  It works, but it feels a bit hacky.  Maybe there's a better way to
 * tell Forge "hey, these deps aren't bundled, make sure they get included in the final package"?
 */
const MAIN_PROCESS_DEPENDENCIES = [
  '@langchain/anthropic',
  '@langchain/core',
  '@langchain/google-genai',
  '@langchain/langgraph',
  '@langchain/openai',
  'chokidar',
  'deepagents',
  'electron-squirrel-startup',
  'exifreader',
  'exiftool-vendored',
  'fdir',
  'github-slugger',
  'js-yaml',
  'mdast-util-toc',
  'nanoid',
  'rehype-katex',
  'rehype-stringify',
  'remark-frontmatter',
  'remark-gfm',
  'remark-math',
  'remark-parse',
  'remark-rehype',
  'remark-stringify',
  'rrule',
  'unified',
  'zod',
];

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

      // Collect the main-process dependencies (all externalized from main.js)
      const externalDeps: Record<string, string> = {};
      for (const name of MAIN_PROCESS_DEPENDENCIES) {
        const version = (srcPkg.dependencies as Record<string, string>)[name];
        if (!version) {
          throw new Error(`forge.config.ts: '${name}' is in MAIN_PROCESS_DEPENDENCIES but not in package.json dependencies`);
        }
        externalDeps[name] = version;
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

      // eslint-disable-next-line no-console
      console.log('[forge hook] Installing external dependencies in build path:', Object.keys(externalDeps).join(', '));
      // --omit=optional keeps exiftool-vendored's vendored perl distribution
      // (exiftool-vendored.pl, ~25 MB) out of the package: we run the system
      // exiftool from the PATH instead (see src/main/exifUtil.ts).
      execSync('npm install --omit=dev --omit=optional', { cwd: buildPath, stdio: 'inherit' });
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
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
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
