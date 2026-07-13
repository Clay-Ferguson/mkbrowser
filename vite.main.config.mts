import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Packages the main process loads at runtime instead of having bundled in.
      // Anything added here must also match EXTERNAL_DEPENDENCY_PREFIXES in
      // forge.config.ts, or it won't be installed into the packaged app.
      external: [
        // LangChain and Anthropic SDK packages use deep internal imports that the
        // bundler can't resolve at build time. The main process runs in Node.js,
        // so these are simply left as runtime requires.
        /^@langchain\/.*/,
        /^@anthropic-ai\/.*/,
        /^langsmith\/.*/,
        'exifreader',

        // fdir must not be bundled into the main process.
        //
        // Its `exports` map lists "import" before "require", so the bundler picks
        // the ESM build — which calls `createRequire(import.meta.url)`. The main
        // bundle is emitted as CommonJS, and Rolldown (Vite 8) lowers
        // `import.meta.url` to `{}.url`, i.e. `undefined`, so that call throws
        // "The argument 'filename' must be a file URL object..." and the app dies
        // on startup. Rollup, under Vite 5, shimmed `import.meta.url` instead, which
        // is why this only appeared on the Vite 8 upgrade.
        //
        // Leaving fdir external means Node resolves it at runtime and takes the
        // "require" condition — its CJS build, which contains no `import.meta` at
        // all. `resolve.conditions` cannot fix this: condition order is decided by
        // the package's own exports map, not by the consumer.
        //
        // The regex (rather than the bare string 'fdir') also covers deep imports:
        // a bare string matches the exact specifier only, so `fdir/dist/...` would
        // slip past and get bundled. No such import exists today — this keeps it so.
        /^fdir(\/|$)/,

        // rrule, for a related reason: the bundler again picks its ESM build (rrule
        // has no `exports` map at all, so Forge's main config wins via its
        // `resolve.mainFields: ['module', …]` default), and Rolldown's ESM→CJS
        // interop hands that build `undefined` for tslib's default export, so its
        // `const { __extends, … } = tslib.default` throws "Cannot destructure
        // property '__extends'" at startup. Required at runtime, Node does the
        // interop correctly. (npm pulls tslib in as rrule's own dependency, so it
        // needs no entry of its own.) Same deep-import reasoning for the regex.
        /^rrule(\/|$)/,
      ],
    },
  },
});
