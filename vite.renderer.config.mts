import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    tailwindcss(),
  ],
  server: {
    watch: {
      // Ignore data folders to prevent HMR reloads when editing markdown files
      ignored: ['**/demo-data/**', '**/docs/**', '**/mkbrowser-test/**'],
    },
  },
});
