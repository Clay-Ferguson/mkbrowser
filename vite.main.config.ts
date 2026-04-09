import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // LangChain and Anthropic SDK packages use deep internal imports that Rollup
      // can't resolve at build time. Since the main process runs in Node.js, all
      // node_modules should be treated as external (not bundled).
      external: [
        /^@langchain\/.*/,
        /^@anthropic-ai\/.*/,
        /^langsmith\/.*/,
        'node-pty',
        'exifreader',
      ],
    },
  },
});
