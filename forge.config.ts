import { spawnSync } from 'child_process';
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

/**
 * Dead-weight files stripped from the packaged node_modules via `ignore`. We shave
 * about 6MB off the final build size by removing these.
 *
 * While `ignore` is never consulted for module ROOT directories (packager routes
 * those straight to the pruner — that's why exiftool-vendored.pl needs the
 * afterPrune hook above), it IS applied to ordinary files and subdirectories
 * *inside* a module, so file-level exclusions are the supported way to strip these.
 *
 * Everything listed here is unreachable by Node's runtime module resolution:
 *  - *.map source maps: only consulted for stack-trace mapping; a missing map
 *    just means unmapped traces, never a load failure.
 *  - *.d.ts / *.d.mts / *.d.cts: TypeScript declarations, compile-time only.
 * Deliberately NOT stripped: *.json (js-tiktoken's BPE rank data and every
 * package.json are load-bearing), *.wasm, fonts, and any binary asset.
 */
const STRIPPED_FILE_PATTERNS = [/\.map$/, /\.d\.ts$/, /\.d\.mts$/, /\.d\.cts$/];

/**
 * Run one of the repo's React Compiler gate scripts as a child Node process,
 * inheriting stdio so its report prints normally. Throws on failure, which
 * aborts the Forge run. Both scripts resolve their inputs from process.cwd(),
 * and Forge always runs from the project root.
 */
function runGate(script: string): void {
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${script} failed — packaging aborted.`);
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: './icon-256',
    extraResource: ['./icon-256.png', './resources/pdf-export', './resources/dictionaries'],
    ignore: (file: string) => {
      if (!file) return false; // the app root itself
      if (!PACKAGED_PATHS.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))) {
        return true;
      }
      if (file.startsWith('/node_modules/')) {
        if (STRIPPED_FILE_PATTERNS.some((re) => re.test(file))) return true;
      }
      return false;
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
  // The two React Compiler gates run as Forge hooks so that EVERY packaging
  // path — `npm run package`, `npm run make`, build.sh, playwright-test.sh,
  // and the e2e global-setup's auto-build — is gated structurally; there is no
  // way to package without them. (They previously lived in the shell scripts,
  // where a direct `npm run package` bypassed them.) `electron-forge start` is
  // unaffected: these hooks only fire for package/make.
  hooks: {
    // Pre-packaging: every component/hook must compile under the React
    // Compiler (a bailout ships de-memoized — see compiler-coverage.mjs).
    // A passing run also records the compiled-function count in
    // .compiler-coverage-count.json, which the postPackage gate reads as its
    // floor — so the hook ordering also guarantees that file is fresh.
    prePackage: async () => {
      runGate('compiler-coverage.mjs');
    },
    // Post-packaging: the compiler's output must actually be present in the
    // built renderer bundle — the only check that can catch the compiler
    // being silently configured out of the Vite pipeline (see
    // bundle-fingerprint.mjs). Runs here because the Vite output does not
    // exist until packaging has built it.
    postPackage: async () => {
      runGate('bundle-fingerprint.mjs');
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
