import * as fs from 'fs';
import * as path from 'path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/**
 * Which of the project's files get copied into the packaged app.
 *
 * We must define this ourselves, because the Forge Vite plugin otherwise installs
 * `ignore: (file) => !file.startsWith('/.vite')` — i.e. it copies ONLY the Vite
 * output and drops node_modules entirely, on the assumption that every dependency
 * has been bundled into main.js.  That assumption does not hold here:
 * vite.main.config.mts deliberately bundles nothing from node_modules (see the
 * comment there — Rolldown's ESM→CJS interop breaks several of our packages), so
 * the main process resolves its dependencies from node_modules at runtime and they
 * have to be in the package.
 *
 * The plugin only sets `ignore` when the config doesn't already define one, so
 * defining it here takes over cleanly.  Keeping node_modules then hands the job to
 * @electron/packager's standard behaviour: it prunes devDependencies during the copy
 * (`prune` defaults to true), so the packaged app contains exactly the production
 * `dependencies` from package.json.  package.json is the single source of truth for
 * what ships — no hand-maintained list of main-process packages to keep in sync.
 */
const PACKAGED_PATHS = ['/.vite', '/package.json', '/node_modules'];

/**
 * exiftool-vendored pulls in a ~22 MB vendored perl distribution as an *optional*
 * production dependency.  We never use it: perl cannot read files inside the asar,
 * so src/main/exifUtil.ts runs the system exiftool from the PATH instead (exiftool
 * is a documented user prerequisite).  Pruning keeps it — it is a production dep —
 * and `ignore` cannot drop it either: @electron/packager's copy filter routes any
 * path that *is* a module straight to the pruner and never consults `ignore`
 * (see copy-filter.js `userPathFilter`).  Deleting it in `afterPrune`, the hook
 * packager provides for exactly this, is the supported way.
 */
const EXCLUDED_MODULES = ['exiftool-vendored.pl'];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: './icon-256',
    extraResource: ['./icon-256.png', './resources/pdf-export', './resources/dictionaries'],
    ignore: (file: string) => {
      if (!file) return false; // the app root itself
      return !PACKAGED_PATHS.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
    },
    afterPrune: [
      (buildPath, _electronVersion, _platform, _arch, done) => {
        for (const name of EXCLUDED_MODULES) {
          fs.rmSync(path.join(buildPath, 'node_modules', name), { recursive: true, force: true });
        }
        done();
      },
    ],
  },
  rebuildConfig: {},
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
